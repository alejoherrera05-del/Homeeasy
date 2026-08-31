/**
 * HomeEasy WhatsApp Document Actions v0.2.0
 * Envío manual y reenvío de PDFs con mensajes personalizados y vista previa.
 * WhatsApp nunca modifica ni bloquea el flujo principal de HomeEasy.
 */
(function (global) {
    'use strict';

    if (global.HomeEasyWhatsAppDocumentActions) return;

    const VERSION = '0.2.0';
    const page = ((global.location && global.location.pathname ? global.location.pathname.split('/').pop() : '') || '').toLowerCase();
    const DOCUMENT_PAGES = Object.freeze({
        'cotizacion.html': 'cotizacion',
        'pedido.html': 'pedido',
        'abono.html': 'abono'
    });
    const SUPPORTED_PAGES = new Set([...Object.keys(DOCUMENT_PAGES), 'ventas.html', 'clientes.html']);
    if (!SUPPORTED_PAGES.has(page)) return;

    const STYLE_ID = 'homeeasyWhatsappDocumentActionsStyle';
    const FETCH_PATCH_FLAG = '__HOMEEASY_WHATSAPP_DOC_FETCH_V2__';
    const processed = new WeakSet();
    let latestGenerated = null;
    let toastTimer = null;

    const clean = value => String(value == null ? '' : value).trim();

    function digits(value) {
        let out = clean(value).replace(/\D/g, '');
        if (out.startsWith('00')) out = out.slice(2);
        if (/^3\d{9}$/.test(out)) out = '57' + out;
        return out;
    }

    function displayPhone(value) {
        const number = digits(value);
        if (/^57\d{10}$/.test(number)) return '+57 ' + number.slice(2, 5) + ' ' + number.slice(5, 8) + ' ' + number.slice(8);
        return number ? '+' + number : '';
    }

    function parseMoney(value) {
        const raw = clean(value);
        if (!raw) return null;
        const normalized = raw.replace(/[^\d-]/g, '');
        if (!normalized || normalized === '-') return null;
        const number = Number(normalized);
        return Number.isFinite(number) ? number : null;
    }

    function formatMoney(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '';
        return '$' + Math.round(number).toLocaleString('es-CO');
    }

    function firstName(value) {
        const raw = clean(value).replace(/\s+/g, ' ');
        if (!raw) return '';
        const word = raw.split(' ')[0].toLocaleLowerCase('es-CO');
        return word.charAt(0).toLocaleUpperCase('es-CO') + word.slice(1);
    }

    function textOf(selector, root) {
        const node = (root || global.document).querySelector(selector);
        return node ? clean(node.textContent) : '';
    }

    function valueOf(selector) {
        const node = global.document.querySelector(selector);
        return node && 'value' in node ? clean(node.value) : '';
    }

    function documentLabel(type) {
        if (type === 'cotizacion') return 'cotización';
        if (type === 'pedido') return 'orden de pedido';
        return 'recibo de abono';
    }

    function normalizeReference(type, value) {
        let raw = clean(value).replace(/^(COT|OP|R\.?\s*C\.?|RECIBO)\s*[-:#Nº°.]?\s*/i, '');
        if (!raw) return '';
        if (type === 'cotizacion') return 'COT-' + raw;
        if (type === 'pedido') return 'OP-' + raw;
        return 'N.º ' + raw;
    }

    function referenceFromFilename(type, filename) {
        const name = clean(filename);
        if (!name) return '';
        const patterns = type === 'cotizacion'
            ? [/cot(?:izacion)?[_\s-]*(\d+)/i]
            : type === 'pedido'
                ? [/(?:orden[_\s-]*(?:pedido)?|op)[_\s-]*(\d+)/i]
                : [/(?:recibo|abono)[_\s-]*(?:n[_\s-]*)?(\d+)/i];
        for (const pattern of patterns) {
            const match = name.match(pattern);
            if (match) return match[1];
        }
        return '';
    }

    function defaultFilename(type, reference) {
        const ref = clean(reference).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
        if (type === 'cotizacion') return 'Cotizacion' + (ref ? '_' + ref : '') + '.pdf';
        if (type === 'pedido') return 'Orden_Pedido' + (ref ? '_' + ref : '') + '.pdf';
        return 'Recibo_Abono' + (ref ? '_' + ref : '') + '.pdf';
    }

    function buildCaption(context, resend) {
        const ctx = context || {};
        const type = ctx.documentType || 'pedido';
        const name = firstName(ctx.clientName);
        const hello = name ? `Hola, *${name}* 👋` : 'Hola 👋';
        const reference = normalizeReference(type, ctx.reference);
        const orderReference = normalizeReference('pedido', ctx.orderReference);
        const signature = '*HomeEasy*\n_Viste tu hogar con estilo_ ✨';

        if (resend) {
            const doc = type === 'cotizacion'
                ? `tu *Cotización${reference ? ' ' + reference : ''}*`
                : type === 'pedido'
                    ? `tu *Orden de Pedido${reference ? ' ' + reference : ''}*`
                    : `tu *Recibo de Abono${reference ? ' ' + reference : ''}*`;
            return [hello, '', `Tal como solicitaste, te reenviamos ${doc} de HomeEasy.`, '', 'Encontrarás el documento adjunto en PDF.', '', signature].join('\n').slice(0, 1000);
        }

        if (type === 'cotizacion') {
            return [hello, '', `Te compartimos tu *Cotización${reference ? ' ' + reference : ''}* de HomeEasy.`, '', 'En el PDF encontrarás el detalle de tu propuesta, productos, medidas y valores.', '', 'Si deseas realizar algún ajuste o tienes alguna duda, puedes responder directamente a este mensaje. Con gusto te ayudamos.', '', signature].join('\n').slice(0, 1000);
        }

        if (type === 'pedido') {
            return [hello, '', `Te compartimos tu *Orden de Pedido${reference ? ' ' + reference : ''}* de HomeEasy.`, '', 'Te recomendamos revisar los productos, medidas, acabados y valores registrados en el documento adjunto.', '', 'Si encuentras alguna novedad, escríbenos por este mismo medio.', '', signature].join('\n').slice(0, 1000);
        }

        const lines = [hello, '', `Hemos registrado correctamente tu abono${Number.isFinite(ctx.amount) ? ' de *' + formatMoney(ctx.amount) + '*' : ''}${orderReference ? ' correspondiente a la *' + orderReference + '*' : ''}.`, '', `Te adjuntamos tu *Recibo de Abono${reference ? ' ' + reference : ''}* en PDF para tu respaldo.`, ''];
        if (Number.isFinite(ctx.balance)) {
            if (ctx.balance <= 0) lines.push('*Tu pedido se encuentra a paz y salvo. ✅*');
            else lines.push(`*Saldo pendiente: ${formatMoney(ctx.balance)}*`);
            lines.push('');
        }
        lines.push('Gracias por confiar en *HomeEasy*. 🤍');
        return lines.join('\n').slice(0, 1000);
    }

    function createIdempotencyKey(prefix, type, filename, phone) {
        const core = global.HomeEasyCore;
        const nonce = core && typeof core.createRequestId === 'function' ? core.createRequestId() : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
        return [prefix, type, clean(filename), digits(phone), nonce].join(':').slice(0, 180);
    }

    function installStyles() {
        if (!global.document || global.document.getElementById(STYLE_ID)) return;
        const style = global.document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .he-wa-generated-btn{width:100%;min-height:52px;margin:0 0 10px;border:0;border-radius:14px;display:flex;align-items:center;justify-content:center;gap:9px;background:#25D366;color:#fff;font:800 .92rem/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 9px 22px rgba(37,211,102,.23);transition:transform .14s ease,opacity .14s ease}
            .he-wa-generated-btn:active{transform:scale(.97)}.he-wa-generated-btn:disabled{opacity:.58;cursor:wait}
            .he-wa-inline-btn{min-height:34px;padding:0 11px;border:1px solid rgba(37,211,102,.30);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:rgba(37,211,102,.09);color:#168b43;font:750 .60rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap}
            .he-wa-inline-btn:active,.he-wa-icon-btn:active{transform:scale(.95)}
            .he-wa-icon-btn{width:33px;height:33px;padding:0;border:1px solid rgba(37,211,102,.28);border-radius:10px;display:inline-grid;place-items:center;background:rgba(37,211,102,.09);color:#159447;font-size:.85rem}
            .he-wa-client-resend{margin-left:7px}.v31-order-actions.he-wa-order-actions{grid-template-columns:minmax(0,1fr) minmax(105px,180px) minmax(92px,145px)!important}
            .v31-payment-row.he-wa-payment-row{grid-template-columns:minmax(220px,1.15fr) minmax(120px,.65fr) minmax(125px,.55fr) 38px!important}.v31-payment-row .he-wa-payment-resend{margin:0;justify-self:end}
            .drawer-actions .he-wa-drawer-send{border:1px solid rgba(37,211,102,.26)!important;background:rgba(37,211,102,.10)!important;color:#168b43!important}
            .he-wa-dialog{position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:18px;background:rgba(38,28,32,.28);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .18s ease,visibility .18s ease;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif}
            .he-wa-dialog.is-open{opacity:1;visibility:visible;pointer-events:auto}.he-wa-dialog-card{width:min(410px,100%);max-height:min(86dvh,720px);overflow:auto;padding:23px;border-radius:24px;background:rgba(255,255,255,.99);border:1px solid rgba(255,255,255,.75);box-shadow:0 24px 70px rgba(38,28,32,.20);color:#2b2729}
            .he-wa-dialog-icon{width:52px;height:52px;margin:0 auto 13px;border-radius:17px;display:grid;place-items:center;background:#25D366;color:#fff;font-size:25px;box-shadow:0 10px 22px rgba(37,211,102,.20)}
            .he-wa-dialog h3{margin:0;text-align:center;font-size:1.13rem;font-weight:780;letter-spacing:-.03em}.he-wa-dialog p{margin:8px auto 17px;max-width:35ch;text-align:center;color:#7c7579;font-size:.76rem;line-height:1.5;font-weight:540}
            .he-wa-dialog label{display:block;margin:0 0 6px;color:#8c8589;font-size:.60rem;font-weight:760;text-transform:uppercase;letter-spacing:.06em}
            .he-wa-dialog input{width:100%;height:49px;border:1px solid #e4dfe1;border-radius:13px;background:#faf9fa;color:#302b2e;padding:0 13px;font-size:16px;font-weight:650;outline:none}.he-wa-dialog input:focus{border-color:rgba(37,211,102,.55);background:#fff;box-shadow:0 0 0 3px rgba(37,211,102,.10)}
            .he-wa-preview{margin:14px 0 0;padding:13px 14px;border:1px solid #ece8ea;border-radius:14px;background:#f8f8f9;color:#4d474a;font-size:.72rem;line-height:1.5;white-space:pre-wrap;max-height:245px;overflow:auto;text-align:left}.he-wa-preview strong{display:block;margin-bottom:7px;color:#847d81;font-size:.58rem;text-transform:uppercase;letter-spacing:.06em}
            .he-wa-dialog-error{min-height:18px;margin:7px 2px 0;color:#c53b3b;font-size:.64rem;font-weight:650}.he-wa-dialog-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:8px;margin-top:10px}
            .he-wa-dialog-actions button{height:47px;border-radius:13px;border:1px solid #e8e3e5;background:#fff;color:#696165;font-weight:720}.he-wa-dialog-actions button.he-wa-confirm{border-color:#25D366;background:#25D366;color:#fff;box-shadow:0 8px 18px rgba(37,211,102,.18)}.he-wa-dialog-actions button:disabled{opacity:.58;cursor:wait}
            .he-wa-toast{position:fixed;z-index:2147483647;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translate(-50%,16px);max-width:min(92vw,430px);padding:12px 15px;border-radius:14px;background:rgba(30,28,29,.92);color:#fff;font:650 .72rem/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 12px 35px rgba(0,0,0,.20);opacity:0;visibility:hidden;transition:.2s ease;text-align:center}.he-wa-toast.is-showing{opacity:1;visibility:visible;transform:translate(-50%,0)}
            @media(max-width:620px){.he-wa-inline-btn{min-height:36px}.v31-quote-actions .he-wa-client-resend{margin-left:0}.v31-order-actions.he-wa-order-actions{grid-template-columns:minmax(0,1fr) 96px 90px!important;gap:7px!important}.v31-order-actions.he-wa-order-actions .he-wa-client-resend{padding:0 8px;font-size:.56rem}.v31-payment-row.he-wa-payment-row{grid-template-columns:minmax(0,1fr) auto 38px!important;gap:7px 9px!important}.v31-payment-row.he-wa-payment-row .v31-payment-left{grid-column:1/-1!important}.v31-payment-row.he-wa-payment-row .v31-payment-date{grid-column:1!important;grid-row:2!important}.v31-payment-row.he-wa-payment-row .v31-payment-amount{grid-column:2!important;grid-row:2!important}.v31-payment-row.he-wa-payment-row .he-wa-payment-resend{grid-column:3!important;grid-row:2!important}}
        `;
        global.document.head.appendChild(style);
    }

    function toast(message) {
        if (!global.document || !global.document.body) return;
        let node = global.document.getElementById('homeeasyWhatsappToast');
        if (!node) { node = global.document.createElement('div'); node.id = 'homeeasyWhatsappToast'; node.className = 'he-wa-toast'; global.document.body.appendChild(node); }
        node.textContent = clean(message) || 'Listo';
        node.classList.add('is-showing');
        global.clearTimeout(toastTimer);
        toastTimer = global.setTimeout(() => node.classList.remove('is-showing'), 2800);
    }

    function makeDialog() {
        let overlay = global.document.getElementById('homeeasyWhatsappSendDialog');
        if (overlay) return overlay;
        overlay = global.document.createElement('div');
        overlay.id = 'homeeasyWhatsappSendDialog';
        overlay.className = 'he-wa-dialog';
        overlay.innerHTML = `<section class="he-wa-dialog-card" role="dialog" aria-modal="true" aria-labelledby="heWaDialogTitle"><div class="he-wa-dialog-icon"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i></div><h3 id="heWaDialogTitle">Enviar por WhatsApp</h3><p id="heWaDialogCopy">Confirma el cliente y el número antes de enviar.</p><label for="heWaDialogPhone">Número de WhatsApp</label><input id="heWaDialogPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Ej. 333 123 4567"><div class="he-wa-preview" id="heWaDialogPreview"><strong>Mensaje que verá el cliente</strong><span></span></div><div class="he-wa-dialog-error" id="heWaDialogError"></div><div class="he-wa-dialog-actions"><button type="button" id="heWaDialogCancel">Cancelar</button><button type="button" class="he-wa-confirm" id="heWaDialogConfirm"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Enviar</button></div></section>`;
        overlay.addEventListener('click', event => { if (event.target === overlay) global.document.getElementById('heWaDialogCancel').click(); });
        global.document.body.appendChild(overlay);
        return overlay;
    }

    function confirmSend(context) {
        const ctx = context || {};
        const overlay = makeDialog();
        const input = global.document.getElementById('heWaDialogPhone');
        const title = global.document.getElementById('heWaDialogTitle');
        const copy = global.document.getElementById('heWaDialogCopy');
        const error = global.document.getElementById('heWaDialogError');
        const preview = global.document.querySelector('#heWaDialogPreview span');
        const cancel = global.document.getElementById('heWaDialogCancel');
        const confirm = global.document.getElementById('heWaDialogConfirm');
        const caption = buildCaption(ctx, Boolean(ctx.resend));
        title.textContent = (ctx.resend ? 'Reenviar ' : 'Enviar ') + documentLabel(ctx.documentType || 'pedido') + ' por WhatsApp';
        const who = clean(ctx.clientName);
        copy.textContent = who ? `Revisa el envío para ${who}. Puedes corregir el número antes de continuar.` : 'Confirma el número del cliente antes de enviar.';
        input.value = displayPhone(ctx.phone || '');
        preview.textContent = caption;
        error.textContent = '';
        confirm.disabled = false;
        cancel.disabled = false;
        overlay.classList.add('is-open');
        global.setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 80);
        return new Promise(resolve => {
            let settled = false;
            const finish = value => { if (settled) return; settled = true; overlay.classList.remove('is-open'); cancel.removeEventListener('click', onCancel); confirm.removeEventListener('click', onConfirm); input.removeEventListener('keydown', onKey); resolve(value); };
            const onCancel = () => finish(null);
            const onConfirm = () => { const phone = digits(input.value); if (!/^\d{8,15}$/.test(phone)) { error.textContent = 'Revisa el número. Puedes escribirlo con espacios; HomeEasy lo organiza.'; input.focus(); return; } finish({ phone, caption }); };
            const onKey = event => { if (event.key === 'Enter') { event.preventDefault(); onConfirm(); } if (event.key === 'Escape') { event.preventDefault(); onCancel(); } };
            cancel.addEventListener('click', onCancel); confirm.addEventListener('click', onConfirm); input.addEventListener('keydown', onKey);
        });
    }

    function parseStoredClients(cedula) {
        const id = clean(cedula); if (!id) return null;
        try {
            const parsed = JSON.parse(global.localStorage.getItem('CACHE_CLIENTES') || 'null'); if (!parsed) return null;
            if (Array.isArray(parsed)) {
                const row = parsed.find(item => Array.isArray(item) ? clean(item[0]) === id : clean(item && (item.cedula || item.documento || item.id)) === id);
                if (Array.isArray(row)) return { cedula: clean(row[0]), nombre: clean(row[1]), telefono: clean(row[2]) };
                if (row && typeof row === 'object') return row;
            }
            if (typeof parsed === 'object') { if (parsed[id] && typeof parsed[id] === 'object') return parsed[id]; return Object.values(parsed).find(item => item && typeof item === 'object' && clean(item.cedula) === id) || null; }
        } catch (_) {}
        return null;
    }

    async function lookupClient(cedula) {
        const id = clean(cedula); const cached = parseStoredClients(id);
        if (cached && (cached.telefono || cached.nombre)) return cached;
        if (!id) return cached || null;
        const core = global.HomeEasyCore; if (!core || typeof core.get !== 'function') return cached || null;
        try { const data = await core.get({ tipo: 'HISTORIAL_CLIENTE', cedula: id, t: Date.now() }, { timeoutMs: 18000 }); if (data && data.status === 'found' && data.cliente) return data.cliente; } catch (_) {}
        return cached || null;
    }

    async function enrichClientContext(context) {
        const ctx = { ...(context || {}) };
        if ((!ctx.phone || !ctx.clientName) && ctx.cedula) { const client = await lookupClient(ctx.cedula); if (client) { if (!ctx.phone) ctx.phone = client.telefono || client.phone || ''; if (!ctx.clientName) ctx.clientName = client.nombre || client.name || ''; } }
        return ctx;
    }

    function generatedContext(payload) {
        const type = DOCUMENT_PAGES[page];
        if (!type || !payload || typeof payload !== 'object') return null;
        const pdfBase64 = clean(payload.pdfBase64); const filename = clean(payload.nombreArchivo || payload.filename); if (!pdfBase64 || !filename) return null;
        let reference = clean(payload.numero || payload.numeroCotizacion || ''); let orderReference = clean(payload.numeroOP || ''); let amount = null; let balance = null;
        if (type === 'cotizacion') reference = reference || textOf('#n_cot_display') || referenceFromFilename(type, filename);
        else if (type === 'pedido') { reference = reference || textOf('#n_orden_display') || referenceFromFilename(type, filename); balance = parseMoney(textOf('#saldo_pendiente_val')); }
        else { reference = textOf('#n_recibo_display') || referenceFromFilename(type, filename) || reference; orderReference = orderReference || valueOf('#numeroOP'); amount = Number(payload.valorAbono); if (!Number.isFinite(amount)) amount = parseMoney(valueOf('#valorAbono')); balance = parseMoney(textOf('#nuevo_saldo_val')); }
        return { documentType: type, pdfBase64, filename, cedula: clean(payload.cedula || valueOf('#cedula')), phone: clean(payload.telefono || valueOf('#telefono')), clientName: clean(payload.nombre || valueOf('#nombre')), reference, orderReference, amount, balance, resend: false };
    }

    function isSuccessful(data) { const status = clean(data && data.status).toLowerCase(); return status === 'success' || status === 'ok'; }

    function installGeneratedCapture() {
        if (!DOCUMENT_PAGES[page] || global[FETCH_PATCH_FLAG]) return;
        global[FETCH_PATCH_FLAG] = true;
        const originalFetch = global.fetch.bind(global);
        global.fetch = async function homeEasyWhatsappCaptureFetch(resource, init) {
            const options = init || {}; let payload = null; if (typeof options.body === 'string') { try { payload = JSON.parse(options.body); } catch (_) {} }
            const candidate = generatedContext(payload); const response = await originalFetch(resource, init);
            if (candidate) response.clone().json().then(data => { if (!isSuccessful(data)) return; latestGenerated = candidate; global.setTimeout(showGeneratedButton, 650); }).catch(() => {});
            return response;
        };
    }

    async function sendContext(context) {
        if (!global.HomeEasyWhatsApp) { toast('WhatsApp todavía no está disponible. Intenta nuevamente.'); return null; }
        let ctx = await enrichClientContext(context); const confirmed = await confirmSend(ctx); if (!confirmed) return null; ctx = { ...ctx, phone: confirmed.phone, caption: confirmed.caption };
        const filename = clean(ctx.filename) || defaultFilename(ctx.documentType, ctx.reference);
        const common = { documentType: ctx.documentType, phone: ctx.phone, filename, caption: ctx.caption, idempotencyKey: createIdempotencyKey(ctx.resend ? 'resend' : 'send', ctx.documentType, filename, ctx.phone) };
        try {
            const result = ctx.pdfBase64 ? await global.HomeEasyWhatsApp.sendDocument({ ...common, pdfBase64: ctx.pdfBase64 }) : await global.HomeEasyWhatsApp.sendDocumentUrl({ ...common, pdfUrl: ctx.pdfUrl });
            if (result && result.delivery === 'UNKNOWN') toast('WhatsApp recibió el envío, pero no confirmó el resultado. No lo reenviaremos automáticamente.');
            else if (result && result.duplicate) toast('Este envío ya había sido procesado.');
            else toast((ctx.resend ? 'Documento reenviado' : 'Documento enviado') + ' por WhatsApp ✅');
            return result;
        } catch (error) { toast(error && error.message ? error.message : 'No fue posible enviar el documento por WhatsApp.'); return null; }
    }

    async function sendGenerated() { if (!latestGenerated) { toast('El PDF todavía no está listo.'); return; } await sendContext(latestGenerated); }

    function showGeneratedButton() {
        const box = global.document.querySelector('#success-modal .success-box, .success-overlay .success-box'); if (!box || box.querySelector('.he-wa-generated-btn')) return;
        const home = box.querySelector('.btn-success-home, #btn-success-home'); const button = global.document.createElement('button'); button.type = 'button'; button.className = 'he-wa-generated-btn'; button.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Enviar por WhatsApp';
        button.addEventListener('click', async () => { if (button.disabled) return; button.disabled = true; const old = button.innerHTML; button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Preparando…'; try { await sendGenerated(); } finally { button.disabled = false; button.innerHTML = old; } });
        if (home) box.insertBefore(button, home); else box.appendChild(button);
    }

    function makeInlineButton(text, className) { const button = global.document.createElement('button'); button.type = 'button'; button.className = className || 'he-wa-inline-btn'; button.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i>' + (text ? ' ' + text : ''); return button; }

    function pdfUrlFromElement(root) {
        if (!root) return ''; const anchor = root.querySelector('a[href*="drive.google"],a[href*="googleusercontent"],a[href$=".pdf"],a[title*="PDF"]'); if (anchor) return clean(anchor.href);
        const clickable = root.querySelector('[onclick*="abrirVisorPDF"]'); if (clickable) { const match = clean(clickable.getAttribute('onclick')).match(/abrirVisorPDF\(['"]([^'"]+)['"]\)/); if (match) return match[1]; }
        return '';
    }

    function clientNameFromPage() { return textOf('.v31-name') || textOf('#c_nombre'); }
    function clientCedulaFromPage() { return textOf('.v31-id') || textOf('#c_cedula') || clean(global.clienteActual && global.clienteActual.cedula); }
    function clientPhoneFromPage() { const visible = textOf('.v31-contact-value'); return clean(global.clienteActual && global.clienteActual.telefono) || visible; }

    function addClientOrderButton(card) {
        const url = pdfUrlFromElement(card); if (!url) return; const actions = card.querySelector('.v31-order-actions'); if (!actions || actions.querySelector('.he-wa-client-resend')) return;
        const reference = textOf('.v31-order-code', card).replace(/^OP\s*/i, ''); const button = makeInlineButton('Reenviar', 'he-wa-inline-btn he-wa-client-resend'); actions.classList.add('he-wa-order-actions');
        button.addEventListener('click', event => { event.stopPropagation(); sendContext({ documentType: 'pedido', pdfUrl: url, filename: defaultFilename('pedido', reference), cedula: clientCedulaFromPage(), phone: clientPhoneFromPage(), clientName: clientNameFromPage(), reference, balance: parseMoney(textOf('.v31-balance', card)), resend: true }); });
        actions.appendChild(button);
    }

    function addClientQuoteButton(card) {
        const url = pdfUrlFromElement(card); if (!url) return; const actions = card.querySelector('.v31-quote-actions'); if (!actions || actions.querySelector('.he-wa-client-resend')) return;
        const reference = textOf('.v31-order-code', card).replace(/^COT\s*/i, ''); const button = makeInlineButton('Reenviar', 'he-wa-inline-btn he-wa-client-resend');
        button.addEventListener('click', event => { event.stopPropagation(); sendContext({ documentType: 'cotizacion', pdfUrl: url, filename: defaultFilename('cotizacion', reference), cedula: clientCedulaFromPage(), phone: clientPhoneFromPage(), clientName: clientNameFromPage(), reference, resend: true }); }); actions.appendChild(button);
    }

    function addClientPaymentButton(row) {
        const url = pdfUrlFromElement(row); if (!url || row.querySelector('.he-wa-payment-resend')) return; const orderCard = row.closest('.v31-order'); const orderReference = orderCard ? textOf('.v31-order-code', orderCard).replace(/^OP\s*/i, '') : '';
        const paymentName = textOf('.v31-payment-name', row); const receiptMatch = paymentName.match(/(?:R\.?\s*C\.?|RECIBO)\s*([A-Za-z0-9_-]+)/i); const reference = receiptMatch ? receiptMatch[1] : paymentName; const button = makeInlineButton('', 'he-wa-icon-btn he-wa-payment-resend'); button.title = 'Reenviar recibo por WhatsApp'; button.setAttribute('aria-label', 'Reenviar recibo por WhatsApp'); row.classList.add('he-wa-payment-row');
        button.addEventListener('click', event => { event.stopPropagation(); sendContext({ documentType: 'abono', pdfUrl: url, filename: defaultFilename('abono', reference), cedula: clientCedulaFromPage(), phone: clientPhoneFromPage(), clientName: clientNameFromPage(), reference, orderReference, amount: parseMoney(textOf('.v31-payment-amount', row)), balance: orderCard ? parseMoney(textOf('.v31-balance', orderCard)) : null, resend: true }); }); row.appendChild(button);
    }

    function augmentClients() {
        if (page !== 'clientes.html') return;
        global.document.querySelectorAll('.v31-order').forEach(card => { if (!processed.has(card)) { addClientOrderButton(card); processed.add(card); } });
        global.document.querySelectorAll('.v31-quote').forEach(card => { if (!processed.has(card)) { addClientQuoteButton(card); processed.add(card); } });
        global.document.querySelectorAll('.v31-payment-row').forEach(row => { if (!row.querySelector('.he-wa-payment-resend')) addClientPaymentButton(row); });
        global.document.querySelectorAll('.item-card').forEach(card => { if (card.querySelector('.he-wa-client-resend')) return; const url = pdfUrlFromElement(card); if (!url) return; const header = textOf('.item-header', card); const type = /COT/i.test(header) ? 'cotizacion' : 'pedido'; const refMatch = header.match(/(?:COT|OP)[-\s]*([A-Za-z0-9_-]+)/i); const reference = refMatch ? refMatch[1] : ''; const footer = card.querySelector('.item-footer .d-flex'); if (!footer) return; const button = makeInlineButton('WhatsApp', 'he-wa-inline-btn he-wa-client-resend'); button.addEventListener('click', event => { event.stopPropagation(); sendContext({ documentType: type, pdfUrl: url, filename: defaultFilename(type, reference), cedula: clientCedulaFromPage(), phone: clientPhoneFromPage(), clientName: clientNameFromPage(), reference, resend: true }); }); footer.appendChild(button); });
    }

    function salesContextFromRow(row, pdfUrl) {
        const reference = clean(row && row.dataset && row.dataset.op) || textOf('.cell-op', row).replace(/^OP-?/i, '');
        return { documentType: 'pedido', pdfUrl, filename: defaultFilename('pedido', reference), cedula: textOf('.client-doc', row).replace(/^Sin documento$/i, ''), clientName: textOf('.client-name', row), reference, balance: parseMoney(textOf('.money.saldo', row)), resend: true };
    }

    function augmentSalesRows() {
        if (page !== 'ventas.html') return;
        global.document.querySelectorAll('#salesBody tr, table tbody tr').forEach(row => { if (row.querySelector('.he-wa-sales-send')) return; const pdf = row.querySelector('a[href][title*="PDF"],a[href*="drive.google"],a[href*="googleusercontent"]'); if (!pdf) return; const actions = row.querySelector('.row-actions'); if (!actions) return; const button = makeInlineButton('', 'he-wa-icon-btn he-wa-sales-send'); button.title = 'Reenviar por WhatsApp'; button.setAttribute('aria-label', 'Reenviar por WhatsApp'); button.addEventListener('click', event => { event.stopPropagation(); sendContext(salesContextFromRow(row, pdf.href)); }); actions.appendChild(button); });
    }

    function augmentSalesDrawer() {
        if (page !== 'ventas.html') return; const drawer = global.document.querySelector('#detailDrawer, .drawer'); if (!drawer) return; const actions = drawer.querySelector('.drawer-actions'); if (!actions || actions.querySelector('.he-wa-drawer-send')) return; const pdf = actions.querySelector('a[href][target="_blank"],a[href*="drive.google"],a[href*="googleusercontent"]'); if (!pdf) return;
        const reference = textOf('#drawerTitle').replace(/^OP-?/i, '') || textOf('.drawer-title strong').replace(/^OP-?/i, ''); const button = makeInlineButton('Reenviar por WhatsApp', 'drawer-action he-wa-drawer-send');
        button.addEventListener('click', event => { event.stopPropagation(); const row = global.document.querySelector(`tr[data-op="${reference}"]`); sendContext({ documentType: 'pedido', pdfUrl: pdf.href, filename: defaultFilename('pedido', reference), clientName: textOf('.detail-hero h3', drawer), cedula: clean(row && row.querySelector('.client-doc') && row.querySelector('.client-doc').textContent), reference, balance: parseMoney(textOf('.money.saldo', row || drawer)), resend: true }); }); actions.appendChild(button);
    }

    function augmentDynamicContent() { augmentClients(); augmentSalesRows(); augmentSalesDrawer(); if (DOCUMENT_PAGES[page] && latestGenerated) showGeneratedButton(); }
    function observeDynamicContent() { if (!global.document || !global.document.documentElement) return; const observer = new MutationObserver(() => augmentDynamicContent()); observer.observe(global.document.documentElement, { childList: true, subtree: true }); }
    async function sendStoredDocument(options) { const opts = options || {}; return sendContext({ ...opts, documentType: clean(opts.documentType || 'pedido').toLowerCase(), resend: opts.resend !== false }); }

    installStyles(); installGeneratedCapture();
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', () => { augmentDynamicContent(); observeDynamicContent(); }, { once: true });
    else { augmentDynamicContent(); observeDynamicContent(); }

    global.HomeEasyWhatsAppDocumentActions = Object.freeze({ VERSION, buildCaption, sendStoredDocument, getLatestGenerated: () => latestGenerated });
})(window);
