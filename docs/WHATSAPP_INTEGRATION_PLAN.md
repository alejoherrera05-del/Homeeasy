# HomeEasy · Ruta de integración WhatsApp

Actualizado: **03-sep-2026**

Estado: **Canal saliente operativo e integrado en HomeEasy · siguiente etapa: seguimiento inteligente con Hommy**

## Objetivo

Conectar HomeEasy con WhatsApp para enviar desde la app sin depender de WhatsApp instalado en el PC o teléfono, manteniendo el canal desacoplado del flujo principal de HomeEasy.

## Arquitectura vigente

```text
HomeEasy (GitHub Pages)
        |
        | sesión/permisos HomeEasy
        v
HomeEasy WhatsApp Bridge · api.homeeasy.com.co
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

WAHA no se consume directamente desde los HTML públicos.

---

# Estado real actual

## Infraestructura

- VPS 24/7 con Docker.
- WAHA con motor WEBJS.
- Sesión persistente `homeeasy`.
- Bridge público por HTTPS en `api.homeeasy.com.co`.
- WAHA permanece privado dentro de la infraestructura.
- Reinicio y recuperación guiada de sesión disponibles.

## HomeEasy WhatsApp Bridge

Versión actual del código: **0.5.0**.

Capacidades implementadas:

- `GET /health`
- `GET /api/whatsapp/status`
- `GET /api/whatsapp/activity`
- `GET /api/whatsapp/templates`
- `POST /api/whatsapp/templates`
- `POST /api/whatsapp/templates/reset`
- `POST /api/whatsapp/bootstrap`
- `POST /api/whatsapp/restart`
- `GET /api/whatsapp/qr`
- `POST /api/whatsapp/test-message`
- `POST /api/whatsapp/test-document`
- `POST /api/whatsapp/send-document`
- `POST /api/whatsapp/send-document-url`

El Bridge registra actividad persistente, mantiene plantillas persistentes y usa idempotencia para reducir el riesgo de documentos duplicados.

## Configuración dentro de HomeEasy

La integración visual en `Configuración → Integraciones → WhatsApp HomeEasy` ya existe.

El cliente `homeeasy-whatsapp-client.js`:

- usa la sesión HomeEasy;
- consulta estado;
- consulta actividad;
- administra plantillas;
- permite reinicio/recuperación;
- obtiene QR cuando corresponde;
- envía mensajes/PDF de prueba;
- envía documentos de HomeEasy;
- evita que una falla del canal WhatsApp cierre o altere la sesión principal de HomeEasy.

## Envío de documentos

El canal ya puede reutilizarse para:

- cotizaciones;
- órdenes de pedido;
- recibos de abono;
- reenvío desde documentos almacenados cuando el PDF es accesible.

---

# Reglas de seguridad vigentes

1. WAHA no se llama directamente desde los HTML públicos.
2. Las credenciales privadas no se guardan en GitHub.
3. El Bridge es la frontera pública del canal.
4. La sesión de HomeEasy se valida antes de operaciones protegidas.
5. Los permisos de HomeEasy limitan operaciones de documentos.
6. La falla de WhatsApp nunca debe bloquear la creación/guardado del documento.
7. Un envío ambiguo no debe reintentarse automáticamente si existe riesgo de duplicado.

---

# Hueco funcional actual

El sistema actual está principalmente orientado a **salida**.

Todavía no existe en el repositorio un flujo completo para:

- recibir mensajes entrantes de clientes desde WAHA;
- vincular automáticamente una respuesta con cliente/cotización;
- interpretar intención comercial;
- cancelar o reprogramar un seguimiento por lo que respondió el cliente;
- ejecutar seguimientos automáticos 24/7.

Ese hueco se resuelve en la siguiente etapa.

---

# Nueva etapa · Hommy Seguimiento Inteligente

La ruta oficial continúa en:

- `docs/HOMMY_SMART_FOLLOWUP_PLAN.md`
- `docs/HOMMY_SALES_PLAYBOOK.md`

La nueva arquitectura separa:

- **HomeEasy:** fuente de verdad de la oportunidad y timeline.
- **Hommy:** análisis, intención, estrategia y redacción.
- **Follow-up Worker:** ejecución 24/7 y programación.
- **WhatsApp Bridge:** canal de entrega/recepción y auditoría técnica.

El navegador no será responsable de ejecutar automatizaciones cuando HomeEasy esté cerrado.

---

# Próximo hito

Construir la primera entrega de seguimiento inteligente en modo **REVIEW**:

1. memoria comercial por cotización;
2. timeline auditable;
3. análisis de Hommy;
4. próxima acción recomendada;
5. borrador contextual;
6. aprobar / editar / omitir;
7. posteriormente conectar envío de texto comercial y WhatsApp entrante.

No activar `AUTO` hasta validar casos reales, STOP rules, idempotencia y comportamiento en errores.