/**
 * HomeEasy Account UI v3.1
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
        'asistente.html': 'app.access'
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
            .he-account-trigger{width:48px;height:48px;padding:0;border:1px solid rgba(60,60,67,.10);border-radius:50%;background:#fff;box-shadow:0 7px 20px rgba(42,32,36,.08);display:grid;place-items:center;transition:transform .18s cubic-bezier(.2,.8,.2,1),box-shadow .18s ease,border-color .18s ease}
            .he-account-avatar{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#b75a70,#a6455a 56%,#823646);color:#fff;font-size:.70rem;line-height:1;font-weight:800;letter-spacing:.035em;box-shadow:inset 0 1px 0 rgba(255,255,255,.20),0 4px 11px rgba(130,54,70,.20)}
            .he-account-trigger[aria-expanded="true"]{border-color:rgba(166,69,90,.24);box-shadow:0 10px 26px rgba(42,32,36,.13)}
            #${MENU_ID}{position:absolute;z-index:3200;top:58px;left:0;width:min(292px,calc(100vw - 34px));padding:10px;border:1px solid rgba(60,60,67,.10);border-radius:22px;background:rgba(255,255,255,.98);box-shadow:0 24px 60px rgba(39,31,35,.18),0 6px 20px rgba(39,31,35,.08);backdrop-filter:blur(22px) saturate(126%);-webkit-backdrop-filter:blur(22px) saturate(126%);transform-origin:top left;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-7px) scale(.975);transition:opacity .16s ease,visibility .16s ease,transform .18s cubic-bezier(.2,.8,.2,1);text-align:left}
            #${MENU_ID}.open{opacity:1;visibility:visible;pointer-events:auto;transform:none}
            .he-account-head{padding:12px 12px 13px}.he-account-head-top{display:flex;align-items:center;gap:11px;min-width:0}.he-account-big-avatar{width:42px;height:42px;flex:0 0 42px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,#b75a70,#a6455a 58%,#823646);color:#fff;font-size:.75rem;font-weight:800;letter-spacing:.04em}.he-account-copy{min-width:0;flex:1}.he-account-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#2b2629;font-size:.88rem;line-height:1.22;font-weight:740}.he-account-email{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8c8589;font-size:.64rem}.he-account-role{width:fit-content;margin-top:10px;padding:5px 8px;border:1px solid rgba(194,164,104,.27);border-radius:999px;background:rgba(194,164,104,.10);color:#8a6d37;font-size:.58rem;font-weight:800;letter-spacing:.075em}
            .he-account-divider{height:1px;margin:0 8px 7px;background:rgba(60,60,67,.10);transform:scaleY(.5)}
            .he-account-action{width:100%;min-height:46px;padding:0 12px;border:0;border-radius:13px;display:flex;align-items:center;gap:11px;background:transparent;color:#393336;text-decoration:none;text-align:left;font-size:.76rem;font-weight:620}.he-account-action i{width:22px;color:#a6455a;text-align:center}.he-account-action:active{background:#f6f1f3;transform:scale(.985)}.he-account-action.logout{color:#a33e55}
            @media(any-hover:hover) and (any-pointer:fine){.he-account-trigger:hover{transform:translateY(-3px) scale(1.025);border-color:rgba(166,69,90,.18);box-shadow:0 13px 30px rgba(42,32,36,.14)}.he-account-action:hover{background:#f8f4f5;color:#a6455a}}
            @media(max-width:430px){.he-account-trigger,.settings-container,.bell-container{width:44px!important;height:44px!important}.he-account-avatar{width:33px;height:33px}#${MENU_ID}{top:54px}}
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
            control.innerHTML = `<button type="button" class="he-account-trigger" id="homeeasyAccountButton" aria-label="Abrir mi perfil" aria-haspopup="menu" aria-expanded="false"><span class="he-account-avatar">${avatar}</span></button><div id="${MENU_ID}" role="menu"><div class="he-account-head"><div class="he-account-head-top"><div class="he-account-big-avatar">${avatar}</div><div class="he-account-copy"><div class="he-account-name"></div><div class="he-account-email"></div></div></div><div class="he-account-role"></div></div><div class="he-account-divider"></div><a class="he-account-action" href="perfil.html" role="menuitem"><i class="fa-regular fa-user"></i><span>Mi perfil</span></a><a class="he-account-action" href="configuracion.html" role="menuitem"><i class="fa-solid fa-gear"></i><span>Configuración</span></a><button class="he-account-action logout" type="button" role="menuitem"><i class="fa-solid fa-arrow-right-from-bracket"></i><span>Cerrar sesión</span></button></div>`;
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
