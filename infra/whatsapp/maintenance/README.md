# Mantenimiento de WhatsApp

El servicio local `homeeasy-maintenance` revisa WAHA cada seis horas. Al activar el modo automático desde Configuración → Integraciones, instala a las 03:00 de America/Bogota las versiones estables oficiales con al menos 72 horas desde su publicación. El navegador no recibe contraseñas del VPS, tokens internos, acceso SSH ni comandos Docker.

Solo administradores autenticados de HomeEasy pueden consultar o solicitar acciones. El Bridge ofrece GET/POST `/api/whatsapp/maintenance` y admite únicamente `check`, `update` y `automatic` (booleano `enabled`). El proceso del host consume una solicitud fija; no recibe rutas, imágenes, URLs ni comandos del cliente. Docker permanece fuera del contenedor Bridge.

El host conserva el estado público en `maintenance-runtime/status.json`, las solicitudes en `maintenance-runtime/requests`, las preferencias privadas en `maintenance-state.json` y los respaldos en `backups/maintenance-*`. El directorio raíz de runtime y el estado pertenecen a root; solo requests pertenece a UID1000. El contenedor recibe este directorio en `/app/maintenance`.

Antes de actualizar: conexión WORKING, 4GB libres, imagen descargada, configuración conocida, bloqueo de nuevos envíos y espera de operaciones activas. Luego se respalda la sesión detenida, se actualiza únicamente WAHA y se verifica versión y reconexión. Ante fallo se restaura la imagen y sesión previas. Una versión que falló no se reintenta automáticamente. Los respaldos se conservan; si falta espacio, se aplaza la actualización.

La comprobación automática no envía mensajes ni garantiza que todos los cambios futuros de WhatsApp sean compatibles. Si la recuperación falla o se interrumpe el proceso durante una operación crítica, el estado `attention` mantiene los envíos pausados y requiere atención técnica. No se reinicia el VPS ni se actualizan Ubuntu, Bridge, Apps Script o Hommy desde este servicio.

Instalación del servicio existente: copiar worker.py y la unidad systemd al VPS, crear runtime (root,0755) y requests (1000:1000,0700), añadir el bind mount al Bridge y reconstruirlo incluyendo maintenance.js. Instalar la unidad en `/etc/systemd/system/homeeasy-maintenance.service`, ejecutar daemon-reload y enable --now. El modo automático está desactivado por defecto hasta autorización del administrador.

Pruebas: `python3 maintenance/test_worker.py` simula actualización, respaldo, reversión y errores sin modificar el servidor real. `node --test tests/whatsapp-maintenance.cjs` verifica permisos, cola, bloqueo de envíos y panel (requiere jsdom).
