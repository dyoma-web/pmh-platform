import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

// F6 · Finanzas: sello de periodo, conciliación contabilidad↔pagos y reglas de prorrateo.
// - sellar (administración): el mes queda inmutable (trigger 0010 lo impone)
// - sugerir_conciliacion: matching gl_accrual ↔ contractor_payment por monto/tercero/fecha
// - conciliar / desconciliar (administración): confirma o deshace una pareja
// - regla_prorrateo (administración): pesos por proyecto para un recurso compartido

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
    const audit = (entity, id, action, after) => client.query(
      `insert into audit.event_log (actor, entity, entity_id, action, after)
       values ($1,$2,$3,$4,$5)`, [actor.full_name, entity, String(id), action, JSON.stringify(after)]);

    if (b.accion === "sellar") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "Sellar un periodo es de administración."); }
      if (!/^\d{4}-\d{2}$/.test(b.mes || "")) { await client.query("rollback"); return err(422, "Mes en formato AAAA-MM."); }
      const mes = b.mes + "-01";
      const { rows: [p] } = await client.query("select sealed_at from ledger.period where month=$1", [mes]);
      if (p?.sealed_at) { await client.query("rollback"); return err(409, `${b.mes} ya está sellado.`); }
      const { rows: [tot] } = await client.query(
        `select count(*) n, sum(amount_cop) filter (where direction='out') gasto,
                sum(amount_cop) filter (where direction='in') ingreso
         from ledger.money_event where date_trunc('month', event_date) = $1::date`, [mes]);
      if (Number(tot.n) === 0) { await client.query("rollback"); return err(422, `${b.mes} no tiene eventos: no hay nada que sellar.`); }
      await client.query(
        `insert into ledger.period (month, sealed_at, sealed_by) values ($1, now(), $2)
         on conflict (month) do update set sealed_at = now(), sealed_by = $2`, [mes, actor.full_name]);
      await audit("ledger.period", b.mes, "periodo.sellar",
        { eventos: Number(tot.n), gasto: tot.gasto, ingreso: tot.ingreso });
      await client.query("commit");
      return NextResponse.json({ ok: true, eventos: Number(tot.n) });
    }

    if (b.accion === "sugerir_conciliacion") {
      const { rows } = await client.query(`
        select g.id gl_id, g.event_date gl_fecha, g.amount_cop monto, g.note gl_tercero,
               p.id pago_id, p.event_date pago_fecha, ct.display_name contratista,
               pr.code project_code,
               (case when g.project_id = p.project_id then 0.4 else 0 end
                + case when abs(g.event_date - p.event_date) <= 45 then 0.4
                       when abs(g.event_date - p.event_date) <= 90 then 0.2 else 0 end
                + 0.2) confianza
        from ledger.money_event g
        join ledger.money_event p
          on p.kind = 'contractor_payment'
         and abs(p.amount_cop - g.amount_cop) <= 1
         and abs(g.event_date - p.event_date) <= 120
        left join procurement.contractor ct on ct.id = p.contractor_id
        left join core.project pr on pr.id = g.project_id
        where g.kind = 'gl_accrual'
          and not exists (select 1 from ledger.reconciliation r where r.gl_event_id = g.id)
          and not exists (select 1 from ledger.reconciliation r where r.op_event_id = p.id)
        order by confianza desc, g.amount_cop desc
        limit 25`);
      await client.query("commit");
      return NextResponse.json({ ok: true, sugerencias: rows });
    }

    if (b.accion === "conciliar") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "Conciliar es de administración."); }
      const { rows: [par] } = await client.query(
        `select g.amount_cop g_monto, p.amount_cop p_monto
         from ledger.money_event g, ledger.money_event p
         where g.id=$1 and p.id=$2 and g.kind='gl_accrual' and p.kind='contractor_payment'`,
        [b.gl_id, b.pago_id]);
      if (!par) { await client.query("rollback"); return err(404, "Alguno de los dos eventos no existe o no es del tipo correcto."); }
      if (Math.abs(Number(par.g_monto) - Number(par.p_monto)) > 1) {
        await client.query("rollback");
        return err(422, "Los montos no coinciden: una conciliación forzada esconde una diferencia. Regístrala como excepción.");
      }
      await client.query(
        `insert into ledger.reconciliation (gl_event_id, op_event_id, confidence, matched_by)
         values ($1,$2,$3,$4)`, [b.gl_id, b.pago_id, b.confianza ?? null, actor.full_name]);
      await audit("reconciliation", `${b.gl_id}↔${b.pago_id}`, "conciliacion.confirmar",
        { monto: par.g_monto });
      await client.query("commit");
      return NextResponse.json({ ok: true });
    }

    if (b.accion === "regla_prorrateo") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "Definir prorrateo es de administración."); }
      const { resource_code, valid_from, pesos } = b;
      if (!resource_code || !valid_from || !Array.isArray(pesos) || pesos.length === 0) {
        await client.query("rollback"); return err(422, "Faltan recurso, vigencia o pesos.");
      }
      const suma = pesos.reduce((s, p) => s + Number(p.weight), 0);
      if (suma > 1.0001) { await client.query("rollback"); return err(422, `Los pesos suman ${suma.toFixed(2)}: no pueden exceder 1.`); }
      // cierra la vigencia de las reglas anteriores del recurso
      await client.query(
        `update infra.allocation_rule set valid_to = ($2::date - 1)
         where resource_key = $1 and valid_to is null and valid_from < $2::date`,
        [resource_code, valid_from]);
      for (const p of pesos) {
        const { rows: [pr] } = await client.query(
          `select p.id from core.project p
           left join core.project_alias a on a.project_id = p.id
           where p.code = $1 or a.alias = $1 limit 1`, [p.project_code]);
        if (!pr) { await client.query("rollback"); return err(404, `Proyecto ${p.project_code} no existe.`); }
        await client.query(
          `insert into infra.allocation_rule (resource_key, project_id, weight, valid_from)
           values ($1,$2,$3,$4)`, [resource_code, pr.id, p.weight, valid_from]);
      }
      await audit("allocation_rule", resource_code, "prorrateo.definir",
        { pesos: pesos.length, suma: Number(suma.toFixed(4)), desde: valid_from });
      await client.query("commit");
      return NextResponse.json({ ok: true, sin_distribuir: Number((1 - suma).toFixed(4)) });
    }

    await client.query("rollback");
    return err(400, `Acción desconocida: ${b.accion}`);
  } catch (e) {
    await client.query("rollback");
    if (e.message?.includes("sellado")) return err(409, e.message.split("\n")[0]);
    return err(500, "La base de datos rechazó la operación: " + e.message);
  } finally {
    client.release();
  }
}
