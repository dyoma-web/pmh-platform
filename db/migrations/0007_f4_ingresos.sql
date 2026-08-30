-- 0007 · F4 — captura de ingresos y cartera.
-- DECISIÓN PROVISIONAL (ratificar en comité, ver docs/07 bloqueante 3):
-- el ciclo del checklist Programado→Facturado→Abonado→Pagado se modela como
--   scheduled → invoiced → partial → credited
-- donde cada abono es un money_event (revenue_credit) ligado al hito, «partial»
-- significa abonado sin saldar, y «credited» = saldado (Σ abonos ≥ monto).
-- El aging NUNCA se calcula sobre forecast: reprogramar no maquilla la mora.

ALTER TABLE revenue.milestone DROP CONSTRAINT IF EXISTS milestone_state_check;
ALTER TABLE revenue.milestone
    ADD CONSTRAINT milestone_state_check
    CHECK (state IN ('scheduled','invoiced','partial','credited','written_off'));

ALTER TABLE revenue.milestone
    ADD COLUMN invoice_number text,
    ADD COLUMN updated_at timestamptz,
    ADD COLUMN updated_by bigint REFERENCES core.app_user;

-- Gestión de cobro: cada llamada/correo/acuerdo queda registrado con autor.
-- Es la acción que cierra el semáforo de hito vencido.
CREATE TABLE revenue.collection_action (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    milestone_id bigint NOT NULL REFERENCES revenue.milestone ON DELETE RESTRICT,
    actor_id     bigint NOT NULL REFERENCES core.app_user,
    at           timestamptz NOT NULL DEFAULT now(),
    kind         text NOT NULL DEFAULT 'gestion'
                 CHECK (kind IN ('gestion','reprogramacion')),
    note         text NOT NULL
);
GRANT SELECT, INSERT ON revenue.collection_action TO app_rw;

-- Lo recibido por hito sale del ledger, nunca de un campo digitado
CREATE OR REPLACE VIEW revenue.v_milestone_recibido AS
SELECT m.id AS milestone_id,
       coalesce(sum(e.amount_cop), 0) AS recibido_cop,
       m.amount_cop - coalesce(sum(e.amount_cop), 0) AS saldo_cop
FROM revenue.milestone m
LEFT JOIN ledger.money_event e
       ON e.milestone_id = m.id AND e.kind = 'revenue_credit'
GROUP BY m.id, m.amount_cop;
GRANT SELECT ON revenue.v_milestone_recibido TO app_rw, bi_reader;
