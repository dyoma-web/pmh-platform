import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

// F3 · Contratistas y sus datos de contacto (Ley 1581 de 2012).
// - POST accion=crear      : alta de contratista + contacto (solo administración)
// - POST accion=contacto_ver (cualquier usuaria activa): devuelve el contacto y
//   REGISTRA la consulta en audit.event_log — minimización con trazabilidad
// - POST accion=contacto_actualizar (solo administración): teléfono, correo,
//   carpeta y URL de la autorización de tratamiento de datos

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
       values ($1,'contractor',$2,$3,$4)`, [actor.full_name, String(id), action, JSON.stringify(after)]);

    if (b.accion === "crear") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "El alta de contratistas es de administración."); }
      if (!b.id_number?.trim() || !b.display_name?.trim()) {
        await client.query("rollback"); return err(422, "Documento y nombre son obligatorios.");
      }
      const { rows: [dup] } = await client.query(
        "select id from procurement.contractor where id_number=$1", [b.id_number.trim()]);
      if (dup) { await client.query("rollback"); return err(409, "Ya existe un contratista con ese documento — el registro es único por documento."); }
      const { rows: [c] } = await client.query(
        `insert into procurement.contractor (id_number, id_type, display_name, profile, company_name)
         values ($1,$2,$3,$4,$5) returning id`,
        [b.id_number.trim(), b.id_type || "ID Card", b.display_name.trim(), b.profile || null, b.company_name || null]);
      await client.query(
        `insert into pii.contractor_contact (contractor_id, legal_name, phone, email, folder_url)
         values ($1,$2,$3,$4,$5)`,
        [c.id, b.legal_name || b.display_name.trim(), b.phone || null, b.email || null, b.folder_url || null]);
      await audit(c.id, "contratista.crear", { documento: "***", perfil: b.profile });
      await client.query("commit");
      return NextResponse.json({ ok: true, id: c.id });
    }

    if (b.accion === "contacto_ver") {
      const { rows: [pc] } = await client.query(
        `select cc.legal_name, cc.phone, cc.email, cc.folder_url,
                (cc.data_authorization_doc_id is not null) autorizacion,
                d.url as autorizacion_url, c.id_number, c.id_type
         from procurement.contractor c
         left join pii.contractor_contact cc on cc.contractor_id = c.id
         left join core.document d on d.id = cc.data_authorization_doc_id
         where c.id = $1`, [b.contratista_id]);
      if (!pc) { await client.query("rollback"); return err(404, "El contratista no existe."); }
      await audit(b.contratista_id, "pii.consultar", { por: actor.full_name });
      await client.query("commit");
      return NextResponse.json({ ok: true, contacto: pc });
    }

    if (b.accion === "contacto_actualizar") {
      if (!esAdmin) { await client.query("rollback"); return err(403, "Editar datos de contacto es de administración."); }
      let authDocId = null;
      if (b.autorizacion_url?.trim()) {
        const { rows: [doc] } = await client.query(
          `insert into core.document (url, origin) values ($1,'autorizacion_ley1581') returning id`,
          [b.autorizacion_url.trim()]);
        authDocId = doc.id;
      }
      const { rowCount } = await client.query(
        `update pii.contractor_contact set
           phone = coalesce($2, phone), email = coalesce($3, email),
           folder_url = coalesce($4, folder_url),
           data_authorization_doc_id = coalesce($5, data_authorization_doc_id),
           updated_at = now()
         where contractor_id = $1`,
        [b.contratista_id, b.phone || null, b.email || null, b.folder_url || null, authDocId]);
      if (!rowCount) { await client.query("rollback"); return err(404, "El contratista no tiene ficha de contacto."); }
      await audit(b.contratista_id, "pii.actualizar",
        { campos: ["phone", "email", "folder_url", "autorizacion"].filter((k) =>
          b[k === "autorizacion" ? "autorizacion_url" : k]) });
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
