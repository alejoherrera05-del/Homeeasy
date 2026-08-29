from pathlib import Path

p = Path('configuracion.html')
raw = p.read_bytes()
text = raw.decode('utf-8')
newline = '\r\n' if b'\r\n' in raw else '\n'
s = text.replace('\r\n', '\n')

old = '''    <script src="homeeasy-docs.js?v=4.2"></script>\n    <script src="homeeasy-account-template.js?v=3.2"></script>\n'''
new = '''    <script src="homeeasy-docs.js?v=4.2"></script>\n    <script src="homeeasy-account-template.js?v=3.2"></script>\n    <script src="homeeasy-whatsapp-client.js?v=0.2"></script>\n    <script src="homeeasy-whatsapp-settings.js?v=0.2"></script>\n'''

if 'homeeasy-whatsapp-client.js?v=0.2' in s and 'homeeasy-whatsapp-settings.js?v=0.2' in s:
    print('Already patched')
    raise SystemExit(0)
if old not in s:
    raise SystemExit('Configuracion script marker not found')
s = s.replace(old, new, 1)
out = s if newline == '\n' else s.replace('\n', '\r\n')
p.write_bytes(out.encode('utf-8'))
print('Patched Configuracion in isolated branch')
