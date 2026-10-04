(function (global) {
  'use strict';

  const API = 'https://api.homeeasy.com.co';
  const SAFE_STATUSES = new Set(['INCREASED', 'DECREASED', 'NEW']);
  const FILTERS = Object.freeze([
    ['ALL', 'Todos'], ['INCREASED', 'Aumentos'], ['DECREASED', 'Disminuciones'],
    ['REVIEW_REQUIRED', 'Revisar'], ['UNMAPPED', 'Sin mapear']
  ]);
  const STATUS_LABELS = Object.freeze({
    INCREASED: 'Aumentado', DECREASED: 'Disminuido', NEW: 'Nuevo', UNCHANGED: 'Sin cambios',
    REVIEW_REQUIRED: 'Revisar', UNMAPPED: 'Sin mapear', ERROR: 'Error'
  });
  const STAGES = Object.freeze({
    QUEUED: 'Conectando con agente…', READING_HOMEEASY: 'Leyendo catálogo HomeEasy…',
    READING_PENTAGRAMA: 'Consultando Pentagrama…', COMPARING: 'Comparando tarifas…',
    SNAPSHOT: 'Creando respaldo…', WRITING_SHEET: 'Actualizando Sheet y refrescando caché…',
    QA: 'Ejecutando QA…', ROLLING_BACK: 'Restaurando versión y validando catálogo…',
    COMPLETED: 'Validación terminada', FAILED: 'La operación no pudo completarse'
  });
  const ERROR_MESSAGES = Object.freeze({
    AGENT_OFFLINE: 'No hay ningún agente Pentagrama disponible. Enciende uno de los equipos registrados e inténtalo nuevamente.',
    AGENT_TIMEOUT: 'El agente Pentagrama no respondió a tiempo. Verifica que el equipo siga encendido y conectado.',
    AGENT_TRANSPORT_ERROR: 'Se perdió la comunicación con el agente Pentagrama. Inténtalo nuevamente cuando la conexión esté estable.',
    PENTAGRAMA_ACCESS_BLOCKED: 'Pentagrama bloqueó la red del agente. Usa un equipo conectado desde una red autorizada.',
    PENTAGRAMA_SESSION_EXPIRED: 'La sesión de Pentagrama no es válida. Revisa las credenciales del agente e inténtalo nuevamente.',
    PENTAGRAMA_UNEXPECTED_RESPONSE: 'Pentagrama respondió de una forma inesperada. No se modificó ninguna tarifa.',
    PENTAGRAMA_SCAN_EXPIRED: 'Este análisis venció. Ejecuta “Actualizar tarifas” antes de aplicar cambios.',
    PENTAGRAMA_NO_APPLICABLE_CHANGES: 'No hay cambios normales seleccionados para aplicar.',
    HOMEEASY_SYNC_UPSTREAM_UNAVAILABLE: 'No fue posible comunicarse con la Sheet de HomeEasy. No se aplicaron cambios.',
    HOMEEASY_SYNC_SESSION_REQUIRED: 'Tu sesión de HomeEasy venció. Inicia sesión nuevamente para continuar.',
    APP_SESSION_EXPIRED: 'Tu sesión de HomeEasy venció. Inicia sesión nuevamente para continuar.',
    APP_SESSION_REJECTED: 'Tu sesión de HomeEasy ya no es válida. Inicia sesión nuevamente.',
    ROLLBACK_CONFIRMATION_REQUIRED: 'La restauración requiere una confirmación explícita.'
  });

  function friendlyError(error) {
    const code = String(error && (error.code || error.message) || error || '');
    if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    if (/QA/i.test(code)) return 'El QA no pasó. HomeEasy fue restaurado automáticamente al estado anterior.';
    if (/SHEET|COSTOS_SYNC|HOMEEASY_SYNC/i.test(code)) return 'La actualización de la Sheet falló. HomeEasy conserva los valores anteriores.';
    return 'No fue posible completar la operación. No se modificaron tarifas; inténtalo nuevamente.';
  }

  function deriveOverview(scan, agents) {
    const results = scan && Array.isArray(scan.results) ? scan.results : [];
    const counts = scan && scan.counts || {};
    const online = (agents || []).filter(item => item.online).length;
    const changes = Number(counts.INCREASED || 0) + Number(counts.DECREASED || 0) + Number(counts.NEW || 0);
    const review = Number(counts.REVIEW_REQUIRED || 0);
    const errors = Number(counts.ERROR || 0);
    let tone = 'neutral'; let label = 'Sin revisar';
    if (!online) { tone = 'error'; label = 'Sin agente disponible'; }
    else if (errors) { tone = 'error'; label = 'Requiere atención'; }
    else if (changes || review) { tone = 'pending'; label = 'Cambios pendientes'; }
    else if (scan) { tone = 'success'; label = 'Sincronizado'; }
    return { tone, label, online, totalAgents: (agents || []).length, changes, review, errors,
      checked: results.filter(item => item.status !== 'UNMAPPED').length, unmapped: Number(counts.UNMAPPED || 0) };
  }

  function filterResults(results, filter) {
    const values = Array.isArray(results) ? results : [];
    return filter === 'ALL' ? values : values.filter(item => item.status === filter);
  }

  const publicApi = Object.freeze({ friendlyError, deriveOverview, filterResults, STATUS_LABELS });
  global.HomeEasyPentagramaSyncUI = publicApi;
  if (typeof module === 'object' && module.exports) module.exports = publicApi;
  if (typeof document === 'undefined') return;

  const state = { scan: null, status: null, history: [], filter: 'ALL', selected: new Set(), busy: false, limit: 50, error: null, scans: new Map() };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(Number(value || 0));
  const dateTime = value => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin registros';
  const auth = () => global.HomeEasyAuth || null;
  const can = permission => Boolean(auth() && auth().hasPermission && auth().hasPermission(permission));

  function headers(body) {
    const meta = auth().buildMeta({ pagina: 'pentagrama-sync' });
    return { Accept: 'application/json', 'X-HomeEasy-Session': auth().getAppSessionToken(),
      'X-HomeEasy-Device-Id': encodeURIComponent(meta.dispositivoId || ''),
      'X-HomeEasy-Device-Name': encodeURIComponent(meta.dispositivoNombre || ''),
      'X-HomeEasy-Platform': encodeURIComponent(meta.plataforma || ''),
      'X-HomeEasy-Browser': encodeURIComponent(meta.navegador || ''),
      ...(body ? { 'Content-Type': 'application/json' } : {}) };
  }

  async function request(path, method = 'GET', body) {
    const response = await fetch(API + path, { method, headers: headers(body), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || data.code || 'PENTAGRAMA_SYNC_FAILED'); error.code = data.code || data.error || 'PENTAGRAMA_SYNC_FAILED'; error.status = response.status; throw error; }
    return data;
  }

  function panel() {
    const node = document.createElement('div'); node.className = 'panel'; node.id = 'panel-pentagrama'; node.dataset.panel = 'pentagrama';
    node.innerHTML = `
      <div class="page-heading"><h2>Precios Pentagrama</h2><p>Verifica y actualiza el costo proveedor sin alterar precios comerciales, transporte, instalación ni margen.</p></div>
      <section class="card he-ps-overview">
        <div class="he-ps-overview-main"><div class="he-ps-status-line"><span class="he-ps-status-dot neutral" id="hePsStatusDot"></span><div><span class="he-ps-eyebrow">Estado Pentagrama</span><h3 id="hePsStatusLabel">Cargando…</h3><p id="hePsStatusHelp">Consultando el último estado disponible.</p></div></div><button class="he-ps-button primary" id="hePsScan"><i class="fa-solid fa-arrows-rotate"></i><span>Actualizar tarifas</span></button></div>
        <div class="he-ps-metrics" id="hePsMetrics"></div><div class="he-ps-alert" id="hePsAlert" hidden></div>
        <div class="he-ps-progress" id="hePsProgress" hidden aria-live="polite"><div class="he-ps-progress-head"><span class="he-ps-spinner"></span><div><strong id="hePsProgressTitle"></strong><span>Los pasos avanzan con el estado real del servidor.</span></div></div><div class="he-ps-progress-steps" id="hePsProgressSteps"></div></div>
      </section>
      <section class="card he-ps-results-card">
        <div class="he-ps-section-head"><div><span class="he-ps-eyebrow">Comparación más reciente</span><h3>Resultados</h3><p id="hePsResultsSummary">Aún no hay información para mostrar.</p></div><button class="he-ps-button primary" id="hePsApply" disabled><i class="fa-solid fa-check"></i><span>Aplicar actualización</span></button></div>
        <div class="he-ps-success-empty" id="hePsUpToDate" hidden><span><i class="fa-solid fa-check"></i></span><div><strong>Todo está actualizado</strong><p>No se encontraron diferencias entre Pentagrama y HomeEasy.</p></div></div>
        <div class="he-ps-review-note" id="hePsReviewNote" hidden><i class="fa-solid fa-triangle-exclamation"></i><div><strong>Hay referencias que requieren revisión</strong><p>Estos casos se muestran claramente y nunca se aplican de forma automática.</p></div></div>
        <div class="he-ps-filters" id="hePsFilters" aria-label="Filtros de resultados"></div>
        <div class="he-ps-table-wrap"><table class="he-ps-table"><thead><tr><th class="he-ps-check-col"><span class="sr-only">Seleccionar</span></th><th>Producto</th><th>Familia</th><th>Anterior</th><th>Nuevo</th><th>Cambio</th><th>Estado</th></tr></thead><tbody id="hePsRows"><tr><td colspan="7" class="he-ps-empty">Ejecuta una actualización para comparar tarifas.</td></tr></tbody></table></div><button class="he-ps-more" id="hePsMore" hidden>Mostrar más resultados</button>
      </section>
      <div class="he-ps-secondary-grid">
        <section class="card he-ps-compact-card"><div class="he-ps-section-head compact"><div><span class="he-ps-eyebrow">Disponibilidad</span><h3>Agentes Pentagrama</h3></div><i class="fa-solid fa-computer he-ps-section-icon"></i></div><div id="hePsAgents" class="he-ps-list"><div class="he-ps-empty">Consultando agentes…</div></div></section>
        <section class="card he-ps-compact-card"><div class="he-ps-section-head compact"><div><span class="he-ps-eyebrow">Trazabilidad</span><h3>Historial</h3></div><i class="fa-solid fa-clock-rotate-left he-ps-section-icon"></i></div><div id="hePsHistory" class="he-ps-list"><div class="he-ps-empty">Consultando historial…</div></div></section>
      </div>`;
    return node;
  }

  function addNav() {
    document.querySelectorAll('.side-nav').forEach(nav => { if (nav.querySelector('[data-section="pentagrama"]')) return; const button = document.createElement('button'); button.className = 'nav-button'; button.dataset.section = 'pentagrama'; button.innerHTML = '<i class="fa-solid fa-tags"></i> Precios Pentagrama'; nav.appendChild(button); });
    document.querySelectorAll('.mobile-tabs').forEach(nav => { if (nav.querySelector('[data-section="pentagrama"]')) return; const button = document.createElement('button'); button.className = 'mobile-tab'; button.dataset.section = 'pentagrama'; button.textContent = 'Pentagrama'; nav.appendChild(button); });
    document.querySelectorAll('[data-section="pentagrama"]').forEach(button => button.addEventListener('click', activate));
  }
  function activate() { document.querySelectorAll('[data-panel]').forEach(node => node.classList.toggle('active', node.dataset.panel === 'pentagrama')); document.querySelectorAll('.nav-button,.mobile-tab').forEach(button => button.classList.toggle('active', button.dataset.section === 'pentagrama')); try { history.replaceState(null, '', 'configuracion.html?section=pentagrama'); } catch (_) {} refresh(); }
  function metric(icon, label, value, hint) { return `<div class="he-ps-metric"><span class="he-ps-metric-icon"><i class="fa-solid ${icon}"></i></span><div><span>${esc(label)}</span><strong>${esc(value)}</strong>${hint ? `<small>${esc(hint)}</small>` : ''}</div></div>`; }

  function renderOverview() {
    const agents = state.status && state.status.agents || []; const overview = deriveOverview(state.scan, agents); const dot = $('#hePsStatusDot'); dot.className = `he-ps-status-dot ${overview.tone}`;
    $('#hePsStatusLabel').textContent = overview.label;
    $('#hePsStatusHelp').textContent = overview.tone === 'success' ? 'Las referencias verificadas coinciden con el costo vigente.' : overview.tone === 'pending' ? 'Revisa el resultado antes de aplicar cambios normales.' : overview.tone === 'error' ? 'La operación necesita atención antes de continuar.' : 'Ejecuta una actualización para comparar tarifas.';
    const nextCheck = state.status && state.status.nextScheduledCheck;
    $('#hePsMetrics').innerHTML = [metric('fa-clock', 'Última sincronización', dateTime(state.scan && state.scan.checkedAt)), metric('fa-list-check', 'Referencias verificadas', String(overview.checked), `${overview.unmapped} sin mapear`), metric('fa-arrow-right-arrow-left', 'Cambios pendientes', String(overview.changes), overview.review ? `${overview.review} por revisar` : 'Sin anomalías'), metric('fa-computer', 'Agentes disponibles', `${overview.online} de ${overview.totalAgents}`), metric('fa-calendar-check', 'Próxima revisión', nextCheck ? dateTime(nextCheck) : 'No programada')].join('');
    const alert = $('#hePsAlert');
    if (state.error) { alert.hidden = false; alert.className = 'he-ps-alert error'; alert.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><span>${esc(friendlyError(state.error))}</span>`; }
    else if (!overview.online) { alert.hidden = false; alert.className = 'he-ps-alert error'; alert.innerHTML = `<i class="fa-solid fa-computer"></i><span>${esc(ERROR_MESSAGES.AGENT_OFFLINE)}</span>`; }
    else { alert.hidden = true; alert.innerHTML = ''; }
    $('#hePsScan').disabled = state.busy || !can('config.write');
  }

  function isSafe(item) { return Boolean(item && item.id && SAFE_STATUSES.has(item.status) && item.severity !== 'review_required'); }
  function selectedSafe() { return (state.scan && state.scan.results || []).filter(item => isSafe(item) && state.selected.has(item.id)); }
  function filterButton(value, label, counts) { const count = value === 'ALL' ? (state.scan && state.scan.results || []).length : Number(counts[value] || 0); return `<button class="he-ps-filter${state.filter === value ? ' active' : ''}" data-filter="${value}">${esc(label)}<span>${count}</span></button>`; }

  function renderResults() {
    const scan = state.scan; const results = scan && scan.results || []; const counts = scan && scan.counts || {}; const safeTotal = results.filter(isSafe).length; const pending = Number(counts.INCREASED || 0) + Number(counts.DECREASED || 0) + Number(counts.NEW || 0);
    $('#hePsResultsSummary').textContent = scan ? `${results.length} referencias leídas · ${pending} cambios normales · ${Number(counts.REVIEW_REQUIRED || 0)} por revisar` : 'Aún no hay información para mostrar.';
    $('#hePsUpToDate').hidden = !(scan && pending === 0 && Number(counts.REVIEW_REQUIRED || 0) === 0 && Number(counts.ERROR || 0) === 0);
    $('#hePsReviewNote').hidden = !(Number(counts.REVIEW_REQUIRED || 0) || Number(counts.ERROR || 0));
    $('#hePsFilters').innerHTML = FILTERS.map(([value, label]) => filterButton(value, label, counts)).join('');
    $('#hePsFilters').querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { state.filter = button.dataset.filter; state.limit = 50; renderResults(); });
    const filtered = filterResults(results, state.filter); const visible = filtered.slice(0, state.limit);
    $('#hePsRows').innerHTML = visible.length ? visible.map(item => {
      const safe = isSafe(item); const checked = safe && state.selected.has(item.id); const statusNote = item.status === 'ERROR' ? `<small>${esc(friendlyError(item.error))}</small>` : item.severity === 'warning' ? '<small>Variación entre 15 % y 30 %</small>' : '';
      return `<tr class="he-ps-row ${esc(item.status)}"><td class="he-ps-check-col" data-label="Seleccionar">${safe ? `<label class="he-ps-checkbox"><input type="checkbox" data-change-id="${esc(item.id)}" ${checked ? 'checked' : ''} aria-label="Seleccionar ${esc(item.reference || item.homeeasyId)}"><span></span></label>` : ''}</td><td data-label="Producto"><strong>${esc(item.reference || item.homeeasyId || '—')}</strong>${item.productCode ? `<small>${esc(item.productCode)}</small>` : ''}</td><td data-label="Familia">${esc(item.family || '—')}</td><td data-label="Anterior">${Number.isFinite(item.oldCost) ? money(item.oldCost) : '—'}</td><td data-label="Nuevo">${Number.isFinite(item.newCost) ? money(item.newCost) : '—'}</td><td data-label="Cambio"><strong class="he-ps-delta ${Number(item.difference) < 0 ? 'down' : Number(item.difference) > 0 ? 'up' : ''}">${Number.isFinite(item.difference) ? money(item.difference) : '—'}</strong>${Number.isFinite(item.percent) ? `<small>${item.percent > 0 ? '+' : ''}${esc(item.percent)} %</small>` : ''}</td><td data-label="Estado"><span class="he-ps-pill ${esc(item.status)}">${esc(STATUS_LABELS[item.status] || item.status)}</span>${statusNote}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="he-ps-empty">No hay resultados para este filtro.</td></tr>';
    $('#hePsRows').querySelectorAll('[data-change-id]').forEach(input => input.onchange = () => { if (input.checked) state.selected.add(input.dataset.changeId); else state.selected.delete(input.dataset.changeId); renderApplyButton(); });
    const more = $('#hePsMore'); more.hidden = filtered.length <= state.limit; more.textContent = `Mostrar más (${Math.max(0, filtered.length - state.limit)})`; renderApplyButton(safeTotal);
  }

  function renderApplyButton(safeTotal) { const button = $('#hePsApply'); const selected = selectedSafe().length; const available = Number.isFinite(safeTotal) ? safeTotal : (state.scan && state.scan.results || []).filter(isSafe).length; button.disabled = state.busy || !can('config.write') || !selected; button.querySelector('span').textContent = selected ? `Aplicar actualización (${selected})` : available ? 'Selecciona cambios' : 'Sin cambios aplicables'; }
  function pentagramaStatus(agent) { const value = agent && agent.pentagrama && agent.pentagrama.status || 'unknown'; if (value === 'ready') return ['Pentagrama disponible', 'ready']; if (value === 'error') return [friendlyError(agent.pentagrama.code), 'error']; return ['Pentagrama sin comprobar', 'unknown']; }
  function renderAgents(items) { $('#hePsAgents').innerHTML = (items || []).map(agent => { const portal = pentagramaStatus(agent); return `<div class="he-ps-list-row agent"><span class="he-ps-agent-icon ${agent.online ? 'online' : 'offline'}"><i class="fa-solid fa-computer"></i></span><div class="he-ps-list-copy"><strong>${esc(agent.hostname || agent.installationId)}</strong><span><b class="he-ps-presence ${agent.online ? 'online' : 'offline'}">${agent.online ? 'Online' : 'Offline'}</b> · v${esc(agent.version || '—')}</span><small>${esc(portal[0])} · Última conexión ${esc(dateTime(agent.lastSeen))}</small></div></div>`; }).join('') || '<div class="he-ps-empty"><i class="fa-solid fa-computer"></i><strong>No hay agentes registrados</strong><span>Instala o enciende un agente para consultar Pentagrama.</span></div>'; }
  function historyAgent() { const agents = state.status && state.status.agents || []; return agents.length === 1 ? agents[0].hostname || agents[0].installationId : 'No registrado'; }

  function renderHistory(items) {
    const rolledBack = new Set((items || []).filter(item => item.type === 'ROLLBACK').map(item => item.sourceHistoryId));
    $('#hePsHistory').innerHTML = (items || []).slice(0, 8).map(item => { const qaOk = Boolean(item.qa && item.qa.ok); const reverted = rolledBack.has(item.id); return `<div class="he-ps-list-row history"><span class="he-ps-history-icon ${item.type === 'ROLLBACK' ? 'rollback' : qaOk ? 'success' : 'error'}"><i class="fa-solid ${item.type === 'ROLLBACK' ? 'fa-rotate-left' : qaOk ? 'fa-check' : 'fa-xmark'}"></i></span><div class="he-ps-list-copy"><strong>${item.type === 'ROLLBACK' ? 'Versión restaurada' : `${Number(item.changed || 0)} cambio(s) aplicado(s)`}</strong><span>${esc(dateTime(item.at))} · QA ${qaOk ? 'PASS' : 'FAIL'}</span><small>${esc(item.actor && (item.actor.nombre || item.actor.email) || 'Sistema')} · ${esc(historyAgent())}</small><div class="he-ps-row-actions"><button data-history-detail="${esc(item.id)}">Ver detalle</button>${item.type === 'APPLY' && !reverted && can('config.write') ? `<button class="danger" data-rollback="${esc(item.id)}">Restaurar versión</button>` : reverted ? '<span class="he-ps-restored">Restaurada</span>' : ''}</div></div></div>`; }).join('') || '<div class="he-ps-empty"><i class="fa-solid fa-clock-rotate-left"></i><strong>Todavía no hay actualizaciones</strong><span>Los futuros cambios y QA aparecerán aquí.</span></div>';
    $('#hePsHistory').querySelectorAll('[data-history-detail]').forEach(button => button.onclick = () => openHistory(button.dataset.historyDetail));
    $('#hePsHistory').querySelectorAll('[data-rollback]').forEach(button => button.onclick = () => rollback(button.dataset.rollback));
  }
  function renderAll() { renderOverview(); renderResults(); renderAgents(state.status && state.status.agents || []); renderHistory(state.history); }

  function setProgress(stage, type) {
    const box = $('#hePsProgress'); if (!stage) { box.hidden = true; return; }
    const scanStages = ['QUEUED', 'READING_HOMEEASY', 'READING_PENTAGRAMA', 'COMPARING']; const applyStages = type === 'rollback' ? ['ROLLING_BACK'] : ['SNAPSHOT', 'WRITING_SHEET', 'QA']; const stages = type === 'scan' ? scanStages : applyStages; const currentIndex = Math.max(0, stages.indexOf(stage));
    box.hidden = false; $('#hePsProgressTitle').textContent = STAGES[stage] || stage; $('#hePsProgressSteps').innerHTML = stages.map((value, index) => `<span class="${index < currentIndex ? 'done' : index === currentIndex ? 'current' : ''}"><i class="fa-solid ${index < currentIndex ? 'fa-check' : 'fa-circle'}"></i>${esc(STAGES[value].replace('…', ''))}</span>`).join('');
  }
  async function poll(id, type) { for (let index = 0; index < 180; index += 1) { const data = await request('/api/pentagrama-sync/operations/' + encodeURIComponent(id)); const operation = data.operation; setProgress(operation.stage, type || operation.type); if (operation.state === 'completed') { setProgress(null); return operation; } if (operation.state === 'failed') { const error = new Error(operation.error && operation.error.code || 'PENTAGRAMA_SYNC_FAILED'); error.code = operation.error && operation.error.code || 'PENTAGRAMA_SYNC_FAILED'; throw error; } await new Promise(resolve => setTimeout(resolve, 1000)); } const error = new Error('AGENT_TIMEOUT'); error.code = 'AGENT_TIMEOUT'; throw error; }
  function selectSafeDefaults() { state.selected = new Set((state.scan && state.scan.results || []).filter(isSafe).map(item => item.id)); }
  async function refresh(options = {}) { try { const [status, history] = await Promise.all([request('/api/pentagrama-sync/status'), request('/api/pentagrama-sync/history')]); state.status = status; state.scan = status.latestScan; state.history = history.items || []; state.error = null; if (options.resetSelection) selectSafeDefaults(); renderAll(); } catch (error) { state.error = error; renderOverview(); } }

  async function scan() {
    if (state.busy) return; state.busy = true; state.error = null; renderAll();
    try { const started = await request('/api/pentagrama-sync/scan', 'POST', {}); await poll(started.operation.id, 'scan'); await refresh({ resetSelection: true }); const counts = state.scan && state.scan.counts || {}; const changes = Number(counts.INCREASED || 0) + Number(counts.DECREASED || 0) + Number(counts.NEW || 0); if (!changes && !Number(counts.REVIEW_REQUIRED || 0) && !Number(counts.ERROR || 0)) await Swal.fire({ icon: 'success', title: 'Todo está actualizado', text: 'No se encontraron diferencias entre Pentagrama y HomeEasy.', confirmButtonColor: '#a6455a' }); else await Swal.fire({ icon: 'success', title: 'Comparación terminada', text: 'Revisa los resultados antes de aplicar cambios. La Sheet no fue modificada.', confirmButtonColor: '#a6455a' }); }
    catch (error) { state.error = error; setProgress(null); await Swal.fire({ icon: 'error', title: 'No se pudo actualizar', text: friendlyError(error), confirmButtonColor: '#a6455a' }); }
    finally { state.busy = false; renderAll(); }
  }

  async function apply() {
    const changes = selectedSafe(); if (!changes.length) return;
    const result = await Swal.fire({ icon: 'warning', title: `Aplicar ${changes.length} cambio(s)`, html: 'Se creará un respaldo, se actualizará la Sheet, se refrescará la caché y se ejecutará QA.<br><b>Los casos “Revisar” no se aplicarán.</b>', showCancelButton: true, confirmButtonText: 'Crear respaldo y aplicar', cancelButtonText: 'Cancelar', confirmButtonColor: '#a6455a' }); if (!result.isConfirmed) return;
    state.busy = true; state.error = null; renderAll();
    try { const started = await request('/api/pentagrama-sync/apply', 'POST', { scanId: state.scan.id, changeIds: changes.map(item => item.id) }); const operation = await poll(started.operation.id, 'apply'); await refresh({ resetSelection: true }); const qa = operation.result && operation.result.qa; if (!qa || qa.ok !== true) throw Object.assign(new Error('QA_FAILED'), { code: 'QA_FAILED' }); await Swal.fire({ icon: 'success', title: 'HomeEasy actualizado correctamente', text: `Se aplicaron ${changes.length} cambio(s). El respaldo, la caché y el QA quedaron verificados.`, confirmButtonColor: '#a6455a' }); }
    catch (error) { state.error = error; setProgress(null); const rolledBack = /QA/i.test(String(error.code || error.message || '')); await Swal.fire({ icon: 'error', title: 'La actualización no fue aplicada', text: rolledBack ? 'El QA no pasó. HomeEasy fue restaurado al estado anterior.' : friendlyError(error), confirmButtonColor: '#a6455a' }); }
    finally { state.busy = false; renderAll(); }
  }

  async function scanForHistory(entry) { if (!entry || !entry.scanId) return null; if (state.scans.has(entry.scanId)) return state.scans.get(entry.scanId); try { const data = await request('/api/pentagrama-sync/scans/' + encodeURIComponent(entry.scanId)); state.scans.set(entry.scanId, data.scan); return data.scan; } catch (_) { return null; } }
  async function openHistory(id) { const entry = state.history.find(item => item.id === id); if (!entry) return; const scanData = await scanForHistory(entry); const checked = scanData ? scanData.results.filter(item => item.status !== 'UNMAPPED').length : 'No registrado'; const qaOk = Boolean(entry.qa && entry.qa.ok); await Swal.fire({ title: entry.type === 'ROLLBACK' ? 'Versión restaurada' : 'Detalle de actualización', html: `<div class="he-ps-modal-detail"><div><span>Fecha</span><strong>${esc(dateTime(entry.at))}</strong></div><div><span>Agente usado</span><strong>${esc(historyAgent())}</strong></div><div><span>Referencias revisadas</span><strong>${esc(checked)}</strong></div><div><span>Cambios aplicados</span><strong>${esc(entry.changed || 0)}</strong></div><div><span>QA</span><strong class="${qaOk ? 'ok' : 'fail'}">${qaOk ? 'PASS' : 'FAIL'}</strong></div><div><span>Estado final</span><strong>${entry.type === 'ROLLBACK' ? 'Restaurado' : qaOk ? 'Aplicado' : 'Falló'}</strong></div></div>`, confirmButtonColor: '#a6455a' }); }
  async function rollback(id) {
    const entry = state.history.find(item => item.id === id); const result = await Swal.fire({ icon: 'warning', title: 'Restaurar versión', html: `Se restaurarán exactamente los valores del respaldo${entry ? ` del ${esc(dateTime(entry.at))}` : ''} y se ejecutará QA.<br><b>Esta acción requiere confirmación.</b>`, showCancelButton: true, confirmButtonText: 'Sí, restaurar versión', cancelButtonText: 'Cancelar', confirmButtonColor: '#a6455a' }); if (!result.isConfirmed) return;
    state.busy = true; renderAll();
    try { const started = await request('/api/pentagrama-sync/rollback', 'POST', { historyId: id, confirmed: true }); const operation = await poll(started.operation.id, 'rollback'); await refresh({ resetSelection: true }); const qaOk = Boolean(operation.result && operation.result.qa && operation.result.qa.ok); await Swal.fire({ icon: qaOk ? 'success' : 'error', title: qaOk ? 'Versión restaurada' : 'La restauración falló', text: qaOk ? 'El respaldo fue restaurado y el QA terminó correctamente.' : 'HomeEasy no pudo validar la versión restaurada.', confirmButtonColor: '#a6455a' }); }
    catch (error) { state.error = error; setProgress(null); await Swal.fire({ icon: 'error', title: 'No se pudo restaurar', text: friendlyError(error), confirmButtonColor: '#a6455a' }); }
    finally { state.busy = false; renderAll(); }
  }
  function mount() { if (!can('config.read') || $('#panel-pentagrama')) return; document.querySelector('.content').appendChild(panel()); addNav(); $('#hePsScan').onclick = scan; $('#hePsApply').onclick = apply; $('#hePsMore').onclick = () => { state.limit += 50; renderResults(); }; if (new URLSearchParams(location.search).get('section') === 'pentagrama') activate(); refresh({ resetSelection: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 600)); else setTimeout(mount, 600);
})(typeof window !== 'undefined' ? window : globalThis);
