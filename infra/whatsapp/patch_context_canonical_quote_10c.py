from pathlib import Path

# Harden auth.js with a canonical HomeEasy detail read tied to the same user session/device.
auth_path = Path('infra/whatsapp/bridge/auth.js')
auth = auth_path.read_text(encoding='utf-8')
anchor = '\nfunction assertPermission(actor, required) {\n'
helper = r'''
async function readFollowupDetail(req, number) {
  const token = String(req && req.headers && req.headers['x-homeeasy-session'] || '').trim();
  const deviceMeta = requestDeviceMeta(req);
  if (!token) throw authError('HomeEasy session required', 401);
  if (!deviceMeta.dispositivoId) {
    throw authError('HomeEasy device context required', 401, { code: 'DEVICE_CONTEXT_REQUIRED' });
  }

  const quoteNumber = String(number || '').trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(quoteNumber)) {
    throw authError('Invalid quote reference', 400, { code: 'FOLLOWUP_QUOTE_INVALID' });
  }

  let response;
  try {
    response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        tipo: 'GET_SEGUIMIENTO_DETALLE',
        numero: quoteNumber,
        limiteEventos: 1,
        appSessionToken: token,
        meta: {
          dispositivoId: deviceMeta.dispositivoId,
          dispositivoNombre: String(deviceMeta.dispositivoNombre || 'HomeEasy Web').trim().slice(0, 120),
          plataforma: String(deviceMeta.plataforma || '').trim().slice(0, 80),
          navegador: String(deviceMeta.navegador || '').trim().slice(0, 80),
          pagina: 'whatsapp-bridge-context',
          versionApp: '0.6.0',
          origen: 'HomeEasy WhatsApp Bridge'
        }
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(18000)
    });
  } catch (_) {
    throw authError('HomeEasy follow-up service unavailable', 502, { code: 'FOLLOWUP_UPSTREAM_UNAVAILABLE' });
  }

  const text = await response.text().catch(() => '');
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!response.ok || !data) {
    throw authError('HomeEasy follow-up service returned an invalid response', 502, { code: 'FOLLOWUP_UPSTREAM_INVALID' });
  }
  if (data.status === 'not_found') {
    throw authError('Quote not found', 404, { code: 'FOLLOWUP_QUOTE_NOT_FOUND' });
  }
  if (data.status !== 'ok') {
    const code = String(data.code || '').trim();
    if (code === 'PERMISSION_DENIED') throw authError('HomeEasy permission denied', 403, { code });
    if (['APP_SESSION_EXPIRED', 'APP_SESSION_REJECTED', 'NO_SESSION'].includes(code)) {
      throw authError('HomeEasy session is not valid', 401, { code });
    }
    throw authError('HomeEasy follow-up detail unavailable', 502, code ? { code } : undefined);
  }
  return data;
}

'''
if 'async function readFollowupDetail(' not in auth:
    if anchor not in auth:
        raise SystemExit('auth assertPermission anchor missing')
    auth = auth.replace(anchor, helper + anchor, 1)
export_anchor = '  authorize,\n  assertPermission,\n'
if '  readFollowupDetail,\n' not in auth:
    if export_anchor not in auth:
        raise SystemExit('auth export anchor missing')
    auth = auth.replace(export_anchor, '  authorize,\n  readFollowupDetail,\n  assertPermission,\n', 1)
auth_path.write_text(auth, encoding='utf-8')

# Harden server.js: the public route accepts only a quote reference and derives phone/date canonically.
server_path = Path('infra/whatsapp/bridge/server.js')
server = server_path.read_text(encoding='utf-8')
old_helper_start = 'async function getConversationContext(phoneValue, options) {'
new_helper_start = 'async function getConversationContext(referenceValue, detail, options) {'
server = server.replace(old_helper_start, new_helper_start, 1)
server = server.replace(
    '''  const phone = normalizePhone(phoneValue);\n  const chatId = `${phone}@c.us`;\n  const limit = Math.max(1, Math.min(80, Number(opts.limit || 50)));\n  const sinceMs = conversation.timestampMs(opts.since);\n''',
    '''  const reference = canonicalQuoteReference(referenceValue);\n  const client = detail && detail.cliente && typeof detail.cliente === 'object' ? detail.cliente : {};\n  const followup = detail && detail.seguimiento && typeof detail.seguimiento === 'object' ? detail.seguimiento : {};\n  const quote = detail && detail.cotizacion && typeof detail.cotizacion === 'object' ? detail.cotizacion : {};\n  const phone = normalizePhone(client.telefono || followup.telefono || '');\n  const chatId = `${phone}@c.us`;\n  const limit = Math.max(1, Math.min(80, Number(opts.limit || 50)));\n  const quoteMs = conversation.timestampMs(quote.fecha);\n  const canonicalSinceMs = quoteMs ? Math.max(0, quoteMs - 7 * 24 * 60 * 60 * 1000) : 0;\n  const requestedSinceMs = conversation.timestampMs(opts.since);\n  const sinceMs = Math.max(canonicalSinceMs, requestedSinceMs || 0);\n''',
    1,
)
server = server.replace(
    '''    reference: opts.reference\n''',
    '''    reference\n''',
    1,
)
server = server.replace(
    '''    source: 'WAHA_WEBJS',\n    session: WAHA_SESSION,\n''',
    '''    source: 'WAHA_WEBJS',\n    reference,\n    session: WAHA_SESSION,\n''',
    1,
)

permission_anchor = 'function documentPermission(payload, actor) {'
canonical_helper = r'''function canonicalQuoteReference(value) {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/^COT\s*[-:#]?\s*([A-Z0-9._-]{1,80})$/i);
  if (!match) throw Object.assign(new Error('Invalid quote reference'), { statusCode: 400 });
  return `COT-${match[1]}`;
}

function quoteNumberFromReference(value) {
  return canonicalQuoteReference(value).slice(4);
}

'''
if 'function canonicalQuoteReference(' not in server:
    if permission_anchor not in server:
        raise SystemExit('server documentPermission anchor missing')
    server = server.replace(permission_anchor, canonical_helper + permission_anchor, 1)

old_route = '''  if (req.method === 'GET' && url.pathname === '/api/whatsapp/conversation') {\n    await auth.authorize(req, 'cotizaciones.read');\n    const result = await getConversationContext(url.searchParams.get('phone') || '', {\n      reference: url.searchParams.get('reference') || '',\n      since: url.searchParams.get('since') || '',\n      limit: url.searchParams.get('limit') || 50\n    });\n    return json(res, 200, result);\n  }\n'''
new_route = '''  if (req.method === 'GET' && url.pathname === '/api/whatsapp/conversation') {\n    await auth.authorize(req, 'cotizaciones.read');\n    const reference = canonicalQuoteReference(url.searchParams.get('reference') || '');\n    const detail = await auth.readFollowupDetail(req, quoteNumberFromReference(reference));\n    const result = await getConversationContext(reference, detail, {\n      since: url.searchParams.get('since') || '',\n      limit: url.searchParams.get('limit') || 50\n    });\n    return json(res, 200, result);\n  }\n'''
if old_route in server:
    server = server.replace(old_route, new_route, 1)
elif 'const detail = await auth.readFollowupDetail' not in server:
    raise SystemExit('conversation route anchor missing')

server_path.write_text(server, encoding='utf-8')
