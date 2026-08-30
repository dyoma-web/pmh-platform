-- 0011 · F7 — métricas v2: la capa de decisión completa sobre el núcleo
-- transaccional. Los saldos descuentan abonos, la caja usa el forecast cuando
-- existe (el aging NO), y cada semáforo trae dueño con nombre y acción.

-- ── Cartera con saldos (los abonos parciales descuentan) ───────────────────
CREATE OR REPLACE VIEW metrics.v2_cartera_aging AS
SELECT m.id AS hito_id, p.code AS project_code, cl.name AS cliente,
       pm.full_name AS partner_manager, ges.full_name AS project_manager,
       m.state, m.expected_date, m.forecast_date, m.invoice_date, m.invoice_number,
       m.amount_cop, r.recibido_cop, r.saldo_cop,
       (current_date - m.expected_date) AS dias_vencido,
       CASE WHEN current_date - m.expected_date <= 30 THEN '01-30'
            WHEN current_date - m.expected_date <= 60 THEN '31-60'
            WHEN current_date - m.expected_date <= 90 THEN '61-90'
            ELSE '+90' END AS tramo
FROM revenue.milestone m
JOIN revenue.v_milestone_recibido r ON r.milestone_id = m.id
JOIN core.project p ON p.id = m.project_id
LEFT JOIN core.client cl ON cl.id = p.client_id
LEFT JOIN core.app_user pm ON pm.id = p.partner_manager_id
LEFT JOIN core.app_user ges ON ges.id = p.pm_id
WHERE m.state IN ('scheduled','invoiced','partial')
  AND m.expected_date < current_date;

CREATE OR REPLACE VIEW metrics.v2_cartera_resumen AS
SELECT cliente, partner_manager, tramo, count(*) hitos, sum(saldo_cop) monto_cop
FROM metrics.v2_cartera_aging GROUP BY 1,2,3;

CREATE OR REPLACE VIEW metrics.v2_dso_cliente AS
SELECT cl.name AS cliente,
       round(sum((m.credited_date - m.expected_date) * m.amount_cop)
             / nullif(sum(m.amount_cop),0)) AS dso_dias,
       count(*) hitos, sum(m.amount_cop) monto_cop
FROM revenue.milestone m
JOIN core.project p ON p.id = m.project_id
LEFT JOIN core.client cl ON cl.id = p.client_id
WHERE m.state = 'credited' AND m.credited_date >= '2022-01-01'
  AND m.credited_date > current_date - interval '12 months'
GROUP BY cl.name;

-- ── Semáforos-tarea v2: dueño con nombre, siete reglas ─────────────────────
CREATE OR REPLACE VIEW metrics.v2_semaforos AS
SELECT 'hito_vencido'::text regla, 'critico'::text severidad,
       'Partner manager: ' || coalesce(a.partner_manager,'sin asignar') dueno,
       a.project_code, a.hito_id::text referencia, a.saldo_cop monto_cop,
       a.dias_vencido dias,
       'Hito ' || CASE a.state WHEN 'invoiced' THEN 'facturado' WHEN 'partial' THEN 'abonado parcial' ELSE 'programado' END
         || ' vencido hace ' || a.dias_vencido || ' días' detalle
FROM metrics.v2_cartera_aging a
UNION ALL
SELECT 'pago_contratista_vencido','critico',
       'Administración + ' || coalesce(u.full_name,'—'),
       p.code, cp.id::text, cp.amount, (current_date - cp.due_date),
       'Pago a ' || ct.display_name || ' vencido (' || c.code || ')'
FROM procurement.contract_payment cp
JOIN procurement.contract c ON c.code = cp.contract_code
JOIN procurement.contractor ct ON ct.id = c.contractor_id
JOIN core.project p ON p.id = c.project_id
LEFT JOIN core.app_user u ON u.id = c.overseer_id
WHERE cp.adm_validated_at IS NULL AND cp.cancelled_at IS NULL
  AND cp.due_date < current_date
UNION ALL
SELECT 'pago_bloqueado_documentos','alerta','Administración',
       p.code, cp.id::text, cp.amount, (current_date - cp.due_date),
       'Pago de ' || c.code || ' sin ' ||
       CASE WHEN cp.invoice_url IS NULL AND cp.legal_support_url IS NULL THEN 'cuenta de cobro ni soporte'
            WHEN cp.invoice_url IS NULL THEN 'cuenta de cobro' ELSE 'soporte de seguridad social' END
FROM procurement.contract_payment cp
JOIN procurement.contract c ON c.code = cp.contract_code
JOIN core.project p ON p.id = c.project_id
WHERE cp.adm_validated_at IS NULL AND cp.cancelled_at IS NULL
  AND (cp.invoice_url IS NULL OR cp.legal_support_url IS NULL)
  AND cp.due_date <= current_date + 7
UNION ALL
SELECT 'pago_sin_soporte_legal','alerta','Administración',
       p.code, cp.id::text, cp.amount, NULL,
       'Pago legado hecho sin soporte legal (' || c.code || ')'
FROM procurement.contract_payment cp
JOIN procurement.contract c ON c.code = cp.contract_code
JOIN core.project p ON p.id = c.project_id
WHERE cp.legacy_exception
UNION ALL
SELECT 'proyecto_activo_cierre_vencido','alerta',
       'Gestora: ' || coalesce(u.full_name,'sin asignar'),
       p.code, p.code, pa.amount_cop, (current_date - p.closing_date),
       'Activo con cierre ' || to_char(p.closing_date,'DD Mon YYYY') || ': prorrogar o cerrar'
FROM core.project p
LEFT JOIN core.app_user u ON u.id = p.pm_id
LEFT JOIN LATERAL (SELECT amount_cop FROM core.project_amount
                   WHERE project_id = p.id ORDER BY version DESC LIMIT 1) pa ON true
WHERE p.status='active' AND p.kind IN ('project','phase') AND p.closing_date < current_date
UNION ALL
SELECT 'contrato_por_vencer','pendiente',
       'Gestora: ' || coalesce(u.full_name,'—'),
       p.code, c.code, c.amount, (c.end_date - current_date),
       'Contrato con ' || ct.display_name || ' vence el ' || to_char(c.end_date,'DD Mon') ||
       ' (' || (c.end_date - current_date) || ' días)'
FROM procurement.contract c
JOIN procurement.contractor ct ON ct.id = c.contractor_id
JOIN core.project p ON p.id = c.project_id
LEFT JOIN core.app_user u ON u.id = c.overseer_id
WHERE c.state='active' AND c.end_date BETWEEN current_date AND current_date + 30
UNION ALL
SELECT 'infra_on_vencida','pendiente','Infraestructura',
       coalesce(p.code,'corporativo'), i.legacy_id, i.monthly_budget,
       (current_date - i.end_date),
       i.concept || ' (' || i.provider || ') encendida con fin ' || to_char(i.end_date,'DD Mon YYYY')
FROM infra.item i
LEFT JOIN core.project p ON p.id = i.project_id
WHERE i.status='on' AND i.end_date < current_date;

CREATE OR REPLACE VIEW metrics.v2_semaforos_dueno AS
SELECT dueno, count(*) abiertos, max(dias) antiguedad_max, sum(monto_cop) monto_cop
FROM metrics.v2_semaforos GROUP BY dueno ORDER BY abiertos DESC;

CREATE OR REPLACE VIEW metrics.v2_acciones AS
SELECT * FROM metrics.v2_semaforos
WHERE regla IN ('hito_vencido','pago_contratista_vencido')
ORDER BY monto_cop DESC NULLS LAST LIMIT 5;

-- ── KPIs del cockpit v2 ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW metrics.v2_kpis AS
SELECT
  (SELECT sum(r.saldo_cop) FROM revenue.milestone m
     JOIN revenue.v_milestone_recibido r ON r.milestone_id=m.id
     WHERE m.state IN ('scheduled','invoiced','partial'))                      AS cartera_pendiente_cop,
  (SELECT sum(saldo_cop) FROM metrics.v2_cartera_aging)                        AS cartera_vencida_cop,
  (SELECT count(*) FROM metrics.v2_cartera_aging)                              AS hitos_vencidos,
  (SELECT count(*) FROM core.project WHERE status='active' AND kind IN ('project','phase')) AS proyectos_activos,
  (SELECT count(*) FROM core.project WHERE status='active' AND kind IN ('project','phase')
     AND closing_date < current_date)                                          AS activos_en_regularizacion,
  (SELECT sum(r.saldo_cop) FROM revenue.milestone m
     JOIN revenue.v_milestone_recibido r ON r.milestone_id=m.id
     JOIN core.project p ON p.id=m.project_id
     WHERE m.state='scheduled' AND p.status IN ('active','paused'))            AS backlog_cop,
  (SELECT sum(amount) FROM procurement.contract_payment
     WHERE adm_validated_at IS NULL AND cancelled_at IS NULL)                  AS pagos_terceros_pend_cop,
  (SELECT count(*) FROM procurement.contract_payment
     WHERE adm_validated_at IS NULL AND cancelled_at IS NULL)                  AS pagos_terceros_pend_n,
  (SELECT count(*) FROM procurement.contract_payment WHERE legacy_exception)   AS pagos_sin_soporte_n,
  (SELECT round(sum(causado_cop)/nullif(sum(acreditado_cop),0)*100,1)
     FROM metrics.v1_resultado_proyecto
     WHERE status='completed' AND kind='project')                              AS costo_pct_completados,
  (SELECT round(sum((credited_date-expected_date)*amount_cop)/nullif(sum(amount_cop),0))
     FROM revenue.milestone WHERE state='credited' AND credited_date >= '2022-01-01'
       AND credited_date > current_date - interval '12 months')                AS dso_ponderado_dias,
  (SELECT max(month) FROM ledger.period WHERE sealed_at IS NOT NULL)           AS ultimo_mes_sellado,
  now()                                                                        AS corte;

-- ── Caja 13 semanas v2: los cobros usan el forecast cuando existe ──────────
CREATE OR REPLACE VIEW metrics.v2_caja_13s AS
WITH sem AS (
  SELECT gs::date semana FROM generate_series(date_trunc('week', current_date),
    date_trunc('week', current_date) + interval '12 weeks', interval '1 week') gs
), cob AS (
  SELECT greatest(date_trunc('week', coalesce(m.forecast_date, m.expected_date))::date,
                  date_trunc('week', current_date)::date) s,
         sum(r.saldo_cop) m
  FROM revenue.milestone m JOIN revenue.v_milestone_recibido r ON r.milestone_id=m.id
  WHERE m.state IN ('scheduled','invoiced','partial') GROUP BY 1
), pag AS (
  SELECT greatest(date_trunc('week', due_date)::date, date_trunc('week', current_date)::date) s,
         sum(amount) m
  FROM procurement.contract_payment
  WHERE adm_validated_at IS NULL AND cancelled_at IS NULL GROUP BY 1
)
SELECT sem.semana, coalesce(c.m,0) cobros_cop, coalesce(p.m,0) pagos_cop,
       sum(coalesce(c.m,0)-coalesce(p.m,0)) OVER (ORDER BY sem.semana) saldo_cop
FROM sem LEFT JOIN cob c ON c.s=sem.semana LEFT JOIN pag p ON p.s=sem.semana
ORDER BY sem.semana;

-- ── Vence en 7 días v2 ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW metrics.v2_proximos_7d AS
SELECT 'hito_cobro'::text tipo, p.code project_code, cl.name contraparte,
       coalesce(m.forecast_date, m.expected_date) fecha, r.saldo_cop monto_cop
FROM revenue.milestone m
JOIN revenue.v_milestone_recibido r ON r.milestone_id=m.id
JOIN core.project p ON p.id=m.project_id
LEFT JOIN core.client cl ON cl.id=p.client_id
WHERE m.state IN ('scheduled','invoiced','partial')
  AND coalesce(m.forecast_date, m.expected_date) BETWEEN current_date AND current_date+7
UNION ALL
SELECT 'pago_contratista', p.code, ct.display_name, cp.due_date, cp.amount
FROM procurement.contract_payment cp
JOIN procurement.contract c ON c.code=cp.contract_code
JOIN procurement.contractor ct ON ct.id=c.contractor_id
JOIN core.project p ON p.id=c.project_id
WHERE cp.adm_validated_at IS NULL AND cp.cancelled_at IS NULL
  AND cp.due_date BETWEEN current_date AND current_date+7
UNION ALL
SELECT 'fin_contrato', p.code, ct.display_name, c.end_date, c.amount
FROM procurement.contract c
JOIN procurement.contractor ct ON ct.id=c.contractor_id
JOIN core.project p ON p.id=c.project_id
WHERE c.state='active' AND c.end_date BETWEEN current_date AND current_date+7
UNION ALL
SELECT 'fin_infraestructura', coalesce(p.code,'corporativo'), i.provider, i.end_date, i.monthly_budget
FROM infra.item i LEFT JOIN core.project p ON p.id=i.project_id
WHERE i.status='on' AND i.end_date BETWEEN current_date AND current_date+7
ORDER BY fecha;

GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO bi_reader;
