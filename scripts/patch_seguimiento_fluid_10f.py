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
    "  const HISTORY_TIMEOUT_MS = 45_000;\n  const historyCache = new Map();\n  const TRANSIENT_RETRY_DELAY_MS = 700;\n",
    "  const HISTORY_TIMEOUT_MS = 45_000;\n  const historyCache = new Map();\n  const radarCache = new Map();\n  const planCache = new Map();\n  const PLAN_CACHE_PREFIX = 'homeeasy:seguimiento:hommy-plan:10f1:';\n  const RADAR_CACHE_PREFIX = 'homeeasy:seguimiento:hommy-radar:10f1:';\n  const PLAN_FRESH_MS = 5 * 60 * 1000;\n  const PLAN_MAX_AGE_MS = 2 * 60 * 60 * 1000;\n  const RADAR_FRESH_MS = 2 * 60 * 1000;\n  const RADAR_MAX_AGE_MS = 30 * 60 * 1000;\n  const BACKGROUND_REFRESH_MS = 3 * 60 * 1000;\n  const BACKGROUND_WARMUP_DELAY_MS = 260;\n  const MAX_RADAR_WORKERS = 3;\n  const radarQueue = [];\n  const queuedRadar = new Set();\n  const visibleQuotes = new Set();\n  let radarWorkers = 0;\n  let refreshTimer = null;\n  let cardVisibilityObserver = null;\n  const TRANSIENT_RETRY_DELAY_MS = 700;\n",
    'cache constants',
)

cache_helpers = r'''
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

'''
replace_once('  function renderIdle(panel, numero) {\n', cache_helpers + '  function renderIdle(panel, numero, radarRecord = cachedRadar(numero)) {\n', 'cache helpers before idle')

old_idle = '''  function renderIdle(panel, numero, radarRecord = cachedRadar(numero)) {\n    clearPanel(panel);\n    const wrap = document.createElement('div');\n    wrap.className = 'he-hommy-idle';\n    const button = document.createElement('button');\n    button.type = 'button';\n    button.className = 'he-hommy-analyze';\n    button.append(icon('fas fa-sparkles'));\n    const label = document.createElement('span');\n    label.textContent = 'Analizar con Hommy';\n    button.append(label);\n    button.addEventListener('click', () => analyze(panel, numero));\n    const note = document.createElement('small');\n    note.textContent = 'Revisión comercial · no envía mensajes ni modifica la cotización';\n    wrap.append(button, note);\n    panel.appendChild(wrap);\n    panel.appendChild(createHistoryAccordion(numero));\n  }\n'''
new_idle = '''  function renderIdle(panel, numero, radarRecord = cachedRadar(numero)) {\n    clearPanel(panel);\n    panel.dataset.mode = 'idle';\n    const wrap = document.createElement('div');\n    wrap.className = 'he-hommy-idle';\n\n    const head = document.createElement('div');\n    head.className = 'he-hommy-radar-head';\n    const brand = document.createElement('div');\n    brand.className = 'he-hommy-radar-brand';\n    const mark = document.createElement('span');\n    mark.className = 'he-hommy-radar-mark';\n    mark.append(icon('fas fa-wand-magic-sparkles'));\n    const brandText = document.createElement('span');\n    const title = document.createElement('strong');\n    title.textContent = 'Hommy';\n    const subtitle = document.createElement('small');\n    subtitle.textContent = 'Radar comercial';\n    brandText.append(title, subtitle);\n    brand.append(mark, brandText);\n    const signal = document.createElement('span');\n    signal.className = 'he-hommy-radar-signal';\n    signal.textContent = 'Preparando radar';\n    head.append(brand, signal);\n\n    const chips = document.createElement('div');\n    chips.className = 'he-hommy-radar-chips';\n    const note = document.createElement('div');\n    note.className = 'he-hommy-radar-note';\n    note.textContent = 'Hommy está leyendo el contexto en segundo plano…';\n\n    const button = document.createElement('button');\n    button.type = 'button';\n    button.className = 'he-hommy-analyze';\n    button.append(icon('fas fa-sparkles'));\n    const label = document.createElement('span');\n    label.textContent = 'Analizar con Hommy';\n    button.append(label);\n    button.addEventListener('click', () => analyze(panel, numero));\n    const safety = document.createElement('small');\n    safety.textContent = 'El radar se actualiza en segundo plano; el análisis completo solo se recalcula cuando hace falta.';\n\n    wrap.append(head, chips, note, button, safety);\n    panel.appendChild(wrap);\n    panel.appendChild(createHistoryAccordion(numero));\n    updateIdleRadar(panel, numero, radarRecord);\n  }\n'''
replace_once(old_idle, new_idle, 'render idle radar')

replace_once(
    '      .he-hommy-idle{padding:11px}\n',
    '''      .he-hommy-idle{padding:11px}\n      .he-hommy-radar-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:8px}\n      .he-hommy-radar-brand{display:flex;align-items:center;gap:8px;min-width:0}\n      .he-hommy-radar-mark{width:29px;height:29px;border-radius:9px;background:#f8eef1;color:#b2566c;display:grid;place-items:center;flex:0 0 auto}\n      .he-hommy-radar-brand strong{display:block;color:#413b3e;font-size:12.5px;line-height:1.05;font-weight:760}\n      .he-hommy-radar-brand small{display:block;margin-top:2px!important;text-align:left!important;color:#918a8e!important;font-size:9.8px!important;font-weight:560!important}\n      .he-hommy-radar-signal{min-height:26px;padding:0 9px;border-radius:999px;background:#f4f3f4;color:#716b6f;display:inline-flex;align-items:center;font-size:10.2px;font-weight:760;white-space:nowrap}\n      .he-hommy-radar-chips{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px}\n      .he-hommy-radar-chip{min-height:24px;padding:0 7px;border-radius:8px;background:#f5f4f5;color:#716b6f;display:inline-flex;align-items:center;font-size:10px;font-weight:680}\n      .he-hommy-radar-chip.address{background:#fbf5e8;color:#8d6b2c}\n      .he-hommy-radar-note{margin:0 1px 9px;color:#918a8e;font-size:10.2px;line-height:1.35;font-weight:560}\n      .he-hommy-cache-note{margin:8px 0 0;color:#918a8e;font-size:10px;line-height:1.3;font-weight:560}\n''',
    'radar css',
)

# When history is fetched by opening the accordion, also update the background radar cache.
replace_once(
    "          historyCache.set(key, payload);\n        }\n        if (details.isConnected) renderHistoryPayload(body, meta, payload);\n",
    "          historyCache.set(key, payload);\n        }\n        const radarRecord = rememberRadar(numero, payload);\n        updateIdleRadar(panelFor(numero), numero, radarRecord);\n        if (details.isConnected) renderHistoryPayload(body, meta, payload);\n",
    'history updates radar',
)

background_helpers = r'''
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
        .catch(() => {})
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
      renderResult(panel, key, planRecord.payload, { cached: true, cachedAt: planRecord.cachedAt });
      if (Date.now() - planRecord.cachedAt > PLAN_FRESH_MS && visibleQuotes.has(key)) {
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
    document.querySelectorAll('.crm-card').forEach((card, index) => {
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

'''
replace_once('  async function copyText(value) {\n', background_helpers + '  async function copyText(value) {\n', 'background helpers')

# Result rendering now marks mode and can label restored cache without forcing a network request.
replace_once(
    '  function renderResult(panel, numero, payload) {\n    clearPanel(panel);\n',
    "  function renderResult(panel, numero, payload, options = {}) {\n    clearPanel(panel);\n    panel.dataset.mode = 'result';\n",
    'render result signature',
)
replace_once(
    "    result.appendChild(head);\n\n    const chips = document.createElement('div');\n",
    "    result.appendChild(head);\n\n    if (options.cached) {\n      const cacheNote = document.createElement('div');\n      cacheNote.className = 'he-hommy-cache-note';\n      cacheNote.textContent = `Análisis guardado ${ageLabel(options.cachedAt)} · se actualizará en segundo plano si cambia el contexto.`;\n      result.appendChild(cacheNote);\n    }\n\n    const chips = document.createElement('div');\n",
    'cached result note',
)

# Preserve the plan after one analysis; subsequent card rerenders restore it instantly.
replace_once(
    "      if (panel.isConnected) renderResult(panel, numero, payload);\n",
    "      const record = rememberPlan(numero, payload);\n      if (panel.isConnected) renderResult(panel, numero, payload, { cached: false, cachedAt: record.cachedAt });\n",
    'remember analyzed plan',
)
replace_once(
    "    panel.dataset.loading = '1';\n    invalidateHistory(numero);\n    renderLoading(panel);\n",
    "    panel.dataset.loading = '1';\n    panel.dataset.mode = 'loading';\n    invalidateHistory(numero);\n    renderLoading(panel);\n",
    'analysis mode',
)

# A successful send changes the opportunity; do not keep a stale reusable draft in session cache.
replace_once(
    "      markDelivery(panel, delivery, sync);\n      resetHistoryControl(panel, numero);\n",
    "      markDelivery(panel, delivery, sync);\n      forgetPlan(numero);\n      resetHistoryControl(panel, numero);\n      queueRadar(numero, true, true);\n",
    'send invalidates plan',
)

# Restore cached plan/radar when filters or data refresh recreate the cards.
replace_once(
    "    panel.setAttribute('aria-label', `Revisión comercial de Hommy para cotización ${numero}`);\n    renderIdle(panel, numero);\n    body.appendChild(panel);\n",
    "    panel.setAttribute('aria-label', `Revisión comercial de Hommy para cotización ${numero}`);\n    body.appendChild(panel);\n    restorePanel(panel, numero);\n    ensureVisibilityObserver();\n    if (cardVisibilityObserver) cardVisibilityObserver.observe(card);\n",
    'restore enhanced card',
)

old_install = '''  function install() {\n    addStyles();\n    enhanceCards();\n    const container = document.getElementById('tarjetas-container');\n    if (!container) return;\n    const observer = new MutationObserver(() => enhanceCards());\n    observer.observe(container, { childList: true, subtree: true });\n  }\n'''
new_install = '''  function install() {\n    addStyles();\n    enhanceCards();\n    const container = document.getElementById('tarjetas-container');\n    if (!container) return;\n    const observer = new MutationObserver(() => enhanceCards());\n    observer.observe(container, { childList: true, subtree: true });\n    window.setTimeout(warmRadar, BACKGROUND_WARMUP_DELAY_MS);\n    scheduleBackgroundRefresh();\n    document.addEventListener('visibilitychange', () => {\n      if (!document.hidden) window.setTimeout(warmRadar, 30);\n    });\n    window.addEventListener('homeeasy:seguimiento-updated', event => {\n      const numero = clean(event && event.detail && event.detail.numero);\n      if (!numero) return;\n      forgetPlan(numero);\n      invalidateHistory(numero);\n      radarCache.delete(numero);\n      sessionRemove(radarStorageKey(numero));\n      const panel = panelFor(numero);\n      if (panel) renderIdle(panel, numero, null);\n      queueRadar(numero, true, true);\n    });\n  }\n'''
replace_once(old_install, new_install, 'install background refresh')

js_path.write_text(source, encoding='utf-8')

# Bump asset version and tell the Hommy extension immediately when a manual note/archive changes context.
html_path = Path('seguimiento.html')
page = html_path.read_text(encoding='utf-8')
if page.count('seguimiento-hommy.js?v=10e1') != 1 or page.count('seguimiento-hommy.js?v=10e1-retry') != 1:
    raise SystemExit('seguimiento.html 10e1 asset anchors did not match exactly')
page = page.replace('seguimiento-hommy.js?v=10e1-retry', 'seguimiento-hommy.js?v=10f1-retry', 1)
page = page.replace('seguimiento-hommy.js?v=10e1', 'seguimiento-hommy.js?v=10f1', 1)

old_success = '''                    aplicarFiltros();\n                } else {\n'''
new_success = '''                    window.dispatchEvent(new CustomEvent('homeeasy:seguimiento-updated', {\n                        detail: { numero: String(numero), archived: Boolean(removerDePantalla), noteChanged: payloadData.notasSeguimiento !== undefined }\n                    }));\n                    aplicarFiltros();\n                } else {\n'''
if page.count(old_success) != 1:
    raise SystemExit(f'seguimiento update success anchor mismatch: {page.count(old_success)}')
page = page.replace(old_success, new_success, 1)
html_path.write_text(page, encoding='utf-8')
