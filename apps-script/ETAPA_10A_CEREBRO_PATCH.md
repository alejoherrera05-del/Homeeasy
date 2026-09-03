# HomeEasy · Patch de integración del Cerebro para Etapa 10A

Este parche acompaña `apps-script/ETAPA_10A_SEGUIMIENTO_IA.gs`.

No reemplaza el Cerebro completo. Son cambios mínimos y localizados.

## 1. Mapear las cuatro rutas POST en RBAC

Dentro de `HOMEEASY_AUTH_POST_PERMISSIONS`, junto a `actualizar_seguimiento`, agregar:

```js
  GET_SEGUIMIENTO_INTELIGENTE: "cotizaciones.read",
  GET_SEGUIMIENTO_DETALLE: "cotizaciones.read",
  ACTUALIZAR_ESTADO_SEGUIMIENTO_IA: "cotizaciones.write",
  REGISTRAR_EVENTO_SEGUIMIENTO: "cotizaciones.write",
```

Las rutas 10A además vuelven a validar la sesión internamente, por lo que permanecen protegidas incluso si el enforcement general estuviera temporalmente en `PREPARACION`.

---

## 2. Conectar el router 10A dentro de `doPost`

Buscar este bloque:

```js
    const bloqueoPostAuth9B = autorizarEscrituraAuth9B_(ss, data);
    if (bloqueoPostAuth9B) return json_(bloqueoPostAuth9B);
```

Inmediatamente después agregar:

```js
    // ETAPA 10A · Seguimiento inteligente protegido.
    // Las propias rutas 10A vuelven a validar sesión + permiso aun si 9B/9C está en PREPARACION.
    const respuestaSeguimiento10A = typeof procesarRutaSeguimiento10A_ === "function"
      ? procesarRutaSeguimiento10A_(ss, data)
      : null;
    if (respuestaSeguimiento10A) return json_(respuestaSeguimiento10A);
```

---

## 3. Sincronizar la ruta manual existente `actualizar_seguimiento`

En `doPostOperacion_`, dentro de:

```js
if (data.tipo === "actualizar_seguimiento") {
```

justo antes de:

```js
return json_({ status: "success" });
```

agregar:

```js
          // 10A: conserva la nota humana en Cotizaciones y además la refleja en el timeline.
          try {
            if (typeof sincronizarSeguimientoLegacy10A_ === "function") {
              sincronizarSeguimientoLegacy10A_(ss, data);
            }
          } catch (followupError) {
            console.error("La cotización se actualizó, pero 10A no pudo sincronizar el timeline: " + followupError);
          }
```

Este hook nunca debe bloquear la operación legacy.

---

## 4. Inicializar memoria cuando nace una cotización nueva

En la ruta `if (data.tipo === "cotizacion")`, después de crear la fila y registrar la versión documental, pero antes del `return` exitoso, agregar:

```js
        try {
          if (typeof inicializarCotizacionSeguimiento10A_ === "function") {
            const meta10A = data.meta || {};
            inicializarCotizacionSeguimiento10A_(ss, {
              numero: numero,
              actor: meta10A.operador || "SISTEMA",
              requestId: (data.requestId || Utilities.getUuid()) + ":FOLLOWUP"
            });
          }
        } catch (followupError) {
          console.error("Cotización creada; 10A no pudo inicializar su memoria: " + followupError);
        }
```

---

## 5. Cerrar automáticamente seguimiento al convertir una cotización en OP

En la ruta `if (data.tipo === "pedido")`, dentro del bloque:

```js
if (data.numeroCotizacion) {
```

inmediatamente después de:

```js
shCot.getRange(i + 1, 10).setValue(`CONVERTIDA A OP N° ${nextOP}`);
```

agregar:

```js
              try {
                if (typeof cerrarSeguimientoCotizacion10A_ === "function") {
                  const meta10A = data.meta || {};
                  cerrarSeguimientoCotizacion10A_(ss, data.numeroCotizacion, "CONVERTED", {
                    actor: meta10A.operador || "SISTEMA",
                    requestId: (data.requestId || Utilities.getUuid()) + ":FOLLOWUP_CONVERTED",
                    motivo: "Cotización convertida a OP-" + nextOP + "."
                  });
                }
              } catch (followupError) {
                console.error("OP creada; 10A no pudo cerrar el seguimiento de la cotización origen: " + followupError);
              }
```

---

## 6. Actualizar la prueba 9A

En `probarEtapa9AHomeEasy()`, dentro del array `expectedPost`, agregar estas cuatro cadenas:

```js
"GET_SEGUIMIENTO_INTELIGENTE",
"GET_SEGUIMIENTO_DETALLE",
"ACTUALIZAR_ESTADO_SEGUIMIENTO_IA",
"REGISTRAR_EVENTO_SEGUIMIENTO",
```

Sin esto, 9A marcará las rutas nuevas como extras aunque estén correctamente protegidas.

---

## 7. Actualizar la prueba 9C

En `probarEtapa9CHomeEasy()`, dentro de `expectedPost`, agregar las mismas cuatro rutas:

```js
"GET_SEGUIMIENTO_INTELIGENTE",
"GET_SEGUIMIENTO_DETALLE",
"ACTUALIZAR_ESTADO_SEGUIMIENTO_IA",
"REGISTRAR_EVENTO_SEGUIMIENTO",
```

---

# Orden de instalación seguro

1. Crear en Apps Script un archivo nuevo: `ETAPA_10A_SEGUIMIENTO_IA`.
2. Pegar allí el contenido completo de `ETAPA_10A_SEGUIMIENTO_IA.gs`.
3. Aplicar los 7 cambios mínimos de este parche al archivo principal del Cerebro.
4. Guardar el proyecto.
5. **No implementar todavía una nueva versión web.**
6. Ejecutar manualmente `instalarEtapa10AHomeEasy`.
7. Revisar el resultado del registro de ejecución.
8. Ejecutar `probarEtapa10AHomeEasy`.
9. Solo si devuelve `status: "ok"`, ejecutar de nuevo `probarEtapa9AHomeEasy` y `probarEtapa9CHomeEasy`.
10. Verificar que `Cotizaciones`, `Ordenes_Pedido`, `Abonos`, `Caja` y `Agenda` no cambiaron en cantidad de filas.
11. Después de esa certificación se prepara el despliegue del web app y la interfaz 10C.

## Resultado esperado de `instalarEtapa10AHomeEasy`

Debe informar, entre otros:

```text
status: ok
etapa: 10A
modoInicial: REVIEW
autoActivado: false
whatsappEnviado: false
iaEjecutada: false
hojasComercialesModificadas: 0
```

## Resultado esperado de `probarEtapa10AHomeEasy`

Debe informar:

```text
status: ok
headersEstado: ok
headersEventos: ok
timelineAppendOnly: true
concurrenciaOptimista: true
requestIdIdempotente: true
autoActivado: false
whatsappEnviado: false
iaEjecutada: false
hojasComercialesModificadas: 0
```

## Qué NO hace 10A

- No llama a Hommy AI.
- No envía WhatsApp.
- No instala triggers.
- No activa `AUTO`.
- No cambia precios, cotizaciones ni PDF.
- No elimina datos.

10A solamente instala la memoria comercial segura sobre la cual se construirá Hommy Analista en 10B.
