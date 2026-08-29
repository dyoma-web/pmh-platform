# -*- coding: utf-8 -*-
"""
M10 · Job de calidad de datos — las advertencias del doc 01 §9 como pruebas que fallan.

Cada regla devuelve el número de filas que la violan (0 = verde). Salida: consola +
out/calidad_YYYYMMDD.md. Pensado para correr a diario (GitHub Actions o manual).
Exit code 1 si alguna regla estructural está en rojo (para que el CI falle).
"""
import os
import sys
from datetime import date

import psycopg2

sys.path.insert(0, os.path.dirname(__file__))
from migrate import load_env

# (id, dueño, descripción, sql que cuenta violaciones, estructural)
REGLAS = [
    ("Q01", "steward", "Eventos del ledger sin proyecto que no sean bolsa/corporativo",
     """select count(*) from ledger.money_event e
        where e.project_id is null and e.kind not in ('subs_payment','adjustment')
          and e.source_id is null""", True),
    ("Q02", "steward", "Eventos en moneda extranjera sin TRM (amount_cop nulo)",
     "select count(*) from ledger.money_event where amount_cop is null", False),
    ("Q03", "admin", "Pagos validados sin soporte legal fuera del stock legado",
     """select count(*) from procurement.contract_payment
        where adm_validated_at is not null and legal_support_url is null
          and not legacy_exception""", True),
    ("Q04", "admin", "Contratos activos cuya suma de pagos difiere del monto (> $1)",
     """select count(*) from (
          select c.code from procurement.contract c
          join procurement.contract_payment p on p.contract_code = c.code
          where c.state = 'active'
          group by c.code, c.amount having abs(sum(p.amount) - c.amount) > 1) x""", False),
    ("Q05", "gestora", "Hitos acreditados con fecha imposible (< 2022)",
     "select count(*) from revenue.milestone where credited_date < '2022-01-01'", True),
    ("Q06", "gestora", "Proyectos activos con fecha de cierre vencida (regularizar)",
     """select count(*) from core.project
        where status = 'active' and kind = 'project' and closing_date < current_date""", False),
    ("Q07", "steward", "Códigos de costos de staging sin resolver a proyecto",
     """select count(distinct c.project_code) from staging.costs c
        where c.project_code is not null
          and not exists (select 1 from core.project p
                          where p.code = lower(replace(replace(c.project_code,' ','_'),'-','_')))
          and not exists (select 1 from core.project_alias a where a.alias = c.project_code)""", True),
    ("Q08", "steward", "Cuentas contables del ledger sin categoría de gestión",
     "select count(*) from ledger.gl_account where mgmt_category is null or mgmt_category = ''", True),
    ("Q09", "admin", "Hitos vencidos hace más de 90 días sin factor de retraso",
     """select count(*) from revenue.milestone
        where state in ('scheduled','invoiced')
          and expected_date < current_date - 90 and delay_category is null""", False),
    ("Q10", "infra", "Infraestructura encendida con fin de vigencia cumplido",
     "select count(*) from infra.item where status = 'on' and end_date < current_date", False),
    ("Q11", "steward", "Ítems IHPSC activos sin costo de referencia (cobertura M11)",
     """select count(*) from catalog.ihpsc_item
        where state = 'activo' and os_applicable and ref_cost is null""", False),
    ("Q12", "steward", "Paridad v1 (transaccional) vs v0 (staging) rota",
     "select count(*) from metrics.v1_vs_v0 where abs(coalesce(v1,0) - coalesce(v0,0)) > 1", True),
]


def main():
    load_env()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    hoy = date.today()
    filas, rojo_estructural = [], False
    for rid, dueno, desc, sql, estructural in REGLAS:
        try:
            cur.execute(sql)
            n = cur.fetchone()[0]
        except Exception as e:
            conn.rollback()
            n, desc = -1, desc + f" [ERROR: {str(e)[:60]}]"
        estado = "VERDE" if n == 0 else "ROJO"
        if n != 0 and estructural:
            rojo_estructural = True
        filas.append((rid, estado, n, dueno, desc))
        print(f"[{estado:5s}] {rid} · {n:>5} · {desc} (dueño: {dueno})")

    verdes = sum(1 for f in filas if f[1] == "VERDE")
    print(f"\nSalud del dato: {verdes}/{len(filas)} reglas en verde "
          f"({round(100*verdes/len(filas))} %)")

    os.makedirs("out", exist_ok=True)
    with open(f"out/calidad_{hoy.strftime('%Y%m%d')}.md", "w", encoding="utf-8") as f:
        f.write(f"# M10 · Calidad de datos — {hoy}\n\n")
        f.write(f"**{verdes}/{len(filas)} reglas en verde.** Las ROJO estructurales "
                "bloquean confianza; las demás son colas de trabajo con dueño.\n\n")
        f.write("| Regla | Estado | Filas | Dueño | Descripción |\n|---|---|---|---|---|\n")
        for rid, estado, n, dueno, desc in filas:
            f.write(f"| {rid} | {estado} | {n} | {dueno} | {desc} |\n")
    sys.exit(1 if rojo_estructural else 0)


if __name__ == "__main__":
    main()
