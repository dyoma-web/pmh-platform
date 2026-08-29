# ProManage Hub (PMH / GAP_DATA)
## Análisis funcional del aplicativo, diagnóstico del sistema y concepto experto para su migración a servidor de producción

**Cliente:** InnovaHub Colombia SAS / InnovaHub LLC
**Elaborado para:** David Yomayusa — COO
**Fecha:** 29 de agosto de 2026
**Fuentes:** recorrido ítem por ítem de la app AppSheet *ProManage Hub* (rol Admin) + informe Power BI publicado (10 páginas) + documento `CONTEXTO_BACKEND_GAP_DATA.md` (corte 2026-08-27).
**Naturaleza:** concepto experto. No se modificó ningún dato ni configuración durante el análisis.

---

## 0. Resumen ejecutivo

PMH no es un aplicativo de gestión de proyectos. Es **un sistema de registro administrativo-financiero de proyectos**, bastante completo en su alcance conceptual y muy débil en su capacidad de sostener decisiones. Registra bien *lo que pasó con el dinero*; no registra casi nada de *lo que está pasando con el trabajo*, y no cierra los ciclos que permitirían pasar de dato a decisión.

Lo que encontré, en una línea cada uno:

1. **La cobertura de dominio es notable.** Cinco procesos reales están modelados de punta a punta: proyecto y costeo, hitos de ingreso, contratación de terceros (con flujo de solicitud), infraestructura tecnológica y contabilidad imputada a proyecto. Muy pocas consultoras de este tamaño tienen esto.
2. **La cobertura de *uso* es baja.** El módulo de presupuesto —el corazón de cualquier control— está poblado en **2 de 144 proyectos**. El proyecto más grande de la casa (`co_csj_rama_judicial_2025`, COP 1.099 M) aparece en el front con *Project Budget: 0 ítems*, `BudgetManagement` vacío y `Cost` vacío. Se está controlando el proyecto más caro sin presupuesto cargado.
3. **La capa semántica está rota en puntos críticos.** `03_INCOME.Currency` no contiene una moneda sino un monto. `CostingCurrency` es un campo numérico (lo verifiqué en el formulario *Project Upload*: se captura con `$ 0.00` y control +/–). Tres vocabularios de códigos conviven sin puente. `04_COSTS.ProjectCode` tiene 42 códigos que no existen en el maestro.
4. **El BI heredó los defectos y los amplifica.** En el informe Power BI: el *Balance* de todas las gestoras muestra `$ 0 mill.`; en el *Income Dashboard* los indicadores COP, USD, EURO y "Other" muestran **exactamente el mismo valor** (medida rota); en la página de pagos de infraestructura el total es **COP 75.917.297.083** frente a un `FullBudget` de COP 107 M, resultado de sumar USD y COP en una misma columna; y hay márgenes brutos con valor `-Infinito` por división por cero. Un tablero que muestra cifras imposibles deja de usarse, y un tablero que no se usa no cambia decisiones.
5. **La integridad se sostiene por convención, no por el motor.** Google Sheets no tiene llaves foráneas. Hay huérfanos verificados, contratistas identificados por texto libre (`"cédula - NOMBRE"`), un registro de prueba en producción (`A Fantasma`, ID 0) y placeholders de plantilla visibles al usuario ("This is a long piece of text…") en las tarjetas de contratistas.
6. **Falta la mitad del negocio.** No hay cronograma, ni entregables con fecha y responsable (`07B_DELIVERABLES` está vacía), ni horas, ni capacidad del equipo, ni riesgos, ni gestión documental (`10_DOCUMENTS` vacía). El PMBOK que ustedes practican no está representado en el sistema: solo su cara financiera.
7. **Hay exposición de datos personales.** Cédulas, teléfonos y correos de personas naturales se muestran en tarjetas y tablas de listado, sin necesidad funcional. Es un riesgo bajo Ley 1581 de 2012 que hoy se mitiga únicamente por el control de acceso de AppSheet.

**Conclusión.** Migrar a servidor de producción es la decisión correcta, pero migrar *el aplicativo* sería un error: hay que migrar **el modelo y los procesos**, corregidos. La recomendación es reconstruir sobre PostgreSQL con un modelo normalizado y multimoneda desde el diseño, cerrar los tres ciclos que hoy están abiertos (solicitud→contrato, contrato→contabilidad, presupuesto→ejecución) y construir encima una capa de decisión —métricas certificadas, semáforos y alertas— en lugar de un tablero de gráficas. El valor no está en tener los mismos datos en otra base: está en que el sistema empiece a **decirle a la organización qué hacer**, y no solo qué pasó.

---

## 1. Alcance y método

Recorrí la aplicación con rol Admin, ítem por ítem del menú, abriendo en cada vista al menos un registro de detalle y sus tablas relacionadas, y el formulario de captura completo (las cuatro pestañas de *Project Upload*, sin guardar). Después recorrí las 10 páginas del informe Power BI enlazado desde el ítem *Dashboard*. Todo lo que afirmo sobre el front está observado directamente; todo lo que afirmo sobre el backend proviene del documento de contexto entregado, cuyas cifras corresponden al corte 2026-08-27.

No abrí las hojas de cálculo fuente ni el editor de AppSheet. Las cifras agregadas son del documento de contexto; las trato como indicativas, no como saldos contables.

---

## 2. Cómo funciona el sistema hoy

### 2.1 Arquitectura actual

```
Google Sheets (13 libros GAP_DATA_*)  ──►  AppSheet (PMH)  ──►  navegador / móvil
        │                                       │
        │                                  archivos adjuntos
        │                              ("<Tabla>_Files_", "<Tabla>_Images")
        │                                    en Google Drive
        │
        └──► Power BI (informe publicado, 10 páginas) ──► enlace externo desde el menú
```

Cada tabla del modelo es una hoja de cálculo. AppSheet genera los IDs de fila, aplica validaciones de lista, resuelve referencias por lookup y guarda los adjuntos como rutas relativas dentro de la celda. La configuración visual (menús, catálogos de clientes con logo, países con bandera, perfiles con avatar) vive en un libro aparte, `PMH_UX.xlsx`, y es editable desde la propia app en el ítem *UX customization* — un detalle de diseño acertado: la personalización visual no requiere tocar el editor de AppSheet.

Consecuencias estructurales de esta arquitectura, que son las que motivan la migración:

- **No hay integridad referencial.** Las relaciones existen como convención (`ProjectCode` como llave natural repetida en 7 tablas), no como restricción del motor. Un código mal escrito no falla: crea un huérfano silencioso.
- **No hay tipos fuertes.** Una columna llamada `Currency` puede contener números; `ContractorID` se almacena como número y pierde ceros a la izquierda; un campo de moneda se captura con teclado numérico.
- **No hay transacciones ni concurrencia real.** Dos gestoras editando el mismo hito compiten por la última escritura.
- **No hay auditoría.** No se sabe quién cambió un monto ni cuándo, más allá de lo que AppSheet registre por su cuenta.
- **El límite de escala está cerca.** 4.439 asientos de costo en una hoja ya es un volumen incómodo; con cierres mensuales continuos, el crecimiento es lineal e inevitable.

### 2.2 Modelo de dominio (lo que el sistema *sí* modela)

Cinco dominios, articulados alrededor de una única llave natural, `ProjectCode`:

| Dominio | Tablas | Volumen | Estado de uso |
|---|---|---|---|
| **Proyecto y costeo** | `01_PROJECTS` (+`01A_PM`, `12_CORP_CONTRACTS`) | 144 proyectos, 42 columnas | Operativo. Núcleo del sistema. |
| **Ingresos** | `03_INCOME` | 339 hitos | Operativo y bien alimentado. Lo más sano del sistema. |
| **Contratación de terceros** | `07A` contratos, `07B` pagos, `07C` adendas, `07C1/2/3` solicitudes, `08` contratistas | 221 contratos · 404 pagos · 97 solicitudes · 73 contratistas | Operativo, con dos flujos que no se hablan. |
| **Infraestructura y SaaS** | `06_INFRA` (+5 catálogos), `05_PAYMENTS`, `inf_data_costs` | 48 ítems · 271 pagos · 263 pagos corporativos | Operativo, con mezcla de monedas. |
| **Costos contables** | `04_COSTS`, `04A`, `09_ACCOUNTS` | 4.439 asientos (ene-2024 → jun-2026) | Operativo. Es la fuente de verdad del gasto real. |

Y tres dominios **diseñados pero nunca operados**: presupuesto por ítem (`02_BUDGET`, 2 proyectos), misiones (`11_MISSIONS`, 1 misión), gestión documental (`10_DOCUMENTS`, vacía) y el catálogo IHPSC dentro de la app (`13_IHPSC`, vacía).

### 2.3 La lógica de negocio, tal como está codificada

**Costeo de un proyecto.** Sobre el valor del contrato convertido a COP (`CostingAmount`), se aplican cinco porcentajes —margen, AyF, imprevistos, ICA, comisión— y de ahí se derivan el presupuesto de implementación, la reserva y el presupuesto de gestión. La regla operativa central es el **80/20**: los ejecutores operan con el 80 % del presupuesto y el 20 % restante es reserva que administración libera explícitamente (los comentarios "Autorizado ejecución 100 % GAP" son la traza de esa liberación). Es un buen modelo de control. El problema no es el modelo: es que **solo está instrumentado en 2 proyectos**.

**Ciclo de ingreso.** `Scheduled` → `Invoiced` → `Credited`, con fechas contractual, esperada, de factura y de acreditación, más factores de retraso. Es el ciclo mejor implementado del sistema y es el que sostiene la única métrica realmente accionable que hoy produce la casa: la cartera vencida.

**Ciclo de contratación.** La gestora crea una solicitud en el *Hiring Menu* con sus líneas de servicio y su plan de pagos; administración la procesa y emite el contrato (`OS_` por entregables o `PS_` mensualizado); cada pago pasa por dos validaciones sucesivas —autorización de la gestora (`PaymentStatus`) y pago efectivo (`AdmValidation`)—; los cambios se tramitan por otrosí. En el front esto está implementado con botones de acción (`Action_02_Process`, `Action_03_Finish`), es decir, **hay una máquina de estados real**, no solo un campo de texto. Bien hecho.

**Infraestructura.** Cada ítem por proyecto tiene una llave compuesta (`ProductKey`) que enlaza el activo con sus pagos. El servidor compartido de Google Cloud ("Granja InnovaHub") se prorratea **manualmente**: capturas de pantalla de la consola de facturación anotadas a mano y adjuntas al pago. Es el punto más artesanal del sistema.

### 2.4 Recorrido ítem por ítem — hallazgos de front

| Ítem del menú | Qué hace | Hallazgos observados |
|---|---|---|
| **Dashboard** | Enlace externo al informe Power BI. | No es parte de la app: es un salto a otra herramienta, sin filtro de contexto ni paso de parámetros. El usuario pierde el hilo de lo que estaba mirando. Ver §2.5. |
| **Project Information** | Galería de fichas (bandera del país + logo del cliente), agrupada por estado y filtrable por gestora. Detalle con 42 campos + presupuesto relacionado + hitos de ingreso. | Es la vista más lograda. En el detalle del proyecto piloto (`arg_pnud_a2030_v1_2023`) sí aparecen los 17 ítems de presupuesto **con semáforo calculado** (`Alert` / `Risk` / `Fine`) y columnas derivadas (`RealCost`, `Authorized`, `Balance`, `Costs`). **Esa vista es exactamente el producto que el sistema debería dar para los 144 proyectos, y lo da para 2.** |
| **Project Upload** | Asistente de alta en 4 pestañas: General / Cliente / Financiero del contrato / Estructura de costos. | Buen diseño de captura por etapas. Dos defectos: (a) **`Costing currency` es un campo numérico** (`$ 0.00` con botones +/–) — el origen exacto de la advertencia de que esa columna contiene números; (b) los campos calculados (`ImplementationBudget`, `ImplementationReserve`, `EstimatedBudget`) se distinguen solo por color/gris, sin etiqueta que lo explique. Aparece además un campo `ProductionCosts` no documentado. |
| **Invoice Information** | Dos paneles: proyectos por gestora, y el cronograma completo de hitos ordenado por fecha esperada. | **Los dos paneles no están vinculados**: seleccionar una gestora a la izquierda no filtra el cronograma a la derecha. No hay totales, ni antigüedad de cartera, ni marca visual de vencido — la única forma de ver que un hito está vencido es comparar mentalmente la fecha con hoy. El detalle de un proyecto sí muestra bien sus hitos y su solicitud de contratación relacionada. |
| **Budget** | Tres paneles: proyectos por gestora, misiones y el presupuesto por ítem con su semáforo. | Casi vacío por construcción: 23 filas de 2 proyectos y 1 misión. La vista funciona; el proceso que la alimenta no existe. |
| **Contract book** | Tres paneles: contratos, cronograma de pagos agrupado por fecha, libro de adendas por gestora. Acciones rápidas de llamada, WhatsApp y correo al contratista desde la fila. | Las acciones de contacto son un acierto operativo real. El detalle del contrato muestra el contratista con **cédula, teléfono y correo en pantalla**. Los pagos aparecen con fechas hasta 2027, mezclados con los vencidos, sin distinción visual. |
| **Contractors** | Galería de 73 fichas con avatar por perfil. | Dos defectos visibles al usuario: **el texto descriptivo de plantilla nunca se configuró** ("This is a long piece of text. The description goes here…") y aparece en las 73 tarjetas; y hay **un registro de prueba en producción** (`A Fantasma`, ID `0`). Las cédulas se muestran formateadas como número (`1.015.409.086`) en la carátula de la tarjeta. |
| **Hiring Menu** | Tabla de las 97 solicitudes agrupada por gestora, con detalle de servicios y plan de pagos, y botones de acción de flujo. | El módulo más maduro en términos de proceso. Verificado: en `GAP-HR-0001` el precio de contrato (COP 10.600.000) cuadra exactamente con sus 5 cuotas de COP 2.120.000. **Pero no existe llave hacia el contrato resultante**: la solicitud se procesa y el rastro se corta. |
| **Project Control** | Tabla de control con columna calculada `Contract status`. | La evidencia más elocuente del sistema. Entre los activos, la enorme mayoría muestra **"Expired contract"**, y varios "No contract". El semáforo funciona; lo que está roto es el dato de fecha que lo alimenta (45 de 53 activos tienen `ClosingDate` en el pasado). Resultado: **el indicador se volvió ruido y la organización aprendió a ignorarlo**. En `co_csj_rama_judicial_2025`: contrato COP 1.099.762.423, *Project Budget* con 0 ítems, `BudgetManagement` y `Cost` vacíos, y 3 hitos en estado `Invoiced` con fecha esperada de junio y julio de 2026 —vencidos al corte de hoy—. |
| **UX customization** | Catálogos editables de perfiles, clientes y países con sus imágenes. | Funciona bien y es una buena idea de producto. Contiene erratas que se propagan a los reportes (`Grece`, `switzerland` en minúscula). |

### 2.5 El informe Power BI, página por página

| # | Página | Qué aporta | Qué está roto |
|---|---|---|---|
| 1 | *General Overview* | Activos y monto adjudicado por gestora, estado de proyectos, contratos por vehículo y por partner manager, adjudicado por línea de servicio. | **`Balance` muestra `$ 0 mill.` para las 10 gestoras** — la medida no está calculando. El panel "General Data" está vacío. |
| 2 | *ExPost* | Utilidad bruta y margen por proyecto cerrado, con estado (`On budget` / `Over-execution` / `Using reserve`). | Márgenes negativos de hasta −81 % sin explicación asociada. Es diagnóstico, no accionable: llega cuando el proyecto ya cerró. |
| 3 | *Tracking* | La misma lectura sobre proyectos vivos, más costos por cuenta y por línea de servicio. | Márgenes con valor **`-Infinito`** (división por presupuesto cero) y filas **`Not classified`** (proyectos sin costeo cargado, incluidas las bolsas contables `Operaciones`, `hon_pnud`). |
| 4 | *Costs* | Causación por contratista, por gestora y por proyecto. | Mezcla proveedores reales con gasto de viaje (aerolíneas, hoteles, restaurantes) y con nómina interna causada a proyecto, todo bajo la etiqueta "contratista". |
| 5 | *Income Dashboard* | Adjudicado por vehículo y línea, flujo de ingresos, desglose de pagos. | **COP, USD, EURO y "Other" muestran el mismo valor** (COP 1.304.444.932,47 en los cuatro). La medida de partición por moneda no funciona. |
| 6 | *Income* | Igual, con el desglose por moneda funcionando y una columna `Delay` calculada. | El total "Amount in COP" (2.182 M) no reconcilia con la suma de las particiones. Conviven dos formas distintas de la misma medida. |
| 7 | *Invoicing Metrics* | **La mejor página del informe.** Retraso promedio y máximo de cobro por agencia (UNICEF 92 días, Santillana 79, CAF 69, UNDP 67…), con diagrama de caja por país y factores de retraso. | El campo `DelayFactors` mezcla categorías (`EXTERNO`, `INTERNO`) con texto libre, y una sola categoría genérica concentra el 58 % del gráfico. |
| 8 | *Payments* | Pagos a terceros por estado, por contratista y por supervisora; capacidad interna (`IHCapacity`). | Nombres completos de contratistas expuestos en un informe publicado. |
| 9 | *Payments (infraestructura)* | Costo de infraestructura por gestora, proyecto y concepto. | **Total: COP 75.917.297.083** contra un `FullBudget` de COP 107.313.192. Es la mezcla USD/COP sumada en una sola columna. Cifra imposible en pantalla. |
| 10 | *Historical data* | **Curva S acumulada** de ingreso vs. costo vs. presupuesto (jul-2024 → 2026) y contratos marco activos con su ingreso asociado. | Es la vista más estratégica del conjunto y está enterrada en la página 10 de 10. |

Dos lecturas de esto. La primera: **la intención analítica ya existe y es buena** — alguien pensó en margen, en retraso de cobro, en curva S, en ejecución contra presupuesto. La segunda: **el informe no es confiable en su superficie**, y en analítica la confianza es binaria. Un director que ve `$ 0 mill.` de balance y COP 75.917 millones de infraestructura deja de creerle a todo el tablero, incluida la página 7, que es excelente.


---

## 3. Diagnóstico: los siete defectos estructurales

Los ordeno por impacto en la capacidad de decidir, no por dificultad de arreglo.

### D1 — Los ciclos no cierran (defecto de proceso, el más grave)

Tres cadenas quedan interrumpidas y cada interrupción cuesta una pregunta que hoy no se puede responder:

| Cadena rota | Dónde se corta | Pregunta que no se puede responder |
|---|---|---|
| Solicitud → Contrato | `07C1_REQUEST` no tiene columna hacia `07A_CONTRACTS.ContractCode` | *¿Cuánto tardamos entre que la gestora pide un contratista y el contrato queda firmado? ¿Cuántas solicitudes se aprueban con cambios respecto de lo pedido?* |
| Contrato → Contabilidad | `04_COSTS.Contractor` es texto libre `"cédula - NOMBRE"`, sin FK; `04_COSTS` no referencia el contrato ni el pago | *¿El gasto contabilizado corresponde a los contratos firmados? ¿Hay pagos sin contrato o contratos sin gasto?* |
| Presupuesto → Ejecución | `02_BUDGET` poblado en 2/144; `04A_COSTS_INTERNAL` en 1/144 | *¿Este proyecto va bien?* — la pregunta central de la operación. |

**Sin la tercera cadena, el sistema no puede hacer control de proyectos.** Puede hacer contabilidad por proyecto, que es otra cosa: le dice cuánto gastó, no si eso estaba bien.

### D2 — Semántica traicionera

Campos cuyo nombre miente sobre su contenido, verificados:

- `03_INCOME.Currency` **contiene el monto**, no la moneda. La moneda no se registra en la tabla; se infiere del proyecto.
- `01_PROJECTS.CostingCurrency` contiene números. Confirmado en el formulario de captura: es un campo numérico.
- `05_PAYMENTS.Details` **contiene la moneda** (y falta en 95 filas).
- `05_PAYMENTS.Cost` e `inf_data_costs.Cost` mezclan USD, COP y EUR en la misma columna.
- `07A.ContractAmount` puede estar desactualizado frente a la suma real de pagos (9 contratos con diferencia).
- `ExchangeRate` es TRM pactada al costear, no de mercado, y vale 0 en 5 proyectos.

Esto no es un problema de documentación: es un problema de **modelo de datos**. Mientras un monto y una moneda vivan en columnas cuyo nombre invita a lo contrario, toda persona nueva y todo agente automatizado que toque los datos va a equivocarse. Ya se equivocó Power BI, dos veces.

### D3 — Sin integridad referencial

Verificado en el corte: 42 códigos de proyecto en costos que no existen en el maestro (por tildes, por `col_` vs `co_`, por fases futuras no creadas, por bolsas contables); 3 contratos y 1 solicitud huérfanos; 20 de 33 cuentas contables sin mapeo a categoría de gestión; 5 códigos en producción fuera del catálogo. Ninguno de estos errores falló al escribirse. Todos fallan al leerse — y fallan en silencio, restando plata de los agregados sin avisar.

### D4 — Tres vocabularios de códigos y ninguno operativo

Conviven (a) IHPSC v1, el que usan presupuesto, pagos e infraestructura; (b) los códigos de suscripción `CCC-PPP-SSS_AAAAMMDD`; (c) IHPSC v2/v3/v3.1, el catálogo rediseñado de 308 ítems. La v3.1 es un trabajo serio —reglas de codificación, perfiles responsables, modalidad interno/externo/mixto, plantilla de OS con validación automática— y está **muerto en el agua**: costo de referencia lleno en 3 de 308 ítems, tarifas por perfil en 0 de 37, y la tabla destino en la app vacía.

Esto es, en mi lectura, **el activo desperdiciado más valioso de la casa**. Un catálogo de servicios con costo de referencia y perfil responsable es lo que convierte una cotización de "lo que nos pareció" en un precio defendible, y es la única base sobre la que se puede construir un cotizador, un cálculo de capacidad y un margen esperado por ítem. Está a una decisión y unas semanas de tarifas de distancia.

### D5 — Datos temporales inservibles

45 de 53 proyectos activos tienen fecha de cierre en el pasado. 13 proyectos tienen inicio posterior a cierre. 6 hitos tienen fecha de acreditación en 2005. 73 hitos acreditados no tienen fecha de acreditación. **Ninguna métrica de duración, retraso, carga de trabajo o proyección puede calcularse hoy sobre estos datos**, y sin embargo el front calcula y muestra un semáforo de vigencia contractual sobre ellos: por eso casi todo aparece en rojo, y por eso nadie lo mira. Un indicador desacreditado es peor que ningún indicador.

### D6 — El BI amplifica el defecto en vez de contenerlo

Power BI está conectado directamente a las hojas, sin capa intermedia. No hay modelo semántico, ni pruebas de datos, ni definición única de cada medida (conviven al menos dos versiones de "monto en COP"). Cada defecto del origen sale a pantalla multiplicado por un formato de miles.

### D7 — Datos personales expuestos por diseño de vista

Cédulas, teléfonos y correos de 73 personas naturales aparecen en tarjetas de galería, tablas de listado y en un informe publicado. Es información que **el 95 % de las consultas no necesita**. Bajo Ley 1581 de 2012 el principio aplicable es el de finalidad y minimización: hoy no se cumple por diseño, se cumple por suerte (porque el acceso está restringido a 11 personas).

### Lo que sí está bien y hay que conservar

Para que el diagnóstico no se lea como demolición, esto es lo que funciona y debe migrar tal cual:

- La **convención de `ProjectCode`** legible (`país_cliente_tema_versión_año`). Es una buena llave natural y todo el mundo la entiende.
- El **modelo de costeo 80/20 con reserva liberable**. Es control real de proyecto, bien pensado.
- El **flujo de contratación con doble validación** (autorización de gestora + validación administrativa de pago) y su máquina de estados.
- El **ciclo de ingreso de tres estados** con fecha esperada vs. fecha de acreditación. Es lo que permite la única métrica accionable que hoy produce la casa.
- La **página 7 del Power BI** (retraso de cobro por agencia). Es analítica de verdad: identifica que UNICEF paga 92 días tarde en promedio y UNDP 67. Eso cambia cómo se negocian los hitos.
- El **catálogo IHPSC v3.1** como diseño.
- La **personalización visual desde la propia app** (*UX customization*).

---

## 4. El gap decisional: qué no puede decidir hoy la dirección

Este es el punto que importa para lo que sigue. No pregunto qué le falta al sistema, sino **qué decisiones concretas de InnovaHub están hoy sin soporte**.

| Decisión | ¿Qué necesita? | ¿El sistema lo da? |
|---|---|---|
| ¿Cotizo este proyecto a este precio? | Costo de referencia por ítem del catálogo, tarifa por perfil, margen histórico realizado por línea de servicio y por cliente | **No.** Catálogo sin costos, tarifas en 0/37. El margen histórico existe pero solo *ex post*. |
| ¿Acepto este proyecto? | Capacidad disponible del equipo en la ventana de ejecución, margen esperado, riesgo de cobro del cliente | **No.** No hay capacidad ni horas. El riesgo de cobro sí es derivable (página 7). |
| ¿Este proyecto vivo va bien? | Presupuesto por ítem vs. comprometido vs. causado, a la fecha | **No, salvo en 2 proyectos.** |
| ¿Cuánta caja voy a tener en 90 días? | Hitos por cobrar con fecha realista + pagos comprometidos a terceros + costos fijos | **Parcial.** Los hitos están; el compromiso con terceros está; falta juntarlos y falta la fecha realista (no la contractual). |
| ¿A quién le cobro primero esta semana? | Cartera vencida por antigüedad y por responsable de la relación | **No en la app.** Derivable manualmente: COP 1.337 M pendientes, 903 M vencidos, con 554 M concentrados en 3 facturas de un solo cliente. |
| ¿Estoy cumpliendo mis obligaciones como contratante? | Pagos efectuados con soporte legal completo | **No.** 150 pagos ya realizados sin soporte de seguridad social cargado. Es riesgo laboral y tributario, y hoy nadie lo ve. |
| ¿Qué línea de servicio y qué cliente me dejan plata? | Margen realizado por línea, cliente, país y vehículo, con costo interno bien imputado | **Parcial y no confiable.** Los ratios existen (41,7 % costo directo/acreditado global, con dispersión de 24 % a 61 % entre líneas) pero arrastran los huérfanos y la mezcla de monedas. |
| ¿Cuánto me cuesta realmente mi infraestructura y mi SaaS? | Costo por proyecto y corporativo, normalizado a una moneda | **No.** El prorrateo del servidor compartido es manual y por captura de pantalla; los totales son inutilizables por mezcla de monedas. |
| ¿Quién de mi equipo está sobrecargado? | Asignación por persona y ventana de tiempo | **No.** No existe el dato. |

**Nueve preguntas de dirección; el sistema responde una y media.** Ese es el tamaño real de la oportunidad, y es lo que debe guiar la construcción — no la paridad funcional con AppSheet.

---

## 5. Modelo de datos objetivo

Principio rector: **el modelo debe hacer imposible el error, no advertir sobre él.** Cada uno de los defectos de la §3 se corrige aquí con una restricción del motor, no con documentación.

### 5.1 Reglas de diseño no negociables

1. **Dinero = trío indivisible.** Ningún monto existe sin `(amount NUMERIC(18,2), currency CHAR(3), fx_rate NUMERIC(18,6), fx_date DATE)`. El valor en COP es una **columna generada**, nunca capturada. Prohibido por `CHECK` que una columna llamada `currency` contenga algo distinto de un ISO-4217 válido.
2. **Toda relación es una FK real**, con `ON DELETE RESTRICT`. Cero huérfanos posibles.
3. **Códigos normalizados en la escritura.** `ProjectCode` se guarda en una forma canónica (minúsculas, sin tildes, prefijo de país unificado) y se conserva el alias mostrado. Los 42 huérfanos actuales dejan de ser posibles.
4. **Un solo catálogo de servicios**: IHPSC v3.1. Los códigos v1 y los de suscripción viven en tablas de equivalencia (`crosswalk`), no en producción.
5. **Todo cambio de estado pasa por una transición registrada**, con actor, timestamp y motivo. La tabla de eventos es append-only.
6. **Los datos personales viven en su propia tabla, con su propio control de acceso**, y nunca se desnormalizan en tablas de operación ni se exponen en vistas de listado.
7. **Fechas con semántica explícita**: `planned`, `baseline`, `forecast`, `actual`. Nunca una sola columna `date` que signifique cosas distintas según el contexto.

### 5.2 Esquema propuesto (PostgreSQL, resumido)

```
── CORE ─────────────────────────────────────────────────────────
org_entity        (SAS, LLC, LTA Wilmer/Oscar/Amagoia, Terceros)   -- vehículos facturadores
client            (+ logo, condiciones de pago, retraso histórico)
country           (ISO-3166)
service_line      (C4D, EL4D, TECH4D, SYS4D, CA4D)
app_user          (11 usuarios; rol de app + rol IH + estado)
currency, fx_rate (tabla de TRM con fecha; histórica y pactada)

── PROYECTO ─────────────────────────────────────────────────────
project           PK id · code_canonical UNIQUE · code_display
                  client_id, country_id, service_line_id, org_entity_id
                  pm_id, partner_manager_id, framework_contract_id
                  status (enum), lifecycle_state
project_amount    -- versionado: cada otrosí crea una versión, ninguna se sobrescribe
                  project_id, version, contract_amount, currency, fx_rate, fx_date,
                  costing_amount_cop (GENERATED), valid_from, valid_to, reason
project_costing   p_margin, p_ayf, p_unforeseen, p_ica, p_commission,
                  base_team, implementation_budget, implementation_reserve,
                  management_budget  -- derivados calculados, no capturados
project_date      project_id, date_type (planned_start|planned_end|actual_start|
                  actual_end|forecast_end), value, set_by, set_at

── PRESUPUESTO ──────────────────────────────────────────────────
budget_version    project_id, version, status(draft|approved|superseded), approved_by
budget_line       budget_version_id, ihpsc_item_id, description, unit, qty,
                  unit_price, currency, deploying_role, implementation(int|ext|mix)
budget_release    budget_line_id, released_pct, released_by, released_at, note
                  -- la liberación del 20 % deja de ser un comentario de texto

── INGRESO ──────────────────────────────────────────────────────
framework_contract (PNUD_10168806, UNICEF_…, CSJ_216 …)
revenue_milestone  project_id, seq, deliverable_desc,
                   amount, currency, fx_rate, amount_cop (GENERATED),
                   contract_date, expected_date, forecast_date,
                   state (scheduled|invoiced|credited|written_off)
invoice            milestone_id, number, issue_date, document_id
receipt            milestone_id, credited_date, amount_received, currency
delay_reason       milestone_id, category_id (catálogo cerrado), note

── CONTRATACIÓN ─────────────────────────────────────────────────
contractor          id, id_type, id_number_normalized(TEXT), profile_id,
                    is_internal, folder_url          -- SIN datos de contacto
contractor_pii      contractor_id, legal_name, phone, email   -- tabla restringida
hiring_request      code (GAP-HR-NNNN), project_id, requested_by, ih_capacity,
                    payor_org_id, category(OS|PS), state
request_service     request_id, ihpsc_item_id, qty, unit_price, deliverable, due_date
contract            code (OS_AAAA_NNN | PS_AAAA_NNN), project_id, contractor_id,
                    hiring_request_id  ← FK OBLIGATORIA (cierra la cadena D1)
                    overseer_id, account_category_id, org_entity_id,
                    start_date, end_date, state
contract_amount     -- versionado igual que project_amount; el otrosí actualiza el monto
contract_payment    contract_id, seq, due_date, amount, currency,
                    authorized_by, authorized_at,
                    paid_at, adm_validated_by,
                    contractor_invoice_doc_id, legal_support_doc_id
                    CHECK: no se marca paid sin legal_support_doc_id  ← cierra el riesgo
contract_addendum   contract_id, request, state, effect(dates|amount|scope)

── COSTO ────────────────────────────────────────────────────────
gl_account          code (PUC), name, mgmt_category_id  ← NOT NULL (cierra el 20/33)
gl_entry            project_id (FK real), gl_account_id, contractor_id (FK, nullable),
                    amount_cop, period_close_date, source_ref
cost_reconciliation gl_entry_id, contract_payment_id, confidence, matched_by
                    -- cierra la cadena contabilidad ↔ contratos (D1)
cost_pool           bolsas no-proyecto: Operaciones, Infraestructura Interna,
                    Amortización — con regla de prorrateo explícita, no manual

── INFRAESTRUCTURA ──────────────────────────────────────────────
infra_item          project_id (nullable = corporativo), category, provider, service,
                    status, start_date, end_date, monthly_budget, currency
infra_payment       infra_item_id, date, amount, currency, fx_rate, doc_id
allocation_rule     shared_resource_id, project_id, weight, valid_from, valid_to
                    -- el prorrateo de la Granja deja de ser una captura de pantalla

── CATÁLOGO ─────────────────────────────────────────────────────
ihpsc_item          code (CCC-PPP-DDD-VVV), ihp_id estable, denominación,
                    descripción, unit, cost_driver, modality(INH|EXT|MIX),
                    os_applicable, ref_cost, ref_currency, state
ihpsc_profile       37 perfiles, provisión (interno|mixto|externo), rate, rate_date
code_crosswalk      legacy_code, legacy_system(v1|subs), ihpsc_item_id

── TRANSVERSAL ──────────────────────────────────────────────────
document            hash, mime, size, storage_key, uploaded_by  -- deduplicado por hash
                    (elimina los 20 grupos de duplicados y las 8 referencias rotas)
event_log           entity, entity_id, action, actor, before, after, at  -- append-only
```

### 5.3 Lo que este modelo hace imposible

| Defecto actual | Restricción que lo impide |
|---|---|
| Sumar USD con COP | El monto en COP es columna generada a partir de moneda + TRM; no hay forma de sumar la columna equivocada |
| Un monto en una columna llamada `Currency` | `CHECK (currency ~ '^[A-Z]{3}$')` + FK a tabla de monedas |
| 42 proyectos huérfanos en costos | FK `gl_entry.project_id → project.id` |
| Contratista como texto libre | FK `gl_entry.contractor_id → contractor.id` |
| Solicitud sin contrato | FK obligatoria `contract.hiring_request_id` |
| Pago hecho sin soporte legal | `CHECK` de transición de estado |
| `ContractAmount` desactualizado tras otrosí | El monto vigente es una vista sobre `contract_amount` versionado |
| Cuenta contable sin categoría | `gl_account.mgmt_category_id NOT NULL` |
| Cédula visible en un listado | La PII vive en tabla aparte con `ROW LEVEL SECURITY` |
| Factura duplicada 6 veces | `document.hash UNIQUE` |
| Proyecto activo con cierre en el pasado | Estado y fecha son la misma máquina: no se puede quedar `active` pasada la fecha sin registrar una prórroga |


---

## 6. Arquitectura de producción recomendada

### 6.1 Principio: tres capas separadas, no una app monolítica

El error a evitar es reconstruir AppSheet en código propio. Lo que hay que construir son tres capas con contratos claros entre ellas, porque son las que tienen ritmos de cambio distintos:

```
┌─────────────────────────────────────────────────────────────┐
│  CAPA 3 — DECISIÓN                                          │
│  Métricas certificadas · Semáforos · Alertas · Proyecciones │
│  (cambia cada mes: es donde vive el aprendizaje del negocio)│
├─────────────────────────────────────────────────────────────┤
│  CAPA 2 — APLICACIÓN                                        │
│  API REST/GraphQL + máquinas de estado + reglas de negocio  │
│  Front web responsive · autenticación · roles               │
│  (cambia cada trimestre)                                    │
├─────────────────────────────────────────────────────────────┤
│  CAPA 1 — DATOS                                             │
│  PostgreSQL · restricciones · auditoría · almacén de objetos│
│  (cambia una vez al año, y con migración versionada)        │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Stack recomendado

| Capa | Recomendación | Por qué |
|---|---|---|
| Base de datos | **PostgreSQL 16+** (gestionado: Neon, Supabase, RDS o VPS propio) | Restricciones fuertes, columnas generadas, RLS para la PII, JSONB para lo que aún no está modelado, y `NUMERIC` exacto para dinero. Es la decisión menos reversible y la más fácil de acertar. |
| Almacenamiento de archivos | **S3-compatible** (Cloudflare R2 / Backblaze B2), deduplicado por hash | Saca los adjuntos de Drive a un almacén direccionable, con URLs firmadas y sin duplicados. |
| API | **Node/TypeScript (Fastify o NestJS)** o **Python (FastAPI)** | Cualquiera sirve. Elija por el equipo, no por la moda. Una sola regla: **toda la lógica de negocio vive aquí**, nunca en el front ni en la base. |
| Front | SPA ligera (**Svelte, Vue o vanilla JS + Web Components**) | Alineado con su preferencia por soluciones sin framework pesado, y suficiente: son ~10 pantallas CRUD y 3 tableros. |
| BI / semántica | **Metabase** o **Apache Superset** sobre vistas materializadas certificadas | Reemplaza Power BI *como herramienta de exploración*. Lo importante no es la herramienta: es que **consulte vistas, no tablas**. |
| Autenticación | OIDC contra Google Workspace (ya lo usan) | Cero contraseñas nuevas, y el rol viene del directorio. |
| Migraciones | Herramienta versionada (Prisma Migrate, Alembic, Flyway) | La base cambia por script en git, nunca a mano. |
| Observabilidad | Logs estructurados + alertas de calidad de dato | Ver §7.3. |

**Opción de aceleración a considerar:** si el objetivo es tener algo funcionando en 8-10 semanas en vez de 6 meses, un backend administrativo generado (**Directus** o **Refine**) sobre el mismo PostgreSQL cubre el 80 % del CRUD sin escribirlo, y usted invierte el esfuerzo de desarrollo donde está el valor diferencial: las máquinas de estado, las reglas de costeo y la capa de decisión. Recomiendo evaluarlo seriamente: el CRUD de contratistas no es donde InnovaHub gana dinero.

### 6.3 Sobre la relación con la idea de herramienta modular propia

Este sistema es, de hecho, **el mejor punto de partida para el producto modular** que usted ha querido construir. Ya tiene lo que a un producto le cuesta años conseguir: un dominio real, datos reales de 144 proyectos, procesos probados en operación y un cliente de referencia (usted mismo). La recomendación de arquitectura anterior es deliberadamente compatible con esa ambición:

- Los cinco dominios (proyecto, ingreso, contratación, infraestructura, costo) son **módulos separables** desde el día uno si el API los expone como servicios independientes con su propio esquema en la base (`project.`, `revenue.`, `procurement.`…).
- El catálogo IHPSC es un módulo vendible por sí solo (cotizador de servicios).
- La capa de decisión es lo que ninguna de las herramientas que usted evaluó —ClickUp, GanttPRO, Asana, Trello— hace bien para consultoría de proyectos financiados.

Pero una advertencia honesta: **no construya para vender mientras construye para operar.** Diseñar dos cosas a la vez es la forma más confiable de no terminar ninguna. Construya para InnovaHub, con fronteras de módulo limpias, y decida sobre el producto cuando el sistema lleve seis meses en operación real.

### 6.4 Seguridad y protección de datos personales (Ley 1581 de 2012)

Obligatorio desde el diseño, no como fase posterior:

- **Segregación**: la tabla `contractor_pii` con Row Level Security; solo los roles `admin` y `contratación` la leen. El resto del sistema trabaja con `contractor_id`.
- **Minimización en vistas**: ninguna vista de listado ni galería muestra documento de identidad, teléfono o correo. Se muestran bajo acción explícita ("Ver datos de contacto"), y esa acción se registra en `event_log`.
- **Nunca en BI**: los tableros usan identificadores anonimizados; los nombres completos de personas naturales no van a un informe publicado.
- **Aviso de privacidad y autorización**: cada contratista debe tener registrada su autorización de tratamiento, con fecha y documento. Hoy no existe ese campo; en el modelo objetivo debe ser obligatorio antes de emitir contrato.
- **Retención**: política explícita de cuánto tiempo se conservan los datos de un contratista sin contrato vigente.
- **Cifrado en reposo y en tránsito**, backups diarios cifrados con restauración probada trimestralmente.

### 6.5 Migración de datos: cómo hacerla sin perder ni inventar

La migración es un proyecto en sí mismo. La regla es: **nada entra a producción sin haber pasado por una etapa de saneamiento con decisión humana registrada.**

```
Hojas actuales ──► staging (esquema espejo, sin restricciones)
                       │
                       ├─► perfilado automático: nulos, tipos, duplicados, huérfanos
                       ├─► reglas de normalización (tildes, col_/co_, hon_/hn_)
                       ├─► COLA DE EXCEPCIONES  ← aquí decide una persona
                       │     · 42 códigos de costo huérfanos
                       │     · 20 cuentas contables sin categoría
                       │     · 95 pagos sin moneda
                       │     · 6 fechas de 2005 y 73 acreditados sin fecha
                       │     · 5 proyectos con TRM = 0
                       │     · 9 contratos con Σ pagos ≠ monto
                       │     · 3 huérfanos de contrato y 1 de solicitud
                       │     · registro de prueba "A Fantasma"
                       └─► carga a producción, con restricciones activas
```

Cada excepción resuelta se guarda con su decisión y su autor. Eso construye, de paso, el primer libro de reglas del negocio.

**Las hojas siguen siendo la fuente hasta el corte.** Recomiendo operación en paralelo de un ciclo mensual completo (captura en ambos sistemas, conciliación de totales al cierre) antes de apagar AppSheet. Es tedioso y es la única forma de migrar sin sustos.

---

## 7. La capa de decisión: de tablero a sistema que recomienda

Aquí está el salto que usted busca. Un tablero muestra; un sistema de decisión **detecta, prioriza y propone**. Tres niveles.

### 7.1 Nivel 1 — Métricas certificadas (una sola definición, en la base)

Vistas materializadas, versionadas en git, con pruebas automáticas. Ninguna herramienta de BI define una métrica por su cuenta.

| Métrica | Definición | Reemplaza a |
|---|---|---|
| `margin_committed` | (Ingreso adjudicado − costo causado − compromisos firmados no pagados) / ingreso adjudicado | El margen *ex post* de la página 2 |
| `budget_execution` | Causado + comprometido vs. presupuesto aprobado del ítem | El semáforo Alert/Risk/Fine, extendido a 144 proyectos |
| `reserve_consumption` | % del 20 % de reserva liberado y consumido | Los comentarios "Autorizado 100 % GAP" |
| `dso_by_client` | Días promedio entre fecha esperada y acreditación, por cliente | La página 7 (que ya lo hace bien) |
| `ar_aging` | Cartera por tramos 0-30 / 31-60 / 61-90 / +90, por cliente y responsable | No existe |
| `cash_forecast_13w` | Cobros probables (hito × probabilidad por cliente) − pagos comprometidos − costo fijo | No existe |
| `backlog` | Adjudicado no facturado, por mes de ejecución esperado | No existe |
| `compliance_rate` | % de pagos a terceros con soporte legal completo | No existe (150 incumplimientos invisibles) |
| `infra_cost_per_project` | Costo de infraestructura normalizado a COP, con prorrateo por regla | La cifra imposible de COP 75.917 M |
| `capacity_load` | Horas comprometidas por persona y semana vs. disponibles | No existe (requiere dato nuevo) |

### 7.2 Nivel 2 — Semáforos con umbral y dueño

Un indicador sin dueño y sin umbral es decoración. Cada semáforo debe responder: *¿quién actúa y a partir de qué valor?*

| Semáforo | Umbral | Dueño |
|---|---|---|
| Cartera vencida por cliente | > 30 días | Partner manager de la relación |
| Ejecución de presupuesto | > 85 % consumido con < 70 % de avance | Gestora del proyecto |
| Contrato próximo a vencer | 30 días antes de `end_date` | Gestora + administración |
| Contrato con Σ pagos ≠ monto | Cualquier diferencia | Administración |
| Pago realizado sin soporte legal | Cualquiera | Administración |
| Proyecto activo con fecha de cierre vencida | Cualquiera | Gestora — **con obligación de prorrogar o cerrar** |
| Margen proyectado por debajo del pMargin costeado | Desviación > 5 pp | COO |
| Ítem de infraestructura `ON` con `EndDate` vencida | Cualquiera (hoy: 29 casos) | Infraestructura |

La diferencia con hoy: **el semáforo de vigencia contractual ya existe y está en rojo casi siempre, y por eso nadie lo mira.** Al forzar la resolución (prorrogar o cerrar), el indicador vuelve a significar algo en dos ciclos.

### 7.3 Nivel 3 — Alertas y calidad de dato como ciudadano de primera

El sistema debe vigilarse a sí mismo. Un job diario que corre las pruebas de integridad y **avisa cuando la calidad se degrada**, con las mismas reglas que hoy están escritas en el documento de contexto: huérfanos, monedas faltantes, fechas imposibles, sumas que no cuadran, adjuntos sin referencia. Cada regla que hoy es una advertencia en un documento debe convertirse en una prueba automática que falla.

### 7.4 Lo que hay que empezar a capturar (dato nuevo, poco esfuerzo, mucho retorno)

Ordenado por relación valor/esfuerzo:

1. **Fecha de cierre real y prórrogas.** Sin esto no hay ninguna métrica temporal. Costo: un campo y una regla de proceso.
2. **Costo de referencia por ítem del catálogo IHPSC y tarifa por perfil.** Habilita cotización, margen esperado y comparación previsto/real. Costo: un taller de tarifas y llenar 308 filas — costear los ~40 ítems más recurrentes debería cubrir la mayor parte de lo que se vende, y eso es verificable contra el histórico antes de invertir en los 308.
3. **Presupuesto por ítem para todo proyecto nuevo, obligatorio al alta.** Es la condición para que exista control de proyecto. Costo: convertirlo en requisito del wizard, no en buena intención.
4. **Entregable con fecha comprometida y responsable** (la tabla `07B_DELIVERABLES` existe y está vacía). Habilita avance físico y, con él, valor ganado. Costo: medio.
5. **Asignación de personas por proyecto y ventana de tiempo** (no horas detalladas: dedicación por semana basta). Habilita capacidad y decisión de aceptación de proyectos. Costo: medio.
6. **Probabilidad de cobro por cliente**, derivada del histórico de retraso ya disponible. Costo: cero, es un cálculo.

Con los puntos 1, 2 y 3 —los tres baratos— la organización pasa de responder 1,5 preguntas de dirección a responder 6 de las 9 de la §4.

---

## 8. Plan por fases

Asumo un equipo pequeño (1 desarrollador senior + usted en definición funcional + 1 persona de administración validando datos). Los tiempos son órdenes de magnitud, no compromisos.

### Fase 0 — Saneamiento y congelación de alcance · 2-3 semanas
*Se hace sobre las hojas actuales, antes de escribir código.*
- Resolver la cola de excepciones de la §6.5 con decisión humana registrada.
- Congelar el modelo: qué se migra, qué se descarta (el backup de marzo 2025 va a histórico frío, no a producción).
- Cerrar el catálogo IHPSC v3.1 y **costear al menos los 40 ítems más vendidos**.
- Definir las 10 métricas de la §7.1 por escrito, con su fórmula exacta.
- **Criterio de salida:** cero huérfanos en el conjunto que se va a migrar y un diccionario de métricas firmado.

### Fase 1 — Núcleo de datos en producción · 4-6 semanas
- Esquema PostgreSQL completo con restricciones y auditoría.
- ETL de migración con staging, perfilado y cola de excepciones.
- API de lectura + almacén de documentos deduplicado.
- **Criterio de salida:** los totales de control reconcilian con el corte actual (6.620 M de ingreso esperado, 5.275 M acreditado, 2.523 M de costo, 830 M de contratos) con diferencia explicada línea a línea.

### Fase 2 — Paridad funcional · 6-8 semanas
- Los cinco módulos operativos con sus máquinas de estado.
- Wizard de alta de proyecto **con presupuesto por ítem obligatorio**.
- Flujo de contratación completo, ahora con llave solicitud→contrato.
- Roles y RLS para la PII.
- **Criterio de salida:** un ciclo mensual completo operado en paralelo, con cierre conciliado.

### Fase 3 — Capa de decisión · 4-6 semanas
- Vistas materializadas certificadas + BI conectado a ellas, no a las tablas.
- Semáforos con umbral y dueño; alertas por correo y en la app.
- Job diario de calidad de dato.
- Curva S y pronóstico de caja a 13 semanas.
- **Criterio de salida:** el comité de dirección toma sus decisiones semanales sobre este sistema y no sobre hojas paralelas.

### Fase 4 — Potenciación · continuo
- Cotizador sobre IHPSC (precio defendible + margen esperado por ítem).
- Capacidad y carga del equipo.
- Entregables con avance físico → valor ganado (CPI/SPI), que es lo que su formación PMBOK permite explotar y que ninguna de las herramientas del mercado que usted evaluó le da bien.
- Prorrateo automático de infraestructura compartida por regla.
- Portal de cliente de solo lectura (hitos, entregables, facturación) — alto valor percibido, bajo costo de construcción.
- Apagado de AppSheet.

**Total estimado hasta Fase 3: 4 a 6 meses.** Fase 0 es la que más se subestima y la que más determina el resultado.

---

## 9. Riesgos y cómo mitigarlos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Migrar los defectos junto con los datos** | Alta | Alto | Fase 0 obligatoria con cola de excepciones. Ningún dato entra sin pasar restricciones. |
| **Reconstruir AppSheet 1:1 y no ganar nada** | Alta | Alto | El criterio de éxito no es paridad funcional: son las 9 preguntas de la §4. Revisar contra esa lista en cada fase. |
| **El presupuesto por ítem sigue sin llenarse** (el defecto se repite en la nueva casa) | **Muy alta** | Muy alto | Hacerlo bloqueante en el alta del proyecto. Es una decisión de proceso, no de software: sin presupuesto no hay proyecto activo. |
| **Resistencia del equipo a capturar más** | Alta | Medio | Compensar con eliminación: quitar el doble registro que hoy existe entre hojas paralelas y la app, y automatizar el prorrateo manual de infraestructura. Que capturar más se sienta como trabajar menos. |
| **Dependencia de una sola persona desarrolladora** | Media | Alto | Migraciones versionadas en git, esquema documentado, stack convencional. Nada exótico. |
| **Alcance que crece hacia el producto vendible** | Media | Alto | Ver §6.3. Fronteras de módulo sí; funcionalidades para clientes hipotéticos no. |
| **Costo de operación mayor que AppSheet** | Baja | Medio | Postgres gestionado + almacén de objetos + un pequeño VPS cuesta menos que las licencias de AppSheet a partir de cierto volumen. Modelar el costo antes de decidir el proveedor. |
| **Pérdida de la movilidad que hoy da AppSheet** | Media | Medio | Front responsive desde el diseño; las gestoras usan el móvil para consultar y aprobar, no para capturar. |

---

## 10. Decisiones que hay que tomar antes de escribir la primera línea

Estas son las preguntas que debe responder la dirección, no el desarrollo:

1. **¿Cuál es la fuente de verdad del costo:** la contabilidad de la SAS (`04_COSTS`) o el cronograma de pagos a terceros (`07B`)? Hoy registran el mismo dinero por caminos separados y ninguna concilia con la otra. Sin esta definición no hay margen confiable.
2. **¿Se costea el trabajo interno?** Hoy la nómina se causa a proyecto, y por eso las gestoras aparecen como "contratistas". ¿Se mantiene ese criterio (correcto para margen real) y se separa explícitamente el costo interno del externo?
3. **¿Qué se hace con las bolsas contables** (`Operaciones`, `Infraestructura Interna`, `Amortización de costos`)? ¿Se prorratean a proyecto con una regla, o se quedan como overhead corporativo? Cambia radicalmente todo margen por proyecto.
4. **¿Se adopta IHPSC v3.1 como catálogo único y se costea?** Es la decisión de mayor apalancamiento de todo el ejercicio. Si la respuesta es no, la Fase 4 completa deja de ser posible.
5. **¿El presupuesto por ítem se vuelve obligatorio?** Sin un sí explícito y sostenido, el sistema nuevo va a repetir el 2 de 144.
6. **¿TRM pactada o TRM de mercado?** Hoy conviven ambas sin distinguirse. El modelo objetivo las separa, pero alguien debe decidir cuál manda para cada uno de los dos usos (costeo vs. reporte).
7. **¿Quién es el dueño de cada semáforo de la §7.2?** Un indicador sin nombre propio no cambia ninguna conducta.

---

## 11. Recomendación final

El sistema actual es un buen levantamiento de requisitos disfrazado de aplicación. Su mayor valor no son los datos —que están, con defectos corregibles— sino **el conocimiento de proceso que está codificado en él**: el costeo con reserva liberable, la doble validación de pagos, el ciclo de tres estados de ingreso, la codificación de servicios. Eso no se tira.

Lo que sí hay que abandonar es la premisa de que una hoja de cálculo con una capa visual encima puede sostener decisiones financieras de una empresa que mueve 6.600 millones de pesos en compromisos de ingreso. No puede, y las cifras imposibles del tablero actual son la prueba.

Mi recomendación concreta, en orden:

1. **Hacer la Fase 0 ya**, incluso antes de decidir el stack. El saneamiento y el costeo del catálogo tienen valor por sí mismos, con o sin sistema nuevo.
2. **Construir el modelo antes que la aplicación.** Si sólo hubiera presupuesto para una cosa, que sea la base de datos bien diseñada: sobre ella se puede poner cualquier front, incluso AppSheet en el interín.
3. **Medir el éxito por las 9 preguntas de la §4**, no por pantallas entregadas.
4. **Instrumentar tres cosas que hoy no cuestan casi nada y valen mucho:** fecha de cierre real, costo de referencia por ítem, y presupuesto obligatorio al alta.

Si el sistema nuevo, a los seis meses, permite que usted mire una pantalla el lunes por la mañana y sepa a quién cobrarle, qué proyecto se está saliendo del presupuesto y si puede aceptar el contrato que le ofrecen el jueves, la migración habrá valido la pena. Si solo permite ver los mismos 144 proyectos en otra base de datos, no.

---

## Anexo A — Defectos verificados directamente en el front

Lista de lo que observé en pantalla, útil como lista de verificación de la migración:

| # | Dónde | Observación |
|---|---|---|
| 1 | Contractors | Texto de plantilla sin configurar visible en las 73 tarjetas |
| 2 | Contractors | Registro de prueba en producción (`A Fantasma`, ID `0`) |
| 3 | Contractors / Contract book | Documento de identidad, teléfono y correo visibles en listados |
| 4 | Project Upload | `Costing currency` capturado como campo numérico |
| 5 | Project Upload | Campos calculados sin etiqueta explicativa (solo color) |
| 6 | Project Upload | Campo `ProductionCosts` no documentado |
| 7 | Invoice Information | Los dos paneles no están vinculados por selección |
| 8 | Invoice Information | Sin totales, sin antigüedad de cartera, sin marca de vencido |
| 9 | Project Control | Mayoría de proyectos activos marcados "Expired contract" |
| 10 | Project Control | `co_csj_rama_judicial_2025` (COP 1.099 M) sin presupuesto, sin `BudgetManagement`, sin `Cost` |
| 11 | Contract book | Pagos futuros (2027) mezclados con vencidos, sin distinción visual |
| 12 | UX customization | Erratas de catálogo en producción (`Grece`, `switzerland`) |
| 13 | Power BI p.1 | `Balance` = `$ 0 mill.` para las 10 gestoras; panel "General Data" vacío |
| 14 | Power BI p.3 | Márgenes brutos con valor `-Infinito`; filas `Not classified` |
| 15 | Power BI p.5 | COP, USD, EURO y "Other" con idéntico valor |
| 16 | Power BI p.6 | Total en COP no reconcilia con la suma de sus particiones |
| 17 | Power BI p.9 | Total de infraestructura COP 75.917.297.083 (mezcla de monedas) |
| 18 | Power BI p.8 | Nombres completos de personas naturales en informe publicado |
| 19 | Menú | El *Dashboard* salta a una herramienta externa sin contexto ni filtros |
| 20 | Hiring Menu | Flujo con máquina de estados correcta, pero sin llave al contrato resultante |

## Anexo B — Cifras de control para validar la migración

Corte 2026-08-27 (del documento de contexto). Estas cifras deben reconciliar al terminar la Fase 1:

| Métrica | Valor |
|---|---|
| Proyectos | 144 (87 completados · 53 activos · 3 cancelados · 1 pausado) |
| Σ `CostingAmount` | COP 6.838 M |
| Σ ingreso esperado | COP 6.620 M · acreditado 5.275 M · pendiente 1.337 M (vencido 903 M) |
| Σ costos contables | COP 2.523 M (2024: 843 · 2025: 1.103 · 2026 parcial: 577) |
| Contratos con terceros | 221 (193 OS + 28 PS) · Σ COP 830 M · pagado 548 M |
| Solicitudes 2026 | 97 (78 procesadas = COP 284,6 M) |
| Contratistas | 73 (67 con contrato) |
| Hitos de ingreso | 339 (286 acreditados · 40 programados · 12 facturados · 1 anómalo) |

---

*Documento elaborado a partir del recorrido directo de la aplicación y del informe Power BI el 29 de agosto de 2026, y del documento `CONTEXTO_BACKEND_GAP_DATA.md` con corte 2026-08-27. Ningún dato ni configuración fue modificado. Se omiten deliberadamente datos personales de contratistas observados durante el recorrido.*
