# Hommy 2.1 - Handoff técnico de Codex

Fecha de cierre técnico: 2026-08-28

Timezone funcional: `America/Bogota`

Repositorio: `alejoherrera05-del/Homeeasy`

## Estado final

- Backend Hommy `2.1.0` desplegado y `Live` exclusivamente en Render staging.
- Frontend Hommy publicado en GitHub Pages después de completar QA de staging.
- Servicio Render de producción `Homeeasy`: no modificado. El workspace de Render disponible durante esta tarea solo expuso `homeeasy-hommy-staging`.
- Ramas sin merge masivo: el backend permanece en `hommy-2.0`; a `main` llegaron únicamente siete archivos frontend validados.
- Google Sheets continúa en modo de solo lectura con el scope exacto `https://www.googleapis.com/auth/spreadsheets.readonly`.
- No se versionaron claves, tokens, archivos `.env`, JSON de Service Account ni datos operativos.

## Versiones, commits y despliegues

- Backend: `2.1.0`.
- Assets frontend: `v=2.4`.
- Modelo de texto: `gpt-5.6-terra`.
- Modelo Realtime: `gpt-realtime-2.1`.
- Voz: `cedar`.
- Commit técnico en `hommy-2.0`: `b41317137f1ccf5f534c34edfdf4024b9360f48c` - `Complete Hommy 2.1 staging`.
- Commit frontend en `main`: `eb42eaae3d5156c6e98b4cf766020c01c5a98a07` - `Publish Hommy 2.1 frontend [skip render]`.
- Commit documental: `Document Hommy 2.1 handoff [skip render]` (el commit que contiene este archivo).
- GitHub Actions Hommy 2 QA: run `33210265951`, resultado `success`.
- Render staging: deploy `dep-da8vb8gicp7s73f6nbsg`, estado `Live`, commit `b413171`.
- GitHub Pages: run `33210766484`, resultado `success`, commit `eb42eaa`.

`[skip render]` se usó en la publicación de `main` y en la documentación para impedir despliegues de Render que no correspondan a staging. No hubo force-push, merge ni rebase entre `main` y `hommy-2.0`.

## Arquitectura resultante

1. `Hommychat.html` y los estilos especializados presentan la experiencia responsive y accesible.
2. `hommy-chat.js` controla sesión, bootstrap, contexto texto/voz, tarjetas estructuradas, gráficos, acciones de contacto y Realtime WebRTC.
3. `hommy-transport.js` centraliza transporte autenticado, timeouts y cancelación aguas arriba.
4. `servidor.py` expone health, chat, tools, bootstrap, sesión Realtime y sincronización de turnos, con CORS restringido, rate limits y métricas técnicas sin PII.
5. `hommy_backend/engine.py` usa Responses/Conversations, deja la intención al modelo y delega fechas y cálculos comerciales determinísticos a Python.
6. `hommy_backend/tools.py` entrega al modelo únicamente las herramientas autorizadas por RBAC y devuelve UI estructurada separada del payload del modelo.
7. `hommy_backend/data.py` lee Google Sheets por encabezados normalizados, reconcilia entidades y mantiene cache server-side con fresh TTL y stale-while-revalidate controlado.
8. `hommy_backend/periods.py`, `analytics.py` y `continuity.py` aíslan respectivamente periodos, cálculos ejecutivos/financieros y continuidad idempotente voz-chat.

## Cambios funcionales principales

### Periodos y analytics

- Resolución temporal determinística y testeable con `now` inyectable para hoy, ayer, semana actual/anterior, mes actual/anterior, trimestre, año, últimos 7/30 días y meses explícitos.
- Rechazo seguro de periodos ambiguos o futuros, sin volver a preguntar cuando la expresión es inequívoca.
- Reportes calculados en Python: total vendido, órdenes, ticket promedio, abonado, saldo, mayor venta, top cliente/producto cuando los datos son fiables y hora de actualización.
- Comparación MTD prioritaria: mes actual hasta hoy contra los mismos días del mes anterior, además del mes anterior completo.
- Variación COP/porcentual, crecimiento/caída y división por cero resueltos determinísticamente.
- No se generan proyecciones ni conversiones cotización-venta sin evidencia fiable.

### Herramientas de alto nivel

- `buscar_cliente`
- `consultar_historial_cliente`
- `consultar_orden`
- `consultar_saldos_pendientes`
- `consultar_agenda`
- `obtener_ultimas_ventas`
- `analizar_ventas_periodo`
- `comparar_periodos_ventas`
- `generar_reporte_ventas`
- `consultar_historial_pagos`
- `consultar_ultima_cotizacion`
- `consultar_cotizaciones`
- `analizar_cotizaciones`
- `obtener_resumen_negocio`
- `consultar_catalogo`
- `cotizar_producto`

Las herramientas de ventas, reportes, cartera, clientes, cotizaciones, agenda y catálogo se filtran por permiso antes de enviarse a texto o Realtime. Ambas modalidades ven exactamente el mismo catálogo autorizado.

### Google Sheets y reconciliación financiera

- Parser migrado a encabezados normalizados y alias controlados para `Clientes`, `Cotizaciones`, `Ordenes_Pedido`, `Abonos`, `Agenda` y `Tarifas`.
- Falla cerrada cuando faltan encabezados financieros o técnicos imprescindibles.
- Precisión mejorada en búsquedas de teléfono/cédula, orden cronológico de agenda y desempate de OP/cotización por fecha y número.
- Contrato interno por OP: `total_cop`, `abono_inicial_cop`, `abonos_extra_cop`, `abonado_total_cop`, `saldo_cop` y `estado_financiero`.
- Deducción de saldo: `max(total - abonado_total, 0)`; el saldo explícito se compara y las inconsistencias producen advertencia de integridad, nunca un falso estado pagado.
- Consultas financieras fuerzan o esperan un refresh y no ocultan un error devolviendo silenciosamente datos stale.

### UI, documentos, contactos y gráficos

- Tarjetas compactas de órdenes con total, abonado, saldo, estado y documento integrado.
- Tarjetas de cotización con fecha, cliente, resumen, valor, estado y PDF integrado.
- Documentos deduplicados por entidad/URL; un reporte agregado no genera cascadas de PDFs.
- Tarjeta única de contacto con placeholder de correo saneado y acciones Copiar, Compartir, WhatsApp y Llamar.
- `navigator.share()` en dispositivos compatibles y fallback de portapapeles; WhatsApp solo abre el chat y nunca envía mensajes.
- Tarjetas KPI y gráficos SVG/DOM nativos responsive, sin dependencia pesada ni `innerHTML` para contenido del modelo.
- Respuestas ejecutivas sin repetir el detalle ya visible en tarjetas.
- Sugerencias contextuales limitadas y filtradas también por RBAC.
- El starter inicial respeta capacidades: `Ventas recientes` requiere `ventas.read`; un usuario con solo `reportes.read` recibe `Ventas de este mes`.

### Voz y continuidad

- Realtime usa `semantic_vad` con eagerness baja, creación automática de respuesta e interrupción real habilitada.
- Reducción de ruido `near_field`, voz `cedar` y transcripción en español con `gpt-4o-mini-transcribe` y vocabulario HomeEasy.
- Contexto texto a voz y persistencia deduplicada de transcripciones finales voz a texto.
- Importes COP se conservan como números estructurados para pronunciación correcta.
- Corregidas cuatro carreras de la máquina de estados: respuesta activa, herramienta lenta supersedida por barge-in, audio cortado al cerrar y transcripción final retrasada.
- Cierre de voz espera de forma acotada los turnos finales para conservar orden voz→texto.
- La sincronización es idempotente durante la vida del proceso y queda ligada al usuario/conversación.

### Performance y seguridad

- Prewarm único y no bloqueante de `/api/health` desde `index.html` durante uso real; no existe keep-alive artificial.
- Bootstrap autenticado en background para calentar snapshot y métricas sin bloquear la UI ni enviar la base al navegador.
- Cache fresh/stale con single-flight, deadlines y forma explícita de refresh financiero.
- Timeouts de conexión/lectura de Sheets y timeout/retry acotado para OpenAI.
- Métricas internas `auth_ms`, `data_ms`, `openai_ms`, `tools_ms`, `total_ms` y rounds, sin prompts ni datos personales.
- Límites por UID salteado para chat, tools, sesiones Realtime y sync.
- Se mantienen `X-HomeEasy-Session`, `X-HomeEasy-Meta`, device binding, CORS restringido, DOM seguro y permisos mínimos.

## Archivos modificados

### Backend, configuración e infraestructura en `hommy-2.0`

- `.env.example`
- `.github/workflows/hommy-2-qa.yml`
- `.python-version`
- `render.yaml`
- `servidor.py`
- `hommy_backend/__init__.py`
- `hommy_backend/analytics.py`
- `hommy_backend/continuity.py`
- `hommy_backend/data.py`
- `hommy_backend/engine.py`
- `hommy_backend/periods.py`
- `hommy_backend/realtime.py`
- `hommy_backend/tools.py`

### Frontend Hommy

- `Hommychat.html`
- `hommy-chat.css`
- `hommy-chat.js`
- `hommy-ios.css`
- `hommy-polish.css`
- `hommy-transport.js`
- `index.html` (solo prewarm no bloqueante de staging)

### QA

- `tests/hommy-browser-qa.mjs`
- `tests/test_backend_contract.py`
- `tests/test_hommy_analytics_v2.py`
- `tests/test_hommy_cache_v2.py`
- `tests/test_hommy_continuity.py`
- `tests/test_hommy_data_v2.py`
- `tests/test_hommy_engine_metrics.py`
- `tests/test_hommy_intent_eval.py`
- `tests/test_hommy_intent_model_eval.py`
- `tests/test_hommy_periods.py`
- `tests/test_hommy_rbac.py`
- `tests/test_hommy_tools_v2.py`
- `tests/test_hommy_voice_ux.py`
- `tests/test_http_contract.py`
- `tests/test_static_contract.py`

No se modificaron AR, GLB, productos, Quick Look, builders ni módulos operativos ajenos a Hommy.

## Pruebas y resultados

- Suite Python completa: 99 pruebas descubiertas; 98 aprobadas y 1 omitida de forma intencional porque la evaluación real del modelo es opt-in y no usa secretos locales.
- Corpus determinístico de intents: aprobado.
- Python 3.12: `compileall` y contratos del SDK: aprobados.
- JavaScript: `node --check` para chat, transporte y QA: aprobado.
- WSGI/Gunicorn: import local aprobado; smoke real en Ubuntu CI aprobado.
- Flask local `/api/health`: HTTP 200, versión `2.1.0`.
- Navegador real: desktop `1440x1000` y móvil `390x844`, incluidos welcome, ventas, contacto, comparación/chart, XSS, overflow y cuatro carreras de voz: aprobado con mocks.
- RBAC: tools filtradas para texto/Realtime, permisos de solo lectura y fallos cerrados: aprobado.
- Secret scan de 35 archivos fuente y del diff staged: sin claves, private keys ni JSON privado.
- `git diff --check`: aprobado.
- CI `33210265951`: aprobado, incluyendo Gunicorn, navegador y contratos live de staging.
- Staging real: health 200; root 200; chat/bootstrap/sync sin sesión 401; endpoint legado 426; preflight CORS 204; `nosniff` y `no-referrer` presentes.
- Pages `33210766484`: aprobado. Los siete archivos públicos coinciden byte a byte con el commit `eb42eaa` y apuntan exclusivamente al backend staging.

## Variables configuradas

Solo nombres, sin valores:

- `OPENAI_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `HOMMY_CONVERSATION_SECRET`
- `HOMMY_SAFETY_SALT`
- `HOMMY_MODEL`
- `HOMMY_REASONING_EFFORT`
- `HOMMY_REALTIME_MODEL`
- `HOMMY_REALTIME_VOICE`
- `HOMEEASY_BACKEND_URL`
- `HOMEEASY_SHEET_ID`
- `HOMMY_DATA_TTL_SECONDS`
- `HOMMY_DATA_STALE_SECONDS`
- `HOMMY_DATA_REFRESH_WAIT_SECONDS`
- `HOMMY_SHEETS_CONNECT_TIMEOUT_SECONDS`
- `HOMMY_SHEETS_READ_TIMEOUT_SECONDS`
- `HOMMY_AUTH_CACHE_SECONDS`
- `HOMMY_OPENAI_TIMEOUT_SECONDS`
- `HOMMY_OPENAI_MAX_RETRIES`
- `HOMMY_RATE_CHAT_PER_MINUTE`
- `HOMMY_RATE_TOOL_PER_MINUTE`
- `HOMMY_RATE_REALTIME_SESSION_PER_MINUTE`
- `HOMMY_RATE_SYNC_PER_MINUTE`
- `HOMMY_CONVERSATION_MAX_AGE_SECONDS`
- `HOMMY_ALLOWED_ORIGINS`
- `HOMMY_INSTALL_DEFAULT`
- `HOMMY_INSTALL_ONDA`
- `HOMMY_VAT_RATE`
- `HOMMY_TRANSPORT`

## OpenAI, Google Cloud y Sheets

- OpenAI organization: `Personal`.
- OpenAI project: `Default project`.
- Credencial dedicada almacenada en Render: `HomeEasy Hommy 2.0`.
- La clave pegada en el chat no se utilizó ni se almacenó en el repositorio.
- Google Cloud project: `Hommy-HomeEasy` (`hommy-homeeasy`).
- Service Account pública: `homeeasy-hommy@hommy-homeeasy.iam.gserviceaccount.com`.
- Hoja operativa compartida con la Service Account: sí, rol lector.
- Scope: `https://www.googleapis.com/auth/spreadsheets.readonly`.
- La cuenta no recibió permisos administrativos ni permisos de escritura.

## URLs y estado live

- GitHub Pages: `https://alejoherrera05-del.github.io/Homeeasy/`
- Hommy público: `https://alejoherrera05-del.github.io/Homeeasy/Hommychat.html`
- Render staging: `https://homeeasy-hommy-staging.onrender.com`
- Health staging: `https://homeeasy-hommy-staging.onrender.com/api/health`
- Resultado health: HTTP 200, `ok=true`, `service=Hommy`, `version=2.1.0`.

## Riesgos restantes y acciones humanas

- La confirmación física en iPhone sigue pendiente para eco/ruido real, pausas naturales, teclado/safe-area y las hojas nativas de Share/WhatsApp/Phone.
- La idempotencia de sync y sus locks son memoria local del proceso. Un reinicio exactamente entre procesar y confirmar un batch podría permitir un turno duplicado; los locks también pueden crecer lentamente durante la vida de un worker. No es un bloqueante para staging, pero una persistencia/expiración compartida sería el siguiente endurecimiento.
- Render Free puede introducir cold start; el prewarm reduce el impacto durante uso real, sin evadir las reglas del plan.
- Acción de seguridad recomendada: revocar en OpenAI Platform la credencial que se publicó en el chat. Borrar el chat no revoca una clave expuesta.
- No queda ninguna autorización pendiente para la infraestructura de staging.

## Pruebas físicas pendientes en iPhone

1. Abrir Hommy desde HomeEasy y confirmar que carga sin zoom, overflow ni salto del composer al mostrar el teclado.
2. Preguntar “¿Cuánto llevo vendido este mes?” y comprobar que no solicita el mes y presenta KPIs/chart.
3. Preguntar “Compara este mes con el mes pasado” y revisar comparación MTD y mes anterior completo.
4. Pedir las últimas cinco ventas y confirmar total/abonado/saldo, estado y un único documento integrado por tarjeta.
5. Pedir la última cotización y abrir su documento.
6. Buscar un cliente de prueba y validar Copiar, Compartir, WhatsApp y Llamar sin envío automático.
7. En voz, preguntar por la última venta y después “¿Cuánto debe?” para validar contexto.
8. Escuchar un valor de COP de millones y confirmar la pronunciación completa en pesos.
9. Dejar ruido ambiente mientras Hommy habla y hacer una pausa natural durante una frase; Hommy no debe autocortarse ni contestar antes de tiempo.
10. Interrumpir intencionalmente a Hommy y confirmar que el barge-in real sí funciona y que el turno queda una sola vez en el chat.
