# HomeEasy · Ruta de integración WhatsApp

Estado: **Fase 1 iniciada**

## Objetivo

Conectar HomeEasy con WhatsApp para enviar desde la app, sin depender de WhatsApp instalado en el PC o teléfono:

- Cotizaciones en PDF.
- Órdenes de pedido en PDF.
- Recibos de abono en PDF.

La primera implementación será **WAHA + WEBJS**, alojada en un VPS 24/7 con Docker y sesión persistente.

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
3. El Bridge es el único componente expuesto para la integración de HomeEasy.
4. WAHA queda en una red Docker privada y protegido con `X-Api-Key`.
5. La sesión de WhatsApp se guarda fuera del contenedor en almacenamiento persistente del VPS.
6. `.env`, sesiones, backups y archivos temporales están excluidos de Git.

## Fases

### Fase 1 · Infraestructura aislada

- VPS Ubuntu 24/7.
- Docker + Docker Compose.
- WAHA con motor WEBJS.
- Volumen persistente para `.sessions`.
- Autoarranque después de reinicio.
- Bridge privado de HomeEasy.
- Primer QR.
- Primer mensaje de prueba.
- Primer PDF de prueba.

**No tocar Cotización, Pedido ni Abono hasta completar esta fase.**

### Fase 2 · Configuración dentro de HomeEasy

Crear en `configuracion.html` una sección **Integraciones → WhatsApp HomeEasy** con:

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

La sesión se almacenará en el VPS en un volumen persistente, por ejemplo:

```text
/opt/homeeasy-whatsapp/data/sessions/
```

Reiniciar Docker, WAHA o el VPS no debe requerir un nuevo QR mientras WhatsApp conserve válido el dispositivo vinculado.

## Motor inicial

- WAHA
- `WHATSAPP_DEFAULT_ENGINE=WEBJS`
- Imagen Docker para WEBJS/Chromium: `devlikeapro/waha:chrome`

## Próximo hito

**HomeEasy WhatsApp Bridge + WAHA funcionando en un VPS y enviando un PDF de prueba.**
