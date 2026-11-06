'use strict';

// Optional service-to-service conversational adapter. No WAHA access, no writes,
// no personal HomeEasy session, and no customer contact capability.
const fs = require('fs');
const path = require('path');

const MAX_MEMORY_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 12 * 1024;
const MAX_REPLY = 480;
const PRODUCTS = Object.freeze([
  'Onda Serena', 'Sheer Elegance', 'Sheer Vertesse', 'Panel Japonés', 'Blackout'
]);
const NEXT_ACTIONS = new Set([
  'PREPARE_RESPONSE', 'COLLECT_VISIT_DETAILS', 'REQUEST_QUOTE_DETAILS',
  'HUMAN_REVIEW', 'STOP_CONTACT', 'WAIT'
]);
const ROOM_NAMES = new Map([
  ['sala','sala'],['comedor','comedor'],['sala comedor','sala comedor'],
  ['habitacion','habitación'],['habitacion principal','habitación principal'],
  ['alcoba','alcoba'],['oficina','oficina'],['estudio','estudio'],
  ['balcon','balcón'],['cocina','cocina'],['terraza','terraza'],['patio','patio']
]);
const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .trim().toLowerCase().replace(/\s+/g,' ');
const limited = (s,n) => String(s || '').trim().slice(0,n);

function readFacts(root, taskCount = 0) {
  const facts = { source: 'ANALYZED_MEMORY_ONLY', available: false,
    manualPending: Math.max(0, Math.min(250, Number(taskCount) || 0)),
    knownClients: null, openOpportunities: null, opportunities: [], truncated: false,
    caveats: ['La memoria analizada no es la lista completa de chats, ventas ni agenda de visitas.'] };
  try {
    const file = path.join(path.resolve(String(root)), 'hommy-intelligence', 'state-v2.json');
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_MEMORY_BYTES) return facts;
    const data = JSON.parse(fs.readFileSync(file,'utf8'));
    if (!data || data.version !== 2 || !data.clients || !data.opportunities ||
        Array.isArray(data.clients) || Array.isArray(data.opportunities)) return facts;
    const open = Object.values(data.opportunities).filter(o => o && o.status === 'OPEN');
    facts.available = true;
    facts.knownClients = Object.keys(data.clients).length;
    facts.openOpportunities = open.length;
    facts.truncated = open.length > 15;
    for (const op of open.slice(-15)) {
      const product = PRODUCTS.find(x => normalize(x) === normalize(op.product)) || null;
      const rooms = Array.isArray(op.environments) ?
        op.environments.map(x => ROOM_NAMES.get(normalize(x))).filter(Boolean).slice(0,2) : [];
      facts.opportunities.push({
        product, rooms,
        nextAction: NEXT_ACTIONS.has(op.nextAction) ? op.nextAction : null,
        hasQuoteReference: Array.isArray(op.quoteNumbers) && op.quoteNumbers.some(Boolean),
        // No IDs, customer names, phone numbers, raw history or free-text memory.
      });
    }
    return facts;
  } catch (_) {
    return facts; // Missing, corrupt or oversized memory is unknown, not zero.
  }
}

function validateEndpoint(endpoint, backendUrl) {
  try {
    const url = new URL(endpoint);
    const backend = new URL(backendUrl);
    return url.protocol === 'https:' && backend.protocol === 'https:' &&
      url.origin === backend.origin && url.username === '' && url.password === '' &&
      !url.hash && !url.search && url.pathname === '/api/hommy/team/interpret' ?
      url.toString() : '';
  } catch (_) { return ''; }
}

function validateReply(data, request) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {kind:'UNAVAILABLE'};
  if (data.kind === 'REVIEW_REQUIRED') return {kind:'REVIEW_REQUIRED'};
  if (data.kind !== 'ANSWER' || typeof data.text !== 'string') return {kind:'UNAVAILABLE'};
  const text = data.text.trim();
  if (text.length < 6 || text.length > MAX_REPLY || /[\x00-\x08\x0b\x0e-\x1f]/.test(text) ||
      /(?:https?:\/\/|www\.|<script|api[_ -]?key|bearer\s|sk-proj-)/i.test(text) ||
      /\b\d{8,}\b/.test(text) || /(?:[$€]|\bCOP\b|\bpesos\b)/i.test(text) ||
      /\b(?:ya (?:le )?(?:escrib[ií]|envi[eé]|confirm[eé]|agend[eé])|la cita (?:qued[oó]|est[aá]) confirmada)(?=$|[\s.,!?])/i.test(text)) {
    return {kind:'UNAVAILABLE'};
  }
  // Never allow an unverified number just because a team member mentioned it.
  const grounding = JSON.stringify(request.facts);
  const allowedDigits = new Set((grounding.match(/\d+(?:[.,]\d+)?/g)||[]));
  if ((text.match(/\d+(?:[.,]\d+)?/g)||[]).some(n=>!allowedDigits.has(n)))
    return {kind:'UNAVAILABLE'};
  return {kind:'ANSWER',text};
}

async function readBoundedJson(response) {
  const chunks = [];
  let bytes = 0;
  if (!response.body || !response.body[Symbol.asyncIterator]) return null;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_BODY_BYTES) throw Error('AI_RESPONSE_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createTeamAI(options = {}) {
  const token = String(options.serviceToken || '').trim();
  const url = validateEndpoint(options.endpoint, options.backendUrl);
  const enabled = options.enabled === true && token.length >= 32 && Boolean(url);
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Math.max(1000, Math.min(9500, Number(options.timeoutMs) || 6500));
  const memoryRoot = options.dataDir || '/app/data';

  async function interpret(input) {
    if (!enabled) return {kind:'UNAVAILABLE',reason:'NOT_CONFIGURED'};
    const question = limited(input && input.question, 440);
    if (!question) return {kind:'UNAVAILABLE',reason:'EMPTY'};
    const facts = readFacts(memoryRoot, input && input.pendingTasks);
    const history = Array.isArray(input && input.history) ? input.history.slice(-3)
      .filter(h => h && typeof h === 'object')
      .map(h => ({ question: limited(h.question,220), answer: limited(h.answer,400) })) : [];
    // No customer messages or phone identifiers in payload; group member identity
    // is authenticated on the Bridge before this function is called.
    const payload = { version:1, purpose:'HOME_EASY_TEAM_READ_ONLY',
      question, history, facts, style:{
        locale:'es-CO',tone:'natural_whatsapp',shortSentences:true,
        constraints:['No inventar citas, envíos, precios, medidas ni descuentos.',
          'Si el usuario pide una acción sobre clientes, devolver REVIEW_REQUIRED.',
          'No devolver números de teléfono, credenciales o texto de conversaciones.',
          'Usar los hechos de facts solamente; avisar cuando falten datos.',
          'Responder como colega de HomeEasy, no como reporte burocrático.']
      } };
    try {
      const response = await fetcher(url, {
        method:'POST', redirect:'error',
        headers:{'Content-Type':'application/json','Accept':'application/json',
          'Authorization':'Bearer '+token},
        body:JSON.stringify(payload),
        signal:AbortSignal.timeout(timeoutMs)
      });
      if (!response || response.status !== 200) return {kind:'UNAVAILABLE',reason:'HTTP_ERROR'};
      const answer = await readBoundedJson(response);
      return validateReply(answer, payload);
    } catch (_) {
      return {kind:'UNAVAILABLE',reason:'SERVICE_UNAVAILABLE'};
    }
  }

  return Object.freeze({available:enabled,interpret});
}

module.exports = Object.freeze({
  createTeamAI,readFacts,validateEndpoint,validateReply
});
