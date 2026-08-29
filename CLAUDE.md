# PMH 2.0 — Contexto para Claude Code

Plataforma interna de gestión administrativa y financiera de proyectos de InnovaHub.
Sucesor del sistema PMH actual (AppSheet sobre Google Sheets). Repositorio **privado**.

## Antes de escribir código

1. Lee `docs/03-especificacion-funcional.md` — es el contrato del producto (principios, roles,
   12 pantallas, 12 métricas, validaciones duras).
2. Para entender los datos de origen y sus trampas: `docs/01-contexto-backend-gap-data.md`
   (especialmente su §9, "Advertencias críticas" — nombres de columna engañosos, monedas mezcladas).
3. El roadmap vive en los issues F0–F8. No adelantes bloques: cada fase tiene criterio de salida.

## Reglas del proyecto (no negociables)

- **Dinero = monto + moneda + TRM juntos**; el valor en COP es siempre columna generada, nunca
  capturada ni calculada en el front.
- **Toda métrica sale de una vista certificada** versionada en este repo con su test. El front y el
  BI nunca definen fórmulas propias.
- **Estados cambian solo por transición registrada** (actor, timestamp, motivo). Nada de editar un
  campo `status` a mano.
- **PII segregada**: datos de contacto de personas naturales en su propia tabla con RLS; jamás en
  listados, exports ni logs.
- **Migraciones de BD solo por script versionado** (nunca cambios manuales).
- **Nunca commitear**: `.env`, credenciales, datos de producción (xlsx/csv/pdf de las hojas
  actuales), datos personales. El `.gitignore` ya lo impide; no lo debilites.

## Convenciones

- Rama principal `main`; trabajo en `feat/…`, `fix/…`, `docs/…`; merge por PR.
- Commits en español, en imperativo ("Agrega wizard de alta de proyecto").
- UI en español (Colombia): fechas `27 ago 2026`, moneda `$ 4.185.598 COP`.
- Números en tablas: siempre `font-variant-numeric: tabular-nums`, alineados a la derecha.

## Stack decidido (docs/02 §6, docs/03 §8)

PostgreSQL (restricciones fuertes, RLS, ledger `money_event`, `event_log` append-only) ·
API con máquinas de estado · front web responsive/PWA · Metabase sobre vistas certificadas ·
auth OIDC contra Google Workspace. Elecciones finas de framework se toman al iniciar F2 y se
documentan en `docs/` como ADR.

## Cifras de control (corte 2026-08-27)

144 proyectos · ingreso esperado COP 6.620 M · acreditado 5.275 M · costos 2.523 M ·
contratos 221 por COP 830 M. Toda migración debe reconciliar contra estas cifras
(detalle en docs/02, Anexo B).
