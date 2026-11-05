'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const conversation = require('./conversation');

const STATE_VERSION = 1;
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

function clean(value, maxLength) {
  return conversation.clean(value, maxLength || 1000);
}

function emptyState() {
  return { version: STATE_VERSION, processed: {}, analyses: [], conversations: {} };
}

function readState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && parsed.version === STATE_VERSION ? {
      version: STATE_VERSION,
      processed: parsed.processed && typeof parsed.processed === 'object' ? parsed.processed : {},
      analyses: Array.isArray(parsed.analyses) ? parsed.analyses : [],
      conversations: parsed.conversations && typeof parsed.conversations === 'object' ? parsed.conversations : {}
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
    confidence
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

  function enabled() { return configured && !fs.existsSync(disabledFile); }
  function save() {
    state.analyses = state.analyses.slice(-maxAnalyses);
    atomicWrite(stateFile, state);
  }
  function status() {
    const processed = Object.values(state.processed);
    return { configured, enabled: enabled(), killSwitch: fs.existsSync(disabledFile),
      analyses: state.analyses.length, completed: processed.filter(item => item.status === 'DONE').length,
      errors: processed.filter(item => item.status === 'ERROR').length };
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

  async function process(requestContext, processOptions) {
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

    for (const record of candidates) {
      const id = clean(record.id, 260);
      const chatId = clean(record.chatId, 200);
      const previous = state.processed[id] || {};
      state.processed[id] = { status: 'PROCESSING', attempts: Number(previous.attempts || 0) + 1,
        updatedAt: new Date().toISOString() };
      save();
      try {
        const memory = state.conversations[chatId] || { messages: [], conversationToken: null };
        const match = publicAssociation(await opts.resolveMatch(record, requestContext));
        const inspection = typeof opts.inspectConversation === 'function'
          ? await opts.inspectConversation(record, requestContext) : { humanTakeover: false };
        const contextMessages = [...memory.messages, { id, at: record.at, direction: 'INCOMING', text: clean(record.text, 4000) }]
          .filter((item, index, all) => item.id && all.findIndex(other => other.id === item.id) === index).slice(-12);
        const analyzed = await opts.analyze({ record, match, messages: contextMessages,
          conversationToken: memory.conversationToken || null }, requestContext);
        const guarded = applyGuardrails(validateResult(analyzed.result), record, inspection);
        const analysisId = crypto.createHash('sha256').update(id).digest('hex').slice(0, 24);
        const analysis = {
          id: analysisId, sourceMessageId: id, chatId, at: record.at || null,
          processedAt: new Date().toISOString(), association: match, result: guarded,
          audit: { mode: 'REVIEW', sent: false, agendaCreated: false,
            actor: requestContext && requestContext.actor ? requestContext.actor : null,
            humanTakeover: Boolean(inspection && inspection.humanTakeover), attempts: state.processed[id].attempts }
        };
        state.analyses.push(analysis);
        state.conversations[chatId] = {
          messages: contextMessages,
          conversationToken: clean(analyzed.conversationToken, 2000) || memory.conversationToken || null,
          lastAnalysisId: analysisId,
          humanTakeover: Boolean(inspection && inspection.humanTakeover),
          updatedAt: new Date().toISOString()
        };
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

  return Object.freeze({ process, list, status, disable, enable });
}

module.exports = Object.freeze({ createIntelligence, validateResult, applyGuardrails, resolveAssociation });
