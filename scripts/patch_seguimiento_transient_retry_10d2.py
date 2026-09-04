from pathlib import Path

hommy_path = Path('seguimiento-hommy.js')
page_path = Path('seguimiento.html')

hommy = hommy_path.read_text(encoding='utf-8')
page = page_path.read_text(encoding='utf-8')

constant_anchor = "  const REQUEST_TIMEOUT_MS = 90_000;\n"
constant_block = """  const REQUEST_TIMEOUT_MS = 90_000;\n  const TRANSIENT_RETRY_DELAY_MS = 700;\n  const TRANSIENT_ANALYSIS_CODES = new Set([\n    'AUTH_UPSTREAM_TIMEOUT',\n    'AUTH_UPSTREAM_UNAVAILABLE',\n    'FOLLOWUP_UPSTREAM_TIMEOUT',\n    'FOLLOWUP_UPSTREAM_UNAVAILABLE'\n  ]);\n"""
if 'TRANSIENT_ANALYSIS_CODES' not in hommy:
    if constant_anchor not in hommy:
        raise SystemExit('Could not find request timeout constant')
    hommy = hommy.replace(constant_anchor, constant_block, 1)

old_loading = '''  function renderLoading(panel) {\n    clearPanel(panel);\n    const loading = document.createElement('div');\n    loading.className = 'he-hommy-loading';\n    const spinner = document.createElement('span');\n    spinner.className = 'he-hommy-spinner';\n    spinner.setAttribute('aria-hidden', 'true');\n    const text = document.createElement('span');\n    text.textContent = 'Hommy está revisando el contexto comercial…';\n    loading.append(spinner, text);\n    panel.appendChild(loading);\n  }\n'''
new_loading = '''  function renderLoading(panel, message = 'Hommy está revisando el contexto comercial…') {\n    clearPanel(panel);\n    const loading = document.createElement('div');\n    loading.className = 'he-hommy-loading';\n    const spinner = document.createElement('span');\n    spinner.className = 'he-hommy-spinner';\n    spinner.setAttribute('aria-hidden', 'true');\n    const text = document.createElement('span');\n    text.textContent = message;\n    loading.append(spinner, text);\n    panel.appendChild(loading);\n  }\n'''
if old_loading in hommy:
    hommy = hommy.replace(old_loading, new_loading, 1)
elif "function renderLoading(panel, message =" not in hommy:
    raise SystemExit('Could not find renderLoading block')

friendly_anchor = '''  function friendlyError(error) {\n    const code = clean(error && error.code).toUpperCase();\n'''
friendly_replacement = '''  function friendlyError(error) {\n    const code = clean(error && error.code).toUpperCase();\n    if (TRANSIENT_ANALYSIS_CODES.has(code)) {\n      return 'La conexión con HomeEasy está lenta. Hommy no envió nada ni cambió datos. Puedes seguir usando la cotización y volver a analizar en un momento.';\n    }\n'''
if friendly_anchor in hommy:
    hommy = hommy.replace(friendly_anchor, friendly_replacement, 1)
elif "TRANSIENT_ANALYSIS_CODES.has(code)" not in hommy:
    raise SystemExit('Could not find friendlyError anchor')

analyze_anchor = '''  async function analyze(panel, numero) {\n    if (!panel || panel.dataset.loading === '1') return;\n    panel.dataset.loading = '1';\n    renderLoading(panel);\n    try {\n      const payload = await requestPlan(numero);\n      if (panel.isConnected) renderResult(panel, numero, payload);\n    } catch (error) {\n      if (panel.isConnected) renderError(panel, numero, error);\n    } finally {\n      panel.dataset.loading = '0';\n    }\n  }\n'''
analyze_replacement = '''  function isTransientAnalysisError(error) {\n    return TRANSIENT_ANALYSIS_CODES.has(clean(error && error.code).toUpperCase());\n  }\n\n  function wait(ms) {\n    return new Promise(resolve => window.setTimeout(resolve, ms));\n  }\n\n  async function analyze(panel, numero) {\n    if (!panel || panel.dataset.loading === '1') return;\n    panel.dataset.loading = '1';\n    renderLoading(panel);\n    try {\n      let payload;\n      try {\n        payload = await requestPlan(numero);\n      } catch (error) {\n        if (!isTransientAnalysisError(error)) throw error;\n        if (panel.isConnected) renderLoading(panel, 'Reconectando con HomeEasy…');\n        await wait(TRANSIENT_RETRY_DELAY_MS);\n        payload = await requestPlan(numero);\n      }\n      if (panel.isConnected) renderResult(panel, numero, payload);\n    } catch (error) {\n      if (panel.isConnected) renderError(panel, numero, error);\n    } finally {\n      panel.dataset.loading = '0';\n    }\n  }\n'''
if analyze_anchor in hommy:
    hommy = hommy.replace(analyze_anchor, analyze_replacement, 1)
elif 'function isTransientAnalysisError(error)' not in hommy:
    raise SystemExit('Could not find analyze block')

hommy_path.write_text(hommy, encoding='utf-8')

page = page.replace('homeeasy-whatsapp-client.js?v=0.6.0', 'homeeasy-whatsapp-client.js?v=0.6.0')
page = page.replace('seguimiento-hommy.js?v=10d1-retry', 'seguimiento-hommy.js?v=10d2-retry')
page = page.replace('seguimiento-hommy.js?v=10d1', 'seguimiento-hommy.js?v=10d2')
if 'seguimiento-hommy.js?v=10d2" defer' not in page or 'seguimiento-hommy.js?v=10d2-retry' not in page:
    raise SystemExit('Could not update Seguimiento Hommy cache versions')
page_path.write_text(page, encoding='utf-8')

print('Seguimiento transient analysis retry 10D.2 patch applied')
