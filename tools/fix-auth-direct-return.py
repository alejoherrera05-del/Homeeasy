from pathlib import Path

auth_path = Path('homeeasy-auth.js')
auth = auth_path.read_text(encoding='utf-8')

replacements = [
    ("HomeEasy Auth v0.4.1", "HomeEasy Auth v0.4.2"),
    ("const VERSION = '0.4.1';", "const VERSION = '0.4.2';"),
    ("function safeReturnUrl(value, fallback) {\n        const defaultValue = String(fallback || config.homePath || 'index.html');",
     "function safeReturnUrl(value, fallback, options) {\n        const opts = { allowCurrent: false, ...(options || {}) };\n        const defaultValue = String(fallback || config.homePath || 'index.html');"),
    ("if (resolved.pathname === currentPath && resolved.search === global.location.search) return defaultValue;",
     "if (!opts.allowCurrent && resolved.pathname === currentPath && resolved.search === global.location.search) return defaultValue;"),
    ("const target = safeReturnUrl(returnUrl || currentTarget, config.homePath);",
     "const target = safeReturnUrl(returnUrl || currentTarget, config.homePath, { allowCurrent: true });")
]

for old, new in replacements:
    if old not in auth:
        raise SystemExit(f'missing auth patch marker: {old[:80]}')
    auth = auth.replace(old, new, 1)

auth_path.write_text(auth, encoding='utf-8')

for filename in ['login.html', 'activar-cuenta.html', 'homeeasy-core.js', 'homeeasy-page-guard.js']:
    path = Path(filename)
    text = path.read_text(encoding='utf-8')
    if 'homeeasy-auth.js?v=3.4' in text:
        text = text.replace('homeeasy-auth.js?v=3.4', 'homeeasy-auth.js?v=3.5')
        path.write_text(text, encoding='utf-8')

print('auth direct-return fix applied')
