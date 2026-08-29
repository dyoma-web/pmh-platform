# PMH 2.0 — Especificación funcional de la plataforma

**Producto:** sistema de gestión administrativa y financiera de proyectos de InnovaHub (sucesor de PMH/AppSheet).
**Propósito de este documento:** definir estructura del sitio, roles, indicadores, dinámicas de consumo e ingreso de información, con el nivel de detalle necesario para derivar fases de desarrollo.
**Base:** `CONTEXTO_BACKEND_GAP_DATA.md` (backend, corte 2026-08-27) + `INFORME_PMH_ANALISIS_Y_ARQUITECTURA.md` (front y BI) + concepto aprobado: *ledger financiero único, puestos de trabajo por rol con colas de acción, capa de decisión primero*.
**Fecha:** 2026-08-29.

---

## 1. Principios de producto (gobiernan todo lo demás)

1. **La página de inicio de cada rol es su lista de acciones, no un dashboard.** Los tableros existen, pero son la segunda pestaña.
2. **Un solo lugar para cada dato.** Todo movimiento de dinero es un evento del ledger; toda métrica sale de una vista certificada; ningún número se calcula en el front.
3. **El sistema hace imposible el error, no advierte sobre él.** Moneda + TRM + monto viajan juntos; los códigos se normalizan al escribir; los estados solo cambian por transición registrada.
4. **Todo semáforo tiene dueño, umbral y acción de cierre.** Un indicador que no asigna trabajo es decoración.
5. **Capturar debe sentirse como trabajar menos.** Cada campo nuevo que se pida debe eliminar un registro paralelo, una captura de pantalla o un correo.
6. **Los datos personales se ven solo bajo acción explícita y registrada.** Nunca en listados, nunca en reportes.
7. **Móvil para consultar y aprobar; escritorio para capturar y analizar.**

---

## 2. Roles y permisos

### 2.1 Roles internos (fase 1-3)

| Rol | Quiénes hoy | Qué hace en el sistema |
|---|---|---|
| **Dirección (COO)** | David Yomayusa | Ve todo. Cockpit ejecutivo, aprueba excepciones (liberación de reserva, proyectos sin presupuesto en régimen transitorio, cierres), dueño de semáforos de margen. |
| **Administración** | Andrés Guerra (Administrative PM) | Procesa solicitudes de contratación, valida pagos (segunda firma), carga/concilia contabilidad, gestiona otrosíes, cierra periodos, resuelve cola de excepciones de datos. |
| **Gestora (PM)** | 8 project managers | Crea y opera sus proyectos: presupuesto, hitos, solicitudes de contratación, autorización de pagos (primera firma), actualización de fechas y avance. Ve solo lo suyo por defecto, todo en modo lectura. |
| **Partner manager** | Aura, Wilmer, Oscar, Amagoia | Cartera y cobro: hitos por facturar/cobrar de sus clientes, aging, DSO, condiciones de pago. Edita fechas esperadas/forecast de cobro y factores de retraso. |
| **Data steward** | por designar (§10 del informe + recomendación propia) | Dueño del diccionario, de la tabla de alias de códigos y de la cola de excepciones de calidad. Puede ser sombrero de Administración, pero es un rol nombrado. |

Notas: una persona puede tener varios roles (Oscar es PM y partner manager). Los permisos son por rol acumulativo, no por menú.

### 2.2 Roles externos (fase 4, diseñados desde ya para no romper el modelo)

| Rol | Alcance |
|---|---|
| **Contratista** (portal) | Ve sus contratos y cronograma, sube cuenta de cobro y soporte de seguridad social (hoy: 150 pagos sin soporte — el portal ataca la causa raíz), ve estado de sus pagos. Cero acceso a nada más. |
| **Cliente** (portal, solo lectura) | Hitos, entregables y estado de facturación de sus proyectos. Alto valor percibido, bajo costo. |
| **Contabilidad externa** | Importa el cierre mensual (CSV/Excel) a staging; no toca producción. |

### 2.3 Matriz de permisos (resumen)

| Capacidad | COO | Admin | Gestora | Partner Mgr | Steward |
|---|---|---|---|---|---|
| Ver todos los proyectos | ● | ● | ○ (solo suyos; resto lectura) | ● (solo sus clientes en detalle) | ● |
| Alta de proyecto (wizard) | ● | ● | ● | — | — |
| Aprobar presupuesto / liberar reserva 20 % | ● | ● | solicita | — | — |
| Crear solicitud de contratación | ● | ● | ● | — | — |
| Procesar solicitud → contrato | — | ● | — | — | — |
| Autorizar pago (1.ª firma) | ● | — | ● | — | — |
| Validar pago (2.ª firma) | — | ● | — | — | — |
| Editar hitos de ingreso / fechas de cobro | ● | ● | ● (los suyos) | ● (sus clientes) | — |
| Ver PII de contratistas | ● | ● | bajo acción registrada | — | — |
| Cargar contabilidad / conciliar ledger | — | ● | — | — | ● |
| Editar catálogos (IHPSC, clientes, alias) | ● | ○ | — | — | ● |
| Administrar usuarios y roles | ● | — | — | — | — |
| Resolver cola de calidad de datos | — | ● | — | — | ● |

---

## 3. Estructura del sitio (arquitectura de información)

```
PMH 2.0
│
├── 0. MI DÍA (home por rol) ······· cola de acciones + resumen mínimo
│
├── 1. COCKPIT (dirección) ········· decisión ejecutiva
│     ├── Caja a 13 semanas
│     ├── Margen comprometido (línea · cliente · vehículo)
│     ├── Semáforos abiertos (por dueño y antigüedad)
│     └── Curva S del portafolio
│
├── 2. PROYECTOS
│     ├── Portafolio (tabla + tarjetas; filtros: estado, línea, cliente, país, gestora)
│     └── Ficha de proyecto (tabs):
│           Resumen · Presupuesto · Ingresos · Contratación ·
│           Infraestructura · Documentos · Bitácora
│
├── 3. CARTERA Y COBRO (partner managers)
│     ├── Aging 0-30 / 31-60 / 61-90 / +90 por cliente y responsable
│     ├── Calendario de hitos (esperado vs forecast)
│     └── Perfil de cliente (DSO histórico, condiciones, contratos marco)
│
├── 4. CONTRATACIÓN
│     ├── Solicitudes (kanban por estado: Solicitada → En proceso → Contratada / Cancelada)
│     ├── Contratos (libro; detalle con cronograma, otrosíes y cumplimiento)
│     ├── Pagos (cola de doble firma; bloqueo sin soporte legal)
│     └── Contratistas (directorio sin PII en listado; ficha con historial)
│
├── 5. CATÁLOGO IHPSC
│     ├── Explorador (categoría → producto → entregable → variante)
│     ├── Tarifas por perfil
│     └── Cotizador (fase 4: arma OS/propuesta desde el catálogo)
│
├── 6. INFRAESTRUCTURA
│     ├── Ítems por proyecto (estado real, vencimientos)
│     ├── Suscripciones corporativas (presupuesto vs pagado, renovaciones)
│     └── Reglas de prorrateo (recurso compartido → pesos por proyecto)
│
├── 7. FINANZAS
│     ├── Ledger (todos los eventos de dinero; filtros y export)
│     ├── Conciliación (contabilidad ↔ contratos ↔ pagos; cola de no conciliados)
│     └── Cierres mensuales (importación, validación, sello de periodo)
│
├── 8. ADMINISTRACIÓN
│     ├── Usuarios y roles
│     ├── Catálogos (clientes, países, líneas, cuentas, vehículos)
│     ├── Alias de códigos (canónico ↔ variantes históricas)
│     ├── Calidad de datos (pruebas diarias, cola de excepciones)
│     └── Auditoría (event_log consultable)
│
└── ⚑ NOTIFICACIONES (transversal: campana + digest diario por correo)
```

**Regla de navegación:** máximo 2 clics de cualquier pantalla a la ficha del proyecto implicado; el `ProjectCode` es siempre un enlace. El buscador global (⌘K) busca por proyecto, contratista, contrato, hito y cliente.

---

## 4. Especificación por pantalla (las 12 que definen el producto)

| # | Pantalla | Para quién | Contenido y componentes | Acciones |
|---|---|---|---|---|
| P1 | **Mi día** | todos | Cola de tareas priorizada (semáforos propios + firmas pendientes + vencimientos a 7 días), 3-4 cifras de contexto del rol. Vacío = "todo al día" explícito. | Resolver / posponer con motivo / ir al detalle |
| P2 | **Cockpit** | COO | 6 KPI titulares (§5), caja 13 semanas (gráfico de barras apiladas in/out + línea de saldo), tabla de semáforos abiertos con dueño y días, curva S portafolio, margen por línea (small multiples) | Drill-down a proyecto/cliente; exportar PDF del comité semanal |
| P3 | **Portafolio** | todos | Tabla densa (código, cliente, línea, gestora, estado, costeo, % ejecución presupuestal, próximo hito, semáforo) con orden/filtro/grupo; vista tarjetas opcional | Alta de proyecto (wizard), export |
| P4 | **Ficha de proyecto** | todos | Cabecera: identidad + estado + 4 cifras (costeo, acreditado, comprometido+causado, margen proyectado). Tabs de §3. Bitácora = event_log humano del proyecto | Todas las del ciclo de vida, según rol |
| P4a | **Tab Presupuesto** | gestora/admin | Versión vigente con líneas IHPSC: presupuestado / comprometido / causado / disponible, semáforo por línea (regla actual Alert-Risk-Fine, extendida), consumo de la reserva 20 % | Nueva versión (borrador→aprobación), solicitar liberación de reserva |
| P5 | **Cartera (aging)** | partner mgr, COO | Matriz cliente × tramo de antigüedad, total vencido, DSO por agencia, lista de hitos vencidos ordenada por monto con responsable | Registrar gestión de cobro, ajustar forecast de cobro, registrar factor de retraso (catálogo cerrado + nota) |
| P6 | **Solicitudes** | gestora, admin | Kanban por estado; tarjeta = proyecto, contratista, valor, días en estado. Detalle: líneas de servicio + plan de pagos + validación IHPSC ("externalizable / revisar") | Crear (gestora), procesar → genera contrato con FK (admin), cancelar con motivo |
| P7 | **Pagos a terceros** | gestora, admin | Cola de doble firma en dos bandejas (por autorizar / por validar), cada pago con documentos adjuntos visibles. **Regla dura: sin soporte legal no existe el botón de pagar.** Vencidos arriba, futuro colapsado | Autorizar (1.ª), validar y marcar pagado (2.ª), devolver con motivo |
| P8 | **Ledger** | admin, steward, COO | Tabla de eventos (fecha, proyecto, tipo, monto original, moneda, TRM, COP, documento, conciliado) con totales por moneda SIEMPRE separados y total COP generado | Filtrar, exportar, abrir documento, conciliar (P9) |
| P9 | **Conciliación** | admin, steward | Dos columnas (asiento contable ↔ pago/contrato sugerido por matching: monto+fecha+tercero), score de confianza, cola de no conciliados | Confirmar pareja, marcar overhead/bolsa, crear excepción |
| P10 | **Catálogo IHPSC** | todos (lectura), steward (edición) | Árbol navegable CCC→PPP→DDD→VVV, ficha del ítem (denominación, descripción, unidad, driver, perfil, modalidad, costo ref + fuente), cobertura de tarifas (% ítems costeados) | Proponer costo (con evidencia de contrato real), aprobar tarifa |
| P11 | **Calidad de datos** | admin, steward | Resultado del job diario: cada regla con estado, tendencia y filas afectadas; cola de excepciones con decisión y autor | Resolver excepción (corrige o registra justificación), silenciar regla con vencimiento |
| P12 | **Wizard de alta de proyecto** | gestora | 5 pasos: 1) Identidad (código canónico autogenerado + alias visible) · 2) Cliente y contrato marco · 3) Financiero (monto+moneda+TRM = un solo control compuesto; costeo calculado en vivo) · 4) **Presupuesto por ítem (obligatorio: mínimo las líneas que suman el 100 % del presupuesto de implementación)** · 5) Fechas e hitos de ingreso (al menos 1) | Guardar borrador; `Active` solo si pasa validación completa |

**Estados vacíos:** toda pantalla define su estado vacío con la acción que lo llena ("Este proyecto no tiene presupuesto. Crear presupuesto →"). Nunca una tabla en blanco sin explicación (lección directa del Budget actual).

---

## 5. Indicadores (métricas certificadas)

Única fuente: vistas materializadas versionadas, con test diario contra cifras de control. Definición completa aquí; ninguna herramienta redefine.

| ID | Métrica | Fórmula (resumen) | Dueño | Umbral semáforo | Pantalla |
|---|---|---|---|---|---|
| M1 | **Caja proyectada 13 semanas** | Σ cobros probables (hito × prob. por cliente derivada del DSO) − pagos comprometidos − costo fijo mensualizado | COO | saldo semanal < 0 → rojo | P2 |
| M2 | **Margen comprometido** por proyecto/línea/cliente | (ingreso adjudicado − causado − comprometido no pagado) / adjudicado | COO | < pMargin costeado − 5 pp | P2, P4 |
| M3 | **Ejecución presupuestal** por línea de presupuesto | (causado + comprometido) / presupuesto aprobado | Gestora | > 85 % con avance < 70 % | P4a |
| M4 | **Consumo de reserva** | reserva liberada y consumida / 20 % | Admin | > 50 % sin aprobación COO | P4a |
| M5 | **Cartera vencida y aging** | hitos Scheduled/Invoiced con expected < hoy, por tramo | Partner mgr | cualquier +30 días | P5 |
| M6 | **DSO por cliente** | media(credited − expected) ponderada por monto, 12 m móviles | Partner mgr | informativo (alimenta M1) | P5 |
| M7 | **Backlog** | adjudicado no facturado, por mes esperado de ejecución | COO | < 3 meses de costo fijo | P2 |
| M8 | **Cumplimiento legal de pagos** | pagos pagados con soporte completo / pagados | Admin | < 100 % | P7, P11 |
| M9 | **Costo de infraestructura por proyecto** | eventos infra normalizados a COP + prorrateo por regla | Infra/Admin | ítem ON con fin vencido | P6 infra |
| M10 | **Salud del dato** | % de pruebas de calidad en verde | Steward | < 100 % dos días seguidos | P11 |
| M11 | **Cobertura de tarifario** | ítems IHPSC con costo ref validado / ítems vendidos 12 m | Steward/COO | < 80 % de lo vendido | P10 |
| M12 | **Ciclo de contratación** | mediana(días solicitud → contrato firmado) | Admin | > 10 días hábiles | P6 |

Reglas transversales: todo monto agregado se muestra **en COP** con la TRM del evento; los totales por moneda original siempre disponibles al expandir. Los umbrales viven en configuración, no en código.

---

## 6. Dinámicas de consumo de información

| Ritmo | Qué pasa | Canal |
|---|---|---|
| **Diario (7:00)** | Digest por rol: tus tareas nuevas, tus semáforos, cambios en tus proyectos. Máximo 1 correo/día por persona | Email + campana in-app |
| **Diario (job nocturno)** | Pruebas de calidad de datos, recálculo de vistas, detección de vencimientos | Sistema → P11 y colas |
| **Lunes** | Cockpit actualizado para comité: PDF de una página autogenerado (KPIs + semáforos + top 5 acciones) | P2 → export |
| **Cierre mensual** | Importación contable → conciliación → sello del periodo (los eventos del periodo sellado quedan inmutables; ajustes = eventos nuevos) | P7 finanzas |
| **Ad hoc** | Exploración libre en Metabase sobre las MISMAS vistas certificadas; exportes CSV/Excel desde cualquier tabla | BI |
| **Móvil** | PWA: Mi día, aprobar/validar pagos, consultar ficha de proyecto y cartera. Sin captura compleja en móvil | PWA |

**Anti-patrón prohibido:** notificar sin acción posible. Cada notificación enlaza al lugar exacto donde se resuelve.

---

## 7. Dinámicas de ingreso de información

### 7.1 Patrones de captura

1. **Wizard con validación bloqueante** (alta de proyecto, P12): no existe "guardar incompleto y activar"; existe borrador.
2. **Control compuesto de dinero:** un solo widget captura monto + moneda + TRM (con TRM del día sugerida y editable, marcando pactada vs mercado). Imposible capturar un monto sin moneda.
3. **Códigos canónicos con autocompletado:** el usuario nunca tipea un `ProjectCode` ni un código IHPSC a mano; siempre selecciona. La normalización (tildes, prefijos) ocurre al crear, con el alias visible.
4. **Acciones de estado, no edición de campos:** los estados cambian con botones ("Procesar solicitud", "Validar pago", "Marcar acreditado") que piden lo mínimo necesario (fecha real, documento, motivo) y registran actor y timestamp.
5. **Documentos con deduplicación:** el upload calcula hash; si ya existe, referencia el existente. Tipos exigidos por contexto (cuenta de cobro ≠ soporte legal ≠ factura).
6. **Importación masiva con staging:** el cierre contable mensual entra por plantilla → validación → vista previa de excepciones → confirmación. Nada entra directo a producción.
7. **Edición en línea solo para campos sin consecuencias** (notas, links); todo lo financiero pasa por formulario con confirmación.

### 7.2 Quién ingresa qué (mapa de captura)

| Información | Quién | Cuándo | Pantalla |
|---|---|---|---|
| Proyecto + costeo + presupuesto + hitos | Gestora | Al ganar el contrato | P12 |
| Cambios de alcance/monto (otrosí, adenda cliente) | Admin | Al firmarse | P4 (nueva versión) |
| Factura emitida / dinero acreditado | Partner mgr o Admin | Al ocurrir | P4/P5 (acción) |
| Solicitud de contratación + servicios + plan de pagos | Gestora | Antes de necesitar al tercero | P6 |
| Contrato (generado desde solicitud) + firma | Admin | Al procesar | P6 |
| Cuenta de cobro + soporte legal | Contratista (fase 4) / Admin (interín) | Cada pago | P7 / portal |
| Cierre contable | Contabilidad → Admin | Mensual | P7 finanzas |
| Ítems y pagos de infraestructura | Admin/Infra | Al contratar/pagar | P6 infra |
| Tarifas y costos de referencia IHPSC | Steward (propone gestora) | Continuo | P10 |
| Avance de entregables (fase 4) | Gestora | Semanal | P4 |
| Dedicación por persona/semana (fase 4) | Gestora | Semanal, 5 minutos | P4 |

### 7.3 Validaciones duras en la captura (el motor las impone)

- Moneda ∈ ISO-4217; TRM > 0; montos ≥ 0 salvo tipos de ajuste.
- Proyecto `Active` ⇒ presupuesto aprobado + fecha de cierre futura + ≥ 1 hito de ingreso.
- Fecha de cierre vencida ⇒ el sistema exige prórroga (nueva fecha + motivo) o cierre; mientras tanto el proyecto queda `en_regularizacion`, visible en Mi día de la gestora.
- Pago no puede marcarse pagado sin: 1.ª firma + 2.ª firma + cuenta de cobro + soporte legal.
- Contrato solo nace desde solicitud procesada (FK obligatoria); otrosí crea versión de monto, nunca sobrescribe.
- Asiento contable requiere proyecto válido (o bolsa explícita con regla de prorrateo) y cuenta mapeada.
- PII: contrato no se emite sin autorización de tratamiento de datos registrada.

---

## 8. Requisitos no funcionales

| Área | Requisito |
|---|---|
| Autenticación | OIDC contra Google Workspace; sesión única; sin contraseñas propias |
| Autorización | Roles acumulativos + RLS en BD (la API no puede saltarse la política) |
| Auditoría | `event_log` append-only: quién, qué, antes/después, cuándo; consultable en P8 admin |
| Privacidad | PII en tabla segregada, acceso registrado, retención definida (Ley 1581/2012) |
| Disponibilidad | Objetivo 99.5 %; backups diarios cifrados; restauración probada trimestralmente |
| Rendimiento | Portafolio y colas < 1 s con 10× el volumen actual (≈ 45 k asientos) |
| Accesibilidad | WCAG 2.1 AA; navegable por teclado; números tabulares en toda tabla |
| Idioma | UI en español; datos y códigos como están (mixto ES/EN); arquitectura lista para EN |
| Dispositivos | Responsive real; PWA instalable para aprobar en móvil |
| Exportación | CSV/Excel en toda tabla; PDF en cockpit y ficha de proyecto |
| Integraciones | Import contable (plantilla), export a Metabase (vistas), Google Drive (enlaces legados solo lectura), futura API de facturación GCloud (BigQuery export) |

---

## 9. Insumo para fases de desarrollo (pre-descomposición)

Bloques en orden de dependencia — el detalle de fases se acordará sobre esta lista:

1. **F0 · Saneamiento** (sin código de producto): cola de excepciones del informe §6.5, alias de códigos, costeo de ~40 ítems IHPSC, diccionario de métricas firmado.
2. **F1 · Réplica limpia + Cockpit lectura** (valor en semana 3): sync hojas→Postgres staging→vistas certificadas; P2, P5 y P11 en solo lectura; digest diario.
3. **F2 · Núcleo transaccional**: esquema definitivo + ledger + documentos + auth/RLS + auditoría. Migración con conciliación contra cifras de control (Anexo B del informe).
4. **F3 · Módulo Contratación completo** (primer módulo de captura): P6, P7, portal-interín de soportes; apagar Hiring Menu de AppSheet.
5. **F4 · Ingresos y Cartera**: P4 ingresos, P5 edición, acciones de facturar/acreditar; apagar Invoice Information.
6. **F5 · Proyectos y Presupuesto**: P12 wizard bloqueante, P4a, liberación de reserva; apagar Project Upload/Control.
7. **F6 · Finanzas**: importación contable, conciliación P9, sello de periodo, prorrateo de infraestructura por regla; apagar hojas de costos.
8. **F7 · Decisión completa + BI**: M1-M12 en producción, Metabase, PDF de comité; apagado total de AppSheet y Power BI actual.
9. **F8 · Potenciación**: cotizador IHPSC, entregables y avance (valor ganado), capacidad por persona/semana, portales externos.

Criterio de éxito global (heredado del informe y vinculante): **las 9 preguntas de dirección del §4 del informe respondidas desde el sistema.** Hoy: 1,5. Tras F5: ≥ 6. Tras F8: 9.

---

*Este documento define el QUÉ. El CÓMO visual se define en `BRIEF_DISENO_PMH2.md`; el CUÁNDO se acordará descomponiendo la §9 en sprints con el equipo de desarrollo.*
