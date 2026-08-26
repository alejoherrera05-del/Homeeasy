/**
 * HomeEasy Page Guard v3C-prep
 * Guard reutilizable para módulos internos.
 * Requiere homeeasy-core.js y usa la sesión general de Firebase/HomeEasy 9A.
 * AR queda deliberadamente fuera de este mapa.
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
        'Hommychat.html': 'app.access',
        'asistente.html': 'app.access'
    });

    const API_URL = global.HomeEasyCore && global.HomeEasyCore.API_URL
        ? global.HomeEasyCore.API_URL
        : 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec';
    const currentPage = ((global.location && global.location.pathname ? global.location.pathname.split('/').pop() : '') || '').trim();
    const requiredPermission = PAGE_PERMISSIONS[currentPage] || '';
    if (!requiredPermission) return;

    const nativeFetch = global.fetch.bind(global);
    const PENDING_CLASS = 'homeeasy-module-auth-pending';
    let pageAuthStatus = 'checking';
    let resolvePageReady;
    const pageReady = new Promise(resolve => { resolvePageReady = resolve; });

    function installPendingCover() {
        if (!global.document || !global.document.documentElement) return;
        global.document.documentElement.classList.add(PENDING_CLASS);
        const style = global.document.createElement('style');
        style.id = 'homeeasy-module-auth-style';
        style.textContent = `
            html.${PENDING_CLASS} body { visibility: hidden !important; }
            html.${PENDING_CLASS} { min-height: 100%; background: #f2f2f7 !important; }
            html.${PENDING_CLASS}::before {
                content: '';
                position: fixed;
                z-index: 2147483646;
                inset: 0;
                background: radial-gradient(circle at 50% 44%, rgba(166,69,90,.08), transparent 28%), #f2f2f7;
            }
            html.${PENDING_CLASS}::after {
                content: 'HomeEasy · verificando permisos…';
                position: fixed;
                z-index: 2147483647;
                left: 50%; top: 50%; transform: translate(-50%,-50%);
                color: #6e686c;
                font: 650 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
                white-space: nowrap;
            }
        `;
        (global.document.head || global.document.documentElement).appendChild(style);
    }

    function reveal() {
        if (global.document && global.document.documentElement) {
            global.document.documentElement.classList.remove(PENDING_CLASS);
        }
    }

    function loadScriptOnce(src, id, ready) {
        if (typeof ready === 'function' && ready()) return Promise.resolve();
        const existing = global.document.getElementById(id);
        if (existing) {
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
            script.addEventListener('load', resolve, { once: true });
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
        target.searchParams.set('versionApp', '3C');
        return target.href;
    }

    function parseJsonBody(body) {
        if (typeof body !== 'string') return null;
        try {
            const data = JSON.parse(body);
            return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
        } catch (error) {
            return null;
        }
    }

    function isAuthPayload(data) {
        return Boolean(data && /^AUTH_/i.test(String(data.tipo || '')));
    }

    function enrichPost(options) {
        const data = parseJsonBody(options.body);
        if (!data || isAuthPayload(data)) return { options, isAuth: isAuthPayload(data) };
        const token = global.HomeEasyAuth && global.HomeEasyAuth.getAppSessionToken
            ? global.HomeEasyAuth.getAppSessionToken()
            : '';
        const meta = global.HomeEasyCore && global.HomeEasyCore.buildMeta
            ? global.HomeEasyCore.buildMeta()
            : { pagina: currentPage, versionApp: '3C' };
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
                if (data.requiresLogin === true) {
                    global.HomeEasyAuth.redirectToLogin(currentPage + global.location.search + global.location.hash);
                } else if (data.forbidden === true || data.code === 'PERMISSION_DENIED') {
                    showDenied(data.msg || 'Tu rol no tiene permiso para realizar esta acción.');
                }
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
            if (method === 'POST') {
                const enriched = enrichPost(options);
                isAuth = enriched.isAuth;
            }
            if (method === 'GET') {
                finalUrl = buildMetaQuery(rawUrl);
            }

            const execute = () => nativeFetch(finalUrl || resource, options).then(handleSecurityResponse);
            if (isAuth) return execute();
            return pageReady.then(allowed => {
                if (!allowed) throw new Error('PERMISSION_DENIED');
                return execute();
            });
        };
    }

    function redirectToLogin() {
        pageAuthStatus = 'redirecting';
        if (global.HomeEasyCore && global.HomeEasyCore.clearSensitiveBrowserCaches) {
            global.HomeEasyCore.clearSensitiveBrowserCaches();
        }
        if (global.HomeEasyAuth && global.HomeEasyAuth.redirectToLogin) {
            global.HomeEasyAuth.redirectToLogin(currentPage + global.location.search + global.location.hash);
        } else {
            const url = new URL('login.html', global.location.href);
            url.searchParams.set('return', currentPage + global.location.search + global.location.hash);
            global.location.replace(url.href);
        }
    }

    function showDenied(message) {
        if (pageAuthStatus === 'denied') return;
        pageAuthStatus = 'denied';
        resolvePageReady(false);
        reveal();
        const profile = global.HomeEasyAuth && global.HomeEasyAuth.getCurrentProfile
            ? global.HomeEasyAuth.getCurrentProfile()
            : null;
        global.document.body.innerHTML = `
            <main style="min-height:100svh;display:grid;place-items:center;padding:24px;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#252125">
                <section style="width:min(460px,100%);padding:30px;border-radius:26px;background:#fff;box-shadow:0 22px 65px rgba(45,35,40,.12);text-align:center">
                    <div style="width:58px;height:58px;margin:0 auto 17px;border-radius:18px;display:grid;place-items:center;background:rgba(166,69,90,.10);color:#a6455a;font-size:24px">🔒</div>
                    <h1 style="margin:0;font-size:1.55rem;letter-spacing:-.04em">Acceso restringido</h1>
                    <p style="margin:10px auto 20px;max-width:34ch;color:#777075;font-size:.86rem;line-height:1.55">${String(message || 'Tu rol no tiene permiso para abrir este módulo.').replace(/[<>]/g,'')}</p>
                    <div style="margin-bottom:20px;padding:12px 14px;border-radius:15px;background:#f8f6f7;color:#6e676b;font-size:.73rem">${profile ? String(profile.nombre || profile.email || '').replace(/[<>]/g,'') + ' · ' + String(profile.rol || '').replace(/[<>]/g,'') : ''}</div>
                    <button id="heBackHome" style="width:100%;height:50px;border:0;border-radius:14px;background:#a6455a;color:#fff;font-weight:720">Volver a HomeEasy</button>
                </section>
            </main>`;
        global.document.getElementById('heBackHome').addEventListener('click', () => global.location.replace('index.html'));
    }

    async function authorizePage() {
        try {
            await loadScriptOnce('homeeasy-auth-config.js?v=3C', 'homeeasyAuthConfigScript', () => Boolean(global.HOMEEASY_AUTH_CONFIG));
            await loadScriptOnce('homeeasy-auth.js?v=3C', 'homeeasyAuthScript', () => Boolean(global.HomeEasyAuth));
            if (!global.HomeEasyAuth || !global.HomeEasyAuth.isConfigured()) {
                redirectToLogin();
                return;
            }
            const session = await global.HomeEasyAuth.restoreHomeEasySession({
                validateFirebase: false,
                reopen: true,
                silent: true,
                meta: global.HomeEasyCore && global.HomeEasyCore.buildMeta ? global.HomeEasyCore.buildMeta() : {}
            });
            if (!session) {
                redirectToLogin();
                return;
            }
            if (!global.HomeEasyAuth.hasPermission(requiredPermission)) {
                showDenied('Tu rol no tiene permiso para abrir este módulo.');
                return;
            }
            const profile = global.HomeEasyAuth.getCurrentProfile();
            if (profile && global.HomeEasyCore && global.HomeEasyCore.setOperator) {
                global.HomeEasyCore.setOperator(profile.nombre || profile.email || 'Sin identificar');
            }
            pageAuthStatus = 'authorized';
            resolvePageReady(true);
            reveal();
            try {
                global.dispatchEvent(new CustomEvent('homeeasy:page-auth-ready', {
                    detail: { page: currentPage, permission: requiredPermission, profile, timestamp: Date.now() }
                }));
            } catch (error) {}
        } catch (error) {
            console.error('HomeEasy Page Guard:', error);
            redirectToLogin();
        }
    }

    installPendingCover();
    installFetchBridge();
    authorizePage();

    global.HomeEasyPageGuard = Object.freeze({
        currentPage,
        requiredPermission,
        permissions: PAGE_PERMISSIONS,
        getStatus: () => pageAuthStatus
    });
})(window);
