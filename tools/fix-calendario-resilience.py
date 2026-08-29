from pathlib import Path

p = Path('calendario.html')
s = p.read_text(encoding='utf-8')

replacements = [
    ('<span class="material-icons-round" onclick="abrirBuscador()">search</span>', '<i class="fas fa-search header-action-icon" onclick="abrirBuscador()" role="button" aria-label="Buscar"></i>'),
    ('<span class="material-icons-round" onclick="abrirProximos()">upcoming</span>', '<i class="fas fa-calendar-check header-action-icon" onclick="abrirProximos()" role="button" aria-label="Próximas tareas"></i>'),
    ('<span class="material-icons-round month-nav" onclick="changeMonth(-1)">chevron_left</span>', '<i class="fas fa-chevron-left month-nav" onclick="changeMonth(-1)" role="button" aria-label="Mes anterior"></i>'),
    ('<span class="material-icons-round month-nav" onclick="changeMonth(1)">chevron_right</span>', '<i class="fas fa-chevron-right month-nav" onclick="changeMonth(1)" role="button" aria-label="Mes siguiente"></i>'),
    ('<span class="material-icons-round">add</span>', '<i class="fas fa-plus" aria-hidden="true"></i>'),
    ('<span class="material-icons-round" onclick="cerrarBuscador()" style="cursor:pointer; color: var(--primary-wine); font-size: 28px;">arrow_back</span>', '<i class="fas fa-arrow-left" onclick="cerrarBuscador()" role="button" aria-label="Cerrar buscador" style="cursor:pointer; color: var(--primary-wine); font-size: 24px;"></i>'),
    ('<span class="material-icons-round" onclick="cerrarProximos()" style="cursor:pointer; color: var(--primary-wine); font-size: 28px;">arrow_back</span>', '<i class="fas fa-arrow-left" onclick="cerrarProximos()" role="button" aria-label="Cerrar próximas tareas" style="cursor:pointer; color: var(--primary-wine); font-size: 24px;"></i>'),
]

for old, new in replacements:
    if old not in s:
        raise SystemExit(f'missing markup marker: {old[:90]}')
    s = s.replace(old, new, 1)

s = s.replace('.header-icons span { color: var(--primary-wine); font-size: 24px; cursor: pointer; padding: 5px; }',
              '.header-icons .header-action-icon { color: var(--primary-wine); font-size: 20px; cursor: pointer; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; transition: background .16s ease, transform .16s ease; }\n        .header-icons .header-action-icon:active { background: rgba(166,69,90,.08); transform: scale(.94); }', 1)
s = s.replace('.fab .material-icons-round { font-size: 32px; }', '.fab i { font-size: 26px; }', 1)
s = s.replace('.fab .material-icons-round { font-size: 28px; }', '.fab i { font-size: 23px; }', 1)

old_init = '''    async function inicializarCalendario() {
        const cacheEventos = localStorage.getItem('CACHE_EVENTOS');
        if (cacheEventos) {
            try { eventosGlobales = JSON.parse(cacheEventos); procesarEventosLocales(); } catch(e) {}
        }
        try {
            const response = await fetch(`${WEBAPP_URL}?tipo=EVENTOS_TODOS`);
            const data = await response.json();
            if (data.eventos) {
                eventosGlobales = data.eventos;
                localStorage.setItem('CACHE_EVENTOS', JSON.stringify(eventosGlobales));
                procesarEventosLocales(); 
            }
        } catch(e) { console.log("Modo offline."); }
    }'''

new_init = '''    async function inicializarCalendario() {
        // El calendario base debe existir aun sin caché o conexión.
        // Antes dependía de que EVENTOS_TODOS respondiera para pintar el mes.
        procesarEventosLocales();

        const cacheEventos = localStorage.getItem('CACHE_EVENTOS');
        if (cacheEventos) {
            try {
                const parsed = JSON.parse(cacheEventos);
                if (Array.isArray(parsed)) eventosGlobales = parsed;
                procesarEventosLocales();
            } catch(e) {
                console.warn("Caché de agenda inválida; se continúa con calendario vacío.");
            }
        }

        try {
            const response = await fetch(`${WEBAPP_URL}?tipo=EVENTOS_TODOS`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (Array.isArray(data.eventos)) {
                eventosGlobales = data.eventos;
                localStorage.setItem('CACHE_EVENTOS', JSON.stringify(eventosGlobales));
                procesarEventosLocales();
            }
        } catch(e) {
            console.log("Agenda en modo local/offline.", e);
            // No borrar la cuadrícula: ya fue renderizada arriba con caché o estado vacío.
        }
    }'''

if old_init not in s:
    raise SystemExit('initialization marker missing')
s = s.replace(old_init, new_init, 1)

# Accessibility/robustness for icon buttons and month controls.
extra_css = '''

        /* Calendario: controles sin dependencia de Material Icons */
        .month-nav { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; }
        .month-nav:active { background: rgba(194,164,104,.10); transform: scale(.94); }
        .fab i, .month-nav, .header-action-icon { line-height: 1; }
'''
marker = '        /* Enlace directo desde la campana del inicio */'
if marker not in s:
    raise SystemExit('css insertion marker missing')
s = s.replace(marker, extra_css + '\n' + marker, 1)

# Version marker for cache busting/audit.
s = s.replace('<title>Calendario - Sistema Hommy</title>', '<title>Calendario - Sistema Hommy</title>\n    <!-- calendario-resilience-v2 -->', 1)

p.write_text(s, encoding='utf-8')
print('calendar resilience patch applied')
