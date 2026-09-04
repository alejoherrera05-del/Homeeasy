/**
 * HomeEasy Runtime Cache 11A.2
 *
 * Extension of the certified 11A.1 Boot Manager.
 * It turns the already-warmed CACHE_CLIENTES bundle into an authorized,
 * instant read source for Clientes, Cotizacion and Pedido.
 *
 * Safety:
 * - Page Guard remains the outer auth/RBAC gate.
 * - Only equivalent client-list reads are cacheable.
 * - Client history, writes, PDFs and financial reads stay live.
 */
(function (global) {
    'use strict';

    const VERSION = '11A.2';
    const META_KEY = 'HOMEEASY_RUNTIME_BOOT_META_V1';
    const AUTH_SESSION_KEY = 'HOMEEASY_AUTH_SESSION_V1';
    const CLIENTS_KEY = 'CACHE_CLIENTES';
    const FRESH_MS = 5 * 60 * 1000;
    const REVALIDATE_AFTER_MS = 60 * 1000;
    const TARGET_PAGES = new Set(['clientes.html', 'cotizacion.html', 'pedido.html']);
    const backgroundInFlight = new Map();
    let indexSource = null;
    let searchIndex = [];

    const baseRuntime = global.HomeEasyRuntime || null;
    const baseFetch = global.fetch.bind(global);

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function safeGet(storage, key) {
        try { return storage && storage.getItem ? storage.getItem(key) : null; }
        catch (error) { return null; }
    }

    function safeSet(storage, key, value) {
        try { storage.setItem(key, value); return true; }
        catch (error) { return false; }
    }

    function parseJson(raw, fallback) {
        try {
            const value = JSON.parse(raw);
            return value === undefined || value === null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function currentPage() {
        const path = global.location && global.location.pathname ? global.location.pathname : '';
        return (path.split('/').pop() || 'index.html').toLowerCase();
    }

    function readSession() {
        return parseJson(safeGet(global.sessionStorage, AUTH_SESSION_KEY), null)
            || parseJson(safeGet(global.localStorage, AUTH_SESSION_KEY), null);
    }

    function currentUserScope() {
        const session = readSession();
        const uid = clean(session && session.profile && session.profile.uid);
        return uid ? `uid:${uid}` : '';
    }

    function readMeta() {
        return parseJson(safeGet(global.localStorage, META_KEY), null);
    }

    function writeScopedMeta(meta) {
        const scope = currentUserScope();
        if (!scope || !meta || typeof meta !== 'object') return meta;
        const scoped = {
            ...meta,
            cacheVersion: VERSION,
            userScope: scope
        };
        safeSet(global.localStorage, META_KEY, JSON.stringify(scoped));
        return scoped;
    }

    function isFresh() {
        const meta = readMeta();
        const scope = currentUserScope();
        return Boolean(
            scope &&
            meta &&
            meta.cacheVersion === VERSION &&
            meta.userScope === scope &&
            meta.bootstrapOk === true &&
            Number(meta.savedAt) > 0 &&
            Date.now() - Number(meta.savedAt) <= FRESH_MS
        );
    }

    function invalidateClients() {
        const meta = readMeta();
        if (!meta) return;
        safeSet(global.localStorage, META_KEY, JSON.stringify({
            ...meta,
            cacheVersion: VERSION,
            userScope: currentUserScope() || meta.userScope || '',
            savedAt: 0,
            bootstrapOk: false
        }));
        indexSource = null;
        searchIndex = [];
    }

    function normalizeClientObject(value, key) {
        const source = value && typeof value === 'object' ? value : {};
        const cedula = clean(source.cedula || source.documento || source.id || key);
        if (!cedula || /^c[eé]dula$/i.test(cedula)) return null;
        return {
            cedula,
            nombre: clean(source.nombre),
            telefono: clean(source.telefono),
            email: clean(source.email),
            direccion: clean(source.direccion)
        };
    }

    function normalizeClientRow(row) {
        if (!Array.isArray(row)) return null;
        const cedula = clean(row[0]);
        if (!cedula || /^c[eé]dula$/i.test(cedula)) return null;
        return {
            cedula,
            nombre: clean(row[1]),
            telefono: clean(row[2]),
            email: clean(row[3]),
            direccion: clean(row[4])
        };
    }

    function normalizeClientMap(source) {
        const clients = {};
        if (!source) return clients;

        if (Array.isArray(source)) {
            source.forEach(item => {
                const client = Array.isArray(item)
                    ? normalizeClientRow(item)
                    : normalizeClientObject(item);
                if (client) clients[client.cedula] = client;
            });
            return clients;
        }

        if (typeof source === 'object') {
            Object.keys(source).forEach(key => {
                const raw = source[key];
                const client = Array.isArray(raw)
                    ? normalizeClientRow(raw)
                    : normalizeClientObject(raw, key);
                if (client) clients[client.cedula] = client;
            });
        }
        return clients;
    }

    function readMap(options) {
        const opts = { requireFresh: true, ...(options || {}) };
        if (opts.requireFresh && !isFresh()) return null;
        const raw = parseJson(safeGet(global.localStorage, CLIENTS_KEY), null);
        if (!raw) return null;
        const map = normalizeClientMap(raw);
        return Object.keys(map).length ? map : null;
    }

    function toList(map) {
        return Object.values(map || {}).map(client => ({ ...client }));
    }

    function toRows(map) {
        const rows = [['CEDULA', 'NOMBRE', 'TELEFONO', 'EMAIL', 'DIRECCION']];
        Object.values(map || {}).forEach(client => {
            rows.push([
                client.cedula || '',
                client.nombre || '',
                client.telefono || '',
                client.email || '',
                client.direccion || ''
            ]);
        });
        return rows;
    }

    function readClients(options) {
        const opts = { format: 'map', requireFresh: true, ...(options || {}) };
        const map = readMap({ requireFresh: opts.requireFresh });
        if (!map) return null;
        if (opts.format === 'list') return toList(map);
        if (opts.format === 'rows') return toRows(map);
        return map;
    }

    function normalizeSearch(value) {
        return clean(value)
            .toLocaleLowerCase('es')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function ensureIndex(map) {
        const signature = Object.keys(map || {}).join('|');
        if (indexSource === signature) return searchIndex;
        indexSource = signature;
        searchIndex = Object.values(map || {}).map(client => ({
            client,
            text: normalizeSearch([
                client.cedula,
                client.nombre,
                client.telefono,
                client.email,
                client.direccion
            ].join(' '))
        }));
        return searchIndex;
    }

    function searchClients(query, options) {
        const opts = { limit: 8, requireFresh: true, ...(options || {}) };
        const needle = normalizeSearch(query);
        if (!needle) return [];
        const map = readMap({ requireFresh: opts.requireFresh });
        if (!map) return [];
        const results = [];
        for (const entry of ensureIndex(map)) {
            if (!entry.text.includes(needle)) continue;
            results.push({ ...entry.client });
            if (results.length >= Math.max(1, Number(opts.limit) || 8)) break;
        }
        return results;
    }

    function apiUrl() {
        return global.HomeEasyCore && global.HomeEasyCore.API_URL
            ? String(global.HomeEasyCore.API_URL)
            : '';
    }

    function isApiUrl(rawUrl) {
        try {
            const api = new URL(apiUrl(), global.location.href);
            const target = new URL(rawUrl, global.location.href);
            return Boolean(apiUrl() && target.origin === api.origin && target.pathname === api.pathname);
        } catch (error) {
            return false;
        }
    }

    function classifyRead(rawUrl, method) {
        if (String(method || 'GET').toUpperCase() !== 'GET') return '';
        const page = currentPage();
        if (!TARGET_PAGES.has(page) || !isApiUrl(rawUrl)) return '';
        try {
            const url = new URL(rawUrl, global.location.href);
            if (page === 'clientes.html' && url.searchParams.get('listaClientes') === '1') {
                return 'clients-list';
            }
            if ((page === 'cotizacion.html' || page === 'pedido.html') && url.searchParams.get('init') === 'LOAD') {
                return 'bootstrap-clients';
            }
        } catch (error) {}
        return '';
    }

    function cachedPayload(kind) {
        const map = readMap({ requireFresh: true });
        if (!map) return null;
        if (kind === 'clients-list') {
            return { status: 'ok', clientes: toList(map), source: 'runtime-cache', runtimeVersion: VERSION };
        }
        if (kind === 'bootstrap-clients') {
            return { status: 'ok', clientes: toRows(map), source: 'runtime-cache', runtimeVersion: VERSION };
        }
        return null;
    }

    function cachedResponse(payload) {
        return new Response(JSON.stringify(payload), {
            status: 200,
            statusText: 'OK',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'X-HomeEasy-Cache': 'hit'
            }
        });
    }

    function updateClients(kind, data) {
        if (!data || data.status !== 'ok' || !Array.isArray(data.clientes)) return false;
        const map = normalizeClientMap(data.clientes);
        const count = Object.keys(map).length;
        if (!count) return false;

        safeSet(global.localStorage, CLIENTS_KEY, JSON.stringify(map));
        indexSource = null;
        searchIndex = [];

        const previous = readMeta() || {};
        writeScopedMeta({
            ...previous,
            savedAt: Date.now(),
            clients: count,
            bootstrapOk: true
        });

        try {
            global.dispatchEvent(new CustomEvent('homeeasy:runtime-clients-updated', {
                detail: { count, kind, version: VERSION }
            }));
        } catch (error) {}
        return true;
    }

    function shouldRevalidate() {
        const meta = readMeta();
        return !meta || !Number(meta.savedAt) || Date.now() - Number(meta.savedAt) >= REVALIDATE_AFTER_MS;
    }

    function backgroundRevalidate(kind, url, options) {
        if (!shouldRevalidate()) return;
        const key = `${kind}:${url}`;
        if (backgroundInFlight.has(key)) return;

        const task = baseFetch(url, {
            cache: 'no-store',
            ...(options || {})
        }).then(async response => {
            if (!response.ok) return null;
            const data = await response.clone().json();
            updateClients(kind, data);
            return data;
        }).catch(error => {
            console.warn('HomeEasy 11A.2: revalidación silenciosa omitida.', error);
            return null;
        }).finally(() => {
            if (backgroundInFlight.get(key) === task) backgroundInFlight.delete(key);
        });

        backgroundInFlight.set(key, task);
    }

    function parsePost(body) {
        if (typeof body !== 'string') return null;
        return parseJson(body, null);
    }

    function affectsClients(method, options) {
        if (String(method || 'GET').toUpperCase() !== 'POST') return false;
        const payload = parsePost(options && options.body);
        const type = clean(payload && payload.tipo).toLowerCase();
        return type === 'actualizar_cliente' || type === 'guardar_cliente' || type === 'crear_cliente';
    }

    function installCacheFetch() {
        if (!TARGET_PAGES.has(currentPage())) return;
        if (global.__HOMEEASY_RUNTIME_CACHE_11A2__) return;
        global.__HOMEEASY_RUNTIME_CACHE_11A2__ = true;

        global.fetch = function homeEasyRuntimeCacheFetch(resource, init) {
            const rawUrl = typeof resource === 'string'
                ? resource
                : (resource && resource.url ? resource.url : '');
            const options = { ...(init || {}) };
            const method = String(options.method || (resource && resource.method) || 'GET').toUpperCase();
            const kind = classifyRead(rawUrl, method);

            if (kind) {
                const payload = cachedPayload(kind);
                if (payload) {
                    // Page Guard is loaded after this file and stays the outer security gate.
                    backgroundRevalidate(kind, rawUrl, options);
                    return Promise.resolve(cachedResponse(payload));
                }
            }

            return baseFetch(resource, options).then(response => {
                if (kind && response && response.ok) {
                    response.clone().json().then(data => updateClients(kind, data)).catch(() => {});
                }
                if (isApiUrl(rawUrl) && affectsClients(method, options) && response && response.ok) {
                    invalidateClients();
                }
                return response;
            });
        };
    }

    function installRuntimeExtension() {
        if (!baseRuntime || typeof baseRuntime !== 'object') return;

        const nativeWarmIndex = typeof baseRuntime.warmIndex === 'function'
            ? baseRuntime.warmIndex.bind(baseRuntime)
            : null;

        const extended = {
            ...baseRuntime,
            cacheVersion: VERSION,
            readClients,
            searchClients,
            isSharedCacheFresh: isFresh,
            invalidateClientFreshness: invalidateClients
        };

        if (nativeWarmIndex) {
            extended.warmIndex = async function scopedWarmIndex(url, options) {
                const result = await nativeWarmIndex(url, options);
                writeScopedMeta(baseRuntime.readMeta ? baseRuntime.readMeta() : readMeta());
                return result;
            };
        }

        global.HomeEasyRuntime = Object.freeze(extended);
    }

    installRuntimeExtension();
    installCacheFetch();

    global.HomeEasyRuntimeCache = Object.freeze({
        version: VERSION,
        isFresh,
        readClients,
        searchClients,
        invalidateClients
    });
})(window);
