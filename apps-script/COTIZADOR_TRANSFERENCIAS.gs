/*********************************************************
 * HOMEEASY — TRANSFERENCIAS TEMPORALES DEL COTIZADOR
 *
 * Alcance:
 * - Comparte únicamente el levantamiento técnico saneado.
 * - Exige sesión HomeEasy + cotizaciones.write en cada ruta.
 * - No usa precios, costos, VPS, WhatsApp, Firebase ni triggers.
 *********************************************************/

const HOMEEASY_COTIZADOR_TRANSFER_SHEET = "Cotizador_Transferencias";
const HOMEEASY_COTIZADOR_TRANSFER_PERMISSION = "cotizaciones.write";
const HOMEEASY_COTIZADOR_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HOMEEASY_COTIZADOR_TRANSFER_USED_TTL_MS = 24 * 60 * 60 * 1000;
const HOMEEASY_COTIZADOR_TRANSFER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const HOMEEASY_COTIZADOR_TRANSFER_CODE_LENGTH = 6;
const HOMEEASY_COTIZADOR_TRANSFER_CODE_ATTEMPTS = 24;
const HOMEEASY_COTIZADOR_TRANSFER_MAX_ITEMS = 100;
const HOMEEASY_COTIZADOR_TRANSFER_MAX_JSON_CHARS = 131072;

const HOMEEASY_COTIZADOR_TRANSFER_HEADERS = Object.freeze([
  "Codigo",
  "Creado_En",
  "Expira_En",
  "Estado",
  "Creador_UID",
  "Creador_Nombre",
  "Datos_JSON",
  "Consumido_En",
  "Consumido_Por_UID"
]);

const HOMEEASY_COTIZADOR_TRANSFER_COL = Object.freeze({
  CODE: 0,
  CREATED_AT: 1,
  EXPIRES_AT: 2,
  STATUS: 3,
  CREATOR_UID: 4,
  CREATOR_NAME: 5,
  DATA_JSON: 6,
  CONSUMED_AT: 7,
  CONSUMED_BY_UID: 8
});

const HOMEEASY_COTIZADOR_TRANSFER_ROUTES = Object.freeze({
  COTIZADOR_TRANSFERENCIA_CREAR: HOMEEASY_COTIZADOR_TRANSFER_PERMISSION,
  COTIZADOR_TRANSFERENCIA_PREVIEW: HOMEEASY_COTIZADOR_TRANSFER_PERMISSION,
  COTIZADOR_TRANSFERENCIA_CONSUMIR: HOMEEASY_COTIZADOR_TRANSFER_PERMISSION
});

function procesarRutaCotizadorTransferencias_(ss, data) {
  const tipo = String(data && data.tipo || "").trim();
  const permission = HOMEEASY_COTIZADOR_TRANSFER_ROUTES[tipo];
  if (!permission) return null;

  const auth = autorizarRutaCotizadorTransferencias_(ss, data, permission);
  if (!auth.ok) return auth.response;
  data.__auth9C = auth.validation;

  try {
    if (tipo === "COTIZADOR_TRANSFERENCIA_CREAR") return crearCotizadorTransferencia_(ss, data);
    if (tipo === "COTIZADOR_TRANSFERENCIA_PREVIEW") return previewCotizadorTransferencia_(ss, data);
    if (tipo === "COTIZADOR_TRANSFERENCIA_CONSUMIR") return consumirCotizadorTransferencia_(ss, data);
    return errorCotizadorTransferencia_("TRANSFER_ROUTE_NOT_FOUND", "La acción de transferencia no existe.");
  } catch (error) {
    console.error("Cotizador transferencias: " + (error && error.stack ? error.stack : error));
    return errorCotizadorTransferencia_(
      error && error.code ? error.code : "TRANSFER_INTERNAL_ERROR",
      error && error.message ? error.message : "No fue posible procesar la transferencia."
    );
  }
}

function autorizarRutaCotizadorTransferencias_(ss, data, permission) {
  if (typeof validarPermisoSesionAuth9B_ !== "function") {
    return {
      ok: false,
      response: errorCotizadorTransferencia_("TRANSFER_AUTH_UNAVAILABLE", "El núcleo de sesión HomeEasy no está disponible.")
    };
  }
  const token = String(data && data.appSessionToken || "").trim();
  const meta = data && data.meta && typeof data.meta === "object" ? data.meta : {};
  const check = validarPermisoSesionAuth9B_(ss, token, meta, permission);
  if (check.response) return { ok: false, response: check.response };
  return { ok: true, validation: check.validation };
}

function crearCotizadorTransferencia_(ss, data) {
  const actor = obtenerActorCotizadorTransferencia_(data);
  const payload = sanearPayloadCotizadorTransferencia_(data && data.payload);
  const payloadJson = JSON.stringify(payload);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HOMEEASY_COTIZADOR_TRANSFER_TTL_MS);

  return conLockCotizadorTransferencia_(function() {
    const sh = asegurarHojaCotizadorTransferencias_(ss);
    limpiarCotizadorTransferencias_(sh, now);
    const occupied = codigosCotizadorTransferencia_(sh);
    const code = generarCodigoCotizadorTransferencia_(occupied);
    sh.appendRow([
      code,
      now,
      expiresAt,
      "PENDIENTE",
      actor.uid,
      actor.name,
      payloadJson,
      "",
      ""
    ]);
    return {
      status: "ok",
      code: code,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
  });
}

function previewCotizadorTransferencia_(ss, data) {
  const code = normalizarCodigoCotizadorTransferencia_(data && data.code);
  return conLockCotizadorTransferencia_(function() {
    const now = new Date();
    const sh = asegurarHojaCotizadorTransferencias_(ss);
    const cleanup = limpiarCotizadorTransferencias_(sh, now);
    const found = buscarCotizadorTransferencia_(sh, code);
    if (!found) return errorTransferenciaAusenteCotizador_(code, cleanup);
    const row = found.values;
    const status = String(row[HOMEEASY_COTIZADOR_TRANSFER_COL.STATUS] || "").trim().toUpperCase();
    const expiresAt = fechaCotizadorTransferencia_(row[HOMEEASY_COTIZADOR_TRANSFER_COL.EXPIRES_AT]);
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
      return errorCotizadorTransferencia_("TRANSFER_EXPIRED", "El código de transferencia venció.");
    }
    if (status !== "PENDIENTE") {
      return errorCotizadorTransferencia_("TRANSFER_USED", "El código de transferencia ya fue usado.");
    }
    const payload = parsearPayloadGuardadoCotizadorTransferencia_(row[HOMEEASY_COTIZADOR_TRANSFER_COL.DATA_JSON]);
    return {
      status: "ok",
      code: code,
      createdBy: String(row[HOMEEASY_COTIZADOR_TRANSFER_COL.CREATOR_NAME] || "Usuario HomeEasy"),
      createdAt: isoCotizadorTransferencia_(row[HOMEEASY_COTIZADOR_TRANSFER_COL.CREATED_AT]),
      expiresAt: expiresAt.toISOString(),
      summary: resumenPayloadCotizadorTransferencia_(payload),
      payload: payload
    };
  });
}

function consumirCotizadorTransferencia_(ss, data) {
  const code = normalizarCodigoCotizadorTransferencia_(data && data.code);
  const actor = obtenerActorCotizadorTransferencia_(data);
  return conLockCotizadorTransferencia_(function() {
    const now = new Date();
    const sh = asegurarHojaCotizadorTransferencias_(ss);
    const cleanup = limpiarCotizadorTransferencias_(sh, now);
    const found = buscarCotizadorTransferencia_(sh, code);
    if (!found) return errorTransferenciaAusenteCotizador_(code, cleanup);
    const row = found.values;
    const status = String(row[HOMEEASY_COTIZADOR_TRANSFER_COL.STATUS] || "").trim().toUpperCase();
    const expiresAt = fechaCotizadorTransferencia_(row[HOMEEASY_COTIZADOR_TRANSFER_COL.EXPIRES_AT]);
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
      return errorCotizadorTransferencia_("TRANSFER_EXPIRED", "El código de transferencia venció.");
    }
    if (status !== "PENDIENTE") {
      return errorCotizadorTransferencia_("TRANSFER_USED", "El código de transferencia ya fue usado.");
    }
    sh.getRange(found.rowNumber, HOMEEASY_COTIZADOR_TRANSFER_COL.STATUS + 1, 1, 6).setValues([[
      "USADO",
      row[HOMEEASY_COTIZADOR_TRANSFER_COL.CREATOR_UID],
      row[HOMEEASY_COTIZADOR_TRANSFER_COL.CREATOR_NAME],
      row[HOMEEASY_COTIZADOR_TRANSFER_COL.DATA_JSON],
      now,
      actor.uid
    ]]);
    return { status: "ok", code: code };
  });
}

function conLockCotizadorTransferencia_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function asegurarHojaCotizadorTransferencias_(ss) {
  let sh = ss.getSheetByName(HOMEEASY_COTIZADOR_TRANSFER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(HOMEEASY_COTIZADOR_TRANSFER_SHEET);
    sh.getRange(1, 1, 1, HOMEEASY_COTIZADOR_TRANSFER_HEADERS.length).setValues([HOMEEASY_COTIZADOR_TRANSFER_HEADERS.slice()]);
    if (typeof sh.setFrozenRows === "function") sh.setFrozenRows(1);
    if (typeof sh.getMaxColumns === "function" && typeof sh.deleteColumns === "function" && sh.getMaxColumns() > HOMEEASY_COTIZADOR_TRANSFER_HEADERS.length) {
      sh.deleteColumns(HOMEEASY_COTIZADOR_TRANSFER_HEADERS.length + 1, sh.getMaxColumns() - HOMEEASY_COTIZADOR_TRANSFER_HEADERS.length);
    }
  }
  validarHojaCotizadorTransferencias_(sh);
  return sh;
}

function validarHojaCotizadorTransferencias_(sh) {
  if (!sh || sh.getLastColumn() < HOMEEASY_COTIZADOR_TRANSFER_HEADERS.length) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_SCHEMA_INVALID", "La hoja de transferencias no tiene el esquema esperado.");
  }
  const headers = sh.getRange(1, 1, 1, HOMEEASY_COTIZADOR_TRANSFER_HEADERS.length).getValues()[0];
  const mismatch = HOMEEASY_COTIZADOR_TRANSFER_HEADERS.some(function(header, index) {
    return String(headers[index] || "").trim() !== header;
  });
  if (mismatch) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_SCHEMA_INVALID", "Los encabezados de Cotizador_Transferencias no coinciden con el contrato.");
  }
}

function limpiarCotizadorTransferencias_(sh, now) {
  const result = { expiredCodes: {}, usedCodes: {}, deleted: 0 };
  if (sh.getLastRow() < 2) return result;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, HOMEEASY_COTIZADOR_TRANSFER_HEADERS.length).getValues();
  const nowMs = now.getTime();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const code = String(row[HOMEEASY_COTIZADOR_TRANSFER_COL.CODE] || "").trim().toUpperCase();
    const status = String(row[HOMEEASY_COTIZADOR_TRANSFER_COL.STATUS] || "").trim().toUpperCase();
    const expiresAt = fechaCotizadorTransferencia_(row[HOMEEASY_COTIZADOR_TRANSFER_COL.EXPIRES_AT]);
    const consumedAt = fechaCotizadorTransferencia_(row[HOMEEASY_COTIZADOR_TRANSFER_COL.CONSUMED_AT]);
    const createdAt = fechaCotizadorTransferencia_(row[HOMEEASY_COTIZADOR_TRANSFER_COL.CREATED_AT]);
    const pendingExpired = status === "PENDIENTE" && (!expiresAt || expiresAt.getTime() <= nowMs);
    const usedReference = consumedAt || createdAt;
    const usedOld = status === "USADO" && usedReference && usedReference.getTime() <= nowMs - HOMEEASY_COTIZADOR_TRANSFER_USED_TTL_MS;
    if (!pendingExpired && !usedOld) continue;
    if (pendingExpired && code) result.expiredCodes[code] = true;
    if (usedOld && code) result.usedCodes[code] = true;
    sh.deleteRow(i + 2);
    result.deleted++;
  }
  return result;
}

function buscarCotizadorTransferencia_(sh, code) {
  if (sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, HOMEEASY_COTIZADOR_TRANSFER_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][HOMEEASY_COTIZADOR_TRANSFER_COL.CODE] || "").trim().toUpperCase() === code) {
      return { rowNumber: i + 2, values: rows[i] };
    }
  }
  return null;
}

function codigosCotizadorTransferencia_(sh) {
  const occupied = {};
  if (sh.getLastRow() < 2) return occupied;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  values.forEach(function(row) {
    const code = String(row[0] || "").trim().toUpperCase();
    if (code) occupied[code] = true;
  });
  return occupied;
}

function generarCodigoCotizadorTransferencia_(occupied, randomFn) {
  const random = typeof randomFn === "function" ? randomFn : Math.random;
  for (let attempt = 0; attempt < HOMEEASY_COTIZADOR_TRANSFER_CODE_ATTEMPTS; attempt++) {
    let code = "";
    for (let i = 0; i < HOMEEASY_COTIZADOR_TRANSFER_CODE_LENGTH; i++) {
      code += HOMEEASY_COTIZADOR_TRANSFER_CODE_ALPHABET.charAt(Math.floor(random() * HOMEEASY_COTIZADOR_TRANSFER_CODE_ALPHABET.length));
    }
    if (!occupied[code]) return code;
  }
  throw crearErrorCotizadorTransferencia_("TRANSFER_CODE_EXHAUSTED", "No fue posible generar un código único. Intenta de nuevo.");
}

function normalizarCodigoCotizadorTransferencia_(value) {
  const code = String(value || "").toUpperCase().replace(/[\s-]+/g, "");
  const pattern = new RegExp("^[" + HOMEEASY_COTIZADOR_TRANSFER_CODE_ALPHABET + "]{" + HOMEEASY_COTIZADOR_TRANSFER_CODE_LENGTH + "}$");
  if (!pattern.test(code)) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_CODE_INVALID", "El código de transferencia no es válido.");
  }
  return code;
}

function sanearPayloadCotizadorTransferencia_(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_PAYLOAD_INVALID", "El levantamiento debe ser un objeto JSON.");
  }
  let raw;
  try {
    raw = JSON.stringify(payload);
  } catch (error) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_PAYLOAD_INVALID", "El levantamiento no se puede serializar.");
  }
  if (raw.length > HOMEEASY_COTIZADOR_TRANSFER_MAX_JSON_CHARS) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_PAYLOAD_TOO_LARGE", "El levantamiento supera el tamaño máximo permitido.");
  }
  validarCamposProhibidosCotizadorTransferencia_(payload, 0);
  if (!Array.isArray(payload.items)) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_ITEMS_REQUIRED", "El levantamiento debe incluir items.");
  }
  if (payload.items.length > HOMEEASY_COTIZADOR_TRANSFER_MAX_ITEMS) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_TOO_MANY_ITEMS", "El levantamiento no puede superar 100 items.");
  }
  const sanitized = {
    project: textoCotizadorTransferencia_(payload.project, 200, "project", false),
    items: payload.items.map(function(item, index) {
      return sanearItemCotizadorTransferencia_(item, index);
    })
  };
  const sanitizedRaw = JSON.stringify(sanitized);
  if (sanitizedRaw.length > HOMEEASY_COTIZADOR_TRANSFER_MAX_JSON_CHARS) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_PAYLOAD_TOO_LARGE", "El levantamiento saneado supera el tamaño máximo permitido.");
  }
  return sanitized;
}

function sanearItemCotizadorTransferencia_(item, index) {
  const label = "items[" + index + "]";
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_ITEM_INVALID", label + " debe ser un objeto.");
  }
  if (item.addons != null && !Array.isArray(item.addons)) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_ITEM_INVALID", label + ".addons debe ser una lista.");
  }
  const addons = (item.addons || []).map(function(addon, addonIndex) {
    return textoCotizadorTransferencia_(addon, 120, label + ".addons[" + addonIndex + "]", true);
  });
  if (addons.length > 30) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_ITEM_INVALID", label + ".addons supera el límite permitido.");
  }
  const uniqueAddons = [];
  const seenAddons = {};
  addons.forEach(function(addon) {
    if (!seenAddons[addon]) {
      seenAddons[addon] = true;
      uniqueAddons.push(addon);
    }
  });
  const installation = item.installation == null ? {} : item.installation;
  if (!installation || typeof installation !== "object" || Array.isArray(installation)) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_ITEM_INVALID", label + ".installation debe ser un objeto.");
  }
  return {
    roomId: textoCotizadorTransferencia_(item.roomId, 120, label + ".roomId", true),
    family: textoCotizadorTransferencia_(item.family, 80, label + ".family", true),
    product: textoCotizadorTransferencia_(item.product, 160, label + ".product", true),
    location: textoCotizadorTransferencia_(item.location, 200, label + ".location", false),
    width: numeroCotizadorTransferencia_(item.width, label + ".width", 0.001, 100, false),
    height: numeroCotizadorTransferencia_(item.height, label + ".height", 0.001, 100, false),
    quantity: numeroCotizadorTransferencia_(item.quantity, label + ".quantity", 1, 1000, true),
    configuration: textoCotizadorTransferencia_(item.configuration, 120, label + ".configuration", false),
    coverlight: textoCotizadorTransferencia_(item.coverlight, 120, label + ".coverlight", false),
    addons: uniqueAddons,
    installation: {
      mount: textoCotizadorTransferencia_(installation.mount, 80, label + ".installation.mount", false),
      control: textoCotizadorTransferencia_(installation.control, 80, label + ".installation.control", false),
      opening: textoCotizadorTransferencia_(installation.opening, 80, label + ".installation.opening", false),
      note: textoCotizadorTransferencia_(installation.note, 1000, label + ".installation.note", false)
    }
  };
}

function validarCamposProhibidosCotizadorTransferencia_(value, depth) {
  if (depth > 8 || value == null || typeof value !== "object") return;
  const prohibited = {
    cost: true, costo: true, costohomeeasy: true, manualcost: true,
    extras: true, extramonetario: true, extrasmonetarios: true,
    gain: true, margen: true, margin: true, profit: true,
    sale: true, venta: true, preciosugerido: true, suggestedprice: true,
    roundsale: true, transport: true, transporte: true,
    installationtotal: true, totalinstalacion: true,
    costospentagrama: true, pentagramacost: true,
    resultado: true, resultados: true, calculated: true, calculo: true,
    token: true, appsessiontoken: true, sessiontoken: true,
    password: true, contrasena: true, auth: true, authentication: true,
    email: true, correo: true
  };
  Object.keys(value).forEach(function(key) {
    const normalized = normalizarNombreCampoCotizadorTransferencia_(key);
    if (prohibited[normalized]) {
      throw crearErrorCotizadorTransferencia_("TRANSFER_FORBIDDEN_FIELD", "El levantamiento contiene un campo no permitido: " + key + ".");
    }
    validarCamposProhibidosCotizadorTransferencia_(value[key], depth + 1);
  });
}

function normalizarNombreCampoCotizadorTransferencia_(key) {
  let normalized = String(key || "").toLowerCase();
  if (typeof normalized.normalize === "function") normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-z0-9]/g, "");
}

function textoCotizadorTransferencia_(value, maxLength, field, required) {
  if (value == null) value = "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw crearErrorCotizadorTransferencia_("TRANSFER_PAYLOAD_INVALID", field + " debe ser texto.");
  }
  const text = String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (required && !text) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_PAYLOAD_INVALID", field + " es obligatorio.");
  }
  if (text.length > maxLength) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_PAYLOAD_INVALID", field + " supera " + maxLength + " caracteres.");
  }
  return text;
}

function numeroCotizadorTransferencia_(value, field, min, max, integerOnly) {
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const number = Number(normalized);
  if (!isFinite(number) || number < min || number > max || (integerOnly && Math.floor(number) !== number)) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_PAYLOAD_INVALID", field + " no es un número válido.");
  }
  return String(number);
}

function obtenerActorCotizadorTransferencia_(data) {
  const validation = data && data.__auth9C;
  const user = validation && validation.usuario || {};
  const uid = textoCotizadorTransferencia_(user.uid, 160, "usuario.uid", true);
  const name = textoCotizadorTransferencia_(user.nombre || user.email || user.uid, 160, "usuario.nombre", true);
  return { uid: uid, name: name };
}

function parsearPayloadGuardadoCotizadorTransferencia_(value) {
  let payload;
  try {
    payload = JSON.parse(String(value || ""));
  } catch (error) {
    throw crearErrorCotizadorTransferencia_("TRANSFER_DATA_CORRUPTED", "El levantamiento guardado no se puede leer.");
  }
  return sanearPayloadCotizadorTransferencia_(payload);
}

function resumenPayloadCotizadorTransferencia_(payload) {
  const rooms = {};
  payload.items.forEach(function(item) { rooms[item.roomId] = true; });
  return {
    project: payload.project,
    rooms: Object.keys(rooms).length,
    items: payload.items.length
  };
}

function errorTransferenciaAusenteCotizador_(code, cleanup) {
  if (cleanup && cleanup.expiredCodes && cleanup.expiredCodes[code]) {
    return errorCotizadorTransferencia_("TRANSFER_EXPIRED", "El código de transferencia venció.");
  }
  if (cleanup && cleanup.usedCodes && cleanup.usedCodes[code]) {
    return errorCotizadorTransferencia_("TRANSFER_USED", "El código de transferencia ya fue usado.");
  }
  return errorCotizadorTransferencia_("TRANSFER_NOT_FOUND", "No existe una transferencia con ese código.");
}

function fechaCotizadorTransferencia_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isoCotizadorTransferencia_(value) {
  const date = fechaCotizadorTransferencia_(value);
  return date ? date.toISOString() : "";
}

function crearErrorCotizadorTransferencia_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorCotizadorTransferencia_(code, message) {
  return { status: "error", code: code, msg: message };
}
