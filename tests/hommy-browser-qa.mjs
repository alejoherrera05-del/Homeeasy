import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH;
assert.ok(executablePath, 'CHROME_PATH is required for browser QA');
fs.mkdirSync('qa/hommy-2-browser', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const coreStub = `
window.HomeEasyCore = {
  buildMeta() {
    return {
      operador: 'Alejandro QA',
      dispositivoId: 'device-browser-qa',
      dispositivoNombre: 'Chromium QA',
      plataforma: 'QA',
      navegador: 'Chromium',
      pagina: 'Hommychat.html',
      versionApp: '3.4',
      horaCliente: new Date().toISOString()
    };
  },
  goHome() { window.__hommyWentHome = true; }
};
window.HomeEasyAuth = {
  getCurrentProfile() {
    return { uid: 'qa-user', nombre: 'Alejandro QA', email: 'qa@example.com', rol: 'ADMIN' };
  },
  getPermissions() {
    return ['app.access', 'clientes.read', 'ventas.read', 'reportes.read', 'caja.read', 'agenda.read', 'cotizaciones.read', 'cotizaciones.write'];
  },
  getAppSessionToken() { return 'qa-session-token'; }
};
`;

const guardStub = `
queueMicrotask(() => window.dispatchEvent(new CustomEvent('homeeasy:page-auth-ready', { detail: { authorized: true } })));
`;

function responseFor(prompt) {
  if (prompt === 'qa-sales') {
    return {
      ok: true,
      answer: 'Estas son tus últimas ventas. **La OP 38 tiene saldo pendiente.**\n<img src=x onerror="window.__hommyXss=1"> debe verse como texto.',
      conversationToken: 'signed-conversation-token',
      document_mode: 'embedded',
      cards: [
        {
          type: 'order', entity_id: 'order:38', numero: '38', cliente: 'Cristhian Prueba', fecha: '2026-08-14',
          descripcion: 'Combo Portobello + 4 verticales', total_cop: 2_900_000, abonado_total_cop: 1_450_000,
          saldo_cop: 1_450_000, estado_financiero: 'ABONADO', documento: { url: 'https://example.com/op38.pdf', label: 'Ver OP' },
        },
        {
          type: 'order', entity_id: 'order:39', numero: '39', cliente: 'Andrea Prueba', fecha: '2026-08-20',
          descripcion: 'Sheer Elegance', total_cop: 1_800_000, abonado_total_cop: 1_800_000,
          saldo_cop: 0, estado_financiero: 'PAGADO', documento: { url: 'https://example.com/op39.pdf', label: 'Ver OP' },
        },
        { type: 'document', entity_id: 'order:38', title: 'Documento OP38 duplicado', url: 'https://example.com/op38.pdf' },
        { type: 'document', entity_id: 'order:40', title: 'Documento no solicitado', url: 'https://example.com/op40.pdf' },
      ],
      suggestions: [
        { label: 'Comparar con mes pasado', prompt: 'Compara este mes con el anterior', required_permission: 'reportes.read' },
        { label: 'Ver cartera', prompt: 'Muéstrame la cartera pendiente', required_permission: 'caja.read' },
        { label: 'Top clientes', prompt: 'Muéstrame los mejores clientes', required_permission: 'ventas.read' },
        { label: 'Configuración', prompt: 'Abre configuración', required_permission: 'config.read' },
      ],
    };
  }
  if (prompt === 'qa-customer') {
    return {
      ok: true,
      answer: 'Encontré una coincidencia exacta.',
      conversationToken: 'signed-conversation-token',
      cards: [{
        type: 'customer', entity_id: 'customer:qa-1', nombre: 'Oscar Aníbal Prueba', cedula: '10.530.101',
        telefono: '300 000 0000', email: 'sincorreo@sincorreo.com', direccion: 'Calle de prueba 10',
        actions: ['copy', 'share', 'whatsapp', 'call'],
      }],
      suggestions: [
        { label: 'Ver compras', prompt: 'Ver compras del cliente', required_permission: 'ventas.read' },
        { label: 'Ver saldo', prompt: 'Ver saldo del cliente', required_permission: 'caja.read' },
      ],
    };
  }
  if (prompt === 'qa-quote') {
    return {
      ok: true,
      answer: 'Esta es la cotización más reciente.',
      conversationToken: 'signed-conversation-token',
      cards: [{
        type: 'quote', entity_id: 'quote:104', numero: '104', cliente: 'Oscar Aníbal Prueba', fecha: '2026-08-27',
        resumen: 'Sheer Elegance · Serenade', valor_cop: 1_800_000, estado: 'ACTIVA',
        documento: { url: 'https://example.com/cot104.pdf', label: 'Ver cotización' },
      }],
    };
  }
  if (prompt === 'qa-comparison') {
    return {
      ok: true,
      answer: 'Agosto va 68,1% por debajo de julio. Frente a los mismos 28 días, el ritmo también es menor.',
      conversationToken: 'signed-conversation-token',
      cards: [
        {
          type: 'kpi_group', title: 'Ventas del mes', items: [
            { key: 'sales', label: 'Ventas', kind: 'currency', value: 7_199_000 },
            { key: 'orders', label: 'Órdenes', kind: 'integer', value: 4 },
            { key: 'ticket', label: 'Ticket promedio', kind: 'currency', value: 1_799_750 },
            { key: 'change', label: 'Vs. mes pasado', kind: 'percent', value: -68.1, tone: 'down' },
            { key: 'extra', label: 'No debe mostrarse', kind: 'integer', value: 99 },
          ],
        },
        {
          type: 'chart', chart_type: 'bar', title: 'Ventas comparadas',
          accessible_summary: 'Agosto registra 7,2 millones frente a 22,5 millones de julio.',
          series: [
            { key: 'current', label: 'Ago 1–28', value: 7_199_000, display_value: '$7,2 M' },
            { key: 'previous', label: 'Jul 1–28', value: 22_550_000, display_value: '$22,5 M' },
          ],
        },
      ],
      suggestions: [
        { label: 'Ver cartera', prompt: 'Muéstrame la cartera', required_permission: 'caja.read' },
        { label: 'Top ventas', prompt: 'Muéstrame las ventas más altas', required_permission: 'ventas.read' },
        { label: 'Mes completo', prompt: 'Compara los meses completos', required_permission: 'reportes.read' },
        { label: 'Cuarta sugerencia', prompt: 'No debe mostrarse', required_permission: 'reportes.read' },
      ],
    };
  }
  throw new Error(`Unexpected QA prompt: ${prompt}`);
}

async function mockPage(page, counters) {
  await page.addInitScript(() => {
    window.__qaCopied = [];
    window.__qaShared = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__qaCopied.push(text); } },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async data => { window.__qaShared.push(data); },
    });
    const track = {
      enabled: true,
      stopped: false,
      stop() { this.stopped = true; window.__qaTrackStopped = true; },
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) },
    });
    window.__qaSentRealtime = [];
    window.RTCPeerConnection = class FakePeerConnection {
      constructor() {
        this.connectionState = 'new';
        this.listeners = new Map();
        window.__qaPeer = this;
      }
      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }
      emit(type) { for (const listener of this.listeners.get(type) || []) listener({ type }); }
      addTrack() {}
      createDataChannel() {
        const listeners = new Map();
        const channel = {
          readyState: 'connecting',
          addEventListener(type, listener) {
            const rows = listeners.get(type) || [];
            rows.push(listener);
            listeners.set(type, rows);
          },
          emit(type, event = {}) { for (const listener of listeners.get(type) || []) listener({ type, ...event }); },
          emitMessage(event) { this.emit('message', { data: JSON.stringify(event) }); },
          send(payload) { window.__qaSentRealtime.push(JSON.parse(payload)); },
          close() { this.readyState = 'closed'; this.emit('close'); },
        };
        this.channel = channel;
        window.__qaChannel = channel;
        return channel;
      }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = 'connected';
        this.emit('connectionstatechange');
        this.channel.readyState = 'open';
        queueMicrotask(() => this.channel.emit('open'));
      }
      close() { this.connectionState = 'closed'; }
    };
  });
  await page.route('**/homeeasy-core.js*', route => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: coreStub }));
  await page.route('**/homeeasy-page-guard.js*', route => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: guardStub }));
  await page.route('https://homeeasy-hommy-staging.onrender.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, service: 'Hommy', version: '2.4.0' }) });
    if (url.pathname === '/api/hommy/bootstrap') {
      counters.bootstrap += 1;
      assert.equal(request.headers()['x-homeeasy-session'], 'qa-session-token');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, dataUpdatedAt: '2026-08-28T12:00:00-05:00' }) });
    }
    if (url.pathname === '/api/hommy/realtime/session') return route.fulfill({ status: 200, contentType: 'application/sdp', body: 'v=0\r\n' });
    if (url.pathname === '/api/hommy/realtime/sync') {
      counters.voiceSync = counters.voiceSync || [];
      counters.voiceSync.push(request.postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversationToken: 'signed-voice-token', synced: request.postDataJSON().turns.length }) });
    }
    if (url.pathname === '/api/hommy/tool') {
      counters.voiceTools = (counters.voiceTools || 0) + 1;
      if (counters.blockNextVoiceTool) {
        counters.blockNextVoiceTool = false;
        counters.voiceToolBlocked = true;
        await new Promise(resolve => { counters.releaseVoiceTool = resolve; });
      }
      try {
        return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: { ok: true, data: { cantidad: 1 } } }) });
      } catch (_) {
        return undefined;
      }
    }
    if (url.pathname === '/api/hommy/chat') {
      const headers = request.headers();
      assert.equal(headers['x-homeeasy-session'], 'qa-session-token');
      assert.ok(headers['x-homeeasy-meta'], 'HomeEasy device metadata header must be sent');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFor(request.postDataJSON().message)) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'QA route not mocked' } }) });
  });
}

async function waitUntilReady(page) {
  await page.waitForFunction(() => document.querySelector('#service-status')?.textContent.includes('Disponible'));
  await page.waitForFunction(() => document.documentElement.dataset.hommyBootstrap === 'ready');
}

async function resetConversation(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('#new-chat-button').click(),
  ]);
  await waitUntilReady(page);
}

async function sendPrompt(page, prompt, resultSelector) {
  await page.locator('#message-input').fill(prompt);
  assert.equal(await page.locator('#send-button').isDisabled(), false);
  await page.locator('#send-button').click();
  await page.locator(resultSelector).last().waitFor({ state: 'visible' });
}

async function emitRealtime(page, event) {
  await page.evaluate(value => window.__qaChannel.emitMessage(value), event);
}

async function assertLayout(page, name, stage) {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    composerBottom: document.querySelector('.composer-shell').getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
    minimumAction: Math.min(...[...document.querySelectorAll('.contact-action, .entity-document-link, .suggestion-chip')].map(node => Math.min(node.getBoundingClientRect().width, node.getBoundingClientRect().height))),
    zoomDisabled: document.querySelector('meta[name="viewport"]')?.content.includes('user-scalable=no') || false,
  }));
  assert.ok(layout.scrollWidth <= layout.innerWidth + 1, `${name}/${stage}: horizontal overflow`);
  assert.ok(layout.composerBottom <= layout.viewportHeight + 2, `${name}/${stage}: composer escaped viewport`);
  assert.equal(layout.zoomDisabled, false, `${name}/${stage}: viewport must not disable zoom`);
  if (Number.isFinite(layout.minimumAction)) assert.ok(layout.minimumAction >= 43.5, `${name}/${stage}: touch action below 44px`);
}

async function runViewport(name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  const counters = { bootstrap: 0 };
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => consoleErrors.push(String(error)));
  await mockPage(page, counters);

  await page.goto('http://127.0.0.1:8000/Hommychat.html', { waitUntil: 'networkidle' });
  await waitUntilReady(page);
  assert.equal(await page.locator('#welcome-title').textContent(), 'Hola, Alejandro.');
  assert.ok(await page.locator('.starter').count() >= 3, `${name}: expected starter actions`);
  await assertLayout(page, name, 'welcome');
  await page.screenshot({ path: `qa/hommy-2-browser/${name}-welcome.png`, fullPage: true });

  await page.locator('#voice-button').click();
  await page.locator('#voice-mode').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'voice-dismiss', `${name}: voice dialog should receive focus`);
  assert.equal(await page.evaluate(() => document.querySelector('#hommy-app').inert), true, `${name}: app should be inert behind voice dialog`);
  await page.waitForFunction(() => document.querySelector('#voice-title')?.textContent === 'Te escucho');
  assert.equal(await page.evaluate(() => window.__qaPeer?.connectionState), 'connected', `${name}: voice WebRTC must connect`);
  assert.equal(await page.locator('#voice-help').getAttribute('aria-live'), 'polite', `${name}: voice status must be announced`);

  await emitRealtime(page, { event_id: 'event_commit_1', type: 'input_audio_buffer.committed', item_id: 'item_user_1' });
  await emitRealtime(page, { event_id: 'event_transcript_1', type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_user_1', transcript: 'Interrumpe esta respuesta' });
  await emitRealtime(page, { event_id: 'event_created_1', type: 'response.created', response: { id: 'resp_interrupt', metadata: null } });
  await emitRealtime(page, { event_id: 'event_audio_started_1', type: 'output_audio_buffer.started', response_id: 'resp_interrupt' });
  await emitRealtime(page, { event_id: 'event_output_text_1', type: 'response.output_audio_transcript.done', response_id: 'resp_interrupt', item_id: 'item_assistant_1', content_index: 0, transcript: 'Esta parte no se alcanzó a oír completa.' });
  await emitRealtime(page, { event_id: 'event_done_1', type: 'response.done', response: { id: 'resp_interrupt', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_audio', transcript: 'Esta parte no se alcanzó a oír completa.' }] }] } });
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('HOMMY_CHAT_V2:qa-user')).messages.some(item => item.voiceTurnId === 'resp_interrupt')), false, `${name}: assistant transcript must wait for drained audio`);
  await emitRealtime(page, { event_id: 'event_audio_cleared_1', type: 'output_audio_buffer.cleared', response_id: 'resp_interrupt' });

  await emitRealtime(page, { event_id: 'event_commit_2', type: 'input_audio_buffer.committed', item_id: 'item_user_2', previous_item_id: 'item_user_1' });
  await emitRealtime(page, { event_id: 'event_transcript_2', type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_user_2', transcript: 'Ahora responde completo' });
  await emitRealtime(page, { event_id: 'event_created_2', type: 'response.created', response: { id: 'resp_complete', metadata: null } });
  await emitRealtime(page, { event_id: 'event_audio_started_2', type: 'output_audio_buffer.started', response_id: 'resp_complete' });
  await emitRealtime(page, { event_id: 'event_output_text_2', type: 'response.output_audio_transcript.done', response_id: 'resp_complete', item_id: 'item_assistant_2', content_index: 0, transcript: 'Respuesta completa y audible.' });
  await emitRealtime(page, { event_id: 'event_done_2', type: 'response.done', response: { id: 'resp_complete', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_audio', transcript: 'Respuesta completa y audible.' }] }] } });
  await emitRealtime(page, { event_id: 'event_audio_stopped_2', type: 'output_audio_buffer.stopped', response_id: 'resp_complete' });
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('HOMMY_CHAT_V2:qa-user')).messages.some(item => item.voiceTurnId === 'resp_complete'));

  await emitRealtime(page, { event_id: 'event_commit_3', type: 'input_audio_buffer.committed', item_id: 'item_user_3', previous_item_id: 'item_user_2' });
  await emitRealtime(page, { event_id: 'event_transcript_3', type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_user_3', transcript: 'Consulta una herramienta' });
  await emitRealtime(page, { event_id: 'event_created_3', type: 'response.created', response: { id: 'resp_tool', metadata: null } });
  const toolResponse = { id: 'resp_tool', status: 'completed', output: [{ type: 'function_call', call_id: 'call_qa_1', name: 'obtener_ultimas_ventas', arguments: '{"cantidad":1}', status: 'completed' }] };
  await emitRealtime(page, { event_id: 'event_done_3', type: 'response.done', response: toolResponse });
  await emitRealtime(page, { event_id: 'event_done_3_duplicate', type: 'response.done', response: toolResponse });
  await page.waitForTimeout(500);
  assert.equal(counters.voiceTools, 1, `${name}: repeated response.done must not execute a tool twice`);
  const sentRealtime = await page.evaluate(() => window.__qaSentRealtime);
  assert.equal(sentRealtime.filter(event => event.type === 'conversation.item.create' && event.item?.type === 'function_call_output').length, 1, `${name}: tool output must be returned once`);
  assert.equal(sentRealtime.filter(event => event.type === 'response.create' && event.response?.metadata?.hommy_tool_continuation).length, 1, `${name}: tool continuation must be correlated`);

  const firstContinuation = sentRealtime.find(event => event.type === 'response.create' && event.response?.metadata?.hommy_tool_continuation);
  await emitRealtime(page, { event_id: 'event_created_vad_race', type: 'response.created', response: { id: 'resp_vad_race', metadata: null } });
  await emitRealtime(page, {
    event_id: 'event_active_response_error',
    type: 'error',
    error: { event_id: firstContinuation.event_id, code: 'conversation_already_has_active_response', message: 'Conversation already has an active response in progress.' },
  });
  await emitRealtime(page, { event_id: 'event_done_vad_race', type: 'response.done', response: { id: 'resp_vad_race', status: 'completed', output: [] } });
  await page.waitForTimeout(350);
  const afterRetry = await page.evaluate(() => window.__qaSentRealtime);
  const continuationsAfterRetry = afterRetry.filter(event => event.type === 'response.create' && event.response?.metadata?.hommy_tool_continuation);
  assert.equal(continuationsAfterRetry.length, 2, `${name}: active-response race must retry the continuation exactly once`);
  const retryContinuation = continuationsAfterRetry.at(-1);
  await emitRealtime(page, { event_id: 'event_created_tool_retry', type: 'response.created', response: { id: 'resp_tool_retry', metadata: retryContinuation.response.metadata } });
  await emitRealtime(page, { event_id: 'event_done_tool_retry', type: 'response.done', response: { id: 'resp_tool_retry', status: 'completed', output: [] } });
  await page.waitForTimeout(850);
  assert.equal((await page.evaluate(() => window.__qaSentRealtime)).filter(event => event.type === 'response.create' && event.response?.metadata?.hommy_tool_continuation).length, 2, `${name}: continuation retry must not loop`);

  await emitRealtime(page, { event_id: 'event_commit_slow_tool', type: 'input_audio_buffer.committed', item_id: 'item_user_slow', previous_item_id: 'item_user_3' });
  await emitRealtime(page, { event_id: 'event_transcript_slow_tool', type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_user_slow', transcript: 'Consulta lenta del turno anterior' });
  await emitRealtime(page, { event_id: 'event_created_slow_tool', type: 'response.created', response: { id: 'resp_tool_slow', metadata: null } });
  counters.blockNextVoiceTool = true;
  const slowToolResponse = { id: 'resp_tool_slow', status: 'completed', output: [{ type: 'function_call', call_id: 'call_qa_slow', name: 'obtener_ultimas_ventas', arguments: '{"cantidad":1}', status: 'completed' }] };
  await emitRealtime(page, { event_id: 'event_done_slow_tool', type: 'response.done', response: slowToolResponse });
  for (let attempt = 0; attempt < 20 && !counters.voiceToolBlocked; attempt += 1) await page.waitForTimeout(25);
  assert.equal(counters.voiceToolBlocked, true, `${name}: slow voice tool must reach the mocked backend`);
  await emitRealtime(page, { event_id: 'event_speech_barge', type: 'input_audio_buffer.speech_started' });
  await emitRealtime(page, { event_id: 'event_commit_barge', type: 'input_audio_buffer.committed', item_id: 'item_user_barge', previous_item_id: 'item_user_slow' });
  await emitRealtime(page, { event_id: 'event_transcript_barge', type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_user_barge', transcript: 'Este turno reemplaza al anterior' });
  counters.releaseVoiceTool?.();
  await page.waitForTimeout(350);
  const afterSupersession = await page.evaluate(() => window.__qaSentRealtime);
  const supersededOutputs = afterSupersession.filter(event => event.type === 'conversation.item.create' && event.item?.call_id === 'call_qa_slow');
  assert.equal(supersededOutputs.length, 1, `${name}: superseded tool call must be closed once`);
  assert.equal(JSON.parse(supersededOutputs[0].item.output).code, 'TURN_SUPERSEDED', `${name}: slow old tool must be marked superseded`);
  assert.equal(afterSupersession.filter(event => event.type === 'response.create' && event.response?.metadata?.hommy_input_item_id === 'item_user_slow').length, 0, `${name}: superseded tool must not create a continuation`);
  await emitRealtime(page, { event_id: 'event_created_barge', type: 'response.created', response: { id: 'resp_barge', metadata: null } });
  await emitRealtime(page, { event_id: 'event_done_barge', type: 'response.done', response: { id: 'resp_barge', status: 'completed', output: [] } });

  await page.waitForTimeout(500);
  const syncedTurns = (counters.voiceSync || []).flatMap(batch => batch.turns || []);
  assert.ok(syncedTurns.some(turn => turn.id === 'item_user_1'), `${name}: final user transcript must sync`);
  assert.ok(syncedTurns.some(turn => turn.id === 'resp_complete'), `${name}: drained assistant transcript must sync`);
  assert.ok(!syncedTurns.some(turn => turn.id === 'resp_interrupt'), `${name}: interrupted assistant transcript must not sync`);
  await emitRealtime(page, { event_id: 'event_speech_cut', type: 'input_audio_buffer.speech_started' });
  await emitRealtime(page, { event_id: 'event_commit_cut', type: 'input_audio_buffer.committed', item_id: 'item_user_cut', previous_item_id: 'item_user_barge' });
  await emitRealtime(page, { event_id: 'event_transcript_cut', type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_user_cut', transcript: 'Respuesta que voy a cortar' });
  await emitRealtime(page, { event_id: 'event_created_cut', type: 'response.created', response: { id: 'resp_cut_on_close', metadata: null } });
  await emitRealtime(page, { event_id: 'event_audio_started_cut', type: 'output_audio_buffer.started', response_id: 'resp_cut_on_close' });
  await emitRealtime(page, { event_id: 'event_output_text_cut', type: 'response.output_audio_transcript.done', response_id: 'resp_cut_on_close', item_id: 'item_assistant_cut', content_index: 0, transcript: 'Esta respuesta fue cortada localmente.' });
  await emitRealtime(page, { event_id: 'event_speech_delayed', type: 'input_audio_buffer.speech_started' });
  await emitRealtime(page, { event_id: 'event_commit_delayed', type: 'input_audio_buffer.committed', item_id: 'item_user_delayed', previous_item_id: 'item_user_cut' });
  await page.locator('#end-call-button').click();
  await page.waitForFunction(() => document.querySelector('#voice-mode').hidden);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'voice-button', `${name}: voice focus should be restored`);
  assert.equal(await page.evaluate(() => window.__qaTrackStopped), true, `${name}: closing voice must stop the microphone immediately`);
  await page.locator('#message-input').fill('qa-sales');
  await page.locator('#send-button').click();
  await page.waitForTimeout(200);
  await emitRealtime(page, { event_id: 'event_audio_stopped_cut', type: 'output_audio_buffer.stopped', response_id: 'resp_cut_on_close' });
  await emitRealtime(page, { event_id: 'event_done_cut', type: 'response.done', response: { id: 'resp_cut_on_close', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_audio', transcript: 'Esta respuesta fue cortada localmente.' }] }] } });
  await page.waitForTimeout(1_250);
  assert.equal(await page.evaluate(() => window.__qaChannel.readyState), 'open', `${name}: voice channel must wait beyond minimum grace for the last transcript`);
  await emitRealtime(page, { event_id: 'event_transcript_delayed', type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_user_delayed', transcript: 'Último turno de voz tardío' });
  await page.locator('.order-card').last().waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.__qaChannel.readyState === 'closed');
  const orderedMessages = await page.evaluate(() => JSON.parse(sessionStorage.getItem('HOMMY_CHAT_V2:qa-user')).messages);
  const delayedIndex = orderedMessages.findIndex(item => item.voiceTurnId === 'item_user_delayed');
  const textIndex = orderedMessages.findIndex(item => item.role === 'user' && item.text === 'qa-sales');
  assert.ok(delayedIndex >= 0 && textIndex > delayedIndex, `${name}: delayed voice turn must remain before the next text message`);
  assert.equal(orderedMessages.some(item => item.voiceTurnId === 'resp_cut_on_close'), false, `${name}: locally cut assistant audio must never persist`);
  await page.waitForTimeout(400);
  const syncedAfterClose = (counters.voiceSync || []).flatMap(batch => batch.turns || []);
  assert.ok(syncedAfterClose.some(turn => turn.id === 'item_user_delayed'), `${name}: delayed final transcript must sync`);
  assert.ok(!syncedAfterClose.some(turn => turn.id === 'resp_cut_on_close'), `${name}: locally cut response must not sync`);

  assert.equal(await page.locator('.order-card').count(), 2, `${name}: sales cards`);
  assert.equal(await page.locator('.order-card .entity-document-link').count(), 2, `${name}: documents must be embedded`);
  assert.equal(await page.locator('.document-card').count(), 0, `${name}: no standalone document spam`);
  assert.equal(await page.locator('.suggestion-chip').count(), 3, `${name}: maximum three suggestions`);
  assert.equal(await page.locator('img[src="x"]').count(), 0, `${name}: model HTML must not become DOM`);
  assert.equal(await page.evaluate(() => window.__hommyXss), undefined, `${name}: injected JS must never execute`);
  await assertLayout(page, name, 'sales');
  await page.screenshot({ path: `qa/hommy-2-browser/${name}-sales.png`, fullPage: true });

  await resetConversation(page);
  await sendPrompt(page, 'qa-customer', '.customer-card');
  const customerText = await page.locator('.customer-card').textContent();
  assert.ok(customerText.includes('Sin correo registrado'), `${name}: placeholder email must be hidden`);
  assert.ok(!customerText.includes('sincorreo@sincorreo.com'), `${name}: placeholder email leaked`);
  assert.equal(await page.locator('.customer-card .contact-action').count(), 4, `${name}: contact actions`);
  assert.equal(await page.locator('a[href="https://wa.me/573000000000"]').count(), 1, `${name}: safe Colombian WhatsApp URL`);
  assert.equal(await page.locator('a[href="tel:+573000000000"]').count(), 1, `${name}: safe telephone URL`);
  await assertLayout(page, name, 'customer');
  await page.screenshot({ path: `qa/hommy-2-browser/${name}-customer.png`, fullPage: true });
  await page.getByRole('button', { name: 'Copiar datos de Oscar Aníbal Prueba' }).click();
  assert.ok((await page.evaluate(() => window.__qaCopied.at(-1))).includes('Cédula: 10.530.101'), `${name}: clean copy payload`);
  await page.getByRole('button', { name: 'Compartir datos de Oscar Aníbal Prueba' }).click();
  assert.equal(await page.evaluate(() => window.__qaShared.at(-1).text.includes('sincorreo@sincorreo.com')), false, `${name}: share payload hides placeholder email`);
  await sendPrompt(page, 'qa-quote', '.quote-card');
  assert.equal(await page.locator('.quote-card .entity-document-link').count(), 1, `${name}: quote document must be embedded`);

  await resetConversation(page);
  await sendPrompt(page, 'qa-comparison', '.chart-card');
  assert.equal(await page.locator('.kpi-item').count(), 4, `${name}: maximum four KPIs`);
  assert.equal(await page.locator('.chart-card svg[role="img"]').count(), 1, `${name}: accessible SVG chart`);
  assert.equal(await page.locator('.chart-card svg title').textContent(), 'Ventas comparadas');
  assert.equal(await page.locator('.chart-bar').count(), 2, `${name}: chart bars`);
  assert.equal(await page.locator('.suggestion-chip').count(), 3, `${name}: suggestions remain bounded`);
  await assertLayout(page, name, 'comparison');
  await page.screenshot({ path: `qa/hommy-2-browser/${name}-comparison.png`, fullPage: true });

  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('HOMMY_CHAT_V2:qa-user')));
  assert.equal(stored.conversationToken, 'signed-conversation-token');
  assert.equal(stored.messages.at(-1).role, 'assistant');
  assert.ok(counters.bootstrap >= 3, `${name}: bootstrap must run after authenticated page loads`);
  assert.deepEqual(consoleErrors, [], `${name}: console/page errors: ${consoleErrors.join(' | ')}`);

  console.log(`${name}: PASS (${viewport.width}x${viewport.height})`);
  await context.close();
}

try {
  await runViewport('desktop', { width: 1440, height: 1000 });
  await runViewport('mobile', { width: 390, height: 844 });
  console.log('ALL HOMMY BROWSER QA PASSED');
} finally {
  await Promise.race([
    browser.close(),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
}
process.exit(0);
