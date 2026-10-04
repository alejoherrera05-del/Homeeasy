# HomeEasy Pentagrama Agent v1

Servicio Windows de salida para ejecutar consultas Pentagrama desde una red autorizada. El agente se registra contra el VPS, conserva secretos con DPAPI de máquina y acepta únicamente los trabajos `health` y `getPrice`. No abre puertos en el computador, no ejecuta comandos remotos arbitrarios y no escribe en Sheets.

El instalador se construye con `build.ps1`; recibe por parámetro el endpoint TLS, el certificado de confianza y la clave de enrolamiento. Esos valores operativos no se versionan. WinSW instala el proceso como servicio automático con recuperación y el paquete incluye su propio `node.exe`.
