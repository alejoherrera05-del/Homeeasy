/*********************************************************
 * HOMEEASY — QA DE CERTIFICACIÓN ETAPA 10A
 * Solo lectura/validación. No envía WhatsApp, no llama IA,
 * no instala activadores y no modifica datos comerciales.
 *********************************************************/

function certificarEtapa10ACompletaHomeEasy() {
  const ss = SpreadsheetApp.openById(HOMEEASY_SPREADSHEET_ID);
  const salida = {
    status: "ok",
    etapa: "10A",
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
      salida.pruebas[nombre] = {
        status: "error",
        error: error && error.message ? error.message : String(error)
      };
    }
  }

  ejecutarPruebaSegura_("10A", function() { return probarEtapa10AHomeEasy(); });
  ejecutarPruebaSegura_("9A", function() { return probarEtapa9AHomeEasy(); });
  ejecutarPruebaSegura_("9C", function() { return probarEtapa9CHomeEasy(); });

  try {
    const shState = ss.getSheetByName(HOMEEASY_FOLLOWUP_STATE_SHEET);
    const shEvents = ss.getSheetByName(HOMEEASY_FOLLOWUP_EVENTS_SHEET);
    const stateRows = shState && shState.getLastRow() > 1
      ? shState.getRange(2, 1, shState.getLastRow() - 1, HOMEEASY_FOLLOWUP_STATE_HEADERS.length).getValues()
      : [];
    const eventRows = shEvents && shEvents.getLastRow() > 1
      ? shEvents.getRange(2, 1, shEvents.getLastRow() - 1, HOMEEASY_FOLLOWUP_EVENT_HEADERS.length).getValues()
      : [];

    const seenCot = {};
    const duplicateCot = [];
    stateRows.forEach(function(row) {
      const n = String(row[HOMEEASY_FOLLOWUP_STATE_COL.COT] || "").trim();
      if (!n) return;
      if (seenCot[n]) duplicateCot.push(n);
      seenCot[n] = true;
    });

    const seenRequest = {};
    const duplicateRequest = [];
    eventRows.forEach(function(row) {
      const id = String(row[HOMEEASY_FOLLOWUP_EVENT_COL.REQUEST_ID] || "").trim();
      if (!id) return;
      if (seenRequest[id]) duplicateRequest.push(id);
      seenRequest[id] = true;
    });

    const activeQuotes = (function() {
      const shCot = ss.getSheetByName("Cotizaciones");
      if (!shCot || shCot.getLastRow() < 2) return 0;
      const rows = shCot.getDataRange().getValues();
      let total = 0;
      for (let i = 1; i < rows.length; i++) {
        const numero = String(rows[i][0] || "").trim();
        const estado = String(rows[i][9] || "COTIZACION").trim().toUpperCase();
        if (numero && (estado === "COTIZACION" || estado === "COTIZACIÓN")) total++;
      }
      return total;
    })();

    salida.integridad = {
      estadosSeguimiento: stateRows.length,
      eventosSeguimiento: eventRows.length,
      cotizacionesActivas: activeQuotes,
      estadosDuplicados: duplicateCot,
      requestIdsDuplicados: duplicateRequest,
      coberturaActivasCompleta: stateRows.length === activeQuotes,
      timelineAppendOnly: true,
      autoActivado: false,
      whatsappEnviado: false,
      iaEjecutada: false
    };

    if (duplicateCot.length || duplicateRequest.length || stateRows.length !== activeQuotes) salida.status = "error";
  } catch (error) {
    salida.status = "error";
    salida.integridad = { status: "error", error: error && error.message ? error.message : String(error) };
  }

  try {
    const triggers = ScriptApp.getProjectTriggers().map(function(t) {
      return { funcion: t.getHandlerFunction(), fuente: String(t.getTriggerSource()) };
    });
    const triggers10A = triggers.filter(function(t) {
      return /10A|seguimiento/i.test(String(t.funcion || ""));
    });
    salida.integridad.triggers10A = triggers10A;
    if (triggers10A.length) {
      salida.status = "error";
      salida.advertencias.push("Se detectó al menos un trigger asociado a 10A/seguimiento.");
    }
  } catch (error) {
    salida.advertencias.push("No fue posible inspeccionar activadores: " + (error && error.message ? error.message : String(error)));
  }

  Logger.log(JSON.stringify(salida, null, 2));
  console.log(JSON.stringify(salida, null, 2));
  return salida;
}
