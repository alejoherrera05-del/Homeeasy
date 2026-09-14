/** Correcciones de movimientos manuales. No modifica OP, Abonos ni ajustes documentales. */
var CAJA_CORRECCION_HEADERS = ["Version_Correccion", "Ultimo_Request_ID", "Huella_Solicitud", "Actualizado_En", "Actualizado_Por", "Motivo_Correccion"];

function cajaCorreccionTexto_(value) { return String(value === undefined || value === null ? "" : value).trim(); }

function cajaCorreccionHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8)
    .map(function(b) { return (b & 255).toString(16).padStart(2, "0"); }).join("");
}

function cajaCorreccionManual_(row) {
  return ["INGRESO", "GASTO", "ELIMINADO_INGRESO", "ELIMINADO_GASTO"].indexOf(cajaCorreccionTexto_(row[2])) >= 0 &&
    ![row[6], row[7], row[8]].some(function(v) { return cajaCorreccionTexto_(v) !== ""; });
}

function cajaCorreccionRevision_(row) {
  return cajaCorreccionHash_(Array.from({ length: 16 }, function(_, i) { return row[i] === undefined ? "" : row[i]; }));
}

function cajaCorreccionMovimiento_(row) {
  var tipo = cajaCorreccionTexto_(row[2]);
  var eliminado = tipo.indexOf("ELIMINADO_") === 0;
  var movimiento = tipo.replace(/^ELIMINADO_/, "");
  var fecha = new Date(row[1]).getTime();
  return {
    id: (movimiento === "GASTO" ? "GST-" : "EXT-") + row[0], cajaId: String(row[0]),
    tipo: movimiento === "GASTO" ? "OUT_GASTO" : "IN_EXTRA", movimiento: movimiento,
    titulo: movimiento === "GASTO" ? String(row[4] || "Gasto") : "Ingreso Extra",
    cat: String(row[3] || "Sin categoría") + " · " + String(row[4] || ""),
    categoria: String(row[3] || ""), descripcion: String(row[4] || ""), valor: Number(row[5] || 0),
    fecha: isNaN(fecha) ? 0 : fecha, eliminado: eliminado, manual: true,
    revision: cajaCorreccionRevision_(row), motivoCorreccion: String(row[15] || "")
  };
}

function enriquecerCajaCorrecciones_(ss, resultado) {
  var sh = ss.getSheetByName("Caja");
  var rows = sh ? sh.getDataRange().getValues() : [];
  var counts = {};
  rows.slice(1).forEach(function(row) { var id = String(row[0]); counts[id] = (counts[id] || 0) + 1; });
  var manuales = rows.slice(1).filter(function(row) {
    return cajaCorreccionTexto_(row[0]) && counts[String(row[0])] === 1 && cajaCorreccionManual_(row);
  }).map(cajaCorreccionMovimiento_);
  manuales.sort(function(a, b) { return b.fecha - a.fecha; });
  var byId = {};
  manuales.forEach(function(tx) { byId[tx.id] = tx; });
  resultado.feed = (resultado.feed || []).map(function(tx) {
    return byId[tx.id] && !byId[tx.id].eliminado ? Object.assign({}, tx, byId[tx.id]) : tx;
  });
  resultado.movimientosManuales = manuales;
  resultado.correccionesCajaVersion = 1;
  return resultado;
}

function validarEsquemaCorreccionesCaja_(sh) {
  var current = sh.getRange(1, 11, 1, CAJA_CORRECCION_HEADERS.length).getValues()[0];
  if (current.some(function(v, i) { return v !== "" && v !== CAJA_CORRECCION_HEADERS[i]; })) {
    throw new Error("Las columnas de control de Caja cambiaron. Revisa el esquema antes de corregir movimientos.");
  }
}

function corregirMovimientoCaja_(ss, data) {
  var meta = data.meta && typeof data.meta === "object" ? data.meta : {};
  var permission = validarPermisoSesionAuth9B_(ss, data.appSessionToken, meta, "caja.write");
  if (permission.response) return permission.response;
  var cajaSession = validarSesionCaja_(data.cajaSessionToken, meta, true);
  if (!cajaSession.valido) return { status: "error", requiresPin: true, msg: cajaSession.msg || "La sesión de Caja venció." };

  var accion = cajaCorreccionTexto_(data.accionCaja);
  var id = cajaCorreccionTexto_(data.id);
  var requestId = cajaCorreccionTexto_(data.requestId);
  var motivo = cajaCorreccionTexto_(data.motivo);
  function fail(code, msg) { return { status: "error", code: code, msg: msg }; }
  if (["EDITAR", "ELIMINAR", "RESTAURAR"].indexOf(accion) < 0 || !id || id.length > 80) return fail("CAJA_INVALID_REQUEST", "La acción o el movimiento no son válidos.");
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestId)) return fail("CAJA_REQUEST_ID_REQUIRED", "Falta el identificador de la solicitud. Vuelve a abrir el movimiento.");
  if (motivo.length < 3 || motivo.length > 300 || /^[=+@]/.test(motivo)) return fail("CAJA_INVALID_REASON", "Escribe un motivo de 3 a 300 caracteres.");
  var movimiento = cajaCorreccionTexto_(data.movimiento);
  var categoria = cajaCorreccionTexto_(data.categoria);
  var descripcion = cajaCorreccionTexto_(data.descripcion);
  var valor = Number(data.valor);
  if (accion === "EDITAR") {
    if (["INGRESO", "GASTO"].indexOf(movimiento) < 0 || !Number.isSafeInteger(valor) || valor <= 0) return fail("CAJA_INVALID_VALUE", "Ingresa un tipo válido y un valor entero mayor que cero.");
    if (!categoria || categoria.length > 120 || !descripcion || descripcion.length > 250 || /^[=+@]/.test(categoria) || /^[=+@]/.test(descripcion)) return fail("CAJA_INVALID_TEXT", "Revisa la categoría y la descripción del movimiento.");
  }
  var huella = cajaCorreccionHash_([id, accion, motivo, accion === "EDITAR" ? [movimiento, categoria, descripcion, valor] : null]);
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(30000); locked = true;
    var sh = ss.getSheetByName("Caja");
    if (!sh) return fail("CAJA_NOT_FOUND", "No se encontró Caja.");
    validarEsquemaCorreccionesCaja_(sh);
    var rows = sh.getDataRange().getValues();
    var matches = [];
    rows.forEach(function(row, i) { if (i > 0 && String(row[0]) === id) matches.push(i); });
    if (matches.length !== 1) return fail("CAJA_NOT_FOUND", "El movimiento no existe o su identificador está duplicado. Sincroniza Caja.");
    var rowIndex = matches[0];
    var before = Array.from({ length: 16 }, function(_, i) { return rows[rowIndex][i] === undefined ? "" : rows[rowIndex][i]; });
    if (!cajaCorreccionManual_(before)) return fail("CAJA_DOCUMENT_LINKED", "Este movimiento pertenece a un documento o ajuste. Corrígelo desde su documento de origen.");
    if (String(before[11]) === requestId) {
      if (String(before[12]) !== huella) return fail("CAJA_REQUEST_REUSED", "La solicitud ya se usó para otro cambio. Sincroniza Caja.");
      return { status: "success", id: id, accionCaja: accion, duplicate: true, movimiento: cajaCorreccionMovimiento_(before) };
    }
    if (cajaCorreccionTexto_(data.expectedRevision) !== cajaCorreccionRevision_(before)) return fail("CAJA_CONFLICT", "Este movimiento cambió desde que lo abriste. Sincroniza Caja y revisa los datos actuales.");
    var eliminado = String(before[2]).indexOf("ELIMINADO_") === 0;
    if (eliminado !== (accion === "RESTAURAR")) return fail("CAJA_INVALID_STATE", eliminado ? "El movimiento ya está eliminado. Puedes restaurarlo." : "El movimiento ya está activo.");
    var after = before.slice();
    if (accion === "EDITAR") { after[2] = movimiento; after[3] = categoria; after[4] = descripcion; after[5] = valor; }
    if (accion === "ELIMINAR") after[2] = "ELIMINADO_" + before[2];
    if (accion === "RESTAURAR") after[2] = String(before[2]).replace(/^ELIMINADO_/, "");
    var actor = permission.validation.usuario || permission.validation.perfil || {};
    var operador = String(actor.nombre || actor.email || permission.validation.uid || "Usuario autorizado");
    after[10] = (Number(before[10]) || 0) + 1;
    after[11] = requestId; after[12] = huella; after[13] = new Date(); after[14] = operador; after[15] = motivo;

    // El lock es compartido con movimientos y anulaciones. No invocar el auditor legacy,
    // que toma/libera otro lock, dentro de esta sección crítica.
    var audit = ss.getSheetByName("Auditoria");
    if (!audit || audit.getRange(1, 1, 1, HOMEEASY_AUDIT_HEADERS.length).getValues()[0].join("|") !== HOMEEASY_AUDIT_HEADERS.join("|")) return fail("CAJA_AUDIT_UNAVAILABLE", "No se puede guardar sin el historial de auditoría. Revisa Auditoría e intenta de nuevo.");
    sh.getRange(1, 11, 1, CAJA_CORRECCION_HEADERS.length).setValues([CAJA_CORRECCION_HEADERS]);
    var auditId = "AUD-CAJA-" + Utilities.getUuid();
    var beforeSnapshot = cajaCorreccionMovimiento_(before);
    var afterSnapshot = cajaCorreccionMovimiento_(after);
    var auditRow = audit.getLastRow() + 1;
    audit.appendRow([
      auditId, new Date(), operador, meta.dispositivoId || "SIN_ID", meta.dispositivoNombre || "", meta.plataforma || "", meta.navegador || "", "caja.html",
      "Caja", accion + " MOVIMIENTO", "CAJA", id, accion + " movimiento manual #" + id + ": " + motivo, "PENDIENTE", requestId,
      JSON.stringify({ accion: accion, motivo: motivo }), "caja-correcciones-1", JSON.stringify(beforeSnapshot), JSON.stringify(afterSnapshot),
      JSON.stringify(calcularCambiosAuditoria_(beforeSnapshot, afterSnapshot)), "", "SI", "", JSON.stringify({ afectaCaja: true, movimientoManual: true }), "NO", "", "", ""
    ]);
    try {
      sh.getRange(rowIndex + 1, 3, 1, 4).setValues([after.slice(2, 6)]);
      sh.getRange(rowIndex + 1, 11, 1, 6).setValues([after.slice(10, 16)]);
      SpreadsheetApp.flush();
      audit.getRange(auditRow, 14).setValue("EXITOSO");
      SpreadsheetApp.flush();
    } catch (writeError) {
      sh.getRange(rowIndex + 1, 3, 1, 4).setValues([before.slice(2, 6)]);
      sh.getRange(rowIndex + 1, 11, 1, 6).setValues([before.slice(10, 16)]);
      audit.getRange(auditRow, 14).setValue("FALLIDO");
      audit.getRange(auditRow, 21).setValue(String(writeError));
      SpreadsheetApp.flush();
      throw writeError;
    }
    return { status: "success", id: id, accionCaja: accion, auditoriaId: auditId, movimiento: afterSnapshot };
  } catch (error) {
    return fail("CAJA_CORRECTION_FAILED", "No se pudo confirmar el cambio. Sincroniza Caja antes de reintentar. " + String(error.message || error));
  } finally { if (locked) lock.releaseLock(); }
}
