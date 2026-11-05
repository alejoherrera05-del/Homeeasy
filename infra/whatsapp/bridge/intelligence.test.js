'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createIntelligence, resolveAssociation, RESPONSE_STYLE } = require('./intelligence');

function record(id, text, overrides) {
  return { id, chatId: '573001112233@c.us', phone: '573001112233', lid: null,
    at: `2026-11-05T12:00:0${id.slice(-1)}.000Z`, text, ...(overrides || {}) };
}

function result(overrides) {
  return {
    intent: 'INFORMATION_REQUEST', secondaryIntents: [], productInterest: null,
    commercialSummary: 'El contacto solicita información comercial.', pendingInformation: [],
    temperature: 'ACTIVE', humanInterventionRequired: false,
    suggestedResponse: '¡Hola! Con gusto te ayudamos.', nextAction: 'PREPARE_RESPONSE',
    reason: 'Solicitud comercial explícita.', confidence: 0.91, ...(overrides || {})
  };
}

function setup(items, overrides) {
  const dataDir = fs.mkdtempSync(path.join(__dirname, '.test-hommy-intelligence-'));
  const opts = overrides || {};
  const intelligence = createIntelligence({
    dataDir, enabled: true,
    inbox: { list: () => ({ items: items.slice().reverse(), pagination: {} }) },
    resolveMatch: opts.resolveMatch || (async () => ({ status: 'UNKNOWN', reason: 'Sin coincidencia' })),
    analyze: opts.analyze || (async () => ({ result: result(), conversationToken: 'context-1' })),
    inspectConversation: opts.inspectConversation || (async () => ({ humanTakeover: false }))
  });
  return { dataDir, intelligence, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('acceptance: Onda Serena + visita stays in REVIEW and does not confirm availability', async t => {
  const env = setup([record('m1', 'Hola, quiero información de las persianas onda serena. Puedo agendar una visita?')], {
    analyze: async () => ({ result: result({ productInterest: 'Onda Serena',
      commercialSummary: 'Interés en persianas Onda Serena y solicitud de visita.',
      suggestedResponse: 'Claro. Preparamos la solicitud de visita y te confirmaremos según disponibilidad.' }) })
  });
  t.after(env.cleanup);
  const output = await env.intelligence.process({}, {});
  assert.equal(output.processed, 1);
  const analysis = env.intelligence.list({}).items[0];
  assert.equal(analysis.result.productInterest, 'Onda Serena');
  assert.equal(analysis.result.intent, 'VISIT_REQUEST');
  assert.ok(analysis.result.secondaryIntents.includes('INFORMATION_REQUEST'));
  assert.equal(analysis.result.nextAction, 'COLLECT_VISIT_DETAILS');
  assert.deepEqual(analysis.result.pendingInformation, ['Nombre', 'Dirección o barrio', 'Horarios preferidos']);
  assert.match(analysis.result.reason, /disponibilidad real/i);
  assert.deepEqual(analysis.audit, { mode: 'REVIEW', sent: false, agendaCreated: false, actor: null, humanTakeover: false, attempts: 1 });
});

test('deduplicates already processed inbox messages', async t => {
  let calls = 0;
  const env = setup([record('m2', 'Quiero una cotización')], {
    analyze: async () => { calls += 1; return { result: result({ intent: 'QUOTE_REQUEST', nextAction: 'REQUEST_QUOTE_DETAILS' }) }; }
  });
  t.after(env.cleanup);
  await env.intelligence.process({}, {});
  await env.intelligence.process({}, {});
  assert.equal(calls, 1);
  assert.equal(env.intelligence.list({}).items.length, 1);
});

test('serializes simultaneous processing requests and creates one final analysis', async t => {
  let calls = 0;
  const env = setup([record('concurrent-1', 'Quiero información')], {
    analyze: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 25));
      return { result: result() };
    }
  });
  t.after(env.cleanup);
  await Promise.all([env.intelligence.process({}, {}), env.intelligence.process({}, {})]);
  assert.equal(calls, 1);
  assert.equal(env.intelligence.list({}).items.filter(item => item.sourceMessageId === 'concurrent-1').length, 1);
});

test('keeps one stable client by verified phone and separates unresolved LIDs', async t => {
  const env = setup([
    record('identity-1', 'Hola'),
    record('identity-2', 'Regresé', { at: '2026-11-06T12:00:00.000Z' }),
    record('lid-a', 'Hola', { chatId: '111@lid', phone: null, lid: '111@lid' }),
    record('lid-b', 'Hola', { chatId: '222@lid', phone: null, lid: '222@lid' })
  ]);
  t.after(env.cleanup);
  await env.intelligence.process({}, { limit: 10 });
  const memory = env.intelligence.memory({ limit: 20 });
  assert.equal(memory.clients.length, 3);
  const phoneClient = memory.clients.find(item => item.phones.includes('573001112233'));
  assert.ok(phoneClient);
  assert.equal(memory.conversations.filter(item => item.clientId === phoneClient.id)[0].messages.length, 2);
  assert.equal(memory.clients.filter(item => item.provisional).length, 2);
});

test('stores several commercial opportunities for the same client', async t => {
  const env = setup([
    record('opp-1', 'Busco Onda Serena para una habitación'),
    record('opp-2', 'También quiero paneles japoneses para la sala', { at: '2026-11-06T12:00:00.000Z' })
  ], { analyze: async input => ({ result: result(input.record.id === 'opp-1' ? {
    productInterest: 'Onda Serena', memory: { environment: 'habitación' }
  } : { productInterest: 'Paneles japoneses', memory: { environment: 'sala' } }) }) });
  t.after(env.cleanup);
  await env.intelligence.process({}, { limit: 10 });
  const memory = env.intelligence.memory({});
  assert.equal(memory.clients.length, 1);
  assert.deepEqual(memory.opportunities.map(item => item.product).sort(), ['Onda Serena', 'Paneles japoneses'].sort());
});

test('stores Colombian response rules and greets only the new-conversation draft', async t => {
  const env = setup([
    record('style-1', 'Necesito ayuda'),
    record('style-2', 'Es para la sala', { at: '2026-11-05T12:01:00.000Z' })
  ], { analyze: async () => ({ result: result({ suggestedResponse: 'Claro que sí, con mucho gusto te ayudo.' }) }) });
  t.after(env.cleanup);
  assert.equal(RESPONSE_STYLE.locale, 'es-CO');
  assert.equal(RESPONSE_STYLE.neverImpersonateHuman, true);
  assert.equal(RESPONSE_STYLE.neverRepeatKnownQuestions, true);
  await env.intelligence.process({}, { limit: 10 });
  const drafts = Object.fromEntries(env.intelligence.list({}).items.map(item => [item.sourceMessageId, item.result.suggestedResponse]));
  assert.match(drafts['style-1'], /^Hola, cómo estás\? 😊/);
  assert.equal(drafts['style-2'], 'Claro que sí, con mucho gusto te ayudo.');
});

test('keeps LID without phone and new contacts unknown', async t => {
  const associations = [];
  const env = setup([
    record('m3', 'Hola', { chatId: '12345@lid', phone: null, lid: '12345@lid' }),
    record('m4', 'Soy un cliente nuevo', { phone: '573009998877', chatId: '573009998877@c.us' })
  ], { resolveMatch: async item => {
    const match = item.phone ? { status: 'UNKNOWN', reason: 'No existe coincidencia' }
      : { status: 'UNKNOWN', reason: 'El LID no tiene un teléfono resuelto.' };
    associations.push(match); return match;
  } });
  t.after(env.cleanup);
  await env.intelligence.process({}, { limit: 10 });
  assert.equal(associations.length, 2);
  assert.ok(env.intelligence.list({}).items.every(item => item.association.status === 'UNKNOWN'));
});

test('persists only an unequivocal existing client and quote match', async t => {
  const env = setup([record('m5', '¿Cómo va mi cotización?')], {
    resolveMatch: async () => ({ status: 'MATCHED', client: { cedula: '123', name: 'Ana Pérez' },
      quote: { number: 'COT-42' }, reason: 'Coincidencia inequívoca por teléfono.' })
  });
  t.after(env.cleanup);
  await env.intelligence.process({}, {});
  assert.deepEqual(env.intelligence.list({}).items[0].association.client, { cedula: '123', name: 'Ana Pérez' });
  assert.deepEqual(env.intelligence.list({}).items[0].association.quote, { number: 'COT-42' });
});

test('association logic refuses ambiguous clients and quotes', () => {
  const incoming = record('match-1', 'Hola');
  const unique = resolveAssociation([
    { telefono: '3001112233', cedula: '123', nombre: 'Ana Pérez', numero: 'COT-42' }
  ], incoming);
  assert.deepEqual(unique, { status: 'MATCHED', client: { cedula: '123', name: 'Ana Pérez' },
    quote: { number: 'COT-42' }, reason: 'Coincidencia inequívoca por teléfono.' });

  const ambiguousClient = resolveAssociation([
    { telefono: '3001112233', cedula: '123', nombre: 'Ana Pérez', numero: 'COT-42' },
    { telefono: '3001112233', cedula: '456', nombre: 'Luis Díaz', numero: 'COT-43' }
  ], incoming);
  assert.equal(ambiguousClient.status, 'AMBIGUOUS');

  const ambiguousQuote = resolveAssociation([
    { telefono: '3001112233', cedula: '123', nombre: 'Ana Pérez', numero: 'COT-42' },
    { telefono: '3001112233', cedula: '123', nombre: 'Ana Pérez', numero: 'COT-44' }
  ], incoming);
  assert.equal(ambiguousQuote.status, 'MATCHED');
  assert.equal(ambiguousQuote.quote, null);
});

test('complaints and negotiations always require human review', async t => {
  const env = setup([
    record('m6', 'Quiero poner una reclamación por el mal servicio'),
    record('m7', '¿Me pueden dar un descuento o negociar el precio?')
  ]);
  t.after(env.cleanup);
  await env.intelligence.process({}, { limit: 10 });
  const byId = Object.fromEntries(env.intelligence.list({}).items.map(item => [item.sourceMessageId, item.result]));
  assert.equal(byId.m6.intent, 'COMPLAINT');
  assert.equal(byId.m6.humanInterventionRequired, true);
  assert.equal(byId.m7.intent, 'NEGOTIATION');
  assert.equal(byId.m7.nextAction, 'HUMAN_REVIEW');
});

test('STOP rules suppress the suggested response', async t => {
  const env = setup([record('m8', 'Por favor no me contacten más')]);
  t.after(env.cleanup);
  await env.intelligence.process({}, {});
  const review = env.intelligence.list({}).items[0].result;
  assert.equal(review.intent, 'DO_NOT_CONTACT');
  assert.equal(review.nextAction, 'STOP_CONTACT');
  assert.equal(review.suggestedResponse, '');
});

test('keeps context across a product change', async t => {
  const seen = [];
  const items = [record('m9', 'Me interesan paneles japoneses'),
    record('m10', 'Mejor quiero persianas Onda Serena', { at: '2026-11-05T12:01:00.000Z' })];
  const env = setup(items, { analyze: async input => {
    seen.push(input.messages.map(item => item.text));
    const latest = input.record.id === 'm10';
    return { result: result({ productInterest: latest ? 'Onda Serena' : 'Paneles japoneses' }),
      conversationToken: latest ? 'context-2' : 'context-1' };
  } });
  t.after(env.cleanup);
  await env.intelligence.process({}, { limit: 1 });
  await env.intelligence.process({}, { limit: 1 });
  assert.equal(seen[1].length, 2);
  assert.match(seen[1][0], /paneles japoneses/i);
  assert.equal(env.intelligence.list({}).items[0].result.productInterest, 'Onda Serena');
});

test('persists backend errors and recovers after restart without duplicating drafts', async t => {
  const item = record('m11', 'Necesito información');
  const first = setup([item], { analyze: async () => { throw Object.assign(new Error('offline'), { code: 'HOMMY_BACKEND_UNAVAILABLE' }); } });
  t.after(first.cleanup);
  const failed = await first.intelligence.process({}, {});
  assert.equal(failed.errors[0].code, 'HOMMY_BACKEND_UNAVAILABLE');

  const recovered = createIntelligence({ dataDir: first.dataDir, enabled: true,
    inbox: { list: () => ({ items: [item], pagination: {} }) },
    resolveMatch: async () => ({ status: 'UNKNOWN' }),
    analyze: async () => ({ result: result() }) });
  const retry = await recovered.process({}, {});
  assert.equal(retry.processed, 1);
  assert.equal(recovered.list({}).items.length, 1);
  assert.equal(recovered.list({}).items[0].audit.attempts, 2);
});

test('retries a message left PROCESSING by an interrupted process', async t => {
  const item = record('m15', 'Quiero información');
  const env = setup([item]);
  t.after(env.cleanup);
  const stateFile = path.join(env.dataDir, 'hommy-intelligence', 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1,
    processed: { m15: { status: 'PROCESSING', attempts: 1 } }, analyses: [], conversations: {} }));
  let calls = 0;
  const recovered = createIntelligence({ dataDir: env.dataDir, enabled: true,
    inbox: { list: () => ({ items: [item], pagination: {} }) },
    resolveMatch: async () => ({ status: 'UNKNOWN' }),
    analyze: async () => { calls += 1; return { result: result() }; } });
  await recovered.process({}, {});
  assert.equal(calls, 1);
  assert.equal(recovered.list({}).items[0].audit.attempts, 2);
});

test('human intervention suppresses a competing draft', async t => {
  const env = setup([record('m12', '¿Me confirmas?')], {
    inspectConversation: async () => ({ humanTakeover: true })
  });
  t.after(env.cleanup);
  await env.intelligence.process({}, {});
  const analysis = env.intelligence.list({}).items[0];
  assert.equal(analysis.result.humanInterventionRequired, true);
  assert.equal(analysis.result.nextAction, 'HUMAN_REVIEW');
  assert.equal(analysis.result.suggestedResponse, '');
  assert.equal(analysis.audit.humanTakeover, true);
});

test('outgoing human and system messages update memory without generating analyses', async t => {
  const items = [
    record('out-system', 'Mensaje de sistema', { direction: 'OUTGOING', senderKind: 'SYSTEM', source: 'api' }),
    record('out-human', 'Hola, soy Daniela y ya te ayudo', { direction: 'OUTGOING', senderKind: 'HUMAN', source: 'app', at: '2026-11-05T12:01:00.000Z' })
  ];
  let analyzeCalls = 0;
  const env = setup(items, { analyze: async () => { analyzeCalls += 1; return { result: result() }; } });
  t.after(env.cleanup);
  await env.intelligence.process({}, { limit: 10 });
  const memory = env.intelligence.memory({});
  assert.equal(analyzeCalls, 0);
  assert.equal(env.intelligence.list({}).items.length, 0);
  assert.equal(memory.conversations[0].messages.length, 2);
  assert.equal(memory.conversations[0].humanTakeover, true);
  assert.equal(memory.clients[0].lastHumanInterventionAt, '2026-11-05T12:01:00.000Z');
});

test('remembered human takeover prevents a later competing draft', async t => {
  const items = [record('human-first', 'Ya te atiendo', { direction: 'OUTGOING', senderKind: 'HUMAN', source: 'app', at: '2026-11-05T12:00:00.000Z' })];
  const dataDir = fs.mkdtempSync(path.join(__dirname, '.test-hommy-intelligence-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const intelligence = createIntelligence({ dataDir, enabled: true,
    inbox: { list: () => ({ items: items.slice().reverse(), pagination: {} }) },
    resolveMatch: async () => ({ status: 'UNKNOWN' }), analyze: async () => ({ result: result() }),
    inspectConversation: async () => ({ humanTakeover: false }) });
  await intelligence.process({}, {});
  items.push(record('customer-after', 'Gracias, necesito Onda Serena', { at: '2026-11-05T12:02:00.000Z' }));
  await intelligence.process({}, {});
  const draft = intelligence.list({}).items[0].result;
  assert.equal(draft.humanInterventionRequired, true);
  assert.equal(draft.suggestedResponse, '');
});

test('reconciles a later manual WEBJS reply without changing the WAHA session', async t => {
  let observed = [];
  let analyzeCalls = 0;
  const env = setup([record('poll-incoming', 'Necesito información', { at: '2026-11-05T12:00:00.000Z' })], {
    analyze: async () => { analyzeCalls += 1; return { result: result() }; },
    inspectConversation: async () => ({ humanTakeover: false, messages: observed })
  });
  t.after(env.cleanup);
  await env.intelligence.process({}, {});
  observed = [{ id: 'manual-from-app', at: '2026-11-05T12:05:00.000Z', direction: 'OUTGOING',
    source: 'app', text: 'Hola, ya te ayudo con esto.' }];
  await env.intelligence.process({}, {});
  const memory = env.intelligence.memory({});
  assert.equal(analyzeCalls, 1);
  assert.equal(memory.conversations[0].messages.some(item => item.id === 'manual-from-app'), true);
  assert.equal(memory.conversations[0].humanTakeover, true);
});

test('a WAHA inspection failure is safe, auditable and retryable', async t => {
  const item = record('m16', '¿Me confirmas?');
  let inspectionFails = true;
  const env = setup([item], {
    inspectConversation: async () => {
      if (inspectionFails) throw Object.assign(new Error('WAHA unavailable'), { code: 'HUMAN_TAKEOVER_CHECK_UNAVAILABLE' });
      return { humanTakeover: false };
    }
  });
  t.after(env.cleanup);
  const failed = await env.intelligence.process({}, {});
  assert.equal(failed.processed, 0);
  assert.equal(failed.errors[0].code, 'HUMAN_TAKEOVER_CHECK_UNAVAILABLE');
  assert.equal(env.intelligence.list({}).items.length, 0);

  inspectionFails = false;
  const retried = await env.intelligence.process({}, {});
  assert.equal(retried.processed, 1);
  assert.equal(env.intelligence.list({}).items[0].audit.attempts, 2);
});

test('paginates the full inbox and processes the oldest backlog beyond 100 records', async t => {
  const chronological = Array.from({ length: 150 }, (_, index) => record(
    `backlog-${String(index + 1).padStart(3, '0')}`,
    `Mensaje ${index + 1}`,
    { at: new Date(Date.UTC(2026, 10, 5, 12, index)).toISOString() }
  ));
  const newest = chronological.slice().reverse();
  const dataDir = fs.mkdtempSync(path.join(__dirname, '.test-hommy-intelligence-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const analyzed = [];
  const intelligence = createIntelligence({
    dataDir, enabled: true,
    inbox: { list: ({ offset, limit }) => {
      const items = newest.slice(offset, offset + limit);
      return { items, pagination: { nextOffset: offset + items.length < newest.length ? offset + items.length : null } };
    } },
    resolveMatch: async () => ({ status: 'UNKNOWN' }),
    analyze: async input => { analyzed.push(input.record.id); return { result: result() }; }
  });
  const output = await intelligence.process({}, { limit: 2 });
  assert.equal(output.scanned, 150);
  assert.deepEqual(analyzed, ['backlog-001', 'backlog-002']);
});

test('persists customer memory, verified Meta origin and Onda Serena analysis across restart', async t => {
  const item = record('memory-restart', 'Soy Laura. Quiero Onda Serena para mi habitación de 2 m por 1.8 m', {
    commercialOrigin: { channel: 'WHATSAPP', campaign: 'META', platform: 'FACEBOOK', verified: true, sourceId: 'ad-9' }
  });
  const env = setup([item], { resolveMatch: async () => ({ status: 'MATCHED',
    client: { cedula: '55', name: 'Laura Gómez' }, quote: null }),
  analyze: async () => ({ result: result({ productInterest: 'Onda Serena',
    commercialSummary: 'Laura busca Onda Serena para una habitación.',
    memory: { providedName: 'Laura', environment: 'habitación', measurements: [{ width: 2, height: 1.8, unit: 'm' }],
      commitments: ['Enviar fotos'], importantDates: ['2026-11-10'] }
  }) }) });
  t.after(env.cleanup);
  const processed = await env.intelligence.process({}, {});
  assert.equal(processed.processed, 1);
  const restarted = createIntelligence({ dataDir: env.dataDir, enabled: true,
    inbox: { list: () => ({ items: [item], pagination: {} }) },
    resolveMatch: async () => ({ status: 'UNKNOWN' }), analyze: async () => ({ result: result() }) });
  const memory = restarted.memory({});
  assert.equal(memory.clients[0].name, 'Laura Gómez');
  assert.ok(memory.clients[0].products.includes('Onda Serena'));
  assert.equal(memory.clients[0].measurements[0].unit, 'm');
  assert.deepEqual(memory.clients[0].importantDates, ['2026-11-10']);
  assert.equal(memory.clients[0].commercialOrigins[0].sourceId, 'ad-9');
  assert.doesNotMatch(JSON.stringify(memory), /context-1|conversationToken/);
  const analysis = restarted.list({}).items[0];
  assert.equal(analysis.result.productInterest, 'Onda Serena');
  assert.equal(analysis.audit.sent, false);
  assert.equal(analysis.audit.agendaCreated, false);
});

test('reconciles legacy duplicate analyses without deleting original audit records', t => {
  const dataDir = fs.mkdtempSync(path.join(__dirname, '.test-hommy-intelligence-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const stateDir = path.join(dataDir, 'hommy-intelligence');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({ version: 1, processed: {}, conversations: {}, analyses: [
    { id: 'a1', sourceMessageId: 'duplicate-real', processedAt: '2026-11-05T12:00:00.000Z' },
    { id: 'a2', sourceMessageId: 'duplicate-real', processedAt: '2026-11-05T12:00:01.000Z' }
  ] }));
  const intelligence = createIntelligence({ dataDir, enabled: true,
    inbox: { list: () => ({ items: [], pagination: {} }) },
    resolveMatch: async () => ({ status: 'UNKNOWN' }), analyze: async () => ({ result: result() }) });
  const analyses = intelligence.list({}).items;
  assert.equal(analyses.length, 2);
  assert.equal(analyses.filter(item => item.reconciliation && item.reconciliation.status === 'DUPLICATE').length, 1);
  assert.equal(intelligence.status().reconciledDuplicates, 1);
});

test('rejects malformed AI output and records an auditable error', async t => {
  const env = setup([record('m13', 'Hola')], { analyze: async () => ({ result: 'no-json' }) });
  t.after(env.cleanup);
  const output = await env.intelligence.process({}, {});
  assert.equal(output.processed, 0);
  assert.equal(output.errors[0].code, 'HOMMY_INVALID_JSON');
  assert.equal(env.intelligence.list({}).items.length, 0);
});

test('blocks unverified prices, delivery promises and availability from drafts', async t => {
  const env = setup([record('m14', '¿Cuánto cuesta?')], {
    analyze: async () => ({ result: result({ suggestedResponse: 'Cuesta $500.000 y hay disponibilidad.' }) })
  });
  t.after(env.cleanup);
  await env.intelligence.process({}, {});
  const review = env.intelligence.list({}).items[0].result;
  assert.equal(review.humanInterventionRequired, true);
  assert.equal(review.nextAction, 'HUMAN_REVIEW');
  assert.equal(review.suggestedResponse, '');
});

test('server contract keeps processing protected, REVIEW-only and disabled by default', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const compose = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
  assert.match(server, /HOMMY_INTELLIGENCE_ENABLED \|\| 'false'/);
  assert.match(server, /\/api\/whatsapp\/intelligence\/process[\s\S]{0,220}authorize\(req, 'cotizaciones\.read'\)/);
  assert.match(server, /\/api\/whatsapp\/intelligence\/memory[\s\S]{0,180}authorize\(req, 'cotizaciones\.read'\)/);
  assert.match(server, /mode: 'REVIEW'/);
  assert.match(server, /if \(!fetched\.ok\)[\s\S]{0,180}HUMAN_TAKEOVER_CHECK_UNAVAILABLE/);
  assert.match(compose, /HOMMY_INTELLIGENCE_ENABLED: \$\{HOMMY_INTELLIGENCE_ENABLED:-false\}/);
  assert.doesNotMatch(server, /hommyIntelligence[\s\S]{0,80}sendText/);
});

test('deployment contract preserves the inbox and rolls intelligence.js back', () => {
  const updater = fs.readFileSync(path.join(__dirname, '..', 'update-bridge.sh'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'pentagrama-inventory-readonly-qa.yml'), 'utf8');
  assert.match(updater, /INBOX_ENABLED_AFTER.*!=.*INBOX_ENABLED_BEFORE/);
  assert.match(updater, /INBOX_COUNT_AFTER < INBOX_COUNT_BEFORE/);
  assert.match(updater, /INBOX_PREFIX_SHA_AFTER.*!=.*INBOX_PREFIX_SHA_BEFORE/);
  assert.match(updater, /BRIDGE_FILES=\(server\.js auth\.js operations\.js conversation\.js inbox\.js intelligence\.js/);
  assert.doesNotMatch(updater, /inbox\.enabled[^\n]+!= "false"/);
  assert.match(workflow, /BRIDGE_VERSION = '\\d\+\\\.\\d\+\\\.\\d\+'/);
  assert.doesNotMatch(workflow, /BRIDGE_VERSION = '0\.19\.2'/);
});
