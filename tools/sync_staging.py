# -*- coding: utf-8 -*-
"""
F1 · Sincroniza las hojas GAP_DATA_* hacia el esquema staging (espejo crudo) y
(re)crea las vistas de db/views_f1.sql.

- staging se trunca y recarga completo en cada corrida (es espejo, no historia).
- Columnas PII (teléfono, correo de personas naturales) NO se sincronizan.
- Nombres de columna normalizados a snake_case ASCII.
- Registra cada corrida en staging._sync_run.

Uso: python tools/sync_staging.py   (DATABASE_URL y GAP_DATA_SRC en .env)
"""
import os
import re
import sys
import unicodedata
from datetime import datetime

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(__file__))
from migrate import load_env

# (archivo, hoja, tabla_destino, columnas_excluidas_PII)
SOURCES = [
    ("GAP_DATA_01_PROJECTS.xlsx", "GAP_DATA_01_PROJECTS", "projects", []),
    ("GAP_DATA_01_PROJECTS.xlsx", "GAP_DATA_01A_PM", "pm_users", []),
    ("GAP_DATA_02_BUDGET.xlsx", "GAP_DATA_02_BUDGET", "budget_lines", []),
    ("GAP_DATA_02_BUDGET.xlsx", "GAP_DATA_02A_CODES", "codes_v1", []),
    ("GAP_DATA_03_INCOME.xlsx", "GAP_DATA_03_INCOME", "income", []),
    ("GAP_DATA_04_COSTS.xlsx", "GAP_DATA_04_COSTS", "costs", []),
    ("GAP_DATA_04_COSTS.xlsx", "GAP_DATA_04A_COSTS_INTERNAL", "costs_internal", []),
    ("GAP_DATA_05_PAYMENTS.xlsx", "GAP_DATA_05_PAYMENTS", "infra_payments", []),
    ("GAP_DATA_05_PAYMENTS.xlsx", "inf_data_costs", "subs_payments", []),
    ("GAP_DATA_06_INFRAESTRUCTURE.xlsx", "GAP_DATA_06_INFRAESTRUCTURE", "infra_items", []),
    ("GAP_DATA_06_INFRAESTRUCTURE.xlsx", "InfraestructureData_IntGeneral", "subs_budget", []),
    ("GAP_DATA_07_CONTRACTS.xlsx", "GAP_DATA_07A_CONTRACTS", "contracts",
     ["ContractorPhone", "ContractorMail"]),
    ("GAP_DATA_07_CONTRACTS.xlsx", "GAP_DATA_07B_PAYMENTS", "contract_payments", []),
    ("GAP_DATA_07_CONTRACTS.xlsx", "GAP_DATA_07C1_REQUEST", "hiring_requests",
     ["ContractorPhone", "ContractorMail"]),
    ("GAP_DATA_07_CONTRACTS.xlsx", "GAP_DATA_07C2_SERVICES", "request_services", []),
    ("GAP_DATA_07_CONTRACTS.xlsx", "GAP_DATA_07C3_PAYMENTS", "request_payments", []),
    ("GAP_DATA_08_CONTRACTORS.xlsx", "GAP_DATA_08_CONTRACTORS", "contractors",
     ["ContractorPhone", "ContractorMail", "ContractorFolder"]),
    ("GAP_DATA_09_ACCOUNTS.xlsx", "fal_accounts", "accounts", []),
    ("GAP_DATA_12_CORP_CONTRACTS.xlsx", "Hoja 1", "corp_contracts", []),
]


def snake(name):
    s = unicodedata.normalize("NFD", str(name))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", s)
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").lower()
    return s or "col"


def pg_type(series):
    if pd.api.types.is_datetime64_any_dtype(series):
        return "timestamptz"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    return "text"


def to_py(v):
    if v is None or (isinstance(v, float) and pd.isna(v)) or pd.isna(v):
        return None
    if isinstance(v, pd.Timestamp):
        return v.to_pydatetime()
    return v


def main():
    load_env()
    url = os.environ.get("DATABASE_URL")
    src = os.environ.get("GAP_DATA_SRC")
    if not url or not src:
        sys.exit("Faltan DATABASE_URL / GAP_DATA_SRC en .env")

    conn = psycopg2.connect(url)
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS staging._sync_run (
        id serial PRIMARY KEY, started_at timestamptz NOT NULL,
        finished_at timestamptz, tables_loaded int, rows_total int, source text)""")
    conn.commit()
    started = datetime.now().astimezone()

    total_rows, total_tables = 0, 0
    for archivo, hoja, tabla, pii in SOURCES:
        df = pd.read_excel(os.path.join(src, archivo), sheet_name=hoja).dropna(how="all")
        df = df.drop(columns=[c for c in pii if c in df.columns])
        df = df.loc[:, [c for c in df.columns if not str(c).startswith("Unnamed")]]
        cols = [snake(c) for c in df.columns]
        # desambiguar duplicados
        seen = {}
        for i, c in enumerate(cols):
            if c in seen:
                seen[c] += 1
                cols[i] = f"{c}_{seen[c]}"
            else:
                seen[c] = 0
        types = [pg_type(df[orig]) for orig in df.columns]
        ddl_cols = ", ".join(f'"{c}" {t}' for c, t in zip(cols, types))
        cur.execute(f'DROP TABLE IF EXISTS staging."{tabla}" CASCADE')
        cur.execute(f'CREATE TABLE staging."{tabla}" ({ddl_cols})')
        rows = [tuple(to_py(v) for v in row) for row in df.itertuples(index=False, name=None)]
        if rows:
            execute_values(
                cur,
                f'INSERT INTO staging."{tabla}" ({", ".join(chr(34)+c+chr(34) for c in cols)}) VALUES %s',
                rows, page_size=500)
        total_rows += len(rows)
        total_tables += 1
        print(f"staging.{tabla}: {len(rows)} filas")

    # vistas F1 (CREATE OR REPLACE; dependen de staging, por eso viven fuera de migraciones)
    views_path = os.path.join(os.path.dirname(__file__), "..", "db", "views_f1.sql")
    if os.path.exists(views_path):
        cur.execute(open(views_path, encoding="utf-8").read())
        print("Vistas F1 aplicadas (db/views_f1.sql)")

    cur.execute(
        "INSERT INTO staging._sync_run (started_at, finished_at, tables_loaded, rows_total, source) "
        "VALUES (%s, now(), %s, %s, %s)",
        (started, total_tables, total_rows, src))
    conn.commit()
    print(f"OK — {total_tables} tablas, {total_rows} filas sincronizadas.")


if __name__ == "__main__":
    main()
