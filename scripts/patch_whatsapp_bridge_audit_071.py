from pathlib import Path

server_path = Path('infra/whatsapp/bridge/server.js')
source = server_path.read_text(encoding='utf-8')

if source.count("const BRIDGE_VERSION = '0.7.0';") != 1:
    raise SystemExit('Bridge version anchor mismatch')
source = source.replace("const BRIDGE_VERSION = '0.7.0';", "const BRIDGE_VERSION = '0.7.1';", 1)

anchor = "function publicFollowupDelivery(record, duplicate) {\n"
if source.count(anchor) != 1:
    raise SystemExit('publicFollowupDelivery anchor mismatch')
helper = r'''function normalizeMessageIdValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    const clean = String(value).trim();
    return clean && clean !== '[object Object]' ? clean : null;
  }
  if (typeof value !== 'object') return null;
  const candidates = [
    value._serialized,
    value.id,
    value.messageId,
    value.key && value.key.id,
    value.key && value.key._serialized
  ];
  for (const candidate of candidates) {
    const normalized = normalizeMessageIdValue(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function extractMessageId(result) {
  if (!result || typeof result !== 'object') return normalizeMessageIdValue(result);
  const candidates = [result.id, result.messageId, result.key, result.key && result.key.id];
  for (const candidate of candidates) {
    const normalized = normalizeMessageIdValue(candidate);
    if (normalized) return normalized;
  }
  return null;
}

'''
source = source.replace(anchor, helper + anchor, 1)

old_assign = "record.messageId = result && (result.id || result.key || result.messageId) || null;"
count = source.count(old_assign)
if count < 2:
    raise SystemExit(f'Expected at least 2 messageId assignments, found {count}')
source = source.replace(old_assign, "record.messageId = extractMessageId(result);")

old_inline = "messageId: result && (result.id || result.key || result.messageId) || null,"
source = source.replace(old_inline, "messageId: extractMessageId(result),")

old_public = "    messageId: record.messageId || null,\n"
if source.count(old_public) < 1:
    raise SystemExit('public messageId anchor missing')
source = source.replace(old_public, "    messageId: normalizeMessageIdValue(record.messageId),\n")

server_path.write_text(source, encoding='utf-8')

updater_path = Path('infra/whatsapp/update-bridge.sh')
updater = updater_path.read_text(encoding='utf-8')
if updater.count('EXPECTED_VERSION="0.7.0"') != 1:
    raise SystemExit('Updater version anchor mismatch')
updater_path.write_text(updater.replace('EXPECTED_VERSION="0.7.0"', 'EXPECTED_VERSION="0.7.1"', 1), encoding='utf-8')

# Exercise the real send smoke with the object-shaped ID WAHA/WebJS may return.
smoke_path = Path('infra/whatsapp/bridge/test-followup-send-smoke.js')
smoke = smoke_path.read_text(encoding='utf-8')
old_smoke = "    return json(res, 200, { id: `msg-${sendCount}` });"
new_smoke = "    return json(res, 200, { id: { _serialized: `msg-${sendCount}`, id: `inner-${sendCount}` } });"
if smoke.count(old_smoke) != 1:
    raise SystemExit(f'Follow-up smoke ID anchor mismatch: {smoke.count(old_smoke)}')
smoke_path.write_text(smoke.replace(old_smoke, new_smoke, 1), encoding='utf-8')

# Permanent CI must certify the deployed version after merge to main.
for workflow_name in ('whatsapp-context-qa.yml', 'whatsapp-followup-send-10d-qa.yml'):
    path = Path('.github/workflows') / workflow_name
    text = path.read_text(encoding='utf-8')
    if '0.7.0' not in text:
        raise SystemExit(f'{workflow_name}: expected old Bridge version anchor')
    path.write_text(text.replace('0.7.0', '0.7.1'), encoding='utf-8')
