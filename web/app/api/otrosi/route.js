import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

// F3 · Otrosí: el contrato original nunca se edita.
// solicitar (gestora/supervisora) → aprobar/rechazar (administración, distinta de quien pidió).
// Al aprobar, el sistema aplica el cambio y deja la traza completa.

const err = (s, m) => NextResponse.json({ error: m }, { status: s });

export async function POST(req) {
  const b = await req.json().catch(() => null);
  if (!b?.accion || !b?.actor_id) return err(400, "Faltan datos: accion y actor_id.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: [actor] } = await client.query(
      "select id, full_name, app_role, ih_role, active from core.app_user where id=$1", [b.actor_id]);
    if (!actor?.active) { await client.query("rollback"); return err(403, "Actor inexistente o inactivo."); }
    const esAdmin = actor.app_role === "admin" || actor.ih_role === "Administrative Project Manager";
    const audit = (id, action, after) => client.query(
      `insert into audit.event_log (actor, entity, entity_id, action, after)
       values ($1,'contract_amendment',$2,$3,$4)`,
      [actor.full_name, String(id), action, JSON.stringify(after)]);

    if (b.accion === "solicitar") {
      const { contract_code, effect, detail, changes } = b;
      if (!detail?.trim()) { await client.query("rollback"); return err(422, "El otrosí necesita el detalle de qué cambia y por qué."); }
      const { rows: [k] } = await client.query(
        "select code, state, amount from procurement.contract where code=$1 for update", [contract_code]);
      if (!k) { await client.query("rollback"); return err(404, "El contrato no existe."); }
      if (k.state !== "active") {
        await client.query("rollback");
        return err(409, `El contrato está «${k.state}»: solo los activos se modifican por otrosí.`);
      }
      if (effect === "monto" && !(Number(changes?.nuevo_monto) > 0)) {
        await client.query("rollback"); return err(422, "Un otrosí de monto necesita el nuevo monto.");
      }
      if (effect === "fechas") {
        const { rows: [p] } = await client.query(
          `select id, adm_validated_at from procurement.contract_payment
           where id=$1 and contract_code=$2`, [changes?.pago_id, contract_code]);
        if (!p) { await client.query("rollback"); return err(422, "Un otrosí de fechas necesita el pago a mover (de este contrato)."); }
        if (p.adm_validated_at) { await client.query("rollback"); return err(409, "Ese pago ya se validó y pagó: su fecha no se mueve."); }
        if (!changes?.nueva_fecha) { await client.query("rollback"); return err(422, "Falta la nueva fecha."); }
      }
      const { rows: [a] } = await client.query(
        `insert into procurement.contract_amendment
         (contract_code, effect, detail, changes, requested_by)
         values ($1,$2,$3,$4,$5) returning id`,
        [contract_code, effect, detail.trim(), JSON.stringify(changes || {}), actor.id]);
      await audit(a.id, "otrosi.solicitar", { contrato: contract_code, efecto: effect });
      await client.query("commit");
      return NextResponse.json({ ok: true, id: a.id });
    }

    if (b.accion === "aprobar" || b.accion === "rechazar") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "Resolver un otrosí es de administración."); }
      const { rows: [a] } = await client.query(
        `select am.*, c.amount as monto_actual, c.state as contrato_estado
         from procurement.contract_amendment am
         join procurement.contract c on c.code = am.contract_code
         where am.id = $1 for update of am`, [b.otrosi_id]);
      if (!a) { await client.query("rollback"); return err(404, "El otrosí no existe."); }
      if (a.state !== "requested") {
        await client.query("rollback"); return err(409, `Ya fue resuelto: ${a.state}.`);
      }
      if (a.requested_by === actor.id) {
        await client.query("rollback");
        return err(403, "Separación de funciones: quien solicita el otrosí no lo resuelve.");
      }

      if (b.accion === "rechazar") {
        if (!b.nota?.trim()) { await client.query("rollback"); return err(422, "Rechazar exige una nota: la solicitante debe saber por qué."); }
        await client.query(
          `update procurement.contract_amendment
           set state='rejected', resolved_by=$1, resolved_at=now(), resolution_note=$2
           where id=$3`, [actor.id, b.nota.trim(), a.id]);
        await audit(a.id, "otrosi.rechazar", { nota: b.nota.trim() });
        await client.query("commit");
        return NextResponse.json({ ok: true });
      }

      // aprobar: aplicar el efecto
      const ch = a.changes || {};
      let aplicado = {};
      if (a.effect === "monto") {
        await client.query(
          `update procurement.contract
           set amount=$1,
               amount_note = coalesce(amount_note,'') ||
                 format(' · OTROSÍ #%s: %s → %s', $2::text, $3::numeric, $1::numeric)
           where code=$4`, [ch.nuevo_monto, a.id, a.monto_actual, a.contract_code]);
        aplicado = { monto_anterior: a.monto_actual, monto_nuevo: ch.nuevo_monto };
      } else if (a.effect === "fechas") {
        const { rows: [p] } = await client.query(
          `update procurement.contract_payment set due_date=$1, updated_at=now(), updated_by=$2
           where id=$3 and adm_validated_at is null returning due_date`, [ch.nueva_fecha, actor.id, ch.pago_id]);
        if (!p) { await client.query("rollback"); return err(409, "El pago ya no se puede mover (fue validado)."); }
        aplicado = { pago: ch.pago_id, nueva_fecha: ch.nueva_fecha };
      } else if (a.effect === "anulacion") {
        await client.query(
          "update procurement.contract set state='annulled' where code=$1", [a.contract_code]);
        const { rowCount } = await client.query(
          `update procurement.contract_payment
           set cancelled_at=current_date, cancelled_reason=$1
           where contract_code=$2 and adm_validated_at is null and cancelled_at is null`,
          [`Otrosí #${a.id}: anulación`, a.contract_code]);
        aplicado = { contrato: "annulled", pagos_anulados: rowCount };
      } // alcance: el detalle documenta; no hay cambio automático

      await client.query(
        `update procurement.contract_amendment
         set state='approved', resolved_by=$1, resolved_at=now(), resolution_note=$2
         where id=$3`, [actor.id, b.nota?.trim() || null, a.id]);
      await audit(a.id, "otrosi.aprobar", { efecto: a.effect, ...aplicado });
      await client.query("commit");
      return NextResponse.json({ ok: true, aplicado });
    }

    await client.query("rollback");
    return err(400, `Acción desconocida: ${b.accion}`);
  } catch (e) {
    await client.query("rollback");
    return err(500, "La base de datos rechazó la operación: " + e.message);
  } finally {
    client.release();
  }
}
