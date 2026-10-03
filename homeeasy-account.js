/**
 * HomeEasy Account UI v3.2
 * Identidad de la sesión en el Index. Se monta junto a Configuración, no en la campana.
 */
(function (global) {
    'use strict';

    if (((global.location.pathname.split('/').pop() || 'index.html').toLowerCase()) !== 'index.html') return;

    const CONTROL_ID = 'homeeasyAccountControl';
    const MENU_ID = 'homeeasyAccountMenu';
    const STYLE_ID = 'homeeasyAccountStyles';
    let currentProfile = null;


    const NAV_PERMISSION_MAP = Object.freeze({
        'clientes.html': 'clientes.read',
        'ventas.html': 'ventas.read',
        'cotizacion.html': 'cotizaciones.write',
        'seguimiento.html': 'cotizaciones.read',
        'pedido.html': 'pedidos.write',
        'abono.html': 'abonos.write',
        'caja.html': 'caja.read',
        'documentos.html': 'documentos.read',
        'calendario.html': 'agenda.read',
        'reportes.html': 'reportes.read',
        'configuracion.html': 'config.read',
        'Hommychat.html': 'app.access',
    });

    function filterNavigationByPermissions() {
        const auth = global.HomeEasyAuth;
        if (!auth || typeof auth.hasPermission !== 'function') return;
        document.querySelectorAll('a[href]').forEach(link => {
            let file = '';
            try { file = new URL(link.getAttribute('href'), global.location.href).pathname.split('/').pop(); } catch (e) {}
            const permission = NAV_PERMISSION_MAP[file];
            if (!permission) return;
            const allowed = auth.hasPermission(permission);
            link.hidden = !allowed;
            link.setAttribute('aria-hidden', allowed ? 'false' : 'true');
            if (!allowed) link.setAttribute('tabindex', '-1');
            else link.removeAttribute('tabindex');
        });
    }

    function clean(value, max) {
        return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max || 160);
    }

    function firstName(name) {
        return clean(name, 80).split(/\s+/)[0] || '';
    }

    function initials(name, email) {
        const parts = clean(name, 120).split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return clean(email, 120).slice(0, 2).toUpperCase() || 'HE';
    }

    function roleLabel(role) {
        const value = clean(role, 60).toUpperCase();
        return ({PROPIETARIO:'PROPIETARIO',ADMINISTRADOR:'ADMINISTRADOR',COMERCIAL:'COMERCIAL',CAJA:'CAJA / FINANZAS',OPERACIONES:'OPERACIONES',CONSULTA:'CONSULTA'})[value] || value || 'USUARIO';
    }

    function installStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .homeeasy-left-actions{display:flex;align-items:center;gap:8px;position:relative;pointer-events:auto}
            .homeeasy-left-actions .settings-action{position:relative!important;inset:auto!important;margin:0!important}
            #${CONTROL_ID}{position:relative;display:inline-flex;align-items:center;flex:0 0 auto}
            .he-account-trigger{width:46px;height:46px;padding:5px;border:1px solid rgba(60,60,67,.09);border-radius:50%;background:#fff;box-shadow:0 6px 18px rgba(42,32,36,.07);display:grid;place-items:center;transition:transform .18s cubic-bezier(.2,.8,.2,1),box-shadow .18s ease,border-color .18s ease}
            .he-account-avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#a6455a;color:#fff;font-size:.69rem;line-height:1;font-weight:600;letter-spacing:.005em}
            .he-account-trigger[aria-expanded="true"]{border-color:rgba(166,69,90,.22);box-shadow:0 9px 24px rgba(42,32,36,.12)}
            #${MENU_ID}{position:absolute;z-index:3200;top:58px;left:0;width:min(302px,calc(100vw - 34px));padding:8px;border:1px solid rgba(60,60,67,.085);border-radius:19px;background:rgba(255,255,255,.985);box-shadow:0 22px 54px rgba(39,31,35,.15),0 4px 12px rgba(39,31,35,.05);backdrop-filter:blur(22px) saturate(126%);-webkit-backdrop-filter:blur(22px) saturate(126%);transform-origin:top left;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-7px) scale(.978);transition:opacity .16s ease,visibility .16s ease,transform .18s cubic-bezier(.2,.8,.2,1);text-align:left}
            #${MENU_ID}.open{opacity:1;visibility:visible;pointer-events:auto;transform:none}
            .he-account-head{padding:12px 12px 14px}
            .he-account-head-top{display:flex;align-items:center;gap:12px;min-width:0}
            .he-account-big-avatar{width:42px;height:42px;flex:0 0 42px;border-radius:14px;display:grid;place-items:center;background:#f5e9ec;color:#a6455a;border:1px solid rgba(166,69,90,.08);font-size:.75rem;font-weight:600;letter-spacing:.01em}
            .he-account-copy{min-width:0;flex:1}
            .he-account-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#292428;font-size:.88rem;line-height:1.22;font-weight:650;letter-spacing:-.012em}
            .he-account-email{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8e878b;font-size:.66rem;line-height:1.25}
            .he-account-role-row{margin-top:12px;display:flex;align-items:center;gap:7px;color:#6f686c}
            .he-account-role-icon{width:18px;height:18px;border-radius:6px;display:grid;place-items:center;background:rgba(194,164,104,.11);color:#9a7e47;flex:0 0 auto}
            .he-account-role-icon svg{width:11px;height:11px;stroke:currentColor;stroke-width:1.8;fill:none}
            .he-account-role{font-size:.66rem;line-height:1;font-weight:600;letter-spacing:.01em;color:#6f686c}
            .he-account-divider{height:1px;margin:0 7px 7px;background:rgba(60,60,67,.10);transform:scaleY(.6)}
            .he-account-action{width:100%;min-height:44px;padding:0 10px;border:0;border-radius:11px;display:flex;align-items:center;gap:11px;background:transparent;color:#3c3639;text-decoration:none;text-align:left;font-size:.76rem;font-weight:600;transition:background .16s ease,color .16s ease}
            .he-account-action>i:first-child{width:24px;color:#a6455a;text-align:center;font-size:.92rem}
            .he-account-action span{flex:1}
            .he-account-chevron{width:auto!important;color:#b8b1b5!important;font-size:.66rem!important}
            .he-account-action:active{background:#f8f5f6;transform:scale(.988)}
            .he-account-actions-gap{height:5px}
            .he-account-action.logout{color:#a13e54;margin-top:0}
            .he-account-footer{margin:7px 7px 0;padding:9px 8px 7px;border-top:1px solid rgba(60,60,67,.075);text-align:center;color:#aba3a7;font-size:.56rem;letter-spacing:.025em}
            @media(any-hover:hover) and (any-pointer:fine){
                .he-account-trigger:hover{transform:translateY(-2px) scale(1.02);border-color:rgba(166,69,90,.17);box-shadow:0 11px 26px rgba(42,32,36,.12)}
                .he-account-action:hover{background:#f8f5f6;color:#a6455a}
                .he-account-action.logout:hover{background:rgba(166,69,90,.055)}
            }
            @media(max-width:430px){
                .he-account-trigger,.settings-container,.bell-container{width:44px!important;height:44px!important}
                .he-account-trigger{padding:5px}
                .he-account-avatar{width:33px;height:33px}
                #${MENU_ID}{top:54px;width:min(302px,calc(100vw - 26px))}
            }
        `;
        document.head.appendChild(style);
    }

    function personalizeGreeting(profile) {
        const greeting = document.getElementById('homeGreeting');
        const name = firstName(profile && profile.nombre);
        if (!greeting || !name) return;
        const apply = () => {
            const raw = clean(greeting.textContent, 80) || 'Hola';
            greeting.textContent = raw.replace(/,\s*[^,]+$/, '').trim() + ', ' + name;
        };
        apply();
        setTimeout(apply, 80);
        setTimeout(apply, 650);
    }

    function closeMenu() {
        const menu = document.getElementById(MENU_ID);
        const trigger = document.getElementById('homeeasyAccountButton');
        if (menu) menu.classList.remove('open');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    async function logout(button) {
        if (button.disabled) return;
        button.disabled = true;
        try {
            if (global.HomeEasyAuth) await global.HomeEasyAuth.signOut({meta: global.HomeEasyCore ? global.HomeEasyCore.buildMeta() : {}});
        } finally {
            if (global.HomeEasyCore) global.HomeEasyCore.clearSensitiveBrowserCaches();
            global.location.replace('login.html');
        }
    }

    function mount(profile) {
        currentProfile = profile || currentProfile || (global.HomeEasyAuth && global.HomeEasyAuth.getCurrentProfile ? global.HomeEasyAuth.getCurrentProfile() : null);
        if (!currentProfile || document.getElementById(CONTROL_ID)) return;
        const install = () => {
            const heroActions = document.querySelector('.hero-actions');
            const settings = document.querySelector('.settings-action');
            if (!heroActions || !settings) return;
            installStyles();

            let left = heroActions.querySelector('.homeeasy-left-actions');
            if (!left) {
                left = document.createElement('div');
                left.className = 'homeeasy-left-actions';
                heroActions.insertBefore(left, heroActions.firstChild);
                left.appendChild(settings);
            }

            const name = clean(currentProfile.nombre, 160) || 'Usuario HomeEasy';
            const email = clean(currentProfile.email, 180);
            const role = roleLabel(currentProfile.rol);
            const avatar = initials(name, email);

            const control = document.createElement('div');
            control.id = CONTROL_ID;
            control.innerHTML = `<button type="button" class="he-account-trigger" id="homeeasyAccountButton" aria-label="Abrir mi perfil" aria-haspopup="menu" aria-expanded="false"><span class="he-account-avatar">${avatar}</span></button><div id="${MENU_ID}" role="menu"><div class="he-account-head"><div class="he-account-head-top"><div class="he-account-big-avatar">${avatar}</div><div class="he-account-copy"><div class="he-account-name"></div><div class="he-account-email"></div></div></div><div class="he-account-role-row" aria-label="Rol del usuario"><span class="he-account-role-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.9 8.3 7 10 4.1-1.7 7-5.3 7-10V6l-7-3Z"></path><path d="M9.5 12.2 11.2 14l3.6-4"></path></svg></span><span class="he-account-role"></span></div></div><div class="he-account-divider"></div><a class="he-account-action" href="perfil.html" role="menuitem"><i class="fa-regular fa-user" aria-hidden="true"></i><span>Mi perfil</span><i class="fa-solid fa-chevron-right he-account-chevron" aria-hidden="true"></i></a><a class="he-account-action" href="configuracion.html" role="menuitem"><i class="fa-solid fa-gear" aria-hidden="true"></i><span>Configuración</span><i class="fa-solid fa-chevron-right he-account-chevron" aria-hidden="true"></i></a><div class="he-account-actions-gap" aria-hidden="true"></div><button class="he-account-action logout" type="button" role="menuitem"><i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i><span>Cerrar sesión</span></button><div class="he-account-footer">HomeEasy · Sistema Hommy</div></div>`;
            control.querySelector('.he-account-name').textContent = name;
            control.querySelector('.he-account-email').textContent = email;
            control.querySelector('.he-account-role').textContent = role;
            left.insertBefore(control, settings);

            const trigger = control.querySelector('#homeeasyAccountButton');
            const menu = control.querySelector('#' + MENU_ID);
            trigger.addEventListener('click', event => {
                event.stopPropagation();
                const open = !menu.classList.contains('open');
                menu.classList.toggle('open', open);
                trigger.setAttribute('aria-expanded', String(open));
            });
            menu.addEventListener('click', event => event.stopPropagation());
            menu.querySelector('.logout').addEventListener('click', event => logout(event.currentTarget));
            filterNavigationByPermissions();
            personalizeGreeting(currentProfile);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
        else install();
    }

    global.addEventListener('homeeasy:index-auth-ready', event => mount(event.detail && event.detail.profile));
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
    setTimeout(() => mount(), 500);
})(window);
