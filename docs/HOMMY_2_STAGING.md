# Hommy 2.0 — Staging y aceptación

Este documento define cómo probar Hommy 2.0 con los servicios reales antes de integrarlo a `main`.

## Estado de la rama

- Rama candidata: `hommy-2.0`
- `main` permanece sin cambios hasta completar staging.
- El CI de Hommy valida compilación, contratos, permisos, Gunicorn y navegador en desktop/móvil.
- El servicio público actual `homeeasy-l5n1.onrender.com` todavía sirve el backend anterior; Hommy 2.0 aún no está desplegado allí.

## Despliegue recomendado

La opción más segura es crear un servicio Web temporal de staging en Render apuntando a la rama `hommy-2.0`. No se debe sustituir el servicio actual hasta terminar la matriz de aceptación.

### Build command

```bash
pip install -r requirements.txt
```

### Start command

```bash
gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 90 servidor:app
```

Un solo worker evita duplicar innecesariamente snapshots/cachés en esta primera fase. Los threads permiten atender salud, chat y herramientas concurrentemente para el volumen esperado de HomeEasy.

### Health check

```text
/api/health
```

Debe devolver JSON con:

```json
{
  "ok": true,
  "service": "Hommy",
  "version": "2.x"
}
```

## Variables / secretos requeridos

Nunca se deben guardar valores reales en Git.

Obligatorias:

- `OPENAI_API_KEY`
- `HOMMY_CONVERSATION_SECRET` — secreto aleatorio largo, independiente de la API key.
- Credenciales de Google Sheets mediante una de estas opciones:
  - `GOOGLE_SERVICE_ACCOUNT_JSON`, o
  - `GOOGLE_APPLICATION_CREDENTIALS`, o
  - archivo secreto legado `credenciales.json`.

Recomendadas:

```text
HOMMY_ALLOWED_ORIGINS=https://alejoherrera05-del.github.io
HOMMY_MODEL=gpt-5.6-terra
HOMMY_REALTIME_MODEL=gpt-realtime-2.1
HOMMY_DATA_TTL_SECONDS=30
HOMMY_AUTH_CACHE_SECONDS=45
```

No usar nuevamente ElevenLabs en Hommy 2.0.

## Acción de seguridad obligatoria

El backend anterior tuvo una clave de ElevenLabs escrita directamente en `servidor.py` dentro de un repositorio público. Aunque Hommy 2.0 ya eliminó esa dependencia y no contiene esa credencial, la clave antigua debe considerarse comprometida por haber estado en el historial Git.

Antes del cierre definitivo:

1. Revocar/eliminar esa API key en ElevenLabs.
2. Si la cuenta de ElevenLabs sigue usándose en otro proyecto, crear una clave nueva con el mínimo alcance necesario.
3. No almacenar la nueva clave en este repositorio.

## Matriz de aceptación con datos reales

Todas las pruebas siguientes deben ejecutarse con una sesión HomeEasy real. No se aprueba el merge si alguna falla.

### 1. Salud y sesión

- `/api/health` responde `200` y `service=Hommy`.
- Hommy acepta una sesión HomeEasy válida.
- Una sesión ausente devuelve `401`.
- Una sesión vencida/revocada no expone datos.
- Una sesión ligada a otro dispositivo es rechazada.

### 2. Clientes y permisos

Con un usuario autorizado:

- Buscar un cliente conocido por nombre.
- Buscarlo por cédula.
- Verificar teléfono/email/dirección contra HomeEasy.
- Probar un nombre ambiguo: Hommy debe pedir precisión, no elegir arbitrariamente.

Con un rol que solo tenga `clientes.read`:

- Debe ver contacto.
- No debe ver compras, cotizaciones, saldos ni PDFs comerciales.

Con roles de ventas/cotizaciones:

- Solo debe aparecer el historial permitido por sus permisos.

### 3. Frescura de datos

- Consultar una venta/cliente conocido.
- Crear o modificar un registro desde HomeEasy.
- Esperar como máximo el TTL configurado (~30 s por defecto).
- Consultar de nuevo y comprobar que Hommy refleja el cambio sin reiniciar Render.

### 4. Ventas, cartera y abonos

Comparar directamente contra HomeEasy:

- Última venta.
- Últimas 5 ventas.
- Una OP específica.
- Saldo de una OP.
- Historial de abonos.
- Cartera pendiente.
- Reporte de un rango de fechas conocido.

Hommy no debe inventar un valor cuando el dato no exista.

### 5. Cotizador

Usar varios casos cuyo resultado esperado se conozca de antemano:

- Medida normal.
- Cantidad > 1.
- Cabezal/upgrade cuando aplique.
- Plan Renueva cuando aplique.
- Medida por encima del ancho máximo.
- Medida por encima del alto máximo.
- Tela inexistente o nombre ambiguo.

La configuración físicamente inválida debe ser rechazada; no debe producir un total como si fuera fabricable.

### 6. Conversación de texto

Secuencia mínima:

1. `Busca a <cliente real>`.
2. `¿Cuál fue su última compra?`.
3. `¿Cuánto debe?`.

Hommy debe conservar el referente conversacional, pero volver a consultar la herramienta correspondiente para los datos actuales.

### 7. Voz Realtime

Probar en Chrome desktop y Safari/iPhone:

- Permiso de micrófono.
- Inicio de WebRTC.
- Hablar español natural.
- Hommy escucha y responde por audio.
- Interrumpir a Hommy mientras habla: debe detenerse y escuchar el nuevo turno.
- Preguntar por una OP/cliente/saldo por voz y verificar el dato contra HomeEasy.
- Confirmar que las herramientas disponibles por voz respetan los mismos permisos que el texto.

### 8. Contexto texto → voz

1. En texto: `Busca a <cliente real>`.
2. Recibir la respuesta.
3. Abrir voz.
4. Preguntar: `¿Y cuánto debe?` o equivalente.

La voz debe recibir el contexto reciente del chat y resolver correctamente la referencia.

### 9. Seguridad de salida

- Respuestas con caracteres `< >`, Markdown o texto parecido a HTML deben mostrarse como texto, no ejecutarse.
- Los documentos deben abrirse únicamente mediante enlaces HTTPS creados por la interfaz.
- Nunca deben aparecer tokens, credenciales ni prompts internos en la respuesta.

### 10. Recuperación / Render dormido

- Dejar el servicio inactivo el tiempo suficiente para provocar un cold start si el plan lo permite.
- Abrir Hommy y comprobar que la UI se recupera después de que Render despierte.
- Una caída temporal no debe cerrar la sesión principal de HomeEasy.

## Orden de publicación

1. Desplegar backend Hommy 2.0 en staging.
2. Completar toda la matriz anterior.
3. Corregir cualquier discrepancia real de datos/voz.
4. Validar nuevamente CI de la rama.
5. Desplegar el backend nuevo en el servicio definitivo.
6. Confirmar `/api/health` en producción.
7. Integrar `hommy-2.0` a `main`.
8. Esperar despliegue de GitHub Pages.
9. Ejecutar smoke final desde la app publicada.

## Rollback

Mientras no se haya integrado a `main`, el frontend productivo permanece intacto.

Después del release:

- Render: volver al deploy anterior si el backend presenta una regresión crítica.
- GitHub: revertir el commit/merge de Hommy 2.0 si la interfaz publicada necesita volver al estado anterior.

No tocar AR, modelos, productos o módulos operativos como parte de un rollback de Hommy.
