import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

// Carga ../.env (raíz del repo) sin dependencia de dotenv.
function loadEnv() {
  const p = path.join(process.cwd(), "..", ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
}
loadEnv();

const globalForPg = globalThis;
export const pool =
  globalForPg.__cotaPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
if (!globalForPg.__cotaPool) globalForPg.__cotaPool = pool;

export async function q(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}
