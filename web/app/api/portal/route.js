import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";
import { guardarArchivo } from "../../../lib/archivos";

// F8 · API del portal de contratista: autenticada por TOKEN (no por Basic Auth —
// el middleware la excluye). Solo permite lo suyo: subir cuenta de cobro y
// soporte de seguridad social a pagos PROPIOS aún no validados. Cada acción
// queda en la auditoría como portal:<contratista>.

const err = (s, m) => NextResponse.json({ error: m }, { status: s });

async function contratistaPorToken(token) {
  const { rows: [c] } = await pool.query(
    "select id, display_name from procurement.contractor where portal_token = $1", [token]);
  return c;
}

export async function POST(req) {
  const ct = req.headers.get("content-type") || "";

  // multipart: subida de documento a un pago propio
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const token = form?.get("token");
    const pagoId = form?.get("pago_id");
    const tipo = form?.get("tipo"); // cuenta | soporte
    const file = form?.get("file");
    if (!token || !pagoId || !["cuenta", "soporte"].includes(tipo) || !file) {
      return err(400, "Faltan token, pago_id, tipo (cuenta|soporte) o el archivo.");
    }
    const c = await contratistaPorToken(String(token));
    if (!c) return err(403, "El enlace no es válido o fue revocado. Pide uno nuevo a administración.");
    const { rows: [p] } = await pool.query(
      `select cp.id, cp.adm_validated_at from procurement.contract_payment cp
       join procurement.contract k on k.code = cp.contract_code
       where cp.id = $1 and k.contractor_id = $2`, [pagoId, c.id]);
    if (!p) return err(404, "Ese pago no existe o no es tuyo.");
    if (p.adm_validated_at) return err(409, "Ese pago ya fue validado y pagado: no necesita documentos.");
    let doc;
    try {
      doc = await guardarArchivo(file, `portal_${tipo}`);
    } catch (e) {
      return err(422, e.message);
    }
    const campo = tipo === "cuenta" ? "invoice_url" : "legal_support_url";
    await pool.query(
      `update procurement.contract_payment set ${campo}=$1, updated_at=now() where id=$2`,
      [doc.url, pagoId]);
    await pool.query(
      `insert into audit.event_log (actor, entity, entity_id, action, after)
       values ($1,'contract_payment',$2,$3,$4)`,
      [`portal:${c.display_name}`, String(pagoId), `portal.subir_${tipo}`,
       JSON.stringify({ documento: doc.id })]);
    return NextResponse.json({ ok: true, url: doc.url });
  }

  // json: datos del contratista para el portal
  const b = await req.json().catch(() => null);
  if (b?.accion !== "datos" || !b?.token) return err(400, "Acción desconocida.");
  const c = await contratistaPorToken(b.token);
  if (!c) return err(403, "El enlace no es válido o fue revocado.");
  const { rows: pagos } = await pool.query(
    `select cp.id, cp.due_date, cp.amount, cp.invoice_url, cp.legal_support_url,
            cp.authorized_at, cp.adm_validated_at, cp.cancelled_at,
            k.code contrato, p.display_code proyecto
     from procurement.contract_payment cp
     join procurement.contract k on k.code = cp.contract_code
     join core.project p on p.id = k.project_id
     where k.contractor_id = $1
     order by cp.adm_validated_at is not null, cp.due_date`, [c.id]);
  return NextResponse.json({ ok: true, nombre: c.display_name, pagos });
}
