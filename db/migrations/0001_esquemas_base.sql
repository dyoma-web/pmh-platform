-- 0001 · Esquemas por dominio, extensiones y roles de acceso.
-- Portable: solo Postgres estándar. Ver docs/adr/0001-donde-vive-la-informacion.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- hashes y uuid
CREATE EXTENSION IF NOT EXISTS citext;     -- correos case-insensitive

-- Dominio de datos (los transaccionales se pueblan en F2; existir desde ya
-- fija el mapa y evita reestructuraciones)
CREATE SCHEMA IF NOT EXISTS staging;      -- espejo crudo de las hojas (sync F1); se trunca y recarga
CREATE SCHEMA IF NOT EXISTS ref;          -- semillas y catálogos (alias, cuentas, tarifario, monedas)
CREATE SCHEMA IF NOT EXISTS core;         -- proyectos, clientes, usuarios, vehículos
CREATE SCHEMA IF NOT EXISTS revenue;      -- hitos, facturas, cobros
CREATE SCHEMA IF NOT EXISTS procurement;  -- solicitudes, contratos, pagos, contratistas
CREATE SCHEMA IF NOT EXISTS budget;       -- versiones de presupuesto, líneas, liberaciones
CREATE SCHEMA IF NOT EXISTS ledger;       -- money_event + conciliación
CREATE SCHEMA IF NOT EXISTS catalog;      -- IHPSC v3.1, perfiles, crosswalk
CREATE SCHEMA IF NOT EXISTS pii;          -- datos de personas naturales (RLS obligatoria)
CREATE SCHEMA IF NOT EXISTS metrics;      -- SOLO vistas certificadas M1-M12 (única superficie de BI)
CREATE SCHEMA IF NOT EXISTS audit;        -- event_log append-only

COMMENT ON SCHEMA staging IS 'Espejo crudo de las hojas GAP_DATA. Sin restricciones. Se trunca y recarga en cada sync.';
COMMENT ON SCHEMA ref     IS 'Semillas de F0 y catálogos de referencia. Fuente: seeds/ en git.';
COMMENT ON SCHEMA metrics IS 'Vistas certificadas (docs/05). Lo único que puede leer bi_reader.';
COMMENT ON SCHEMA pii     IS 'Datos personales Ley 1581/2012. RLS obligatoria; acceso registrado.';
COMMENT ON SCHEMA audit   IS 'Append-only. Nunca UPDATE ni DELETE.';

-- Roles de acceso (idempotente; NOLOGIN: la pertenencia la dan los usuarios/servicios)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_reader') THEN
    CREATE ROLE bi_reader NOLOGIN;
  END IF;
END $$;

-- bi_reader: SOLO metrics, y nada más — la regla 5 del ADR en forma de GRANT
GRANT USAGE ON SCHEMA metrics TO bi_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA metrics GRANT SELECT ON TABLES TO bi_reader;

-- app_rw: dominios operativos (afinado por tabla en F2; pii queda excluida por defecto)
GRANT USAGE ON SCHEMA staging, ref, core, revenue, procurement, budget, ledger, catalog, audit TO app_rw;
