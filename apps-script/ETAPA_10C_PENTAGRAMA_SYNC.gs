/*********************************************************
 * HOMEEASY — ETAPA 10C
 * PENTAGRAMA SYNC TRANSACCIONAL
 *********************************************************/

const HOMEEASY_SYNC_SNAPSHOT_SHEET = "Costos_Pentagrama_Snapshots";
const HOMEEASY_SYNC_HISTORY_SHEET = "Costos_Pentagrama_Sync_Historial";
const HOMEEASY_SYNC_SNAPSHOT_HEADERS = Object.freeze(["Snapshot_ID", "Historial_ID", "Scan_ID", "Fila", "Producto_ID", "Antes_JSON", "Creado_En"]);
const HOMEEASY_SYNC_HISTORY_HEADERS = Object.freeze(["Historial_ID", "Tipo", "Scan_ID", "Estado", "Cambios", "Creado_En", "Operador", "QA_JSON", "Error", "Revertido_Por"]);

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
  const products = [];
  for (let i = 1; i < values.length; i++) {
    if (!String(values[i][0] || "").trim()) continue;
    products.push({ row: i + 1, id: String(values[i][0]), family: String(values[i][1]), familyName: String(values[i][2]),
      reference: String(values[i][3]), method: String(values[i][5]), rate: Number(values[i][6]), active: String(values[i][12]).toUpperCase() !== "FALSE",
      status: String(values[i][13]), updatedAt: values[i][19] instanceof Date ? values[i][19].toISOString() : String(values[i][19] || "") });
  }
  const catalog = cargarCatalogoCostos10B_(ss, false);
  return { status: "ok", version: catalog.version, validThrough: catalog.validThrough, products: products };
}

function aplicarPentagramaSync10C_(ss, data, authValidation) {
  const scanId = String(data && data.scanId || "").trim();
  const scannedAt = new Date(String(data && data.scannedAt || ""));
  const changes = Array.isArray(data && data.changes) ? data.changes : [];
  if (!scanId || isNaN(scannedAt.getTime()) || Date.now() - scannedAt.getTime() > 30 * 60 * 1000) return { status: "error", code: "PENTAGRAMA_SCAN_EXPIRED", msg: "El escaneo no existe o expiró." };
  if (!changes.length) return { status: "error", code: "PENTAGRAMA_NO_CHANGES", msg: "No hay cambios para aplicar." };
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
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

function revertirPentagramaSync10C_(ss, data, authValidation) {
  const sourceHistoryId = String(data && data.historyId || "").trim();
  if (!sourceHistoryId) return { status: "error", code: "ROLLBACK_HISTORY_REQUIRED", msg: "Falta historialId." };
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  const sheet = ss.getSheetByName(HOMEEASY_COST_SHEET); const snapshotsSheet = ss.getSheetByName(HOMEEASY_SYNC_SNAPSHOT_SHEET);
  const historySheet = asegurarHojaSync10C_(ss, HOMEEASY_SYNC_HISTORY_SHEET, HOMEEASY_SYNC_HISTORY_HEADERS);
  const rollbackId = Utilities.getUuid();
  try {
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
    try {
      const result = calcularItemCostos10B_({ product: item.productId, width: String(item.change.width), height: String(item.change.height), quantity: String(item.change.quantity || 1), extras: "0" }, catalog, { today: fechaBogota10B_(), promotions: true, installMode: "common", installation: "0" });
      const actual = Number(result.unit) / 100;
      if (!result.ok || Math.abs(actual - Number(item.change.newCost)) > 0.02) errors.push(item.productId + " esperado " + item.change.newCost + " obtenido " + actual);
    } catch (error) { errors.push(item.productId + ": " + String(error)); }
  });
  return { ok: errors.length === 0, checked: snapshots.length, catalog: catalog.products.length, criticalFamilies: ["Vertical", "Onda Serena", "Enrollable"], errors: errors };
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
