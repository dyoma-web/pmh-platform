-- 0017 · Resúmenes del portafolio por cliente, gestora y país: número de
-- proyectos (activos e históricos), costeo, ingresos acreditados y pendientes
-- (del ledger, con abonos descontados) y distribución por línea de servicio.

CREATE OR REPLACE FUNCTION metrics.resumen_dim(dim text)
RETURNS TABLE (clave text, proyectos bigint, activos bigint, historicos bigint,
               costeo_cop numeric, acreditado_cop numeric, pendiente_cop numeric,
               lineas jsonb)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT CASE dim WHEN 'cliente' THEN cl.name
                    WHEN 'gestora' THEN u.full_name
                    ELSE p.country END AS clave,
           p.id, p.status, p.service_line,
           pa.amount_cop
    FROM core.project p
    LEFT JOIN core.client cl ON cl.id = p.client_id
    LEFT JOIN core.app_user u ON u.id = p.pm_id
    LEFT JOIN LATERAL (SELECT amount_cop FROM core.project_amount
                       WHERE project_id = p.id ORDER BY version DESC LIMIT 1) pa ON true
    WHERE p.kind IN ('project','phase')
  ), fin AS (
    SELECT b.clave,
           count(*) proyectos,
           count(*) FILTER (WHERE b.status = 'active') activos,
           count(*) FILTER (WHERE b.status = 'completed') historicos,
           sum(b.amount_cop) costeo,
           sum(led.acreditado) acreditado,
           sum(pend.saldo) pendiente
    FROM base b
    LEFT JOIN LATERAL (SELECT sum(amount_cop) acreditado FROM ledger.money_event
                       WHERE project_id = b.id AND kind = 'revenue_credit') led ON true
    LEFT JOIN LATERAL (SELECT sum(r.saldo_cop) saldo FROM revenue.milestone m
                       JOIN revenue.v_milestone_recibido r ON r.milestone_id = m.id
                       WHERE m.project_id = b.id
                         AND m.state IN ('scheduled','invoiced','partial')) pend ON true
    GROUP BY b.clave
  ), lin AS (
    SELECT clave, jsonb_object_agg(service_line, n ORDER BY n DESC) lineas
    FROM (SELECT clave, service_line, count(*) n FROM base
          WHERE service_line IS NOT NULL GROUP BY clave, service_line) x
    GROUP BY clave
  )
  SELECT f.clave, f.proyectos, f.activos, f.historicos,
         coalesce(f.costeo,0), coalesce(f.acreditado,0), coalesce(f.pendiente,0),
         coalesce(l.lineas, '{}'::jsonb)
  FROM fin f LEFT JOIN lin l USING (clave)
  WHERE f.clave IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION metrics.resumen_dim(text) TO app_rw, bi_reader;
