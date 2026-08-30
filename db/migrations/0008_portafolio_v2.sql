-- 0008 · Portafolio v2: la vista del front sobre el núcleo transaccional.
-- Mantiene los nombres de columna de v0 para el cambio de fuente sin fricción.

CREATE OR REPLACE VIEW metrics.v2_portafolio AS
SELECT p.code            AS project_code,
       p.display_code,
       p.kind,
       cl.name           AS cliente,
       p.country         AS pais,
       p.service_line    AS linea,
       ges.full_name     AS gestora,
       p.status          AS estado,
       pa.amount_cop     AS costeo_cop,
       p.closing_date    AS cierre,
       led.causado       AS causado_cop,
       round(led.causado / nullif(pa.amount_cop, 0) * 100, 1) AS ejec_pct,
       h.prox_hito, h.prox_monto,
       coalesce(v.vencidos_n, 0)  AS vencidos_n,
       coalesce(v.vencidos_cop, 0) AS vencidos_cop,
       CASE WHEN coalesce(v.vencidos_n, 0) > 0 THEN 'critico'
            WHEN p.status = 'active' AND p.closing_date < current_date THEN 'alerta'
            WHEN p.status = 'active' THEN 'correcto'
            ELSE 'pendiente' END AS semaforo
FROM core.project p
LEFT JOIN core.client cl  ON cl.id = p.client_id
LEFT JOIN core.app_user ges ON ges.id = p.pm_id
LEFT JOIN LATERAL (SELECT amount_cop FROM core.project_amount
                   WHERE project_id = p.id ORDER BY version DESC LIMIT 1) pa ON true
LEFT JOIN LATERAL (SELECT sum(amount_cop) causado FROM ledger.money_event
                   WHERE project_id = p.id AND kind = 'gl_accrual') led ON true
LEFT JOIN LATERAL (SELECT min(expected_date) prox_hito,
                          (array_agg(amount_cop ORDER BY expected_date))[1] prox_monto
                   FROM revenue.milestone
                   WHERE project_id = p.id AND state IN ('scheduled','invoiced','partial')
                     AND expected_date >= current_date) h ON true
LEFT JOIN LATERAL (SELECT count(*) vencidos_n, sum(r.saldo_cop) vencidos_cop
                   FROM revenue.milestone m
                   JOIN revenue.v_milestone_recibido r ON r.milestone_id = m.id
                   WHERE m.project_id = p.id AND m.state IN ('scheduled','invoiced','partial')
                     AND m.expected_date < current_date) v ON true
WHERE p.kind IN ('project', 'phase');

GRANT SELECT ON metrics.v2_portafolio TO bi_reader, app_rw;
