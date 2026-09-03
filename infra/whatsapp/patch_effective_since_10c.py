from pathlib import Path

path = Path('infra/whatsapp/bridge/server.js')
text = path.read_text(encoding='utf-8')
old = '''  const messages = conversation.normalizeMessages(rawMessages, { since: opts.since, limit });\n  const activity = conversation.normalizeActivity(ops.getActivity(150), {\n    phone,\n    since: opts.since,\n    reference\n  });\n'''
new = '''  const effectiveSince = sinceMs ? new Date(sinceMs).toISOString() : '';\n  const messages = conversation.normalizeMessages(rawMessages, { since: effectiveSince, limit });\n  const activity = conversation.normalizeActivity(ops.getActivity(150), {\n    phone,\n    since: effectiveSince,\n    reference\n  });\n'''
if old not in text and 'const effectiveSince = sinceMs ? new Date(sinceMs).toISOString()' not in text:
    raise SystemExit('effective since anchor missing')
if old in text:
    text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
