from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Missing target: {label}')
    return text.replace(old, new, 1)


# ---------- homeeasy-auth.js ----------
p = Path('homeeasy-auth.js')
s = p.read_text(encoding='utf-8')
s = replace_once(s, 'HomeEasy Auth v0.2.0', 'HomeEasy Auth v0.3.0', 'auth header')
s = replace_once(s, "const VERSION = '0.2.0';", "const VERSION = '0.3.0';", 'auth version')
s = replace_once(s,
    '    const REQUEST_TIMEOUT_MS = 25000;\n    const VALID_PERSISTENCE',
    '    const REQUEST_TIMEOUT_MS = 25000;\n    const APP_SESSION_REVALIDATE_MS = 5 * 60 * 1000;\n    const APP_SESSION_EXPIRY_SKEW_MS = 30 * 1000;\n    const VALID_PERSISTENCE',
    'auth constants')
s = replace_once(s,
    "            appSessionExpiresAt: session.appSessionExpiresAt || '',\n            profile:",
    "            appSessionExpiresAt: session.appSessionExpiresAt || '',\n            appSessionValidatedAt: Number(session.appSessionValidatedAt || 0),\n            profile:",
    'store validation stamp')
s = replace_once(s,
    "            appSessionExpiresAt: '',\n            profile: {},",
    "            appSessionExpiresAt: '',\n            appSessionValidatedAt: 0,\n            profile: {},",
    'clear validation stamp')
s = replace_once(s,
    "            appSessionExpiresAt: response.expiresAt || '',\n            profile: response.perfil || {},",
    "            appSessionExpiresAt: response.expiresAt || '',\n            appSessionValidatedAt: Date.now(),\n            profile: response.perfil || {},",
    'open validation stamp')
s = replace_once(s,
    "            appSessionExpiresAt: response.expiresAt || current.appSessionExpiresAt || '',\n            profile: response.perfil || current.profile || {},",
    "            appSessionExpiresAt: response.expiresAt || current.appSessionExpiresAt || '',\n            appSessionValidatedAt: Date.now(),\n            profile: response.perfil || current.profile || {},",
    'validate stamp')
s = replace_once(s,
    "            appSessionExpiresAt: current.appSessionExpiresAt,\n            profile: current.profile,",
    "            appSessionExpiresAt: current.appSessionExpiresAt,\n            appSessionValidatedAt: current.appSessionValidatedAt || Date.now(),\n            profile: current.profile,",
    'password preserve stamp')

old_restore = """    async function restoreSession(options) {
        const opts = { validate: false, homeEasy: true, silent: true, meta: {}, ...(options || {}) };
        const user = await restoreFirebaseSession({ validate: opts.validate });
        if (!user || opts.homeEasy === false) return user;

        try {
            const current = readStoredSession();
            if (current && current.appSessionToken) {
                await validateAppSession({ meta: opts.meta });
            } else {
                await openAppSession({ meta: opts.meta });
            }
            return user;
        } catch (error) {
            clearStoredSessions();
            emitAuthChange('session-rejected', null);
            if (opts.silent) return null;
            throw error;
        }
    }
"""
new_restore = """    async function restoreSession(options) {
        const opts = { validate: false, homeEasy: true, silent: true, meta: {}, preferCache: true, ...(options || {}) };
        const user = await restoreFirebaseSession({ validate: opts.validate });
        if (!user || opts.homeEasy === false) return user;

        try {
            if (opts.preferCache !== false && getCachedHomeEasySession()) return user;
            const current = readStoredSession();
            if (current && current.appSessionToken) await validateAppSession({ meta: opts.meta });
            else await openAppSession({ meta: opts.meta });
            return user;
        } catch (error) {
            clearStoredSessions();
            emitAuthChange('session-rejected', null);
            if (opts.silent) return null;
            throw error;
        }
    }
"""
s = replace_once(s, old_restore, new_restore, 'restoreSession')

old_home = """    async function restoreHomeEasySession(options) {
        const opts = { validateFirebase: false, reopen: true, silent: false, meta: {}, ...(options || {}) };
        const user = await restoreFirebaseSession({ validate: opts.validateFirebase });
        if (!user) return null;

        const current = readStoredSession();
        if (current && current.appSessionToken) {
            try {
                return await validateAppSession({ meta: opts.meta });
            } catch (error) {
                if (!opts.reopen) {
                    if (opts.silent) return null;
                    throw error;
                }
            }
        }

        if (!opts.reopen) return null;
        try {
            return await openAppSession({ meta: opts.meta });
        } catch (error) {
            clearStoredSessions();
            emitAuthChange('session-rejected', null);
            if (opts.silent) return null;
            throw error;
        }
    }
"""
new_home = """    async function restoreHomeEasySession(options) {
        const opts = { validateFirebase: false, reopen: true, silent: false, meta: {}, preferCache: true, ...(options || {}) };
        const user = await restoreFirebaseSession({ validate: opts.validateFirebase });
        if (!user) return null;

        if (opts.preferCache !== false) {
            const cached = getCachedHomeEasySession();
            if (cached) return cached;
        }

        const current = readStoredSession();
        if (current && current.appSessionToken) {
            try { return await validateAppSession({ meta: opts.meta }); }
            catch (error) {
                if (!opts.reopen) {
                    if (opts.silent) return null;
                    throw error;
                }
            }
        }

        if (!opts.reopen) return null;
        try { return await openAppSession({ meta: opts.meta }); }
        catch (error) {
            clearStoredSessions();
            emitAuthChange('session-rejected', null);
            if (opts.silent) return null;
            throw error;
        }
    }
"""
s = replace_once(s, old_home, new_home, 'restoreHomeEasySession')

marker = """    function getAppSessionToken() {
        const session = readStoredSession();
        return session ? String(session.appSessionToken || '') : '';
    }
"""
helpers = marker + """
    function parseExpiryMs(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value > 100000000000 ? value : value * 1000;
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric > 100000000000 ? numeric : numeric * 1000;
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function getCachedHomeEasySession() {
        const current = readStoredSession();
        if (!current || !current.appSessionToken || !validateProjectAudience(current.idToken)) return null;
        if (!current.expiresAt || current.expiresAt <= Date.now() + APP_SESSION_EXPIRY_SKEW_MS) return null;
        const appExpiry = parseExpiryMs(current.appSessionExpiresAt);
        if (appExpiry && appExpiry <= Date.now() + APP_SESSION_EXPIRY_SKEW_MS) return null;
        const profile = normalizeProfile(current.profile);
        if (!profile.uid || profile.estado === 'INACTIVO') return null;
        return Object.freeze({
            profile,
            permissions: normalizePermissions(current.permissions),
            expiresAt: current.appSessionExpiresAt,
            validatedAt: Number(current.appSessionValidatedAt || 0),
            cached: true
        });
    }

    function shouldRevalidateAppSession(maxAgeMs) {
        const cached = getCachedHomeEasySession();
        if (!cached) return true;
        const maxAge = Math.max(30000, Number(maxAgeMs || APP_SESSION_REVALIDATE_MS));
        return !cached.validatedAt || Date.now() - cached.validatedAt >= maxAge;
    }
"""
s = replace_once(s, marker, helpers, 'cache helpers')
s = replace_once(s,
    '        getAppSessionToken,\n        fetchAccount,',
    '        getAppSessionToken,\n        getCachedHomeEasySession,\n        shouldRevalidateAppSession,\n        fetchAccount,',
    'cache exports')
p.write_text(s, encoding='utf-8')


# ---------- homeeasy-core.js ----------
p = Path('homeeasy-core.js')
s = p.read_text(encoding='utf-8')
s = replace_once(s, 'HomeEasy Core v2.3', 'HomeEasy Core v2.4', 'core header')
s = replace_once(s, "const APP_VERSION = '2.3';", "const APP_VERSION = '2.4';", 'core version')
s = replace_once(s, "const FETCH_PATCH_FLAG = '__HOMEEASY_FETCH_PATCHED_V23__';", "const FETCH_PATCH_FLAG = '__HOMEEASY_FETCH_PATCHED_V24__';", 'core fetch flag')

block_pattern = re.compile(r"\n    if \(INDEX_AUTH_PROTECTED && global\.document && global\.document\.documentElement\) \{.*?\n    \}\n\n    function buildQuery", re.S)
replacement = """
    let indexPendingTimer = null;
    function showIndexPending() {
        if (indexAuthStatus !== 'checking' || !global.document || !global.document.documentElement) return;
        global.document.documentElement.classList.add(AUTH_PENDING_CLASS);
        if (global.document.getElementById(AUTH_LOADING_STYLE_ID)) return;
        const loadingStyle = global.document.createElement('style');
        loadingStyle.id = AUTH_LOADING_STYLE_ID;
        loadingStyle.textContent = `html.${AUTH_PENDING_CLASS} body{visibility:hidden!important}html.${AUTH_PENDING_CLASS}{min-height:100%;background:#a6455a!important}html.${AUTH_PENDING_CLASS}::before{content:'';position:fixed;z-index:2147483646;inset:0;background:#a6455a}html.${AUTH_PENDING_CLASS}::after{content:'Abriendo HomeEasy…';position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%);color:rgba(255,255,255,.88);font:650 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;
        (global.document.head || global.document.documentElement).appendChild(loadingStyle);
    }
    function scheduleIndexPending() {
        clearTimeout(indexPendingTimer);
        indexPendingTimer = global.setTimeout(showIndexPending, 220);
    }

    function buildQuery"""
s, n = block_pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit('Could not replace index pending block')

s = replace_once(s,
    "        indexAuthStatus = 'authorized';\n        if (resolveIndexAuthReady) resolveIndexAuthReady(true);",
    "        indexAuthStatus = 'authorized';\n        clearTimeout(indexPendingTimer);\n        if (resolveIndexAuthReady) resolveIndexAuthReady(true);",
    'index reveal timer')

old_guard = """            const authorized = await global.HomeEasyAuth.requireAuth({
                redirect: false,
                validateFirebase: false,
                returnUrl: 'index.html',
                meta: buildMeta()
            });

            if (!authorized) {
                redirectIndexToLogin();
                return;
            }

            const profile = global.HomeEasyAuth.getCurrentProfile();
            if (profile) {
                setOperator(profile.nombre || profile.email || 'Sin identificar');
            }

            revealAuthenticatedIndex();
            installLogoutControl();"""
new_guard = """            let authorized = global.HomeEasyAuth.getCachedHomeEasySession
                ? global.HomeEasyAuth.getCachedHomeEasySession()
                : null;
            if (!authorized) {
                authorized = await global.HomeEasyAuth.restoreHomeEasySession({
                    validateFirebase: false,
                    reopen: true,
                    silent: true,
                    preferCache: true,
                    meta: buildMeta()
                });
            }
            if (!authorized) {
                redirectIndexToLogin();
                return;
            }

            const profile = global.HomeEasyAuth.getCurrentProfile();
            if (profile) setOperator(profile.nombre || profile.email || 'Sin identificar');
            await loadScriptOnce('homeeasy-account.js?v=3D', 'homeeasyAccountScript', () => Boolean(global.document && global.document.getElementById('homeeasyAccountControl')));
            revealAuthenticatedIndex();

            if (global.HomeEasyAuth.shouldRevalidateAppSession && global.HomeEasyAuth.shouldRevalidateAppSession(5 * 60 * 1000)) {
                global.HomeEasyAuth.validateAppSession({ meta: buildMeta() }).catch(() => redirectIndexToLogin());
            }"""
s = replace_once(s, old_guard, new_guard, 'index cache guard')
s = replace_once(s,
    "        try {\n            await loadScriptOnce(\n                'homeeasy-auth-config.js?v=3A',",
    "        scheduleIndexPending();\n        try {\n            await loadScriptOnce(\n                'homeeasy-auth-config.js?v=3D',",
    'index schedule/config version')
s = replace_once(s, "'homeeasy-auth.js?v=3A'", "'homeeasy-auth.js?v=3D'", 'index auth version')
p.write_text(s, encoding='utf-8')


# ---------- login.html ----------
p = Path('login.html')
s = p.read_text(encoding='utf-8')
success_css = """
.success-screen{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:24px;background:rgba(248,247,248,.96);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .22s ease,visibility .22s ease}.success-screen.visible{opacity:1;visibility:visible;pointer-events:auto}.success-card{text-align:center;transform:translateY(8px) scale(.97);transition:transform .28s var(--spring)}.success-screen.visible .success-card{transform:none}.success-check{width:76px;height:76px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#b75a70,#a6455a 60%,#823646);color:#fff;box-shadow:0 18px 38px rgba(166,69,90,.22)}.success-check svg{width:40px;height:40px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:45;stroke-dashoffset:45;animation:drawCheck .42s .08s ease forwards}.success-title{margin:0;color:#292429;font-size:1.65rem;font-weight:780;letter-spacing:-.045em}.success-name{margin-top:7px;color:#a6455a;font-size:.9rem;font-weight:720}.success-copy{margin-top:6px;color:#817a7e;font-size:.72rem}@keyframes drawCheck{to{stroke-dashoffset:0}}
"""
s = replace_once(s, '</style>', success_css + '</style>', 'login success css')
success_html = '<div class="success-screen" id="successScreen" aria-hidden="true"><div class="success-card"><div class="success-check"><svg viewBox="0 0 48 48"><path d="M13 25.5 21 33l14-17"/></svg></div><h2 class="success-title">Acceso listo</h2><div class="success-name" id="successName">Bienvenido</div><div class="success-copy">Preparando tu espacio HomeEasy…</div></div></div>\n'
s = replace_once(s, '<div class="modal" id="resetPanel"', success_html + '<div class="modal" id="resetPanel"', 'login success html')
s = replace_once(s,
    "try{await auth.signIn(email,password,{remember:rememberInput.checked});setStatus('Acceso autorizado. Abriendo HomeEasy…',true);passwordInput.value='';location.replace(returnUrl)}",
    "try{await auth.signIn(email,password,{remember:rememberInput.checked});passwordInput.value='';await showSuccess();location.replace(returnUrl)}",
    'login success flow')
success_fn = "async function showSuccess(){const p=auth.getCurrentProfile?auth.getCurrentProfile():null,n=p&&p.nombre?String(p.nombre).trim().split(/\\s+/)[0]:'';document.getElementById('successName').textContent=n?'Bienvenido, '+n:'Bienvenido a HomeEasy';const screen=document.getElementById('successScreen');screen.classList.add('visible');screen.setAttribute('aria-hidden','false');await new Promise(r=>setTimeout(r,720))}\n"
s = replace_once(s, 'function togglePassword()', success_fn + 'function togglePassword()', 'login success function')
s = replace_once(s,
    '.visual:before{content:"";position:absolute;inset:0;z-index:0;opacity:.1;background-image:linear-gradient(rgba(255,255,255,.11) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.11) 1px,transparent 1px);background-size:52px 52px;mask-image:linear-gradient(#000,transparent 90%)}',
    '.visual:before{content:"";position:absolute;inset:0;z-index:0;background:radial-gradient(circle at 34% 32%,rgba(255,255,255,.05),transparent 35%)}',
    'remove login grid')
s = replace_once(s, 'opacity:.055;filter:brightness(0) invert(1)', 'opacity:.16;filter:brightness(.48) saturate(.75)', 'login triangle')
p.write_text(s, encoding='utf-8')

print('Auth UX optimization patched successfully.')
