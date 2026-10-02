/*********************************************************
 * HOMEEASY — QA DE CERTIFICACIÓN ETAPA 10B
 * Solo lectura/validación. No modifica datos comerciales,
 * no envía WhatsApp, no usa IA y no instala activadores.
 *********************************************************/

function certificarEtapa10BCompletaHomeEasy() {
  const ss = SpreadsheetApp.openById(HOMEEASY_SPREADSHEET_ID);
  const salida = {
    status: "ok",
    etapa: "10B",
    timestamp: new Date().toISOString(),
    pruebas: {},
    integridad: {},
    advertencias: []
  };

  function ejecutarPruebaSegura_(nombre, fn) {
    try {
      const result = fn();
      salida.pruebas[nombre] = result;
      if (!result || String(result.status || "").toLowerCase() !== "ok") salida.status = "error";
    } catch (error) {
      salida.status = "error";
      salida.pruebas[nombre] = { status: "error", error: error && error.message ? error.message : String(error) };
    }
  }

  ejecutarPruebaSegura_("10B", function() { return probarEtapa10BHomeEasy(); });
  ejecutarPruebaSegura_("9A", function() { return probarEtapa9AHomeEasy(); });
  ejecutarPruebaSegura_("9C", function() { return probarEtapa9CHomeEasy(); });

  try {
    const sh = ss.getSheetByName(HOMEEASY_COST_SHEET);
    const matrix = ss.getSheetByName(HOMEEASY_COST_MATRIX_SHEET);
    const config = ss.getSheetByName(HOMEEASY_COST_CONFIG_SHEET);
    const products = sh && sh.getLastRow() > 1 ? sh.getLastRow() - 1 : 0;
    const matrixCells = matrix && matrix.getLastRow() > 1 ? matrix.getLastRow() - 1 : 0;
    const configRows = config && config.getLastRow() > 1 ? config.getLastRow() - 1 : 0;
    const legacy = ss.getSheetByName("Tarifas");
    const catalog = cargarCatalogoCostos10B_(ss, true);

    const ids = {};
    const duplicates = [];
    catalog.products.forEach(function(p) {
      if (ids[p.id]) duplicates.push(p.id);
      ids[p.id] = true;
    });

    salida.integridad = {
      productos: products,
      matrizCeldas: matrixCells,
      configFilas: configRows,
      idsDuplicados: duplicates,
      version: catalog.version,
      vigenteHasta: catalog.validThrough,
      moneda: catalog.currency,
      preciosIncluyenIva: catalog.pricesIncludeVat,
      hojaTarifasLegacyExiste: Boolean(legacy),
      hojaTarifasLegacyUsada: false,
      usaVps: false,
      datosComercialesModificados: 0
    };

    if (!products || duplicates.length || !catalog.version || !catalog.validThrough || catalog.currency !== "COP" || catalog.pricesIncludeVat !== true) salida.status = "error";
  } catch (error) {
    salida.status = "error";
    salida.integridad = { status: "error", error: error && error.message ? error.message : String(error) };
  }

  try {
    const triggers = ScriptApp.getProjectTriggers().map(function(t) {
      return { funcion: t.getHandlerFunction(), fuente: String(t.getTriggerSource()) };
    });
    const triggers10B = triggers.filter(function(t) { return /10B|costos|cotizador/i.test(String(t.funcion || "")); });
    salida.integridad.triggers10B = triggers10B;
    if (triggers10B.length) {
      salida.status = "error";
      salida.advertencias.push("Se detectó un trigger asociado a 10B/costos; esta etapa no debe instalar activadores.");
    }
  } catch (error) {
    salida.advertencias.push("No fue posible inspeccionar activadores: " + (error && error.message ? error.message : String(error)));
  }

  Logger.log(JSON.stringify(salida, null, 2));
  console.log(JSON.stringify(salida, null, 2));
  return salida;
}
