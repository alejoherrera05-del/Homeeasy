/**
 * HomeEasy WhatsApp Client v0.1.0
 * Cliente seguro para api.homeeasy.com.co.
 * Usa la sesión operativa de HomeEasy; nunca contiene BRIDGE_TOKEN ni WAHA_API_KEY.
 */
(function (global) {
    'use strict';

    if (global.HomeEasyWhatsApp) return;

    const VERSION = '0.1.0';
    const BASE_URL = 'https://api.homeeasy.com.co';
    const REQUEST_TIMEOUT_MS = 25000;

    class HomeEasyWhatsAppError extends Error {
        constructor(code, message, details, status) {
            super(message || 'No fue posible comunicarse con WhatsApp.');
            this.name = 'HomeEasyWhatsAppError';
            this.code = String(code || 'WHATSAPP_ERROR');
            this.details = details || null;
            this.status = Number(status || 0);
        }
    }

    function authApi() {
        return global.HomeEasyAuth || null;
    }

    function sessionToken() {
        const auth = authApi();
        return auth && typeof auth.getAppSessionToken === 'function'
            ? String(auth.getAppSessionToken() || '').trim()
            : '';
    }

    async function refreshOperationalSession() {
        const auth = authApi();
        if (!auth || typeof auth.restoreHomeEasySession !== 'function') return false;
        try {
            const restored = await auth.restoreHomeEasySession({
                validateFirebase: false,
                reopen: true,
                silent: false,
                preferCache: false,
                meta: global.HomeEasyCore && typeof global.HomeEasyCore.buildMeta === 'function'
                    ? global.HomeEasyCore.buildMeta({ canal: 'whatsapp' })
                    : { pagina: (global.location.pathname.split('/').pop() || '') }
            });
            return Boolean(restored && sessionToken());
        } catch (error) {
            return false;
        }
    }

    function friendlyMessage(status, payload) {
        if (status === 401) return 'Tu sesión de HomeEasy necesita renovarse.';
        if (status === 403) return 'Tu usuario no tiene permiso para usar esta función de WhatsApp.';
        if (status === 409) return payload && payload.error ? String(payload.error) : 'WhatsApp ya está conectado o el QR no está disponible.';
        if (status === 503) return 'WhatsApp está reconectando. Intenta nuevamente en unos segundos.';
        if (status >= 500) return 'El servicio de WhatsApp no respondió correctamente.';
        return payload && payload.error ? String(payload.error) : 'No fue posible completar la operación de WhatsApp.';
    }

    async function request(path, options, allowRecovery) {
        const opts = options || {};
        let token = sessionToken();
        if (!token && allowRecovery !== false) {
            await refreshOperationalSession();
            token = sessionToken();
        }
        if (!token) throw new HomeEasyWhatsAppError('NO_HOMEASY_SESSION', 'No hay una sesión activa de HomeEasy.', null, 401);

        const controller = new AbortController();
        const timer = global.setTimeout(() => controller.abort(), Number(opts.timeoutMs || REQUEST_TIMEOUT_MS));
        let response;
        try {
            response = await global.fetch(BASE_URL + path, {
                method: String(opts.method || 'GET').toUpperCase(),
                mode: 'cors',
                cache: 'no-store',
                headers: {
                    'Accept': 'application/json',
                    'X-HomeEasy-Session': token,
                    ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                    ...(opts.headers || {})
                },
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                signal: controller.signal
            });
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new HomeEasyWhatsAppError('WHATSAPP_TIMEOUT', 'WhatsApp tardó demasiado en responder.');
            }
            throw new HomeEasyWhatsAppError('WHATSAPP_NETWORK', 'No fue posible conectar con el servicio de WhatsApp.', error);
        } finally {
            global.clearTimeout(timer);
        }

        let payload = null;
        try { payload = await response.json(); } catch (error) {}

        if (response.status === 401 && allowRecovery !== false) {
            const recovered = await refreshOperationalSession();
            if (recovered) return request(path, opts, false);
        }

        if (!response.ok && response.status !== 202) {
            throw new HomeEasyWhatsAppError(
                'WHATSAPP_HTTP_' + response.status,
                friendlyMessage(response.status, payload),
                payload,
                response.status
            );
        }
        return payload || { ok: response.ok };
    }

    function status() {
        return request('/api/whatsapp/status', {}, true);
    }

    function restart() {
        return request('/api/whatsapp/restart', { method: 'POST', body: {} }, true);
    }

    function bootstrap() {
        return request('/api/whatsapp/bootstrap', { method: 'POST', body: {} }, true);
    }

    function qr() {
        return request('/api/whatsapp/qr', {}, true);
    }

    function testMessage(phone) {
        return request('/api/whatsapp/test-message', {
            method: 'POST',
            body: {
                phone: String(phone || '').trim(),
                text: 'Prueba HomeEasy ✅ La integración de WhatsApp está funcionando correctamente.'
            }
        }, true);
    }

    function sendDocument(options) {
        const opts = options || {};
        return request('/api/whatsapp/send-document', {
            method: 'POST',
            timeoutMs: 105000,
            body: {
                documentType: String(opts.documentType || '').trim().toLowerCase(),
                phone: String(opts.phone || '').trim(),
                pdfBase64: String(opts.pdfBase64 || ''),
                filename: String(opts.filename || 'HomeEasy.pdf'),
                caption: String(opts.caption || ''),
                idempotencyKey: String(opts.idempotencyKey || '')
            }
        }, true);
    }

    function connectedPhone(statusPayload) {
        const raw = statusPayload && statusPayload.whatsapp && statusPayload.whatsapp.me
            ? String(statusPayload.whatsapp.me.id || '')
            : '';
        return raw.replace(/@c\.us$/i, '');
    }

    global.HomeEasyWhatsApp = Object.freeze({
        VERSION,
        BASE_URL,
        HomeEasyWhatsAppError,
        status,
        restart,
        bootstrap,
        qr,
        testMessage,
        sendDocument,
        connectedPhone
    });
})(window);
