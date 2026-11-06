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
      '<button type="button" id="heHommyProfiles" class="he-hommy-ops-btn" hidden>Personalizar integrantes</button>' +
      '<button type="button" id="heHommyReplies" class="he-hommy-ops-btn" hidden>Activar respuestas internas</button>' +
      '<button type="button" id="heHommyAI" class="he-hommy-ops-btn" hidden>Activar conversación natural</button>' +
      '<button type="button" id="heHommyCommands" class="he-hommy-ops-btn">Actividad (0)</button>' +
      '<button type="button" id="heHommyDesk" class="he-hommy-ops-btn primary">Escritorio y memoria</button>' +
      '<button type="button" id="heHommyRefresh" class="he-hommy-ops-btn">Actualizar</button></div>' +
      '<div id="heHommyNote" class="he-hommy-ops-foot" role="status">Esta función no desconecta WhatsApp ni afecta los comprobantes.</div>';
    panel.appendChild(card);
    document.getElementById('heHommyToggle').addEventListener('click', toggle);
    document.getElementById('heHommyRefresh').addEventListener('click', () => load(true));
    document.getElementById('heHommyGroupLink').addEventListener('click', linkTeamGroup);
    document.getElementById('heHommyProfiles').addEventListener('click', editTeamProfiles);
    document.getElementById('heHommyGroupToggle').addEventListener('click', toggleTeamGroup);
    document.getElementById('heHommyCommands').addEventListener('click', viewTeamCommands);
    document.getElementById('heHommyDesk').addEventListener('click', openDesk);
    document.getElementById('heHommyReplies').addEventListener('click', toggleTeamReplies);
    document.getElementById('heHommyAI').addEventListener('click', toggleTeamAI);
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
      const profileButton = document.getElementById('heHommyProfiles');
      profileButton.hidden = !(teamState && teamState.configured);
      profileButton.disabled = !canConfigure();
      profileButton.textContent = 'Personalizar equipo' + (teamState && teamState.profiledMembers ?
        ' (' + teamState.profiledMembers + ')' : '');
      teamToggle.textContent = teamState && teamState.enabled ? 'Pausar grupo' : 'Activar grupo';
      const replyToggle = document.getElementById('heHommyReplies');
      replyToggle.hidden = !(teamState && teamState.enabled && teamState.replySupported === true);
      replyToggle.disabled = !canConfigure() || control.mode !== 'REVIEW';
      replyToggle.textContent = teamState && teamState.replyEnabled === true ?
        'Desactivar respuestas internas' : 'Activar respuestas internas';
      const aiToggle = document.getElementById('heHommyAI');
      aiToggle.hidden = !(teamState && teamState.enabled &&
        (teamState.aiAvailable === true || teamState.aiEnabled === true));
      aiToggle.disabled = !canConfigure() || control.mode !== 'REVIEW' ||
        (teamState.aiEnabled !== true && (teamState.aiAvailable !== true || teamState.replyEnabled !== true));
      aiToggle.textContent = teamState && teamState.aiEnabled === true ?
        'Desactivar conversación IA' : 'Activar conversación natural';
      modeEl.className = 'he-hommy-ops-status' + (control.mode === 'REVIEW' ? ' review' : '');
      modeEl.textContent = control.mode === 'REVIEW' ? 'Supervisado' : 'Pausado';
      document.getElementById('heHommyGroup').textContent =
        control.team && control.team.enabled ? 'Grupo habilitado' :
        control.team && control.team.configured ? 'Grupo listo, inactivo' : 'Grupo sin vincular';
      document.getElementById('heHommyTasks').textContent = String(control.pendingTasks || 0);
      document.getElementById('heHommyCommands').textContent = 'Actividad (' + String(control.totalTeamCommands || 0) + ')';
      toggleButton.textContent = control.mode === 'REVIEW' ? 'Pausar Hommy' : 'Reanudar supervisión';
      toggleButton.disabled = !canConfigure();
      noteEl.textContent = teamState && teamState.aiEnabled === true ?
        'Modo conversación natural del equipo. Solo lectura; las acciones comerciales siguen bajo aprobación.' :
        'Las respuestas al grupo usan el modo supervisado. El motor IA se habilita por separado y nunca autoriza envíos a clientes.';
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
        text:'No se desconectará WhatsApp ni se enviarán mensajes a clientes. La pausa apaga también las respuestas internas.',
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
        '<p style="color:#817980;font-size:11px">Confirma la identidad de cada participante antes de autorizarlo. Si aparece un ID privado (@lid), no es necesariamente su número de celular. Hommy solo registrará órdenes; no enviará mensajes.</p></div>',
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
              const rawId = String(member.id || '');
              const suffix = rawId.split('@')[0].slice(-4);
              caption.textContent = (rawId.endsWith('@lid') ? 'ID privado de WhatsApp · ' : 'Número terminado en ') +
                suffix + ' · ' + (member.role || 'participante');
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

  // Identities are assigned only by an authorized administrator to the
  // exact preapproved WhatsApp IDs; we never trust a nickname inside a chat.
  async function editTeamProfiles() {
    if (!canConfigure() || loading || !teamState || !teamState.configured ||
        !global.Swal || !global.HomeEasyWhatsApp.hommyTeamMembers) return;
    let members;
    try {
      const result = await global.HomeEasyWhatsApp.hommyTeamMembers();
      members = Array.isArray(result.members) ? result.members : [];
    } catch (e) {
      global.Swal.fire({icon:'error',title:'No se pudieron cargar los integrantes',
        text:e.message || 'Revisa el Bridge y vuelve a intentar.',confirmButtonColor:'#a6455a'});
      return;
    }
    if(!members.length) {
      global.Swal.fire({icon:'info',title:'No hay integrantes autorizados',
        text:'Vincula las cuentas del grupo antes de personalizar las respuestas.'});
      return;
    }
    const pick = (options,selected) => {
      const node=document.createElement('select');
      node.style.cssText='width:100%;padding:10px;border:1px solid #e6dfe2;border-radius:10px;background:white';
      for(const [value,label] of options) {
        const option=document.createElement('option');
        option.value=value;option.textContent=label;
        option.selected=value===selected;
        node.appendChild(option);
      }
      return node;
    };
    const result = await global.Swal.fire({
      title:'¿Cómo debe hablar Hommy con el equipo?',
      width:600,
      html:'<p style="text-align:left;font-size:13px;line-height:1.6;color:#62565d">Asigna el nombre y trato de cada cuenta autorizada. Hommy sabrá quién le habla, sin repetir el nombre o “jefe” en cada respuesta. No cambia permisos ni envía mensajes a clientes.</p>' +
        '<div id="heHommyProfileRows" style="display:grid;gap:12px;margin-top:15px;text-align:left"></div>',
      showCancelButton:true, confirmButtonText:'Guardar personalización',
      cancelButtonText:'Cancelar',confirmButtonColor:'#a6455a',
      didOpen:() => {
        const container=document.getElementById('heHommyProfileRows');
        for(const member of members) {
          const card=document.createElement('div');
          card.style.cssText='display:grid;gap:9px;padding:14px;border:1px solid #eee;border-radius:13px;background:#fbfafb';
          card.dataset.memberId=member.senderId;
          const heading=document.createElement('strong');
          heading.textContent='Cuenta autorizada ···' + String(member.senderId||'').split('@')[0].slice(-4);
          heading.style.fontSize='12px';
          const input=document.createElement('input');
          input.type='text'; input.maxLength=28;
          input.placeholder='Nombre: Ale, Daniela...';
          input.value=member.profile && member.profile.name || '';
          input.style.cssText='width:100%;padding:11px;border:1px solid #e6dfe2;border-radius:10px;box-sizing:border-box';
          input.setAttribute('aria-label','Nombre de esta cuenta autorizada');
          input.className='heHommyNickname';
          const role=pick([
            ['OWNER','Dirección / propietario'],['MANAGER','Gerencia'],['TEAM','Equipo']
          ],member.profile && member.profile.role || 'TEAM');
          role.className='heHommyMemberRole';
          const address=pick([
            ['NAME','Por su nombre (natural)'],
            ['JEFE','“Jefe” + nombre (de vez en cuando)'],
            ['NONE','Sin vocativos']
          ],member.profile && member.profile.address || 'NAME');
          address.className='heHommyMemberAddress';
          card.append(heading,input,role,address);
          container.appendChild(card);
        }
      },
      preConfirm:() => {
        const profiles={};
        const cards=document.querySelectorAll('#heHommyProfileRows [data-member-id]');
        for(const card of cards) {
          const name=card.querySelector('.heHommyNickname').value.trim();
          if(!name) continue;
          if(!/^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u.test(name) ||
              name.length<2 || name.length>28) {
            global.Swal.showValidationMessage('Usa solo letras y espacios en los nombres (de 2 a 28 caracteres).');
            return false;
          }
          profiles[card.dataset.memberId]={
            name,
            role:card.querySelector('.heHommyMemberRole').value,
            address:card.querySelector('.heHommyMemberAddress').value
          };
        }
        if(!Object.keys(profiles).length) {
          global.Swal.showValidationMessage('Escribe al menos un nombre para que Hommy pueda reconocerlo.');
          return false;
        }
        return profiles;
      }
    });
    if(!result.isConfirmed) return;
    try {
      await global.HomeEasyWhatsApp.saveHommyControl({
        team:{profiles:result.value},revision
      });
      await load(true);
      global.Swal.fire({icon:'success',title:'Equipo personalizado',
        text:'Hommy reconoce ahora los nombres configurados de estos integrantes.',
        confirmButtonColor:'#a6455a'});
    } catch (e) {
      await load(false);
      global.Swal.fire({icon:'error',title:'No se pudo guardar el equipo',
        text:e.message || 'Revisa los permisos e inténtalo de nuevo.',
        confirmButtonColor:'#a6455a'});
    }
  }

  async function openDesk() {
    if (!canConfigure() || !global.Swal ||
        !global.HomeEasyWhatsApp || !global.HomeEasyWhatsApp.hommyDesk) return;
    const api = global.HomeEasyWhatsApp;
    await global.Swal.fire({
      title: 'Escritorio de Hommy',
      width: 620,
      html: '<div style="display:grid;gap:14px;text-align:left;font-size:13px">' +
        '<section style="padding:14px;border:1px solid #eee;border-radius:14px">' +
        '<strong>Catálogo oficial</strong>' +
        '<p id="heHommyCatalogStatus" style="color:#81777d">Consultando...</p>' +
        '<input type="file" id="heHommyCatalogFile" accept="application/pdf,.pdf" style="width:100%;margin:8px 0">' +
        '<button type="button" id="heHommyCatalogUpload" class="he-hommy-ops-btn primary">Guardar PDF en su escritorio</button>' +
        '<label style="display:flex;gap:9px;align-items:flex-start;margin-top:13px"><input id="heHommyCatalogAuto" type="checkbox">' +
        '<span>Enviar el PDF automáticamente a clientes que soliciten únicamente el catálogo</span></label>' +
        '<small style="display:block;margin-top:5px;color:#81777d">Desactivado por defecto. Solo opera con solicitudes claras, sin intervención humana reciente y con control de duplicados.</small>' +
        '<small style="display:block;margin-top:8px;color:#81777d">Sube la versión oficial optimizada (máximo 12 MB). ' +
        'Se guarda en el VPS, no se hace público en Internet.</small></section>' +
        '<section style="padding:14px;border:1px solid #eee;border-radius:14px">' +
        '<strong>Bloc de notas</strong>' +
        '<p style="color:#81777d">Hommy puede usar hechos comerciales aprobados. ' +
        'La memoria de clientes es independiente; no escribas aquí datos personales ni contraseñas.</p>' +
        '<input id="heHommyNoteTopic" maxlength="70" placeholder="Tema: p. ej. garantía" ' +
        'style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:9px;margin:5px 0">' +
        '<textarea id="heHommyNoteText" maxlength="500" rows="3" ' +
        'placeholder="¿Qué debe recordar Hommy?" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:9px"></textarea>' +
        '<select id="heHommyNoteVisibility" style="width:100%;padding:10px;margin:7px 0;border:1px solid #ddd;border-radius:9px">' +
        '<option value="TEAM">Solo para el equipo</option><option value="PUBLIC">Puede usarlo para responder clientes</option></select>' +
        '<button type="button" id="heHommyNoteSave" class="he-hommy-ops-btn primary">Guardar nota aprobada</button>' +
        '<div id="heHommyDeskNotes" style="max-height:230px;overflow:auto;display:grid;gap:8px;margin-top:12px"></div></section>' +
        '<p id="heHommyDeskFeedback" role="status" style="color:#81777d"></p></div>',
      confirmButtonText: 'Cerrar',
      confirmButtonColor: '#a6455a',
      didOpen: () => {
        let editingId = '';
        let busy = false;
        const feedback = document.getElementById('heHommyDeskFeedback');
        const catalog = document.getElementById('heHommyCatalogStatus');
        const notesNode = document.getElementById('heHommyDeskNotes');
        const topic = document.getElementById('heHommyNoteTopic');
        const body = document.getElementById('heHommyNoteText');
        const visibility = document.getElementById('heHommyNoteVisibility');
        const fileInput = document.getElementById('heHommyCatalogFile');
        const uploadButton = document.getElementById('heHommyCatalogUpload');
        const autoToggle = document.getElementById('heHommyCatalogAuto');
        const saveButton = document.getElementById('heHommyNoteSave');
        const report = (message, error) => {
          feedback.textContent = message;
          feedback.style.color = error ? '#ae344f' : '#278448';
        };
        const makeButton = (label, fn) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.className = 'he-hommy-ops-btn';
          button.addEventListener('click', fn);
          return button;
        };
        async function refresh() {
          const response = await api.hommyDesk();
          const item = response && response.catalog || {};
          catalog.textContent = item.installed ?
            'Listo para enviar al grupo · ' + (item.bytes/1048576).toFixed(1) + ' MB · ' + (item.filename || '') :
            'Aún no hay un catálogo instalado en el VPS.';
          autoToggle.checked = Boolean(response.automation && response.automation.customerCatalogEnabled);
          autoToggle.disabled = !item.installed;
          notesNode.replaceChildren();
          const notes = Array.isArray(response.notes) ? response.notes : [];
          if (!notes.length) notesNode.textContent = 'Todavía no hay notas aprobadas.';
          for (const note of notes) {
            const box = document.createElement('div');
            box.style.cssText = 'padding:10px;border:1px solid #eee;border-radius:10px';
            const title = document.createElement('strong');
            title.textContent = note.topic || '';
            const text = document.createElement('p');
            text.style.cssText = 'margin:5px 0;color:#62575c;white-space:pre-wrap;overflow-wrap:anywhere';
            text.textContent = note.text || '';
            const kind = document.createElement('small');
            kind.style.cssText = 'display:block;color:#867b81;margin-bottom:5px';
            kind.textContent = note.visibility === 'PUBLIC' ? 'Visible en respuestas comerciales' : 'Solo equipo';
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
            actions.append(makeButton('Editar', () => {
              editingId = note.id;
              topic.value = note.topic || '';
              topic.disabled = true;
              body.value = note.text || '';
              visibility.value = note.visibility || 'TEAM';
              saveButton.textContent = 'Actualizar nota';
              topic.focus();
            }), makeButton('Archivar', async () => {
              if (busy || !global.confirm('¿Archivar esta nota de Hommy?')) return;
              busy = true;
              try { await api.archiveHommyDeskNote(note.id); await refresh(); report('Nota archivada.'); }
              catch(e) { report(e.message || 'No se pudo archivar.',true); }
              finally {busy = false;}
            }));
            box.append(title,text,kind,actions);
            notesNode.append(box);
          }
        }
        autoToggle.addEventListener('change', async () => {
          const enabled=autoToggle.checked;
          if (busy) {autoToggle.checked=!enabled;return;}
          if (enabled && !global.confirm(
            '¿Activar el envío automático del catálogo a clientes que lo soliciten expresamente? ' +
            'Hommy solo enviará el PDF aprobado y se retirará si detecta atención humana.')) {
            autoToggle.checked=false; return;
          }
          busy=true;autoToggle.disabled=true;
          try {
            await api.setHommyCatalogAutomation(enabled);
            await refresh();
            report(enabled ? 'Envío automático de catálogo habilitado.' :
              'Envío automático de catálogo desactivado.');
          } catch(e) {
            await refresh().catch(()=>{});
            report(e.message||'No se pudo cambiar la automatización.',true);
          } finally {busy=false;}
        });
        uploadButton.addEventListener('click', async () => {
          if (busy || !fileInput.files || !fileInput.files[0]) {
            report('Selecciona el catálogo oficial en PDF.', true); return;
          }
          busy = true; uploadButton.disabled = true;
          try {
            const file = fileInput.files[0];
            const response = await api.uploadHommyCatalog(file);
            if (!response || !response.catalog || response.catalog.installed !== true)
              throw new Error('No se confirmó la instalación.');
            await refresh();
            report('Catálogo oficial guardado. Hommy ya puede enviártelo en el grupo.');
          } catch(e) { report(e.message || 'No se pudo guardar el PDF.',true); }
          finally {busy = false; uploadButton.disabled = false;}
        });
        saveButton.addEventListener('click', async () => {
          if (busy) return;
          busy = true;saveButton.disabled=true;
          try {
            if (editingId) await api.editHommyDeskNote(editingId,body.value,visibility.value);
            else await api.saveHommyDeskNote(topic.value,body.value,visibility.value);
            topic.value='';topic.disabled=false;body.value='';visibility.value='TEAM';
            editingId='';saveButton.textContent='Guardar nota aprobada';
            await refresh();
            report('Nota guardada en la memoria persistente de Hommy.');
          } catch(e) {report(e.message || 'No se pudo guardar la nota.',true);}
          finally {busy=false;saveButton.disabled=false;}
        });
        refresh().catch(e=>report(e.message || 'No se pudo consultar el escritorio.',true));
      }
    });
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
            heading.textContent = item.status === 'REVIEW_REQUIRED' ? 'Pendiente de revisión' :
              item.status === 'AI_PENDING' ? 'Interpretando consulta' :
              item.status === 'AI_UNAVAILABLE' ? 'Motor IA no disponible' :
              item.status === 'AI_RATE_LIMITED' ? 'Límite de consultas' : 'Consulta registrada';
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

  async function toggleTeamReplies() {
    if (!canConfigure() || loading || currentMode !== 'REVIEW' ||
        !teamState || !teamState.enabled || !global.Swal) return;
    const enabled = teamState.replyEnabled !== true;
    const confirmation = await global.Swal.fire({
      icon: enabled ? 'warning' : 'question',
      title: enabled ? 'Activar respuestas informativas al equipo?' : 'Apagar las respuestas internas?',
      text: enabled ?
        'Hommy podrá contestar únicamente consultas informativas en este grupo autorizado. No podrá escribir a clientes, enviar cotizaciones ni ejecutar órdenes comerciales.' :
        'Hommy seguirá registrando instrucciones, pero dejará de responder dentro del grupo.',
      showCancelButton: true,
      confirmButtonText: enabled ? 'Activar respuestas internas' : 'Desactivar',
      cancelButtonText: 'Cancelar', confirmButtonColor: '#a6455a'
    });
    if (!confirmation.isConfirmed) return;
    loading = true;
    document.getElementById('heHommyReplies').disabled = true;
    try {
      await global.HomeEasyWhatsApp.saveHommyControl({ team:{ replyEnabled: enabled }, revision });
      loading = false;
      await load(true);
    } catch (e) {
      loading = false;
      await load(false);
      global.Swal.fire({ icon:'error', title:'No se pudo cambiar este permiso',
        text:e.message || 'Vuelve a intentar.', confirmButtonColor:'#a6455a' });
    }
  }

  async function toggleTeamAI() {
    if (!canConfigure() || loading || currentMode !== 'REVIEW' ||
        !teamState || !teamState.enabled || !global.Swal) return;
    const enabled = teamState.aiEnabled !== true;
    if (enabled && (teamState.aiAvailable !== true || teamState.replyEnabled !== true)) return;
    const confirmation = await global.Swal.fire({
      icon: enabled ? 'warning' : 'question',
      title: enabled ? 'Activar conversación natural de Hommy?' : 'Volver al modo supervisado?',
      text: enabled ?
        'Hommy consultará el motor de IA mediante una conexión de servicio protegida. Solo podrá leer resúmenes comerciales y responder en este grupo autorizado. Nunca ejecutará órdenes ni enviará mensajes a clientes.' :
        'Se apagará el motor conversacional del grupo. El Bridge y WhatsApp seguirán conectados.',
      showCancelButton: true,
      confirmButtonText: enabled ? 'Activar conversación natural' : 'Desactivar modo IA',
      cancelButtonText: 'Cancelar', confirmButtonColor: '#a6455a'
    });
    if (!confirmation.isConfirmed) return;
    loading = true;
    document.getElementById('heHommyAI').disabled = true;
    try {
      await global.HomeEasyWhatsApp.saveHommyControl({ team:{ aiEnabled: enabled }, revision });
      loading = false;
      await load(true);
    } catch (e) {
      loading = false;
      await load(false);
      global.Swal.fire({ icon:'error', title:'No se pudo actualizar el modo de Hommy',
        text:e.message || 'Vuelve a intentarlo.', confirmButtonColor:'#a6455a' });
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
  // The shared Integraciones panel emits status after it loads. Refresh Hommy too,
  // even if our optional card was mounted earlier while the panel was hidden.
  global.addEventListener('homeeasy:whatsapp-status', () => {
    mount();
    if (mounted && document.getElementById('panel-integraciones')?.classList.contains('active')) {
      load(false);
    }
  });
  // Also handle explicit navigation if the WhatsApp status request is delayed or fails.
  document.addEventListener('click', event => {
    if (!event.target?.closest?.('[data-section="integraciones"]')) return;
    Promise.resolve().then(() => {
      mount();
      if (mounted && document.getElementById('panel-integraciones')?.classList.contains('active')) {
        load(false);
      }
    });
  });
  document.addEventListener('DOMContentLoaded', mount, { once: true });
  mount();
  global.HomeEasyHommyOperationsUI = Object.freeze({ VERSION: '0.1.0' });
})(window);
