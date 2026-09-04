from pathlib import Path
import runpy

root = Path(__file__).resolve().parents[1]
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

print('HomeEasy 10G performance patch wrapper completed')
