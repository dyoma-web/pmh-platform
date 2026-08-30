import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

// F4 · Ciclo de ingresos: Programado → Facturado → Abonado parcial → Pagado.
// - crear (gestora): hito sobre proyecto vigente
// - facturar (gestora/partner): fecha + número + factura al almacén
// - acreditar (administración): cada abono es un money_event; el hito queda
//   «partial» hasta que la suma salda y pasa a «credited»
// - reprogramar: mueve el forecast con categoría de retraso — NUNCA la fecha
//   esperada: el aging no se maquilla
// - gestion: registra la gestión de cobro (cierra el semáforo con acción)

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
       values ($1,'milestone',$2,$3,$4)`, [actor.full_name, String(id), action, JSON.stringify(after)]);

    if (b.accion === "crear") {
      const { project_code, amount_cop, expected_date, contract_date, deliverables } = b;
      if (!(Number(amount_cop) > 0) || !expected_date) {
        await client.query("rollback"); return err(422, "Un hito necesita monto en COP y fecha esperada.");
      }
      const { rows: [proy] } = await client.query(
        `select p.id, p.status from core.project p
         left join core.project_alias a on a.project_id = p.id
         where p.code = $1 or a.alias = $1 limit 1`, [project_code]);
      if (!proy) { await client.query("rollback"); return err(404, `El proyecto ${project_code} no existe.`); }
      if (["completed", "cancelled"].includes(proy.status)) {
        await client.query("rollback");
        return err(422, "El proyecto está cerrado: los hitos nuevos van en el proyecto vigente.");
      }
      const { rows: [m] } = await client.query(
        `insert into revenue.milestone
         (project_id, amount_cop, contract_date, expected_date, state, deliverables, updated_at, updated_by)
         values ($1,$2,$3,$4,'scheduled',$5,now(),$6) returning id`,
        [proy.id, amount_cop, contract_date || null, expected_date, deliverables || null, actor.id]);
      await audit(m.id, "hito.crear", { proyecto: project_code, monto: amount_cop, esperada: expected_date });
      await client.query("commit");
      return NextResponse.json({ ok: true, id: m.id });
    }

    const { rows: [m] } = await client.query(
      `select m.*, p.code project_code, r.recibido_cop, r.saldo_cop
       from revenue.milestone m
       join core.project p on p.id = m.project_id
       join revenue.v_milestone_recibido r on r.milestone_id = m.id
       where m.id = $1 for update of m`, [b.hito_id]);
    if (!m) { await client.query("rollback"); return err(404, "El hito no existe."); }

    if (b.accion === "facturar") {
      if (m.state !== "scheduled") {
        await client.query("rollback");
        return err(409, `El hito está «${m.state}»: solo los programados se facturan.`);
      }
      await client.query(
        `update revenue.milestone
         set state='invoiced', invoice_date=$1, invoice_number=$2, invoice_url=coalesce($3, invoice_url),
             credited_date_approx=false, updated_at=now(), updated_by=$4
         where id=$5`,
        [b.invoice_date || new Date().toISOString().slice(0, 10), b.invoice_number || null,
         b.invoice_url || null, actor.id, m.id]);
      await audit(m.id, "hito.facturar", { numero: b.invoice_number, monto: m.amount_cop });
      await client.query("commit");
      return NextResponse.json({ ok: true });
    }

    if (b.accion === "acreditar") {
      if (!esAdmin) {
        await client.query("rollback");
        return err(403, "Registrar dinero recibido es de administración.");
      }
      if (!["invoiced", "partial"].includes(m.state)) {
        await client.query("rollback");
        return err(409, m.state === "scheduled"
          ? "Primero se factura, luego se acredita. Usa «Facturar» — o registra la factura con su fecha real."
          : `El hito está «${m.state}».`);
      }
      const saldo = Number(m.saldo_cop);
      const monto = Number(b.monto_cop ?? saldo);
      if (!(monto > 0)) { await client.query("rollback"); return err(422, "El abono debe ser mayor que cero."); }
      if (monto > saldo + 1) {
        await client.query("rollback");
        return err(422, `El abono ($ ${monto.toLocaleString("es-CO")}) supera el saldo del hito ($ ${saldo.toLocaleString("es-CO")}). Si el cliente pagó de más, va como ajuste, no aquí.`);
      }
      const fecha = b.fecha || new Date().toISOString().slice(0, 10);
      await client.query(
        `insert into ledger.money_event
         (direction, kind, project_id, event_date, amount, currency, fx_rate,
          milestone_id, source_table, document_url, note)
         values ('in','revenue_credit',$1,$2,$3,'COP',1,$4,'api/hitos',$5,$6)`,
        [m.project_id, fecha, monto, m.id, b.soporte_url || null,
         `Abono registrado por ${actor.full_name}`]);
      const saldado = monto >= saldo - 1;
      await client.query(
        `update revenue.milestone
         set state=$1, credited_date=case when $1='credited' then $2::date else credited_date end,
             credited_date_approx=false, updated_at=now(), updated_by=$3
         where id=$4`,
        [saldado ? "credited" : "partial", fecha, actor.id, m.id]);
      await audit(m.id, "hito.acreditar",
        { abono: monto, saldo_restante: saldado ? 0 : saldo - monto, estado: saldado ? "credited" : "partial" });
      await client.query("commit");
      return NextResponse.json({ ok: true, estado: saldado ? "credited" : "partial", saldo: saldado ? 0 : saldo - monto });
    }

    if (b.accion === "reprogramar") {
      if (!b.forecast_date || !b.delay_category || !b.nota?.trim()) {
        await client.query("rollback");
        return err(422, "Reprogramar exige nueva fecha probable, categoría de retraso y nota.");
      }
      if (!["externo", "interno", "mixto", "otro"].includes(b.delay_category)) {
        await client.query("rollback"); return err(422, "Categoría de retraso inválida.");
      }
      await client.query(
        `update revenue.milestone
         set forecast_date=$1, delay_category=$2, delay_note=$3, updated_at=now(), updated_by=$4
         where id=$5`, [b.forecast_date, b.delay_category, b.nota.trim(), actor.id, m.id]);
      await client.query(
        `insert into revenue.collection_action (milestone_id, actor_id, kind, note)
         values ($1,$2,'reprogramacion',$3)`,
        [m.id, actor.id, `Forecast → ${b.forecast_date} (${b.delay_category}): ${b.nota.trim()}`]);
      await audit(m.id, "hito.reprogramar", { forecast: b.forecast_date, categoria: b.delay_category });
      await client.query("commit");
      return NextResponse.json({ ok: true });
    }

    if (b.accion === "gestion") {
      if (!b.nota?.trim()) { await client.query("rollback"); return err(422, "La gestión de cobro se registra con nota: qué se hizo y qué quedó acordado."); }
      await client.query(
        `insert into revenue.collection_action (milestone_id, actor_id, kind, note)
         values ($1,$2,'gestion',$3)`, [m.id, actor.id, b.nota.trim()]);
      await audit(m.id, "hito.gestion_cobro", { nota: b.nota.trim() });
      await client.query("commit");
      return NextResponse.json({ ok: true });
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
