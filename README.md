# PMH 2.0 — Plataforma de gestión administrativa y financiera de proyectos

Sistema interno de InnovaHub para gobernar el ciclo completo de sus proyectos de cooperación
internacional: costeo, presupuesto, ingresos y cartera, contratación de terceros, infraestructura,
conciliación contable y capa de decisión. Sucesor del sistema PMH actual (AppSheet sobre Google
Sheets).

> **Repositorio privado.** Contiene documentación de negocio interna. No hacer público ni compartir
> fuera del equipo del proyecto.

## Estado

**Fase actual: preparación (pre-F0).** Documentación funcional y de diseño cerrada; el desarrollo
aún no inicia. El roadmap vive en los [issues](../../issues) de este repositorio (F0 → F8).

## Documentación

Leer en este orden:

| Doc | Qué contiene | Audiencia |
|---|---|---|
| [01 · Contexto de backend](docs/01-contexto-backend-gap-data.md) | El sistema actual por dentro: 13 tablas, llaves, vocabularios, lógica de negocio y los 14 defectos de datos verificados | Desarrollo, datos |
| [02 · Informe de análisis y arquitectura](docs/02-informe-analisis-y-arquitectura.md) | Recorrido del front actual y del Power BI, diagnóstico (7 defectos estructurales), gap decisional, modelo de datos objetivo y plan | Dirección, desarrollo |
| [03 · Especificación funcional](docs/03-especificacion-funcional.md) | El QUÉ de PMH 2.0: principios, roles y permisos, arquitectura de información, 12 pantallas, 12 métricas certificadas, dinámicas de captura y consumo, bloques F0–F8 | Todo el equipo |
| [04 · Brief de diseño](docs/04-brief-diseno.md) | Encargo de identidad visual y manual de marca (para Claude Design): principios, territorios, entregables, restricciones y criterios de evaluación | Diseño |

## Dónde viven los datos

**[ADR 0001](docs/adr/0001-donde-vive-la-informacion.md)**: PostgreSQL gestionado en **Supabase**
(us-east-1), entornos `pmh-dev` → `pmh-beta` → `pmh-prod`, con reglas de portabilidad vinculantes
(migraciones SQL en git, solo Postgres estándar, storage S3, auth OIDC, BI solo sobre `metrics`)
y plan de salida probado (`pg_dump` + `rclone` → cualquier Postgres). Arranque:

```
cp .env.example .env        # llenar con las claves del proyecto Supabase
python tools/migrate.py     # aplica db/migrations/ (esquemas + ref)
python tools/cargar_seeds.py  # carga las semillas de F0 en ref.*
```

## Decisiones de arquitectura (resumen)

- **Datos:** PostgreSQL con restricciones fuertes, RLS para PII, ledger financiero único
  (`money_event`), auditoría append-only. Dinero = monto + moneda + TRM, COP como columna generada.
- **Aplicación:** API con máquinas de estado + front web responsive (PWA para aprobar en móvil).
- **Decisión:** vistas materializadas certificadas y versionadas aquí (una sola definición por
  métrica), semáforos con dueño y umbral, BI (Metabase) solo sobre vistas.
- **Secuencia:** capa de decisión en solo lectura primero (F1), captura módulo a módulo después.
  AppSheet sigue siendo la fuente hasta que cada módulo migre con un ciclo conciliado.

Detalle y justificación en el doc 02 (§5–§6) y doc 03 (§9).

## Criterio de éxito

Las **9 preguntas de dirección** del doc 02 §4 respondidas desde el sistema.
Hoy: 1,5 · tras F5: ≥ 6 · tras F8: 9.

## Convenciones del repositorio

- Rama principal: `main`. Trabajo en ramas `feat/…`, `fix/…`, `docs/…`; merge por PR.
- Commits en español, imperativo: `Agrega wizard de alta de proyecto`.
- Migraciones de BD solo por script versionado (nunca cambios a mano en producción).
- **Nunca** subir a este repo: datos personales de contratistas, facturas/soportes, exports de las
  hojas de producción, credenciales (`.env`). Ver `.gitignore`.

## Front (Cota · F1 solo lectura)

```
cd web && npm install && npm run dev    # http://localhost:3200
```

Cockpit (cifra que manda + KPI + acciones + aging), Cartera, Mi día (semáforos) y Calidad de
datos, server-rendered desde las vistas `metrics.v0_*`. Identidad según
`design/cota-manual-de-marca.html` (manual Cota 2.0) y wireframe `design/cota-plataforma-wireframe.html`.

## Despliegue (F1)

El front está listo para Vercel (único paso que requiere cuenta):

1. En [vercel.com](https://vercel.com) → **Add New → Project** → importar `dyoma-web/pmh-platform`
   (login con GitHub). **Root Directory: `web`**. Framework: Next.js (autodetectado).
2. Variables de entorno del proyecto: `DATABASE_URL` (pooler de Supabase),
   `BASIC_AUTH_USER` y `BASIC_AUTH_PASS` (protección interina hasta el OIDC de F2).
3. Deploy. Cada push a `main` redespliega automáticamente.

**Digest diario:** `python tools/digest.py [--quien "Nombre"]` genera el correo de las 7:00 con la
voz narrativa (HTML en `out/`). Para automatizarlo, poner los secretos `DATABASE_URL`, `SMTP_*` y
`DIGEST_TO` en GitHub → Actions y el workflow `digest-diario` lo envía de lunes a viernes.
Con Google Workspace: `smtp.gmail.com:587` + contraseña de aplicación.

## Núcleo transaccional (F2)

`db/migrations/0003` crea el modelo definitivo: `core` (proyectos con código canónico + alias,
montos versionados como trío monto·moneda·TRM con COP **generado**), `revenue` (hitos con estados
por CHECK), `procurement` (contratos y pagos con la regla dura de M8 como CHECK), `budget`,
`ledger` (**money_event**: el libro único de todo peso que entra o sale), `infra`, `catalog`
(IHPSC v3.1 completo) y `pii` (RLS: nadie la lee salvo `pii_reader`). `audit.event_log` es
append-only por trigger.

`tools/migrar_f2.py` puebla todo desde staging aplicando las decisiones de F0 y termina con la
reconciliación contra las cifras de control (informe en `data-quality/f2_reconciliacion.md`).
Las métricas v1 sobre el modelo limpio viven en `db/migrations/0004`; `metrics.v1_vs_v0` es la
prueba de paridad contra las vistas de staging.

**Pendiente de F2 que requiere credenciales:** OIDC contra Google Workspace (crear OAuth Client ID
en Google Cloud Console → variables `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`). Hasta entonces el
front usa Basic Auth interino.
