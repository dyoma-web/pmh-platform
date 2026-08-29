# -*- coding: utf-8 -*-
"""
Carga/actualiza las semillas de seeds/ en el esquema ref (upsert idempotente).

Uso: python tools/cargar_seeds.py   (requiere DATABASE_URL en entorno o .env)
"""
import csv
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(__file__))
from migrate import load_env  # reutiliza la lectura de .env


def upsert(cur, table, key, rows, cols):
    for r in rows:
        vals = [r.get(c) or None for c in cols]
        sets = ", ".join(f"{c}=EXCLUDED.{c}" for c in cols if c != key)
        cur.execute(
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "
            f"ON CONFLICT ({key}) DO UPDATE SET {sets}, actualizado_en=now()",
            vals,
        )


def leer(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main():
    load_env()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("Falta DATABASE_URL (entorno o .env).")
    conn = psycopg2.connect(url)
    cur = conn.cursor()

    a = leer("seeds/alias_projectcode.csv")
    upsert(cur, "ref.alias_projectcode", "codigo_origen",
           [{"codigo_origen": r["codigo_origen"], "accion": r["accion"],
             "codigo_canonico": r["codigo_canonico"], "nota": r["nota"]} for r in a],
           ["codigo_origen", "accion", "codigo_canonico", "nota"])
    print(f"ref.alias_projectcode: {len(a)} filas")

    c = leer("seeds/cuentas_categoria.csv")
    upsert(cur, "ref.cuenta_categoria", "cuenta",
           [{"cuenta": str(r["cuenta"]), "nombre_cuenta": r["nombre_cuenta"],
             "categoria": r["categoria"]} for r in c],
           ["cuenta", "nombre_cuenta", "categoria"])
    print(f"ref.cuenta_categoria: {len(c)} filas")

    t = leer("seeds/tarifario_provisional.csv")
    upsert(cur, "ref.tarifario_provisional", "ihpsc_item",
           [{"ihpsc_item": r["ihpsc_candidato"], "lineas": r["lineas"],
             "monto_total": r["monto_total"], "p_min": r["p_min"],
             "p_mediana": r["p_mediana"], "p_max": r["p_max"],
             "costo_ref_provisional_cop": r["costo_ref_provisional_cop"],
             "fuente": r["fuente"], "estado": r["estado"]} for r in t],
           ["ihpsc_item", "lineas", "monto_total", "p_min", "p_mediana", "p_max",
            "costo_ref_provisional_cop", "fuente", "estado"])
    print(f"ref.tarifario_provisional: {len(t)} filas")

    conn.commit()
    print("OK — semillas cargadas.")


if __name__ == "__main__":
    main()
