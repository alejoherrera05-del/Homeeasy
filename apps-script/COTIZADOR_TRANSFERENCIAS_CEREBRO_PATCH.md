# HomeEasy · Integración del Cerebro para transferencias del Cotizador

Este parche acompaña `apps-script/COTIZADOR_TRANSFERENCIAS.gs` y mantiene el patrón actual del Cerebro HomeEasy: autorización general 9B, revalidación interna de sesión/RBAC y respuesta con `json_`.

## 1. Añadir rutas POST al mapa RBAC

Dentro de `HOMEEASY_AUTH_POST_PERMISSIONS`, junto a las rutas del cotizador, agregar:

```js
  COTIZADOR_TRANSFERENCIA_CREAR: "cotizaciones.write",
  COTIZADOR_TRANSFERENCIA_PREVIEW: "cotizaciones.write",
  COTIZADOR_TRANSFERENCIA_CONSUMIR: "cotizaciones.write",
```

## 2. Enrutar dentro de `doPost`

Después de `autorizarEscrituraAuth9B_(ss, data)` y junto a los routers 10A/10B, agregar:

```js
    // Transferencias temporales del levantamiento técnico del Cotizador.
    const respuestaCotizadorTransferencias = typeof procesarRutaCotizadorTransferencias_ === "function"
      ? procesarRutaCotizadorTransferencias_(ss, data)
      : null;
    if (respuestaCotizadorTransferencias) return json_(respuestaCotizadorTransferencias);
```

## 3. Mantener sincronizadas las certificaciones 9A y 9C

Agregar a cada `expectedPost`:

```js
"COTIZADOR_TRANSFERENCIA_CREAR",
"COTIZADOR_TRANSFERENCIA_PREVIEW",
"COTIZADOR_TRANSFERENCIA_CONSUMIR",
```

## 4. Añadir archivos al proyecto Apps Script

Crear en **Cerebro HomeEasy**:

- `COTIZADOR_TRANSFERENCIAS.gs`
- `COTIZADOR_TRANSFERENCIAS_QA.gs`

No se requiere instalador ni trigger. La hoja `Cotizador_Transferencias` se crea de forma segura en la primera operación autenticada.

## 5. Activación

1. Guardar el proyecto Apps Script.
2. Ejecutar `certificarCotizadorTransferenciasHomeEasy()` una sola vez.
3. Si devuelve `status: "ok"`, publicar una nueva versión del Web App existente.

No modificar la URL ni crear otro Web App.
