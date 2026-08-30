import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { pool } from "../../../lib/db";

// F8 · Cotizador, entregables (valor ganado), capacidad y tokens de portal.

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

    const proyectoDe = async (code) => {
      const { rows: [p] } = await client.query(
        `select p.id, p.status from core.project p
         left join core.project_alias a on a.project_id = p.id
         where p.code = $1 or a.alias = $1 limit 1`, [code]);
      return p;
    };

    // ── COTIZADOR ───────────────────────────────────────────────────────────
    if (b.accion === "cotizacion_crear") {
      const { title, client_id, lineas, notes } = b;
      if (!title?.trim() || !Array.isArray(lineas) || !lineas.length) {
        await client.query("rollback"); return err(422, "La cotización necesita título y al menos una línea.");
      }
      const anio = new Date().getFullYear();
      const { rows: [seq] } = await client.query(
        `select coalesce(max(substring(code from '_(\\d+)$')::int),0)+1 n
         from catalog.quote where code like $1`, [`Q_${anio}_%`]);
      const code = `Q_${anio}_${String(seq.n).padStart(3, "0")}`;
      const { rows: [qz] } = await client.query(
        `insert into catalog.quote (code, client_id, title, created_by, notes)
         values ($1,$2,$3,$4,$5) returning id`,
        [code, client_id || null, title.trim(), actor.id, notes || null]);
      let total = 0, costo = 0;
      for (const l of lineas) {
        if (!(Number(l.qty) > 0) || !(Number(l.unit_price) >= 0)) {
          await client.query("rollback"); return err(422, "Cada línea necesita cantidad y precio.");
        }
        let ref = null;
        if (l.ihpsc_code) {
          const { rows: [it] } = await client.query(
            "select ref_cost from catalog.ihpsc_item where code=$1", [l.ihpsc_code]);
          ref = it?.ref_cost ?? null;
        }
        await client.query(
          `insert into catalog.quote_line (quote_id, ihpsc_code, description, unit, qty, unit_price, ref_cost)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [qz.id, l.ihpsc_code || null, l.description, l.unit || null, l.qty, l.unit_price, ref]);
        total += Number(l.qty) * Number(l.unit_price);
        costo += Number(l.qty) * Number(ref ?? 0);
      }
      await audit("quote", code, "cotizacion.crear",
        { total: Math.round(total), costo_ref: Math.round(costo), lineas: lineas.length });
      await client.query("commit");
      return NextResponse.json({ ok: true, code, total, costo_ref: costo,
        margen_pct: total ? Math.round((1 - costo / total) * 1000) / 10 : null });
    }

    if (b.accion === "cotizacion_estado") {
      if (!["sent", "won", "lost"].includes(b.estado)) {
        await client.query("rollback"); return err(422, "Estado: sent, won o lost.");
      }
      const { rowCount } = await client.query(
        "update catalog.quote set state=$1 where code=$2", [b.estado, b.code]);
      if (!rowCount) { await client.query("rollback"); return err(404, "La cotización no existe."); }
      await audit("quote", b.code, "cotizacion.estado", { estado: b.estado });
      await client.query("commit");
      return NextResponse.json({ ok: true });
    }

    // ── ENTREGABLES / VALOR GANADO ──────────────────────────────────────────
    if (b.accion === "entregable_crear") {
      const p = await proyectoDe(b.project_code);
      if (!p) { await client.query("rollback"); return err(404, "El proyecto no existe."); }
      if (!b.description?.trim() || !b.due_date || !(Number(b.planned_value_cop) >= 0)) {
        await client.query("rollback"); return err(422, "Un entregable necesita descripción, fecha comprometida y valor planeado.");
      }
      const { rows: [d] } = await client.query(
        `insert into core.deliverable
         (project_id, description, due_date, responsible_id, planned_value_cop, milestone_id, updated_at, updated_by)
         values ($1,$2,$3,$4,$5,$6,now(),$7) returning id`,
        [p.id, b.description.trim(), b.due_date, b.responsible_id || actor.id,
         b.planned_value_cop, b.milestone_id || null, actor.id]);
      await audit("deliverable", d.id, "entregable.crear",
        { proyecto: b.project_code, valor: b.planned_value_cop, fecha: b.due_date });
      await client.query("commit");
      return NextResponse.json({ ok: true, id: d.id });
    }

    if (b.accion === "entregable_avance") {
      const pct = Number(b.progress_pct);
      if (!(pct >= 0 && pct <= 100)) { await client.query("rollback"); return err(422, "El avance va de 0 a 100."); }
      const { rowCount } = await client.query(
        `update core.deliverable set progress_pct=$1, updated_at=now(), updated_by=$2 where id=$3`,
        [pct, actor.id, b.entregable_id]);
      if (!rowCount) { await client.query("rollback"); return err(404, "El entregable no existe."); }
      await audit("deliverable", b.entregable_id, "entregable.avance", { pct });
      await client.query("commit");
      return NextResponse.json({ ok: true });
    }

    // ── CAPACIDAD ───────────────────────────────────────────────────────────
    if (b.accion === "asignar") {
      const p = await proyectoDe(b.project_code);
      if (!p) { await client.query("rollback"); return err(404, "El proyecto no existe."); }
      const pct = Number(b.dedication_pct);
      const week = b.week; // lunes AAAA-MM-DD
      if (pct === 0) {
        await client.query(
          "delete from core.assignment where user_id=$1 and project_id=$2 and week=$3",
          [b.user_id, p.id, week]);
      } else {
        if (!(pct > 0 && pct <= 100)) { await client.query("rollback"); return err(422, "Dedicación entre 1 y 100 %."); }
        await client.query(
          `insert into core.assignment (user_id, project_id, week, dedication_pct, updated_by)
           values ($1,$2,$3,$4,$5)
           on conflict (user_id, project_id, week)
           do update set dedication_pct=$4, updated_by=$5, updated_at=now()`,
          [b.user_id, p.id, week, pct, actor.id]);
      }
      const { rows: [tot] } = await client.query(
        "select coalesce(sum(dedication_pct),0) t from core.assignment where user_id=$1 and week=$2",
        [b.user_id, week]);
      await audit("assignment", `${b.user_id}@${week}`, "capacidad.asignar",
        { proyecto: b.project_code, pct, total_semana: Number(tot.t) });
      await client.query("commit");
      return NextResponse.json({ ok: true, total_semana: Number(tot.t), sobrecarga: Number(tot.t) > 100 });
    }

    // ── TOKENS DE PORTAL ────────────────────────────────────────────────────
    if (b.accion === "portal_contratista") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "Generar accesos de portal es de administración."); }
      const token = crypto.randomBytes(20).toString("hex");
      const { rowCount } = await client.query(
        "update procurement.contractor set portal_token=$1 where id=$2", [token, b.contratista_id]);
      if (!rowCount) { await client.query("rollback"); return err(404, "El contratista no existe."); }
      await audit("contractor", b.contratista_id, "portal.token_contratista", {});
      await client.query("commit");
      return NextResponse.json({ ok: true, url: `/portal/${token}` });
    }
    if (b.accion === "portal_cliente") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "Generar accesos de portal es de administración."); }
      const p = await proyectoDe(b.project_code);
      if (!p) { await client.query("rollback"); return err(404, "El proyecto no existe."); }
      const token = crypto.randomBytes(20).toString("hex");
      await client.query("update core.project set client_portal_token=$1 where id=$2", [token, p.id]);
      await audit("project", b.project_code, "portal.token_cliente", {});
      await client.query("commit");
      return NextResponse.json({ ok: true, url: `/cliente/${token}` });
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
