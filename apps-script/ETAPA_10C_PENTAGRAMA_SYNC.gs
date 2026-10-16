/*********************************************************
 * HOMEEASY — ETAPA 10C
 * PENTAGRAMA SYNC TRANSACCIONAL
 *********************************************************/

const HOMEEASY_SYNC_SNAPSHOT_SHEET = "Costos_Pentagrama_Snapshots";
const HOMEEASY_SYNC_HISTORY_SHEET = "Costos_Pentagrama_Sync_Historial";
const HOMEEASY_SYNC_SNAPSHOT_V2_SHEET = "Costos_Pentagrama_Snapshots_V2";
const HOMEEASY_SYNC_SNAPSHOT_HEADERS = Object.freeze(["Snapshot_ID", "Historial_ID", "Scan_ID", "Fila", "Producto_ID", "Antes_JSON", "Creado_En"]);
const HOMEEASY_SYNC_HISTORY_HEADERS = Object.freeze(["Historial_ID", "Tipo", "Scan_ID", "Estado", "Cambios", "Creado_En", "Operador", "QA_JSON", "Error", "Revertido_Por"]);
const HOMEEASY_SYNC_SNAPSHOT_V2_HEADERS = Object.freeze(["Snapshot_ID", "Historial_ID", "Scan_ID", "Hoja", "Fila", "Clave", "Antes_JSON", "Existia", "Creado_En", "Tipo"]);

function procesarRutaPentagramaSync10C_(ss, data, authValidation) {
  const tipo = String(data && data.tipo || "");
  if (tipo === "COSTOS_SYNC_READ") return leerCatalogoPentagramaSync10C_(ss);
  if (tipo === "COSTOS_SYNC_HISTORY") return leerHistorialPentagramaSync10C_(ss);
  if (tipo === "COSTOS_SYNC_APPLY") return aplicarPentagramaSync10C_(ss, data, authValidation);
  if (tipo === "COSTOS_SYNC_ROLLBACK") return revertirPentagramaSync10C_(ss, data, authValidation);
  return { status: "error", code: "PENTAGRAMA_SYNC_ROUTE_NOT_FOUND", msg: "Ruta de sincronización desconocida." };
}

function leerCatalogoPentagramaSync10C_(ss) {
  const sheet = ss.getSheetByName(HOMEEASY_COST_SHEET);
  const values = sheet.getDataRange().getValues();
  const rowsById = {};
  for (let i = 1; i < values.length; i++) {
    const id = String(values[i][0] || "").trim();
    if (!id) continue;
    rowsById[id] = { row: i + 1, values: values[i] };
  }

  // Usa el mismo catálogo efectivo del cotizador. Así la sincronización ve también
  // productos certificados que hoy viven fuera de la Sheet (por ejemplo Ring)
  // y recibe su identidad técnica Pentagrama sin exponer reglas sensibles al navegador.
  const catalog = cargarCatalogoCostos10B_(ss, false);
  const products = (catalog.products || []).map(function(product) {
    const stored = rowsById[String(product.id)] || null;
    const row = stored && stored.values;
    const rules = product.rules && typeof product.rules === "object" ? product.rules : {};
    return {
      row: stored ? stored.row : null,
      storage: stored ? "SHEET" : "CERTIFIED_EMBEDDED",
      id: String(product.id),
      family: String(product.family || ""),
      familyName: String(product.familyName || ""),
      reference: String(product.name || ""),
      type: String(product.type || ""),
      method: String(product.method || ""),
      rate: stored ? Number(row[6] || 0) : Number(product.rateCents || 0) / 100,
      minHeight: stored ? Number(row[7] || 0) : Number(product.minHeightMm || 0) / 1000,
      minArea: stored ? Number(row[8] || 0) : Number(product.minAreaMm2 || 0) / 1000000,
      extraDiscount: stored ? Number(row[9] || 0) : Number(product.extraDiscount || 0),
      promotional: stored ? String(row[10]).toUpperCase() === "TRUE" : Boolean(product.promotional),
      configuration: String(product.configuration || ""),
      active: Boolean(product.active),
      status: String(product.status || ""),
      destination: stored ? { sheet: HOMEEASY_COST_SHEET, row: stored.row, field: "Tarifa_IVA_COP" } : null,
      updatedAt: stored && row[19] instanceof Date ? row[19].toISOString() : stored ? String(row[19] || "") : "",
      rules: rules,
      pricesIncludeVat: product.pricesIncludeVat === true,
      currency: String(product.currency || "COP"),
      validThrough: String(product.validThrough || catalog.validThrough || ""),
      external: {
        productCode: String(rules.productCode || ""),
        groupCode: String(rules.groupCode || ""),
        associationGroup: String(rules.associationGroup || ""),
        primaryGroup: String(rules.primaryGroup || ""),
        calculationType: String(rules.calculationType || ""),
        unit: String(rules.unit || ""),
        source: String(rules.source || ""),
        sourceSha256: String(rules.sourceSha256 || "")
      }
    };
  });
  return {
    status: "ok",
    version: catalog.version,
    validThrough: catalog.validThrough,
    products: products,
    config: catalog.config || {},
    enrollableSizeRules: catalog.enrollableSizeRules || {}
  };
}

function aplicarPentagramaSync10C_(ss, data, authValidation) {
  if (data && data.modelCandidate) return aplicarModeloLocalPentagramaSync10C_(ss, data, authValidation);
  if (data && Array.isArray(data.catalogMutations) && data.catalogMutations.length) {
    return aplicarCambiosCatalogoPentagramaSync10C_(ss, data, authValidation);
  }
  const scanId = String(data && data.scanId || "").trim();
  const scannedAt = new Date(String(data && data.scannedAt || ""));
  const changes = Array.isArray(data && data.changes) ? data.changes : [];
  if (!scanId || isNaN(scannedAt.getTime()) || Date.now() - scannedAt.getTime() > 30 * 60 * 1000) return { status: "error", code: "PENTAGRAMA_SCAN_EXPIRED", msg: "El escaneo no existe o expiró." };
  if (!changes.length) return { status: "error", code: "PENTAGRAMA_NO_CHANGES", msg: "No hay cambios para aplicar." };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: "error", code: "PENTAGRAMA_SYNC_BUSY", msg: "HomeEasy está ocupado por otra operación. No se modificaron datos." };
  const historyId = Utilities.getUuid(); const snapshotId = Utilities.getUuid();
  const sheet = ss.getSheetByName(HOMEEASY_COST_SHEET);
  const snapshotSheet = asegurarHojaSync10C_(ss, HOMEEASY_SYNC_SNAPSHOT_SHEET, HOMEEASY_SYNC_SNAPSHOT_HEADERS);
  const historySheet = asegurarHojaSync10C_(ss, HOMEEASY_SYNC_HISTORY_SHEET, HOMEEASY_SYNC_HISTORY_HEADERS);
  const snapshots = [];
  try {
    const seen = {};
    changes.forEach(function(change) {
      const row = Number(change.row); if (!Number.isInteger(row) || row < 2 || row > sheet.getLastRow() || seen[row]) throw new Error("Fila inválida o duplicada: " + row);
      seen[row] = true;
      const before = sheet.getRange(row, 1, 1, HOMEEASY_COST_HEADERS.length).getValues()[0];
      if (String(before[0]) !== String(change.homeeasyId)) throw new Error("El producto cambió de fila: " + change.homeeasyId);
      if (Math.abs(Number(before[6]) - Number(change.expectedRate)) > 0.005) throw new Error("La tarifa cambió después del escaneo: " + change.homeeasyId);
      if (String(change.strategy) !== "RATE_M2") throw new Error("Estrategia no habilitada para escritura automática: " + change.homeeasyId);
      const destination = change.destination || {};
      if (String(destination.sheet) !== HOMEEASY_COST_SHEET || String(destination.field) !== "Tarifa_IVA_COP") throw new Error("Destino de tarifa no autorizado: " + change.homeeasyId);
      if (!Array.isArray(change.qaCases) || change.qaCases.length < 2) throw new Error("Evidencia QA insuficiente: " + change.homeeasyId);
      if (!isFinite(Number(change.proposedRate)) || Number(change.proposedRate) <= 0) throw new Error("Tarifa propuesta inválida: " + change.homeeasyId);
      snapshots.push({ row: row, productId: String(before[0]), values: before, change: change });
    });
    snapshotSheet.getRange(snapshotSheet.getLastRow() + 1, 1, snapshots.length, HOMEEASY_SYNC_SNAPSHOT_HEADERS.length).setValues(snapshots.map(function(item) {
      return [snapshotId, historyId, scanId, item.row, item.productId, JSON.stringify(item.values), new Date()];
    }));
    snapshots.forEach(function(item) {
      const rowValues = item.values.slice();
      rowValues[6] = Number(item.change.proposedRate); rowValues[18] = "Pentagrama Sync"; rowValues[19] = new Date();
      rowValues[20] = "Actualizado por Pentagrama Sync. Scan " + scanId;
      sheet.getRange(item.row, 1, 1, HOMEEASY_COST_HEADERS.length).setValues([rowValues]);
    });
    SpreadsheetApp.flush(); borrarCacheCostos10B_();
    const qa = ejecutarQaPentagramaSync10C_(ss, snapshots);
    if (!qa.ok) throw new Error("QA posterior falló: " + qa.errors.join("; "));
    historySheet.appendRow([historyId, "APPLY", scanId, "APLICADO", snapshots.length, new Date(), operadorSync10C_(authValidation), JSON.stringify(qa), "", ""]);
    return { status: "ok", historyId: historyId, snapshotId: snapshotId, changed: snapshots.length, qa: qa };
  } catch (error) {
    snapshots.forEach(function(item) { sheet.getRange(item.row, 1, 1, HOMEEASY_COST_HEADERS.length).setValues([item.values]); });
    SpreadsheetApp.flush(); borrarCacheCostos10B_();
    historySheet.appendRow([historyId, "APPLY", scanId, "REVERTIDO_AUTOMATICO", snapshots.length, new Date(), operadorSync10C_(authValidation), "", String(error), ""]);
    return { status: "error", code: "PENTAGRAMA_APPLY_ROLLED_BACK", msg: "No se aplicó ningún cambio; se restauró el snapshot.", error: String(error) };
  } finally { lock.releaseLock(); }
}

function claveExternaReglasSync10C_(rules) {
  const value = rules && typeof rules === "object" ? rules : {};
  function code_(input) { return String(input || "").trim().toUpperCase(); }
  if (!code_(value.productCode)) return "";
  return [code_(value.productCode), code_(value.groupCode), code_(value.associationGroup)].join("|");
}

function aplicarModeloLocalPentagramaSync10C_(ss, data, authValidation) {
  const scanId = String(data && data.scanId || "").trim();
  const scannedAt = new Date(String(data && data.scannedAt || ""));
  const candidate = data && data.modelCandidate;
  if (!scanId || isNaN(scannedAt.getTime()) || Date.now() - scannedAt.getTime() > 30 * 60 * 1000) return { status: "error", code: "PENTAGRAMA_SCAN_EXPIRED", msg: "El escaneo no existe o expiró." };
  if (!candidate || Number(candidate.schemaVersion) !== 1 || String(candidate.mode) !== "ENROLLABLES_LOCAL_FIRST") return { status: "error", code: "PENTAGRAMA_LOCAL_MODEL_INVALID", msg: "El candidato local no es válido." };
  if (!Array.isArray(candidate.products) || candidate.products.length !== 279 || !Array.isArray(candidate.qaCases) || !candidate.qaCases.length) return { status: "error", code: "PENTAGRAMA_LOCAL_MODEL_INCOMPLETE", msg: "El candidato no cubre los 279 Enrollables o no contiene QA." };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: "error", code: "PENTAGRAMA_SYNC_BUSY", msg: "HomeEasy está ocupado por otra operación. No se modificaron datos." };
  const historyId = Utilities.getUuid(); const snapshotId = Utilities.getUuid();
  const historySheet = asegurarHojaSync10C_(ss, HOMEEASY_SYNC_HISTORY_SHEET, HOMEEASY_SYNC_HISTORY_HEADERS);
  const snapshotSheet = asegurarHojaSync10C_(ss, HOMEEASY_SYNC_SNAPSHOT_V2_SHEET, HOMEEASY_SYNC_SNAPSHOT_V2_HEADERS);
  const snapshots = []; const writes = [];
  try {
    if (String(candidate.sourceVersion || "") !== String(cargarCatalogoCostos10B_(ss, true).version || "")) throw new Error("La versión local cambió después del escaneo.");
    const productSheet = ss.getSheetByName(HOMEEASY_COST_SHEET);
    const matrixSheet = ss.getSheetByName(HOMEEASY_COST_MATRIX_SHEET);
    const configSheet = ss.getSheetByName(HOMEEASY_COST_CONFIG_SHEET);
    if (!productSheet || !matrixSheet || !configSheet) throw new Error("Faltan hojas de Costos Pentagrama.");
    const allProductPatches = candidate.products.concat(Array.isArray(candidate.complements) ? candidate.complements : []);
    const productRows = indiceFilasSync10C_(productSheet, 0); let nextProductRow = productSheet.getLastRow() + 1;
    allProductPatches.forEach(function(patch) {
      const id = String(patch.homeeasyId || ""); if (!id) throw new Error("Producto candidato sin ID.");
      let row = productRows[id] || 0; const existed = Boolean(row);
      if (!row && String(patch.family) !== "complemento-enrollable") throw new Error("No existe el producto local " + id);
      if (!row) row = nextProductRow++;
      const before = existed ? productSheet.getRange(row, 1, 1, HOMEEASY_COST_HEADERS.length).getValues()[0] : [];
      if (existed && Math.abs(Number(before[6]) - Number(patch.expectedRate)) > 0.005) throw new Error("La tarifa cambió después del escaneo: " + id);
      if (existed && hashObjetoSync10C_(leerReglasCostos10B_(before[20])) !== String(patch.expectedRulesHash || "")) throw new Error("Las reglas cambiaron después del escaneo: " + id);
      snapshots.push(snapshotV2Sync10C_(snapshotId, historyId, scanId, HOMEEASY_COST_SHEET, row, id, before, existed, "PRODUCT"));
      const values = existed ? before.slice() : filaComplementoSync10C_(patch, candidate);
      values[5] = String(patch.method || values[5] || "area"); values[6] = Number(patch.proposedRate);
      values[13] = "VIGENTE"; values[15] = String(candidate.version); values[16] = "COP"; values[17] = true;
      values[18] = "Pentagrama Live"; values[19] = new Date(); values[20] = JSON.stringify(patch.rules || {});
      writes.push({ sheet: productSheet, row: row, values: values }); productRows[id] = row;
    });
    (candidate.matrices || []).forEach(function(patch) {
      const row = Number(patch.row); if (!Number.isInteger(row) || row < 2) throw new Error("Fila de matriz inválida.");
      const existed = row <= matrixSheet.getLastRow(); const before = existed ? matrixSheet.getRange(row, 1, 1, HOMEEASY_COST_MATRIX_HEADERS.length).getValues()[0] : [];
      snapshots.push(snapshotV2Sync10C_(snapshotId, historyId, scanId, HOMEEASY_COST_MATRIX_SHEET, row, String(patch.key || row), before, existed, "MATRIX"));
      if (!Array.isArray(patch.values) || patch.values.length !== HOMEEASY_COST_MATRIX_HEADERS.length) throw new Error("Celda de matriz inválida.");
      writes.push({ sheet: matrixSheet, row: row, values: patch.values });
    });
    const configRows = indiceFilasSync10C_(configSheet, 0); let nextConfigRow = configSheet.getLastRow() + 1;
    (candidate.config || []).forEach(function(patch) {
      const key = String(patch.key || ""); let row = configRows[key] || 0; const existed = Boolean(row);
      if (!row) row = nextConfigRow++;
      const before = existed ? configSheet.getRange(row, 1, 1, HOMEEASY_COST_CONFIG_HEADERS.length).getValues()[0] : [];
      if (existed && String(before[1] || "") !== String(patch.expectedValue || "")) throw new Error("La configuración cambió después del escaneo: " + key);
      snapshots.push(snapshotV2Sync10C_(snapshotId, historyId, scanId, HOMEEASY_COST_CONFIG_SHEET, row, key, before, existed, "CONFIG"));
      writes.push({ sheet: configSheet, row: row, values: [key, patch.value, "Actualizado atómicamente desde Pentagrama Live"] }); configRows[key] = row;
    });
    snapshotSheet.getRange(snapshotSheet.getLastRow() + 1, 1, snapshots.length, HOMEEASY_SYNC_SNAPSHOT_V2_HEADERS.length).setValues(snapshots);
    writes.forEach(function(write) { write.sheet.getRange(write.row, 1, 1, write.values.length).setValues([write.values]); });
    SpreadsheetApp.flush(); borrarCacheCostos10B_();
    const qa = ejecutarQaModeloLocalPentagramaSync10C_(ss, candidate.qaCases);
    if (!qa.ok) throw new Error("QA Live vs local falló: " + qa.errors.slice(0, 10).join("; "));
    historySheet.appendRow([historyId, "LOCAL_MODEL_APPLY", scanId, "APLICADO", snapshots.length, new Date(), operadorSync10C_(authValidation), JSON.stringify(qa), "", ""]);
    return { status: "ok", historyId: historyId, snapshotId: snapshotId, changed: snapshots.length, qa: qa, version: candidate.version };
  } catch (error) {
    restaurarSnapshotV2PentagramaSync10C_(ss, snapshots);
    SpreadsheetApp.flush(); borrarCacheCostos10B_();
    historySheet.appendRow([historyId, "LOCAL_MODEL_APPLY", scanId, "REVERTIDO_AUTOMATICO", snapshots.length, new Date(), operadorSync10C_(authValidation), "", String(error), ""]);
    return { status: "error", code: "PENTAGRAMA_APPLY_ROLLED_BACK", msg: "El modelo candidato falló; la versión anterior permanece activa.", error: String(error) };
  } finally { lock.releaseLock(); }
}

function ejecutarQaModeloLocalPentagramaSync10C_(ss, cases) {
  const catalog = cargarCatalogoCostos10B_(ss, true); const errors = []; let maxDifference = 0; let passed = 0;
  (cases || []).forEach(function(testCase) {
    const request = { product: testCase.homeeasyId, width: String(testCase.width), height: String(testCase.height), quantity: "1", extras: "0",
      configuration: String(testCase.configuration || "standard"), coverlight: String(testCase.coverlight || ""), addons: [] };
    const result = calcularItemCostos10B_(request, catalog, { today: fechaBogota10B_(), promotions: true, installMode: "common", installation: "0" });
    if (!result.ok) { errors.push(testCase.id + ": " + String(result.error || "sin precio local")); return; }
    const actual = Number(result.unit) / 100; const difference = Math.abs(actual - Number(testCase.expected)); maxDifference = Math.max(maxDifference, difference);
    const orientation = String(result.fabrication && result.fabrication.orientationCode || "") || (result.fabrication && result.fabrication.orientation === "normal" ? "DIN" : result.fabrication && result.fabrication.orientation === "atravesada" ? "TAT" : result.fabrication && result.fabrication.orientation === "atravesada_y_anadida" ? "TAN" : "");
    const mechanism = String(result.fabrication && result.fabrication.mechanism || "");
    if (difference > 0.02 || (testCase.expectedOrientation && orientation !== testCase.expectedOrientation) || (testCase.expectedMechanism && mechanism !== String(testCase.expectedMechanism))) {
      errors.push(testCase.id + " esperado " + testCase.expected + " obtenido " + actual + " orientación " + orientation + " mecanismo " + mechanism +
        (testCase.expectedOrientation ? " orientaciónEsperada " + testCase.expectedOrientation : "") +
        (testCase.expectedMechanism ? " mecanismoEsperado " + String(testCase.expectedMechanism) : ""));
    } else passed++;
  });
  return { ok: errors.length === 0, checked: (cases || []).length, passed: passed, failed: errors.length, maxDifference: Math.round(maxDifference * 100) / 100, tolerance: 0.02, errors: errors };
}

function filaComplementoSync10C_(patch, candidate) {
  return [String(patch.homeeasyId), "complemento-enrollable", String(patch.familyName || "Complementos Enrollable"), String(patch.reference || patch.homeeasyId),
    String(patch.type || "Complemento"), String(patch.method || "unit"), Number(patch.proposedRate), 0, 0, 0, false,
    String(patch.configuration || ""), true, "VIGENTE", String(candidate.validThrough || "2099-12-31"), String(candidate.version), "COP", true,
    "Pentagrama Live", new Date(), JSON.stringify(patch.rules || {})];
}

function hashObjetoSync10C_(value) {
  function ordenar_(item) {
    if (Array.isArray(item)) return item.map(ordenar_);
    if (!item || typeof item !== "object") return item;
    const out = {}; Object.keys(item).sort().forEach(function(key) { out[key] = ordenar_(item[key]); }); return out;
  }
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(ordenar_(value || {})), Utilities.Charset.UTF_8)
    .map(function(part) { return (part < 0 ? part + 256 : part).toString(16).padStart(2, "0"); }).join("");
}

function aplicarCambiosCatalogoPentagramaSync10C_(ss, data, authValidation) {
  const scanId = String(data && data.scanId || "").trim();
  const scannedAt = new Date(String(data && data.scannedAt || ""));
  const mutations = Array.isArray(data && data.catalogMutations) ? data.catalogMutations : [];
  if (!scanId || isNaN(scannedAt.getTime()) || Date.now() - scannedAt.getTime() > 30 * 60 * 1000) {
    return { status: "error", code: "PENTAGRAMA_SCAN_EXPIRED", msg: "El escaneo no existe o expiró." };
  }
  if (!mutations.length) return { status: "error", code: "PENTAGRAMA_NO_CHANGES", msg: "No hay novedades de catálogo para aplicar." };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: "error", code: "PENTAGRAMA_SYNC_BUSY", msg: "HomeEasy está ocupado por otra operación. No se modificaron datos." };
  const historyId = Utilities.getUuid(); const snapshotId = Utilities.getUuid();
  const productSheet = ss.getSheetByName(HOMEEASY_COST_SHEET);
  const snapshotSheet = asegurarHojaSync10C_(ss, HOMEEASY_SYNC_SNAPSHOT_V2_SHEET, HOMEEASY_SYNC_SNAPSHOT_V2_HEADERS);
  const historySheet = asegurarHojaSync10C_(ss, HOMEEASY_SYNC_HISTORY_SHEET, HOMEEASY_SYNC_HISTORY_HEADERS);
  const snapshots = []; const writes = [];
  try {
    if (!productSheet) throw new Error("No existe la hoja de Costos Pentagrama.");
    const rowById = indiceFilasSync10C_(productSheet, 0);
    let nextRow = productSheet.getLastRow() + 1;
    const seenIds = {};

    mutations.forEach(function(mutation) {
      if (mutation && mutation.certified !== true) throw new Error("La novedad de catálogo no está certificada.");
      const kind = String(mutation && mutation.kind || "").trim().toUpperCase();
      if (["ADD", "DEACTIVATE", "RENAME", "UPDATE_RATE", "UPDATE_RULES"].indexOf(kind) < 0) throw new Error("Tipo de novedad no permitido: " + kind);
      const id = String(mutation && mutation.homeeasyId || "").trim();
      if (!id || seenIds[id]) throw new Error("ID de catálogo inválido o duplicado: " + id);
      seenIds[id] = true;

      let row = Number(rowById[id] || 0); const existed = Boolean(row);
      if (!row) row = nextRow++;
      const before = existed ? productSheet.getRange(row, 1, 1, HOMEEASY_COST_HEADERS.length).getValues()[0] : [];
      if (existed && String(before[0]) !== id) throw new Error("El producto cambió de fila: " + id);

      const currentRules = existed ? leerReglasCostos10B_(before[20]) : {};
      const currentKey = claveExternaReglasSync10C_(currentRules);
      const expectedKey = String(mutation.expectedExternalKey || "").trim().toUpperCase();
      if (existed && expectedKey && currentKey && currentKey !== expectedKey) throw new Error("La identidad Pentagrama cambió después del escaneo: " + id);

      let values;
      if (kind === "ADD") {
        if (existed) throw new Error("La referencia nueva ya existe en HomeEasy: " + id);
        if (!Array.isArray(mutation.rowValues) || mutation.rowValues.length !== HOMEEASY_COST_HEADERS.length) throw new Error("Fila certificada incompleta: " + id);
        values = mutation.rowValues.slice();
        values[0] = id; values[12] = true; values[13] = "VIGENTE"; values[18] = "Pentagrama Sync"; values[19] = new Date();
        const addRules = leerReglasCostos10B_(values[20]);
        if (!claveExternaReglasSync10C_(addRules)) throw new Error("La referencia nueva no contiene identidad Pentagrama: " + id);
        if (!Array.isArray(mutation.qaCases) || mutation.qaCases.length < 2) throw new Error("Evidencia QA insuficiente para alta: " + id);
      } else if (kind === "DEACTIVATE") {
        if (existed) values = before.slice();
        else {
          if (!Array.isArray(mutation.rowValues) || mutation.rowValues.length !== HOMEEASY_COST_HEADERS.length) throw new Error("Falta override certificado para desactivar: " + id);
          values = mutation.rowValues.slice(); values[0] = id;
        }
        values[12] = false; values[13] = "DESCONTINUADO"; values[18] = "Pentagrama Sync"; values[19] = new Date();
      } else if (kind === "RENAME") {
        if (existed) values = before.slice();
        else {
          if (!Array.isArray(mutation.rowValues) || mutation.rowValues.length !== HOMEEASY_COST_HEADERS.length) throw new Error("Falta override certificado para renombrar: " + id);
          values = mutation.rowValues.slice(); values[0] = id;
        }
        const newReference = String(mutation.newReference || "").trim();
        if (!newReference) throw new Error("Nuevo nombre vacío: " + id);
        values[3] = newReference; values[18] = "Pentagrama Sync"; values[19] = new Date();
      } else if (kind === "UPDATE_RULES") {
        if (!existed) throw new Error("La referencia de mantenimiento no existe en HomeEasy: " + id);
        if (!Array.isArray(mutation.rowValues) || mutation.rowValues.length !== HOMEEASY_COST_HEADERS.length) throw new Error("Fila certificada incompleta para mantenimiento: " + id);
        if (Math.abs(Number(before[6]) - Number(mutation.expectedRate)) > 0.005) throw new Error("La tarifa cambió después del escaneo: " + id);
        if (Math.abs(Number(before[7]) - Number(mutation.expectedMinHeight)) > 0.000001) throw new Error("El alto mínimo cambió después del escaneo: " + id);
        if (Math.abs(Number(before[8]) - Number(mutation.expectedMinArea)) > 0.000001) throw new Error("El área mínima cambió después del escaneo: " + id);
        if (!isFinite(Number(mutation.proposedRate)) || Number(mutation.proposedRate) <= 0) throw new Error("Tarifa propuesta inválida: " + id);
        if (!isFinite(Number(mutation.proposedMinArea)) || Number(mutation.proposedMinArea) <= 0) throw new Error("Área mínima propuesta inválida: " + id);
        if (!Array.isArray(mutation.qaCases) || mutation.qaCases.length < 3) throw new Error("Evidencia QA insuficiente para mantenimiento: " + id);
        values = mutation.rowValues.slice(); values[0] = id;
        values[6] = Number(mutation.proposedRate);
        values[7] = Number(mutation.proposedMinHeight);
        values[8] = Number(mutation.proposedMinArea);
        values[12] = true; values[13] = "VIGENTE"; values[18] = "Pentagrama Maintenance"; values[19] = new Date();
        const maintenanceRules = leerReglasCostos10B_(values[20]);
        if (!claveExternaReglasSync10C_(maintenanceRules)) throw new Error("El mantenimiento no contiene identidad Pentagrama: " + id);
      } else {
        if (!Array.isArray(mutation.rowValues) || mutation.rowValues.length !== HOMEEASY_COST_HEADERS.length) throw new Error("Fila certificada incompleta para actualizar tarifa: " + id);
        if (existed && Math.abs(Number(before[6]) - Number(mutation.expectedRate)) > 0.005) throw new Error("La tarifa cambió después del escaneo: " + id);
        if (!isFinite(Number(mutation.proposedRate)) || Number(mutation.proposedRate) <= 0) throw new Error("Tarifa propuesta inválida: " + id);
        if (!Array.isArray(mutation.qaCases) || mutation.qaCases.length < 2) throw new Error("Evidencia QA insuficiente para tarifa: " + id);
        values = mutation.rowValues.slice(); values[0] = id; values[6] = Number(mutation.proposedRate);
        values[12] = true; values[13] = "VIGENTE"; values[18] = "Pentagrama Sync"; values[19] = new Date();
        const rateRules = leerReglasCostos10B_(values[20]);
        if (!claveExternaReglasSync10C_(rateRules)) throw new Error("La actualización de tarifa no contiene identidad Pentagrama: " + id);
      }

      snapshots.push(snapshotV2Sync10C_(snapshotId, historyId, scanId, HOMEEASY_COST_SHEET, row, id, before, existed, "CATALOG_" + kind));
      writes.push({ row: row, values: values, mutation: mutation, kind: kind });
      rowById[id] = row;
    });

    snapshotSheet.getRange(snapshotSheet.getLastRow() + 1, 1, snapshots.length, HOMEEASY_SYNC_SNAPSHOT_V2_HEADERS.length).setValues(snapshots);
    writes.forEach(function(write) { productSheet.getRange(write.row, 1, 1, HOMEEASY_COST_HEADERS.length).setValues([write.values]); });
    SpreadsheetApp.flush(); borrarCacheCostos10B_();

    const qa = ejecutarQaCatalogoPentagramaSync10C_(ss, writes);
    if (!qa.ok) throw new Error("QA de catálogo falló: " + qa.errors.slice(0, 10).join("; "));
    historySheet.appendRow([historyId, "CATALOG_APPLY", scanId, "APLICADO", writes.length, new Date(), operadorSync10C_(authValidation), JSON.stringify(qa), "", ""]);
    return { status: "ok", historyId: historyId, snapshotId: snapshotId, changed: writes.length, qa: qa };
  } catch (error) {
    restaurarSnapshotV2PentagramaSync10C_(ss, snapshots);
    SpreadsheetApp.flush(); borrarCacheCostos10B_();
    historySheet.appendRow([historyId, "CATALOG_APPLY", scanId, "REVERTIDO_AUTOMATICO", snapshots.length, new Date(), operadorSync10C_(authValidation), "", String(error), ""]);
    return { status: "error", code: "PENTAGRAMA_CATALOG_APPLY_ROLLED_BACK", msg: "No se aplicó la novedad de catálogo; se restauró el snapshot.", error: String(error) };
  } finally { lock.releaseLock(); }
}

function ejecutarQaCatalogoPentagramaSync10C_(ss, writes) {
  const errors = []; let checked = 0;
  const catalog = cargarCatalogoCostos10B_(ss, true);
  (writes || []).forEach(function(write) {
    const mutation = write.mutation || {}; const id = String(mutation.homeeasyId || "");
    const product = (catalog.products || []).find(function(item) { return String(item.id) === id; });
    if (!product) { errors.push(id + ": no quedó visible en el catálogo técnico."); return; }
    if (write.kind === "DEACTIVATE") {
      checked++;
      if (product.active !== false || String(product.status).toUpperCase() !== "DESCONTINUADO") errors.push(id + ": no quedó desactivado.");
      return;
    }
    if (write.kind === "RENAME") {
      checked++;
      if (String(product.name) !== String(mutation.newReference || "")) errors.push(id + ": el nombre no coincide después de escribir.");
      return;
    }
    if (product.active !== true) { errors.push(id + ": la referencia no quedó activa."); return; }
    if (write.kind === "UPDATE_RATE" || write.kind === "UPDATE_RULES") {
      checked++;
      const actualRate = Number(product.rateCents || 0) / 100;
      if (Math.abs(actualRate - Number(mutation.proposedRate || 0)) > 0.005) errors.push(id + ": la tarifa escrita no coincide.");
      if (write.kind === "UPDATE_RULES") {
        const actualMinHeight = Number(product.minHeightMm || 0) / 1000;
        const actualMinArea = Number(product.minAreaMm2 || 0) / 1000000;
        if (Math.abs(actualMinHeight - Number(mutation.proposedMinHeight || 0)) > 0.000001) errors.push(id + ": el alto mínimo escrito no coincide.");
        if (Math.abs(actualMinArea - Number(mutation.proposedMinArea || 0)) > 0.000001) errors.push(id + ": el área mínima escrita no coincide.");
      }
    }
    (mutation.qaCases || []).forEach(function(testCase) {
      checked++;
      try {
        const request = testCase.homeeasy || { product: id, width: String(testCase.width), height: String(testCase.height), quantity: String(testCase.quantity || 1), extras: "0" };
        const result = calcularItemCostos10B_(request, catalog, { today: fechaBogota10B_(), promotions: true, installMode: "common", installation: "0" });
        const actual = Number(result.unit) / 100;
        if (!result.ok || Math.abs(actual - Number(testCase.expected)) > 0.02) errors.push(id + "/" + String(testCase.id || "caso") + " esperado " + testCase.expected + " obtenido " + actual);
      } catch (error) { errors.push(id + "/" + String(testCase.id || "caso") + ": " + String(error)); }
    });
  });
  return { ok: errors.length === 0, checked: checked, catalog: catalog.products.length, tolerance: 0.02, errors: errors };
}

function indiceFilasSync10C_(sheet, column) {
  const out = {}; if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, column + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(row, index) {
    const key = String(row[0] || "").trim(); if (key) out[key] = index + 2;
  });
  return out;
}

function snapshotV2Sync10C_(snapshotId, historyId, scanId, sheet, row, key, before, existed, type) {
  return [snapshotId, historyId, scanId, sheet, row, key, JSON.stringify(before || []), existed, new Date(), type];
}

function restaurarSnapshotV2PentagramaSync10C_(ss, rows) {
  const grouped = {};
  (rows || []).forEach(function(row) { const name = String(row[3] || ""); if (!grouped[name]) grouped[name] = []; grouped[name].push(row); });
  Object.keys(grouped).forEach(function(name) {
    const sheet = ss.getSheetByName(name); if (!sheet) throw new Error("No existe la hoja del snapshot: " + name);
    grouped[name].sort(function(a, b) { return Number(b[4]) - Number(a[4]); }).forEach(function(row) {
      const rowNumber = Number(row[4]); const existed = String(row[7]).toUpperCase() === "TRUE" || row[7] === true;
      if (!existed) { if (rowNumber <= sheet.getLastRow()) sheet.deleteRow(rowNumber); return; }
      const values = JSON.parse(String(row[6] || "[]")); if (!values.length) throw new Error("Snapshot vacío para " + name + "/" + rowNumber);
      sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
    });
  });
}

function revertirPentagramaSync10C_(ss, data, authValidation) {
  const sourceHistoryId = String(data && data.historyId || "").trim();
  if (!sourceHistoryId) return { status: "error", code: "ROLLBACK_HISTORY_REQUIRED", msg: "Falta historialId." };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: "error", code: "PENTAGRAMA_SYNC_BUSY", msg: "HomeEasy está ocupado por otra operación. No se modificaron datos." };
  const sheet = ss.getSheetByName(HOMEEASY_COST_SHEET); const snapshotsSheet = ss.getSheetByName(HOMEEASY_SYNC_SNAPSHOT_SHEET);
  const historySheet = asegurarHojaSync10C_(ss, HOMEEASY_SYNC_HISTORY_SHEET, HOMEEASY_SYNC_HISTORY_HEADERS);
  const rollbackId = Utilities.getUuid();
  try {
    const snapshotsV2 = ss.getSheetByName(HOMEEASY_SYNC_SNAPSHOT_V2_SHEET);
    const rowsV2 = snapshotsV2 ? snapshotsV2.getDataRange().getValues().slice(1).filter(function(row) { return String(row[1]) === sourceHistoryId; }) : [];
    if (rowsV2.length) {
      restaurarSnapshotV2PentagramaSync10C_(ss, rowsV2);
      SpreadsheetApp.flush(); borrarCacheCostos10B_();
      const qaV2 = { ok: true, catalog: cargarCatalogoCostos10B_(ss, true).products.length, errors: [] };
      historySheet.appendRow([rollbackId, "ROLLBACK", "", "APLICADO", rowsV2.length, new Date(), operadorSync10C_(authValidation), JSON.stringify(qaV2), "", sourceHistoryId]);
      return { status: "ok", historyId: rollbackId, sourceHistoryId: sourceHistoryId, changed: rowsV2.length, qa: qaV2 };
    }
    if (!snapshotsSheet) throw new Error("No existe snapshot para revertir.");
    const rows = snapshotsSheet.getDataRange().getValues().slice(1).filter(function(row) { return String(row[1]) === sourceHistoryId; });
    if (!rows.length) throw new Error("No se encontró el snapshot solicitado.");
    rows.forEach(function(row) { sheet.getRange(Number(row[3]), 1, 1, HOMEEASY_COST_HEADERS.length).setValues([JSON.parse(String(row[5]))]); });
    SpreadsheetApp.flush(); borrarCacheCostos10B_();
    const qa = { ok: true, catalog: cargarCatalogoCostos10B_(ss, true).products.length, errors: [] };
    historySheet.appendRow([rollbackId, "ROLLBACK", "", "APLICADO", rows.length, new Date(), operadorSync10C_(authValidation), JSON.stringify(qa), "", sourceHistoryId]);
    return { status: "ok", historyId: rollbackId, sourceHistoryId: sourceHistoryId, changed: rows.length, qa: qa };
  } catch (error) { return { status: "error", code: "PENTAGRAMA_ROLLBACK_FAILED", msg: String(error) }; }
  finally { lock.releaseLock(); }
}

function ejecutarQaPentagramaSync10C_(ss, snapshots) {
  const errors = []; const catalog = cargarCatalogoCostos10B_(ss, true);
  snapshots.forEach(function(item) {
    (item.change.qaCases || []).forEach(function(testCase) {
      try {
        const request = testCase.homeeasy || { product: item.productId, width: String(testCase.width), height: String(testCase.height), quantity: String(testCase.quantity || 1), extras: "0" };
        const result = calcularItemCostos10B_(request, catalog, { today: fechaBogota10B_(), promotions: true, installMode: "common", installation: "0" });
        const actual = Number(result.unit) / 100;
        if (!result.ok || Math.abs(actual - Number(testCase.expected)) > 0.02) errors.push(item.productId + "/" + String(testCase.id || "caso") + " esperado " + testCase.expected + " obtenido " + actual);
      } catch (error) { errors.push(item.productId + "/" + String(testCase.id || "caso") + ": " + String(error)); }
    });
  });
  return { ok: errors.length === 0, checked: snapshots.reduce(function(sum, item) { return sum + (item.change.qaCases || []).length; }, 0),
    catalog: catalog.products.length, tolerance: 0.02, criticalRegressions: ["Panel Japonés mínimo", "Verticales mínimo", "Sheer Vertesse matriz", "Enrollable configuración"], errors: errors };
}

function leerHistorialPentagramaSync10C_(ss) {
  const sheet = asegurarHojaSync10C_(ss, HOMEEASY_SYNC_HISTORY_SHEET, HOMEEASY_SYNC_HISTORY_HEADERS);
  const rows = sheet.getDataRange().getValues().slice(1).reverse().slice(0, 50).map(function(row) { return { id: String(row[0]), type: String(row[1]), scanId: String(row[2]), state: String(row[3]), changes: Number(row[4]), at: row[5] instanceof Date ? row[5].toISOString() : String(row[5]), operator: String(row[6]), qa: String(row[7]), error: String(row[8]), revertedBy: String(row[9]) }; });
  return { status: "ok", items: rows };
}

function asegurarHojaSync10C_(ss, name, headers) {
  let sheet = ss.getSheetByName(name); if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]); sheet.setFrozenRows(1); return sheet;
}

function operadorSync10C_(validation) { return String(validation && (validation.usuario || validation.email || validation.userId) || "HomeEasy"); }
