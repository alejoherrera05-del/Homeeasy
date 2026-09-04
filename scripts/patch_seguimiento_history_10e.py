from pathlib import Path

js_path = Path('seguimiento-hommy.js')
source = js_path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    source = source.replace(old, new, 1)

replace_once(
    "  const ENDPOINT = `${API_BASE}/api/hommy/followup/plan`;\n  const STYLE_ID = 'homeeasy-followup-hommy-10b-style';\n  const REQUEST_TIMEOUT_MS = 90_000;\n",
    "  const ENDPOINT = `${API_BASE}/api/hommy/followup/plan`;\n  const HISTORY_ENDPOINT = `${API_BASE}/api/hommy/followup/history`;\n  const STYLE_ID = 'homeeasy-followup-hommy-10b-style';\n  const REQUEST_TIMEOUT_MS = 90_000;\n  const HISTORY_TIMEOUT_MS = 45_000;\n  const historyCache = new Map();\n",
    'constants',
)

request_history = r'''
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
      throw error;
    }
    return payload;
  }

'''
replace_once('  function addStyles() {\n', request_history + '  function addStyles() {\n', 'requestHistory')

history_css = '''      .he-hommy-history{margin-top:11px;border:1px solid #ebe7e9;border-radius:12px;background:rgba(255,255,255,.82);overflow:hidden}\n      .he-hommy-history summary{list-style:none;cursor:pointer;min-height:42px;padding:0 11px;display:flex;align-items:center;justify-content:space-between;gap:10px;color:#625b5f;font-size:11.5px;font-weight:720;user-select:none}\n      .he-hommy-history summary::-webkit-details-marker{display:none}\n      .he-hommy-history-summary{display:flex;align-items:center;gap:7px;min-width:0}\n      .he-hommy-history-summary i{color:#a0465b}\n      .he-hommy-history-meta{color:#9a9397;font-size:10px;font-weight:620;white-space:nowrap}\n      .he-hommy-history-chevron{font-size:9px;color:#aaa3a7;transition:transform .18s ease}\n      .he-hommy-history[open] .he-hommy-history-chevron{transform:rotate(180deg)}\n      .he-hommy-history-body{border-top:1px solid #f0edef;padding:10px}\n      .he-hommy-history-status{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px}\n      .he-hommy-history-pill{min-height:23px;padding:0 7px;border-radius:7px;background:#f5f4f5;color:#716b6f;display:inline-flex;align-items:center;font-size:9.8px;font-weight:680}\n      .he-hommy-history-pill.address{background:#fbf5e8;color:#8d6b2c}\n      .he-hommy-history-list{display:flex;flex-direction:column;gap:0;max-height:330px;overflow:auto;overscroll-behavior:contain}\n      .he-hommy-history-item{position:relative;padding:2px 0 11px 25px}\n      .he-hommy-history-item:not(:last-child)::before{content:'';position:absolute;left:7px;top:18px;bottom:-1px;width:1px;background:#ebe7e9}\n      .he-hommy-history-dot{position:absolute;left:0;top:2px;width:15px;height:15px;border-radius:50%;background:#f4f3f4;color:#8c8589;display:grid;place-items:center;font-size:7px;z-index:1}\n      .he-hommy-history-item[data-kind="INCOMING"] .he-hommy-history-dot{background:#eef8f3;color:#2b765f}\n      .he-hommy-history-item[data-kind="OUTGOING"] .he-hommy-history-dot,.he-hommy-history-item[data-kind="QUOTE_SENT"] .he-hommy-history-dot{background:#f8eef1;color:#a0465b}\n      .he-hommy-history-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}\n      .he-hommy-history-title{color:#514b4e;font-size:10.7px;font-weight:740}\n      .he-hommy-history-time{color:#9a9397;font-size:9.4px;font-weight:560;white-space:nowrap}\n      .he-hommy-history-text{margin:3px 0 0;color:#746d71;font-size:10.7px;line-height:1.42;font-weight:530;white-space:pre-wrap;overflow-wrap:anywhere}\n      .he-hommy-history-loading,.he-hommy-history-empty{padding:5px 2px;color:#8b8488;font-size:10.7px;line-height:1.4}\n      .he-hommy-history-retry{margin-top:7px;min-height:32px;padding:0 9px;border:1px solid #e8e3e5;border-radius:9px;background:#fff;color:#a0465b;font-size:10.5px;font-weight:700}\n'''
replace_once('      .he-hommy-safe{margin-top:8px;', history_css + '      .he-hommy-safe{margin-top:8px;', 'history CSS')

history_helpers = r'''
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

'''
replace_once('  async function copyText(value) {\n', history_helpers + '  async function copyText(value) {\n', 'history helpers')

replace_once(
    "    const sentAt = clean(delivery && delivery.sentAt) || new Date().toISOString();\n    let stateResult = null;\n",
    "    const sentAt = clean(delivery && delivery.sentAt) || new Date().toISOString();\n    const sourceAttempts = Math.max(0, Number(payload.sourceAttemptCount || 0));\n    let stateResult = null;\n",
    'source attempts',
)

replace_once(
    "        intencion: clean(plan.intent).toUpperCase(),\n        temperatura: clean(plan.temperature).toUpperCase(),\n        resumen: clean(plan.summary),\n",
    "        estado: 'WAITING_CUSTOMER',\n        intencion: clean(plan.intent).toUpperCase(),\n        temperatura: clean(plan.temperature).toUpperCase(),\n        resumen: clean(plan.summary),\n        intentosSeguimiento: sourceAttempts + 1,\n",
    'sent state fields',
)

replace_once(
    "      const sync = await syncSentFollowup(numero, payload, finalMessage, delivery);\n      window.Swal.close();\n      markDelivery(panel, delivery, sync);\n",
    "      const sync = await syncSentFollowup(numero, payload, finalMessage, delivery);\n      window.Swal.close();\n      markDelivery(panel, delivery, sync);\n      resetHistoryControl(panel, numero);\n",
    'history invalidation after send',
)

# Add attempt chip to current analysis.
replace_once(
    "    if (plan.temperature) {\n      const temperature = document.createElement('span');\n      temperature.className = 'he-hommy-chip';\n      temperature.textContent = `Temperatura: ${TEMPERATURE_LABELS[clean(plan.temperature).toUpperCase()] || clean(plan.temperature)}`;\n      chips.appendChild(temperature);\n    }\n    result.appendChild(chips);\n",
    "    if (plan.temperature) {\n      const temperature = document.createElement('span');\n      temperature.className = 'he-hommy-chip';\n      temperature.textContent = `Temperatura: ${TEMPERATURE_LABELS[clean(plan.temperature).toUpperCase()] || clean(plan.temperature)}`;\n      chips.appendChild(temperature);\n    }\n    const priorAttempts = Math.max(0, Number(payload.sourceAttemptCount || 0));\n    if (priorAttempts > 0) {\n      const attempts = document.createElement('span');\n      attempts.className = 'he-hommy-chip';\n      attempts.textContent = priorAttempts === 1 ? '1 seguimiento previo' : `${priorAttempts} seguimientos previos`;\n      chips.appendChild(attempts);\n    }\n    result.appendChild(chips);\n",
    'attempt chip',
)

# Insert accordion into analysis result before actions.
replace_once(
    "    const actions = document.createElement('div');\n    actions.className = 'he-hommy-actions';\n",
    "    result.appendChild(createHistoryAccordion(numero));\n\n    const actions = document.createElement('div');\n    actions.className = 'he-hommy-actions';\n",
    'result history accordion',
)

# Idle card also exposes history without requiring an analysis.
replace_once(
    "    wrap.append(button, note);\n    panel.appendChild(wrap);\n  }\n",
    "    wrap.append(button, note);\n    panel.appendChild(wrap);\n    panel.appendChild(createHistoryAccordion(numero));\n  }\n",
    'idle history accordion',
)

# Analysis refreshes the history cache, since it just rereads live commercial context.
replace_once(
    "    panel.dataset.loading = '1';\n    renderLoading(panel);\n",
    "    panel.dataset.loading = '1';\n    invalidateHistory(numero);\n    renderLoading(panel);\n",
    'analysis history invalidation',
)

js_path.write_text(source, encoding='utf-8')

html_path = Path('seguimiento.html')
html = html_path.read_text(encoding='utf-8')
if html.count('seguimiento-hommy.js?v=10d2') != 1 or html.count("seguimiento-hommy.js?v=10d2-retry") != 1:
    raise SystemExit('seguimiento.html 10d2 asset anchors did not match exactly')
html = html.replace('seguimiento-hommy.js?v=10d2', 'seguimiento-hommy.js?v=10e1', 1)
html = html.replace('seguimiento-hommy.js?v=10d2-retry', 'seguimiento-hommy.js?v=10e1-retry', 1)
html_path.write_text(html, encoding='utf-8')
