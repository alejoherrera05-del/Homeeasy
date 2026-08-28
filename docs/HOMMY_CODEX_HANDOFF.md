# Hommy 2.0 - Handoff de Codex

Fecha de cierre técnico: 2026-08-28

Repositorio: `alejoherrera05-del/Homeeasy`

Rama: `hommy-2.0`

## Estado final

- Hommy 2.0 quedó desplegado y `Live` exclusivamente en el servicio Render `homeeasy-hommy-staging`.
- El servicio de producción `Homeeasy` no fue modificado.
- El despliegue activo de staging usa el commit técnico `75407015cd370d6b7823bd217cfab2a6ab3462ac`.
- `main` continúa intacto en `cf904486711a1eb69ded02adc0972068477bcc51`.
- Google Sheets usa exactamente el scope `https://www.googleapis.com/auth/spreadsheets.readonly`.
- Las credenciales sensibles quedaron almacenadas en Render; las copias locales temporales se eliminaron.

## Commits realizados

- `75407015cd370d6b7823bd217cfab2a6ab3462ac` - `Harden Hommy staging isolation and Sheets access`.
- `HEAD` - `Document Hommy 2 staging handoff` (este documento).

No se realizó merge a `main`.

## Archivos modificados

- `.github/workflows/hommy-2-qa.yml`
- `hommy-chat.js`
- `hommy_backend/data.py`
- `tests/hommy-browser-qa.mjs`
- `tests/test_backend_contract.py`
- `tests/test_static_contract.py`
- `docs/HOMMY_CODEX_HANDOFF.md`

Los cambios de código fueron quirúrgicos: aislar frontend y QA hacia staging y reducir Google Sheets al scope de solo lectura. No se modificaron AR, modelos, productos ni otros módulos operativos.

## Pruebas y validaciones

- Python 3.12: compilación de `servidor.py` y `hommy_backend/`, aprobada.
- JavaScript: validación sintáctica de `hommy-chat.js` y `tests/hommy-browser-qa.mjs`, aprobada.
- Contratos Hommy: 24 pruebas, aprobadas.
- Contratos del SDK de OpenAI: Responses, Conversations y Realtime, aprobados.
- OpenAI real: autenticación y acceso a `gpt-5.6-terra`, aprobados.
- Flask local: `/api/health` 200; chat sin autenticación 401; cliente legado 426; preflight CORS 204.
- Gunicorn: smoke test Linux y `/api/health`, aprobados en GitHub Actions.
- Navegador: desktop 1440x1000, móvil 390x844 y protección XSS, aprobados.
- GitHub Actions `Hommy 2 QA`, run `33179652129`: `success` sobre `75407015cd370d6b7823bd217cfab2a6ab3462ac`, incluyendo el probe de staging.
- Staging real:
  - `GET /api/health`: 200 desde Gunicorn.
  - `POST /api/hommy/chat` sin sesión: 401 `AUTH_REQUIRED`.
  - `POST /api/chat`: 426 `CLIENT_UPGRADE_REQUIRED`.
  - Preflight desde `https://alejoherrera05-del.github.io`: 204 con el origen permitido.
- Google Sheets real: la Service Account autenticó y leyó metadatos de `Base de Datos HomeEasy` con el scope de solo lectura; no se leyó ni imprimió contenido operativo.

## Variables configuradas en Render

- `OPENAI_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

También quedaron presentes las variables no secretas y secretos generados definidos por `render.yaml`. No se registran valores en este documento.

## OpenAI

- Organización: `Personal`.
- Proyecto usado: `Default project` (único destino disponible en el flujo seguro desde esta sesión).
- Nombre de la credencial nueva: `HomeEasy Hommy 2.0`.
- La clave pegada en el chat no fue utilizada ni almacenada localmente.

## Google Cloud y Google Sheets

- Proyecto Google Cloud: `Hommy-HomeEasy` (`hommy-homeeasy`).
- Service Account: `homeeasy-hommy@hommy-homeeasy.iam.gserviceaccount.com`.
- IAM del proyecto: sin roles administrativos ni roles operativos adicionales.
- Hoja: `Base de Datos HomeEasy`.
- Hoja compartida con la Service Account: sí, rol `reader`.
- Scope de la aplicación: `https://www.googleapis.com/auth/spreadsheets.readonly`.
- Validación RBAC: lectura aprobada; escritura no concedida por Drive y no solicitada por el scope OAuth.

## Render staging

- Blueprint: `homeeasy-hommy-staging`.
- Servicio: `homeeasy-hommy-staging`.
- Rama: `hommy-2.0`.
- URL: https://homeeasy-hommy-staging.onrender.com
- Health: https://homeeasy-hommy-staging.onrender.com/api/health - HTTP 200.
- Último commit desplegado correctamente: `75407015cd370d6b7823bd217cfab2a6ab3462ac`.

El historial del Blueprint conserva `c002f66f02f403111c35a16015416f376b5b7a9e` como la sincronización inicial de `render.yaml`; la página del servicio confirma que el deploy `Live` usa `75407015cd370d6b7823bd217cfab2a6ab3462ac`.

## Seguridad y acciones pendientes

- No hay `.env`, JSON de Service Account, claves privadas ni tokens versionados.
- Se eliminaron `.env.local` y el JSON descargado después de transmitir y validar las credenciales en Render.
- Acción humana pendiente: revocar en OpenAI Platform la clave que fue pegada en el chat. Borrar el chat no revoca una credencial expuesta.
- No queda ninguna autorización pendiente para staging.

Listo para revisión de ChatGPT.
