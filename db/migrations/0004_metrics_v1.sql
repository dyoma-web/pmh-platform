-- 0004 · Métricas certificadas v1 — definidas sobre el núcleo transaccional.
-- Las v0 (staging) siguen alimentando el front hasta el switch de F4; la vista
-- metrics.v1_vs_v0 compara ambas y es la prueba de paridad del corte.

-- M5 · Cartera vencida con antigüedad
CREATE OR REPLACE VIEW metrics.v1_cartera_aging AS
SELECT p.code            AS project_code,
       cl.name           AS cliente,
       pm.full_name      AS partner_manager,
       ges.full_name     AS project_manager,
       m.legacy_id       AS hito_id,
       m.expected_date   AS fecha_esperada,
       m.invoice_date    AS fecha_factura,
       m.state,
       m.amount_cop,
       (current_date - m.expected_date)      AS dias_vencido,
       CASE WHEN current_date - m.expected_date <= 30 THEN '01-30'
            WHEN current_date - m.expected_date <= 60 THEN '31-60'
            WHEN current_date - m.expected_date <= 90 THEN '61-90'
            ELSE '+90' END AS tramo
FROM revenue.milestone m
JOIN core.project p   ON p.id = m.project_id
LEFT JOIN core.client cl ON cl.id = p.client_id
LEFT JOIN core.app_user pm ON pm.id = p.partner_manager_id
LEFT JOIN core.app_user ges ON ges.id = p.pm_id
WHERE m.state IN ('scheduled', 'invoiced')
  AND m.expected_date < current_date;

-- M2 (base ledger) · resultado por proyecto: todo sale del libro único
CREATE OR REPLACE VIEW metrics.v1_resultado_proyecto AS
SELECT p.id AS project_id, p.code, p.kind, p.status, p.service_line,
       cl.name AS cliente,
       sum(e.amount_cop) FILTER (WHERE e.kind = 'revenue_credit')      AS acreditado_cop,
       sum(e.amount_cop) FILTER (WHERE e.kind = 'gl_accrual')          AS causado_cop,
       sum(e.amount_cop) FILTER (WHERE e.kind IN ('infra_payment'))    AS infra_cop,
       count(*) FILTER (WHERE e.amount_cop IS NULL)                    AS eventos_sin_trm
FROM core.project p
LEFT JOIN core.client cl ON cl.id = p.client_id
LEFT JOIN ledger.money_event e ON e.project_id = p.id
GROUP BY p.id, p.code, p.kind, p.status, p.service_line, cl.name;

-- M2 (aprox) · margen por línea, completados — versión ledger
CREATE OR REPLACE VIEW metrics.v1_margen_linea AS
SELECT service_line,
       count(*)             AS proyectos,
       sum(acreditado_cop)  AS acreditado_cop,
       sum(causado_cop)     AS costo_directo_cop,
       round(sum(causado_cop) / nullif(sum(acreditado_cop), 0) * 100, 1) AS costo_pct
FROM metrics.v1_resultado_proyecto
WHERE status = 'completed' AND kind = 'project'
GROUP BY service_line
ORDER BY acreditado_cop DESC NULLS LAST;

-- M8 · cumplimiento legal (la regla vive como CHECK; esto mide el stock legado)
CREATE OR REPLACE VIEW metrics.v1_cumplimiento_legal AS
SELECT count(*) FILTER (WHERE adm_validated_at IS NOT NULL)                        AS pagados,
       count(*) FILTER (WHERE legacy_exception)                                    AS legado_sin_soporte,
       round(100.0 * count(*) FILTER (WHERE adm_validated_at IS NOT NULL AND NOT legacy_exception)
             / nullif(count(*) FILTER (WHERE adm_validated_at IS NOT NULL), 0), 1) AS cumplimiento_pct
FROM procurement.contract_payment;

-- M10 · eventos del ledger sin TRM (moneda extranjera histórica sin tasa)
CREATE OR REPLACE VIEW metrics.v1_eventos_sin_trm AS
SELECT kind, currency, count(*) AS eventos, sum(amount) AS monto_original
FROM ledger.money_event
WHERE amount_cop IS NULL
GROUP BY kind, currency ORDER BY eventos DESC;

-- Prueba de paridad v1 (transaccional) vs v0 (staging): debe dar OK en todo
CREATE OR REPLACE VIEW metrics.v1_vs_v0 AS
SELECT 'cartera_vencida_cop' AS metrica,
       (SELECT sum(amount_cop)  FROM metrics.v1_cartera_aging)  AS v1,
       (SELECT sum(expected_cop) FROM metrics.v0_cartera_aging) AS v0
UNION ALL
SELECT 'hitos_vencidos',
       (SELECT count(*) FROM metrics.v1_cartera_aging),
       (SELECT count(*) FROM metrics.v0_cartera_aging)
UNION ALL
SELECT 'costos_cop',
       (SELECT sum(amount_cop) FROM ledger.money_event WHERE kind = 'gl_accrual'),
       (SELECT sum(amount) FROM staging.costs)
UNION ALL
SELECT 'acreditado_cop',
       (SELECT sum(amount_cop) FROM ledger.money_event WHERE kind = 'revenue_credit'),
       (SELECT sum(expected_cop) FROM staging.income WHERE status IN ('Credited','Paid'))
UNION ALL
SELECT 'pagos_validados_cop',
       (SELECT sum(amount_cop) FROM ledger.money_event WHERE kind = 'contractor_payment'),
       (SELECT sum(payment_amount) FROM staging.contract_payments WHERE adm_validation = 'Paid');

GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO bi_reader;
