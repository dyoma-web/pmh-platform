-- 0009 · F5 — imputación presupuestal obligatoria y regla de no exceder la línea.
-- DECISIÓN (documentada): exceder una línea no se aprueba con un flag — exige una
-- nueva versión de presupuesto aprobada. Así la «aprobación explícita» del
-- checklist queda versionada y auditable, no como excepción suelta.

ALTER TABLE procurement.contract
    ADD COLUMN budget_line_id bigint REFERENCES budget.line;
ALTER TABLE procurement.hiring_request
    ADD COLUMN budget_line_id bigint REFERENCES budget.line;

CREATE OR REPLACE FUNCTION procurement.check_budget_line() RETURNS trigger AS $$
DECLARE tope numeric; usado numeric; nombre text;
BEGIN
    IF NEW.budget_line_id IS NULL OR NEW.state = 'annulled' THEN
        RETURN NEW;
    END IF;
    SELECT l.total, coalesce(l.description, l.legacy_code, l.ihpsc_code)
      INTO tope, nombre FROM budget.line l WHERE l.id = NEW.budget_line_id;
    SELECT coalesce(sum(c.amount), 0) INTO usado
      FROM procurement.contract c
     WHERE c.budget_line_id = NEW.budget_line_id
       AND c.state <> 'annulled' AND c.code <> NEW.code;
    IF usado + NEW.amount > tope + 1 THEN
        RAISE EXCEPTION
          'La línea presupuestal «%» no alcanza: tope $ %, ya comprometido $ %, este contrato $ %. Exceder exige una nueva versión de presupuesto aprobada.',
          nombre, tope, usado, NEW.amount;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER contrato_respeta_linea
    BEFORE INSERT OR UPDATE OF amount, budget_line_id, state
    ON procurement.contract
    FOR EACH ROW EXECUTE FUNCTION procurement.check_budget_line();

-- Porcentajes de costeo por defecto de la organización (sobreescribibles por proyecto)
INSERT INTO ref.parametro (clave, valor, descripcion) VALUES
    ('costeo_p_margin', '12', 'Margen % por defecto al costear'),
    ('costeo_p_ayf', '12', 'Administración y funcionamiento % por defecto'),
    ('costeo_p_unforeseen', '3', 'Imprevistos % por defecto'),
    ('costeo_p_ica', '1', 'ICA % por defecto'),
    ('costeo_p_commission', '0', 'Comisión % por defecto')
ON CONFLICT (clave) DO NOTHING;
