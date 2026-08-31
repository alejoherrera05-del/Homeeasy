/**
 * HomeEasy WhatsApp Client v0.5.0
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

    const VERSION = '0.5.0';
    const BASE_URL = 'https://api.homeeasy.com.co';
    const REQUEST_TIMEOUT_MS = 25000;
    const RECOVERY_BUTTON_ID = 'heWaRecover';
    let recoveryObserver = null;
    let lastStatusPayload = null;

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

    function emitStatus(payload) {
        lastStatusPayload = payload || null;
        try {
            global.dispatchEvent(new CustomEvent('homeeasy:whatsapp-status', { detail: payload || null }));
        } catch (error) {}
    }

    async function status() {
        const payload = await request('/api/whatsapp/status');
        emitStatus(payload);
        return payload;
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

    async function restart() {
        const payload = await request('/api/whatsapp/restart', { method: 'POST', body: {} });
        emitStatus(payload);
        return payload;
    }

    async function bootstrap() {
        const payload = await request('/api/whatsapp/bootstrap', { method: 'POST', body: {} });
        emitStatus(payload);
        return payload;
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

    function isConfigPage() {
        return ((global.location && global.location.pathname ? global.location.pathname.split('/').pop() : '') || '').toLowerCase() === 'configuracion.html';
    }

    function whatsappReady(payload) {
        const whatsapp = payload && payload.whatsapp ? payload.whatsapp : {};
        return whatsapp.ready === true && String(whatsapp.status || '').toUpperCase() === 'WORKING';
    }

    function whatsappStatus(payload) {
        return String(payload && payload.whatsapp && payload.whatsapp.status || 'UNKNOWN').toUpperCase();
    }

    function qrSource(payload) {
        const qrData = payload && payload.qr ? payload.qr : {};
        const raw = String(qrData.data || qrData.value || qrData.qr || '').trim();
        if (!raw) return '';
        return raw.startsWith('data:image/') ? raw : 'data:image/png;base64,' + raw;
    }

    function syncRecoveryButton(payload) {
        const button = global.document && global.document.getElementById(RECOVERY_BUTTON_ID);
        if (!button) return;
        button.hidden = !payload || whatsappReady(payload);
    }

    function ensureRecoveryButton() {
        if (!isConfigPage() || !global.document) return null;
        let button = global.document.getElementById(RECOVERY_BUTTON_ID);
        if (button) return button;
        const actions = global.document.querySelector('#panel-integraciones .he-wa-actions');
        if (!actions) return null;

        button = global.document.createElement('button');
        button.type = 'button';
        button.id = RECOVERY_BUTTON_ID;
        button.className = 'he-wa-button whatsapp';
        button.hidden = true;
        button.innerHTML = '<i class="fa-solid fa-link"></i>Recuperar WhatsApp';
        button.addEventListener('click', recoverWhatsApp);

        const refresh = actions.querySelector('#heWaRefresh');
        if (refresh && refresh.nextSibling) actions.insertBefore(button, refresh.nextSibling);
        else if (refresh) actions.appendChild(button);
        else actions.prepend(button);

        syncRecoveryButton(lastStatusPayload);
        return button;
    }

    function wait(ms) {
        return new Promise(resolve => global.setTimeout(resolve, ms));
    }

    async function findRecoveryQr() {
        let initial = null;
        try { initial = await bootstrap(); } catch (error) {}
        if (initial && whatsappReady(initial)) return { connected: true, status: initial };

        let last = initial;
        for (let attempt = 0; attempt < 18; attempt += 1) {
            try {
                last = await status();
                if (whatsappReady(last)) return { connected: true, status: last };
            } catch (error) {}

            try {
                const qrPayload = await qr();
                const src = qrSource(qrPayload);
                if (src) return { connected: false, qrPayload, src, status: last };
            } catch (error) {
                if (error && error.status && ![409, 422, 503].includes(Number(error.status))) throw error;
            }
            await wait(1000);
        }
        throw new HomeEasyWhatsAppError('WHATSAPP_QR_WAIT', 'WhatsApp todavía está preparando la vinculación. Intenta Recuperar WhatsApp nuevamente en unos segundos.', last, 409);
    }

    async function refreshSettingsCenter() {
        await wait(250);
        const refresh = global.document && global.document.getElementById('heWaRefresh');
        if (refresh && !refresh.disabled) {
            try { refresh.click(); return; } catch (error) {}
        }
        try { await status(); } catch (error) {}
    }

    async function showRecoveryQr(src) {
        if (!global.Swal) {
            global.alert('El QR está listo. Abre HomeEasy desde una pantalla que puedas escanear con el celular de WhatsApp.');
            return false;
        }

        let interval = null;
        let checking = false;
        let connected = false;
        let checks = 0;

        await global.Swal.fire({
            title: 'Recuperar WhatsApp',
            html:
                '<div class="he-wa-qr-wrap"><img class="he-wa-qr" src="' + String(src).replace(/"/g, '&quot;') + '" alt="Código QR para recuperar WhatsApp"></div>' +
                '<div style="margin:10px auto 0;max-width:330px;text-align:left;padding:12px 14px;border-radius:14px;background:#f7f6f7;color:#6f686c;font-size:12px;line-height:1.5">' +
                '<b style="display:block;margin-bottom:5px;color:#3d383a">En el celular de WhatsApp HomeEasy:</b>' +
                'WhatsApp → Configuración → Dispositivos vinculados → Vincular dispositivo → escanea este código.' +
                '</div>' +
                '<div id="heWaRecoveryWatching" style="margin-top:12px;color:#168b43;font-size:12px;font-weight:700"><i class="fa-solid fa-circle-notch fa-spin"></i> Esperando vinculación…</div>',
            confirmButtonText: 'Cerrar',
            confirmButtonColor: '#a6455a',
            allowOutsideClick: true,
            didOpen: () => {
                interval = global.setInterval(async () => {
                    if (checking || connected) return;
                    checking = true;
                    checks += 1;
                    try {
                        const payload = await status();
                        if (whatsappReady(payload)) {
                            connected = true;
                            if (interval) global.clearInterval(interval);
                            const watching = global.document.getElementById('heWaRecoveryWatching');
                            if (watching) watching.innerHTML = '<i class="fa-solid fa-circle-check"></i> WhatsApp conectado';
                            await wait(500);
                            global.Swal.close();
                        } else if (checks >= 45) {
                            if (interval) global.clearInterval(interval);
                            const watching = global.document.getElementById('heWaRecoveryWatching');
                            if (watching) watching.innerHTML = '<span style="color:#9a7a3f">El QR puede haber vencido. Cierra y toca Recuperar WhatsApp para generar uno nuevo.</span>';
                        }
                    } catch (error) {
                    } finally {
                        checking = false;
                    }
                }, 2000);
            },
            willClose: () => {
                if (interval) global.clearInterval(interval);
            }
        });

        if (connected) {
            await global.Swal.fire({
                icon: 'success',
                title: 'WhatsApp recuperado',
                text: 'HomeEasy volvió a conectarse correctamente.',
                confirmButtonColor: '#a6455a',
                timer: 2200,
                timerProgressBar: true
            });
            await refreshSettingsCenter();
            return true;
        }
        return false;
    }

    async function recoverWhatsApp() {
        const button = ensureRecoveryButton();
        if (button && button.disabled) return;
        if (button) {
            button.disabled = true;
            button.dataset.originalHtml = button.innerHTML;
            button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>Preparando QR…';
        }

        try {
            if (global.Swal) {
                global.Swal.fire({
                    title: 'Preparando WhatsApp',
                    text: 'HomeEasy está comprobando la sesión y preparando la vinculación si hace falta.',
                    allowOutsideClick: false,
                    showConfirmButton: false,
                    didOpen: () => global.Swal.showLoading()
                });
            }

            const recovery = await findRecoveryQr();
            if (global.Swal) global.Swal.close();

            if (recovery.connected) {
                if (global.Swal) {
                    await global.Swal.fire({
                        icon: 'success',
                        title: 'WhatsApp ya está conectado',
                        text: 'No fue necesario generar un nuevo QR.',
                        confirmButtonColor: '#a6455a',
                        timer: 1800
                    });
                }
                await refreshSettingsCenter();
                return;
            }

            await showRecoveryQr(recovery.src);
        } catch (error) {
            if (global.Swal) global.Swal.close();
            if (global.Swal) {
                await global.Swal.fire({
                    icon: 'info',
                    title: 'Todavía no está listo',
                    text: error && error.message ? error.message : 'No fue posible preparar la vinculación de WhatsApp.',
                    confirmButtonText: 'Entendido',
                    confirmButtonColor: '#a6455a'
                });
            }
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = button.dataset.originalHtml || '<i class="fa-solid fa-link"></i>Recuperar WhatsApp';
            }
        }
    }

    function installRecoveryUi() {
        if (!isConfigPage() || !global.document) return;
        const mount = () => {
            ensureRecoveryButton();
            if (!recoveryObserver && global.document.documentElement) {
                recoveryObserver = new MutationObserver(() => ensureRecoveryButton());
                recoveryObserver.observe(global.document.documentElement, { childList: true, subtree: true });
            }
        };
        if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', mount, { once: true });
        else mount();
        global.addEventListener('homeeasy:whatsapp-status', event => {
            ensureRecoveryButton();
            syncRecoveryButton(event && event.detail ? event.detail : null);
        });
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
        connectedPhone,
        recoverWhatsApp
    });

    installRecoveryUi();
})(window);
