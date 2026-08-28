from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "clientes.html"
CSS_SOURCE = ROOT / "clientes-v2-preview.css"
JS_SOURCE = ROOT / "clientes-v2-preview.js"
OUTPUT = ROOT / "clientes-prueba" / "clientes.html"

source = SOURCE.read_text(encoding="utf-8")
css = CSS_SOURCE.read_text(encoding="utf-8")
js = JS_SOURCE.read_text(encoding="utf-8")

if "#pantalla-inicio" not in source or "#pantalla-resultados" not in source:
    raise SystemExit("clientes.html no tiene la estructura esperada")
if "v2-profile-card" not in css or "buildProfile" not in js:
    raise SystemExit("Los assets visuales de Clientes 2.0 no tienen el contrato esperado")

# El archivo vive dentro de /clientes-prueba/ pero todos los recursos reales de
# HomeEasy deben resolverse desde la raiz del proyecto.
if "<base href=\"../\">" not in source:
    source = source.replace("<head>", "<head>\n    <base href=\"../\">", 1)

# Mantiene la misma pantalla inicial, pero evita el zoom forzado/limitacion de
# accesibilidad del viewport de la version historica.
source = source.replace(
    'content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"',
    'content="width=device-width, initial-scale=1.0, viewport-fit=cover"',
    1,
)

# El basename sigue siendo clientes.html, por lo que homeeasy-page-guard.js
# conserva clientes.read. Estas dos llamadas se fijan a la URL de ESTA prueba
# para no saltar accidentalmente al clientes.html de produccion por el <base>.
source = source.replace(
    "window.history.replaceState({}, '', `clientes.html?search=${cedula}`);",
    "window.history.replaceState({}, '', window.location.pathname + '?search=' + encodeURIComponent(cedula));",
)
source = source.replace(
    "window.history.replaceState({}, '', 'clientes.html');",
    "window.history.replaceState({}, '', window.location.pathname);",
)

# Marca estatica: el CSS se aplica incluso antes de que ejecute el enhancer JS.
source = source.replace("<body>", '<body class="clientes-v2-preview clientes-standalone-v2">', 1)

# El CSS y JS quedan INCRUSTADOS en el HTML. No hay iframe, document.write,
# fetch del HTML principal ni carga dinamica de la vista vieja.
style_block = "\n<style id=\"clientes-standalone-v2-style\">\n" + css + "\n</style>\n"
source = source.replace("</head>", style_block + "</head>", 1)

# Identidad explicita de la prueba para depuracion visual/QA.
standalone_js = r'''
(function ClientesStandaloneContract(){
  'use strict';
  document.documentElement.dataset.clientesBuild = 'standalone-v2';
  window.addEventListener('DOMContentLoaded', function(){
    var result = document.getElementById('pantalla-resultados');
    if (result) result.dataset.clientesView = 'v2';
  }, { once:true });
})();
'''
script_block = "\n<script id=\"clientes-standalone-v2-script\">\n" + js + "\n" + standalone_js + "\n</script>\n"
source = source.replace("</body>", script_block + "</body>", 1)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(source, encoding="utf-8", newline="\n")

# Contratos que impiden repetir el enfoque fragil anterior.
checks = {
    "standalone file": OUTPUT.exists(),
    "same search screen": "Hommybuscando.png" in source and "Buscar Cliente" in source,
    "profile v2": "v2-profile-card" in source,
    "summary v2": "Resumen comercial" in source,
    "activity v2": "v2-history-shell" in source,
    "inline css": 'id="clientes-standalone-v2-style"' in source,
    "inline js": 'id="clientes-standalone-v2-script"' in source,
    "no document.write": "document.write(" not in source,
    "no source fetch": "fetch('./clientes.html" not in source and 'fetch("./clientes.html' not in source,
    "no iframe wrapper": "clientesPreviewFrame" not in source,
    "permission filename": OUTPUT.name == "clientes.html",
    "base root": '<base href="../">' in source,
    "self history": "window.location.pathname + '?search='" in source,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("Contratos fallidos: " + ", ".join(failed))

print(f"Clientes standalone generado: {OUTPUT} ({OUTPUT.stat().st_size} bytes)")
for name in checks:
    print("OK", name)
