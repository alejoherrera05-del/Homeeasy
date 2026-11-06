'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createHommyWorkspace, LABELS, mappedSenderAlias, shouldResolveTeamAlias } = require('./hommy-workspace');

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
  assert.equal(s.team.replySupported, true);
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
  assert.equal(v.workspace.dashboard().teamCommands[0].preview.includes('memoria comercial'), true);
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

test('lookup predicate recognizes actual private-group commands (runtime regression)', () => {
  const team = { enabled:true, groupId:GROUP };
  const author = '123456789012345@lid';
  const event = groupEvent({ author, body:'Hommy, pendientes' });
  assert.equal(shouldResolveTeamAlias(event, team, author, false, 'homeeasy'), true);
  assert.equal(shouldResolveTeamAlias(groupEvent({ author, body:'Hommy: qué pendientes tenemos?' }),
    team, author, false, 'homeeasy'), true);
  assert.equal(shouldResolveTeamAlias(groupEvent({ author, body:'hommy quieres cotizar?' }),
    team, author, false, 'homeeasy'), true);
  assert.equal(shouldResolveTeamAlias(groupEvent({ author, body:'Hommyabc, pendientes' }),
    team, author, false, 'homeeasy'), false);
  assert.equal(shouldResolveTeamAlias(groupEvent({ author, body:'Buenos días Hommy, pendientes' }),
    team, author, false, 'homeeasy'), true);
  assert.equal(shouldResolveTeamAlias(event, team, author, true, 'homeeasy'), false);
  assert.equal(shouldResolveTeamAlias(event, { ...team, enabled:false }, author, false, 'homeeasy'), false);
  assert.equal(shouldResolveTeamAlias(event, team, 'untrusted', false, 'homeeasy'), false);
  assert.equal(shouldResolveTeamAlias(groupEvent({ author, group:'11111111111@g.us' }),
    team, author, false, 'homeeasy'), false);
  assert.equal(shouldResolveTeamAlias(groupEvent({ author, session:'wrong' }),
    team, author, false, 'homeeasy'), false);
  assert.equal(shouldResolveTeamAlias(groupEvent({ author, fromMe:true }),
    team, author, false, 'homeeasy'), false);
});

test('verified WEBJS LID mapping identifies the allowed group member without weakening whitelist', t => {
  const v = setup(); t.after(v.cleanup);
  v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [STAFF], enabled: true } });
  const lid = '123456789012345@lid';
  const event = groupEvent({ author: lid, id: 'lid-proof' });
  assert.equal(v.workspace.ingestSignedGroupEvent(event).reason, 'UNAUTHORIZED_AUTHOR');
  assert.equal(mappedSenderAlias(lid, { lid, pn: STAFF }), STAFF);
  const accepted = v.workspace.ingestSignedGroupEvent(event, { lid, pn: STAFF });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.status, 'INFORMATION');
  assert.equal(v.workspace.dashboard().teamCommands.length, 1);
  assert.equal(v.workspace.ingestSignedGroupEvent(event, { lid, pn: STAFF }).reason, 'DUPLICATE');
});

test('invalid or unrelated LID mappings cannot elevate a stranger or wrong group', t => {
  const v = setup(); t.after(v.cleanup);
  v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [STAFF], enabled: true } });
  const other = '123456789012345@lid';
  const stranger = groupEvent({ author: other, id: 'stranger' });
  const wrongPair = { lid: '987654321098765@lid', pn: STAFF };
  const noPhone = { lid: other, pn: null };
  assert.equal(mappedSenderAlias(other, wrongPair), '');
  assert.equal(mappedSenderAlias(other, noPhone), '');
  assert.equal(v.workspace.ingestSignedGroupEvent(stranger, wrongPair).reason, 'UNAUTHORIZED_AUTHOR');
  assert.equal(v.workspace.ingestSignedGroupEvent(stranger, noPhone).reason, 'UNAUTHORIZED_AUTHOR');
  assert.equal(v.workspace.ingestSignedGroupEvent(stranger, { lid: other, pn: '573999999999@c.us' }).reason, 'UNAUTHORIZED_AUTHOR');
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ author: other, id: 'wrong-group', group: '987654321012@g.us' }),
    { lid: other, pn: STAFF }).reason, 'OTHER_GROUP');
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ author: other, id: 'own', fromMe: true }),
    { lid: other, pn: STAFF }).reason, 'NOT_INBOUND');
  assert.equal(v.workspace.dashboard().teamCommands.length, 0);
});

test('reverse LID lookup authorizes phone-backed event only via WAHA-confirmed pair', t => {
  const v = setup(); t.after(v.cleanup);
  const lid = '123456789012345@lid';
  v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [lid], enabled: true } });
  const alias = mappedSenderAlias(STAFF, { lid, pn: STAFF });
  assert.equal(alias, lid);
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ author: STAFF }), { lid, pn: STAFF }).accepted, true);
});


test('team mentions work naturally at beginning, at end or after a greeting', t => {
  const v = setup(); t.after(v.cleanup);
  const { extractTeamRequest } = require('./hommy-workspace');
  const variants = [
    ['Hommy, cómo va lo de la onda serena?', 'cómo va lo de la onda serena?'],
    ['Onda Serena Hommy', 'Onda Serena'],
    ['Oye Hommy, cómo vamos con la Onda Serena?', 'cómo vamos con la Onda Serena?'],
    ['Hommy, la cortina Onda Serena', 'la cortina Onda Serena']
  ];
  const dir=path.join(v.options.dataDir, 'hommy-intelligence');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'state-v2.json'), JSON.stringify({
    version:2,
    clients:{ c:{id:'c',name:'Laura',provisional:false,identityConflicts:[]} },
    opportunities:{ o:{id:'o',clientId:'c',product:'Onda Serena',status:'OPEN',nextAction:'REQUEST_QUOTE_DETAILS',environments:[],quoteNumbers:[]} }
  }));
  v.workspace.configure({ team:{ groupId:GROUP, allowedSenders:[STAFF], enabled:true, replyEnabled:true } });
  for (const [i, [body, command]] of variants.entries()) {
    assert.equal(extractTeamRequest(body), command, body);
    const result = v.workspace.ingestSignedGroupEvent(groupEvent({ id:'conversational-' + i, body }));
    assert.equal(result.accepted, true, body);
    assert.equal(result.status, 'INFORMATION', body);
    const preview = v.workspace.dashboard().teamCommands[0].preview;
    assert.match(preview, /Onda Serena/, body);
    assert.doesNotMatch(preview, /No encuentro ese nombre exacto/, body);
  }
  assert.equal(extractTeamRequest('hommymarketing es otro nombre'), null);
  assert.equal(extractTeamRequest('Hola a todos, cómo están?'), null);
  const stranger = v.workspace.ingestSignedGroupEvent(groupEvent({
    id:'not-authorized', body:'Onda Serena Hommy', author:'573099999999@c.us'
  }));
  assert.equal(stranger.reason, 'UNAUTHORIZED_AUTHOR');
  const action = v.workspace.ingestSignedGroupEvent(groupEvent({
    id:'unsafe-mixed', body:'Onda Serena Hommy, envía la cotización al cliente'
  }));
  assert.equal(action.status, 'REVIEW_REQUIRED');
  assert.equal(v.workspace.reserveTeamReply(action.id), null);
});

test('webhook performs a bounded read-only LID lookup after signature verification', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const segment = server.slice(server.indexOf("url.pathname === '/api/whatsapp/webhook'"),
    server.indexOf("url.pathname === '/api/whatsapp/inbox'"));
  assert.match(segment, /hommyInbox\.ingest\(raw, req\.headers\)/);
  assert.match(segment, /wahaRequest\('GET'/);
  assert.match(segment, /shouldResolveTeamAlias\(event, team, author/);
  assert.match(segment, /\/lids\/pn\//);
  assert.match(segment, /2500/);
  assert.ok(segment.indexOf('hommyInbox.ingest(raw, req.headers)') < segment.indexOf("wahaRequest('GET'"));
  assert.match(segment, /if \(group\.accepted\)/);
  assert.match(segment, /hommyWorkspace\.reserveTeamReply\(group\.id\)/);
  assert.match(segment, /chatId: reserved\.groupId/);
  assert.doesNotMatch(segment, /sendDocument|force-recreate/);
});

test('team activity counts informational queries separately from pending review actions', t => {
  const v = setup(); t.after(v.cleanup);
  v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [STAFF], enabled: true } });
  v.workspace.ingestSignedGroupEvent(groupEvent({ id: 'info-1' }));
  assert.equal(v.workspace.status().totalTeamCommands, 1);
  assert.equal(v.workspace.status().pendingTeamCommands, 0);
  v.workspace.ingestSignedGroupEvent(groupEvent({ id: 'action-1', body: 'Hommy, avisa al cliente que vamos en camino' }));
  assert.equal(v.workspace.status().totalTeamCommands, 2);
  assert.equal(v.workspace.status().pendingTeamCommands, 1);
});

test('internal replies are off by default and may only be enabled for an authorized group in REVIEW', t => {
  const v = setup(); t.after(v.cleanup);
  assert.equal(v.workspace.status().team.replyEnabled, false);
  assert.throws(() => v.workspace.configure({ team: { replyEnabled: true } }), /active group/);
  v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [STAFF], enabled: true } });
  assert.equal(v.workspace.status().team.replyEnabled, false);
  assert.throws(() => v.workspace.configure({ team: { replyEnabled: 'true' } }), /active group/);
  v.workspace.configure({ team: { replyEnabled: true } });
  assert.equal(v.workspace.status().team.replyEnabled, true);
  v.workspace.configure({ mode: 'PAUSED' });
  assert.equal(v.workspace.status().team.replyEnabled, false);
  assert.equal(v.workspace.status().mode, 'PAUSED');
  v.workspace.configure({ mode: 'REVIEW' });
  assert.equal(v.workspace.status().team.replyEnabled, false);
});

test('only authorized informational group queries can reserve a single durable reply', t => {
  const v = setup(); t.after(v.cleanup);
  v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [STAFF], enabled: true } });
  const received = v.workspace.ingestSignedGroupEvent(groupEvent({ id:'test-info' }));
  assert.equal(received.accepted, true);
  assert.equal(v.workspace.reserveTeamReply('test-info'), null);
  v.workspace.configure({ team: { replyEnabled:true } });
  const reserved = v.workspace.reserveTeamReply('test-info');
  assert.ok(reserved);
  assert.equal(reserved.groupId, GROUP);
  assert.match(reserved.text, /No tengo tareas manuales pendientes registradas/i);
  assert.equal(v.workspace.reserveTeamReply('test-info'), null);
  const restarted = createHommyWorkspace(v.options);
  assert.equal(restarted.reserveTeamReply('test-info'), null);
  assert.equal(restarted.dashboard().teamCommands[0].replyStatus, 'SENDING');
  assert.equal(restarted.finishTeamReply('test-info', false), true);
  assert.equal(restarted.dashboard().teamCommands[0].replyStatus, 'UNKNOWN');
  assert.equal(restarted.reserveTeamReply('test-info'), null);
  assert.equal(restarted.finishTeamReply('test-info', true), false);
  assert.equal(v.workspace.reserveTeamReply('another-id'), null);
});

test('internal reply cannot be sent for instructions, strangers, wrong groups or while paused', t => {
  const v = setup(); t.after(v.cleanup);
  v.workspace.configure({ team: { groupId: GROUP, allowedSenders: [STAFF], enabled:true, replyEnabled:true } });
  const action = v.workspace.ingestSignedGroupEvent(groupEvent({ id:'no-send-action', body:'Hommy, avisa al cliente' }));
  assert.equal(action.status, 'REVIEW_REQUIRED');
  assert.equal(v.workspace.reserveTeamReply(action.id), null);
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ id:'other-group', group:'987654321012@g.us' })).accepted, false);
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({ id:'other-author', author:'573999999999@c.us' })).accepted, false);
  assert.equal(v.workspace.reserveTeamReply('other-group'), null);
  assert.equal(v.workspace.reserveTeamReply('other-author'), null);
  const info = v.workspace.ingestSignedGroupEvent(groupEvent({ id:'before-pause' }));
  assert.equal(info.status, 'INFORMATION');
  v.workspace.configure({ mode:'PAUSED' });
  assert.equal(v.workspace.reserveTeamReply(info.id), null);
});

test('authenticated group overview reads analyzed clients, not private contact data', t => {
  const v = setup(); t.after(v.cleanup);
  const dir = path.join(v.options.dataDir, 'hommy-intelligence');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'state-v2.json'), JSON.stringify({
    version:2, clients:{ c1:{ name:'Laura', phones:['573007771111'] } },
    opportunities:{ o1:{ status:'OPEN', nextAction:'REQUEST_QUOTE_DETAILS', quoteNumbers:[] } }
  }));
  v.workspace.configure({ team:{ groupId:GROUP, allowedSenders:[STAFF], enabled:true, replyEnabled:true } });
  const a = v.workspace.ingestSignedGroupEvent(groupEvent({ id:'memory-pending' }));
  assert.equal(a.status, 'INFORMATION');
  assert.match(v.workspace.dashboard().teamCommands[0].preview, /una oportunidad abierta/);
  assert.match(v.workspace.dashboard().teamCommands[0].preview, /Una necesita datos para cotizar/);
  assert.doesNotMatch(v.workspace.dashboard().teamCommands[0].preview, /Laura|573007771111/);
  const q = v.workspace.ingestSignedGroupEvent(groupEvent({ id:'memory-quotes', body:'Hommy, cotizaciones' }));
  assert.equal(q.status, 'INFORMATION');
  assert.match(v.workspace.dashboard().teamCommands[0].preview, /una que necesita datos para cotizar/);
  const unsafe = v.workspace.ingestSignedGroupEvent(groupEvent({
    id:'unsafe', body:'Hommy, cotizaciones y manda el precio al cliente'
  }));
  assert.equal(unsafe.status, 'REVIEW_REQUIRED');
  assert.equal(v.workspace.reserveTeamReply(unsafe.id), null);
});


test('signed team group reads one exact client interest and never sends an instruction to a client', t => {
  const v = setup(); t.after(v.cleanup);
  const folder=path.join(v.options.dataDir,'hommy-intelligence');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder,'state-v2.json'),JSON.stringify({
    version:2,
    clients:{c:{id:'c',name:'Laura',provisional:false,identityConflicts:[],phones:['573001234567']}},
    opportunities:{o:{id:'o',clientId:'c',product:'Onda Serena',status:'OPEN',
      nextAction:'REQUEST_QUOTE_DETAILS',environments:['sala'],quoteNumbers:[]}}
  }));
  v.workspace.configure({team:{enabled:true,groupId:GROUP,allowedSenders:[STAFF],replyEnabled:true}});
  const received=v.workspace.ingestSignedGroupEvent(groupEvent({
    id:'product-question',body:'Hommy, cómo va lo de Onda Serena?'
  }));
  assert.equal(received.status,'INFORMATION');
  const item=v.workspace.dashboard().teamCommands[0];
  assert.match(item.preview,/Onda Serena/);
  assert.match(item.preview,/Por ahora faltan datos para poder cotizar/);
  assert.doesNotMatch(item.preview,/573001234567/);
  const reserved=v.workspace.reserveTeamReply(received.id);
  assert.equal(reserved.groupId,GROUP);
  assert.equal(reserved.text,item.preview);
  assert.equal(v.workspace.reserveTeamReply(received.id),null);
  const unsafe=v.workspace.ingestSignedGroupEvent(groupEvent({
    id:'unsafe-product',body:'Hommy, cliente de Onda Serena manda el precio'
  }));
  assert.equal(unsafe.status,'REVIEW_REQUIRED');
  assert.equal(v.workspace.reserveTeamReply(unsafe.id),null);
  assert.equal(v.workspace.ingestSignedGroupEvent(groupEvent({
    id:'stranger',author:'573009999999@c.us',body:'Hommy, cómo va lo de Onda Serena?'
  })).reason,'UNAUTHORIZED_AUTHOR');
});

test('group response sender has fixed group destination and durable duplicate lock', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const webhook = server.slice(server.indexOf("url.pathname === '/api/whatsapp/webhook'"),
    server.indexOf("url.pathname === '/api/whatsapp/inbox'"));
  assert.match(webhook, /hommyWorkspace\.reserveTeamReply\(group\.id\)/);
  assert.match(webhook, /if \(group\.accepted\)/);
  assert.match(webhook, /chatId: reserved\.groupId/);
  assert.match(webhook, /hommyWorkspace\.finishTeamReply\(reserved\.commandId, true\)/);
  assert.match(webhook, /hommyWorkspace\.finishTeamReply\(reserved\.commandId, false\)/);
  assert.doesNotMatch(webhook, /phone:|cliente\.telefono|cotizacion|sendDocument/);
  const js = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'homeeasy-hommy-operations-ui.js'), 'utf8');
  assert.match(js, /totalTeamCommands/);
  assert.match(js, /team:\{ replyEnabled: enabled \}/);
  assert.match(js, /teamState\.replySupported === true/);
  assert.match(js, /Activar respuestas internas/);
});

test('conversational mode requires a configured service and two independent opt-ins',t=>{
 const v=setup();t.after(v.cleanup);
 assert.equal(v.workspace.status().team.aiAvailable,false);
 assert.equal(v.workspace.status().team.aiEnabled,false);
 v.workspace.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true}});
 assert.throws(()=>v.workspace.configure({team:{aiEnabled:true}}),/active group/);
 const yes={...v.options,teamAiAvailable:true};
 const ai=createHommyWorkspace(yes);
 assert.equal(ai.status().team.aiAvailable,true);
 assert.equal(ai.status().team.aiEnabled,false);
 ai.configure({team:{aiEnabled:true}});
 assert.equal(ai.status().team.aiEnabled,true);
 ai.configure({team:{replyEnabled:false}});
 assert.equal(ai.status().team.aiEnabled,false);
 assert.equal(ai.status().team.replyEnabled,false);
 ai.configure({team:{replyEnabled:true,aiEnabled:true}});
 ai.configure({mode:'PAUSED'});
 assert.equal(ai.status().team.aiEnabled,false);
 assert.equal(ai.status().team.replyEnabled,false);
 ai.configure({mode:'REVIEW'});
 assert.equal(ai.status().team.aiEnabled,false);
});

test('AI group reply remains pending until verified answer and deduplicates all sends',t=>{
 const v=setup();t.after(v.cleanup);
 const options={...v.options,teamAiAvailable:true};
 const w=createHommyWorkspace(options);
 w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
 const event=groupEvent({id:'natural-ai',body:'Oye Hommy, cómo va lo de la Onda Serena?'});
 const received=w.ingestSignedGroupEvent(event,null,{aiEnabled:true});
 assert.equal(received.status,'AI_PENDING');
 assert.equal(w.reserveTeamReply(received.id),null);
 assert.equal(w.ingestSignedGroupEvent(event,null,{aiEnabled:true}).reason,'DUPLICATE');
 const input=w.teamAIRequest(received.id);
 assert.match(input.question,/Onda Serena/);
 assert.equal(input.history.length,0);
 const result=w.completeTeamAI(received.id,{kind:'ANSWER',text:'Sobre Onda Serena tengo una oportunidad. Aún nos faltan datos para cotizar.'});
 assert.equal(result.ready,true);
 assert.equal(w.completeTeamAI(received.id,{kind:'ANSWER',text:'Otra respuesta'}).ready,false);
 const reserved=w.reserveTeamReply(received.id);
 assert.equal(reserved.groupId,GROUP);
 assert.match(reserved.text,/faltan datos/);
 assert.equal(w.reserveTeamReply(received.id),null);
 const restarted=createHommyWorkspace(options);
 assert.equal(restarted.reserveTeamReply(received.id),null);
 restarted.finishTeamReply(received.id,true);
 assert.equal(restarted.dashboard().teamCommands[0].replyStatus,'SENT');
});

test('disabling conversational mode cancels a late AI reply even if group replies stay enabled',t=>{
 const v=setup();t.after(v.cleanup);
 const w=createHommyWorkspace({...v.options,teamAiAvailable:true});
 w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
 const msg=w.ingestSignedGroupEvent(groupEvent({id:'turned-off-during-ai',body:'Hommy, cómo va la cortina?'}),
   null,{aiEnabled:true});
 assert.equal(msg.status,'AI_PENDING');
 w.configure({team:{aiEnabled:false}});
 assert.equal(w.status().team.aiEnabled,false);
 assert.equal(w.status().team.replyEnabled,true);
 w.completeTeamAI(msg.id,{kind:'ANSWER',text:'Respuesta antigua que ya no debe enviarse.'});
 assert.equal(w.reserveTeamReply(msg.id),null);
 const normal=w.ingestSignedGroupEvent(groupEvent({id:'still-in-review',body:'Hommy, pendientes'}),
   null,{aiEnabled:true});
 assert.equal(normal.status,'INFORMATION');
 assert.ok(w.reserveTeamReply(normal.id));
});

test('AI outage, group change, member revocation and unsafe actions never trigger customer or group sends',t=>{
 const v=setup();t.after(v.cleanup);
 const w=createHommyWorkspace({...v.options,teamAiAvailable:true});
 w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
 const first=w.ingestSignedGroupEvent(groupEvent({id:'unavailable',body:'Hommy, y la visita?'}),null,{aiEnabled:true});
 assert.equal(w.completeTeamAI(first.id,{kind:'UNAVAILABLE'}).status,'AI_UNAVAILABLE');
 assert.equal(w.reserveTeamReply(first.id),null);
 const second=w.ingestSignedGroupEvent(groupEvent({id:'requires-human',body:'Hommy, envíale un precio a Laura'}),null,{aiEnabled:true});
 assert.equal(w.completeTeamAI(second.id,{kind:'REVIEW_REQUIRED'}).status,'REVIEW_REQUIRED');
 assert.equal(w.reserveTeamReply(second.id),null);
 const pending=w.ingestSignedGroupEvent(groupEvent({id:'group-changed',body:'Hommy, qué sabemos?'}),null,{aiEnabled:true});
 w.configure({team:{groupId:'120363987654321012@g.us',allowedSenders:[STAFF],enabled:true}});
 w.completeTeamAI(pending.id,{kind:'ANSWER',text:'Esta respuesta no debe ir al nuevo grupo.'});
 assert.equal(w.reserveTeamReply(pending.id),null);
 const revoked=w.ingestSignedGroupEvent(groupEvent({
  id:'revoked',group:'120363987654321012@g.us',body:'Hommy, novedades?'
 }),null,{aiEnabled:true});
 w.configure({team:{allowedSenders:['573008888888@c.us']}});
 w.completeTeamAI(revoked.id,{kind:'ANSWER',text:'Tampoco podemos responder a alguien revocado.'});
 assert.equal(w.reserveTeamReply(revoked.id),null);
 w.configure({team:{aiEnabled:false}});
 const old=w.ingestSignedGroupEvent(groupEvent({
  id:'static-fallback',group:'120363987654321012@g.us',author:'573008888888@c.us'
 }));
 assert.equal(old.status,'INFORMATION');
});

test('team conversational mode limits each authorized member to four AI requests per minute',t=>{
 const v=setup();t.after(v.cleanup);
 const w=createHommyWorkspace({...v.options,teamAiAvailable:true});
 w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
 for(let i=0;i<4;i++){
  const g=w.ingestSignedGroupEvent(groupEvent({id:'rate-'+i,body:'Hommy, un resumen por favor'}),null,{aiEnabled:true});
  assert.equal(g.status,'AI_PENDING');
 }
 const limited=w.ingestSignedGroupEvent(groupEvent({id:'rate-4',body:'Hommy, otra pregunta'}),null,{aiEnabled:true});
 assert.equal(limited.status,'AI_RATE_LIMITED');
 assert.equal(w.teamAIRequest(limited.id),null);
 assert.equal(w.reserveTeamReply(limited.id),null);
 const other=w.ingestSignedGroupEvent(groupEvent({id:'second-member',author:'573009999999@c.us'}),
  null,{aiEnabled:true});
 assert.equal(other.reason,'UNAUTHORIZED_AUTHOR');
});

test('group AI is only invoked after signed webhook and its output stays pinned to the team group',()=>{
 const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
 const segment=server.slice(server.indexOf("url.pathname === '/api/whatsapp/webhook'"),
   server.indexOf("url.pathname === '/api/whatsapp/inbox'"));
 assert.match(segment,/hommyInbox\.ingest\(raw, req\.headers\)/);
 assert.match(segment,/hommyWorkspace\.ingestSignedGroupEvent\(event, mapping, \{ aiEnabled: teamAI\.available \}\)/);
 assert.match(segment,/teamAI\.interpret\(request\)/);
 assert.ok(segment.indexOf('hommyInbox.ingest(raw, req.headers)') < segment.indexOf('teamAI.interpret(request)'));
 assert.match(segment,/hommyWorkspace\.reserveTeamReply\(group\.id\)/);
 assert.match(segment,/chatId: reserved\.groupId/);
 assert.doesNotMatch(segment,/chatId: req\.body|phone: reserved|customer.*sendText/);
 const ui=fs.readFileSync(path.join(__dirname,'..','..','..','homeeasy-hommy-operations-ui.js'),'utf8');
 assert.match(ui,/teamState\.aiAvailable/);
 assert.match(ui,/team:\{ aiEnabled: enabled \}/);
 assert.match(ui,/Activar conversación natural/);
});

test('damaged optional workspace fails closed without blocking Bridge startup or overwriting the file', t => {
  const v = setup(); t.after(v.cleanup);
  const file = path.join(v.options.dataDir, 'hommy-workspace', 'state.json');
  fs.writeFileSync(file, '{bad-json', { mode: 0o600 });
  const recovered = createHommyWorkspace(v.options);
  assert.equal(recovered.status().available, false);
  assert.equal(recovered.status().mode, 'PAUSED');
  assert.equal(recovered.ingestSignedGroupEvent(groupEvent()).accepted, false);
  assert.throws(() => recovered.configure({ mode: 'REVIEW' }), x => x.statusCode === 503);
  assert.equal(fs.readFileSync(file, 'utf8'), '{bad-json');
});

test('optional UI does not touch Hommy chat and uses authorized client methods', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'homeeasy-hommy-operations-ui.js'), 'utf8');
  const config = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'configuracion.html'), 'utf8');
  assert.match(config, /homeeasy-hommy-operations-ui\.js/);
  assert.match(js, /panel-integraciones/);
  assert.match(js, /HomeEasyWhatsApp\.saveHommyControl/);
  // The optional card must refresh when the user opens Integraciones after login.
  assert.match(js, /homeeasy:whatsapp-status/);
  assert.match(js, /\[data-section="integraciones"\]/);
  assert.match(js, /load\(false\)/);
  assert.doesNotMatch(js, /restart\(|bootstrap\(|Hommychat\.html|document\.body\.innerHTML/);
});

test('group discovery is read-only, role-protected and time-bounded', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const groups = server.slice(server.indexOf("url.pathname === '/api/whatsapp/hommy/groups'"));
  const members = server.slice(server.indexOf("url.pathname === '/api/whatsapp/hommy/group-members'"));
  assert.match(groups.slice(0, 500), /auth.authorize\(req, 'config.write'\)/);
  assert.match(groups.slice(0, 500), /wahaRequest\('GET'/);
  assert.match(groups.slice(0, 500), /8000/);
  assert.match(members.slice(0, 600), /auth.authorize\(req, 'config.write'\)/);
  assert.match(members.slice(0, 600), /wahaRequest\('GET'/);
  assert.doesNotMatch(groups.slice(0, 1200), /wahaRequest\('POST'/);
  const client = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'homeeasy-whatsapp-client.js'), 'utf8');
  assert.match(client, /hommyGroups/);
  assert.match(client, /hommyGroupMembers/);
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


test('hybrid fast path answers exact read-only summaries without invoking AI', t => {
  const v=setup();t.after(v.cleanup);
  const w=createHommyWorkspace({...v.options,teamAiAvailable:true});
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
  const fast=w.ingestSignedGroupEvent(groupEvent({id:'hybrid-summary',body:'Hommy, pendientes'}),null,{aiEnabled:true});
  assert.equal(fast.status,'INFORMATION');
  assert.equal(w.teamAIRequest(fast.id),null);
  const reserved=w.reserveTeamReply(fast.id);
  assert.ok(reserved);
  assert.match(reserved.text,/tareas manuales/i);
  assert.equal(w.reserveTeamReply(fast.id),null);
  const conversational=w.ingestSignedGroupEvent(groupEvent({
    id:'hybrid-complex',body:'Hommy, ayúdame a analizar nuestros clientes'
  }),null,{aiEnabled:true});
  assert.equal(conversational.status,'AI_PENDING');
  assert.ok(w.teamAIRequest(conversational.id));
  const action=w.ingestSignedGroupEvent(groupEvent({
    id:'hybrid-action',body:'Hommy, avísale al cliente que voy en camino'
  }),null,{aiEnabled:true});
  assert.notEqual(action.status,'INFORMATION');
  assert.equal(w.reserveTeamReply(action.id),null);
});
