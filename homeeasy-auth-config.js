/**
 * HomeEasy Auth configuration + session stability bridge v3.2.
 * Firebase Authentication en plan Spark, sin servicios de pago.
 *
 * La sesión operativa de HomeEasy es opaca, vinculada al usuario/dispositivo y
 * tiene su propia expiración. Un ID token Firebase vencido no debe cerrar una
 * sesión HomeEasy que todavía es válida; Firebase se renueva únicamente cuando
 * realmente hace falta reabrir la sesión operativa.
 */
window.HOMEEASY_AUTH_CONFIG = Object.freeze({
    enabled: true,
    apiKey: 'AIzaSyCc-kiqZ3WxpulA_fKEgNuSNLI2ofCL7eY',
    projectId: 'homeeasy-auth',
    backendUrl: 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec',
    loginPath: 'login.html',
    homePath: 'index.html',
    defaultPersistence: 'session',
    activationPath: 'activar-cuenta.html'
});

(function installHomeEasySessionStability(global) {
    'use strict';

    if (!global || global.__HOMEEASY_SESSION_STABILITY_V32__) return;
    global.__HOMEEASY_SESSION_STABILITY_V32__ = true;

    const STORAGE_KEY = 'HOMEEASY_AUTH_SESSION_V1';
    const APP_EXPIRY_SKEW_MS = 30 * 1000;
    const PROJECT_ID = String(global.HOMEEASY_AUTH_CONFIG && global.HOMEEASY_AUTH_CONFIG.projectId || '').trim();
    let authValue = null;

    function safeGet(storage, key) {
        try { return storage && storage.getItem ? storage.getItem(key) : null; }
        catch (error) { return null; }
    }

    function parseJson(value) {
        try { return JSON.parse(value); }
        catch (error) { return null; }
    }

    function readStoredSession() {
        const sessionRaw = safeGet(global.sessionStorage, STORAGE_KEY);
        if (sessionRaw) {
            const session = parseJson(sessionRaw);
            if (session && session.persistence === 'session' && session.refreshToken) return session;
        }
        const localRaw = safeGet(global.localStorage, STORAGE_KEY);
        if (localRaw) {
            const session = parseJson(localRaw);
            if (session && session.persistence === 'local' && session.refreshToken) return session;
        }
        return null;
    }

    function parseExpiryMs(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value > 100000000000 ? value : value * 1000;
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric > 100000000000 ? numeric : numeric * 1000;
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function decodeJwtPayload(token) {
        const parts = String(token || '').split('.');
        if (parts.length !== 3 || !global.atob) return null;
        try {
            const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
            const binary = global.atob(padded);
            let encoded = '';
            for (let index = 0; index < binary.length; index += 1) {
                encoded += '%' + ('00' + binary.charCodeAt(index).toString(16)).slice(-2);
            }
            return JSON.parse(decodeURIComponent(encoded));
        } catch (error) {
            return null;
        }
    }

    function belongsToHomeEasyProject(session) {
        const payload = decodeJwtPayload(session && session.idToken);
        if (!payload || !PROJECT_ID) return false;
        return String(payload.aud || '') === PROJECT_ID &&
            String(payload.iss || '') === 'https://securetoken.google.com/' + PROJECT_ID;
    }

    function normalizeProfile(source) {
        const value = source && typeof source === 'object' ? source : {};
        return {
            uid: String(value.uid || '').trim(),
            nombre: String(value.nombre || '').trim().slice(0, 160),
            email: String(value.email || '').trim().toLowerCase(),
            rol: String(value.rol || '').trim().toUpperCase(),
            estado: String(value.estado || '').trim().toUpperCase(),
            emailVerificado: value.emailVerificado === true,
            ultimoAcceso: value.ultimoAcceso || '',
            ultimoDispositivo: String(value.ultimoDispositivo || '').trim().slice(0, 160)
        };
    }

    function normalizePermissions(value) {
        if (!Array.isArray(value)) return [];
        return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean))).slice(0, 120);
    }

    function operationalCache() {
        const session = readStoredSession();
        if (!session || !session.appSessionToken || !belongsToHomeEasyProject(session)) return null;
        const appExpiry = parseExpiryMs(session.appSessionExpiresAt);
        if (appExpiry && appExpiry <= Date.now() + APP_EXPIRY_SKEW_MS) return null;
        const profile = normalizeProfile(session.profile);
        if (!profile.uid || profile.estado === 'DESACTIVADO') return null;
        return Object.freeze({
            profile: Object.freeze(profile),
            permissions: Object.freeze(normalizePermissions(session.permissions)),
            expiresAt: session.appSessionExpiresAt || '',
            validatedAt: Number(session.appSessionValidatedAt || 0),
            cached: true,
            source: 'operational-session'
        });
    }

    function patchAuth(api) {
        if (!api || typeof api !== 'object' || api.__SESSION_STABILITY_BRIDGE__) return api;
        const nativeCached = typeof api.getCachedHomeEasySession === 'function'
            ? api.getCachedHomeEasySession.bind(api) : null;
        const nativeRestore = typeof api.restoreHomeEasySession === 'function'
            ? api.restoreHomeEasySession.bind(api) : null;

        const resilientCached = () => {
            try {
                const native = nativeCached ? nativeCached() : null;
                if (native) return native;
            } catch (error) {}
            return operationalCache();
        };

        const patched = {
            ...api,
            __SESSION_STABILITY_BRIDGE__: '3.2',
            getCachedHomeEasySession: resilientCached,
            shouldRevalidateAppSession(maxAgeMs) {
                const cached = resilientCached();
                if (!cached) return true;
                const maxAge = Math.max(30000, Number(maxAgeMs || 5 * 60 * 1000));
                return !cached.validatedAt || Date.now() - cached.validatedAt >= maxAge;
            },
            async restoreHomeEasySession(options) {
                const opts = { preferCache: true, ...(options || {}) };
                if (opts.preferCache !== false) {
                    const cached = resilientCached();
                    if (cached) return cached;
                }
                if (!nativeRestore) return null;
                return nativeRestore(options);
            }
        };
        return Object.freeze(patched);
    }

    const descriptor = Object.getOwnPropertyDescriptor(global, 'HomeEasyAuth');
    if (descriptor && descriptor.configurable === false) {
        authValue = patchAuth(global.HomeEasyAuth);
        return;
    }
    authValue = patchAuth(global.HomeEasyAuth);
    Object.defineProperty(global, 'HomeEasyAuth', {
        configurable: true,
        enumerable: true,
        get() { return authValue; },
        set(value) { authValue = patchAuth(value); }
    });
})(window);
