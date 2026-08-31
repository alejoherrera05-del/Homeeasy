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
    "documentos.pie_sistema": "Documento generado automáticamente • Sistema Hommy V3.0",
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

  function normalizePublicVersion(value) {
    return clean(value)
      .replace(/\bV2\.0\b/gi, "V3.0")
      .replace(/\b2\.0\b/g, "3.0");
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
    setText("footer-system-line", normalizePublicVersion(key(cfg, "documentos.pie_sistema")));
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

  function ensureMobileTextEditorStyle() {
    if (document.getElementById("homeeasy-mobile-text-editor-style")) return;
    const style = document.createElement("style");
    style.id = "homeeasy-mobile-text-editor-style";
    style.textContent = `
      html.homeeasy-text-editor-open,body.homeeasy-text-editor-open{
        overflow:hidden!important;overscroll-behavior:none!important;
      }
      .homeeasy-expanded-text-source{
        cursor:pointer;touch-action:manipulation;font-size:16px!important;-webkit-text-size-adjust:100%;
      }
      .homeeasy-text-editor-overlay{
        --homeeasy-editor-height:100dvh;
        position:fixed;left:0;right:0;top:0;bottom:auto;height:var(--homeeasy-editor-height);box-sizing:border-box;
        z-index:12000;display:flex;align-items:flex-end;justify-content:center;
        padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));
        background:rgba(45,35,39,.18);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);
        opacity:0;visibility:hidden;pointer-events:none;
        transition:opacity .18s ease,visibility .18s ease;
      }
      .homeeasy-text-editor-overlay.is-open{opacity:1;visibility:visible;pointer-events:auto;}
      .homeeasy-text-editor-panel{
        width:min(100%,580px);height:min(86%,560px);min-height:0;max-height:100%;
        display:flex;flex-direction:column;overflow:hidden;
        background:rgba(255,255,255,.985);border:1px solid rgba(166,69,90,.12);border-radius:24px;
        box-shadow:0 20px 64px rgba(68,42,50,.22),inset 0 1px 0 rgba(255,255,255,.9);
      }
      .homeeasy-text-editor-handle{width:38px;height:4px;border-radius:999px;background:#DED7DA;margin:9px auto 3px;flex:0 0 auto;}
      .homeeasy-text-editor-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 18px 10px;flex:0 0 auto;}
      .homeeasy-text-editor-heading{min-width:0;text-align:left;}
      .homeeasy-text-editor-title{margin:0;color:#302A2D;font:700 1.02rem/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;letter-spacing:-.015em;}
      .homeeasy-text-editor-caption{margin:4px 0 0;color:#8B8387;font:500 .72rem/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;}
      .homeeasy-text-editor-done{border:0;background:rgba(166,69,90,.09);color:#A6455A;border-radius:999px;padding:9px 14px;font:700 .82rem/1 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;flex:0 0 auto;}
      .homeeasy-text-editor-done:active{transform:scale(.96);}
      .homeeasy-text-editor-body{display:flex;flex:1;min-height:0;padding:4px 14px 14px;}
      .homeeasy-text-editor-input{
        display:block;width:100%;height:100%;min-height:0;resize:none;overflow:auto;-webkit-overflow-scrolling:touch;
        border:1px solid rgba(60,60,67,.11);outline:0;border-radius:18px;background:#FAF8F9;color:#2D282A;
        padding:16px 16px 24px;font:500 16px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif!important;
        caret-color:#A6455A;box-shadow:inset 0 1px 2px rgba(43,31,36,.025);scroll-padding:16px;-webkit-text-size-adjust:100%;
      }
      .homeeasy-text-editor-input:focus{border-color:rgba(166,69,90,.34);background:#fff;box-shadow:0 0 0 4px rgba(166,69,90,.07);}
      .homeeasy-text-editor-overlay.is-compact .homeeasy-text-editor-handle{margin:6px auto 1px;}
      .homeeasy-text-editor-overlay.is-compact .homeeasy-text-editor-header{padding:8px 14px 8px;}
      .homeeasy-text-editor-overlay.is-compact .homeeasy-text-editor-caption{display:none;}
      .homeeasy-text-editor-overlay.is-compact .homeeasy-text-editor-body{padding:2px 10px 10px;}
      .homeeasy-text-editor-overlay.is-compact .homeeasy-text-editor-input{border-radius:16px;padding:12px 14px 18px;}
      @media (min-width:821px) and (pointer:fine){.homeeasy-text-editor-overlay{display:none!important;}}
      @media (prefers-reduced-motion:reduce){.homeeasy-text-editor-overlay{transition:none!important;}}
    `;
    document.head.appendChild(style);
  }

  function installMobileTextEditor(options) {
    const opts = options || {};
    const target = document.getElementById(opts.targetId || "notas");
    if (!target || target.dataset.homeeasyExpandedEditor === "1") return null;
    target.dataset.homeeasyExpandedEditor = "1";
    ensureMobileTextEditorStyle();

    const mobileQuery = window.matchMedia("(max-width: 820px), (pointer: coarse)");
    const originalReadOnly = Boolean(target.readOnly);
    const originalTabIndex = target.getAttribute("tabindex");
    const originalInputMode = target.getAttribute("inputmode");
    const overlay = document.createElement("div");
    overlay.className = "homeeasy-text-editor-overlay no-print";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <section class="homeeasy-text-editor-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(opts.title || "Editar observaciones")}">
        <div class="homeeasy-text-editor-handle" aria-hidden="true"></div>
        <header class="homeeasy-text-editor-header">
          <div class="homeeasy-text-editor-heading">
            <h2 class="homeeasy-text-editor-title">${escapeHtml(opts.title || "Editar observaciones")}</h2>
            <p class="homeeasy-text-editor-caption">Escribe y desplázate con libertad. El texto se conserva al cerrar.</p>
          </div>
          <button type="button" class="homeeasy-text-editor-done">Listo</button>
        </header>
        <div class="homeeasy-text-editor-body">
          <textarea class="homeeasy-text-editor-input" spellcheck="true"></textarea>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    const editor = overlay.querySelector(".homeeasy-text-editor-input");
    const done = overlay.querySelector(".homeeasy-text-editor-done");
    let open = false;
    let pageLock = null;

    function restoreAttribute(name, value) {
      if (value === null) target.removeAttribute(name);
      else target.setAttribute(name, value);
    }

    function syncMode() {
      const mobile = mobileQuery.matches;
      target.readOnly = mobile ? true : originalReadOnly;
      target.classList.toggle("homeeasy-expanded-text-source", mobile);
      target.setAttribute("aria-haspopup", mobile ? "dialog" : "false");
      if (mobile) {
        target.setAttribute("tabindex", "-1");
        target.setAttribute("inputmode", "none");
      } else {
        restoreAttribute("tabindex", originalTabIndex);
        restoreAttribute("inputmode", originalInputMode);
      }
      if (!mobile && open) closeEditor();
    }

    function syncViewport() {
      if (!open) return;
      const viewport = window.visualViewport;
      const viewportHeight = Math.round(viewport && viewport.height ? viewport.height : (window.innerHeight || document.documentElement.clientHeight || 0));
      if (viewportHeight > 0) overlay.style.setProperty("--homeeasy-editor-height", viewportHeight + "px");
      overlay.classList.toggle("is-compact", viewportHeight > 0 && viewportHeight < 560);
    }

    function lockPage() {
      if (pageLock) return;
      const bodyStyle = document.body.style;
      pageLock = {
        scrollY: window.pageYOffset || document.documentElement.scrollTop || 0,
        position: bodyStyle.position,
        top: bodyStyle.top,
        left: bodyStyle.left,
        right: bodyStyle.right,
        width: bodyStyle.width,
        overflow: bodyStyle.overflow
      };
      document.documentElement.classList.add("homeeasy-text-editor-open");
      document.body.classList.add("homeeasy-text-editor-open");
      bodyStyle.position = "fixed";
      bodyStyle.top = "-" + pageLock.scrollY + "px";
      bodyStyle.left = "0";
      bodyStyle.right = "0";
      bodyStyle.width = "100%";
      bodyStyle.overflow = "hidden";
    }

    function unlockPage() {
      if (!pageLock) return;
      const lock = pageLock;
      pageLock = null;
      const bodyStyle = document.body.style;
      bodyStyle.position = lock.position;
      bodyStyle.top = lock.top;
      bodyStyle.left = lock.left;
      bodyStyle.right = lock.right;
      bodyStyle.width = lock.width;
      bodyStyle.overflow = lock.overflow;
      document.documentElement.classList.remove("homeeasy-text-editor-open");
      document.body.classList.remove("homeeasy-text-editor-open");
      window.scrollTo(0, lock.scrollY);
      window.requestAnimationFrame(function () { window.scrollTo(0, lock.scrollY); });
    }

    function commit() {
      target.value = editor.value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function focusEditor() {
      editor.scrollTop = 0;
      try { editor.focus({ preventScroll: true }); } catch (error) { editor.focus(); }
      const end = editor.value.length;
      window.requestAnimationFrame(syncViewport);
      window.setTimeout(function () {
        syncViewport();
        try { editor.setSelectionRange(end, end); } catch (error) {}
        editor.scrollTop = editor.scrollHeight;
      }, 180);
      window.setTimeout(syncViewport, 340);
    }

    function openEditor() {
      if (!mobileQuery.matches || open) return;
      open = true;
      editor.value = target.value || "";
      lockPage();
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
      syncViewport();
      focusEditor();
    }

    function closeEditor() {
      if (!open) return;
      commit();
      editor.blur();
      open = false;
      overlay.classList.remove("is-open", "is-compact");
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.removeProperty("--homeeasy-editor-height");
      target.blur();
      unlockPage();
    }

    function openFromSource(event) {
      if (!mobileQuery.matches) return;
      if (event && event.cancelable) event.preventDefault();
      target.blur();
      openEditor();
    }

    if (window.PointerEvent) {
      target.addEventListener("pointerdown", openFromSource);
    } else {
      target.addEventListener("touchstart", openFromSource, { passive: false });
    }
    target.addEventListener("click", openFromSource);
    target.addEventListener("focus", function () {
      if (!mobileQuery.matches) return;
      target.blur();
      openEditor();
    });
    editor.addEventListener("input", function () { target.value = editor.value; });
    done.addEventListener("click", closeEditor);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) closeEditor(); });
    document.addEventListener("keydown", function (event) { if (open && event.key === "Escape") closeEditor(); });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", syncViewport);
    window.addEventListener("resize", syncViewport);
    if (typeof mobileQuery.addEventListener === "function") mobileQuery.addEventListener("change", syncMode);
    syncMode();
    return { open: openEditor, close: closeEditor, overlay: overlay, target: target };
  }

  function preparePaginatedClone(clonedDoc, options) {
    const opts = options || {};
    const area = clonedDoc.getElementById(opts.areaId || "area-pdf");
    if (!area) return { pages: 1, breaks: 0 };

    const pageWidthPx = Number(opts.pageWidthPx || 800);
    const pageHeightPx = Number(opts.pageHeightPx || (pageWidthPx * 279.4 / 215.9));
    const tableBody = clonedDoc.querySelector(opts.tableBodySelector || "#tabla-body");
    const tableHeader = clonedDoc.querySelector("thead tr");
    let breaks = 0;

    area.style.overflow = "visible";
    area.style.minHeight = pageHeightPx + "px";

    function topWithinArea(element) {
      return element.getBoundingClientRect().top - area.getBoundingClientRect().top;
    }

    function bottomWithinArea(element) {
      return element.getBoundingClientRect().bottom - area.getBoundingClientRect().top;
    }

    function crossesBoundary(element) {
      const top = topWithinArea(element);
      const bottom = bottomWithinArea(element);
      if (bottom - top >= pageHeightPx - 4) return false;
      return Math.floor((top + .5) / pageHeightPx) !== Math.floor((bottom - .5) / pageHeightPx);
    }

    function remainingOnPage(element) {
      const top = Math.max(0, topWithinArea(element));
      const mod = ((top % pageHeightPx) + pageHeightPx) % pageHeightPx;
      return pageHeightPx - mod;
    }

    function addTableBreak(row) {
      if (!tableBody || !crossesBoundary(row)) return;
      const gap = remainingOnPage(row);
      if (gap <= 1 || gap >= pageHeightPx - 1) return;
      const spacer = clonedDoc.createElement("tr");
      spacer.className = "pdf-smart-page-spacer";
      spacer.setAttribute("aria-hidden", "true");
      const cell = clonedDoc.createElement("td");
      cell.colSpan = Math.max(1, row.children.length || (tableHeader ? tableHeader.children.length : 4));
      cell.style.cssText = "height:" + gap + "px!important;min-height:" + gap + "px!important;padding:0!important;border:0!important;background:#fff!important;line-height:0!important;font-size:0!important;";
      spacer.style.cssText = "height:" + gap + "px!important;border:0!important;background:#fff!important;";
      spacer.appendChild(cell);
      tableBody.insertBefore(spacer, row);
      if (opts.repeatTableHeader !== false && tableHeader) {
        const repeat = tableHeader.cloneNode(true);
        repeat.classList.add("pdf-repeat-table-header");
        repeat.querySelectorAll(".no-print").forEach(function (node) { node.remove(); });
        tableBody.insertBefore(repeat, row);
      }
      breaks += 1;
    }

    function addBlockBreak(element) {
      if (!element || !element.parentNode || !crossesBoundary(element)) return;
      const gap = remainingOnPage(element);
      if (gap <= 1 || gap >= pageHeightPx - 1) return;
      const spacer = clonedDoc.createElement("div");
      spacer.className = "pdf-smart-page-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.style.cssText = "display:block!important;width:100%!important;height:" + gap + "px!important;min-height:" + gap + "px!important;flex:0 0 " + gap + "px!important;background:#fff!important;";
      element.parentNode.insertBefore(spacer, element);
      breaks += 1;
    }

    if (tableBody) {
      Array.from(tableBody.querySelectorAll(":scope > tr")).forEach(function (row) {
        if (!row.classList.contains("pdf-smart-page-spacer") && !row.classList.contains("pdf-repeat-table-header")) addTableBreak(row);
      });
    }

    const notes = clonedDoc.querySelector(opts.notesSelector || "#notas");
    const notesBlock = notes ? (notes.closest(".mb-4") || notes.parentElement) : null;
    addBlockBreak(notesBlock);
    addBlockBreak(clonedDoc.querySelector(opts.summarySelector || ".row.g-4.mt-auto"));
    addBlockBreak(clonedDoc.querySelector(opts.footerSelector || ".pdf-footer"));

    const totalHeight = area.getBoundingClientRect().height;
    const pages = Math.max(1, Math.ceil((totalHeight - .5) / pageHeightPx));
    const targetHeight = pages * pageHeightPx;
    const tailGap = targetHeight - totalHeight;
    if (tailGap > 1) {
      const tail = clonedDoc.createElement("div");
      tail.className = "pdf-smart-page-tail";
      tail.setAttribute("aria-hidden", "true");
      tail.style.cssText = "display:block!important;width:100%!important;height:" + tailGap + "px!important;min-height:" + tailGap + "px!important;flex:0 0 " + tailGap + "px!important;background:#fff!important;";
      area.appendChild(tail);
    }
    area.dataset.pdfSmartPages = String(pages);
    area.dataset.pdfSmartBreaks = String(breaks);
    return { pages: pages, breaks: breaks };
  }

  const autoType = detectDocumentType();
  if (autoType) {
    state.documentType = autoType;
    installLoadingGuard();
    state.configPromise = fetchConfig(DEFAULT_API_URL); // Empieza antes de que termine de dibujarse el formulario.
    const autoInit = function () {
      init({ url: DEFAULT_API_URL, documentType: autoType });
      if (autoType === "cotizacion" || autoType === "pedido") {
        installMobileTextEditor({
          targetId: "notas",
          title: autoType === "pedido" ? "Observaciones de fabricación" : "Observaciones especiales"
        });
      }
    };
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
    installMobileTextEditor: installMobileTextEditor,
    preparePaginatedClone: preparePaginatedClone,
    state: state
  });
})(window);
