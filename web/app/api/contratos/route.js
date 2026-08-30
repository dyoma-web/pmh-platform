import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

// Línea de vida (0018): captura de los actos y entregas del contrato que antes
// no tenían fecha. Cada acción escribe UNA fecha y deja auditoría; nada se inventa
// hacia atrás (si un contrato legado no tiene emisión, se registra la firma sin
// fabricar la emisión).
//  - firmar            {contract_code, parte: interna|contratista, fecha?}
//  - entregable_crear  {contract_code, description, due_date, rounds_agreed?, ihpsc_group?}
//  - entregable_entregar / entregable_aprobar {entregable_id, fecha?}
//  - entregable_devolver {entregable_id, motivo}  → suma una ronda de ajustes
//  - documentos_proyecto {project_code, contract_url, fecha?}

const err = (s, m) => NextResponse.json({ error: m }, { status: s });
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ""));

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
    await client.query("select set_config('app.actor', $1, true)", [actor.full_name]);
    const audit = (entity, id, action, after) => client.query(
      `insert into audit.event_log (actor, entity, entity_id, action, after)
       values ($1,$2,$3,$4,$5)`, [actor.full_name, entity, String(id), action, JSON.stringify(after)]);
    const fecha = fechaValida(b.fecha) ? b.fecha : new Date().toISOString().slice(0, 10);

    if (b.accion === "firmar") {
      const { rows: [k] } = await client.query(
        "select code, state, issued_at, signed_internal_at, signed_contractor_at from procurement.contract where code=$1 for update",
        [b.contract_code]);
      if (!k) { await client.query("rollback"); return err(404, "El contrato no existe."); }
      if (k.state === "annulled") { await client.query("rollback"); return err(409, "Un contrato anulado no se firma."); }
      if (b.parte === "interna") {
        if (!esAdmin) { await client.query("rollback"); return err(403, "La firma de InnovaHub la registra administración."); }
        if (k.signed_internal_at) { await client.query("rollback"); return err(409, "La firma de InnovaHub ya está registrada; las fechas no se reescriben."); }
        await client.query(
          "update procurement.contract set signed_internal_at=$1, signed_internal_by=$2 where code=$3",
          [fecha, actor.id, k.code]);
      } else if (b.parte === "contratista") {
        if (k.signed_contractor_at) { await client.query("rollback"); return err(409, "La firma del contratista ya está registrada."); }
        await client.query(
          "update procurement.contract set signed_contractor_at=$1 where code=$2", [fecha, k.code]);
      } else { await client.query("rollback"); return err(422, "parte debe ser interna o contratista."); }
      await audit("contract", k.code, `contrato.firma_${b.parte}`, { fecha });
      await client.query("commit");
      return NextResponse.json({ ok: true, fecha });
    }

    if (b.accion === "entregable_crear") {
      const { contract_code, description, due_date, rounds_agreed, ihpsc_group } = b;
      if (!description?.trim() || !fechaValida(due_date)) {
        await client.query("rollback"); return err(422, "Descripción y fecha de compromiso son obligatorias.");
      }
      const { rows: [k] } = await client.query(
        "select code, state from procurement.contract where code=$1", [contract_code]);
      if (!k) { await client.query("rollback"); return err(404, "El contrato no existe."); }
      if (k.state !== "active") { await client.query("rollback"); return err(409, `El contrato está «${k.state}»: solo se planean entregas en contratos activos.`); }
      const { rows: [d] } = await client.query(
        `insert into procurement.contract_deliverable
         (contract_code, description, ihpsc_group, due_date, rounds_agreed, created_by)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [k.code, description.trim().slice(0, 200), ihpsc_group || null, due_date,
         Number.isInteger(Number(rounds_agreed)) && Number(rounds_agreed) >= 0 ? Number(rounds_agreed) : 1,
         actor.full_name]);
      await audit("contract_deliverable", d.id, "entrega.planear", { contrato: k.code, due_date });
      await client.query("commit");
      return NextResponse.json({ ok: true, id: d.id });
    }

    if (["entregable_entregar", "entregable_aprobar", "entregable_devolver"].includes(b.accion)) {
      const { rows: [d] } = await client.query(
        `select d.*, k.state contrato_estado, k.overseer_id from procurement.contract_deliverable d
         join procurement.contract k on k.code = d.contract_code
         where d.id=$1 for update of d`, [b.entregable_id]);
      if (!d) { await client.query("rollback"); return err(404, "El entregable no existe."); }
      if (d.approved_at) { await client.query("rollback"); return err(409, "Ese entregable ya fue aprobado; no se reabre."); }

      if (b.accion === "entregable_entregar") {
        await client.query(
          `update procurement.contract_deliverable
           set first_delivered_at = coalesce(first_delivered_at, $1), delivered_at = $1,
               updated_at = now() where id=$2`, [fecha, d.id]);
        await audit("contract_deliverable", d.id, "entrega.entregar", { contrato: d.contract_code, fecha, ronda: d.rounds_used });
      } else if (b.accion === "entregable_aprobar") {
        if (!d.delivered_at) { await client.query("rollback"); return err(422, "No se aprueba lo que no se ha entregado: registra primero la entrega."); }
        await client.query(
          `update procurement.contract_deliverable
           set approved_at=$1, approved_by=$2, updated_at=now() where id=$3`, [fecha, actor.id, d.id]);
        await audit("contract_deliverable", d.id, "entrega.aprobar",
          { contrato: d.contract_code, fecha, rondas: `${d.rounds_used}/${d.rounds_agreed}` });
      } else {
        if (!d.delivered_at) { await client.query("rollback"); return err(422, "Solo se devuelve lo entregado."); }
        if (!b.motivo?.trim()) { await client.query("rollback"); return err(422, "Devolver exige el motivo: el contratista debe saber qué ajustar."); }
        await client.query(
          `update procurement.contract_deliverable
           set rounds_used = rounds_used + 1, returned_reason=$1, updated_at=now() where id=$2`,
          [b.motivo.trim(), d.id]);
        await audit("contract_deliverable", d.id, "entrega.devolver",
          { contrato: d.contract_code, ronda: d.rounds_used + 1, pactadas: d.rounds_agreed, motivo: b.motivo.trim() });
      }
      await client.query("commit");
      return NextResponse.json({ ok: true, excede_rondas: b.accion === "entregable_devolver" && d.rounds_used + 1 > d.rounds_agreed });
    }

    if (b.accion === "documentos_proyecto") {
      if (!b.contract_url?.trim()) { await client.query("rollback"); return err(422, "Falta la URL de la carpeta del contrato."); }
      const { rows: [p] } = await client.query(
        `select p.id, p.code from core.project p left join core.project_alias a on a.project_id = p.id
         where p.code=$1 or a.alias=$1 limit 1`, [b.project_code]);
      if (!p) { await client.query("rollback"); return err(404, "El proyecto no existe."); }
      await client.query(
        "update core.project set contract_url=$1, docs_uploaded_at=coalesce(docs_uploaded_at,$2) where id=$3",
        [b.contract_url.trim(), fecha, p.id]);
      await audit("project", p.code, "proyecto.documentos", { fecha });
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
