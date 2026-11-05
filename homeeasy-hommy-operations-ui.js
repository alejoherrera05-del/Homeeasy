/**
 * HomeEasy Hommy Operations UI · isolated optional card in Configuración > Integraciones.
 * Never modifies the Hommy chat, login, WAHA session or global styles.
 */
(function (global) {
  'use strict';
  if ((global.location.pathname.split('/').pop() || '').toLowerCase() !== 'configuracion.html') return;

  const ID = 'heHommyOperations';
  const STYLE_ID = 'heHommyOperationsStyles';
  let mounted = false;
  let loading = false;
  let revision = null;
  let currentMode = '';

  function canConfigure() {
    return Boolean(global.HomeEasyAuth && typeof global.HomeEasyAuth.hasPermission === 'function' &&
      (global.HomeEasyAuth.hasPermission('config.write') || global.HomeEasyAuth.hasPermission('*')));
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.he-hommy-ops{margin-top:15px;overflow:hidden}' +
      '.he-hommy-ops-head{padding:20px 21px 13px;display:flex;align-items:center;gap:12px}' +
      '.he-hommy-ops-mark{width:41px;height:41px;flex:none;display:grid;place-items:center;border-radius:13px;background:rgba(166,69,90,.08);color:#a6455a}' +
      '.he-hommy-ops-title{min-width:0;flex:1}' +
      '.he-hommy-ops-title strong{display:block;font-size:.88rem;color:#302b2e}' +
      '.he-hommy-ops-title span{display:block;margin-top:4px;font-size:.64rem;color:#8d8388;line-height:1.5}' +
      '.he-hommy-ops-status{font-size:.62rem;font-weight:720;border-radius:999px;padding:7px 10px;background:#f4f2f3;color:#756e72;white-space:nowrap}' +
      '.he-hommy-ops-status.review{background:rgba(52,199,89,.10);color:#278448}' +
      '.he-hommy-ops-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:0 21px 15px}' +
      '.he-hommy-ops-item{background:#f8f7f8;border-radius:14px;padding:12px;min-width:0}' +
      '.he-hommy-ops-item b{display:block;font-size:.76rem;color:#393238;font-weight:740}' +
      '.he-hommy-ops-item small{display:block;margin-top:5px;font-size:.59rem;line-height:1.4;color:#978e93}' +
      '.he-hommy-ops-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 21px 19px}' +
      '.he-hommy-ops-btn{min-height:42px;border:1px solid rgba(60,60,67,.11);background:white;border-radius:12px;padding:0 14px;color:#4c4348;font-size:.68rem;font-weight:720}' +
      '.he-hommy-ops-btn.primary{background:#a6455a;color:#fff;border-color:#a6455a}' +
      '.he-hommy-ops-btn:disabled{opacity:.55;cursor:default}' +
      '.he-hommy-ops-foot{padding:0 21px 17px;color:#8d8589;font-size:.58rem;line-height:1.55}' +
      '@media(max-width:700px){.he-hommy-ops-head{padding:16px;flex-wrap:wrap}.he-hommy-ops-grid{padding:0 16px 14px}.he-hommy-ops-actions{padding:0 16px 15px}.he-hommy-ops-foot{padding:0 16px 16px}}';
    document.head.appendChild(style);
  }

  function mount() {
    if (mounted) return;
    if (global.HomeEasyPageGuard && global.HomeEasyPageGuard.getStatus() !== 'authorized') return;
    const panel = document.getElementById('panel-integraciones');
    if (!panel || !global.HomeEasyWhatsApp) return;
    addStyles();
    const card = document.createElement('section');
    card.className = 'he-wa-card he-hommy-ops';
    card.id = ID;
    card.innerHTML = '<div class="he-hommy-ops-head">' +
      '<div class="he-hommy-ops-mark"><i class="fa-solid fa-robot" aria-hidden="true"></i></div>' +
      '<div class="he-hommy-ops-title"><strong>Hommy · Atención comercial</strong>' +
      '<span>Control independiente para las conversaciones de clientes y el equipo.</span></div>' +
      '<span class="he-hommy-ops-status" id="heHommyMode">Consultando</span></div>' +
      '<div class="he-hommy-ops-grid">' +
      '<div class="he-hommy-ops-item"><b id="heHommyGroup">Grupo sin vincular</b><small>Equipo autorizado</small></div>' +
      '<div class="he-hommy-ops-item"><b id="heHommyTasks">—</b><small>Tareas pendientes</small></div>' +
      '</div><div class="he-hommy-ops-actions">' +
      '<button type="button" id="heHommyToggle" class="he-hommy-ops-btn primary" disabled>Pausar Hommy</button>' +
      '<button type="button" id="heHommyRefresh" class="he-hommy-ops-btn">Actualizar</button></div>' +
      '<div id="heHommyNote" class="he-hommy-ops-foot" role="status">Esta función no desconecta WhatsApp ni afecta los comprobantes.</div>';
    panel.appendChild(card);
    document.getElementById('heHommyToggle').addEventListener('click', toggle);
    document.getElementById('heHommyRefresh').addEventListener('click', () => load(true));
    mounted = true;
    if (panel.classList.contains('active')) load(false);
  }

  async function load(notify) {
    if (!mounted || loading || !global.HomeEasyWhatsApp.hommyControl) return;
    loading = true;
    const toggleButton = document.getElementById('heHommyToggle');
    toggleButton.disabled = true;
    const modeEl = document.getElementById('heHommyMode');
    const noteEl = document.getElementById('heHommyNote');
    try {
      const payload = await global.HomeEasyWhatsApp.hommyControl();
      const control = payload && payload.control || {};
      revision = control.revision;
      currentMode = control.mode;
      modeEl.className = 'he-hommy-ops-status' + (control.mode === 'REVIEW' ? ' review' : '');
      modeEl.textContent = control.mode === 'REVIEW' ? 'Supervisado' : 'Pausado';
      document.getElementById('heHommyGroup').textContent =
        control.team && control.team.enabled ? 'Grupo habilitado' :
        control.team && control.team.configured ? 'Grupo listo, inactivo' : 'Grupo sin vincular';
      document.getElementById('heHommyTasks').textContent = String(control.pendingTasks || 0);
      toggleButton.textContent = control.mode === 'REVIEW' ? 'Pausar Hommy' : 'Reanudar supervisión';
      toggleButton.disabled = !canConfigure();
      noteEl.textContent = 'El interruptor controla solo la inteligencia comercial. WhatsApp, pedidos, recibos y Pentagrama siguen disponibles.';
      if (notify && global.Swal) global.Swal.fire({ toast:true, position:'top-end', timer:1500,
        showConfirmButton:false, icon:'success', title:'Estado de Hommy actualizado' });
    } catch (e) {
      modeEl.textContent = 'No disponible';
      noteEl.textContent = 'No se pudo consultar este módulo. El resto de HomeEasy sigue funcionando.';
      toggleButton.disabled = true;
    } finally {
      loading = false;
    }
  }

  async function toggle() {
    if (!canConfigure() || loading || !['REVIEW', 'PAUSED'].includes(currentMode)) return;
    const mode = currentMode === 'REVIEW' ? 'PAUSED' : 'REVIEW';
    if (global.Swal) {
      const confirmation = await global.Swal.fire({
        icon:'question', title: mode === 'PAUSED' ? 'Pausar la atención de Hommy?' : 'Reanudar Hommy supervisado?',
        text:'No se desconectará WhatsApp. No se enviarán mensajes automáticos.',
        showCancelButton:true, confirmButtonText:mode === 'PAUSED'?'Pausar':'Reanudar',
        cancelButtonText:'Cancelar', confirmButtonColor:'#a6455a'
      });
      if (!confirmation.isConfirmed) return;
    }
    loading = true;
    document.getElementById('heHommyToggle').disabled = true;
    try {
      await global.HomeEasyWhatsApp.saveHommyControl({ mode, revision });
      loading = false;
      await load(true);
    } catch (e) {
      loading = false;
      await load(false);
      if (global.Swal) global.Swal.fire({icon:'error',title:'No se pudo cambiar el modo',
        text:e.message || 'Vuelve a intentar.',confirmButtonColor:'#a6455a'});
    }
  }

  global.addEventListener('homeeasy:page-auth-ready', mount);
  global.addEventListener('homeeasy:whatsapp-status', mount);
  document.addEventListener('DOMContentLoaded', mount, { once: true });
  mount();
  global.HomeEasyHommyOperationsUI = Object.freeze({ VERSION: '0.1.0' });
})(window);
