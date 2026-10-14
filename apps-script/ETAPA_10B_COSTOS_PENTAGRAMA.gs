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

const HOMEEASY_RING_SOURCE_SHA256_10B = "1c313dcd421259ada7493329a9fa97672f27e8a1df03e57e4b1e5a1bf7c363be";
const HOMEEASY_RING_CATALOG_GZIP_B64_10B = "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";
let HOMEEASY_RING_ROWS_CACHE_10B_ = null;

function filasRingCertificadas10B_() {
  if (HOMEEASY_RING_ROWS_CACHE_10B_) return HOMEEASY_RING_ROWS_CACHE_10B_;
  const bytes = Utilities.base64Decode(HOMEEASY_RING_CATALOG_GZIP_B64_10B);
  const json = Utilities.ungzip(Utilities.newBlob(bytes, "application/gzip")).getDataAsString("UTF-8");
  const rows = JSON.parse(json);
  if (!Array.isArray(rows) || rows.length !== 238) throw new Error("El catálogo certificado de Cortina Ring está incompleto.");
  HOMEEASY_RING_ROWS_CACHE_10B_ = rows;
  return rows;
}

function productosRingCertificados10B_(catalogVersion, validThrough) {
  const typeLabels = { B: "Blackout", T: "Traslúcido", V: "Velo" };
  return filasRingCertificadas10B_().map(function(row) {
    const active = row[5] === 1 && Number(row[4] || 0) > 0;
    return {
      id: String(row[0]),
      family: "ring",
      familyName: "Cortina Ring",
      name: String(row[2]),
      type: typeLabels[row[1]] || String(row[1]),
      method: "area",
      rateCents: Number(row[4] || 0),
      minHeightMm: 0,
      minAreaMm2: 0,
      extraDiscount: 0,
      promotional: false,
      configuration: "Sistema Ring al 2.0 · tubo con anillos. Configuración Pentagrama: color de anillos, recogida, altura de confección, bajo, dirección de tela y correa opcional.",
      active: active,
      status: active ? "VIGENTE" : "REVIEW_REQUIRED",
      validThrough: validThrough,
      version: catalogVersion,
      currency: "COP",
      pricesIncludeVat: true,
      matrixCells: [],
      rules: {
        source: "PENTAGRAMA_LIVE_RING_2026-10-14",
        sourceSha256: HOMEEASY_RING_SOURCE_SHA256_10B,
        productCode: String(row[3]),
        groupCode: "1346",
        associationGroup: "RIECORIN",
        note: "Sistema Ring al 2.0. Define color de anillos, recogida, altura de confección, bajo y dirección de tela según el pedido."
      }
    };
  });
}

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
  COSTOS_SYNC_COST: "config.read",
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
  if (tipo === "COSTOS_SYNC_COST") return calcularCotizacionCostos10B_(ss, data);
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
  const tipo = String(data && data.tipo || "").trim();
  if ((tipo === "COSTOS_SYNC_READ" || tipo === "COSTOS_SYNC_COST") && autorizarServicioPentagramaSync10D_(data)) {
    return { ok: true, validation: { usuario: "Pentagrama Scheduler", email: "scheduler@homeeasy", userId: "PENTAGRAMA_SCHEDULER" } };
  }
  if (typeof validarPermisoSesionAuth9B_ !== "function") {
    return { ok: false, response: { status: "error", code: "COST_AUTH_UNAVAILABLE", msg: "El núcleo de sesión HomeEasy no está disponible." } };
  }
  const token = String(data && data.appSessionToken || "").trim();
  const meta = data && data.meta && typeof data.meta === "object" ? data.meta : {};
  const check = validarPermisoSesionAuth9B_(ss, token, meta, permission);
  if (check.response) return { ok: false, response: check.response };
  return { ok: true, validation: check.validation };
}

function autorizarServicioPentagramaSync10D_(data) {
  const supplied = String(data && data.pentagramaSyncKey || "").trim();
  const expected = String(PropertiesService.getScriptProperties().getProperty("HOMEEASY_PENTAGRAMA_SYNC_KEY") || "").trim();
  if (!supplied || !expected) return false;
  const suppliedHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, supplied, Utilities.Charset.UTF_8)
    .map(function(value) { return (value < 0 ? value + 256 : value).toString(16).padStart(2, "0"); }).join("");
  if (suppliedHash.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < suppliedHash.length; i++) difference |= suppliedHash.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
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

  const catalogVersion = String(config.VERSION_CATALOGO || (products[0] && products[0].version) || "").trim();
  const catalogValidThrough = normalizarFechaCostos10B_(config.VIGENTE_HASTA || (products[0] && products[0].validThrough) || "");
  const ringProducts = productosRingCertificados10B_(catalogVersion, catalogValidThrough);
  // La Sheet es la fuente editable. Si una referencia Ring ya existe allí,
  // su fila (incluido un override inactivo) reemplaza el snapshot certificado.
  const storedIds = {};
  products.forEach(function(product) { storedIds[String(product.id)] = true; });
  ringProducts.forEach(function(product) {
    if (!storedIds[String(product.id)]) products.push(product);
  });

  const catalog = {
    version: catalogVersion,
    validThrough: catalogValidThrough,
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
