# F0 · Cola de excepciones — corte 2026-08-27

Generado por `tools/f0_saneamiento.py`. Ninguna excepción se considera resuelta hasta que `decision_final` y `decidido_por` estén diligenciadas.

| Archivo | Excepciones |
|---|---|
| 01_alias_projectcode.csv | 44 |
| 02_cuentas_sin_mapeo.csv | 28 |
| 03_pagos_sin_moneda.csv | 108 |
| 04_fechas_invalidas.csv | 79 |
| 05_proyectos_trm.csv | 69 |
| 06_contratos_descuadre.csv | 9 |
| 07_registros_prueba.csv | 1 |
| **Total** | **338** |

Criterio de salida de F0: total de excepciones sin decisión = 0.

---

## Estado: COLA CERRADA (2026-08-29)

Las 338 excepciones tienen decisión registrada (`tools/f0_aplicar_decisiones.py`), por delegación
expresa de dirección. Reglas aplicadas:

- **Alias (8):** misma iniciativa con grafía distinta → códigos unificados al canónico.
- **Proyectos históricos (30):** iniciativas 2021-2023 anteriores al maestro actual → se crean
  como proyectos históricos para no perder su costo.
- **Fases CSJ (3):** `co_csj_rama_judicial_2026/2027/2028` se crean como proyectos-fase reales.
- **Bolsas contables (3):** AMORTIZACION, INFRA_INTERNA, OPERACIONES → overhead no distribuido.
- **Cuentas (28):** categoría por similitud/palabra clave; residual a Other.
- **Monedas (108):** heurística de magnitud (84 COP, 24 USD) — PROVISIONAL en zona ambigua.
- **Fechas (79):** `CreditedDate := InvoiceDate` (o ExpectedDate) siempre `aproximada=true`.
- **TRM (69):** `CostingAmount` manda; TRM pactada derivada. Moneda nula sin monto → COP.
- **Contratos (9):** con otrosí → monto := Σ pagos; sin otrosí y pagos < monto → cronograma
  incompleto; pagos > monto → otrosí retroactivo.
- **Prueba (1):** «A Fantasma» se elimina antes de migrar.

Semillas de migración generadas: `seeds/alias_projectcode.csv`, `seeds/cuentas_categoria.csv`,
`seeds/tarifario_provisional.csv` (14 ítems con costo ref = mediana de precios reales 2026).

**Pendiente de ratificación humana** (no bloquea F1): decisiones marcadas PROVISIONAL
(monedas ambiguas, mapeo y tarifas IHPSC) y las 5 decisiones del diccionario de métricas v0.2.
