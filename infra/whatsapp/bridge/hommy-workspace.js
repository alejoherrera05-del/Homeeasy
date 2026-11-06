'use strict';

// Hommy workspace is isolated from WAHA, Pentagrama and customer messaging.
// It stores operational state only and never sends a WhatsApp message.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const operational = require('./operational-overview');

const LABELS = Object.freeze(['NUEVO', 'COTIZACION', 'VISITA', 'SEGUIMIENTO', 'VENTA', 'PENDIENTE', 'ATENCION_HUMANA']);
const STATUSES = Object.freeze(['PENDIENTE', 'EN_CURSO', 'COMPLETADA', 'CANCELADA']);
const clean = (value, limit = 240) => String(value == null ? '' : value).trim().slice(0, limit);
const err = (message, code = 'HOMMY_BAD_INPUT', statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const validClient = id => /^client_[a-f0-9]{20}$/.test(id);
const validGroup = id => /^\d{8,22}(?:-\d{1,22})?@g\.us$/.test(id);
const validSender = id => /^\d{8,22}@(c\.us|lid)$/.test(id);

function mappedSenderAlias(author, mapping) {
  // The caller must fetch 'mapping' from WAHA after authenticating the webhook.
  // Never accept an alternate identity supplied within an incoming chat message.
  if (!validSender(author) || !mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return '';
  const lid = clean(mapping.lid, 90);
  const pn = clean(mapping.pn, 90);
  if (!/^\d{8,22}@lid$/.test(lid) || !/^\d{8,22}@c\.us$/.test(pn)) return '';
  if (author === lid) return pn;
  if (author === pn) return lid;
  return '';
}



function shouldResolveTeamAlias(event, team, author, alreadyAllowed, session) {
  if (!team || !team.enabled || !validGroup(team.groupId)) return false;
  if (!event || event.session !== session || !['message', 'message.any'].includes(event.event)) return false;
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || payload.fromMe === true || payload.key?.fromMe === true) return false;
  if (clean(payload.chatId || payload.from, 90) !== team.groupId) return false;
  if (alreadyAllowed || !validSender(author)) return false;
  const message = clean(payload.body || payload.text || payload.caption, 700);
  return /^hommy\b(?:[,\s:!?-]|$)/i.test(message);
}

function saveAtomic(file, data) {
  const temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function createHommyWorkspace(options = {}) {
  const dir = path.join(path.resolve(options.dataDir || '/app/data'), 'hommy-workspace');
  const file = path.join(dir, 'state.json');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const defaults = () => ({
    version: 1, revision: 0, mode: options.intelligenceEnabled ? 'REVIEW' : 'PAUSED',
    team: { enabled: false, groupId: '', allowedSenders: [], replyEnabled: false },
    labels: {}, tasks: [], commands: [], seen: [], audit: []
  });
  // A damaged optional workspace must never prevent the WhatsApp/Pentagrama Bridge from starting.
  // Keep the damaged file untouched for manual recovery and disable only these operations.
  let corrupted = false;
  let data = defaults();
  try {
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1 || !['PAUSED', 'REVIEW'].includes(data.mode) ||
        !data.team || !Array.isArray(data.team.allowedSenders) ||
        !data.labels || !Array.isArray(data.tasks) || !Array.isArray(data.commands) ||
        !Array.isArray(data.seen) || !Array.isArray(data.audit)) throw Error('Invalid workspace schema');
  } catch (_) {
    corrupted = true;
    data = defaults();
    data.mode = 'PAUSED';
  }
  const hasClient = options.hasClient || (() => false);
  const session = clean(options.session || 'homeeasy', 120);
  const limit = 250;
  const readOverview = operational.createOverview(options.dataDir || '/app/data');
  const lookupClient = operational.createClientLookup(options.dataDir || '/app/data');

  function persist(action, actor) {
    if (corrupted) throw err('Hommy workspace requires recovery; other Bridge services remain available', 'HOMMY_WORKSPACE_UNAVAILABLE', 503);
    data.revision++;
    data.audit.push({ at: new Date().toISOString(), action,
      actor: clean(actor && actor.profile && actor.profile.uid || 'system', 120) });
    data.audit = data.audit.slice(-limit);
    saveAtomic(file, data);
  }

  function status() {
    return { available: !corrupted, mode: corrupted ? 'PAUSED' : data.mode, revision: data.revision, availableLabels: LABELS,
      team: { enabled: data.team.enabled,
        configured: validGroup(data.team.groupId) && data.team.allowedSenders.length > 0,
        groupId: data.team.groupId || null, authorizedSenders: data.team.allowedSenders.length,
        replyEnabled: data.team.replyEnabled === true, replySupported: true },
      totalTeamCommands: data.commands.length,
      labeledClients: Object.keys(data.labels).length,
      pendingTasks: data.tasks.filter(t => ['PENDIENTE', 'EN_CURSO'].includes(t.status)).length,
      pendingTeamCommands: data.commands.filter(c => c.status === 'REVIEW_REQUIRED').length };
  }

  function configure(body, actor) {
    if (corrupted) throw err('Hommy workspace requires recovery', 'HOMMY_WORKSPACE_UNAVAILABLE', 503);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw err('Invalid configuration');
    if (body.revision !== undefined && body.revision !== data.revision) throw err('Refresh Hommy settings', 'HOMMY_REVISION_CONFLICT', 409);
    if (body.mode !== undefined && !['PAUSED', 'REVIEW'].includes(body.mode)) throw err('Only PAUSED and REVIEW are supported');
    let team = null;
    if (body.team !== undefined) {
      if (!body.team || typeof body.team !== 'object' || Array.isArray(body.team)) throw err('Invalid team settings');
      const groupId = body.team.groupId === undefined ? data.team.groupId : clean(body.team.groupId, 90);
      const senders = body.team.allowedSenders === undefined ? data.team.allowedSenders : body.team.allowedSenders;
      const enabled = body.team.enabled === undefined ? data.team.enabled : body.team.enabled;
      const replyEnabled = body.team.replyEnabled === undefined ? data.team.replyEnabled === true : body.team.replyEnabled;
      if ((groupId && !validGroup(groupId)) || typeof enabled !== 'boolean' ||
          typeof replyEnabled !== 'boolean' ||
          !Array.isArray(senders) || senders.length > 5 || senders.some(s => !validSender(s)) ||
          (enabled && (!groupId || !senders.length)) ||
          (replyEnabled && (!enabled || !groupId || !senders.length))) {
        throw err('Exact group ID, authorized sender IDs and active group are required');
      }
      team = { groupId, allowedSenders: [...new Set(senders)], enabled,
        replyEnabled: enabled && replyEnabled };
    }
    if (body.mode !== undefined) data.mode = body.mode;
    if (team) data.team = team;
    if (data.mode !== 'REVIEW') data.team.replyEnabled = false;
    persist('CONFIGURE', actor);
    return status();
  }

  function requireClient(value) {
    const id = clean(value, 90);
    if (!validClient(id) || !hasClient(id)) throw err('Client was not found in Hommy memory', 'HOMMY_CLIENT_NOT_FOUND', 404);
    return id;
  }

  function putLabels(body, actor) {
    const id = requireClient(body && body.clientId);
    const labels = body && body.labels;
    if (!Array.isArray(labels) || labels.some(s => !LABELS.includes(s))) throw err('Invalid labels');
    data.labels[id] = [...new Set(labels)];
    persist('LABELS', actor);
    return { clientId: id, labels: data.labels[id] };
  }

  function createTask(body, actor) {
    const clientId = requireClient(body && body.clientId);
    const title = clean(body && body.title, 160);
    if (title.length < 4) throw err('Task title is too short');
    if (data.tasks.length >= limit) throw err('Task limit reached; finish or archive previous tasks', 'HOMMY_TASK_LIMIT', 409);
    const task = { id: 'task_' + crypto.randomUUID(), clientId, title,
      status: 'PENDIENTE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    data.tasks.push(task);
    persist('TASK_CREATED', actor);
    return task;
  }

  function updateTask(body, actor) {
    const task = data.tasks.find(t => t.id === clean(body && body.taskId, 90));
    if (!task) throw err('Task not found', 'HOMMY_TASK_NOT_FOUND', 404);
    if (!STATUSES.includes(body.status)) throw err('Invalid task status');
    task.status = body.status;
    task.updatedAt = new Date().toISOString();
    persist('TASK_UPDATED', actor);
    return task;
  }

  function dashboard(options = {}) {
    const max = Math.max(1, Math.min(100, Number(options.limit) || 30));
    return { ...status(), clientLabels: Object.entries(data.labels).slice(-max).map(([clientId, labels]) => ({ clientId, labels })),
      tasks: data.tasks.slice(-max).reverse(),
      teamCommands: data.commands.slice(-Math.min(max, 20)).reverse() };
  }

  // The Bridge calls this only AFTER inbox.ingest authenticates the HMAC and session.
  // No customer or team-group messages are sent from this code path.
  function isAuthorizedSender(value) {
    return !corrupted && data.team.allowedSenders.includes(clean(value, 90));
  }

  // Synchronous reservation persisted BEFORE any outbound request.
  // Only an already-authenticated, authorized INFORMATION query may get a group reply.
  // The ID comes from a stored command, not from arbitrary API input or model output.
  function reserveTeamReply(id) {
    if (corrupted || data.mode !== 'REVIEW' || !data.team.enabled ||
        data.team.replyEnabled !== true || !validGroup(data.team.groupId)) return null;
    const command = data.commands.find(c => c.id === clean(id, 260));
    if (!command || command.status !== 'INFORMATION' || command.replyStatus) return null;
    const text = clean(command.preview, 600);
    if (!text) return null;
    command.replyStatus = 'SENDING';
    command.replyStartedAt = new Date().toISOString();
    persist('TEAM_REPLY_RESERVED', { profile: { uid: 'system' } });
    return Object.freeze({ commandId: command.id, groupId: data.team.groupId, text });
  }

  function finishTeamReply(id, success) {
    if (corrupted) return false;
    const command = data.commands.find(c => c.id === clean(id, 260));
    if (!command || command.replyStatus !== 'SENDING') return false;
    command.replyStatus = success === true ? 'SENT' : 'UNKNOWN';
    command.replyFinishedAt = new Date().toISOString();
    persist(command.replyStatus === 'SENT' ? 'TEAM_REPLY_SENT' : 'TEAM_REPLY_UNCONFIRMED',
      { profile: { uid: 'system' } });
    return true;
  }

  function ingestSignedGroupEvent(event, verifiedMapping) {
    if (corrupted || data.mode !== 'REVIEW' || !data.team.enabled) return { accepted: false, reason: 'DISABLED' };
    if (!event || event.session !== session || !['message', 'message.any'].includes(event.event))
      return { accepted: false, reason: 'UNSUPPORTED_EVENT' };
    const p = event.payload;
    if (!p || typeof p !== 'object' || p.fromMe || p.key?.fromMe) return { accepted: false, reason: 'NOT_INBOUND' };
    if (clean(p.chatId || p.from, 90) !== data.team.groupId) return { accepted: false, reason: 'OTHER_GROUP' };
    const author = clean(p.author || p.participant || p.key?.participant, 90);
    const matchingAlias = mappedSenderAlias(author, verifiedMapping);
    if (!isAuthorizedSender(author) && !isAuthorizedSender(matchingAlias))
      return { accepted: false, reason: 'UNAUTHORIZED_AUTHOR' };
    const id = clean(p.id || p.messageId || p.key?.id, 260);
    if (!id || data.seen.includes(id)) return { accepted: false, reason: id ? 'DUPLICATE' : 'MISSING_ID' };
    const body = clean(p.body || p.text || p.caption, 700);
    if (!/^hommy\b[,\s:!?-]*/i.test(body)) return { accepted: false, reason: 'NOT_MENTIONED' };
    const command = body.replace(/^hommy\b[,\s:!?-]*/i, '').trim();
    const queryType = operational.classify(command);
    const clientDetail = queryType ? null : lookupClient(command);
    const status = queryType || clientDetail !== null ? 'INFORMATION' : 'REVIEW_REQUIRED';
    const preview = queryType
      ? operational.preview(queryType, data.tasks, data.labels, readOverview())
      : clientDetail !== null ? clientDetail
      : 'Solicitud recibida. Hay que identificar al cliente y aprobar la acción en HomeEasy antes de cualquier envío.';
    data.commands.push({ id, at: new Date().toISOString(), author, command: command.slice(0, 500), preview, status });
    data.commands = data.commands.slice(-limit);
    data.seen.push(id);
    data.seen = data.seen.slice(-limit);
    persist('TEAM_COMMAND', { profile: { uid: author } });
    return { accepted: true, id, status };
  }

  return Object.freeze({ status, configure, putLabels, createTask, updateTask, dashboard,
    isAuthorizedSender, ingestSignedGroupEvent, reserveTeamReply, finishTeamReply });
}

module.exports = Object.freeze({ createHommyWorkspace, LABELS, mappedSenderAlias, shouldResolveTeamAlias });
