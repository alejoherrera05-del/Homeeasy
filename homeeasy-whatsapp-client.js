/**
 * HomeEasy WhatsApp Client v0.4.0
 * Cliente seguro para api.homeeasy.com.co.
 *
 * REGLA CRÍTICA:
 * Este módulo NUNCA renueva, reabre, cierra, borra ni modifica la sesión de HomeEasy.
 * Solo lee el appSessionToken que HomeEasy ya tenga validado y lo presenta al Bridge.
 * Un fallo de WhatsApp jamás debe afectar el login ni el ciclo de autorización principal.
 */
(function (global) {
    'use strict';

    if (global.HomeEasyWhatsApp) return;

    const VERSION = '0.4.0';
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

    function deviceHeaders() {
        const auth = authApi();
        if (!auth || typeof auth.buildMeta !== 'function') return {};

        let meta = null;
        try {
            meta = auth.buildMeta({ pagina: 'whatsapp-bridge-client' });
        } catch (error) {
            meta = null;
        }
        if (!meta || typeof meta !== 'object') return {};

        const headers = {};
        const deviceId = String(meta.dispositivoId || '').trim();
        const deviceName = String(meta.dispositivoNombre || '').trim();
        const platform = String(meta.plataforma || '').trim();
        const browser = String(meta.navegador || '').trim();

        if (deviceId) headers['X-HomeEasy-Device-Id'] = encodeURIComponent(deviceId);
        if (deviceName) headers['X-HomeEasy-Device-Name'] = encodeURIComponent(deviceName);
        if (platform) headers['X-HomeEasy-Platform'] = encodeURIComponent(platform);
        if (browser) headers['X-HomeEasy-Browser'] = encodeURIComponent(browser);
        return headers;
    }

    function friendlyMessage(status, payload) {
        const serverError = payload && payload.error ? String(payload.error) : '';
        if (status === 400 && /stored pdf|google drive|pdf link/i.test(serverError)) return 'El PDF guardado no tiene un enlace compatible para reenviarlo.';
        if (status === 401) return 'WhatsApp no pudo autorizar esta sesión. HomeEasy seguirá abierto; vuelve a intentar desde Integraciones.';
        if (status === 403) return 'Tu usuario no tiene permiso para usar esta función de WhatsApp.';
        if (status === 409) return serverError || 'WhatsApp ya está conectado o el QR no está disponible.';
        if (status === 413) return 'El PDF es demasiado pesado para enviarlo por WhatsApp desde HomeEasy.';
        if (status === 422) return 'El PDF guardado no pudo descargarse. Puedes abrirlo para comprobar que siga disponible.';
        if (status === 503) return 'WhatsApp está reconectando. Intenta nuevamente en unos segundos.';
        if (status >= 500) return 'El servicio de WhatsApp no respondió correctamente.';
        return serverError || 'No fue posible completar la operación de WhatsApp.';
    }

    async function request(path, options) {
        const opts = options || {};
        const token = sessionToken();

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

    function activity(limit) {
        const size = Math.max(1, Math.min(150, Number(limit || 60)));
        return request('/api/whatsapp/activity?limit=' + encodeURIComponent(size));
    }

    function getTemplates() {
        return request('/api/whatsapp/templates');
    }

    function saveTemplates(templates) {
        return request('/api/whatsapp/templates', {
            method: 'POST',
            body: { templates: templates && typeof templates === 'object' ? templates : {} }
        });
    }

    function resetTemplates() {
        return request('/api/whatsapp/templates/reset', { method: 'POST', body: {} });
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

    function testDocument(phone) {
        return request('/api/whatsapp/test-document', {
            method: 'POST',
            timeoutMs: 105000,
            body: { phone: String(phone || '').trim() }
        });
    }

    function documentMeta(opts) {
        return {
            reference: String(opts.reference || '').trim(),
            clientName: String(opts.clientName || '').trim(),
            cedula: String(opts.cedula || '').trim(),
            source: String(opts.source || '').trim(),
            resend: Boolean(opts.resend),
            orderReference: String(opts.orderReference || '').trim(),
            amount: Number.isFinite(Number(opts.amount)) ? Number(opts.amount) : null,
            balance: Number.isFinite(Number(opts.balance)) ? Number(opts.balance) : null
        };
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
                idempotencyKey: String(opts.idempotencyKey || ''),
                ...documentMeta(opts)
            }
        });
    }

    function sendDocumentUrl(options) {
        const opts = options || {};
        return request('/api/whatsapp/send-document-url', {
            method: 'POST',
            timeoutMs: 105000,
            body: {
                documentType: String(opts.documentType || '').trim().toLowerCase(),
                phone: String(opts.phone || '').trim(),
                pdfUrl: String(opts.pdfUrl || '').trim(),
                filename: String(opts.filename || 'HomeEasy.pdf'),
                caption: String(opts.caption || ''),
                idempotencyKey: String(opts.idempotencyKey || ''),
                ...documentMeta(opts)
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
        activity,
        getTemplates,
        saveTemplates,
        resetTemplates,
        restart,
        bootstrap,
        qr,
        testMessage,
        testDocument,
        sendDocument,
        sendDocumentUrl,
        connectedPhone
    });
})(window);
