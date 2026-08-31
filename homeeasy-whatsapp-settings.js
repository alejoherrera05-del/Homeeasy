/**
 * HomeEasy WhatsApp Settings v0.3.0
 * Centro de control de WhatsApp: estado, actividad, plantillas, pruebas y recuperación.
 *
 * Reglas:
 * - Solo se monta después de homeeasy:page-auth-ready.
 * - No consulta WhatsApp hasta que el usuario abre Integraciones.
 * - WhatsApp nunca renueva, cierra ni modifica la sesión principal de HomeEasy.
 * - No existe acción de "desconectar" en la interfaz ordinaria.
 */
(function (global) {
    'use strict';

    if (((global.location.pathname.split('/').pop() || '').toLowerCase()) !== 'configuracion.html') return;

    const VERSION = '0.3.0';
    const REQUIRED_BRIDGE = '0.5.0';
    const STYLE_ID = 'homeeasyWhatsappSettingsStyle';
    const PANEL_ID = 'panel-integraciones';
    const TEMPLATE_LABELS = Object.freeze({
        cotizacion: ['Cotización', 'Mensaje que acompaña una cotización nueva.'],
        pedido: ['Orden de pedido', 'Confirmación y revisión de la orden del cliente.'],
        abono: ['Recibo de abono', 'Incluye valor, OP y estado del saldo.'],
        reenvio: ['Reenvío de documento', 'Mensaje usado desde Clientes o Historial de ventas.']
    });
    const FALLBACK_VARIABLES = Object.freeze({
        cotizacion: ['{nombre}', '{numero}'],
        pedido: ['{nombre}', '{numero}'],
        abono: ['{nombre}', '{numero}', '{op}', '{valor}', '{estado_saldo}'],
        reenvio: ['{nombre}', '{documento}']
    });

    let mounted = false;
    let loading = false;
    let loadedOnce = false;
    let state = { status: null, activity: [], templates: null };

    const clean = value => String(value == null ? '' : value).trim();

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function installStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .he-wa-center{display:grid;gap:15px}
            .he-wa-card{overflow:hidden;border:1px solid rgba(60,60,67,.09);border-radius:24px;background:#fff;box-shadow:0 12px 34px rgba(44,34,38,.05)}
            .he-wa-hero{padding:22px;background:linear-gradient(145deg,#fff 0%,#fcf8f9 100%)}
            .he-wa-hero-top{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:15px;align-items:center}
            .he-wa-logo{width:56px;height:56px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(145deg,#33d368,#20b858);color:#fff;font-size:27px;box-shadow:0 11px 24px rgba(32,184,88,.20),inset 0 1px 0 rgba(255,255,255,.34)}
            .he-wa-eyebrow{color:#91898d;font-size:.60rem;font-weight:780;letter-spacing:.10em;text-transform:uppercase}.he-wa-title{margin:4px 0 0;color:#2b2729;font-size:1.18rem;line-height:1.15;font-weight:770;letter-spacing:-.03em}.he-wa-description{margin:6px 0 0;color:#7f777b;font-size:.73rem;line-height:1.48;font-weight:520}
            .he-wa-chip{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:0 11px;border-radius:999px;border:1px solid rgba(60,60,67,.08);background:#f5f3f4;color:#787175;font-size:.63rem;font-weight:780;white-space:nowrap}.he-wa-chip::before{content:'';width:7px;height:7px;border-radius:50%;background:#a8a3a6}.he-wa-chip.ready{background:rgba(52,199,89,.09);border-color:rgba(52,199,89,.18);color:#268642}.he-wa-chip.ready::before{background:#34c759;box-shadow:0 0 0 4px rgba(52,199,89,.09)}.he-wa-chip.busy{background:rgba(194,164,104,.11);border-color:rgba(194,164,104,.22);color:#8e7138}.he-wa-chip.busy::before{background:#c2a468}.he-wa-chip.error{background:rgba(255,59,48,.075);border-color:rgba(255,59,48,.16);color:#b33d37}.he-wa-chip.error::before{background:#ff3b30}
            .he-wa-path{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:20px}.he-wa-path-step{min-height:55px;padding:10px 12px;border-radius:15px;background:#f7f6f7;border:1px solid rgba(60,60,67,.06);display:flex;align-items:center;gap:9px;color:#817a7e}.he-wa-path-dot{width:23px;height:23px;flex:0 0 23px;border-radius:50%;display:grid;place-items:center;background:#e7e4e5;color:#8d878a;font-size:10px}.he-wa-path-copy b{display:block;color:#514b4e;font-size:.68rem;font-weight:720}.he-wa-path-copy span{display:block;margin-top:2px;font-size:.56rem;font-weight:540}.he-wa-path-step.ok{background:rgba(52,199,89,.055);border-color:rgba(52,199,89,.12)}.he-wa-path-step.ok .he-wa-path-dot{background:#34c759;color:#fff}.he-wa-path-step.ok .he-wa-path-copy b{color:#267d3e}.he-wa-path-step.warn{background:rgba(194,164,104,.08);border-color:rgba(194,164,104,.16)}.he-wa-path-step.warn .he-wa-path-dot{background:#c2a468;color:#fff}.he-wa-path-step.error{background:rgba(255,59,48,.05);border-color:rgba(255,59,48,.12)}.he-wa-path-step.error .he-wa-path-dot{background:#ff3b30;color:#fff}
            .he-wa-details{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:16px;border-top:1px solid rgba(60,60,67,.07)}.he-wa-detail{padding:14px 12px 0 0;min-width:0}.he-wa-label{display:block;color:#aaa3a7;font-size:.56rem;font-weight:760;text-transform:uppercase;letter-spacing:.075em}.he-wa-value{display:block;margin-top:5px;color:#3b3539;font-size:.72rem;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            .he-wa-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.he-wa-button{min-height:43px;padding:0 14px;border:1px solid rgba(60,60,67,.10);border-radius:13px;background:#fff;color:#514a4e;font-size:.68rem;font-weight:700;box-shadow:0 4px 12px rgba(44,34,38,.03);transition:.14s ease}.he-wa-button i{margin-right:7px;color:#a6455a}.he-wa-button.primary{border-color:#a6455a;background:#a6455a;color:#fff;box-shadow:0 7px 17px rgba(166,69,90,.18)}.he-wa-button.primary i{color:#fff}.he-wa-button.whatsapp{border-color:rgba(37,211,102,.25);background:rgba(37,211,102,.08);color:#178746}.he-wa-button.whatsapp i{color:#20aa56}.he-wa-button:disabled{opacity:.52;cursor:wait}.he-wa-button:active{transform:scale(.97)}
            .he-wa-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:19px 21px 13px}.he-wa-section-head h3{margin:0;color:#302b2e;font-size:.88rem;font-weight:750;letter-spacing:-.015em}.he-wa-section-head p{margin:4px 0 0;color:#918a8e;font-size:.62rem;line-height:1.4}.he-wa-link{border:0;background:transparent;color:#a6455a;font-size:.63rem;font-weight:720;padding:6px 0}
            .he-wa-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:0 21px 17px}.he-wa-stat{padding:13px;border-radius:15px;background:#f8f7f8;border:1px solid rgba(60,60,67,.055)}.he-wa-stat span{display:block;color:#999296;font-size:.55rem;font-weight:720;text-transform:uppercase;letter-spacing:.055em}.he-wa-stat strong{display:block;margin-top:4px;color:#312c2f;font-size:1.15rem;line-height:1;font-weight:760;letter-spacing:-.035em}.he-wa-stat.error strong{color:#bd403b}
            .he-wa-activity{border-top:1px solid rgba(60,60,67,.06)}.he-wa-activity-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:11px;align-items:center;min-height:62px;padding:9px 21px;border-bottom:1px solid rgba(60,60,67,.055)}.he-wa-activity-row:last-child{border-bottom:0}.he-wa-activity-icon{width:35px;height:35px;border-radius:11px;display:grid;place-items:center;background:#f4f1f2;color:#a6455a;font-size:13px}.he-wa-activity-icon.ok{background:rgba(52,199,89,.09);color:#249044}.he-wa-activity-icon.error{background:rgba(255,59,48,.07);color:#c5423b}.he-wa-activity-icon.warn{background:rgba(194,164,104,.11);color:#99783d}.he-wa-activity-main{min-width:0}.he-wa-activity-main b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3c363a;font-size:.68rem;font-weight:690}.he-wa-activity-main span{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#999296;font-size:.58rem}.he-wa-activity-time{text-align:right;color:#918a8e;font-size:.58rem;font-weight:600;white-space:nowrap}.he-wa-empty{padding:22px;text-align:center;color:#999296;font-size:.65rem}
            .he-wa-template-list{padding:0 13px 14px}.he-wa-template-row{width:100%;min-height:62px;border:0;border-top:1px solid rgba(60,60,67,.055);background:#fff;display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:11px;align-items:center;padding:8px 8px;text-align:left}.he-wa-template-row:first-child{border-top:0}.he-wa-template-icon{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:rgba(166,69,90,.075);color:#a6455a;font-size:13px}.he-wa-template-copy b{display:block;color:#3b3539;font-size:.69rem;font-weight:700}.he-wa-template-copy span{display:block;margin-top:3px;color:#9a9397;font-size:.58rem;line-height:1.35}.he-wa-template-row>i{color:#b3adb0;font-size:11px}
            .he-wa-security{padding:18px 21px}.he-wa-security-top{display:flex;gap:12px;align-items:flex-start}.he-wa-shield{width:42px;height:42px;flex:0 0 42px;border-radius:13px;display:grid;place-items:center;background:rgba(194,164,104,.12);color:#ad8843}.he-wa-security h3{margin:1px 0 4px;color:#3a3437;font-size:.78rem;font-weight:730}.he-wa-security p{margin:0;color:#8e878b;font-size:.62rem;line-height:1.5}.he-wa-access{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.he-wa-access span{padding:6px 9px;border-radius:999px;background:#f6f4f5;color:#746d71;font-size:.56rem;font-weight:680}.he-wa-tech{margin-top:13px;border-top:1px solid rgba(60,60,67,.06);padding-top:11px}.he-wa-tech summary{cursor:pointer;color:#827a7e;font-size:.60rem;font-weight:690}.he-wa-tech-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:10px}.he-wa-tech-item{padding:9px 10px;border-radius:11px;background:#f8f7f8}.he-wa-tech-item span{display:block;color:#aaa3a7;font-size:.51rem;text-transform:uppercase;font-weight:730}.he-wa-tech-item b{display:block;margin-top:3px;color:#4b4548;font-size:.60rem;font-weight:650;word-break:break-word}.he-wa-note{display:flex;align-items:flex-start;gap:10px;padding:14px 15px;border:1px solid rgba(194,164,104,.18);border-radius:16px;background:rgba(194,164,104,.075);color:#77684d;font-size:.63rem;line-height:1.5}.he-wa-note i{margin-top:2px;color:#b89550}.he-wa-note strong{color:#65583f}.he-wa-qr-wrap{display:grid;place-items:center;padding:8px}.he-wa-qr{display:block;width:min(290px,78vw);height:auto;border-radius:14px;border:10px solid #fff;box-shadow:0 14px 38px rgba(0,0,0,.11)}
            .he-wa-editor{display:grid;gap:10px;text-align:left}.he-wa-editor textarea{width:100%;min-height:240px;resize:vertical;border:1px solid #e2dcdf;border-radius:14px;padding:12px;font:500 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#393337;background:#fbfafb;outline:none}.he-wa-editor textarea:focus{border-color:rgba(166,69,90,.45);box-shadow:0 0 0 3px rgba(166,69,90,.07)}.he-wa-vars{display:flex;flex-wrap:wrap;gap:6px}.he-wa-var{border:1px solid #e5dfe2;border-radius:999px;background:#fff;color:#a6455a;padding:6px 8px;font-size:10px;font-weight:680}.he-wa-editor-preview{padding:11px 12px;border-radius:13px;background:#f5f4f5;color:#5d565a;font-size:11px;line-height:1.45;white-space:pre-wrap;max-height:180px;overflow:auto}
            @media(any-hover:hover) and (any-pointer:fine){.he-wa-button:hover:not(:disabled){transform:translateY(-1px);border-color:rgba(166,69,90,.22)}.he-wa-template-row:hover{background:#fbf9fa}}
            @media(max-width:700px){.he-wa-hero{padding:18px 16px}.he-wa-hero-top{grid-template-columns:auto minmax(0,1fr)}.he-wa-chip{grid-column:1/-1;width:max-content}.he-wa-path{grid-template-columns:1fr}.he-wa-details{grid-template-columns:1fr 1fr}.he-wa-actions{display:grid;grid-template-columns:1fr 1fr}.he-wa-button{width:100%;padding:0 9px}.he-wa-button.primary{grid-column:1/-1}.he-wa-section-head{padding:17px 16px 12px}.he-wa-stats{grid-template-columns:1fr 1fr;padding:0 16px 15px}.he-wa-activity-row{padding-left:16px;padding-right:16px}.he-wa-security{padding:17px 16px}.he-wa-tech-grid{grid-template-columns:1fr 1fr}}
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
            button.addEventListener('click', openIntegrations);
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
            button.addEventListener('click', openIntegrations);
        }
    }

    function panelHtml() {
        return `
            <div class="page-heading"><h2>Integraciones</h2><p>Servicios conectados a HomeEasy para automatizar tareas sin salir de la aplicación.</p></div>
            <div class="he-wa-center">
                <section class="he-wa-card he-wa-hero">
                    <div class="he-wa-hero-top"><div class="he-wa-logo" aria-hidden="true"><i class="fa-brands fa-whatsapp"></i></div><div><span class="he-wa-eyebrow">Centro de WhatsApp</span><h3 class="he-wa-title">WhatsApp HomeEasy</h3><p class="he-wa-description" id="heWaDescription">Comprueba el canal, revisa envíos y administra los mensajes que recibe el cliente.</p></div><span class="he-wa-chip" id="heWaChip">Sin comprobar</span></div>
                    <div class="he-wa-path"><div class="he-wa-path-step" id="heWaStepHome"><span class="he-wa-path-dot"><i class="fa-solid fa-user-shield"></i></span><span class="he-wa-path-copy"><b>HomeEasy</b><span>Sesión autorizada</span></span></div><div class="he-wa-path-step" id="heWaStepBridge"><span class="he-wa-path-dot"><i class="fa-solid fa-server"></i></span><span class="he-wa-path-copy"><b>Servidor</b><span>Bridge seguro</span></span></div><div class="he-wa-path-step" id="heWaStepWhatsapp"><span class="he-wa-path-dot"><i class="fa-brands fa-whatsapp"></i></span><span class="he-wa-path-copy"><b>WhatsApp</b><span>Canal de documentos</span></span></div></div>
                    <div class="he-wa-details"><div class="he-wa-detail"><span class="he-wa-label">Cuenta</span><span class="he-wa-value" id="heWaAccount">—</span></div><div class="he-wa-detail"><span class="he-wa-label">Número</span><span class="he-wa-value" id="heWaPhone">—</span></div><div class="he-wa-detail"><span class="he-wa-label">Bridge</span><span class="he-wa-value" id="heWaBridge">—</span></div><div class="he-wa-detail"><span class="he-wa-label">Última comprobación</span><span class="he-wa-value" id="heWaChecked">—</span></div></div>
                    <div class="he-wa-actions"><button type="button" class="he-wa-button primary" id="heWaRefresh"><i class="fa-solid fa-arrows-rotate"></i>Probar conexión</button><button type="button" class="he-wa-button whatsapp" id="heWaTestMessage" hidden><i class="fa-regular fa-paper-plane"></i>Mensaje de prueba</button><button type="button" class="he-wa-button whatsapp" id="heWaTestPdf" hidden><i class="fa-regular fa-file-pdf"></i>PDF de prueba</button><button type="button" class="he-wa-button" id="heWaRestart" hidden><i class="fa-solid fa-rotate"></i>Reconectar</button><button type="button" class="he-wa-button" id="heWaQr" hidden><i class="fa-solid fa-qrcode"></i>Mostrar QR</button></div>
                </section>
                <section class="he-wa-card"><div class="he-wa-section-head"><div><h3>Actividad de envíos</h3><p>Lo que HomeEasy ha enviado por este canal.</p></div><button type="button" class="he-wa-link" id="heWaHistory">Ver historial</button></div><div class="he-wa-stats"><div class="he-wa-stat"><span>Hoy</span><strong id="heWaToday">0</strong></div><div class="he-wa-stat"><span>Cotizaciones</span><strong id="heWaQuotes">0</strong></div><div class="he-wa-stat"><span>Órdenes</span><strong id="heWaOrders">0</strong></div><div class="he-wa-stat"><span>Abonos</span><strong id="heWaPayments">0</strong></div><div class="he-wa-stat error"><span>Errores</span><strong id="heWaErrors">0</strong></div></div><div class="he-wa-activity" id="heWaActivity"><div class="he-wa-empty">Abre Integraciones para cargar la actividad.</div></div></section>
                <section class="he-wa-card"><div class="he-wa-section-head"><div><h3>Mensajes automáticos</h3><p>Edita una vez y HomeEasy usará la plantilla en los próximos envíos.</p></div><button type="button" class="he-wa-link" id="heWaResetTemplates">Restaurar</button></div><div class="he-wa-template-list" id="heWaTemplates"></div></section>
                <section class="he-wa-card he-wa-security"><div class="he-wa-security-top"><div class="he-wa-shield"><i class="fa-solid fa-shield-halved"></i></div><div><h3>Seguridad y acceso</h3><p>WhatsApp está aislado de la sesión principal. Los envíos respetan los permisos que cada usuario ya tiene en HomeEasy.</p></div></div><div class="he-wa-access" id="heWaAccess"><span>Esperando comprobación</span></div><details class="he-wa-tech"><summary>Detalles técnicos</summary><div class="he-wa-tech-grid"><div class="he-wa-tech-item"><span>Sesión</span><b id="heWaTechSession">homeeasy</b></div><div class="he-wa-tech-item"><span>Motor</span><b id="heWaTechEngine">WEBJS</b></div><div class="he-wa-tech-item"><span>Versión Bridge</span><b id="heWaTechBridge">—</b></div><div class="he-wa-tech-item"><span>Usuario</span><b id="heWaTechActor">—</b></div></div></details></section>
                <div class="he-wa-note"><i class="fa-solid fa-shield-halved"></i><div><strong>Aislado de tu sesión.</strong> Si WhatsApp falla, HomeEasy seguirá funcionando. Este centro no renueva, cierra ni modifica tu sesión principal y no incluye un botón de desconexión accidental.</div></div>
            </div>`;
    }

    function insertPanel() {
        if (document.getElementById(PANEL_ID)) return;
        const content = document.querySelector('.content');
        if (!content) return;
        const panel = document.createElement('div'); panel.className = 'panel'; panel.id = PANEL_ID; panel.dataset.panel = 'integraciones'; panel.innerHTML = panelHtml();
        const before = document.getElementById('panel-restauraciones'); content.insertBefore(panel, before || null); bindPanelActions(panel); renderTemplates();
    }

    function activateSection(section) { document.querySelectorAll('[data-section]').forEach(button => button.classList.toggle('active', button.dataset.section === section)); document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === section)); try { history.replaceState(null, '', '#' + section); } catch (error) {} try { global.scrollTo({ top: 0, behavior: 'smooth' }); } catch (error) {} }
    function openIntegrations() { activateSection('integraciones'); loadCenter(loadedOnce); }
    function formatPhone(value) { const digits = String(value || '').replace(/\D/g, ''); if (/^57\d{10}$/.test(digits)) return '+57 ' + digits.slice(2,5) + ' ' + digits.slice(5,8) + ' ' + digits.slice(8); return digits ? '+' + digits : '—'; }
    function nowLabel(withSeconds) { try { return new Intl.DateTimeFormat('es-CO', withSeconds ? { hour:'numeric', minute:'2-digit', second:'2-digit' } : { hour:'numeric', minute:'2-digit' }).format(new Date()); } catch (error) { return new Date().toLocaleTimeString(); } }

    function setLoading(value) { loading = Boolean(value); ['heWaRefresh','heWaTestMessage','heWaTestPdf','heWaRestart','heWaQr','heWaHistory','heWaResetTemplates'].forEach(id => { const button = document.getElementById(id); if (button) button.disabled = loading; }); if (loading) { const chip = document.getElementById('heWaChip'); if (chip) { chip.className = 'he-wa-chip busy'; chip.textContent = 'Comprobando'; } } }
    function setPath(id, status) { const node = document.getElementById(id); if (!node) return; node.classList.remove('ok','warn','error'); if (status) node.classList.add(status); }

    function applyStatus(payload) {
        state.status = payload || null;
        const whatsapp = payload && payload.whatsapp ? payload.whatsapp : {}; const bridge = payload && payload.bridge ? payload.bridge : {}; const actor = payload && payload.actor ? payload.actor : {}; const caps = payload && payload.capabilities ? payload.capabilities : {};
        const ready = whatsapp.ready === true && String(whatsapp.status || '').toUpperCase() === 'WORKING'; const status = String(whatsapp.status || 'UNKNOWN').toUpperCase(); const me = whatsapp.me || {}; const bridgeVersion = clean(bridge.version);
        const chip = document.getElementById('heWaChip'); const description = document.getElementById('heWaDescription');
        if (chip) { chip.className = 'he-wa-chip ' + (ready ? 'ready' : (status === 'STARTING' || status === 'SCAN_QR_CODE' ? 'busy' : 'error')); chip.textContent = ready ? 'Operativo' : (status === 'STARTING' ? 'Conectando' : (status === 'SCAN_QR_CODE' ? 'Vincular' : 'Requiere atención')); }
        if (description) description.textContent = ready ? 'Todo está listo para enviar cotizaciones, órdenes y recibos desde HomeEasy.' : (status === 'SCAN_QR_CODE' ? 'WhatsApp necesita vinculación. El resto de HomeEasy continúa funcionando.' : 'El canal de WhatsApp requiere atención; HomeEasy continúa funcionando normalmente.');
        setPath('heWaStepHome', payload && payload.actor ? 'ok' : 'error'); setPath('heWaStepBridge', bridgeVersion ? (bridgeVersion === REQUIRED_BRIDGE ? 'ok' : 'warn') : 'warn'); setPath('heWaStepWhatsapp', ready ? 'ok' : (status === 'STARTING' || status === 'SCAN_QR_CODE' ? 'warn' : 'error'));
        const connected = global.HomeEasyWhatsApp ? global.HomeEasyWhatsApp.connectedPhone(payload) : '';
        const values = { heWaAccount:String(me.pushName || me.name || (ready ? 'HomeEasy' : '—')), heWaPhone:formatPhone(connected), heWaBridge:bridgeVersion ? 'v' + bridgeVersion : 'Actualización pendiente', heWaChecked:nowLabel(true), heWaTechSession:String(whatsapp.name || 'homeeasy'), heWaTechEngine:String(whatsapp.engine || 'WEBJS'), heWaTechBridge:bridgeVersion ? 'v' + bridgeVersion + (bridge.storage ? ' · almacenamiento ' + bridge.storage : '') : 'Anterior a v' + REQUIRED_BRIDGE, heWaTechActor:String(actor.nombre || actor.email || actor.rol || '—') };
        Object.entries(values).forEach(([id,value]) => { const node = document.getElementById(id); if (node) node.textContent = value; });
        const restart = document.getElementById('heWaRestart'); const qr = document.getElementById('heWaQr'); const testMessage = document.getElementById('heWaTestMessage'); const testPdf = document.getElementById('heWaTestPdf'); if (restart) restart.hidden = ready; if (qr) qr.hidden = ready || !['SCAN_QR_CODE','FAILED','MISSING','STOPPED','STARTING'].includes(status); if (testMessage) testMessage.hidden = !ready; if (testPdf) testPdf.hidden = !ready;
        const access = document.getElementById('heWaAccess'); if (access) { const labels = []; if (actor.rol) labels.push('Rol: ' + actor.rol); if (caps.sendCotizacion) labels.push('Cotizaciones'); if (caps.sendPedido) labels.push('Órdenes'); if (caps.sendAbono) labels.push('Abonos'); if (caps.configure) labels.push('Configuración'); access.innerHTML = (labels.length ? labels : ['Sesión autorizada']).map(label => '<span>' + escapeHtml(label) + '</span>').join(''); }
    }

    function showStatusError(error) { state.status = null; const chip = document.getElementById('heWaChip'); const description = document.getElementById('heWaDescription'); const checked = document.getElementById('heWaChecked'); if (chip) { chip.className = 'he-wa-chip error'; chip.textContent = 'Sin respuesta'; } if (description) description.textContent = (error && error.message ? error.message : 'No fue posible comprobar WhatsApp.') + ' Tu sesión de HomeEasy no fue modificada.'; if (checked) checked.textContent = nowLabel(false); setPath('heWaStepHome','warn'); setPath('heWaStepBridge','error'); setPath('heWaStepWhatsapp','error'); ['heWaTestMessage','heWaTestPdf','heWaRestart','heWaQr'].forEach(id => { const node = document.getElementById(id); if (node) node.hidden = true; }); }
    function isToday(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return false; const now = new Date(); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate(); }
    function activityTypeLabel(item) { if (item.kind === 'test') return item.filename ? 'Prueba de PDF' : 'Prueba de mensaje'; if (item.documentType === 'cotizacion') return 'Cotización'; if (item.documentType === 'pedido') return 'Orden de pedido'; if (item.documentType === 'abono') return 'Recibo de abono'; return 'WhatsApp'; }
    function activityState(item) { const status = clean(item.state).toUpperCase(); if (status === 'SENT') return ['ok','Enviado']; if (status === 'FAILED') return ['error','Error']; if (status === 'UNKNOWN' || status === 'SENDING') return ['warn','Por confirmar']; return ['','Registrado']; }
    function activityIcon(item) { if (item.kind === 'test') return item.filename ? 'fa-regular fa-file-pdf' : 'fa-regular fa-paper-plane'; if (item.documentType === 'cotizacion') return 'fa-regular fa-file-lines'; if (item.documentType === 'pedido') return 'fa-solid fa-clipboard-list'; if (item.documentType === 'abono') return 'fa-solid fa-receipt'; return 'fa-brands fa-whatsapp'; }

    function renderActivity() {
        const items = Array.isArray(state.activity) ? state.activity : []; const todayDocs = items.filter(item => item.kind === 'document' && isToday(item.at)); const sentToday = todayDocs.filter(item => clean(item.state).toUpperCase() === 'SENT'); const errorsToday = todayDocs.filter(item => clean(item.state).toUpperCase() === 'FAILED'); const quotes = sentToday.filter(item => item.documentType === 'cotizacion').length; const orders = sentToday.filter(item => item.documentType === 'pedido').length; const payments = sentToday.filter(item => item.documentType === 'abono').length;
        const values = { heWaToday:sentToday.length, heWaQuotes:quotes, heWaOrders:orders, heWaPayments:payments, heWaErrors:errorsToday.length }; Object.entries(values).forEach(([id,value]) => { const node = document.getElementById(id); if (node) node.textContent = String(value); });
        const container = document.getElementById('heWaActivity'); if (!container) return; if (!items.length) { container.innerHTML = '<div class="he-wa-empty">Todavía no hay envíos registrados en este Bridge.</div>'; return; }
        container.innerHTML = items.slice(0,5).map(item => { const [cls,label] = activityState(item); const date = new Date(item.at); const time = Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'}); const detail = [clean(item.reference),clean(item.clientName),label].filter(Boolean).join(' · '); return `<div class="he-wa-activity-row"><div class="he-wa-activity-icon ${cls}"><i class="${activityIcon(item)}"></i></div><div class="he-wa-activity-main"><b>${escapeHtml(activityTypeLabel(item))}${item.resend ? ' · Reenvío' : ''}</b><span>${escapeHtml(detail || item.filename || 'Movimiento de WhatsApp')}</span></div><div class="he-wa-activity-time">${escapeHtml(time)}</div></div>`; }).join('');
    }

    function renderTemplates() {
        const container = document.getElementById('heWaTemplates'); if (!container) return; const templateData = state.templates && state.templates.templates ? state.templates.templates : {};
        container.innerHTML = Object.entries(TEMPLATE_LABELS).map(([key,[title,desc]]) => `<button type="button" class="he-wa-template-row" data-template="${key}"><span class="he-wa-template-icon"><i class="${key === 'abono' ? 'fa-solid fa-receipt' : key === 'reenvio' ? 'fa-solid fa-rotate-right' : key === 'pedido' ? 'fa-solid fa-clipboard-list' : 'fa-regular fa-file-lines'}"></i></span><span class="he-wa-template-copy"><b>${escapeHtml(title)}</b><span>${escapeHtml(templateData[key] ? desc : desc + ' · Cargando…')}</span></span><i class="fa-solid fa-chevron-right"></i></button>`).join('');
        container.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => editTemplate(button.dataset.template)));
    }

    async function loadCenter(showFeedback) {
        if (loading || !global.HomeEasyWhatsApp) return; setLoading(true); let statusOk = false;
        try { const payload = await global.HomeEasyWhatsApp.status(); applyStatus(payload); statusOk = true; } catch (error) { showStatusError(error); }
        if (statusOk) {
            const [activityResult,templateResult] = await Promise.allSettled([global.HomeEasyWhatsApp.activity ? global.HomeEasyWhatsApp.activity(80) : Promise.reject(new Error('Actividad no disponible')),global.HomeEasyWhatsApp.getTemplates ? global.HomeEasyWhatsApp.getTemplates() : Promise.reject(new Error('Plantillas no disponibles'))]);
            if (activityResult.status === 'fulfilled') state.activity = Array.isArray(activityResult.value.items) ? activityResult.value.items : []; else state.activity = []; if (templateResult.status === 'fulfilled') state.templates = templateResult.value; renderActivity(); renderTemplates();
            const bridgeVersion = clean(state.status && state.status.bridge && state.status.bridge.version); if (bridgeVersion && bridgeVersion !== REQUIRED_BRIDGE && global.Swal) Swal.fire({toast:true,position:'top-end',icon:'info',title:'Actualización de WhatsApp pendiente',text:'El servidor debe quedar en v' + REQUIRED_BRIDGE + ' para usar actividad y plantillas.',showConfirmButton:false,timer:3200}); else if (showFeedback && global.Swal) Swal.fire({toast:true,position:'top-end',icon:'success',title:'WhatsApp comprobado',showConfirmButton:false,timer:1600});
        }
        loadedOnce = true; setLoading(false);
    }

    function templateExample(key) { return { nombre:'Daniela', numero:key === 'pedido' ? 'OP-097' : key === 'abono' ? 'N.º 036' : 'COT-184', op:'OP-097', valor:'$450.000', estado_saldo:'*Saldo pendiente: $700.000*', documento:'tu *Orden de Pedido OP-097*' }; }
    function renderTemplatePreview(template,key) { const vars = templateExample(key); return clean(template).replace(/\{([a-z_]+)\}/gi,(match,name) => Object.prototype.hasOwnProperty.call(vars,name) ? vars[name] : match); }

    async function editTemplate(key) {
        if (!global.Swal) return; const payload = state.templates || {}; const current = payload.templates && payload.templates[key] ? payload.templates[key] : ''; const original = payload.defaults && payload.defaults[key] ? payload.defaults[key] : current; const variables = payload.variables && payload.variables[key] ? payload.variables[key] : (FALLBACK_VARIABLES[key] || []); const meta = TEMPLATE_LABELS[key] || [key,''];
        const result = await Swal.fire({ title:meta[0], html:'<div class="he-wa-editor"><div class="he-wa-vars" id="heWaEditorVars"></div><textarea id="heWaEditorText" maxlength="1000"></textarea><div class="he-wa-editor-preview" id="heWaEditorPreview"></div></div>', showCancelButton:true, showDenyButton:true, confirmButtonText:'Guardar cambios', denyButtonText:'Restaurar original', cancelButtonText:'Cancelar', confirmButtonColor:'#a6455a', denyButtonColor:'#c2a468', didOpen:() => { const textarea = document.getElementById('heWaEditorText'); const preview = document.getElementById('heWaEditorPreview'); const vars = document.getElementById('heWaEditorVars'); textarea.value = current; const update = () => { preview.textContent = renderTemplatePreview(textarea.value,key); }; vars.innerHTML = variables.map(variable => '<button type="button" class="he-wa-var">' + escapeHtml(variable) + '</button>').join(''); vars.querySelectorAll('.he-wa-var').forEach(button => button.addEventListener('click',() => { const start = textarea.selectionStart || textarea.value.length; const end = textarea.selectionEnd || textarea.value.length; textarea.value = textarea.value.slice(0,start) + button.textContent + textarea.value.slice(end); textarea.focus(); textarea.selectionStart = textarea.selectionEnd = start + button.textContent.length; update(); })); textarea.addEventListener('input',update); update(); }, preConfirm:() => { const value = clean(document.getElementById('heWaEditorText').value); if (value.length < 10) { Swal.showValidationMessage('La plantilla es demasiado corta.'); return false; } return value; } });
        if (result.isDismissed) return; if (!global.HomeEasyWhatsApp || !global.HomeEasyWhatsApp.saveTemplates) return;
        try { const next = { ...(payload.templates || {}) }; next[key] = result.isDenied ? original : result.value; state.templates = await global.HomeEasyWhatsApp.saveTemplates(next); renderTemplates(); Swal.fire({toast:true,position:'top-end',icon:'success',title:result.isDenied ? 'Plantilla restaurada' : 'Plantilla guardada',showConfirmButton:false,timer:1700}); } catch (error) { Swal.fire({icon:'error',title:'No se pudo guardar',text:error.message || 'WhatsApp no respondió.',confirmButtonColor:'#a6455a'}); }
    }

    async function resetAllTemplates() { if (!global.Swal || !global.HomeEasyWhatsApp || !global.HomeEasyWhatsApp.resetTemplates) return; const confirm = await Swal.fire({icon:'question',title:'¿Restaurar los mensajes?',text:'Las cuatro plantillas volverán al texto oficial de HomeEasy.',showCancelButton:true,confirmButtonText:'Sí, restaurar',cancelButtonText:'Cancelar',confirmButtonColor:'#a6455a'}); if (!confirm.isConfirmed) return; try { state.templates = await global.HomeEasyWhatsApp.resetTemplates(); renderTemplates(); Swal.fire({toast:true,position:'top-end',icon:'success',title:'Mensajes restaurados',showConfirmButton:false,timer:1700}); } catch (error) { Swal.fire({icon:'error',title:'No se pudo restaurar',text:error.message || '',confirmButtonColor:'#a6455a'}); } }

    async function askTestPhone(title,help) { if (!global.Swal) return null; const result = await Swal.fire({title,text:help,input:'tel',inputPlaceholder:'Ej. 333 123 4567',showCancelButton:true,confirmButtonText:'Enviar prueba',cancelButtonText:'Cancelar',confirmButtonColor:'#25D366',inputValidator:value => { let number = clean(value).replace(/\D/g,''); if (/^3\d{9}$/.test(number)) number = '57' + number; if (!/^\d{8,15}$/.test(number)) return 'Escribe un número de WhatsApp válido.'; return undefined; }}); if (!result.isConfirmed) return null; let number = clean(result.value).replace(/\D/g,''); if (/^3\d{9}$/.test(number)) number = '57' + number; return number; }
    async function sendTest(kind) { if (loading || !global.HomeEasyWhatsApp) return; const isPdf = kind === 'pdf'; const phone = await askTestPhone(isPdf ? 'Enviar PDF de prueba' : 'Enviar mensaje de prueba',isPdf ? 'HomeEasy enviará un PDF técnico pequeño al número que indiques.' : 'HomeEasy enviará un mensaje corto al número que indiques.'); if (!phone) return; setLoading(true); try { if (isPdf) await global.HomeEasyWhatsApp.testDocument(phone); else await global.HomeEasyWhatsApp.testMessage(phone); if (global.Swal) Swal.fire({icon:'success',title:isPdf ? 'PDF enviado' : 'Mensaje enviado',text:'La prueba salió correctamente desde HomeEasy.',confirmButtonColor:'#a6455a'}); try { const activity = await global.HomeEasyWhatsApp.activity(80); state.activity = Array.isArray(activity.items) ? activity.items : []; renderActivity(); } catch (_) {} } catch (error) { if (global.Swal) Swal.fire({icon:'error',title:'No se pudo enviar',text:error.message || 'WhatsApp no respondió.',confirmButtonColor:'#a6455a'}); } finally { setLoading(false); } }
    async function restartSession() { if (loading || !global.HomeEasyWhatsApp) return; setLoading(true); try { await global.HomeEasyWhatsApp.restart(); await new Promise(resolve => global.setTimeout(resolve,1200)); } catch (error) { if (global.Swal) Swal.fire({icon:'error',title:'No se pudo reconectar',text:error.message || '',confirmButtonColor:'#a6455a'}); } finally { setLoading(false); } loadCenter(false); }
    async function showQr() { if (loading || !global.HomeEasyWhatsApp) return; setLoading(true); try { const payload = await global.HomeEasyWhatsApp.qr(); const qr = payload && payload.qr ? payload.qr : {}; const raw = String(qr.data || qr.value || qr.qr || ''); const src = raw.startsWith('data:image/') ? raw : (raw ? 'data:image/png;base64,' + raw : ''); if (!src) throw new Error('El QR todavía no está disponible.'); if (global.Swal) await Swal.fire({title:'Vincular WhatsApp',html:'<div class="he-wa-qr-wrap"><img class="he-wa-qr" src="' + src.replace(/"/g,'&quot;') + '" alt="Código QR de WhatsApp"></div><p style="font-size:.72rem;color:#7f777b">Escanéalo desde WhatsApp → Dispositivos vinculados.</p>',confirmButtonText:'Cerrar',confirmButtonColor:'#a6455a'}); } catch (error) { if (global.Swal) Swal.fire({icon:'info',title:'QR no disponible',text:error.message || '',confirmButtonColor:'#a6455a'}); } finally { setLoading(false); } }

    function showHistory() { if (!global.Swal) return; const items = Array.isArray(state.activity) ? state.activity : []; const html = items.length ? '<div style="max-height:55vh;overflow:auto;text-align:left">' + items.map(item => { const [,label] = activityState(item); const date = new Date(item.at); const when = Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'numeric',minute:'2-digit'}); return '<div style="padding:10px 4px;border-bottom:1px solid #eee"><b style="font-size:12px">' + escapeHtml(activityTypeLabel(item) + (item.resend ? ' · Reenvío' : '')) + '</b><div style="margin-top:3px;color:#777;font-size:11px">' + escapeHtml([item.reference,item.clientName,label].filter(Boolean).join(' · ')) + '</div><div style="margin-top:3px;color:#aaa;font-size:10px">' + escapeHtml(when) + '</div></div>'; }).join('') + '</div>' : '<p style="color:#888;font-size:13px">Todavía no hay actividad registrada.</p>'; Swal.fire({title:'Historial de WhatsApp',html,confirmButtonText:'Cerrar',confirmButtonColor:'#a6455a',width:520}); }

    function bindPanelActions(panel) { panel.querySelector('#heWaRefresh').addEventListener('click',() => loadCenter(true)); panel.querySelector('#heWaTestMessage').addEventListener('click',() => sendTest('message')); panel.querySelector('#heWaTestPdf').addEventListener('click',() => sendTest('pdf')); panel.querySelector('#heWaRestart').addEventListener('click',restartSession); panel.querySelector('#heWaQr').addEventListener('click',showQr); panel.querySelector('#heWaHistory').addEventListener('click',showHistory); panel.querySelector('#heWaResetTemplates').addEventListener('click',resetAllTemplates); }
    function mountAfterAuthorization() { if (mounted) return; mounted = true; installStyles(); insertNavigation(); insertPanel(); if (global.location.hash === '#integraciones') global.setTimeout(openIntegrations,80); }
    global.addEventListener('homeeasy:page-auth-ready',event => { const detail = event && event.detail ? event.detail : {}; if (detail.page && String(detail.page).toLowerCase() !== 'configuracion.html') return; mountAfterAuthorization(); },{once:true});
    global.HomeEasyWhatsAppSettings = Object.freeze({ VERSION });
})(window);
