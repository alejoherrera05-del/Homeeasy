/**
 * HomeEasy Runtime 11A.0
 * Boot coordinator for useful splash-time warming.
 *
 * Scope of this first slice:
 * - Preserve existing CACHE_CLIENTES / CACHE_ORDENES / CACHE_EVENTOS contracts.
 * - Deduplicate identical in-flight reads.
 * - Load the existing bootstrap + agenda datasets concurrently instead of serially.
 * - Keep a small freshness marker for background refresh decisions.
 * - Prefetch likely HTML modules only after data warming, without blocking boot.
 *
 * It does NOT change auth, RBAC, money, writes, document generation or Hommy review mode.
 */
(function (global) {
    'use strict';

    const VERSION = '11A.0';
    const META_KEY = 'HOMEEASY_RUNTIME_BOOT_META_V1';
    const CACHE_FRESH_MS = 5 * 60 * 1000;
    const inFlight = new Map();
    const marks = new Map();

    function now() {
        return global.performance && typeof global.performance.now === 'function'
            ? global.performance.now()
            : Date.now();
    }

    function mark(name) {
        marks.set(String(name), now());
        try { global.performance && global.performance.mark && global.performance.mark(`homeeasy:${name}`); } catch (error) {}
    }

    function duration(startName, endName) {
        const start = marks.get(String(startName));
        const end = marks.get(String(endName));
        return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
    }

    function safeGet(storage, key) {
        try { return storage.getItem(key); } catch (error) { return null; }
    }

    function safeSet(storage, key, value) {
        try { storage.setItem(key, value); return true; } catch (error) { return false; }
    }

    function parseJson(raw, fallback) {
        try {
            const value = JSON.parse(raw);
            return value === undefined || value === null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function buildKey(url, options) {
        const method = String(options && options.method || 'GET').toUpperCase();
        return `${method}:${url}`;
    }

    function requestJson(url, options) {
        const key = buildKey(url, options);
        if (inFlight.has(key)) return inFlight.get(key);

        const task = global.fetch(url, {
            cache: 'no-store',
            ...(options || {})
        }).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        }).finally(() => {
            if (inFlight.get(key) === task) inFlight.delete(key);
        });

        inFlight.set(key, task);
        return task;
    }

    function normalizeClients(rows) {
        const clients = {};
        if (!Array.isArray(rows)) return clients;
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row[0]) continue;
            clients[row[0]] = {
                cedula: row[0],
                nombre: row[1],
                telefono: row[2],
                email: row[3],
                direccion: row[4]
            };
        }
        return clients;
    }

    function normalizeOrders(rows) {
        const orders = [];
        if (!Array.isArray(rows)) return orders;
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            orders.push({
                numero: row[1],
                cedula: row[2],
                nombre: row[3],
                total: row[6],
                // Compatibility-only cached value. Financial confirmation remains live in Abonos.
                saldo: row[17]
            });
        }
        return orders;
    }

    function readMeta() {
        return parseJson(safeGet(global.localStorage, META_KEY), null);
    }

    function isFresh() {
        const meta = readMeta();
        return Boolean(meta && Number(meta.savedAt) > 0 && Date.now() - Number(meta.savedAt) <= CACHE_FRESH_MS);
    }

    function writeMeta(result) {
        const payload = {
            version: VERSION,
            savedAt: Date.now(),
            clients: Number(result && result.clients || 0),
            orders: Number(result && result.orders || 0),
            events: Number(result && result.events || 0),
            bootstrapOk: Boolean(result && result.bootstrapOk),
            agendaOk: Boolean(result && result.agendaOk)
        };
        safeSet(global.localStorage, META_KEY, JSON.stringify(payload));
        return payload;
    }

    function prefetchLikelyPages() {
        if (!global.document || !global.document.head) return;
        const pages = ['clientes.html', 'cotizacion.html', 'pedido.html', 'seguimiento.html', 'abono.html'];
        pages.forEach(href => {
            if (global.document.querySelector(`link[data-homeeasy-prefetch="${href}"]`)) return;
            const link = global.document.createElement('link');
            link.rel = 'prefetch';
            link.href = href;
            link.as = 'document';
            link.dataset.homeeasyPrefetch = href;
            global.document.head.appendChild(link);
        });
    }

    async function warmIndex(apiUrl, options) {
        const opts = { force: false, prefetch: true, ...(options || {}) };
        if (!apiUrl) throw new Error('HomeEasy Runtime necesita la URL del Cerebro.');

        if (!opts.force && isFresh()) {
            if (opts.prefetch) {
                const later = () => prefetchLikelyPages();
                if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(later, { timeout: 2500 });
                else global.setTimeout(later, 900);
            }
            return { status: 'fresh-cache', meta: readMeta() };
        }

        mark('boot-warm-start');

        // Both reads already existed on Index. 11A only makes them concurrent.
        const bootstrapPromise = requestJson(`${apiUrl}?init=LOAD`);
        const agendaPromise = requestJson(`${apiUrl}?tipo=EVENTOS_TODOS`);
        const [bootstrapResult, agendaResult] = await Promise.allSettled([bootstrapPromise, agendaPromise]);

        let clientsCount = 0;
        let ordersCount = 0;
        let eventsCount = 0;
        let bootstrapOk = false;
        let agendaOk = false;

        if (bootstrapResult.status === 'fulfilled') {
            const data = bootstrapResult.value;
            if (data && data.status === 'ok') {
                const clients = normalizeClients(data.clientes);
                const orders = normalizeOrders(data.ordenes);
                clientsCount = Object.keys(clients).length;
                ordersCount = orders.length;
                safeSet(global.localStorage, 'CACHE_CLIENTES', JSON.stringify(clients));
                safeSet(global.localStorage, 'CACHE_ORDENES', JSON.stringify(orders));
                bootstrapOk = true;
            }
        }

        if (agendaResult.status === 'fulfilled') {
            const data = agendaResult.value;
            if (data && Array.isArray(data.eventos)) {
                eventsCount = data.eventos.length;
                safeSet(global.localStorage, 'CACHE_EVENTOS', JSON.stringify(data.eventos));
                agendaOk = true;
            }
        }

        const meta = writeMeta({
            clients: clientsCount,
            orders: ordersCount,
            events: eventsCount,
            bootstrapOk,
            agendaOk
        });

        mark('boot-warm-end');

        if (opts.prefetch) {
            const later = () => prefetchLikelyPages();
            if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(later, { timeout: 3000 });
            else global.setTimeout(later, 1000);
        }

        return {
            status: bootstrapOk || agendaOk ? 'ok' : 'degraded',
            bootstrapOk,
            agendaOk,
            meta,
            warmMs: duration('boot-warm-start', 'boot-warm-end')
        };
    }

    function clear() {
        [META_KEY].forEach(key => {
            try { global.localStorage.removeItem(key); } catch (error) {}
        });
        inFlight.clear();
        marks.clear();
    }

    global.HomeEasyRuntime = Object.freeze({
        version: VERSION,
        warmIndex,
        isFresh,
        readMeta,
        mark,
        duration,
        clear
    });
})(window);
