(function (global) {
  'use strict';

  const API = 'https://api.homeeasy.com.co';
  const SAFE_STATUSES = new Set(['INCREASED', 'DECREASED', 'NEW']);
  const FILTERS = Object.freeze([
    ['ALL', 'Todos'], ['INCREASED', 'Aumentos'], ['DECREASED', 'Disminuciones'],
    ['REVIEW_REQUIRED', 'Pendientes de certificar'], ['UNMAPPED', 'Sin mapear']
  ]);
  const STATUS_LABELS = Object.freeze({
    INCREASED: 'Aumentado', DECREASED: 'Disminuido', NEW: 'Nuevo', UNCHANGED: 'Sin cambios',
    REVIEW_REQUIRED: 'Pendiente de certificar', UNMAPPED: 'Sin mapear', ERROR: 'Error',
    DISCONTINUED: 'Descontinuado', RENAMED: 'Renombrado', STRUCTURE_CHANGED: 'Cambio técnico'
  });
  const STAGES = Object.freeze({
    QUEUED: 'Conectando con agente…', READING_HOMEEASY: 'Leyendo catálogo HomeEasy…',
    READING_PENTAGRAMA: 'Consultando Pentagrama…', COMPARING: 'Comparando tarifas…',
    PREWRITE_VALIDATION: 'Validando regla de precio…', SNAPSHOT: 'Creando respaldo…', WRITING_SHEET: 'Actualizando Sheet y refrescando caché…',
    QA: 'Ejecutando QA…', ROLLING_BACK: 'Restaurando versión y validando catálogo…',
    COMPLETED: 'Validación terminada', FAILED: 'La operación no pudo completarse'
  });
  const ERROR_MESSAGES = Object.freeze({
    AGENT_OFFLINE: 'No hay ningún agente Pentagrama disponible. Enciende uno de los equipos registrados e inténtalo nuevamente.',
    AGENT_TIMEOUT: 'El agente Pentagrama no respondió a tiempo. Verifica que el equipo siga encendido y conectado.',
    AGENT_TRANSPORT_ERROR: 'Se perdió la comunicación con el agente Pentagrama. Inténtalo nuevamente cuando la conexión esté estable.',
    PENTAGRAMA_ACCESS_BLOCKED: 'Pentagrama bloqueó la red del agente. Usa un equipo conectado desde una red autorizada.',
    PENTAGRAMA_SESSION_EXPIRED: 'La sesión de Pentagrama no es válida. Revisa la sesión de Brave en el equipo del agente e inténtalo nuevamente.',
    PENTAGRAMA_BROWSER_SESSION_REQUIRED: 'El Agent está conectado, pero Brave todavía no tiene una sesión Pentagrama disponible. Abre o inicia sesión en Pentagrama desde ese equipo.',
    PENTAGRAMA_CAPTCHA_REQUIRED: 'Pentagrama solicitó CAPTCHA. Complétalo en Brave en el equipo del agente; HomeEasy no modificó ningún precio.',
    PENTAGRAMA_UNEXPECTED_RESPONSE: 'Pentagrama respondió de una forma inesperada. No se modificó ninguna tarifa.',
    PENTAGRAMA_SCAN_EXPIRED: 'Este análisis venció. Ejecuta “Actualizar desde Pentagrama” nuevamente.',
    PENTAGRAMA_PREWRITE_VALIDATION_FAILED: 'Pentagrama cambió o la tarifa dejó de ser reproducible antes de escribir. No se modificó la Sheet.',
    PENTAGRAMA_POST_APPLY_QA_ROLLED_BACK: 'El QA contra Pentagrama no coincidió. El lote fue restaurado automáticamente.',
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
    const audit = scan && scan.catalogAudit || {};
    const online = (agents || []).filter(item => item.online).length;
    const changes = Number(counts.INCREASED || 0) + Number(counts.DECREASED || 0) + Number(counts.NEW || 0);
    const review = Number(counts.REVIEW_REQUIRED || 0);
    const errors = Number(counts.ERROR || 0);
    const certified = Number(audit.certified != null ? audit.certified : audit.mapped != null ? audit.mapped : results.filter(item => item.id).length);
    const unmapped = Number(audit.unmapped != null ? audit.unmapped : counts.UNMAPPED || 0);
    const total = Number(audit.total != null ? audit.total : results.length);
    const catalogPending = Number(audit.newReferences || 0) + Number(audit.discontinued || 0) +
      Number(audit.renamed || 0) + Number(audit.structureChanged || 0) + Number(audit.bindingConflicts || 0) +
      Number(audit.catalogRateChanges || 0);
    const partial = Boolean(scan && (review || unmapped || certified < total || catalogPending));
    let tone = 'neutral'; let label = 'Sin revisar';
    if (!online) { tone = 'error'; label = 'Sin agente disponible'; }
    else if (errors) { tone = 'error'; label = 'Requiere atención'; }
    else if (changes || catalogPending) { tone = 'pending'; label = 'Actualizaciones disponibles'; }
    else if (scan && partial) { tone = 'success'; label = 'Precios al día'; }
    else if (scan) { tone = 'success'; label = 'Sincronizado'; }
    return { tone, label, online, totalAgents: (agents || []).length, changes, catalogPending, review, errors,
      checked: certified, certified, total, partial, unmapped, pentagramaProducts: Number(audit.pentagramaProducts || 0) };
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
        <div class="he-ps-overview-main"><div class="he-ps-status-line"><span class="he-ps-status-dot neutral" id="hePsStatusDot"></span><div><span class="he-ps-eyebrow">Estado Pentagrama</span><h3 id="hePsStatusLabel">Cargando…</h3><p id="hePsStatusHelp">Consultando el último estado disponible.</p></div></div><div class="he-ps-actions"><button class="he-ps-button primary" id="hePsScan"><i class="fa-solid fa-arrows-rotate"></i><span>Actualizar precios</span></button><button class="he-ps-button" id="hePsMaintenance"><i class="fa-solid fa-screwdriver-wrench"></i><span>Mantenimiento profundo</span></button></div></div>
        <div class="he-ps-metrics" id="hePsMetrics"></div><div class="he-ps-alert" id="hePsAlert" hidden></div>
        <div class="he-ps-progress" id="hePsProgress" hidden aria-live="polite"><div class="he-ps-progress-head"><span class="he-ps-spinner"></span><div><strong id="hePsProgressTitle"></strong><span>Los pasos avanzan con el estado real del servidor.</span></div></div><div class="he-ps-progress-steps" id="hePsProgressSteps"></div></div>
      </section>
      <section class="card he-ps-results-card">
        <div class="he-ps-section-head"><div><span class="he-ps-eyebrow">Comparación más reciente</span><h3>Resultados</h3><p id="hePsResultsSummary">Aún no hay información para mostrar.</p></div><button class="he-ps-button primary" id="hePsApply" hidden disabled><i class="fa-solid fa-check"></i><span>Aplicar actualización</span></button></div>
        <div class="he-ps-success-empty" id="hePsUpToDate" hidden><span><i class="fa-solid fa-check"></i></span><div><strong>Todo lo certificado está actualizado</strong><p>Las referencias pendientes o sin mapear permanecen intactas.</p></div></div>
        <div class="he-ps-review-note" id="hePsReviewNote" hidden><i class="fa-solid fa-circle-info"></i><div><strong>Pendientes de certificación</strong><p>No son errores ni bloquean la actualización diaria. Permanecen fuera del auto-apply hasta completar su validación técnica.</p></div></div>
        <div class="he-ps-filters" id="hePsFilters" aria-label="Filtros de resultados"></div>
        <div class="he-ps-table-wrap"><table class="he-ps-table"><thead><tr><th class="he-ps-check-col"><span class="sr-only">Seleccionar</span></th><th>Producto</th><th>Familia</th><th>Anterior</th><th>Nuevo</th><th>Cambio</th><th>Estado</th></tr></thead><tbody id="hePsRows"><tr><td colspan="7" class="he-ps-empty">Ejecuta una actualización para comparar tarifas.</td></tr></tbody></table></div><button class="he-ps-more" id="hePsMore" hidden>Mostrar más resultados</button>
      </section>
      <section class="card he-ps-results-card he-ps-catalog-card">
        <div class="he-ps-section-head"><div><span class="he-ps-eyebrow">Inventario real del proveedor</span><h3>Novedades del catálogo Pentagrama</h3><p id="hePsCatalogSummary">Aún no se ha comparado el catálogo completo.</p></div></div>
        <div class="he-ps-review-note" id="hePsCatalogNote" hidden><i class="fa-solid fa-shield-halved"></i><div><strong>Protección activa</strong><p>Las novedades del catálogo son solo lectura hasta que HomeEasy certifique su regla de precio. Nada nuevo se activa por nombre o aproximación.</p></div></div>
        <div class="he-ps-success-empty" id="hePsCatalogUpToDate" hidden><span><i class="fa-solid fa-check"></i></span><div><strong>Catálogo sin novedades</strong><p>Las identidades técnicas conocidas siguen presentes en Pentagrama.</p></div></div>
        <div class="he-ps-table-wrap"><table class="he-ps-table he-ps-catalog-table"><thead><tr><th>Estado</th><th>Referencia Pentagrama</th><th>Código</th><th>Ruta / familia</th><th>Vínculo HomeEasy</th></tr></thead><tbody id="hePsCatalogRows"><tr><td colspan="5" class="he-ps-empty">Ejecuta una actualización para comparar el catálogo.</td></tr></tbody></table></div>
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
    if (state.error) { overview.tone = 'error'; overview.label = 'Requiere atención'; dot.className = 'he-ps-status-dot error'; }
    $('#hePsStatusLabel').textContent = overview.label;
    $('#hePsStatusHelp').textContent = overview.tone === 'success' && overview.partial ? `${overview.certified} certificadas · ${overview.review} pendientes de certificar · ${overview.unmapped} sin mapear` : overview.tone === 'success' ? 'Las referencias certificadas coinciden con Pentagrama.' : overview.tone === 'pending' ? 'Pentagrama reportó cambios de precio o novedades de catálogo; nada no certificado se aplicará.' : overview.tone === 'error' ? 'La operación necesita atención antes de continuar.' : 'Ejecuta una actualización para comparar precios y catálogo.';
    const nextCheck = state.status && state.status.nextScheduledCheck; const lastAuto = state.status && state.status.lastAutomaticCheck; const autoResult = state.status && state.status.automaticResult;
    const autoHint = autoResult ? (autoResult.event === 'AUTO_SCAN_OK' ? 'Sin cambios' : autoResult.event === 'CHANGES_DETECTED' && Number(autoResult.changes || 0) ? `${Number(autoResult.changes || 0)} cambios pendientes` : autoResult.event === 'CHANGES_DETECTED' ? 'Cobertura parcial' : 'Falló · requiere atención') : 'Aún no ejecutada';
    const audit = state.scan && state.scan.catalogAudit || {};
    const catalogHint = `${Number(audit.newReferences || 0)} nuevas · ${Number(audit.discontinued || 0)} bajas`;
    $('#hePsMetrics').innerHTML = [metric('fa-clock', 'Última revisión automática', lastAuto ? dateTime(lastAuto) : 'Sin registros', autoHint), metric('fa-list-check', 'Referencias certificadas', String(overview.certified), `${overview.review} pendientes de certificar · ${overview.unmapped} sin mapear`), metric('fa-boxes-stacked', 'Catálogo Pentagrama', overview.pentagramaProducts ? String(overview.pentagramaProducts) : '—', overview.pentagramaProducts ? catalogHint : 'Pendiente de lectura'), metric('fa-arrow-right-arrow-left', 'Cambios de precio', String(overview.changes), overview.review ? `${overview.review} pendientes de certificar` : 'Sin anomalías'), metric('fa-computer', 'Agentes disponibles', `${overview.online} de ${overview.totalAgents}`), metric('fa-calendar-check', 'Próxima revisión automática', nextCheck ? dateTime(nextCheck) : 'No programada')].join('');
    const alert = $('#hePsAlert');
    if (state.error) { alert.hidden = false; alert.className = 'he-ps-alert error'; alert.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><span>${esc(friendlyError(state.error))}</span>`; }
    else if (!overview.online) { alert.hidden = false; alert.className = 'he-ps-alert error'; alert.innerHTML = `<i class="fa-solid fa-computer"></i><span>${esc(ERROR_MESSAGES.AGENT_OFFLINE)}</span>`; }
    else { alert.hidden = true; alert.innerHTML = ''; }
    $('#hePsScan').disabled = state.busy || !can('config.write');
    const maintenanceButton = $('#hePsMaintenance'); if (maintenanceButton) maintenanceButton.disabled = state.busy || !can('config.write');
  }

  function isSafe(item) { return Boolean(item && item.id && SAFE_STATUSES.has(item.status) && item.autoApplicable === true); }
  function selectedSafe() { return (state.scan && state.scan.results || []).filter(item => isSafe(item) && state.selected.has(item.id)); }
  function safeCatalogActions() { return (state.scan && state.scan.catalogActions || []).filter(item => item.autoApplicable === true && item.certified === true); }
  function filterButton(value, label, counts) { const count = value === 'ALL' ? (state.scan && state.scan.results || []).length : Number(counts[value] || 0); return `<button class="he-ps-filter${state.filter === value ? ' active' : ''}" data-filter="${value}">${esc(label)}<span>${count}</span></button>`; }

  function renderResults() {
    const scan = state.scan; const results = scan && scan.results || []; const counts = scan && scan.counts || {}; const safeTotal = results.filter(isSafe).length; const pending = Number(counts.INCREASED || 0) + Number(counts.DECREASED || 0) + Number(counts.NEW || 0);
    $('#hePsResultsSummary').textContent = scan ? `${results.length} referencias leídas · ${pending} cambios de precio · ${Number(counts.REVIEW_REQUIRED || 0)} pendientes de certificar` : 'Aún no hay información para mostrar.';
    $('#hePsUpToDate').hidden = !(scan && pending === 0 && Number(counts.ERROR || 0) === 0);
    const reviewCount = Number(counts.REVIEW_REQUIRED || 0);
    const reviewNote = $('#hePsReviewNote');
    reviewNote.hidden = !reviewCount;
    if (reviewCount) {
      const byFamily = results.filter(item => item.status === 'REVIEW_REQUIRED').reduce((acc, item) => {
        const family = String(item.family || 'Sin familia');
        acc[family] = (acc[family] || 0) + 1;
        return acc;
      }, {});
      const familySummary = Object.entries(byFamily)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([family, total]) => `${family}: ${total}`)
        .join(' · ');
      reviewNote.innerHTML = `<i class="fa-solid fa-circle-info"></i><div><strong>Pendientes de certificación</strong><p>No son errores ni bloquean la actualización diaria. Se resolverán por familia en mantenimiento${familySummary ? `: ${esc(familySummary)}` : ''}.</p></div>`;
    }
    $('#hePsFilters').innerHTML = FILTERS.map(([value, label]) => filterButton(value, label, counts)).join('');
    $('#hePsFilters').querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { state.filter = button.dataset.filter; state.limit = 50; renderResults(); });
    const filtered = filterResults(results, state.filter); const visible = filtered.slice(0, state.limit);
    $('#hePsRows').innerHTML = visible.length ? visible.map(item => {
      const safe = isSafe(item); const checked = safe && state.selected.has(item.id); const statusNote = item.status === 'ERROR' ? `<small>${esc(friendlyError(item.error))}</small>` : item.status === 'REVIEW_REQUIRED' && item.reviewReason ? `<small>${esc(item.reviewReason)}</small>` : item.severity === 'warning' ? '<small>Variación entre 15 % y 30 %</small>' : '';
      return `<tr class="he-ps-row ${esc(item.status)}"><td class="he-ps-check-col" data-label="Seleccionar">${safe ? `<label class="he-ps-checkbox"><input type="checkbox" data-change-id="${esc(item.id)}" ${checked ? 'checked' : ''} aria-label="Seleccionar ${esc(item.reference || item.homeeasyId)}"><span></span></label>` : ''}</td><td data-label="Producto"><strong>${esc(item.reference || item.homeeasyId || '—')}</strong>${item.productCode ? `<small>${esc(item.productCode)}</small>` : ''}</td><td data-label="Familia">${esc(item.family || '—')}</td><td data-label="Anterior">${Number.isFinite(item.oldCost) ? money(item.oldCost) : '—'}</td><td data-label="Nuevo">${Number.isFinite(item.newCost) ? money(item.newCost) : '—'}</td><td data-label="Cambio"><strong class="he-ps-delta ${Number(item.difference) < 0 ? 'down' : Number(item.difference) > 0 ? 'up' : ''}">${Number.isFinite(item.difference) ? money(item.difference) : '—'}</strong>${Number.isFinite(item.percent) ? `<small>${item.percent > 0 ? '+' : ''}${esc(item.percent)} %</small>` : ''}</td><td data-label="Estado"><span class="he-ps-pill ${esc(item.status)}">${esc(STATUS_LABELS[item.status] || item.status)}</span>${statusNote}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="he-ps-empty">No hay resultados para este filtro.</td></tr>';
    $('#hePsRows').querySelectorAll('[data-change-id]').forEach(input => input.onchange = () => { if (input.checked) state.selected.add(input.dataset.changeId); else state.selected.delete(input.dataset.changeId); renderApplyButton(); });
    const more = $('#hePsMore'); more.hidden = filtered.length <= state.limit; more.textContent = `Mostrar más (${Math.max(0, filtered.length - state.limit)})`; renderApplyButton(safeTotal);
  }

  function catalogAction(status, action) {
    if (action && action.autoApplicable === true) {
      if (action.kind === 'ADD') return 'Certificada · alta automática';
      if (action.kind === 'DEACTIVATE') return 'Confirmada · desactivación segura';
      if (action.kind === 'UPDATE_RATE') return 'Precio real certificado · actualización automática';
      if (action.kind === 'RENAME') return 'Identidad confirmada · cambio de nombre';
    }
    if (action && action.reason) return action.reason;
    if (status === 'NEW') return 'Pendiente de certificar';
    if (status === 'DISCONTINUED') return 'Pendiente de confirmar baja';
    if (status === 'RENAMED') return 'Revisar nombre';
    if (status === 'STRUCTURE_CHANGED') return 'Revisar identidad técnica';
    return 'Revisión requerida';
  }

  function renderCatalogChanges() {
    const scan = state.scan;
    const changes = scan && Array.isArray(scan.catalogChanges) ? scan.catalogChanges : [];
    const actions = scan && Array.isArray(scan.catalogActions) ? scan.catalogActions : [];
    const actionByKey = new Map(actions.filter(item => item.externalKey).map(item => [item.externalKey, item]));
    const audit = scan && scan.catalogAudit || {};
    const counts = {
      NEW: Number(audit.newReferences || 0),
      DISCONTINUED: Number(audit.discontinued || 0),
      RENAMED: Number(audit.renamed || 0),
      STRUCTURE_CHANGED: Number(audit.structureChanged || 0),
      RATE: Number(audit.catalogRateChanges || 0),
      CONFLICT: Number(audit.bindingConflicts || 0)
    };
    const safe = safeCatalogActions();
    const structuralTotal = counts.NEW + counts.DISCONTINUED + counts.RENAMED + counts.STRUCTURE_CHANGED + counts.CONFLICT;
    const total = structuralTotal + counts.RATE;
    const quickMode = Boolean(scan && scan.mode === 'quick');
    $('#hePsCatalogSummary').textContent = quickMode
      ? `Actualización rápida de precios · ${counts.RATE} precio(s) Ring cambiado(s). Altas, bajas, renombres y estructura se revisan en mantenimiento profundo.`
      : scan
        ? `${Number(audit.pentagramaProducts || 0)} referencias vistas en Pentagrama · ${counts.NEW} nuevas · ${counts.DISCONTINUED} descontinuadas · ${counts.RATE} precios Ring cambiados · ${safe.length} cambio(s) certificado(s)`
        : 'Aún no se ha comparado el catálogo completo.';
    $('#hePsCatalogNote').hidden = quickMode ? false : !(scan && total);
    if (quickMode) $('#hePsCatalogNote').innerHTML = '<i class="fa-solid fa-screwdriver-wrench"></i><div><strong>Mantenimiento separado</strong><p>La actualización normal revisa precios conocidos. El inventario, rutas, altas, bajas y renombres se auditan aparte para no ralentizar el trabajo diario.</p></div>';
    $('#hePsCatalogUpToDate').hidden = quickMode || !(scan && total === 0);

    const represented = new Set(changes.map(item => item.externalKey).filter(Boolean));
    const rateRows = actions
      .filter(item => item.kind === 'UPDATE_RATE' && !represented.has(item.externalKey))
      .map(item => ({
        status: item.status,
        externalKey: item.externalKey,
        homeeasyId: item.homeeasyId,
        productCode: item.productCode,
        oldName: item.reference,
        newName: item.reference,
        oldRate: item.oldRate,
        proposedRate: item.proposedRate,
        action: item
      }));
    const visible = [...changes.map(item => ({ ...item, action: actionByKey.get(item.externalKey) || null })), ...rateRows].slice(0, 250);
    $('#hePsCatalogRows').innerHTML = visible.length ? visible.map(item => {
      const live = item.live || {};
      const route = Array.isArray(live.path) ? live.path.join(' › ') : '';
      const action = item.action || actionByKey.get(item.externalKey) || null;
      const rateNote = Number.isFinite(item.oldRate) && Number.isFinite(item.proposedRate)
        ? `<small>${money(item.oldRate)} → ${money(item.proposedRate)}</small>`
        : '';
      return `<tr class="he-ps-row ${esc(item.status)}"><td data-label="Estado"><span class="he-ps-pill ${esc(item.status)}">${esc(STATUS_LABELS[item.status] || item.status)}</span><small>${esc(catalogAction(item.status, action))}</small></td><td data-label="Referencia"><strong>${esc(item.newName || item.oldName || (action && action.reference) || '—')}</strong>${item.oldName && item.newName && item.oldName !== item.newName ? `<small>Antes: ${esc(item.oldName)}</small>` : ''}${rateNote}</td><td data-label="Código"><strong>${esc(item.productCode || (action && action.productCode) || '—')}</strong><small>${esc(item.externalKey || '')}</small></td><td data-label="Ruta">${esc(route || (action && action.kind === 'UPDATE_RATE' ? 'Cortina Ring · tarifa certificada' : '—'))}</td><td data-label="HomeEasy"><strong>${esc(item.homeeasyId || (action && action.homeeasyId) || 'Sin vincular')}</strong><small>${esc(catalogAction(item.status, action))}</small></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="he-ps-empty">No se detectaron novedades de catálogo.</td></tr>';
  }

  function renderApplyButton(safeTotal) { const button = $('#hePsApply'); const selected = selectedSafe().length; const catalog = safeCatalogActions().length; const availablePrices = Number.isFinite(safeTotal) ? safeTotal : (state.scan && state.scan.results || []).filter(isSafe).length; const available = availablePrices + catalog; const total = selected + catalog; button.hidden = !available; button.disabled = state.busy || !can('config.write') || !total; button.querySelector('span').textContent = total ? `Aplicar actualización (${total})` : available ? 'Selecciona cambios' : 'Sin cambios aplicables'; }
  function pentagramaStatus(agent) {
    const p = agent && agent.pentagrama || {};
    const bridge = p.sessionBridge || {};
    const value = p.status || 'unknown';
    if (value === 'ready') return [bridge.browserTransportOnline ? 'Pentagrama disponible · Brave conectado' : 'Pentagrama disponible', 'ready'];
    if (value === 'error') return [friendlyError(p.code), 'error'];
    if (bridge.configured && bridge.browserTransportOnline && bridge.sessionReady) return ['Brave conectado · sesión Pentagrama lista', 'ready'];
    if (bridge.configured && bridge.browserTransportOnline) return ['Brave conectado · esperando sesión Pentagrama', 'unknown'];
    if (bridge.configured) return ['Agent listo · esperando extensión de Brave', 'unknown'];
    return ['Pentagrama sin comprobar', 'unknown'];
  }
  function renderAgents(items) { $('#hePsAgents').innerHTML = (items || []).map(agent => { const portal = pentagramaStatus(agent); return `<div class="he-ps-list-row agent"><span class="he-ps-agent-icon ${agent.online ? 'online' : 'offline'}"><i class="fa-solid fa-computer"></i></span><div class="he-ps-list-copy"><strong>${esc(agent.hostname || agent.installationId)}</strong><span><b class="he-ps-presence ${agent.online ? 'online' : 'offline'}">${agent.online ? 'Online' : 'Offline'}</b> · v${esc(agent.version || '—')}</span><small>${esc(portal[0])} · Última conexión ${esc(dateTime(agent.lastSeen))}</small></div></div>`; }).join('') || '<div class="he-ps-empty"><i class="fa-solid fa-computer"></i><strong>No hay agentes registrados</strong><span>Instala o enciende un agente para consultar Pentagrama.</span></div>'; }
  function historyAgent() { const agents = state.status && state.status.agents || []; return agents.length === 1 ? agents[0].hostname || agents[0].installationId : 'No registrado'; }

  function renderHistory(items) {
    const rolledBack = new Set((items || []).filter(item => item.type === 'ROLLBACK').map(item => item.sourceHistoryId));
    $('#hePsHistory').innerHTML = (items || []).slice(0, 8).map(item => {
      const qaOk = Boolean(item.qa && item.qa.ok); const reverted = rolledBack.has(item.id); const automatic = item.automatic || {};
      const isAuto = ['AUTO_SCAN_OK', 'CHANGES_DETECTED', 'AUTO_SCAN_FAILED'].includes(item.type);
      const title = item.type === 'ROLLBACK' ? 'Versión restaurada' : item.type === 'AUTO_SCAN_OK' ? 'Revisión automática sin cambios' : item.type === 'CHANGES_DETECTED' ? `${Number(item.changed || 0)} cambio(s) detectado(s)` : item.type === 'AUTO_SCAN_FAILED' ? 'Falló la revisión automática' : `${Number(item.changed || 0)} cambio(s) aplicado(s)`;
      const tone = item.type === 'ROLLBACK' ? 'rollback' : item.type === 'AUTO_SCAN_FAILED' ? 'error' : isAuto || qaOk ? 'success' : 'error';
      const icon = item.type === 'ROLLBACK' ? 'fa-rotate-left' : item.type === 'AUTO_SCAN_FAILED' ? 'fa-xmark' : item.type === 'CHANGES_DETECTED' ? 'fa-triangle-exclamation' : 'fa-check';
      const status = isAuto ? (item.type === 'AUTO_SCAN_FAILED' ? esc(automatic.errorType || 'ERROR') : `${Number(automatic.checked || 0)} revisadas · solo lectura`) : `QA ${qaOk ? 'PASS' : 'FAIL'}`;
      const agent = automatic.agent && (automatic.agent.hostname || automatic.agent.installationId) || historyAgent();
      return `<div class="he-ps-list-row history"><span class="he-ps-history-icon ${tone}"><i class="fa-solid ${icon}"></i></span><div class="he-ps-list-copy"><strong>${esc(title)}</strong><span>${esc(dateTime(item.at))} · ${status}</span><small>${esc(item.actor && (item.actor.nombre || item.actor.email) || 'Sistema')} · ${esc(agent)}</small><div class="he-ps-row-actions"><button data-history-detail="${esc(item.id)}">Ver detalle</button>${item.type === 'APPLY' && !reverted && can('config.write') ? `<button class="danger" data-rollback="${esc(item.id)}">Restaurar versión</button>` : reverted ? '<span class="he-ps-restored">Restaurada</span>' : ''}</div></div></div>`;
    }).join('') || '<div class="he-ps-empty"><i class="fa-solid fa-clock-rotate-left"></i><strong>Todavía no hay actualizaciones</strong><span>Los futuros cambios y QA aparecerán aquí.</span></div>';
    $('#hePsHistory').querySelectorAll('[data-history-detail]').forEach(button => button.onclick = () => openHistory(button.dataset.historyDetail));
    $('#hePsHistory').querySelectorAll('[data-rollback]').forEach(button => button.onclick = () => rollback(button.dataset.rollback));
  }
  function renderAll() { renderOverview(); renderResults(); renderCatalogChanges(); renderAgents(state.status && state.status.agents || []); renderHistory(state.history); }

  function setProgress(stage, type) {
    const box = $('#hePsProgress'); if (!stage) { box.hidden = true; return; }
    const scanStages = ['QUEUED', 'READING_HOMEEASY', 'READING_PENTAGRAMA', 'COMPARING']; const applyStages = type === 'rollback' ? ['ROLLING_BACK'] : ['PREWRITE_VALIDATION', 'SNAPSHOT', 'WRITING_SHEET', 'QA']; const stages = type === 'scan' ? scanStages : applyStages; const currentIndex = Math.max(0, stages.indexOf(stage));
    box.hidden = false; $('#hePsProgressTitle').textContent = STAGES[stage] || stage; $('#hePsProgressSteps').innerHTML = stages.map((value, index) => `<span class="${index < currentIndex ? 'done' : index === currentIndex ? 'current' : ''}"><i class="fa-solid ${index < currentIndex ? 'fa-check' : 'fa-circle'}"></i>${esc(STAGES[value].replace('…', ''))}</span>`).join('');
  }
  async function poll(id, type) { const maxPolls = type === 'scan' ? 1200 : 600; for (let index = 0; index < maxPolls; index += 1) { const data = await request('/api/pentagrama-sync/operations/' + encodeURIComponent(id)); const operation = data.operation; setProgress(operation.stage, type || operation.type); if (operation.state === 'completed') { setProgress(null); return operation; } if (operation.state === 'failed') { const error = new Error(operation.error && operation.error.code || 'PENTAGRAMA_SYNC_FAILED'); error.code = operation.error && operation.error.code || 'PENTAGRAMA_SYNC_FAILED'; throw error; } await new Promise(resolve => setTimeout(resolve, 1000)); } const error = new Error('AGENT_TIMEOUT'); error.code = 'AGENT_TIMEOUT'; throw error; }
  function selectSafeDefaults() { state.selected = new Set((state.scan && state.scan.results || []).filter(isSafe).map(item => item.id)); }
  async function refresh(options = {}) { try { const [status, history] = await Promise.all([request('/api/pentagrama-sync/status'), request('/api/pentagrama-sync/history')]); state.status = status; state.scan = status.latestScan; state.history = history.items || []; state.error = null; if (options.resetSelection) selectSafeDefaults(); renderAll(); } catch (error) { state.error = error; renderOverview(); } }

  async function scan() {
    if (state.busy) return; state.busy = true; state.error = null; renderAll();
    try { const started = await request('/api/pentagrama-sync/quick-scan', 'POST', {}); await poll(started.operation.id, 'scan'); await refresh({ resetSelection: true }); const counts = state.scan && state.scan.counts || {}; const audit = state.scan && state.scan.catalogAudit || {}; const safe = selectedSafe(); const safeCatalog = safeCatalogActions(); const review = Number(counts.REVIEW_REQUIRED || 0); const catalogPending = Number(audit.newReferences || 0) + Number(audit.discontinued || 0) + Number(audit.renamed || 0) + Number(audit.structureChanged || 0) + Number(audit.bindingConflicts || 0); if (safe.length || safeCatalog.length) { await apply(true); return; } if (!Number(counts.ERROR || 0) && catalogPending) await Swal.fire({ icon: 'info', title: 'Pentagrama revisado', text: `Los precios certificados están al día. Se detectaron ${catalogPending} novedad(es) de catálogo que permanecerán bloqueadas hasta ser certificadas.`, confirmButtonColor: '#a6455a' }); else if (!Number(counts.ERROR || 0)) await Swal.fire({ icon: 'success', title: 'Todo lo certificado está actualizado', text: `${Number(audit.certified != null ? audit.certified : audit.mapped || 0)} certificadas · ${review} pendientes de certificar · catálogo sin novedades`, confirmButtonColor: '#a6455a' }); else await Swal.fire({ icon: 'error', title: 'Requiere atención', text: 'Una o más consultas operativas fallaron. No se modificó ninguna tarifa.', confirmButtonColor: '#a6455a' }); }
    catch (error) { state.error = error; setProgress(null); await Swal.fire({ icon: 'error', title: 'No se pudo actualizar', text: friendlyError(error), confirmButtonColor: '#a6455a' }); }
    finally { state.busy = false; renderAll(); }
  }

  async function maintenance() {
    if (state.busy) return;
    const confirm = await Swal.fire({
      icon: 'info',
      title: 'Mantenimiento profundo Pentagrama',
      html: 'Este proceso revisa catálogo, rutas, altas, bajas, renombres y estructura técnica.<br><b>Puede tardar varios minutos y no aplica cambios automáticamente.</b>',
      showCancelButton: true,
      confirmButtonText: 'Iniciar mantenimiento',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#a6455a'
    });
    if (!confirm.isConfirmed) return;
    state.busy = true; state.error = null; renderAll();
    try {
      const started = await request('/api/pentagrama-sync/scan', 'POST', {});
      await poll(started.operation.id, 'scan');
      await refresh({ resetSelection: true });
      const audit = state.scan && state.scan.catalogAudit || {};
      const pending = Number(audit.newReferences || 0) + Number(audit.discontinued || 0) + Number(audit.renamed || 0) + Number(audit.structureChanged || 0) + Number(audit.bindingConflicts || 0);
      await Swal.fire({
        icon: pending ? 'info' : 'success',
        title: 'Mantenimiento terminado',
        text: pending ? `Se detectaron ${pending} novedad(es) técnicas para revisar. No se aplicó ninguna automáticamente.` : 'Catálogo y estructura revisados. No se detectaron novedades técnicas.',
        confirmButtonColor: '#a6455a'
      });
    } catch (error) {
      state.error = error; setProgress(null);
      await Swal.fire({ icon: 'error', title: 'El mantenimiento no pudo completarse', text: friendlyError(error), confirmButtonColor: '#a6455a' });
    } finally {
      state.busy = false; renderAll();
    }
  }
  async function apply(automatic) {
    const changes = selectedSafe(); const catalogChanges = safeCatalogActions(); const totalChanges = changes.length + catalogChanges.length; if (!totalChanges) return;
    if (!automatic) { const result = await Swal.fire({ icon: 'warning', title: `Aplicar ${totalChanges} cambio(s)`, html: 'Se creará respaldo transaccional, se actualizará la Sheet, se refrescará la caché y se ejecutará QA contra Pentagrama.<br><b>Las referencias pendientes de certificación nunca se aplicarán automáticamente.</b>', showCancelButton: true, confirmButtonText: 'Crear respaldo y aplicar', cancelButtonText: 'Cancelar', confirmButtonColor: '#a6455a' }); if (!result.isConfirmed) return; }
    state.busy = true; state.error = null; renderAll();
    try { const started = await request('/api/pentagrama-sync/apply', 'POST', { scanId: state.scan.id, changeIds: changes.map(item => item.id), catalogActionIds: catalogChanges.map(item => item.id) }); const operation = await poll(started.operation.id, 'apply'); await refresh({ resetSelection: true }); const qa = operation.result && operation.result.qa; if (!qa || qa.ok !== true) throw Object.assign(new Error('QA_FAILED'), { code: 'QA_FAILED' }); const review = Number(state.scan && state.scan.counts && state.scan.counts.REVIEW_REQUIRED || 0); const audit = state.scan && state.scan.catalogAudit || {}; const catalogPending = Number(audit.newReferences || 0) + Number(audit.discontinued || 0) + Number(audit.renamed || 0) + Number(audit.structureChanged || 0) + Number(audit.bindingConflicts || 0); await Swal.fire({ icon: 'success', title: 'HomeEasy actualizado correctamente', text: `${Number(operation.result && operation.result.priceChanges || 0)} tarifa(s) estándar + ${Number(operation.result && operation.result.catalogChanges || 0)} cambio(s) de catálogo + ${Number(operation.result && operation.result.localModelChanges || 0)} modelo(s) Enrollables aplicados${review ? ` · ${review} requiere(n) revisión` : ''}${catalogPending ? ` · ${catalogPending} novedad(es) pendientes` : ''}. QA contra Pentagrama: PASS.`, confirmButtonColor: '#a6455a' }); }
    catch (error) { state.error = error; setProgress(null); const rolledBack = /QA/i.test(String(error.code || error.message || '')); await Swal.fire({ icon: 'error', title: 'La actualización no fue aplicada', text: rolledBack ? 'El QA no pasó. HomeEasy fue restaurado al estado anterior.' : friendlyError(error), confirmButtonColor: '#a6455a' }); }
    finally { state.busy = false; renderAll(); }
  }

  async function scanForHistory(entry) { if (!entry || !entry.scanId) return null; if (state.scans.has(entry.scanId)) return state.scans.get(entry.scanId); try { const data = await request('/api/pentagrama-sync/scans/' + encodeURIComponent(entry.scanId)); state.scans.set(entry.scanId, data.scan); return data.scan; } catch (_) { return null; } }
  async function openHistory(id) { const entry = state.history.find(item => item.id === id); if (!entry) return; const scanData = await scanForHistory(entry); const checked = scanData ? scanData.results.filter(item => item.status !== 'UNMAPPED').length : 'No registrado'; const qaOk = Boolean(entry.qa && entry.qa.ok); const automatic = entry.automatic; const agent = automatic && automatic.agent && (automatic.agent.hostname || automatic.agent.installationId) || historyAgent(); const finalState = automatic ? (entry.type === 'AUTO_SCAN_OK' ? 'Sin cambios' : entry.type === 'CHANGES_DETECTED' ? 'Cambios pendientes' : automatic.errorType || 'Falló') : entry.type === 'ROLLBACK' ? 'Restaurado' : qaOk ? 'Aplicado' : 'Falló'; await Swal.fire({ title: automatic ? 'Detalle de revisión automática' : entry.type === 'ROLLBACK' ? 'Versión restaurada' : 'Detalle de actualización', html: `<div class="he-ps-modal-detail"><div><span>Fecha</span><strong>${esc(dateTime(entry.at))}</strong></div><div><span>Agente usado</span><strong>${esc(agent)}</strong></div><div><span>Referencias revisadas</span><strong>${esc(automatic ? automatic.checked || 0 : checked)}</strong></div><div><span>${automatic ? 'Cambios detectados' : 'Cambios aplicados'}</span><strong>${esc(entry.changed || 0)}</strong></div><div><span>${automatic ? 'Duración' : 'QA'}</span><strong class="${automatic && entry.type === 'AUTO_SCAN_FAILED' ? 'fail' : 'ok'}">${automatic ? `${Math.round(Number(automatic.durationMs || 0) / 1000)} s` : qaOk ? 'PASS' : 'FAIL'}</strong></div><div><span>Estado final</span><strong>${esc(finalState)}</strong></div></div>`, customClass: { container: 'he-ps-swal-container' }, confirmButtonColor: '#a6455a' }); }
  async function rollback(id) {
    const entry = state.history.find(item => item.id === id); const result = await Swal.fire({ icon: 'warning', title: 'Restaurar versión', html: `Se restaurarán exactamente los valores del respaldo${entry ? ` del ${esc(dateTime(entry.at))}` : ''} y se ejecutará QA.<br><b>Esta acción requiere confirmación.</b>`, showCancelButton: true, confirmButtonText: 'Sí, restaurar versión', cancelButtonText: 'Cancelar', confirmButtonColor: '#a6455a' }); if (!result.isConfirmed) return;
    state.busy = true; renderAll();
    try { const started = await request('/api/pentagrama-sync/rollback', 'POST', { historyId: id, confirmed: true }); const operation = await poll(started.operation.id, 'rollback'); await refresh({ resetSelection: true }); const qaOk = Boolean(operation.result && operation.result.qa && operation.result.qa.ok); await Swal.fire({ icon: qaOk ? 'success' : 'error', title: qaOk ? 'Versión restaurada' : 'La restauración falló', text: qaOk ? 'El respaldo fue restaurado y el QA terminó correctamente.' : 'HomeEasy no pudo validar la versión restaurada.', confirmButtonColor: '#a6455a' }); }
    catch (error) { state.error = error; setProgress(null); await Swal.fire({ icon: 'error', title: 'No se pudo restaurar', text: friendlyError(error), confirmButtonColor: '#a6455a' }); }
    finally { state.busy = false; renderAll(); }
  }
  function mount() { if (!can('config.read') || $('#panel-pentagrama')) return; document.querySelector('.content').appendChild(panel()); addNav(); $('#hePsScan').onclick = scan; $('#hePsMaintenance').onclick = maintenance; $('#hePsApply').onclick = apply; $('#hePsMore').onclick = () => { state.limit += 50; renderResults(); }; if (new URLSearchParams(location.search).get('section') === 'pentagrama') activate(); refresh({ resetSelection: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 600)); else setTimeout(mount, 600);
})(typeof window !== 'undefined' ? window : globalThis);
