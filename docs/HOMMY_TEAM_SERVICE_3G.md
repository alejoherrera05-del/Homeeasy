# Fase 3G · Servicio conversacional del equipo

Estado: propuesta aislada, aun NO desplegada ni habilitada.

Esta ruta incorpora inteligencia conversacional sin exponer herramientas comerciales de escritura ni copiar una sesion personal de HomeEasy a Hetzner.

Endpoint POST /api/hommy/team/interpret (JSON). Se autentica con el header Authorization: Bearer <token de servicio>.
El mismo secreto de al menos 32 caracteres debe configurarse de forma privada en Render y Hetzner, nunca en GitHub, HTML, Apps Script o chat.

En Render: HOMMY_TEAM_SERVICE_ENABLED=false inicialmente; HOMMY_TEAM_AI_SERVICE_TOKEN guardado como secreto. HOMMY_TEAM_MODEL opcional; timeout 5.5 segundos.
En Hetzner: HOMMY_TEAM_AI_ENABLED=false inicialmente, HOMMY_TEAM_AI_URL apuntando al endpoint HTTPS de Render, y HOMMY_TEAM_AI_SERVICE_TOKEN con el mismo secreto.

Se necesita ademas el modo REVIEW, grupo autorizado, respuestas internas habilitadas y aprobacion independiente del propietario desde Integraciones.

El cuerpo contiene question, history de maximo tres intercambios, facts resumidos y style. No contiene nombres de clientes, telefonos, chats privados ni IDs internos.
La respuesta es ANSWER con text o REVIEW_REQUIRED sin ejecucion de acciones.
No son herramientas para contacto a clientes, cotizaciones, agenda o modificaciones de datos.
El backend valida token por comparacion constante, limita solicitudes autenticadas, valida tamanos y contrato, no usa herramientas ni la sesion personal.

Orden de despliegue: (1) validar PR y tests sin red; (2) desplegar backend desactivado; (3) configurar token seguro en Render y Hetzner;
(4) verificar que sin token responde 401; (5) habilitar backend de forma controlada; (6) actualizar solo Bridge con respaldo;
(7) habilitar el modo conversacional del grupo desde HomeEasy y probar una pregunta inocua.

La rama hommy-2.0 tiene despliegue automatico: un merge provoca un deploy. No fusionar sin validar QA y revisar impacto.
Render Free puede tener arranque frio y superar el timeout de Bridge. Ante error no hay reintentos ni mensajes inventados.

La memoria disponible al Bridge sigue siendo una vista parcial de oportunidades analizadas; no equivale a la agenda confirmada ni todos los chats.
