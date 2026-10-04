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
const HOMEEASY_COST_SCHEMA_VERSION = 2;
const HOMEEASY_COST_SHEET = "Costos_Pentagrama";
const HOMEEASY_COST_MATRIX_SHEET = "Costos_Pentagrama_Matrices";
const HOMEEASY_COST_CONFIG_SHEET = "Costos_Pentagrama_Config";
const HOMEEASY_COST_CACHE_KEY = "HOMEEASY_COST_CATALOG_V4_SIZE_RULES";
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
  COSTOS_CALCULAR_COTIZACION: HOMEEASY_COST_PERMISSION,
  COSTOS_SYNC_READ: "config.read",
  COSTOS_SYNC_APPLY: "config.write",
  COSTOS_SYNC_ROLLBACK: "config.write",
  COSTOS_SYNC_HISTORY: "config.read"
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
  if (/^COSTOS_SYNC_/.test(tipo) && typeof procesarRutaPentagramaSync10C_ === "function") return procesarRutaPentagramaSync10C_(ss, data, auth.validation);
  return { status: "error", code: "COST_ROUTE_NOT_FOUND", msg: "La acción del cotizador no existe." };
}

function borrarCacheCostos10B_() {
  const cache = CacheService.getScriptCache();
  const manifestText = cache.get(HOMEEASY_COST_CACHE_KEY);
  if (manifestText) {
    try {
      const manifest = JSON.parse(manifestText);
      if (manifest && manifest.chunks && manifest.generation) {
        for (let i = 0; i < manifest.chunks; i++) cache.remove(HOMEEASY_COST_CACHE_KEY + ":" + manifest.generation + ":" + i);
      }
    } catch (ignore) {}
  }
  cache.remove(HOMEEASY_COST_CACHE_KEY);
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
  const products = catalog.products.filter(function(p) {
    return p.active && p.family !== "complemento-enrollable" && (p.family !== "enrollable" ||
      (p.method === "area" && p.rateCents > 0 && p.status === "VIGENTE" && p.pricesIncludeVat && p.currency === "COP" &&
       catalog.validThrough >= fechaBogota10B_() && p.validThrough >= fechaBogota10B_() && !/institucional|m[aá]s de 30/i.test(p.name)));
  }).map(function(p) {
    const rules = p.rules || {};
    if (p.family === "enrollable") return {
      id: p.id, family: p.family, familyName: p.familyName, name: nombreEnrollable10B_(p), type: p.type,
      method: p.method, manual: false, coverlight: opcionesComplementos10B_(catalog, rules.coverlightIds || []),
      limits: { minWidthMm: rules.minWidthMm, minHeightMm: rules.minHeightMm,
        maxWidthMm: rules.maxWidthMm, maxHeightMm: rules.maxHeightMm, maxRatio: rules.maxRatio }
    };
    return {
      id: p.id, family: p.family, familyName: p.familyName, name: p.name, type: p.type,
      method: p.method, configuration: p.configuration, status: p.status,
      manual: p.method === "manual",
      configurations: (rules.configurations || []).map(function(c) { return { id: c.id, label: c.label, manual: c.method === "manual" }; }),
      coverlight: opcionesComplementos10B_(catalog, rules.coverlightIds || []),
      addons: opcionesComplementos10B_(catalog, rules.addonIds || [])
    };
  });
  return {
    status: "ok", etapa: HOMEEASY_COST_STAGE, version: catalog.version,
    validThrough: catalog.validThrough, currency: catalog.currency,
    pricesIncludeVat: catalog.pricesIncludeVat, products: products
  };
}

function nombreEnrollable10B_(p) {
  let name = p.name.replace(/\s+/g, " ").trim().replace(/Lagrima/gi, "Lágrima");
  if (p.type === "Blackout" && !/^Blackout\b/i.test(name)) name = "Blackout " + name.replace(/\s+Blackout\b/gi, "");
  return name.replace(/\s+(Lágrima|Platina)$/i, " — $1");
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
      try {
        const data = JSON.parse(cached);
        if (!data.chunks) return data;
        let joined = "";
        for (let i = 0; i < data.chunks; i++) {
          const part = cache.get(HOMEEASY_COST_CACHE_KEY + ":" + data.generation + ":" + i);
          if (!part) throw new Error("Cache incompleta");
          joined += part;
        }
        return JSON.parse(joined);
      } catch (e) {}
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
  const enrollableSizeRules = leerConfigJsonCostos10B_(config.ENROLLABLE_SIZE_RULES_JSON, "reglas de medidas para Enrollables");

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
      rateCents: method !== "manual" && method !== "matrix" ? copACentavos10B_(r[6]) : 0,
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
      matrixCells: matrices[id] || [],
      rules: leerReglasCostos10B_(r[20])
    });
  });

  const catalog = {
    version: String(config.VERSION_CATALOGO || (products[0] && products[0].version) || "").trim(),
    validThrough: normalizarFechaCostos10B_(config.VIGENTE_HASTA || (products[0] && products[0].validThrough) || ""),
    currency: String(config.MONEDA || (products[0] && products[0].currency) || "COP").trim(),
    pricesIncludeVat: boolCostos10B_(config.PRECIOS_INCLUYEN_IVA, true),
    products: products,
    matrixCount: matrixRows.length,
    enrollableSizeRules: enrollableSizeRules
  };
  if (!catalog.version || !catalog.validThrough || catalog.currency !== "COP" || catalog.pricesIncludeVat !== true) {
    throw new Error("La configuración de Costos Pentagrama está incompleta o no es compatible.");
  }
  try {
    const serialized = JSON.stringify(catalog);
    // Cada entrada de CacheService admite 100 KB; las reglas privadas amplían el catálogo.
    const chunkSize = 24000;
    const chunks = Math.ceil(serialized.length / chunkSize);
    const generation = String(Date.now());
    for (let i = 0; i < chunks; i++) cache.put(HOMEEASY_COST_CACHE_KEY + ":" + generation + ":" + i, serialized.slice(i * chunkSize, (i + 1) * chunkSize), HOMEEASY_COST_CACHE_SECONDS);
    cache.put(HOMEEASY_COST_CACHE_KEY, JSON.stringify({ chunks: chunks, generation: generation }), HOMEEASY_COST_CACHE_SECONDS);
  } catch (e) {}
  return catalog;
}

function calcularItemCostos10B_(item, catalog, options) {
  try {
    const qty = enteroCostos10B_(Number(item && item.quantity), 1, 999, "Cantidad: usa un entero entre 1 y 999.");
    const width = parseDecimalCostos10B_(item && item.width, 3);
    const height = parseDecimalCostos10B_(item && item.height, 3);
    enteroCostos10B_(width, 1, 20000, "Ingresa el ancho en metros, hasta 3 decimales.");
    enteroCostos10B_(height, 1, 20000, "Ingresa el alto en metros, hasta 3 decimales.");

    const original = catalog.products.find(function(p) { return p.id === String(item && (item.product || item.productId) || ""); });
    if (!original || !original.active || original.family === "complemento-enrollable") throw new Error("Elige un producto disponible.");
    const product = configurarProductoCostos10B_(original, item && item.configuration);

    let unit = 0;
    let area = null;
    let fabrication = null;
    const manual = String(item && item.mode || "auto") === "manual" || product.method === "manual";
    if (manual) {
      if (item.coverlight || (Array.isArray(item.addons) && item.addons.length)) throw new Error("El costo confirmado debe incluir Coverlight y los accesorios. Desactiva los complementos automáticos.");
      unit = parseDecimalCostos10B_(item && item.manualCost, 2);
      dineroCostos10B_(unit);
      if (!unit) throw new Error("Ingresa el costo por persiana confirmado con IVA.");
    } else {
      if (!catalog.validThrough || String(options.today || "") > catalog.validThrough) {
        throw new Error("La tarifa automática venció. Confirma el costo actualizado con Pentagrama.");
      }
      validarVigenciaProducto10B_(product, options.today);
      fabrication = validarMedidasEnrollable10B_(product, width, height, catalog);
      if (product.promotional && !options.promotions) {
        throw new Error("Esta referencia usa una promoción vigente. Si no aplica, usa costo confirmado.");
      }
      if (product.method === "area") {
        if (!product.rateCents) throw new Error("Confirma la tarifa vigente de esta referencia con Pentagrama.");
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
      const rules = product.rules || {};
      const coverlightId = item.coverlight ? String(item.coverlight) : "";
      if (coverlightId) {
        if ((rules.coverlightIds || []).indexOf(coverlightId) < 0) throw new Error("Coverlight no es compatible con esta configuración.");
        unit += calcularComplemento10B_(coverlightId, catalog, width, height, options.today, 2);
      }
      if (item.addons !== undefined && !Array.isArray(item.addons)) throw new Error("Los accesorios seleccionados no son válidos.");
      const addons = Array.isArray(item.addons) ? item.addons : [];
      if (new Set(addons).size !== addons.length || addons.length > 20) throw new Error("Los accesorios seleccionados no son válidos.");
      addons.forEach(function(id) {
        if ((rules.addonIds || []).indexOf(id) < 0) throw new Error("El accesorio no es compatible con esta configuración.");
        unit += calcularComplemento10B_(id, catalog, width, height, options.today, 1);
      });
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
      manual: manual, area: area, fabrication: fabrication,
      widthMm: width, heightMm: height,
      coverlightOptions: product.family === "enrollable" && !manual ? (product.rules.coverlightIds || []).map(function(id) {
        try {
          const cents = calcularComplemento10B_(id, catalog, width, height, options.today, 2);
          const complement = catalog.products.find(function(p) { return p.id === id; });
          return cents > 0 ? { id: id, name: complement.name, costCents: cents } : null;
        } catch (e) { return null; }
      }).filter(Boolean) : [],
      product: {
        id: product.id, family: product.family, familyName: product.familyName,
        name: product.family === "enrollable" ? nombreEnrollable10B_(product) : product.name, type: product.type, method: product.method,
        configuration: product.configuration + (item.coverlight ? " · con Coverlight" : ""), status: product.status,
        coverlight: Boolean(item.coverlight)
      }
    };
  } catch (error) {
    const response = { ok: false, error: error && error.message ? error.message : String(error) };
    ["code", "reason", "requiresAlternative", "notManufacturable", "alternatives"].forEach(function(key) {
      if (error && error[key] !== undefined) response[key] = error[key];
    });
    return response;
  }
}

// Reglas privadas en Notas (JSON). El esquema y las tarifas permanecen en Sheets.
function leerReglasCostos10B_(value) {
  const text = String(value || "").trim();
  if (text.charAt(0) !== "{") return {};
  try { return JSON.parse(text); } catch (e) { throw new Error("Hay reglas inválidas en Notas del catálogo de costos."); }
}

function leerConfigJsonCostos10B_(value, label) {
  const text = String(value || "").trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { throw new Error("Hay " + String(label || "configuración JSON") + " inválidas en Costos_Pentagrama_Config."); }
}

function opcionesComplementos10B_(catalog, ids) {
  return ids.map(function(id) { return catalog.products.find(function(p) { return p.id === id && p.active && p.family === "complemento-enrollable"; }); })
    .filter(function(p) { return Boolean(p); }).map(function(p) { return { id: p.id, name: p.name }; });
}

function configurarProductoCostos10B_(product, configuration) {
  const id = String(configuration || "standard");
  if (id === "standard") return product;
  const variant = ((product.rules || {}).configurations || []).find(function(c) { return c.id === id; });
  if (!variant) throw new Error("Elige una configuración disponible.");
  return Object.assign({}, product, {
    method: variant.method,
    rateCents: copACentavos10B_(variant.rateCOP || 0),
    promotional: Boolean(variant.promotional),
    extraDiscount: numeroCostos10B_(variant.extraDiscount, 0),
    configuration: variant.label,
    rules: Object.assign({}, product.rules, { coverlightIds: variant.coverlightIds || [], addonIds: variant.addonIds || [] })
  });
}

function validarVigenciaProducto10B_(product, today) {
  if (product.family !== "enrollable" && product.family !== "complemento-enrollable") return;
  if (!product.pricesIncludeVat || product.currency !== "COP" || !product.validThrough || String(today || "") > product.validThrough || product.status !== "VIGENTE") {
    throw new Error("La configuración requiere un costo vigente confirmado con IVA por Pentagrama.");
  }
}

function validarMedidasEnrollable10B_(product, width, height, catalog) {
  const r = product.rules || {};
  if (product.family !== "enrollable" && product.family !== "complemento-enrollable") return;
  if ((r.minWidthMm && width < r.minWidthMm) || (r.minHeightMm && height < r.minHeightMm)) throw new Error("Estas medidas están por debajo del mínimo de fabricación.");

  const sizePolicy = catalog && catalog.enrollableSizeRules || {};
  const sizeRuleId = String(r.sizeRuleId || "");
  const group = String(r.sizeGroup || "");
  const configurations = sizePolicy.configurations || {};
  const standard = configurations.standard || {};
  const bands = standard.groups && standard.groups[group] || [];
  if (product.family === "enrollable" && sizeRuleId && sizePolicy.id === sizeRuleId && bands.length) {
    const band = buscarBandaFabricacion10B_(bands, width, height);
    if (!band) {
      const alternatives = Object.keys(configurations).filter(function(id) { return id !== "standard"; }).map(function(id) {
        const alternative = configurations[id] || {};
        const alternativeBand = buscarBandaFabricacion10B_(alternative.groups && alternative.groups[group] || [], width, height);
        return alternativeBand ? {
          id: id,
          label: String(alternative.label || id),
          mechanism: String(alternativeBand.mechanism || ""),
          tube: String(alternativeBand.tube || ""),
          requiresConfirmedCost: alternative.requiresConfirmedCost !== false
        } : null;
      }).filter(Boolean);
      throw errorFabricacionEnrollable10B_(alternatives.length ?
        "La medida no cabe en la configuración Standard. Pentagrama ofrece otra configuración de fabricación." :
        "La tabla oficial de Pentagrama no contiene una configuración fabricable para esta medida.", alternatives);
    }

    const rollWidth = numeroCostos10B_(r.rollWidthMm, 0);
    let orientation = "normal";
    let requiresAuthorization = false;
    let warranty = true;
    if (rollWidth && width > rollWidth) {
      if (!r.canRotate) {
        throw errorFabricacionEnrollable10B_("El ancho supera el rollo y esta referencia no permite atravesar la tela.", []);
      }
      if (height <= rollWidth) {
        orientation = "atravesada";
      } else {
        orientation = "atravesada_y_anadida";
        requiresAuthorization = true;
        warranty = false;
      }
    }
    return {
      supported: true,
      ruleId: sizeRuleId,
      sizeGroup: group,
      configuration: "standard",
      orientation: orientation,
      requiresAuthorization: requiresAuthorization,
      warranty: warranty,
      mechanism: String(band.mechanism || ""),
      tube: String(band.tube || ""),
      source: String(sizePolicy.source || "Pentagrama")
    };
  }

  if ((r.maxWidthMm && width > r.maxWidthMm) || (r.maxHeightMm && height > r.maxHeightMm) || (r.maxRatio && height > width * r.maxRatio)) {
    throw new Error("Esta medida requiere confirmar fabricación y recargos con Pentagrama. Usa costo confirmado.");
  }
  return null;
}

function buscarBandaFabricacion10B_(bands, width, height) {
  return (bands || []).find(function(band) {
    return width <= numeroCostos10B_(band.maxWidthMm, 0) && height <= numeroCostos10B_(band.maxHeightMm, 0);
  }) || null;
}

function errorFabricacionEnrollable10B_(reason, alternatives) {
  const list = Array.isArray(alternatives) ? alternatives : [];
  const error = new Error(reason);
  error.code = list.length ? "ENROLLABLE_REQUIRES_ALTERNATIVE" : "ENROLLABLE_NOT_MANUFACTURABLE";
  error.reason = reason;
  error.requiresAlternative = list.length > 0;
  error.notManufacturable = list.length === 0;
  error.alternatives = list;
  return error;
}

function calcularComplemento10B_(id, catalog, width, height, today, quantity) {
  const p = catalog.products.find(function(p) { return p.id === id && p.active && p.family === "complemento-enrollable"; });
  if (!p) throw new Error("El complemento no está disponible.");
  validarVigenciaProducto10B_(p, today);
  validarMedidasEnrollable10B_(p, width, height, catalog);
  let factor;
  if (p.method === "linear-height") factor = height / 1000;
  else if (p.method === "linear-width") factor = width / 1000;
  else if (p.method === "unit") factor = 1;
  else throw new Error("Este complemento requiere confirmación de Pentagrama.");
  return dineroCostos10B_(Math.round(factor * p.rateCents * quantity));
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
  if (!sh) sh = ss.insertSheet(name);
  const targetRows = Math.max(Number(minRows || 100), 1);
  const targetCols = Math.max(Number(minCols || headers.length), headers.length);
  if (sh.getMaxRows() < targetRows) sh.insertRowsAfter(sh.getMaxRows(), targetRows - sh.getMaxRows());
  if (sh.getMaxColumns() < targetCols) sh.insertColumnsAfter(sh.getMaxColumns(), targetCols - sh.getMaxColumns());
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
