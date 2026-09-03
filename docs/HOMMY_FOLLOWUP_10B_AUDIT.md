# HomeEasy · Auditoría previa Etapa 10B · Hommy Analista Comercial

Fecha: 2026-09-03

Estado: **AUDITORÍA TÉCNICA CERRADA · IMPLEMENTACIÓN AÚN NO ACTIVADA**

## 1. Hallazgo principal

El backend vigente de Hommy no desapareció: está aislado deliberadamente en la rama `hommy-2.0`, mientras `main` contiene el frontend publicado y los módulos operativos de HomeEasy.

Fuente candidata actual:

- repositorio: `alejoherrera05-del/Homeeasy`
- rama backend: `hommy-2.0`
- head auditado: `c9f3fa0bc7339129deb8540f7a6f4bdec00195c9`
- backend certificado/deploy documentado: `b41317137f1ccf5f534c34edfdf4024b9360f48c`
- versión: `2.1.0`
- servicio Render: `homeeasy-hommy-staging`

`render.yaml` apunta explícitamente a `branch: hommy-2.0`, usa `servidor:app`, health `/api/health` y auto-deploy por commit.

El documento `docs/HOMMY_CODEX_HANDOFF_V2.md` confirma que el backend 2.1.0 quedó Live en Render staging y que a `main` solo se publicaron los archivos frontend validados.

## 2. Relación entre el deploy documentado y el head actual

Se comparó `b413171...` contra `c9f3fa0...`.

Hay 14 commits posteriores, pero no modifican el backend Hommy 2.1.0. Los cambios posteriores son principalmente limpieza de archivos legacy, documentación, configuración de autenticación compartida y pruebas de estabilidad de sesión.

No cambiaron entre esos dos puntos:

- `servidor.py`
- `hommy_backend/engine.py`
- `hommy_backend/auth.py`
- `hommy_backend/data.py`
- `hommy_backend/tools.py`
- `hommy_backend/realtime.py`
- `hommy_backend/continuity.py`
- `requirements.txt`
- `render.yaml`

Por tanto, el backend que debemos extender para 10B es el código de `hommy-2.0`; no se debe restaurar el backend Python legacy eliminado de `main`.

## 3. CI y estabilidad actual

La rama `hommy-2.0` tiene el workflow `Hommy 2 QA`.

El run correspondiente al head auditado `c9f3fa0...` terminó en `success`.

La suite actual valida, entre otros:

- compilación Python;
- sintaxis JavaScript;
- contratos backend;
- RBAC;
- Gunicorn real;
- navegador desktop/móvil;
- health local;
- endpoints sin sesión => 401;
- endpoint legacy => 426;
- CORS restringido;
- contrato live contra `homeeasy-hommy-staging`.

## 4. Arquitectura actual de Hommy 2.1

### HTTP

`servidor.py` expone:

- `GET /api/health`
- `POST /api/hommy/chat`
- `POST /api/hommy/bootstrap`
- `POST /api/hommy/tool`
- `POST /api/hommy/realtime/session`
- `POST /api/hommy/realtime/sync`

Los endpoints antiguos `/api/chat` y `/api/tts` están deshabilitados con 426.

### Autenticación

El navegador entrega:

- `X-HomeEasy-Session`
- `X-HomeEasy-Meta`

`SessionValidator` revalida la sesión contra el Cerebro HomeEasy por `AUTH_VALIDAR_SESION`, conserva device binding y construye un `AuthContext` con UID, rol y permisos.

### Datos

`HomeEasyDataStore` usa una Service Account con scope exacto:

`https://www.googleapis.com/auth/spreadsheets.readonly`

No tiene escritura.

Carga por encabezados normalizados:

- Clientes
- Cotizaciones
- Ordenes_Pedido
- Abonos
- Agenda
- Tarifas

La hoja operativa ya está compartida con la Service Account como lector, por lo que las nuevas pestañas de seguimiento pertenecen al mismo archivo sin requerir privilegios de escritura adicionales.

### OpenAI

`HommyEngine` usa Responses + Conversations, herramientas filtradas por RBAC, `safety_identifier`, tools estrictas y cálculos comerciales determinísticos en Python.

Versión SDK fijada actualmente: `openai==2.54.0`.

## 5. Estado 10A que 10B puede reutilizar

10A está certificada y provee:

- `GET_SEGUIMIENTO_INTELIGENTE`
- `GET_SEGUIMIENTO_DETALLE`
- `ACTUALIZAR_ESTADO_SEGUIMIENTO_IA`
- `REGISTRAR_EVENTO_SEGUIMIENTO`

`GET_SEGUIMIENTO_DETALLE` devuelve por cotización:

- cotización real;
- datos de cliente;
- nota manual;
- snapshot de `Seguimiento_IA`;
- timeline de `Seguimiento_Eventos`;
- `Estado_Version`.

La ruta exige sesión HomeEasy y permiso `cotizaciones.read`.

## 6. Decisión de integración para 10B

Para el primer 10B, Hommy NO recibirá desde el navegador una cotización completa como fuente confiable.

Flujo recomendado:

1. navegador llama `POST /api/hommy/followup/plan` con número de cotización;
2. Hommy valida `X-HomeEasy-Session` como hoy;
3. exige permiso de cotizaciones;
4. Hommy vuelve a consultar HomeEasy `GET_SEGUIMIENTO_DETALLE` usando la misma sesión;
5. HomeEasy devuelve el contexto canónico 10A;
6. Hommy reduce/minimiza el contexto;
7. solo entonces se envía al modelo;
8. el modelo devuelve un plan mediante Structured Outputs / JSON Schema;
9. backend valida nuevamente el resultado;
10. devuelve el plan al navegador sin escribir nada y sin enviar WhatsApp.

Ventaja: el cliente no puede alterar silenciosamente total, cliente, nota, estado o timeline para engañar a Hommy.

## 7. Minimización antes de IA

No se debe enviar al modelo, salvo necesidad futura explícita:

- cédula;
- email;
- dirección;
- teléfono completo;
- URL del PDF;
- tokens;
- metadata de dispositivo;
- datos de otros clientes.

Contexto 10B suficiente:

- primer nombre;
- número y fecha de cotización;
- descripción/productos;
- observaciones comerciales relevantes;
- total cotizado;
- nota manual;
- estado 10A;
- intención/temperatura actuales;
- objeciones conocidas;
- fecha prometida;
- últimos eventos relevantes del timeline;
- fecha/hora local HomeEasy;
- versión de estado.

Todo texto de Sheets/timeline se trata como **dato no confiable**, nunca como instrucciones al modelo.

## 8. Contrato propuesto del plan

Endpoint:

`POST /api/hommy/followup/plan`

Respuesta comercial validada:

```json
{
  "decision": "SEND | WAIT | STOP | HUMAN_REVIEW",
  "reasonCode": "...",
  "intent": "...",
  "temperature": "HIGH | ACTIVE | WAITING | RISK | COLD",
  "summary": "...",
  "objective": "...",
  "message": "... o null",
  "nextActionAt": "ISO-8601 o null",
  "confidence": 0.0,
  "needsHumanReview": true,
  "stopReason": null,
  "explanation": "explicación comercial breve"
}
```

El servidor añadirá, fuera del modelo:

- `planId`;
- `generatedAt`;
- `sourceStateVersion`;
- `playbookVersion`;
- `model`.

No se mostrará ni almacenará chain-of-thought.

## 9. Reglas duras de validación

El servidor debe rechazar/corregir cualquier plan que viole:

- enums cerrados;
- oportunidad ya convertida/archivada/detenida;
- `DO_NOT_CONTACT` o `NOT_INTERESTED` con decisión SEND;
- mensaje en WAIT/STOP salvo copy explícitamente permitido para revisión humana;
- mensaje vacío en SEND;
- mensaje excesivo;
- descuento/precio/entrega/disponibilidad no verificados;
- `nextActionAt` inválido o anterior al presente;
- estado cambió desde la lectura inicial;
- número de cotización no coincide;
- contexto insuficiente tratado como certeza.

10B será **REVIEW-only**. Incluso `decision=SEND` significa “borrador recomendado”; nunca envío automático.

## 10. Hallazgo importante: falta evidencia de conversación en las cotizaciones importadas

Las 22 oportunidades migradas por 10A tienen inicialmente un evento `QUOTE_CREATED`, pero no se importó historial real de WhatsApp.

Por tanto, para una cotización antigua sin notas/eventos suficientes, 10B NO debe asumir automáticamente:

- que el PDF fue enviado;
- que el cliente lo recibió;
- que existe “NO_RESPONSE”;
- que el último mensaje fue de HomeEasy;
- que la oportunidad sigue caliente.

Regla conservadora: cuando falte evidencia suficiente, devolver `HUMAN_REVIEW` o `WAIT` con `reasonCode=INSUFFICIENT_CONTEXT` en vez de inventar una narrativa.

## 11. El Bridge sí conserva una pieza útil para el futuro

El envío actual de documentos por WhatsApp ya manda al Bridge:

- `documentType`;
- `reference`;
- cliente;
- teléfono;
- filename;
- source;
- resend;
- idempotency key.

El Bridge persiste actividad con:

- timestamp;
- estado;
- referencia;
- `messageId`;
- actor;
- error si existe.

Esto permite, en una fase posterior, reflejar correctamente en el timeline 10A que `COT-x` realmente fue enviada.

No se debe usar la ausencia de un evento 10A histórico como prueba de que nunca se envió.

## 12. Segundo hallazgo: las rutas 10A actuales no deben usarse para atribuir un plan a Hommy

`REGISTRAR_EVENTO_SEGUIMIENTO` hoy crea el evento con `Actor_Tipo=HUMAN`.

`ACTUALIZAR_ESTADO_SEGUIMIENTO_IA` hoy actualiza `Ultimo_Humano`.

Por eso 10B no debe reutilizar esas rutas para guardar un `AI_ANALYSIS` fingiendo que lo produjo una persona.

Después de certificar la calidad del endpoint read-only se deberá crear una ruta específica, por ejemplo:

`REGISTRAR_PLAN_HOMMY`

que:

- hardcodee `Actor_Tipo=HOMMY`;
- use `Estado_Version` / expectedVersion;
- incremente `Plan_Version`;
- actualice `Ultimo_Hommy`, no `Ultimo_Humano`;
- escriba `AI_ANALYSIS` y `DRAFT_CREATED` de forma idempotente;
- nunca envíe WhatsApp.

## 13. Estrategia de desarrollo segura

No desarrollar 10B directamente en `hommy-2.0` porque `render.yaml` tiene auto-deploy por commit a staging.

Se creó una rama aislada:

`hommy-followup-10b`

Base exacta:

`c9f3fa0bc7339129deb8540f7a6f4bdec00195c9`

Esta rama no es la rama que Render declara para `homeeasy-hommy-staging`, por lo que crear código allí no debe desplegarlo automáticamente al servicio.

Antes de escribir la funcionalidad se ajustará el workflow de QA en esa rama para ejecutar toda la suite sin comparar la versión de desarrollo contra el staging live. Solo al pasar QA se promoverá el cambio a `hommy-2.0`.

## 14. Pruebas obligatorias 10B

- endpoint sin sesión => 401;
- usuario sin permiso de cotizaciones => 403;
- cotización inexistente => 404/controlado;
- contexto se obtiene desde HomeEasy, no se confía en payload del navegador;
- cédula/teléfono/email/dirección no llegan al modelo;
- prompt injection dentro de notas/descripciones se trata como dato;
- esquema JSON exacto;
- enum desconocido => falla cerrada;
- SEND con STOP => bloqueado;
- SEND sin mensaje => bloqueado;
- mensaje fuera de longitud => bloqueado;
- fecha inválida => bloqueada;
- cotización cambia de `Estado_Version` => plan queda stale;
- no hay escritura a Sheets;
- no hay llamada a WhatsApp;
- no hay endpoint Bridge en el flujo 10B;
- no se modifica voz, chat general, AR ni módulos comerciales;
- suite Hommy existente continúa verde.

## 15. Seguridad heredada que se conserva

- Service Account de Sheets sigue read-only.
- No se agregan secretos al repositorio.
- CORS sigue restringido.
- Sesión y device binding siguen vigentes.
- rate limiting por UID salteado sigue vigente.
- `safety_identifier` sigue vigente.
- OpenAI no recibe datos de otros clientes.
- Hommy nunca llama al WhatsApp Bridge desde el modelo.

## 16. Deuda de seguridad histórica

El backend legacy eliminado contenía una clave de ElevenLabs escrita en código público. Hommy 2.1 ya no usa ElevenLabs y las pruebas actuales verifican que esa dependencia no regrese.

La clave histórica debe mantenerse considerada comprometida y revocarse si todavía existe en la cuenta correspondiente. No se debe restaurar el backend legacy.

## 17. Orden recomendado

1. QA de rama aislada.
2. Implementar `followup` backend read-only.
3. Tests unitarios + HTTP + privacidad + prompt-injection.
4. Corpus comercial basado en `HOMMY_SALES_PLAYBOOK.md`.
5. Revisar resultados sobre casos controlados.
6. Promover a `hommy-2.0` solo cuando todo pase.
7. Validar staging real.
8. Integrar UI de Seguimiento en REVIEW.
9. Añadir persistencia Hommy específica a Apps Script.
10. Solo después trabajar envío comercial y WhatsApp entrante.

## 18. Conclusión

La Etapa 10B puede construirse sobre la infraestructura actual sin crear un segundo Hommy y sin recuperar código legacy.

La ruta segura es extender el backend 2.1 existente desde una rama aislada, mantenerlo read-only en esta primera subfase y usar 10A como fuente canónica de contexto y memoria.
