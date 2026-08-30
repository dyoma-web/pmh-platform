# 09 · Líneas de vida y agenda

**Estado:** implementado (migración `0018`, sección 01 · Agenda, línea de vida en la ficha de
proyecto y en el expediente 360 del contratista). Decisión de dirección: 30 ago 2026.

## 1. La idea

Todo lo que la dirección pidió ver "en un calendario" —draft, emisión y firmas del contrato,
vigencias, pagos previstos y ejecutados, cuentas de cobro, entregas y aprobaciones, rondas de
ajuste, otrosíes, facturas, cobros, cargue de documentación, cambios de fechas— tiene la misma
anatomía: **un evento con fecha prevista y/o fecha real, una familia y un dueño**. Por eso hay un
solo modelo (`metrics.v2_eventos`) y dos productos encima:

| | Agenda (calendario) | Línea de vida |
|---|---|---|
| Pregunta | ¿Qué debo hacer hoy / esta semana? | ¿Qué pasó con este contrato o proyecto y cuánto se desvió? |
| Unidad | compromiso: acción + dueño + fecha límite | evento: hecho con plan y real |
| Contenido | solo `pendiente` y `vencido` (lo cumplido, en gris, como memoria del día) | todo, incluido lo no registrado |
| Vistas | día · semana · mes · año | por contrato · por proyecto |

Regla que las separa: **al calendario solo va lo que alguien debe hacer; lo ocurrido vive en la
línea de vida.** Un pago validado desaparece de la agenda y aparece como ▼ en la línea.

## 2. Familias y eventos

| Familia | Contrato (contratista) | Proyecto |
|---|---|---|
| **Actos** | solicitud, contrato emitido, firma InnovaHub, firma contratista, vigencia, inicio, fin, expediente documental completo | vigencia, cierre, cargue de contrato y documentación |
| **Dinero** | pago (autorizar → validar), cuenta de cobro (5 días antes del pago) | factura, cobro |
| **Entregas** | entrega (planeada → entregada), aprobación (rondas usadas / pactadas) | entregable del proyecto (avance 100 %) |
| **Novedades** | otrosí (monto, fechas, plazo, alcance, anulación) | cambios de fecha o estado (bitácora automática), versiones de monto |

Estados: `pendiente`, `vencido`, `cumplido`, `anulado`, `no_registrado`.
**`no_registrado` es una categoría honesta**: contratos históricos sin fecha de firma, cuentas de
cobro de pagos ya validados sin fecha de envío. Nunca se rellena con una fecha inventada.

Anticipación en agenda: pagos, cobros, facturas y cuentas de cobro avisan **3 días hábiles** antes
(vista día → "Dinero en los próximos tres días hábiles"); firmas, entregas y cierres, el día.
Lo vencido se arrastra hasta que alguien lo cierre.

## 3. Lo que hubo que empezar a capturar (0018)

| Dato | Dónde | Quién lo escribe |
|---|---|---|
| `hiring_request.created_at` | solicitud | automático al crear |
| `contract.drafted_at`, `issued_at`, `base_amount` | contrato | automático al procesar la solicitud |
| `contract.signed_internal_at/_by`, `signed_contractor_at` | contrato | expediente 360 → "Firma InnovaHub" (administración) / "Firma del contratista" |
| `contract_payment.submitted_at` | pago | portal (primera cuenta de cobro) o validación |
| `project.docs_uploaded_at` | proyecto | ficha → "Registrar cargue" |
| `procurement.contract_deliverable` | entregas por contrato | plan heredado de la solicitud; entregar / aprobar / devolver (+1 ronda) en el expediente 360 |
| `core.project_change` | bitácora | trigger sobre `core.project` (closing_date, start_date, status) |
| `procurement.required_document` | documentos obligatorios por tipo (natural / jurídica) | tabla editable; hoy: RUT, cert. bancaria, autorización 1581, seguridad social para ambos |
| otrosí de **plazo** | `contract_amendment.effect='plazo'` | mueve `end_date` y guarda la fecha anterior (fantasma en la línea) |

Los 221 contratos legados no tienen solicitud enlazada (cadena rota en AppSheet), así que no
heredan plan de entregas: sus entregas se planean a mano si hace falta.

## 4. Decisiones

- **Sobrecosto**: línea base = monto del contrato al emitirlo (antes del primer otrosí de monto);
  `metrics.v2_sobrecosto` da monto, %, número de otrosíes y prórrogas.
- **Brecha de financiación** (`metrics.v2_brecha_financiacion`): pagado a terceros − cobrado al
  cliente, cuando es positivo. Se lee en la cabecera de la línea de vida del proyecto.
- **Rondas**: devolver una entrega suma una ronda; superar las pactadas no se bloquea, se marca
  ("excede rondas") — es exactamente lo que hay que ver.
- **Google Calendar**: no se conecta por ahora (decisión 30 ago 2026). La agenda usa su sistema de
  visualización (día/semana/mes/año) dentro de Koleto. Si algún día se conecta, será un feed ICS
  de solo lectura por persona y familia: Koleto sigue siendo la fuente.

## 5. Gramática visual (manual Koleto)

◇ acto · ▽ dinero · ○ entrega · ◈ novedad. **Hueco = previsto, sólido = ocurrido**; el segmento
entre ambos es la desviación en días (punteado si es atraso). Punteado sin relleno = no
registrado. Rojo solo para vencido, y nunca como único portador: la forma y el relleno llevan el
significado. Línea de "hoy" en acento. Cada marca lleva su tooltip y la cronología completa está
como tabla desplegable (imprimible en B/N).

## 6. Pendiente

- Lead times agregados (solicitud→firma, entrega→aprobación, cuenta de cobro→pago) por gestora
  en el cockpit.
- Entregas por producto en el comparador (usar `contract_deliverable.ihpsc_group` y rondas
  reales en lugar de las estáticas de la evaluación).
- Festivos colombianos en `metrics.dias_habiles` (hoy cuenta solo fines de semana).
