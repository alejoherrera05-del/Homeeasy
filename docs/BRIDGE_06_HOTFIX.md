# Bridge v0.6.0 hotfix

El despliegue inicial de Bridge v0.6.0 reveló que `server.js` ya requería `conversation.js`, pero el Dockerfile no copiaba ese módulo a la imagen. El contenedor podía construirse y arrancar, pero el proceso Node terminaba al resolver `require('./conversation')`, por lo que el health check no respondía.

Hotfix: añadir `COPY conversation.js ./` al Dockerfile y cubrirlo en QA permanente antes de volver a ejecutar el actualizador del VPS.
