/**
 * HomeEasy Settings Auth UI v3.1
 * Sustituye la identidad manual por la sesión autenticada y añade Mi perfil / Usuarios y roles.
 */
(function (global) {
    'use strict';
    const page = (global.location.pathname.split('/').pop() || '').toLowerCase();
    if (page !== 'configuracion.html') return;

    const STYLE_ID = 'homeeasy-settings-auth-ui-style';
    let mounted = false;
    let profile = null;

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
            @media(max-width:760px){.he-profile-grid{grid-template-columns:1fr}.he-user-row{grid-template-columns:1fr 1fr}.he-user-main{grid-column:1/-1}.he-invite-form{grid-template-columns:1fr}.he-users-toolbar{align-items:flex-start}.he-profile-actions{display:grid;grid-template-columns:1fr}.he-auth-btn{width:100%}}
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
        panel.innerHTML=`<div class="page-heading"><h2>Usuarios y roles</h2><p>Crea accesos, revisa quién está conectado y define qué puede hacer cada cuenta.</p></div><div class="card"><div class="he-users-toolbar"><div class="he-users-toolbar-copy"><strong>Equipo HomeEasy</strong><span>El rol Propietario está protegido. Los cambios de rol o estado revocan las sesiones anteriores.</span></div><button class="refresh-button" id="heRefreshUsers"><i class="fa-solid fa-rotate"></i> Actualizar</button></div><div class="he-users-list" id="heUsersList"><div class="he-users-empty"><i class="fa-solid fa-circle-notch fa-spin"></i><br>Cargando usuarios…</div></div><div class="he-invite-form"><div class="he-invite-field"><label>Nombre</label><input id="heInviteName" maxlength="120" placeholder="Nombre completo"></div><div class="he-invite-field"><label>Correo</label><input id="heInviteEmail" type="email" maxlength="180" placeholder="usuario@correo.com"></div><div class="he-invite-field"><label>Rol</label><select id="heInviteRole"><option>ADMINISTRADOR</option><option selected>COMERCIAL</option><option>CAJA</option><option>OPERACIONES</option><option>CONSULTA</option></select></div><button class="he-invite-submit" id="heInviteSubmit">Crear invitación</button></div></div>`;
        panel.querySelector('#heRefreshUsers').addEventListener('click',loadUsers);
        panel.querySelector('#heInviteSubmit').addEventListener('click',inviteUser);
        return panel;
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
        row.innerHTML=`<div class="he-user-main"><strong>${esc(u.nombre||'Sin nombre')}</strong><span>${esc(u.email||'')}</span>${owner?'<em class="he-owner-badge">CUENTA PROTEGIDA</em>':invited?'<em class="he-owner-badge">INVITACIÓN PENDIENTE</em>':''}</div><select class="he-user-role" ${owner?'disabled':''}>${['ADMINISTRADOR','COMERCIAL','CAJA','OPERACIONES','CONSULTA'].map(r=>`<option ${r===u.rol?'selected':''}>${r}</option>`).join('')}</select><select class="he-user-status" ${owner?'disabled':''}>${u.uid?`<option ${status==='ACTIVO'?'selected':''} value="ACTIVO">ACTIVO</option><option ${status==='DESACTIVADO'?'selected':''} value="DESACTIVADO">DESACTIVADO</option>`:`<option ${status==='INVITADO'?'selected':''} value="INVITADO">INVITADO</option><option ${status==='DESACTIVADO'?'selected':''} value="DESACTIVADO">DESACTIVADO</option>`}</select><div class="he-user-presence">${presence}</div><div class="he-user-actions">${actions}</div>`;
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
        const install=()=>{if(mounted)return;mounted=true;addStyles();hideLegacyIdentity();const content=document.querySelector('.content');if(!content)return;if(isAdmin(profile)){content.insertBefore(usersPanel(),document.getElementById('panel-empresa')||content.firstChild);addNav('usuarios','Usuarios y roles','fa-solid fa-users-gear',true);}setTimeout(hideLegacyIdentity,300);const requested=new URLSearchParams(location.search).get('section');if(requested==='usuarios'&&isAdmin(profile))setTimeout(()=>activate(requested),50);};
        if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
    }

    global.addEventListener('homeeasy:page-auth-ready',e=>mount(e.detail&&e.detail.profile));
    setTimeout(()=>mount(),700);
})(window);
