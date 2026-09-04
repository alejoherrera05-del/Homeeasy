(() => {
  'use strict';

  if (window.__HOMEEASY_SEGUIMIENTO_HOMMY_10B__) return;
  window.__HOMEEASY_SEGUIMIENTO_HOMMY_10B__ = true;

  const API_BASE = String(window.HOMMY_API_BASE || 'https://homeeasy-hommy-staging.onrender.com').replace(/\/$/, '');
  const ENDPOINT = `${API_BASE}/api/hommy/followup/plan`;
  const HISTORY_ENDPOINT = `${API_BASE}/api/hommy/followup/history`;
  const STYLE_ID = 'homeeasy-followup-hommy-10b-style';
  const REQUEST_TIMEOUT_MS = 90_000;
  const HISTORY_TIMEOUT_MS = 45_000;
  const historyCache = new Map();
  const radarCache = new Map();
  const planCache = new Map();
  const PLAN_CACHE_PREFIX = 'homeeasy:seguimiento:hommy-plan:10f1:';
  const RADAR_CACHE_PREFIX = 'homeeasy:seguimiento:hommy-radar:10f1:';
  const CACHE_OWNER_KEY = 'homeeasy:seguimiento:hommy-cache-owner:10f1';
  const PLAN_FRESH_MS = 5 * 60 * 1000;
  const PLAN_MAX_AGE_MS = 2 * 60 * 60 * 1000;
  const RADAR_FRESH_MS = 2 * 60 * 1000;
  const RADAR_MAX_AGE_MS = 30 * 60 * 1000;
  const BACKGROUND_REFRESH_MS = 3 * 60 * 1000;
  const BACKGROUND_WARMUP_DELAY_MS = 260;
  const INITIAL_RADAR_WARM_COUNT = 8;
  const MAX_RADAR_WORKERS = 3;
  const radarQueue = [];
  const queuedRadar = new Set();
  const visibleQuotes = new Set();
  let radarWorkers = 0;
  let refreshTimer = null;
  let cardVisibilityObserver = null;
  const TRANSIENT_RETRY_DELAY_MS = 700;
  const TRANSIENT_ANALYSIS_CODES = new Set([
    'AUTH_UPSTREAM_TIMEOUT',
    'AUTH_UPSTREAM_UNAVAILABLE',
    'FOLLOWUP_UPSTREAM_TIMEOUT',
    'FOLLOWUP_UPSTREAM_UNAVAILABLE'
  ]);
  const HOME_EASY_API = String(window.HomeEasyCore && window.HomeEasyCore.API_URL || 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec');

  const DECISION_LABELS = Object.freeze({
    SEND: 'Borrador recomendado',
    WAIT: 'Esperar',
    STOP: 'Detener',
    HUMAN_REVIEW: 'Revisión humana'
  });

  const REASON_LABELS = Object.freeze({
    INSUFFICIENT_CONTEXT: 'Falta contexto',
    FOLLOWUP_DUE: 'Seguimiento oportuno',
    CUSTOMER_WAIT_REQUEST: 'Fecha acordada',
    PRICE_OBJECTION: 'Objeción de precio',
    DECISION_PARTNER: 'Decisión compartida',
    PRODUCT_QUESTION: 'Duda de producto',
    CHANGE_REQUESTED: 'Cambio solicitado',
    PAYMENT_QUESTION: 'Consulta de pago',
    DELIVERY_QUESTION: 'Consulta de entrega',
    HIGH_INTENT: 'Intención alta',
    STOP_SIGNAL: 'Condición de cierre',
    HUMAN_REQUIRED: 'Requiere asesor',
    NO_NEW_VALUE: 'Sin motivo nuevo',
    COLD_CLOSE: 'Cierre elegante',
    OTHER: 'Análisis comercial'
  });

  const INTENT_LABELS = Object.freeze({
    NEW_QUOTE: 'Nueva cotización',
    NO_RESPONSE: 'Sin respuesta',
    EVALUATING: 'Evaluando',
    NEEDS_DECISION_PARTNER: 'Decisión compartida',
    PRICE_OBJECTION: 'Precio',
    PRODUCT_QUESTION: 'Duda de producto',
    CHANGE_REQUESTED: 'Cambio solicitado',
    PAYMENT_QUESTION: 'Pago',
    DELIVERY_QUESTION: 'Entrega',
    READY_TO_BUY: 'Listo para comprar',
    WAITING_UNTIL_DATE: 'Esperando fecha',
    NOT_INTERESTED: 'No interesado',
    DO_NOT_CONTACT: 'No contactar',
    HUMAN_REQUIRED: 'Revisión humana'
  });

  const TEMPERATURE_LABELS = Object.freeze({
    HIGH: 'Alta',
    ACTIVE: 'Activa',
    WAITING: 'En espera',
    RISK: 'En riesgo',
    COLD: 'Fría'
  });

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function sessionToken() {
    return window.HomeEasyAuth && typeof window.HomeEasyAuth.getAppSessionToken === 'function'
      ? clean(window.HomeEasyAuth.getAppSessionToken())
      : '';
  }

  function metaHeader() {
    try {
      const meta = window.HomeEasyCore && typeof window.HomeEasyCore.buildMeta === 'function'
        ? window.HomeEasyCore.buildMeta()
        : {};
      const bytes = new TextEncoder().encode(JSON.stringify(meta));
      let binary = '';
      bytes.forEach(byte => { binary += String.fromCharCode(byte); });
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    } catch (_) {
      return '';
    }
  }

  function authenticatedHeaders() {
    const token = sessionToken();
    if (!token) {
      const error = new Error('Tu sesión de HomeEasy no está disponible.');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    const headers = {
      'Content-Type': 'application/json',
      'X-HomeEasy-Session': token
    };
    const meta = metaHeader();
    if (meta) headers['X-HomeEasy-Meta'] = meta;
    return headers;
  }

  async function recoverSession() {
    const auth = window.HomeEasyAuth;
    if (!auth || typeof auth.restoreHomeEasySession !== 'function') return false;
    try {
      const restored = await auth.restoreHomeEasySession({
        validateFirebase: false,
        reopen: true,
        silent: true,
        preferCache: false,
        meta: window.HomeEasyCore && typeof window.HomeEasyCore.buildMeta === 'function'
          ? window.HomeEasyCore.buildMeta()
          : {}
      });
      return Boolean(restored && sessionToken());
    } catch (_) {
      return false;
    }
  }

  async function requestPlan(numero, allowRecovery = true) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: authenticatedHeaders(),
        body: JSON.stringify({ numero: clean(numero) }),
        signal: controller.signal,
        cache: 'no-store'
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        const timeout = new Error('Hommy tardó demasiado en responder. Intenta nuevamente.');
        timeout.code = 'FOLLOWUP_TIMEOUT';
        throw timeout;
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }

    let payload = null;
    try { payload = await response.json(); } catch (_) {}

    const code = clean(payload && payload.error && payload.error.code).toUpperCase();
    if (response.status === 401 && allowRecovery && ['AUTH_REQUIRED', 'APP_SESSION_EXPIRED', 'APP_SESSION_REJECTED', 'NO_SESSION'].includes(code || 'AUTH_REQUIRED')) {
      if (await recoverSession()) return requestPlan(numero, false);
    }

    if (!response.ok || !payload || payload.ok !== true) {
      const error = new Error(
        clean(payload && payload.error && payload.error.message) ||
        (response.status === 403 ? 'Tu perfil no tiene permiso para analizar esta cotización.' : 'No fue posible completar el análisis con Hommy.')
      );
      error.code = code || `HTTP_${response.status}`;
      throw error;
    }

    if (payload.reviewOnly !== true || !payload.plan || typeof payload.plan !== 'object') {
      const error = new Error('Hommy devolvió una respuesta incompleta.');
      error.code = 'FOLLOWUP_INVALID_RESPONSE';
      throw error;
    }
    return payload;
  }


  async function requestHistory(numero, allowRecovery = true) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(HISTORY_ENDPOINT, {
        method: 'POST',
        headers: authenticatedHeaders(),
        body: JSON.stringify({ numero: clean(numero) }),
        signal: controller.signal,
        cache: 'no-store'
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        const timeout = new Error('El historial tardó demasiado en responder.');
        timeout.code = 'FOLLOWUP_UPSTREAM_TIMEOUT';
        throw timeout;
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }

    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    const code = clean(payload && payload.error && payload.error.code).toUpperCase();
    if (response.status === 401 && allowRecovery && ['AUTH_REQUIRED', 'APP_SESSION_EXPIRED', 'APP_SESSION_REJECTED', 'NO_SESSION'].includes(code || 'AUTH_REQUIRED')) {
      if (await recoverSession()) return requestHistory(numero, false);
    }
    if (!response.ok || !payload || payload.ok !== true || !Array.isArray(payload.history)) {
      const error = new Error(clean(payload && payload.error && payload.error.message) || 'No fue posible cargar el historial comercial.');
      error.code = code || `HTTP_${response.status}`;
      const retryAfter = Number(response.headers && typeof response.headers.get === 'function' ? response.headers.get('Retry-After') : 0);
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterSeconds = retryAfter;
      throw error;
    }
    return payload;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .he-hommy-followup{margin-top:13px;border:1px solid rgba(178,86,108,.12);border-radius:16px;background:linear-gradient(180deg,#fff 0%,#fcf8f9 100%);overflow:hidden}
      .he-hommy-idle{padding:11px}
      .he-hommy-radar-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:8px}
      .he-hommy-radar-brand{display:flex;align-items:center;gap:8px;min-width:0}
      .he-hommy-radar-mark{width:29px;height:29px;border-radius:9px;background:#f8eef1;color:#b2566c;display:grid;place-items:center;flex:0 0 auto}
      .he-hommy-radar-brand strong{display:block;color:#413b3e;font-size:12.5px;line-height:1.05;font-weight:760}
      .he-hommy-radar-brand small{display:block;margin-top:2px!important;text-align:left!important;color:#918a8e!important;font-size:9.8px!important;font-weight:560!important}
      .he-hommy-radar-signal{min-height:26px;padding:0 9px;border-radius:999px;background:#f4f3f4;color:#716b6f;display:inline-flex;align-items:center;font-size:10.2px;font-weight:760;white-space:nowrap}
      .he-hommy-radar-chips{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px}
      .he-hommy-radar-chip{min-height:24px;padding:0 7px;border-radius:8px;background:#f5f4f5;color:#716b6f;display:inline-flex;align-items:center;font-size:10px;font-weight:680}
      .he-hommy-radar-chip.address{background:#fbf5e8;color:#8d6b2c}
      .he-hommy-radar-note{margin:0 1px 9px;color:#918a8e;font-size:10.2px;line-height:1.35;font-weight:560}
      .he-hommy-cache-note{margin:8px 0 0;color:#918a8e;font-size:10px;line-height:1.3;font-weight:560}
      .he-hommy-analyze{width:100%;min-height:44px;border:1px solid rgba(178,86,108,.16);border-radius:13px;background:#fff;color:#9c485d;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:720;font-size:13px;box-shadow:0 6px 16px rgba(70,42,51,.04)}
      .he-hommy-analyze:active{transform:scale(.985)}
      .he-hommy-analyze:disabled{opacity:.62;cursor:wait;transform:none}
      .he-hommy-idle small{display:block;margin:7px 2px 0;text-align:center;color:#918a8e;font-size:11.5px;line-height:1.25;font-weight:540}
      .he-hommy-loading{padding:14px;display:flex;align-items:center;gap:10px;color:#6f676b;font-size:12.5px;font-weight:620}
      .he-hommy-spinner{width:18px;height:18px;border:2px solid rgba(178,86,108,.15);border-top-color:#b2566c;border-radius:50%;animation:heHommySpin .8s linear infinite;flex:0 0 auto}
      @keyframes heHommySpin{to{transform:rotate(360deg)}}
      .he-hommy-result{padding:14px}
      .he-hommy-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
      .he-hommy-brand{display:flex;align-items:center;gap:8px;min-width:0}
      .he-hommy-mark{width:31px;height:31px;border-radius:10px;background:#f8eef1;color:#b2566c;display:grid;place-items:center;flex:0 0 auto}
      .he-hommy-brand strong{display:block;color:#413b3e;font-size:13px;line-height:1.05;font-weight:760}
      .he-hommy-brand small{display:block;margin-top:3px;color:#918a8e;font-size:10.5px;font-weight:560}
      .he-hommy-decision{flex:0 0 auto;min-height:27px;padding:0 9px;border-radius:999px;display:inline-flex;align-items:center;font-size:10.5px;font-weight:760;white-space:nowrap;background:#f4f3f4;color:#716b6f}
      .he-hommy-decision[data-decision="SEND"]{background:#eef8f3;color:#2b765f}
      .he-hommy-decision[data-decision="WAIT"]{background:#fff8e8;color:#9b711f}
      .he-hommy-decision[data-decision="STOP"]{background:#fff1f3;color:#b84e5c}
      .he-hommy-decision[data-decision="HUMAN_REVIEW"]{background:#f8eef1;color:#a0465b}
      .he-hommy-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:11px}
      .he-hommy-chip{min-height:25px;padding:0 8px;border-radius:8px;background:#f5f4f5;color:#716b6f;display:inline-flex;align-items:center;font-size:10.5px;font-weight:670}
      .he-hommy-reason{margin:10px 0 0;color:#5f585c;font-size:12.5px;line-height:1.46;font-weight:560}
      .he-hommy-draft{margin-top:11px;padding:11px 12px;border-radius:12px;background:#fff;border:1px solid #ebe7e9}
      .he-hommy-draft-label{display:flex;align-items:center;gap:6px;color:#a0465b;font-size:10.5px;font-weight:760;text-transform:uppercase;letter-spacing:.035em}
      .he-hommy-draft-text{margin:7px 0 0;color:#3f393c;font-size:12.5px;line-height:1.5;font-weight:530;white-space:pre-wrap;overflow-wrap:anywhere}
      .he-hommy-next{margin-top:9px;color:#817a7e;font-size:11.5px;line-height:1.35;font-weight:560}
      .he-hommy-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:11px}
      .he-hommy-action{min-height:39px;border-radius:11px;border:1px solid #e8e3e5;background:#fff;color:#746d71;font-size:11.5px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px}
      .he-hommy-action.primary{border-color:rgba(178,86,108,.18);color:#a0465b;background:#fbf5f7}
      .he-hommy-action.send{grid-column:1/-1;border-color:rgba(43,118,95,.18);background:#eef8f3;color:#2b765f;min-height:43px}
      .he-hommy-action.send:disabled{opacity:.68;cursor:default;transform:none}
      .he-hommy-delivery{margin-top:10px;padding:10px 11px;border-radius:11px;background:#eef8f3;color:#2b765f;font-size:11.5px;line-height:1.4;font-weight:680;display:flex;align-items:flex-start;gap:7px}
      .he-hommy-delivery.unknown{background:#fff8e8;color:#946c1f}
      .he-hommy-action:active{transform:scale(.98)}
      .he-hommy-history{margin-top:11px;border:1px solid #ebe7e9;border-radius:12px;background:rgba(255,255,255,.82);overflow:hidden}
      .he-hommy-history summary{list-style:none;cursor:pointer;min-height:42px;padding:0 11px;display:flex;align-items:center;justify-content:space-between;gap:10px;color:#625b5f;font-size:11.5px;font-weight:720;user-select:none}
      .he-hommy-history summary::-webkit-details-marker{display:none}
      .he-hommy-history-summary{display:flex;align-items:center;gap:7px;min-width:0}
      .he-hommy-history-summary i{color:#a0465b}
      .he-hommy-history-meta{color:#9a9397;font-size:10px;font-weight:620;white-space:nowrap}
      .he-hommy-history-chevron{font-size:9px;color:#aaa3a7;transition:transform .18s ease}
      .he-hommy-history[open] .he-hommy-history-chevron{transform:rotate(180deg)}
      .he-hommy-history-body{border-top:1px solid #f0edef;padding:10px}
      .he-hommy-history-status{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px}
      .he-hommy-history-pill{min-height:23px;padding:0 7px;border-radius:7px;background:#f5f4f5;color:#716b6f;display:inline-flex;align-items:center;font-size:9.8px;font-weight:680}
      .he-hommy-history-pill.address{background:#fbf5e8;color:#8d6b2c}
      .he-hommy-history-list{display:flex;flex-direction:column;gap:0;max-height:330px;overflow:auto;overscroll-behavior:contain}
      .he-hommy-history-item{position:relative;padding:2px 0 11px 25px}
      .he-hommy-history-item:not(:last-child)::before{content:'';position:absolute;left:7px;top:18px;bottom:-1px;width:1px;background:#ebe7e9}
      .he-hommy-history-dot{position:absolute;left:0;top:2px;width:15px;height:15px;border-radius:50%;background:#f4f3f4;color:#8c8589;display:grid;place-items:center;font-size:7px;z-index:1}
      .he-hommy-history-item[data-kind="INCOMING"] .he-hommy-history-dot{background:#eef8f3;color:#2b765f}
      .he-hommy-history-item[data-kind="OUTGOING"] .he-hommy-history-dot,.he-hommy-history-item[data-kind="QUOTE_SENT"] .he-hommy-history-dot{background:#f8eef1;color:#a0465b}
      .he-hommy-history-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
      .he-hommy-history-title{color:#514b4e;font-size:10.7px;font-weight:740}
      .he-hommy-history-time{color:#9a9397;font-size:9.4px;font-weight:560;white-space:nowrap}
      .he-hommy-history-text{margin:3px 0 0;color:#746d71;font-size:10.7px;line-height:1.42;font-weight:530;white-space:pre-wrap;overflow-wrap:anywhere}
      .he-hommy-history-loading,.he-hommy-history-empty{padding:5px 2px;color:#8b8488;font-size:10.7px;line-height:1.4}
      .he-hommy-history-retry{margin-top:7px;min-height:32px;padding:0 9px;border:1px solid #e8e3e5;border-radius:9px;background:#fff;color:#a0465b;font-size:10.5px;font-weight:700}
      .he-hommy-safe{margin-top:8px;color:#9a9397;font-size:10.5px;line-height:1.3;text-align:center;font-weight:540}
      .he-hommy-error{padding:13px}
      .he-hommy-error strong{display:block;color:#9f4659;font-size:12.5px;font-weight:740}
      .he-hommy-error p{margin:5px 0 0;color:#766f73;font-size:11.5px;line-height:1.4}
      .he-hommy-error button{margin-top:9px;min-height:38px;padding:0 11px;border-radius:10px;border:1px solid rgba(178,86,108,.16);background:#fff;color:#a0465b;font-size:11.5px;font-weight:700}
      @media(max-width:760px){.he-hommy-followup{margin-top:11px}.he-hommy-result{padding:12px}.he-hommy-head{align-items:center}.he-hommy-actions{grid-template-columns:1fr}.he-hommy-action{min-height:42px}}
    `;
    document.head.appendChild(style);
  }

  function icon(className) {
    const node = document.createElement('i');
    node.className = className;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function clearPanel(panel) {
    while (panel.firstChild) panel.firstChild.remove();
  }



  function cacheOwnerFingerprint() {
    const auth = window.HomeEasyAuth;
    const profile = auth && typeof auth.getCurrentProfile === 'function' ? auth.getCurrentProfile() : null;
    const token = sessionToken();
    const basis = clean(profile && (profile.email || profile.nombre || profile.rol)) || token;
    if (!basis) return '';
    let hash = 2166136261;
    const text = `${basis}|${token.slice(-24)}`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function purgeHommySessionCache() {
    planCache.clear();
    radarCache.clear();
    historyCache.clear();
    try {
      if (!window.sessionStorage) return;
      const keys = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (key && (key.startsWith(PLAN_CACHE_PREFIX) || key.startsWith(RADAR_CACHE_PREFIX))) keys.push(key);
      }
      keys.forEach(key => window.sessionStorage.removeItem(key));
    } catch (_) {}
  }

  function ensureCacheOwner() {
    const fingerprint = cacheOwnerFingerprint();
    if (!fingerprint) return;
    let previous = '';
    try { previous = clean(window.sessionStorage && window.sessionStorage.getItem(CACHE_OWNER_KEY)); } catch (_) {}
    if (previous && previous !== fingerprint) purgeHommySessionCache();
    try { if (window.sessionStorage) window.sessionStorage.setItem(CACHE_OWNER_KEY, fingerprint); } catch (_) {}
  }

  function sessionRead(key) {
    try {
      const raw = window.sessionStorage && window.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function sessionWrite(key, value) {
    try {
      if (window.sessionStorage) window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function sessionRemove(key) {
    try {
      if (window.sessionStorage) window.sessionStorage.removeItem(key);
    } catch (_) {}
  }

  function planStorageKey(numero) {
    return `${PLAN_CACHE_PREFIX}${clean(numero)}`;
  }

  function radarStorageKey(numero) {
    return `${RADAR_CACHE_PREFIX}${clean(numero)}`;
  }

  function cachedPlan(numero) {
    const key = clean(numero);
    if (!key) return null;
    let record = planCache.get(key) || sessionRead(planStorageKey(key));
    if (!record || !record.payload || typeof record.payload !== 'object') return null;
    const age = Date.now() - Number(record.cachedAt || 0);
    if (!Number.isFinite(age) || age < 0 || age > PLAN_MAX_AGE_MS) {
      planCache.delete(key);
      sessionRemove(planStorageKey(key));
      return null;
    }
    planCache.set(key, record);
    return record;
  }

  function rememberPlan(numero, payload) {
    const key = clean(numero);
    if (!key || !payload || typeof payload !== 'object') return null;
    const record = { cachedAt: Date.now(), payload };
    planCache.set(key, record);
    sessionWrite(planStorageKey(key), record);
    return record;
  }

  function forgetPlan(numero) {
    const key = clean(numero);
    if (!key) return;
    planCache.delete(key);
    sessionRemove(planStorageKey(key));
  }

  function cachedRadar(numero) {
    const key = clean(numero);
    if (!key) return null;
    let record = radarCache.get(key) || sessionRead(radarStorageKey(key));
    if (!record || !record.summary || typeof record.summary !== 'object') return null;
    const age = Date.now() - Number(record.cachedAt || 0);
    if (!Number.isFinite(age) || age < 0 || age > RADAR_MAX_AGE_MS) {
      radarCache.delete(key);
      sessionRemove(radarStorageKey(key));
      return null;
    }
    radarCache.set(key, record);
    return record;
  }

  function maxDateMs(values) {
    let best = 0;
    (values || []).forEach(value => {
      const ms = Date.parse(clean(value));
      if (Number.isFinite(ms) && ms > best) best = ms;
    });
    return best;
  }

  function summarizeHistory(payload) {
    const status = payload && payload.status && typeof payload.status === 'object' ? payload.status : {};
    const style = payload && payload.conversationStyle && typeof payload.conversationStyle === 'object' ? payload.conversationStyle : {};
    const rows = Array.isArray(payload && payload.history) ? payload.history : [];
    let incomingCount = 0;
    let outgoingCount = 0;
    let latestEventMs = 0;
    let latestIncomingMs = Date.parse(clean(status.lastIncomingAt)) || 0;
    let latestOutgoingMs = Date.parse(clean(status.lastOutgoingAt)) || 0;
    rows.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const kind = clean(item.kind).toUpperCase();
      const at = Date.parse(clean(item.at)) || 0;
      if (at > latestEventMs) latestEventMs = at;
      if (kind === 'INCOMING') {
        incomingCount += 1;
        if (at > latestIncomingMs) latestIncomingMs = at;
      }
      if (kind === 'OUTGOING' || kind === 'QUOTE_SENT') {
        outgoingCount += 1;
        if (at > latestOutgoingMs) latestOutgoingMs = at;
      }
    });
    latestEventMs = Math.max(latestEventMs, latestIncomingMs, latestOutgoingMs);
    return {
      state: clean(status.state).toUpperCase(),
      intent: clean(status.intent).toUpperCase(),
      temperature: clean(status.temperature).toUpperCase(),
      attempts: Math.max(0, Number(status.attempts || 0)),
      preferredAddress: clean(style.preferredAddress),
      honorificObserved: style.honorificObserved === true,
      register: clean(style.register).toUpperCase(),
      eventCount: rows.length,
      incomingCount,
      outgoingCount,
      latestEventMs,
      latestIncomingMs,
      latestOutgoingMs
    };
  }

  function rememberRadar(numero, payload) {
    const key = clean(numero);
    if (!key) return null;
    const record = { cachedAt: Date.now(), summary: summarizeHistory(payload) };
    radarCache.set(key, record);
    sessionWrite(radarStorageKey(key), record);
    return record;
  }

  function radarSignal(summary) {
    const state = clean(summary && summary.state).toUpperCase();
    const intent = clean(summary && summary.intent).toUpperCase();
    const incoming = Number(summary && summary.incomingCount || 0);
    const outgoing = Number(summary && summary.outgoingCount || 0);
    const attempts = Number(summary && summary.attempts || 0);
    const lastIn = Number(summary && summary.latestIncomingMs || 0);
    const lastOut = Number(summary && summary.latestOutgoingMs || 0);
    if (intent === 'READY_TO_BUY') return 'Listo para comprar';
    if (intent === 'WAITING_UNTIL_DATE') return 'Esperando fecha';
    if (intent === 'NOT_INTERESTED' || intent === 'DO_NOT_CONTACT' || state === 'STOPPED') return 'No contactar';
    if (state === 'WAITING_CUSTOMER') return 'Esperando respuesta';
    if (lastIn > lastOut) return 'Cliente respondió';
    if (attempts > 0) return 'Seguimiento activo';
    if (incoming > 0) return 'Conversación activa';
    if (outgoing > 0) return 'Contacto iniciado';
    return 'Nueva cotización';
  }

  function ageLabel(timestamp) {
    const age = Math.max(0, Date.now() - Number(timestamp || 0));
    if (age < 45_000) return 'ahora';
    const minutes = Math.max(1, Math.round(age / 60_000));
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.max(1, Math.round(minutes / 60));
    return `hace ${hours} h`;
  }

  function panelFor(numero) {
    const card = document.getElementById(`card-${clean(numero)}`);
    return card && card.querySelector('.he-hommy-followup');
  }

  function updateIdleRadar(panel, numero, record) {
    if (!panel || panel.dataset.mode !== 'idle') return;
    const summary = record && record.summary;
    const signal = panel.querySelector('.he-hommy-radar-signal');
    const chips = panel.querySelector('.he-hommy-radar-chips');
    const note = panel.querySelector('.he-hommy-radar-note');
    if (!summary) {
      if (signal) signal.textContent = 'Preparando radar';
      if (note) note.textContent = 'Hommy está leyendo el contexto en segundo plano…';
      return;
    }
    if (signal) signal.textContent = radarSignal(summary);
    if (chips) {
      clearPanel(chips);
      const add = (text, className = '') => {
        if (!clean(text)) return;
        const chip = document.createElement('span');
        chip.className = `he-hommy-radar-chip${className ? ` ${className}` : ''}`;
        chip.textContent = text;
        chips.appendChild(chip);
      };
      if (summary.attempts > 0) add(summary.attempts === 1 ? '1 seguimiento' : `${summary.attempts} seguimientos`);
      if (summary.incomingCount > 0) add(summary.latestIncomingMs > summary.latestOutgoingMs ? 'Respuesta nueva' : 'Conversación registrada');
      if (summary.honorificObserved && summary.preferredAddress) add(`Trato: ${summary.preferredAddress}`, 'address');
      if (['HIGH', 'RISK', 'WAITING', 'COLD'].includes(summary.temperature)) {
        add(`Temperatura: ${TEMPERATURE_LABELS[summary.temperature] || summary.temperature}`);
      }
      if (!chips.children.length) add('Contexto listo');
    }
    if (note) {
      const events = summary.eventCount === 1 ? '1 evento' : `${summary.eventCount} eventos`;
      note.textContent = `${events} · contexto actualizado ${ageLabel(record.cachedAt)}`;
    }
  }

  function latestHistoryAfterPlan(numero, radarRecord) {
    const planRecord = cachedPlan(numero);
    if (!planRecord || !radarRecord || !radarRecord.summary) return false;
    const generatedMs = Date.parse(clean(planRecord.payload && planRecord.payload.generatedAt)) || Number(planRecord.cachedAt || 0);
    return Number(radarRecord.summary.latestEventMs || 0) > generatedMs + 1000;
  }

  function renderIdle(panel, numero, radarRecord = cachedRadar(numero)) {
    clearPanel(panel);
    panel.dataset.mode = 'idle';
    const wrap = document.createElement('div');
    wrap.className = 'he-hommy-idle';

    const head = document.createElement('div');
    head.className = 'he-hommy-radar-head';
    const brand = document.createElement('div');
    brand.className = 'he-hommy-radar-brand';
    const mark = document.createElement('span');
    mark.className = 'he-hommy-radar-mark';
    mark.append(icon('fas fa-wand-magic-sparkles'));
    const brandText = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = 'Hommy';
    const subtitle = document.createElement('small');
    subtitle.textContent = 'Radar comercial';
    brandText.append(title, subtitle);
    brand.append(mark, brandText);
    const signal = document.createElement('span');
    signal.className = 'he-hommy-radar-signal';
    signal.textContent = 'Preparando radar';
    head.append(brand, signal);

    const chips = document.createElement('div');
    chips.className = 'he-hommy-radar-chips';
    const note = document.createElement('div');
    note.className = 'he-hommy-radar-note';
    note.textContent = 'Hommy está leyendo el contexto en segundo plano…';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'he-hommy-analyze';
    button.append(icon('fas fa-sparkles'));
    const label = document.createElement('span');
    label.textContent = 'Analizar con Hommy';
    button.append(label);
    button.addEventListener('click', () => analyze(panel, numero));
    const safety = document.createElement('small');
    safety.textContent = 'El radar se actualiza en segundo plano · no envía mensajes ni modifica la cotización. El análisis completo solo se recalcula cuando hace falta.';

    wrap.append(head, chips, note, button, safety);
    panel.appendChild(wrap);
    panel.appendChild(createHistoryAccordion(numero));
    updateIdleRadar(panel, numero, radarRecord);
  }

  function renderLoading(panel, message = 'Hommy está revisando el contexto comercial…') {
    clearPanel(panel);
    const loading = document.createElement('div');
    loading.className = 'he-hommy-loading';
    const spinner = document.createElement('span');
    spinner.className = 'he-hommy-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    loading.append(spinner, text);
    panel.appendChild(loading);
  }

  function formatNextAction(value) {
    const raw = clean(value);
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }


  const HISTORY_KIND_LABELS = Object.freeze({
    QUOTE_CREATED: 'Cotización creada',
    QUOTE_SENT: 'Cotización enviada',
    OUTGOING: 'Mensaje enviado',
    INCOMING: 'Cliente respondió',
    NOTE: 'Nota de seguimiento',
    CLOSED: 'Seguimiento cerrado',
    STATUS: 'Cambio de seguimiento'
  });

  const HISTORY_KIND_ICONS = Object.freeze({
    QUOTE_CREATED: 'fas fa-file-lines',
    QUOTE_SENT: 'fab fa-whatsapp',
    OUTGOING: 'fas fa-arrow-up',
    INCOMING: 'fas fa-arrow-down',
    NOTE: 'fas fa-note-sticky',
    CLOSED: 'fas fa-circle-stop',
    STATUS: 'fas fa-circle-dot'
  });

  function formatHistoryDate(value) {
    const raw = clean(value);
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'
    }).format(date);
  }

  function historyText(value, limit = 360) {
    const text = clean(value).replace(/\s+/g, ' ');
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
  }

  function invalidateHistory(numero) {
    historyCache.delete(clean(numero));
  }

  function resetHistoryControl(panel, numero) {
    invalidateHistory(numero);
    const current = panel && panel.querySelector('.he-hommy-history');
    if (current) current.replaceWith(createHistoryAccordion(numero));
  }

  function renderHistoryPayload(body, meta, payload) {
    clearPanel(body);
    const status = payload && payload.status && typeof payload.status === 'object' ? payload.status : {};
    const style = payload && payload.conversationStyle && typeof payload.conversationStyle === 'object' ? payload.conversationStyle : {};
    const history = Array.isArray(payload && payload.history) ? payload.history : [];
    const pills = document.createElement('div');
    pills.className = 'he-hommy-history-status';

    const addPill = (label, className = '') => {
      if (!clean(label)) return;
      const pill = document.createElement('span');
      pill.className = `he-hommy-history-pill${className ? ` ${className}` : ''}`;
      pill.textContent = label;
      pills.appendChild(pill);
    };

    const attempts = Math.max(0, Number(status.attempts || 0));
    addPill(attempts === 1 ? '1 seguimiento enviado' : attempts > 1 ? `${attempts} seguimientos enviados` : 'Sin seguimientos enviados');
    if (status.intent) addPill(INTENT_LABELS[clean(status.intent).toUpperCase()] || clean(status.intent));
    if (status.temperature) addPill(`Temperatura: ${TEMPERATURE_LABELS[clean(status.temperature).toUpperCase()] || clean(status.temperature)}`);
    if (style.honorificObserved === true && style.preferredAddress) addPill(`Trato: ${clean(style.preferredAddress)}`, 'address');
    body.appendChild(pills);

    meta.textContent = history.length ? `${history.length} eventos` : 'Sin eventos';
    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'he-hommy-history-empty';
      empty.textContent = 'Aún no hay actividad comercial registrada para esta cotización.';
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'he-hommy-history-list';
    history.forEach(event => {
      if (!event || typeof event !== 'object') return;
      const kind = clean(event.kind).toUpperCase() || 'STATUS';
      const item = document.createElement('div');
      item.className = 'he-hommy-history-item';
      item.dataset.kind = kind;
      const dot = document.createElement('span');
      dot.className = 'he-hommy-history-dot';
      dot.append(icon(HISTORY_KIND_ICONS[kind] || HISTORY_KIND_ICONS.STATUS));
      const top = document.createElement('div');
      top.className = 'he-hommy-history-top';
      const title = document.createElement('span');
      title.className = 'he-hommy-history-title';
      title.textContent = HISTORY_KIND_LABELS[kind] || 'Actividad';
      const time = document.createElement('span');
      time.className = 'he-hommy-history-time';
      time.textContent = formatHistoryDate(event.at);
      top.append(title, time);
      item.append(dot, top);
      const textValue = historyText(event.text);
      if (textValue) {
        const text = document.createElement('p');
        text.className = 'he-hommy-history-text';
        text.textContent = textValue;
        item.appendChild(text);
      }
      list.appendChild(item);
    });
    body.appendChild(list);
  }

  function createHistoryAccordion(numero) {
    const details = document.createElement('details');
    details.className = 'he-hommy-history';
    const summary = document.createElement('summary');
    const left = document.createElement('span');
    left.className = 'he-hommy-history-summary';
    left.append(icon('fas fa-clock-rotate-left'));
    const label = document.createElement('span');
    label.textContent = 'Historial y contexto';
    left.appendChild(label);
    const right = document.createElement('span');
    right.style.display = 'inline-flex';
    right.style.alignItems = 'center';
    right.style.gap = '7px';
    const meta = document.createElement('span');
    meta.className = 'he-hommy-history-meta';
    meta.textContent = 'Ver actividad';
    const chevron = icon('fas fa-chevron-down he-hommy-history-chevron');
    right.append(meta, chevron);
    summary.append(left, right);
    const body = document.createElement('div');
    body.className = 'he-hommy-history-body';
    details.append(summary, body);

    const load = async force => {
      if (!force && details.dataset.loaded === '1') return;
      details.dataset.loaded = '1';
      clearPanel(body);
      const loading = document.createElement('div');
      loading.className = 'he-hommy-history-loading';
      loading.textContent = 'Cargando actividad de HomeEasy y WhatsApp…';
      body.appendChild(loading);
      try {
        const key = clean(numero);
        let payload = !force ? historyCache.get(key) : null;
        if (!payload) {
          try {
            payload = await requestHistory(numero);
          } catch (error) {
            if (!isTransientAnalysisError(error)) throw error;
            await wait(TRANSIENT_RETRY_DELAY_MS);
            payload = await requestHistory(numero);
          }
          historyCache.set(key, payload);
        }
        const radarRecord = rememberRadar(numero, payload);
        updateIdleRadar(panelFor(numero), numero, radarRecord);
        if (details.isConnected) renderHistoryPayload(body, meta, payload);
      } catch (error) {
        details.dataset.loaded = '0';
        clearPanel(body);
        const failed = document.createElement('div');
        failed.className = 'he-hommy-history-empty';
        failed.textContent = 'No pudimos cargar el historial en este momento. El seguimiento y WhatsApp no fueron modificados.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'he-hommy-history-retry';
        retry.textContent = 'Volver a cargar';
        retry.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          load(true);
        });
        body.append(failed, retry);
      }
    };

    details.addEventListener('toggle', () => {
      if (details.open) load(false);
    });
    return details;
  }


  async function prefetchRadar(numero, force = false) {
    const key = clean(numero);
    if (!key) return null;
    const existing = cachedRadar(key);
    if (!force && existing && Date.now() - existing.cachedAt <= RADAR_FRESH_MS) {
      updateIdleRadar(panelFor(key), key, existing);
      return existing;
    }
    let payload;
    try {
      payload = await requestHistory(key);
    } catch (error) {
      if (!isTransientAnalysisError(error)) throw error;
      await wait(TRANSIENT_RETRY_DELAY_MS);
      payload = await requestHistory(key);
    }
    historyCache.set(key, payload);
    const record = rememberRadar(key, payload);
    updateIdleRadar(panelFor(key), key, record);
    if (latestHistoryAfterPlan(key, record)) {
      const hadPlan = Boolean(cachedPlan(key));
      forgetPlan(key);
      const panel = panelFor(key);
      if (panel && panel.dataset.mode === 'result') {
        renderIdle(panel, key, record);
        const note = panel.querySelector('.he-hommy-radar-note');
        if (note) note.textContent = 'Hay actividad nueva · Hommy actualizará el análisis sin bloquear la tarjeta.';
      }
      if (hadPlan && visibleQuotes.has(key)) refreshPlanSilently(key);
    }
    return record;
  }

  function drainRadarQueue() {
    while (radarWorkers < MAX_RADAR_WORKERS && radarQueue.length) {
      const job = radarQueue.shift();
      const key = clean(job && job.numero);
      if (!key) continue;
      queuedRadar.delete(key);
      radarWorkers += 1;
      prefetchRadar(key, Boolean(job.force))
        .catch(error => {
          if (clean(error && error.code).toUpperCase() === 'RATE_LIMITED') {
            const delay = Math.max(5, Math.min(90, Number(error.retryAfterSeconds || 15))) * 1000;
            window.setTimeout(() => queueRadar(key, Boolean(job.force), true), delay);
          }
        })
        .finally(() => {
          radarWorkers -= 1;
          drainRadarQueue();
        });
    }
  }

  function queueRadar(numero, force = false, priority = false) {
    const key = clean(numero);
    if (!key) return;
    const existing = cachedRadar(key);
    if (!force && existing && Date.now() - existing.cachedAt <= RADAR_FRESH_MS) {
      updateIdleRadar(panelFor(key), key, existing);
      return;
    }
    if (queuedRadar.has(key)) return;
    queuedRadar.add(key);
    const job = { numero: key, force: Boolean(force) };
    if (priority) radarQueue.unshift(job);
    else radarQueue.push(job);
    drainRadarQueue();
  }

  async function refreshPlanSilently(numero) {
    const key = clean(numero);
    const panel = panelFor(key);
    if (!key || !panel || panel.dataset.loading === '1' || panel.dataset.backgroundPlan === '1') return;
    panel.dataset.backgroundPlan = '1';
    try {
      let payload;
      try {
        payload = await requestPlan(key);
      } catch (error) {
        if (!isTransientAnalysisError(error)) throw error;
        await wait(TRANSIENT_RETRY_DELAY_MS);
        payload = await requestPlan(key);
      }
      const record = rememberPlan(key, payload);
      if (panel.isConnected && panel.dataset.loading !== '1') {
        renderResult(panel, key, payload, { cached: false, cachedAt: record.cachedAt, background: true });
      }
    } catch (_) {
      // Background refresh is intentionally silent; the last usable UI remains available.
    } finally {
      if (panel) panel.dataset.backgroundPlan = '0';
    }
  }

  function restorePanel(panel, numero) {
    const key = clean(numero);
    const planRecord = cachedPlan(key);
    if (planRecord) {
      const stale = Date.now() - planRecord.cachedAt > PLAN_FRESH_MS;
      renderResult(panel, key, planRecord.payload, { cached: true, cachedAt: planRecord.cachedAt, stale });
      if (stale && visibleQuotes.has(key)) {
        window.setTimeout(() => refreshPlanSilently(key), 30);
      }
      return;
    }
    renderIdle(panel, key, cachedRadar(key));
  }

  function ensureVisibilityObserver() {
    if (cardVisibilityObserver || typeof window.IntersectionObserver !== 'function') return;
    cardVisibilityObserver = new window.IntersectionObserver(entries => {
      entries.forEach(entry => {
        const numero = quoteNumberFromCard(entry.target);
        if (!numero) return;
        if (entry.isIntersecting) {
          visibleQuotes.add(numero);
          queueRadar(numero, false, true);
          const planRecord = cachedPlan(numero);
          if (planRecord && Date.now() - planRecord.cachedAt > PLAN_FRESH_MS) {
            window.setTimeout(() => refreshPlanSilently(numero), 20);
          }
        } else {
          visibleQuotes.delete(numero);
        }
      });
    }, { rootMargin: '260px 0px 260px 0px', threshold: 0.01 });
  }

  function warmRadar() {
    Array.from(document.querySelectorAll('.crm-card')).slice(0, INITIAL_RADAR_WARM_COUNT).forEach((card, index) => {
      const numero = quoteNumberFromCard(card);
      if (numero) queueRadar(numero, false, index < 5);
    });
  }

  function scheduleBackgroundRefresh() {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      if (!document.hidden) {
        visibleQuotes.forEach(numero => {
          queueRadar(numero, true, true);
          const planRecord = cachedPlan(numero);
          if (planRecord && Date.now() - planRecord.cachedAt > PLAN_FRESH_MS) refreshPlanSilently(numero);
        });
      }
      scheduleBackgroundRefresh();
    }, BACKGROUND_REFRESH_MS);
  }

  async function copyText(value) {
    const text = clean(value);
    if (!text) return false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    }
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    return Boolean(copied);
  }

  function toast(text, iconName = 'success') {
    if (window.Swal && typeof window.Swal.fire === 'function') {
      window.Swal.fire({
        toast: true,
        position: 'bottom',
        icon: iconName,
        title: text,
        showConfirmButton: false,
        timer: 1800,
        timerProgressBar: false
      });
    }
  }

  function canSendFollowup() {
    const auth = window.HomeEasyAuth;
    return Boolean(auth && typeof auth.hasPermission === 'function' && auth.hasPermission('cotizaciones.write'));
  }

  function words(value) {
    return clean(value).split(/\s+/).filter(Boolean).length;
  }

  async function postHomeEasy(payload) {
    const response = await fetch(HOME_EASY_API, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
      cache: 'no-store'
    });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data || !['success', 'ok'].includes(clean(data.status).toLowerCase())) {
      const error = new Error(clean(data && data.msg) || 'No fue posible actualizar la memoria de seguimiento.');
      error.code = clean(data && data.code).toUpperCase() || `HTTP_${response.status}`;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function syncSentFollowup(numero, payload, message, delivery) {
    const plan = payload.plan || {};
    const planId = clean(payload.planId);
    const sentAt = clean(delivery && delivery.sentAt) || new Date().toISOString();
    const sourceAttempts = Math.max(0, Number(payload.sourceAttemptCount || 0));
    let stateResult = null;
    let stateError = null;
    let eventResult = null;
    let eventError = null;

    try {
      stateResult = await postHomeEasy({
        tipo: 'ACTUALIZAR_ESTADO_SEGUIMIENTO_IA',
        numero: clean(numero),
        expectedVersion: Number(payload.sourceStateVersion || 0),
        estado: 'WAITING_CUSTOMER',
        intencion: clean(plan.intent).toUpperCase(),
        temperatura: clean(plan.temperature).toUpperCase(),
        resumen: clean(plan.summary),
        intentosSeguimiento: sourceAttempts + 1,
        proximaAccionFecha: plan.nextActionAt || '',
        proximaAccionTipo: 'WAIT_REPLY',
        ultimoSaliente: sentAt,
        requestId: `10D:STATE:${planId}`,
        eventText: 'Seguimiento enviado por WhatsApp con aprobación humana.',
        motivo: 'Borrador de Hommy revisado por una persona antes del envío.'
      });
    } catch (error) {
      stateError = error;
    }

    try {
      eventResult = await postHomeEasy({
        tipo: 'REGISTRAR_EVENTO_SEGUIMIENTO',
        numero: clean(numero),
        eventType: 'MESSAGE_SENT',
        channel: 'WHATSAPP',
        text: clean(message),
        messageId: clean(delivery && delivery.messageId),
        motivo: 'Seguimiento aprobado por una persona y enviado por WhatsApp.',
        metadata: {
          source: 'hommy-review-10d',
          planId,
          generatedAt: clean(payload.generatedAt),
          decision: clean(plan.decision).toUpperCase(),
          edited: clean(message) !== clean(plan.message),
          delivery: clean(delivery && delivery.delivery).toUpperCase(),
          duplicate: Boolean(delivery && delivery.duplicate)
        },
        requestId: `10D:MESSAGE_SENT:${planId}`
      });
    } catch (error) {
      eventError = error;
    }

    return {
      stateResult,
      eventResult,
      stateError,
      eventError,
      memoryOk: !stateError && !eventError
    };
  }

  function markDelivery(panel, delivery, sync) {
    if (!panel) return;
    const state = clean(delivery && delivery.delivery).toUpperCase();
    const unknown = state !== 'SENT';
    let banner = panel.querySelector('.he-hommy-delivery');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'he-hommy-delivery';
      const safe = panel.querySelector('.he-hommy-safe');
      if (safe) safe.before(banner);
      else panel.appendChild(banner);
    }
    banner.classList.toggle('unknown', unknown);
    clearPanel(banner);
    banner.append(icon(unknown ? 'fas fa-clock' : 'fab fa-whatsapp'));
    const copy = document.createElement('span');
    if (unknown) {
      copy.textContent = 'WhatsApp recibió el intento, pero el resultado quedó por confirmar. No lo reenvíes manualmente hasta revisar el chat.';
    } else if (sync && sync.memoryOk === false) {
      copy.textContent = 'Mensaje enviado por WhatsApp. El historial interno no terminó de sincronizarse, pero Hommy podrá releer el chat real.';
    } else {
      copy.textContent = 'Mensaje enviado por WhatsApp y registrado en el seguimiento. Ahora esperamos la respuesta del cliente.';
    }
    banner.appendChild(copy);

    const sendButton = panel.querySelector('.he-hommy-action.send');
    if (sendButton) {
      sendButton.disabled = true;
      sendButton.replaceChildren(icon(state === 'SENT' ? 'fas fa-check' : 'fas fa-clock'));
      const label = document.createElement('span');
      label.textContent = state === 'SENT' ? 'Enviado por WhatsApp' : 'Envío por confirmar';
      sendButton.appendChild(label);
    }
  }

  function sendErrorMessage(error) {
    const code = clean(error && error.code).toUpperCase();
    const details = error && error.details && typeof error.details === 'object' ? error.details : {};
    const serverCode = clean(details.code || details.details && details.details.code).toUpperCase();
    const effective = serverCode || code;
    if (effective === 'FOLLOWUP_CONVERSATION_CHANGED') return 'El cliente escribió después del análisis de Hommy. Analiza de nuevo antes de enviar.';
    if (effective === 'FOLLOWUP_STATE_CHANGED') return 'El seguimiento cambió después del análisis. Analiza de nuevo antes de enviar.';
    if (effective === 'FOLLOWUP_NOT_SENDABLE') return 'Esta oportunidad ya no admite este seguimiento.';
    if (effective === 'FOLLOWUP_REVIEW_MODE_REQUIRED') return 'El envío manual solo está permitido en modo REVIEW.';
    if (effective === 'FOLLOWUP_PLAN_REUSED') return 'Este análisis ya fue usado con otro texto. Analiza de nuevo para generar un plan nuevo.';
    if (code === 'WHATSAPP_TIMEOUT' || code === 'WHATSAPP_NETWORK') return 'No pudimos confirmar el resultado. Revisa el chat antes de intentar otro envío para evitar duplicados.';
    return clean(error && error.message) || 'No fue posible enviar el seguimiento.';
  }

  async function reviewAndSend(panel, numero, payload) {
    if (!canSendFollowup()) {
      toast('Tu perfil no tiene permiso para enviar cotizaciones', 'info');
      return;
    }
    const whatsapp = window.HomeEasyWhatsApp;
    if (!whatsapp || typeof whatsapp.sendFollowup !== 'function') {
      toast('WhatsApp todavía no está listo en esta pantalla', 'error');
      return;
    }

    const plan = payload.plan || {};
    const original = clean(plan.message);
    if (!original || clean(plan.decision).toUpperCase() !== 'SEND') return;

    if (!window.Swal || typeof window.Swal.fire !== 'function') {
      toast('No se pudo abrir la revisión del mensaje', 'error');
      return;
    }

    const review = await window.Swal.fire({
      title: 'Revisar antes de enviar',
      html: '<div style="font-size:12.5px;color:#746d71;line-height:1.45;margin-bottom:8px">Puedes editar el borrador. HomeEasy verificará nuevamente la cotización y el chat justo antes del envío.</div>',
      input: 'textarea',
      inputValue: original,
      inputAttributes: {
        maxlength: '1200',
        rows: '7',
        autocapitalize: 'sentences',
        spellcheck: 'true'
      },
      showCancelButton: true,
      confirmButtonText: '<i class="fab fa-whatsapp"></i>&nbsp; Enviar por WhatsApp',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2b765f',
      cancelButtonColor: '#8e8e93',
      focusConfirm: false,
      customClass: { popup: 'swal2-premium' },
      preConfirm: value => {
        const text = clean(value);
        if (!text) {
          window.Swal.showValidationMessage('Escribe el mensaje que deseas enviar.');
          return false;
        }
        if (words(text) > 130) {
          window.Swal.showValidationMessage('El mensaje debe tener máximo 130 palabras.');
          return false;
        }
        return text;
      }
    });
    if (!review.isConfirmed) return;
    const finalMessage = clean(review.value);

    window.Swal.fire({
      title: 'Enviando por WhatsApp…',
      text: 'Estamos verificando que la conversación no haya cambiado.',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => window.Swal.showLoading(),
      customClass: { popup: 'swal2-premium' }
    });

    try {
      const delivery = await whatsapp.sendFollowup({
        reference: `COT-${clean(numero)}`,
        text: finalMessage,
        planId: clean(payload.planId),
        expectedVersion: Number(payload.sourceStateVersion || 0),
        generatedAt: clean(payload.generatedAt)
      });
      const sync = await syncSentFollowup(numero, payload, finalMessage, delivery);
      window.Swal.close();
      markDelivery(panel, delivery, sync);
      forgetPlan(numero);
      resetHistoryControl(panel, numero);
      queueRadar(numero, true, true);
      if (clean(delivery && delivery.delivery).toUpperCase() === 'SENT') {
        toast(sync.memoryOk ? 'Seguimiento enviado y registrado' : 'Seguimiento enviado por WhatsApp');
      } else {
        toast('Envío por confirmar; no lo reenvíes todavía', 'info');
      }
    } catch (error) {
      window.Swal.close();
      const message = sendErrorMessage(error);
      await window.Swal.fire({
        icon: 'info',
        title: 'No se envió el seguimiento',
        text: message,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#b2566c',
        customClass: { popup: 'swal2-premium' }
      });
      const effective = clean(error && error.details && (error.details.code || error.details.details && error.details.details.code)).toUpperCase();
      if (['FOLLOWUP_CONVERSATION_CHANGED', 'FOLLOWUP_STATE_CHANGED'].includes(effective)) {
        await analyze(panel, numero);
      }
    }
  }

  function renderResult(panel, numero, payload, options = {}) {
    clearPanel(panel);
    panel.dataset.mode = 'result';
    const plan = payload.plan || {};
    const decision = clean(plan.decision).toUpperCase();
    const result = document.createElement('div');
    result.className = 'he-hommy-result';

    const head = document.createElement('div');
    head.className = 'he-hommy-head';
    const brand = document.createElement('div');
    brand.className = 'he-hommy-brand';
    const mark = document.createElement('span');
    mark.className = 'he-hommy-mark';
    mark.append(icon('fas fa-wand-magic-sparkles'));
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = 'Hommy';
    const subtitle = document.createElement('small');
    subtitle.textContent = 'Revisión comercial';
    copy.append(title, subtitle);
    brand.append(mark, copy);

    const badge = document.createElement('span');
    badge.className = 'he-hommy-decision';
    badge.dataset.decision = decision;
    badge.textContent = DECISION_LABELS[decision] || 'Análisis';
    head.append(brand, badge);
    result.appendChild(head);

    if (options.cached) {
      const cacheNote = document.createElement('div');
      cacheNote.className = 'he-hommy-cache-note';
      cacheNote.textContent = options.stale
        ? `Análisis guardado ${ageLabel(options.cachedAt)} · verificando cambios antes de permitir acciones.`
        : `Análisis guardado ${ageLabel(options.cachedAt)} · se actualizará en segundo plano si cambia el contexto.`;
      result.appendChild(cacheNote);
    }

    const chips = document.createElement('div');
    chips.className = 'he-hommy-chips';
    const reasonChip = document.createElement('span');
    reasonChip.className = 'he-hommy-chip';
    reasonChip.textContent = REASON_LABELS[clean(plan.reasonCode).toUpperCase()] || 'Contexto comercial';
    chips.appendChild(reasonChip);
    if (plan.intent) {
      const intent = document.createElement('span');
      intent.className = 'he-hommy-chip';
      intent.textContent = INTENT_LABELS[clean(plan.intent).toUpperCase()] || clean(plan.intent);
      chips.appendChild(intent);
    }
    if (plan.temperature) {
      const temperature = document.createElement('span');
      temperature.className = 'he-hommy-chip';
      temperature.textContent = `Temperatura: ${TEMPERATURE_LABELS[clean(plan.temperature).toUpperCase()] || clean(plan.temperature)}`;
      chips.appendChild(temperature);
    }
    const priorAttempts = Math.max(0, Number(payload.sourceAttemptCount || 0));
    if (priorAttempts > 0) {
      const attempts = document.createElement('span');
      attempts.className = 'he-hommy-chip';
      attempts.textContent = priorAttempts === 1 ? '1 seguimiento previo' : `${priorAttempts} seguimientos previos`;
      chips.appendChild(attempts);
    }
    result.appendChild(chips);

    const reason = document.createElement('p');
    reason.className = 'he-hommy-reason';
    reason.textContent = clean(plan.explanation) || clean(plan.summary) || 'Hommy terminó la revisión comercial.';
    result.appendChild(reason);

    const message = clean(plan.message);
    if (message) {
      const draft = document.createElement('div');
      draft.className = 'he-hommy-draft';
      const draftLabel = document.createElement('div');
      draftLabel.className = 'he-hommy-draft-label';
      draftLabel.append(icon('fas fa-message'));
      const draftLabelText = document.createElement('span');
      draftLabelText.textContent = 'Borrador sugerido';
      draftLabel.appendChild(draftLabelText);
      const draftText = document.createElement('p');
      draftText.className = 'he-hommy-draft-text';
      draftText.textContent = message;
      draft.append(draftLabel, draftText);
      result.appendChild(draft);
    }

    const nextAction = formatNextAction(plan.nextActionAt);
    if (nextAction) {
      const next = document.createElement('div');
      next.className = 'he-hommy-next';
      next.textContent = `Próxima revisión sugerida: ${nextAction}`;
      result.appendChild(next);
    }

    result.appendChild(createHistoryAccordion(numero));

    const actions = document.createElement('div');
    actions.className = 'he-hommy-actions';
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'he-hommy-action';
    again.append(icon('fas fa-rotate'));
    const againText = document.createElement('span');
    againText.textContent = 'Analizar de nuevo';
    again.appendChild(againText);
    again.addEventListener('click', () => analyze(panel, numero));
    actions.appendChild(again);

    if (message && !options.stale) {
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'he-hommy-action primary';
      copyButton.append(icon('fas fa-copy'));
      const copyLabel = document.createElement('span');
      copyLabel.textContent = 'Copiar borrador';
      copyButton.appendChild(copyLabel);
      copyButton.addEventListener('click', async () => {
        if (await copyText(message)) toast('Borrador copiado');
        else toast('No fue posible copiar el borrador', 'error');
      });
      actions.appendChild(copyButton);
    }
    if (message && decision === 'SEND' && canSendFollowup() && !options.stale) {
      const sendButton = document.createElement('button');
      sendButton.type = 'button';
      sendButton.className = 'he-hommy-action send';
      sendButton.append(icon('fab fa-whatsapp'));
      const sendLabel = document.createElement('span');
      sendLabel.textContent = 'Revisar y enviar';
      sendButton.appendChild(sendLabel);
      sendButton.addEventListener('click', () => reviewAndSend(panel, numero, payload));
      actions.appendChild(sendButton);
    }
    result.appendChild(actions);

    const safe = document.createElement('div');
    safe.className = 'he-hommy-safe';
    safe.textContent = options.stale
      ? 'Modo REVIEW · este análisis se muestra para no hacerte esperar, pero Hommy está verificando cambios antes de habilitar acciones.'
      : decision === 'SEND' && canSendFollowup()
        ? 'Modo REVIEW · Hommy propone; tú revisas y autorizas cualquier envío.'
        : 'Modo REVIEW · Hommy no envió nada y no cambió datos de HomeEasy.';
    result.appendChild(safe);
    panel.appendChild(result);
  }

  function friendlyError(error) {
    const code = clean(error && error.code).toUpperCase();
    if (TRANSIENT_ANALYSIS_CODES.has(code)) {
      return 'La conexión con HomeEasy está lenta. Hommy no envió nada ni cambió datos. Puedes seguir usando la cotización y volver a analizar en un momento.';
    }
    if (['AUTH_REQUIRED', 'APP_SESSION_EXPIRED', 'APP_SESSION_REJECTED', 'NO_SESSION'].includes(code)) {
      return 'Tu sesión necesita renovarse. Vuelve a HomeEasy e inténtalo nuevamente.';
    }
    if (code === 'PERMISSION_DENIED') return 'Tu perfil no tiene permiso para analizar seguimiento comercial.';
    if (code === 'FOLLOWUP_STATE_CHANGED') return 'La cotización cambió mientras Hommy la revisaba. Analízala otra vez con la información nueva.';
    if (code === 'RATE_LIMITED') return 'Hommy recibió varias solicitudes seguidas. Espera un momento e inténtalo de nuevo.';
    return clean(error && error.message) || 'No fue posible completar el análisis.';
  }

  function renderError(panel, numero, error) {
    clearPanel(panel);
    const wrap = document.createElement('div');
    wrap.className = 'he-hommy-error';
    const title = document.createElement('strong');
    title.textContent = 'Hommy no pudo completar la revisión';
    const text = document.createElement('p');
    text.textContent = friendlyError(error);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Intentar de nuevo';
    retry.addEventListener('click', () => analyze(panel, numero));
    wrap.append(title, text, retry);
    panel.appendChild(wrap);
  }

  function isTransientAnalysisError(error) {
    return TRANSIENT_ANALYSIS_CODES.has(clean(error && error.code).toUpperCase());
  }

  function wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async function analyze(panel, numero) {
    if (!panel || panel.dataset.loading === '1') return;
    panel.dataset.loading = '1';
    panel.dataset.mode = 'loading';
    invalidateHistory(numero);
    renderLoading(panel);
    try {
      let payload;
      try {
        payload = await requestPlan(numero);
      } catch (error) {
        if (!isTransientAnalysisError(error)) throw error;
        if (panel.isConnected) renderLoading(panel, 'Reconectando con HomeEasy…');
        await wait(TRANSIENT_RETRY_DELAY_MS);
        payload = await requestPlan(numero);
      }
      const record = rememberPlan(numero, payload);
      if (panel.isConnected) renderResult(panel, numero, payload, { cached: false, cachedAt: record.cachedAt });
    } catch (error) {
      if (panel.isConnected) renderError(panel, numero, error);
    } finally {
      panel.dataset.loading = '0';
    }
  }

  function quoteNumberFromCard(card) {
    const id = clean(card && card.id);
    if (id.startsWith('card-')) return id.slice(5);
    const badge = card && card.querySelector('.doc-number');
    const match = clean(badge && badge.textContent).match(/COT\s*#?\s*([A-Za-z0-9._-]+)/i);
    return match ? match[1] : '';
  }

  function enhanceCard(card) {
    if (!card || card.dataset.hommyFollowup10b === '1') return;
    const numero = quoteNumberFromCard(card);
    const body = card.querySelector('.card-body-crm');
    if (!numero || !body) return;
    card.dataset.hommyFollowup10b = '1';
    const panel = document.createElement('section');
    panel.className = 'he-hommy-followup';
    panel.setAttribute('aria-label', `Revisión comercial de Hommy para cotización ${numero}`);
    body.appendChild(panel);
    restorePanel(panel, numero);
    ensureVisibilityObserver();
    if (cardVisibilityObserver) cardVisibilityObserver.observe(card);
  }

  function enhanceCards() {
    document.querySelectorAll('.crm-card').forEach(enhanceCard);
  }

  function install() {
    ensureCacheOwner();
    addStyles();
    enhanceCards();
    const container = document.getElementById('tarjetas-container');
    if (!container) return;
    const observer = new MutationObserver(() => enhanceCards());
    observer.observe(container, { childList: true, subtree: true });
    if (typeof window.IntersectionObserver === 'function') {
      window.setTimeout(warmRadar, BACKGROUND_WARMUP_DELAY_MS);
      scheduleBackgroundRefresh();
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) window.setTimeout(warmRadar, 30);
    });
    window.addEventListener('homeeasy:auth-change', event => {
      const type = clean(event && event.detail && event.detail.type).toLowerCase();
      if (['signed-out', 'session-rejected'].includes(type)) {
        purgeHommySessionCache();
        try { if (window.sessionStorage) window.sessionStorage.removeItem(CACHE_OWNER_KEY); } catch (_) {}
        return;
      }
      if (type.includes('signed-in')) ensureCacheOwner();
    });
    window.addEventListener('homeeasy:seguimiento-updated', event => {
      const numero = clean(event && event.detail && event.detail.numero);
      if (!numero) return;
      forgetPlan(numero);
      invalidateHistory(numero);
      radarCache.delete(numero);
      sessionRemove(radarStorageKey(numero));
      const panel = panelFor(numero);
      if (panel) renderIdle(panel, numero, null);
      queueRadar(numero, true, true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
