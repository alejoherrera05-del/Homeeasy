from pathlib import Path
import runpy
import subprocess

root = Path(__file__).resolve().parents[1]
modified_files = (
    'index.html', 'homeeasy-core.js', 'homeeasy-auth.js',
    'cotizacion.html', 'pedido.html', 'abono.html',
    'calendario.html', 'reportes.html',
)

# The legacy HTML files use a mix of CRLF/LF. read_text() normalizes them, which
# would turn a surgical patch into a whole-file diff. Capture each file's source
# convention from Git before applying the patch, then restore it byte-for-byte.
eol_by_file = {}
for name in modified_files:
    raw = subprocess.check_output(['git', 'show', f'HEAD:{name}'], cwd=root)
    eol_by_file[name] = '\r\n' if b'\r\n' in raw else '\n'

runpy.run_path(str(root / 'scripts' / 'patch_homeeasy_performance_10g.py'), run_name='__main__')

# Normalize the click-listener boundary emitted by the strict regex replacement.
for name in ('cotizacion.html', 'pedido.html', 'abono.html'):
    path = root / name
    text = path.read_text(encoding='utf-8')
    malformed = 'document.addEventListener("click"(,'
    if malformed not in text:
        raise RuntimeError(f'{name}: optimized click-listener boundary was not found')
    text = text.replace(malformed, 'document.addEventListener("click",', 1)
    path.write_text(text, encoding='utf-8')

# Restore the original line-ending convention without touching content/spacing.
for name in modified_files:
    path = root / name
    normalized = path.read_bytes().decode('utf-8').replace('\r\n', '\n')
    eol = eol_by_file[name]
    if eol == '\r\n':
        normalized = normalized.replace('\n', '\r\n')
    path.write_bytes(normalized.encode('utf-8'))

print('HomeEasy 10G performance patch wrapper completed with source EOL preserved')
