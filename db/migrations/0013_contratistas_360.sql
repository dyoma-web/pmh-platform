-- 0013 · E1 — Expediente 360 del contratista + comparador por producto.
-- Evaluaciones y comparador: SOLO gestoras/administración (el portal jamás los
-- consulta; sus APIs no tocan estas tablas). Escala: 4 criterios 1-5 (5=mejor),
-- rondas_ajustes entero (menos=mejor), desviacion_dias (negativo=antes de tiempo)
-- — estáticos hoy (los captura la gestora al evaluar), dinámicos cuando la
-- ejecución de proyectos alimente entregas y rondas reales.

ALTER TABLE procurement.contractor
    ADD COLUMN kind text NOT NULL DEFAULT 'natural' CHECK (kind IN ('natural','juridica')),
    ADD COLUMN relation_state text NOT NULL DEFAULT 'activo'
        CHECK (relation_state IN ('en_vinculacion','activo','inactivo','no_elegible'));
UPDATE procurement.contractor SET kind='juridica'
 WHERE company_name IS NOT NULL OR id_type = 'NIT';

-- Evaluación por contrato cerrado (única, escrita como hechos)
CREATE TABLE procurement.contractor_review (
    contract_code  text PRIMARY KEY REFERENCES procurement.contract,
    contractor_id  bigint NOT NULL REFERENCES procurement.contractor,
    q_calidad      int NOT NULL CHECK (q_calidad BETWEEN 1 AND 5),
    q_fechas       int NOT NULL CHECK (q_fechas BETWEEN 1 AND 5),
    q_comunicacion int NOT NULL CHECK (q_comunicacion BETWEEN 1 AND 5),
    q_autonomia    int NOT NULL CHECK (q_autonomia BETWEEN 1 AND 5),
    rondas_ajustes int CHECK (rondas_ajustes >= 0),
    desviacion_dias int,
    hecho          text NOT NULL,     -- un hecho verificable, no un juicio
    autor_id       bigint NOT NULL REFERENCES core.app_user,
    creado_en      timestamptz NOT NULL DEFAULT now()
);

-- Expediente documental con VIGENCIAS (no basta con que exista)
CREATE TABLE procurement.contractor_document (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contractor_id bigint NOT NULL REFERENCES procurement.contractor,
    tipo          text NOT NULL CHECK (tipo IN
                    ('rut','cert_bancaria','autorizacion_1581','seguridad_social','certificacion')),
    periodo       date,               -- mes (seguridad_social) o año (rut)
    vigente_hasta date,
    url           text NOT NULL,
    subido_por    text NOT NULL,      -- usuario interno o 'portal'
    creado_en     timestamptz NOT NULL DEFAULT now()
);

-- Bitácora de relación (solo insertar)
CREATE TABLE procurement.contractor_note (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contractor_id bigint NOT NULL REFERENCES procurement.contractor,
    nota          text NOT NULL,
    autor_id      bigint NOT NULL REFERENCES core.app_user,
    creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER nota_inmutable BEFORE UPDATE OR DELETE ON procurement.contractor_note
    FOR EACH ROW EXECUTE FUNCTION audit.no_touch();

-- Grupo IHPSC en líneas de servicio → habilita el comparador de precios
ALTER TABLE procurement.request_service ADD COLUMN ihpsc_group text;

GRANT SELECT, INSERT, UPDATE ON procurement.contractor_review,
    procurement.contractor_document TO app_rw;
GRANT SELECT, INSERT ON procurement.contractor_note TO app_rw;

-- ── Expediente 360: todo calculado, nada digitado ──────────────────────────
CREATE OR REPLACE VIEW metrics.v2_contratista_360 AS
SELECT c.id, c.display_name, c.kind, c.relation_state, c.profile,
       coalesce(pg.percibido, 0)  AS percibido_cop,
       coalesce(pg.pendiente, 0)  AS pendiente_cop,
       coalesce(k.activos, 0)     AS contratos_activos,
       coalesce(k.total, 0)       AS contratos_total,
       round(100.0 * coalesce(pg.percibido,0) /
             nullif((SELECT sum(amount_cop) FROM ledger.money_event
                     WHERE kind='contractor_payment'),0), 1) AS concentracion_pct,
       pg.dso_pago_dias,
       ga.actuales   AS gestoras_actuales,
       ga.historicas AS gestoras_historicas,
       ev.promedio   AS eval_promedio,
       ev.n          AS evaluaciones,
       ev.rondas_prom, ev.desviacion_prom,
       docs.vigentes AS docs_vigentes,
       docs.vencidos AS docs_vencidos,
       (SELECT count(*) FROM procurement.contract kk
        WHERE kk.contractor_id=c.id AND kk.state='finished'
          AND NOT EXISTS (SELECT 1 FROM procurement.contractor_review r
                          WHERE r.contract_code=kk.code)) AS evaluaciones_pendientes
FROM procurement.contractor c
LEFT JOIN LATERAL (
    SELECT sum(cp.amount) FILTER (WHERE cp.adm_validated_at IS NOT NULL) percibido,
           sum(cp.amount) FILTER (WHERE cp.adm_validated_at IS NULL AND cp.cancelled_at IS NULL) pendiente,
           round(avg(cp.adm_validated_at - cp.due_date)
                 FILTER (WHERE cp.adm_validated_at IS NOT NULL)) dso_pago_dias
    FROM procurement.contract_payment cp
    JOIN procurement.contract k ON k.code = cp.contract_code
    WHERE k.contractor_id = c.id) pg ON true
LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE state='active') activos, count(*) total
    FROM procurement.contract WHERE contractor_id = c.id) k ON true
LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT u.full_name) FILTER (WHERE k.state='active')  actuales,
           array_agg(DISTINCT u.full_name) FILTER (WHERE k.state<>'active') historicas
    FROM procurement.contract k
    LEFT JOIN core.app_user u ON u.id = k.overseer_id
    WHERE k.contractor_id = c.id AND u.full_name IS NOT NULL) ga ON true
LEFT JOIN LATERAL (
    SELECT round(avg((q_calidad+q_fechas+q_comunicacion+q_autonomia)/4.0),1) promedio,
           count(*) n, round(avg(rondas_ajustes),1) rondas_prom,
           round(avg(desviacion_dias),1) desviacion_prom
    FROM procurement.contractor_review WHERE contractor_id = c.id) ev ON true
LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE vigente_hasta IS NULL OR vigente_hasta >= current_date) vigentes,
           count(*) FILTER (WHERE vigente_hasta < current_date) vencidos
    FROM procurement.contractor_document WHERE contractor_id = c.id) docs ON true;
GRANT SELECT ON metrics.v2_contratista_360 TO app_rw;

-- ── Comparador por producto: quién cobra más/menos, quién rinde ────────────
CREATE OR REPLACE VIEW metrics.v2_comparador AS
SELECT s.ihpsc_group,
       ct.id contractor_id, ct.display_name,
       count(*)                    AS lineas,
       round(avg(s.unit_price))    AS precio_prom,
       min(s.unit_price)           AS precio_min,
       max(s.unit_price)           AS precio_max,
       sum(s.total)                AS monto_total,
       ev.eval_promedio, ev.rondas_prom, ev.desviacion_prom,
       round(100.0 * avg(s.unit_price) /
             nullif(avg(avg(s.unit_price)) OVER (PARTITION BY s.ihpsc_group), 0) - 100, 1)
         AS vs_promedio_pct        -- + = más caro que el promedio del grupo
FROM procurement.request_service s
JOIN procurement.hiring_request hr ON hr.code = s.request_code
JOIN procurement.contractor ct ON ct.id = hr.contractor_id
LEFT JOIN LATERAL (
    SELECT round(avg((q_calidad+q_fechas+q_comunicacion+q_autonomia)/4.0),1) eval_promedio,
           round(avg(rondas_ajustes),1) rondas_prom,
           round(avg(desviacion_dias),1) desviacion_prom
    FROM procurement.contractor_review WHERE contractor_id = ct.id) ev ON true
WHERE s.ihpsc_group IS NOT NULL AND hr.state = 'processed'
GROUP BY s.ihpsc_group, ct.id, ct.display_name,
         ev.eval_promedio, ev.rondas_prom, ev.desviacion_prom;
GRANT SELECT ON metrics.v2_comparador TO app_rw;

-- ── Nueva regla de semáforo: evaluación pendiente al cerrar contrato ───────
CREATE OR REPLACE VIEW metrics.v2_semaforos_extra AS
SELECT 'evaluacion_pendiente'::text regla, 'pendiente'::text severidad,
       'Gestora: ' || coalesce(u.full_name,'—') dueno,
       p.code project_code, k.code referencia, k.amount monto_cop,
       (current_date - k.end_date) dias,
       'Contrato con ' || ct.display_name || ' terminó sin evaluación del servicio' detalle
FROM procurement.contract k
JOIN procurement.contractor ct ON ct.id = k.contractor_id
JOIN core.project p ON p.id = k.project_id
LEFT JOIN core.app_user u ON u.id = k.overseer_id
WHERE k.state = 'finished'
  AND NOT EXISTS (SELECT 1 FROM procurement.contractor_review r WHERE r.contract_code = k.code);
GRANT SELECT ON metrics.v2_semaforos_extra TO app_rw, bi_reader;
