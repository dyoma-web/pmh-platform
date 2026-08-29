# -*- coding: utf-8 -*-
"""
F0 · Saneamiento — genera la cola de excepciones de datos con propuestas de resolución.

Lee las hojas fuente del sistema actual (carpeta 'administrativo') y produce, en --out:
  01_alias_projectcode.csv   códigos huérfanos en COSTS/CONTRACTS/REQUEST + canónico sugerido
  02_cuentas_sin_mapeo.csv   cuentas contables sin categoría + categoría sugerida
  03_pagos_sin_moneda.csv    pagos de infraestructura sin moneda + moneda sugerida (heurística)
  04_fechas_invalidas.csv    hitos con CreditedDate imposible o faltante
  05_proyectos_trm.csv       proyectos con TRM=0 / moneda nula / costeo inconsistente
  06_contratos_descuadre.csv contratos cuya suma de pagos ≠ monto
  07_registros_prueba.csv    registros de prueba detectados
  RESUMEN.md                 conteos y estado de la cola

Cada CSV incluye columnas `decision_final` y `decidido_por` VACÍAS: la regla de F0 es que
ninguna excepción se resuelve sin decisión humana registrada. Este script propone, no decide.

Uso:  python tools/f0_saneamiento.py --src "C:/ruta/administrativo" --out data-quality/f0
Requiere: pandas, openpyxl.
"""
import argparse
import difflib
import os
import unicodedata

import pandas as pd


def canon(code: str) -> str:
    """Forma canónica de un ProjectCode para matching (no para almacenamiento)."""
    s = str(code).strip().lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")  # sin tildes/ñ→n
    s = s.replace(" ", "_").replace("-", "_")
    while "__" in s:
        s = s.replace("__", "_")
    # unificación de prefijos de país duplicados (solo para comparar)
    for a, b in (("col_", "co_"), ("hon_", "hn_"), ("arg_", "ar_")):
        if s.startswith(a):
            s = b + s[len(a):]
    return s


def sugerir(code, master_by_canon, master_codes):
    """(sugerencia, confianza, criterio) para un código huérfano."""
    c = canon(code)
    if c in master_by_canon:
        return master_by_canon[c], "alta", "coincidencia canónica (tildes/prefijo/espacios)"
    m = difflib.get_close_matches(c, list(master_by_canon.keys()), n=1, cutoff=0.85)
    if m:
        return master_by_canon[m[0]], "media", f"similitud {difflib.SequenceMatcher(None, c, m[0]).ratio():.0%}"
    m = difflib.get_close_matches(c, list(master_by_canon.keys()), n=1, cutoff=0.70)
    if m:
        return master_by_canon[m[0]], "baja", "similitud parcial — revisar"
    return "", "", "sin candidato — ¿crear proyecto, bolsa contable o error?"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="Carpeta con los GAP_DATA_*.xlsx")
    ap.add_argument("--out", required=True, help="Carpeta de salida")
    ap.add_argument("--corte", default="2026-08-27")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    S = lambda f, s: pd.read_excel(os.path.join(args.src, f), sheet_name=s).dropna(how="all")

    P = S("GAP_DATA_01_PROJECTS.xlsx", "GAP_DATA_01_PROJECTS")
    C = S("GAP_DATA_04_COSTS.xlsx", "GAP_DATA_04_COSTS")
    I = S("GAP_DATA_03_INCOME.xlsx", "GAP_DATA_03_INCOME")
    K = S("GAP_DATA_07_CONTRACTS.xlsx", "GAP_DATA_07A_CONTRACTS")
    KP = S("GAP_DATA_07_CONTRACTS.xlsx", "GAP_DATA_07B_PAYMENTS")
    RQ = S("GAP_DATA_07_CONTRACTS.xlsx", "GAP_DATA_07C1_REQUEST")
    PAY = S("GAP_DATA_05_PAYMENTS.xlsx", "GAP_DATA_05_PAYMENTS")
    ACC = S("GAP_DATA_09_ACCOUNTS.xlsx", "fal_accounts")
    CT = S("GAP_DATA_08_CONTRACTORS.xlsx", "GAP_DATA_08_CONTRACTORS")

    master = sorted(set(P.ProjectCode.astype(str)))
    master_by_canon = {canon(m): m for m in master}
    resumen = []

    def emit(nombre, df, cols_decision=True):
        if cols_decision:
            df = df.assign(decision_final="", decidido_por="", fecha_decision="")
        df.to_csv(os.path.join(args.out, nombre), index=False, encoding="utf-8-sig")
        resumen.append((nombre, len(df)))
        return df

    # ── 01 · Alias de ProjectCode ────────────────────────────────────────────
    rows = []
    fuentes = [("GAP_DATA_04_COSTS", C.ProjectCode), ("GAP_DATA_07A_CONTRACTS", K.ProjectCode),
               ("GAP_DATA_07C1_REQUEST", RQ.ProjectCode)]
    vistos = {}
    for fuente, serie in fuentes:
        s = serie.dropna().astype(str)
        for code, n in s.value_counts().items():
            if code not in master:
                vistos.setdefault(code, {"fuentes": [], "filas": 0})
                vistos[code]["fuentes"].append(fuente)
                vistos[code]["filas"] += int(n)
    monto = C[~C.ProjectCode.isin(master)].groupby(C.ProjectCode.astype(str)).Amount.sum()
    for code, info in sorted(vistos.items()):
        sug, conf, crit = sugerir(code, master_by_canon, master)
        rows.append({"codigo_huerfano": code, "fuentes": " + ".join(info["fuentes"]),
                     "filas_afectadas": info["filas"],
                     "monto_costos_cop": round(float(monto.get(code, 0)), 2),
                     "canonico_sugerido": sug, "confianza": conf, "criterio": crit})
    emit("01_alias_projectcode.csv", pd.DataFrame(rows))

    # ── 02 · Cuentas sin mapeo ───────────────────────────────────────────────
    mapeadas = set(pd.to_numeric(ACC.account, errors="coerce").dropna().astype(int))
    nombres_map = ACC.dropna(subset=["name_account"])[["name_account", "new_account"]]
    rows = []
    g = C.groupby([C.Account.astype(int), "AccountName"]).Amount.agg(["count", "sum"]).reset_index()
    for _, r in g.iterrows():
        if int(r.Account) in mapeadas:
            continue
        m = difflib.get_close_matches(str(r.AccountName).upper(),
                                      nombres_map.name_account.astype(str).str.upper().tolist(),
                                      n=1, cutoff=0.6)
        sug = nombres_map[nombres_map.name_account.astype(str).str.upper() == m[0]].new_account.iloc[0] if m else ""
        rows.append({"cuenta": int(r.Account), "nombre_cuenta": r.AccountName,
                     "asientos": int(r["count"]), "monto_cop": round(float(r["sum"]), 2),
                     "categoria_sugerida": sug, "criterio": "similitud de nombre" if m else "sin candidato"})
    emit("02_cuentas_sin_mapeo.csv", pd.DataFrame(rows).sort_values("monto_cop", ascending=False))

    # ── 03 · Pagos sin moneda ────────────────────────────────────────────────
    MONEDAS = {"USD", "COP", "EUR", "CLP"}
    sin = PAY[~PAY.Details.astype(str).isin(MONEDAS)].copy()
    def heur(cost):
        if pd.isna(cost):
            return "", ""
        if cost < 1000:
            return "USD", "monto < 1.000 (patrón USD)"
        if cost >= 10000:
            return "COP", "monto ≥ 10.000 (patrón COP)"
        return "", "zona ambigua — decidir con la factura"
    sin[["moneda_sugerida", "criterio"]] = sin.Cost.apply(lambda c: pd.Series(heur(c)))
    emit("03_pagos_sin_moneda.csv",
         sin[["Id", "ProjectCode", "Code", "Date", "Cost", "Details", "Invoice",
              "moneda_sugerida", "criterio"]].rename(columns={"Details": "details_actual"}))

    # ── 04 · Fechas inválidas en ingresos ───────────────────────────────────
    bad = I[(I.CreditedDate.notna()) & (I.CreditedDate < "2022-01-01")].copy()
    bad["problema"] = "CreditedDate imposible (anterior a 2022)"
    nod = I[(I.Status == "Credited") & (I.CreditedDate.isna())].copy()
    nod["problema"] = "Credited sin CreditedDate"
    F = pd.concat([bad, nod])[["Id", "ProjectCode", "ExpectedDate", "InvoiceDate",
                               "CreditedDate", "ExpectedCOP", "problema"]]
    F["propuesta"] = "usar fecha del extracto bancario; si no existe, InvoiceDate como aproximación marcada"
    emit("04_fechas_invalidas.csv", F)

    # ── 05 · Proyectos con TRM/moneda/costeo inconsistente ──────────────────
    rows = []
    for _, r in P.iterrows():
        problemas = []
        if pd.isna(r.Currency):
            problemas.append("moneda nula")
        if r.ExchangeRate == 0:
            problemas.append("TRM = 0")
        if r.ContractAmount and r.ExchangeRate and r.CostingAmount:
            calc = r.ContractAmount * r.ExchangeRate
            if calc and abs(r.CostingAmount - calc) / calc > 0.01:
                problemas.append(f"Costing difiere {((r.CostingAmount-calc)/calc*100):+.0f}% de Contrato×TRM")
        if problemas:
            rows.append({"ProjectCode": r.ProjectCode, "Status": r.Status,
                         "ContractAmount": r.ContractAmount, "Currency": r.Currency,
                         "ExchangeRate": r.ExchangeRate, "CostingAmount": r.CostingAmount,
                         "problemas": " · ".join(problemas),
                         "propuesta": "confirmar versión vigente (¿adenda?) y registrar TRM pactada"})
    emit("05_proyectos_trm.csv", pd.DataFrame(rows))

    # ── 06 · Contratos con descuadre ────────────────────────────────────────
    kp = KP.groupby("ContractCode").PaymentAmount.sum()
    kk = K.set_index("ContractCode")[["ContractAmount", "ContractAnnotations", "ProjectCode"]].join(
        kp.rename("suma_pagos"))
    desc = kk[(kk.suma_pagos.notna()) & ((kk.suma_pagos - kk.ContractAmount).abs() > 1)].reset_index()
    desc["diferencia"] = desc.suma_pagos - desc.ContractAmount
    desc["propuesta"] = "si hubo otrosí: actualizar monto del contrato; si no: corregir cronograma"
    emit("06_contratos_descuadre.csv", desc)

    # ── 07 · Registros de prueba ────────────────────────────────────────────
    prueba = CT[(CT.ContractorID == 0) |
                (CT.apply(lambda r: "fantasma" in str(r.values).lower(), axis=1))]
    cols = [c for c in ["ContractorID", "ContractorIDType", "ContractorFirstName",
                        "ContractorFamilyName1", "Profile"] if c in prueba.columns]
    pr = prueba[cols].copy()
    pr["propuesta"] = "eliminar antes de migrar (verificar que no tenga contratos)"
    emit("07_registros_prueba.csv", pr)

    # ── RESUMEN ──────────────────────────────────────────────────────────────
    with open(os.path.join(args.out, "RESUMEN.md"), "w", encoding="utf-8") as f:
        f.write(f"# F0 · Cola de excepciones — corte {args.corte}\n\n")
        f.write("Generado por `tools/f0_saneamiento.py`. Ninguna excepción se considera resuelta "
                "hasta que `decision_final` y `decidido_por` estén diligenciadas.\n\n")
        f.write("| Archivo | Excepciones |\n|---|---|\n")
        for nombre, n in resumen:
            f.write(f"| {nombre} | {n} |\n")
        total = sum(n for _, n in resumen)
        f.write(f"| **Total** | **{total}** |\n\n")
        f.write("Criterio de salida de F0: total de excepciones sin decisión = 0.\n")
    print(f"OK — {sum(n for _, n in resumen)} excepciones en {args.out}")
    for nombre, n in resumen:
        print(f"  {nombre}: {n}")


if __name__ == "__main__":
    main()
