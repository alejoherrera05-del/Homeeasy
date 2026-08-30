/**
 * HomeEasy WhatsApp Document Actions v0.1.0
 * Envío manual y reenvío de PDFs sin afectar el flujo principal de HomeEasy.
 */
(function (global) {
    'use strict';

    if (global.HomeEasyWhatsAppDocumentActions) return;

    const VERSION = '0.1.0';
    const page = ((global.location && global.location.pathname ? global.location.pathname.split('/').pop() : '') || '').toLowerCase();
    const DOCUMENT_PAGES = Object.freeze({
        'cotizacion.html': 'cotizacion',
        'pedido.html': 'pedido',
        'abono.html': 'abono'
    });
    const SUPPORTED_PAGES = new Set([...Object.keys(DOCUMENT_PAGES), 'ventas.html', 'clientes.html']);
    if (!SUPPORTED_PAGES.has(page)) return;

    const STYLE_ID = 'homeeasyWhatsappDocumentActionsStyle';
    const FETCH_PATCH_FLAG = '__HOMEEASY_WHATSAPP_DOC_FETCH_V1__';
    const processed = new WeakSet();
    let latestGenerated = null;
    let toastTimer = null;

    function clean(value) {
        return String(value == null ? '' : value).trim();
    }

    function digits(value) {
        let out = clean(value).replace(/\D/g, '');
        if (out.startsWith('00')) out = out.slice(2);
        if (/^3\d{9}$/.test(out)) out = '57' + out;
        return out;
    }

    function displayPhone(value) {
        const number = digits(value);
        if (/^57\d{10}$/.test(number)) {
            return '+57 ' + number.slice(2, 5) + ' ' + number.slice(5, 8) + ' ' + number.slice(8);
        }
        return number ? '+' + number : '';
    }

    function documentLabel(type) {
        if (type === 'cotizacion') return 'cotización';
        if (type === 'pedido') return 'orden de pedido';
        return 'recibo de abono';
    }

    function defaultFilename(type, reference) {
        const ref = clean(reference).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
        if (type === 'cotizacion') return 'Cotizacion' + (ref ? '_' + ref : '') + '.pdf';
        if (type === 'pedido') return 'Orden_Pedido' + (ref ? '_' + ref : '') + '.pdf';
        return 'Recibo_Abono' + (ref ? '_' + ref : '') + '.pdf';
    }

    function defaultCaption(type) {
        if (type === 'cotizacion') return 'Hola 👋 Te compartimos tu cotización de HomeEasy en PDF.';
        if (type === 'pedido') return 'Hola 👋 Te compartimos tu orden de pedido de HomeEasy en PDF.';
        return 'Hola 👋 Te compartimos tu recibo de abono de HomeEasy en PDF.';
    }

    function createIdempotencyKey(prefix, type, filename, phone) {
        const core = global.HomeEasyCore;
        const nonce = core && typeof core.createRequestId === 'function'
            ? core.createRequestId()
            : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
        return [prefix, type, clean(filename), digits(phone), nonce].join(':').slice(0, 180);
    }

    function installStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .he-wa-generated-btn{
                width:100%;min-height:52px;margin:0 0 10px;border:0;border-radius:14px;
                display:flex;align-items:center;justify-content:center;gap:9px;
                background:#25D366;color:#fff;font:800 .92rem/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
                box-shadow:0 9px 22px rgba(37,211,102,.23);transition:transform .14s ease,opacity .14s ease;
            }
            .he-wa-generated-btn:active{transform:scale(.97)}
            .he-wa-generated-btn:disabled{opacity:.58;cursor:wait}
            .he-wa-inline-btn{
                min-height:34px;padding:0 11px;border:1px solid rgba(37,211,102,.30);border-radius:10px;
                display:inline-flex;align-items:center;justify-content:center;gap:6px;background:rgba(37,211,102,.09);
                color:#168b43;font:750 .60rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;
            }
            .he-wa-inline-btn:active{transform:scale(.95)}
            .he-wa-inline-btn i{font-size:.76rem}
            .he-wa-icon-btn{
                width:33px;height:33px;padding:0;border:1px solid rgba(37,211,102,.28);border-radius:10px;
                display:inline-grid;place-items:center;background:rgba(37,211,102,.09);color:#159447;font-size:.85rem;
            }
            .he-wa-icon-btn:active{transform:scale(.92)}
            .he-wa-client-resend{margin-left:7px}
            .v31-order-actions.he-wa-order-actions{grid-template-columns:minmax(0,1fr) minmax(105px,180px) minmax(92px,145px)!important}
            .v31-payment-row.he-wa-payment-row{grid-template-columns:minmax(220px,1.15fr) minmax(120px,.65fr) minmax(125px,.55fr) 38px!important}
            .v31-payment-row .he-wa-payment-resend{margin:0;justify-self:end}
            .drawer-actions .he-wa-drawer-send{border:1px solid rgba(37,211,102,.26)!important;background:rgba(37,211,102,.10)!important;color:#168b43!important}
            .he-wa-dialog{
                position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:18px;
                background:rgba(38,28,32,.28);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
                opacity:0;visibility:hidden;pointer-events:none;transition:opacity .18s ease,visibility .18s ease;
                font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;
            }
            .he-wa-dialog.is-open{opacity:1;visibility:visible;pointer-events:auto}
            .he-wa-dialog-card{
                width:min(390px,100%);padding:23px;border-radius:24px;background:rgba(255,255,255,.99);
                border:1px solid rgba(255,255,255,.75);box-shadow:0 24px 70px rgba(38,28,32,.20);color:#2b2729;
            }
            .he-wa-dialog-icon{width:52px;height:52px;margin:0 auto 13px;border-radius:17px;display:grid;place-items:center;background:#25D366;color:#fff;font-size:25px;box-shadow:0 10px 22px rgba(37,211,102,.20)}
            .he-wa-dialog h3{margin:0;text-align:center;font-size:1.13rem;font-weight:780;letter-spacing:-.03em}
            .he-wa-dialog p{margin:8px auto 17px;max-width:32ch;text-align:center;color:#7c7579;font-size:.76rem;line-height:1.5;font-weight:540}
            .he-wa-dialog label{display:block;margin:0 0 6px;color:#8c8589;font-size:.60rem;font-weight:760;text-transform:uppercase;letter-spacing:.06em}
            .he-wa-dialog input{width:100%;height:49px;border:1px solid #e4dfe1;border-radius:13px;background:#faf9fa;color:#302b2e;padding:0 13px;font-size:16px;font-weight:650;outline:none}
            .he-wa-dialog input:focus{border-color:rgba(37,211,102,.55);background:#fff;box-shadow:0 0 0 3px rgba(37,211,102,.10)}
            .he-wa-dialog-error{min-height:18px;margin:7px 2px 0;color:#c53b3b;font-size:.64rem;font-weight:650}
            .he-wa-dialog-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:8px;margin-top:10px}
            .he-wa-dialog-actions button{height:47px;border-radius:13px;border:1px solid #e8e3e5;background:#fff;color:#696165;font-weight:720}
            .he-wa-dialog-actions button.he-wa-confirm{border-color:#25D366;background:#25D366;color:#fff;box-shadow:0 8px 18px rgba(37,211,102,.18)}
            .he-wa-dialog-actions button:disabled{opacity:.58;cursor:wait}
            .he-wa-toast{position:fixed;z-index:2147483647;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translate(-50%,16px);max-width:min(92vw,430px);padding:12px 15px;border-radius:14px;background:rgba(30,28,29,.92);color:#fff;font:650 .72rem/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 12px 35px rgba(0,0,0,.20);opacity:0;visibility:hidden;transition:.2s ease;text-align:center}
            .he-wa-toast.is-showing{opacity:1;visibility:visible;transform:translate(-50%,0)}
            @media(max-width:620px){
                .he-wa-inline-btn{min-height:36px}.v31-quote-actions .he-wa-client-resend{margin-left:0}
                .v31-order-actions.he-wa-order-actions{grid-template-columns:minmax(0,1fr) 96px 90px!important;gap:7px!important}
                .v31-order-actions.he-wa-order-actions .he-wa-client-resend{padding:0 8px;font-size:.56rem}
                .v31-payment-row.he-wa-payment-row{grid-template-columns:minmax(0,1fr) auto 38px!important;gap:7px 9px!important}
                .v31-payment-row.he-wa-payment-row .v31-payment-left{grid-column:1/-1!important}
                .v31-payment-row.he-wa-payment-row .v31-payment-date{grid-column:1!important;grid-row:2!important}
                .v31-payment-row.he-wa-payment-row .v31-payment-amount{grid-column:2!important;grid-row:2!important}
                .v31-payment-row.he-wa-payment-row .he-wa-payment-resend{grid-column:3!important;grid-row:2!important}
            }
        `;
        global.document.head.appendChild(style);
    }

    function toast(message) {
        if (!global.document || !global.document.body) return;
        let node = global.document.getElementById('homeeasyWhatsappToast');
        if (!node) {
            node = global.document.createElement('div');
            node.id = 'homeeasyWhatsappToast';
            node.className = 'he-wa-toast';
            global.document.body.appendChild(node);
        }
        node.textContent = clean(message) || 'Listo';
        node.classList.add('is-showing');
        global.clearTimeout(toastTimer);
        toastTimer = global.setTimeout(() => node.classList.remove('is-showing'), 2600);
    }

    function makeDialog() {
        let overlay = global.document.getElementById('homeeasyWhatsappSendDialog');
        if (overlay) return overlay;
        overlay = global.document.createElement('div');
        overlay.id = 'homeeasyWhatsappSendDialog';
        overlay.className = 'he-wa-dialog';
        overlay.innerHTML = `
            <section class="he-wa-dialog-card" role="dialog" aria-modal="true" aria-labelledby="heWaDialogTitle">
                <div class="he-wa-dialog-icon"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i></div>
                <h3 id="heWaDialogTitle">Enviar por WhatsApp</h3>
                <p id="heWaDialogCopy">Confirma el número del cliente antes de enviar.</p>
                <label for="heWaDialogPhone">Número de WhatsApp</label>
                <input id="heWaDialogPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Ej. 333 123 4567">
                <div class="he-wa-dialog-error" id="heWaDialogError"></div>
                <div class="he-wa-dialog-actions">
                    <button type="button" id="heWaDialogCancel">Cancelar</button>
                    <button type="button" class="he-wa-confirm" id="heWaDialogConfirm"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Enviar</button>
                </div>
            </section>`;
        overlay.addEventListener('click', event => {
            if (event.target === overlay) global.document.getElementById('heWaDialogCancel').click();
        });
        global.document.body.appendChild(overlay);
        return overlay;
    }

    function confirmPhone(options) {
        const opts = options || {};
        const overlay = makeDialog();
        const input = global.document.getElementById('heWaDialogPhone');
        const title = global.document.getElementById('heWaDialogTitle');
        const copy = global.document.getElementById('heWaDialogCopy');
        const error = global.document.getElementById('heWaDialogError');
        const cancel = global.document.getElementById('heWaDialogCancel');
        const confirm = global.document.getElementById('heWaDialogConfirm');
        title.textContent = (opts.resend ? 'Reenviar ' : 'Enviar ') + documentLabel(opts.documentType || 'pedido') + ' por WhatsApp';
        copy.textContent = 'Confirma el número del cliente. HomeEasy enviará el PDF guardado y no modificará el documento.';
        input.value = displayPhone(opts.phone || '');
        error.textContent = '';
        confirm.disabled = false;
        cancel.disabled = false;
        overlay.classList.add('is-open');
        global.setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 80);

        return new Promise(resolve => {
            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                overlay.classList.remove('is-open');
                cancel.removeEventListener('click', onCancel);
                confirm.removeEventListener('click', onConfirm);
                input.removeEventListener('keydown', onKey);
                resolve(value);
            };
            const onCancel = () => finish(null);
            const onConfirm = () => {
                const phone = digits(input.value);
                if (!/^\d{8,15}$/.test(phone)) {
                    error.textContent = 'Revisa el número. Puedes escribirlo con espacios; HomeEasy lo organiza.';
                    input.focus();
                    return;
                }
                finish(phone);
            };
            const onKey = event => {
                if (event.key === 'Enter') { event.preventDefault(); onConfirm(); }
                if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
            };
            cancel.addEventListener('click', onCancel);
            confirm.addEventListener('click', onConfirm);
            input.addEventListener('keydown', onKey);
        });
    }

    function parseStoredClients(cedula) {
        const id = clean(cedula);
        if (!id) return null;
        try {
            const parsed = JSON.parse(global.localStorage.getItem('CACHE_CLIENTES') || 'null');
            if (!parsed) return null;
            if (Array.isArray(parsed)) {
                const row = parsed.find(item => {
                    if (Array.isArray(item)) return clean(item[0]) === id;
                    return clean(item && (item.cedula || item.documento || item.id)) === id;
                });
                if (Array.isArray(row)) return { cedula: clean(row[0]), nombre: clean(row[1]), telefono: clean(row[2]) };
                if (row && typeof row === 'object') return row;
            }
            if (typeof parsed === 'object') {
                if (parsed[id] && typeof parsed[id] === 'object') return parsed[id];
                const row = Object.values(parsed).find(item => item && typeof item === 'object' && clean(item.cedula) === id);
                if (row) return row;
            }
        } catch (_) {}
        return null;
    }

    async function lookupClient(cedula) {
        const id = clean(cedula);
        if (!id) return null;
        const cached = parseStoredClients(id);
        if (cached && digits(cached.telefono)) return cached;
        const core = global.HomeEasyCore;
        if (!core || typeof core.get !== 'function') return cached;
        try {
            const data = await core.get({ tipo: 'HISTORIAL_CLIENTE', cedula: id, t: Date.now() }, { timeoutMs: 16000 });
            if (data && data.status === 'found' && data.cliente) return data.cliente;
        } catch (error) {
            console.warn('HomeEasy WhatsApp: no se pudo precargar el teléfono del cliente.', error);
        }
        return cached;
    }

    function phoneFromClientPage() {
        const selectors = [
            '.v31-contact-grid .v31-contact-value',
            '#c_tel',
            '#edit_telefono'
        ];
        for (const selector of selectors) {
            const node = global.document.querySelector(selector);
            const value = node && ('value' in node ? node.value : node.textContent);
            if (digits(value)) return digits(value);
        }
        return '';
    }

    function cedulaFromSalesRow(row) {
        const node = row && row.querySelector('.client-doc');
        return clean(node && node.textContent).replace(/^Sin documento$/i, '');
    }

    async function resolvePhone(context) {
        const ctx = context || {};
        const direct = digits(ctx.phone || '');
        if (direct) return direct;
        if (page === 'clientes.html') {
            const phone = phoneFromClientPage();
            if (phone) return phone;
        }
        const client = await lookupClient(ctx.cedula || '');
        return digits(client && client.telefono);
    }

    async function sendBase64(context) {
        const ctx = context || {};
        const phone = await resolvePhone(ctx);
        const confirmed = await confirmPhone({ documentType: ctx.documentType, phone, resend: false });
        if (!confirmed) return null;
        if (!global.HomeEasyWhatsApp || typeof global.HomeEasyWhatsApp.sendDocument !== 'function') {
            toast('WhatsApp todavía no está disponible. Intenta nuevamente.');
            return null;
        }
        const key = ctx.idempotencyKey || createIdempotencyKey('generated', ctx.documentType, ctx.filename, confirmed);
        const result = await global.HomeEasyWhatsApp.sendDocument({
            documentType: ctx.documentType,
            phone: confirmed,
            pdfBase64: ctx.pdfBase64,
            filename: ctx.filename,
            caption: ctx.caption || defaultCaption(ctx.documentType),
            idempotencyKey: key
        });
        return { result, phone: confirmed };
    }

    async function sendRemote(context) {
        const ctx = context || {};
        const phone = await resolvePhone(ctx);
        const confirmed = await confirmPhone({ documentType: ctx.documentType, phone, resend: true });
        if (!confirmed) return null;
        if (!global.HomeEasyWhatsApp || typeof global.HomeEasyWhatsApp.sendDocumentUrl !== 'function') {
            toast('La función de reenvío todavía no está disponible en el servidor.');
            return null;
        }
        const result = await global.HomeEasyWhatsApp.sendDocumentUrl({
            documentType: ctx.documentType,
            phone: confirmed,
            pdfUrl: ctx.pdfUrl,
            filename: ctx.filename || defaultFilename(ctx.documentType, ctx.reference),
            caption: ctx.caption || defaultCaption(ctx.documentType),
            idempotencyKey: createIdempotencyKey('resend', ctx.documentType, ctx.filename || ctx.reference, confirmed)
        });
        return { result, phone: confirmed };
    }

    function sentMessage(result) {
        const delivery = result && result.delivery ? String(result.delivery).toUpperCase() : '';
        if (delivery === 'UNKNOWN') return 'Envío procesado. HomeEasy evitó repetirlo automáticamente.';
        return 'PDF enviado por WhatsApp.';
    }

    async function runSend(button, action) {
        if (!button || button.disabled) return;
        const originalHtml = button.innerHTML;
        delete button.dataset.heWaSent;
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Enviando…';
        try {
            const outcome = await action();
            if (!outcome) return;
            toast(sentMessage(outcome.result));
            button.dataset.heWaSent = 'true';
            button.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Enviado';
            global.setTimeout(() => {
                if (button.isConnected) {
                    button.innerHTML = originalHtml;
                    button.disabled = false;
                    delete button.dataset.heWaSent;
                }
            }, 2600);
            return;
        } catch (error) {
            console.error('HomeEasy WhatsApp document send:', error);
            toast(error && error.message ? error.message : 'No se pudo enviar el PDF por WhatsApp.');
        } finally {
            if (button.isConnected && button.dataset.heWaSent !== 'true') {
                button.innerHTML = originalHtml;
                button.disabled = false;
            }
        }
    }

    function capturePdfUrlFromAction(action) {
        if (!action || typeof global.abrirVisorPDF !== 'function') return '';
        const original = global.abrirVisorPDF;
        let captured = '';
        global.abrirVisorPDF = function (url) { captured = clean(url); };
        try {
            if (typeof action.onclick === 'function') action.onclick.call(action);
            else action.click();
        } catch (_) {
        } finally {
            global.abrirVisorPDF = original;
        }
        return captured;
    }

    function generatedButton() {
        if (!global.document) return null;
        const box = global.document.querySelector('#success-modal .success-box');
        if (!box) return null;
        let button = global.document.getElementById('homeeasyWhatsappGeneratedSend');
        if (button) return button;
        button = global.document.createElement('button');
        button.type = 'button';
        button.id = 'homeeasyWhatsappGeneratedSend';
        button.className = 'he-wa-generated-btn';
        button.hidden = true;
        button.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Enviar por WhatsApp';
        const home = box.querySelector('#btn-success-home,.btn-success-home');
        box.insertBefore(button, home || null);
        button.addEventListener('click', () => {
            if (!latestGenerated) return;
            runSend(button, () => sendBase64(latestGenerated));
        });
        return button;
    }

    function showGeneratedButton() {
        const button = generatedButton();
        if (!button || !latestGenerated) return;
        button.hidden = false;
        button.disabled = false;
        button.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Enviar por WhatsApp';
    }

    function captureGeneratedPayload(payload) {
        if (!payload || !payload.pdfBase64) return null;
        const type = DOCUMENT_PAGES[page];
        if (!type) return null;
        const filename = clean(payload.nombreArchivo || payload.filename) || defaultFilename(type, payload.numero || payload.numeroOP || '');
        return {
            documentType: type,
            pdfBase64: clean(payload.pdfBase64),
            filename,
            phone: clean(payload.telefono || ''),
            cedula: clean(payload.cedula || ''),
            reference: clean(payload.numero || payload.numeroOP || ''),
            caption: defaultCaption(type),
            idempotencyKey: createIdempotencyKey('generated', type, filename, payload.telefono || '')
        };
    }

    function installGeneratedCapture() {
        if (!DOCUMENT_PAGES[page] || global[FETCH_PATCH_FLAG]) return;
        global[FETCH_PATCH_FLAG] = true;
        const previousFetch = global.fetch.bind(global);
        const apiUrl = global.HomeEasyCore && global.HomeEasyCore.API_URL ? global.HomeEasyCore.API_URL : '';
        global.fetch = async function homeEasyWhatsappDocumentFetch(resource, init) {
            const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
            const options = init || {};
            let candidate = null;
            if (apiUrl && url.startsWith(apiUrl) && String(options.method || 'GET').toUpperCase() === 'POST' && typeof options.body === 'string') {
                try { candidate = captureGeneratedPayload(JSON.parse(options.body)); } catch (_) {}
            }
            const response = await previousFetch(resource, init);
            if (candidate && response && typeof response.clone === 'function') {
                response.clone().json().then(data => {
                    if (data && String(data.status || '').toLowerCase() === 'success') {
                        latestGenerated = candidate;
                        showGeneratedButton();
                    }
                }).catch(() => {});
            }
            return response;
        };
    }

    function enhanceSales(root) {
        const scope = root && root.querySelectorAll ? root : global.document;
        scope.querySelectorAll('tbody tr[data-op]').forEach(row => {
            const actions = row.querySelector('.row-actions');
            if (!actions || actions.querySelector('.he-wa-sales-send')) return;
            const pdf = actions.querySelector('a[href][target="_blank"]');
            if (!pdf || !clean(pdf.href)) return;
            const button = global.document.createElement('button');
            button.type = 'button';
            button.className = 'he-wa-icon-btn he-wa-sales-send';
            button.title = 'Reenviar por WhatsApp';
            button.setAttribute('aria-label', 'Reenviar orden por WhatsApp');
            button.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i>';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const ref = clean(row.dataset.op || row.querySelector('.cell-op')?.textContent || '');
                const cedula = cedulaFromSalesRow(row);
                runSend(button, () => sendRemote({
                    documentType: 'pedido',
                    pdfUrl: pdf.href,
                    filename: defaultFilename('pedido', 'OP_' + ref),
                    reference: ref,
                    cedula
                }));
            });
            actions.appendChild(button);
        });

        scope.querySelectorAll('.drawer-actions').forEach(actions => {
            if (actions.querySelector('.he-wa-drawer-send')) return;
            const pdf = actions.querySelector('a[href][target="_blank"]');
            if (!pdf || !clean(pdf.href)) return;
            const button = global.document.createElement('button');
            button.type = 'button';
            button.className = 'drawer-action he-wa-drawer-send';
            button.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Reenviar por WhatsApp';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const title = clean(global.document.getElementById('drawerTitle')?.textContent || '');
                const sub = clean(global.document.querySelector('.detail-hero .sub')?.textContent || '');
                const cedula = clean(sub.split('·')[0]);
                runSend(button, () => sendRemote({
                    documentType: 'pedido',
                    pdfUrl: pdf.href,
                    filename: defaultFilename('pedido', title.replace(/\s+/g, '_')),
                    reference: title,
                    cedula
                }));
            });
            actions.appendChild(button);
        });
    }

    function clientReference(card) {
        return clean(card && card.querySelector('.v31-order-code')?.textContent || '');
    }

    function enhanceClientOrders(scope) {
        scope.querySelectorAll('.v31-order').forEach(card => {
            const actions = card.querySelector('.v31-order-actions');
            const view = actions && actions.querySelector('.v31-view-op:not(:disabled)');
            if (!actions || !view || actions.querySelector('.he-wa-client-resend')) return;
            const button = global.document.createElement('button');
            button.type = 'button';
            button.className = 'he-wa-inline-btn he-wa-client-resend';
            button.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Reenviar';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const url = capturePdfUrlFromAction(view);
                if (!url) { toast('No encontramos el PDF guardado de esta orden.'); return; }
                const ref = clientReference(card);
                runSend(button, () => sendRemote({
                    documentType: 'pedido',
                    pdfUrl: url,
                    filename: defaultFilename('pedido', ref),
                    reference: ref,
                    phone: phoneFromClientPage()
                }));
            });
            actions.classList.add('he-wa-order-actions');
            actions.appendChild(button);
        });
    }

    function enhanceClientQuotes(scope) {
        scope.querySelectorAll('.v31-quote').forEach(card => {
            const actions = card.querySelector('.v31-quote-actions');
            if (!actions || actions.querySelector('.he-wa-client-resend')) return;
            const view = Array.from(actions.querySelectorAll('button')).find(button => /ver pdf/i.test(clean(button.textContent)));
            if (!view) return;
            const button = global.document.createElement('button');
            button.type = 'button';
            button.className = 'he-wa-inline-btn he-wa-client-resend';
            button.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Reenviar';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const url = capturePdfUrlFromAction(view);
                if (!url) { toast('No encontramos el PDF guardado de esta cotización.'); return; }
                const ref = clientReference(card);
                runSend(button, () => sendRemote({
                    documentType: 'cotizacion',
                    pdfUrl: url,
                    filename: defaultFilename('cotizacion', ref),
                    reference: ref,
                    phone: phoneFromClientPage()
                }));
            });
            actions.appendChild(button);
        });
    }

    function enhanceClientPayments(scope) {
        scope.querySelectorAll('.v31-payment-row.is-clickable').forEach(row => {
            if (row.querySelector('.he-wa-payment-resend')) return;
            const button = global.document.createElement('button');
            button.type = 'button';
            button.className = 'he-wa-icon-btn he-wa-payment-resend';
            button.title = 'Reenviar recibo por WhatsApp';
            button.setAttribute('aria-label', 'Reenviar recibo por WhatsApp');
            button.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i>';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const url = capturePdfUrlFromAction(row);
                if (!url) { toast('No encontramos el PDF guardado de este recibo.'); return; }
                const label = clean(row.querySelector('.v31-payment-name')?.textContent || 'Recibo');
                runSend(button, () => sendRemote({
                    documentType: 'abono',
                    pdfUrl: url,
                    filename: defaultFilename('abono', label),
                    reference: label,
                    phone: phoneFromClientPage()
                }));
            });
            row.classList.add('he-wa-payment-row');
            row.appendChild(button);
        });
    }

    function enhanceClients(root) {
        const scope = root && root.querySelectorAll ? root : global.document;
        enhanceClientOrders(scope);
        enhanceClientQuotes(scope);
        enhanceClientPayments(scope);
    }

    function scan(root) {
        if (!global.document) return;
        if (DOCUMENT_PAGES[page]) generatedButton();
        if (page === 'ventas.html') enhanceSales(root || global.document);
        if (page === 'clientes.html') enhanceClients(root || global.document);
    }

    function installObserver() {
        if (!global.document || !global.document.documentElement) return;
        const observer = new MutationObserver(records => {
            for (const record of records) {
                for (const node of record.addedNodes || []) {
                    if (node && node.nodeType === 1 && !processed.has(node)) {
                        processed.add(node);
                        scan(node);
                    }
                }
            }
            scan(global.document);
        });
        observer.observe(global.document.documentElement, { childList: true, subtree: true });
    }

    function init() {
        installStyles();
        installGeneratedCapture();
        const run = () => {
            generatedButton();
            scan(global.document);
            installObserver();
        };
        if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', run, { once: true });
        else run();
    }

    global.HomeEasyWhatsAppDocumentActions = Object.freeze({
        VERSION,
        scan,
        getLatestGenerated: () => latestGenerated
    });

    init();
})(window);
