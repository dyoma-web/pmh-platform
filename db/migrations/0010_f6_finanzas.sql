-- 0010 · F6 — cierres sellados, conciliación y prorrateo por regla.
-- Un mes sellado es inmutable: ningún evento entra, cambia o sale de él; los
-- ajustes posteriores son eventos nuevos en el mes abierto. El prorrateo del
-- recurso compartido deja de ser una captura de pantalla: es una regla con
-- pesos y vigencia, y lo no cubierto queda visible como «sin distribuir».

-- El recurso (suscripción/infra) al que pertenece un evento, para prorrateo
ALTER TABLE ledger.money_event ADD COLUMN resource_code text;
UPDATE ledger.money_event e
   SET resource_code = s.code
  FROM staging.subs_payments s
 WHERE e.source_table = 'inf_data_costs' AND e.source_id = s.id::text;

-- Sello de periodo: el motor lo impone
CREATE OR REPLACE FUNCTION ledger.check_period() RETURNS trigger AS $$
DECLARE m date; sellado timestamptz;
BEGIN
    m := date_trunc('month', COALESCE(NEW.event_date, OLD.event_date))::date;
    SELECT sealed_at INTO sellado FROM ledger.period WHERE month = m;
    IF sellado IS NOT NULL THEN
        RAISE EXCEPTION
          'El periodo % está sellado desde %: los eventos de un mes sellado no se tocan. Un ajuste va como evento nuevo en el mes abierto.',
          to_char(m, 'YYYY-MM'), to_char(sellado, 'YYYY-MM-DD');
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER periodo_sellado_inmutable
    BEFORE INSERT OR UPDATE OR DELETE ON ledger.money_event
    FOR EACH ROW EXECUTE FUNCTION ledger.check_period();

-- Prorrateo del gasto compartido: cálculo en vista, nunca eventos inventados
CREATE OR REPLACE VIEW metrics.v1_prorrateo AS
WITH base AS (
    SELECT e.id, e.resource_code, e.event_date, e.amount_cop
    FROM ledger.money_event e
    WHERE e.kind IN ('subs_payment','infra_payment')
      AND e.resource_code IS NOT NULL AND e.amount_cop IS NOT NULL
)
SELECT b.resource_code,
       b.event_date,
       r.project_id,
       p.code AS project_code,
       round(b.amount_cop * r.weight, 2) AS asignado_cop,
       b.amount_cop AS evento_cop,
       b.id AS event_id
FROM base b
JOIN infra.allocation_rule r
  ON r.resource_key = b.resource_code
 AND b.event_date >= r.valid_from
 AND (r.valid_to IS NULL OR b.event_date <= r.valid_to)
JOIN core.project p ON p.id = r.project_id;

CREATE OR REPLACE VIEW metrics.v1_prorrateo_sin_distribuir AS
SELECT e.resource_code, count(*) eventos, sum(e.amount_cop) monto_cop,
       min(e.event_date) desde, max(e.event_date) hasta
FROM ledger.money_event e
WHERE e.kind IN ('subs_payment','infra_payment')
  AND e.amount_cop IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM infra.allocation_rule r
                  WHERE r.resource_key = e.resource_code
                    AND e.event_date >= r.valid_from
                    AND (r.valid_to IS NULL OR e.event_date <= r.valid_to))
GROUP BY e.resource_code ORDER BY monto_cop DESC NULLS LAST;

GRANT SELECT ON metrics.v1_prorrateo, metrics.v1_prorrateo_sin_distribuir TO bi_reader, app_rw;
GRANT SELECT, INSERT, UPDATE ON ledger.period TO app_rw;
