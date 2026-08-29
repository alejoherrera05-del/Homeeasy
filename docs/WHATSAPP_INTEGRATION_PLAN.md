# HomeEasy · Ruta de integración WhatsApp

Estado: **Fase 1 completada · Fase 2 pendiente de HTTPS/Integraciones**

## Objetivo

Conectar HomeEasy con WhatsApp para enviar desde la app, sin depender de WhatsApp instalado en el PC o teléfono:

- Cotizaciones en PDF.
- Órdenes de pedido en PDF.
- Recibos de abono en PDF.

La primera implementación usa **WAHA + WEBJS**, alojada en un VPS 24/7 con Docker y sesión persistente.

## Arquitectura aprobada

```text
HomeEasy (GitHub Pages)
        |
        v
Backend HomeEasy (Google Apps Script)
        |
        v
HomeEasy WhatsApp Bridge (VPS, HTTPS, autenticado)
        |
        v
WAHA + WEBJS (red Docker privada)
        |
        v
WhatsApp Web
        |
        v
Cliente
```

### Reglas de seguridad

1. WAHA **no** se llama directamente desde los HTML públicos.
2. Ninguna API key, token o sesión se guarda en GitHub.
3. El Bridge es el único componente que podrá exponerse para la integración de HomeEasy.
4. WAHA queda privado en el VPS y protegido con `X-Api-Key`.
5. La sesión de WhatsApp se guarda fuera del contenedor en almacenamiento persistente del VPS.
6. `.env`, sesiones, backups y archivos temporales están excluidos de Git.

## Fases

### Fase 1 · Infraestructura aislada — COMPLETADA ✅

- VPS Hetzner CX23, Ubuntu 24.04, Falkenstein.
- Docker + Docker Compose instalados.
- WAHA 2026.8.1 con motor WEBJS.
- Volumen persistente para `.sessions`.
- Autoarranque después de reinicio.
- HomeEasy WhatsApp Bridge desplegado.
- Sesión `homeeasy` vinculada por QR.
- Estado verificado: `WORKING`, `ready: true`.
- Primer mensaje de prueba enviado y recibido correctamente.
- Primer PDF de prueba enviado y recibido correctamente.

**Resultado:** la cadena `VPS → Bridge → WAHA → WhatsApp` funciona en producción real.

### Fase 2 · HTTPS + Configuración dentro de HomeEasy

Antes de conectar los HTML públicos se debe exponer **solo el Bridge** mediante HTTPS válido y mantener WAHA privado.

Después crear en `configuracion.html` una sección **Integraciones → WhatsApp HomeEasy** con:

- Estado: Conectado / Reconectando / Necesita vincularse.
- Número conectado.
- Última comprobación.
- Botón `Probar conexión`.
- Botón `Enviar mensaje de prueba`.
- QR solamente cuando la sesión lo requiera.

### Fase 3 · Cotizaciones

- Botón `Enviar por WhatsApp` después de generar el PDF.
- Confirmación de número antes de enviar.
- Estado `PENDIENTE / ENVIADO / ERROR`.
- Sin envío automático inicialmente.

### Fase 4 · Pedido + Abono

Reutilizar exactamente el mismo servicio para:

- Orden de pedido.
- Recibo de abono.

### Fase 5 · Cola y recuperación

- Reintentos automáticos.
- Evitar duplicados.
- Mantener el documento guardado aunque WhatsApp esté caído.
- Registro de fecha, número, documento y resultado.

### Fase 6 · Automatización

Después de validar estabilidad:

- Enviar cotizaciones automáticamente: ON/OFF.
- Enviar órdenes automáticamente: ON/OFF.
- Enviar abonos automáticamente: ON/OFF.

## Comportamiento ante fallos

WhatsApp nunca debe bloquear el flujo principal de HomeEasy.

Si WhatsApp no está disponible:

```text
Documento guardado  ✓
PDF generado        ✓
WhatsApp             PENDIENTE
```

El envío puede reintentarse posteriormente sin regenerar el documento.

## Sesión

La sesión se almacena en el VPS en:

```text
/opt/homeeasy-whatsapp/data/sessions/
```

Reiniciar Docker, WAHA o el VPS no debe requerir un nuevo QR mientras WhatsApp conserve válido el dispositivo vinculado.

## Motor actual

- WAHA 2026.8.1
- `WHATSAPP_DEFAULT_ENGINE=WEBJS`
- Imagen Docker: `devlikeapro/waha:chrome`
- Sesión: `homeeasy`

## Próximo hito

**Publicar únicamente el HomeEasy WhatsApp Bridge mediante HTTPS válido, probarlo desde fuera del VPS y después integrar el panel de WhatsApp en `configuracion.html`.**
