/**
 * HomeEasy WhatsApp Settings v0.1.0
 * Integra WhatsApp dentro de Configuración sin exponer secretos del Bridge.
 */
(function (global) {
    'use strict';

    if (((global.location.pathname.split('/').pop() || '').toLowerCase()) !== 'configuracion.html') return;

    const STYLE_ID = 'homeeasyWhatsappSettingsStyle';
    const PANEL_ID = 'panel-integraciones';
    let lastPayload = null;
    let loading = false;

    function installStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .he-wa-card{overflow:hidden;border:1px solid rgba(60,60,67,.09);border-radius:24px;background:#fff;box-shadow:0 12px 34px rgba(44,34,38,.055)}
            .he-wa-main{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;padding:22px 22px 20px;background:linear-gradient(145deg,rgba(255,255,255,1),rgba(252,249,250,.98))}
            .he-wa-main::after{content:'';position:absolute;left:22px;right:22px;bottom:0;height:1px;background:rgba(60,60,67,.08);transform:scaleY(.5)}
            .he-wa-logo{width:54px;height:54px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(145deg,#33d368,#20b858);color:#fff;font-size:26px;box-shadow:0 10px 22px rgba(32,184,88,.20),inset 0 1px 0 rgba(255,255,255,.32)}
            .he-wa-copy{min-width:0}.he-wa-eyebrow{color:#91898d;font-size:.61rem;font-weight:780;letter-spacing:.09em;text-transform:uppercase}.he-wa-title{margin:4px 0 0;color:#2c272a;font-size:1.08rem;line-height:1.15;font-weight:760;letter-spacing:-.025em}.he-wa-description{margin:5px 0 0;color:#7f777b;font-size:.72rem;line-height:1.48;font-weight:520}
            .he-wa-chip{display:inline-flex;align-items:center;gap:7px;min-height:31px;padding:0 11px;border-radius:999px;border:1px solid rgba(60,60,67,.08);background:#f5f3f4;color:#787175;font-size:.63rem;font-weight:780;white-space:nowrap}.he-wa-chip::before{content:'';width:7px;height:7px;border-radius:50%;background:#a8a3a6}.he-wa-chip.ready{background:rgba(52,199,89,.09);border-color:rgba(52,199,89,.18);color:#268642}.he-wa-chip.ready::before{background:#34c759;box-shadow:0 0 0 4px rgba(52,199,89,.09)}.he-wa-chip.busy{background:rgba(194,164,104,.10);border-color:rgba(194,164,104,.20);color:#91733b}.he-wa-chip.busy::before{background:#c2a468}.he-wa-chip.error{background:rgba(255,59,48,.075);border-color:rgba(255,59,48,.15);color:#b33d37}.he-wa-chip.error::before{background:#ff3b30}
            .he-wa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;padding:4px 22px 0}.he-wa-detail{min-width:0;padding:15px 0;border-bottom:1px solid rgba(60,60,67,.065)}.he-wa-detail:nth-child(odd){padding-right:18px}.he-wa-detail:nth-child(even){padding-left:18px;border-left:1px solid rgba(60,60,67,.065)}.he-wa-label{display:block;color:#aaa3a7;font-size:.58rem;font-weight:760;text-transform:uppercase;letter-spacing:.075em}.he-wa-value{display:block;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#393337;font-size:.76rem;font-weight:650}
            .he-wa-actions{display:flex;flex-wrap:wrap;gap:9px;padding:18px 22px 21px}.he-wa-button{min-height:43px;padding:0 15px;border:1px solid rgba(60,60,67,.10);border-radius:13px;background:#fff;color:#514a4e;font-size:.69rem;font-weight:690;box-shadow:0 4px 12px rgba(44,34,38,.035);transition:transform .14s ease,background .14s ease,border-color .14s ease}.he-wa-button i{margin-right:7px;color:#a6455a}.he-wa-button.primary{border-color:#a6455a;background:#a6455a;color:#fff;box-shadow:0 7px 17px rgba(166,69,90,.18)}.he-wa-button.primary i{color:#fff}.he-wa-button:disabled{opacity:.52;cursor:wait}.he-wa-button:active{transform:scale(.97)}
            .he-wa-note{display:flex;align-items:flex-start;gap:11px;margin-top:14px;padding:14px 15px;border:1px solid rgba(194,164,104,.18);border-radius:16px;background:rgba(194,164,104,.075);color:#77684d;font-size:.65rem;line-height:1.5}.he-wa-note i{margin-top:2px;color:#b89550}.he-wa-note strong{color:#65583f}
            .he-wa-qr-wrap{display:grid;place-items:center;padding:8px}.he-wa-qr{display:block;width:min(290px,78vw);height:auto;border-radius:14px;border:10px solid #fff;box-shadow:0 14px 38px rgba(0,0,0,.11)}
            @media(any-hover:hover) and (any-pointer:fine){.he-wa-button:hover:not(:disabled){border-color:rgba(166,69,90,.23);background:#fbf7f8;transform:translateY(-1px)}.he-wa-button.primary:hover:not(:disabled){background:#963d51;color:#fff}}
            @media(max-width:620px){.he-wa-main{grid-template-columns:auto minmax(0,1fr);padding:18px 16px 17px}.he-wa-logo{width:48px;height:48px;border-radius:16px;font-size:23px}.he-wa-chip{grid-column:1/-1;width:max-content;margin-top:1px}.he-wa-grid{grid-template-columns:1fr;padding:3px 16px 0}.he-wa-detail:nth-child(n){padding:13px 0;border-left:0}.he-wa-actions{padding:16px;display:grid;grid-template-columns:1fr 1fr}.he-wa-button{width:100%;padding:0 10px}.he-wa-button.primary{grid-column:1/-1}.he-wa-note{margin-top:12px}}
        `;
        document.head.appendChild(style);
    }

    function insertNavigation() {
        const mobileNav = document.querySelector('.mobile-tabs');
        if (mobileNav && !mobileNav.querySelector('[data-section="integraciones"]')) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mobile-tab';
            button.dataset.section = 'integraciones';
            button.textContent = 'Integraciones';
            const before = mobileNav.querySelector('[data-section="restauraciones"]');
            mobileNav.insertBefore(button, before || null);
            button.addEventListener('click', () => showSection('integraciones'));
        }

        const sideNav = document.querySelector('.side-nav');
        if (sideNav && !sideNav.querySelector('[data-section="integraciones"]')) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'nav-button';
            button.dataset.section = 'integraciones';
            button.innerHTML = '<i class="fa-solid fa-plug"></i> Integraciones';
            const before = sideNav.querySelector('[data-section="restauraciones"]');
            sideNav.insertBefore(button, before || null);
            button.addEventListener('click', () => showSection('integraciones'));
        }
    }

    function panelHtml() {
        return `
            <div class="page-heading">
                <h2>Integraciones</h2>
                <p>Servicios conectados a HomeEasy para automatizar tareas sin salir de la aplicación.</p>
            </div>
            <div class="he-wa-card">
                <div class="he-wa-main">
                    <div class="he-wa-logo" aria-hidden="true"><i class="fa-brands fa-whatsapp"></i></div>
                    <div class="he-wa-copy">
                        <span class="he-wa-eyebrow">Canal de documentos</span>
                        <h3 class="he-wa-title">WhatsApp HomeEasy</h3>
                        <p class="he-wa-description" id="heWaDescription">Comprobando la conexión segura con WhatsApp…</p>
                    </div>
                    <span class="he-wa-chip busy" id="heWaChip">Comprobando</span>
                </div>
                <div class="he-wa-grid">
                    <div class="he-wa-detail"><span class="he-wa-label">Cuenta conectada</span><span class="he-wa-value" id="heWaAccount">—</span></div>
                    <div class="he-wa-detail"><span class="he-wa-label">Número</span><span class="he-wa-value" id="heWaPhone">—</span></div>
                    <div class="he-wa-detail"><span class="he-wa-label">Conexión</span><span class="he-wa-value" id="heWaEngine">WEBJS · sesión homeeasy</span></div>
                    <div class="he-wa-detail"><span class="he-wa-label">Última comprobación</span><span class="he-wa-value" id="heWaChecked">—</span></div>
                </div>
                <div class="he-wa-actions">
                    <button type="button" class="he-wa-button primary" id="heWaRefresh"><i class="fa-solid fa-arrows-rotate"></i>Probar conexión</button>
                    <button type="button" class="he-wa-button" id="heWaTest"><i class="fa-regular fa-paper-plane"></i>Enviar prueba</button>
                    <button type="button" class="he-wa-button" id="heWaRestart" hidden><i class="fa-solid fa-rotate"></i>Reconectar</button>
                    <button type="button" class="he-wa-button" id="heWaQr" hidden><i class="fa-solid fa-qrcode"></i>Mostrar QR</button>
                </div>
            </div>
            <div class="he-wa-note"><i class="fa-solid fa-shield-halved"></i><div><strong>Conexión protegida.</strong> HomeEasy usa tu sesión actual para autorizar este panel. Las claves de WAHA y del servidor nunca se guardan en el navegador ni en GitHub Pages.</div></div>
        `;
    }

    function insertPanel() {
        if (document.getElementById(PANEL_ID)) return;
        const content = document.querySelector('.content');
        if (!content) return;
        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.id = PANEL_ID;
        panel.dataset.panel = 'integraciones';
        panel.innerHTML = panelHtml();
        const before = document.getElementById('panel-restauraciones');
        content.insertBefore(panel, before || null);
        bindPanelActions(panel);
    }

    function showSection(section) {
        document.querySelectorAll('[data-section]').forEach(button => button.classList.toggle('active', button.dataset.section === section));
        document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === section));
        try { history.replaceState(null, '', '#' + section); } catch (error) {}
        global.scrollTo({ top: 0, behavior: 'smooth' });
        if (section === 'integraciones') loadStatus(false);
    }

    function formatPhone(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (/^57\d{10}$/.test(digits)) return '+57 ' + digits.slice(2,5) + ' ' + digits.slice(5,8) + ' ' + digits.slice(8);
        return digits ? '+' + digits : '—';
    }

    function setLoading(value) {
        loading = Boolean(value);
        ['heWaRefresh','heWaTest','heWaRestart','heWaQr'].forEach(id => {
            const button = document.getElementById(id);
            if (button) button.disabled = loading;
        });
    }

    function applyStatus(payload) {
        lastPayload = payload || null;
        const whatsapp = payload && payload.whatsapp ? payload.whatsapp : {};
        const ready = whatsapp.ready === true && whatsapp.status === 'WORKING';
        const status = String(whatsapp.status || 'UNKNOWN').toUpperCase();
        const me = whatsapp.me || {};
        const chip = document.getElementById('heWaChip');
        const description = document.getElementById('heWaDescription');
        const restart = document.getElementById('heWaRestart');
        const qr = document.getElementById('heWaQr');
        const test = document.getElementById('heWaTest');

        if (chip) {
            chip.className = 'he-wa-chip ' + (ready ? 'ready' : (status === 'STARTING' || status === 'SCAN_QR_CODE' ? 'busy' : 'error'));
            chip.textContent = ready ? 'Conectado' : (status === 'STARTING' ? 'Conectando' : (status === 'SCAN_QR_CODE' ? 'Vincular' : 'Requiere atención'));
        }
        if (description) {
            description.textContent = ready
                ? 'El servidor está listo para enviar documentos desde HomeEasy.'
                : (status === 'SCAN_QR_CODE'
                    ? 'WhatsApp necesita volver a vincularse. Genera un QR y escanéalo desde el celular.'
                    : 'La sesión no está disponible en este momento. Puedes intentar reconectarla.');
        }
        const account = document.getElementById('heWaAccount');
        const phone = document.getElementById('heWaPhone');
        const engine = document.getElementById('heWaEngine');
        const checked = document.getElementById('heWaChecked');
        if (account) account.textContent = String(me.pushName || me.name || 'HomeEasy');
        if (phone) phone.textContent = formatPhone(global.HomeEasyWhatsApp ? global.HomeEasyWhatsApp.connectedPhone(payload) : '');
        if (engine) engine.textContent = String(whatsapp.engine || 'WEBJS') + ' · sesión ' + String(whatsapp.name || 'homeeasy');
        if (checked) checked.textContent = new Intl.DateTimeFormat('es-CO', { hour:'numeric', minute:'2-digit', second:'2-digit' }).format(new Date());
        if (restart) restart.hidden = ready;
        if (qr) qr.hidden = ready || (status !== 'SCAN_QR_CODE' && status !== 'FAILED' && status !== 'MISSING' && status !== 'STOPPED' && status !== 'STARTING');
        if (test) test.hidden = !ready;
    }

    function showPanelError(error) {
        const chip = document.getElementById('heWaChip');
        const description = document.getElementById('heWaDescription');
        if (chip) { chip.className = 'he-wa-chip error'; chip.textContent = 'Sin respuesta'; }
        if (description) description.textContent = error && error.message ? error.message : 'No fue posible comprobar WhatsApp.';
        const checked = document.getElementById('heWaChecked');
        if (checked) checked.textContent = new Intl.DateTimeFormat('es-CO', { hour:'numeric', minute:'2-digit' }).format(new Date());
    }

    async function loadStatus(showFeedback) {
        if (loading || !global.HomeEasyWhatsApp) return;
        setLoading(true);
        try {
            const payload = await global.HomeEasyWhatsApp.status();
            applyStatus(payload);
            if (showFeedback && global.Swal) {
                Swal.fire({ toast:true, position:'top-end', icon:payload.whatsapp && payload.whatsapp.ready ? 'success' : 'info', title:payload.whatsapp && payload.whatsapp.ready ? 'WhatsApp conectado' : 'Estado actualizado', showConfirmButton:false, timer:1800 });
            }
        } catch (error) {
            showPanelError(error);
            if (showFeedback && global.Swal) Swal.fire({ icon:'error', title:'No pudimos comprobar WhatsApp', text:error.message, confirmButtonColor:'#a6455a' });
        } finally {
            setLoading(false);
        }
    }

    async function sendTest() {
        if (loading || !global.HomeEasyWhatsApp) return;
        setLoading(true);
        try {
            const result = await global.HomeEasyWhatsApp.testMessage('');
            if (global.Swal) Swal.fire({ icon:'success', title:'Mensaje enviado', text:'La prueba llegó al WhatsApp conectado: ' + formatPhone(result.phone), confirmButtonColor:'#a6455a' });
        } catch (error) {
            if (global.Swal) Swal.fire({ icon:'error', title:'No se pudo enviar la prueba', text:error.message, confirmButtonColor:'#a6455a' });
        } finally {
            setLoading(false);
        }
    }

    async function restartSession() {
        if (loading || !global.HomeEasyWhatsApp) return;
        if (global.Swal) {
            const answer = await Swal.fire({
                icon:'question', title:'¿Reconectar WhatsApp?',
                text:'Solo reiniciaremos la sesión del servidor. Tus documentos y la configuración de HomeEasy no cambian.',
                showCancelButton:true, confirmButtonText:'Reconectar', cancelButtonText:'Cancelar', confirmButtonColor:'#a6455a'
            });
            if (!answer.isConfirmed) return;
        }
        setLoading(true);
        try {
            await global.HomeEasyWhatsApp.restart();
            await new Promise(resolve => setTimeout(resolve, 2200));
            const payload = await global.HomeEasyWhatsApp.status();
            applyStatus(payload);
        } catch (error) {
            showPanelError(error);
        } finally {
            setLoading(false);
        }
    }

    function qrImageSource(payload) {
        const qr = payload && payload.qr ? payload.qr : payload;
        if (!qr || typeof qr !== 'object') return '';
        const data = String(qr.data || '').trim();
        if (!data) return '';
        if (/^data:image\//i.test(data)) return data;
        return 'data:' + String(qr.mimetype || 'image/png') + ';base64,' + data;
    }

    async function showQr() {
        if (loading || !global.HomeEasyWhatsApp) return;
        setLoading(true);
        try {
            let payload;
            try { payload = await global.HomeEasyWhatsApp.qr(); }
            catch (error) {
                await global.HomeEasyWhatsApp.restart();
                await new Promise(resolve => setTimeout(resolve, 1800));
                payload = await global.HomeEasyWhatsApp.qr();
            }
            const src = qrImageSource(payload);
            if (!src) throw new Error('El servidor todavía no generó un QR. Intenta nuevamente en unos segundos.');
            if (global.Swal) {
                await Swal.fire({
                    title:'Vincular WhatsApp',
                    html:'<div class="he-wa-qr-wrap"><img class="he-wa-qr" src="' + src + '" alt="Código QR para vincular WhatsApp"></div><p style="margin:8px 6px 0;color:#777075;font-size:.75rem;line-height:1.5">En WhatsApp Business abre <b>Dispositivos vinculados → Vincular un dispositivo</b> y escanea este código.</p>',
                    confirmButtonText:'Ya lo escaneé', confirmButtonColor:'#a6455a', width:430
                });
                await new Promise(resolve => setTimeout(resolve, 1400));
                await loadStatus(false);
            }
        } catch (error) {
            if (global.Swal) Swal.fire({ icon:'error', title:'QR no disponible', text:error.message, confirmButtonColor:'#a6455a' });
        } finally {
            setLoading(false);
        }
    }

    function bindPanelActions(panel) {
        panel.querySelector('#heWaRefresh').addEventListener('click', () => loadStatus(true));
        panel.querySelector('#heWaTest').addEventListener('click', sendTest);
        panel.querySelector('#heWaRestart').addEventListener('click', restartSession);
        panel.querySelector('#heWaQr').addEventListener('click', showQr);
    }

    function mount() {
        installStyles();
        insertNavigation();
        insertPanel();
        if (global.location.hash === '#integraciones') showSection('integraciones');
        global.setTimeout(() => loadStatus(false), 850);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
    else mount();

    global.addEventListener('homeeasy:page-auth-ready', () => global.setTimeout(() => loadStatus(false), 120));
})(window);
