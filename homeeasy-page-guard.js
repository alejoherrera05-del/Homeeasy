/**
 * HomeEasy Page Guard v3.5
 * Navegación cache-first: usa la sesión ya validada para abrir módulos al instante
 * y revalida silenciosamente en segundo plano. AR permanece fuera de este mapa.
 */
(function (global) {
    'use strict';

    const PAGE_PERMISSIONS = Object.freeze({
        'clientes.html': 'clientes.read',
        'ventas.html': 'ventas.read',
        'cotizacion.html': 'cotizaciones.write',
        'seguimiento.html': 'cotizaciones.read',
        'pedido.html': 'pedidos.write',
        'abono.html': 'abonos.write',
        'caja.html': 'caja.read',
        'documentos.html': 'documentos.read',
        'calendario.html': 'agenda.read',
        'reportes.html': 'reportes.read',
        'configuracion.html': 'config.read',
        'perfil.html': 'perfil.read',
        'Hommychat.html': 'app.access'
    });

    const API_URL = global.HomeEasyCore && global.HomeEasyCore.API_URL
        ? global.HomeEasyCore.API_URL
        : 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec';
    const currentPage = ((global.location && global.location.pathname ? global.location.pathname.split('/').pop() : '') || '').trim();
    const requiredPermission = PAGE_PERMISSIONS[currentPage] || '';
    if (!requiredPermission) return;

    const nativeFetch = global.fetch.bind(global);
    const PENDING_CLASS = 'homeeasy-module-auth-pending';
    const REVALIDATE_AFTER_MS = 5 * 60 * 1000;
    let pageAuthStatus = 'checking';
    let resolvePageReady;
    let pendingTimer = null;
    const pageReady = new Promise(resolve => { resolvePageReady = resolve; });

    function showPendingCover() {
        if (pageAuthStatus !== 'checking' || !global.document || !global.document.documentElement) return;
        global.document.documentElement.classList.add(PENDING_CLASS);
        if (global.document.getElementById('homeeasy-module-auth-style')) return;
        const style = global.document.createElement('style');
        style.id = 'homeeasy-module-auth-style';
        style.textContent = `
            html.${PENDING_CLASS} body { visibility: hidden !important; }
            html.${PENDING_CLASS} { min-height: 100%; background: #f2f2f7 !important; }
            html.${PENDING_CLASS}::before { content:''; position:fixed; z-index:2147483646; inset:0; background:#f2f2f7; }
            html.${PENDING_CLASS}::after { content:'Abriendo HomeEasy…'; position:fixed; z-index:2147483647; left:50%; top:50%; transform:translate(-50%,-50%); color:#777075; font:650 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; white-space:nowrap; }
        `;
        (global.document.head || global.document.documentElement).appendChild(style);
    }

    function schedulePendingCover() {
        clearTimeout(pendingTimer);
        pendingTimer = global.setTimeout(showPendingCover, 220);
    }

    function reveal() {
        clearTimeout(pendingTimer);
        if (global.document && global.document.documentElement) {
            global.document.documentElement.classList.remove(PENDING_CLASS);
        }
    }

    function loadScriptOnce(src, id, ready) {
        if (typeof ready === 'function' && ready()) return Promise.resolve();
        const existing = global.document.getElementById(id);
        if (existing) {
            if (existing.dataset.loaded === 'true' || (typeof ready === 'function' && ready())) return Promise.resolve();
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', reject, { once: true });
            });
        }
        return new Promise((resolve, reject) => {
            const script = global.document.createElement('script');
            script.id = id;
            script.src = src;
            script.async = false;
            script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
            script.addEventListener('error', reject, { once: true });
            (global.document.head || global.document.documentElement).appendChild(script);
        });
    }

    function buildMetaQuery(url) {
        const target = new URL(url, global.location.href);
        const auth = global.HomeEasyAuth;
        const core = global.HomeEasyCore;
        const token = auth && auth.getAppSessionToken ? auth.getAppSessionToken() : '';
        if (token) target.searchParams.set('appSessionToken', token);
        if (core && core.getDeviceInfo) {
            const device = core.getDeviceInfo();
            target.searchParams.set('dispositivoId', device.id || 'SIN_ID');
            target.searchParams.set('dispositivoNombre', device.name || '');
            target.searchParams.set('plataforma', device.platform || '');
            target.searchParams.set('navegador', device.browser || '');
        }
        target.searchParams.set('pagina', currentPage);
        target.searchParams.set('versionApp', '3.4');
        return target.href;
    }

    function parseJsonBody(body) {
        if (typeof body !== 'string') return null;
        try {
            const data = JSON.parse(body);
            return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
        } catch (error) { return null; }
    }

    function isAuthPayload(data) {
        return Boolean(data && /^AUTH_/i.test(String(data.tipo || '')));
    }

    function enrichPost(options) {
        const data = parseJsonBody(options.body);
        if (!data || isAuthPayload(data)) return { options, isAuth: isAuthPayload(data) };
        const token = global.HomeEasyAuth && global.HomeEasyAuth.getAppSessionToken ? global.HomeEasyAuth.getAppSessionToken() : '';
        const meta = global.HomeEasyCore && global.HomeEasyCore.buildMeta ? global.HomeEasyCore.buildMeta() : { pagina: currentPage, versionApp: '3.4' };
        options.body = JSON.stringify({
            ...data,
            appSessionToken: token,
            meta: { ...meta, ...(data.meta && typeof data.meta === 'object' ? data.meta : {}) }
        });
        return { options, isAuth: false };
    }

    function handleSecurityResponse(response) {
        try {
            response.clone().json().then(data => {
                if (!data || typeof data !== 'object') return;
                if (data.requiresLogin === true) redirectToLogin();
                else if (data.forbidden === true || data.code === 'PERMISSION_DENIED') showDenied(data.msg || 'Tu rol no tiene permiso para realizar esta acción.');
            }).catch(() => {});
        } catch (error) {}
        return response;
    }

    function installFetchBridge() {
        global.fetch = function homeEasyAuthorizedFetch(resource, init) {
            const rawUrl = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
            const options = { ...(init || {}) };
            const method = String(options.method || (resource && resource.method) || 'GET').toUpperCase();
            const targetsHomeEasy = rawUrl.startsWith(API_URL);
            if (!targetsHomeEasy) return nativeFetch(resource, options);

            let isAuth = false;
            let finalUrl = rawUrl;
            if (method === 'POST') isAuth = enrichPost(options).isAuth;
            if (method === 'GET') finalUrl = buildMetaQuery(rawUrl);

            const execute = () => nativeFetch(finalUrl || resource, options).then(handleSecurityResponse);
            if (isAuth) return execute();
            return pageReady.then(allowed => {
                if (!allowed) throw new Error('PERMISSION_DENIED');
                return execute();
            });
        };
    }

    function redirectToLogin() {
        if (pageAuthStatus === 'redirecting') return;
        pageAuthStatus = 'redirecting';
        reveal();
        if (global.HomeEasyCore && global.HomeEasyCore.clearSensitiveBrowserCaches) global.HomeEasyCore.clearSensitiveBrowserCaches();
        if (global.HomeEasyAuth && global.HomeEasyAuth.redirectToLogin) global.HomeEasyAuth.redirectToLogin(currentPage + global.location.search + global.location.hash);
        else {
            const url = new URL('login.html', global.location.href);
            url.searchParams.set('return', currentPage + global.location.search + global.location.hash);
            global.location.replace(url.href);
        }
    }

    function isTransientAuthError(error) {
        return Boolean(global.HomeEasyAuth && typeof global.HomeEasyAuth.isTransientError === 'function' && global.HomeEasyAuth.isTransientError(error));
    }

    function showConnectionIssue(error) {
        if (pageAuthStatus === 'network-error') return;
        pageAuthStatus = 'network-error';
        reveal();
        const render = () => {
            if (!global.document || !global.document.body || global.document.getElementById('homeeasyModuleConnectionIssue')) return;
            const overlay = global.document.createElement('div');
            overlay.id = 'homeeasyModuleConnectionIssue';
            overlay.setAttribute('role', 'alert');
            overlay.style.cssText = 'position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;background:rgba(242,242,247,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#252125';
            overlay.innerHTML = '<section style="width:min(430px,100%);padding:28px;border-radius:24px;background:#fff;box-shadow:0 22px 60px rgba(45,35,40,.14);text-align:center"><div style="font-size:30px;margin-bottom:12px">↻</div><h1 style="margin:0;font-size:1.35rem;letter-spacing:-.035em">Conexión interrumpida</h1><p style="margin:10px auto 20px;max-width:35ch;color:#777075;font-size:.84rem;line-height:1.5">No se cerró tu sesión. Reintenta cuando tengas conexión con HomeEasy.</p><button id="homeeasyRetryModule" style="width:100%;height:50px;border:0;border-radius:14px;background:#a6455a;color:#fff;font-weight:720">Reintentar</button><button id="homeeasyBackFromConnection" style="width:100%;height:46px;margin-top:8px;border:0;background:transparent;color:#a6455a;font-weight:680">Volver al Inicio</button></section>';
            global.document.body.appendChild(overlay);
            global.document.getElementById('homeeasyRetryModule').addEventListener('click', () => global.location.reload());
            global.document.getElementById('homeeasyBackFromConnection').addEventListener('click', () => {
                if (global.HomeEasyCore && typeof global.HomeEasyCore.goHome === 'function') global.HomeEasyCore.goHome();
                else global.location.assign('index.html');
            });
        };
        if (global.document && global.document.body) render();
        else if (global.document) global.document.addEventListener('DOMContentLoaded', render, { once: true });
        console.warn('HomeEasy: módulo conservado por error transitorio.', error);
    }

    function showDenied(message) {
        if (pageAuthStatus === 'denied') return;
        pageAuthStatus = 'denied';
        resolvePageReady(false);
        reveal();
        const profile = global.HomeEasyAuth && global.HomeEasyAuth.getCurrentProfile ? global.HomeEasyAuth.getCurrentProfile() : null;
        global.document.body.innerHTML = `<main id="homeeasyAccessDenied" role="alert" style="min-height:100svh;display:grid;place-items:center;padding:24px;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#252125"><section style="width:min(460px,100%);padding:30px;border-radius:26px;background:#fff;box-shadow:0 22px 65px rgba(45,35,40,.12);text-align:center"><div style="width:58px;height:58px;margin:0 auto 17px;border-radius:18px;display:grid;place-items:center;background:rgba(166,69,90,.10);color:#a6455a;font-size:24px">🔒</div><h1 style="margin:0;font-size:1.55rem;letter-spacing:-.04em">Acceso restringido</h1><p style="margin:10px auto 20px;max-width:34ch;color:#777075;font-size:.86rem;line-height:1.55">${String(message || 'Tu rol no tiene permiso para abrir este módulo.').replace(/[<>]/g,'')}</p><div style="margin-bottom:20px;padding:12px 14px;border-radius:15px;background:#f8f6f7;color:#6e676b;font-size:.73rem">${profile ? String(profile.nombre || profile.email || '').replace(/[<>]/g,'') + ' · ' + String(profile.rol || '').replace(/[<>]/g,'') : ''}</div><button id="heBackHome" style="width:100%;height:50px;border:0;border-radius:14px;background:#a6455a;color:#fff;font-weight:720">Volver a HomeEasy</button></section></main>`;
        global.document.getElementById('heBackHome').addEventListener('click', () => {
            if (global.HomeEasyCore && typeof global.HomeEasyCore.goHome === 'function') global.HomeEasyCore.goHome();
            else global.location.assign('index.html');
        });
    }

    function authorizeLocally(session) {
        if (!session || !global.HomeEasyAuth) return false;
        if (!global.HomeEasyAuth.hasPermission(requiredPermission)) {
            showDenied('Tu rol no tiene permiso para abrir este módulo.');
            return false;
        }
        const profile = global.HomeEasyAuth.getCurrentProfile();
        if (profile && global.HomeEasyCore && global.HomeEasyCore.setOperator) global.HomeEasyCore.setOperator(profile.nombre || profile.email || 'Sin identificar');
        pageAuthStatus = 'authorized';
        resolvePageReady(true);
        reveal();
        try { global.dispatchEvent(new CustomEvent('homeeasy:page-auth-ready', { detail: { page: currentPage, permission: requiredPermission, profile, timestamp: Date.now() } })); } catch (error) {}
        if (currentPage === 'configuracion.html') loadScriptOnce('homeeasy-settings-auth-ui.js?v=3.2', 'homeeasySettingsAuthUiScript', () => false).catch(() => {});
        return true;
    }

    function revalidateInBackground() {
        const auth = global.HomeEasyAuth;
        if (!auth || !auth.validateAppSession) return;
        if (auth.shouldRevalidateAppSession && !auth.shouldRevalidateAppSession(REVALIDATE_AFTER_MS)) return;
        auth.validateAppSession({ meta: global.HomeEasyCore && global.HomeEasyCore.buildMeta ? global.HomeEasyCore.buildMeta() : {} })
            .then(() => {
                if (!auth.hasPermission(requiredPermission)) showDenied('Tu rol cambió y ya no tiene acceso a este módulo.');
            })
            .catch(error => {
                if (isTransientAuthError(error)) {
                    console.warn('HomeEasy: revalidación del módulo aplazada por conexión.', error);
                    return;
                }
                redirectToLogin();
            });
    }

    async function authorizePage() {
        schedulePendingCover();
        try {
            await loadScriptOnce('homeeasy-auth-config.js?v=3.2', 'homeeasyAuthConfigScript', () => Boolean(global.HOMEEASY_AUTH_CONFIG));
            await loadScriptOnce('homeeasy-auth.js?v=3.4', 'homeeasyAuthScript', () => Boolean(global.HomeEasyAuth));
            if (!global.HomeEasyAuth || !global.HomeEasyAuth.isConfigured()) { redirectToLogin(); return; }

            const cached = global.HomeEasyAuth.getCachedHomeEasySession ? global.HomeEasyAuth.getCachedHomeEasySession() : null;
            if (cached && authorizeLocally(cached)) {
                revalidateInBackground();
                return;
            }

            const session = await global.HomeEasyAuth.restoreHomeEasySession({
                validateFirebase: false,
                reopen: true,
                silent: true,
                preferCache: true,
                backgroundValidate: false,
                meta: global.HomeEasyCore && global.HomeEasyCore.buildMeta ? global.HomeEasyCore.buildMeta() : {}
            });
            if (!session) { redirectToLogin(); return; }
            if (authorizeLocally(session)) revalidateInBackground();
        } catch (error) {
            console.error('HomeEasy Page Guard:', error);
            if (isTransientAuthError(error)) {
                showConnectionIssue(error);
                return;
            }
            redirectToLogin();
        }
    }

    installFetchBridge();
    authorizePage();

    global.HomeEasyPageGuard = Object.freeze({
        currentPage,
        requiredPermission,
        permissions: PAGE_PERMISSIONS,
        getStatus: () => pageAuthStatus
    });
})(window);
