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
 const event=groupEvent({id:'natural-ai',body:'Oye Hommy, qué deberíamos mejorar al atender clientes interesados en Onda Serena?'});
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
 assert.equal(second.status,'REVIEW_REQUIRED');
 assert.equal(w.teamAIRequest(second.id),null);
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


test('hybrid product lookup uses verified memory and does not contact the AI or customers',t=>{
  const v=setup();t.after(v.cleanup);
  const folder=path.join(v.options.dataDir,'hommy-intelligence');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder,'state-v2.json'),JSON.stringify({
    version:2,
    clients:{c:{id:'c',name:'Laura',provisional:false,identityConflicts:[]}},
    opportunities:{o:{id:'o',clientId:'c',product:'Onda Serena',status:'OPEN',
      nextAction:'REQUEST_QUOTE_DETAILS',environments:['sala'],quoteNumbers:[]}}
  }));
  const w=createHommyWorkspace({...v.options,teamAiAvailable:true});
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
  const direct=w.ingestSignedGroupEvent(groupEvent({
    id:'fast-product',body:'Hommy, cómo vamos con la cortina Onda Serena?'
  }),null,{aiEnabled:true});
  assert.equal(direct.status,'INFORMATION');
  assert.equal(w.teamAIRequest(direct.id),null);
  const reserved=w.reserveTeamReply(direct.id);
  assert.match(reserved.text,/Onda Serena/);
  assert.match(reserved.text,/faltan datos/);
  assert.equal(w.reserveTeamReply(direct.id),null);
  const unsafe=w.ingestSignedGroupEvent(groupEvent({
    id:'mixed-product-action',body:'Hommy, envía el precio de Onda Serena al cliente'
  }),null,{aiEnabled:true});
  assert.equal(unsafe.status,'REVIEW_REQUIRED');
  assert.equal(w.teamAIRequest(unsafe.id),null);
  assert.equal(w.reserveTeamReply(unsafe.id),null);
});


test('customer-action requests are rejected before expensive AI, even with natural wording',t=>{
  const v=setup();t.after(v.cleanup);
  const w=createHommyWorkspace({...v.options,teamAiAvailable:true});
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
  const actions=[
    'Hommy, dile a Camilo que voy para Novaterra',
    'Hommy, puedes enviarle el catálogo a Laura?',
    'Hommy, cómo van las visitas y confirma la de mañana',
    'Hommy, avísale que llego tarde',
    'Hommy, responde al cliente que ya voy en camino'
  ];
  actions.forEach((body,i)=>{
    const received=w.ingestSignedGroupEvent(groupEvent({id:'action-gate-'+i,body}),null,{aiEnabled:true});
    assert.equal(received.status,'REVIEW_REQUIRED',body);
    assert.equal(w.teamAIRequest(received.id),null,body);
    assert.equal(w.dashboard().teamCommands[0].aiRequest,false,body);
    assert.equal(w.reserveTeamReply(received.id),null,body);
  });
  const advisory=w.ingestSignedGroupEvent(groupEvent({
    id:'advisory-safe',body:'Hommy, qué le digo a un cliente interesado en cortinas?'
  }),null,{aiEnabled:true});
  assert.equal(advisory.status,'AI_PENDING');
});


test('Hommy understands friendly name variants and a grounded follow-up with no command syntax',t=>{
  const v=setup();t.after(v.cleanup);
  const dir=path.join(v.options.dataDir,'hommy-intelligence');fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'state-v2.json'),JSON.stringify({
    version:2,clients:{c:{id:'c',name:'Laura',provisional:false,identityConflicts:[]}},
    opportunities:{o:{id:'o',clientId:'c',product:'Onda Serena',status:'OPEN',
      nextAction:'REQUEST_QUOTE_DETAILS',environments:['sala'],quoteNumbers:[]}}
  }));
  const w=createHommyWorkspace({...v.options,teamAiAvailable:true});
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
  const first=w.ingestSignedGroupEvent(groupEvent({
    id:'conversation-a',body:'Oye Homie, ¿cómo vamos con Onda Serena?'
  }),null,{aiEnabled:true});
  assert.equal(first.status,'INFORMATION');
  assert.match(w.reserveTeamReply(first.id).text,/Onda Serena/);
  assert.equal(w.finishTeamReply(first.id,true),true);
  const second=w.ingestSignedGroupEvent(groupEvent({
    id:'conversation-b',body:'Homy, ¿y qué nos falta para concretarla?'
  }),null,{aiEnabled:true});
  assert.equal(second.status,'INFORMATION');
  assert.equal(w.teamAIRequest(second.id),null);
  const reply=w.reserveTeamReply(second.id);
  assert.match(reply.text,/faltan datos para poder cotizar/);
  assert.doesNotMatch(reply.text,/cita confirmada|precio:|573001/);
  assert.equal(reply.groupId,GROUP);
  assert.equal(w.reserveTeamReply(second.id),null);
  assert.equal(require('./hommy-workspace').extractTeamRequest('homiedesign no es una mención'),null);
});

test('follow-up memory is speaker-scoped, delivery-scoped and interrupted by an action',t=>{
  const v=setup();t.after(v.cleanup);
  const dir=path.join(v.options.dataDir,'hommy-intelligence');fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'state-v2.json'),JSON.stringify({
    version:2,clients:{c:{id:'c',name:'Laura'}},
    opportunities:{o:{id:'o',clientId:'c',product:'Onda Serena',status:'OPEN',
      nextAction:'COLLECT_VISIT_DETAILS',environments:[],quoteNumbers:[]}}
  }));
  const w=createHommyWorkspace({...v.options,teamAiAvailable:true});
  const OTHER='573009999999@c.us';
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF,OTHER],enabled:true,replyEnabled:true,aiEnabled:true}});
  const original=w.ingestSignedGroupEvent(groupEvent({id:'context-original',
    body:'Hommy, ¿cómo va Onda Serena?'}),null,{aiEnabled:true});
  assert.equal(original.status,'INFORMATION');
  // Not enough to compose a reply: WhatsApp delivery must be confirmed.
  assert.equal(w.ingestSignedGroupEvent(groupEvent({id:'context-not-yet-sent',
    body:'Hommy, ¿y qué falta?'}),null,{aiEnabled:true}).status,'AI_PENDING');
  const reply=w.reserveTeamReply(original.id);
  assert.ok(reply);
  assert.equal(w.finishTeamReply(original.id,true),true);
  const stranger=w.ingestSignedGroupEvent(groupEvent({id:'context-other',
    author:OTHER,body:'Hommy, ¿y qué falta?'}),null,{aiEnabled:true});
  assert.equal(stranger.status,'AI_PENDING');
  // The same member's more recent unanswered turn interrupts the topic chain.
  const interrupted=w.ingestSignedGroupEvent(groupEvent({id:'context-interrupted',
    body:'Hommy, ¿y qué sigue?'}),null,{aiEnabled:true});
  assert.equal(interrupted.status,'AI_PENDING');
  const fresh=w.ingestSignedGroupEvent(groupEvent({id:'context-fresh',
    body:'Hommy, ¿cómo va Onda Serena?'}),null,{aiEnabled:true});
  assert.equal(fresh.status,'INFORMATION');
  assert.ok(w.reserveTeamReply(fresh.id));
  w.finishTeamReply(fresh.id,true);
  const follow=w.ingestSignedGroupEvent(groupEvent({id:'context-visit',
    body:'Hommy, ¿y qué falta para concretarla?'}),null,{aiEnabled:true});
  assert.equal(follow.status,'INFORMATION');
  const grounded=w.reserveTeamReply(follow.id);
  assert.match(grounded.text,/visita/);
  assert.match(grounded.text,/no tengo una cita confirmada/i);
  w.finishTeamReply(follow.id,true);
  const action=w.ingestSignedGroupEvent(groupEvent({id:'context-action',
    body:'Hommy, avísale a Laura que voy en camino'}),null,{aiEnabled:true});
  assert.equal(action.status,'REVIEW_REQUIRED');
  assert.equal(w.reserveTeamReply(action.id),null);
  const afterAction=w.ingestSignedGroupEvent(groupEvent({id:'context-after-action',
    body:'Hommy, ¿y qué falta?'}),null,{aiEnabled:true});
  assert.equal(afterAction.status,'AI_PENDING');
});

test('AI conversation history never borrows a different colleague previous replies',t=>{
  const v=setup();t.after(v.cleanup);
  const OTHER='573009999999@c.us';
  const w=createHommyWorkspace({...v.options,teamAiAvailable:true});
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF,OTHER],enabled:true,replyEnabled:true,aiEnabled:true}});
  const a=w.ingestSignedGroupEvent(groupEvent({id:'history-one',
    body:'Hommy, pendientes',author:STAFF}),null,{aiEnabled:true});
  assert.equal(a.status,'INFORMATION');
  assert.ok(w.reserveTeamReply(a.id));
  w.finishTeamReply(a.id,true);
  const b=w.ingestSignedGroupEvent(groupEvent({id:'history-other',
    body:'Hommy, cotizaciones',author:OTHER}),null,{aiEnabled:true});
  assert.equal(b.status,'INFORMATION');
  assert.ok(w.reserveTeamReply(b.id));
  w.finishTeamReply(b.id,true);
  const follow=w.ingestSignedGroupEvent(groupEvent({id:'history-question',
    body:'Hommy, ¿qué podemos hacer para mejorar?',author:STAFF}),null,{aiEnabled:true});
  assert.equal(follow.status,'AI_PENDING');
  const request=w.teamAIRequest(follow.id);
  assert.equal(request.history.length,1);
  assert.match(request.history[0].question,/pendientes/);
  assert.doesNotMatch(JSON.stringify(request.history),/cotizaciones/);
});


test('context expires after ten minutes rather than guessing from an old conversation',t=>{
  const v=setup();t.after(v.cleanup);
  const folder=path.join(v.options.dataDir,'hommy-intelligence');fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder,'state-v2.json'),JSON.stringify({
    version:2,clients:{c:{id:'c',name:'Laura'}},
    opportunities:{o:{id:'o',clientId:'c',product:'Onda Serena',status:'OPEN',
      nextAction:'REQUEST_QUOTE_DETAILS',environments:[],quoteNumbers:[]}}
  }));
  const opts={...v.options,teamAiAvailable:true};
  const w=createHommyWorkspace(opts);
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
  const first=w.ingestSignedGroupEvent(groupEvent({id:'expired-original',
    body:'Homie, ¿cómo vamos con Onda Serena?'}),null,{aiEnabled:true});
  assert.equal(first.status,'INFORMATION');
  assert.ok(w.reserveTeamReply(first.id));
  w.finishTeamReply(first.id,true);
  const stateFile=path.join(v.options.dataDir,'hommy-workspace','state.json');
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const record=state.commands.find(c=>c.id===first.id);
  record.at=new Date(Date.now()-11*60*1000).toISOString();
  fs.writeFileSync(stateFile,JSON.stringify(state));
  const reloaded=createHommyWorkspace(opts);
  const late=reloaded.ingestSignedGroupEvent(groupEvent({id:'expired-followup',
    body:'Homie, ¿y qué nos falta para concretarla?'}),null,{aiEnabled:true});
  assert.equal(late.status,'AI_PENDING');
  assert.equal(reloaded.reserveTeamReply(late.id),null);
});


test('a natural catalog request sends only to the configured authorized team group',t=>{
  const v=setup();t.after(v.cleanup);
  let installed=true;
  const opts={...v.options,teamAiAvailable:true,hasDeskCatalog:()=>installed};
  const w=createHommyWorkspace(opts);
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
  const req=groupEvent({id:'send-approved-catalog',
    body:'Oye Homie, ¿me envías el catálogo de HomeEasy, por favor?'});
  const accepted=w.ingestSignedGroupEvent(req,null,{aiEnabled:true});
  assert.equal(accepted.status,'CATALOG_READY');
  assert.equal(w.teamAIRequest(accepted.id),null);
  assert.equal(w.reserveTeamReply(accepted.id),null);
  const job=w.reserveTeamCatalog(accepted.id);
  assert.deepEqual(job,{commandId:accepted.id,groupId:GROUP});
  assert.equal(w.reserveTeamCatalog(accepted.id),null);
  assert.equal(w.ingestSignedGroupEvent(req,null,{aiEnabled:true}).reason,'DUPLICATE');
  assert.equal(w.finishTeamReply(accepted.id,true),true);
  assert.equal(createHommyWorkspace(opts).reserveTeamCatalog(accepted.id),null);
  installed=false;
  const unavailable=w.ingestSignedGroupEvent(groupEvent({id:'catalog-not-installed',
    body:'Hommy, pásame el catálogo'}),null,{aiEnabled:true});
  assert.equal(unavailable.status,'INFORMATION');
  assert.match(w.reserveTeamReply(unavailable.id).text,/no tengo el catálogo PDF instalado/i);
  assert.equal(w.reserveTeamCatalog(unavailable.id),null);
});
test('catalog attachment requests cannot redirect document to customers or unknown groups',t=>{
  const v=setup();t.after(v.cleanup);
  const w=createHommyWorkspace({...v.options,teamAiAvailable:true,hasDeskCatalog:()=>true});
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
  const cases=[
    'Hommy, envía el catálogo a Laura',
    'Hommy, mándale el catálogo al cliente',
    'Hommy, envíame el catálogo y confirma una visita',
    'Hommy, enviar catálogo al celular de Camilo'
  ];
  for(const [i,body] of cases.entries()){
    const r=w.ingestSignedGroupEvent(groupEvent({id:'catalog-unsafe-'+i,body}),null,{aiEnabled:true});
    assert.equal(r.status,'REVIEW_REQUIRED',body);
    assert.equal(w.reserveTeamCatalog(r.id),null,body);
    assert.equal(w.reserveTeamReply(r.id),null,body);
    assert.equal(w.teamAIRequest(r.id),null,body);
  }
  const other=w.ingestSignedGroupEvent(groupEvent({id:'catalog-unauthorized',
    author:'573009999999@c.us',body:'Hommy, envíame el catálogo'}),null,{aiEnabled:true});
  assert.equal(other.accepted,false);
  const wrong=w.ingestSignedGroupEvent(groupEvent({id:'catalog-other-group',
    group:'120363987654321012@g.us',body:'Hommy, envíame el catálogo'}),null,{aiEnabled:true});
  assert.equal(wrong.accepted,false);
});


test('approved teammate can teach Hommy a fact only with a second confirmation',t=>{
  const v=setup();t.after(v.cleanup);
  const written=[];
  const w=createHommyWorkspace({...v.options,teamAiAvailable:true,
    saveDeskNote:(note,sender)=>{written.push({note,sender});return {id:'note_1'};}});
  const OTHER='573009999999@c.us';
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF,OTHER],enabled:true,replyEnabled:true,aiEnabled:true}});
  const suggest=w.ingestSignedGroupEvent(groupEvent({id:'teach-propose',
    body:'Oye Homie, recuerda que las citas siempre deben confirmarse con el equipo'}),null,{aiEnabled:true});
  assert.equal(suggest.status,'INFORMATION');
  assert.equal(w.teamAIRequest(suggest.id),null);
  assert.equal(w.dashboard().teamCommands[0].noteCandidate.includes('citas'),true);
  assert.equal(written.length,0);
  // An unconfirmed proposal is not memory, even after another person confirms.
  assert.ok(w.reserveTeamReply(suggest.id));
  w.finishTeamReply(suggest.id,true);
  const stranger=w.ingestSignedGroupEvent(groupEvent({id:'teach-other',
    author:OTHER,body:'Hommy guarda esa nota'}),null,{aiEnabled:true});
  assert.equal(stranger.status,'INFORMATION');
  assert.equal(written.length,0);
  const final=w.ingestSignedGroupEvent(groupEvent({id:'teach-confirm',
    body:'Hommy, sí, guarda esa nota'}),null,{aiEnabled:true});
  assert.equal(final.status,'INFORMATION');
  assert.equal(written.length,1);
  assert.equal(written[0].note.visibility,'TEAM');
  assert.equal(written[0].sender,STAFF);
  assert.match(w.reserveTeamReply(final.id).text,/quedó en mi bloc/);
  w.finishTeamReply(final.id,true);
  const repeated=w.ingestSignedGroupEvent(groupEvent({id:'teach-again',
    body:'Hommy guarda esa nota'}),null,{aiEnabled:true});
  assert.equal(repeated.status,'INFORMATION');
  assert.equal(written.length,1);
});

test('an unrelated teammate instruction interrupts a pending memory confirmation',t=>{
  const v=setup();t.after(v.cleanup);const written=[];
  const w=createHommyWorkspace({...v.options,teamAiAvailable:true,
    saveDeskNote:note=>written.push(note)});
  w.configure({team:{groupId:GROUP,allowedSenders:[STAFF],enabled:true,replyEnabled:true,aiEnabled:true}});
  const proposed=w.ingestSignedGroupEvent(groupEvent({id:'teach-old',
    body:'Hommy recuerda que las cotizaciones requieren revisión humana'}),null,{aiEnabled:true});
  w.reserveTeamReply(proposed.id);w.finishTeamReply(proposed.id,true);
  const intermission=w.ingestSignedGroupEvent(groupEvent({id:'teach-interrupted',
    body:'Hommy, pendientes'}),null,{aiEnabled:true});
  assert.equal(intermission.status,'INFORMATION');
  const after=w.ingestSignedGroupEvent(groupEvent({id:'teach-wrong-target',
    body:'Hommy guarda la nota'}),null,{aiEnabled:true});
  assert.equal(after.status,'INFORMATION');
  assert.equal(written.length,0);
});
