# ADR 0001 — Dónde vive la información (MVP → beta → producción)

**Estado:** aceptada (decisión delegada por dirección, 2026-08-29)
**Decide:** motor y hogar de los datos, entornos, y las reglas de portabilidad que evitan una
reestructuración al pasar a producción con usuarios reales.

---

## Decisión

**PostgreSQL 16+ gestionado en Supabase** es el hogar de la información desde el MVP, con tres
entornos y una disciplina estricta de portabilidad.

| Entorno | Proyecto Supabase | Cuándo | Plan |
|---|---|---|---|
| `dev` | `pmh-dev` | ya (F1) | Free — desarrollo y pruebas; datos sintéticos o réplica saneada |
| `beta` | `pmh-beta` | cuando el equipo empiece a mirar el cockpit (fin de F1) | Pro (~USD 25/mes) — backups diarios 7 días, sin pausa por inactividad |
| `prod` | `pmh-prod` | al iniciar captura real (F3) | Pro + PITR si se justifica; **proyecto separado desde el día uno del dato real** |

Región: **AWS us-east-1** (mejor latencia estable desde Bogotá ~70-90 ms; São Paulo no mejora y
encarece el ecosistema alrededor). *Nota (2026-08-29): `pmh-dev` se creó en `ca-central-1`; se
mantiene así para dev (latencia aceptable). `pmh-beta` y `pmh-prod` se crearán en us-east-1.*

Qué resuelve Supabase además del motor: **Auth** (OIDC con Google, restringido al dominio
`innovahub.org` — cero contraseñas nuevas), **RLS** nativa para la PII, **Storage** compatible S3
para los documentos (bucket privado `documentos`, clave = hash del archivo), API REST instantánea
para las lecturas simples, y backups diarios gestionados.

## Por qué no las alternativas

| Alternativa | Por qué no |
|---|---|
| **MySQL en el WAMP local** | Sin RLS, sin columnas generadas equivalentes, sin gestión; la máquina de un desarrollador no es un hogar de datos financieros. Descartada sin matices. |
| **Postgres en la VM "Granja InnovaHub" (GCP)** | Barata pero convierte al equipo en DBA: backups, parches, disco, disponibilidad. El riesgo operativo supera el ahorro; la Granja ya es el punto más artesanal del sistema actual. |
| **Cloud SQL en el GCP existente** | Válida (misma facturación GCP), pero solo da el motor: auth, storage, RLS-tooling y API habría que construirlos. Más costo total para 11 usuarios. **Es el plan B natural de salida.** |
| **Neon / RDS** | Neon no trae auth/storage; RDS es el mismo caso que Cloud SQL con otra factura. |
| **Google Sheets "mejorado"** | Es exactamente lo que estamos abandonando. |

## Reglas de portabilidad (lo que evita la reestructuración)

El riesgo de un BaaS es acoplarse. Estas reglas son vinculantes y se revisan en cada PR:

1. **El esquema vive en git, no en Supabase.** Migraciones SQL puras y secuenciales en
   `db/migrations/`, aplicadas por `tools/migrate.py` (psycopg2) contra cualquier `DATABASE_URL`.
   El dashboard de Supabase no se usa para cambiar esquema, nunca.
2. **Solo Postgres estándar en el núcleo:** RLS, columnas generadas, `NUMERIC`, `CHECK`,
   triggers, vistas materializadas — todo portable. Prohibido acoplar lógica de negocio a Edge
   Functions o features exclusivas de Supabase; la lógica vive en SQL portable y en la capa API
   propia.
3. **Storage solo por protocolo S3** (clave = hash). Migrar documentos = `rclone sync` a
   cualquier S3-compatible (R2, B2, GCS).
4. **Auth solo por OIDC estándar.** La identidad es el correo `@innovahub.org`; la tabla
   `core.app_user` es nuestra (el `auth.users` de Supabase solo autentica, no es dueño del rol).
5. **Roles de BD propios:** `app_rw` (API), `bi_reader` (SOLO esquema `metrics`), `migrator`.
   Metabase/BI jamás se conecta con otra cosa que `bi_reader`.
6. **Respaldo con dos custodios:** además del backup diario de Supabase, `pg_dump` semanal
   cifrado hacia almacenamiento propio (GCS del GCP existente). La restauración se prueba
   trimestralmente. Nadie depende de la buena salud de un solo proveedor.

**Prueba de salida (exit plan):** `pg_dump | pg_restore` a Cloud SQL + `rclone` del bucket +
cambiar `DATABASE_URL` y el emisor OIDC. Si en cualquier momento esa prueba deja de ser cierta,
se violó una regla de arriba.

## Organización interna de la base (una sola BD, esquemas por dominio)

```
staging      espejo crudo de las hojas (sync F1); sin restricciones; se trunca y recarga
ref          semillas y catálogos (alias de códigos, cuentas, tarifario, monedas, TRM)
core         proyectos, clientes, usuarios, vehículos           (F2)
revenue      hitos, facturas, cobros                            (F2/F4)
procurement  solicitudes, contratos, pagos, contratistas        (F2/F3)
budget       versiones de presupuesto, líneas, liberaciones     (F2/F5)
ledger       money_event + conciliación                         (F2/F6)
catalog      IHPSC v3.1, perfiles, crosswalk de códigos         (F2)
pii          datos de contacto de personas naturales (RLS)      (F2/F3)
metrics      SOLO vistas certificadas M1-M12 (lo único que ve BI)
audit        event_log append-only
```

El MVP (F1) usa `staging` + `ref` + `metrics`. Los esquemas transaccionales llegan en F2 **en la
misma base**: por eso el paso a beta y a producción no reestructura nada — agrega esquemas y
migra datos, con los entornos separados por proyecto, no por rediseño.

## Costos estimados

dev: USD 0 · beta: ~25/mes · prod: 25-35/mes + ~2/mes de backup externo. Total en producción
< USD 40/mes — menos que las licencias AppSheet actuales para 11 usuarios.

## Paso manual pendiente (5 minutos, requiere cuenta)

1. Crear organización Supabase con `david.yomayusa@innovahub.org` → proyecto `pmh-dev`
   (región us-east-1, contraseña de BD generada y guardada en 1Password).
2. Copiar `.env.example` → `.env` y llenar `DATABASE_URL` (Connection string → URI, pooler
   session mode) y las claves del proyecto.
3. `python tools/migrate.py` — aplica las migraciones y deja la base lista.

Con el token de acceso (`SUPABASE_ACCESS_TOKEN`) Claude Code puede automatizar la creación de
`pmh-beta`/`pmh-prod` y la gestión vía CLI cuando se quiera.
