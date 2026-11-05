'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const conversation = require('./conversation');

const STATE_VERSION = 2;
const DISABLED_FILE = 'disabled';
const INTENTS = new Set([
  'INFORMATION_REQUEST', 'PRODUCT_QUESTION', 'VISIT_REQUEST', 'QUOTE_REQUEST',
  'NEGOTIATION', 'COMPLAINT', 'DO_NOT_CONTACT', 'OTHER'
]);
const TEMPERATURES = new Set(['HIGH', 'ACTIVE', 'WAITING', 'RISK', 'COLD']);
const ACTIONS = new Set([
  'PREPARE_RESPONSE', 'COLLECT_VISIT_DETAILS', 'REQUEST_QUOTE_DETAILS',
  'HUMAN_REVIEW', 'STOP_CONTACT', 'WAIT'
]);
const RESPONSE_STYLE = Object.freeze({
  locale: 'es-CO', mode: 'REVIEW', greetNewConversation: true,
  tone: 'cercano, paciente, amable y profesional', shortNaturalSentences: true,
  occasionalEmoji: true, neverImpersonateHuman: true, neverRepeatKnownQuestions: true
});

function clean(value, maxLength) {
  return conversation.clean(value, maxLength || 1000);
}

function emptyState() {
  return { version: STATE_VERSION, processed: {}, analyses: [], conversations: {},
    clients: {}, opportunities: {}, identityIndex: {} };
}

function readState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && [1, STATE_VERSION].includes(parsed.version) ? {
      version: STATE_VERSION,
      processed: parsed.processed && typeof parsed.processed === 'object' ? parsed.processed : {},
      analyses: Array.isArray(parsed.analyses) ? parsed.analyses : [],
      conversations: parsed.conversations && typeof parsed.conversations === 'object' ? parsed.conversations : {},
      clients: parsed.clients && typeof parsed.clients === 'object' ? parsed.clients : {},
      opportunities: parsed.opportunities && typeof parsed.opportunities === 'object' ? parsed.opportunities : {},
      identityIndex: parsed.identityIndex && typeof parsed.identityIndex === 'object' ? parsed.identityIndex : {}
    } : emptyState();
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw error;
  }
}

function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function parseJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch (_) {
    throw Object.assign(new Error('Hommy returned invalid JSON'), { code: 'HOMMY_INVALID_JSON' });
  }
}

function stringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.map(item => clean(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function measurements(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const source = item && typeof item === 'object' ? item : {};
    const width = Number(source.width);
    const height = Number(source.height);
    const unit = clean(source.unit, 12).toLowerCase();
    if ((!Number.isFinite(width) && !Number.isFinite(height)) || !['mm', 'cm', 'm'].includes(unit)) return null;
    return { label: clean(source.label, 120) || null,
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null, unit };
  }).filter(Boolean).slice(0, 20);
}

function memoryFields(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    providedName: clean(source.providedName, 180) || null,
    environment: clean(source.environment, 180) || null,
    measurements: measurements(source.measurements),
    privacyRequirements: stringArray(source.privacyRequirements, 10, 240),
    lightingRequirements: stringArray(source.lightingRequirements, 10, 240),
    commitments: stringArray(source.commitments, 12, 300),
    importantDates: stringArray(source.importantDates, 12, 120),
    pendingQuestions: stringArray(source.pendingQuestions, 12, 300)
  };
}

function validateResult(raw) {
  const source = parseJson(raw);
  const intent = clean(source.intent, 50).toUpperCase();
  const temperature = clean(source.temperature, 30).toUpperCase();
  const nextAction = clean(source.nextAction, 50).toUpperCase();
  if (!INTENTS.has(intent)) throw Object.assign(new Error('Invalid Hommy intent'), { code: 'HOMMY_SCHEMA_INVALID' });
  if (!TEMPERATURES.has(temperature)) throw Object.assign(new Error('Invalid Hommy temperature'), { code: 'HOMMY_SCHEMA_INVALID' });
  if (!ACTIONS.has(nextAction)) throw Object.assign(new Error('Invalid Hommy next action'), { code: 'HOMMY_SCHEMA_INVALID' });
  const confidence = Number(source.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw Object.assign(new Error('Invalid Hommy confidence'), { code: 'HOMMY_SCHEMA_INVALID' });
  }
  const result = {
    mode: 'REVIEW',
    intent,
    secondaryIntents: stringArray(source.secondaryIntents, 5, 50).map(item => item.toUpperCase()).filter(item => INTENTS.has(item)),
    productInterest: clean(source.productInterest, 180) || null,
    commercialSummary: clean(source.commercialSummary, 1200),
    pendingInformation: stringArray(source.pendingInformation, 12, 240),
    temperature,
    humanInterventionRequired: source.humanInterventionRequired === true,
    suggestedResponse: clean(source.suggestedResponse, 1800),
    nextAction,
    reason: clean(source.reason, 800),
    confidence,
    memory: memoryFields(source.memory)
  };
  if (!result.commercialSummary || !result.reason) {
    throw Object.assign(new Error('Incomplete Hommy result'), { code: 'HOMMY_SCHEMA_INVALID' });
  }
  return result;
}

function normalizeText(value) {
  return clean(value, 4000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function applyGuardrails(result, record, inspection) {
  const text = normalizeText(record && record.text);
  const stop = /\b(no me (?:escriban|contacten)|no (?:escriban|contacten) mas|dejen de (?:escribirme|contactarme)|stop|cancelar suscripcion|dar de baja)\b/i.test(text);
  const complaint = /\b(reclamo|reclamacion|queja|garantia|incumpl|danad[oa]|pesim[oa]|mal servicio)\b/i.test(text);
  const negotiation = /\b(descuento|rebaja|negociar|mejor precio|precio final)\b/i.test(text);
  const visit = /\b(visita|medicion|medir|agendar|cita)\b/i.test(text);
  const quote = /\b(cotiz|presupuesto|cuanto (?:cuesta|vale)|precio)\b/i.test(text);
  const productQuestion = /\b(informacion|como funciona|caracteristicas|material|producto)\b/i.test(text);
  const explicitProduct = /\bonda serena\b/i.test(text) ? 'Onda Serena' : result.productInterest;
  const manual = inspection && inspection.humanTakeover === true;
  const unverifiedCommitment = /(?:visita|cita) (?:esta |queda )?confirmad|hay disponibilidad|entrega (?:en|para) \d|(?:cuesta|vale) \$?[\d.,]+|descuento (?:de|del) \d/i
    .test(normalizeText(result && result.suggestedResponse));

  if (stop) {
    return { ...result, intent: 'DO_NOT_CONTACT', secondaryIntents: [], temperature: 'COLD',
      humanInterventionRequired: false, suggestedResponse: '', nextAction: 'STOP_CONTACT',
      reason: 'La persona pidió expresamente no recibir más contacto.' };
  }
  if (manual) {
    return { ...result, humanInterventionRequired: true, suggestedResponse: '', nextAction: 'HUMAN_REVIEW',
      reason: `${result.reason} Se detectó intervención humana en la conversación.`.trim() };
  }
  if (complaint) {
    return { ...result, intent: 'COMPLAINT', temperature: 'RISK', humanInterventionRequired: true,
      nextAction: 'HUMAN_REVIEW' };
  }
  if (negotiation) {
    return { ...result, intent: 'NEGOTIATION', humanInterventionRequired: true, nextAction: 'HUMAN_REVIEW' };
  }
  if (visit) {
    const pending = new Set(result.pendingInformation);
    ['Nombre', 'Dirección o barrio', 'Horarios preferidos'].forEach(item => pending.add(item));
    const product = explicitProduct ? ` sobre ${explicitProduct}` : '';
    return {
      ...result, productInterest: explicitProduct,
      intent: 'VISIT_REQUEST',
      secondaryIntents: Array.from(new Set([...result.secondaryIntents, 'INFORMATION_REQUEST', ...(quote ? ['QUOTE_REQUEST'] : [])])),
      pendingInformation: Array.from(pending).slice(0, 12),
      suggestedResponse: `¡Hola! Claro, con gusto te ayudamos${product} y preparamos la solicitud de visita. ¿Nos compartes tu nombre, dirección o barrio, y los horarios que te sirven? La visita queda pendiente de confirmar según disponibilidad.`,
      nextAction: result.humanInterventionRequired ? 'HUMAN_REVIEW' : 'COLLECT_VISIT_DETAILS',
      reason: `${result.reason} La visita queda pendiente de consultar y confirmar según disponibilidad real.`.trim()
    };
  }
  if (unverifiedCommitment) {
    return { ...result, humanInterventionRequired: true, suggestedResponse: '', nextAction: 'HUMAN_REVIEW',
      reason: `${result.reason} El borrador contenía una condición comercial o disponibilidad no verificada.`.trim() };
  }
  if (quote) {
    return { ...result, productInterest: explicitProduct, intent: 'QUOTE_REQUEST',
      nextAction: result.humanInterventionRequired ? 'HUMAN_REVIEW' : 'REQUEST_QUOTE_DETAILS' };
  }
  if (productQuestion) return { ...result, productInterest: explicitProduct, intent: 'PRODUCT_QUESTION' };
  return result;
}

function applyResponseStyle(result, context) {
  const source = context && typeof context === 'object' ? context : {};
  if (!result.suggestedResponse || result.nextAction === 'STOP_CONTACT' || result.humanInterventionRequired) return result;
  if (source.isNewConversation && !/^[¡¿]?\s*(hola|buenos d[ií]as|buenas)/i.test(result.suggestedResponse)) {
    return { ...result, suggestedResponse: `Hola, cómo estás? 😊\n\n${result.suggestedResponse}` };
  }
  return result;
}

function resolveAssociation(rows, record) {
  const phone = conversation.phoneDigits(record && record.phone);
  if (!phone) return { status: 'UNKNOWN', reason: 'El LID no tiene un teléfono resuelto.' };
  const matches = (Array.isArray(rows) ? rows : []).filter(row => conversation.phoneDigits(
    row && (row.telefono || row.phone || row.cliente && row.cliente.telefono)
  ) === phone);
  if (!matches.length) return { status: 'UNKNOWN', reason: 'No existe una coincidencia por teléfono.' };
  const identities = new Map();
  for (const row of matches) {
    const cedula = clean(row.cedula || row.cliente && row.cliente.cedula || '', 80);
    const name = clean(row.nombre || row.cliente && row.cliente.nombre || '', 180);
    if (cedula || name) identities.set(`${cedula}|${name}`.toLowerCase(), { cedula, name });
  }
  if (!identities.size) return { status: 'UNKNOWN', reason: 'El teléfono coincide, pero el cliente no puede resolverse.' };
  if (identities.size > 1) return { status: 'AMBIGUOUS', reason: 'El teléfono coincide con más de un cliente.' };
  const quoteNumbers = Array.from(new Set(matches.map(row => clean(
    row.numero || row.reference || row.cotizacion && row.cotizacion.numero || '', 80
  )).filter(Boolean)));
  return {
    status: 'MATCHED', client: Array.from(identities.values())[0],
    quote: quoteNumbers.length === 1 ? { number: quoteNumbers[0] } : null,
    reason: quoteNumbers.length === 1 ? 'Coincidencia inequívoca por teléfono.' : 'Cliente inequívoco; cotización no inequívoca.'
  };
}

function publicAssociation(match) {
  const source = match && typeof match === 'object' ? match : {};
  const status = ['MATCHED', 'UNKNOWN', 'AMBIGUOUS'].includes(source.status) ? source.status : 'UNKNOWN';
  return {
    status,
    client: status === 'MATCHED' && source.client ? {
      cedula: clean(source.client.cedula, 80), name: clean(source.client.name, 180)
    } : null,
    quote: status === 'MATCHED' && source.quote ? { number: clean(source.quote.number, 80) } : null,
    reason: clean(source.reason, 300) || null
  };
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20)}`;
}

function uniqueStrings(existing, incoming, maxItems, maxLength) {
  const values = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
    .map(item => clean(item, maxLength)).filter(Boolean);
  return Array.from(new Map(values.map(item => [normalizeText(item), item])).values()).slice(-maxItems);
}

function identityKeys(record) {
  const source = record && typeof record === 'object' ? record : {};
  const phone = conversation.phoneDigits(source.phone);
  const phoneFromChat = /@(?:c\.us|s\.whatsapp\.net)$/i.test(String(source.chatId || ''));
  const verifiedPhone = phone && (source.phoneVerified === true || phoneFromChat) ? `phone:${phone}` : '';
  const lid = clean(source.lid || /@lid$/i.test(String(source.chatId || '')) && source.chatId || '', 200).toLowerCase();
  return { primary: verifiedPhone || (lid ? `lid:${lid}` : `chat:${clean(source.chatId, 200).toLowerCase()}`),
    phoneKey: verifiedPhone, lidKey: lid ? `lid:${lid}` : '' };
}

function ensureClient(state, record, match) {
  const keys = identityKeys(record);
  const knownIds = [keys.phoneKey, keys.lidKey, keys.primary].map(key => key && state.identityIndex[key]).filter(Boolean);
  const clientId = knownIds[0] || stableId('client', keys.primary);
  const now = new Date().toISOString();
  const client = state.clients[clientId] || {
    id: clientId, provisional: !keys.phoneKey, name: null, phones: [], lids: [],
    products: [], environments: [], measurements: [], privacyRequirements: [], lightingRequirements: [],
    quoteNumbers: [], commitments: [], importantDates: [], pendingQuestions: [], commercialOrigins: [],
    lastHumanInterventionAt: null, conversationSummary: '', identityConflicts: [], createdAt: now, updatedAt: now
  };
  if (keys.phoneKey) {
    const owner = state.identityIndex[keys.phoneKey];
    if (!owner || owner === clientId) {
      client.provisional = false;
      client.phones = uniqueStrings(client.phones, [keys.phoneKey.slice(6)], 10, 20);
      state.identityIndex[keys.phoneKey] = clientId;
    } else client.identityConflicts = uniqueStrings(client.identityConflicts, [keys.phoneKey], 20, 220);
  }
  if (keys.lidKey) {
    const owner = state.identityIndex[keys.lidKey];
    if (!owner || owner === clientId) {
      client.lids = uniqueStrings(client.lids, [keys.lidKey.slice(4)], 10, 200);
      state.identityIndex[keys.lidKey] = clientId;
    } else client.identityConflicts = uniqueStrings(client.identityConflicts, [keys.lidKey], 20, 220);
  }
  if (!state.identityIndex[keys.primary]) state.identityIndex[keys.primary] = clientId;
  if (match && match.status === 'MATCHED' && match.client && match.client.name) client.name = clean(match.client.name, 180);
  client.updatedAt = now;
  state.clients[clientId] = client;
  return client;
}

function appendConversationMessage(state, record, client) {
  const chatId = clean(record.chatId, 200);
  const memory = state.conversations[chatId] || {
    id: stableId('conversation', chatId), chatId, clientId: client.id, messages: [],
    conversationToken: null, summary: '', humanTakeover: false, lastHumanInterventionAt: null,
    createdAt: record.at || new Date().toISOString()
  };
  const message = { id: clean(record.id, 260), at: record.at || null,
    direction: record.direction === 'OUTGOING' ? 'OUTGOING' : 'INCOMING',
    senderKind: clean(record.senderKind || (record.direction === 'OUTGOING' ? 'OUTGOING_UNKNOWN' : 'CUSTOMER'), 40),
    text: clean(record.text, 4000) };
  if (!memory.messages.some(item => item.id === message.id)) memory.messages.push(message);
  memory.messages = memory.messages.slice(-80);
  memory.clientId = client.id;
  memory.updatedAt = new Date().toISOString();
  if (message.direction === 'OUTGOING' && message.senderKind !== 'SYSTEM') {
    memory.humanTakeover = true;
    memory.lastHumanInterventionAt = message.at || memory.updatedAt;
    client.lastHumanInterventionAt = memory.lastHumanInterventionAt;
  }
  state.conversations[chatId] = memory;
  return memory;
}

function updateCommercialMemory(state, client, memory, record, result, match) {
  const extracted = result.memory || memoryFields({});
  const providedName = extracted.providedName && normalizeText(record.text).includes(normalizeText(extracted.providedName))
    ? extracted.providedName : null;
  if (!client.name && providedName) client.name = providedName;
  client.products = uniqueStrings(client.products, result.productInterest ? [result.productInterest] : [], 30, 180);
  client.environments = uniqueStrings(client.environments, extracted.environment ? [extracted.environment] : [], 20, 180);
  const knownMeasurements = [...client.measurements, ...extracted.measurements];
  client.measurements = Array.from(new Map(knownMeasurements.map(item => [JSON.stringify(item), item])).values()).slice(-30);
  client.privacyRequirements = uniqueStrings(client.privacyRequirements, extracted.privacyRequirements, 20, 240);
  client.lightingRequirements = uniqueStrings(client.lightingRequirements, extracted.lightingRequirements, 20, 240);
  client.commitments = uniqueStrings(client.commitments, extracted.commitments, 30, 300);
  client.importantDates = uniqueStrings(client.importantDates, extracted.importantDates, 30, 120);
  client.pendingQuestions = uniqueStrings(client.pendingQuestions, [...extracted.pendingQuestions, ...result.pendingInformation], 30, 300);
  if (match.quote && match.quote.number) client.quoteNumbers = uniqueStrings(client.quoteNumbers, [match.quote.number], 30, 80);
  const origin = record.commercialOrigin;
  if (origin && origin.verified === true) {
    const origins = [...client.commercialOrigins, origin];
    client.commercialOrigins = Array.from(new Map(origins.map(item => [JSON.stringify(item), item])).values()).slice(-20);
  }
  client.conversationSummary = result.commercialSummary;
  memory.summary = result.commercialSummary;

  const opportunityKey = normalizeText(result.productInterest || 'general').replace(/[^a-z0-9]+/g, '-');
  const opportunityId = stableId('opportunity', `${client.id}:${opportunityKey}`);
  const opportunity = state.opportunities[opportunityId] || {
    id: opportunityId, clientId: client.id, product: result.productInterest || null,
    environments: [], measurements: [], quoteNumbers: [], commitments: [], importantDates: [], pendingQuestions: [],
    status: 'OPEN', createdAt: new Date().toISOString()
  };
  opportunity.product = opportunity.product || result.productInterest || null;
  opportunity.environments = uniqueStrings(opportunity.environments, extracted.environment ? [extracted.environment] : [], 20, 180);
  opportunity.measurements = Array.from(new Map([...opportunity.measurements, ...extracted.measurements]
    .map(item => [JSON.stringify(item), item])).values()).slice(-30);
  opportunity.quoteNumbers = uniqueStrings(opportunity.quoteNumbers, match.quote ? [match.quote.number] : [], 20, 80);
  opportunity.commitments = uniqueStrings(opportunity.commitments, extracted.commitments, 20, 300);
  opportunity.importantDates = uniqueStrings(opportunity.importantDates, extracted.importantDates, 20, 120);
  opportunity.pendingQuestions = uniqueStrings(opportunity.pendingQuestions, [...extracted.pendingQuestions, ...result.pendingInformation], 30, 300);
  opportunity.summary = result.commercialSummary;
  opportunity.nextAction = result.nextAction;
  opportunity.updatedAt = new Date().toISOString();
  state.opportunities[opportunityId] = opportunity;
  client.updatedAt = opportunity.updatedAt;
  return opportunity;
}

function mergeObservedOutgoing(state, conversationMemory, client, messages) {
  let added = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || message.direction !== 'OUTGOING' || !message.id) continue;
    const existed = conversationMemory.messages.some(item => item.id === message.id);
    appendConversationMessage(state, {
      id: message.id, chatId: conversationMemory.chatId, at: message.at,
      direction: 'OUTGOING', senderKind: String(message.source || '').toLowerCase() === 'api' ? 'SYSTEM' : 'HUMAN',
      source: message.source, text: message.text
    }, client);
    if (!existed) added += 1;
  }
  return added;
}

function reconcileAnalyses(state) {
  const canonical = new Map();
  let reconciled = 0;
  for (const analysis of state.analyses) {
    const messageId = clean(analysis && analysis.sourceMessageId, 260);
    if (!messageId) continue;
    if (!canonical.has(messageId)) {
      canonical.set(messageId, analysis.id);
      continue;
    }
    if (!analysis.reconciliation || analysis.reconciliation.status !== 'DUPLICATE') {
      analysis.reconciliation = { status: 'DUPLICATE', canonicalAnalysisId: canonical.get(messageId),
        reconciledAt: new Date().toISOString() };
      reconciled += 1;
    }
  }
  return reconciled;
}

function createIntelligence(options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!opts.inbox || typeof opts.inbox.list !== 'function') throw new Error('Inbox dependency is required');
  if (typeof opts.resolveMatch !== 'function' || typeof opts.analyze !== 'function') throw new Error('Intelligence dependencies are required');
  const dataDir = path.resolve(String(opts.dataDir || '/app/data'), 'hommy-intelligence');
  const stateFile = path.join(dataDir, 'state.json');
  const disabledFile = path.join(dataDir, DISABLED_FILE);
  const configured = opts.enabled === true;
  const maxAnalyses = Math.max(100, Math.min(5000, Number(opts.maxAnalyses || 1000)));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const state = readState(stateFile);
  const reconciledAtStartup = reconcileAnalyses(state);
  if (reconciledAtStartup) atomicWrite(stateFile, state);
  let processQueue = Promise.resolve();

  function enabled() { return configured && !fs.existsSync(disabledFile); }
  function save() {
    state.analyses = state.analyses.slice(-maxAnalyses);
    atomicWrite(stateFile, state);
  }
  function status() {
    const processed = Object.values(state.processed);
    return { configured, enabled: enabled(), killSwitch: fs.existsSync(disabledFile),
      analyses: state.analyses.length, completed: processed.filter(item => item.status === 'DONE').length,
      errors: processed.filter(item => item.status === 'ERROR').length,
      clients: Object.keys(state.clients).length, opportunities: Object.keys(state.opportunities).length,
      reconciledDuplicates: state.analyses.filter(item => item.reconciliation && item.reconciliation.status === 'DUPLICATE').length };
  }
  function disable() {
    fs.writeFileSync(disabledFile, `${new Date().toISOString()}\n`, { encoding: 'utf8', mode: 0o600 });
    return status();
  }
  function enable() {
    if (fs.existsSync(disabledFile)) fs.unlinkSync(disabledFile);
    return status();
  }
  function list(query) {
    const source = query && typeof query === 'object' ? query : {};
    const limit = Math.max(1, Math.min(100, Number(source.limit || 50) || 50));
    const offset = Math.max(0, Number(source.offset || 0) || 0);
    const items = state.analyses.slice().reverse().slice(offset, offset + limit);
    return { items, pagination: { offset, limit, total: state.analyses.length,
      nextOffset: offset + items.length < state.analyses.length ? offset + items.length : null } };
  }

  function memory(query) {
    const source = query && typeof query === 'object' ? query : {};
    const limit = Math.max(1, Math.min(100, Number(source.limit || 50) || 50));
    const offset = Math.max(0, Number(source.offset || 0) || 0);
    const allClients = Object.values(state.clients).sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    const clients = allClients.slice(offset, offset + limit);
    const ids = new Set(clients.map(item => item.id));
    const conversations = Object.values(state.conversations).filter(item => ids.has(item.clientId)).map(item => ({
      id: item.id, chatId: item.chatId, clientId: item.clientId, messages: item.messages,
      summary: item.summary || '', humanTakeover: item.humanTakeover === true,
      lastHumanInterventionAt: item.lastHumanInterventionAt || null, updatedAt: item.updatedAt || null
    }));
    const opportunities = Object.values(state.opportunities).filter(item => ids.has(item.clientId));
    return { clients, conversations, opportunities, pagination: { offset, limit, total: allClients.length,
      nextOffset: offset + clients.length < allClients.length ? offset + clients.length : null } };
  }

  async function processUnlocked(requestContext, processOptions) {
    if (!enabled()) return { ok: true, skipped: true, reason: 'DISABLED', intelligence: status() };
    const max = Math.max(1, Math.min(50, Number(processOptions && processOptions.limit || 20) || 20));
    const candidatesNewestFirst = [];
    let offset = 0;
    let scanned = 0;
    let completed = 0;
    while (offset !== null) {
      const page = opts.inbox.list({ offset, limit: 100 });
      const items = page && Array.isArray(page.items) ? page.items : [];
      for (const item of items) {
        scanned += 1;
        const current = state.processed[String(item && item.id || '')];
        if (current && current.status === 'DONE') {
          completed += 1;
          continue;
        }
        candidatesNewestFirst.push(item);
        if (candidatesNewestFirst.length > max) candidatesNewestFirst.shift();
      }
      const next = page && page.pagination ? page.pagination.nextOffset : null;
      offset = Number.isInteger(next) && next > offset ? next : null;
    }
    const candidates = candidatesNewestFirst.reverse();
    const outcome = { ok: true, processed: 0, duplicates: completed, scanned, errors: [] };
    const candidateChats = new Set(candidates.map(item => clean(item && item.chatId, 200)));
    if (typeof opts.inspectConversation === 'function') {
      const storedConversations = Object.values(state.conversations)
        .filter(item => item && item.chatId && !candidateChats.has(item.chatId))
        .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)).slice(0, 20);
      for (const stored of storedConversations) {
        const client = state.clients[stored.clientId];
        if (!client) continue;
        const last = stored.messages.length ? stored.messages[stored.messages.length - 1] : {};
        try {
          const inspection = await opts.inspectConversation({ chatId: stored.chatId, at: last.at || stored.updatedAt }, requestContext);
          mergeObservedOutgoing(state, stored, client, inspection && inspection.messages);
        } catch (error) {
          outcome.errors.push({ conversationId: stored.id,
            code: clean(error && error.code || 'HUMAN_TAKEOVER_CHECK_UNAVAILABLE', 80) });
        }
      }
      save();
    }

    for (const record of candidates) {
      const id = clean(record.id, 260);
      const chatId = clean(record.chatId, 200);
      const existingAnalysis = state.analyses.find(item => item.sourceMessageId === id &&
        !(item.reconciliation && item.reconciliation.status === 'DUPLICATE'));
      if (existingAnalysis) {
        state.processed[id] = { status: 'DONE', attempts: Number(state.processed[id] && state.processed[id].attempts || 1),
          analysisId: existingAnalysis.id, updatedAt: new Date().toISOString(), reconciled: true };
        completed += 1;
        save();
        continue;
      }
      const previous = state.processed[id] || {};
      state.processed[id] = { status: 'PROCESSING', attempts: Number(previous.attempts || 0) + 1,
        updatedAt: new Date().toISOString() };
      save();
      try {
        const match = publicAssociation(await opts.resolveMatch(record, requestContext));
        const client = ensureClient(state, record, match);
        const conversationMemory = appendConversationMessage(state, record, client);
        if (record.direction === 'OUTGOING') {
          state.processed[id] = { status: 'DONE', attempts: state.processed[id].attempts,
            memoryOnly: true, updatedAt: new Date().toISOString() };
          outcome.processed += 1;
          save();
          continue;
        }
        const inspection = typeof opts.inspectConversation === 'function'
          ? await opts.inspectConversation(record, requestContext) : { humanTakeover: false };
        mergeObservedOutgoing(state, conversationMemory, client, inspection && inspection.messages);
        const humanTakeover = conversationMemory.humanTakeover === true || inspection.humanTakeover === true;
        const contextMessages = conversationMemory.messages.slice(-12);
        const clientOpportunities = Object.values(state.opportunities).filter(item => item.clientId === client.id);
        const analyzed = await opts.analyze({ record, match, messages: contextMessages,
          client, opportunities: clientOpportunities, responseStyle: RESPONSE_STYLE,
          conversationToken: conversationMemory.conversationToken || null }, requestContext);
        const incomingCount = conversationMemory.messages.filter(item => item.direction === 'INCOMING').length;
        const guarded = applyResponseStyle(
          applyGuardrails(validateResult(analyzed.result), record, { humanTakeover }),
          { isNewConversation: incomingCount === 1 }
        );
        const opportunity = updateCommercialMemory(state, client, conversationMemory, record, guarded, match);
        const analysisId = crypto.createHash('sha256').update(id).digest('hex').slice(0, 24);
        const analysis = {
          id: analysisId, sourceMessageId: id, chatId, at: record.at || null,
          processedAt: new Date().toISOString(), clientId: client.id, opportunityId: opportunity.id,
          association: match, result: guarded,
          audit: { mode: 'REVIEW', sent: false, agendaCreated: false,
            actor: requestContext && requestContext.actor ? requestContext.actor : null,
            humanTakeover, attempts: state.processed[id].attempts }
        };
        if (!state.analyses.some(item => item.sourceMessageId === id &&
          !(item.reconciliation && item.reconciliation.status === 'DUPLICATE'))) state.analyses.push(analysis);
        conversationMemory.conversationToken = clean(analyzed.conversationToken, 2000) || conversationMemory.conversationToken || null;
        conversationMemory.lastAnalysisId = analysisId;
        conversationMemory.humanTakeover = humanTakeover;
        if (humanTakeover && !conversationMemory.lastHumanInterventionAt) {
          conversationMemory.lastHumanInterventionAt = new Date().toISOString();
          client.lastHumanInterventionAt = conversationMemory.lastHumanInterventionAt;
        }
        conversationMemory.updatedAt = new Date().toISOString();
        state.processed[id] = { status: 'DONE', attempts: state.processed[id].attempts,
          analysisId, updatedAt: new Date().toISOString() };
        outcome.processed += 1;
      } catch (error) {
        state.processed[id] = { status: 'ERROR', attempts: state.processed[id].attempts,
          code: clean(error && error.code || 'PROCESSING_ERROR', 80),
          error: clean(error && error.message || 'Processing failed', 300), updatedAt: new Date().toISOString() };
        outcome.errors.push({ sourceMessageId: id, code: state.processed[id].code });
      }
      save();
    }
    return { ...outcome, intelligence: status() };
  }

  function process(requestContext, processOptions) {
    const task = processQueue.then(() => processUnlocked(requestContext, processOptions));
    processQueue = task.catch(() => undefined);
    return task;
  }

  return Object.freeze({ process, list, memory, status, disable, enable });
}

module.exports = Object.freeze({ createIntelligence, validateResult, applyGuardrails, resolveAssociation, RESPONSE_STYLE });
