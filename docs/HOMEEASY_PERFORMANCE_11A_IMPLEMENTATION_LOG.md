# HomeEasy Performance 11A · Implementation Log

Fecha: 2026-09-04

## 11A.1 · Boot Manager inicial — IMPLEMENTADO

Commit principal: `b573ec604aa748797cdecb336c8d08646d0d866e`
PR: #20

### Decisión de producto preservada

La pantalla inicial de Hommy se mantiene como parte funcional de la experiencia. No se modificaron sus cuatro mensajes ni sus tiempos:

- 100 ms · `Hommy está despertando...`
- 1500 ms · `Limpiando sus ojitos...`
- 3000 ms · `Preparándose un café virtual...`
- 4500 ms · `Ajustando su gorra...`

El mensaje final `¡Hommy está listo!` también permanece.

### Cambio conceptual

Antes, el Index ya iniciaba `init=LOAD` y luego `EVENTOS_TODOS`, pero el splash podía cerrarse casi inmediatamente al quedar lista la autenticación. Los datos continuaban cargando detrás y la espera visual no se aprovechaba como ventana de preparación.

Ahora:

1. HomeEasy conserva la secuencia completa de Hommy.
2. El splash tiene un mínimo útil de 5.2 s para permitir completar la secuencia visual.
3. Autenticación y warm-up quedan coordinados antes del cierre visual, con failover de 9 s para evitar bloqueo indefinido.
4. `init=LOAD` y `EVENTOS_TODOS` se ejecutan en paralelo en vez de en cadena.
5. Se conservan sin cambios los contratos `CACHE_CLIENTES`, `CACHE_ORDENES` y `CACHE_EVENTOS`.
6. Se añadió deduplicación de solicitudes idénticas en vuelo.
7. Se registra metadata de frescura de la caché.
8. Tras el warm-up de datos se hace prefetch no bloqueante de `clientes.html`, `cotizacion.html`, `pedido.html`, `seguimiento.html` y `abono.html`.
9. Al volver a Home dentro de la misma sesión no se reabre el splash: si la caché está vieja se refresca en segundo plano.

### Límites conservados

- Sin cambios en Apps Script/Cerebro.
- Sin cambios en RBAC o autenticación autoritativa.
- Sin Service Worker.
- Sin polling.
- Sin escrituras automáticas.
- Sin IA masiva.
- Sin envíos WhatsApp.
- Sin cambios financieros.
- Sin cambios a PDFs.

### QA

- Stage 11A: success.
- PR Performance Audit: success.
- Post-merge Performance Audit en `main`: success.
- GitHub Pages deployment del commit: success.
- Sintaxis JS externa e inline: validada.
- Performance budgets: validados.
- 10G + 11A contracts: validados.
- Seguimiento 10B / 10D.2 / 10E / 10F: sin regresiones.

## 11A.2 · Runtime Cache compartido — CERTIFICADO EN STAGE

Rama: `performance-11a2-runtime-cache`
Commit de cableado certificado: `9d9586ebe6b0c2986d37518b9db2224f5cca1837`

### Alcance implementado

1. El Boot Manager 11A.1 permanece intacto y `homeeasy-runtime-cache.js` se monta como extensión separada.
2. `Clientes`, `Cotización` y `Pedido` cargan `Core -> Runtime -> Runtime Cache -> Page Guard`, manteniendo al Page Guard como compuerta exterior de autorización y RBAC.
3. La caché calentada durante la pantalla de Hommy puede responder de inmediato a `listaClientes=1` y al subconjunto de clientes de `init=LOAD`.
4. El Runtime conserva los dos contratos que esperan las páginas actuales: lista de objetos para Clientes y filas para Cotización/Pedido.
5. Se añadió un índice de búsqueda compartido para clientes, sin cambiar la lógica de creación, edición ni generación documental.
6. La metadata de caché queda vinculada al `uid` de la sesión HomeEasy. Una caché de otro usuario nunca se sirve y fuerza lectura en vivo.
7. La revalidación es silenciosa y deduplicada; una caché válida puede mostrarse primero y refrescarse detrás.
8. Después de una escritura explícita de cliente, la frescura del bundle se invalida para evitar reutilizar datos anteriores.

### Límites conservados

- Historial de cliente continúa live y bajo demanda.
- Guardados y escrituras continúan live y autoritativos.
- Saldos y operaciones financieras no se cachean como verdad.
- PDFs no cambian.
- Apps Script/Cerebro no cambia en esta fase.
- Hommy, sus cuatro mensajes, sus tiempos y `¡Hommy está listo!` no cambian.
- Sin SPA, Service Worker ni polling.

### QA stage 11A.2

- Cableado de páginas: success.
- Sintaxis JavaScript externa e inline: success.
- Contratos 11A.1 + 11A.2: success.
- Aislamiento de caché entre usuarios: success.
- Performance Audit + budgets: success.
- Contrato 10G: success.
- Seguimiento 10B / 10D.2 / 10E / 10F: sin regresiones.
- `diff --check`: success.

## Próxima fase propuesta

### 11A.3 · OP / Abonos / Agenda

Extender el Runtime Cache a índices ligeros de OP y Agenda. El saldo seguirá consultándose de forma autoritativa en el momento de operar y Agenda histórica continuará bajo demanda.

### 11A.5 · Cerebro indexado + sincronización incremental

Posteriormente, reducir `getDataRange().getValues()` completos mediante índices seguros `cliente/COT/OP -> fila`, versiones por dataset y respuestas delta. Los datos financieros seguirán leyéndose de forma autoritativa al momento de operar.
