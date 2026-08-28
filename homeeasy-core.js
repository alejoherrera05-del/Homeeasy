/**
 * HomeEasy Core v3.5
 * Comunicación central, identificación del dispositivo, trazabilidad y guard de acceso del Index.
 * La protección general se aplica únicamente a index.html en esta fase.
 */
(function (global) {
    'use strict';

    const API_URL = 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec';
    const APP_VERSION = '3.5';
    const CONFIG_CACHE_KEY = 'HOMEEASY_CONFIG_BROWSER_V1';
    const CONFIG_CACHE_FRESH_MS = 5 * 60 * 1000;
    const CONFIG_CACHE_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000;
    const DEFAULT_TIMEOUT_MS = 25000;
    const OPERATOR_KEY = 'HOMEEASY_OPERADOR_LOCAL';
    const DEVICE_ID_KEY = 'HOMEEASY_DEVICE_ID';
    const DEVICE_NAME_KEY = 'HOMEEASY_DEVICE_NAME';
    const FETCH_PATCH_FLAG = '__HOMEEASY_FETCH_PATCHED_V25__';
    const AUTH_PENDING_CLASS = 'homeeasy-auth-pending';
    const AUTH_LOADING_STYLE_ID = 'homeeasy-auth-loading-style';
    const AUTH_LOGOUT_STYLE_ID = 'homeeasy-auth-logout-style';
    const FAST_RETURN_STYLE_ID = 'homeeasy-fast-home-return-style';
    const AUTH_SESSION_STORAGE_KEY = 'HOMEEASY_AUTH_SESSION_V1';
    const INTERNAL_HOME_RETURN_KEY = 'HOMEEASY_INTERNAL_HOME_RETURN_V1';

    function readStorageValue(storage, key) {
        try { return storage.getItem(key) || ''; } catch (error) { return ''; }
    }

    function writeSessionValue(key, value) {
        try { global.sessionStorage.setItem(key, String(value)); } catch (error) {}
    }

    function removeSessionValue(key) {
        try { global.sessionStorage.removeItem(key); } catch (error) {}
    }

    function parseStoredAuthSession(raw) {
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function getStoredAuthSessionSnapshot() {
        return parseStoredAuthSession(readStorageValue(global.sessionStorage, AUTH_SESSION_STORAGE_KEY))
            || parseStoredAuthSession(readStorageValue(global.localStorage, AUTH_SESSION_STORAGE_KEY));
    }

    function parseExpiryMs(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value > 100000000000 ? value : value * 1000;
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric > 100000000000 ? numeric : numeric * 1000;
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function hasFreshCachedAppSession() {
        const session = getStoredAuthSessionSnapshot();
        if (!session || !session.appSessionToken) return false;
        if (!Number(session.expiresAt || 0) || Number(session.expiresAt) <= Date.now() + 30000) return false;
        const appExpiry = parseExpiryMs(session.appSessionExpiresAt);
        if (!appExpiry || appExpiry <= Date.now() + 30000) return false;
        return true;
    }

    function cameFromInternalModule() {
        try {
            if (!global.document || !global.document.referrer) return false;
            const previous = new URL(global.document.referrer, global.location.href);
            const current = new URL(global.location.href);
            const page = (previous.pathname.split('/').pop() || '').toLowerCase();
            if (previous.origin !== current.origin || !page) return false;
            return page !== 'index.html' && page !== 'login.html' && page !== 'activar-cuenta.html';
        } catch (error) {
            return false;
        }
    }

    function isFastHomeReturn() {
        if (!INDEX_AUTH_PROTECTED) return false;
        const appWasOpened = readStorageValue(global.sessionStorage, 'APP_INIT_DONE') === 'true';
        const explicitReturn = readStorageValue(global.sessionStorage, INTERNAL_HOME_RETURN_KEY) === '1';
        return (appWasOpened || explicitReturn || cameFromInternalModule()) && hasFreshCachedAppSession();
    }

    function installFastHomeReturnStyle() {
        if (!isFastHomeReturn() || !global.document || !global.document.head) return;
        if (global.document.getElementById(FAST_RETURN_STYLE_ID)) return;
        const style = global.document.createElement('style');
        style.id = FAST_RETURN_STYLE_ID;
        style.textContent = '#intro-curtain{display:none!important}';
        global.document.head.appendChild(style);
    }

    const nativeFetch = global.fetch.bind(global);
    const initialPage = ((global.location && global.location.pathname ? global.location.pathname.split('/').pop() : '') || 'index.html').toLowerCase();
    const INDEX_AUTH_PROTECTED = initialPage === 'index.html';
    let indexAuthStatus = INDEX_AUTH_PROTECTED ? 'checking' : 'disabled';
    let resolveIndexAuthReady = null;
    const indexAuthReadyPromise = INDEX_AUTH_PROTECTED
        ? new Promise(resolve => { resolveIndexAuthReady = resolve; })
        : Promise.resolve(true);

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
        if (isFastHomeReturn()) return;
        indexPendingTimer = global.setTimeout(showIndexPending, 220);
    }

    function buildQuery(params) {
        const search = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                search.set(key, String(value));
            }
        });
        return search.toString();
    }

    function createUuid() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
            const random = Math.random() * 16 | 0;
            const value = character === 'x' ? random : (random & 0x3 | 0x8);
            return value.toString(16);
        });
    }

    function safeStorageGet(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return value === null || value === '' ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function safeStorageSet(key, value) {
        try { localStorage.setItem(key, String(value)); } catch (error) {}
    }

    function detectBrowser() {
        const ua = navigator.userAgent || '';
        if (/Edg\//.test(ua)) return 'Microsoft Edge';
        if (/OPR\//.test(ua)) return 'Opera';
        if (/CriOS\//.test(ua)) return 'Chrome';
        if (/FxiOS\//.test(ua)) return 'Firefox';
        if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
        if (/Firefox\//.test(ua)) return 'Firefox';
        if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
        return 'Navegador';
    }

    function detectPlatform() {
        const ua = navigator.userAgent || '';
        const platform = navigator.userAgentData && navigator.userAgentData.platform
            ? navigator.userAgentData.platform
            : (navigator.platform || '');
        if (/iPad/i.test(ua) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)) return 'iPad';
        if (/iPhone/i.test(ua)) return 'iPhone';
        if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android' : 'Tablet Android';
        if (/Win/i.test(platform)) return 'PC Windows';
        if (/Mac/i.test(platform)) return 'Mac';
        if (/Linux/i.test(platform)) return 'Linux';
        return 'Dispositivo';
    }

    function defaultDeviceName() {
        return detectPlatform() + ' · ' + detectBrowser();
    }

    function getDeviceId() {
        let id = safeStorageGet(DEVICE_ID_KEY, '');
        if (!id) {
            id = createUuid();
            safeStorageSet(DEVICE_ID_KEY, id);
        }
        return id;
    }

    function getDeviceName() {
        return safeStorageGet(DEVICE_NAME_KEY, defaultDeviceName());
    }

    function setDeviceName(name) {
        const clean = String(name || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80) || defaultDeviceName();
        safeStorageSet(DEVICE_NAME_KEY, clean);
        return clean;
    }

    function getDeviceInfo() {
        return Object.freeze({
            id: getDeviceId(),
            name: getDeviceName(),
            platform: detectPlatform(),
            browser: detectBrowser()
        });
    }

    function getOperator() {
        return safeStorageGet(OPERATOR_KEY, 'Sin identificar');
    }

    function setOperator(name) {
        const clean = String(name || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80) || 'Sin identificar';
        safeStorageSet(OPERATOR_KEY, clean);
        return clean;
    }

    function currentPageName() {
        const value = (global.location && global.location.pathname ? global.location.pathname.split('/').pop() : '') || 'index.html';
        return value.slice(0, 120);
    }

    function buildMeta() {
        const device = getDeviceInfo();
        return {
            operador: getOperator(),
            dispositivoId: device.id,
            dispositivoNombre: device.name,
            plataforma: device.platform,
            navegador: device.browser,
            pagina: currentPageName(),
            versionApp: APP_VERSION,
            horaCliente: new Date().toISOString()
        };
    }

    function enrichPayload(payload) {
        const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
        return {
            ...source,
            requestId: source.requestId || createUuid(),
            meta: {
                ...buildMeta(),
                ...(source.meta && typeof source.meta === 'object' ? source.meta : {})
            }
        };
    }

    function parseRequestBody(body) {
        if (typeof body !== 'string') return null;
        try {
            const parsed = JSON.parse(body);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function isAuthenticationRequest(payload) {
        return Boolean(payload && /^AUTH_/i.test(String(payload.tipo || '')));
    }

    function installFetchInstrumentation() {
        if (global[FETCH_PATCH_FLAG]) return;
        global[FETCH_PATCH_FLAG] = true;

        global.fetch = function homeEasyTrackedFetch(resource, init) {
            const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
            const options = { ...(init || {}) };
            const method = String(options.method || (resource && resource.method) || 'GET').toUpperCase();
            const targetsHomeEasy = url.startsWith(API_URL);
            let parsedBody = null;

            if (targetsHomeEasy && method === 'POST' && typeof options.body === 'string') {
                parsedBody = parseRequestBody(options.body);
                if (parsedBody) {
                    options.body = JSON.stringify(enrichPayload(parsedBody));
                }
            }

            const execute = () => nativeFetch(resource, options);

            // En Fase 3A, ninguna consulta comercial del Index sale al servidor
            // hasta que Firebase + la sesión HomeEasy hayan sido validadas.
            // Las rutas AUTH_* quedan exentas para evitar un bloqueo circular.
            if (
                INDEX_AUTH_PROTECTED &&
                targetsHomeEasy &&
                !isAuthenticationRequest(parsedBody) &&
                indexAuthStatus !== 'authorized'
            ) {
                return indexAuthReadyPromise.then(execute);
            }

            return execute();
        };
    }

    async function fetchJson(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

        try {
            const response = await global.fetch(url, {
                redirect: 'follow',
                cache: 'no-store',
                ...(options || {}),
                signal: controller.signal
            });

            const raw = await response.text();
            let data;
            try {
                data = JSON.parse(raw);
            } catch (error) {
                throw new Error('HomeEasy devolvió una respuesta que no se pudo leer.');
            }

            if (!response.ok) {
                throw new Error(data && data.msg ? data.msg : 'La solicitud no se completó.');
            }
            return data;
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new Error('La conexión tardó demasiado. Revisa internet e intenta nuevamente.');
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    async function get(params, options) {
        const query = buildQuery(params);
        return fetchJson(API_URL + (query ? '?' + query : ''), { method: 'GET' }, options && options.timeoutMs);
    }

    async function post(payload, options) {
        return fetchJson(API_URL, {
            method: 'POST',
            // No se agrega Content-Type para conservar compatibilidad con la Web App de Apps Script.
            body: JSON.stringify(enrichPayload(payload || {}))
        }, options && options.timeoutMs);
    }

    function readConfigCache() {
        try {
            const raw = localStorage.getItem(CONFIG_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.savedAt || !parsed.payload) return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function writeConfigCache(payload) {
        try {
            localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
        } catch (error) {}
    }

    function clearConfigCache() {
        try { localStorage.removeItem(CONFIG_CACHE_KEY); } catch (error) {}
    }

    async function getConfiguration(options) {
        const opts = { force: false, allowFallback: true, ...(options || {}) };
        const cached = readConfigCache();
        const cacheAge = cached ? Date.now() - cached.savedAt : Infinity;

        if (!opts.force && cached && cacheAge <= CONFIG_CACHE_FRESH_MS) {
            return { ...cached.payload, source: 'cache' };
        }

        try {
            const data = await get({ tipo: 'GET_CONFIGURACION', t: Date.now() });
            if (!data || data.status !== 'ok' || !data.configuracion) {
                throw new Error(data && data.msg ? data.msg : 'No se pudo cargar la configuración central.');
            }
            writeConfigCache(data);
            return { ...data, source: 'network' };
        } catch (error) {
            if (opts.allowFallback && cached && cacheAge <= CONFIG_CACHE_FALLBACK_MS) {
                return { ...cached.payload, source: 'fallback', warning: error.message };
            }
            throw error;
        }
    }

    function flattenObject(value, prefix, result) {
        const out = result || {};
        const base = prefix || '';
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.keys(value).forEach(key => {
                const path = base ? base + '.' + key : key;
                const item = value[key];
                if (item && typeof item === 'object' && !Array.isArray(item)) flattenObject(item, path, out);
                else out[path] = item;
            });
        }
        return out;
    }

    function getByPath(object, path, fallback) {
        const parts = String(path || '').split('.');
        let cursor = object;
        for (const part of parts) {
            if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return fallback;
            cursor = cursor[part];
        }
        return cursor === undefined || cursor === null ? fallback : cursor;
    }

    function normalizeComparable(value, type) {
        if (type === 'boolean') return Boolean(value);
        if (type === 'number') return Number(value);
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatCOP(value) {
        return '$ ' + Number(value || 0).toLocaleString('es-CO');
    }

    function formatDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('es-CO', {
            year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    }

    function clearSensitiveBrowserCaches() {
        [
            'CACHE_CLIENTES',
            'CACHE_ORDENES',
            'CACHE_EVENTOS',
            CONFIG_CACHE_KEY
        ].forEach(key => {
            try { localStorage.removeItem(key); } catch (error) {}
        });
        [
            'APP_INIT_DONE',
            'HOMEEASY_AGENDA_FOCUS'
        ].forEach(key => {
            try { sessionStorage.removeItem(key); } catch (error) {}
        });
    }

    function loadScriptOnce(src, id, readyTest) {
        if (typeof readyTest === 'function' && readyTest()) return Promise.resolve();
        const existing = global.document && global.document.getElementById(id);
        if (existing) {
            if (existing.dataset.loaded === 'true') return Promise.resolve();
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', reject, { once: true });
            });
        }

        return new Promise((resolve, reject) => {
            const script = global.document.createElement('script');
            script.id = id;
            script.src = src;
            script.async = true;
            script.addEventListener('load', () => {
                script.dataset.loaded = 'true';
                resolve();
            }, { once: true });
            script.addEventListener('error', reject, { once: true });
            (global.document.head || global.document.documentElement).appendChild(script);
        });
    }

    function revealAuthenticatedIndex() {
        indexAuthStatus = 'authorized';
        clearTimeout(indexPendingTimer);
        if (resolveIndexAuthReady) resolveIndexAuthReady(true);
        if (global.document && global.document.documentElement) {
            global.document.documentElement.classList.remove(AUTH_PENDING_CLASS);
        }
        removeSessionValue(INTERNAL_HOME_RETURN_KEY);
        try {
            global.dispatchEvent(new CustomEvent('homeeasy:index-auth-ready', {
                detail: {
                    profile: global.HomeEasyAuth && global.HomeEasyAuth.getCurrentProfile
                        ? global.HomeEasyAuth.getCurrentProfile()
                        : null,
                    timestamp: Date.now()
                }
            }));
        } catch (error) {}
    }

    function redirectIndexToLogin() {
        indexAuthStatus = 'redirecting';
        clearSensitiveBrowserCaches();
        setOperator('Sin identificar');
        if (global.HomeEasyAuth && typeof global.HomeEasyAuth.redirectToLogin === 'function') {
            global.HomeEasyAuth.redirectToLogin('index.html');
            return;
        }
        const fallback = new URL('login.html', global.location.href);
        fallback.searchParams.set('return', 'index.html');
        global.location.replace(fallback.href);
    }

    function isTransientAuthError(error) {
        return Boolean(global.HomeEasyAuth && typeof global.HomeEasyAuth.isTransientError === 'function' && global.HomeEasyAuth.isTransientError(error));
    }

    function showIndexConnectionIssue(error) {
        indexAuthStatus = 'network-error';
        clearTimeout(indexPendingTimer);
        if (global.document && global.document.documentElement) global.document.documentElement.classList.remove(AUTH_PENDING_CLASS);
        const render = () => {
            if (!global.document || !global.document.body || global.document.getElementById('homeeasyIndexConnectionIssue')) return;
            const box = global.document.createElement('div');
            box.id = 'homeeasyIndexConnectionIssue';
            box.setAttribute('role', 'alert');
            box.style.cssText = 'position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;background:rgba(242,242,247,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#252125';
            box.innerHTML = '<section style="width:min(430px,100%);padding:28px;border-radius:24px;background:#fff;box-shadow:0 22px 60px rgba(45,35,40,.14);text-align:center"><div style="font-size:30px;margin-bottom:12px">↻</div><h1 style="margin:0;font-size:1.35rem;letter-spacing:-.035em">Conexión interrumpida</h1><p style="margin:10px auto 20px;max-width:34ch;color:#777075;font-size:.84rem;line-height:1.5">Tu sesión sigue guardada. HomeEasy no pudo verificarla en este momento.</p><button id="homeeasyRetryIndex" style="width:100%;height:50px;border:0;border-radius:14px;background:#a6455a;color:#fff;font-weight:720">Reintentar</button></section>';
            global.document.body.appendChild(box);
            global.document.getElementById('homeeasyRetryIndex').addEventListener('click', () => global.location.reload());
        };
        if (global.document && global.document.body) render();
        else if (global.document) global.document.addEventListener('DOMContentLoaded', render, { once: true });
        console.warn('HomeEasy: sesión conservada por error transitorio.', error);
    }

    function markInternalHomeReturn() {
        writeSessionValue('APP_INIT_DONE', 'true');
        writeSessionValue(INTERNAL_HOME_RETURN_KEY, '1');
    }

    function goHome() {
        markInternalHomeReturn();
        let previousWasIndex = false;
        try {
            if (global.document && global.document.referrer) {
                const previous = new URL(global.document.referrer, global.location.href);
                const current = new URL(global.location.href);
                const previousPage = (previous.pathname.split('/').pop() || 'index.html').toLowerCase();
                previousWasIndex = previous.origin === current.origin && previousPage === 'index.html';
            }
        } catch (error) {}

        if (previousWasIndex && global.history && global.history.length > 1) {
            global.history.back();
            return;
        }
        global.location.assign('index.html');
    }

    function installInternalHomeNavigation() {
        if (!global.document || INDEX_AUTH_PROTECTED) return;
        const install = () => {
            global.document.addEventListener('click', event => {
                if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                const target = event.target && event.target.closest ? event.target.closest('a[href]') : null;
                if (!target || target.target === '_blank' || target.hasAttribute('download')) return;
                let url;
                try { url = new URL(target.getAttribute('href'), global.location.href); } catch (error) { return; }
                const current = new URL(global.location.href);
                const page = (url.pathname.split('/').pop() || 'index.html').toLowerCase();
                if (url.origin !== current.origin || page !== 'index.html') return;
                event.preventDefault();
                goHome();
            }, true);
        };
        if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', install, { once: true });
        else install();
    }

    function installLogoutControl() {
        if (!INDEX_AUTH_PROTECTED || !global.document) return;

        const install = () => {
            if (global.document.getElementById('homeeasyLogoutButton')) return;
            const topActions = global.document.querySelector('.top-actions');
            if (!topActions) return;

            if (!global.document.getElementById(AUTH_LOGOUT_STYLE_ID)) {
                const style = global.document.createElement('style');
                style.id = AUTH_LOGOUT_STYLE_ID;
                style.textContent = `
                    .top-actions.homeeasy-auth-actions {
                        display: flex !important;
                        align-items: center !important;
                        gap: 8px !important;
                    }
                    .top-actions.homeeasy-auth-actions .auth-logout-button {
                        appearance: none;
                        -webkit-appearance: none;
                        flex: 0 0 auto;
                    }
                    .top-actions.homeeasy-auth-actions .auth-logout-button i {
                        color: #a6455a;
                        font-size: 17px;
                    }
                    @media (any-hover:hover) and (any-pointer:fine) {
                        .auth-logout-button:hover {
                            transform: translateY(-3px) scale(1.025);
                            border-color: rgba(166,69,90,.16);
                            box-shadow: 0 13px 30px rgba(42,32,36,.14);
                        }
                    }
                `;
                global.document.head.appendChild(style);
            }

            topActions.classList.add('homeeasy-auth-actions');
            const button = global.document.createElement('button');
            button.type = 'button';
            button.id = 'homeeasyLogoutButton';
            button.className = 'bell-container auth-logout-button';
            button.setAttribute('aria-label', 'Cerrar sesión');
            button.setAttribute('title', 'Cerrar sesión');
            button.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>';
            topActions.insertBefore(button, topActions.firstChild);

            button.addEventListener('click', async () => {
                if (button.disabled) return;
                button.disabled = true;
                const icon = button.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-circle-notch fa-spin';
                try {
                    if (global.HomeEasyAuth && typeof global.HomeEasyAuth.signOut === 'function') {
                        await global.HomeEasyAuth.signOut({ meta: buildMeta() });
                    }
                } finally {
                    clearSensitiveBrowserCaches();
                    setOperator('Sin identificar');
                    global.location.replace('login.html');
                }
            });
        };

        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', install, { once: true });
        } else {
            install();
        }
    }

    async function installIndexAuthGuard() {
        if (!INDEX_AUTH_PROTECTED || !global.document) return;

        scheduleIndexPending();
        try {
            await loadScriptOnce(
                'homeeasy-auth-config.js?v=3.3',
                'homeeasyAuthConfigScript',
                () => Boolean(global.HOMEEASY_AUTH_CONFIG)
            );
            await loadScriptOnce(
                'homeeasy-auth.js?v=3.4',
                'homeeasyAuthScript',
                () => Boolean(global.HomeEasyAuth)
            );

            if (!global.HomeEasyAuth || !global.HomeEasyAuth.isConfigured()) {
                redirectIndexToLogin();
                return;
            }

            let authorized = global.HomeEasyAuth.getCachedHomeEasySession
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
            await loadScriptOnce('homeeasy-account.js?v=3.1', 'homeeasyAccountScript', () => Boolean(global.document && global.document.getElementById('homeeasyAccountControl')));
            revealAuthenticatedIndex();

            if (global.HomeEasyAuth.shouldRevalidateAppSession && global.HomeEasyAuth.shouldRevalidateAppSession(5 * 60 * 1000)) {
                global.HomeEasyAuth.validateAppSession({ meta: buildMeta() }).catch(async error => {
                    if (isTransientAuthError(error)) {
                        console.warn('HomeEasy: revalidación del Index aplazada por conexión.', error);
                        return;
                    }
                    const code = String(error && error.code || '').trim().toUpperCase();
                    const mayRecover = code === 'APP_SESSION_EXPIRED' || code === 'APP_SESSION_REJECTED' || code === 'NO_SESSION';
                    if (mayRecover && global.HomeEasyAuth.restoreHomeEasySession) {
                        try {
                            const recovered = await global.HomeEasyAuth.restoreHomeEasySession({
                                validateFirebase: false,
                                reopen: true,
                                silent: false,
                                preferCache: false,
                                meta: buildMeta()
                            });
                            if (recovered) {
                                const refreshedProfile = global.HomeEasyAuth.getCurrentProfile();
                                if (refreshedProfile) setOperator(refreshedProfile.nombre || refreshedProfile.email || 'Sin identificar');
                                return;
                            }
                        } catch (recoveryError) {
                            if (isTransientAuthError(recoveryError)) {
                                showIndexConnectionIssue(recoveryError);
                                return;
                            }
                        }
                    }
                    redirectIndexToLogin();
                });
            }
        } catch (error) {
            console.error('HomeEasy Auth Guard:', error);
            if (isTransientAuthError(error)) {
                showIndexConnectionIssue(error);
                return;
            }
            redirectIndexToLogin();
        }
    }

    installFetchInstrumentation();

    global.HomeEasyCore = Object.freeze({
        API_URL,
        APP_VERSION,
        get,
        post,
        getConfiguration,
        clearConfigCache,
        clearSensitiveBrowserCaches,
        flattenObject,
        getByPath,
        normalizeComparable,
        escapeHtml,
        formatCOP,
        formatDateTime,
        getOperator,
        setOperator,
        getDeviceInfo,
        getDeviceName,
        setDeviceName,
        buildMeta,
        createRequestId: createUuid,
        indexAuthProtected: INDEX_AUTH_PROTECTED,
        goHome
    });

    installFastHomeReturnStyle();
    installInternalHomeNavigation();
    installIndexAuthGuard();
})(window);
