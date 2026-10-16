# HomeEasy / Hommy — incidente de recibos 63 y 64 (16-oct-2026)

## Evidencia verificada en el código

1. `abono.html` genera un PDF y realiza un `POST` de `tipo: "abono"` al Web App de Google Apps Script. La versión anterior no impedía que `finalizarAbono()` se ejecutara en paralelo desde el mismo formulario. El número mostrado provenía de un GET a `?nextRecibo=1`, que no constituye una reserva atómica.
2. `clientes.html` implementa anulación y revisión para cotizaciones y órdenes (COT/OP), **no para cada abono**.
3. `apps-script/CAJA_CORRECCIONES.gs` prohíbe editar desde Caja movimientos vinculados a documentos. El bloqueo es deliberado y no debe eludirse.
4. `homeeasy-core.js` añade metadatos y un `requestId` si falta, pero esto **no acredita** que la ruta antigua `tipo:"abono"` los deduzca/guarde o aplique idempotencia.
5. La versión completa y desplegada del backend **Cerebro Apps Script** (ruta `tipo:"abono"`, escritura real en `Abonos`, `Caja` y `Ordenes_Pedido`) no está en el repositorio consultado. Por tanto, no se puede atribuir definitivamente la duplicación a un doble clic ni certificar el saldo real con GitHub.

## Cambio incluido en esta rama

- Cerrojo síncrono de registro y botón inhabilitado mientras se procesa.
- Estado `registrado` que impide repetir el POST desde el mismo formulario después de confirmación exitosa.
- Estado `incierto` que bloquea nuevos envíos desde ese formulario si la solicitud pudo haberse registrado y la respuesta no llegó.
- `requestId` explícito en el POST, útil para que el backend implemente idempotencia.
- Se preservaron payload y plantilla PDF, configuración y navegación.
- Pruebas: `tests/abono-no-doble-envio.cjs` (doble clic, éxito, error incierto, error previo a POST).

**Límites:** esta protección en navegador no evita solicitudes concurrentes desde otros dispositivos, pestañas nuevas o recargas, ni confirma idempotencia en servidor. Requiere complemento en Apps Script.

## Recuperación segura del recibo 64

**No eliminar filas, PDFs ni Caja manualmente. No anular la OP para corregir un único recibo.**

Antes de anular, verificar en los datos vivos:

- Ambos recibos existen efectivamente en `Abonos` y no se trata de una duplicación exclusivamente visual.
- R.C. 63 y R.C. 64 comparten OP, cliente, valor, medio, fecha y concepto (si aplica).
- Hay dos movimientos asociados en Caja y cuál corresponde inequívocamente al R.C. 64.
- Los importes de la OP permiten reconstruir: `saldo_correcto = total_OP - abono_inicial - suma(abonos_activos_excluyendo_64)`.
- No hay reembolso, notas/créditos, traslados, recibos dependientes ni cambios posteriores que impidan una reversión directa.
- Copia de seguridad fechada de `Abonos`, `Caja`, `Ordenes_Pedido` y `Auditoria`.

El diseño de reversión es **anulación lógica** del recibo 64, conservar su PDF y crear/ajustar el efecto contable inverso **según la semántica real del backend** (no registrar un gasto ficticio ni otro abono de signo negativo). Recalcular el saldo de OP a partir de los pagos vigentes, garantizar que Caja solo refleje un ingreso activo y auditar antes/después, operador, motivo, fecha y `requestId`.

## Requisitos para habilitar «Anular recibo» en producción

Se necesita el código vigente del Web App / Cerebro Apps Script. La API debe:

1. Ofrecer `PREVISUALIZAR_ANULACION_RECIBO` en modo lectura con estado, relaciones, impacto en saldo y Caja; bloquear operaciones ambiguas.
2. Ofrecer `CONFIRMAR_ANULACION_RECIBO` con rol `abonos.write` o permiso de anulación más restrictivo, usuario autenticado, motivo obligatorio, revisión esperada y confirmación expresa.
3. Usar `LockService`, `requestId` idempotente persistido, comprobación de unicidad del recibo y del movimiento, actualización coordinada de `Abonos` / `Caja` / `Ordenes_Pedido`, auditoría y plan de reparación/rollback.
4. Exponer estado `ANULADO` al historial, excluir del total abonado sin ocultar la transacción, mostrar el motivo y evitar nueva anulación.
5. En la ruta de **creación** `tipo:"abono"`, serializar el cálculo/consumo de saldo y la asignación de números: detectar `requestId` existente antes de volver a escribir. Validar monto <= saldo real **dentro del mismo lock**.
6. Agregar pruebas de doble clic, dos pestañas, dos dispositivos, timeout después de persistir, solicitudes repetidas y reversión repetida.

**Despliegue:** publicar y validar la ruta de Apps Script primero, luego activar la UI de anulaciones. No publicar un botón operativo sin backend certificado.

## Estado

- ✅ Mitigación en frontend preparada en rama y pruebas de lógica del cerrojo ejecutadas.
- ⚠️ No se ha confirmado causalmente la duplicación 63/64 en la hoja operativa.
- ⚠️ Recibo 64 y Caja **no se han modificado**.
- ⚠️ No existe todavía anulación individual funcional hasta integrar y probar el backend de Apps Script.
