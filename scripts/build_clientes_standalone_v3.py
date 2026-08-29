from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "clientes.html"
CSS_SOURCE = ROOT / "clientes-v2-preview.css"
JS_SOURCE = ROOT / "clientes-v2-preview.js"
GUARD_SOURCE = ROOT / "homeeasy-page-guard.js"
OUTPUT = ROOT / "clientes-prueba-v2.html"

source = SOURCE.read_text(encoding="utf-8")
css = CSS_SOURCE.read_text(encoding="utf-8")
js = JS_SOURCE.read_text(encoding="utf-8")
guard = GUARD_SOURCE.read_text(encoding="utf-8")

if "#pantalla-inicio" not in source or "#pantalla-resultados" not in source:
    raise SystemExit("clientes.html no tiene la estructura esperada")
if "v2-profile-card" not in css or "buildProfile" not in js:
    raise SystemExit("Los assets visuales de Clientes 2.0 no tienen el contrato esperado")
if "PAGE_PERMISSIONS" not in guard or "clientes.read" not in guard:
    raise SystemExit("El guard actual no contiene el permiso de Clientes")

# Mantiene exactamente la pantalla inicial, quitando solo la restriccion historica
# de zoom para que la prueba sea accesible en iPhone.
source = source.replace(
    'content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"',
    'content="width=device-width, initial-scale=1.0, viewport-fit=cover"',
    1,
)

# La prueba vive en la raiz, igual que los modulos reales. No usa <base>, iframe,
# document.write ni descarga clientes.html en runtime.
source = source.replace(
    "window.history.replaceState({}, '', `clientes.html?search=${cedula}`);",
    "window.history.replaceState({}, '', 'clientes-prueba-v2.html?search=' + encodeURIComponent(cedula));",
)
source = source.replace(
    "window.history.replaceState({}, '', 'clientes.html');",
    "window.history.replaceState({}, '', 'clientes-prueba-v2.html');",
)

# El guard se incrusta dentro de ESTE HTML y usa la identidad logica clientes.html,
# de modo que conserva exactamente clientes.read sin modificar el guard compartido.
guard_pattern = re.compile(r"const currentPage = \(\(global\.location[\s\S]*?\.trim\(\);", re.M)
guard, count = guard_pattern.subn("const currentPage = 'clientes.html';", guard, count=1)
if count != 1:
    raise SystemExit("No fue posible fijar la identidad logica del guard")
guard = guard.replace("</script", "<\\/script")
external_guard = '<script src="homeeasy-page-guard.js?v=3.6"></script>'
if external_guard not in source:
    raise SystemExit("No se encontro el guard externo esperado en clientes.html")
source = source.replace(external_guard, '<script id="clientes-v2-inline-guard">\n' + guard + '\n</script>', 1)

# Marca estatica: el nuevo estilo existe antes de que se pinte la vista de resultados.
source = source.replace("<body>", '<body class="clientes-v2-preview clientes-standalone-v3">', 1)

style_block = "\n<style id=\"clientes-standalone-v3-style\">\n" + css + "\n</style>\n"
source = source.replace("</head>", style_block + "</head>", 1)

standalone_js = r'''
(function ClientesStandaloneV3Contract(){
  'use strict';
  document.documentElement.dataset.clientesBuild = 'standalone-v3-root';
  window.addEventListener('DOMContentLoaded', function(){
    var result = document.getElementById('pantalla-resultados');
    if (result) result.dataset.clientesView = 'v2-root';
  }, { once:true });
})();
'''
script_block = "\n<script id=\"clientes-standalone-v3-script\">\n" + js + "\n" + standalone_js + "\n</script>\n"
source = source.replace("</body>", script_block + "</body>", 1)

OUTPUT.write_text(source, encoding="utf-8", newline="\n")

checks = {
    "root standalone file": OUTPUT.exists() and OUTPUT.parent == ROOT,
    "same search screen": "Hommybuscando.png" in source and "Buscar Cliente" in source,
    "profile v2": "v2-profile-card" in source,
    "summary v2": "Resumen comercial" in source,
    "activity v2": "v2-history-shell" in source,
    "inline css": 'id="clientes-standalone-v3-style"' in source,
    "inline js": 'id="clientes-standalone-v3-script"' in source,
    "inline guard": 'id="clientes-v2-inline-guard"' in source and "const currentPage = 'clientes.html';" in source,
    "permission": "'clientes.html': 'clientes.read'" in source,
    "no document.write": "document.write(" not in source,
    "no source fetch": "fetch('./clientes.html" not in source and 'fetch("./clientes.html' not in source,
    "no preview iframe": "clientesPreviewFrame" not in source,
    "no base tag": "<base " not in source,
    "self history": "clientes-prueba-v2.html?search=" in source,
    "shared guard untouched": external_guard not in source,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("Contratos fallidos: " + ", ".join(failed))

print(f"Clientes standalone root generado: {OUTPUT} ({OUTPUT.stat().st_size} bytes)")
for name in checks:
    print("OK", name)
