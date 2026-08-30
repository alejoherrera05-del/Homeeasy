/**
 * HomeEasy WhatsApp Client v0.2.1
 * Cliente seguro para api.homeeasy.com.co.
 *
 * REGLA CRÍTICA:
 * Este módulo NUNCA renueva, reabre, cierra, borra ni modifica la sesión de HomeEasy.
 * Solo lee el appSessionToken y el contexto de dispositivo que HomeEasy ya tiene validado.
 * Un fallo de WhatsApp jamás debe afectar el login ni el ciclo de autorización principal.
 */
(function (global) {
    'use strict';

    if (global.HomeEasyWhatsApp) return;

    const VERSION = '0.2.1';
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

    function cleanHeader(value, maxLength) {
        return encodeURIComponent(String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength || 180));
    }

    function deviceHeaders() {
        const core = global.HomeEasyCore || null;
        let device = null;
        try {
            if (core && typeof core.getDeviceInfo === 'function') device = core.getDeviceInfo();
        } catch (error) {}

        const id = device && device.id ? String(device.id).trim() : '';
        if (!id) {
            throw new HomeEasyWhatsAppError(
                'WHATSAPP_DEVICE_CONTEXT_UNAVAILABLE',
                'WhatsApp todavía no puede identificar este dispositivo. HomeEasy seguirá abierto.',
                null,
                401
            );
        }

        return {
            'X-HomeEasy-Device-Id': cleanHeader(id, 180),
            'X-HomeEasy-Device-Name': cleanHeader(device && device.name, 120),
            'X-HomeEasy-Platform': cleanHeader(device && device.platform, 80),
            'X-HomeEasy-Browser': cleanHeader(device && device.browser, 80)
        };
    }

    function friendlyMessage(status, payload) {
        if (status === 401) return 'WhatsApp no pudo autorizar esta sesión. HomeEasy seguirá abierto; vuelve a intentar desde Integraciones.';
        if (status === 403) return 'Tu usuario no tiene permiso para usar esta función de WhatsApp.';
        if (status === 409) return payload && payload.error ? String(payload.error) : 'WhatsApp ya está conectado o el QR no está disponible.';
        if (status === 503) return 'WhatsApp está reconectando. Intenta nuevamente en unos segundos.';
        if (status >= 500) return 'El servicio de WhatsApp no respondió correctamente.';
        return payload && payload.error ? String(payload.error) : 'No fue posible completar la operación de WhatsApp.';
    }

    async function request(path, options) {
        const opts = options || {};
        const token = sessionToken();

        // Nunca intentar recuperar/modificar la sesión aquí. Page Guard es el único dueño
        // del ciclo de autenticación de HomeEasy.
        if (!token) {
            throw new HomeEasyWhatsAppError(
                'WHATSAPP_HOME_SESSION_UNAVAILABLE',
                'WhatsApp todavía no puede usar la sesión actual. HomeEasy seguirá abierto.',
                null,
                401
            );
        }

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
                    ...deviceHeaders(),
                    ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                    ...(opts.headers || {})
                },
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                signal: controller.signal
            });
        } catch (error) {
            if (error instanceof HomeEasyWhatsAppError) throw error;
            if (error && error.name === 'AbortError') {
                throw new HomeEasyWhatsAppError('WHATSAPP_TIMEOUT', 'WhatsApp tardó demasiado en responder. HomeEasy sigue funcionando.', null, 0);
            }
            throw new HomeEasyWhatsAppError('WHATSAPP_NETWORK', 'No fue posible conectar con WhatsApp. HomeEasy sigue funcionando.', error, 0);
        } finally {
            global.clearTimeout(timer);
        }

        let payload = null;
        try { payload = await response.json(); } catch (error) {}

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
        return request('/api/whatsapp/status');
    }

    function restart() {
        return request('/api/whatsapp/restart', { method: 'POST', body: {} });
    }

    function bootstrap() {
        return request('/api/whatsapp/bootstrap', { method: 'POST', body: {} });
    }

    function qr() {
        return request('/api/whatsapp/qr');
    }

    function testMessage(phone) {
        return request('/api/whatsapp/test-message', {
            method: 'POST',
            body: {
                phone: String(phone || '').trim(),
                text: 'Prueba HomeEasy ✅ La integración de WhatsApp está funcionando correctamente.'
            }
        });
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
        });
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
