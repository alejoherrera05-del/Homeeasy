/**
 * HomeEasy Core v2.2
 * Comunicación central, identificación del dispositivo y trazabilidad.
 * No cambia la lógica de negocio de los formularios existentes.
 */
(function (global) {
    'use strict';

    const API_URL = 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec';
    const APP_VERSION = '2.2';
    const CONFIG_CACHE_KEY = 'HOMEEASY_CONFIG_BROWSER_V1';
    const CONFIG_CACHE_FRESH_MS = 5 * 60 * 1000;
    const CONFIG_CACHE_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000;
    const DEFAULT_TIMEOUT_MS = 25000;
    const OPERATOR_KEY = 'HOMEEASY_OPERADOR_LOCAL';
    const DEVICE_ID_KEY = 'HOMEEASY_DEVICE_ID';
    const DEVICE_NAME_KEY = 'HOMEEASY_DEVICE_NAME';
    const FETCH_PATCH_FLAG = '__HOMEEASY_FETCH_PATCHED_V22__';

    const nativeFetch = global.fetch.bind(global);

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

    function installFetchInstrumentation() {
        if (global[FETCH_PATCH_FLAG]) return;
        global[FETCH_PATCH_FLAG] = true;

        global.fetch = function homeEasyTrackedFetch(resource, init) {
            const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
            const options = { ...(init || {}) };
            const method = String(options.method || (resource && resource.method) || 'GET').toUpperCase();

            if (url.startsWith(API_URL) && method === 'POST' && typeof options.body === 'string') {
                try {
                    const parsed = JSON.parse(options.body);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        options.body = JSON.stringify(enrichPayload(parsed));
                    }
                } catch (error) {
                    // Se conserva el cuerpo original cuando no es JSON.
                }
            }

            return nativeFetch(resource, options);
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

    installFetchInstrumentation();

    global.HomeEasyCore = Object.freeze({
        API_URL,
        APP_VERSION,
        get,
        post,
        getConfiguration,
        clearConfigCache,
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
        createRequestId: createUuid
    });
})(window);
