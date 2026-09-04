from pathlib import Path

path = Path('scripts/patch_seguimiento_fluid_10f.py')
source = path.read_text(encoding='utf-8')
old = '''if page.count('seguimiento-hommy.js?v=10e1') != 1 or page.count('seguimiento-hommy.js?v=10e1-retry') != 1:\n    raise SystemExit('seguimiento.html 10e1 asset anchors did not match exactly')\npage = page.replace('seguimiento-hommy.js?v=10e1-retry', 'seguimiento-hommy.js?v=10f1-retry', 1)\npage = page.replace('seguimiento-hommy.js?v=10e1', 'seguimiento-hommy.js?v=10f1', 1)\n'''
new = '''main_asset = '<script src="seguimiento-hommy.js?v=10e1" defer></script>'\nretry_asset = "retry.src = 'seguimiento-hommy.js?v=10e1-retry';"\nif page.count(main_asset) != 1 or page.count(retry_asset) != 1:\n    raise SystemExit(f'seguimiento.html 10e1 asset anchors mismatch: main={page.count(main_asset)} retry={page.count(retry_asset)}')\npage = page.replace(retry_asset, "retry.src = 'seguimiento-hommy.js?v=10f1-retry';", 1)\npage = page.replace(main_asset, '<script src="seguimiento-hommy.js?v=10f1" defer></script>', 1)\n'''
if source.count(old) != 1:
    raise SystemExit(f'patch asset block mismatch: {source.count(old)}')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
