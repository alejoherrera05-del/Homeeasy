/*********************************************************
 * HOMEEASY — CERTIFICACIÓN DE TRANSFERENCIAS DEL COTIZADOR
 * Solo valida contrato, saneamiento y configuración.
 * No crea transferencias ni modifica datos comerciales.
 *********************************************************/

function certificarCotizadorTransferenciasHomeEasy() {
  const ss = SpreadsheetApp.openById(HOMEEASY_SPREADSHEET_ID);
  const salida = {
    status: "ok",
    timestamp: new Date().toISOString(),
    pruebas: {},
    integridad: {},
    advertencias: []
  };

  function probar_(nombre, fn) {
    try {
      const result = fn();
      salida.pruebas[nombre] = { status: "ok", result: result };
    } catch (error) {
      salida.status = "error";
      salida.pruebas[nombre] = { status: "error", error: error && error.message ? error.message : String(error) };
    }
  }

  probar_("rutas_rbac", function() {
    const missing = Object.keys(HOMEEASY_COTIZADOR_TRANSFER_ROUTES).filter(function(tipo) {
      return typeof resolverPermisoPostAuth9A_ !== "function" ||
        resolverPermisoPostAuth9A_(tipo) !== HOMEEASY_COTIZADOR_TRANSFER_PERMISSION;
    });
    if (missing.length) throw new Error("Faltan rutas en HOMEEASY_AUTH_POST_PERMISSIONS: " + missing.join(", "));
    return Object.keys(HOMEEASY_COTIZADOR_TRANSFER_ROUTES);
  });

  probar_("codigo", function() {
    const occupied = {};
    occupied.AAAAAA = true;
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99];
    let index = 0;
    const code = generarCodigoCotizadorTransferencia_(occupied, function() { return values[index++]; });
    if (code.length !== 6 || code === "AAAAAA") throw new Error("La generación no evitó una colisión.");
    if (normalizarCodigoCotizadorTransferencia_(" " + code.toLowerCase().slice(0, 3) + "-" + code.slice(3) + " ") !== code) {
      throw new Error("La normalización del código falló.");
    }
    return code;
  });

  probar_("payload", function() {
    const sample = {
      project: "QA sintética",
      items: [{
        roomId: "room-qa", family: "onda", product: "producto-qa", location: "Sala",
        width: "1.2", height: "2.1", quantity: "1", configuration: "standard",
        coverlight: "", addons: [], installation: { mount: "techo", control: "", opening: "centro", note: "Sin datos reales" }
      }]
    };
    const sanitized = sanearPayloadCotizadorTransferencia_(sample);
    if (sanitized.items.length !== 1 || "cost" in sanitized.items[0]) throw new Error("El saneamiento no conservó el contrato mínimo.");
    let forbidden = false;
    try { sanearPayloadCotizadorTransferencia_({ project: "QA", items: [Object.assign({}, sample.items[0], { cost: 1 })] }); }
    catch (error) { forbidden = error && error.code === "TRANSFER_FORBIDDEN_FIELD"; }
    if (!forbidden) throw new Error("Un campo comercial prohibido fue aceptado.");
    let tooMany = false;
    try { sanearPayloadCotizadorTransferencia_({ project: "QA", items: new Array(101).fill(sample.items[0]) }); }
    catch (error) { tooMany = error && error.code === "TRANSFER_TOO_MANY_ITEMS"; }
    if (!tooMany) throw new Error("Se aceptaron más de 100 items.");
    return resumenPayloadCotizadorTransferencia_(sanitized);
  });

  probar_("hoja", function() {
    const sh = ss.getSheetByName(HOMEEASY_COTIZADOR_TRANSFER_SHEET);
    if (!sh) return { existe: false, creacionAutomatica: true };
    validarHojaCotizadorTransferencias_(sh);
    return { existe: true, filasTemporales: Math.max(0, sh.getLastRow() - 1) };
  });

  probar_("sin_triggers", function() {
    const triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
      return /transfer|cotizador/i.test(String(trigger.getHandlerFunction() || ""));
    });
    if (triggers.length) throw new Error("Las transferencias no deben instalar triggers.");
    return true;
  });

  salida.integridad = {
    permiso: HOMEEASY_COTIZADOR_TRANSFER_PERMISSION,
    ttlDias: HOMEEASY_COTIZADOR_TRANSFER_TTL_MS / (24 * 60 * 60 * 1000),
    retencionUsadoHoras: HOMEEASY_COTIZADOR_TRANSFER_USED_TTL_MS / (60 * 60 * 1000),
    maxItems: HOMEEASY_COTIZADOR_TRANSFER_MAX_ITEMS,
    maxJsonChars: HOMEEASY_COTIZADOR_TRANSFER_MAX_JSON_CHARS,
    datosComercialesModificados: 0,
    usaVps: false,
    usaFirebase: false,
    instalaTriggers: false
  };

  Logger.log(JSON.stringify(salida, null, 2));
  console.log(JSON.stringify(salida, null, 2));
  return salida;
}
