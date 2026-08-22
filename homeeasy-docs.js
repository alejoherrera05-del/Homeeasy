(function (window) {
  "use strict";

  const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec";
  const FALLBACK = {
    "empresa.nombre_comercial": "HOMEEASY POPAYÁN",
    "empresa.razon_social": "",
    "empresa.nit": "1061760852-1",
    "empresa.nit_formateado": "1.061.760.852-1",
    "empresa.direccion": "Trav. 9 # 6N-26",
    "empresa.ciudad": "Popayán",
    "empresa.telefono": "3334319374",
    "empresa.whatsapp": "",
    "empresa.email": "",
    "empresa.web": "",
    "empresa.instagram": "@homeeasypopayan",
    "empresa.eslogan": "Viste tu hogar con estilo",
    "documentos.cotizacion.titulo": "COTIZACIÓN",
    "documentos.cotizacion.validez_dias": "15",
    "documentos.cotizacion.medicion_instalacion": "Incluye toma de medidas e instalación GRATIS (Popayán).",
    "documentos.cotizacion.forma_pago": "50% anticipo, 50% contra entrega.",
    "documentos.pedido.titulo": "ORDEN DE PEDIDO",
    "documentos.pedido.garantia_anios": "3",
    "documentos.pedido.entrega_dias_habiles": "10",
    "documentos.pedido.condicion_saldo": "Se cancela contra entrega e instalación.",
    "documentos.pedido.instalacion": "Incluida en el valor total pactado.",
    "documentos.recibo.titulo": "RECIBO DE ABONO",
    "documentos.pie_principal": "HomeEasy - Viste tu hogar con estilo",
    "documentos.pie_sistema": "Documento generado automáticamente • Sistema Hommy V2.0",
    "documentos.mostrar_email": true,
    "documentos.mostrar_web": false,
    "documentos.mostrar_whatsapp": false,
    "documentos.mostrar_instagram": true
  };

  const state = {
    promise: null,
    configPromise: null,
    config: null,
    version: null,
    documentType: null
  };

  function flattenObject(value, prefix, result) {
    const out = result || {};
    const base = prefix || "";
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.keys(value).forEach(function (name) {
        const path = base ? base + "." + name : name;
        const item = value[name];
        if (item && typeof item === "object" && !Array.isArray(item)) flattenObject(item, path, out);
        else out[path] = item;
      });
    }
    return out;
  }

  function boolValue(value) {
    if (typeof value === "boolean") return value;
    const raw = String(value == null ? "" : value).trim().toLowerCase();
    return raw === "true" || raw === "1" || raw === "si" || raw === "sí" || raw === "yes";
  }

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeHtml(value) {
    return clean(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function key(cfg, name, fallback) {
    if (cfg && Object.prototype.hasOwnProperty.call(cfg, name)) {
      return cfg[name]; // Un valor vacío guardado significa “no mostrar”.
    }
    if (fallback !== undefined) return fallback;
    return FALLBACK[name] !== undefined ? FALLBACK[name] : "";
  }

  function normalizePhone(value) {
    return clean(value).replace(/\D/g, "");
  }

  function displayWeb(value) {
    return clean(value).replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }

  function displayInstagram(value) {
    const text = clean(value);
    return text && !text.startsWith("@") ? "@" + text : text;
  }

  function line(icon, text, extraClass) {
    if (!clean(text)) return "";
    return '<span' + (extraClass ? ' class="' + extraClass + '"' : '') + '><i class="' + icon + '"></i> ' + escapeHtml(text) + '</span><br>';
  }

  function combinedPhoneWhatsappLine(number) {
    if (!clean(number)) return "";
    return '<span class="homeeasy-contact-combined"><i class="fas fa-phone-alt"></i><i class="fab fa-whatsapp"></i> ' + escapeHtml(number) + '</span><br>';
  }

  function buildHeader(cfg) {
    const name = clean(key(cfg, "empresa.nombre_comercial")) || FALLBACK["empresa.nombre_comercial"];
    const legalName = clean(key(cfg, "empresa.razon_social", ""));
    const nit = clean(key(cfg, "empresa.nit_formateado", key(cfg, "empresa.nit")));
    const address = clean(key(cfg, "empresa.direccion", ""));
    const city = clean(key(cfg, "empresa.ciudad", ""));
    const phone = clean(key(cfg, "empresa.telefono", ""));
    const whatsapp = clean(key(cfg, "empresa.whatsapp", ""));
    const email = clean(key(cfg, "empresa.email", ""));
    const web = displayWeb(key(cfg, "empresa.web", ""));
    const instagram = displayInstagram(key(cfg, "empresa.instagram", ""));
    const showWhatsapp = boolValue(key(cfg, "documentos.mostrar_whatsapp", false));
    const showEmail = boolValue(key(cfg, "documentos.mostrar_email", true));
    const showWeb = boolValue(key(cfg, "documentos.mostrar_web", false));
    const showInstagram = boolValue(key(cfg, "documentos.mostrar_instagram", true));
    const location = [address, city].filter(Boolean).join(" · ");
    const samePhone = Boolean(phone && whatsapp && normalizePhone(phone) === normalizePhone(whatsapp));

    let html = '<b>' + escapeHtml(name.toUpperCase()) + '</b><br>';
    if (legalName && legalName.toLowerCase() !== name.toLowerCase()) {
      html += '<span class="legal-name">' + escapeHtml(legalName) + '</span><br>';
    }
    if (nit) html += '<span><i class="fas fa-id-card"></i> NIT: ' + escapeHtml(nit) + '</span><br>';
    if (location) html += line("fas fa-map-marker-alt", location);

    if (phone && showWhatsapp && samePhone) {
      html += combinedPhoneWhatsappLine(phone);
    } else {
      if (phone) html += line("fas fa-phone-alt", phone);
      if (showWhatsapp && whatsapp) html += line("fab fa-whatsapp", whatsapp);
    }

    if (showEmail && email) html += line("fas fa-envelope", email.toLowerCase());
    if (showWeb && web) html += line("fas fa-globe", web);
    if (showInstagram && instagram) html += line("fab fa-instagram", instagram);
    return html.replace(/<br>$/, "");
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setHtml(id, value) {
    const element = document.getElementById(id);
    if (element) element.innerHTML = value;
  }

  function applyCommon(cfg, kind) {
    setHtml("empresa-info-header", buildHeader(cfg));
    const companyHeader = document.getElementById("empresa-info-header");
    if (companyHeader) companyHeader.setAttribute("aria-busy", "false");
    const titleKey = kind === "cotizacion"
      ? "documentos.cotizacion.titulo"
      : kind === "pedido"
        ? "documentos.pedido.titulo"
        : "documentos.recibo.titulo";
    const title = String(key(cfg, titleKey)).toUpperCase();
    setText("document-type", title);
    setText("footer-creds", key(cfg, "documentos.pie_principal"));
    setText("footer-system-line", key(cfg, "documentos.pie_sistema"));
    document.title = "HomeEasy | " + title;
  }

  function applyCotizacion(cfg) {
    const validity = clean(key(cfg, "documentos.cotizacion.validez_dias", "15")) || "15";
    const measurement = clean(key(cfg, "documentos.cotizacion.medicion_instalacion", ""));
    const payment = clean(key(cfg, "documentos.cotizacion.forma_pago", ""));
    const lines = ['• Validez de la oferta: <b>' + escapeHtml(validity) + ' días calendario</b>.'];
    if (measurement) lines.push("• " + escapeHtml(measurement));
    if (payment) lines.push("• Forma de pago: " + escapeHtml(payment));
    setHtml("condiciones-comerciales", lines.join("<br>"));
  }

  function applyPedido(cfg) {
    const warranty = clean(key(cfg, "documentos.pedido.garantia_anios", "3")) || "3";
    const delivery = clean(key(cfg, "documentos.pedido.entrega_dias_habiles", "10")) || "10";
    const balance = clean(key(cfg, "documentos.pedido.condicion_saldo", ""));
    const installation = clean(key(cfg, "documentos.pedido.instalacion", ""));
    const lines = [
      '• <b>Garantía:</b> ' + escapeHtml(warranty) + ' años (aplica términos y condiciones).',
      '• <b>Tiempo de entrega:</b> ' + escapeHtml(delivery) + ' días hábiles.'
    ];
    if (balance) lines.push('• <b>Saldo:</b> ' + escapeHtml(balance));
    if (installation) lines.push('• <b>Instalación:</b> ' + escapeHtml(installation));
    setHtml("pedido-condiciones", lines.join("<br>"));
  }

  function apply(cfg, kind) {
    applyCommon(cfg, kind);
    if (kind === "cotizacion") applyCotizacion(cfg);
    if (kind === "pedido") applyPedido(cfg);
  }

  function fetchConfig(url) {
    const apiUrl = clean(url) || DEFAULT_API_URL;
    return fetch(apiUrl + "?tipo=GET_CONFIGURACION", { cache: "no-store" })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data && data.status === "ok" && data.configuracion) {
          const flat = flattenObject(data.configuracion);
          if (Object.prototype.hasOwnProperty.call(flat, "empresa.nit") && !clean(flat["empresa.nit"])) {
            flat["empresa.nit_formateado"] = "";
          }
          return { config: Object.assign({}, FALLBACK, flat), version: data.version || 1 };
        }
        return { config: Object.assign({}, FALLBACK), version: 1 };
      })
      .catch(function () {
        return { config: Object.assign({}, FALLBACK), version: 1 };
      });
  }

  function ensureConfig(url) {
    if (!state.configPromise) state.configPromise = fetchConfig(url);
    return state.configPromise;
  }

  function markReady() {
    document.documentElement.classList.remove("homeeasy-docs-loading");
    document.documentElement.classList.add("homeeasy-docs-ready");
  }

  function init(options) {
    const opts = options || {};
    const url = opts.url || window.URL_G || DEFAULT_API_URL;
    const kind = opts.documentType || state.documentType || "cotizacion";
    state.documentType = kind;
    state.promise = ensureConfig(url).then(function (payload) {
      state.config = payload.config;
      state.version = payload.version;
      apply(state.config, kind);
      markReady();
      return payload;
    });
    return state.promise;
  }

  function detectDocumentType() {
    const file = String(window.location && window.location.pathname ? window.location.pathname.split("/").pop() : "").toLowerCase();
    if (file === "cotizacion.html") return "cotizacion";
    if (file === "pedido.html") return "pedido";
    if (file === "abono.html") return "recibo";
    return null;
  }

  function installLoadingGuard() {
    document.documentElement.classList.add("homeeasy-docs-loading");
    if (document.getElementById("homeeasy-docs-loading-style")) return;
    const style = document.createElement("style");
    style.id = "homeeasy-docs-loading-style";
    style.textContent =
      "html.homeeasy-docs-loading .empresa-info-header," +
      "html.homeeasy-docs-loading #document-type," +
      "html.homeeasy-docs-loading #condiciones-comerciales," +
      "html.homeeasy-docs-loading #pedido-condiciones," +
      "html.homeeasy-docs-loading #footer-creds," +
      "html.homeeasy-docs-loading #footer-system-line{" +
      "visibility:hidden!important;opacity:0!important;}" +
      ".empresa-info-header,.preview-company,#document-type,#condiciones-comerciales,#pedido-condiciones,#footer-creds,#footer-system-line{" +
      "transition:opacity .16s ease;}" +
      ".homeeasy-contact-combined i+ i{margin-left:1px;}";
    document.head.appendChild(style);
  }

  const autoType = detectDocumentType();
  if (autoType) {
    state.documentType = autoType;
    installLoadingGuard();
    state.configPromise = fetchConfig(DEFAULT_API_URL); // Empieza antes de que termine de dibujarse el formulario.
    const autoInit = function () { init({ url: DEFAULT_API_URL, documentType: autoType }); };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", autoInit, { once: true });
    } else {
      autoInit();
    }
  }

  window.HomeEasyDocs = Object.freeze({
    init: init,
    apply: apply,
    key: key,
    flattenObject: flattenObject,
    buildHeaderHtml: buildHeader,
    normalizePhone: normalizePhone,
    state: state
  });
})(window);
