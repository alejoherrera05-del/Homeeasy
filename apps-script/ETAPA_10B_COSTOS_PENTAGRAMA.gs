/*********************************************************
 * HOMEEASY — ETAPA 10B
 * COSTOS PENTAGRAMA + COTIZADOR INTERNO
 *
 * Alcance:
 * - Usa exclusivamente las hojas Costos_Pentagrama*.
 * - NO usa la hoja legacy Tarifas.
 * - NO usa el VPS/WAHA.
 * - NO modifica Cotizaciones, Pedidos, Caja ni Abonos.
 * - Todas las rutas 10B exigen sesión HomeEasy + cotizaciones.write.
 * - El catálogo completo de costos nunca se entrega al navegador.
 *********************************************************/

const HOMEEASY_COST_STAGE = "10B";
const HOMEEASY_COST_SCHEMA_VERSION = 1;
const HOMEEASY_COST_SHEET = "Costos_Pentagrama";
const HOMEEASY_COST_MATRIX_SHEET = "Costos_Pentagrama_Matrices";
const HOMEEASY_COST_CONFIG_SHEET = "Costos_Pentagrama_Config";
const HOMEEASY_COST_CACHE_KEY = "HOMEEASY_COST_CATALOG_V1";
const HOMEEASY_COST_CACHE_SECONDS = 300;
const HOMEEASY_COST_PERMISSION = "cotizaciones.write";

const HOMEEASY_COST_HEADERS = Object.freeze([
  "ID", "Familia_Codigo", "Familia", "Referencia", "Tipo", "Metodo_Calculo",
  "Tarifa_IVA_COP", "Alto_Min_Fact_m", "Area_Min_Fact_m2", "Descuento_Extra_Pct",
  "Promocional", "Configuracion", "Activo", "Estado", "Vigente_Hasta",
  "Version_Catalogo", "Moneda", "IVA_Incluido", "Fuente", "Actualizado_En", "Notas"
]);

const HOMEEASY_COST_MATRIX_HEADERS = Object.freeze([
  "Producto_ID", "Familia", "Referencia", "Alto_Min_m", "Alto_Max_m",
  "Ancho_Min_m", "Ancho_Max_m", "Costo_IVA_COP", "Vigente_Hasta", "Version_Catalogo"
]);

const HOMEEASY_COST_CONFIG_HEADERS = Object.freeze(["Clave", "Valor", "Descripcion"]);

const HOMEEASY_COST_ROUTES = Object.freeze({
  COSTOS_ESTADO: HOMEEASY_COST_PERMISSION,
  COSTOS_OPCIONES: HOMEEASY_COST_PERMISSION,
  COSTOS_CALCULAR_COTIZACION: HOMEEASY_COST_PERMISSION
});

function instalarEtapa10BHomeEasy() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(HOMEEASY_SPREADSHEET_ID);
    const productSheet = asegurarHojaCostos10B_(ss, HOMEEASY_COST_SHEET, HOMEEASY_COST_HEADERS, 500, 24);
    const matrixSheet = asegurarHojaCostos10B_(ss, HOMEEASY_COST_MATRIX_SHEET, HOMEEASY_COST_MATRIX_HEADERS, 500, 12);
    const configSheet = asegurarHojaCostos10B_(ss, HOMEEASY_COST_CONFIG_SHEET, HOMEEASY_COST_CONFIG_HEADERS, 100, 6);
    const catalog = cargarCatalogoCostos10B_(ss, true);

    const props = PropertiesService.getScriptProperties();
    props.setProperty("HOMEEASY_COST_STAGE", HOMEEASY_COST_STAGE);
    props.setProperty("HOMEEASY_COST_SCHEMA_VERSION", String(HOMEEASY_COST_SCHEMA_VERSION));
    props.setProperty("HOMEEASY_COST_INSTALADO", "SI");
    props.setProperty("HOMEEASY_COST_INSTALADO_EN", new Date().toISOString());

    try {
      registrarAuditoria_(ss, {
        operador: "SISTEMA", dispositivoId: "SERVER", dispositivo: "Google Apps Script",
        plataforma: "Servidor", navegador: "—", pagina: "Apps Script", modulo: "Cotizador",
        accion: "INSTALAR COSTOS PENTAGRAMA", entidad: "COSTOS_PENTAGRAMA", entidadId: HOMEEASY_COST_STAGE,
        resumen: "Se instaló la Etapa 10B de costos y cotizador interno sin modificar datos comerciales.",
        estado: "EXITOSO", requestId: "INSTALACION_10B",
        datosJson: serializarObjetoAuditoria_({ productos: catalog.products.length, matrices: catalog.matrixCount, version: catalog.version, vigenteHasta: catalog.validThrough }),
        versionApp: "4.0-10B", antesJson: "",
        despuesJson: serializarObjetoAuditoria_({ hojas: [HOMEEASY_COST_SHEET, HOMEEASY_COST_MATRIX_SHEET, HOMEEASY_COST_CONFIG_SHEET] }),
        cambiosJson: "[]", error: "", reversible: "NO",
        motivoNoReversible: "La instalación valida/crea únicamente hojas técnicas del cotizador.",
        dependenciasJson: serializarObjetoAuditoria_({ hojaLegacyTarifasUsada: false }),
        revertida: "NO"
      });
    } catch (auditError) {
      console.error("10B instalada; no se pudo registrar auditoría inicial: " + auditError);
    }

    return {
      status: "ok", etapa: HOMEEASY_COST_STAGE, esquema: HOMEEASY_COST_SCHEMA_VERSION,
      hojaProductos: productSheet.getName(), hojaMatrices: matrixSheet.getName(), hojaConfig: configSheet.getName(),
      productos: catalog.products.length, matrices: catalog.matrixCount, version: catalog.version,
      vigenteHasta: catalog.validThrough, moneda: catalog.currency, preciosIncluyenIva: catalog.pricesIncludeVat,
      usaVps: false, usaHojaTarifasLegacy: false, datosComercialesModificados: 0
    };
  } finally {
    lock.releaseLock();
  }
}

function probarEtapa10BHomeEasy() {
  const ss = SpreadsheetApp.openById(HOMEEASY_SPREADSHEET_ID);
  validarHojaCostos10B_(ss, HOMEEASY_COST_SHEET, HOMEEASY_COST_HEADERS);
  validarHojaCostos10B_(ss, HOMEEASY_COST_MATRIX_SHEET, HOMEEASY_COST_MATRIX_HEADERS);
  validarHojaCostos10B_(ss, HOMEEASY_COST_CONFIG_SHEET, HOMEEASY_COST_CONFIG_HEADERS);

  const faltantes = Object.keys(HOMEEASY_COST_ROUTES).filter(function(tipo) {
    return typeof resolverPermisoPostAuth9A_ !== "function" || resolverPermisoPostAuth9A_(tipo) !== HOMEEASY_COST_ROUTES[tipo];
  });
  if (faltantes.length) throw new Error("Faltan rutas 10B en HOMEEASY_AUTH_POST_PERMISSIONS: " + faltantes.join(", "));

  const catalog = cargarCatalogoCostos10B_(ss, true);
  if (catalog.products.length < 1) throw new Error("El catálogo 10B está vacío.");
  const sample = calcularItemCostos10B_({ product: "onda-67", width: "1", height: "1", quantity: "1", extras: "0" }, catalog, {
    today: "2026-10-02", promotions: true, installMode: "common", installation: "0"
  });
  if (!sample.ok || sample.unit !== 18352656) throw new Error("La prueba Velo Coral White 1×1 no coincide con el valor certificado.");

  return {
    status: "ok", etapa: HOMEEASY_COST_STAGE, esquema: HOMEEASY_COST_SCHEMA_VERSION,
    rutasProtegidas: Object.keys(HOMEEASY_COST_ROUTES), productos: catalog.products.length,
    matrices: catalog.matrixCount, version: catalog.version, vigenteHasta: catalog.validThrough,
    pruebaVeloCoralWhite: sample.unit, usaVps: false, usaHojaTarifasLegacy: false,
    datosComercialesModificados: 0
  };
}

function procesarRutaCostos10B_(ss, data) {
  const tipo = String(data && data.tipo || "").trim();
  const permission = HOMEEASY_COST_ROUTES[tipo];
  if (!permission) return null;

  const auth = autorizarRutaCostos10B_(ss, data, permission);
  if (!auth.ok) return auth.response;
  data.__auth9C = auth.validation;

  if (tipo === "COSTOS_ESTADO") return obtenerEstadoCostos10B_(ss);
  if (tipo === "COSTOS_OPCIONES") return obtenerOpcionesCostos10B_(ss);
  if (tipo === "COSTOS_CALCULAR_COTIZACION") return calcularCotizacionCostos10B_(ss, data);
  return { status: "error", code: "COST_ROUTE_NOT_FOUND", msg: "La acción del cotizador no existe." };
}

function autorizarRutaCostos10B_(ss, data, permission) {
  if (typeof validarPermisoSesionAuth9B_ !== "function") {
    return { ok: false, response: { status: "error", code: "COST_AUTH_UNAVAILABLE", msg: "El núcleo de sesión HomeEasy no está disponible." } };
  }
  const token = String(data && data.appSessionToken || "").trim();
  const meta = data && data.meta && typeof data.meta === "object" ? data.meta : {};
  const check = validarPermisoSesionAuth9B_(ss, token, meta, permission);
  if (check.response) return { ok: false, response: check.response };
  return { ok: true, validation: check.validation };
}

function obtenerEstadoCostos10B_(ss) {
  const catalog = cargarCatalogoCostos10B_(ss, false);
  return {
    status: "ok", etapa: HOMEEASY_COST_STAGE, esquema: HOMEEASY_COST_SCHEMA_VERSION,
    version: catalog.version, validThrough: catalog.validThrough, currency: catalog.currency,
    pricesIncludeVat: catalog.pricesIncludeVat, products: catalog.products.length,
    matrixCells: catalog.matrixCount, expired: fechaBogota10B_() > catalog.validThrough,
    source: "Costos_Pentagrama", legacyTarifas: false, vps: false
  };
}

function obtenerOpcionesCostos10B_(ss) {
  const catalog = cargarCatalogoCostos10B_(ss, false);
  const products = catalog.products.filter(function(p) { return p.active; }).map(function(p) {
    return {
      id: p.id, family: p.family, familyName: p.familyName, name: p.name, type: p.type,
      method: p.method, configuration: p.configuration, status: p.status,
      manual: p.method === "manual"
    };
  });
  return {
    status: "ok", etapa: HOMEEASY_COST_STAGE, version: catalog.version,
    validThrough: catalog.validThrough, currency: catalog.currency,
    pricesIncludeVat: catalog.pricesIncludeVat, products: products
  };
}

function calcularCotizacionCostos10B_(ss, data) {
  const catalog = cargarCatalogoCostos10B_(ss, false);
  const state = {
    items: Array.isArray(data && data.items) ? data.items : [],
    transport: data && data.transport !== undefined ? data.transport : "0",
    installation: data && data.installation !== undefined ? data.installation : "0",
    margin: data && data.margin !== undefined ? data.margin : "30",
    installMode: String(data && data.installMode || "common") === "individual" ? "individual" : "common",
    promotions: data && data.promotions !== false
  };
  const quote = calcularQuoteCostos10B_(state, catalog, fechaBogota10B_());
  if (!quote.ok) return { status: "error", code: "COST_QUOTE_INVALID", msg: quote.error, quote: quote };
  return {
    status: "ok", etapa: HOMEEASY_COST_STAGE, version: catalog.version, validThrough: catalog.validThrough,
    currency: catalog.currency, pricesIncludeVat: catalog.pricesIncludeVat, quote: quote
  };
}

function cargarCatalogoCostos10B_(ss, forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get(HOMEEASY_COST_CACHE_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
  }

  const sh = ss.getSheetByName(HOMEEASY_COST_SHEET);
  const shMatrix = ss.getSheetByName(HOMEEASY_COST_MATRIX_SHEET);
  const shConfig = ss.getSheetByName(HOMEEASY_COST_CONFIG_SHEET);
  if (!sh || !shMatrix || !shConfig) throw new Error("Faltan hojas de Costos Pentagrama. Ejecuta instalarEtapa10BHomeEasy.");
  validarHeadersCostos10B_(sh, HOMEEASY_COST_HEADERS);
  validarHeadersCostos10B_(shMatrix, HOMEEASY_COST_MATRIX_HEADERS);
  validarHeadersCostos10B_(shConfig, HOMEEASY_COST_CONFIG_HEADERS);

  const configRows = shConfig.getLastRow() > 1 ? shConfig.getRange(2, 1, shConfig.getLastRow() - 1, 3).getValues() : [];
  const config = {};
  configRows.forEach(function(r) { const k = String(r[0] || "").trim(); if (k) config[k] = r[1]; });

  const matrixRows = shMatrix.getLastRow() > 1 ? shMatrix.getRange(2, 1, shMatrix.getLastRow() - 1, HOMEEASY_COST_MATRIX_HEADERS.length).getValues() : [];
  const matrices = {};
  matrixRows.forEach(function(r) {
    const id = String(r[0] || "").trim();
    if (!id) return;
    if (!matrices[id]) matrices[id] = [];
    matrices[id].push({
      minHeightMm: metrosAMm10B_(r[3]), maxHeightMm: metrosAMm10B_(r[4]),
      minWidthMm: metrosAMm10B_(r[5]), maxWidthMm: metrosAMm10B_(r[6]),
      cents: copACentavos10B_(r[7])
    });
  });

  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HOMEEASY_COST_HEADERS.length).getValues() : [];
  const products = [];
  rows.forEach(function(r) {
    const id = String(r[0] || "").trim();
    if (!id) return;
    const active = boolCostos10B_(r[12], true);
    const method = String(r[5] || "").trim().toLowerCase();
    products.push({
      id: id,
      family: String(r[1] || "").trim(),
      familyName: String(r[2] || "").trim(),
      name: String(r[3] || "").trim(),
      type: String(r[4] || "").trim(),
      method: method,
      rateCents: method === "area" ? copACentavos10B_(r[6]) : 0,
      minHeightMm: metrosAMm10B_(r[7]),
      minAreaMm2: metrosCuadradosAMm210B_(r[8]),
      extraDiscount: numeroCostos10B_(r[9], 0),
      promotional: boolCostos10B_(r[10], false),
      configuration: String(r[11] || "").trim(),
      active: active,
      status: String(r[13] || "VIGENTE").trim().toUpperCase(),
      validThrough: normalizarFechaCostos10B_(r[14]),
      version: String(r[15] || "").trim(),
      currency: String(r[16] || "COP").trim(),
      pricesIncludeVat: boolCostos10B_(r[17], true),
      matrixCells: matrices[id] || []
    });
  });

  const catalog = {
    version: String(config.VERSION_CATALOGO || (products[0] && products[0].version) || "").trim(),
    validThrough: normalizarFechaCostos10B_(config.VIGENTE_HASTA || (products[0] && products[0].validThrough) || ""),
    currency: String(config.MONEDA || (products[0] && products[0].currency) || "COP").trim(),
    pricesIncludeVat: boolCostos10B_(config.PRECIOS_INCLUYEN_IVA, true),
    products: products,
    matrixCount: matrixRows.length
  };
  if (!catalog.version || !catalog.validThrough || catalog.currency !== "COP" || catalog.pricesIncludeVat !== true) {
    throw new Error("La configuración de Costos Pentagrama está incompleta o no es compatible.");
  }
  try { cache.put(HOMEEASY_COST_CACHE_KEY, JSON.stringify(catalog), HOMEEASY_COST_CACHE_SECONDS); } catch (e) {}
  return catalog;
}

function calcularItemCostos10B_(item, catalog, options) {
  try {
    const qty = enteroCostos10B_(Number(item && item.quantity), 1, 999, "Cantidad: usa un entero entre 1 y 999.");
    const width = parseDecimalCostos10B_(item && item.width, 3);
    const height = parseDecimalCostos10B_(item && item.height, 3);
    enteroCostos10B_(width, 1, 20000, "Ingresa el ancho en metros, hasta 3 decimales.");
    enteroCostos10B_(height, 1, 20000, "Ingresa el alto en metros, hasta 3 decimales.");

    const product = catalog.products.find(function(p) { return p.id === String(item && (item.product || item.productId) || ""); });
    if (!product || !product.active) throw new Error("Elige un producto disponible.");

    let unit = 0;
    let area = null;
    const manual = String(item && item.mode || "auto") === "manual" || product.method === "manual";
    if (manual) {
      unit = parseDecimalCostos10B_(item && item.manualCost, 2);
      dineroCostos10B_(unit);
      if (!unit) throw new Error("Ingresa el costo por persiana confirmado con IVA.");
    } else {
      if (!catalog.validThrough || String(options.today || "") > catalog.validThrough) {
        throw new Error("La tarifa automática venció. Confirma el costo actualizado con Pentagrama.");
      }
      if (product.promotional && !options.promotions) {
        throw new Error("Esta referencia usa una promoción vigente. Si no aplica, usa costo confirmado.");
      }
      if (product.method === "area") {
        area = Math.max(width * Math.max(height, product.minHeightMm || 0), product.minAreaMm2 || 0);
        const discount = options.promotions && product.extraDiscount ? (100 - product.extraDiscount) / 100 : 1;
        unit = Math.round((area / 1000000) * product.rateCents * discount);
      } else if (product.method === "matrix") {
        const cell = product.matrixCells.find(function(c) {
          return width >= c.minWidthMm && width <= c.maxWidthMm && height >= c.minHeightMm && height <= c.maxHeightMm;
        });
        if (!cell || cell.cents === null || cell.cents === undefined) {
          throw new Error("Esta medida no tiene una tarifa automática confirmada. Consulta Pentagrama y usa costo confirmado.");
        }
        unit = cell.cents;
      } else {
        throw new Error("Esta configuración requiere costo confirmado por Pentagrama.");
      }
      const extras = parseDecimalCostos10B_(item && item.extras !== undefined ? item.extras : "0", 2);
      dineroCostos10B_(extras);
      unit += extras;
    }

    dineroCostos10B_(unit);
    const install = parseDecimalCostos10B_(options.installMode === "individual" ? item.installation : options.installation, 2);
    dineroCostos10B_(install);
    const total = dineroCostos10B_(unit * qty);
    const installation = dineroCostos10B_(install * qty);
    return {
      ok: true, unit: unit, total: total, installation: installation, quantity: qty,
      manual: manual, area: area,
      product: {
        id: product.id, family: product.family, familyName: product.familyName,
        name: product.name, type: product.type, method: product.method,
        configuration: product.configuration, status: product.status
      }
    };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

function calcularQuoteCostos10B_(state, catalog, today) {
  const items = (state.items || []).map(function(item) {
    return calcularItemCostos10B_(item, catalog, {
      today: today,
      promotions: state.promotions !== false,
      installMode: state.installMode,
      installation: state.installation
    });
  });
  try {
    if (!items.length || items.some(function(i) { return !i.ok; })) throw new Error("Completa las persianas pendientes para calcular el total.");
    const transport = parseDecimalCostos10B_(state.transport, 2);
    dineroCostos10B_(transport);
    const margin = parseDecimalCostos10B_(state.margin, 2);
    enteroCostos10B_(margin, 0, 9900, "El margen debe estar entre 0 % y 99 %.");
    const products = items.reduce(function(sum, i) { return sum + i.total; }, 0);
    const installation = items.reduce(function(sum, i) { return sum + i.installation; }, 0);
    const cost = dineroCostos10B_(products + installation + transport);
    const factor = 1 - margin / 10000;
    const sale = dineroCostos10B_(Math.ceil((cost / factor) / 100) * 100);
    return { ok: true, items: items, products: products, installation: installation, transport: transport, cost: cost, sale: sale, profit: sale - cost, margin: margin };
  } catch (error) {
    return { ok: false, items: items, error: error && error.message ? error.message : String(error) };
  }
}

function asegurarHojaCostos10B_(ss, name, headers, minRows, minCols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, ss.getSheets().length, { rows: minRows || 100, columns: Math.max(minCols || headers.length, headers.length) });
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  const current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  const empty = current.every(function(v) { return String(v || "").trim() === ""; });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else {
    validarHeadersCostos10B_(sh, headers);
  }
  return sh;
}

function validarHojaCostos10B_(ss, name, headers) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error("No existe la hoja " + name + ".");
  validarHeadersCostos10B_(sh, headers);
  return sh;
}

function validarHeadersCostos10B_(sh, headers) {
  const current = sh.getRange(1, 1, 1, headers.length).getValues()[0].map(function(v) { return String(v || "").trim(); });
  if (current.join("|") !== headers.join("|")) throw new Error("El esquema de " + sh.getName() + " no coincide con Etapa 10B.");
}

function parseDecimalCostos10B_(raw, scale) {
  const s = String(raw === undefined || raw === null ? "" : raw).trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const parts = s.split(".");
  const whole = parts[0];
  const part = parts[1] || "";
  if (part.length > scale) return null;
  const n = Number(whole) * Math.pow(10, scale) + Number((part + "0".repeat(scale)).slice(0, scale));
  return Number.isSafeInteger(n) ? n : null;
}

function enteroCostos10B_(value, min, max, message) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(message);
  return value;
}

function dineroCostos10B_(value) {
  return enteroCostos10B_(value, 0, 100000000000, "Ingresa un valor válido, sin negativos.");
}

function numeroCostos10B_(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolCostos10B_(value, fallback) {
  if (typeof value === "boolean") return value;
  const s = String(value === undefined || value === null ? "" : value).trim().toUpperCase();
  if (["TRUE", "VERDADERO", "SI", "SÍ", "1"].indexOf(s) >= 0) return true;
  if (["FALSE", "FALSO", "NO", "0"].indexOf(s) >= 0) return false;
  return fallback;
}

function metrosAMm10B_(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
}

function metrosCuadradosAMm210B_(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000000) : 0;
}

function copACentavos10B_(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("Hay una tarifa inválida en Costos Pentagrama.");
  return Math.round(n * 100);
}

function normalizarFechaCostos10B_(value) {
  if (!value) return "";
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, "America/Bogota", "yyyy-MM-dd");
  const s = String(value).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[1] + "-" + match[2] + "-" + match[3] : s;
}

function fechaBogota10B_() {
  return Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd");
}
