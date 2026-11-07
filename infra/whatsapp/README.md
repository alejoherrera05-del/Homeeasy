## Fase 3G · Contrato del motor conversacional (preparado, NO activar)

Esta fase introduce el módulo opcional `team-ai.js` para que las preguntas libres
del grupo puedan interpretarse mediante el **motor de IA de Hommy**, sin crear
una nueva cuenta de WhatsApp ni recurrir a respuestas por expresiones regulares.

**Importante:** el backend de Render debe implementar y probar primero
`POST /api/hommy/team/interpret`; ese endpoint no está verificado ni se presume
existente. La autenticación es de servicio a servicio con el encabezado
`Authorization: Bearer <HOMMY_TEAM_AI_SERVICE_TOKEN>`. La credencial es distinta
del token de HomeEasy, de WAHA y del token del Bridge. No se reutiliza ni
almacena una sesión humana de HomeEasy. El endpoint debe verificar la credencial
mediante comparación en tiempo constante y devolver únicamente
`{"kind":"ANSWER","text":"<respuesta en español>"}` o
`{"kind":"REVIEW_REQUIRED"}`, sin acceso a herramientas de escritura.

La solicitud incluye `purpose: HOME_EASY_TEAM_READ_ONLY`, la pregunta del miembro
autorizado, hasta tres intercambios del grupo y un resumen de datos comerciales
**sin nombres de clientes, teléfonos, texto de clientes, números de cotización
ni IDs internos**. Los datos incompletos o no disponibles se informan como
desconocidos; nunca se convierten en cero confirmado.

Requisitos para activar, todos simultáneos:

- Backend Render verificado, HTTPS y URL exacta dentro del origen permitido
  `HOMMY_BACKEND_URL`, sin redirecciones ni URL arbitraria.
- Variables **solo en secretos del VPS**, jamás en GitHub:
  `HOMMY_TEAM_AI_ENABLED=true`,
  `HOMMY_TEAM_AI_URL=https://.../api/hommy/team/interpret`,
  `HOMMY_TEAM_AI_SERVICE_TOKEN=<clave larga de servicio>`.
- Grupo autorizado, modo `REVIEW`, respuestas internas activadas y aprobación
  independiente del propietario en Integraciones → **Activar conversación natural**.
- El adaptador espera hasta 6,5 s; si hay error, no inventa respuestas ni reintenta.
  Los duplicados quedan bloqueados de forma persistente antes del envío.
- Los comandos que implican escribir a clientes, programar citas, cambiar precios
  o modificar datos deben devolver `REVIEW_REQUIRED`, sin ejecutar acciones.
- La habilitación de IA del grupo **no habilita la atención automática de clientes**.

La red privada de Render no alcanza directamente a Hetzner. Para este despliegue
se requiere comunicación pública HTTPS con autenticación propia y límites de tasa
en Render; no basta un hostname interno privado. La instalación de esta rama
no activa nada hasta que las condiciones anteriores se verifiquen.

# HomeEasy WhatsApp · Fase 1

Esta carpeta contiene la infraestructura aislada para probar **WAHA + WEBJS** antes de tocar los módulos de producción de HomeEasy.

## Qué instala

- Docker.
- WAHA con motor WEBJS/Chromium.
- Sesión persistente de WhatsApp.
- HomeEasy WhatsApp Bridge.
- Reinicio automático de contenedores.
- Secretos generados localmente en el VPS.

## Requisitos del VPS

Recomendado para una sola sesión:

- Ubuntu 24.04 LTS.
- 2 vCPU.
- 4 GB RAM.
- 30–40 GB SSD o más.
- IPv4 pública.

## Instalación para el usuario

En la consola web del VPS pegar exactamente:

```bash
curl -fsSL https://raw.githubusercontent.com/alejoherrera05-del/Homeeasy/main/infra/whatsapp/install.sh | sudo bash
```

El instalador deja todo en:

```text
/opt/homeeasy-whatsapp
```

Los secretos quedan únicamente en el VPS:

```text
/opt/homeeasy-whatsapp/.env
/opt/homeeasy-whatsapp/ACCESS.txt
```

Ambos deben permanecer privados.

## Sesión persistente

WhatsApp se almacena en:

```text
/opt/homeeasy-whatsapp/data/sessions
```

Esa carpeta está montada como `/app/.sessions` dentro de WAHA. Por eso un reinicio normal de Docker, WAHA o del VPS no elimina la autenticación.

## Vincular WhatsApp

Después de instalar:

```bash
cd /opt/homeeasy-whatsapp
docker compose logs -f waha
```

Cuando WAHA muestre el QR:

1. Abrir WhatsApp Business en el teléfono.
2. Ir a **Dispositivos vinculados**.
3. Tocar **Vincular dispositivo**.
4. Escanear el QR.
5. Esperar a que WAHA muestre estado `WORKING`.

Salir de los logs con `Ctrl+C` no detiene WAHA.

## Corrección de lenguaje natural del grupo (Bridge 0.26.1)

Las respuestas del equipo deben reconocer la cortina Onda Serena como producto
incluso si preguntan «Hommy, cómo va lo de la onda serena?» y pueden invocar a
Hommy al principio o al final del mensaje («Onda Serena Hommy»). El detector
comprueba la palabra completa y conserva el control de grupo y remitentes
autorizados. Cualquier instrucción combinada con acciones comerciales
sigue pendiente de revisión y **no** contacta clientes.

Se suaviza la redacción de los resúmenes de productos utilizando únicamente
la memoria comercial analizada. Esto mejora reconocimiento y tono, **pero
no sustituye un motor conversacional con IA**; integrar semántica avanzada
requiere autenticación de servicio independiente y restricciones estrictas
de lectura para proteger los datos de HomeEasy.

## Fase 3F · Búsqueda puntual y segura de oportunidades (Bridge 0.26.0)

Un integrante autorizado puede preguntar por un cliente con nombre **exacto**
(por ejemplo `Hommy, qué sabemos de Laura?`) o por el nombre de un producto
comercial reconocido (por ejemplo `Hommy, cómo va lo de Onda Serena?`).
Hommy consulta exclusivamente la memoria V2 previamente analizada y no
examina chats nuevos ni obtiene información externa.

La búsqueda es de solo lectura, con límite de 8 MiB y caché por archivo.
Nunca incluye teléfonos, documentos de identidad ni textos de mensajes en
la respuesta. Si hay más de un cliente u oportunidad compatible, pide otra
referencia en vez de elegir arbitrariamente. Cuando no hay coincidencia,
indica la cobertura parcial de su memoria.

Las preguntas mezcladas con acciones como «envía precio» o «confirma visita»
**no generan respuestas automáticas**: permanecen en revisión. Ninguna
herramienta de esta fase envía mensajes a clientes o confirma citas.
Las protecciones del grupo y el estado de supervisión siguen intactos.

## Fase 3E · Consultas operativas verificables en el grupo (Bridge 0.25.0)

El grupo privado de Hommy responde a consultas informativas de solo lectura:
`pendientes`, `resumen`, `cotizaciones`, `visitas`, `seguimientos` y
`clientes`, después de verificar la firma del webhook, el grupo exacto y el
remitente autorizado. Los comandos que incluyen acciones o destinos a clientes
permanecen en `REVIEW_REQUIRED`, sin envíos a clientes.

Las respuestas se basan en tareas y etiquetas internas y en
`hommy-intelligence/state-v2.json` (solo conversaciones analizadas).
El lector utiliza una caché por identidad y fecha del archivo, evita
consultas de red y limita el tamaño de lectura a 8 MiB. Si la memoria falta,
está dañada o excede ese límite, informa que no está disponible en lugar de
inventar cantidades.

**Interpretación:** una oportunidad abierta no es una venta, una solicitud de
visita no es una cita confirmada y un número de cotización asociado no prueba
que la cotización fue enviada. Por ahora las respuestas no cubren todos los
mensajes sin analizar ni la agenda operativa completa.

Permanece el control independiente `replyEnabled` y su deduplicación
persistente. WAHA, Pentagrama, HomeEasy Hommychat y los módulos existentes
no cambian. La entrega de esta versión debe realizarse solo con el
actualizador protegido, respaldando el Bridge y preservando WAHA.

## Comprobar el estado

```bash
cd /opt/homeeasy-whatsapp
source .env
curl -s \
  -H "X-HomeEasy-Token: $BRIDGE_TOKEN" \
  http://127.0.0.1:8080/api/whatsapp/status | jq .
```

El estado deseado es:

```json
{
  "ready": true,
  "status": "WORKING"
}
```

## Servicios y exposición

WAHA escucha solamente en:

```text
127.0.0.1:3000
```

Bridge escucha solamente en:

```text
127.0.0.1:8080
```

En Fase 1 **ninguno se expone directamente a Internet**. Primero validaremos estabilidad y envío desde el propio VPS. Después añadiremos HTTPS delante del Bridge para Google Apps Script.

## Endpoints del Bridge

### Pentagrama Sync (Fase 1, solo lectura)

El VPS debe definir `PENTAGRAMA_LOGIN` y `PENTAGRAMA_PASSWORD` en `.env`. El endpoint no
escribe en Sheets ni modifica tarifas; compara el costo vigente calculado por HomeEasy con
el costo proveedor reconstruido desde Pentagrama.

```text
POST /api/pentagrama-sync/check
X-HomeEasy-Session: ...
X-HomeEasy-Device-Id: ...
Content-Type: application/json
```

Payload opcional:

```json
{ "mappingIds": ["onda-coral-white-100x100"] }
```

Una respuesta parcial usa HTTP `207` y conserva un error controlado por caso. Nunca devuelve
la cookie Pentagrama ni las credenciales configuradas.

### Salud

```text
GET /health
```

### Inbox Hommy SHADOW

La recepción queda desactivada por defecto. WAHA entrega únicamente eventos `message` al
Bridge y firma el cuerpo crudo con HMAC-SHA512.

```text
POST /api/whatsapp/webhook
X-Webhook-Hmac-Algorithm: sha512
X-Webhook-Hmac: ...
```

Los administradores consultan el inbox privado con paginación:

```text
GET /api/whatsapp/inbox?offset=0&limit=50
X-HomeEasy-Session: ...
X-HomeEasy-Device-Id: ...
```

El kill switch persistente usa `POST /api/whatsapp/inbox/disable`; para retirar el
marcador usa `POST /api/whatsapp/inbox/enable`. Ambos requieren `config.write`. La bandera
`HOMMY_INBOX_ENABLED=false` siempre prevalece.

### Inteligencia comercial Hommy (REVIEW)

Esta fase depende del PR #104 (`feat/hommy-whatsapp-inbox-shadow`, base `dcd018b`). No envía mensajes ni crea citas. El
procesamiento es explícito, usa la sesión y permisos actuales de HomeEasy y queda apagado
por defecto con `HOMMY_INTELLIGENCE_ENABLED=false`.

```text
POST /api/whatsapp/intelligence/process   (cotizaciones.read)
GET  /api/whatsapp/intelligence?offset=0&limit=50   (cotizaciones.read)
GET  /api/whatsapp/intelligence/memory?offset=0&limit=50   (cotizaciones.read)
POST /api/whatsapp/intelligence/disable   (config.write)
POST /api/whatsapp/intelligence/enable    (config.write)
```

Despliegue conservador: la primera instalación mantiene `HOMMY_INTELLIGENCE_ENABLED=false`,
pero las actualizaciones de una instalación existente **conservan** la bandera y los kill switches
exactamente como estaban (incluido el entorno de producción que ya usa REVIEW activado).
El actualizador comprueba `/health`, `/api/whatsapp/status` y que WAHA continúe `WORKING`.
Nunca habilita envíos automáticos ni crea citas.

La migración de memoria crea `data/bridge/hommy-intelligence/state-v2.json` y **no modifica**
el histórico `state.json` V1. Los análisis ya completados se relacionan con los registros
persistidos del inbox sin llamar otra vez a la IA; las auditorías duplicadas se conservan
identificadas como tales. El actualizador respalda los datos y, si vuelve a un Bridge anterior
con un estado V2 presente, deja Intelligence bajo kill switch (`disabled`) para impedir
que un proceso antiguo escriba sobre la memoria nueva. El inbox sigue recibiendo mensajes;
la reactivación exige revisar y reconciliar el estado antes de quitar ese marcador.
El rollback **no restaura automáticamente archivos de mensajes antiguos** sobre los nuevos.

La memoria comercial separa clientes, conversaciones y oportunidades. El teléfono
normalizado sólo se usa como identidad estable cuando WAHA lo verificó; los LID sin
resolver permanecen como contactos provisionales. El procesador reconcilia los salientes
con el historial WEBJS de WAHA sin cambiar la sesión; además acepta `message.any` si se
habilita expresamente más adelante. El campo `source` distingue acciones `app` y `api`.
Los salientes humanos pausan el borrador; ningún evento de esta fase envía respuestas.

### Fase 3B · Contexto comercial de campañas (REVIEW solamente)

El procesador reconoce preguntas cortas habituales de anuncios de clic a WhatsApp
(por ejemplo, `Qué costo tiene?`, `Me das información?` y `Quiero cotizar`).
Estas preguntas **no prueban qué producto busca el cliente**.

El borrador consulta el producto si no existe evidencia, pide ancho y alto si
existe un producto reconocido sin medidas y evita volver a solicitar medidas ya
registradas para una oportunidad reciente e inequívoca. El origen de anuncio
se utiliza únicamente si WAHA aportó metadatos de referencia verificados.
Cuando falta contexto o hay intereses ambiguos, no se inventan datos ni precios.

Los mensajes siguen siendo borradores privados en modo `REVIEW`: esta fase no
envía mensajes, no crea citas y no activa un trabajador automático. La memoria
V2 creada en la fase anterior permanece en `state-v2.json`. Los ajustes de
estilo no reescriben los análisis históricos.

### Fase 3C · Operaciones comerciales aisladas

Bridge 0.23.0 incluye un módulo privado `hommy-workspace.js`, separado del envío
de documentos, WAHA y Pentagrama. Su almacenamiento vive en
`data/bridge/hommy-workspace/state.json` con escritura atómica, respaldo y
auditoría. Si el archivo se daña, el módulo se pausa sin impedir que arranque el
resto del Bridge.

- `GET /api/whatsapp/hommy/control` (`config.read`): modo, grupo y pendientes.
- `POST /api/whatsapp/hommy/control` (`config.write`): solo `PAUSED` o `REVIEW`.
- `GET /api/whatsapp/hommy/workspace` (`cotizaciones.read`): etiquetas, tareas y comandos capturados.
- `POST /api/whatsapp/hommy/labels` (`config.write`): etiquetas internas para un cliente existente.
- `POST /api/whatsapp/hommy/tasks` y `.../tasks/status` (`config.write`): tareas auditables.

Pausar la inteligencia impide iniciar nuevos análisis de REVIEW y captar nuevos
comandos de grupo; **no desactiva el inbox ni WAHA**, tampoco impide enviar
documentos o realizar operaciones Pentagrama.

El grupo privado está desactivado por defecto. Para escucharlo hace falta
configurarlo explícitamente con su ID `@g.us` exacto y una lista de remitentes
verificados `@c.us` o `@lid`. Solo se considera un mensaje dirigido
expresamente a Hommy y firmado por el webhook actual. Los comandos se
**registran para revisión**: este módulo no envía respuestas al grupo ni mensajes
a clientes y no tiene acceso a los métodos de envío de WAHA.

La tarjeta de Configuración → Integraciones permite pausar y reanudar REVIEW
siempre que la sesión tenga `config.write`. Se monta en un archivo JavaScript
opcional independiente; no modifica Hommychat, voz, log-in ni estilos globales.
Las etiquetas de HomeEasy son la fuente principal; la futura sincronización
con las etiquetas nativas de WhatsApp será explícita y verificable.

### Fase 3D · Respuestas internas opcionales (Bridge 0.24.0)

Las consultas informativas reconocidas en el **grupo privado autorizado** pueden
recibir una respuesta directa en el mismo grupo. Esta capacidad está
**desactivada por defecto** y debe habilitarse explícitamente en
Configuración → Integraciones → `Activar respuestas internas`.
No se conceden permisos para enviar mensajes a clientes ni para ejecutar órdenes
comerciales desde el grupo.

- El webhook se verifica mediante la firma HMAC y la sesión WAHA existente.
- Solo participan remitentes de la lista de integrantes autorizados; LID/PN se
  reconcilia únicamente con datos consultados a WAHA y nunca con texto del chat.
- Solo comandos `INFORMATION` como `Hommy, pendientes` generan respuestas.
  Las instrucciones sobre clientes permanecen en `REVIEW_REQUIRED`.
- El destino de envío está limitado al ID del grupo configurado. No se aceptan
  destinos variables ni mensajes generados arbitrariamente.
- Cada respuesta se reserva en almacenamiento persistente *antes* de enviarse;
  un webhook duplicado o un reinicio no vuelve a disparar el mismo envío.
  Ante un error de red el estado es `UNKNOWN` y no hay reintentos automáticos.
- `PAUSED` apaga las respuestas internas, sin desconectar WAHA.
- El botón **Actividad (N)** cuenta todas las consultas registradas. El contador
  de revisiones pendientes sigue disponible por separado en el estado de operaciones.

Los mensajes anteriores a esta activación **no se responden retrospectivamente**.
No se habilita ninguna automatización de respuestas a clientes.

### Estado WhatsApp

```text
GET /api/whatsapp/status
X-HomeEasy-Token: ...
```

### Crear/arrancar sesión

```text
POST /api/whatsapp/bootstrap
X-HomeEasy-Token: ...
```

### Reiniciar sesión

```text
POST /api/whatsapp/restart
X-HomeEasy-Token: ...
```

### Obtener QR

```text
GET /api/whatsapp/qr
X-HomeEasy-Token: ...
```

### Enviar PDF

```text
POST /api/whatsapp/send-document
X-HomeEasy-Token: ...
Content-Type: application/json
```

Payload:

```json
{
  "phone": "3001234567",
  "filename": "Cotizacion_184.pdf",
  "caption": "Hola, adjuntamos tu cotización HomeEasy #184.",
  "pdfBase64": "JVBERi0xLjQ...",
  "idempotencyKey": "cotizacion-184-whatsapp"
}
```

El Bridge convierte automáticamente un celular colombiano `3001234567` en `573001234567@c.us`.

`idempotencyKey` evita repetir accidentalmente el mismo envío desde HomeEasy.

## Qué NO hacer

- No subir `.env` a GitHub.
- No subir `data/sessions` a GitHub.
- No exponer el puerto 3000 de WAHA públicamente.
- No poner `WAHA_API_KEY` ni `BRIDGE_TOKEN` dentro de `cotizacion.html`, `pedido.html`, `abono.html` o cualquier JavaScript público.
- No integrar aún los documentos de producción hasta que el primer PDF de prueba sea estable.

## Próxima etapa

Una vez que WAHA esté `WORKING` y podamos enviar un PDF desde el VPS:

1. HTTPS para el Bridge.
2. Conexión segura desde Google Apps Script.
3. Panel WhatsApp en `configuracion.html`.
4. Cotización manual por WhatsApp.
5. Pedido y Abono.
6. Cola/reintentos.
7. Automatización opcional.


### Diagnóstico real sin escribir a clientes

Una vez instalada la versión 0.28.0, desde el VPS se puede ejecutar:

```bash
docker exec homeeasy-whatsapp-bridge node /app/hommy-self-check.js
```

El script muestra el estado del catálogo y de las notas, después consulta la IA **real del equipo** usando la configuración de servicio ya existente, registra el tiempo y las respuestas de dos preguntas consecutivas, y no llama a WAHA ni envía ningún WhatsApp. No muestra tokens. Si el servicio de equipo está desactivado, registra `TEAM_AI_NOT_CONFIGURED` sin fingir una respuesta. No sustituye las pruebas de extremo a extremo de envíos con WhatsApp.

## Hommy 0.31 — estudio privado de atención en WhatsApp (semana actual)

El dueño puede pedir que Hommy estudie la atención real a clientes sin
autorizar que el modelo conteste o escriba por WhatsApp.

Con el Bridge actualizado a 0.31.0, ejecutar en el VPS:

    docker exec homeeasy-whatsapp-bridge node /app/hommy-week-study.js study

El diagnóstico consulta la cuenta actual de WAHA en modo SOLO LECTURA:
GET /api/{session}/chats y GET /api/{session}/chats/{chatId}/messages.
No descarga archivos, no marca mensajes como leídos, no envía textos ni
contacta a los clientes. Revisa desde el lunes a las 00:00 (hora de Bogotá)
hasta el momento de ejecución, con límite de 120 chats, 200 mensajes
por chat y 12 segundos por consulta; registra si la muestra es parcial.

El informe separa las conversaciones con referencia Meta verificable,
los anuncios con tipo "ad", los posts con tipo "post" y las de origen
no demostrado. No interpreta cualquier texto prellenado como campaña
confirmada. Incluye tipos de consultas, primeras respuestas observadas,
conversaciones cuyo último mensaje observado es entrante y patrones
de redacción del equipo. No infiere ventas, conversiones, clientes
perdidos ni tiempos totales cuando no están documentados.

OpenAI recibe únicamente resúmenes agregados y hasta 18 fragmentos cortos
filtrados de respuestas SALIENTES del equipo, no las conversaciones crudas de
los clientes, identificadores de WhatsApp, nombres de contactos o teléfonos.
No se guardan ejemplos crudos en el informe, no se solicitan herramientas
ni se autoriza envío de mensajes. El reporte anónimo y las propuestas
quedan SOLO en el VPS en /app/data/hommy-desk/learning, permisos 0600.
Aunque se minimizan datos, una revisión humana del resumen sigue siendo
necesaria antes de aplicar recomendaciones; no debe usarse en lugar
de un sistema formal de consentimiento o privacidad.

La primera ejecución NO modifica el bloc de memoria de Hommy. El
administrador puede revisar el JSON que imprime el comando. Para
aprobar explícitamente la propuesta como nota interna TEAM, ejecutar:

    docker exec homeeasy-whatsapp-bridge node /app/hommy-week-study.js approve 2026-11-02

Sustituir la fecha por el lunes reportado. La aprobación añade una nota
verificada al bloc interno, NO la publica a clientes ni activa la
conversación automática. Ejecutar "approve" dos veces sobre el mismo
estudio falla de forma segura. Antes de usar recomendaciones con clientes,
revisarlas, entrenar al equipo y actualizar las aprobaciones apropiadas.

## Hommy 0.30 — OpenAI directo en el VPS, sin Render para conversaciones internas

La conversación natural del grupo autorizado puede usar el VPS directamente
contra https://api.openai.com/v1/responses. No requiere Render para esa función;
otros módulos de HomeEasy pueden seguir utilizando Render.

Variables privadas para el Bridge (archivo .env del VPS, NUNCA GitHub):
- HOMMY_TEAM_AI_PROVIDER=DIRECT_OPENAI
- HOMMY_TEAM_AI_ENABLED=true
- HOMMY_TEAM_OPENAI_MODEL=gpt-5.4-mini
- OPENAI_API_KEY=sk-... (la clave real se introduce en secreto)

Sin provider o con provider=RENDER se conserva el adaptador antiguo.
En modo directo nunca se reenvían preguntas silenciosamente a Render.
Se mantienen las verificaciones HMAC, identidad, permisos, catálogo,
memoria aprobada y autorización humana. El modelo no dispone de
herramientas para enviar mensajes ni editar cotizaciones. La API utiliza
store=false; consulta las políticas de retención de OpenAI para otros casos.

Instalación:
1. Instala Bridge v0.30.0 con infra/whatsapp/update-bridge.sh.
2. Crea una API key desde OpenAI Platform para un proyecto con límite de gasto.
   No compartas la clave en ChatGPT, WhatsApp, GitHub ni capturas.
3. En el VPS descarga infra/whatsapp/enable-direct-openai.sh desde main
   y ejecútalo con sudo. Pide la clave sin eco, verifica acceso al modelo,
   respalda .env y recrea solamente el Bridge (NO WAHA ni Pentagrama).
4. Prueba sin enviar WhatsApp:
   docker exec homeeasy-whatsapp-bridge node /app/hommy-self-check.js
   Debe decir provider=DIRECT_OPENAI, available=true, y mostrar respuestas
   reales si hay acceso, créditos y conectividad.
5. En HomeEasy Integraciones habilita Conversación natural y pregunta en
   el grupo autorizado. El catálogo y los flujos con clientes no cambian.

La API tiene facturación independiente de ChatGPT Plus.

## Hommy 0.29 — personalidad y reconocimiento verificado del equipo

El Bridge reconoce miembros únicamente por su identificador de WhatsApp
autorizado en el grupo privado. Nunca confía en nombres escritos dentro del
chat ni en nombres de clientes.

En **HomeEasy → Configuración → Integraciones → Personalizar equipo**,
el administrador asigna nombre (p. ej. Ale o Daniela), función (dirección,
gerencia o equipo) y forma de trato (nombre, «jefe» ocasional o sin vocativos).
El Bridge guarda esos perfiles en su volumen persistente
`/app/data/hommy-workspace/state.json`, con los mismos controles de acceso
que la lista de remitentes autorizados.

- `GET /api/whatsapp/hommy/team-members` requiere `config.write` y solo
  entrega los identificadores ya autorizados y sus propios perfiles.
- El envío explícito del catálogo al grupo es una acción segura directa de
  WAHA. Usa un texto cercano y el nombre verificado si hay perfil.
- Cuando el administrador activa **Conversación natural**, las preguntas
  libres se responden mediante el adaptador de IA del equipo. Se pasa solo
  nombre, función y preferencia de trato validados; nunca teléfono, ID de
  WhatsApp ni identidades de clientes. Sin la activación, las consultas
  informativas exactas siguen con respuestas locales y supervisadas.
- El vocativo no se repite en cada respuesta. El motor de IA nunca recibe
  permisos para escribirle a clientes ni modificar cotizaciones.
- Los miembros que aún no tengan perfil siguen autorizados para sus
  funciones existentes y reciben un trato neutro, sin adivinar el nombre.

La actualización del Bridge preserva los mensajes ya enviados, el catálogo,
los datos del grupo y las notas aprobadas. Los perfiles se asignan expresamente
desde el panel, pues no sería seguro deducir a quién pertenece cada ID.

## Hommy 0.28 — Escritorio comercial y memoria aprobada

En `Configuración > Integraciones > Hommy > Escritorio y memoria` se administra el escritorio privado del Bridge:

1. **Catálogo oficial en PDF.** Se carga desde el navegador un archivo PDF de hasta 12 MB. El catálogo no queda expuesto como URL pública; se guarda en el volumen persistente del Bridge, en `DATA_DIR/hommy-desk/CATALOGO_HOMEEASY_OFICIAL_WHATSAPP.pdf`, con permisos privados. Utilizar el catálogo optimizado oficial de HomeEasy. No subir el original de más de 20 MB a este formulario.
2. **Bloc de notas aprobado.** Los usuarios con permiso `config.write` pueden agregar, corregir y archivar información comercial general. Las notas de equipo no se incorporan a las respuestas a clientes; las públicas sí se incluyen en el contexto comercial, como hechos y nunca como instrucciones. Bloquea teléfonos, correos, enlaces y secretos. Las conversaciones de clientes tienen su memoria comercial independiente.
3. **Solicitud al grupo privado.** Cuando un integrante autorizado del grupo escribe «Hommy, envíame el catálogo», Hommy puede adjuntar el PDF directamente al **mismo grupo autorizado** si están habilitadas las respuestas internas. La petición se registra y se reserva antes del envío para impedir duplicados; si WAHA no confirma la entrega, queda marcada como desconocida y no se reintenta automáticamente.
4. **Clientes externos.** El envío automático del catálogo es **optativo y está desactivado por defecto**. Una vez instalado el PDF, el administrador puede habilitarlo explícitamente desde el mismo escritorio. Solo responde a solicitudes simples y directas de catálogo, recibidas por el webhook HMAC de WAHA, con mensajes recientes verificables, sin atención humana reciente y con bloqueo de duplicados por contacto y día. Si WAHA no permite verificar la conversación, no envía nada. Las demás solicitudes siguen en `REVIEW`.
5. **Aprendizaje interno por WhatsApp.** En el grupo autorizado: «Hommy, recuerda que las visitas deben confirmarse con el equipo» y luego «Hommy, guarda esa nota». Es un proceso de dos pasos: solo el mismo integrante puede confirmar la última propuesta entregada, en menos de diez minutos. Se guarda inicialmente como información del equipo; el administrador puede publicarla para consultas de clientes desde el escritorio.
6. **Seguridad y persistencia.** El actualizador incluye `hommy-desk.js` y respalda el contenido de `hommy-desk`. Ni WAHA ni Pentagrama necesitan reiniciarse al actualizar el código del Bridge.

Endpoints autenticados (`config.read` / `config.write`): `GET /api/whatsapp/hommy/desk`, `POST /api/whatsapp/hommy/desk/catalog` (cuerpo `application/pdf`), `POST /api/whatsapp/hommy/desk/automation`, `POST /api/whatsapp/hommy/desk/notes`, `POST /api/whatsapp/hommy/desk/notes/edit`, `POST /api/whatsapp/hommy/desk/notes/archive`.

