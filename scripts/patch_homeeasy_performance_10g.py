from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def write(name, text):
    (ROOT / name).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, repl, label, flags=0):
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return out


# -----------------------------------------------------------------------------
# Index: remove artificial splash wait, preserve auth gate, improve asset hints.
# -----------------------------------------------------------------------------
text = read("index.html")
text = replace_once(
    text,
    '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">',
    '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n'
    '<link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>\n'
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">',
    "index preconnects",
)
text = replace_once(
    text,
    'transition: opacity 0.8s ease, visibility 0.8s ease;',
    'transition: opacity 0.35s ease, visibility 0.35s ease;',
    "index intro transition",
)
text = replace_once(
    text,
    '<img src="banner2.png" class="home-hero-media" alt="Hommy saludando en HomeEasy"',
    '<img src="banner2.png" class="home-hero-media" alt="Hommy saludando en HomeEasy" fetchpriority="high" decoding="async"',
    "index hero image priority",
)
text = replace_once(
    text,
    '<img src="Hommypiedepagina.png" alt="Hommy" class="footer-logo">',
    '<img src="Hommypiedepagina.png" alt="Hommy" class="footer-logo" loading="lazy" decoding="async">',
    "index footer lazy image",
)
text = replace_once(
    text,
    '''    setTimeout(() => {\n        if(curtain) {\n            curtain.classList.add("curtain-hidden");\n            sessionStorage.setItem("APP_INIT_DONE", "true");\n            actualizarCampana(); \n            setTimeout(() => { curtain.style.display = "none"; }, 1000);\n        }\n    }, 800);''',
    '''    setTimeout(() => {\n        if(curtain) {\n            curtain.classList.add("curtain-hidden");\n            sessionStorage.setItem("APP_INIT_DONE", "true");\n            actualizarCampana();\n            setTimeout(() => { curtain.style.display = "none"; }, 420);\n        }\n    }, 180);''',
    "index closeIntro timing",
)
text = replace_once(
    text,
    '''function correrGuion() {\n    const progressBar = document.getElementById("progress-bar");\n    const statusMessage = document.getElementById("status-message");\n    guionCarga.forEach(escena => {\n        setTimeout(() => {\n            if (!appIniciada) {\n                if(statusMessage) statusMessage.innerText = escena.texto;\n                if(progressBar) progressBar.style.width = escena.progreso;\n            }\n        }, escena.tiempo);\n    });\n}\n''',
    '''function correrGuion() {\n    const progressBar = document.getElementById("progress-bar");\n    const statusMessage = document.getElementById("status-message");\n    guionCarga.forEach(escena => {\n        setTimeout(() => {\n            if (!appIniciada) {\n                if(statusMessage) statusMessage.innerText = escena.texto;\n                if(progressBar) progressBar.style.width = escena.progreso;\n            }\n        }, escena.tiempo);\n    });\n}\n\nfunction cerrarIntroCuandoAuthEsteLista() {\n    const inicio = performance.now();\n    const minimoVisualMs = 420;\n    let programado = false;\n    const programar = () => {\n        if (programado || appIniciada) return;\n        programado = true;\n        const espera = Math.max(0, minimoVisualMs - (performance.now() - inicio));\n        setTimeout(closeIntro, espera);\n    };\n\n    window.addEventListener('homeeasy:index-auth-ready', programar, { once: true });\n    if (window.__HOMEEASY_INDEX_AUTH_READY_AT__) programar();\n\n    // Fallback visual only. HomeEasyCore keeps its independent auth-pending gate\n    // over the app until the session is actually authorized.\n    setTimeout(programar, 2400);\n}\n''',
    "index auth-ready intro helper",
)
text = replace_once(
    text,
    '''    correrGuion();\n    setTimeout(() => { closeIntro(); }, 5500); ''',
    '''    correrGuion();\n    cerrarIntroCuandoAuthEsteLista();''',
    "index artificial 5.5s splash",
)
text = text.replace('            setTimeout(closeIntro, 500); \n', '')
text = text.replace('            setTimeout(closeIntro, 1000);\n', '')
write("index.html", text)


# -----------------------------------------------------------------------------
# Core/Auth: expose auth-ready timing only for coordination; defer presence ping.
# -----------------------------------------------------------------------------
text = read("homeeasy-core.js")
text = replace_once(
    text,
    '''    function revealAuthenticatedIndex() {\n        indexAuthStatus = 'authorized';''',
    '''    function revealAuthenticatedIndex() {\n        indexAuthStatus = 'authorized';\n        global.__HOMEEASY_INDEX_AUTH_READY_AT__ = Date.now();''',
    "core auth-ready marker",
)
write("homeeasy-core.js", text)

text = read("homeeasy-auth.js")
text = replace_once(
    text,
    '''        global.setTimeout(() => { touchPresence(); }, 900);\n        presenceTimer = global.setInterval(() => { if (!global.document || !global.document.hidden) touchPresence(); }, PRESENCE_INTERVAL_MS);''',
    '''        const firstPresence = () => {\n            if (!global.document || !global.document.hidden) touchPresence();\n        };\n        if (typeof global.requestIdleCallback === 'function') {\n            global.requestIdleCallback(firstPresence, { timeout: 5000 });\n        } else {\n            global.setTimeout(firstPresence, 3500);\n        }\n        presenceTimer = global.setInterval(() => { if (!global.document || !global.document.hidden) touchPresence(); }, PRESENCE_INTERVAL_MS);''',
    "auth idle presence",
)
write("homeeasy-auth.js", text)


# -----------------------------------------------------------------------------
# Shared PDF loader injected into quote/order/payment forms. The libraries no
# longer block initial parsing; idle warmup keeps submit latency near zero.
# -----------------------------------------------------------------------------
PDF_TAGS = '''    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>\n    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>\n'''
PDF_HELPER = '''    let homeEasyPdfLibrariesPromise = null;\n    function cargarScriptPdf(src, ready) {\n        if (ready()) return Promise.resolve();\n        return new Promise((resolve, reject) => {\n            const existing = Array.from(document.scripts).find(s => s.src === src);\n            if (existing) {\n                existing.addEventListener('load', resolve, { once: true });\n                existing.addEventListener('error', reject, { once: true });\n                return;\n            }\n            const script = document.createElement('script');\n            script.src = src;\n            script.async = true;\n            script.addEventListener('load', resolve, { once: true });\n            script.addEventListener('error', () => reject(new Error('No se pudo cargar el motor PDF.')), { once: true });\n            document.head.appendChild(script);\n        });\n    }\n    function asegurarLibreriasPdf() {\n        if (window.html2canvas && window.jspdf) return Promise.resolve();\n        if (!homeEasyPdfLibrariesPromise) {\n            homeEasyPdfLibrariesPromise = Promise.all([\n                cargarScriptPdf('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => Boolean(window.html2canvas)),\n                cargarScriptPdf('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => Boolean(window.jspdf))\n            ]).catch(error => { homeEasyPdfLibrariesPromise = null; throw error; });\n        }\n        return homeEasyPdfLibrariesPromise;\n    }\n    function precalentarLibreriasPdf() {\n        const warm = () => asegurarLibreriasPdf().catch(() => {});\n        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(warm, { timeout: 7000 });\n        else window.setTimeout(warm, 4500);\n    }\n'''

CLIENT_HELPER = '''    const MAX_CLIENTE_SUGERENCIAS = 10;\n    let clientesCacheMem = null;\n    let clientesSearchIndex = [];\n    let clienteSearchTimer = null;\n\n    function normalizarBusquedaCliente(value) {\n        return String(value || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');\n    }\n\n    function indexarClientes(cache) {\n        clientesSearchIndex = Object.values(cache || {}).map(cliente => ({\n            cliente,\n            texto: normalizarBusquedaCliente(`${cliente.cedula || ''} ${cliente.nombre || ''}`)\n        }));\n    }\n\n    function setClientesCache(cache) {\n        clientesCacheMem = cache && typeof cache === 'object' ? cache : {};\n        indexarClientes(clientesCacheMem);\n        try { localStorage.setItem('CACHE_CLIENTES', JSON.stringify(clientesCacheMem)); } catch (e) {}\n        return clientesCacheMem;\n    }\n\n    function getClientesCache() {\n        if (clientesCacheMem) return clientesCacheMem;\n        try {\n            const parsed = JSON.parse(localStorage.getItem('CACHE_CLIENTES') || '{}');\n            return setClientesCache(parsed && typeof parsed === 'object' ? parsed : {});\n        } catch (e) {\n            return setClientesCache({});\n        }\n    }\n\n    function renderSugerenciasCliente(valor, cont) {\n        const needle = normalizarBusquedaCliente(valor);\n        if (needle.length < 2) return;\n        getClientesCache();\n        const fragment = document.createDocumentFragment();\n        let mostrados = 0;\n        for (const entry of clientesSearchIndex) {\n            if (!entry.texto.includes(needle)) continue;\n            const cliente = entry.cliente;\n            const div = document.createElement('div');\n            div.style.padding = '12px 15px';\n            div.style.cursor = 'pointer';\n            div.style.borderBottom = '1px solid #eee';\n            div.style.fontSize = '0.85rem';\n            div.onmouseover = () => div.style.background = '#f9f9f9';\n            div.onmouseout = () => div.style.background = 'white';\n            const strong = document.createElement('strong');\n            strong.style.color = 'var(--homeeasy-wine)';\n            strong.textContent = String(cliente.cedula || '');\n            div.append(strong, document.createTextNode(` - ${cliente.nombre || ''}`));\n            div.onclick = function() {\n                document.getElementById('cedula').value = cliente.cedula;\n                buscarCliente();\n                cont.replaceChildren();\n                cont.style.display = 'none';\n            };\n            fragment.appendChild(div);\n            mostrados += 1;\n            if (mostrados >= MAX_CLIENTE_SUGERENCIAS) break;\n        }\n        if (mostrados) {\n            cont.appendChild(fragment);\n            cont.style.display = 'block';\n        }\n    }\n'''

CLIENT_HANDLER_PATTERN = r'''    document\.getElementById\("cedula"\)\.addEventListener\("input", function\(\) \{[\s\S]*?\n    \}\);\n\n    document\.addEventListener\("click"'''
CLIENT_HANDLER_REPL = '''    document.getElementById("cedula").addEventListener("input", function() {\n        buscarCliente();\n        const valor = this.value.trim();\n        const cont = document.getElementById("sugerencias_cliente");\n        cont.replaceChildren();\n        cont.style.display = "none";\n        clearTimeout(clienteSearchTimer);\n        if (valor.length < 2) return;\n        clienteSearchTimer = setTimeout(() => renderSugerenciasCliente(valor, cont), 90);\n    });\n\n    document.addEventListener("click"'''

for name, vars_block in (
    ("cotizacion.html", '''    let isEditMode = false;\n    let editNum = null;\n    let returnCedula = null; \n'''),
    ("pedido.html", '''    let numeroCot = null;\n    let isEditMode = false;\n    let editNum = null;\n    let returnCedula = null; \n'''),
):
    text = read(name)
    text = replace_once(text, PDF_TAGS, '', f"{name} remove blocking PDF tags")
    text = replace_once(text, vars_block, vars_block + '\n' + PDF_HELPER + '\n' + CLIENT_HELPER + '\n', f"{name} inject performance helpers")
    text = text.replace('localStorage.setItem("CACHE_CLIENTES", JSON.stringify(clientesObj));', 'setClientesCache(clientesObj);')
    text = regex_once(text, CLIENT_HANDLER_PATTERN, CLIENT_HANDLER_REPL + '(', f"{name} optimized client input", flags=re.M)
    text = text.replace('const cache = JSON.parse(localStorage.getItem("CACHE_CLIENTES") || "{}");', 'const cache = getClientesCache();')
    # Warm libraries without blocking initial render.
    text = replace_once(text, '    window.onload = () => {\n', '    window.onload = () => {\n        precalentarLibreriasPdf();\n', f"{name} idle PDF warmup")
    # Guarantee click-time correctness even if idle warmup has not completed.
    text = replace_once(text, '    async function finalizar() {\n', '    async function finalizar() {\n        await asegurarLibreriasPdf();\n', f"{name} submit PDF guarantee")
    write(name, text)


# -----------------------------------------------------------------------------
# Abonos: same lazy PDF approach + one in-memory/search index for orders.
# Fresh HISTORIAL_ABONOS and VERIFICAR_SALDO network checks remain untouched.
# -----------------------------------------------------------------------------
text = read("abono.html")
text = replace_once(text, PDF_TAGS, '', "abono remove blocking PDF tags")
ABONO_VARS = '''    var saldoBase = 0;\n    var ordenActual = null;\n    var historialAbonos = [];\n'''
ORDER_HELPER = '''    const MAX_ORDEN_SUGERENCIAS = 10;\n    let ordenesCacheMem = null;\n    let ordenesByNumber = new Map();\n    let ordenesSearchIndex = [];\n    let ordenSearchTimer = null;\n\n    function normalizarBusquedaOrden(value) {\n        return String(value || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');\n    }\n    function indexarOrdenes(rows) {\n        ordenesByNumber = new Map();\n        ordenesSearchIndex = [];\n        for (const orden of rows || []) {\n            const numero = String(orden.numero ?? '');\n            ordenesByNumber.set(numero, orden);\n            ordenesSearchIndex.push({\n                orden,\n                texto: normalizarBusquedaOrden(`${numero} ${orden.nombre || ''}`)\n            });\n        }\n    }\n    function setOrdenesCache(rows) {\n        ordenesCacheMem = Array.isArray(rows) ? rows : [];\n        indexarOrdenes(ordenesCacheMem);\n        try { localStorage.setItem('CACHE_ORDENES', JSON.stringify(ordenesCacheMem)); } catch (e) {}\n        return ordenesCacheMem;\n    }\n    function getOrdenesCache() {\n        if (ordenesCacheMem) return ordenesCacheMem;\n        try { return setOrdenesCache(JSON.parse(localStorage.getItem('CACHE_ORDENES') || '[]')); }\n        catch (e) { return setOrdenesCache([]); }\n    }\n    function renderSugerenciasOrden(valor, cont) {\n        const needle = normalizarBusquedaOrden(valor);\n        if (!needle) return;\n        getOrdenesCache();\n        const fragment = document.createDocumentFragment();\n        let mostrados = 0;\n        for (const entry of ordenesSearchIndex) {\n            if (!entry.texto.includes(needle)) continue;\n            const o = entry.orden;\n            const div = document.createElement('div');\n            div.style.padding = '12px 15px';\n            div.style.cursor = 'pointer';\n            div.style.borderBottom = '1px solid #eee';\n            div.style.fontSize = '0.85rem';\n            div.onmouseover = function() { div.style.background = '#f9f9f9'; };\n            div.onmouseout = function() { div.style.background = 'white'; };\n            const strong = document.createElement('strong');\n            strong.style.color = 'var(--homeeasy-wine)';\n            strong.textContent = `OP ${o.numero}`;\n            div.append(strong, document.createTextNode(` - ${o.nombre || ''}`));\n            div.onclick = function() {\n                document.getElementById('numeroOP').value = o.numero;\n                buscarOrden();\n                cont.replaceChildren();\n                cont.style.display = 'none';\n            };\n            fragment.appendChild(div);\n            mostrados += 1;\n            if (mostrados >= MAX_ORDEN_SUGERENCIAS) break;\n        }\n        if (mostrados) { cont.appendChild(fragment); cont.style.display = 'block'; }\n    }\n'''
text = replace_once(text, ABONO_VARS, ABONO_VARS + '\n' + PDF_HELPER + '\n' + ORDER_HELPER + '\n', "abono helpers")
text = replace_once(text, '    window.onload = function() {\n', '    window.onload = function() {\n        precalentarLibreriasPdf();\n', "abono idle PDF warmup")
text = text.replace('localStorage.setItem("CACHE_ORDENES", JSON.stringify(ordenesArr));', 'setOrdenesCache(ordenesArr);')
text = replace_once(
    text,
    '''        var cache = JSON.parse(localStorage.getItem("CACHE_ORDENES") || "[]");\n        var orden = cache.find(function(o) { return String(o.numero) === numero; });''',
    '''        getOrdenesCache();\n        var orden = ordenesByNumber.get(String(numero));''',
    "abono exact order lookup",
)
ABONO_HANDLER_PATTERN = r'''    document\.getElementById\("numeroOP"\)\.addEventListener\("input", function\(\) \{[\s\S]*?\n    \}\);\n\n    document\.addEventListener\("click"'''
ABONO_HANDLER_REPL = '''    document.getElementById("numeroOP").addEventListener("input", function() {\n        var valor = this.value.trim();\n        var cont = document.getElementById("sugerencias_orden");\n        cont.replaceChildren();\n        cont.style.display = "none";\n        clearTimeout(ordenSearchTimer);\n        if (!valor) return;\n        ordenSearchTimer = setTimeout(function() { renderSugerenciasOrden(valor, cont); }, 90);\n    });\n\n    document.addEventListener("click"'''
text = regex_once(text, ABONO_HANDLER_PATTERN, ABONO_HANDLER_REPL + '(', "abono optimized order input", flags=re.M)
text = replace_once(text, '    async function finalizarAbono() {\n', '    async function finalizarAbono() {\n        await asegurarLibreriasPdf();\n', "abono submit PDF guarantee")
write("abono.html", text)


# -----------------------------------------------------------------------------
# Calendar: server already supports deleting a recurrence by groupId. Replace
# up-to-12 fire-and-forget POSTs with one authoritative batch request.
# -----------------------------------------------------------------------------
text = read("calendario.html")
old_calendar = '''            eventosDelGrupo.forEach(ev => {\n                const elVisual = document.getElementById(`evento-${ev.id}`) || document.getElementById(`evento-vencido-${ev.id}`);\n                if (elVisual) elVisual.remove();\n                fetch(WEBAPP_URL, { method: "POST", body: JSON.stringify({ tipo: "eliminar_evento", id: ev.id }) });\n            });'''
new_calendar = '''            eventosDelGrupo.forEach(ev => {\n                const elVisual = document.getElementById(`evento-${ev.id}`) || document.getElementById(`evento-vencido-${ev.id}`);\n                if (elVisual) elVisual.remove();\n            });\n            fetch(WEBAPP_URL, {\n                method: "POST",\n                body: JSON.stringify({ tipo: "eliminar_evento", groupId: grupoABorrar })\n            }).catch(error => console.error("No se pudo sincronizar el borrado recurrente:", error));'''
text = replace_once(text, old_calendar, new_calendar, "calendar recurrence batch delete")
write("calendario.html", text)


# -----------------------------------------------------------------------------
# Reports: html2pdf is export-only; lazy-load it on demand instead of blocking
# the dashboard. All calculation/report semantics remain unchanged.
# -----------------------------------------------------------------------------
text = read("reportes.html")
text = replace_once(text, '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>\n', '', "reports remove blocking html2pdf")
old_export = '''function pdfFilename(){const label=String(lastMetrics?.rg?.texto||'Periodo').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');return `HomeEasy_Reporte_Ventas_${label}_${new Date().toISOString().slice(0,10)}.pdf`}\nasync function exportPDF(){'''
new_export = '''function pdfFilename(){const label=String(lastMetrics?.rg?.texto||'Periodo').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');return `HomeEasy_Reporte_Ventas_${label}_${new Date().toISOString().slice(0,10)}.pdf`}\nlet html2PdfPromise=null;\nfunction ensureHtml2Pdf(){if(window.html2pdf)return Promise.resolve();if(!html2PdfPromise){html2PdfPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';script.async=true;script.onload=resolve;script.onerror=()=>reject(new Error('No se pudo cargar el motor de exportación PDF.'));document.head.appendChild(script)}).catch(error=>{html2PdfPromise=null;throw error})}return html2PdfPromise}\nasync function exportPDF(){'''
text = replace_once(text, old_export, new_export, "reports lazy html2pdf helper")
text = replace_once(text, '''try{if(!lastMetrics)throw new Error('El reporte aún está cargando.');report=buildBoardReport();''', '''try{if(!lastMetrics)throw new Error('El reporte aún está cargando.');await ensureHtml2Pdf();report=buildBoardReport();''', "reports await html2pdf")
write("reportes.html", text)

print("HomeEasy 10G safe performance patch applied")
