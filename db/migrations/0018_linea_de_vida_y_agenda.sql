-- 0018 · Línea de vida y agenda.
-- Un solo modelo de EVENTOS (metrics.v2_eventos) del que se dibujan el calendario
-- (día/semana/mes/año), la línea de vida de cada contrato y de cada proyecto.
-- Reglas (docs/09):
--   · Un evento = hecho con fecha_plan y/o fecha_real, familia y dueño. Al calendario
--     solo van los que alguien debe hacer (pendiente/vencido); lo ocurrido va a la línea.
--   · Lo histórico sin fecha se muestra «no_registrado»; nunca se inventa.
--   · Línea base del sobrecosto = monto del contrato al firmarlo (antes del primer
--     otrosí de monto).

-- ── 1. Fechas de proceso que faltaban ──────────────────────────────────────
ALTER TABLE procurement.hiring_request ADD COLUMN created_at timestamptz;
ALTER TABLE procurement.hiring_request ALTER COLUMN created_at SET DEFAULT now();
UPDATE procurement.hiring_request hr SET created_at = e.at
  FROM audit.event_log e
 WHERE e.entity = 'hiring_request' AND e.entity_id = hr.code AND e.action = 'solicitud.crear';

ALTER TABLE procurement.contract
    ADD COLUMN drafted_at           date,     -- solicitud (borrador) creada
    ADD COLUMN issued_at            date,     -- contrato emitido
    ADD COLUMN signed_internal_at   date,     -- firma InnovaHub
    ADD COLUMN signed_internal_by   bigint REFERENCES core.app_user,
    ADD COLUMN signed_contractor_at date,     -- firma del contratista
    ADD COLUMN base_amount          numeric(18,2);   -- línea base del sobrecosto

UPDATE procurement.contract k SET issued_at = e.at::date
  FROM audit.event_log e
 WHERE e.entity = 'contract' AND e.entity_id = k.code AND e.action = 'contrato.crear';
UPDATE procurement.contract k SET drafted_at = hr.created_at::date
  FROM procurement.hiring_request hr
 WHERE hr.code = k.hiring_request_code AND hr.created_at IS NOT NULL;
UPDATE procurement.contract k SET base_amount = coalesce(
  (SELECT (e.after->>'monto_anterior')::numeric
     FROM procurement.contract_amendment a
     JOIN audit.event_log e ON e.entity = 'contract_amendment'
                           AND e.entity_id = a.id::text AND e.action = 'otrosi.aprobar'
    WHERE a.contract_code = k.code AND a.effect = 'monto' AND a.state = 'approved'
    ORDER BY a.resolved_at LIMIT 1),
  k.amount);
ALTER TABLE procurement.contract ALTER COLUMN base_amount SET NOT NULL;

-- Cuenta de cobro: cuándo la envió el contratista (hoy solo había la URL)
ALTER TABLE procurement.contract_payment ADD COLUMN submitted_at date;
UPDATE procurement.contract_payment cp SET submitted_at = x.d
  FROM (SELECT entity_id, min(at)::date d FROM audit.event_log
         WHERE entity = 'contract_payment' AND action = 'portal.subir_cuenta' GROUP BY 1) x
 WHERE x.entity_id = cp.id::text;

-- Proyecto: cuándo se cargaron contrato y documentación
ALTER TABLE core.project ADD COLUMN docs_uploaded_at date;

-- Otrosí de plazo (mueve la fecha de fin del contrato; deja el fantasma de la anterior)
ALTER TABLE procurement.contract_amendment DROP CONSTRAINT contract_amendment_effect_check;
ALTER TABLE procurement.contract_amendment
    ADD CONSTRAINT contract_amendment_effect_check
    CHECK (effect IN ('monto','fechas','plazo','alcance','anulacion'));

-- ── 2. Entregas por contrato (entregado ≠ aprobado; rondas pactadas vs usadas) ──
CREATE TABLE procurement.contract_deliverable (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contract_code      text NOT NULL REFERENCES procurement.contract ON DELETE RESTRICT,
    request_service_id text REFERENCES procurement.request_service,  -- línea de servicio/producto origen
    description        text NOT NULL,
    ihpsc_group        text,
    due_date           date NOT NULL,
    first_delivered_at date,                 -- primera entrega (plan vs real)
    delivered_at       date,                 -- última entrega (tras ajustes)
    approved_at        date,
    approved_by        bigint REFERENCES core.app_user,
    rounds_agreed      int NOT NULL DEFAULT 1 CHECK (rounds_agreed >= 0),
    rounds_used        int NOT NULL DEFAULT 0 CHECK (rounds_used >= 0),
    returned_reason    text,
    created_by         text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz,
    CHECK (approved_at IS NULL OR delivered_at IS NOT NULL),
    CHECK (delivered_at IS NULL OR first_delivered_at IS NOT NULL)
);
CREATE INDEX ON procurement.contract_deliverable (contract_code);
GRANT SELECT, INSERT, UPDATE ON procurement.contract_deliverable TO app_rw;

-- Plan de entregas heredado de las solicitudes ya procesadas (solo el PLAN; la
-- entrega real de los contratos históricos queda «no registrada»).
INSERT INTO procurement.contract_deliverable
    (contract_code, request_service_id, description, ihpsc_group, due_date, created_by)
SELECT k.code, s.legacy_id,
       left(coalesce(nullif(trim(s.deliverable), ''), nullif(trim(s.description), ''), 'Entregable'), 200),
       s.ihpsc_group, coalesce(s.due_date, k.end_date), 'migración 0018'
  FROM procurement.contract k
  JOIN procurement.request_service s ON s.request_code = k.hiring_request_code
 WHERE coalesce(s.due_date, k.end_date) IS NOT NULL;

-- ── 3. Documentos obligatorios por tipo de contratista (→ «expediente completo») ──
CREATE TABLE procurement.required_document (
    tipo text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('natural','juridica')),
    PRIMARY KEY (tipo, kind)
);
INSERT INTO procurement.required_document VALUES
    ('rut','natural'), ('cert_bancaria','natural'), ('autorizacion_1581','natural'), ('seguridad_social','natural'),
    ('rut','juridica'), ('cert_bancaria','juridica'), ('autorizacion_1581','juridica'), ('seguridad_social','juridica');
GRANT SELECT, INSERT, DELETE ON procurement.required_document TO app_rw;

-- ── 4. Bitácora de cambios del proyecto (fechas, estado): la historia, no solo el valor ──
CREATE TABLE core.project_change (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id bigint NOT NULL REFERENCES core.project ON DELETE RESTRICT,
    at         timestamptz NOT NULL DEFAULT now(),
    actor      text NOT NULL,
    field      text NOT NULL,
    old_value  text,
    new_value  text
);
CREATE INDEX ON core.project_change (project_id);
GRANT SELECT ON core.project_change TO app_rw;
CREATE TRIGGER project_change_inmutable BEFORE UPDATE OR DELETE ON core.project_change
    FOR EACH ROW EXECUTE FUNCTION audit.no_touch();

CREATE OR REPLACE FUNCTION core.log_project_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quien text := coalesce(nullif(current_setting('app.actor', true), ''), current_user);
BEGIN
  IF NEW.closing_date IS DISTINCT FROM OLD.closing_date THEN
    INSERT INTO core.project_change (project_id, actor, field, old_value, new_value)
    VALUES (NEW.id, quien, 'closing_date', OLD.closing_date::text, NEW.closing_date::text);
  END IF;
  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    INSERT INTO core.project_change (project_id, actor, field, old_value, new_value)
    VALUES (NEW.id, quien, 'start_date', OLD.start_date::text, NEW.start_date::text);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO core.project_change (project_id, actor, field, old_value, new_value)
    VALUES (NEW.id, quien, 'status', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_change AFTER UPDATE ON core.project
    FOR EACH ROW EXECUTE FUNCTION core.log_project_change();

-- ── 5. Funciones de apoyo ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION metrics.dias_habiles(desde date, hasta date) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE WHEN hasta >= desde THEN 1 ELSE -1 END) *
         (SELECT count(*)::int
            FROM generate_series(least(desde, hasta) + 1, greatest(desde, hasta), interval '1 day') d
           WHERE extract(isodow FROM d) < 6)
$$;

-- anulado → anulado · con fecha real → cumplido · cerrado sin fecha → no_registrado
-- (contratos históricos) · sin plan → no_registrado · plan pasado → vencido · si no → pendiente
CREATE OR REPLACE FUNCTION metrics.estado_evento(f_plan date, f_real date, anulado boolean, cerrado boolean)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN coalesce(anulado, false) THEN 'anulado'
              WHEN f_real IS NOT NULL          THEN 'cumplido'
              WHEN coalesce(cerrado, false)    THEN 'no_registrado'
              WHEN f_plan IS NULL              THEN 'no_registrado'
              WHEN f_plan < current_date       THEN 'vencido'
              ELSE 'pendiente' END
$$;

-- ── 6. LA vista: todo evento de contrato y de proyecto, con plan y real ────
CREATE OR REPLACE VIEW metrics.v2_eventos AS
WITH k AS (
    SELECT k.*, p.id pid, p.code project_code, p.display_code, p.country pais, cl.name cliente,
           u.full_name gestora, ct.display_name contratista, ct.id ctid, ct.kind ctkind,
           (k.state <> 'active') cerrado,
           dc.completos_en
      FROM procurement.contract k
      JOIN core.project p ON p.id = k.project_id
      JOIN procurement.contractor ct ON ct.id = k.contractor_id
      LEFT JOIN core.client cl ON cl.id = p.client_id
      LEFT JOIN core.app_user u ON u.id = k.overseer_id
      LEFT JOIN LATERAL (
          SELECT CASE WHEN bool_and(d.primera IS NOT NULL) THEN max(d.primera) END completos_en
            FROM procurement.required_document rq
            LEFT JOIN LATERAL (SELECT min(cd.creado_en)::date primera
                                 FROM procurement.contractor_document cd
                                WHERE cd.contractor_id = ct.id AND cd.tipo = rq.tipo) d ON true
           WHERE rq.kind = ct.kind) dc ON true
),
pr AS (
    SELECT p.*, cl.name cliente, u.full_name gestora,
           (p.status IN ('completed','cancelled')) cerrado
      FROM core.project p
      LEFT JOIN core.client cl ON cl.id = p.client_id
      LEFT JOIN core.app_user u ON u.id = p.pm_id
)
-- Actos del contrato
SELECT 'contrato' ambito, 'acto' familia, 'solicitud' tipo, k.code contract_code, k.pid project_id,
       k.project_code, k.display_code, k.ctid contractor_id, k.contratista, k.gestora, k.cliente, k.pais,
       NULL::text ihpsc_group, 'Solicitud ' || coalesce(k.hiring_request_code, 'legada') titulo,
       NULL::text accion, NULL::date fecha_plan, k.drafted_at fecha_real, NULL::date fecha_fin,
       NULL::numeric monto_cop, metrics.estado_evento(NULL, k.drafted_at, false, true) estado,
       coalesce(k.gestora, 'Gestora') dueno, '/contratacion/solicitudes' ref, 10 orden
  FROM k
UNION ALL
SELECT 'contrato', 'acto', 'contrato', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL, 'Contrato ' || k.code || ' emitido',
       'Procesar solicitud', k.drafted_at, k.issued_at, NULL, k.amount,
       metrics.estado_evento(k.drafted_at, k.issued_at, false, k.cerrado OR k.drafted_at IS NULL),
       'Administración', '/contratacion/solicitudes', 11
  FROM k
UNION ALL
SELECT 'contrato', 'acto', 'firma_interna', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL, 'Firma InnovaHub · ' || k.code,
       'Firmar (InnovaHub)', k.issued_at, k.signed_internal_at, NULL, NULL,
       metrics.estado_evento(k.issued_at, k.signed_internal_at, false, k.cerrado),
       'Administración', '/contratacion/contratistas/' || k.ctid, 12
  FROM k
UNION ALL
SELECT 'contrato', 'acto', 'firma_contratista', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL, 'Firma de ' || k.contratista || ' · ' || k.code,
       'Registrar firma del contratista', k.issued_at, k.signed_contractor_at, NULL, NULL,
       metrics.estado_evento(k.issued_at, k.signed_contractor_at, false, k.cerrado),
       coalesce(k.gestora, 'Gestora'), '/contratacion/contratistas/' || k.ctid, 13
  FROM k
UNION ALL
SELECT 'contrato', 'acto', 'vigencia', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL, 'Vigencia ' || k.code,
       NULL, k.start_date, CASE WHEN k.start_date <= current_date THEN k.start_date END, k.end_date, k.amount,
       CASE WHEN k.state = 'annulled' THEN 'anulado' WHEN k.end_date < current_date THEN 'cumplido' ELSE 'pendiente' END,
       coalesce(k.gestora, 'Gestora'), '/contratacion/contratistas/' || k.ctid, 1
  FROM k
UNION ALL
SELECT 'contrato', 'acto', 'inicio_contrato', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL, 'Inicia ' || k.contratista || ' · ' || k.code,
       'Confirmar arranque', k.start_date, CASE WHEN k.start_date <= current_date THEN k.start_date END, NULL, NULL,
       metrics.estado_evento(k.start_date, CASE WHEN k.start_date <= current_date THEN k.start_date END,
                             k.state = 'annulled', k.cerrado),
       coalesce(k.gestora, 'Gestora'), '/contratacion/contratistas/' || k.ctid, 14
  FROM k
UNION ALL
SELECT 'contrato', 'acto', 'fin_contrato', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL, 'Termina ' || k.contratista || ' · ' || k.code,
       'Liquidar o prorrogar', k.end_date, CASE WHEN k.state = 'finished' THEN k.end_date END, NULL, NULL,
       metrics.estado_evento(k.end_date, CASE WHEN k.state = 'finished' THEN k.end_date END,
                             k.state = 'annulled', false),
       coalesce(k.gestora, 'Gestora'), '/contratacion/contratistas/' || k.ctid, 15
  FROM k
UNION ALL
SELECT 'contrato', 'acto', 'documentos', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL, 'Expediente completo de ' || k.contratista,
       'Completar expediente', k.issued_at, k.completos_en, NULL, NULL,
       metrics.estado_evento(k.issued_at, k.completos_en, false, k.cerrado),
       'Administración', '/contratacion/contratistas/' || k.ctid, 16
  FROM k
UNION ALL
-- Dinero del contrato
SELECT 'contrato', 'dinero', 'pago', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL, 'Pago a ' || k.contratista || ' · ' || k.code,
       CASE WHEN cp.authorized_at IS NULL THEN 'Autorizar pago' ELSE 'Validar pago' END,
       cp.due_date, cp.adm_validated_at, NULL, cp.amount,
       metrics.estado_evento(cp.due_date, cp.adm_validated_at, cp.cancelled_at IS NOT NULL, false),
       CASE WHEN cp.authorized_at IS NULL THEN coalesce(k.gestora, 'Gestora') ELSE 'Administración' END,
       '/contratacion/firmas', 20
  FROM k JOIN procurement.contract_payment cp ON cp.contract_code = k.code
UNION ALL
SELECT 'contrato', 'dinero', 'cuenta_cobro', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL, 'Cuenta de cobro de ' || k.contratista || ' · ' || k.code,
       'Solicitar cuenta de cobro', cp.due_date - 5, cp.submitted_at, NULL, cp.amount,
       metrics.estado_evento(cp.due_date - 5, cp.submitted_at, cp.cancelled_at IS NOT NULL,
                             cp.adm_validated_at IS NOT NULL),
       k.contratista, '/contratacion/firmas', 21
  FROM k JOIN procurement.contract_payment cp ON cp.contract_code = k.code
UNION ALL
-- Entregas del contrato
SELECT 'contrato', 'entrega', 'entrega', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, d.ihpsc_group, 'Entrega: ' || d.description,
       'Registrar entrega', d.due_date, d.first_delivered_at, NULL, NULL,
       metrics.estado_evento(d.due_date, d.first_delivered_at, k.state = 'annulled', k.cerrado),
       coalesce(k.gestora, 'Gestora'), '/contratacion/contratistas/' || k.ctid, 30
  FROM k JOIN procurement.contract_deliverable d ON d.contract_code = k.code
UNION ALL
SELECT 'contrato', 'entrega', 'aprobacion', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, d.ihpsc_group,
       'Aprobar: ' || d.description || ' · rondas ' || d.rounds_used || '/' || d.rounds_agreed,
       'Aprobar entrega', d.delivered_at + 5, d.approved_at, NULL, NULL,
       metrics.estado_evento(d.delivered_at + 5, d.approved_at, k.state = 'annulled', k.cerrado),
       coalesce(k.gestora, 'Gestora'), '/contratacion/contratistas/' || k.ctid, 31
  FROM k JOIN procurement.contract_deliverable d ON d.contract_code = k.code
 WHERE d.delivered_at IS NOT NULL
UNION ALL
-- Novedades del contrato
SELECT 'contrato', 'novedad', 'otrosi', k.code, k.pid, k.project_code, k.display_code, k.ctid, k.contratista,
       k.gestora, k.cliente, k.pais, NULL,
       'Otrosí (' || a.effect || ') ' || k.code || ': ' || left(a.detail, 90),
       'Resolver otrosí', a.requested_at::date, a.resolved_at::date, NULL,
       CASE WHEN a.effect = 'monto' THEN (a.changes->>'nuevo_monto')::numeric END,
       metrics.estado_evento(a.requested_at::date, a.resolved_at::date, a.state = 'rejected', false),
       'Administración', '/contratacion/otrosi', 40
  FROM k JOIN procurement.contract_amendment a ON a.contract_code = k.code
UNION ALL
-- Proyecto
SELECT 'proyecto', 'acto', 'vigencia', NULL, pr.id, pr.code, pr.display_code, NULL, NULL,
       pr.gestora, pr.cliente, pr.country, NULL, 'Vigencia ' || pr.display_code,
       NULL, pr.start_date, CASE WHEN pr.start_date <= current_date THEN pr.start_date END, pr.closing_date, NULL,
       CASE WHEN pr.status = 'cancelled' THEN 'anulado' WHEN pr.cerrado THEN 'cumplido' ELSE 'pendiente' END,
       coalesce(pr.gestora, 'Gestora'), '/proyectos/' || pr.code, 1
  FROM pr
UNION ALL
SELECT 'proyecto', 'acto', 'fin_proyecto', NULL, pr.id, pr.code, pr.display_code, NULL, NULL,
       pr.gestora, pr.cliente, pr.country, NULL, 'Cierre de ' || pr.display_code,
       'Cerrar o prorrogar', pr.closing_date, CASE WHEN pr.cerrado THEN pr.closing_date END, NULL, NULL,
       metrics.estado_evento(pr.closing_date, CASE WHEN pr.cerrado THEN pr.closing_date END,
                             pr.status = 'cancelled', false),
       coalesce(pr.gestora, 'Gestora'), '/proyectos/' || pr.code, 15
  FROM pr
UNION ALL
SELECT 'proyecto', 'acto', 'documentos_proyecto', NULL, pr.id, pr.code, pr.display_code, NULL, NULL,
       pr.gestora, pr.cliente, pr.country, NULL, 'Contrato y documentación de ' || pr.display_code,
       'Cargar contrato', pr.start_date, pr.docs_uploaded_at, NULL, NULL,
       metrics.estado_evento(pr.start_date, pr.docs_uploaded_at, pr.status = 'cancelled',
                             pr.cerrado OR pr.contract_url IS NOT NULL),
       coalesce(pr.gestora, 'Gestora'), '/proyectos/' || pr.code, 16
  FROM pr
UNION ALL
SELECT 'proyecto', 'dinero', 'factura', NULL, pr.id, pr.code, pr.display_code, NULL, NULL,
       pr.gestora, pr.cliente, pr.country, NULL, 'Facturar a ' || coalesce(pr.cliente, 'cliente') || ' · ' || pr.display_code,
       'Registrar factura', coalesce(m.contract_date, m.expected_date), m.invoice_date, NULL, m.amount_cop,
       metrics.estado_evento(coalesce(m.contract_date, m.expected_date), m.invoice_date,
                             m.state = 'written_off', m.state IN ('invoiced','partial','credited')),
       coalesce(pr.gestora, 'Gestora'), '/cartera', 22
  FROM pr JOIN revenue.milestone m ON m.project_id = pr.id
UNION ALL
SELECT 'proyecto', 'dinero', 'cobro', NULL, pr.id, pr.code, pr.display_code, NULL, NULL,
       pr.gestora, pr.cliente, pr.country, NULL, 'Cobro de ' || coalesce(pr.cliente, 'cliente') || ' · ' || pr.display_code,
       'Gestionar cobro', coalesce(m.forecast_date, m.expected_date), m.credited_date, NULL,
       CASE WHEN m.state = 'credited' THEN m.amount_cop ELSE r.saldo_cop END,
       metrics.estado_evento(coalesce(m.forecast_date, m.expected_date), m.credited_date,
                             m.state = 'written_off', m.state = 'credited'),
       coalesce(pr.gestora, 'Gestora'), '/cartera', 23
  FROM pr JOIN revenue.milestone m ON m.project_id = pr.id
  JOIN revenue.v_milestone_recibido r ON r.milestone_id = m.id
UNION ALL
SELECT 'proyecto', 'entrega', 'entregable_proyecto', NULL, pr.id, pr.code, pr.display_code, NULL, NULL,
       pr.gestora, pr.cliente, pr.country, NULL, 'Entregable: ' || d.description,
       'Actualizar avance', d.due_date, CASE WHEN d.progress_pct >= 100 THEN d.updated_at::date END, NULL,
       d.planned_value_cop,
       metrics.estado_evento(d.due_date, CASE WHEN d.progress_pct >= 100 THEN d.updated_at::date END,
                             pr.status = 'cancelled', pr.cerrado),
       coalesce(u.full_name, pr.gestora, 'Gestora'), '/proyectos/' || pr.code, 32
  FROM pr JOIN core.deliverable d ON d.project_id = pr.id
  LEFT JOIN core.app_user u ON u.id = d.responsible_id
UNION ALL
SELECT 'proyecto', 'novedad', 'cambio', NULL, pr.id, pr.code, pr.display_code, NULL, NULL,
       pr.gestora, pr.cliente, pr.country, NULL,
       CASE c.field WHEN 'closing_date' THEN 'Cierre movido' WHEN 'start_date' THEN 'Inicio movido' ELSE 'Estado' END
         || ': ' || coalesce(c.old_value, '—') || ' → ' || coalesce(c.new_value, '—'),
       NULL, NULL, c.at::date, NULL, NULL, 'cumplido', c.actor, '/proyectos/' || pr.code, 41
  FROM pr JOIN core.project_change c ON c.project_id = pr.id
UNION ALL
SELECT 'proyecto', 'novedad', 'monto', NULL, pr.id, pr.code, pr.display_code, NULL, NULL,
       pr.gestora, pr.cliente, pr.country, NULL,
       'Monto v' || pa.version || ': ' || coalesce(pa.reason, 'nueva versión'),
       NULL, NULL, pa.valid_from, NULL, pa.amount_cop, 'cumplido',
       coalesce(pr.gestora, 'Gestora'), '/proyectos/' || pr.code, 42
  FROM pr JOIN core.project_amount pa ON pa.project_id = pr.id AND pa.version > 1;
GRANT SELECT ON metrics.v2_eventos TO app_rw, bi_reader;

-- ── 7. Agenda: solo compromisos (alguien debe hacer algo), con anticipación ──
-- Pagos y cobros avisan 3 días hábiles antes; firmas, entregas y cierres, el día.
CREATE OR REPLACE VIEW metrics.v2_agenda AS
SELECT e.*,
       metrics.dias_habiles(current_date, e.fecha_plan) dias_habiles,
       CASE WHEN e.tipo IN ('pago','cobro','cuenta_cobro','factura') THEN 3 ELSE 0 END anticipacion
  FROM metrics.v2_eventos e
 WHERE e.estado IN ('pendiente','vencido')
   AND e.fecha_plan IS NOT NULL
   AND e.tipo <> 'vigencia';
GRANT SELECT ON metrics.v2_agenda TO app_rw, bi_reader;

-- ── 8. Sobrecosto por contrato y brecha de financiación por proyecto ───────
CREATE OR REPLACE VIEW metrics.v2_sobrecosto AS
SELECT k.code contract_code, k.project_id, k.contractor_id, k.base_amount, k.amount,
       k.amount - k.base_amount sobrecosto_cop,
       round(100.0 * (k.amount - k.base_amount) / nullif(k.base_amount, 0), 1) sobrecosto_pct,
       (SELECT count(*) FROM procurement.contract_amendment a
         WHERE a.contract_code = k.code AND a.state = 'approved') otrosies,
       (SELECT count(*) FROM procurement.contract_amendment a
         WHERE a.contract_code = k.code AND a.state = 'approved' AND a.effect = 'plazo') prorrogas
  FROM procurement.contract k;
GRANT SELECT ON metrics.v2_sobrecosto TO app_rw, bi_reader;

-- Pagado a terceros antes de haber cobrado al cliente: lo que financia InnovaHub.
CREATE OR REPLACE VIEW metrics.v2_brecha_financiacion AS
SELECT p.id project_id, p.code project_code,
       coalesce(pg.pagado, 0) pagado_terceros_cop,
       coalesce(cb.cobrado, 0) cobrado_cliente_cop,
       greatest(coalesce(pg.pagado, 0) - coalesce(cb.cobrado, 0), 0) brecha_cop
  FROM core.project p
  LEFT JOIN (SELECT k.project_id, sum(cp.amount) pagado
               FROM procurement.contract_payment cp JOIN procurement.contract k ON k.code = cp.contract_code
              WHERE cp.adm_validated_at IS NOT NULL GROUP BY 1) pg ON pg.project_id = p.id
  LEFT JOIN (SELECT m.project_id, sum(r.recibido_cop) cobrado
               FROM revenue.milestone m JOIN revenue.v_milestone_recibido r ON r.milestone_id = m.id
              GROUP BY 1) cb ON cb.project_id = p.id;
GRANT SELECT ON metrics.v2_brecha_financiacion TO app_rw, bi_reader;
