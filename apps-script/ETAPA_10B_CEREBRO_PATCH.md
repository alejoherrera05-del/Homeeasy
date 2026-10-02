# HomeEasy · Patch de integración del Cerebro para Etapa 10B

Este parche acompaña `apps-script/ETAPA_10B_COSTOS_PENTAGRAMA.gs` y `apps-script/ETAPA_10B_CERTIFICACION_QA.gs`.

La Etapa 10B usa Apps Script + Google Sheets. No usa el VPS de WhatsApp y no usa la hoja legacy `Tarifas`.

## 1. Añadir rutas POST al mapa RBAC

Dentro de `HOMEEASY_AUTH_POST_PERMISSIONS`, junto a las rutas de cotizaciones, agregar:

```js
  COSTOS_ESTADO: "cotizaciones.write",
  COSTOS_OPCIONES: "cotizaciones.write",
  COSTOS_CALCULAR_COTIZACION: "cotizaciones.write",
```

## 2. Enrutar 10B dentro de doPost

Después de `autorizarEscrituraAuth9B_(ss, data)` y antes de las rutas administrativas, agregar:

```js
    // ETAPA 10B · Costos Pentagrama / Cotizador interno.
    const respuestaCostos10B = typeof procesarRutaCostos10B_ === "function"
      ? procesarRutaCostos10B_(ss, data)
      : null;
    if (respuestaCostos10B) return json_(respuestaCostos10B);
```

Puede ir antes o después del bloque 10A. Las rutas 10B vuelven a validar sesión + permiso internamente.

## 3. Actualizar la lista expectedPost de probarEtapa9AHomeEasy

Agregar:

```js
"COSTOS_ESTADO", "COSTOS_OPCIONES", "COSTOS_CALCULAR_COTIZACION",
```

Esto evita que 9A marque las nuevas rutas como extra.

## 4. Actualizar expectedPost de probarEtapa9CHomeEasy

Agregar las mismas tres rutas a `expectedPost`.

## 5. Añadir archivos al proyecto Apps Script

Crear dos archivos nuevos en **Cerebro HomeEasy** y pegar su contenido completo:

- `ETAPA_10B_COSTOS_PENTAGRAMA.gs`
- `ETAPA_10B_CERTIFICACION_QA.gs`

## 6. Orden seguro de activación

1. Guardar los cambios.
2. Ejecutar `instalarEtapa10BHomeEasy()`.
3. Confirmar que reporte 168 productos y 156 celdas de matriz.
4. Ejecutar `probarEtapa10BHomeEasy()`.
5. Ejecutar `certificarEtapa10BCompletaHomeEasy()`.
6. Solo si todo queda en `status: "ok"`, implementar una nueva versión del Web App de Apps Script.
7. Después probar el frontend del cotizador.

## Contrato

- Fuente: `Costos_Pentagrama`, `Costos_Pentagrama_Matrices`, `Costos_Pentagrama_Config`.
- La hoja `Tarifas` no participa.
- El VPS/WAHA no participa.
- No se modifica ninguna fila de Clientes, Cotizaciones, Ordenes_Pedido, Abonos o Caja.
- El navegador recibe opciones de catálogo, pero no recibe la tabla completa de costos.
