-- Vistas F1 (v0) — capa de decisión de solo lectura sobre staging + ref.
-- Se aplican con CREATE OR REPLACE en cada sync (tools/sync_staging.py).
-- Son PROVISIONALES: en F2+ las métricas certificadas se materializan sobre el
-- modelo transaccional. El prefijo v0_ lo hace explícito.

-- ── Normalización de códigos (decisiones F0) ────────────────────────────────
CREATE OR REPLACE VIEW staging.v_costs_norm AS
SELECT c.*,
       COALESCE(a.codigo_canonico, c.project_code) AS project_code_canon,
       COALESCE(a.accion, 'directo')               AS norm_accion
FROM staging.costs c
LEFT JOIN ref.alias_projectcode a ON a.codigo_origen = c.project_code;

-- ── M5/M6 · Cartera vencida con antigüedad ─────────────────────────────────
CREATE OR REPLACE VIEW metrics.v0_cartera_aging AS
SELECT i.project_code,
       p.partner_entity  AS cliente,
       p.partner_manager,
       p.project_manager,
       i.id              AS hito_id,
       i.expected_date::date AS fecha_esperada,
       i.invoice_date::date  AS fecha_factura,
       i.status,
       i.expected_cop,
       (current_date - i.expected_date::date) AS dias_vencido,
       CASE WHEN current_date - i.expected_date::date <= 30 THEN '01-30'
            WHEN current_date - i.expected_date::date <= 60 THEN '31-60'
            WHEN current_date - i.expected_date::date <= 90 THEN '61-90'
            ELSE '+90' END AS tramo
FROM staging.income i
JOIN staging.projects p USING (project_code)
WHERE i.status IN ('Scheduled', 'Invoiced')
  AND i.expected_date::date < current_date;

CREATE OR REPLACE VIEW metrics.v0_cartera_resumen AS
SELECT cliente, partner_manager, tramo,
       count(*)          AS hitos,
       sum(expected_cop) AS monto_cop
FROM metrics.v0_cartera_aging
GROUP BY cliente, partner_manager, tramo;

-- ── Semáforos-tarea con dueño (doc 03 §5) ──────────────────────────────────
CREATE OR REPLACE VIEW metrics.v0_semaforos AS
SELECT 'hito_vencido'::text AS regla,
       'Partner manager: ' || partner_manager AS dueno,
       project_code, hito_id AS referencia,
       expected_cop AS monto_cop, dias_vencido AS dias,
       'Hito ' || status || ' vencido hace ' || dias_vencido || ' días' AS detalle
FROM metrics.v0_cartera_aging
UNION ALL
SELECT 'pago_contratista_vencido',
       'Administración + ' || c.contract_overseer,
       c.project_code, cp.contract_code,
       cp.payment_amount, (current_date - cp.payment_date::date),
       'Pago ' || cp.adm_validation || ' con fecha ' || cp.payment_date::date
FROM staging.contract_payments cp
JOIN staging.contracts c USING (contract_code)
WHERE cp.adm_validation <> 'Paid' AND cp.payment_date::date < current_date
UNION ALL
SELECT 'pago_sin_soporte_legal',
       'Administración',
       c.project_code, cp.contract_code,
       cp.payment_amount, NULL,
       'Pago marcado Paid sin soporte legal adjunto'
FROM staging.contract_payments cp
JOIN staging.contracts c USING (contract_code)
WHERE cp.adm_validation = 'Paid' AND cp.contractor_legal IS NULL
UNION ALL
SELECT 'proyecto_activo_cierre_vencido',
       'Gestora: ' || p.project_manager,
       p.project_code, p.project_code,
       p.costing_amount, (current_date - p.closing_date::date),
       'Activo con cierre ' || p.closing_date::date || ': prorrogar o cerrar'
FROM staging.projects p
WHERE p.status = 'Active' AND p.closing_date::date < current_date
UNION ALL
SELECT 'infra_on_vencida',
       'Infraestructura',
       i.project_code, i.product_key,
       i.monthly_budget, (current_date - i.end_date::date),
       i.concept || ' (' || i.provider || ') ON con fin ' || i.end_date::date
FROM staging.infra_items i
WHERE i.status = 'ON' AND i.end_date::date < current_date;

-- ── M2 (aprox. F1) · Margen por línea de servicio, proyectos completados ───
CREATE OR REPLACE VIEW metrics.v0_margen_linea AS
WITH ingreso AS (
    SELECT project_code, sum(expected_cop) AS acreditado
    FROM staging.income WHERE status = 'Credited' GROUP BY project_code
), costo AS (
    SELECT project_code_canon AS project_code, sum(amount) AS costo
    FROM staging.v_costs_norm
    WHERE norm_accion IN ('directo', 'alias', 'crear_proyecto_fase')
    GROUP BY project_code_canon
)
SELECT p.service_line,
       count(*)                            AS proyectos,
       sum(i.acreditado)                   AS acreditado_cop,
       sum(c.costo)                        AS costo_directo_cop,
       round(sum(c.costo) / nullif(sum(i.acreditado), 0) * 100, 1) AS costo_pct
FROM staging.projects p
LEFT JOIN ingreso i USING (project_code)
LEFT JOIN costo   c USING (project_code)
WHERE p.status = 'Completed'
GROUP BY p.service_line
ORDER BY acreditado_cop DESC NULLS LAST;

-- ── Cifras de control (reconciliación contra docs/02 Anexo B) ──────────────
CREATE OR REPLACE VIEW metrics.v0_cifras_control AS
SELECT 'proyectos'                AS metrica, count(*)::numeric AS valor FROM staging.projects
UNION ALL SELECT 'ingreso_esperado_cop', sum(expected_cop) FROM staging.income
UNION ALL SELECT 'ingreso_acreditado_cop', sum(expected_cop) FROM staging.income WHERE status = 'Credited'
UNION ALL SELECT 'cartera_pendiente_cop', sum(expected_cop) FROM staging.income WHERE status IN ('Scheduled','Invoiced')
UNION ALL SELECT 'cartera_vencida_cop', sum(expected_cop) FROM metrics.v0_cartera_aging
UNION ALL SELECT 'costos_cop', sum(amount) FROM staging.costs
UNION ALL SELECT 'contratos_monto_cop', sum(contract_amount) FROM staging.contracts
UNION ALL SELECT 'contratos_n', count(*)::numeric FROM staging.contracts;

-- BI solo ve metrics
GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO bi_reader;
