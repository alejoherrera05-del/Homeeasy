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
  let teamState = null;

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
      '<button type="button" id="heHommyGroupLink" class="he-hommy-ops-btn">Vincular grupo</button>' +
      '<button type="button" id="heHommyGroupToggle" class="he-hommy-ops-btn" hidden>Activar grupo</button>' +
      '<button type="button" id="heHommyCommands" class="he-hommy-ops-btn">Órdenes (0)</button>' +
      '<button type="button" id="heHommyRefresh" class="he-hommy-ops-btn">Actualizar</button></div>' +
      '<div id="heHommyNote" class="he-hommy-ops-foot" role="status">Esta función no desconecta WhatsApp ni afecta los comprobantes.</div>';
    panel.appendChild(card);
    document.getElementById('heHommyToggle').addEventListener('click', toggle);
    document.getElementById('heHommyRefresh').addEventListener('click', () => load(true));
    document.getElementById('heHommyGroupLink').addEventListener('click', linkTeamGroup);
    document.getElementById('heHommyGroupToggle').addEventListener('click', toggleTeamGroup);
    document.getElementById('heHommyCommands').addEventListener('click', viewTeamCommands);
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
      teamState = control.team || null;
      document.getElementById('heHommyGroupLink').disabled = !canConfigure();
      const teamToggle = document.getElementById('heHommyGroupToggle');
      teamToggle.hidden = !(teamState && teamState.configured);
      teamToggle.disabled = !canConfigure();
      teamToggle.textContent = teamState && teamState.enabled ? 'Pausar grupo' : 'Activar grupo';
      modeEl.className = 'he-hommy-ops-status' + (control.mode === 'REVIEW' ? ' review' : '');
      modeEl.textContent = control.mode === 'REVIEW' ? 'Supervisado' : 'Pausado';
      document.getElementById('heHommyGroup').textContent =
        control.team && control.team.enabled ? 'Grupo habilitado' :
        control.team && control.team.configured ? 'Grupo listo, inactivo' : 'Grupo sin vincular';
      document.getElementById('heHommyTasks').textContent = String(control.pendingTasks || 0);
      document.getElementById('heHommyCommands').textContent = 'Órdenes (' + String(control.pendingTeamCommands || 0) + ')';
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


  // The group and member identities come from read-only WAHA endpoints.
  // No group is created or mutated by this wizard.
  async function linkTeamGroup() {
    if (!canConfigure() || loading || !global.Swal) return;
    const api = global.HomeEasyWhatsApp;
    let groups;
    try {
      const payload = await api.hommyGroups();
      groups = Array.isArray(payload.groups) ? payload.groups : [];
    } catch (e) {
      global.Swal.fire({ icon:'error', title:'No se pudieron consultar los grupos',
        text:e.message || 'WhatsApp no respondió.', confirmButtonColor:'#a6455a' });
      return;
    }
    if (!groups.length) {
      global.Swal.fire({ icon:'info', title:'No hay grupos disponibles',
        text:'Crea el grupo en WhatsApp Business y regresa para vincularlo.',
        confirmButtonColor:'#a6455a' });
      return;
    }
    let loadingMembers = false;
    const result = await global.Swal.fire({
      title:'Vincular grupo de HomeEasy',
      html:'<div style="display:grid;gap:12px;text-align:left;font-size:13px">' +
        '<p>Selecciona el grupo privado y las cuentas personales que podrán darle instrucciones a Hommy.</p>' +
        '<select id="heHommyGroupSelect" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:12px"></select>' +
        '<div id="heHommyMembers" style="display:grid;gap:9px"></div>' +
        '<p style="color:#817980;font-size:11px">Hommy solo registrará las órdenes para revisión. No responderá al grupo ni a clientes todavía.</p></div>',
      showCancelButton:true, confirmButtonText:'Vincular grupo', cancelButtonText:'Cancelar',
      confirmButtonColor:'#a6455a', width:490,
      didOpen:() => {
        const select = document.getElementById('heHommyGroupSelect');
        for (const group of groups) {
          const option = document.createElement('option');
          option.value = group.id; option.textContent = group.subject || group.id;
          select.appendChild(option);
        }
        async function loadMembers() {
          const node = document.getElementById('heHommyMembers');
          node.replaceChildren();
          node.textContent = 'Consultando participantes...';
          loadingMembers = true;
          try {
            const payload = await api.hommyGroupMembers(select.value);
            if (select.value !== payload.groupId && payload.groupId) return;
            node.replaceChildren();
            const members = Array.isArray(payload.members) ? payload.members : [];
            for (const member of members) {
              const label = document.createElement('label');
              label.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #eee;border-radius:10px';
              const input = document.createElement('input');
              input.type='checkbox'; input.name='heHommyTeamMember'; input.value=member.id;
              const caption = document.createElement('span');
              const digits = String(member.id || '').split('@')[0];
              caption.textContent = 'Cuenta terminada en ' + digits.slice(-4) + ' · ' + (member.role || 'participante');
              label.append(input, caption);
              node.appendChild(label);
            }
            if (!members.length) node.textContent = 'No se pudieron identificar los participantes de este grupo.';
          } catch (e) {
            node.textContent = 'No se pudieron consultar los participantes. Prueba otro grupo.';
          } finally { loadingMembers = false; }
        }
        select.addEventListener('change', loadMembers);
        loadMembers();
      },
      preConfirm:() => {
        if (loadingMembers) { global.Swal.showValidationMessage('Estamos consultando los participantes.'); return false; }
        const groupId = document.getElementById('heHommyGroupSelect').value;
        const selected = Array.from(document.querySelectorAll('input[name="heHommyTeamMember"]:checked')).map(el => el.value);
        if (!selected.length) { global.Swal.showValidationMessage('Selecciona al menos una cuenta autorizada.'); return false; }
        return { groupId, allowedSenders:selected, enabled:true };
      }
    });
    if (!result.isConfirmed) return;
    try {
      await api.saveHommyControl({ team:result.value, revision });
      await load(true);
    } catch (e) {
      await load(false);
      global.Swal.fire({ icon:'error', title:'No se pudo vincular el grupo',
        text:e.message || 'Vuelve a intentar.', confirmButtonColor:'#a6455a' });
    }
  }

  async function viewTeamCommands() {
    if (!global.Swal || !global.HomeEasyWhatsApp.hommyWorkspace) return;
    try {
      const payload = await global.HomeEasyWhatsApp.hommyWorkspace(20);
      const commands = Array.isArray(payload.teamCommands) ? payload.teamCommands : [];
      await global.Swal.fire({
        title:'Órdenes del equipo',
        html:'<div id="heHommyCommandList" style="display:grid;gap:9px;max-height:50vh;overflow:auto;text-align:left"></div>',
        confirmButtonText:'Cerrar', confirmButtonColor:'#a6455a', width:510,
        didOpen:() => {
          const node = document.getElementById('heHommyCommandList');
          if (!commands.length) { node.textContent = 'Aún no hay órdenes del grupo registradas.'; return; }
          for (const item of commands) {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid #ede6e9;border-radius:12px;padding:12px';
            const heading = document.createElement('strong');
            heading.style.cssText = 'display:block;font-size:12px;color:#a6455a';
            heading.textContent = item.status === 'REVIEW_REQUIRED' ? 'Pendiente de revisión' : 'Consulta registrada';
            const question = document.createElement('p');
            question.style.cssText = 'font-size:12px;margin:7px 0';
            question.textContent = item.command || '';
            const preview = document.createElement('small');
            preview.style.cssText = 'font-size:11px;color:#81777d;line-height:1.4';
            preview.textContent = item.preview || '';
            card.append(heading, question, preview);
            node.appendChild(card);
          }
        }
      });
    } catch (e) {
      global.Swal.fire({ icon:'error', title:'No se pudieron consultar las órdenes',
        text:e.message || 'Vuelve a intentar.', confirmButtonColor:'#a6455a' });
    }
  }

  async function toggleTeamGroup() {
    if (!canConfigure() || loading || !teamState || !teamState.configured) return;
    try {
      await global.HomeEasyWhatsApp.saveHommyControl({ team:{ enabled: !teamState.enabled }, revision });
      await load(true);
    } catch (e) {
      await load(false);
      if (global.Swal) global.Swal.fire({ icon:'error', title:'No se pudo actualizar el grupo',
        text:e.message || 'Vuelve a intentar.', confirmButtonColor:'#a6455a' });
    }
  }

  global.addEventListener('homeeasy:page-auth-ready', mount);
  global.addEventListener('homeeasy:whatsapp-status', mount);
  document.addEventListener('DOMContentLoaded', mount, { once: true });
  mount();
  global.HomeEasyHommyOperationsUI = Object.freeze({ VERSION: '0.1.0' });
})(window);
