from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = ('index.html', 'clientes.html', 'cotizacion.html', 'pedido.html')
CORE = '<script src="homeeasy-core.js?v=3.5"></script>'
RUNTIME = '<script src="homeeasy-runtime.js?v=11a0"></script>'
CACHE = '<script src="homeeasy-runtime-cache.js?v=11a2"></script>'
GUARD = '<script src="homeeasy-page-guard.js?v=3.6"></script>'


def read(path):
    raw = path.read_bytes()
    eol = '\r\n' if b'\r\n' in raw else '\n'
    return raw.decode('utf-8').replace('\r\n', '\n'), eol


def write(path, text, eol):
    if eol == '\r\n':
        text = text.replace('\n', '\r\n')
    path.write_bytes(text.encode('utf-8'))


def insert_after_once(text, anchor, addition, label):
    if addition in text:
        return text
    count = text.count(anchor)
    if count != 1:
        raise RuntimeError(f'{label}: expected one anchor, found {count}')
    return text.replace(anchor, anchor + '\n    ' + addition, 1)


for filename in PAGES:
    path = ROOT / filename
    text, eol = read(path)

    if filename == 'index.html':
        text = insert_after_once(text, RUNTIME, CACHE, filename)
    else:
        text = insert_after_once(text, CORE, RUNTIME, filename)
        text = insert_after_once(text, RUNTIME, CACHE, filename)

    if text.count(CACHE) != 1:
        raise RuntimeError(f'{filename}: expected one 11A.2 cache script, found {text.count(CACHE)}')
    if text.count(RUNTIME) != 1:
        raise RuntimeError(f'{filename}: expected one base runtime, found {text.count(RUNTIME)}')

    if filename != 'index.html':
        positions = [text.index(CORE), text.index(RUNTIME), text.index(CACHE), text.index(GUARD)]
        if positions != sorted(positions):
            raise RuntimeError(f'{filename}: security load order must be Core -> Runtime -> Cache -> Page Guard')

    write(path, text, eol)

print('HomeEasy 11A.2 page wiring applied safely')
