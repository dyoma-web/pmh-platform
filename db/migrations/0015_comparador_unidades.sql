-- 0015 · Comparador: unidades saneadas. La fuente trae a veces números o vacíos
-- en la columna de unidad ("5", "10"); esos no son unidades — se tratan como
-- «sin especificar» para no fabricar subgrupos falsos ni comparaciones engañosas.

DROP VIEW metrics.v2_comparador;
CREATE VIEW metrics.v2_comparador AS
WITH s AS (
    SELECT s.*,
           CASE WHEN s.unit IS NULL OR trim(s.unit) = '' OR trim(s.unit) ~ '^[0-9.,]+$'
                THEN NULL ELSE initcap(lower(trim(s.unit))) END AS unit_limpia,
           hr.contractor_id, hr.state
    FROM procurement.request_service s
    JOIN procurement.hiring_request hr ON hr.code = s.request_code
)
SELECT s.ihpsc_group,
       ct.id contractor_id, ct.display_name,
       count(*)                    AS lineas,
       round(avg(s.unit_price))    AS precio_prom,
       min(s.unit_price)           AS precio_min,
       max(s.unit_price)           AS precio_max,
       sum(s.total)                AS monto_total,
       mode() WITHIN GROUP (ORDER BY s.unit_limpia) AS unidad_comun,
       count(DISTINCT s.unit_limpia) AS unidades_distintas,
       ev.eval_promedio, ev.rondas_prom, ev.desviacion_prom,
       round(100.0 * avg(s.unit_price) /
             nullif(avg(avg(s.unit_price)) OVER (PARTITION BY s.ihpsc_group), 0) - 100, 1)
         AS vs_promedio_pct
FROM s
JOIN procurement.contractor ct ON ct.id = s.contractor_id
LEFT JOIN LATERAL (
    SELECT round(avg((q_calidad+q_fechas+q_comunicacion+q_autonomia)/4.0),1) eval_promedio,
           round(avg(rondas_ajustes),1) rondas_prom,
           round(avg(desviacion_dias),1) desviacion_prom
    FROM procurement.contractor_review WHERE contractor_id = ct.id) ev ON true
WHERE s.ihpsc_group IS NOT NULL AND s.state = 'processed'
GROUP BY s.ihpsc_group, ct.id, ct.display_name,
         ev.eval_promedio, ev.rondas_prom, ev.desviacion_prom;

GRANT SELECT ON metrics.v2_comparador TO app_rw;
