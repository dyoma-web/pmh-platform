# Diccionario de métricas certificadas — PMH 2.0

**Estado: BORRADOR PARA FIRMA.** Ninguna métrica se implementa hasta que dirección firme su
definición. Una vez firmada, la definición solo cambia por versión nueva registrada aquí (el
histórico no se recalcula en silencio).

Reglas transversales:

- **Toda cifra agregada se expresa en COP**, convertida con la TRM del evento (`fx_rate` del
  `money_event`). Los totales por moneda original están disponibles al expandir, nunca sumados.
- **"Hoy"** = fecha de cálculo de la vista; **"vencido"** = fecha de referencia < hoy.
- Cada métrica es una vista materializada `mv_<id>` con test diario que compara contra una cifra
  de control o una invariante (p. ej. M5 ⊆ M7; M2 por proyecto suma al total del portafolio).
- Exclusiones globales: proyectos `Cancelled` fuera de toda métrica salvo mención explícita; las
  bolsas contables (`Operaciones`, `Infraestructura Interna`, `Amortización`) solo entran donde se
  indique, nunca como "proyecto".

| Campo | Contenido |
|---|---|
| ID / Nombre | Identificador estable y nombre en la interfaz |
| Pregunta | La pregunta de negocio que responde (una sola) |
| Fórmula | Definición exacta |
| Insumos | Tablas/eventos del modelo objetivo |
| Casos borde | Decisiones explícitas sobre datos incómodos |
| Dueño / Umbral | Quién actúa y cuándo se enciende el semáforo |

---

## M1 · Caja proyectada a 13 semanas — `mv_cash_forecast_13w`

- **Pregunta:** ¿me alcanza la plata las próximas 13 semanas?
- **Fórmula:** por semana *w*: `saldo(w) = saldo(w−1) + cobros_probables(w) − pagos_comprometidos(w) − costo_fijo_semanal`. `cobros_probables(w) = Σ hitos no cobrados con forecast_date ∈ w × prob_cobro(cliente, atraso_actual)`. `prob_cobro` se deriva de la curva histórica de M6 (fracción de hitos del cliente cobrados a ≤ n días de la fecha esperada).
- **Insumos:** `revenue_milestone` (estado ≠ credited), `contract_payment` (no pagados), `infra_item` (renovaciones), costo fijo mensual parametrizado (decisión de dirección, no dato del sistema).
- **Casos borde:** hito vencido sin forecast → se proyecta con el percentil 50 de atraso del cliente; contratos `Pending` de pago sin fecha → semana de `due_date`; saldo inicial = parámetro capturado al cierre de cada mes.
- **Dueño:** COO. **Umbral:** cualquier semana con saldo proyectado < 0 → rojo; < costo fijo de 2 semanas → ámbar.

## M2 · Margen comprometido — `mv_margin_committed`

- **Pregunta:** ¿cuánto voy a ganar de verdad en este proyecto/línea/cliente, con lo ya firmado?
- **Fórmula:** `(ingreso_adjudicado_cop − causado_cop − comprometido_no_causado_cop) / ingreso_adjudicado_cop`. `ingreso_adjudicado` = versión vigente de `project_amount`; `causado` = eventos ledger tipo `gl_accrual` del proyecto; `comprometido_no_causado` = contratos activos − su parte ya causada (vía conciliación M-rec).
- **Casos borde:** proyecto sin conciliación completa → el comprometido se toma bruto (conservador) y la fila se marca `estimado`; costo interno causado incluido (decisión §10.2 del doc 02 — pendiente de firma); bolsas contables excluidas del margen por proyecto, visibles como línea "overhead no distribuido" en el agregado.
- **Dueño:** COO. **Umbral:** margen proyectado < `p_margin` costeado − 5 pp → ámbar; < 0 → rojo.

## M3 · Ejecución presupuestal — `mv_budget_execution`

- **Pregunta:** ¿esta línea de presupuesto aguanta lo que falta del proyecto?
- **Fórmula:** por línea de presupuesto: `(causado + comprometido) / presupuesto_aprobado_vigente`. Semáforo heredado del sistema actual: `Fine` < 70 % · `Risk` 70–90 % · `Alert` > 90 % (umbrales en configuración).
- **Casos borde:** proyecto sin presupuesto aprobado → no se calcula: la fila aparece como **"sin presupuesto"** (estado propio, visible y contable — nunca un cero que finja ejecución 0 %); costos imputados al proyecto sin línea asignada → bucket "sin clasificar" de ese proyecto, que también enciende semáforo.
- **Dueño:** gestora. **Umbral:** `Alert`, o consumo > 85 % con avance físico < 70 % (avance disponible desde F8).

## M4 · Consumo de reserva — `mv_reserve_consumption`

- **Pregunta:** ¿cuánto del 20 % de reserva se liberó y consumió, y quién lo autorizó?
- **Fórmula:** por proyecto: `liberado = Σ budget_release`; `consumido = causado − presupuesto_80`; ratio sobre `implementation_reserve`.
- **Casos borde:** liberaciones históricas (comentarios "Autorizado 100 % GAP") migran como `budget_release` con autor "migración" y fecha del comentario si es datable.
- **Dueño:** administración. **Umbral:** > 50 % liberado sin aprobación de COO registrada → rojo.

## M5 · Cartera vencida y aging — `mv_ar_aging`

- **Pregunta:** ¿quién me debe, cuánto y desde hace cuánto?
- **Fórmula:** hitos en `scheduled`/`invoiced` con `expected_date < hoy`, `dias = hoy − expected_date`, tramos 1-30 / 31-60 / 61-90 / +90, agrupado por cliente y partner manager. Cifra titular = Σ `amount_cop`.
- **Casos borde:** hito con `forecast_date` repactada futura → sigue vencido contra `expected_date` pero se marca `repactado` (el aging no se resetea por repactar — decisión anti-maquillaje); hitos de proyectos `Paused` incluidos.
- **Dueño:** partner manager de la relación. **Umbral:** cualquier hito +30 días → tarea; cliente con > 20 % de su cartera en +60 → escalamiento a COO.

## M6 · DSO por cliente — `mv_dso_client`

- **Pregunta:** ¿cuánto se demora en pagar cada cliente, de verdad?
- **Fórmula:** media ponderada por monto de `(credited_date − expected_date)` sobre hitos cobrados en los últimos 12 meses móviles, por cliente; percentiles 50/90 además de la media.
- **Casos borde:** hitos sin `credited_date` excluidos y contados en M10; valores < −60 días (cobro muy anticipado) se auditan antes de promediar.
- **Dueño:** partner manager (informativo; alimenta M1 y la negociación de hitos).

## M7 · Backlog — `mv_backlog`

- **Pregunta:** ¿cuánto trabajo vendido me queda por convertir en factura?
- **Fórmula:** Σ hitos en `scheduled` (no facturados) de proyectos activos, distribuido por mes de `expected_date`/`forecast_date`.
- **Dueño:** COO. **Umbral:** backlog total < 3 × costo fijo mensual → ámbar (señal de vender).

## M8 · Cumplimiento legal de pagos — `mv_payment_compliance`

- **Pregunta:** ¿todos los pagos a terceros tienen su soporte?
- **Fórmula:** `pagos con cuenta de cobro + soporte legal / pagos pagados`, total y por gestora. En el sistema nuevo el CHECK lo hace imposible; la métrica vigila el stock migrado (150 casos) y cualquier bypass.
- **Dueño:** administración. **Umbral:** < 100 % → cada caso es una tarea con contratista y monto.

## M9 · Costo de infraestructura por proyecto — `mv_infra_cost`

- **Pregunta:** ¿cuánto cuesta de verdad la infraestructura de cada proyecto y la corporativa?
- **Fórmula:** eventos ledger tipo `infra_payment` a COP con TRM del evento + distribución de recursos compartidos según `allocation_rule` vigente a la fecha del evento.
- **Casos borde:** pago de recurso compartido sin regla vigente → bucket "sin distribuir" (visible, no desaparece); ítems `ON` con `end_date` vencida generan tarea (no entran distinto a la métrica).
- **Dueño:** administración/infraestructura. **Umbral:** ítem ON vencido → tarea; costo mensual corporativo > presupuesto anual/12 × 1,15 → ámbar.

## M10 · Salud del dato — `mv_data_health`

- **Pregunta:** ¿puedo confiar hoy en las demás métricas?
- **Fórmula:** % de reglas de calidad en verde. Set inicial = las 14 advertencias del doc 01 §9 convertidas en pruebas (huérfanos nuevos = 0, montos sin moneda = 0, fechas imposibles = 0, Σ pagos = monto por contrato, documentos referenciados existen, PII fuera de vistas, etc.).
- **Dueño:** data steward. **Umbral:** < 100 % dos días seguidos → tarea; cualquier regla en rojo se muestra como banda en el cockpit ("estas cifras pueden estar afectadas por…").

## M11 · Cobertura de tarifario — `mv_catalog_coverage`

- **Pregunta:** ¿qué tanto de lo que vendemos tiene costo de referencia validado?
- **Fórmula:** `Σ monto 12 m de líneas de servicio mapeadas a ítems IHPSC con costo validado / Σ monto 12 m total`. Se pondera por plata, no por conteo (costear 40 ítems puede cubrir > 80 % del monto).
- **Dueño:** data steward / COO. **Umbral:** < 80 % del monto vendido → ámbar.

## M12 · Ciclo de contratación — `mv_hiring_cycle`

- **Pregunta:** ¿cuánto tardamos de "necesito a alguien" a "contrato firmado"?
- **Fórmula:** mediana y p90 de `(contract.signed_date − hiring_request.created_at)` en días hábiles (calendario Colombia), por trimestre y por categoría OS/PS.
- **Casos borde:** solicitudes canceladas excluidas de la mediana, reportadas como tasa de cancelación aparte.
- **Dueño:** administración. **Umbral:** mediana > 10 días hábiles → ámbar.

---

## Pendientes de firma (bloquean la implementación)

1. Costo fijo mensual: monto y fuente de actualización (M1, M7).
2. ¿El costo interno causado entra al margen por proyecto? (M2 — recomendación: sí, con desglose interno/externo visible).
3. Destino de las bolsas contables: ¿prorrateo por regla o overhead no distribuido? (M2, M9).
4. TRM para reporte cuando el evento no la trae: ¿TRM pactada del proyecto o TRM del día? (transversal).
5. Umbrales definitivos de M3 (70/90) y M5 (30/60/90): confirmar o ajustar.

*Versión 0.1 · 2026-08-29 · Firmas: ☐ Dirección ☐ Administración ☐ Data steward*
