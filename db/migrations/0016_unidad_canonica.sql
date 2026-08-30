-- 0016 · Unidad canónica: la fuente trae en la columna «unidad» desde números
-- hasta párrafos enteros de alcance. Esta función extrae la unidad real cuando
-- es reconocible ('Ovas Virtualizados', '7 Objetos Virtuales…' → OVA) y descarta
-- lo que no es una unidad (párrafos, números) → «sin especificar».
-- Es el puente honesto hasta que presupuestación capture unidad y alcance aparte.

CREATE OR REPLACE FUNCTION metrics.unidad_canonica(u text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t IS NULL OR t = '' OR t ~ '^[0-9.,¡!¿?()\s]*$' THEN NULL
    WHEN t ~ 'uma|unidad(es)? m[ií]nima'          THEN 'UMA'
    WHEN t ~ 'ova|objeto virtual'                 THEN 'OVA'
    WHEN t ~ 'slide|diapositiva|lámina|lamina'    THEN 'Slide'
    WHEN t ~ 'minut'                              THEN 'Minuto'
    WHEN t ~ 'segundo'                            THEN 'Segundo'
    WHEN t ~ 'video|vídeo'                        THEN 'Video'
    WHEN t ~ 'd[ií]as?([^a-z]|$)'                 THEN 'Día'
    WHEN t ~ 'horas?([^a-z]|$)'                   THEN 'Hora'
    WHEN t ~ 'm[oó]dulo'                          THEN 'Módulo'
    WHEN t ~ 'cursos?([^a-z]|$)'                  THEN 'Curso'
    WHEN t ~ 'palabras?([^a-z]|$)'                THEN 'Palabra'
    WHEN t ~ 'p[aá]ginas?([^a-z]|$)'              THEN 'Página'
    WHEN t ~ 'ilustraci|dibujo'                   THEN 'Ilustración'
    WHEN t ~ 'infograf'                           THEN 'Infografía'
    WHEN t ~ 'animaci'                            THEN 'Animación'
    WHEN t ~ 'podcast|episodio'                   THEN 'Episodio'
    WHEN t ~ 'sesi[oó]n|jornada|taller'           THEN 'Sesión'
    WHEN t ~ 'entregables?([^a-z]|$)|documentos?([^a-z]|$)|informes?([^a-z]|$)' THEN 'Documento'
    WHEN t ~ 'piezas?([^a-z]|$)|paquete|kit'      THEN 'Pieza/paquete'
    WHEN t ~ 'personaje|avatar'                   THEN 'Personaje'
    WHEN t ~ 'storyboard|guion|guión'             THEN 'Guion/storyboard'
    WHEN length(t) <= 22                          THEN initcap(t)
    ELSE NULL   -- un párrafo de alcance no es una unidad
  END
  FROM (SELECT nullif(regexp_replace(lower(trim(coalesce(u, ''))),
                                     '^[0-9.,]+\s*', ''), '') AS t) x
$$;

DROP VIEW metrics.v2_comparador;
CREATE VIEW metrics.v2_comparador AS
WITH s AS (
    SELECT s.*, metrics.unidad_canonica(s.unit) AS unit_limpia,
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
