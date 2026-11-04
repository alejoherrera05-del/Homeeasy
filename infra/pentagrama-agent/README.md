# HomeEasy Pentagrama Agent v1

## Experiencia de escritorio

- Instala un servicio de Windows que inicia automáticamente y se recupera ante fallos.
- Muestra el icono oficial de HomeEasy en la bandeja del sistema.
- Doble clic en el icono abre un panel con estado, versión y acceso al diagnóstico.
- Los estados visibles son `Agente activado`, `Agente trabajando`, `Agente reconectando` y `Agente desconectado`.
- Las actualizaciones llegan por el canal TLS autenticado del Agent, se validan con SHA-256 y se instalan silenciosamente.
- Una versión nunca se degrada a otra anterior y un paquete con hash incorrecto nunca se ejecuta.

La instalación 1.6.0 requiere UAC una sola vez. A partir de esa versión, las actualizaciones publicadas por HomeEasy son automáticas.

Servicio Windows de salida para ejecutar consultas Pentagrama desde una red autorizada. El agente se registra contra el VPS, conserva secretos con DPAPI de máquina y acepta únicamente la lista cerrada de trabajos Pentagrama definida en el código. No abre puertos en el computador, no ejecuta comandos remotos arbitrarios y no escribe en Sheets.

El instalador se construye con `build.ps1`; recibe por parámetro el endpoint TLS, el certificado de confianza y la clave de enrolamiento. Esos valores operativos no se versionan. WinSW instala el proceso como servicio automático con recuperación y el paquete incluye su propio `node.exe`.
