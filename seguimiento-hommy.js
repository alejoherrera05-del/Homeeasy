(() => {
  'use strict';

  if (window.__HOMEEASY_SEGUIMIENTO_HOMMY_10B__) return;
  window.__HOMEEASY_SEGUIMIENTO_HOMMY_10B__ = true;

  const API_BASE = String(window.HOMMY_API_BASE || 'https://homeeasy-hommy-staging.onrender.com').replace(/\/$/, '');
  const ENDPOINT = `${API_BASE}/api/hommy/followup/plan`;
  const STYLE_ID = 'homeeasy-followup-hommy-10b-style';
  const REQUEST_TIMEOUT_MS = 75_000;

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

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .he-hommy-followup{margin-top:13px;border:1px solid rgba(178,86,108,.12);border-radius:16px;background:linear-gradient(180deg,#fff 0%,#fcf8f9 100%);overflow:hidden}
      .he-hommy-idle{padding:11px}
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
      .he-hommy-action:active{transform:scale(.98)}
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

  function renderIdle(panel, numero) {
    clearPanel(panel);
    const wrap = document.createElement('div');
    wrap.className = 'he-hommy-idle';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'he-hommy-analyze';
    button.append(icon('fas fa-sparkles'));
    const label = document.createElement('span');
    label.textContent = 'Analizar con Hommy';
    button.append(label);
    button.addEventListener('click', () => analyze(panel, numero));
    const note = document.createElement('small');
    note.textContent = 'Revisión comercial · no envía mensajes ni modifica la cotización';
    wrap.append(button, note);
    panel.appendChild(wrap);
  }

  function renderLoading(panel) {
    clearPanel(panel);
    const loading = document.createElement('div');
    loading.className = 'he-hommy-loading';
    const spinner = document.createElement('span');
    spinner.className = 'he-hommy-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = 'Hommy está revisando el contexto comercial…';
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

  function renderResult(panel, numero, payload) {
    clearPanel(panel);
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

    if (message) {
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
    result.appendChild(actions);

    const safe = document.createElement('div');
    safe.className = 'he-hommy-safe';
    safe.textContent = 'Modo REVIEW · Hommy no envió nada y no cambió datos de HomeEasy.';
    result.appendChild(safe);
    panel.appendChild(result);
  }

  function friendlyError(error) {
    const code = clean(error && error.code).toUpperCase();
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

  async function analyze(panel, numero) {
    if (!panel || panel.dataset.loading === '1') return;
    panel.dataset.loading = '1';
    renderLoading(panel);
    try {
      const payload = await requestPlan(numero);
      if (panel.isConnected) renderResult(panel, numero, payload);
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
    renderIdle(panel, numero);
    body.appendChild(panel);
  }

  function enhanceCards() {
    document.querySelectorAll('.crm-card').forEach(enhanceCard);
  }

  function install() {
    addStyles();
    enhanceCards();
    const container = document.getElementById('tarjetas-container');
    if (!container) return;
    const observer = new MutationObserver(() => enhanceCards());
    observer.observe(container, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
