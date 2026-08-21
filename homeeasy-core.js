/**
 * HomeEasy Core v2.1
 * Capa compartida para comunicación con Google Apps Script.
 * Etapa 2 / 7 — Configuración central.
 */
(function (global) {
    'use strict';

    const API_URL = 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec';
    const CONFIG_CACHE_KEY = 'HOMEEASY_CONFIG_BROWSER_V1';
    const CONFIG_CACHE_FRESH_MS = 5 * 60 * 1000;
    const CONFIG_CACHE_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000;
    const DEFAULT_TIMEOUT_MS = 25000;

    function buildQuery(params) {
        const search = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                search.set(key, String(value));
            }
        });
        return search.toString();
    }

    async function fetchJson(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
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
                throw new Error('El Cerebro de HomeEasy devolvió una respuesta que no se pudo leer.');
            }

            if (!response.ok) {
                throw new Error(data && data.msg ? data.msg : 'La solicitud al Cerebro no se completó.');
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
            body: JSON.stringify(payload || {})
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
            localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({
                savedAt: Date.now(),
                payload
            }));
        } catch (error) {}
    }

    function clearConfigCache() {
        try { localStorage.removeItem(CONFIG_CACHE_KEY); } catch (error) {}
    }

    async function getConfiguration(options) {
        const opts = {
            force: false,
            allowFallback: true,
            ...(options || {})
        };

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
                return {
                    ...cached.payload,
                    source: 'fallback',
                    warning: error.message
                };
            }
            throw error;
        }
    }

    function flattenObject(value, prefix, result) {
        const out = result || {};
        const base = prefix || '';

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.keys(value).forEach((key) => {
                const path = base ? base + '.' + key : key;
                const item = value[key];
                if (item && typeof item === 'object' && !Array.isArray(item)) {
                    flattenObject(item, path, out);
                } else {
                    out[path] = item;
                }
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
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function getOperator() {
        try { return localStorage.getItem('HOMEEASY_OPERADOR_LOCAL') || 'Alejandro'; }
        catch (error) { return 'Alejandro'; }
    }

    function setOperator(name) {
        const clean = String(name || '').trim().substring(0, 80) || 'ADMIN_LOCAL';
        try { localStorage.setItem('HOMEEASY_OPERADOR_LOCAL', clean); } catch (error) {}
        return clean;
    }

    global.HomeEasyCore = Object.freeze({
        API_URL,
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
        setOperator
    });
})(window);
