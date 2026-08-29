# Contexto de backend — Sistema GAP_DATA / PMH (InnovaHub)

> **Para quién es este documento.** Eres un agente de IA que interactúa con el *front* de una aplicación
> AppSheet llamada **PMH (Project Management Hub)** de InnovaHub. Este documento describe el *backend*
> completo que alimenta esa app: sus tablas, llaves, vocabularios, lógica de negocio y —muy importante—
> sus defectos conocidos. Fue generado el **2026-08-27** a partir de una lectura exhaustiva de las hojas
> de cálculo fuente (verificación fila a fila de llaves foráneas, perfilado de todas las columnas,
> cruce de adjuntos contra disco). Todo conteo y cifra corresponde a ese corte.
>
> **Cómo usarlo.** Antes de interpretar cualquier dato que veas en el front, consulta la sección
> [Advertencias críticas](#9-advertencias-críticas-de-interpretación). Varios campos tienen nombres
> engañosos y varias columnas numéricas mezclan monedas: sumarlas sin leer esas advertencias produce
> resultados erróneos. Los nombres de tablas y columnas se transcriben **exactamente como existen**,
> incluidas las erratas (`ProjectMaganer`, `BudgeProposal`, `Deriverable`…): esas erratas SON los nombres
> reales de los campos; úsalas tal cual.

---

## 1. Qué es el sistema

- **Empresa:** InnovaHub — consultora de e-learning, comunicación y tecnología para desarrollo.
  Opera con dos vehículos que actúan como pagadores/facturadores: **InnovaHub Colombia SAS** (`SAS`,
  NIT 901.172.967-2, pesos colombianos) e **InnovaHub LLC** (`LLC`, EE. UU., USD). Además factura a
  través de LTA (Long Term Agreements) personales: `LTA Wilmer`, `LTA Oscar`, `LTA Amagoia`.
- **Clientes:** principalmente agencias de Naciones Unidas (UNDP/PNUD 61 proyectos, UNICEF 35, FAO,
  UNFPA, UNWOMEN, UNHCR), más WWF, Santillana, CAF, GIZ, ECORYS, IDB, CSJ (Consejo Superior de la
  Judicatura de Colombia), ICANH, OIJ, IDEA, Wageningen, P4C, Unión Europea. 22 países de operación
  (Panamá 37, Venezuela 21, Colombia 18, México 12, Costa Rica 11…).
- **Plataforma:** AppSheet (Google) sobre Google Sheets. Cada tabla del modelo es una hoja de cálculo;
  AppSheet genera los IDs de fila (hex de 8 dígitos o correlativos) y guarda los archivos adjuntos en
  carpetas `"<Tabla>_Files_"` y `"<Tabla>_Images"` junto a la hoja, escribiendo en la celda la **ruta
  relativa** del archivo (p. ej. `inf_data_costs_Files_/0f3dc9a6.Invoice.013057.pdf`).
- **Escala (corte 2026-08-27):** 144 proyectos (53 activos, 87 completados, 3 cancelados, 1 pausado),
  339 hitos de ingreso, 4.439 asientos de costo, 221 contratos con terceros, 97 solicitudes de
  contratación 2026, 73 contratistas, 48 ítems de infraestructura por proyecto, ~27 suscripciones SaaS
  corporativas.
- **BI:** el menú "Dashboard" de la app es un enlace externo a un informe de **Power BI** publicado.

---

## 2. Mapa front → back

La configuración visual de la app vive en `APPSHEET_DATA/PMH_UX.xlsx`. El menú (hoja `PMH_UX_MENU`
para rol Admin; `PMH_UX_MENU_USER` para rol User) mapea así:

| Ítem del menú (front)   | Vista/Location        | Tabla(s) de backend                                    |
|-------------------------|-----------------------|--------------------------------------------------------|
| Dashboard               | enlace Power BI       | (externo)                                              |
| Project Information     | `Project Cards`       | `GAP_DATA_01_PROJECTS`                                 |
| Project Upload          | `Project Upload`      | `GAP_DATA_01_PROJECTS` (captura) — **solo Admin**      |
| Invoice Information     | `INVOICE_01_INFORMATION` | `GAP_DATA_03_INCOME`                                |
| Budget                  | `Budget`              | `GAP_DATA_02_BUDGET`                                   |
| Contract book           | `CONTRACTS_01_BOOK`   | `GAP_DATA_07A_CONTRACTS` (+ 07B pagos, 07C adendas)    |
| Contractors             | `Contractors`         | `GAP_DATA_08_CONTRACTORS`                              |
| Hiring Menu             | `HIRING_01_MENU`      | `GAP_DATA_07C1_REQUEST` + `07C2_SERVICES` + `07C3_PAYMENTS` |
| Project Control         | `Project Control`     | `GAP_DATA_01_PROJECTS` (formulario `GlobalControl`)    |
| UX customization        | `UX_01_MENU`          | hojas `PMH_UX_*` — **solo Admin**                      |

- **Usuarios y roles** (`GAP_DATA_01_PROJECTS.xlsx`, hoja `GAP_DATA_01A_PM`): 11 usuarios con correo
  `@innovahub.org`. `APP_Role`: `Admin` (David Yomayusa, Andrés Guerra) o `User`. `IH_Role`:
  `Project Manager` o `Administrative Project Manager`. `Status`: `Active`/`Inactive` (inactivas:
  Angélica Cárdenas, Erika Ramírez).
- **Catálogos visuales:** `PMH_UX_CLIENTS` (21 clientes con logo), `PMH_UX_COUNTRIES` (22 países con
  bandera), `PMH_UX_PROFILES` (6 perfiles de contratista con avatar). Coinciden 1:1 con los valores
  usados en el maestro de proyectos.
- **Colores en formularios** (única documentación original que existía): morado `#9000a6` = campo no
  editable; naranja `#ff6000` = campo editable.

---

## 3. Diccionario de entidades

Convención de nombres: cada archivo `GAP_DATA_NN_*.xlsx` contiene una tabla principal homónima y a
veces sub-tablas con sufijo letra (`07A`, `07B`, `07C1`…). El prefijo numérico ordena el dominio.

### 3.1 `GAP_DATA_01_PROJECTS` — Maestro de proyectos (144 filas, 42 columnas)

Llave: **`ProjectCode`** (única, es la FK usada por casi todas las demás tablas).

| Grupo | Columnas | Semántica |
|---|---|---|
| Identidad | `ProjectCode`, `Identifier` | Código legible (ver §5.1) y hash corto generado (p. ej. `apav2V12023-05a5`). |
| Clasificación | `ServiceLine`, `Status`, `Country`, `PartnerEntity`, `ContractCategory` | `ServiceLine` ∈ {`C4D` 83, `EL4D` 41, `TECH4D` 12, `SYS4D` 6, `CA4D` 2}. `Status` ∈ {`Active`, `Paused`, `Cancelled`, `Completed`}. `ContractCategory` = vehículo que factura ∈ {`InnovaHub Colombia SAS`, `InnovaHub LLC`, `LTA Wilmer`, `LTA Oscar`, `LTA Amagoia`, `Terceros`}. |
| Responsables | `ProjectManager`, `PartnerManager` | PM = gestora interna (FK a `01A_PM.User`). PartnerManager = quien gestiona la relación/facturación con el cliente ∈ {Aura Romualdo, Wilmer Castañeda, Oscar Rodríguez, Amagoia Salazar}. |
| Documentos | `ContractID`, `Contract`, `BudgeProposal` (sic) | `ContractID` referencia el contrato marco (FK débil a `GAP_DATA_12_CORP_CONTRACTS`, solo 44/144 lo tienen). `Contract` y `BudgeProposal` son URLs de Drive. |
| Fechas | `StartDate`, `ClosingDate` | ⚠ Muy desactualizadas (ver §9.2). |
| Económico | `ContractAmount`, `Currency`, `ExchangeRate`, `CostingAmount`, `CostingCurrency` | `ContractAmount` en la **moneda original** (`Currency` ∈ USD/COP/EUR/CLP). `CostingAmount` es el valor **en COP** usado para costear. En teoría `CostingAmount = ContractAmount × ExchangeRate` (TRM pactada), pero difiere >1 % en 62/137 casos (adendas no trazadas). ⚠ `CostingCurrency` contiene números, no monedas. |
| Costeo % | `pMargin`, `pAyF`, `pUnforeseen`, `pICA`, `pCommission` | Porcentajes aplicados sobre `CostingAmount`. Valores típicos: margen 10-15 %, AyF (administración y funcionamiento) 10-15 %, imprevistos 0-10 %, ICA 1 % (impuesto de industria y comercio), comisión usualmente 0. |
| Costeo COP | `Margin`, `AyF`, `Unforeseen`, `ICA`, `Commission`, `BaseTeam`, `ImplementationBudget`, `ImplementationReserve`, `EstimatedBudget`, `ManagementBudget`, `InternalCost`, `ExternalCost` | Resultados en COP. `BaseTeam` = costo del equipo interno base. `ImplementationReserve` ≈ 20 % del presupuesto de implementación (retención de control). Ver fórmulas en §5.2. |
| Sin uso | `InitiationAct`, `WBS`, `Network`, `Baseline`, `Column 42` | Siempre vacías. Diseño aspiracional nunca operado. |

**Hoja `GlobalControl`** (mismo archivo): formulario de control de UN proyecto a la vez — selecciona un
`ProjectCode` (validación de lista contra la tabla) y muestra su ficha, su flujo de caja (`Total
payments`, `Outstanding` con fórmulas SUMIFS por estado) y la validación de macro-costos previsto vs
real. Es la vista "Project Control" del front.

### 3.2 `GAP_DATA_02_BUDGET` — Presupuesto por ítem (23 filas) + catálogo de códigos v1 (22)

- `GAP_DATA_02_BUDGET`: presupuesto desagregado por ítem codificado. Columnas: `Id`, `ProjectCode`,
  `Code` (código IHPSC v1 tipo `STF-CNS-DVA-IHS`), `CodeUnique` (= Code + correlativo `-001`),
  `Details`, `Unity`, `Quantity`, `UnitaryPrice`, `TotalPrice`, `Budget100`, `Budget80` (= 80 % del
  total; el 20 % es la reserva), `BudgetManagement`, `CoveredBy` (siempre `Contract`), `Deploying`
  (quién ejecuta: Project Manager / Infraestructure / Administrative PM), `Implementation`
  (`Internal`/`Exterrnal` — sic), `Comments`.
- ⚠ **Solo 2 de 144 proyectos** tienen presupuesto aquí (`arg_pnud_a2030_v1_2023`,
  `es_santillana_richmond_2026`). La vista "Budget" del front mostrará casi siempre vacío.
- `GAP_DATA_02A_CODES`: catálogo de 22 códigos `CCC-PPP-DDD-VVV` **de la versión 1** del IHPSC
  (anterior al rediseño; ver §6). Es el vocabulario que usan `05_PAYMENTS.Code` y `06_INFRA.Code`.

### 3.3 `GAP_DATA_03_INCOME` — Hitos de facturación y cobro (339 filas)

Un registro = un hito de pago pactado con el cliente para un proyecto. Es la vista "Invoice
Information" del front.

- Columnas: `Id` (6 alfanum), `ProjectCode`, `ContractDate` (fecha del hito según contrato),
  `ExpectedDate` (fecha esperada de cobro), `InvoiceDate`, `Invoice` (URL Drive de la factura),
  `CreditedDate` (fecha en que el dinero entró), `Currency`, `ExpectedCOP`, `Status`, `Deliverables`
  (texto: qué se entrega en este hito), `Remarks`, `DelayFactors`.
- **Ciclo de estados:** `Scheduled` (programado, 40) → `Invoiced` (facturado, 12) → `Credited`
  (acreditado/cobrado, 286). Existe 1 fila anómala `Paid` (tratar como `Credited`).
- ⚠ **`Currency` NO es la moneda: es el MONTO en la moneda original** (p. ej. `6000` = USD 6.000, o
  `323459536` = COP). La moneda no se registra en esta tabla; se infiere del proyecto. `ExpectedCOP`
  es el monto convertido a COP — usa siempre `ExpectedCOP` para agregar.
- `DelayFactors`: mezcla categorías (`EXTERNO` 23, `INTERNO` 6) con texto libre.
- Totales de control: ExpectedCOP Σ = 6.620 M COP; Credited = 5.275 M; pendiente (Scheduled+Invoiced) =
  1.337 M, de la cual 903 M ya vencida al corte.

### 3.4 `GAP_DATA_04_COSTS` — Costos contables (4.439 filas) + causación interna (144)

- `GAP_DATA_04_COSTS`: asientos de la contabilidad de la SAS imputados a proyecto, con cierres
  mensuales de **ene-2024 a jun-2026** (campo `Trimming` = fecha de cierre del mes). Columnas:
  `ProjectCode`, `Account` (código contable PUC, p. ej. 740510), `AccountName`, `Contractor`
  (⚠ texto libre `"cédula - NOMBRE"`, sin FK), `Amount` (COP), `Trimming`, `Validaciones`, `Comments`.
- Incluye "proyectos" que son bolsas contables, no proyectos: `Amortizacion de costos`,
  `Infraestructura Interna`, `Operaciones`.
- La nómina/el equipo interno se causa a proyectos vía estas cuentas (los mayores "contractors" por
  monto son las propias gestoras del equipo). Por tanto el costo por proyecto **incluye mano de obra
  interna**, no solo terceros.
- `GAP_DATA_04A_COSTS_INTERNAL`: causación por ítem presupuestal (`CodeUnique`) — solo poblada para
  `arg_pnud_a2030_v1_2023` (144 filas, `Validations` ∈ {`CAUSACION`, `IMPUTACION`}).
- Homologación de cuentas: `GAP_DATA_09_ACCOUNTS` (hoja `fal_accounts`) mapea `account` →
  `new_account` (9 categorías de gestión: Pedagogical Advisory, Design and Visual Arts, Project
  Management, Missions, Expert consultants, Technology Advisory, Software Services, Stationery…,
  Other). ⚠ 20 de las 33 cuentas presentes en COSTS no están en este mapeo.

### 3.5 `GAP_DATA_05_PAYMENTS` — Pagos de infraestructura (271) + suscripciones corporativas (263)

Dos hojas distintas en el mismo archivo:

- `GAP_DATA_05_PAYMENTS` (por proyecto): pagos de dominios, servidores, plugins, chatbots imputados a
  un `ProjectCode`. Columnas: `Id`, `ProjectCode`, `Code` (IHPSC v1, dominado por `TIN-SRV-MNT-MNT`
  servidores y `TIN-DOM-MNT-MNT` dominios), `ProductKey` (= `ProjectCode-Code-IdInfra`, enlaza con el
  ítem de infraestructura de la tabla 06), `Date`, `Cost`, `Payor` (siempre `SAS`), `Details`
  (⚠ aquí va la MONEDA: USD/COP/…; 95 filas sin ella), `Contract`, `Invoice` (ruta a adjunto),
  `Status` (todos `Paid`), `Comment`.
- `inf_data_costs` (corporativa, sin proyecto): pagos de suscripciones SaaS de la empresa
  (Anthropic/Claude, Google Workspace y Cloud, Adobe, Descript, OpenAI, Miro, Genially, ElevenLabs,
  Midjourney, Lovable, GoDaddy…). `Code` = código de la suscripción con fecha de vigencia
  (`CPE-ADO-ADS_20250101`), `Details` = moneda, `Contract` = periodicidad (`Mensual`/`Anual`/`Pago
  único`), `Invoice` = ruta al PDF adjunto (243/263 con soporte). Estado `Paid` salvo 1 `Forecasted`.
- ⚠ En ambas hojas `Cost` **mezcla monedas** (USD 0,08 convive con COP 4.185.598). Nunca sumar sin
  agrupar por la columna de moneda (`Details`).

### 3.6 `GAP_DATA_06_INFRAESTRUCTURE` — Inventario de infraestructura (6 hojas)

- `GAP_DATA_06_INFRAESTRUCTURE` (48 filas): un ítem de infraestructura vivo por proyecto (dominio,
  servidor, plugin, mail, chatbot…). `Id`, `ProjectCode`, `Code` (IHPSC v1), `ProductKey` (llave
  compuesta que usan los pagos de la tabla 05), `Concept`, `Provider` (Google Cloud 14, GoDaddy 13…),
  `Link`, `Status` ∈ {`ON` 39, `OFF` 9}, `StartDate`, `EndDate`, `Category` (siempre `Overhead
  Cost`), `ContractedTime` + `TimeUnit`, `Payor` (`SAS`), `FullBudget`, `MonthlyBudget`, `Currency`.
  ⚠ 29 ítems figuran `ON` con `EndDate` ya vencida: estado no confiable.
- `InfraestructureData_IntGeneral` (27): presupuesto anual 2025 de suscripciones corporativas
  (espejo presupuestal de `inf_data_costs`). Σ FullBudget ≈ 90,8 M COP.
- `pys_code` (47) + `inf_code_category` (9) + `inf_code_provider` (44) + `inf_code_service` (47):
  catálogo normalizado Categoría→Proveedor→Servicio para códigos de suscripción
  (`CCC-PPP-SSS`, p. ej. `ARI-CAI-CAI` = Artificial Intelligence / Claude AI). ⚠ Es un vocabulario
  DISTINTO del IHPSC y del `02A_CODES`; conviven tres sistemas de códigos (ver §9.6).

### 3.7 `GAP_DATA_07_CONTRACTS` — Contratación de terceros (7 hojas)

El dominio más rico. Dos flujos coexisten:

**Flujo A — Libro de contratos (2025→):**
- `GAP_DATA_07A_CONTRACTS` (221): contratos individuales. `ContractCode` con formato **`OS_AAAA_NNN`**
  (orden de servicio, 193) o **`PS_AAAA_NNN`** (prestación de servicios, 28). Columnas relevantes:
  `ContractAccount` (categoría de gasto: Design and Visual Arts 162, Pedagogical Advisory 19, Specific
  Technology Services 17, Expert consultants 16…), `ProjectCode`, `ContractOverseer` (gestora que
  supervisa, FK a PM), `Company` (`SAS`), `ContractorID` + `ContractorName` + teléfono + mail
  (desnormalizados desde la tabla 08), `InternalCost` (True = el contratista es del equipo interno,
  25 casos), `ContractLink` (Drive), `ContractAmount` (COP), `ContractStart`, `ContractEnd`,
  `ContractAnnotations` (`MODIFICADO POR OTROSÍ` 41, `ANULADO POR OTROSÍ` 3…).
- `GAP_DATA_07B_PAYMENTS` (404): cronograma de pagos por contrato. `PaymentStatus` ∈ {`Authorized`
  318, `Pending` 86} y `AdmValidation` ∈ {`Paid` 286, `Pending` 108, `Authorized` 10} — el pago
  efectivo es `AdmValidation = Paid`. `ContractorInvoice` (cuenta de cobro del contratista) y
  `ContractorLegal` (soporte de seguridad social/legal; falta en 150 pagos ya pagados).
- `GAP_DATA_07B_DELIVERABLES`: vacía (0 filas).
- `GAP_DATA_07C_ADDENDUM` (5): solicitudes de otrosí/adenda con estado.

**Flujo B — Hiring Menu (2026):** solicitud de contratación que la gestora llena en la app:
- `GAP_DATA_07C1_REQUEST` (97): `RequestID` formato **`GAP-HR-NNNN`**, `Status` ∈ {`Processed` 78,
  `Cancelled` 12, `Requested` 7}, `ProjectCode`, `ProjectMaganer` (sic), `IHCapacity` (True = hay
  capacidad interna para hacerlo, 44 casos), datos del contratista, `DateStart`, `Payor`
  (`SAS` 93 / `LLC` 4), `Category` ∈ {`OS` 73, `PS` 24}, `Annotations`.
- `GAP_DATA_07C2_SERVICES` (131): líneas de servicio de cada solicitud (`ServiceID` =
  `GAP-HR-NNNN-NNNN`): descripción, unidad, cantidad, entregable, fecha, precio unitario y total.
  Consistencia perfecta: cantidad × unitario = total en el 100 % de filas.
- `GAP_DATA_07C3_PAYMENTS` (174): cronograma de pagos de la solicitud (`Disaggregated`/`Unique`).
- ⚠ **No existe llave entre `RequestID` y el `ContractCode` resultante.** El flujo B alimenta
  conceptualmente al flujo A (78 solicitudes procesadas ↔ 87 contratos 2026) pero no hay columna que
  los una; solo se pueden correlacionar por contratista + proyecto + fechas.

### 3.8 `GAP_DATA_08_CONTRACTORS` — Directorio de terceros (73 filas)

`ContractorID` (cédula/NIT/pasaporte, ⚠ almacenado como número), `ContractorIDType` ∈ {`ID Card` 64,
`NIT` 3, `Passport` 3, `Alien Card` 3}, nombres desagregados en 4 columnas, `CompanyName` (solo
personas jurídicas), `Profile` ∈ {`Expert` 22, `Graphic and multimedia designer` 15, `Audiovisual
producer` 9, `Digital Infrastructure Specialist` 8, `Voice actor` 6, `Multimedia producer` 2} (mismo
vocabulario que `PMH_UX_PROFILES`), teléfono, mail, `ContractorFolder` (carpeta Drive con su
documentación). **Contiene datos personales sensibles: trátalos bajo mínima exposición** (Ley 1581 de
2012, Colombia); no los reproduzcas ni los muevas fuera del sistema.

### 3.9 Tablas menores

- `GAP_DATA_10_DOCUMENTS`: gestión documental (TRD, emisor, receptor, repositorio). **Vacía** — la
  funcionalidad existe en diseño pero nunca se operó.
- `GAP_DATA_11_MISSIONS` (3 hojas): misiones de campo con presupuesto por concepto (transporte,
  alojamiento, viáticos, seguros) y legalización de pagos. **Una sola misión registrada**
  (`MI-2025-CPCJ-01-2025`, Montes de María, oct-2025, proyecto `co_pnud_comunica_justicia_2024`).
  El patrón Budget80/BudgetManagement se repite aquí.
- `GAP_DATA_12_CORP_CONTRACTS` (37): contratos marco con clientes: `ContractID`
  (`PNUD_10168806`, `UNICEF_43454142`, `CAF_CW19679`, `CSJ_216`…), objeto y carpeta Drive.
  Es la tabla a la que apunta `01_PROJECTS.ContractID`.
- `GAP_DATA_13_IHPSC`: **vacía**. Destino previsto del catálogo IHPSC dentro de la app (aún no cargado).
- `GAP_DATA_BACKUP/`: esquema anterior (marzo 2025) en un solo libro
  (`management_global_project_data`, 74 proyectos, 38 columnas, con la errata `Indentifier`;
  `OutstandingData` = cartera de entonces) + 2 CSV (`data_income`, `data_invoicing` al 2025-03-18).
  Solo valor histórico; su esquema NO es el vigente.

---

## 4. Diagrama de relaciones e integridad verificada

```
GAP_DATA_01A_PM (11 usuarios)
   └─< GAP_DATA_01_PROJECTS.ProjectManager           [0 huérfanos]
GAP_DATA_12_CORP_CONTRACTS (37)
   └─< GAP_DATA_01_PROJECTS.ContractID               [FK débil, 44/144 poblada]

GAP_DATA_01_PROJECTS (144)  ← llave: ProjectCode
   ├─< GAP_DATA_03_INCOME.ProjectCode        (339)   [0 huérfanos]
   ├─< GAP_DATA_04_COSTS.ProjectCode         (4.434) [42 códigos huérfanos — ver §9.3]
   ├─< GAP_DATA_05_PAYMENTS.ProjectCode      (271)   [0 huérfanos]
   ├─< GAP_DATA_06_INFRAESTRUCTURE.ProjectCode (48)  [0 huérfanos]
   ├─< GAP_DATA_07A_CONTRACTS.ProjectCode    (221)   [3 huérfanos: co_csj_rama_judicial_2026/27/28]
   ├─< GAP_DATA_07C1_REQUEST.ProjectCode     (97)    [1 huérfano: pa_pnud_diagrama_democracia]
   └─< GAP_DATA_02_BUDGET.ProjectCode        (23)    [0 huérfanos]

GAP_DATA_08_CONTRACTORS (73) ← llave: ContractorID
   ├─< GAP_DATA_07A_CONTRACTS.ContractorID           [0 huérfanos; datos desnormalizados en 07A]
   └─< GAP_DATA_07C1_REQUEST.ContractorID            [0 huérfanos]

GAP_DATA_07A_CONTRACTS (221) ← llave: ContractCode
   ├─< GAP_DATA_07B_PAYMENTS.ContractCode    (404)   [0 huérfanos]
   └─< GAP_DATA_07C_ADDENDUM.ContractCode    (5)     [0 huérfanos]

GAP_DATA_07C1_REQUEST (97) ← llave: RequestID
   ├─< GAP_DATA_07C2_SERVICES.RequestID      (131)   [0 huérfanos]
   └─< GAP_DATA_07C3_PAYMENTS.RequestID      (174)   [0 huérfanos]

GAP_DATA_06_INFRAESTRUCTURE.ProductKey (= ProjectCode-Code-Id)
   └─< GAP_DATA_05_PAYMENTS.ProductKey               [enlaza pago → ítem de infraestructura]

GAP_DATA_09_ACCOUNTS.account
   └─< GAP_DATA_04_COSTS.Account                     [20 de 33 cuentas SIN mapeo]

GAP_DATA_02A_CODES.Code (IHPSC v1)
   ├─< GAP_DATA_02_BUDGET.Code                       [0 huérfanos]
   ├─< GAP_DATA_05_PAYMENTS.Code                     [5 códigos fuera de catálogo: ARI-*, CYC-*]
   └─< GAP_DATA_06_INFRAESTRUCTURE.Code              [los mismos 5]
```

Sin relación formal (correlacionables solo heurísticamente): `07C1_REQUEST` ↔ `07A_CONTRACTS`;
`04_COSTS.Contractor` (texto libre) ↔ `08_CONTRACTORS`; `04_COSTS` ↔ `07B_PAYMENTS`
(la contabilidad y el cronograma de pagos registran el mismo dinero por caminos separados).

---

## 5. Lógica de negocio

### 5.1 Convención de `ProjectCode`

`{pais}_{cliente}_{tema}_{version?}_{año}` en minúsculas con guion bajo:
`arg_pnud_a2030_v1_2023`, `cl_unwomen_indigform_2025`, `nl_wwf_coursesweb_2026`.

- Prefijos de país: `pa` Panamá, `ven` Venezuela, `co`/`col` Colombia (⚠ ambos existen), `mx` México,
  `cr` Costa Rica, `fji` Fiji, `es` España, `us` EE. UU., `hn`/`hon` Honduras (⚠ ambos), `gr` Grecia,
  `cl` Chile, `gq` Guinea Ecuatorial, `ec` Ecuador, `br` Brasil, `arg` Argentina, `eu` UE, `lac`
  regional LATAM, `fr` Francia, `gl` global, `nl` Países Bajos, `pt` Portugal, `be` Bélgica.
- Excepciones sin año: `hon_pnud`, `Operaciones` (bolsa interna).
- ⚠ Algunos códigos llevan tildes/ñ (`co_pnud_campaña_vbg_osigd_2024`) y la contabilidad los escribe
  sin tilde → mismatch (ver §9.3).

### 5.2 Modelo de costeo de un proyecto

Sobre el valor del contrato convertido a COP (`CostingAmount = ContractAmount × ExchangeRate`, con
TRM pactada al costear):

```
Margin     = pMargin%     × CostingAmount      (utilidad objetivo)
AyF        = pAyF%        × CostingAmount      (administración y funcionamiento)
Unforeseen = pUnforeseen% × CostingAmount      (imprevistos)
ICA        = pICA%        × CostingAmount      (impuesto de industria y comercio, típicamente 1 %)
Commission = pCommission% × CostingAmount      (usualmente 0)

ImplementationBudget  = presupuesto operable del proyecto
ImplementationReserve ≈ 20 % de ImplementationBudget  (retención; los ítems operan al 80 % → "Budget80")
EstimatedBudget / ManagementBudget = presupuesto de gestión resultante
BaseTeam     = costo previsto del equipo interno base
InternalCost / ExternalCost = división prevista interno vs subcontratado
```

El formulario `GlobalControl` compara previsto vs real ("Forecasted internal cost / Actual internal
cost / remaining balance"). La regla del 80/20 reaparece en `02_BUDGET.Budget80` y en
`11B_BUDGET.Budget80`: **los ejecutores operan con el 80 % del presupuesto; el 20 % es reserva que la
administración libera** (comentarios como "Autorizado ejecución 100 % GAP" indican liberación).

"GAP" en los nombres (`GAP_DATA`, `GAP-HR`, "Correo GAP") designa el área/proceso administrativo de
gestión de proyectos (Gestión Administrativa de Proyectos — inferido, no documentado en la fuente).

### 5.3 Ciclo de ingresos

1. Al firmar contrato se cargan sus hitos en `03_INCOME` con `ContractDate`/`ExpectedDate` y estado
   `Scheduled`.
2. Al facturar: `InvoiceDate` + URL en `Invoice`, estado `Invoiced`.
3. Al recibir el dinero: `CreditedDate`, estado `Credited`.
4. Retrasos se explican en `DelayFactors`/`Remarks`.

Métricas de referencia al corte: mediana de retraso de cobro 15 días, p90 77 días, 11 % cobrado a
tiempo. Cartera pendiente 1.337 M COP (52 hitos), 903 M vencida — concentrada en
`co_csj_rama_judicial_2025` (3 facturas ≈ 554 M).

### 5.4 Ciclo de contratación de terceros

1. La gestora crea una solicitud en el Hiring Menu → `07C1_REQUEST` (`Requested`), con líneas de
   servicio (`07C2`) y cronograma de pagos (`07C3`).
2. Administración la procesa (`Processed`) y genera el contrato `OS_`/`PS_` en `07A_CONTRACTS`
   (⚠ sin llave de vuelta), con su cronograma real en `07B_PAYMENTS`.
3. Cada pago pasa por `PaymentStatus` (autorización de la gestora) y `AdmValidation` (pago efectivo),
   con cuenta de cobro (`ContractorInvoice`) y soporte legal (`ContractorLegal`).
4. Cambios → `07C_ADDENDUM` y anotación `MODIFICADO POR OTROSÍ` (⚠ el `ContractAmount` no siempre se
   actualiza: 9 contratos con Σ pagos ≠ monto).
5. La contabilidad registra el gasto en paralelo en `04_COSTS` (sin llave al contrato).

`OS` = orden de servicio (por entregables); `PS` = prestación de servicios (mensualizado, modelo
introducido en 2026 para autorías y roles continuos).

### 5.5 Infraestructura

Cada ítem por proyecto vive en `06_INFRAESTRUCTURE` con `ProductKey`; sus pagos van a `05_PAYMENTS`
referenciando ese `ProductKey`. Las suscripciones corporativas (sin proyecto) se presupuestan en
`InfraestructureData_IntGeneral` y se pagan en `inf_data_costs`. El costo del servidor compartido de
Google Cloud ("Granja InnovaHub") se prorratea **manualmente**: capturas de la consola de facturación
anotadas con una tabla de reparto por proyecto (las encontrarás como imágenes adjuntas en los pagos).

---

## 6. Catálogo IHPSC (productos y servicios)

**IHPSC** = catálogo interno de productos y servicios codificables. Estructura del código:
**`CCC-PPP-DDD-VVV`** = Categoría – Producto – Entregable – Variante (3 letras cada nivel).
Ejemplo: `DYA-GLN-BMA-STD` = Diseño y Artes Visuales → Línea Gráfica → Manual de Marca → Estándar.

- **7 categorías:** `DYA` Diseño y Artes Visuales · `DLR` Recursos Digitales de Aprendizaje · `AUP`
  Producción Audiovisual · `ELS` Soluciones e-learning · `TIN` Infraestructura Tecnológica · `CPM`
  Consultoría y Gestión de Proyectos · `SPT` Servicios Profesionales por Tiempo.
- **Versiones:** v1 (implícita, la que usa `02A_CODES` y los códigos operativos actuales) → **v2**
  (164 ítems; incluye hoja `01_Hallazgos` con 20 defectos de v1 y su corrección) → **v3** (298 ítems;
  integra un ejercicio previo `gap_clave_ihpsc`: perfiles responsables, líderes de producto
  Aura/Oscar, 28 decisiones documentadas en `02_Integracion`) → **v3.1 = versión más reciente**
  (308 ítems; agrega `Denominación específica` y `Descripción detallada` por ítem, regla 8).
- **Reglas del código (v3.1):** nunca códigos incompletos (variante `GEN` si no hay diferenciación);
  códigos únicos por nivel; entregables transversales reutilizables; los atributos operativos
  (proveedor, SO, plataforma, idioma no catalogado) NO crean códigos — van en los comentarios de la
  OS; ID correlativo estable `IHP-NNNN` que nunca se renumera; alcance parcial/total se expresa en la
  cantidad; la gestión de proyecto no se codifica como entregable (se cotiza por `SPT-PMC`).
- **Campos del maestro (`08_Maestro`):** código, denominación, descripción, perfil responsable
  (37 perfiles en `07_Perfiles` con tipo de provisión Interno/Mixto/Externo), unidad de medida,
  driver de costo, `Modalidad` ∈ {`INH` interno, `EXT` externo, `MIX`}, `OS aplicable` (Sí/No),
  `Costo ref. (COP)`, estado.
- ⚠ **Estado de población:** `Costo ref.` lleno en 3/308; tarifas por perfil 0/37; la tabla destino en
  la app (`GAP_DATA_13_IHPSC`) está vacía. El catálogo es hoy un documento de diseño, no un dato
  operativo. Los códigos que verás en producción (pagos, presupuesto, infraestructura) son de la
  **v1** (`02A_CODES`), cuya estructura coincide pero cuyo contenido difiere.
- La `09_Plantilla_OS` (v3.1) es el prototipo de línea de orden de servicio: dropdown validado contra
  el maestro (rango con nombre `CodigosIHPSC`), descripción/perfil/unidad auto-completados por INDEX/
  MATCH, verificación automática de externalizabilidad ("OK: externalizable" / "REVISAR").

---

## 7. Adjuntos y convención de archivos

- Convención AppSheet: `"<Tabla>_Files_/"` (PDF) y `"<Tabla>_Images/"` (imágenes). Nombre de archivo:
  `{IdFila}.{Campo}.{HHMMSS}{sufijo}.ext` (p. ej. `0f3dc9a6.Invoice.013057.pdf`). La celda del campo
  guarda la ruta relativa; varias rutas separadas por coma si hay múltiples archivos.
- Contenido real: facturas de suscripciones (Anthropic, Google, Descript, OpenAI, Adobe, Miro,
  Genially, ElevenLabs, Midjourney, Lovable, Mailchimp, Cloudflare, GoDaddy, Hostinger…) y capturas
  de la consola de facturación de Google Cloud con el prorrateo manual por proyecto.
- Estado verificado: 8 referencias de `05_PAYMENTS` apuntan a archivos inexistentes; 32 archivos sin
  referencia; 20 grupos de duplicados binarios (la misma factura cargada hasta 6 veces con IDs
  distintos); existen DOS carpetas `GAP_DATA_05_PAYMENTS_Files_` (raíz y `APPSHEET_DATA/`) sin
  intersección — la de `APPSHEET_DATA` contiene estados de cuenta de Google Cloud.

---

## 8. Cifras de referencia (sanity checks)

Úsalas para validar que estás leyendo bien los datos. Corte 2026-08-27; M = millones de COP.

| Métrica | Valor |
|---|---|
| Proyectos | 144 = 87 Completed + 53 Active + 3 Cancelled + 1 Paused |
| Σ `CostingAmount` | 6.838 M |
| Σ `ExpectedCOP` (ingresos) | 6.620 M · Credited 5.275 M · pendiente 1.337 M (vencido 903 M) |
| Σ `04_COSTS.Amount` | 2.523 M (2024: 843 · 2025: 1.103 · 2026 parcial: 577) |
| Completados: costo directo / acreditado | 41,7 % (TECH4D 24 · CA4D 36 · C4D 41 · EL4D 44 · SYS4D 61) |
| Contratos 07A | 221 (193 OS + 28 PS) · Σ 830 M · pagado 548 M · pendiente 239 M |
| Solicitudes 2026 | 97 (78 Processed = 284,6 M · 7 Requested · 12 Cancelled) |
| Contratistas | 73 (67 con contrato) |
| Presupuesto SaaS 2025 | 90,8 M COP · pagos reales 2025 ≈ USD 16.7k + COP 2,8 M + EUR 0,6k |

Nota: el 41,7 % incluye mano de obra interna causada a proyectos; los costos contables empiezan en
ene-2024, así que proyectos 2022–2023 no tienen costo asociado. Trata estos ratios como indicativos.

---

## 9. Advertencias críticas de interpretación

**Léelas antes de calcular cualquier cosa.**

1. **`03_INCOME.Currency` es un MONTO, no una moneda.** Contiene el valor del hito en la moneda
   original del contrato. Para agregar usa siempre `ExpectedCOP`. La moneda real se obtiene del
   proyecto (`01_PROJECTS.Currency`).
2. **Fechas de proyecto desactualizadas.** 45/53 activos tienen `ClosingDate` en el pasado; 13
   proyectos tienen `StartDate > ClosingDate`. No infieras retraso, duración ni carga de trabajo de
   estas fechas sin advertirlo. Además: 6 hitos con `CreditedDate = 2005-05-16` (error de captura,
   son de 2024/2025), 73 hitos `Credited` sin `CreditedDate`.
3. **`04_COSTS.ProjectCode` tiene 42 códigos que no existen en el maestro.** Causas: alias
   ortográficos (`col_` vs `co_`, `campana` vs `campaña`, `refrigeracion` con/sin tilde y con
   espacios, `est-temprana` vs `est_temprana`, `a2030` en proyectos br/col), fases futuras no creadas
   como proyecto (`co_csj_rama_judicial_2026/2027`), y bolsas contables (`Amortizacion de costos`,
   `Infraestructura Interna`). Al cruzar ingresos vs costos, normaliza primero (quitar tildes,
   unificar `col_`→`co_` y `hon_`→`hn_` caso a caso) o perderás asientos.
4. **Columnas de dinero con monedas mezcladas.** `05_PAYMENTS.Cost` y `inf_data_costs.Cost` mezclan
   USD/COP/EUR en la misma columna; la moneda va en `Details` (y falta en 95 filas de la primera).
   `01_PROJECTS.ContractAmount` está en moneda original (usa `CostingAmount` para COP).
   `CostingCurrency` contiene números sin significado claro: ignórala.
5. **Erratas que son nombres oficiales de campo.** `ProjectMaganer` (07C1), `BudgeProposal` (01),
   `Deriverable` (02A), `Exterrnal` (02), `Indentifier` (backup), `Infraestructure` (06),
   `Validaciones`/`Validations` (04/04A), países `Grece` y `switzerland`, `Payor = "SAs"` (1 fila).
   Consulta con estos nombres exactos; no los "corrijas" al consultar.
6. **Tres vocabularios de códigos conviven.** (a) IHPSC v1 en `02A_CODES` — el que usan presupuesto,
   pagos e infraestructura por proyecto; (b) códigos de suscripción `CCC-PPP-SSS_AAAAMMDD` del
   catálogo `pys_code` — los de `inf_data_costs`; (c) IHPSC v2/v3/v3.1 — el catálogo rediseñado, aún
   no operativo. No asumas que un código de uno existe en otro (5 códigos `ARI-*`/`CYC-*` usados en
   producción no están en `02A_CODES`).
7. **Estados con doble columna en pagos a contratistas.** El pago está hecho solo si
   `AdmValidation = Paid`; `PaymentStatus = Authorized` es la autorización de la gestora, no el pago.
8. **`ContractAmount` de 07A puede estar desactualizado.** 9 contratos tienen Σ de pagos ≠ monto
   (otrosíes aplicados al cronograma pero no al monto). Para el valor real de un contrato usa la suma
   de `07B_PAYMENTS`.
9. **Tablas vacías o piloto.** `10_DOCUMENTS`, `13_IHPSC`, `07B_DELIVERABLES` (0 filas);
   `02_BUDGET` solo 2 proyectos; `04A_COSTS_INTERNAL` solo 1; `11_MISSIONS` solo 1 misión. Que el
   front muestre una vista vacía no significa error de la app.
10. **IDs numéricos.** `ContractorID` se almacena como número: puede perder ceros a la izquierda y no
    representa pasaportes alfanuméricos. Compara como texto normalizado.
11. **Duplicidad aparente de personas.** Las gestoras del equipo aparecen como "contractors" en
    `04_COSTS` (causación de nómina) y a veces en `07A` con `InternalCost = True`. No son terceros.
12. **Datos personales.** `08_CONTRACTORS`, `07A` y `07C1` contienen cédulas, teléfonos y correos de
    personas naturales. Minimiza su exposición: no los copies a salidas, resúmenes ni ejemplos salvo
    necesidad explícita del usuario.
13. **El backup no es el esquema vigente.** `GAP_DATA_BACKUP/` (marzo 2025) tiene otro esquema
    (38 columnas, sin `ContractID`/`Identifier` actual). Úsalo solo como histórico.
14. **`ExchangeRate` es la TRM pactada al costear, no la de mercado**, y en 5 proyectos vale 0 con
    moneda nula. `CostingAmount ≠ ContractAmount × ExchangeRate` en 62/137 proyectos (adendas sin
    traza): ante discrepancia, `CostingAmount` es la cifra que el negocio usa.

---

## 10. Glosario

| Término | Significado |
|---|---|
| **PMH** | Project Management Hub — la app AppSheet (el front que ves). |
| **GAP** | Área/proceso administrativo de gestión de proyectos (prefijo de tablas y solicitudes `GAP-HR`). Inferido; no documentado en la fuente. |
| **C4D / EL4D / TECH4D / SYS4D / CA4D** | Líneas de servicio "…for Development": Comunicación, E-Learning, Tecnología, Sistematización, Capacity/Assessment (los dos últimos inferidos del tipo de proyectos que agrupan). |
| **LTA** | Long Term Agreement — acuerdo marco de agencias ONU con consultores individuales; `LTA Wilmer/Oscar/Amagoia` son vehículos de facturación personales. |
| **OS / PS** | Orden de Servicio (por entregables) / Prestación de Servicios (mensualizado). |
| **IHPSC** | Catálogo interno de productos y servicios codificables (`CCC-PPP-DDD-VVV`). |
| **TRM** | Tasa representativa del mercado (tipo de cambio COP). |
| **ICA** | Impuesto de Industria y Comercio (municipal, ~1 %). |
| **AyF** | Administración y Funcionamiento (overhead cargado al costeo). |
| **Trimming** | Fecha de cierre contable mensual del asiento de costo. |
| **Causación / Imputación** | Registro contable del costo (devengo) / asignación a proyecto o ítem. |
| **Otrosí / Adenda** | Modificación contractual (fechas, montos, alcance). |
| **Budget80 / reserva 20 %** | Los ejecutores operan el 80 % del presupuesto; el 20 % es reserva que administración libera ("Autorizado ejecución 100 % GAP"). |
| **SAS / LLC** | InnovaHub Colombia SAS / InnovaHub LLC — los dos pagadores (`Payor`). |
| **Granja InnovaHub** | Servidor compartido en Google Cloud que aloja varios campus/plataformas; su factura se prorratea manualmente entre proyectos. |
| **Credited** | Hito de ingreso efectivamente cobrado (dinero acreditado en cuenta). |
| **TRD** | Tabla de Retención Documental (gestión documental colombiana; prevista en `10_DOCUMENTS`, sin uso). |

---

*Documento generado por análisis automatizado de la carpeta `administrativo` (2026-08-27). Ningún
archivo fuente fue modificado. Las marcas ⚠ señalan defectos de datos verificados, no suposiciones;
lo marcado como "inferido" no consta en la fuente.*
