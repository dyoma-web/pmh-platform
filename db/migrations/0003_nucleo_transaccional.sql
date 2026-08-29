-- 0003 · Núcleo transaccional (F2) — el modelo que hace imposible el error.
-- Reglas (docs/02 §5): dinero como trío (monto+moneda+TRM, COP generado);
-- FKs reales; estados por CHECK; PII segregada con RLS; auditoría append-only.
-- Se puebla con tools/migrar_f2.py desde staging + ref (decisiones F0).

CREATE SCHEMA IF NOT EXISTS infra;

-- ═══════════════ CORE ═══════════════
CREATE TABLE core.country (
    name text PRIMARY KEY
);
CREATE TABLE core.service_line (
    code text PRIMARY KEY
);
CREATE TABLE core.org_entity (
    name text PRIMARY KEY,
    kind text NOT NULL DEFAULT 'vehiculo' CHECK (kind IN ('vehiculo','lta','tercero'))
);
CREATE TABLE core.client (
    id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE
);
CREATE TABLE core.app_user (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name text NOT NULL UNIQUE,
    email     citext UNIQUE,
    ih_role   text,
    app_role  text NOT NULL DEFAULT 'user' CHECK (app_role IN ('admin','user')),
    active    boolean NOT NULL DEFAULT true
);
CREATE TABLE core.framework_contract (
    code       text PRIMARY KEY,
    concept    text,
    folder_url text
);
-- Documentos deduplicados por hash (el almacén de objetos llega con la captura F3;
-- por ahora registra las URLs migradas)
CREATE TABLE core.document (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sha256      text UNIQUE,
    url         text,
    mime        text,
    bytes       bigint,
    storage_key text,
    origin      text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (sha256 IS NOT NULL OR url IS NOT NULL)
);

CREATE TABLE core.project (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code          text NOT NULL UNIQUE CHECK (code = lower(code) AND code !~ ' '),
    display_code  text NOT NULL,
    kind          text NOT NULL DEFAULT 'project'
                  CHECK (kind IN ('project','phase','historical','pool')),
    client_id     bigint REFERENCES core.client,
    country       text REFERENCES core.country,
    service_line  text REFERENCES core.service_line,
    org_entity    text REFERENCES core.org_entity,
    pm_id         bigint REFERENCES core.app_user,
    partner_manager_id bigint REFERENCES core.app_user,
    framework_contract_code text REFERENCES core.framework_contract,
    status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','paused','completed','cancelled')),
    start_date    date,
    closing_date  date,
    identifier    text,
    contract_url  text,
    proposal_url  text,
    remarks       text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
-- Los códigos históricos/variantes apuntan al proyecto canónico: los huérfanos
-- dejan de ser posibles porque toda lectura resuelve por esta tabla.
CREATE TABLE core.project_alias (
    alias      text PRIMARY KEY,
    project_id bigint NOT NULL REFERENCES core.project ON DELETE RESTRICT,
    note       text
);

-- Dinero = trío indivisible. amount_cop es SIEMPRE generado, nunca capturado.
CREATE TABLE core.project_amount (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id  bigint NOT NULL REFERENCES core.project ON DELETE RESTRICT,
    version     int NOT NULL,
    amount      numeric(18,2) NOT NULL CHECK (amount >= 0),
    currency    char(3) NOT NULL REFERENCES ref.moneda,
    fx_rate     numeric(18,6) NOT NULL CHECK (fx_rate > 0),
    amount_cop  numeric(18,2) GENERATED ALWAYS AS (round(amount * fx_rate, 2)) STORED,
    fx_kind     text NOT NULL DEFAULT 'pactada' CHECK (fx_kind IN ('pactada','mercado','derivada')),
    valid_from  date,
    reason      text,
    UNIQUE (project_id, version),
    CHECK (currency <> 'COP' OR fx_rate = 1)
);
CREATE TABLE core.project_costing (
    project_id   bigint PRIMARY KEY REFERENCES core.project ON DELETE RESTRICT,
    p_margin     numeric(6,2), p_ayf numeric(6,2), p_unforeseen numeric(6,2),
    p_ica        numeric(6,2), p_commission numeric(6,2),
    base_team    numeric(18,2), implementation_budget numeric(18,2),
    implementation_reserve numeric(18,2), management_budget numeric(18,2),
    internal_cost numeric(18,2), external_cost numeric(18,2)
);

-- ═══════════════ REVENUE ═══════════════
CREATE TABLE revenue.milestone (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legacy_id     text UNIQUE,
    project_id    bigint NOT NULL REFERENCES core.project ON DELETE RESTRICT,
    amount_cop    numeric(18,2) NOT NULL CHECK (amount_cop >= 0),
    original_amount numeric(18,2),
    contract_date date,
    expected_date date NOT NULL,
    forecast_date date,
    state         text NOT NULL CHECK (state IN ('scheduled','invoiced','credited','written_off')),
    invoice_date  date,
    invoice_url   text,
    credited_date date,
    credited_date_approx boolean NOT NULL DEFAULT false,
    deliverables  text,
    remarks       text,
    delay_category text CHECK (delay_category IN ('externo','interno','mixto','otro')),
    delay_note    text,
    CHECK (state <> 'credited' OR credited_date IS NOT NULL),
    CHECK (state NOT IN ('invoiced','credited') OR invoice_date IS NOT NULL OR credited_date_approx)
);

-- ═══════════════ PROCUREMENT + PII ═══════════════
CREATE TABLE procurement.contractor (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_number    text NOT NULL UNIQUE,      -- texto: conserva ceros y alfanuméricos
    id_type      text,
    display_name text NOT NULL,
    profile      text,
    company_name text,
    is_internal  boolean NOT NULL DEFAULT false
);
CREATE TABLE pii.contractor_contact (
    contractor_id bigint PRIMARY KEY REFERENCES procurement.contractor ON DELETE RESTRICT,
    legal_name    text,
    phone         text,
    email         citext,
    folder_url    text,
    data_authorization_doc_id bigint REFERENCES core.document,
    updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pii.contractor_contact ENABLE ROW LEVEL SECURITY;
-- Sin política para app_rw: por defecto NADIE la lee salvo el dueño de la BD.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pii_reader') THEN
    CREATE ROLE pii_reader NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA pii TO pii_reader;
GRANT SELECT ON pii.contractor_contact TO pii_reader;
CREATE POLICY pii_lectura ON pii.contractor_contact FOR SELECT TO pii_reader USING (true);

CREATE TABLE procurement.hiring_request (
    code          text PRIMARY KEY,           -- GAP-HR-NNNN
    project_id    bigint NOT NULL REFERENCES core.project,
    contractor_id bigint NOT NULL REFERENCES procurement.contractor,
    requested_by  bigint REFERENCES core.app_user,
    ih_capacity   boolean,
    payor_org     text REFERENCES core.org_entity,
    category      text NOT NULL CHECK (category IN ('OS','PS')),
    state         text NOT NULL CHECK (state IN ('requested','processed','cancelled')),
    start_date    date,
    annotations   text
);
CREATE TABLE procurement.request_service (
    legacy_id    text PRIMARY KEY,
    request_code text NOT NULL REFERENCES procurement.hiring_request,
    description  text, unit text, qty numeric(12,2), unit_price numeric(18,2),
    total        numeric(18,2), deliverable text, due_date date
);
CREATE TABLE procurement.request_payment (
    legacy_id    text PRIMARY KEY,
    request_code text NOT NULL REFERENCES procurement.hiring_request,
    due_date     date, method text, amount numeric(18,2)
);
CREATE TABLE procurement.contract (
    code          text PRIMARY KEY,            -- OS_AAAA_NNN | PS_AAAA_NNN
    project_id    bigint NOT NULL REFERENCES core.project ON DELETE RESTRICT,
    contractor_id bigint NOT NULL REFERENCES procurement.contractor,
    hiring_request_code text REFERENCES procurement.hiring_request, -- obligatoria para NUEVOS (trigger F3); NULL solo en legado
    overseer_id   bigint REFERENCES core.app_user,
    account_category text,
    org_entity    text REFERENCES core.org_entity,
    internal_cost boolean NOT NULL DEFAULT false,
    amount        numeric(18,2) NOT NULL CHECK (amount >= 0),
    currency      char(3) NOT NULL DEFAULT 'COP' REFERENCES ref.moneda,
    start_date    date, end_date date,
    state         text NOT NULL DEFAULT 'active' CHECK (state IN ('active','finished','annulled')),
    annotations   text, folder_url text,
    amount_note   text                          -- traza de la decisión F0 (otrosí → Σ pagos)
);
CREATE TABLE procurement.contract_payment (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legacy_id     text UNIQUE,
    contract_code text NOT NULL REFERENCES procurement.contract ON DELETE RESTRICT,
    due_date      date NOT NULL,
    amount        numeric(18,2) NOT NULL CHECK (amount > 0),
    authorized_at date,
    adm_validated_at date,
    dates_approx  boolean NOT NULL DEFAULT false, -- legado: fechas de firma = fecha programada
    invoice_url   text,
    legal_support_url text,
    legacy_exception boolean NOT NULL DEFAULT false,
    annotations   text,
    -- La regla dura de M8: no hay pago validado sin soporte legal (salvo stock legado marcado)
    CHECK (adm_validated_at IS NULL OR legal_support_url IS NOT NULL OR legacy_exception)
);
CREATE TABLE procurement.addendum (
    legacy_id     text PRIMARY KEY,
    contract_code text NOT NULL REFERENCES procurement.contract,
    request       text, state text
);

-- ═══════════════ BUDGET ═══════════════
CREATE TABLE budget.version (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id  bigint NOT NULL REFERENCES core.project ON DELETE RESTRICT,
    version     int NOT NULL,
    state       text NOT NULL CHECK (state IN ('draft','approved','superseded')),
    approved_by bigint REFERENCES core.app_user,
    approved_at date,
    UNIQUE (project_id, version)
);
CREATE TABLE budget.line (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legacy_id   text UNIQUE,
    version_id  bigint NOT NULL REFERENCES budget.version ON DELETE RESTRICT,
    legacy_code text,
    ihpsc_code  text,
    description text, unit text, qty numeric(12,2),
    unit_price  numeric(18,2), total numeric(18,2) NOT NULL CHECK (total >= 0),
    budget80    numeric(18,2) GENERATED ALWAYS AS (round(total * 0.8, 2)) STORED,
    deploying   text, implementation text CHECK (implementation IN ('internal','external','mixed')),
    comments    text
);
CREATE TABLE budget.release (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    line_id     bigint NOT NULL REFERENCES budget.line,
    released_pct numeric(5,2) NOT NULL CHECK (released_pct > 0 AND released_pct <= 20),
    released_by text NOT NULL,
    released_at date,
    note        text
);

-- ═══════════════ LEDGER ═══════════════
CREATE TABLE ledger.gl_account (
    code          text PRIMARY KEY,
    name          text,
    mgmt_category text NOT NULL
);
CREATE TABLE ledger.period (
    month     date PRIMARY KEY CHECK (extract(day from month) = 1),
    sealed_at timestamptz,
    sealed_by text
);
-- El libro único: todo peso que entra o sale es un evento aquí.
CREATE TABLE ledger.money_event (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    direction   text NOT NULL CHECK (direction IN ('in','out')),
    kind        text NOT NULL CHECK (kind IN
                 ('revenue_credit','contractor_payment','infra_payment',
                  'subs_payment','gl_accrual','adjustment')),
    project_id  bigint REFERENCES core.project ON DELETE RESTRICT,
    event_date  date NOT NULL,
    amount      numeric(18,2) NOT NULL,
    currency    char(3) NOT NULL REFERENCES ref.moneda,
    fx_rate     numeric(18,6) CHECK (fx_rate IS NULL OR fx_rate > 0),
    amount_cop  numeric(18,2) GENERATED ALWAYS AS (round(amount * fx_rate, 2)) STORED,
    gl_account  text REFERENCES ledger.gl_account,
    contractor_id bigint REFERENCES procurement.contractor,
    contract_payment_id bigint REFERENCES procurement.contract_payment,
    milestone_id bigint REFERENCES revenue.milestone,
    source_table text NOT NULL,
    source_id    text,
    document_url text,
    note         text,
    CHECK (currency <> 'COP' OR fx_rate = 1)   -- COP siempre convertible; otra moneda sin TRM ⇒ amount_cop NULL y regla de calidad lo cuenta
);
CREATE INDEX ON ledger.money_event (project_id, event_date);
CREATE INDEX ON ledger.money_event (kind, event_date);
CREATE TABLE ledger.reconciliation (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gl_event_id bigint NOT NULL REFERENCES ledger.money_event,
    op_event_id bigint NOT NULL REFERENCES ledger.money_event,
    confidence  numeric(4,3),
    matched_by  text,
    matched_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (gl_event_id, op_event_id)
);

-- ═══════════════ INFRA ═══════════════
CREATE TABLE infra.item (
    legacy_id   text PRIMARY KEY,
    project_id  bigint REFERENCES core.project,
    concept     text, provider text, resource text,
    status      text CHECK (status IN ('on','off')),
    start_date  date, end_date date,
    monthly_budget numeric(18,2), currency char(3) REFERENCES ref.moneda,
    payor       text
);
CREATE TABLE infra.subscription (
    code       text PRIMARY KEY,
    provider   text, service text, plan text,
    start_date date, end_date date,
    full_budget numeric(18,2), currency char(3) REFERENCES ref.moneda
);
CREATE TABLE infra.allocation_rule (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    resource_key text NOT NULL,
    project_id bigint NOT NULL REFERENCES core.project,
    weight     numeric(6,4) NOT NULL CHECK (weight > 0 AND weight <= 1),
    valid_from date NOT NULL,
    valid_to   date
);

-- ═══════════════ CATALOG ═══════════════
CREATE TABLE catalog.profile (
    name      text PRIMARY KEY,
    provision text,
    rate      numeric(18,2),
    rate_date date
);
CREATE TABLE catalog.ihpsc_item (
    ihp_id      text PRIMARY KEY,             -- IHP-NNNN, estable
    code        text UNIQUE,                  -- CCC-PPP-DDD-VVV
    name        text, description text, unit text, cost_driver text,
    profile     text REFERENCES catalog.profile,
    modality    text CHECK (modality IN ('INH','EXT','MIX')),
    os_applicable boolean,
    ref_cost    numeric(18,2), ref_currency char(3) REFERENCES ref.moneda,
    ref_source  text,
    state       text NOT NULL DEFAULT 'activo' CHECK (state IN ('activo','en_revision','inactivo'))
);
CREATE TABLE catalog.crosswalk (
    legacy_code   text PRIMARY KEY,
    legacy_system text NOT NULL CHECK (legacy_system IN ('v1','subs')),
    ihpsc_code    text REFERENCES catalog.ihpsc_item (code),
    note          text
);

-- ═══════════════ AUDIT (append-only de verdad) ═══════════════
CREATE TABLE audit.event_log (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at        timestamptz NOT NULL DEFAULT now(),
    actor     text NOT NULL,
    entity    text NOT NULL,
    entity_id text,
    action    text NOT NULL,
    before    jsonb,
    after     jsonb
);
CREATE OR REPLACE FUNCTION audit.no_touch() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit.event_log es append-only: % prohibido', TG_OP;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER event_log_inmutable
  BEFORE UPDATE OR DELETE ON audit.event_log
  FOR EACH ROW EXECUTE FUNCTION audit.no_touch();

-- Grants operativos (app_rw NO alcanza pii)
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA core, revenue, procurement, budget, ledger, infra, catalog TO app_rw;
GRANT INSERT ON audit.event_log TO app_rw;
GRANT SELECT ON audit.event_log TO app_rw;
