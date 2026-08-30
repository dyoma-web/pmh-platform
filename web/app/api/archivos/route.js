import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { pool } from "../../../lib/db";

// F3 · Almacén de archivos propio: Supabase Storage (bucket privado «documentos»),
// deduplicado por hash y servido SIEMPRE con URL firmada de corta vida — nunca un
// enlace público (checklist §8/§12). El registro vive en core.document.

const err = (s, m) => NextResponse.json({ error: m }, { status: s });
const BASE = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const origen = form?.get("origen") || "carga";
  if (!file || typeof file === "string") return err(400, "Falta el archivo (campo «file»).");
  if (file.size > 25 * 1024 * 1024) return err(413, "Máximo 25 MB por archivo.");

  const buf = Buffer.from(await file.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const ext = (file.name?.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const key = `${sha}.${ext}`;

  const client = await pool.connect();
  try {
    const { rows: [dup] } = await client.query(
      "select id from core.document where sha256=$1", [sha]);
    if (dup) {
      return NextResponse.json({ ok: true, id: dup.id, url: `/api/archivos?id=${dup.id}`, dedup: true });
    }
    const up = await fetch(`${BASE()}/storage/v1/object/documentos/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY()}`,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: buf,
    });
    if (!up.ok) {
      const t = await up.text();
      return err(502, "El almacén rechazó el archivo: " + t.slice(0, 120));
    }
    const { rows: [doc] } = await client.query(
      `insert into core.document (sha256, mime, bytes, storage_key, origin)
       values ($1,$2,$3,$4,$5) returning id`,
      [sha, file.type || null, file.size, key, String(origen)]);
    await client.query(
      `insert into audit.event_log (actor, entity, entity_id, action, after)
       values ('api/archivos','document',$1,'documento.subir',$2)`,
      [String(doc.id), JSON.stringify({ bytes: file.size, origen })]);
    return NextResponse.json({ ok: true, id: doc.id, url: `/api/archivos?id=${doc.id}` });
  } finally {
    client.release();
  }
}

export async function GET(req) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return err(400, "Falta id.");
  const { rows: [doc] } = await pool.query(
    "select storage_key, url from core.document where id=$1", [id]);
  if (!doc) return err(404, "El documento no existe.");
  if (!doc.storage_key) {
    return NextResponse.redirect(doc.url); // legado: enlace externo migrado
  }
  const r = await fetch(`${BASE()}/storage/v1/object/sign/documentos/${doc.storage_key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!r.ok) return err(502, "No se pudo firmar la URL.");
  const j = await r.json();
  return NextResponse.redirect(`${BASE()}/storage/v1${j.signedURL.replace(/^\/storage\/v1/, "")}`);
}
