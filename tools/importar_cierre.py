# -*- coding: utf-8 -*-
"""
F6 · Importa el cierre contable mensual al ledger (staging → validación → confirmación).

Nada entra directo: primero un PREVIEW con totales y excepciones; solo --confirmar
escribe. Cada asiento queda como money_event gl_accrual con fuente rastreable, y el
periodo puede sellarse después desde /finanzas.

Uso:
  python tools/importar_cierre.py --archivo cierre_jul.xlsx --mes 2026-07 --actor "Andrés Guerra"
  python tools/importar_cierre.py --archivo ... --mes 2026-07 --actor ... --confirmar
  (--reemplazar borra una importación previa del mismo mes ANTES de sellar)

Columnas aceptadas (insensible a mayúsculas): ProjectCode|proyecto, Account|cuenta,
AccountName|nombre_cuenta, Contractor|tercero, Amount|monto.
"""
import argparse
import calendar
import os
import sys

import pandas as pd
import psycopg2

sys.path.insert(0, os.path.dirname(__file__))
from migrate import load_env

COLS = {"projectcode": "proyecto", "proyecto": "proyecto",
        "account": "cuenta", "cuenta": "cuenta",
        "accountname": "nombre_cuenta", "nombre_cuenta": "nombre_cuenta",
        "contractor": "tercero", "tercero": "tercero",
        "amount": "monto", "monto": "monto"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", required=True)
    ap.add_argument("--mes", required=True, help="AAAA-MM")
    ap.add_argument("--actor", required=True)
    ap.add_argument("--confirmar", action="store_true")
    ap.add_argument("--reemplazar", action="store_true")
    a = ap.parse_args()

    anio, mes = map(int, a.mes.split("-"))
    fecha_cierre = f"{anio:04d}-{mes:02d}-{calendar.monthrange(anio, mes)[1]:02d}"

    df = (pd.read_excel(a.archivo) if a.archivo.lower().endswith((".xlsx", ".xls"))
          else pd.read_csv(a.archivo))
    df.columns = [COLS.get(str(c).strip().lower().replace(" ", ""), None) or str(c) for c in df.columns]
    faltan = {"proyecto", "cuenta", "monto"} - set(df.columns)
    if faltan:
        sys.exit(f"Faltan columnas: {faltan}. Aceptadas: ProjectCode, Account, AccountName, Contractor, Amount.")
    df = df.dropna(subset=["monto"])

    load_env()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()

    cur.execute("select full_name from core.app_user where full_name=%s and active", (a.actor,))
    if not cur.fetchone():
        sys.exit(f"Actor «{a.actor}» no existe o está inactivo.")
    cur.execute("select sealed_at from ledger.period where month=%s", (f"{a.mes}-01",))
    r = cur.fetchone()
    if r and r[0]:
        sys.exit(f"El periodo {a.mes} está SELLADO desde {r[0]:%Y-%m-%d}: no se importa sobre un mes cerrado.")
    cur.execute("select count(*) from ledger.money_event where source_table='importar_cierre' and source_id like %s",
                (a.mes + ":%",))
    previos = cur.fetchone()[0]
    if previos and not a.reemplazar:
        sys.exit(f"Ya hay {previos} asientos importados para {a.mes}. Usa --reemplazar para sustituirlos (el mes no está sellado).")

    # resolución de proyectos por código/alias
    cur.execute("select code, id from core.project")
    proj = dict(cur.fetchall())
    cur.execute("select alias, project_id from core.project_alias")
    proj.update(dict(cur.fetchall()))
    cur.execute("select cuenta, categoria from ref.cuenta_categoria")
    refcat = dict(cur.fetchall())
    cur.execute("select code from ledger.gl_account")
    cuentas = {r[0] for r in cur.fetchall()}

    sin_proyecto, cuentas_nuevas, filas = [], set(), []
    for _, r in df.iterrows():
        codigo = str(r["proyecto"]).strip() if pd.notna(r.get("proyecto")) else None
        pid = proj.get(codigo) or proj.get(str(codigo).lower().replace(" ", "_").replace("-", "_")) if codigo else None
        if codigo and pid is None:
            sin_proyecto.append(codigo)
        cuenta = str(int(float(r["cuenta"])))
        if cuenta not in cuentas:
            cuentas_nuevas.add((cuenta, str(r.get("nombre_cuenta") or "")))
        filas.append((pid, cuenta, str(r.get("nombre_cuenta") or ""),
                      str(r.get("tercero") or ""), float(r["monto"])))

    total = sum(f[4] for f in filas)
    print(f"PREVIEW cierre {a.mes} · {len(filas)} asientos · $ {total:,.0f} COP · fecha de cierre {fecha_cierre}")
    if cuentas_nuevas:
        print(f"  Cuentas nuevas ({len(cuentas_nuevas)}): se crearán con categoría del mapeo o «Other»:",
              sorted(c for c, _ in cuentas_nuevas))
    if sin_proyecto:
        print(f"  ✕ {len(set(sin_proyecto))} códigos SIN resolver a proyecto ni alias:", sorted(set(sin_proyecto))[:10])
        print("    Resuélvelos en ref.alias_projectcode (o crea el proyecto) antes de confirmar.")
        sys.exit(1)
    if not a.confirmar:
        print("  (preview — nada se escribió; agrega --confirmar para importar)")
        return

    if previos:
        cur.execute("delete from ledger.money_event where source_table='importar_cierre' and source_id like %s",
                    (a.mes + ":%",))
        print(f"  {previos} asientos previos de {a.mes} reemplazados.")
    for cuenta, nombre in cuentas_nuevas:
        cur.execute("insert into ledger.gl_account values (%s,%s,%s) on conflict do nothing",
                    (cuenta, nombre or None, refcat.get(cuenta, "Other")))
    for i, (pid, cuenta, nombre, tercero, monto) in enumerate(filas, 1):
        cur.execute(
            """insert into ledger.money_event
               (direction, kind, project_id, event_date, amount, currency, fx_rate,
                gl_account, source_table, source_id, note)
               values ('out','gl_accrual',%s,%s,%s,'COP',1,%s,'importar_cierre',%s,%s)""",
            (pid, fecha_cierre, monto, cuenta, f"{a.mes}:{i}", tercero or None))
    cur.execute("insert into ledger.period (month) values (%s) on conflict do nothing", (f"{a.mes}-01",))
    cur.execute(
        """insert into audit.event_log (actor, entity, entity_id, action, after)
           values (%s,'ledger.period',%s,'cierre.importar',
                   jsonb_build_object('asientos', %s, 'total_cop', %s, 'archivo', %s))""",
        (a.actor, a.mes, len(filas), round(total, 2), os.path.basename(a.archivo)))
    conn.commit()
    print(f"OK — {len(filas)} asientos importados a {a.mes}. Sella el periodo desde /finanzas cuando concilie.")


if __name__ == "__main__":
    main()
