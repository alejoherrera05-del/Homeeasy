# Hommy - Handoff vigente de Codex

Fecha de cierre técnico: 2026-08-28

Rama backend: `hommy-2.0`

Documento detallado: `docs/HOMMY_CODEX_HANDOFF_V2.md`

## Estado final

- Hommy `2.1.0` está `Live` exclusivamente en `homeeasy-hommy-staging`.
- El frontend validado está publicado en GitHub Pages.
- El servicio Render de producción `Homeeasy` no fue modificado.
- No hubo merge entre `hommy-2.0` y `main`, ni force-push.
- Google Sheets usa únicamente `https://www.googleapis.com/auth/spreadsheets.readonly`.
- No hay secretos, claves privadas ni JSON de credenciales en Git.

## Commits realizados

- `b41317137f1ccf5f534c34edfdf4024b9360f48c` - `Complete Hommy 2.1 staging` (`hommy-2.0`).
- `eb42eaae3d5156c6e98b4cf766020c01c5a98a07` - `Publish Hommy 2.1 frontend [skip render]` (`main`).
- `Document Hommy 2.1 handoff [skip render]` - actualización documental en `hommy-2.0`.

## Archivos modificados

- Backend Hommy: `servidor.py` y `hommy_backend/`.
- Frontend Hommy: `Hommychat.html`, `hommy-chat.css`, `hommy-chat.js`, `hommy-ios.css`, `hommy-polish.css` y `hommy-transport.js`.
- Prewarm mínimo: `index.html`.
- Infraestructura: `render.yaml`, `.env.example`, `.python-version` y `.github/workflows/hommy-2-qa.yml`.
- QA: tests Hommy bajo `tests/`.
- Documentación: este archivo y `docs/HOMMY_CODEX_HANDOFF_V2.md`.

No se modificaron AR, modelos GLB, productos, Quick Look ni módulos operativos ajenos a Hommy. El inventario exacto de archivos está en el handoff V2.

## Resultados de pruebas

- Suite Python: 99 pruebas descubiertas; 98 aprobadas y 1 evaluación real opt-in omitida intencionalmente.
- Python 3.12, JavaScript, WSGI/Gunicorn, contratos OpenAI, RBAC y escaneo de secretos: aprobados.
- Navegador real desktop `1440x1000` y móvil `390x844`: aprobados con mocks, incluidas tarjetas, chart, contacto, XSS, overflow y carreras de voz.
- GitHub Actions Hommy 2 QA `33210265951`: `success`.
- GitHub Pages `33210766484`: `success`.
- Staging: health/root 200; rutas autenticadas sin sesión 401; legado 426; CORS 204.

## Variables configuradas

Los valores permanecen únicamente en el servicio seguro. Variables sensibles:

- `OPENAI_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `HOMMY_CONVERSATION_SECRET`
- `HOMMY_SAFETY_SALT`

Las variables no sensibles de modelos, timeouts, cache, rate limits, origen permitido y reglas comerciales están enumeradas solo por nombre en `docs/HOMMY_CODEX_HANDOFF_V2.md`.

## OpenAI, Google Cloud y Sheets

- OpenAI project: `Default project`.
- Credencial dedicada en Render: `HomeEasy Hommy 2.0`.
- Google Cloud project: `Hommy-HomeEasy` (`hommy-homeeasy`).
- Service Account: `homeeasy-hommy@hommy-homeeasy.iam.gserviceaccount.com`.
- Hoja compartida: sí, rol lector.
- Scope: `https://www.googleapis.com/auth/spreadsheets.readonly`.

## Render staging

- URL: `https://homeeasy-hommy-staging.onrender.com`
- Health: `https://homeeasy-hommy-staging.onrender.com/api/health`
- Resultado: HTTP 200, `ok=true`, versión `2.1.0`.
- Commit live: `b41317137f1ccf5f534c34edfdf4024b9360f48c`.
- Deploy live: `dep-da8vb8gicp7s73f6nbsg`.

## Acciones humanas pendientes

- Ejecutar las pruebas físicas detalladas en el handoff V2 desde un iPhone real.
- Revocar en OpenAI Platform la clave que se publicó en el chat; esa clave no fue utilizada por Codex y borrar el chat no la revoca.
- No queda autorización pendiente para staging.
