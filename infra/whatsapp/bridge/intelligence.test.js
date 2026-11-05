'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createIntelligence, resolveAssociation } = require('./intelligence');

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
  assert.match(server, /mode: 'REVIEW'/);
  assert.match(compose, /HOMMY_INTELLIGENCE_ENABLED: \$\{HOMMY_INTELLIGENCE_ENABLED:-false\}/);
  assert.doesNotMatch(server, /hommyIntelligence[\s\S]{0,80}sendText/);
});
