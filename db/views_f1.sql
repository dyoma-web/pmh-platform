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

-- ── KPIs del cockpit (una fila) ────────────────────────────────────────────
CREATE OR REPLACE VIEW metrics.v0_kpis AS
SELECT
  (SELECT sum(expected_cop) FROM staging.income WHERE status IN ('Scheduled','Invoiced'))            AS cartera_pendiente_cop,
  (SELECT sum(expected_cop) FROM metrics.v0_cartera_aging)                                           AS cartera_vencida_cop,
  (SELECT count(*) FROM metrics.v0_cartera_aging)                                                    AS hitos_vencidos,
  (SELECT count(*) FROM staging.projects WHERE status='Active')                                      AS proyectos_activos,
  (SELECT count(*) FROM staging.projects WHERE status='Active' AND closing_date::date<current_date)  AS activos_en_regularizacion,
  (SELECT sum(expected_cop) FROM staging.income i JOIN staging.projects p USING (project_code)
     WHERE i.status='Scheduled' AND p.status IN ('Active','Paused'))                                 AS backlog_cop,
  (SELECT sum(payment_amount) FROM staging.contract_payments WHERE adm_validation<>'Paid')           AS pagos_terceros_pend_cop,
  (SELECT count(*) FROM staging.contract_payments WHERE adm_validation<>'Paid')                      AS pagos_terceros_pend_n,
  (SELECT count(*) FROM staging.contract_payments WHERE adm_validation='Paid' AND contractor_legal IS NULL) AS pagos_sin_soporte_n,
  (SELECT round(sum(c.costo)/nullif(sum(i2.acreditado),0)*100,1) FROM
     (SELECT project_code, sum(expected_cop) acreditado FROM staging.income WHERE status='Credited' GROUP BY 1) i2
     JOIN (SELECT project_code_canon project_code, sum(amount) costo FROM staging.v_costs_norm GROUP BY 1) c USING (project_code)
     JOIN staging.projects p USING (project_code) WHERE p.status='Completed')                        AS costo_pct_completados,
  (SELECT round(sum((i.credited_date::date - i.expected_date::date) * i.expected_cop)/nullif(sum(i.expected_cop),0))
     FROM staging.income i WHERE i.status='Credited' AND i.credited_date IS NOT NULL
       AND i.credited_date >= '2022-01-01' AND i.credited_date > current_date - interval '12 months') AS dso_ponderado_dias,
  (SELECT max(finished_at) FROM staging._sync_run)                                                   AS corte;

-- ── DSO por cliente (12 meses móviles, ponderado por monto) ────────────────
CREATE OR REPLACE VIEW metrics.v0_dso_cliente AS
SELECT p.partner_entity AS cliente,
       round(sum((i.credited_date::date - i.expected_date::date) * i.expected_cop)
             / nullif(sum(i.expected_cop),0)) AS dso_dias,
       count(*) AS hitos, sum(i.expected_cop) AS monto_cop
FROM staging.income i JOIN staging.projects p USING (project_code)
WHERE i.status='Credited' AND i.credited_date IS NOT NULL
  AND i.credited_date >= '2022-01-01'
  AND i.credited_date > current_date - interval '12 months'
GROUP BY p.partner_entity;

-- ── Acciones de la semana (top vencidos por monto) ─────────────────────────
CREATE OR REPLACE VIEW metrics.v0_acciones AS
SELECT regla, dueno, project_code, referencia, monto_cop, dias, detalle
FROM metrics.v0_semaforos
WHERE regla IN ('hito_vencido','pago_contratista_vencido')
ORDER BY monto_cop DESC NULLS LAST
LIMIT 5;

-- ── Semáforos agrupados por dueño ──────────────────────────────────────────
CREATE OR REPLACE VIEW metrics.v0_semaforos_dueno AS
SELECT dueno, count(*) AS abiertos, max(dias) AS antiguedad_max, sum(monto_cop) AS monto_cop
FROM metrics.v0_semaforos GROUP BY dueno ORDER BY abiertos DESC;

GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO bi_reader;

-- ── M1 (aprox. F1) · Caja a 13 semanas ─────────────────────────────────────
-- Cobros = hitos no cobrados por semana esperada (los vencidos caen en la semana
-- actual, criterio conservador marcado). Pagos = cronograma no pagado a terceros.
CREATE OR REPLACE VIEW metrics.v0_caja_13s AS
WITH sem AS (
  SELECT gs::date AS semana
  FROM generate_series(date_trunc('week', current_date),
                       date_trunc('week', current_date) + interval '12 weeks',
                       interval '1 week') gs
), cob AS (
  SELECT greatest(date_trunc('week', expected_date)::date,
                  date_trunc('week', current_date)::date) s,
         sum(expected_cop) m
  FROM staging.income WHERE status IN ('Scheduled','Invoiced') GROUP BY 1
), pag AS (
  SELECT greatest(date_trunc('week', payment_date)::date,
                  date_trunc('week', current_date)::date) s,
         sum(payment_amount) m
  FROM staging.contract_payments WHERE adm_validation <> 'Paid' GROUP BY 1
)
SELECT sem.semana,
       COALESCE(c.m, 0) AS cobros_cop,
       COALESCE(p.m, 0) AS pagos_cop,
       sum(COALESCE(c.m,0) - COALESCE(p.m,0)) OVER (ORDER BY sem.semana) AS saldo_cop
FROM sem
LEFT JOIN cob c ON c.s = sem.semana
LEFT JOIN pag p ON p.s = sem.semana
ORDER BY sem.semana;

-- ── Portafolio con semáforo, ejecución y próximo hito ──────────────────────
CREATE OR REPLACE VIEW metrics.v0_portafolio AS
SELECT p.project_code,
       p.partner_entity  AS cliente,
       p.country         AS pais,
       p.service_line    AS linea,
       p.project_manager AS gestora,
       p.status          AS estado,
       p.costing_amount  AS costeo_cop,
       p.closing_date::date AS cierre,
       c.costo           AS causado_cop,
       round(c.costo / nullif(p.costing_amount, 0) * 100, 1) AS ejec_pct,
       h.prox_hito, h.prox_monto,
       COALESCE(v.vencidos_n, 0)  AS vencidos_n,
       COALESCE(v.vencidos_cop,0) AS vencidos_cop,
       CASE WHEN COALESCE(v.vencidos_n,0) > 0 THEN 'critico'
            WHEN p.status = 'Active' AND p.closing_date::date < current_date THEN 'alerta'
            WHEN p.status = 'Active' THEN 'correcto'
            ELSE 'pendiente' END AS semaforo
FROM staging.projects p
LEFT JOIN (SELECT project_code_canon pc, sum(amount) costo
           FROM staging.v_costs_norm GROUP BY 1) c ON c.pc = p.project_code
LEFT JOIN (SELECT project_code, min(expected_date)::date prox_hito,
                  (array_agg(expected_cop ORDER BY expected_date))[1] prox_monto
           FROM staging.income
           WHERE status IN ('Scheduled','Invoiced') AND expected_date::date >= current_date
           GROUP BY 1) h USING (project_code)
LEFT JOIN (SELECT project_code, count(*) vencidos_n, sum(expected_cop) vencidos_cop
           FROM metrics.v0_cartera_aging GROUP BY 1) v USING (project_code);

-- ── Vencimientos de los próximos 7 días (Mi día) ───────────────────────────
CREATE OR REPLACE VIEW metrics.v0_proximos_7d AS
SELECT 'hito_cobro'::text tipo, i.project_code, p.partner_entity contraparte,
       i.expected_date::date fecha, i.expected_cop monto_cop
FROM staging.income i JOIN staging.projects p USING (project_code)
WHERE i.status IN ('Scheduled','Invoiced')
  AND i.expected_date::date BETWEEN current_date AND current_date + 7
UNION ALL
SELECT 'pago_contratista', c.project_code, c.contractor_name,
       cp.payment_date::date, cp.payment_amount
FROM staging.contract_payments cp JOIN staging.contracts c USING (contract_code)
WHERE cp.adm_validation <> 'Paid'
  AND cp.payment_date::date BETWEEN current_date AND current_date + 7
UNION ALL
SELECT 'fin_infraestructura', i.project_code, i.provider,
       i.end_date::date, i.monthly_budget
FROM staging.infra_items i
WHERE i.status = 'ON' AND i.end_date::date BETWEEN current_date AND current_date + 7
ORDER BY fecha;

GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO bi_reader;
