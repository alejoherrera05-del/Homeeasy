from pathlib import Path

js_path = Path('seguimiento-hommy.js')
source = js_path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    source = source.replace(old, new, 1)

# Cache ownership + prudent initial warmup.
replace_once(
    "  const PLAN_CACHE_PREFIX = 'homeeasy:seguimiento:hommy-plan:10f1:';\n  const RADAR_CACHE_PREFIX = 'homeeasy:seguimiento:hommy-radar:10f1:';\n",
    "  const PLAN_CACHE_PREFIX = 'homeeasy:seguimiento:hommy-plan:10f1:';\n  const RADAR_CACHE_PREFIX = 'homeeasy:seguimiento:hommy-radar:10f1:';\n  const CACHE_OWNER_KEY = 'homeeasy:seguimiento:hommy-cache-owner:10f1';\n",
    'cache owner constant',
)
replace_once(
    "  const BACKGROUND_WARMUP_DELAY_MS = 260;\n  const MAX_RADAR_WORKERS = 3;\n",
    "  const BACKGROUND_WARMUP_DELAY_MS = 260;\n  const INITIAL_RADAR_WARM_COUNT = 8;\n  const MAX_RADAR_WORKERS = 3;\n",
    'warm count',
)

cache_owner_helpers = r'''
  function cacheOwnerFingerprint() {
    const auth = window.HomeEasyAuth;
    const profile = auth && typeof auth.getCurrentProfile === 'function' ? auth.getCurrentProfile() : null;
    const token = sessionToken();
    const basis = clean(profile && (profile.email || profile.nombre || profile.rol)) || token;
    if (!basis) return '';
    let hash = 2166136261;
    const text = `${basis}|${token.slice(-24)}`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function purgeHommySessionCache() {
    planCache.clear();
    radarCache.clear();
    historyCache.clear();
    try {
      if (!window.sessionStorage) return;
      const keys = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (key && (key.startsWith(PLAN_CACHE_PREFIX) || key.startsWith(RADAR_CACHE_PREFIX))) keys.push(key);
      }
      keys.forEach(key => window.sessionStorage.removeItem(key));
    } catch (_) {}
  }

  function ensureCacheOwner() {
    const fingerprint = cacheOwnerFingerprint();
    if (!fingerprint) return;
    let previous = '';
    try { previous = clean(window.sessionStorage && window.sessionStorage.getItem(CACHE_OWNER_KEY)); } catch (_) {}
    if (previous && previous !== fingerprint) purgeHommySessionCache();
    try { if (window.sessionStorage) window.sessionStorage.setItem(CACHE_OWNER_KEY, fingerprint); } catch (_) {}
  }
'''
replace_once(
    "  function sessionRead(key) {\n",
    cache_owner_helpers + "\n  function sessionRead(key) {\n",
    'cache owner helpers',
)

# Preserve Retry-After from rate limiting so background radar can defer instead of dropping cards.
replace_once(
    "      const error = new Error(clean(payload && payload.error && payload.error.message) || 'No fue posible cargar el historial comercial.');\n      error.code = code || `HTTP_${response.status}`;\n      throw error;\n",
    "      const error = new Error(clean(payload && payload.error && payload.error.message) || 'No fue posible cargar el historial comercial.');\n      error.code = code || `HTTP_${response.status}`;\n      const retryAfter = Number(response.headers && typeof response.headers.get === 'function' ? response.headers.get('Retry-After') : 0);\n      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterSeconds = retryAfter;\n      throw error;\n",
    'history retry after',
)

# Rate-limited background jobs should return later, not silently disappear.
replace_once(
    "      prefetchRadar(key, Boolean(job.force))\n        .catch(() => {})\n        .finally(() => {\n",
    "      prefetchRadar(key, Boolean(job.force))\n        .catch(error => {\n          if (clean(error && error.code).toUpperCase() === 'RATE_LIMITED') {\n            const delay = Math.max(5, Math.min(90, Number(error.retryAfterSeconds || 15))) * 1000;\n            window.setTimeout(() => queueRadar(key, Boolean(job.force), true), delay);\n          }\n        })\n        .finally(() => {\n",
    'radar rate limit retry',
)

# Restore stale results instantly, but never allow a stale cached SEND plan to be acted on until refreshed.
replace_once(
    "    if (planRecord) {\n      renderResult(panel, key, planRecord.payload, { cached: true, cachedAt: planRecord.cachedAt });\n      if (Date.now() - planRecord.cachedAt > PLAN_FRESH_MS && visibleQuotes.has(key)) {\n",
    "    if (planRecord) {\n      const stale = Date.now() - planRecord.cachedAt > PLAN_FRESH_MS;\n      renderResult(panel, key, planRecord.payload, { cached: true, cachedAt: planRecord.cachedAt, stale });\n      if (stale && visibleQuotes.has(key)) {\n",
    'stale cached plan restore',
)
replace_once(
    "      cacheNote.textContent = `Análisis guardado ${ageLabel(options.cachedAt)} · se actualizará en segundo plano si cambia el contexto.`;\n",
    "      cacheNote.textContent = options.stale\n        ? `Análisis guardado ${ageLabel(options.cachedAt)} · verificando cambios antes de permitir acciones.`\n        : `Análisis guardado ${ageLabel(options.cachedAt)} · se actualizará en segundo plano si cambia el contexto.`;\n",
    'stale cache copy',
)
replace_once(
    "    if (message) {\n      const copyButton = document.createElement('button');\n",
    "    if (message && !options.stale) {\n      const copyButton = document.createElement('button');\n",
    'stale copy guard',
)
replace_once(
    "    if (message && decision === 'SEND' && canSendFollowup()) {\n",
    "    if (message && decision === 'SEND' && canSendFollowup() && !options.stale) {\n",
    'stale send guard',
)
replace_once(
    "    safe.textContent = decision === 'SEND' && canSendFollowup()\n      ? 'Modo REVIEW · Hommy propone; tú revisas y autorizas cualquier envío.'\n      : 'Modo REVIEW · Hommy no envió nada y no cambió datos de HomeEasy.';\n",
    "    safe.textContent = options.stale\n      ? 'Modo REVIEW · este análisis se muestra para no hacerte esperar, pero Hommy está verificando cambios antes de habilitar acciones.'\n      : decision === 'SEND' && canSendFollowup()\n        ? 'Modo REVIEW · Hommy propone; tú revisas y autorizas cualquier envío.'\n        : 'Modo REVIEW · Hommy no envió nada y no cambió datos de HomeEasy.';\n",
    'stale safety copy',
)

# Do not eagerly read every active quote. First cards warm immediately; IntersectionObserver prioritizes the rest as the user approaches them.
replace_once(
    "  function warmRadar() {\n    document.querySelectorAll('.crm-card').forEach((card, index) => {\n      const numero = quoteNumberFromCard(card);\n      if (numero) queueRadar(numero, false, index < 5);\n    });\n  }\n",
    "  function warmRadar() {\n    Array.from(document.querySelectorAll('.crm-card')).slice(0, INITIAL_RADAR_WARM_COUNT).forEach((card, index) => {\n      const numero = quoteNumberFromCard(card);\n      if (numero) queueRadar(numero, false, index < 5);\n    });\n  }\n",
    'warm radar scope',
)

# Scope caches to the current authenticated operator and purge on sign-out/rejection.
replace_once(
    "  function install() {\n    addStyles();\n",
    "  function install() {\n    ensureCacheOwner();\n    addStyles();\n",
    'cache owner install',
)
replace_once(
    "    window.addEventListener('homeeasy:seguimiento-updated', event => {\n",
    "    window.addEventListener('homeeasy:auth-change', event => {\n      const type = clean(event && event.detail && event.detail.type).toLowerCase();\n      if (['signed-out', 'session-rejected'].includes(type)) {\n        purgeHommySessionCache();\n        try { if (window.sessionStorage) window.sessionStorage.removeItem(CACHE_OWNER_KEY); } catch (_) {}\n        return;\n      }\n      if (type.includes('signed-in')) ensureCacheOwner();\n    });\n    window.addEventListener('homeeasy:seguimiento-updated', event => {\n",
    'auth change cache hygiene',
)

js_path.write_text(source, encoding='utf-8')

# Bump the asset so browsers do not keep 10F cached.
page_path = Path('seguimiento.html')
page = page_path.read_text(encoding='utf-8')
main_asset = '<script src="seguimiento-hommy.js?v=10f1" defer></script>'
retry_asset = "retry.src = 'seguimiento-hommy.js?v=10f1-retry';"
if page.count(main_asset) != 1 or page.count(retry_asset) != 1:
    raise SystemExit(f'10F.1 asset anchors mismatch main={page.count(main_asset)} retry={page.count(retry_asset)}')
page = page.replace(main_asset, '<script src="seguimiento-hommy.js?v=10f2" defer></script>', 1)
page = page.replace(retry_asset, "retry.src = 'seguimiento-hommy.js?v=10f2-retry';", 1)
page_path.write_text(page, encoding='utf-8')
