-- 0006 · F3 — otrosí formal y soporte para el almacén de archivos propio.
-- El contrato original nunca se edita: toda modificación es un otrosí con su
-- propio flujo (solicitar → aprobar/rechazar), y al aprobarse el sistema aplica
-- el cambio dejando la traza. Anular no borra: marca.

CREATE TABLE procurement.contract_amendment (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contract_code text NOT NULL REFERENCES procurement.contract ON DELETE RESTRICT,
    effect        text NOT NULL CHECK (effect IN ('monto','fechas','alcance','anulacion')),
    detail        text NOT NULL,
    changes       jsonb,                     -- {nuevo_monto} | {pago_id, nueva_fecha} | …
    state         text NOT NULL DEFAULT 'requested'
                  CHECK (state IN ('requested','approved','rejected')),
    requested_by  bigint NOT NULL REFERENCES core.app_user,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    resolved_by   bigint REFERENCES core.app_user,
    resolved_at   timestamptz,
    resolution_note text,
    -- separación de funciones: quien pide el otrosí no lo aprueba
    CHECK (resolved_by IS NULL OR resolved_by <> requested_by),
    CHECK (state = 'requested' OR resolved_by IS NOT NULL)
);

-- Anulación de pagos: se marca, nunca se borra; un pago ya validado no se anula
ALTER TABLE procurement.contract_payment
    ADD COLUMN cancelled_at date,
    ADD COLUMN cancelled_reason text,
    ADD CONSTRAINT validado_no_se_anula
        CHECK (cancelled_at IS NULL OR adm_validated_at IS NULL);

GRANT SELECT, INSERT, UPDATE ON procurement.contract_amendment TO app_rw;
