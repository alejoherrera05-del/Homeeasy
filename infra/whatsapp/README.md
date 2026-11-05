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
