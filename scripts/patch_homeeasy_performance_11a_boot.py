from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'

raw = INDEX.read_bytes()
eol = '\r\n' if b'\r\n' in raw else '\n'
text = raw.decode('utf-8').replace('\r\n', '\n')


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return source.replace(old, new, 1)


text = replace_once(
    text,
    '    <script src="homeeasy-core.js?v=3.5"></script>',
    '    <script src="homeeasy-core.js?v=3.5"></script>\n'
    '    <script src="homeeasy-runtime.js?v=11a0"></script>',
    'runtime script tag',
)

old_boot_closer = '''function cerrarIntroCuandoAuthEsteLista() {
    const inicio = performance.now();
    const minimoVisualMs = 420;
    let programado = false;
    const programar = () => {
        if (programado || appIniciada) return;
        programado = true;
        const espera = Math.max(0, minimoVisualMs - (performance.now() - inicio));
        setTimeout(closeIntro, espera);
    };

    window.addEventListener('homeeasy:index-auth-ready', programar, { once: true });
    if (window.__HOMEEASY_INDEX_AUTH_READY_AT__) programar();

    // Fallback visual only. HomeEasyCore keeps its independent auth-pending gate
    // over the app until the session is actually authorized.
    setTimeout(programar, 2400);
}
'''

new_boot_closer = '''const HOMEEASY_BOOT_MIN_VISUAL_MS = 5200;
const HOMEEASY_BOOT_FAILOVER_MS = 9000;

function esperarMs(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function esperarAuthIndex() {
    if (window.__HOMEEASY_INDEX_AUTH_READY_AT__) return Promise.resolve('ready');
    return new Promise(resolve => {
        window.addEventListener('homeeasy:index-auth-ready', () => resolve('ready'), { once: true });
    });
}

function cerrarIntroCuandoBootEsteListo(warmPromise) {
    const inicio = performance.now();

    // P0: autenticación real. P1: cachés que ya existían en Index, ahora coordinadas.
    // El failover solo libera el splash: HomeEasyCore conserva su gate de seguridad.
    const authGate = Promise.race([
        esperarAuthIndex(),
        esperarMs(HOMEEASY_BOOT_FAILOVER_MS).then(() => 'auth-timeout')
    ]);
    const warmGate = Promise.race([
        Promise.resolve(warmPromise).catch(error => {
            console.warn('HomeEasy 11A: el warm-up continuará de forma degradada.', error);
            return { status: 'degraded' };
        }),
        esperarMs(HOMEEASY_BOOT_FAILOVER_MS).then(() => ({ status: 'warm-timeout' }))
    ]);

    Promise.allSettled([authGate, warmGate]).then(() => {
        const elapsed = performance.now() - inicio;
        return esperarMs(Math.max(0, HOMEEASY_BOOT_MIN_VISUAL_MS - elapsed));
    }).then(() => closeIntro());
}
'''

text = replace_once(text, old_boot_closer, new_boot_closer, 'boot closer')

pattern = re.compile(
    r'document\.addEventListener\("DOMContentLoaded", function\(\) \{[\s\S]*?\n\}\);\n\n// ==========================================\n// CAMPANA Y NOTIFICACIONES',
    re.M,
)

replacement = '''document.addEventListener("DOMContentLoaded", function() {
    const curtain = document.getElementById("intro-curtain");
    const runtime = window.HomeEasyRuntime;

    if (sessionStorage.getItem("APP_INIT_DONE") === "true") {
        if(curtain) curtain.style.display = "none";
        actualizarCampana();

        // Volver al Home conserva la navegación instantánea. Si la caché envejeció,
        // se refresca detrás sin volver a interponer el splash.
        if (runtime && typeof runtime.warmIndex === 'function') {
            runtime.warmIndex(URL_SCRIPT, { force: false, prefetch: true }).then(() => {
                actualizarCampana();
            }).catch(error => console.warn('HomeEasy 11A: refresh de fondo omitido.', error));
        }
        return;
    }

    // La animación y el guion de Hommy no cambian. Ahora cubren trabajo real.
    correrGuion();

    const warmPromise = runtime && typeof runtime.warmIndex === 'function'
        ? runtime.warmIndex(URL_SCRIPT, { force: true, prefetch: true })
        : Promise.resolve({ status: 'runtime-unavailable' });

    cerrarIntroCuandoBootEsteListo(warmPromise);
});

// ==========================================
// CAMPANA Y NOTIFICACIONES'''

text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise RuntimeError(f'index DOMContentLoaded boot block: expected 1 match, found {count}')

if 'Hommy está despertando...' not in text or 'Ajustando su gorra...' not in text:
    raise RuntimeError('11A must preserve Hommy splash messages')
if '?init=LOAD' in replacement or '?tipo=EVENTOS_TODOS' in replacement:
    raise RuntimeError('Index should delegate warm reads to HomeEasyRuntime')

if eol == '\r\n':
    text = text.replace('\n', '\r\n')
INDEX.write_bytes(text.encode('utf-8'))

print('HomeEasy 11A boot patch applied: splash preserved, warm-up coordinated')
