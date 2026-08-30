import crypto from "node:crypto";
import { pool } from "./db";

// Almacén compartido (F3/F8): dedup por sha256, bucket privado, registro en core.document.
export async function guardarArchivo(file, origen) {
  if (!file || typeof file === "string") throw new Error("Falta el archivo.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Máximo 25 MB por archivo.");
  const buf = Buffer.from(await file.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const ext = (file.name?.split(".").pop() || "bin").toLowerCase()
    .replace(/[^a-z0-9]/g, "").slice(0, 8);
  const key = `${sha}.${ext}`;

  const { rows: [dup] } = await pool.query("select id from core.document where sha256=$1", [sha]);
  if (dup) return { id: dup.id, url: `/api/archivos?id=${dup.id}`, dedup: true };

  const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/documentos/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: buf,
  });
  if (!up.ok) throw new Error("El almacén rechazó el archivo: " + (await up.text()).slice(0, 120));

  const { rows: [doc] } = await pool.query(
    `insert into core.document (sha256, mime, bytes, storage_key, origin)
     values ($1,$2,$3,$4,$5) returning id`,
    [sha, file.type || null, file.size, key, String(origen || "carga")]);
  await pool.query(
    `insert into audit.event_log (actor, entity, entity_id, action, after)
     values ('almacen','document',$1,'documento.subir',$2)`,
    [String(doc.id), JSON.stringify({ bytes: file.size, origen })]);
  return { id: doc.id, url: `/api/archivos?id=${doc.id}` };
}
