import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

// F3 · Flujo de contratación: solicitud → contrato con llave obligatoria.
// crear   (gestora): solicitud + servicios + plan de pagos (Σ servicios = Σ pagos)
// procesar (admin) : genera el contrato OS_/PS_AAAA_NNN con hiring_request_code — la
//                    cadena que en AppSheet estaba rota queda soldada por FK
// cancelar (gestora/admin): con motivo

const err = (s, m) => NextResponse.json({ error: m }, { status: s });
const hoy = () => new Date().toISOString().slice(0, 10);

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
    const audit = (entity, id, action, after) => client.query(
      `insert into audit.event_log (actor, entity, entity_id, action, after)
       values ($1,$2,$3,$4,$5)`, [actor.full_name, entity, String(id), action, JSON.stringify(after)]);

    // ── CREAR ───────────────────────────────────────────────────────────────
    if (b.accion === "crear") {
      const { project_code, contractor_id, category, payor, servicios, pagos, annotations } = b;
      if (!["OS", "PS"].includes(category)) { await client.query("rollback"); return err(422, "Categoría debe ser OS o PS."); }
      const { rows: [proy] } = await client.query(
        `select p.id, p.status from core.project p
         left join core.project_alias a on a.project_id = p.id
         where p.code = $1 or a.alias = $1 limit 1`, [project_code]);
      if (!proy) { await client.query("rollback"); return err(404, `El proyecto ${project_code} no existe.`); }
      if (["completed", "cancelled"].includes(proy.status)) {
        await client.query("rollback");
        return err(422, "No se contrata sobre un proyecto completado o cancelado. Reábrelo o usa el proyecto vigente.");
      }
      const { rows: [ctr] } = await client.query(
        "select id from procurement.contractor where id = $1", [contractor_id]);
      if (!ctr) { await client.query("rollback"); return err(404, "El contratista no existe en el directorio. Créalo primero."); }
      if (!Array.isArray(servicios) || servicios.length === 0) {
        await client.query("rollback"); return err(422, "La solicitud necesita al menos un servicio con entregable y precio.");
      }
      let totalServicios = 0;
      for (const s of servicios) {
        const t = Number(s.qty) * Number(s.unit_price);
        if (!(Number(s.qty) > 0) || !(Number(s.unit_price) > 0)) {
          await client.query("rollback"); return err(422, "Cada servicio necesita cantidad y precio unitario mayores que cero.");
        }
        totalServicios += t;
      }
      const totalPagos = (pagos || []).reduce((x, p) => x + Number(p.amount), 0);
      if (!pagos?.length || Math.abs(totalPagos - totalServicios) > 1) {
        await client.query("rollback");
        return err(422, `El plan de pagos ($ ${totalPagos.toLocaleString("es-CO")}) debe sumar lo mismo que los servicios ($ ${totalServicios.toLocaleString("es-CO")}).`);
      }
      let budgetLine = null;
      if (b.budget_line_id) {
        const { rows: [bl] } = await client.query(
          `select l.id from budget.line l join budget.version v on v.id = l.version_id
           where l.id = $1 and v.project_id = $2 and v.state = 'approved'`,
          [b.budget_line_id, proy.id]);
        if (!bl) { await client.query("rollback"); return err(422, "La línea presupuestal no pertenece al presupuesto aprobado de este proyecto."); }
        budgetLine = bl.id;
      }
      const { rows: [seq] } = await client.query(
        `select coalesce(max(substring(code from 'GAP-HR-(\\d+)')::int), 0) + 1 n
         from procurement.hiring_request`);
      const code = `GAP-HR-${String(seq.n).padStart(4, "0")}`;
      await client.query(
        `insert into procurement.hiring_request
         (code, project_id, contractor_id, requested_by, ih_capacity, payor_org, category, state, start_date, annotations, budget_line_id)
         values ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10)`,
        [code, proy.id, contractor_id, actor.id, b.ih_capacity === true,
         payor || "InnovaHub Colombia SAS", category, b.start_date || hoy(), annotations || null,
         budgetLine]);
      for (let i = 0; i < servicios.length; i++) {
        const s = servicios[i];
        await client.query(
          `insert into procurement.request_service values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [`${code}-${String(i + 1).padStart(4, "0")}`, code, s.description, s.unit,
           s.qty, s.unit_price, Number(s.qty) * Number(s.unit_price), s.deliverable || null, s.due_date || null]);
      }
      for (let i = 0; i < pagos.length; i++) {
        await client.query(
          `insert into procurement.request_payment values ($1,$2,$3,$4,$5)`,
          [`${code}-P${String(i + 1).padStart(3, "0")}`, code, pagos[i].due_date,
           pagos[i].method || "Disaggregated", pagos[i].amount]);
      }
      await audit("hiring_request", code, "solicitud.crear",
        { proyecto: project_code, total: totalServicios, servicios: servicios.length });
      await client.query("commit");
      return NextResponse.json({ ok: true, code, total: totalServicios });
    }

    // ── PROCESAR → CONTRATO ────────────────────────────────────────────────
    if (b.accion === "procesar") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "Procesar una solicitud es de administración."); }
      const { rows: [r] } = await client.query(
        `select hr.*, p.code as project_code from procurement.hiring_request hr
         join core.project p on p.id = hr.project_id
         where hr.code = $1 for update`, [b.solicitud]);
      if (!r) { await client.query("rollback"); return err(404, "La solicitud no existe."); }
      if (r.state !== "requested") {
        await client.query("rollback");
        return err(409, `La solicitud está en estado «${r.state}»; solo se procesan las solicitadas.`);
      }
      const { rows: [tot] } = await client.query(
        "select coalesce(sum(total),0) t, min(due_date) d from procurement.request_service where request_code=$1",
        [b.solicitud]);
      const { rows: pagos } = await client.query(
        "select due_date, amount from procurement.request_payment where request_code=$1 order by due_date",
        [b.solicitud]);
      const anio = new Date().getFullYear();
      const { rows: [seq] } = await client.query(
        `select coalesce(max(substring(code from '_(\\d+)$')::int), 0) + 1 n
         from procurement.contract where code like $1`, [`${r.category}_${anio}_%`]);
      const contrato = `${r.category}_${anio}_${String(seq.n).padStart(3, "0")}`;
      // La imputación presupuestal viaja de la solicitud al contrato; el trigger
      // contrato_respeta_linea impide exceder la línea (0009).
      // Línea de vida (0018): borrador = creación de la solicitud, emisión = hoy,
      // línea base del sobrecosto = monto emitido.
      await client.query(
        `insert into procurement.contract
         (code, project_id, contractor_id, hiring_request_code, overseer_id, account_category,
          org_entity, amount, currency, start_date, end_date, state, annotations, budget_line_id,
          drafted_at, issued_at, base_amount)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'COP',$9,$10,'active',$11,$12,$13,current_date,$8)`,
        [contrato, r.project_id, r.contractor_id, r.code, r.requested_by, b.account_category || null,
         r.payor_org, tot.t, r.start_date || tot.d || hoy(),
         pagos.at(-1)?.due_date || null, `Generado desde ${r.code}`, r.budget_line_id,
         r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : null]);
      for (const p of pagos) {
        await client.query(
          `insert into procurement.contract_payment (contract_code, due_date, amount)
           values ($1,$2,$3)`, [contrato, p.due_date, p.amount]);
      }
      // El plan de entregas nace de las líneas de servicio de la solicitud.
      await client.query(
        `insert into procurement.contract_deliverable
           (contract_code, request_service_id, description, ihpsc_group, due_date, created_by)
         select $1, s.legacy_id,
                left(coalesce(nullif(trim(s.deliverable),''), nullif(trim(s.description),''), 'Entregable'), 200),
                s.ihpsc_group, coalesce(s.due_date, $2::date), $3
           from procurement.request_service s
          where s.request_code = $4 and coalesce(s.due_date, $2::date) is not null`,
        [contrato, pagos.at(-1)?.due_date || null, actor.full_name, r.code]);
      await client.query(
        "update procurement.hiring_request set state='processed' where code=$1", [r.code]);
      await audit("hiring_request", r.code, "solicitud.procesar", { contrato, monto: tot.t });
      await audit("contract", contrato, "contrato.crear", { solicitud: r.code, proyecto: r.project_code });
      await client.query("commit");
      return NextResponse.json({ ok: true, contrato, pagos: pagos.length });
    }

    // ── CANCELAR ───────────────────────────────────────────────────────────
    if (b.accion === "cancelar") {
      if (!b.motivo?.trim()) { await client.query("rollback"); return err(422, "Cancelar exige un motivo."); }
      const { rows: [r] } = await client.query(
        "select state from procurement.hiring_request where code=$1 for update", [b.solicitud]);
      if (!r) { await client.query("rollback"); return err(404, "La solicitud no existe."); }
      if (r.state === "processed") {
        await client.query("rollback");
        return err(409, "Ya se convirtió en contrato: lo que procede es un otrosí de anulación, no cancelar la solicitud.");
      }
      await client.query(
        `update procurement.hiring_request
         set state='cancelled', annotations = coalesce(annotations,'') || ' · CANCELADA: ' || $2
         where code=$1`, [b.solicitud, b.motivo.trim()]);
      await audit("hiring_request", b.solicitud, "solicitud.cancelar", { motivo: b.motivo.trim() });
      await client.query("commit");
      return NextResponse.json({ ok: true });
    }

    await client.query("rollback");
    return err(400, `Acción desconocida: ${b.accion}`);
  } catch (e) {
    await client.query("rollback");
    if (e.message?.includes("línea presupuestal")) {
      return err(409, e.message.split("\n")[0]); // regla de presupuesto del motor, en limpio
    }
    return err(500, "La base de datos rechazó la operación: " + e.message);
  } finally {
    client.release();
  }
}
