# Corrección de recibos duplicados — 16/10/2026

El Cerebro exportado confirma que la ruta `tipo: abono` ya tenía LockService y asignación secuencial, pero no comprobaba requestId ni saldo bajo ese bloqueo. Escribía primero las columnas de la OP y después el PDF y Abonos. Un reintento podía consumir otro número y repetir el importe; el saldo negativo quedaba oculto por Math.max(..., 0). El frontend permitía ejecuciones paralelas y continuar con saldo en caché.

## Corrección

- `abono.html`: cerrojo síncrono, estado incierto, coordinación entre pestañas mediante Web Locks, requestId persistido y autorización explícita para un segundo pago real con los mismos datos. Sin saldo actualizado no se envía. La nueva anulación exige motivo y confirmación, y solo aparece con permiso y backend habilitado. Las acciones y filas anuladas no se imprimen.
- `RECIBOS_SEGUROS.gs`: sesión y permisos verificados en servidor; saldo y número asignados dentro del mismo lock; idempotencia permanente ligada al usuario y contenido; lote atómico de OP, Abonos y Auditoria. El resultado se persiste junto con el pago. Un resultado incierto deja un diario que impide nuevas escrituras hasta conciliarlo. Lecturas financieras por Sheets API para evitar caché de SpreadsheetApp tras el lote.
- La anulación exige identificación inequívoca por nota de columna, recibo/OP/cliente consistentes, revisión vigente, motivo, permiso y confirmación. Examina vínculos de Caja y Anulaciones bajo lock. Marca ANULADO / NO / NO, retira solo su columna de la OP y recalcula saldo/estado. Conserva filas, PDF y antes/después auditables. No crea gastos ni reembolsos.
- `scripts/integrar-recibos.cjs`: integración repetible mediante dos cambios acotados en doPost/HISTORIAL_ABONOS y dependencia Sheets v4. No publica por sí mismo ni elimina handlers existentes.
- `RECIBO_64_CORRECCION.gs`: recuperación específica del incidente, limitada al propietario del proyecto. Exige respaldo independiente, coincidencia exacta de importes/cliente, PDF idéntico por SHA-256 y ausencia de cambios posteriores vinculados. Verifica después que el 63 y todas las filas manuales de Caja sigan intactos.

## Validación

- 18 escenarios financieros de Node/V8: reintentos, requestId reutilizado, saldo, numeración, dos pestañas, lock ocupado, timeout antes/después del commit, fallo de Drive, anulación repetida, permisos, motivo, revisión, dependencias y Caja.
- 4 escenarios reales de Chromium para intentos compartidos entre dos pestañas, recarga y segundo pago autorizado.
- 6 casos de PDF de recibos con acciones visibles excluidas del PDF, móvil/escritorio, historial extenso, pago final y recuperación tras fallo de captura.
- 4 casos de PDF de órdenes y 3 de cotizaciones; contratos existentes de Configuración, canales, encabezados, guardado e integración; 24 pruebas existentes de correcciones de Caja.
- Certificación real en Apps Script con base nueva exclusivamente ficticia: 9 casos. Caja 5.840.000 -> 3.920.000 al anular el duplicado ficticio; saldo cero y recibo 63 ficticio conservado. Resultado PASS en ejecución de 19:58 del 16/10/2026, Bogotá. Se repite antes de desplegar la revisión final.

El primer ensayo real detectó Sheets API deshabilitada (403). Su activación y aceptación de términos fueron autorizadas expresamente por el usuario. Otro ensayo detectó caché de SpreadsheetApp en el retry de anulación: se sustituyeron esas lecturas por lecturas persistidas de la API antes de continuar.

## Operación

Se conserva copia independiente de la base real y exportación original del Cerebro. No se hacen pagos ficticios en producción. El despliegue y la recuperación real deben registrarse con resultado verificado; un commit o un PASS simulado no acreditan la modificación del recibo 64.
