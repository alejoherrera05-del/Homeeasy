# HomeEasy · Hommy Seguimiento Inteligente

Estado: **Ruta aprobada para implementación**

## Visión

Convertir `seguimiento.html` de un radar pasivo de cotizaciones en un centro comercial inteligente donde Hommy pueda:

1. entender cada oportunidad;
2. leer el contexto comercial disponible;
3. decidir la próxima mejor acción;
4. redactar un mensaje natural y contextual;
5. enviarlo por WhatsApp de forma automática o con revisión humana;
6. interpretar las respuestas del cliente;
7. actualizar la memoria comercial de la cotización;
8. detenerse cuando haya venta, archivo, rechazo, solicitud de no contacto o intervención humana;
9. medir qué seguimientos generan respuesta, reactivación y venta.

La meta no es crear un bot de recordatorios. La meta es que **Hommy funcione como asistente comercial de HomeEasy**.

---

## Lo que ya existe y se reutiliza

### HomeEasy

- `seguimiento.html` ya consulta cotizaciones abiertas con `GET_SEGUIMIENTO`.
- Cada cotización ya tiene notas manuales (`notas_seguimiento`).
- Se puede archivar una cotización desde el radar.
- La app usa permisos y sesión HomeEasy.

### Hommy

- Hommy ya vive dentro de HomeEasy.
- El frontend usa el backend `homeeasy-hommy-staging.onrender.com`.
- El chat actual envía contexto mediante la sesión HomeEasy y conversa con `/api/hommy/chat`.
- Hommy ya puede consultar datos reales de HomeEasy según permisos.

### WhatsApp

- Ya existe `HomeEasy WhatsApp Bridge` en el VPS.
- El Bridge ya autentica con la sesión HomeEasy.
- Ya envía texto de prueba y documentos.
- Ya registra actividad persistente.
- Ya tiene plantillas persistentes.
- Ya implementa idempotencia para evitar duplicados de documentos.

---

## Principio arquitectónico

Separar responsabilidades.

```text
HomeEasy / seguimiento.html
        |
        | consulta y acciones humanas
        v
Backend HomeEasy / base de datos
        |
        | estado + historial comercial
        +------------------------------+
        |                              |
        v                              v
Hommy AI                         Follow-up Worker 24/7
razona y redacta                 decide qué está vencido
        |                              |
        +---------------+--------------+
                        |
                        v
              WhatsApp Bridge
                        |
                        v
                    WAHA / WEBJS
                        |
                        v
                     Cliente
```

### Regla crítica

El navegador **no puede ser el motor de automatización**. Si Alejandro cierra HomeEasy, el seguimiento debe continuar. Por eso la ejecución automática debe vivir en un proceso 24/7.

El VPS existente es el lugar natural para un `followup-worker`, pero la fuente de verdad de la oportunidad debe seguir siendo HomeEasy, no un JSON aislado del Bridge.

---

# Modelo comercial

## 1. Estado actual de una oportunidad

Crear un estado resumido por cotización.

Campos propuestos:

- `cotizacionNumero`
- `clienteId`
- `telefono`
- `automationMode`: `OFF | REVIEW | AUTO`
- `status`: `ACTIVE | WAITING_CUSTOMER | HUMAN_TAKEOVER | PAUSED | STOPPED | CONVERTED | ARCHIVED`
- `intent`: intención detectada por Hommy
- `temperature`: `HIGH | ACTIVE | RISK | COLD | WAITING`
- `summary`: resumen comercial corto
- `objections`: objeciones conocidas
- `promisedFollowupAt`: fecha que el propio cliente indicó
- `nextActionAt`
- `nextActionType`
- `lastOutboundAt`
- `lastInboundAt`
- `lastHumanAt`
- `lastHommyAt`
- `followupAttempts`
- `stopReason`
- `updatedAt`

Este registro es un **snapshot** para pintar rápido la tarjeta.

## 2. Historial inmutable de seguimiento

No se debe sobrescribir la nota manual cada vez que Hommy actúe.

Crear un timeline append-only con eventos como:

- `QUOTE_CREATED`
- `MANUAL_NOTE`
- `AI_ANALYSIS`
- `DRAFT_CREATED`
- `MESSAGE_APPROVED`
- `MESSAGE_SENT`
- `MESSAGE_FAILED`
- `CLIENT_REPLY`
- `INTENT_CHANGED`
- `NEXT_ACTION_CHANGED`
- `PAUSED`
- `RESUMED`
- `HUMAN_TAKEOVER`
- `STOPPED`
- `CONVERTED`
- `ARCHIVED`

Campos mínimos por evento:

- `id`
- `cotizacionNumero`
- `at`
- `actorType`: `HOMMY | HUMAN | CLIENT | SYSTEM`
- `actor`
- `eventType`
- `channel`: `WHATSAPP | APP | SYSTEM`
- `text`
- `messageId`
- `intent`
- `temperature`
- `nextActionAt`
- `metadata`

### Nota manual vs memoria de Hommy

- **Nota manual:** sigue perteneciendo al vendedor y nunca Hommy la pisa.
- **Resumen Hommy:** se recalcula a partir del contexto.
- **Timeline:** conserva qué sucedió realmente.

---

# Ciclo de decisión de Hommy

Cada oportunidad vencida pasa por este flujo:

```text
1. Reunir contexto
      ↓
2. ¿Existe motivo de STOP?
      ├─ Sí → detener
      └─ No
          ↓
3. Interpretar conversación
          ↓
4. Determinar intención y temperatura
          ↓
5. ¿Conviene contactar ahora?
      ├─ No → programar próxima revisión
      └─ Sí
          ↓
6. Elegir objetivo comercial
          ↓
7. Redactar mensaje
          ↓
8. Guardar borrador + razonamiento estructurado
          ↓
9. REVIEW → espera aprobación
   AUTO   → enviar
          ↓
10. Registrar resultado y programar siguiente revisión
```

Hommy no debe decidir solo por “cantidad de días”. La conversación manda.

Ejemplo: si el cliente dijo “el viernes te confirmo”, Hommy no debe escribir el jueves aunque se haya cumplido el umbral general.

---

# Contrato estructurado para la IA

No aceptar como respuesta del modelo solamente texto libre. Crear un endpoint especializado que devuelva JSON validado.

Propuesta:

`POST /api/hommy/followup/plan`

Entrada resumida:

```json
{
  "quote": {},
  "customer": {},
  "commercialState": {},
  "manualNotes": "",
  "recentTimeline": [],
  "recentWhatsApp": [],
  "businessRules": {}
}
```

Salida esperada:

```json
{
  "decision": "SEND | WAIT | STOP | HUMAN_REVIEW",
  "reasonCode": "NO_RESPONSE | CUSTOMER_PROMISE | PRICE_OBJECTION | ...",
  "intent": "EVALUATING",
  "temperature": "ACTIVE",
  "summary": "Cliente interesado; está revisando la propuesta con su pareja.",
  "objective": "Retomar decisión sin presionar.",
  "message": "...",
  "nextActionAt": "2026-09-05T10:30:00-05:00",
  "confidence": 0.91,
  "needsHumanReview": false,
  "stopReason": null
}
```

El backend valida enums, longitud, fecha y permisos antes de aceptar el plan.

---

# Guardrails comerciales

Hommy nunca puede:

- inventar descuentos;
- ofrecer un precio no contenido en HomeEasy;
- prometer tiempos de entrega no confirmados;
- inventar disponibilidad;
- crear falsa urgencia o falsa escasez;
- afirmar que “revisó” algo que no recibió en contexto;
- continuar escribiendo después de un rechazo claro;
- continuar después de una solicitud de no contacto;
- enviar de madrugada o fuera de la ventana comercial definida;
- bombardear al cliente;
- discutir con un cliente;
- ocultar que necesita intervención humana cuando el caso lo requiere.

Al detectar precio, descuento, reclamo, error contractual, solicitud especial o ambigüedad importante, puede recomendar una respuesta pero debe elevar a humano según las reglas.

---

# Modos de automatización

## OFF

Hommy analiza únicamente cuando el usuario se lo pide.

## REVIEW

Hommy prepara la próxima acción y el mensaje, pero un humano debe aprobarlo.

## AUTO

Hommy puede enviar automáticamente si:

- la decisión es `SEND`;
- no existe regla de STOP;
- la confianza supera el umbral definido;
- el caso no exige revisión humana;
- está dentro del horario comercial;
- la oportunidad no cambió desde que se generó el plan;
- la idempotencia confirma que ese seguimiento no se envió antes.

Para el primer despliegue real, comenzar en **REVIEW** y pasar a **AUTO** después de QA y suficientes casos observados.

---

# WhatsApp entrante: pieza obligatoria

El Bridge actual está orientado principalmente a envío. Para que Hommy realmente entienda una negociación debe recibir respuestas del cliente.

Implementar:

1. webhook/evento entrante desde WAHA;
2. normalización del teléfono;
3. ignorar mensajes propios;
4. vincular teléfono → cliente → cotización activa;
5. guardar evento `CLIENT_REPLY`;
6. solicitar a Hommy una nueva lectura de intención;
7. cancelar cualquier envío vencido que ya no tenga sentido;
8. programar la próxima acción.

Sin WhatsApp entrante, la automatización inteligente sería incompleta.

---

# Follow-up Worker 24/7

Crear un servicio pequeño separado del Bridge.

Responsabilidades:

- consultar oportunidades con `nextActionAt <= now`;
- obtener un lock por cotización;
- volver a leer el estado antes de actuar;
- pedir el plan a Hommy;
- registrar el plan;
- enviar por el Bridge únicamente si corresponde;
- registrar el resultado;
- programar la próxima revisión;
- reintentar errores seguros;
- jamás reenviar automáticamente un resultado ambiguo.

Frecuencia inicial sugerida: cada 5 minutos.

El worker no debe contener la personalidad comercial. Esa lógica pertenece al playbook + Hommy.

---

# Diseño de `seguimiento.html`

La pantalla debe evolucionar sin hacerse pesada.

## Tarjeta

Mantener:

- COT #
- cliente
- valor
- antigüedad
- Ver cotización
- Nota
- Archivar

Agregar una sección compacta:

### Hommy · Seguimiento inteligente

- estado: `Activo / Esperando cliente / Revisión / Pausado / Detenido`
- temperatura comercial
- resumen de una línea
- próxima acción
- hora/fecha

Ejemplo:

```text
Hommy · Seguimiento inteligente
Activo · Interés activo

Karen recibió la propuesta y aún no ha respondido.
Próxima acción: hoy · 3:00 p. m.

[Ver seguimiento]
```

## Panel de detalle

Al tocar `Ver seguimiento` mostrar:

1. **Estado actual**
2. **Resumen Hommy**
3. **Próxima acción**
4. **Mensaje preparado**, si existe
5. botones según modo:
   - `Enviar ahora`
   - `Editar`
   - `Aprobar`
   - `Omitir`
   - `Pausar`
   - `Tomar conversación`
6. **Timeline completo**

No mostrar razonamiento interno extenso. Mostrar una explicación comercial corta: “Esperando porque el cliente pidió retomar el viernes”.

---

# Conocimiento comercial de Hommy

Crear un playbook separado, versionado y auditable. No esconder toda la estrategia en un prompt enorme.

El playbook debe enseñar:

- cómo hacer seguimiento sin perseguir;
- cómo abrir conversación;
- una intención por mensaje;
- CTA de baja fricción;
- personalización real;
- manejo de silencio;
- objeción de precio;
- comparación de opciones;
- indecisión;
- consulta con pareja/familia;
- cliente que pide tiempo;
- cliente interesado que se enfría;
- cuándo cerrar elegantemente;
- cuándo no enviar;
- cuándo escalar a humano;
- tono HomeEasy;
- ejemplos buenos y malos;
- reglas contra presión, manipulación y falsa urgencia.

El playbook será insumo del backend de Hommy y también servirá para pruebas automatizadas.

---

# Métricas

Medir por cotización y periodo:

- seguimientos preparados;
- aprobados;
- enviados;
- clientes que respondieron;
- tiempo hasta respuesta;
- oportunidades reactivadas;
- conversiones después de seguimiento;
- valor convertido;
- tasa de respuesta por etapa;
- tasa de conversión por etapa;
- mensajes omitidos por Hommy;
- STOP por rechazo/no contacto;
- intervenciones humanas;
- errores de WhatsApp.

A futuro:

```text
Ventas influenciadas por Hommy
$18.450.000

6 ventas · 11 oportunidades reactivadas
```

No atribuir una venta a Hommy solo porque existió un mensaje. Definir una regla de atribución explícita.

---

# Fases de implementación

## Fase 0 · Arquitectura y doctrina — AHORA

- [x] Definir visión.
- [x] Separar IA, estado, ejecución y canal.
- [x] Definir timeline vs notas manuales.
- [x] Definir necesidad de WhatsApp entrante.
- [x] Definir worker 24/7.
- [ ] Crear `HOMMY_SALES_PLAYBOOK.md`.
- [ ] Cerrar contrato de datos exacto.

## Fase 1 · Memoria comercial y timeline

- [ ] Persistencia de estado por cotización.
- [ ] Persistencia append-only de eventos.
- [ ] API para leer/escribir seguimiento.
- [ ] Migración inicial desde `notas_seguimiento` sin perder información.
- [ ] UI de timeline sin IA todavía.

**Criterio de salida:** una cotización tiene historial confiable y auditable.

## Fase 2 · Hommy como analista

- [ ] Endpoint `/api/hommy/followup/plan`.
- [ ] Playbook comercial incorporado.
- [ ] JSON schema estricto.
- [ ] Clasificación de intención/temperatura.
- [ ] Resumen comercial.
- [ ] Próxima acción recomendada.
- [ ] Borrador contextual.

**Modo:** solo `REVIEW`, sin envío automático.

**Criterio de salida:** Hommy recomienda bien sobre casos reales sin poder enviar solo.

## Fase 3 · Envío de texto comercial

- [ ] Endpoint Bridge seguro `send-text` para seguimiento.
- [ ] permiso específico o permiso comercial equivalente;
- [ ] idempotencia por `cotizacion + followupEvent`;
- [ ] auditoría;
- [ ] guardar messageId;
- [ ] `Enviar ahora / Aprobar / Omitir` desde seguimiento.

**Criterio de salida:** un asesor aprueba y el mensaje sale con trazabilidad completa.

## Fase 4 · WhatsApp entrante

- [ ] recibir eventos WAHA;
- [ ] vincular cliente/cotización;
- [ ] guardar respuesta;
- [ ] actualizar intención;
- [ ] cancelar planes obsoletos;
- [ ] mostrar respuesta en timeline.

**Criterio de salida:** la conversación real modifica la estrategia.

## Fase 5 · Automatización 24/7

- [ ] follow-up worker;
- [ ] locks;
- [ ] scheduler;
- [ ] `AUTO`;
- [ ] horario comercial;
- [ ] revalidación antes de enviar;
- [ ] STOP automático;
- [ ] observabilidad y recuperación.

**Criterio de salida:** funciona con HomeEasy cerrado y no produce duplicados.

## Fase 6 · Inteligencia comercial y reportes

- [ ] funnel de seguimiento;
- [ ] respuesta por etapa;
- [ ] conversiones;
- [ ] ventas influenciadas;
- [ ] aprendizaje por resultados;
- [ ] comparación controlada de variantes de copy.

---

# Casos STOP obligatorios

Detener automatización inmediatamente si:

- cotización convertida en OP;
- cotización archivada;
- cliente dice que no está interesado;
- cliente pide no recibir mensajes;
- número inválido o no utilizable después de validación;
- humano toma la conversación;
- reclamo sensible;
- existe inconsistencia de precio/documento;
- la cotización dejó de estar activa.

---

# Primera entrega que vamos a construir

La primera entrega funcional debe ser **Memoria + Timeline + Hommy en modo REVIEW**.

No activar AUTO todavía.

Objetivo de esa entrega:

1. abrir una cotización en Seguimiento;
2. ver su historial comercial;
3. pedir a Hommy que la analice;
4. ver intención, temperatura, resumen y próxima acción;
5. ver el mensaje redactado;
6. aprobar, editar u omitir;
7. registrar cada acción en el timeline.

Después conectamos envío de texto y entrada de WhatsApp.

---

## Regla de calidad

No considerar una fase terminada solo porque “compila”. Cada fase debe verificarse en:

- desktop;
- iPhone/Safari;
- sesión con permisos;
- error de red;
- WhatsApp desconectado;
- doble toque / doble envío;
- refresco de página;
- cotización archivada o convertida durante el proceso.
