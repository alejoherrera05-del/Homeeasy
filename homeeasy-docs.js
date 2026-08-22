(function (window) {
  const FALLBACK = {
    "empresa.nombre_comercial": "HOMEEASY POPAYÁN",
    "empresa.razon_social": "",
    "empresa.nit": "1.061.760.852-1",
    "empresa.direccion": "Trav. 9 # 6N-26",
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
    "documentos.mostrar_email": false,
    "documentos.mostrar_web": false,
    "documentos.mostrar_whatsapp": false,
    "documentos.mostrar_instagram": true
  };

  const state = { promise: null, config: null, version: null };

  function boolValue(value) {
    if (typeof value === 'boolean') return value;
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'si' || raw === 'sí' || raw === 'yes';
  }

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value) {
    return clean(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function key(cfg, name, fallback) {
    const value = cfg && Object.prototype.hasOwnProperty.call(cfg, name) ? cfg[name] : undefined;
    if (value === undefined || value === null || value === '') {
      if (fallback !== undefined) return fallback;
      return FALLBACK[name] !== undefined ? FALLBACK[name] : '';
    }
    return value;
  }

  function displayWeb(value) {
    let text = clean(value);
    if (!text) return '';
    text = text.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return text;
  }

  function displayInstagram(value) {
    const text = clean(value);
    if (!text) return '';
    return text.startsWith('@') ? text : '@' + text;
  }

  function line(icon, text) {
    if (!clean(text)) return '';
    return '<span><i class="' + icon + '"></i> ' + escapeHtml(text) + '</span><br>';
  }

  function buildHeader(cfg) {
    const name = clean(key(cfg, 'empresa.nombre_comercial')) || FALLBACK['empresa.nombre_comercial'];
    const razon = clean(key(cfg, 'empresa.razon_social', ''));
    const nit = clean(key(cfg, 'empresa.nit'));
    const direccion = clean(key(cfg, 'empresa.direccion'));
    const telefono = clean(key(cfg, 'empresa.telefono'));
    const whatsapp = clean(key(cfg, 'empresa.whatsapp', ''));
    const email = clean(key(cfg, 'empresa.email', ''));
    const web = displayWeb(key(cfg, 'empresa.web', ''));
    const instagram = displayInstagram(key(cfg, 'empresa.instagram', ''));
    const showWhatsapp = boolValue(key(cfg, 'documentos.mostrar_whatsapp', false));
    const showEmail = boolValue(key(cfg, 'documentos.mostrar_email', false));
    const showWeb = boolValue(key(cfg, 'documentos.mostrar_web', false));
    const showInstagram = boolValue(key(cfg, 'documentos.mostrar_instagram', true));

    let html = '<b>' + escapeHtml(name.toUpperCase()) + '</b><br>';
    if (razon) html += '<span>' + escapeHtml(razon) + '</span><br>';
    if (nit) html += '<span><i class="fas fa-id-card"></i> NIT: ' + escapeHtml(nit) + '</span><br>';
    if (direccion) html += line('fas fa-map-marker-alt', direccion);
    if (telefono) html += line('fas fa-phone-alt', telefono);
    if (showWhatsapp && whatsapp) html += line('fab fa-whatsapp', whatsapp);
    if (showEmail && email) html += line('fas fa-envelope', email.toLowerCase());
    if (showWeb && web) html += line('fas fa-globe', web);
    if (showInstagram && instagram) html += line('fab fa-instagram', instagram);

    html = html.replace(/<br>$/, '');
    return html;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setHtml(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
  }

  function applyCommon(cfg, kind) {
    setHtml('empresa-info-header', buildHeader(cfg));
    const docTitleKey = kind === 'cotizacion'
      ? 'documentos.cotizacion.titulo'
      : kind === 'pedido'
        ? 'documentos.pedido.titulo'
        : 'documentos.recibo.titulo';
    setText('document-type', String(key(cfg, docTitleKey)).toUpperCase());
    setText('footer-creds', key(cfg, 'documentos.pie_principal'));
    setText('footer-system-line', key(cfg, 'documentos.pie_sistema'));
    document.title = 'HomeEasy | ' + String(key(cfg, docTitleKey)).trim();
  }

  function applyCotizacion(cfg) {
    const validez = clean(key(cfg, 'documentos.cotizacion.validez_dias', '15')) || '15';
    const medicion = clean(key(cfg, 'documentos.cotizacion.medicion_instalacion', ''));
    const formaPago = clean(key(cfg, 'documentos.cotizacion.forma_pago', ''));
    const lines = [
      '• Validez de la oferta: <b>' + escapeHtml(validez) + ' días calendario</b>.'
    ];
    if (medicion) lines.push('• ' + escapeHtml(medicion));
    if (formaPago) lines.push('• Forma de pago: ' + escapeHtml(formaPago));
    setHtml('condiciones-comerciales', lines.join('<br>'));
  }

  function applyPedido(cfg) {
    const garantia = clean(key(cfg, 'documentos.pedido.garantia_anios', '3')) || '3';
    const entrega = clean(key(cfg, 'documentos.pedido.entrega_dias_habiles', '10')) || '10';
    const saldo = clean(key(cfg, 'documentos.pedido.condicion_saldo', ''));
    const instalacion = clean(key(cfg, 'documentos.pedido.instalacion', ''));
    const lines = [
      '• <b>Garantía:</b> ' + escapeHtml(garantia) + ' años (aplica términos y condiciones).',
      '• <b>Tiempo de entrega:</b> ' + escapeHtml(entrega) + ' días hábiles.'
    ];
    if (saldo) lines.push('• <b>Saldo:</b> ' + escapeHtml(saldo));
    if (instalacion) lines.push('• <b>Instalación:</b> ' + escapeHtml(instalacion));
    setHtml('pedido-condiciones', lines.join('<br>'));
  }

  function applyRecibo() {}

  function apply(cfg, kind) {
    applyCommon(cfg, kind);
    if (kind === 'cotizacion') applyCotizacion(cfg);
    else if (kind === 'pedido') applyPedido(cfg);
    else applyRecibo(cfg);
  }

  function fetchConfig(url) {
    return fetch(url + '?tipo=GET_CONFIGURACION', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 'ok' && data.configuracion) {
          return {
            config: Object.assign({}, FALLBACK, data.configuracion),
            version: data.version || 1
          };
        }
        return { config: Object.assign({}, FALLBACK), version: 1 };
      })
      .catch(function () {
        return { config: Object.assign({}, FALLBACK), version: 1 };
      });
  }

  function init(options) {
    const opts = options || {};
    const url = opts.url || window.URL_G || '';
    const kind = opts.documentType || 'cotizacion';
    state.promise = fetchConfig(url).then(function (payload) {
      state.config = payload.config;
      state.version = payload.version;
      apply(state.config, kind);
      return payload;
    });
    return state.promise;
  }

  window.HomeEasyDocs = {
    init: init,
    apply: apply,
    key: key,
    state: state
  };
})(window);
