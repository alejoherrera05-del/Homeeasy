(() => {
  'use strict';

  const API_BASE = String(window.HOMMY_API_BASE || 'https://homeeasy-l5n1.onrender.com').replace(/\/$/, '');
  const HEALTH_INTERVAL_MS = 60_000;
  const REQUEST_TIMEOUT_MS = 55_000;
  const MAX_STORED_MESSAGES = 50;

  const el = {
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
    toastTimer: null,
    voice: null,
  };

  function safeText(value) { return String(value == null ? '' : value); }
  function hasPermission(permission) { return state.permissions.includes('*') || state.permissions.includes(permission); }
  function hasAny(...permissions) { return permissions.some(hasPermission); }

  function formatCOP(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
    }
    return safeText(value).trim();
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
    } catch (_) {
      state.messages = [];
      state.conversationToken = '';
    }
  }

  function starterOptions() {
    const rows = [];
    if (hasPermission('cotizaciones.write')) rows.push(['Cotizar una persiana', 'Dime producto, tela y medidas.', 'Quiero cotizar una persiana']);
    if (hasAny('ventas.read', 'reportes.read')) rows.push(['Ventas recientes', 'Consulta las últimas ventas registradas.', '¿Cuáles son las últimas 5 ventas?']);
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
    return ({ customer: 'Cliente', order: 'Orden de pedido', balance: 'Saldo', metric: 'Resumen', quote: 'Cotización', document: 'Documento' })[type] || 'HomeEasy';
  }

  function renderCard(card) {
    if (!card || typeof card !== 'object') return null;
    if (card.type === 'document') {
      let url; try { url = new URL(safeText(card.url)); } catch (_) { return null; }
      if (url.protocol !== 'https:') return null;
      const wrap = document.createElement('div'); wrap.className = 'hommy-card';
      const link = document.createElement('a'); link.className = 'document-link'; link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const copy = document.createElement('span');
      const kicker = document.createElement('span'); kicker.className = 'card-kicker'; kicker.textContent = 'Documento';
      const title = document.createElement('span'); title.className = 'card-title'; title.textContent = safeText(card.title || 'Abrir documento');
      copy.append(kicker, title);
      const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
      link.append(copy, arrow); wrap.appendChild(link); return wrap;
    }

    const wrap = document.createElement('div'); wrap.className = 'hommy-card';
    const top = document.createElement('div'); top.className = 'card-topline';
    const copy = document.createElement('div'); copy.className = 'card-copy';
    const kicker = document.createElement('div'); kicker.className = 'card-kicker'; kicker.textContent = cardKicker(card.type);
    const title = document.createElement('div'); title.className = 'card-title'; title.textContent = safeText(card.title || 'HomeEasy');
    copy.append(kicker, title);
    if (card.subtitle) { const subtitle = document.createElement('div'); subtitle.className = 'card-subtitle'; subtitle.textContent = safeText(card.subtitle); copy.appendChild(subtitle); }
    top.appendChild(copy);
    if (card.amount !== undefined && safeText(card.amount).trim()) { const amount = document.createElement('div'); amount.className = 'card-amount'; amount.textContent = formatCOP(card.amount); top.appendChild(amount); }
    wrap.appendChild(top);
    if (card.meta) { const meta = document.createElement('div'); meta.className = 'card-meta'; meta.textContent = safeText(card.meta); wrap.appendChild(meta); }
    if (card.status) { const status = document.createElement('span'); status.className = 'card-status'; status.textContent = safeText(card.status); wrap.appendChild(status); }
    return wrap;
  }

  function appendMessage(role, text, cards = [], { persistMessage = true } = {}) {
    if (el.welcome && el.welcome.isConnected) el.welcome.remove();
    const row = document.createElement('div'); row.className = `message-row ${role}`;
    const message = document.createElement('article'); message.className = 'message';
    const bubble = document.createElement('div'); bubble.className = 'message-bubble';
    const content = document.createElement('div'); content.className = 'message-text'; content.textContent = safeText(text);
    bubble.appendChild(content); message.appendChild(bubble);
    const cleanCards = Array.isArray(cards) ? cards.filter(card => card && typeof card === 'object').slice(0, 10) : [];
    if (cleanCards.length) {
      const stack = document.createElement('div'); stack.className = 'card-stack';
      for (const card of cleanCards) { const node = renderCard(card); if (node) stack.appendChild(node); }
      if (stack.childElementCount) message.appendChild(stack);
    }
    const meta = document.createElement('div'); meta.className = 'message-meta'; meta.textContent = role === 'assistant' ? 'Hommy · datos consultados cuando aplica' : 'Tú';
    message.appendChild(meta); row.appendChild(message); el.conversation.appendChild(row);
    if (persistMessage) { state.messages.push({ role, text: safeText(text), cards: cleanCards }); state.messages = state.messages.slice(-MAX_STORED_MESSAGES); persist(); }
    scrollToBottom(); return row;
  }

  function showTyping() {
    const row = document.createElement('div'); row.className = 'message-row assistant'; row.dataset.typing = 'true';
    const message = document.createElement('div'); message.className = 'message';
    const bubble = document.createElement('div'); bubble.className = 'message-bubble typing-bubble'; bubble.setAttribute('aria-label', 'Hommy está pensando');
    bubble.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
    message.appendChild(bubble); row.appendChild(message); el.conversation.appendChild(row); scrollToBottom();
  }
  function hideTyping() { el.conversation.querySelector('[data-typing="true"]')?.remove(); }
  function scrollToBottom() { requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })); }
  function renderStoredConversation() { for (const item of state.messages) appendMessage(item.role, item.text, item.cards || [], { persistMessage: false }); }

  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { cache: 'no-store', ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  async function apiJSON(path, body) {
    const response = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {}),
    });
    let data = null; try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data || data.ok === false) {
      const error = new Error(data?.error?.message || `Hommy no pudo completar la solicitud (${response.status}).`);
      error.code = data?.error?.code || `HTTP_${response.status}`; throw error;
    }
    return data;
  }

  async function sendMessage(preset) {
    if (state.sending) return;
    const text = safeText(preset !== undefined ? preset : el.input.value).trim(); if (!text) return;
    state.sending = true; el.send.disabled = true; el.input.disabled = true; el.composerNote.textContent = 'Hommy está consultando HomeEasy…';
    appendMessage('user', text); el.input.value = ''; resizeInput(); showTyping();
    try {
      const data = await apiJSON('/api/hommy/chat', { message: text, conversationToken: state.conversationToken || null });
      state.conversationToken = safeText(data.conversationToken); hideTyping(); appendMessage('assistant', data.answer || 'No recibí una respuesta completa.', data.cards || []);
    } catch (error) {
      hideTyping(); appendMessage('assistant', `No pude completar esa consulta. ${safeText(error.message)}`);
      if (['APP_SESSION_EXPIRED', 'AUTH_REQUIRED', 'DEVICE_MISMATCH'].includes(error.code)) showToast('Tu sesión debe renovarse. Vuelve a HomeEasy e inténtalo de nuevo.');
    } finally {
      state.sending = false; el.input.disabled = false; el.composerNote.textContent = 'Hommy consulta datos reales según tus permisos de HomeEasy.'; updateSendButton(); el.input.focus({ preventScroll: true });
    }
  }

  function updateSendButton() { el.send.disabled = state.sending || !el.input.value.trim(); }
  function resizeInput() { el.input.style.height = 'auto'; el.input.style.height = `${Math.min(el.input.scrollHeight, 150)}px`; }
  function newConversation() { if (state.sending) return; state.messages = []; state.conversationToken = ''; persist(); window.location.reload(); }

  async function checkHealth() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/health`, { method: 'GET' }, 9_000); const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error('offline'); setServiceStatus('Disponible', 'ready'); el.voice.disabled = false;
    } catch (_) { setServiceStatus('Sin conexión', 'error'); el.voice.disabled = true; }
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

  function stopVoice({ hide = true } = {}) {
    const voice = state.voice; state.voice = null;
    if (voice) {
      try { voice.channel?.close(); } catch (_) {} try { voice.pc?.close(); } catch (_) {}
      for (const track of voice.stream?.getTracks?.() || []) { try { track.stop(); } catch (_) {} }
      try { voice.audio?.pause(); } catch (_) {} if (voice.audio) voice.audio.srcObject = null;
    }
    el.mute.setAttribute('aria-pressed', 'false'); el.muteLabel.textContent = 'Silenciar';
    if (hide) { el.voiceMode.hidden = true; document.body.style.overflow = ''; }
  }

  async function realtimeTool(item, channel) {
    try {
      let args = {}; try { args = JSON.parse(item.arguments || '{}'); } catch (_) {}
      const data = await apiJSON('/api/hommy/tool', { name: item.name, arguments: args }); const result = data.result || { ok: false, code: 'EMPTY_TOOL_RESULT' };
      channel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ ok: result.ok, data: result.data, code: result.code, message: result.message }) } }));
      channel.send(JSON.stringify({ type: 'response.create' }));
    } catch (error) {
      channel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ ok: false, code: 'TOOL_FAILED', message: safeText(error.message) }) } }));
      channel.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  function handleRealtimeEvent(event, voice) {
    const type = safeText(event?.type);
    if (type === 'input_audio_buffer.speech_started') setVoiceState('listening', 'Te escucho', 'Habla con naturalidad. Hommy mantiene el contexto de esta conversación.');
    else if (type === 'input_audio_buffer.speech_stopped' || type === 'response.created') setVoiceState('thinking', 'Pensando', 'Estoy entendiendo tu consulta y revisando HomeEasy si hace falta.');
    else if (['response.output_audio.delta', 'response.audio.delta'].includes(type)) setVoiceState('speaking', 'Hommy está respondiendo', 'Puedes interrumpirme hablando cuando quieras.');
    else if (['response.output_audio.done', 'response.audio.done', 'response.done'].includes(type)) setVoiceState('listening', 'Te escucho', 'Puedes seguir preguntando sin empezar de nuevo.');
    else if (type === 'response.output_item.done' && event.item?.type === 'function_call') realtimeTool(event.item, voice.channel);
    else if (type === 'error') setVoiceState('connecting', 'No pude continuar', event.error?.message || 'La conversación por voz encontró un problema.');
  }

  async function startVoice() {
    if (state.voice) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { showToast('Este navegador no ofrece el audio WebRTC que necesita Hommy Voice.'); return; }
    el.voiceMode.hidden = false; document.body.style.overflow = 'hidden'; setVoiceState('connecting', 'Conectando con Hommy', 'Activando el micrófono y preparando la conversación.');
    const voice = { pc: null, channel: null, stream: null, audio: null }; state.voice = voice;
    try {
      voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const pc = new RTCPeerConnection(); voice.pc = pc;
      const audio = document.createElement('audio'); audio.autoplay = true; audio.setAttribute('playsinline', ''); voice.audio = audio;
      pc.ontrack = event => { audio.srcObject = event.streams[0]; };
      for (const track of voice.stream.getTracks()) pc.addTrack(track, voice.stream);
      const channel = pc.createDataChannel('oai-events'); voice.channel = channel;
      channel.addEventListener('open', () => setVoiceState('listening', 'Te escucho', 'Habla con naturalidad. Hommy consultará HomeEasy cuando lo necesite.'));
      channel.addEventListener('message', raw => { try { handleRealtimeEvent(JSON.parse(raw.data), voice); } catch (_) {} });
      channel.addEventListener('close', () => { if (state.voice === voice) setVoiceState('connecting', 'Conversación terminada', 'Puedes cerrar esta pantalla o iniciar otra llamada.'); });
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const response = await fetchWithTimeout(`${API_BASE}/api/hommy/realtime/session`, {
        method: 'POST',
        headers: authenticatedHeaders({ 'Content-Type': 'application/sdp' }),
        body: offer.sdp,
      }, 35_000);
      if (!response.ok) { let message = 'No fue posible iniciar Hommy Voice.'; try { message = (await response.json())?.error?.message || message; } catch (_) {} throw new Error(message); }
      await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    } catch (error) { stopVoice({ hide: false }); setVoiceState('connecting', 'No pude abrir el micrófono', safeText(error.message)); showToast(safeText(error.message)); }
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
    renderStarters(); renderStoredConversation(); checkHealth(); state.healthTimer = setInterval(checkHealth, HEALTH_INTERVAL_MS);
  }

  el.input.addEventListener('input', () => { resizeInput(); updateSendButton(); });
  el.input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
  el.send.addEventListener('click', () => sendMessage()); el.back.addEventListener('click', goHome); el.newChat.addEventListener('click', newConversation); el.voice.addEventListener('click', startVoice);
  el.voiceDismiss.addEventListener('click', () => stopVoice()); el.endCall.addEventListener('click', () => stopVoice()); el.mute.addEventListener('click', toggleMute);
  window.addEventListener('pagehide', () => stopVoice({ hide: false }));
  window.addEventListener('beforeunload', () => { if (state.healthTimer) clearInterval(state.healthTimer); });
  init();
})();
