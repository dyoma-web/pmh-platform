-- 0005 · F3 — captura de doble firma con separación de funciones (checklist §5, §8).
-- Registra QUIÉN firma cada paso; el motor impide que la misma persona ponga las dos firmas
-- y que se valide sin documentos. Patrón de auditoría por fila que adoptarán las demás tablas.

ALTER TABLE procurement.contract_payment
    ADD COLUMN authorized_by bigint REFERENCES core.app_user,
    ADD COLUMN validated_by  bigint REFERENCES core.app_user,
    ADD COLUMN returned_reason text,
    ADD COLUMN updated_at timestamptz,
    ADD COLUMN updated_by bigint REFERENCES core.app_user;

-- Separación de funciones: quien autoriza no valida (bloqueante 7 del checklist)
ALTER TABLE procurement.contract_payment
    ADD CONSTRAINT firmas_distintas
    CHECK (authorized_by IS NULL OR validated_by IS NULL OR authorized_by <> validated_by);

-- No hay validación sin autorización previa (el flujo no se salta pasos)
ALTER TABLE procurement.contract_payment
    ADD CONSTRAINT validar_requiere_autorizar
    CHECK (adm_validated_at IS NULL OR authorized_at IS NOT NULL OR legacy_exception);

-- Las solicitudes procesadas de ahora en adelante deben generar contrato con llave
-- (la FK ya existe; este índice acelera el cruce y el control de la regla en API)
CREATE INDEX IF NOT EXISTS contract_hiring_idx ON procurement.contract (hiring_request_code);
CREATE INDEX IF NOT EXISTS payment_estado_idx
    ON procurement.contract_payment (adm_validated_at, authorized_at, due_date);
