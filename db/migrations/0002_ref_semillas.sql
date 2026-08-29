-- 0002 · Tablas de referencia que reciben las semillas de F0 (seeds/ en git).
-- Se cargan/actualizan con tools/cargar_seeds.py (upsert idempotente).

CREATE TABLE IF NOT EXISTS ref.moneda (
    codigo char(3) PRIMARY KEY CHECK (codigo ~ '^[A-Z]{3}$'),
    nombre text NOT NULL
);
INSERT INTO ref.moneda (codigo, nombre) VALUES
    ('COP','Peso colombiano'), ('USD','Dólar estadounidense'),
    ('EUR','Euro'), ('CLP','Peso chileno')
ON CONFLICT (codigo) DO NOTHING;

-- Alias y destino de códigos de proyecto (decisiones F0, seeds/alias_projectcode.csv)
CREATE TABLE IF NOT EXISTS ref.alias_projectcode (
    codigo_origen    text PRIMARY KEY,
    accion           text NOT NULL CHECK (accion IN
                        ('alias','bolsa_contable','crear_proyecto_fase','crear_proyecto_historico')),
    codigo_canonico  text NOT NULL,
    nota             text,
    decidido_por     text NOT NULL DEFAULT 'F0 2026-08-29',
    actualizado_en   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE ref.alias_projectcode IS
    'Normalización de ProjectCode al migrar/sincronizar. Toda lectura de staging pasa por aquí.';

-- Homologación cuenta contable → categoría de gestión (seeds/cuentas_categoria.csv)
CREATE TABLE IF NOT EXISTS ref.cuenta_categoria (
    cuenta          text PRIMARY KEY,
    nombre_cuenta   text,
    categoria       text NOT NULL,
    actualizado_en  timestamptz NOT NULL DEFAULT now()
);

-- Tarifario provisional IHPSC (seeds/tarifario_provisional.csv)
CREATE TABLE IF NOT EXISTS ref.tarifario_provisional (
    ihpsc_item              text PRIMARY KEY,
    lineas                  int,
    monto_total             numeric(18,2),
    p_min                   numeric(18,2),
    p_mediana               numeric(18,2),
    p_max                   numeric(18,2),
    costo_ref_provisional_cop numeric(18,2) NOT NULL,
    fuente                  text NOT NULL,
    estado                  text NOT NULL DEFAULT 'PROVISIONAL',
    actualizado_en          timestamptz NOT NULL DEFAULT now()
);

-- Parámetros del sistema (costo fijo mensual, umbrales, TRM por defecto…)
CREATE TABLE IF NOT EXISTS ref.parametro (
    clave          text PRIMARY KEY,
    valor          text NOT NULL,
    descripcion    text,
    actualizado_por text,
    actualizado_en timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ref.parametro (clave, valor, descripcion) VALUES
    ('umbral_m3_risk',  '0.70', 'Ejecución presupuestal: inicio de Risk'),
    ('umbral_m3_alert', '0.90', 'Ejecución presupuestal: inicio de Alert'),
    ('aging_tramos',    '30,60,90', 'Cortes de antigüedad de cartera (días)'),
    ('costo_fijo_mensual_cop', '0', 'Se calcula en F1 (ver docs/05 decisión 1); 0 = sin definir')
ON CONFLICT (clave) DO NOTHING;
