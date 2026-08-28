(() => {
  'use strict';

  const API_BASE = String(window.HOMMY_API_BASE || 'https://homeeasy-hommy-staging.onrender.com').replace(/\/$/, '');
  const HEALTH_INTERVAL_MS = 60_000;
  const HEALTH_REQUEST_TIMEOUT_MS = 70_000;
  const REQUEST_TIMEOUT_MS = 110_000;
  const MAX_STORED_MESSAGES = 50;
  const MAX_VOICE_CONTEXT_MESSAGES = 12;
  const MAX_VOICE_TRANSCRIPT_CHARS = 2_400;
  const VOICE_SYNC_BATCH_SIZE = 12;
  const VOICE_SYNC_BATCH_CHARS = 12_000;
  const VOICE_CLOSE_MIN_GRACE_MS = 1_200;
  const VOICE_CLOSE_MAX_GRACE_MS = 6_000;
  const VOICE_CONNECT_TIMEOUT_MS = 50_000;
  const VOICE_DISCONNECT_GRACE_MS = 8_000;

  const el = {
    app: document.getElementById('hommy-app'),
    conversation: document.getElementById('conversation'),
    welcome: document.getElementById('welcome'),
    welcomeTitle: document.getElementById('welcome-title'),
    starterGrid: document.getElementById('starter-grid'),
    input: document.getElementById('message-input'),
    send: document.getElementById('send-button'),
    back: document.getElementById('back-button'),
    newChat: document.getElementById('new-chat-button'),
    voice: document.getElementById('voice-button'),
    status: document.getElementById('service-status'),
    composerNote: document.getElementById('composer-note'),
    voiceMode: document.getElementById('voice-mode'),
    voiceDismiss: document.getElementById('voice-dismiss'),
    endCall: document.getElementById('end-call-button'),
    mute: document.getElementById('mute-button'),
    muteLabel: document.getElementById('mute-label'),
    voiceOrb: document.getElementById('voice-orb'),
    voiceTitle: document.getElementById('voice-title'),
    voiceHelp: document.getElementById('voice-help'),
    toast: document.getElementById('toast'),
  };

  const state = {
    profile: null,
    permissions: [],
    sending: false,
    messages: [],
    conversationToken: '',
    storageKey: '',
    healthTimer: null,
    healthCheckInFlight: false,
    toastTimer: null,
    voice: null,
    voicePreviousFocus: null,
    bodyOverflow: '',
    voiceSyncQueue: [],
    voiceSyncPromise: null,
    voiceSyncRetryTimer: null,
    voiceSyncRetryMs: 2_000,
    conversationRevision: 0,
  };

  let chartSequence = 0;

  function safeText(value) { return String(value == null ? '' : value); }
  function hasPermission(permission) { return state.permissions.includes('*') || state.permissions.includes(permission); }
  function hasAny(...permissions) { return permissions.some(hasPermission); }

  function normalizedVoiceTurn(value) {
    if (!value || typeof value !== 'object') return null;
    const id = safeText(value.id).trim();
    const role = safeText(value.role).trim();
    const text = safeText(value.text).trim().slice(0, MAX_VOICE_TRANSCRIPT_CHARS);
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id) || !['user', 'assistant'].includes(role) || !text) return null;
    return { id, role, text };
  }

  function voiceTurnKey(turn) { return `${turn.role}:${turn.id}`; }

  function formatCOP(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
    }
    return safeText(value).trim();
  }

  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = safeText(value).trim().replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null && safeText(value).trim() !== '');
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(safeText(value));
      return url.protocol === 'https:' ? url : null;
    } catch (_) {
      return null;
    }
  }

  function usableEmail(value) {
    const email = safeText(value).trim();
    if (!email) return '';
    const normalized = email.toLowerCase().replace(/\s+/g, '');
    if (normalized === 'sincorreo@sincorreo.com' || /^(?:sin|no)[._-]?correo@/.test(normalized)) return '';
    return email;
  }

  function phoneDigits(value) { return safeText(value).replace(/\D/g, ''); }

  function colombianMobile(value) {
    const digits = phoneDigits(value);
    if (/^3\d{9}$/.test(digits)) return `57${digits}`;
    if (/^573\d{9}$/.test(digits)) return digits;
    return '';
  }

  function telephoneHref(value) {
    const mobile = colombianMobile(value);
    if (mobile) return `tel:+${mobile}`;
    const digits = phoneDigits(value);
    return /^\d{7,15}$/.test(digits) ? `tel:${digits}` : '';
  }

  function customerShareText(card) {
    const name = safeText(firstValue(card.nombre, card.name, card.title, 'Cliente')).trim();
    const identification = safeText(firstValue(card.cedula, card.identification, card.documento_identidad)).trim();
    const phone = safeText(firstValue(card.telefono, card.phone)).trim();
    const email = usableEmail(firstValue(card.email, card.correo));
    const address = safeText(firstValue(card.direccion, card.address)).trim();
    return [
      name,
      identification ? `Cédula: ${identification}` : '',
      phone ? `Teléfono: ${phone}` : '',
      email ? `Correo: ${email}` : '',
      address ? `Dirección: ${address}` : '',
    ].filter(Boolean).join('\n');
  }

  async function copyText(value) {
    const text = safeText(value);
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return; } catch (_) {}
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
    if (!copied) throw new Error('No fue posible copiar la ficha.');
  }

  function setActionFeedback(control, label) {
    const previous = control.textContent;
    control.textContent = label;
    window.setTimeout(() => { if (control.isConnected) control.textContent = previous; }, 1800);
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    el.toast.textContent = safeText(message);
    el.toast.hidden = false;
    state.toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3600);
  }

  function setServiceStatus(text, tone = '') {
    el.status.querySelector('span').textContent = text;
    if (tone) el.status.dataset.tone = tone; else delete el.status.dataset.tone;
  }

  function setVoiceState(kind, title, help) {
    el.voiceOrb.dataset.state = kind;
    el.voiceTitle.textContent = title;
    el.voiceHelp.textContent = help;
  }

  function goHome() {
    if (window.HomeEasyCore && typeof window.HomeEasyCore.goHome === 'function') window.HomeEasyCore.goHome();
    else window.location.assign('index.html');
  }

  function sessionToken() {
    return window.HomeEasyAuth && typeof window.HomeEasyAuth.getAppSessionToken === 'function'
      ? window.HomeEasyAuth.getAppSessionToken() : '';
  }

  function homeEasyMetaHeader() {
    try {
      const meta = window.HomeEasyCore && typeof window.HomeEasyCore.buildMeta === 'function'
        ? window.HomeEasyCore.buildMeta() : {};
      const bytes = new TextEncoder().encode(JSON.stringify(meta));
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    } catch (_) {
      return '';
    }
  }

  function authenticatedHeaders(extra = {}) {
    const token = sessionToken();
    if (!token) throw new Error('Tu sesión de HomeEasy no está disponible.');
    const meta = homeEasyMetaHeader();
    return {
      ...extra,
      'X-HomeEasy-Session': token,
      ...(meta ? { 'X-HomeEasy-Meta': meta } : {}),
    };
  }

  function persist() {
    if (!state.storageKey) return;
    try {
      sessionStorage.setItem(state.storageKey, JSON.stringify({
        conversationToken: state.conversationToken,
        messages: state.messages.slice(-MAX_STORED_MESSAGES),
        voiceSyncQueue: state.voiceSyncQueue,
      }));
    } catch (_) {}
  }

  function restore() {
    if (!state.storageKey) return;
    try {
      const raw = sessionStorage.getItem(state.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.conversationToken = typeof parsed.conversationToken === 'string' ? parsed.conversationToken : '';
      state.messages = Array.isArray(parsed.messages)
        ? parsed.messages.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.text === 'string').slice(-MAX_STORED_MESSAGES)
        : [];
      state.voiceSyncQueue = Array.isArray(parsed.voiceSyncQueue)
        ? parsed.voiceSyncQueue.map(normalizedVoiceTurn).filter(Boolean)
        : [];
    } catch (_) {
      state.messages = [];
      state.conversationToken = '';
      state.voiceSyncQueue = [];
    }
  }

  function starterOptions() {
    const rows = [];
    if (hasPermission('cotizaciones.write')) rows.push(['Cotizar una persiana', 'Dime producto, tela y medidas.', 'Quiero cotizar una persiana']);
    if (hasPermission('ventas.read')) rows.push(['Ventas recientes', 'Consulta las últimas ventas registradas.', '¿Cuáles son las últimas 5 ventas?']);
    else if (hasPermission('reportes.read')) rows.push(['Ventas de este mes', 'Consulta el total y las métricas del mes actual.', '¿Cuánto llevo vendido este mes?']);
    if (hasAny('caja.read', 'ventas.read')) rows.push(['Cartera pendiente', 'Revisa quién tiene saldos por pagar.', 'Muéstrame la cartera pendiente']);
    if (hasPermission('agenda.read')) rows.push(['Agenda de hoy', 'Consulta las visitas y tareas de hoy.', '¿Qué tengo en la agenda de hoy?']);
    if (!rows.length) rows.push(['Consultar catálogo', 'Busca referencias y opciones disponibles.', 'Ayúdame a consultar el catálogo']);
    return rows.slice(0, 4);
  }

  function renderStarters() {
    el.starterGrid.replaceChildren();
    for (const [title, subtitle, prompt] of starterOptions()) {
      const button = document.createElement('button');
      button.className = 'starter'; button.type = 'button';
      const strong = document.createElement('strong'); strong.textContent = title;
      const span = document.createElement('span'); span.textContent = subtitle;
      button.append(strong, span);
      button.addEventListener('click', () => sendMessage(prompt));
      el.starterGrid.appendChild(button);
    }
  }

  function cardKicker(type) {
    return ({ customer: 'Cliente', order: 'Orden de pedido', balance: 'Saldo', metric: 'Resumen', quote: 'Cotización', kpi_group: 'Indicadores', chart: 'Análisis', document: 'Documento' })[type] || 'HomeEasy';
  }

  function createCard(type, label) {
    const card = document.createElement('article');
    card.className = 'hommy-card';
    for (const token of safeText(type).split(/\s+/).filter(Boolean)) card.classList.add(token, `${token}-card`);
    if (label) card.setAttribute('aria-label', safeText(label));
    return card;
  }

  function statusTone(value) {
    const status = safeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (/(PAGAD|COMPLET|CERRAD)/.test(status)) return 'paid';
    if (/(ANULAD|CANCELAD)/.test(status)) return 'cancelled';
    return 'pending';
  }

  function appendStatus(card, value) {
    const text = safeText(value).trim();
    if (!text) return;
    const status = document.createElement('span');
    status.className = 'card-status';
    status.dataset.tone = statusTone(text);
    status.textContent = text;
    card.appendChild(status);
  }

  function financialItem(label, value) {
    const item = document.createElement('div'); item.className = 'financial-item';
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = formatCOP(value);
    item.append(term, detail);
    return item;
  }

  function documentPayload(card) {
    const nested = card.documento || card.document;
    if (nested && typeof nested === 'object') return nested;
    if (card.type === 'document') return { url: card.url, label: card.title };
    return null;
  }

  function claimDocument(context, entityId, url) {
    const key = `${safeText(entityId)}|${url.href}`;
    if (context.documentKeys.has(key) || context.documentUrls.has(url.href)) return false;
    context.documentKeys.add(key);
    context.documentUrls.add(url.href);
    return true;
  }

  function renderDocumentAction(payload, entityId, fallbackLabel, context) {
    if (!payload || typeof payload !== 'object') return null;
    const url = safeHttpsUrl(payload.url);
    if (!url || !claimDocument(context, entityId, url)) return null;
    const label = safeText(firstValue(payload.label, payload.title, fallbackLabel, 'Ver documento')).trim();
    const link = document.createElement('a');
    link.className = 'entity-document-link';
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    link.setAttribute('aria-label', `${label} en una pestaña nueva`);
    link.textContent = label;
    return link;
  }

  function renderEntityHeader(card, type, title, customer, amount) {
    const head = document.createElement('div'); head.className = 'entity-head';
    const heading = document.createElement('div'); heading.className = 'entity-heading';
    const kicker = document.createElement('div'); kicker.className = 'card-kicker'; kicker.textContent = cardKicker(type);
    const titleNode = document.createElement('div'); titleNode.className = 'card-title'; titleNode.textContent = safeText(title);
    heading.append(kicker, titleNode);
    if (customer) { const customerNode = document.createElement('div'); customerNode.className = 'entity-customer'; customerNode.textContent = safeText(customer); heading.appendChild(customerNode); }
    head.appendChild(heading);
    if (amount !== undefined && amount !== null && safeText(amount).trim()) {
      const total = document.createElement('div'); total.className = 'entity-total';
      const label = document.createElement('span'); label.textContent = 'Total';
      const value = document.createElement('strong'); value.className = 'card-amount'; value.textContent = formatCOP(amount);
      total.append(label, value); head.appendChild(total);
    }
    return head;
  }

  function appendDescription(card, values) {
    const text = values.map(safeText).map(value => value.trim()).filter(Boolean).join(' · ');
    if (!text) return;
    const description = document.createElement('div'); description.className = 'entity-description'; description.textContent = text;
    card.appendChild(description);
  }

  function renderOrderCard(card, context) {
    const number = safeText(firstValue(card.numero, card.order_number, card.orderNumber)).trim();
    const legacyTitle = safeText(card.title).trim();
    const title = number ? `OP ${number}` : (legacyTitle || 'Orden de pedido');
    const customer = safeText(firstValue(card.cliente, card.customer, card.nombre)).trim();
    const total = firstValue(card.total_cop, card.totalCop, card.amount);
    const paid = firstValue(card.abonado_total_cop, card.paid_cop, card.abonado_cop, card.paid);
    const balance = firstValue(card.saldo_cop, card.balance_cop, card.balance);
    const status = firstValue(card.estado_financiero, card.financial_status, card.status);
    const entityId = firstValue(card.entity_id, card.entityId, number ? `order:${number}` : legacyTitle);
    const wrap = createCard('order entity', title);
    wrap.appendChild(renderEntityHeader(card, 'order', title, customer, total));
    appendDescription(wrap, [firstValue(card.fecha, card.date), firstValue(card.descripcion, card.description, card.summary, card.subtitle)]);
    if (paid !== undefined || balance !== undefined) {
      const facts = document.createElement('dl'); facts.className = 'entity-financials';
      if (paid !== undefined) facts.appendChild(financialItem('Abonado', paid));
      if (balance !== undefined) facts.appendChild(financialItem('Saldo', balance));
      wrap.appendChild(facts);
    } else if (card.meta) {
      const meta = document.createElement('div'); meta.className = 'card-meta'; meta.textContent = safeText(card.meta); wrap.appendChild(meta);
    }
    appendStatus(wrap, status);
    const documentLink = renderDocumentAction(documentPayload(card), entityId, 'Ver OP', context);
    if (documentLink) { const actions = document.createElement('div'); actions.className = 'entity-actions'; actions.appendChild(documentLink); wrap.appendChild(actions); }
    return wrap;
  }

  function renderQuoteCard(card, context) {
    const number = safeText(firstValue(card.numero, card.quote_number, card.quoteNumber)).trim();
    const legacyTitle = safeText(card.title).trim();
    const title = number ? `Cotización ${number}` : (legacyTitle || 'Cotización');
    const customer = safeText(firstValue(card.cliente, card.customer, card.nombre)).trim();
    const amount = firstValue(card.valor_cop, card.total_cop, card.amount);
    const status = firstValue(card.estado, card.status);
    const entityId = firstValue(card.entity_id, card.entityId, number ? `quote:${number}` : legacyTitle);
    const wrap = createCard('quote entity', title);
    wrap.appendChild(renderEntityHeader(card, 'quote', title, customer, amount));
    appendDescription(wrap, [firstValue(card.fecha, card.date), firstValue(card.resumen, card.descripcion, card.summary, card.subtitle)]);
    if (card.meta) { const meta = document.createElement('div'); meta.className = 'card-meta'; meta.textContent = safeText(card.meta); wrap.appendChild(meta); }
    appendStatus(wrap, status);
    const documentLink = renderDocumentAction(documentPayload(card), entityId, 'Ver cotización', context);
    if (documentLink) { const actions = document.createElement('div'); actions.className = 'entity-actions'; actions.appendChild(documentLink); wrap.appendChild(actions); }
    return wrap;
  }

  function contactDetail(label, value) {
    const item = document.createElement('div'); item.className = 'contact-detail';
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = safeText(value || 'Sin registro');
    item.append(term, detail); return item;
  }

  function contactButton(label, ariaLabel, handler) {
    const button = document.createElement('button'); button.className = 'contact-action'; button.type = 'button'; button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', handler);
    return button;
  }

  function contactLink(label, ariaLabel, href, external = false) {
    const link = document.createElement('a'); link.className = 'contact-action'; link.textContent = label; link.href = href;
    link.setAttribute('aria-label', ariaLabel);
    if (external) { link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; }
    return link;
  }

  function renderCustomerCard(card) {
    const contact = card.contact && typeof card.contact === 'object' ? card.contact : {};
    const name = safeText(firstValue(card.nombre, contact.nombre, card.name, card.title, 'Cliente')).trim();
    const identification = safeText(firstValue(card.cedula, contact.cedula, card.identification, card.documento_identidad)).trim();
    const rawPhone = firstValue(card.telefono, contact.telefono, card.phone, phoneDigits(card.subtitle).length >= 7 ? card.subtitle : '');
    const phone = safeText(rawPhone).trim();
    const email = usableEmail(firstValue(card.email, contact.email, card.correo));
    const address = safeText(firstValue(card.direccion, contact.direccion, card.address, card.meta)).trim();
    const shareText = customerShareText({ ...card, nombre: name, cedula: identification, telefono: phone, email, direccion: address });
    const allowed = new Set(Array.isArray(card.actions) ? card.actions.map(action => safeText(action).toLowerCase()) : ['copy', 'share', 'whatsapp', 'call']);
    const wrap = createCard('customer entity', name);
    const kicker = document.createElement('div'); kicker.className = 'card-kicker'; kicker.textContent = 'Cliente';
    const title = document.createElement('div'); title.className = 'card-title'; title.textContent = name;
    wrap.append(kicker, title);
    const details = document.createElement('dl'); details.className = 'contact-details';
    details.append(
      contactDetail('Cédula', identification),
      contactDetail('Teléfono', phone),
      contactDetail('Correo', email || 'Sin correo registrado'),
      contactDetail('Dirección', address),
    );
    wrap.appendChild(details);
    const actions = document.createElement('div'); actions.className = 'contact-actions'; actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', `Acciones para ${name}`);
    if (allowed.has('copy')) {
      const copy = contactButton('Copiar', `Copiar datos de ${name}`, async () => {
        try { await copyText(shareText); setActionFeedback(copy, 'Copiado'); showToast('Ficha copiada.'); }
        catch (error) { showToast(error.message); }
      });
      actions.appendChild(copy);
    }
    if (allowed.has('share')) {
      const share = contactButton('Compartir', `Compartir datos de ${name}`, async () => {
        try {
          if (navigator.share) await navigator.share({ title: name, text: shareText });
          else { await copyText(shareText); setActionFeedback(share, 'Copiado'); showToast('Ficha copiada para compartir.'); }
        } catch (error) { if (error?.name !== 'AbortError') showToast('No fue posible compartir la ficha.'); }
      });
      actions.appendChild(share);
    }
    const whatsapp = colombianMobile(phone);
    if (allowed.has('whatsapp') && whatsapp) actions.appendChild(contactLink('WhatsApp', `Abrir WhatsApp de ${name}`, `https://wa.me/${whatsapp}`, true));
    const telephone = telephoneHref(phone);
    if (allowed.has('call') && telephone) actions.appendChild(contactLink('Llamar', `Llamar a ${name}`, telephone));
    if (actions.childElementCount) wrap.appendChild(actions);
    return wrap;
  }

  function formatKpiValue(item) {
    if (firstValue(item.display_value, item.displayValue) !== undefined) return safeText(firstValue(item.display_value, item.displayValue));
    const number = finiteNumber(item.value);
    if (number === null) return safeText(item.value);
    const kind = safeText(item.kind).toLowerCase();
    if (kind === 'currency' || kind === 'cop') return formatCOP(number);
    if (kind === 'percent' || kind === 'percentage') return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(number)}%`;
    return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(number);
  }

  function renderKpiGroup(card) {
    const items = Array.isArray(card.items) ? card.items.filter(item => item && typeof item === 'object').slice(0, 4) : [];
    if (!items.length) return null;
    const wrap = createCard('kpi-group', safeText(card.title || 'Indicadores'));
    const heading = document.createElement('h3'); heading.className = 'kpi-heading'; heading.textContent = safeText(card.title || 'Indicadores');
    const grid = document.createElement('div'); grid.className = 'kpi-grid';
    for (const item of items) {
      const block = document.createElement('div'); block.className = 'kpi-item';
      const label = document.createElement('span'); label.className = 'kpi-label'; label.textContent = safeText(item.label || item.key || 'Indicador');
      const value = document.createElement('strong'); value.className = 'kpi-value'; value.textContent = formatKpiValue(item);
      const tone = safeText(item.tone).toLowerCase(); if (['up', 'down'].includes(tone)) value.dataset.tone = tone;
      block.append(label, value); grid.appendChild(block);
    }
    wrap.append(heading, grid); return wrap;
  }

  function svgElement(name, attributes = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, safeText(value));
    return node;
  }

  function chartSeries(card) {
    return (Array.isArray(card.series) ? card.series : [])
      .filter(item => item && typeof item === 'object' && finiteNumber(item.value) !== null)
      .slice(0, 8);
  }

  function renderBarFigure(series, title, summary, titleId, descriptionId) {
    const height = 18 + (series.length * 42);
    const svg = svgElement('svg', { viewBox: `0 0 360 ${height}`, role: 'img', 'aria-labelledby': `${titleId} ${descriptionId}` });
    svg.classList.add('chart-svg');
    const titleNode = svgElement('title', { id: titleId }); titleNode.textContent = title;
    const description = svgElement('desc', { id: descriptionId }); description.textContent = summary || series.map(item => `${item.label}: ${formatKpiValue(item)}`).join('. ');
    svg.append(titleNode, description);
    const max = Math.max(...series.map(item => Math.max(0, finiteNumber(item.value))), 1);
    series.forEach((item, index) => {
      const value = Math.max(0, finiteNumber(item.value));
      const y = 4 + (index * 42);
      const label = svgElement('text', { x: 0, y: y + 11, class: 'chart-label' }); label.textContent = safeText(item.label).slice(0, 28);
      const display = svgElement('text', { x: 360, y: y + 11, 'text-anchor': 'end', class: 'chart-value' }); display.textContent = formatKpiValue(item);
      const track = svgElement('rect', { x: 0, y: y + 20, width: 360, height: 8, rx: 4, class: 'chart-track' });
      const bar = svgElement('rect', { x: 0, y: y + 20, width: Math.max(value > 0 ? 3 : 0, (value / max) * 360), height: 8, rx: 4, class: `chart-bar${index ? ' is-secondary' : ''}` });
      svg.append(label, display, track, bar);
    });
    return svg;
  }

  function renderDonutFigure(series, title, summary, titleId, descriptionId) {
    const figure = document.createElement('div'); figure.className = 'chart-donut-layout';
    const svg = svgElement('svg', { viewBox: '0 0 180 180', role: 'img', 'aria-labelledby': `${titleId} ${descriptionId}` });
    svg.classList.add('chart-svg', 'chart-donut');
    const titleNode = svgElement('title', { id: titleId }); titleNode.textContent = title;
    const description = svgElement('desc', { id: descriptionId }); description.textContent = summary || series.map(item => `${item.label}: ${formatKpiValue(item)}`).join('. ');
    const track = svgElement('circle', { cx: 90, cy: 90, r: 58, class: 'chart-donut-track' });
    svg.append(titleNode, description, track);
    const total = Math.max(series.reduce((sum, item) => sum + Math.max(0, finiteNumber(item.value)), 0), 1);
    const circumference = 2 * Math.PI * 58;
    const colors = ['#a6455a', '#b9a7ad', '#c2a468', '#6e6e73'];
    let offset = 0;
    const legend = document.createElement('ul'); legend.className = 'chart-legend';
    series.forEach((item, index) => {
      const portion = Math.max(0, finiteNumber(item.value)) / total;
      const segment = svgElement('circle', { cx: 90, cy: 90, r: 58, class: 'chart-donut-segment', transform: 'rotate(-90 90 90)', 'stroke-dasharray': `${portion * circumference} ${circumference}`, 'stroke-dashoffset': -offset });
      segment.style.stroke = colors[index % colors.length]; svg.appendChild(segment); offset += portion * circumference;
      const row = document.createElement('li');
      const swatch = document.createElement('i'); swatch.style.background = colors[index % colors.length]; swatch.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = safeText(item.label);
      const value = document.createElement('strong'); value.textContent = formatKpiValue(item);
      row.append(swatch, label, value); legend.appendChild(row);
    });
    figure.append(svg, legend); return figure;
  }

  function renderChartCard(card) {
    const series = chartSeries(card); if (!series.length) return null;
    const title = safeText(card.title || 'Análisis');
    const summary = safeText(firstValue(card.accessible_summary, card.accessibleSummary, card.summary)).trim();
    const id = ++chartSequence; const titleId = `hommy-chart-title-${id}`; const descriptionId = `hommy-chart-description-${id}`;
    const wrap = createCard('chart', title);
    const heading = document.createElement('h3'); heading.className = 'chart-heading'; heading.textContent = title; wrap.appendChild(heading);
    const chartType = safeText(firstValue(card.chart_type, card.chartType, 'bar')).toLowerCase();
    wrap.appendChild(['donut', 'pie'].includes(chartType)
      ? renderDonutFigure(series, title, summary, titleId, descriptionId)
      : renderBarFigure(series, title, summary, titleId, descriptionId));
    if (summary) { const paragraph = document.createElement('p'); paragraph.className = 'chart-summary'; paragraph.textContent = summary; wrap.appendChild(paragraph); }
    return wrap;
  }

  function renderDocumentCard(card, context) {
    const link = renderDocumentAction(documentPayload(card), firstValue(card.entity_id, card.entityId, card.title), 'Ver documento', context);
    if (!link) return null;
    const wrap = createCard('document', safeText(card.title || 'Documento')); wrap.appendChild(link); return wrap;
  }

  function renderGenericCard(card) {
    const wrap = createCard('generic', safeText(card.title || 'HomeEasy'));
    const top = document.createElement('div'); top.className = 'card-topline';
    const copy = document.createElement('div'); copy.className = 'card-copy';
    const kicker = document.createElement('div'); kicker.className = 'card-kicker'; kicker.textContent = cardKicker(card.type);
    const title = document.createElement('div'); title.className = 'card-title'; title.textContent = safeText(card.title || 'HomeEasy');
    copy.append(kicker, title);
    if (card.subtitle) { const subtitle = document.createElement('div'); subtitle.className = 'card-subtitle'; subtitle.textContent = safeText(card.subtitle); copy.appendChild(subtitle); }
    top.appendChild(copy);
    const rawValue = firstValue(card.amount, card.value);
    if (rawValue !== undefined) {
      const amount = document.createElement('div'); amount.className = 'card-amount';
      if (card.amount !== undefined) amount.textContent = formatCOP(card.amount);
      else {
        const number = finiteNumber(rawValue);
        amount.textContent = number === null
          ? safeText(rawValue)
          : `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(number)}${safeText(card.unit)}`;
      }
      top.appendChild(amount);
    }
    wrap.appendChild(top);
    if (card.meta) { const meta = document.createElement('div'); meta.className = 'card-meta'; meta.textContent = safeText(card.meta); wrap.appendChild(meta); }
    appendStatus(wrap, card.status); return wrap;
  }

  function renderCard(card, context) {
    if (!card || typeof card !== 'object') return null;
    const type = safeText(card.type).toLowerCase();
    if (type === 'order' || type === 'balance') return renderOrderCard(card, context);
    if (type === 'quote') return renderQuoteCard(card, context);
    if (type === 'customer') return renderCustomerCard(card);
    if (type === 'kpi_group') return renderKpiGroup(card);
    if (type === 'chart') return renderChartCard(card);
    if (type === 'document') return renderDocumentCard(card, context);
    return renderGenericCard(card);
  }

  function normalizeCards(cards, documentMode) {
    const rows = Array.isArray(cards) ? cards.filter(card => card && typeof card === 'object') : [];
    const normalized = [];
    let entityCount = 0;
    for (const card of rows) {
      const type = safeText(card.type).toLowerCase();
      if (type === 'suggestions') continue;
      if (type === 'document' && documentMode !== 'explicit') continue;
      if (['order', 'quote', 'customer', 'balance'].includes(type) && ++entityCount > 5) continue;
      normalized.push(card);
      if (normalized.length >= 12) break;
    }
    return normalized;
  }

  function normalizeSuggestions(suggestions) {
    const unique = new Set(); const rows = [];
    for (const suggestion of (Array.isArray(suggestions) ? suggestions : [])) {
      const source = typeof suggestion === 'string' ? { label: suggestion, prompt: suggestion } : suggestion;
      if (!source || typeof source !== 'object') continue;
      const label = safeText(source.label).trim(); const prompt = safeText(source.prompt).trim();
      const permission = safeText(firstValue(source.required_permission, source.requiredPermission)).trim();
      if (!label || !prompt || unique.has(prompt) || (permission && !hasPermission(permission))) continue;
      unique.add(prompt); rows.push({ label, prompt, required_permission: permission });
      if (rows.length === 3) break;
    }
    return rows;
  }

  function appendMessage(role, text, cards = [], { persistMessage = true, suggestions = [], documentMode = 'embedded', voiceTurnId = '' } = {}) {
    if (el.welcome && el.welcome.isConnected) el.welcome.remove();
    const row = document.createElement('div'); row.className = `message-row ${role}`;
    const message = document.createElement('article'); message.className = 'message';
    const bubble = document.createElement('div'); bubble.className = 'message-bubble';
    const content = document.createElement('div'); content.className = 'message-text'; content.textContent = safeText(text);
    bubble.appendChild(content); message.appendChild(bubble);
    const normalizedDocumentMode = safeText(documentMode).toLowerCase() === 'explicit' ? 'explicit' : 'embedded';
    const cleanCards = normalizeCards(cards, normalizedDocumentMode);
    const context = { documentKeys: new Set(), documentUrls: new Set() };
    if (cleanCards.length) {
      const stack = document.createElement('div'); stack.className = 'card-stack';
      for (const card of cleanCards) { const node = renderCard(card, context); if (node) stack.appendChild(node); }
      if (stack.childElementCount) message.appendChild(stack);
    }
    const embeddedSuggestions = (Array.isArray(cards) ? cards : [])
      .filter(card => safeText(card?.type).toLowerCase() === 'suggestions')
      .flatMap(card => Array.isArray(card.items) ? card.items : (card.suggestions || []));
    const cleanSuggestions = normalizeSuggestions([...(Array.isArray(suggestions) ? suggestions : []), ...embeddedSuggestions]);
    if (role === 'assistant' && cleanSuggestions.length) {
      const group = document.createElement('div'); group.className = 'suggestion-row'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Sugerencias para continuar');
      for (const suggestion of cleanSuggestions) {
        const button = document.createElement('button'); button.className = 'suggestion-chip'; button.type = 'button'; button.textContent = suggestion.label;
        button.addEventListener('click', () => sendMessage(suggestion.prompt)); group.appendChild(button);
      }
      message.appendChild(group);
    }
    const meta = document.createElement('div'); meta.className = 'message-meta'; meta.textContent = role === 'assistant' ? 'Hommy · datos consultados cuando aplica' : 'Tú';
    message.appendChild(meta); row.appendChild(message); el.conversation.appendChild(row);
    if (persistMessage) {
      const stored = { role, text: safeText(text), cards: cleanCards, suggestions: cleanSuggestions, documentMode: normalizedDocumentMode };
      if (/^[A-Za-z0-9_-]{1,180}$/.test(safeText(voiceTurnId))) stored.voiceTurnId = safeText(voiceTurnId);
      state.messages.push(stored); state.messages = state.messages.slice(-MAX_STORED_MESSAGES); persist();
    }
    scrollToBottom(); return row;
  }

  function showTyping() {
    const row = document.createElement('div'); row.className = 'message-row assistant'; row.dataset.typing = 'true';
    const message = document.createElement('div'); message.className = 'message';
    const bubble = document.createElement('div'); bubble.className = 'message-bubble typing-bubble'; bubble.setAttribute('role', 'status'); bubble.setAttribute('aria-label', 'Hommy está pensando');
    bubble.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
    message.appendChild(bubble); row.appendChild(message); el.conversation.appendChild(row); el.conversation.setAttribute('aria-busy', 'true'); scrollToBottom();
  }
  function hideTyping() { el.conversation.querySelector('[data-typing="true"]')?.remove(); el.conversation.removeAttribute('aria-busy'); }
  function scrollToBottom() {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduced ? 'auto' : 'smooth' }));
  }
  function renderStoredConversation() {
    for (const item of state.messages) appendMessage(item.role, item.text, item.cards || [], { persistMessage: false, suggestions: item.suggestions || [], documentMode: item.documentMode || 'embedded' });
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const upstreamSignal = options.signal;
    const requestOptions = { ...options };
    delete requestOptions.signal;
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) abortFromUpstream();
    else upstreamSignal?.addEventListener?.('abort', abortFromUpstream, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { cache: 'no-store', ...requestOptions, signal: controller.signal }); }
    finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener?.('abort', abortFromUpstream);
    }
  }

  async function apiJSON(path, body, { signal } = {}) {
    const response = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {}),
      signal,
    });
    let data = null; try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data || data.ok === false) {
      const error = new Error(data?.error?.message || `Hommy no pudo completar la solicitud (${response.status}).`);
      error.code = data?.error?.code || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function scheduleVoiceSyncRetry() {
    if (state.voiceSyncRetryTimer || !state.voiceSyncQueue.length) return;
    const delay = state.voiceSyncRetryMs;
    state.voiceSyncRetryMs = Math.min(state.voiceSyncRetryMs * 2, 30_000);
    state.voiceSyncRetryTimer = window.setTimeout(() => {
      state.voiceSyncRetryTimer = null;
      void flushVoiceSyncQueue();
    }, delay);
  }

  function enqueueVoiceSync(turn) {
    const normalized = normalizedVoiceTurn(turn);
    if (!normalized) return;
    const key = voiceTurnKey(normalized);
    if (state.voiceSyncQueue.some(item => voiceTurnKey(item) === key)) return;
    state.voiceSyncQueue.push(normalized);
    persist();
    void flushVoiceSyncQueue();
  }

  function nextVoiceSyncBatch() {
    const batch = [];
    let characters = 0;
    for (const turn of state.voiceSyncQueue) {
      if (batch.length >= VOICE_SYNC_BATCH_SIZE) break;
      const nextCharacters = characters + turn.text.length;
      if (batch.length && nextCharacters > VOICE_SYNC_BATCH_CHARS) break;
      batch.push(turn);
      characters = nextCharacters;
    }
    return batch;
  }

  function flushVoiceSyncQueue() {
    if (state.voiceSyncPromise) return state.voiceSyncPromise;
    if (!state.voiceSyncQueue.length) return Promise.resolve(true);
    const revision = state.conversationRevision;
    state.voiceSyncPromise = (async () => {
      try {
        while (state.voiceSyncQueue.length && revision === state.conversationRevision) {
          const batch = nextVoiceSyncBatch();
          const sentKeys = new Set(batch.map(voiceTurnKey));
          const data = await apiJSON('/api/hommy/realtime/sync', {
            conversationToken: state.conversationToken || null,
            turns: batch,
          });
          if (revision !== state.conversationRevision) return false;
          const nextToken = safeText(firstValue(data.conversationToken, data.data?.conversationToken)).trim();
          if (nextToken) state.conversationToken = nextToken;
          else if (!state.conversationToken) throw new Error('Hommy no devolvió el contexto sincronizado.');
          state.voiceSyncQueue = state.voiceSyncQueue.filter(item => !sentKeys.has(voiceTurnKey(item)));
          if (state.voiceSyncRetryTimer) window.clearTimeout(state.voiceSyncRetryTimer);
          state.voiceSyncRetryTimer = null;
          state.voiceSyncRetryMs = 2_000;
          persist();
        }
        return state.voiceSyncQueue.length === 0;
      } catch (error) {
        const status = Number(error?.status || 0);
        const retryable = !status || status === 408 || status === 429 || status >= 500;
        if (retryable && revision === state.conversationRevision) scheduleVoiceSyncRetry();
        else if (revision === state.conversationRevision) showToast('El servidor rechazó la sincronización de voz. El turno permanece guardado para reintentar.');
        return false;
      } finally {
        state.voiceSyncPromise = null;
      }
    })();
    return state.voiceSyncPromise;
  }

  async function sendMessage(preset) {
    if (state.sending) return;
    const text = safeText(preset !== undefined ? preset : el.input.value).trim(); if (!text) return;
    state.sending = true; el.send.disabled = true; el.input.disabled = true; el.composerNote.textContent = 'Hommy está consultando HomeEasy…';
    try {
      const closingVoice = state.voice?.closing ? state.voice : null;
      if (closingVoice?.closePromise) await closingVoice.closePromise;
      appendMessage('user', text); el.input.value = ''; resizeInput(); showTyping();
      const synchronized = await flushVoiceSyncQueue();
      if (!synchronized && state.voiceSyncQueue.length) throw new Error('No pude sincronizar todavía el contexto de voz. Inténtalo de nuevo en un momento.');
      const data = await apiJSON('/api/hommy/chat', { message: text, conversationToken: state.conversationToken || null });
      const nextToken = safeText(data.conversationToken).trim();
      if (nextToken) state.conversationToken = nextToken;
      hideTyping();
      appendMessage('assistant', data.answer || 'No recibí una respuesta completa.', data.cards || [], {
        suggestions: data.suggestions || [],
        documentMode: firstValue(data.document_mode, data.documentMode, 'embedded'),
      });
    } catch (error) {
      hideTyping(); appendMessage('assistant', `No pude completar esa consulta. ${safeText(error.message)}`);
      if (['APP_SESSION_EXPIRED', 'AUTH_REQUIRED', 'DEVICE_MISMATCH'].includes(error.code)) showToast('Tu sesión debe renovarse. Vuelve a HomeEasy e inténtalo de nuevo.');
    } finally {
      state.sending = false; el.input.disabled = false; el.composerNote.textContent = 'Hommy consulta datos reales según tus permisos de HomeEasy.'; updateSendButton(); el.input.focus({ preventScroll: true });
    }
  }

  function updateSendButton() { el.send.disabled = state.sending || !el.input.value.trim(); }
  function resizeInput() { el.input.style.height = 'auto'; el.input.style.height = `${Math.min(el.input.scrollHeight, 150)}px`; }
  function newConversation() {
    if (state.sending) return;
    state.conversationRevision += 1;
    state.messages = [];
    state.conversationToken = '';
    state.voiceSyncQueue = [];
    state.voiceSyncRetryMs = 2_000;
    if (state.voiceSyncRetryTimer) window.clearTimeout(state.voiceSyncRetryTimer);
    state.voiceSyncRetryTimer = null;
    persist();
    window.location.reload();
  }

  async function checkHealth() {
    if (state.healthCheckInFlight) return;
    state.healthCheckInFlight = true;
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/health`, { method: 'GET' }, HEALTH_REQUEST_TIMEOUT_MS); const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error('offline'); setServiceStatus('Disponible', 'ready'); el.voice.disabled = false;
    } catch (_) { setServiceStatus('Sin conexión', 'error'); el.voice.disabled = true; }
    finally { state.healthCheckInFlight = false; }
  }

  async function bootstrapHommy() {
    try {
      const data = await apiJSON('/api/hommy/bootstrap', {});
      document.documentElement.dataset.hommyBootstrap = 'ready';
      const updatedAt = safeText(firstValue(data.dataUpdatedAt, data.data_updated_at, data.data?.dataUpdatedAt, data.data?.data_updated_at)).trim();
      if (updatedAt) el.composerNote.title = `Datos preparados: ${updatedAt}`;
    } catch (_) {
      document.documentElement.dataset.hommyBootstrap = 'deferred';
    }
  }

  async function waitForAuth() {
    const ready = () => Boolean(window.HomeEasyAuth?.getCurrentProfile?.() && window.HomeEasyAuth?.getAppSessionToken?.());
    if (ready()) return;
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = ok => { if (done) return; done = true; clearInterval(interval); clearTimeout(timeout); window.removeEventListener('homeeasy:page-auth-ready', onReady); ok ? resolve() : reject(new Error('No fue posible abrir la sesión de Hommy.')); };
      const onReady = () => { if (ready()) finish(true); };
      const interval = setInterval(() => { if (ready()) finish(true); }, 100);
      const timeout = setTimeout(() => finish(ready()), 12_000);
      window.addEventListener('homeeasy:page-auth-ready', onReady);
    });
  }

  function finalizeVoiceResources(voice) {
    if (!voice) return;
    if (voice.closed) { voice.resolveClose?.(); return; }
    if (state.voice === voice) state.voice = null;
    voice.closed = true;
    if (voice.closeTimer) window.clearTimeout(voice.closeTimer);
    if (voice.connectTimer) window.clearTimeout(voice.connectTimer);
    if (voice.disconnectTimer) window.clearTimeout(voice.disconnectTimer);
    if (voice.toolContinuationRetryTimer) window.clearTimeout(voice.toolContinuationRetryTimer);
    voice.closeTimer = null;
    voice.connectTimer = null;
    voice.disconnectTimer = null;
    voice.toolContinuationRetryTimer = null;
    try { voice.channel?.close(); } catch (_) {} try { voice.pc?.close(); } catch (_) {}
    for (const track of voice.stream?.getTracks?.() || []) { try { track.stop(); } catch (_) {} }
    try { voice.audio?.pause(); } catch (_) {} if (voice.audio) voice.audio.srcObject = null;
    voice.inputTranscripts?.clear();
    voice.assistantTranscripts?.clear();
    voice.failedTranscriptionIds?.clear();
    voice.finalizedTurnIds?.clear();
    voice.executedCallIds?.clear();
    voice.seenEventIds?.clear();
    voice.settledInputIds?.clear();
    voice.settledResponseIds?.clear();
    voice.inputOrder?.splice(0);
    voice.pendingInputTurns?.clear();
    voice.pendingCompletedResponses?.clear();
    voice.responseInputItems?.clear();
    voice.activeResponseIds?.clear();
    voice.playingAudioResponseIds?.clear();
    voice.pendingAudioDrainResponses?.clear();
    voice.drainedAudioResponseIds?.clear();
    voice.clearedAudioResponseIds?.clear();
    voice.locallyCutResponseIds?.clear();
    voice.manualResponseRequests?.clear();
    voice.supersededManualRequestIds?.clear();
    voice.pendingToolContinuationOrigins?.splice(0);
    voice.pendingTranscriptionIds?.clear();
    voice.inputGenerations?.clear();
    voice.responseGenerations?.clear();
    for (const execution of voice.toolExecutions?.values?.() || []) execution.controller?.abort?.();
    voice.toolExecutions?.clear();
    voice.vadResponsePending = false;
    voice.speechActive = false;
    voice.latestInputItemId = '';
    voice.resolveClose?.();
    void flushVoiceSyncQueue();
  }

  function scheduleVoiceCloseCheck(voice) {
    if (!voice?.closing || voice.closed) return;
    if (voice.closeTimer) window.clearTimeout(voice.closeTimer);
    const now = Date.now();
    const pendingTranscript = voice.speechActive || voice.pendingTranscriptionIds.size > 0 || voice.inputTranscripts.size > 0;
    if (now >= voice.closeDeadline || (now >= voice.closeNotBefore && !pendingTranscript)) {
      finalizeVoiceResources(voice);
      return;
    }
    const nextCheck = now < voice.closeNotBefore
      ? Math.min(voice.closeNotBefore - now, 250)
      : Math.min(250, voice.closeDeadline - now);
    voice.closeTimer = window.setTimeout(() => scheduleVoiceCloseCheck(voice), Math.max(20, nextCheck));
  }

  function stopVoice({ hide = true, graceful = true } = {}) {
    const voice = state.voice;
    if (voice && !voice.closing) {
      voice.closing = true;
      const cutResponses = new Set([
        ...voice.activeResponseIds,
        ...voice.playingAudioResponseIds,
        ...voice.pendingAudioDrainResponses.keys(),
      ]);
      for (const responseId of cutResponses) {
        voice.locallyCutResponseIds.add(responseId);
        discardAssistantTranscript(responseId, voice);
      }
      for (const execution of voice.toolExecutions.values()) execution.controller.abort();
      voice.pendingToolContinuationOrigins.splice(0);
      for (const track of voice.stream?.getTracks?.() || []) { try { track.stop(); } catch (_) {} }
      try { voice.audio?.pause(); } catch (_) {} if (voice.audio) voice.audio.srcObject = null;
      if (graceful && voice.channel?.readyState === 'open') {
        voice.closeNotBefore = Date.now() + VOICE_CLOSE_MIN_GRACE_MS;
        voice.closeDeadline = Date.now() + VOICE_CLOSE_MAX_GRACE_MS;
        scheduleVoiceCloseCheck(voice);
      } else finalizeVoiceResources(voice);
    } else if (voice && !graceful) finalizeVoiceResources(voice);
    void flushVoiceSyncQueue();
    el.mute.setAttribute('aria-pressed', 'false'); el.muteLabel.textContent = 'Silenciar';
    if (hide) {
      el.voiceMode.hidden = true;
      el.app.inert = false;
      document.body.style.overflow = state.bodyOverflow;
      const previousFocus = state.voicePreviousFocus;
      state.voicePreviousFocus = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
  }

  function openVoiceDialog() {
    state.voicePreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : el.voice;
    state.bodyOverflow = document.body.style.overflow;
    el.app.inert = true;
    el.voiceMode.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => el.voiceDismiss.focus({ preventScroll: true }));
  }

  function handleVoiceDialogKeydown(event) {
    if (el.voiceMode.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); stopVoice(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...el.voiceMode.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.hidden && node.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); el.voiceMode.focus(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function sendRealtimeEvent(channel, event) {
    if (!channel || channel.readyState !== 'open') return false;
    try { channel.send(JSON.stringify(event)); return true; }
    catch (_) { return false; }
  }

  async function realtimeTool(item, voice, generation, controller) {
    let output;
    let args;
    try {
      args = JSON.parse(item.arguments || '{}');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('INVALID_ARGUMENTS');
    } catch (_) {
      output = { ok: false, code: 'INVALID_ARGUMENTS', message: 'La llamada de herramienta no contenía argumentos JSON válidos.' };
    }
    if (!output) {
      try {
        const data = await apiJSON('/api/hommy/tool', { name: item.name, arguments: args }, { signal: controller.signal });
        const result = data.result || { ok: false, code: 'EMPTY_TOOL_RESULT' };
        output = { ok: result.ok, data: result.data, code: result.code, message: result.message };
      } catch (error) {
        const superseded = controller.signal.aborted || generation !== voice.turnGeneration;
        output = superseded
          ? { ok: false, code: 'TURN_SUPERSEDED', message: 'La consulta fue reemplazada por un turno más reciente.' }
          : { ok: false, code: 'TOOL_FAILED', message: safeText(error.message) };
      }
    }
    const superseded = generation !== voice.turnGeneration;
    if (superseded) output = { ok: false, code: 'TURN_SUPERSEDED', message: 'La consulta fue reemplazada por un turno más reciente.' };
    const sent = !voice.closed && !voice.closing && sendRealtimeEvent(voice.channel, {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: item.call_id,
        output: JSON.stringify(output),
      },
    });
    return { sent, superseded };
  }

  function queueToolContinuation(voice, origin, generation, retryCount = 0) {
    if (generation !== voice.turnGeneration || voice.closed || voice.closing) return;
    const existing = voice.pendingToolContinuationOrigins.find(item => item.origin === origin && item.generation === generation);
    if (existing) existing.retryCount = Math.max(existing.retryCount || 0, retryCount);
    else voice.pendingToolContinuationOrigins.push({ origin, generation, retryCount });
  }

  function requestRealtimeToolContinuation(voice, inputItemId, generation, retryCount = 0) {
    const origin = safeText(inputItemId).trim();
    if (voice.closed || voice.closing || generation !== voice.turnGeneration) return;
    if (voice.activeResponseIds.size || voice.playingAudioResponseIds.size || voice.vadResponsePending || voice.manualResponseRequests.size) {
      queueToolContinuation(voice, origin, generation, retryCount);
      return;
    }
    voice.toolContinuationSequence += 1;
    const nonce = `${Date.now().toString(36)}-${voice.toolContinuationSequence.toString(36)}`;
    const eventId = `hommy_tool_response_${nonce}`;
    const metadata = { hommy_tool_continuation: nonce };
    if (origin) metadata.hommy_input_item_id = origin;
    voice.manualResponseRequests.set(eventId, { nonce, origin, generation, retryCount });
    if (!sendRealtimeEvent(voice.channel, { event_id: eventId, type: 'response.create', response: { metadata } })) {
      voice.manualResponseRequests.delete(eventId);
      queueToolContinuation(voice, origin, generation, retryCount);
    }
  }

  function dispatchPendingToolContinuation(voice) {
    voice.pendingToolContinuationOrigins = voice.pendingToolContinuationOrigins.filter(item => item.generation === voice.turnGeneration);
    if (!voice.pendingToolContinuationOrigins.length) return;
    if (voice.activeResponseIds.size || voice.playingAudioResponseIds.size || voice.vadResponsePending || voice.manualResponseRequests.size) return;
    const pending = voice.pendingToolContinuationOrigins.shift();
    requestRealtimeToolContinuation(voice, pending.origin, pending.generation, pending.retryCount || 0);
  }

  function scheduleToolContinuationRetry(voice, retryCount) {
    if (voice.toolContinuationRetryTimer || voice.closed || voice.closing) return;
    const delay = Math.min(750, 200 * Math.max(1, retryCount));
    voice.toolContinuationRetryTimer = window.setTimeout(() => {
      voice.toolContinuationRetryTimer = null;
      dispatchPendingToolContinuation(voice);
    }, delay);
  }

  async function executeRealtimeTools(items, voice, inputItemId, responseId) {
    const generation = voice.responseGenerations.get(responseId) ?? voice.inputGenerations.get(inputItemId) ?? voice.turnGeneration;
    const pending = [];
    for (const item of items) {
      const callId = safeText(item?.call_id).trim();
      const name = safeText(item?.name).trim();
      if (!callId || !name || voice.executedCallIds.has(callId)) continue;
      voice.executedCallIds.add(callId);
      pending.push({ ...item, call_id: callId, name });
    }
    if (!pending.length || voice.closed || voice.closing) return;
    setVoiceState('thinking', 'Consultando HomeEasy', 'Estoy revisando los datos autorizados para responderte.');
    let sentOutput = false;
    for (const item of pending) {
      if (voice.closed || voice.closing) return;
      const controller = new AbortController();
      voice.toolExecutions.set(item.call_id, { controller, generation });
      if (generation !== voice.turnGeneration) controller.abort();
      const outcome = await realtimeTool(item, voice, generation, controller);
      voice.toolExecutions.delete(item.call_id);
      sentOutput = (outcome.sent && !outcome.superseded) || sentOutput;
    }
    if (sentOutput && generation === voice.turnGeneration) requestRealtimeToolContinuation(voice, inputItemId, generation);
  }

  function appendFinalVoiceTurn(voice, turn) {
    const normalized = normalizedVoiceTurn(turn);
    if (!normalized) return;
    const key = voiceTurnKey(normalized);
    if (voice.finalizedTurnIds.has(key)) return;
    voice.finalizedTurnIds.add(key);
    if (!state.messages.some(item => item.role === normalized.role && item.voiceTurnId === normalized.id)) {
      appendMessage(normalized.role, normalized.text, [], { voiceTurnId: normalized.id });
    }
    enqueueVoiceSync(normalized);
  }

  function rememberInputOrder(itemId, previousItemId, voice) {
    if (!itemId || voice.inputOrder.includes(itemId)) return;
    const previousIndex = previousItemId ? voice.inputOrder.indexOf(previousItemId) : -1;
    if (previousIndex >= 0) voice.inputOrder.splice(previousIndex + 1, 0, itemId);
    else voice.inputOrder.push(itemId);
  }

  function releaseSettledInputTurns(voice) {
    while (voice.inputOrder.length && voice.settledInputIds.has(voice.inputOrder[0])) {
      const itemId = voice.inputOrder.shift();
      const turn = voice.pendingInputTurns.get(itemId);
      voice.pendingInputTurns.delete(itemId);
      if (turn) appendFinalVoiceTurn(voice, turn);
      releaseCompletedResponses(itemId, voice);
    }
  }

  function handleInputTranscript(event, voice) {
    const itemId = safeText(event.item_id).trim();
    if (!itemId) return;
    const type = safeText(event.type);
    if (![
      'conversation.item.input_audio_transcription.delta',
      'conversation.item.input_audio_transcription.completed',
      'conversation.item.input_audio_transcription.failed',
    ].includes(type)) return;
    rememberInputOrder(itemId, '', voice);
    if (!voice.inputGenerations.has(itemId)) voice.inputGenerations.set(itemId, voice.turnGeneration);
    if (type === 'conversation.item.input_audio_transcription.delta') voice.pendingTranscriptionIds.add(itemId);
    else voice.pendingTranscriptionIds.delete(itemId);
    if (voice.finalizedTurnIds.has(`user:${itemId}`) || voice.failedTranscriptionIds.has(itemId)) {
      if (voice.closing) scheduleVoiceCloseCheck(voice);
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.failed') {
      voice.inputTranscripts.delete(itemId);
      voice.failedTranscriptionIds.add(itemId);
      voice.settledInputIds.add(itemId);
      releaseSettledInputTurns(voice);
      showToast('No pude guardar la transcripción de ese turno, pero la llamada sigue activa.');
      if (voice.closing) scheduleVoiceCloseCheck(voice);
      return;
    }
    const current = voice.inputTranscripts.get(itemId) || '';
    if (type === 'conversation.item.input_audio_transcription.delta') {
      voice.inputTranscripts.set(itemId, `${current}${safeText(event.delta)}`.slice(0, MAX_VOICE_TRANSCRIPT_CHARS));
      return;
    }
    const transcript = safeText(event.transcript !== undefined ? event.transcript : current).trim();
    voice.inputTranscripts.delete(itemId);
    const turn = normalizedVoiceTurn({ id: itemId, role: 'user', text: transcript });
    if (turn) voice.pendingInputTurns.set(itemId, turn);
    voice.settledInputIds.add(itemId);
    releaseSettledInputTurns(voice);
    if (voice.closing) scheduleVoiceCloseCheck(voice);
  }

  function handleAssistantTranscript(event, voice) {
    const responseId = safeText(event.response_id).trim();
    if (!responseId || voice.settledResponseIds.has(responseId) || voice.locallyCutResponseIds.has(responseId)) return;
    const itemId = safeText(event.item_id).trim() || responseId;
    const contentIndex = Number.isInteger(event.content_index) ? event.content_index : 0;
    const partKey = `${itemId}:${contentIndex}`;
    const candidate = voice.assistantTranscripts.get(responseId) || { parts: new Map() };
    const current = candidate.parts.get(partKey) || '';
    const text = event.type.endsWith('.done') && event.transcript !== undefined
      ? safeText(event.transcript)
      : `${current}${safeText(event.delta)}`;
    candidate.parts.set(partKey, text.slice(0, MAX_VOICE_TRANSCRIPT_CHARS));
    voice.assistantTranscripts.set(responseId, candidate);
  }

  function transcriptFromCompletedResponse(response) {
    const parts = [];
    for (const item of Array.isArray(response?.output) ? response.output : []) {
      if (item?.type !== 'message' || item.role !== 'assistant') continue;
      for (const content of Array.isArray(item.content) ? item.content : []) {
        const text = safeText(firstValue(content.transcript, content.type === 'output_text' ? content.text : '')).trim();
        if (text) parts.push(text);
      }
    }
    return parts.join('\n').trim().slice(0, MAX_VOICE_TRANSCRIPT_CHARS);
  }

  function finalizeAssistantTranscript(response, voice) {
    const responseId = safeText(response?.id).trim();
    if (!responseId) return;
    const candidate = voice.assistantTranscripts.get(responseId);
    const candidateText = candidate
      ? [...candidate.parts.values()].map(value => safeText(value).trim()).filter(Boolean).join('\n')
      : '';
    const text = (candidateText || transcriptFromCompletedResponse(response)).trim().slice(0, MAX_VOICE_TRANSCRIPT_CHARS);
    voice.assistantTranscripts.delete(responseId);
    voice.pendingCompletedResponses.delete(responseId);
    voice.responseInputItems.delete(responseId);
    voice.responseGenerations.delete(responseId);
    voice.locallyCutResponseIds.delete(responseId);
    appendFinalVoiceTurn(voice, { id: responseId, role: 'assistant', text });
  }

  function discardAssistantTranscript(responseId, voice) {
    if (!responseId) return;
    voice.assistantTranscripts.delete(responseId);
    voice.pendingCompletedResponses.delete(responseId);
    voice.pendingAudioDrainResponses.delete(responseId);
    voice.responseInputItems.delete(responseId);
  }

  function responseContainsAudio(response, voice) {
    const responseId = safeText(response?.id).trim();
    if (responseId && voice.playingAudioResponseIds.has(responseId)) return true;
    return (Array.isArray(response?.output) ? response.output : []).some(item =>
      item?.type === 'message' && (Array.isArray(item.content) ? item.content : []).some(content =>
        content?.type === 'output_audio'
      )
    );
  }

  function settleCompletedAssistantResponse(response, voice) {
    const responseId = safeText(response?.id).trim();
    const inputItemId = voice.responseInputItems.get(responseId);
    if (inputItemId && !voice.settledInputIds.has(inputItemId)) voice.pendingCompletedResponses.set(responseId, response);
    else finalizeAssistantTranscript(response, voice);
  }

  function handleOutputAudioStopped(responseId, voice) {
    if (!responseId) return;
    voice.playingAudioResponseIds.delete(responseId);
    if (voice.locallyCutResponseIds.has(responseId)) {
      discardAssistantTranscript(responseId, voice);
      voice.drainedAudioResponseIds.delete(responseId);
      voice.clearedAudioResponseIds.delete(responseId);
      voice.responseGenerations.delete(responseId);
      return;
    }
    const response = voice.pendingAudioDrainResponses.get(responseId);
    if (response) {
      voice.pendingAudioDrainResponses.delete(responseId);
      settleCompletedAssistantResponse(response, voice);
    } else if (!voice.settledResponseIds.has(responseId)) voice.drainedAudioResponseIds.add(responseId);
    if (!voice.closing) setVoiceState('listening', 'Te escucho', 'Puedes seguir preguntando sin empezar de nuevo.');
    dispatchPendingToolContinuation(voice);
  }

  function handleOutputAudioCleared(responseId, voice) {
    if (!responseId) return;
    voice.playingAudioResponseIds.delete(responseId);
    if (voice.pendingAudioDrainResponses.has(responseId) || voice.settledResponseIds.has(responseId)) {
      discardAssistantTranscript(responseId, voice);
      voice.clearedAudioResponseIds.delete(responseId);
      voice.responseGenerations.delete(responseId);
    } else voice.clearedAudioResponseIds.add(responseId);
    if (!voice.closing) setVoiceState('listening', 'Te escucho', 'Continúa; descarté la parte de la respuesta que no alcanzaste a oír.');
    dispatchPendingToolContinuation(voice);
  }

  function releaseCompletedResponses(itemId, voice) {
    for (const [responseId, response] of voice.pendingCompletedResponses) {
      if (voice.responseInputItems.get(responseId) !== itemId) continue;
      finalizeAssistantTranscript(response, voice);
    }
  }

  function handleCompletedRealtimeResponse(response, voice) {
    const status = safeText(response?.status);
    const responseId = safeText(response?.id).trim();
    if (responseId && voice.settledResponseIds.has(responseId)) return;
    if (responseId) voice.settledResponseIds.add(responseId);
    const generation = voice.responseGenerations.get(responseId) ?? voice.turnGeneration;
    if (responseId && (voice.locallyCutResponseIds.has(responseId) || generation !== voice.turnGeneration)) {
      discardAssistantTranscript(responseId, voice);
      voice.playingAudioResponseIds.delete(responseId);
      voice.drainedAudioResponseIds.delete(responseId);
      voice.clearedAudioResponseIds.delete(responseId);
      voice.responseGenerations.delete(responseId);
      voice.locallyCutResponseIds.delete(responseId);
      return;
    }
    if (status !== 'completed') {
      if (responseId) {
        discardAssistantTranscript(responseId, voice);
        voice.playingAudioResponseIds.delete(responseId);
        voice.drainedAudioResponseIds.delete(responseId);
        voice.clearedAudioResponseIds.delete(responseId);
        voice.responseGenerations.delete(responseId);
      }
      if (status === 'cancelled') setVoiceState('listening', 'Te escucho', 'Continúa; descarté la parte de la respuesta que no alcanzaste a oír.');
      else setVoiceState('listening', 'Te escucho', 'No pude completar esa respuesta. Puedes intentarlo de nuevo.');
      return;
    }

    const inputItemId = voice.responseInputItems.get(responseId);
    const calls = (Array.isArray(response.output) ? response.output : [])
      .filter(item => item?.type === 'function_call' && (!item.status || item.status === 'completed'));
    if (calls.length) {
      discardAssistantTranscript(responseId, voice);
      if (!voice.closing) void executeRealtimeTools(calls, voice, inputItemId, responseId);
      return;
    }
    if (responseContainsAudio(response, voice)) {
      if (voice.clearedAudioResponseIds.delete(responseId)) {
        discardAssistantTranscript(responseId, voice);
        if (!voice.closing) setVoiceState('listening', 'Te escucho', 'Continúa; descarté la parte de la respuesta que no alcanzaste a oír.');
      } else if (voice.drainedAudioResponseIds.delete(responseId)) {
        settleCompletedAssistantResponse(response, voice);
        if (!voice.closing) setVoiceState('listening', 'Te escucho', 'Puedes seguir preguntando sin empezar de nuevo.');
      } else voice.pendingAudioDrainResponses.set(responseId, response);
      return;
    }
    settleCompletedAssistantResponse(response, voice);
    if (!voice.closing) setVoiceState('listening', 'Te escucho', 'Puedes seguir preguntando sin empezar de nuevo.');
  }

  function rememberRealtimeEvent(event, voice) {
    const eventId = safeText(event?.event_id).trim();
    if (!eventId) return true;
    if (voice.seenEventIds.has(eventId)) return false;
    voice.seenEventIds.add(eventId);
    if (voice.seenEventIds.size > 1_000) voice.seenEventIds.delete(voice.seenEventIds.values().next().value);
    return true;
  }

  function seedVoiceHistory(channel) {
    const recent = state.messages
      .filter(item => item && ['user', 'assistant'].includes(item.role) && safeText(item.text).trim())
      .slice(-MAX_VOICE_CONTEXT_MESSAGES);
    for (const item of recent) {
      const assistant = item.role === 'assistant';
      const text = safeText(item.text).trim().slice(0, 2400);
      channel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: assistant ? 'assistant' : 'user',
          content: [{ type: assistant ? 'output_text' : 'input_text', text }],
        },
      }));
    }
  }

  function beginVoiceTurn(voice) {
    voice.turnGeneration += 1;
    voice.activeSpeechGeneration = voice.turnGeneration;
    for (const [callId, execution] of voice.toolExecutions) {
      if (execution.generation >= voice.turnGeneration) continue;
      execution.controller.abort();
      voice.toolExecutions.delete(callId);
    }
    voice.pendingToolContinuationOrigins = voice.pendingToolContinuationOrigins.filter(item => item.generation === voice.turnGeneration);
    for (const [eventId, request] of voice.manualResponseRequests) {
      if (request.generation >= voice.turnGeneration) continue;
      voice.manualResponseRequests.delete(eventId);
      voice.supersededManualRequestIds.add(eventId);
    }
    for (const responseId of new Set([
      ...voice.activeResponseIds,
      ...voice.playingAudioResponseIds,
      ...voice.pendingAudioDrainResponses.keys(),
    ])) {
      const responseGeneration = voice.responseGenerations.get(responseId) ?? 0;
      if (responseGeneration >= voice.turnGeneration) continue;
      voice.locallyCutResponseIds.add(responseId);
      discardAssistantTranscript(responseId, voice);
    }
    return voice.turnGeneration;
  }

  function handleRealtimeEvent(event, voice) {
    if (!voice || voice.closed || !rememberRealtimeEvent(event, voice)) return;
    const type = safeText(event?.type);
    if ([
      'conversation.item.input_audio_transcription.delta',
      'conversation.item.input_audio_transcription.completed',
      'conversation.item.input_audio_transcription.failed',
    ].includes(type)) handleInputTranscript(event, voice);
    else if (type === 'response.output_audio_transcript.delta' || type === 'response.output_audio_transcript.done') handleAssistantTranscript(event, voice);
    else if (type === 'response.done') {
      const responseId = safeText(event.response?.id).trim();
      if (responseId) voice.activeResponseIds.delete(responseId);
      handleCompletedRealtimeResponse(event.response, voice);
      dispatchPendingToolContinuation(voice);
    }
    else if (type === 'output_audio_buffer.started') {
      const responseId = safeText(event.response_id).trim();
      if (responseId) voice.playingAudioResponseIds.add(responseId);
      if (!voice.closing) setVoiceState('speaking', 'Hommy está respondiendo', 'Puedes interrumpirme hablando cuando quieras.');
    }
    else if (type === 'output_audio_buffer.stopped') handleOutputAudioStopped(safeText(event.response_id).trim(), voice);
    else if (type === 'output_audio_buffer.cleared') handleOutputAudioCleared(safeText(event.response_id).trim(), voice);
    else if (type === 'input_audio_buffer.speech_started') {
      beginVoiceTurn(voice);
      voice.speechActive = true;
      voice.vadResponsePending = true;
      if (!voice.closing) setVoiceState('listening', 'Te escucho', 'Habla con naturalidad. Hommy mantiene el contexto de esta conversación.');
    }
    else if (type === 'input_audio_buffer.speech_stopped' || type === 'input_audio_buffer.committed') {
      voice.vadResponsePending = true;
      if (type === 'input_audio_buffer.speech_stopped') voice.speechActive = false;
      const itemId = safeText(event.item_id).trim();
      if (itemId) {
        let generation = voice.activeSpeechGeneration;
        if (!generation) generation = beginVoiceTurn(voice);
        voice.latestInputItemId = itemId;
        if (type === 'input_audio_buffer.committed') {
          voice.inputGenerations.set(itemId, generation);
          if (!voice.settledInputIds.has(itemId)) voice.pendingTranscriptionIds.add(itemId);
          rememberInputOrder(itemId, safeText(event.previous_item_id).trim(), voice);
          voice.activeSpeechGeneration = 0;
          voice.speechActive = false;
        }
      }
      if (type === 'input_audio_buffer.speech_stopped' && !voice.closing) setVoiceState('thinking', 'Pensando', 'Estoy entendiendo tu consulta y revisando HomeEasy si hace falta.');
      if (voice.closing) scheduleVoiceCloseCheck(voice);
    } else if (type === 'response.created') {
      const responseId = safeText(event.response?.id).trim();
      const metadata = event.response?.metadata && typeof event.response.metadata === 'object' ? event.response.metadata : {};
      const nonce = safeText(metadata.hommy_tool_continuation).trim();
      let manualRequest = null;
      if (nonce) {
        for (const [eventId, request] of voice.manualResponseRequests) {
          if (request.nonce !== nonce) continue;
          manualRequest = request;
          voice.manualResponseRequests.delete(eventId);
          break;
        }
      }
      const inputItemId = safeText(manualRequest?.origin || metadata.hommy_input_item_id || voice.latestInputItemId).trim();
      const generation = manualRequest?.generation ?? voice.inputGenerations.get(inputItemId) ?? voice.turnGeneration;
      if (!nonce && generation === voice.turnGeneration) voice.vadResponsePending = false;
      if (responseId) {
        voice.activeResponseIds.add(responseId);
        if (inputItemId) voice.responseInputItems.set(responseId, inputItemId);
        voice.responseGenerations.set(responseId, generation);
        if (voice.closing || generation !== voice.turnGeneration) voice.locallyCutResponseIds.add(responseId);
      }
      if (!voice.closing && generation === voice.turnGeneration) setVoiceState('thinking', 'Pensando', 'Estoy entendiendo tu consulta y revisando HomeEasy si hace falta.');
    }
    else if (['response.output_audio.delta', 'response.audio.delta'].includes(type)) setVoiceState('speaking', 'Hommy está respondiendo', 'Puedes interrumpirme hablando cuando quieras.');
    else if (type === 'error') {
      const failedEventId = safeText(event.error?.event_id).trim();
      if (failedEventId && voice.supersededManualRequestIds.delete(failedEventId)) return;
      const failedRequest = failedEventId ? voice.manualResponseRequests.get(failedEventId) : null;
      if (failedRequest) {
        voice.manualResponseRequests.delete(failedEventId);
        const detail = `${safeText(event.error?.code)} ${safeText(event.error?.message)}`;
        if (/active.+response|response.+active|in.progress/i.test(detail)) {
          const retryCount = (failedRequest.retryCount || 0) + 1;
          if (retryCount <= 3 && failedRequest.generation === voice.turnGeneration) {
            queueToolContinuation(voice, failedRequest.origin, failedRequest.generation, retryCount);
            scheduleToolContinuationRetry(voice, retryCount);
          } else if (!voice.closing) {
            setVoiceState('connecting', 'No pude completar la consulta', 'La conversación siguió avanzando antes de aplicar el resultado. Puedes intentarlo de nuevo.');
          }
        } else if (!voice.closing) {
          setVoiceState('connecting', 'No pude completar la consulta', event.error?.message || 'La continuación de la herramienta fue rechazada.');
        }
      } else {
        if (!voice.activeResponseIds.size) voice.vadResponsePending = false;
        dispatchPendingToolContinuation(voice);
        if (!voice.closing) setVoiceState('connecting', 'No pude continuar', event.error?.message || 'La conversación por voz encontró un problema.');
      }
    }
  }

  async function startVoice() {
    if (state.voice) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { showToast('Este navegador no ofrece el audio WebRTC que necesita Hommy Voice.'); return; }
    openVoiceDialog(); setVoiceState('connecting', 'Conectando con Hommy', 'Activando el micrófono y preparando la conversación.');
    let resolveClose;
    const closePromise = new Promise(resolve => { resolveClose = resolve; });
    const voice = {
      pc: null,
      channel: null,
      stream: null,
      audio: null,
      closed: false,
      closing: false,
      closeTimer: null,
      closePromise,
      resolveClose,
      closeNotBefore: 0,
      closeDeadline: 0,
      connectTimer: null,
      disconnectTimer: null,
      toolContinuationRetryTimer: null,
      ready: false,
      inputTranscripts: new Map(),
      assistantTranscripts: new Map(),
      failedTranscriptionIds: new Set(),
      finalizedTurnIds: new Set(),
      executedCallIds: new Set(),
      seenEventIds: new Set(),
      settledInputIds: new Set(),
      settledResponseIds: new Set(),
      inputOrder: [],
      pendingInputTurns: new Map(),
      pendingCompletedResponses: new Map(),
      responseInputItems: new Map(),
      activeResponseIds: new Set(),
      playingAudioResponseIds: new Set(),
      pendingAudioDrainResponses: new Map(),
      drainedAudioResponseIds: new Set(),
      clearedAudioResponseIds: new Set(),
      locallyCutResponseIds: new Set(),
      manualResponseRequests: new Map(),
      supersededManualRequestIds: new Set(),
      pendingToolContinuationOrigins: [],
      toolContinuationSequence: 0,
      turnGeneration: 0,
      activeSpeechGeneration: 0,
      inputGenerations: new Map(),
      responseGenerations: new Map(),
      toolExecutions: new Map(),
      pendingTranscriptionIds: new Set(),
      speechActive: false,
      vadResponsePending: false,
      latestInputItemId: '',
    };
    state.voice = voice;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (voice.closed || voice.closing || state.voice !== voice) {
        for (const track of stream.getTracks()) { try { track.stop(); } catch (_) {} }
        return;
      }
      voice.stream = stream;
      const pc = new RTCPeerConnection(); voice.pc = pc;
      voice.connectTimer = window.setTimeout(() => {
        if (voice.closed || voice.closing || voice.ready || state.voice !== voice) return;
        stopVoice({ hide: false, graceful: false });
        setVoiceState('connecting', 'No pude conectar la llamada', 'La red tardó demasiado. Puedes volver a intentarlo.');
        showToast('Hommy Voice no logró conectarse a tiempo.');
      }, VOICE_CONNECT_TIMEOUT_MS);
      pc.addEventListener('connectionstatechange', () => {
        const connectionState = safeText(pc.connectionState);
        if (connectionState === 'connected') {
          if (voice.disconnectTimer) window.clearTimeout(voice.disconnectTimer);
          voice.disconnectTimer = null;
          return;
        }
        if (connectionState === 'disconnected') {
          if (voice.disconnectTimer || voice.closed || voice.closing) return;
          voice.disconnectTimer = window.setTimeout(() => {
            voice.disconnectTimer = null;
            if (pc.connectionState !== 'disconnected' || voice.closed || voice.closing || state.voice !== voice) return;
            stopVoice({ hide: false, graceful: false });
            setVoiceState('connecting', 'Se perdió la conexión', 'Revisa la red e inicia otra llamada.');
          }, VOICE_DISCONNECT_GRACE_MS);
          return;
        }
        if (connectionState === 'failed' && !voice.closed && !voice.closing && state.voice === voice) {
          stopVoice({ hide: false, graceful: false });
          setVoiceState('connecting', 'Se perdió la conexión', 'Revisa la red e inicia otra llamada.');
        }
      });
      const audio = document.createElement('audio'); audio.autoplay = true; audio.setAttribute('playsinline', ''); voice.audio = audio;
      pc.ontrack = event => { audio.srcObject = event.streams[0]; };
      for (const track of voice.stream.getTracks()) pc.addTrack(track, voice.stream);
      const channel = pc.createDataChannel('oai-events'); voice.channel = channel;
      channel.addEventListener('open', () => {
        if (voice.closed || voice.closing || state.voice !== voice) return;
        voice.ready = true;
        if (voice.connectTimer) window.clearTimeout(voice.connectTimer);
        voice.connectTimer = null;
        seedVoiceHistory(channel);
        setVoiceState('listening', 'Te escucho', 'Habla con naturalidad. Hommy conserva el contexto reciente del chat.');
      });
      channel.addEventListener('message', raw => { try { handleRealtimeEvent(JSON.parse(raw.data), voice); } catch (_) {} });
      channel.addEventListener('close', () => {
        if (state.voice === voice) {
          stopVoice({ hide: false, graceful: false });
          setVoiceState('connecting', 'Conversación terminada', 'Puedes cerrar esta pantalla o iniciar otra llamada.');
        }
      });
      const offer = await pc.createOffer();
      if (voice.closed || voice.closing || state.voice !== voice) return;
      await pc.setLocalDescription(offer);
      if (voice.closed || voice.closing || state.voice !== voice) return;
      const response = await fetchWithTimeout(`${API_BASE}/api/hommy/realtime/session`, {
        method: 'POST',
        headers: authenticatedHeaders({ 'Content-Type': 'application/sdp' }),
        body: offer.sdp,
      }, 35_000);
      if (voice.closed || voice.closing || state.voice !== voice) return;
      if (!response.ok) { let message = 'No fue posible iniciar Hommy Voice.'; try { message = (await response.json())?.error?.message || message; } catch (_) {} throw new Error(message); }
      await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    } catch (error) {
      if (voice.closed || voice.closing || state.voice !== voice) return;
      stopVoice({ hide: false, graceful: false }); setVoiceState('connecting', 'No pude abrir el micrófono', safeText(error.message)); showToast(safeText(error.message));
    }
  }

  function toggleMute() {
    const voice = state.voice; if (!voice?.stream) return;
    const nextMuted = el.mute.getAttribute('aria-pressed') !== 'true';
    for (const track of voice.stream.getAudioTracks()) track.enabled = !nextMuted;
    el.mute.setAttribute('aria-pressed', String(nextMuted)); el.muteLabel.textContent = nextMuted ? 'Activar' : 'Silenciar';
    if (nextMuted) setVoiceState('connecting', 'Micrófono silenciado', 'Actívalo cuando quieras seguir hablando.');
    else setVoiceState('listening', 'Te escucho', 'Puedes continuar la conversación.');
  }

  async function init() {
    try { await waitForAuth(); } catch (error) { showToast(error.message); return; }
    state.profile = window.HomeEasyAuth.getCurrentProfile(); state.permissions = window.HomeEasyAuth.getPermissions?.() || [];
    state.storageKey = `HOMMY_CHAT_V2:${safeText(state.profile?.uid || 'session')}`; restore();
    const firstName = safeText(state.profile?.nombre).trim().split(/\s+/)[0]; el.welcomeTitle.textContent = firstName ? `Hola, ${firstName}.` : 'Hola.';
    renderStarters(); renderStoredConversation(); checkHealth(); void bootstrapHommy(); void flushVoiceSyncQueue(); state.healthTimer = setInterval(checkHealth, HEALTH_INTERVAL_MS);
  }

  el.input.addEventListener('input', () => { resizeInput(); updateSendButton(); });
  el.input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
  el.send.addEventListener('click', () => sendMessage()); el.back.addEventListener('click', goHome); el.newChat.addEventListener('click', newConversation); el.voice.addEventListener('click', startVoice);
  el.voiceDismiss.addEventListener('click', () => stopVoice()); el.endCall.addEventListener('click', () => stopVoice()); el.mute.addEventListener('click', toggleMute);
  el.voiceMode.addEventListener('keydown', handleVoiceDialogKeydown);
  window.addEventListener('pagehide', () => stopVoice({ graceful: false }));
  window.addEventListener('beforeunload', () => {
    if (state.healthTimer) clearInterval(state.healthTimer);
    if (state.voiceSyncRetryTimer) window.clearTimeout(state.voiceSyncRetryTimer);
  });
  init();
})();
