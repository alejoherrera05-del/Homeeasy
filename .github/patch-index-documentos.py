from pathlib import Path
import re

p = Path('index.html')
text = p.read_text(encoding='utf-8')
original = text

# 1) Integrar Centro documental en Operación, antes de Agenda.
if 'href="documentos.html" class="nav-row"' not in text:
    calendar = '''                        <a href="calendario.html" class="nav-row">
                            <div class="nav-icon wine"><i class="fa-solid fa-calendar-check"></i></div>
                            <div class="nav-copy"><strong>Agenda y calendario</strong><span>Compromisos y recordatorios</span></div>
                            <i class="fa-solid fa-chevron-right nav-chevron"></i>
                        </a>'''
    documentos = '''                        <a href="documentos.html" class="nav-row">
                            <div class="nav-icon gold"><i class="fa-solid fa-folder-open"></i></div>
                            <div class="nav-copy"><strong>Centro documental</strong><span>Cuentas de cobro y paquetes</span></div>
                            <i class="fa-solid fa-chevron-right nav-chevron"></i>
                        </a>
'''
    if text.count(calendar) != 1:
        raise SystemExit(f'SAFETY STOP: expected one calendar block, found {text.count(calendar)}')
    text = text.replace(calendar, documentos + calendar, 1)

# 2) Quitar los dos bloques visibles de frases.
text, desktop_removed = re.subn(
    r'\n\s*<div class="home-quote-desktop">.*?</div>',
    '', text, count=1, flags=re.S
)
text, mobile_removed = re.subn(
    r'\n\s*<div class="home-quote-mobile" aria-label="Idea empresarial del día">.*?</div>',
    '', text, count=1, flags=re.S
)

# 3) Quitar completamente el banco de frases + función de índice diario.
marker = 'const HOMEEASY_DAILY_IDEAS = ['
if marker in text:
    start = text.index(marker)
    function_start = text.index('function actualizarPortadaHomeEasy()', start)
    text = text[:start] + text[function_start:]

# 4) Mantener saludo + fecha, pero eliminar selección/render de frase.
func_start = text.index('function actualizarPortadaHomeEasy()')
selector = text.find('    const idx = (', func_start)
if selector != -1:
    function_close = text.index('\n}', selector)
    text = text[:selector] + text[function_close:]

text = text.replace('// PORTADA EDITORIAL + IDEA EMPRESARIAL DIARIA', '// PORTADA EDITORIAL')

# Barreras de regresión.
if text.count('href="documentos.html" class="nav-row"') != 1:
    raise SystemExit('SAFETY STOP: Documentos access must exist exactly once')
if 'HOMEEASY_DAILY_IDEAS' in text or 'data-daily-quote' in text or 'data-daily-source' in text:
    raise SystemExit('SAFETY STOP: daily phrase system still present')
if '<h1 class="home-greeting" id="homeGreeting">Buenos días</h1>' not in text:
    raise SystemExit('SAFETY STOP: greeting was altered')
if '<div class="home-date" id="homeDate">Hoy</div>' not in text:
    raise SystemExit('SAFETY STOP: date was altered')
if 'HOMEEASY INDEX 4.4 — SHELLS SEPARADOS IOS 26' not in text:
    raise SystemExit('SAFETY STOP: approved Index 4.4 CSS missing')
if desktop_removed != 1 or mobile_removed != 1:
    raise SystemExit(f'SAFETY STOP: visible phrase cleanup mismatch desktop={desktop_removed} mobile={mobile_removed}')
if text.count('<script') != text.count('</script>'):
    raise SystemExit('SAFETY STOP: script tag mismatch')
if text.count('</style>') != 1:
    raise SystemExit('SAFETY STOP: style block mismatch')
if text == original:
    raise SystemExit('SAFETY STOP: patch produced no changes')

p.write_text(text, encoding='utf-8', newline='\n')
print('Index patch OK')
