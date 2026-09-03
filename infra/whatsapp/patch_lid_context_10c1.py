from pathlib import Path

server_path = Path('infra/whatsapp/bridge/server.js')
smoke_path = Path('infra/whatsapp/bridge/test-conversation-smoke.js')

server = server_path.read_text(encoding='utf-8')
smoke = smoke_path.read_text(encoding='utf-8')

server = server.replace("const BRIDGE_VERSION = '0.6.0';", "const BRIDGE_VERSION = '0.6.1';")

anchor = "async function getConversationContext(referenceValue, detail, options) {\n"
helpers = r'''function addConversationChatCandidate(target, value) {
  const candidate = String(value || '').trim();
  if (!candidate || !/@(?:c\.us|lid)$/i.test(candidate)) return;
  if (!target.includes(candidate)) target.push(candidate);
}

async function resolveConversationChatCandidates(phone) {
  const candidates = [];
  addConversationChatCandidate(candidates, `${phone}@c.us`);

  try {
    const mapped = await wahaRequest(
      'GET',
      `/api/${encodeURIComponent(WAHA_SESSION)}/lids/pn/${encodeURIComponent(phone)}`
    );
    if (mapped && typeof mapped === 'object') addConversationChatCandidate(candidates, mapped.lid);
  } catch (error) {
    const code = Number(error && error.statusCode || 0);
    if (![404, 422, 500].includes(code)) throw error;
  }

  if (!candidates.some(candidate => /@lid$/i.test(candidate))) {
    try {
      const contact = await wahaRequest(
        'GET',
        `/api/contacts?contactId=${encodeURIComponent(phone)}&session=${encodeURIComponent(WAHA_SESSION)}`
      );
      if (contact && typeof contact === 'object') {
        addConversationChatCandidate(candidates, contact.lid);
        addConversationChatCandidate(candidates, contact.id);
      }
    } catch (error) {
      const code = Number(error && error.statusCode || 0);
      if (![404, 422, 500].includes(code)) throw error;
    }
  }

  return candidates;
}

async function fetchConversationMessagesCandidate(chatId, params) {
  try {
    const data = await wahaRequest(
      'GET',
      `/api/${encodeURIComponent(WAHA_SESSION)}/chats/${encodeURIComponent(chatId)}/messages?${params.toString()}`
    );
    return { ok: true, data: Array.isArray(data) ? data : data && Array.isArray(data.data) ? data.data : data && Array.isArray(data.items) ? data.items : [] };
  } catch (error) {
    const code = Number(error && error.statusCode || 0);
    if ([404, 422, 500].includes(code)) return { ok: false, status: code, data: [] };
    throw error;
  }
}

'''
if helpers not in server:
    if anchor not in server:
        raise SystemExit('server helper anchor not found')
    server = server.replace(anchor, helpers + anchor, 1)

old_chat = "  const phone = normalizePhone(client.telefono || followup.telefono || '');\n  const chatId = `${phone}@c.us`;\n  const limit = Math.max(1, Math.min(80, Number(opts.limit || 50)));"
new_chat = "  const phone = normalizePhone(client.telefono || followup.telefono || '');\n  const chatCandidates = await resolveConversationChatCandidates(phone);\n  const limit = Math.max(1, Math.min(80, Number(opts.limit || 50)));"
if old_chat in server:
    server = server.replace(old_chat, new_chat, 1)
elif new_chat not in server:
    raise SystemExit('server chat candidate anchor not found')

old_fetch = r'''  let rawMessages = [];
  try {
    rawMessages = await wahaRequest(
      'GET',
      `/api/${encodeURIComponent(WAHA_SESSION)}/chats/${encodeURIComponent(chatId)}/messages?${params.toString()}`
    );
  } catch (error) {
    if (Number(error.statusCode || 0) !== 404) throw error;
  }

  const effectiveSince = sinceMs ? new Date(sinceMs).toISOString() : '';
'''
new_fetch = r'''  const rawMessages = [];
  let successfulQueries = 0;
  let failedQueries = 0;
  for (const chatId of chatCandidates) {
    const result = await fetchConversationMessagesCandidate(chatId, params);
    if (result.ok) successfulQueries += 1;
    else failedQueries += 1;
    if (Array.isArray(result.data)) rawMessages.push(...result.data);
  }

  const effectiveSince = sinceMs ? new Date(sinceMs).toISOString() : '';
'''
if old_fetch in server:
    server = server.replace(old_fetch, new_fetch, 1)
elif new_fetch not in server:
    raise SystemExit('server fetch anchor not found')

old_response = r'''    activity,
    evidence,
    serverTime: new Date().toISOString()
'''
new_response = r'''    activity,
    evidence,
    lookup: {
      candidateCount: chatCandidates.length,
      lidResolved: chatCandidates.some(candidate => /@lid$/i.test(candidate)),
      successfulQueries,
      failedQueries
    },
    serverTime: new Date().toISOString()
'''
if old_response in server:
    server = server.replace(old_response, new_response, 1)
elif new_response not in server:
    raise SystemExit('server response anchor not found')

if "const TEST_LID = '123456789012345@lid';" not in smoke:
    smoke = smoke.replace("const TEST_PHONE = '573001112233';", "const TEST_PHONE = '573001112233';\nconst TEST_LID = '123456789012345@lid';", 1)

old_waha = r'''  const expectedPath = `/api/homeeasy/chats/${TEST_PHONE}@c.us/messages`;
  if (req.method === 'GET' && decodeURIComponent(url.pathname) === expectedPath) {
    assert.equal(url.searchParams.get('downloadMedia'), 'false');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.ok(Number(url.searchParams.get('filter.timestamp.gte')) > 0);
    return json(res, 200, [
      {
        id: 'out-1',
        timestamp: 1788296400,
        fromMe: true,
        body: 'Te compartimos tu Cotización COT-32.',
        hasMedia: true,
        media: { mimetype: 'application/pdf', filename: 'Cotizacion_COT-32.pdf' },
        ackName: 'READ'
      },
      {
        id: 'out-2',
        timestamp: 1788296460,
        fromMe: true,
        body: 'Quedamos atentos a cualquier duda.',
        hasMedia: false
      }
    ]);
  }
'''
new_waha = r'''  const lidLookupPath = `/api/homeeasy/lids/pn/${TEST_PHONE}`;
  if (req.method === 'GET' && decodeURIComponent(url.pathname) === lidLookupPath) {
    return json(res, 200, { lid: TEST_LID, pn: `${TEST_PHONE}@c.us` });
  }
  const expectedPnPath = `/api/homeeasy/chats/${TEST_PHONE}@c.us/messages`;
  if (req.method === 'GET' && decodeURIComponent(url.pathname) === expectedPnPath) {
    assert.equal(url.searchParams.get('downloadMedia'), 'false');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.ok(Number(url.searchParams.get('filter.timestamp.gte')) > 0);
    return json(res, 200, [
      {
        id: 'out-1',
        timestamp: 1788296400,
        fromMe: true,
        body: 'Te compartimos tu Cotización COT-32.',
        hasMedia: true,
        media: { mimetype: 'application/pdf', filename: 'Cotizacion_COT-32.pdf' },
        ackName: 'READ'
      }
    ]);
  }
  const expectedLidPath = `/api/homeeasy/chats/${TEST_LID}/messages`;
  if (req.method === 'GET' && decodeURIComponent(url.pathname) === expectedLidPath) {
    assert.equal(url.searchParams.get('downloadMedia'), 'false');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.ok(Number(url.searchParams.get('filter.timestamp.gte')) > 0);
    return json(res, 200, [
      {
        id: 'out-2',
        timestamp: 1788296460,
        key: { id: 'out-2', fromMe: true },
        body: 'Quedamos atentos a cualquier duda.',
        hasMedia: false
      }
    ]);
  }
'''
if old_waha in smoke:
    smoke = smoke.replace(old_waha, new_waha, 1)
elif new_waha not in smoke:
    raise SystemExit('smoke WAHA anchor not found')

old_asserts = "    assert.equal(payload.evidence.outgoingCount, 2);\n    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'phone'), false);"
new_asserts = "    assert.equal(payload.evidence.outgoingCount, 2);\n    assert.equal(payload.lookup.candidateCount, 2);\n    assert.equal(payload.lookup.lidResolved, true);\n    assert.equal(payload.lookup.successfulQueries, 2);\n    assert.equal(payload.lookup.failedQueries, 0);\n    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'phone'), false);"
if old_asserts in smoke:
    smoke = smoke.replace(old_asserts, new_asserts, 1)
elif new_asserts not in smoke:
    raise SystemExit('smoke assertion anchor not found')

server_path.write_text(server, encoding='utf-8')
smoke_path.write_text(smoke, encoding='utf-8')
print('LID-aware WhatsApp context patch applied')
