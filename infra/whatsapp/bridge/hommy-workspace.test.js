'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createHommyWorkspace, LABELS } = require('./hommy-workspace');

const CID = 'client_' + 'a'.repeat(20);
const STAFF = '573001112233@c.us';
const GROUP = '120363123456789012@g.us';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hommy-workspace-test-'));
  const options = { dataDir: root, intelligenceEnabled: true, session: 'homeeasy', hasClient: id => id === CID };
  return { workspace: createHommyWorkspace(options), options,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function groupEvent({ id = 'm-1', fromMe = false, author = STAFF, group = GROUP, body = 'Hommy, pendientes', session = 'homeeasy' } = {}) {
  return { event: 'message', session,
    payload: { id, fromMe, chatId: group, author, body } };
}

test('workspace starts REVIEW in a currently enabled Bridge without affecting WAHA', t => {
  const v = setup();
  t.after(v.cleanup);
  const s = v.workspace.status();
  assert.equal(s.mode, 'REVIEW');
  assert.equal(s.team.enabled, false);
  assert.equal(s.team.replyEnabled, false);
  assert.equal(s.pendingTasks, 0);
  assert.equal(s.pendingTeamCommands, 0);
  assert.deepEqual([...LABELS].includes('VISITA'), true);
});

test('pausing only blocks Hommy workflow and persists across restart', t => {
  const v = setup(); t.after(v.cleanup);
  const a = v.workspace.status();
  assert.equal(v.workspace.configure({ mode: 'PAUSED', revision: a.revision }).mode, 'PAUSED');
  const restarted = createHommyWorkspace(v.options);
  assert.equal(restarted.status().mode, 'PAUSED');
  assert.equal(restarted.status().team.enabled, false);
  assert.throws(() => restarted.configure({ mode: 'AUTO' }), /PAUSED and REVIEW/);
  assert.throws(() => restarted.configure({ mode: 'REVIEW', revision: a.revision }), x => x.statusCode === 409);
});

test('only verified clients get tags and operational tasks', t => {
  const v = setup(); t.after(v.cleanup);
  assert.deepEqual(v.workspace.putLabels({ clientId: CID, labels: ['VISITA', 'VISITA', 'SEGUIMIENTO'] }).labels,
    ['VISITA', 'SEGUIMIENTO']);
  assert.throws(() => v.workspace.putLabels({ clientId: 'client_' + 'b'.repeat(20), labels: ['VENTA'] }),
    x => x.code === 'HOMMY_CLIENT_NOT_FOUND');
  assert.throws(() => v.workspace.putLabels({ clientId: CID, labels: ['COTIZACION', 'RANDOM'] }), /Invalid labels/);
  const task = v.workspace.createTask({ clientId: CID, title: 'Confirmar visita de medición' });
  assert.equal(task.status, 'PENDIENTE');
  assert.equal(v.workspace.status().pendingTasks, 1);
  assert.equal(v.workspace.updateTask({ taskId: task.id, status: 'COMPLETADA' }).status, 'COMPLETADA');
  assert.equal(v.workspace.status().pendingTasks, 0);
  const restarted = createHommyWorkspace(v.options);
  assert.equal(restarted.dashboard().tasks[0].status, 'COMPLETADA');
  assert.deepEqual(restarted.dashboard().clientLabels[0].labels, ['VISITA', 'SEGUIMIENTO']);
});

test('group commands are off until group and staff are explicitly configured', t => {
  const v = setup(); t.after(v.cleanup);
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent()).accepted, false);
  assert.throws(() => v.workspace.configure({ team: { enabled: true } }), /Exact group ID/);
  assert.throws(() => v.workspace.configure({ team: { groupId: GROUP, allowedSenders: ['admin'], enabled: true } }), /Exact group ID/);
  const state = v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [STAFF], enabled: true } });
  assert.equal(state.team.configured, true);
  assert.equal(state.team.enabled, true);
  assert.equal(state.team.replyEnabled, false);
});

test('authorized private group query gets a preview, never a WhatsApp reply', t => {
  const v = setup(); t.after(v.cleanup);
  v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [STAFF], enabled: true } });
  const a = v.workspace.ingestSignedGroupEvent(groupEvent());
  assert.equal(a.accepted, true);
  assert.equal(a.status, 'INFORMATION');
  assert.equal(v.workspace.dashboard().teamCommands[0].status, 'INFORMATION');
  assert.equal(v.workspace.dashboard().teamCommands[0].preview.includes('chats sin revisar'), true);
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent()).reason, 'DUPLICATE');
  assert.equal(v.workspace.dashboard().teamCommands.length, 1);
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ id: 'm2', author: '573999999999@c.us' })).reason, 'UNAUTHORIZED_AUTHOR');
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ id: 'm3', group: '987654321012@g.us' })).reason, 'OTHER_GROUP');
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ id: 'm4', fromMe: true })).reason, 'NOT_INBOUND');
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ id: 'm5', session: 'some-other-session' })).reason, 'UNSUPPORTED_EVENT');
});

test('instructions to contact a customer remain pending approval and no outbound messages exist', t => {
  const v = setup(); t.after(v.cleanup);
  v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [STAFF], enabled: true } });
  const result = v.workspace.ingestSignedGroupEvent(groupEvent({
    id: 'send1', body: 'Hommy, dile al cliente de las 3 que ya vamos para allá'
  }));
  assert.equal(result.status, 'REVIEW_REQUIRED');
  const entry = v.workspace.dashboard().teamCommands[0];
  assert.equal(entry.status, 'REVIEW_REQUIRED');
  assert.match(entry.preview, /antes de cualquier envío/);
  assert.equal(v.workspace.status().pendingTeamCommands, 1);
  v.workspace.configure({ mode: 'PAUSED' });
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ id: 'send2' })).reason, 'DISABLED');
});

test('server endpoints require authorization and verified HMAC before group capture', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const scope = server.slice(server.indexOf("if (req.method === 'POST' && url.pathname === '/api/whatsapp/webhook')"));
  assert.ok(scope.indexOf('hommyInbox.ingest(raw, req.headers)') < scope.indexOf('hommyWorkspace.ingestSignedGroupEvent'));
  for (const route of ['/api/whatsapp/hommy/control', '/api/whatsapp/hommy/workspace',
    '/api/whatsapp/hommy/labels', '/api/whatsapp/hommy/tasks']) {
    assert.ok(server.includes(route), route);
  }
  assert.match(server, /hommyWorkspace\.status\(\)\.mode !== 'REVIEW'/);
  const source = fs.readFileSync(path.join(__dirname, 'hommy-workspace.js'), 'utf8');
  assert.doesNotMatch(source, /sendText|sendDocument|wahaRequest\(/);
});
