import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

// F5 · Alta de proyecto con presupuesto bloqueante (bloqueantes 2 y 6 del checklist).
// - crear_completo (gestora): identidad + financiero (trío monto·moneda·TRM, costeo
//   CALCULADO) + presupuesto por ítem (≥ 100 % de implementación) + hitos (≥ 1).
//   Queda en borrador con presupuesto en borrador.
// - aprobar_y_activar (administración): re-valida las puertas, aprueba la versión
//   de presupuesto y activa. Sin presupuesto aprobado no existe proyecto activo.

const err = (s, m) => NextResponse.json({ error: m }, { status: s });

function costear(montoCop, p) {
  const pct = (k) => Number(p[k] ?? 0);
  const suma = pct("p_margin") + pct("p_ayf") + pct("p_unforeseen") + pct("p_ica") + pct("p_commission");
  const impl = montoCop * (1 - suma / 100);
  return {
    margin: (montoCop * pct("p_margin")) / 100,
    ayf: (montoCop * pct("p_ayf")) / 100,
    unforeseen: (montoCop * pct("p_unforeseen")) / 100,
    ica: (montoCop * pct("p_ica")) / 100,
    commission: (montoCop * pct("p_commission")) / 100,
    implementation_budget: impl,
    implementation_reserve: impl * 0.2,
    management_budget: impl * 0.8,
  };
}

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
       values ($1,'project',$2,$3,$4)`, [actor.full_name, String(id), action, JSON.stringify(after)]);

    if (b.accion === "crear_completo") {
      const { code, display_code, cliente_id, country, service_line, org_entity,
        framework_code, monto, moneda, fx, fx_kind, porcentajes,
        start_date, closing_date, presupuesto, hitos } = b;

      if (!/^[a-z0-9_áéíóúñ]+$/.test(code || "")) {
        await client.query("rollback");
        return err(422, "El código canónico va en minúsculas con guiones bajos (p. ej. gt_giz_formacion_tecnica_2026).");
      }
      const { rows: [dup] } = await client.query(
        `select 1 from core.project where code=$1
         union select 1 from core.project_alias where alias=$1`, [code]);
      if (dup) { await client.query("rollback"); return err(409, `El código ${code} ya existe (o es alias de otro proyecto).`); }
      if (!(Number(monto) > 0) || !moneda) {
        await client.query("rollback"); return err(422, "El financiero exige monto y moneda juntos.");
      }
      const fxRate = moneda === "COP" ? 1 : Number(fx);
      if (!(fxRate > 0)) { await client.query("rollback"); return err(422, "La TRM no puede ser cero: escribe la tasa pactada o usa la de mercado."); }
      if (!start_date || !closing_date || closing_date <= start_date) {
        await client.query("rollback"); return err(422, "El cierre debe ser posterior al inicio.");
      }
      if (!Array.isArray(hitos) || hitos.length === 0) {
        await client.query("rollback"); return err(422, "El proyecto necesita al menos un hito de ingreso con fecha esperada.");
      }
      const montoCop = Number(monto) * fxRate;
      const c = costear(montoCop, porcentajes || {});
      const totalPres = (presupuesto || []).reduce(
        (s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
      if (!presupuesto?.length || totalPres < c.implementation_budget * 0.999) {
        await client.query("rollback");
        return err(422, `El presupuesto por ítem ($ ${Math.round(totalPres).toLocaleString("es-CO")}) debe cubrir el 100 % de la implementación ($ ${Math.round(c.implementation_budget).toLocaleString("es-CO")}). Sin presupuesto desglosado el proyecto no puede activarse.`);
      }
      const totalHitos = hitos.reduce((s, h) => s + Number(h.amount_cop), 0);
      if (Math.abs(totalHitos - montoCop) > montoCop * 0.01) {
        await client.query("rollback");
        return err(422, `Los hitos de ingreso ($ ${Math.round(totalHitos).toLocaleString("es-CO")}) deben sumar el valor del proyecto ($ ${Math.round(montoCop).toLocaleString("es-CO")}).`);
      }

      const { rows: [proy] } = await client.query(
        `insert into core.project
         (code, display_code, kind, client_id, country, service_line, org_entity,
          pm_id, framework_contract_code, status, start_date, closing_date)
         values ($1,$2,'project',$3,$4,$5,$6,$7,$8,'draft',$9,$10) returning id`,
        [code, display_code || code, cliente_id || null, country || null, service_line || null,
         org_entity || null, actor.id, framework_code || null, start_date, closing_date]);
      await client.query(
        `insert into core.project_amount
         (project_id, version, amount, currency, fx_rate, fx_kind, valid_from, reason)
         values ($1,1,$2,$3,$4,$5,$6,'alta de proyecto')`,
        [proy.id, monto, moneda, fxRate, fx_kind || "pactada", start_date]);
      const pz = porcentajes || {};
      await client.query(
        `insert into core.project_costing values ($1,$2,$3,$4,$5,$6,null,$7,$8,$9,null,null)`,
        [proy.id, pz.p_margin, pz.p_ayf, pz.p_unforeseen, pz.p_ica, pz.p_commission,
         c.implementation_budget, c.implementation_reserve, c.management_budget]);
      const { rows: [ver] } = await client.query(
        `insert into budget.version (project_id, version, state) values ($1,1,'draft') returning id`,
        [proy.id]);
      for (const l of presupuesto) {
        await client.query(
          `insert into budget.line (version_id, ihpsc_code, description, unit, qty, unit_price, total, implementation)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [ver.id, l.ihpsc_code || null, l.description, l.unit || null,
           l.qty, l.unit_price, Number(l.qty) * Number(l.unit_price),
           l.implementation || "mixed"]);
      }
      for (const h of hitos) {
        await client.query(
          `insert into revenue.milestone
           (project_id, amount_cop, expected_date, state, deliverables, updated_at, updated_by)
           values ($1,$2,$3,'scheduled',$4,now(),$5)`,
          [proy.id, h.amount_cop, h.expected_date, h.deliverables || null, actor.id]);
      }
      await audit(code, "proyecto.crear", {
        monto_cop: Math.round(montoCop), lineas: presupuesto.length, hitos: hitos.length,
        implementacion: Math.round(c.implementation_budget),
      });
      await client.query("commit");
      return NextResponse.json({ ok: true, code, costeo: c, estado: "draft" });
    }

    if (b.accion === "aprobar_y_activar") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "Aprobar presupuesto y activar es de administración."); }
      const { rows: [p] } = await client.query(
        `select p.id, p.code, p.status, p.closing_date, pc.implementation_budget
         from core.project p
         left join core.project_costing pc on pc.project_id = p.id
         where p.code = $1 for update of p`, [b.code]);
      if (!p) { await client.query("rollback"); return err(404, "El proyecto no existe."); }
      if (p.status !== "draft") { await client.query("rollback"); return err(409, `El proyecto está «${p.status}».`); }
      const { rows: [ver] } = await client.query(
        `select v.id, sum(l.total) total from budget.version v
         join budget.line l on l.version_id = v.id
         where v.project_id = $1 and v.state = 'draft'
         group by v.id order by v.version desc limit 1`, [p.id]);
      const { rows: [nh] } = await client.query(
        "select count(*) n from revenue.milestone where project_id=$1", [p.id]);
      const faltas = [];
      if (!ver) faltas.push("presupuesto por ítem en borrador");
      else if (Number(ver.total) < Number(p.implementation_budget) * 0.999)
        faltas.push("el presupuesto no cubre el 100 % de la implementación");
      if (Number(nh.n) === 0) faltas.push("al menos un hito de ingreso");
      if (!p.closing_date || new Date(p.closing_date) < new Date()) faltas.push("fecha de cierre futura");
      if (faltas.length) {
        await client.query("rollback");
        return err(422, "Para activar faltan: " + faltas.join(" · ") + ".");
      }
      await client.query(
        `update budget.version set state='approved', approved_by=$1, approved_at=current_date
         where id=$2`, [actor.id, ver.id]);
      await client.query(
        "update core.project set status='active' where id=$1", [p.id]);
      await audit(p.code, "proyecto.activar",
        { presupuesto_aprobado: Number(ver.total), version: 1 });
      await client.query("commit");
      return NextResponse.json({ ok: true, estado: "active" });
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
