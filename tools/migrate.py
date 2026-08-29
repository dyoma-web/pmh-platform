# -*- coding: utf-8 -*-
"""
Runner de migraciones — aplica db/migrations/*.sql en orden contra DATABASE_URL.

Portable a cualquier Postgres (Supabase, Cloud SQL, local). Registra lo aplicado en
public.schema_migrations y envuelve cada migración en una transacción.

Uso:
  python tools/migrate.py            # aplica pendientes
  python tools/migrate.py --status   # muestra estado sin aplicar

DATABASE_URL se toma del entorno o de un archivo .env en la raíz (formato KEY=VALUE).
"""
import argparse
import hashlib
import os
import sys

import psycopg2


def load_env():
    if os.path.exists(".env"):
        for line in open(".env", encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--dir", default="db/migrations")
    args = ap.parse_args()

    load_env()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("Falta DATABASE_URL (entorno o .env). Ver docs/adr/0001 y .env.example.")

    files = sorted(f for f in os.listdir(args.dir) if f.endswith(".sql"))
    conn = psycopg2.connect(url)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
            filename text PRIMARY KEY,
            sha256   text NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
        )""")
    conn.commit()

    cur.execute("SELECT filename, sha256 FROM public.schema_migrations")
    applied = dict(cur.fetchall())

    pendientes = []
    for f in files:
        sql = open(os.path.join(args.dir, f), encoding="utf-8").read()
        sha = hashlib.sha256(sql.encode()).hexdigest()
        if f in applied:
            if applied[f] != sha:
                sys.exit(f"ERROR: {f} ya aplicada pero su contenido cambió. "
                         "Las migraciones aplicadas son inmutables: crea una nueva.")
            continue
        pendientes.append((f, sql, sha))

    if args.status:
        print(f"Aplicadas: {len(applied)} · Pendientes: {len(pendientes)}")
        for f, _, _ in pendientes:
            print("  PENDIENTE:", f)
        return

    for f, sql, sha in pendientes:
        print("Aplicando", f, "...")
        try:
            cur.execute(sql)
            cur.execute("INSERT INTO public.schema_migrations(filename, sha256) VALUES (%s,%s)",
                        (f, sha))
            conn.commit()
        except Exception as e:
            conn.rollback()
            sys.exit(f"FALLO en {f}: {e}")
    print(f"OK — {len(pendientes)} migración(es) aplicadas, {len(applied) + len(pendientes)} en total.")


if __name__ == "__main__":
    main()
