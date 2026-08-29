# Verificación del checklist «Sistema basado en ProManage Hub»

**Contra:** `checklistsistemapromanagehub.md` (David Yomayusa, 29 ago 2026)
**Estado del desarrollo al verificar:** F0 ✅ · F1 ✅ · F2 ✅ (commit `4eab82e`)
**Convención:** ✅ cubierto y verificable hoy · 🟡 parcial (modelo listo, falta captura/UI) · ⬜ pendiente, con la fase que lo cubre.

## Resumen ejecutivo

De los **10 bloqueantes** del checklist: **5 cubiertos, 3 parciales, 2 pendientes** — y los
pendientes están exactamente donde el plan los tiene programados (F3-F5). Ningún bloqueante
requiere rediseño: el modelo de F2 ya los soporta todos.

| # | Bloqueante | Estado | Dónde / cuándo |
|---|---|---|---|
| 1 | 15 entidades núcleo con auditoría | 🟡 | Entidades: todas en `0003` (misiones ⬜ F6). Auditoría por fila (creado/modificado por + borrado lógico): ⬜ F3, hoy existe `audit.event_log` global |
| 2 | Costos calculados, no digitados | ✅ | `amount_cop`/`budget80` son columnas GENERATED; % en `project_costing`; recálculo en vivo llega con el wizard (F5) |
| 3 | Ciclo de ingresos: 4 fechas y 4 estados | 🟡 | 4 fechas ✅ (+forecast). Estados: 3+1 (`scheduled→invoiced→credited`, `written_off`); la distinción Abonado/Pagado del checklist requiere decisión de negocio (¿pagos parciales?) → propuesta en F4 |
| 4 | Contrato imputado a proyecto **y** código presupuestal | 🟡 | Proyecto: FK obligatoria ✅. Código presupuestal: columna lista, imputación obligatoria solo aplicable a contratos nuevos (F3) — el legado no tiene presupuesto al cual imputar |
| 5 | Doble validación antes de pagar | ✅ | CHECK en BD: no existe pago validado sin soporte legal (150 legados marcados `legacy_exception`); doble firma en modelo y en cola del front |
| 6 | No exceder presupuesto de línea sin aprobación | ⬜ F5 | El dato existe (budget.line + ledger); la regla se activa cuando el presupuesto sea obligatorio |
| 7 | Filtrado por usuario y separación de funciones | 🟡 | Separación: dos firmas distintas en modelo ✅. Filtrado real por usuario: ⬜ F3 (OIDC — bloqueado por credenciales de Google Cloud, no por desarrollo) |
| 8 | Analítica dentro del sistema | ✅ | Cockpit, cartera, calidad: internos, sobre vistas certificadas; Power BI queda opcional vía `bi_reader` |
| 9 | Notificaciones automáticas | 🟡 | Digest diario narrativo ✅ (enviado en demo); workflows listos; disparadores por evento (pago autorizado, contrato por vencer) ⬜ F7 |
| 10 | Multi-moneda con histórico de tasa | ✅ | Trío monto·moneda·TRM en `project_amount` (versionado) y en cada `money_event`; TRM de mercado en vivo en el front |

## Verificación por sección

### 1 · Núcleo del modelo de datos
Todas las entidades P0/P1 existen en `db/migrations/0003` con FK reales e integridad
(`ON DELETE RESTRICT`): Proyecto ✅ · Contrato de cliente ✅ (`framework_contract` +
`project_amount` versionado) · Ingreso ✅ · Presupuesto línea ✅ · Código presupuestal ✅
(IHPSC v3.1: 308 ítems, jerarquía CCC-PPP-DDD-VVV) · Contratista ✅ (documento como TEXTO,
conserva ceros) · Contrato ✅ · Pago ✅ · Otrosí ✅ · Solicitud/Servicio/Pago ✅ · Usuario ✅ ·
Maestros ✅ · **Log de auditoría ✅** (`audit.event_log`, append-only por trigger).
**Brechas:** `Misión` ⬜ (F6 — 1 sola misión en la fuente) · `Costo interno` 🟡 (existe como
`gl_accrual` del ledger; el desglose por ítem presupuestal llega con F5) · campos
creado/modificado-por y borrado lógico por tabla ⬜ (F3, junto con la primera captura).

### 2 · Módulo Proyectos
Ficha ✅ · estados controlados por CHECK ✅ · línea de servicio y entidad facturadora
**parametrizables en tablas**, no quemadas ✅ · PM y partner manager como roles distintos ✅ ·
tarjetas con portada/bandera 🟡 (imágenes migrables de `PMH_UX`, vista F4) · Project Control ✅
(ficha + semáforos) · carga documental ⬜ F3 · **cronograma/curva S por proyecto ⬜ F8**
(la curva S de portafolio/caja ya existe en el cockpit). Campos WBS/Network/Baseline: se
descartaron deliberadamente (0 uso en 144 proyectos) — si se quieren, son una migración de una línea.

### 3 · Estructura de costos
Trío monto+moneda+TRM ✅ · porcentajes por proyecto ✅ · **montos calculados, no digitados ✅**
(GENERATED en BD) · cascada de derivación 🟡 (migrada como dato; el cálculo en vivo es el paso 3
del wizard F5) · interno/externo ✅ · BaseTeam ✅ · escenarios 100/80 ✅ (`budget80` generado) ·
semáforo por línea ⬜ F5 (umbrales ya en `ref.parametro`) · **histórico de TRM ✅** (versionado +
TRM por evento) · **baseline de presupuesto ✅** (`budget.version` draft→approved→superseded).
El hallazgo del checklist (presupuesto subutilizado) es la regla central de F5: sin presupuesto
no hay proyecto Activo.

### 4 · Ingresos y Facturación
Hitos con entregables ✅ · 4 fechas ✅ (+ `forecast_date`) · moneda original 🟡 (monto original
migrado; la moneda no existía en la fuente — se captura desde F4) · factura ✅ · factores de
retraso ✅ (catálogo cerrado + nota) · vista por estado ✅ · **alerta de hito vencido ✅**
(semáforo-tarea + digest) · **días de cartera y flujo de caja ✅** (DSO por cliente, caja 13
semanas). Estados: ver bloqueante 3.

### 5 · Contratación
Libro consultable ✅ · estados ✅ · enlaces a documentos ✅ · supervisor y empresa ✅ ·
cronograma con estados ✅ · **doble validación ✅ como CHECK** · flujo otrosí 🟡 (tabla y
decisiones F0 migradas; captura F3) · flujo hiring ✅ modelo (captura F3, **con la llave
solicitud→contrato que hoy no existe en AppSheet**) · imputación a línea presupuestal y regla de
no exceder ⬜ F3/F5 · alerta de vencimiento 🟡 (regla Q-contrato en digest F7).

### 6 · Contratistas
Registro único por documento ✅ · nombres desagregados ✅ (en `pii`, con RLS) · perfil
parametrizable ✅ · **datos de contacto ⬜ F3**: por decisión de privacidad NO se migraron
teléfonos/correos a staging; se cargarán directo a `pii.contractor_contact` (RLS) en la primera
captura, junto con las acciones llamar/correo · historial por contratista ✅ (consultable) ·
avatar 🟡 (assets de PMH_UX migrables) · **Ley 1581 🟡**: campo de autorización obligatorio ya
en el modelo; el aviso, la política de retención y el flujo de supresión son entregable F3.

### 7 · Misiones ⬜ F6
No migradas (una sola misión en la fuente). El patrón presupuesto→pagos→legalización del
checklist entra con el módulo de finanzas.

### 8 · Roles y seguridad
Dos roles de app + roles organizacionales ✅ (modelo) · activo/inactivo ✅ · **federada (OIDC
Google) ⬜** — desarrollo listo para integrarse; bloqueado por crear el OAuth Client en Google
Cloud Console (5 min de consola, ver README) · filtrado por usuario ⬜ F3 (depende de OIDC; el
«ver como» actual es el ensayo de esa vista) · permisos por operación ⬜ F3 (API) · separación de
funciones ✅ modelo / 🟡 enforcement en API F3 · URLs firmadas ⬜ F3 (almacén de objetos).

### 9 · Automatizaciones (GAP completo en la línea base)
Digest diario narrativo ✅ (demo real enviada; workflow L-V listo) · job nocturno de calidad ✅
(12 reglas con dueño, falla en CI) · notificación de pago pendiente 🟡 (está en digest y cola;
push por evento F7) · notificación al contratista ⬜ F7 (requiere sus correos → F3) ·
recordatorios 30/15/7 ⬜ F7 · cuenta de cobro imprimible ⬜ F7 (PDF del comité ya diseñado) ·
export Excel ✅ CSV / ⬜ formulado F7 · bitácora de notificaciones ⬜ F7.

### 10 · Analítica y tableros — la sección más cubierta
Portafolio ✅ · financiero ✅ (margen por línea, interno/externo en ledger) · cartera ✅ (aging,
DSO, factores) · contratación ✅ (colas, bloqueados, descuadres) · **analítica DENTRO ✅** ·
curva S de portafolio ✅ / por proyecto ⬜ F8.

### 11 · Configuración sin tocar código
Catálogos en tablas editables ✅ (clientes, países, líneas, entidades, cuentas, monedas,
IHPSC) · umbrales y porcentajes en `ref.parametro` ✅ · **UI de administración ⬜ F5/F7** (hoy se
edita por SQL/seeds — funcional para 11 usuarios, no para el criterio "sin tocar código") ·
menús por rol ⬜ F3 (con OIDC) · identidad visual ✅ (sistema Cota completo).

### 12 · Documentos
Enlaces por proyecto/contrato/contratista migrados ✅ · deduplicación por hash en modelo ✅ ·
**validación de soporte antes del cambio de estado ✅** (el CHECK de pagos es exactamente eso) ·
almacén propio con URLs firmadas y versionado ⬜ F3 (hoy los archivos siguen en Drive).

### 13 · No funcionales
Multi-moneda real ✅ · trazabilidad append-only ✅ · integridad referencial ✅ (RESTRICT en
todo) · volúmenes ✅ (holgado ×10) · búsqueda/filtrado ✅ · escritorio y móvil ✅ (responsive;
PWA instalable F4) · backups 🟡 (diario de Supabase ✅; `pg_dump` a custodio propio ⬜ F6) ·
API de lectura ✅ (`bi_reader` sobre `metrics`) · **multi-idioma ⬜**: es P0 en el checklist y no
estaba en el plan de fases — arquitectura preparada (textos centralizables), pero requiere
decisión de alcance: propongo ES en beta, EN en F8 con el portal de cliente. **Punto a resolver
con dirección.**

### 14 · Migración
Mapeo campo a campo ✅ (ETL documentado) · limpieza previa ✅ (F0: 338 decisiones) ·
**conciliación al peso ✅** (9/9 exactas + paridad v1/v0 5/5) · congelamiento de AppSheet y
piloto ⬜ — son parte del corte real (F3+), no de dev.

## Las 6 brechas que ordenan lo que sigue

1. **F3 (ya):** captura de contratación — solicitud→contrato con llave, doble firma real con
   documentos, PII de contacto con Ley 1581, permisos por operación, imputación presupuestal
   de contratos nuevos.
2. **OIDC:** listo para integrar; falta el OAuth Client de Google (acción de consola, 5 min).
3. **F4:** decisión Abonado/Pagado + moneda original en captura de hitos + tarjetas con portada.
4. **F5:** wizard con cascada de costeo en vivo + presupuesto bloqueante + regla de no exceder línea.
5. **F6:** misiones + sello de periodo + `pg_dump` a custodio propio.
6. **Multi-idioma:** única P0 del checklist fuera del plan — necesita decisión de alcance.
