-- 0012 · F8 — potenciación: cotizador, entregables/valor ganado, capacidad y portales.

-- ── Entregables con fecha, responsable y avance físico (→ valor ganado) ────
CREATE TABLE core.deliverable (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id   bigint NOT NULL REFERENCES core.project ON DELETE RESTRICT,
    description  text NOT NULL,
    due_date     date NOT NULL,
    responsible_id bigint REFERENCES core.app_user,
    planned_value_cop numeric(18,2) NOT NULL CHECK (planned_value_cop >= 0),
    progress_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
    milestone_id bigint REFERENCES revenue.milestone,
    updated_at   timestamptz,
    updated_by   bigint REFERENCES core.app_user
);
GRANT SELECT, INSERT, UPDATE ON core.deliverable TO app_rw;

-- Valor ganado por proyecto: PV por fecha, EV por avance, AC del ledger
CREATE OR REPLACE VIEW metrics.v2_valor_ganado AS
SELECT p.id project_id, p.code project_code,
       sum(d.planned_value_cop) FILTER (WHERE d.due_date <= current_date) AS pv_cop,
       sum(d.planned_value_cop * d.progress_pct / 100)                    AS ev_cop,
       led.ac_cop,
       round(sum(d.planned_value_cop * d.progress_pct / 100)
             / nullif(led.ac_cop, 0), 2)                                  AS cpi,
       round(sum(d.planned_value_cop * d.progress_pct / 100)
             / nullif(sum(d.planned_value_cop) FILTER (WHERE d.due_date <= current_date), 0), 2) AS spi,
       count(*) entregables,
       count(*) FILTER (WHERE d.progress_pct >= 100) completados
FROM core.deliverable d
JOIN core.project p ON p.id = d.project_id
LEFT JOIN LATERAL (SELECT sum(amount_cop) ac_cop FROM ledger.money_event
                   WHERE project_id = p.id AND kind = 'gl_accrual') led ON true
GROUP BY p.id, p.code, led.ac_cop;
GRANT SELECT ON metrics.v2_valor_ganado TO bi_reader, app_rw;

-- ── Capacidad: dedicación por persona y semana (sin horas: % basta) ────────
CREATE TABLE core.assignment (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     bigint NOT NULL REFERENCES core.app_user,
    project_id  bigint NOT NULL REFERENCES core.project ON DELETE RESTRICT,
    week        date NOT NULL CHECK (extract(dow from week) = 1),  -- lunes
    dedication_pct numeric(5,2) NOT NULL CHECK (dedication_pct > 0 AND dedication_pct <= 100),
    updated_by  bigint REFERENCES core.app_user,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, project_id, week)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON core.assignment TO app_rw;

CREATE OR REPLACE VIEW metrics.v2_capacidad AS
SELECT u.id user_id, u.full_name, a.week,
       sum(a.dedication_pct) dedicacion_pct,
       count(distinct a.project_id) proyectos,
       (sum(a.dedication_pct) > 100) sobrecarga
FROM core.assignment a JOIN core.app_user u ON u.id = a.user_id
GROUP BY u.id, u.full_name, a.week;
GRANT SELECT ON metrics.v2_capacidad TO bi_reader, app_rw;

-- ── Cotizador sobre IHPSC: precio defendible + margen esperado por ítem ────
CREATE TABLE catalog.quote (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,          -- Q-AAAA-NNN
    client_id   bigint REFERENCES core.client,
    title       text NOT NULL,
    state       text NOT NULL DEFAULT 'draft'
                CHECK (state IN ('draft','sent','won','lost')),
    created_by  bigint NOT NULL REFERENCES core.app_user,
    created_at  timestamptz NOT NULL DEFAULT now(),
    notes       text
);
CREATE TABLE catalog.quote_line (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quote_id    bigint NOT NULL REFERENCES catalog.quote ON DELETE CASCADE,
    ihpsc_code  text REFERENCES catalog.ihpsc_item (code),
    description text NOT NULL,
    unit        text,
    qty         numeric(12,2) NOT NULL CHECK (qty > 0),
    unit_price  numeric(18,2) NOT NULL CHECK (unit_price >= 0),
    ref_cost    numeric(18,2),                  -- costo de referencia al cotizar (foto)
    total       numeric(18,2) GENERATED ALWAYS AS (round(qty * unit_price, 2)) STORED
);
GRANT SELECT, INSERT, UPDATE ON catalog.quote, catalog.quote_line TO app_rw;

-- ── Portales externos por token (sin cuentas: enlace firmado por registro) ─
ALTER TABLE procurement.contractor ADD COLUMN portal_token text UNIQUE;
ALTER TABLE core.project ADD COLUMN client_portal_token text UNIQUE;
