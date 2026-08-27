/**
 * HomeEasy Settings Auth UI v3.2
 * Sustituye la identidad manual por la sesión autenticada y añade Mi perfil / Usuarios y roles.
 */
(function (global) {
    'use strict';
    const page = (global.location.pathname.split('/').pop() || '').toLowerCase();
    if (page !== 'configuracion.html') return;

    const STYLE_ID = 'homeeasy-settings-auth-ui-style';
    let mounted = false;
    let profile = null;
    let rolesPayload = null;
    let selectedRole = 'COMERCIAL';
    let privateDocConfig = {};

    function can(permission) {
        return Boolean(auth() && typeof auth().hasPermission === 'function' && auth().hasPermission(permission));
    }

    function roleNames() {
        const fromServer = rolesPayload && Array.isArray(rolesPayload.roles)
            ? rolesPayload.roles.filter(r => !r.protegido).map(r => String(r.rol || '').toUpperCase()).filter(Boolean)
            : [];
        return fromServer.length ? fromServer : ['ADMINISTRADOR','COMERCIAL','CAJA','OPERACIONES','CONSULTA'];
    }

    function roleOptions(selected) {
        return roleNames().map(r => `<option value="${esc(r)}" ${r===String(selected||'').toUpperCase()?'selected':''}>${esc(r)}</option>`).join('');
    }

    function esc(value) {
        return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
    }
    function isAdmin(p) { return p && ['PROPIETARIO','ADMINISTRADOR'].includes(String(p.rol || '').toUpperCase()); }
    function auth() { return global.HomeEasyAuth; }
    function core() { return global.HomeEasyCore; }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .operator-box{display:none!important}.he-legacy-operator-field{display:none!important}
            .he-profile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.he-profile-hero{display:flex;align-items:center;gap:15px;padding:18px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(135deg,rgba(166,69,90,.06),rgba(194,164,104,.07));margin-bottom:16px}.he-profile-avatar{width:58px;height:58px;flex:0 0 58px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(145deg,#b75a70,#a6455a 58%,#823646);color:white;font-size:.92rem;font-weight:800}.he-profile-copy{min-width:0}.he-profile-name{font-size:1rem;font-weight:800;color:var(--text)}.he-profile-email{margin-top:4px;color:var(--muted);font-size:.68rem;overflow:hidden;text-overflow:ellipsis}.he-role-pill{display:inline-flex;margin-top:8px;padding:5px 8px;border-radius:999px;background:var(--soft-gold);color:#8a6d37;font-size:.57rem;font-weight:800;letter-spacing:.06em}.he-info-tile{padding:14px;border:1px solid var(--line);border-radius:15px;background:#fbfbfb}.he-info-tile span{display:block;color:var(--muted);font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.45px}.he-info-tile strong{display:block;margin-top:5px;color:var(--text);font-size:.76rem;line-height:1.35}.he-profile-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}.he-auth-btn{min-height:42px;padding:0 13px;border:1px solid rgba(166,69,90,.18);border-radius:12px;background:#fff;color:var(--home-red);font-size:.68rem;font-weight:800}.he-auth-btn.primary{background:var(--home-red);color:#fff;border-color:transparent}.he-auth-btn.danger{color:#bd364c}
            .he-users-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.he-users-toolbar-copy strong{display:block;font-size:.8rem}.he-users-toolbar-copy span{display:block;margin-top:3px;color:var(--muted);font-size:.63rem;line-height:1.4}.he-users-list{border:1px solid var(--line);border-radius:17px;overflow:hidden;background:#fff}.he-user-row{display:grid;grid-template-columns:minmax(170px,1.35fr) 135px 105px minmax(125px,.8fr) auto;gap:10px;align-items:center;padding:13px 14px;border-bottom:1px solid var(--line)}.he-user-row:last-child{border-bottom:0}.he-user-main{min-width:0}.he-user-main strong{display:block;font-size:.72rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.he-user-main span{display:block;margin-top:3px;color:var(--muted);font-size:.58rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.he-user-role,.he-user-status{width:100%;min-height:38px;border:1px solid var(--line);border-radius:10px;background:#fbfbfb;padding:0 9px;font-size:.63rem;font-weight:700;color:var(--text)}.he-user-actions{display:flex;gap:6px}.he-user-presence{min-width:0}.he-presence-line{display:flex;align-items:center;gap:6px;color:#5f595d;font-size:.59rem;font-weight:650}.he-presence-dot{width:7px;height:7px;border-radius:50%;background:#b7b2b5}.he-presence-line.online{color:#278548}.he-presence-line.online .he-presence-dot{background:#34c759;box-shadow:0 0 0 4px rgba(52,199,89,.10)}.he-last-seen{display:block;margin-top:4px;color:var(--muted);font-size:.52rem;line-height:1.35}.he-user-save{min-height:36px;border:0;border-radius:10px;padding:0 10px;background:var(--soft-wine);color:var(--home-red);font-size:.6rem;font-weight:800}.he-user-save:disabled,.he-user-role:disabled,.he-user-status:disabled{opacity:.48}.he-owner-badge{display:inline-flex;margin-top:5px;padding:3px 6px;border-radius:999px;background:rgba(194,164,104,.12);color:#8a6d37;font-size:.48rem;font-weight:800}.he-users-empty{padding:30px 18px;text-align:center;color:var(--muted);font-size:.68rem;line-height:1.5}.he-invite-form{display:grid;grid-template-columns:1fr 1.25fr 150px auto;gap:9px;align-items:end;margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:16px;background:#fbfbfb}.he-invite-field label{display:block;margin-bottom:6px;color:var(--muted);font-size:.55rem;font-weight:800;text-transform:uppercase}.he-invite-field input,.he-invite-field select{width:100%;height:40px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:0 10px;font-size:.67rem}.he-invite-submit{height:40px;border:0;border-radius:10px;background:var(--home-red);color:white;padding:0 12px;font-size:.64rem;font-weight:800}
            .he-role-editor{display:grid;grid-template-columns:190px minmax(0,1fr);gap:14px}.he-role-list{display:flex;flex-direction:column;gap:7px}.he-role-tab{width:100%;min-height:42px;border:1px solid var(--line);border-radius:12px;background:#fff;color:#615b5f;text-align:left;padding:0 12px;font-size:.65rem;font-weight:750}.he-role-tab.active{background:var(--soft-wine);border-color:rgba(166,69,90,.20);color:var(--home-red)}.he-role-tab.protected{color:#8a6d37}.he-role-permission-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}.he-role-permission-head strong{font-size:.82rem}.he-role-permission-head span{display:block;margin-top:3px;color:var(--muted);font-size:.61rem;line-height:1.45}.he-permission-groups{display:flex;flex-direction:column;gap:10px}.he-permission-group{border:1px solid var(--line);border-radius:14px;background:#fbfbfb;overflow:hidden}.he-permission-group-title{padding:10px 12px;background:#f6f3f4;color:#675f64;font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.he-permission-row{display:grid;grid-template-columns:24px minmax(0,1fr);gap:10px;align-items:flex-start;padding:10px 12px;border-top:1px solid var(--line);cursor:pointer}.he-permission-row:first-of-type{border-top:0}.he-permission-row input{width:18px;height:18px;margin:1px 0 0;accent-color:var(--home-red)}.he-permission-copy strong{display:block;font-size:.66rem;color:var(--text)}.he-permission-copy span{display:block;margin-top:3px;color:var(--muted);font-size:.56rem;line-height:1.4}.he-role-save-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:13px}.he-role-save-note{color:var(--muted);font-size:.57rem;line-height:1.4}.he-role-save{min-height:42px;border:0;border-radius:12px;background:var(--home-red);color:#fff;padding:0 15px;font-size:.66rem;font-weight:800}.he-role-save:disabled{opacity:.46}.he-private-card{margin-top:14px}.he-private-section{padding:14px 0;border-top:1px solid var(--line)}.he-private-section:first-of-type{border-top:0}.he-private-section h4{margin:0 0 10px;color:#635b60;font-size:.62rem;text-transform:uppercase;letter-spacing:.06em}.he-private-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.he-private-field.full{grid-column:1/-1}.he-private-field label{display:block;margin:0 0 6px;color:var(--muted);font-size:.56rem;font-weight:800;text-transform:uppercase}.he-private-field input,.he-private-field textarea{width:100%;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--text);font-size:16px;padding:0 10px;outline:none}.he-private-field input{height:42px}.he-private-field textarea{min-height:72px;padding:10px;resize:vertical;line-height:1.4}.he-private-field input:focus,.he-private-field textarea:focus{border-color:rgba(166,69,90,.35);box-shadow:0 0 0 3px rgba(166,69,90,.07)}.he-private-actions{display:flex;justify-content:flex-end;margin-top:12px}.he-private-save{min-height:42px;border:0;border-radius:12px;background:var(--home-red);color:#fff;padding:0 14px;font-size:.66rem;font-weight:800}.he-private-save:disabled{opacity:.48}
            @media(max-width:900px){.he-role-editor{grid-template-columns:1fr}.he-role-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}}
            @media(max-width:760px){.he-profile-grid{grid-template-columns:1fr}.he-user-row{grid-template-columns:1fr 1fr}.he-user-main{grid-column:1/-1}.he-invite-form{grid-template-columns:1fr}.he-users-toolbar{align-items:flex-start}.he-profile-actions{display:grid;grid-template-columns:1fr}.he-auth-btn{width:100%}}
            @media(max-width:760px){.he-private-grid{grid-template-columns:1fr}.he-private-field.full{grid-column:auto}.he-role-save-row{align-items:stretch;flex-direction:column}.he-role-save{width:100%}}
        `;
        document.head.appendChild(style);
    }

    function initials(p) {
        const parts = String(p && p.nombre || '').trim().split(/\s+/).filter(Boolean);
        return parts.length > 1 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : (parts[0] || 'HE').slice(0,2).toUpperCase();
    }

    function addNav(section, label, icon, adminOnly) {
        if (adminOnly && !isAdmin(profile)) return;
        const side = document.querySelector('.side-nav');
        const mobile = document.querySelector('.mobile-tabs');
        if (side && !side.querySelector(`[data-section="${section}"]`)) {
            const b = document.createElement('button'); b.className='nav-button'; b.dataset.section=section; b.innerHTML=`<i class="${icon}"></i> ${label}`; b.addEventListener('click',()=>activate(section)); side.appendChild(b);
        }
        if (mobile && !mobile.querySelector(`[data-section="${section}"]`)) {
            const b = document.createElement('button'); b.className='mobile-tab'; b.dataset.section=section; b.textContent=label; b.addEventListener('click',()=>activate(section)); mobile.appendChild(b);
        }
    }

    function activate(section) {
        document.querySelectorAll('[data-panel]').forEach(p=>p.classList.toggle('active',p.dataset.panel===section));
        document.querySelectorAll('.nav-button,.mobile-tab').forEach(b=>b.classList.toggle('active',b.dataset.section===section));
        try { history.replaceState(null,'',section==='empresa'?'configuracion.html':`configuracion.html?section=${encodeURIComponent(section)}`); } catch(e) {}
        if (section==='usuarios') loadUsers();
        if (section==='roles') loadRoles();
    }

    function profilePanel() {
        const device = core() && core().getDeviceInfo ? core().getDeviceInfo() : {};
        const panel = document.createElement('div'); panel.className='panel'; panel.id='panel-perfil'; panel.dataset.panel='perfil';
        panel.innerHTML = `<div class="page-heading"><h2>Mi perfil</h2><p>Tu identidad y sesión actual de HomeEasy.</p></div><div class="card"><div class="he-profile-hero"><div class="he-profile-avatar">${esc(initials(profile))}</div><div class="he-profile-copy"><div class="he-profile-name">${esc(profile.nombre || 'Usuario HomeEasy')}</div><div class="he-profile-email">${esc(profile.email || '')}</div><div class="he-role-pill">${esc(profile.rol || 'USUARIO')}</div></div></div><div class="he-profile-grid"><div class="he-info-tile"><span>Estado</span><strong>${esc(profile.estado || 'ACTIVO')}</strong></div><div class="he-info-tile"><span>Correo verificado</span><strong>${profile.emailVerificado ? 'Sí' : 'Pendiente'}</strong></div><div class="he-info-tile"><span>Dispositivo</span><strong>${esc(device.name || 'Este dispositivo')}</strong></div><div class="he-info-tile"><span>Plataforma</span><strong>${esc([device.platform,device.browser].filter(Boolean).join(' · '))}</strong></div></div><div class="he-profile-actions"><button class="he-auth-btn primary" id="heChangePassword"><i class="fa-solid fa-key"></i> Cambiar contraseña</button><button class="he-auth-btn" id="heRenameDevice"><i class="fa-solid fa-laptop"></i> Renombrar dispositivo</button><button class="he-auth-btn danger" id="heLogoutProfile"><i class="fa-solid fa-arrow-right-from-bracket"></i> Cerrar sesión</button></div></div>`;
        panel.querySelector('#heChangePassword').addEventListener('click', changePassword);
        panel.querySelector('#heRenameDevice').addEventListener('click', renameDevice);
        panel.querySelector('#heLogoutProfile').addEventListener('click', logout);
        return panel;
    }

    function usersPanel() {
        const panel=document.createElement('div'); panel.className='panel'; panel.id='panel-usuarios'; panel.dataset.panel='usuarios';
        panel.innerHTML=`<div class="page-heading"><h2>Usuarios</h2><p>Invita personas, revisa quién está conectado y asigna uno de los roles configurados.</p></div><div class="card"><div class="he-users-toolbar"><div class="he-users-toolbar-copy"><strong>Equipo HomeEasy</strong><span>El rol Propietario está protegido. Los permisos de cada rol se administran en “Roles y permisos”.</span></div><button class="refresh-button" id="heRefreshUsers"><i class="fa-solid fa-rotate"></i> Actualizar</button></div><div class="he-users-list" id="heUsersList"><div class="he-users-empty"><i class="fa-solid fa-circle-notch fa-spin"></i><br>Cargando usuarios…</div></div><div class="he-invite-form"><div class="he-invite-field"><label>Nombre</label><input id="heInviteName" maxlength="120" placeholder="Nombre completo"></div><div class="he-invite-field"><label>Correo</label><input id="heInviteEmail" type="email" maxlength="180" placeholder="usuario@correo.com"></div><div class="he-invite-field"><label>Rol</label><select id="heInviteRole">${roleOptions('COMERCIAL')}</select></div><button class="he-invite-submit" id="heInviteSubmit">Crear invitación</button></div></div>`;
        panel.querySelector('#heRefreshUsers').addEventListener('click',loadUsers);
        panel.querySelector('#heInviteSubmit').addEventListener('click',inviteUser);
        return panel;
    }

    function rolesPanel() {
        const panel=document.createElement('div'); panel.className='panel'; panel.id='panel-roles'; panel.dataset.panel='roles';
        panel.innerHTML=`<div class="page-heading"><h2>Roles y permisos</h2><p>Define con precisión qué puede consultar o modificar cada rol. Los permisos se aplican en el Cerebro, no solo en la interfaz.</p></div><div class="card"><div class="he-role-editor"><div class="he-role-list" id="heRoleList"><div class="he-users-empty">Cargando roles…</div></div><div><div id="heRolePermissionArea"><div class="he-users-empty"><i class="fa-solid fa-circle-notch fa-spin"></i><br>Cargando permisos…</div></div></div></div></div>`;
        return panel;
    }

    const permissionDependencies={
        'clientes.write':['clientes.read'],'cotizaciones.write':['cotizaciones.read'],'pedidos.write':['pedidos.read'],
        'abonos.write':['abonos.read'],'caja.write':['caja.read'],'agenda.write':['agenda.read'],'reportes.write':['reportes.read'],
        'documentos.write':['documentos.read'],'config.write':['config.read'],'inventario.manage':['inventario.read','documentos.read'],
        'restauraciones.execute':['restauraciones.read','config.read'],
        'usuarios.manage':['config.read'],'roles.manage':['config.read'],'auditoria.read':['config.read'],
        'inventario.read':['config.read'],'anulaciones.execute':['config.read'],'restauraciones.read':['config.read'],
        'seguridad.manage':['config.read'],'sistema.read':['config.read']
    };

    function renderRoleEditor() {
        const list=document.getElementById('heRoleList'), area=document.getElementById('heRolePermissionArea');
        if(!list||!area||!rolesPayload)return;
        const roles=Array.isArray(rolesPayload.roles)?rolesPayload.roles:[];
        if(!roles.some(r=>r.rol===selectedRole))selectedRole=(roles.find(r=>!r.protegido)||roles[0]||{}).rol||'COMERCIAL';
        list.innerHTML=roles.map(r=>`<button type="button" class="he-role-tab ${r.rol===selectedRole?'active':''} ${r.protegido?'protected':''}" data-role="${esc(r.rol)}">${r.protegido?'<i class="fa-solid fa-crown"></i> ':''}${esc(r.rol)}</button>`).join('');
        list.querySelectorAll('.he-role-tab').forEach(b=>b.addEventListener('click',()=>{selectedRole=b.dataset.role;renderRoleEditor()}));
        const role=roles.find(r=>r.rol===selectedRole)||roles[0]; if(!role)return;
        const catalog=Array.isArray(rolesPayload.catalogo)?rolesPayload.catalogo:[], groups={};
        catalog.forEach(item=>{const module=item.modulo||'Otros';(groups[module]||(groups[module]=[])).push(item)});
        const permissions=new Set(role.protegido?catalog.map(x=>x.id):(role.permisos||[]));
        const groupsHtml=Object.keys(groups).map(module=>`<section class="he-permission-group"><div class="he-permission-group-title">${esc(module)}</div>${groups[module].map(item=>`<label class="he-permission-row"><input type="checkbox" data-permission="${esc(item.id)}" ${permissions.has(item.id)?'checked':''} ${role.protegido?'disabled':''}><span class="he-permission-copy"><strong>${esc(item.accion)}</strong><span>${esc(item.descripcion||'')}</span></span></label>`).join('')}</section>`).join('');
        area.innerHTML=`<div class="he-role-permission-head"><div><strong>${esc(role.rol)}</strong><span>${role.protegido?'Acceso total permanente. La cuenta propietaria no puede degradarse.':'Marca únicamente las acciones que este rol debe poder realizar.'}</span></div></div><div class="he-permission-groups">${groupsHtml}</div><div class="he-role-save-row"><span class="he-role-save-note">Los cambios revocan las sesiones abiertas de usuarios con este rol.</span><button type="button" class="he-role-save" id="heSaveRole" ${role.protegido?'disabled':''}>${role.protegido?'Protegido':'Guardar permisos'}</button></div>`;
        area.querySelectorAll('[data-permission]').forEach(input=>input.addEventListener('change',()=>syncPermissionDependencies(input,area)));
        const save=area.querySelector('#heSaveRole'); if(save&&!role.protegido)save.addEventListener('click',()=>saveRolePermissions(role,save));
    }

    function syncPermissionDependencies(input,area){
        const id=input.dataset.permission;
        if(input.checked){(permissionDependencies[id]||[]).forEach(dep=>{const el=area.querySelector(`[data-permission="${dep}"]`);if(el)el.checked=true})}
        else Object.keys(permissionDependencies).forEach(writer=>{if((permissionDependencies[writer]||[]).includes(id)){const el=area.querySelector(`[data-permission="${writer}"]`);if(el)el.checked=false}});
    }

    async function loadRoles(){
        if(!can('roles.manage'))return;
        const area=document.getElementById('heRolePermissionArea'); if(area&&!rolesPayload)area.innerHTML='<div class="he-users-empty"><i class="fa-solid fa-circle-notch fa-spin"></i><br>Cargando permisos…</div>';
        try{const res=await request('AUTH_LISTAR_ROLES_PERMISOS');if(!res||res.status!=='success'||!Array.isArray(res.roles))throw new Error(res&&res.msg||'No se pudieron cargar los roles.');rolesPayload=res;renderRoleEditor();refreshRoleSelects();}
        catch(e){if(area)area.innerHTML=`<div class="he-users-empty"><strong>No se pudieron cargar los roles</strong><br>${esc(e.message)}</div>`}
    }

    function refreshRoleSelects(){
        document.querySelectorAll('.he-user-role').forEach(select=>{const current=select.value;select.innerHTML=roleOptions(current)});
        const invite=document.getElementById('heInviteRole');if(invite){const current=invite.value||'COMERCIAL';invite.innerHTML=roleOptions(current);if(roleNames().includes(current))invite.value=current}
    }

    async function saveRolePermissions(role,button){
        const area=document.getElementById('heRolePermissionArea');
        const permissions=Array.from(area.querySelectorAll('[data-permission]:checked')).map(el=>el.dataset.permission);
        button.disabled=true;const old=button.textContent;button.textContent='Guardando…';
        try{const res=await request('AUTH_GUARDAR_ROL_PERMISOS',{rol:role.rol,permisos:permissions});if(!res||res.status!=='success')throw new Error(res&&res.msg||'No se pudieron guardar los permisos.');
            if(res.requiereNuevoLogin){await Swal.fire({icon:'success',title:'Permisos actualizados',text:'Tu propio rol cambió. Debes iniciar sesión nuevamente.',confirmButtonColor:'#a6455a'});await logout();return;}
            await loadRoles();notify('Permisos guardados. Se revocaron '+Number(res.sesionesRevocadas||0)+' sesión(es) del rol.',true);
        }catch(e){notify(e.message,false)}finally{button.disabled=false;button.textContent=old}
    }

    function privateAccountCard(){
        const card=document.createElement('div');card.className='card he-private-card';card.id='hePrivateAccountCard';
        const disabled=can('config.write')?'':'disabled';
        card.innerHTML=`<div class="card-header"><div><h3>Cuenta de cobro</h3><p>Estos son los datos reales usados por Documentos y por la vista previa. Al guardarlos, cambian la plantilla emitida.</p></div><div class="card-icon"><i class="fa-solid fa-file-invoice-dollar"></i></div></div>
        <div class="he-private-section"><h4>Representante y firma</h4><div class="he-private-grid"><div class="he-private-field"><label>Nombre</label><input ${disabled} data-he-private-key="documentos.propietaria.nombre"></div><div class="he-private-field"><label>Documento</label><input ${disabled} data-he-private-key="documentos.propietaria.documento"></div><div class="he-private-field full"><label>Calidad / cargo</label><input ${disabled} data-he-private-key="documentos.firma.cargo_documento"></div><div class="he-private-field"><label>Texto de firma</label><input ${disabled} data-he-private-key="documentos.firma.texto"></div></div></div>
        <div class="he-private-section"><h4>Información para pago</h4><div class="he-private-grid"><div class="he-private-field"><label>Banco</label><input ${disabled} data-he-private-key="documentos.banco.nombre"></div><div class="he-private-field"><label>Tipo de cuenta</label><input ${disabled} data-he-private-key="documentos.banco.tipo_cuenta"></div><div class="he-private-field full"><label>Número de cuenta</label><input ${disabled} inputmode="numeric" data-he-private-key="documentos.banco.numero_cuenta"></div><div class="he-private-field"><label>Titular</label><input ${disabled} data-he-private-key="documentos.banco.titular"></div><div class="he-private-field"><label>CC del titular</label><input ${disabled} data-he-private-key="documentos.banco.cc_titular"></div></div></div>
        <div class="he-private-section"><h4>Emisión</h4><div class="he-private-grid"><div class="he-private-field"><label>Prefijo</label><input ${disabled} maxlength="8" data-he-private-key="documentos.cuenta_cobro.prefijo"></div><div class="he-private-field"><label>Ciudad</label><input ${disabled} data-he-private-key="documentos.cuenta_cobro.ciudad"></div><div class="he-private-field full"><label>Texto de cierre</label><textarea ${disabled} data-he-private-key="documentos.cuenta_cobro.texto_cierre"></textarea></div></div></div>
        <div class="he-private-actions"><button class="he-private-save" id="heSavePrivateAccount" ${disabled}>Guardar cuenta de cobro</button></div>`;
        card.querySelectorAll('[data-he-private-key]').forEach(el=>{el.addEventListener('input',()=>{privateDocConfig[el.dataset.hePrivateKey]=el.value;publishPrivateDocConfig()})});
        const save=card.querySelector('#heSavePrivateAccount');if(save&&!save.disabled)save.addEventListener('click',()=>savePrivateAccount(save));
        return card;
    }

    function publishPrivateDocConfig(){
        global.HomeEasyPrivateDocConfig={...privateDocConfig};
        try{global.dispatchEvent(new CustomEvent('homeeasy:private-doc-config',{detail:{configuracion:{...privateDocConfig}}}))}catch(e){}
    }

    async function loadPrivateAccount(){
        const card=document.getElementById('hePrivateAccountCard');if(!card)return;
        try{const res=await request('AUTH_GET_CONFIG_DOCUMENTOS');if(!res||res.status!=='success'||!res.configuracion)throw new Error(res&&res.msg||'No se pudo cargar la configuración de la cuenta.');privateDocConfig={...res.configuracion};card.querySelectorAll('[data-he-private-key]').forEach(el=>{el.value=privateDocConfig[el.dataset.hePrivateKey]??''});publishPrivateDocConfig();}
        catch(e){card.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=true);const note=document.createElement('div');note.className='he-users-empty';note.textContent=e.message;card.appendChild(note)}
    }

    async function savePrivateAccount(button){
        const card=document.getElementById('hePrivateAccountCard'), changes={};
        card.querySelectorAll('[data-he-private-key]').forEach(el=>{changes[el.dataset.hePrivateKey]=el.value.trim()});
        button.disabled=true;const old=button.textContent;button.textContent='Guardando…';
        try{const res=await request('AUTH_GUARDAR_CONFIG_DOCUMENTOS',{cambios:changes});if(!res||res.status!=='success')throw new Error(res&&res.msg||'No se pudo guardar la cuenta de cobro.');privateDocConfig={...res.configuracion};publishPrivateDocConfig();notify('Cuenta de cobro actualizada. Documentos y Vista previa ya usan estos datos.',true)}
        catch(e){notify(e.message,false)}finally{button.disabled=false;button.textContent=old}
    }

    async function request(type, extra) {
        if (!auth()) throw new Error('La sesión no está disponible.');
        return auth().requestBackend({tipo:type,appSessionToken:auth().getAppSessionToken(),...(extra||{})});
    }

    function activationBaseUrl() {
        try {
            const url = new URL('.', global.location.href);
            return url.origin + url.pathname;
        } catch (e) { return ''; }
    }

    async function loadUsers() {
        const list=document.getElementById('heUsersList'); if(!list) return;
        list.innerHTML='<div class="he-users-empty"><i class="fa-solid fa-circle-notch fa-spin"></i><br>Cargando usuarios…</div>';
        try {
            const res=await request('AUTH_LISTAR_USUARIOS');
            if(!res||res.status!=='success'||!Array.isArray(res.usuarios)) throw new Error(res&&res.msg||'La gestión de usuarios requiere el Cerebro 9C actualizado.');
            list.innerHTML='';
            if(!res.usuarios.length){list.innerHTML='<div class="he-users-empty">Todavía no hay usuarios.</div>';return;}
            res.usuarios.forEach(u=>list.appendChild(userRow(u)));
        } catch(err) { list.innerHTML=`<div class="he-users-empty"><strong>Usuarios aún no disponibles</strong><br>${esc(err.message||'Publica el Cerebro 9C para habilitar esta sección.')}</div>`; }
    }

    function relativeTime(value) {
        if (!value) return 'Sin conexiones';
        const d = new Date(value); if (Number.isNaN(d.getTime())) return 'Sin conexiones';
        const secs = Math.max(0, Math.floor((Date.now()-d.getTime())/1000));
        if (secs < 60) return 'Ahora';
        if (secs < 3600) return 'Hace ' + Math.floor(secs/60) + ' min';
        if (secs < 86400) return 'Hace ' + Math.floor(secs/3600) + ' h';
        return d.toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'});
    }

    function lastSeenLabel(value) {
        if (!value) return 'Sin conexiones';
        const d = new Date(value); if (Number.isNaN(d.getTime())) return 'Sin conexiones';
        const relative = relativeTime(value);
        const exact = d.toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'numeric',minute:'2-digit'});
        return relative + ' · ' + exact;
    }

    function userRow(u) {
        const owner=String(u.rol||'').toUpperCase()==='PROPIETARIO';
        const status=String(u.estado||'').toUpperCase();
        const invited=!u.uid && status==='INVITADO';
        const row=document.createElement('div'); row.className='he-user-row';
        const presence = u.enLinea
            ? '<div class="he-presence-line online"><span class="he-presence-dot"></span>En línea</div><span class="he-last-seen">'+esc(u.ultimoDispositivo||'Sesión activa')+'</span>'
            : '<div class="he-presence-line"><span class="he-presence-dot"></span>Desconectado</div><span class="he-last-seen">'+esc(lastSeenLabel(u.ultimaConexion||u.ultimoAcceso))+'</span>';
        const actions = owner ? '<button class="he-user-save" disabled>Protegido</button>' :
            '<button class="he-user-save">Guardar</button>' + (invited ? '<button class="he-user-save he-resend-invite" type="button">Reenviar</button>' : '');
        row.innerHTML=`<div class="he-user-main"><strong>${esc(u.nombre||'Sin nombre')}</strong><span>${esc(u.email||'')}</span>${owner?'<em class="he-owner-badge">CUENTA PROTEGIDA</em>':invited?'<em class="he-owner-badge">INVITACIÓN PENDIENTE</em>':''}</div><select class="he-user-role" ${owner?'disabled':''}>${roleOptions(u.rol)}</select><select class="he-user-status" ${owner?'disabled':''}>${u.uid?`<option ${status==='ACTIVO'?'selected':''} value="ACTIVO">ACTIVO</option><option ${status==='DESACTIVADO'?'selected':''} value="DESACTIVADO">DESACTIVADO</option>`:`<option ${status==='INVITADO'?'selected':''} value="INVITADO">INVITADO</option><option ${status==='DESACTIVADO'?'selected':''} value="DESACTIVADO">DESACTIVADO</option>`}</select><div class="he-user-presence">${presence}</div><div class="he-user-actions">${actions}</div>`;
        if(!owner) {
            row.querySelector('.he-user-save:not(.he-resend-invite)').addEventListener('click',async()=>{
                const b=row.querySelector('.he-user-save:not(.he-resend-invite)'); b.disabled=true;
                try{const res=await request('AUTH_ACTUALIZAR_USUARIO',{usuarioUid:u.uid||'',usuarioEmail:u.email,rol:row.querySelector('.he-user-role').value,estado:row.querySelector('.he-user-status').value});if(!res||res.status!=='success')throw new Error(res&&res.msg||'No se pudo actualizar.');notify('Usuario actualizado.',true);await loadUsers();}catch(e){notify(e.message,false)}finally{b.disabled=false}
            });
            const resend=row.querySelector('.he-resend-invite');
            if(resend) resend.addEventListener('click',()=>resendInvite(u,resend));
        }
        return row;
    }

    async function showInvitationResult(res, name) {
        if(!res||res.status!=='success'||!res.activationUrl) throw new Error(res&&res.msg||'No se pudo crear la invitación.');
        const sent=res.emailEnviado===true;
        const expiry=res.expiraEn?new Date(res.expiraEn).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'}):'';
        await Swal.fire({
            icon:sent?'success':'info',
            title:sent?'Invitación enviada':'Invitación creada',
            html:'<p style="font-size:.82rem;color:#777;line-height:1.5">'+(sent?'HomeEasy envió el correo de activación a <b>'+esc(name)+'</b>.':'No se pudo enviar el correo automáticamente. Comparte este enlace con <b>'+esc(name)+'</b>.')+'</p>'+(expiry?'<p style="font-size:.7rem;color:#999">Vence: '+esc(expiry)+'</p>':'')+'<input id="heInviteLink" class="swal2-input" readonly value="'+esc(res.activationUrl)+'">',
            confirmButtonText:'Copiar enlace', showCancelButton:true, cancelButtonText:'Cerrar', confirmButtonColor:'#a6455a',
            preConfirm:async()=>{try{await navigator.clipboard.writeText(res.activationUrl);return true}catch(e){const input=document.getElementById('heInviteLink');input.select();document.execCommand('copy');return true}}
        });
    }

    async function resendInvite(u, button) {
        button.disabled=true; const old=button.textContent; button.textContent='Enviando…';
        try{const res=await request('AUTH_REENVIAR_INVITACION',{usuarioUid:u.uid||'',usuarioEmail:u.email,appBaseUrl:activationBaseUrl()});await showInvitationResult(res,u.nombre||u.email);await loadUsers();}
        catch(e){notify(e.message,false)}finally{button.disabled=false;button.textContent=old}
    }

    async function inviteUser() {
        const name=document.getElementById('heInviteName').value.trim(),email=document.getElementById('heInviteEmail').value.trim(),role=document.getElementById('heInviteRole').value,b=document.getElementById('heInviteSubmit');
        if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){notify('Escribe nombre y correo válidos.',false);return;}
        b.disabled=true;b.textContent='Creando…';
        try{
            const res=await request('AUTH_INVITAR_USUARIO',{nombre:name,email,rol:role,appBaseUrl:activationBaseUrl()});
            await showInvitationResult(res,name);
            document.getElementById('heInviteName').value='';document.getElementById('heInviteEmail').value='';
            await loadUsers();
        }catch(e){notify(e.message,false)}finally{b.disabled=false;b.textContent='Crear invitación'}
    }

    async function changePassword() {
        if(!global.Swal){return;}
        const result=await Swal.fire({title:'Cambiar contraseña',html:'<input id="hePw1" class="swal2-input" type="password" placeholder="Nueva contraseña"><input id="hePw2" class="swal2-input" type="password" placeholder="Repetir contraseña">',showCancelButton:true,confirmButtonText:'Cambiar',cancelButtonText:'Cancelar',confirmButtonColor:'#a6455a',preConfirm:()=>{const a=document.getElementById('hePw1').value,b=document.getElementById('hePw2').value;if(a.length<8){Swal.showValidationMessage('Usa al menos 8 caracteres.');return false}if(a!==b){Swal.showValidationMessage('Las contraseñas no coinciden.');return false}return a;}});
        if(result.isConfirmed){try{await auth().changePassword(result.value);notify('Contraseña actualizada.',true)}catch(e){notify(e.message,false)}}
    }

    async function renameDevice() {
        if(!global.Swal||!core())return; const current=core().getDeviceName();
        const r=await Swal.fire({title:'Nombre del dispositivo',input:'text',inputValue:current,showCancelButton:true,confirmButtonText:'Guardar',confirmButtonColor:'#a6455a',inputAttributes:{maxlength:80}}); if(r.isConfirmed&&r.value){core().setDeviceName(r.value);notify('Dispositivo actualizado.',true);location.reload();}
    }

    async function logout(){try{await auth().signOut({meta:core()?core().buildMeta():{}})}finally{if(core())core().clearSensitiveBrowserCaches();location.replace('login.html')}}
    function notify(message,ok){if(global.Swal)Swal.fire({icon:ok?'success':'error',title:ok?'Listo':'No se pudo completar',text:message,confirmButtonColor:'#a6455a'});}

    function hideLegacyIdentity() {
        document.querySelectorAll('.operator-box').forEach(el=>el.style.display='none');
        const select=document.getElementById('operatorSelectSecurity'); if(select&&select.closest('.field'))select.closest('.field').classList.add('he-legacy-operator-field');
        if(core()&&profile)core().setOperator(profile.nombre||profile.email||'Sin identificar');
    }

    function mount(p) {
        if(mounted)return; profile=p||(auth()&&auth().getCurrentProfile?auth().getCurrentProfile():null); if(!profile)return;
        const install=()=>{if(mounted)return;mounted=true;addStyles();hideLegacyIdentity();const content=document.querySelector('.content');if(!content)return;const first=document.getElementById('panel-empresa')||content.firstChild;if(can('usuarios.manage')){content.insertBefore(usersPanel(),first);addNav('usuarios','Usuarios','fa-solid fa-users',false);}if(can('roles.manage')){content.insertBefore(rolesPanel(),first);addNav('roles','Roles y permisos','fa-solid fa-list-check',false);loadRoles();}const docsPanel=document.getElementById('panel-documentos');if(docsPanel){docsPanel.appendChild(privateAccountCard());loadPrivateAccount();}setTimeout(hideLegacyIdentity,300);const requested=new URLSearchParams(location.search).get('section');if((requested==='usuarios'&&can('usuarios.manage'))||(requested==='roles'&&can('roles.manage')))setTimeout(()=>activate(requested),50);};
        if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
    }

    global.addEventListener('homeeasy:page-auth-ready',e=>mount(e.detail&&e.detail.profile));
    setTimeout(()=>mount(),700);
})(window);
