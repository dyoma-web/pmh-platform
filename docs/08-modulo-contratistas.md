# Módulo de Contratistas — visión de diseño (pre-implementación)

**Estado:** propuesta para discusión con dirección · 2026-08-30
**Pedido original:** filtro persona/empresa · tarjeta 360 (proyectos, pagado, pendiente,
percibido, gestoras actuales e históricas) · submódulo interno (perfil, habilidades,
historial, productos, pagos, documentación, cuentas de cobro, calificaciones internas) ·
evolución a espacio de autogestión del contratista.

---

## 1. El concepto: un expediente, dos lentes

La regla que evita que esto se pudra: **una sola fuente de verdad — el expediente del
contratista — con dos proyecciones**. La vista interna lo ve todo; el portal es un filtro
de ese mismo expediente, nunca una base paralela. Si un dato aparece en el portal y en la
vista interna con valores distintos, el módulo fracasó.

Y un principio que recomiendo adoptar de una vez: **asimetría transparente**. El
contratista debe poder saber qué información suya maneja la empresa (es su derecho bajo la
Ley 1581), con dos reservas explícitas y defendibles: las evaluaciones internas de servicio
y las notas de relación. Sobre esas dos, una advertencia de experto: bajo habeas data el
titular puede llegar a ejercer derecho de acceso sobre datos que le conciernen. La práctica
sana es **escribir toda evaluación como si el contratista pudiera leerla algún día**:
hechos verificables ("entregó 6 días tarde el módulo 2", "requirió 3 rondas de ajustes"),
nunca juicios de persona. Eso las hace legalmente sólidas Y más útiles.

## 2. La cara interna: el Expediente 360

### 2.1 Directorio (evoluciona el actual)

- **Filtros**: persona natural / jurídica (hoy inferible por `company_name` — se formaliza
  como campo `kind`), perfil, estado de relación, con contratos activos, evaluación
  promedio, semáforo documental.
- **Tarjeta de directorio**: nombre, tipo, perfil(es), contratos activos, **total
  percibido**, **pendiente por pagar**, gestoras con las que trabaja hoy, evaluación
  promedio (solo interno), semáforo de documentos vigentes. Sin cédula ni contacto en el
  listado (regla que ya rige).

### 2.2 Ficha 360 — secciones

1. **Cabecera**: identidad, tipo, perfiles, estado de la relación
   (`en_vinculacion → activo → inactivo → no_elegible`), antigüedad de la relación,
   autorización Ley 1581, semáforo documental.
2. **Cifras de la relación** (todas calculadas del ledger, nada digitado):
   - Total percibido histórico · pendiente por pagar · contratos activos/históricos
   - Ticket promedio y rango
   - **% del gasto en terceros que concentra** → riesgo de dependencia visible
   - **Días promedio en que LE pagamos** (nuestro DSO hacia él) → métrica de justicia con
     el proveedor; un contratista al que se le paga tarde se pierde
3. **Proyectos y gestoras**: matriz proyecto × gestora, separando *actuales* (contrato
   activo) de *históricas* — responde directamente "¿con quién está y con quién ha
   trabajado?".
4. **Productos contratados (habilidades demostradas)**: mapeo de sus contratos a ítems
   IHPSC → lo que sabe hacer **según lo que realmente le hemos comprado**. Se complementa
   con habilidades *declaradas* (las escribe él en el portal) y *certificadas* (con
   documento). Tres orígenes, tres pesos distintos al buscar a quién contratar.
5. **Tarifas históricas**: precio unitario que se le ha pagado por ítem IHPSC a lo largo
   del tiempo → negociación informada y alimenta el tarifario del catálogo.
6. **Pagos y cuentas de cobro**: cronograma completo con estados, cada pago con su cuenta
   de cobro y soporte enlazados (ya existe en el modelo; aquí se consolida por persona).
7. **Expediente documental con vigencias** — la pieza que falta hoy: no basta con que el
   documento *exista*, importa que esté *vigente*:
   - RUT (vigencia anual) · certificación bancaria · autorización Ley 1581 (una vez) ·
     **seguridad social (vigencia mensual — el origen real de los 150 pagos sin soporte)**
     · certificaciones profesionales (opcionales)
   - Cada tipo con su periodo; el semáforo documental sale de aquí; el CHECK de pagos
     evoluciona de "existe una URL" a "existe un documento VIGENTE para el periodo del pago".
8. **Evaluaciones internas** (invisibles en el portal):
   - Se disparan **automáticamente al terminar cada contrato** (semáforo a la gestora
     supervisora: "califica el servicio") — si es opcional y manual, no pasará.
   - Criterios fijos y pocos (recomiendo 4): calidad del entregable · cumplimiento de
     fechas · comunicación · autonomía. Escala 1-5 + un hecho destacable obligatorio.
   - Promedio visible en directorio y ficha; historial por contrato.
9. **Bitácora de relación**: notas internas fechadas y firmadas (append-only, como todo).

### 2.3 Inteligencia que la empresa gana (con estos datos)

- **Matching al contratar**: cuando la gestora crea una solicitud con ítem IHPSC, el
  sistema sugiere contratistas ordenados por: ha hecho ese ítem × evaluación × tarifa
  histórica × disponibilidad declarada × documentos vigentes. La decisión sigue siendo
  humana; la lista corta la arma el sistema.
- **Alertas nuevas para Mi día**: documento por vencer (seguridad social del mes),
  concentración excesiva de gasto en un tercero, contrato nuevo a contratista con
  evaluación baja (aviso, no bloqueo), contratista clave inactivo hace N meses.
- **Onboarding formal**: estado `en_vinculacion` con checklist (RUT, cuenta bancaria,
  autorización 1581) — **sin expediente completo no se emite el primer contrato**, la
  misma filosofía del presupuesto bloqueante.
- **`no_elegible` con motivo y autor** (auditable) en vez de borrar o "olvidar": la
  memoria institucional de por qué no se vuelve a contratar a alguien hoy vive en la
  cabeza de las gestoras.

## 3. La cara externa: «Mi espacio» (evolución del portal)

Hoy el portal ya permite ver pagos y subir cuenta de cobro + seguridad social. La
evolución en tres niveles:

### Nivel 1 — Autogestión documental y transparencia
- **Mi expediente**: subir/renovar RUT, certificación bancaria, seguridad social del mes
  (eligiendo el periodo) — con semáforo de qué le falta y para qué pago.
- **Mis contratos**: cada contrato con sus entregables, fechas y estado de pagos; acuse de
  recibo del contrato en el portal (traza de que lo conoció).
- **Mis datos**: actualizar teléfono/correo (escribe directo a `pii` con auditoría) y
  ejercer derechos de habeas data (solicitud tipificada de corrección/supresión).
- **Avisos**: pago validado 🎉, documento por vencer, contrato nuevo, otrosí aprobado.
  Correo + bandeja en el portal. (Cubre el ítem P1 del checklist "notificación al
  contratista cuando su pago es autorizado".)
- **Certificado de contratos e ingresos descargable** — la joya escondida: los
  contratistas piden estas certificaciones para bancos/arriendos constantemente y hoy se
  hacen a mano. Generado por Cota con código QR de verificación → valor real para ellos,
  cero trabajo para administración.

### Nivel 2 — Participación
- **Disponibilidad declarada** (mes a mes: disponible / parcial / no) → cruza con el
  módulo de capacidad y alimenta el matching.
- **Habilidades declaradas** y portafolio (enlaces).
- **Solicitudes tipificadas, NO chat**: "solicitar adelanto", "reportar novedad en
  entregable", "pedir certificado", "actualizar mis datos" — cada una es una cola con
  dueño interno y estado, gestionable y auditable. Un chat libre se vuelve un pasivo de
  atención; las colas tipificadas no.
- **Postulación**: administración puede publicar una necesidad (ítem IHPSC + ventana +
  presupuesto) y los contratistas del directorio se postulan — el "marketplace interno"
  embrionario.

### Nivel 3 — Cierre del ciclo
- **Firma del contrato en el portal** (ya pagan DocuSign: se integra, no se construye).
- **Cuenta de cobro generada por el sistema**: el contratista confirma el pago del
  cronograma y Cota le genera la cuenta de cobro con sus datos — en vez de que cada quien
  suba un PDF distinto. Estandariza el documento que hoy llega en 70 formatos.

### Autenticación del portal (decisión técnica)
El token permanente actual sirvió para el MVP, pero para "Mi espacio" recomiendo **magic
link**: el contratista pide entrar con su correo registrado, recibe un enlace de un solo
uso (15 min), sesión de un día. Sin contraseñas, revocable, y el acceso queda ligado al
correo del expediente. Cuenta con contraseña solo si algún día el marketplace lo exige.

## 4. Modelo de datos (borrador para la implementación)

```
procurement.contractor            + kind (natural|juridica), relation_state, since
procurement.contractor_skill      (contractor, skill, origen: declarada|demostrada|certificada, doc)
procurement.contractor_document   (contractor, tipo, periodo/vigente_hasta, document_id, estado)
procurement.contractor_review     (contract_code UNIQUE, q_calidad, q_fechas, q_comunicacion,
                                   q_autonomia, hecho_destacable, autor, fecha)  ← sin acceso de portal
procurement.contractor_note       (contractor, nota, autor, fecha)               ← append-only
procurement.contractor_availability (contractor, mes, estado)
core.notification                 (destinatario_tipo, destinatario_id, tipo, payload, leida, enviada)
procurement.portal_request        (contractor, tipo, detalle, estado, atendida_por)
metrics.v2_contratista_360        (percibido, pendiente, concentración, dso_pago, proyectos,
                                   gestoras_actuales[], gestoras_historicas[], eval_promedio)
```

## 5. Secuencia propuesta (tres entregas)

| Entrega | Contenido | Depende de |
|---|---|---|
| **E1 · Expediente 360 interno** | Filtros persona/empresa, tarjeta con cifras del ledger, matriz proyectos×gestoras, tarifas históricas, expediente documental con vigencias, evaluaciones con disparo al cerrar contrato, bitácora | Nada — el 80 % sale de datos existentes |
| **E2 · Mi espacio v2** | Avisos + correo, expediente self-service, mis datos + habeas data, certificado de ingresos con QR, magic link | E1 (tipos de documento) + SMTP |
| **E3 · Participación** | Disponibilidad, habilidades declaradas, solicitudes tipificadas, matching en el flujo de contratación, postulaciones | E1+E2 en uso real |

## 6. Decisiones que necesito de dirección antes de implementar

1. **Criterios y escala de evaluación** (propongo los 4 de arriba, 1-5) y **quién los ve**:
   ¿todas las gestoras o solo administración/dirección?
2. **Política de la evaluación**: ¿obligatoria para cerrar el contrato (bloqueante) o
   semáforo insistente? Recomiendo bloqueante — es un campo y 30 segundos.
3. **Certificado de ingresos**: ¿qué debe decir y quién lo firma institucionalmente?
4. **Magic link vs token permanente** para Mi espacio (recomiendo magic link).
5. **¿La disponibilidad declarada del contratista la ven todas las gestoras?** (propongo sí).
