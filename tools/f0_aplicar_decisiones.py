# -*- coding: utf-8 -*-
"""
F0 · Aplica las decisiones delegadas (2026-08-29) sobre la cola de excepciones.

Cada decisión queda registrada con su criterio en el propio CSV. Las decisiones marcadas
PROVISIONAL requieren ratificación (issue de ratificación en GitHub). Genera además las
tablas semilla para la migración en seeds/.
"""
import os
import pandas as pd

QUIEN = "Claude Code (delegación de dirección 2026-08-29)"
FECHA = "2026-08-29"
D = "data-quality/f0/"


def load(n):
    return pd.read_csv(D + n, encoding="utf-8-sig")


def save(df, n):
    df.to_csv(D + n, index=False, encoding="utf-8-sig")
    print(n, "->", int((df.decision_final != "").sum()), "/", len(df), "decididas")


# ── 01 · Alias / creación / bolsas ──────────────────────────────────────────
a = load("01_alias_projectcode.csv").fillna("")
ALIAS = {
    "col_pnud_campana_vbg_osigd_2024": "co_pnud_campaña_vbg_osigd_2024",
    "cr_pnud_aduanas y refrigeracion_v1_2021": "cr_pnud_aduanas_refrigeración_v1_2021",
    "hn_unicef_cambio_climatico_2025": "hn_unicef_cambio_clima_v1_2025",
    "pa_pnud_diagrama_democracia": "pa_pnud_diagrama_democracia_2026",
    "pan_pnud_pymes-mujeres_v1_2022": "pa_pnud_pymes_mujeres_v1_2022",
    "ve_unicef_po_general_v2": "ven_unicef_po_general_2024",
    "ven_unicef_atencion_inclusiva_26": "ven_unicef_atencion_inclusiva_2026",
    "pa_pnud_rblac_juventud_v3_2023": "pa_rblac_juventud_v3_2023",
}
BOLSA = {
    "Amortizacion de costos": "AMORTIZACION",
    "Infraestructura Interna": "INFRA_INTERNA",
    "team_text_chanel": "OPERACIONES",
}
FASE = {"co_csj_rama_judicial_2026", "co_csj_rama_judicial_2027", "co_csj_rama_judicial_2028"}


def canonizar(c):
    s = c.strip().lower().replace(" ", "_").replace("-", "_")
    while "__" in s:
        s = s.replace("__", "_")
    return s


def dec01(r):
    c = r.codigo_huerfano
    if c in ALIAS:
        return "alias -> " + ALIAS[c], "misma iniciativa, grafía distinta"
    if c in BOLSA:
        nota = "no es proyecto; overhead con regla explícita"
        if c == "team_text_chanel":
            nota += " · revisar asiento original"
        return "bolsa_contable -> " + BOLSA[c], nota
    if c in FASE:
        return "crear_proyecto_fase -> " + c, "fase plurianual real del contrato CSJ (existe en contratos y costos)"
    if c == "us_wwf_safeguards_2023":
        nota = "verificar si corresponde a gr_wwf_safeguards_v1_2023"
    else:
        nota = "proyecto anterior al maestro actual; entra como histórico para no perder su costo"
    return "crear_proyecto_historico -> " + canonizar(c), nota


a[["decision_final", "criterio_decision"]] = a.apply(lambda r: pd.Series(dec01(r)), axis=1)
a["decidido_por"] = QUIEN
a["fecha_decision"] = FECHA
save(a, "01_alias_projectcode.csv")

os.makedirs("seeds", exist_ok=True)
seed = a[["codigo_huerfano", "decision_final", "criterio_decision"]].copy()
seed["accion"] = seed.decision_final.str.split(" -> ").str[0]
seed["codigo_canonico"] = seed.decision_final.str.split(" -> ").str[1]
seed[["codigo_huerfano", "accion", "codigo_canonico", "criterio_decision"]].rename(
    columns={"codigo_huerfano": "codigo_origen", "criterio_decision": "nota"}
).to_csv("seeds/alias_projectcode.csv", index=False, encoding="utf-8-sig")
print("seeds/alias_projectcode.csv:", len(seed), "| acciones:", seed.accion.value_counts().to_dict())

# ── 02 · Cuentas ────────────────────────────────────────────────────────────
c2 = load("02_cuentas_sin_mapeo.csv").fillna("")


def dec02(r):
    if r.categoria_sugerida:
        return r.categoria_sugerida, "se adopta la sugerencia por similitud de nombre"
    n = str(r.nombre_cuenta).upper()
    for kw, cat in (
        ("VIATIC", "Missions"), ("HOTEL", "Missions"), ("PASAJE", "Missions"),
        ("TAXI", "Missions"), ("CASINO", "Missions"),
        ("SUSCRIP", "Software Services"), ("SOFTWARE", "Software Services"),
        ("IMPUESTO", "Other"), ("SEGURO", "Other"), ("POLIZA", "Other"),
    ):
        if kw in n:
            return cat, "palabra clave " + kw
    return "Other", "sin señal clara; categoría residual"


c2[["decision_final", "criterio_decision"]] = c2.apply(lambda r: pd.Series(dec02(r)), axis=1)
c2["decidido_por"] = QUIEN
c2["fecha_decision"] = FECHA
save(c2, "02_cuentas_sin_mapeo.csv")
c2[["cuenta", "nombre_cuenta", "decision_final"]].rename(columns={"decision_final": "categoria"}).to_csv(
    "seeds/cuentas_categoria.csv", index=False, encoding="utf-8-sig")

# ── 03 · Pagos sin moneda ───────────────────────────────────────────────────
p3 = load("03_pagos_sin_moneda.csv").fillna("")
p3["decision_final"] = p3.moneda_sugerida.where(p3.moneda_sugerida != "", "USD")
p3["criterio_decision"] = p3.apply(
    lambda r: r.criterio if r.moneda_sugerida else
    "zona ambigua: USD por patrón dominante de la tabla — PROVISIONAL, confirmar con factura", axis=1)
p3["decidido_por"] = QUIEN
p3["fecha_decision"] = FECHA
save(p3, "03_pagos_sin_moneda.csv")

# ── 04 · Fechas ─────────────────────────────────────────────────────────────
f4 = load("04_fechas_invalidas.csv").fillna("")


def dec04(r):
    if "imposible" in str(r.problema):
        return ("CreditedDate := InvoiceDate, marcada aproximada=true",
                "la fecha 2005-05-16 es un artefacto de captura; la factura es la mejor aproximación")
    if str(r.InvoiceDate) not in ("", "nan", "NaT"):
        return ("CreditedDate := InvoiceDate, marcada aproximada=true",
                "sin extracto disponible; aproximación honesta y marcada")
    return ("CreditedDate := ExpectedDate, marcada aproximada=true",
            "sin factura ni extracto; última aproximación, siempre marcada")


f4[["decision_final", "criterio_decision"]] = f4.apply(lambda r: pd.Series(dec04(r)), axis=1)
f4["decidido_por"] = QUIEN
f4["fecha_decision"] = FECHA
save(f4, "04_fechas_invalidas.csv")

# ── 05 · TRM / costeo ───────────────────────────────────────────────────────
t5 = load("05_proyectos_trm.csv").fillna("")


def dec05(r):
    probs = str(r.problemas)
    monto = float(r.ContractAmount or 0)
    costeo = float(r.CostingAmount or 0)
    if "moneda nula" in probs and monto == 0:
        return ("Currency := COP; montos en 0 se conservan",
                "proyecto sin costeo cargado (pausado/cancelado); COP como neutro")
    partes = ["CostingAmount es la cifra vigente (manda sobre Contrato x TRM)"]
    if monto > 0 and costeo > 0:
        partes.append("TRM_pactada := CostingAmount/ContractAmount = %.2f" % (costeo / monto))
    return ("; ".join(partes),
            "las diferencias provienen de adendas no versionadas; el negocio opera con CostingAmount")


t5[["decision_final", "criterio_decision"]] = t5.apply(lambda r: pd.Series(dec05(r)), axis=1)
t5["decidido_por"] = QUIEN
t5["fecha_decision"] = FECHA
save(t5, "05_proyectos_trm.csv")

# ── 06 · Contratos descuadrados ─────────────────────────────────────────────
k6 = load("06_contratos_descuadre.csv").fillna("")


def dec06(r):
    otrosi = "OTROS" in str(r.ContractAnnotations).upper()
    dif = float(r.diferencia)
    pagos = float(r.suma_pagos)
    if otrosi:
        return ("ContractAmount := %.0f (suma de pagos)" % pagos,
                "hubo otrosí: el cronograma refleja el acuerdo vigente; el monto quedó sin actualizar")
    if dif < 0:
        return ("cronograma incompleto: registrar pagos futuros por la diferencia",
                "monto contractual manda; faltan cuotas por programar")
    return ("ContractAmount := %.0f (suma de pagos) + registrar otrosí retroactivo" % pagos,
            "pagos autorizados por encima del monto: formalizar la modificación")


k6[["decision_final", "criterio_decision"]] = k6.apply(lambda r: pd.Series(dec06(r)), axis=1)
k6["decidido_por"] = QUIEN
k6["fecha_decision"] = FECHA
save(k6, "06_contratos_descuadre.csv")

# ── 07 · Registro de prueba ─────────────────────────────────────────────────
r7 = load("07_registros_prueba.csv").fillna("")
r7["decision_final"] = "eliminar antes de migrar"
r7["criterio_decision"] = "verificado: sin contratos ni solicitudes asociados"
r7["decidido_por"] = QUIEN
r7["fecha_decision"] = FECHA
save(r7, "07_registros_prueba.csv")

# ── 08 · Mapeo tarifario: adoptar candidatos ────────────────────────────────
e8 = load("08_evidencia_tarifario_servicios2026.csv").fillna("")
e8["ihpsc_definitivo"] = e8.ihpsc_candidato.where(e8.ihpsc_candidato != "", "REVISAR EN TALLER")
e8["decidido_por"] = QUIEN + " — PROVISIONAL"
e8.to_csv(D + "08_evidencia_tarifario_servicios2026.csv", index=False, encoding="utf-8-sig")
print("08:", int((e8.ihpsc_definitivo != "REVISAR EN TALLER").sum()), "/", len(e8), "mapeadas")

# ── Tarifario provisional: mediana de precios reales 2026 ───────────────────
g9 = load("09_rangos_precio_por_item.csv")
g9["costo_ref_provisional_cop"] = g9.p_mediana
g9["fuente"] = "mediana de precios reales pagados 2026 (07C2_SERVICES)"
g9["estado"] = "PROVISIONAL — ratificar en taller de tarifas"
g9.to_csv("seeds/tarifario_provisional.csv", index=False, encoding="utf-8-sig")
print("seeds/tarifario_provisional.csv:", len(g9), "ítems con costo de referencia provisional")
