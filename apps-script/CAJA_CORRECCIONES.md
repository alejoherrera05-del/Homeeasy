# Correcciones de Caja

Permite editar, eliminar de forma recuperable y restaurar movimientos manuales. Los movimientos vinculados a documentos se corrigen desde su documento de origen.

## Integración

Instalar `CAJA_CORRECCIONES.gs` junto al Cerebro. Después del retorno de `bloqueoPostAuth9B` en la ruta POST:

```js
if (data.tipo === "movimiento_caja" && data.accionCaja) return json_(corregirMovimientoCaja_(ss, data));
```

En `obtenerDatosCaja_`, envolver el objeto de respuesta existente con `enriquecerCajaCorrecciones_(ss, resultado)`.

Publicar primero Apps Script y después los recursos de Caja. La interfaz conserva el renderizado anterior si el servidor todavía no devuelve `correccionesCajaVersion: 1`.

## Datos y validaciones

La primera corrección añade encabezados de control en K:P si están disponibles. Conserva ID, fecha y columnas de origen. Eliminar cambia el tipo a `ELIMINADO_GASTO` o `ELIMINADO_INGRESO`, por lo que deja de sumar al saldo; restaurar recupera el tipo original. No borra filas.

Cada cambio exige sesión de usuario con `caja.write`, sesión de Caja, motivo y revisión vigente. Usa lock, identificador de solicitud y auditoría antes/después. Rechaza IDs duplicados, columnas inesperadas y movimientos vinculados. Los errores de escritura intentan recuperar los valores anteriores y quedan registrados en Auditoría.

Pruebas con datos ficticios: `node tests/caja-correcciones.cjs` (24 casos). También se verificó editar, eliminar, filtrar eliminados y restaurar desde el navegador con un servidor en memoria; no se alteraron movimientos reales para probar.

Despliegue Apps Script: versión 224, 14 de septiembre de 2026. Conserva la URL de la implementación existente. La versión 223 queda disponible para reversión; si se revierte, las filas eliminadas siguen excluidas del saldo pero requieren volver a instalar el módulo para restaurarlas desde Caja.
