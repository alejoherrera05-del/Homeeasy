from pathlib import Path


def patch(path, replacements):
    p = Path(path)
    raw = p.read_bytes()
    text = raw.decode('utf-8')
    newline = '\r\n' if b'\r\n' in raw else '\n'
    s = text.replace('\r\n', '\n')
    original = s
    for old, new in replacements:
        if old not in s:
            raise SystemExit(f'missing marker in {path}: {old[:100]}')
        s = s.replace(old, new, 1)
    if s == original:
        raise SystemExit(f'no changes in {path}')
    out = s if newline == '\n' else s.replace('\n', '\r\n')
    p.write_bytes(out.encode('utf-8'))
    print('PATCHED', path)

patch('homeeasy-docs.js', [
    ('"documentos.pie_sistema": "Documento generado automáticamente • Sistema Hommy V2.0",',
     '"documentos.pie_sistema": "Documento generado automáticamente • Sistema Hommy V3.0",'),
    ('  function escapeHtml(value) {',
     '  function normalizePublicVersion(value) {\n    return clean(value)\n      .replace(/\\bV2\\.0\\b/gi, "V3.0")\n      .replace(/\\b2\\.0\\b/g, "3.0");\n  }\n\n  function escapeHtml(value) {'),
    ('    setText("footer-system-line", key(cfg, "documentos.pie_sistema"));',
     '    setText("footer-system-line", normalizePublicVersion(key(cfg, "documentos.pie_sistema")));'),
])

patch('configuracion.html', [
    ('        function applyConfiguration(response) {',
     '        function normalizePublicVersionLabel(value) {\n            return String(value == null ? "" : value)\n                .replace(/\\bV2\\.0\\b/gi, "V3.0")\n                .replace(/\\b2\\.0\\b/g, "3.0");\n        }\n\n        function applyConfiguration(response) {'),
    ('                const value = flat[key];',
     '                const rawValue = flat[key];\n                const value = key === "documentos.pie_sistema" ? normalizePublicVersionLabel(rawValue) : rawValue;'),
    ("            document.getElementById('appVersion').textContent = HomeEasyCore.getByPath(configuration, 'sistema.version_app', '—');",
     "            document.getElementById('appVersion').textContent = '3.0';"),
    ("                    values[key] = String(element.value || '').trim();",
     "                    const textValue = String(element.value || '').trim();\n                    values[key] = key === 'documentos.pie_sistema' ? normalizePublicVersionLabel(textValue) : textValue;"),
    ('homeeasy-docs.js?v=4.1', 'homeeasy-docs.js?v=4.2'),
])

for path in ['abono.html', 'cotizacion.html', 'pedido.html']:
    patch(path, [('homeeasy-docs.js?v=4.1', 'homeeasy-docs.js?v=4.2')])
