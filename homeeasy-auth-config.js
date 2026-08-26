/**
 * HomeEasy Auth configuration.
 * Firebase Authentication en plan Spark, sin servicios de pago.
 * Esta configuración permanece aislada en feature/auth-rbac.
 */
window.HOMEEASY_AUTH_CONFIG = Object.freeze({
    enabled: true,
    apiKey: 'AIzaSyCc-kiqZ3WxpulA_fKEgNuSNLI2ofCL7eY',
    projectId: 'homeeasy-auth',
    backendUrl: 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec',
    loginPath: 'login.html',
    homePath: 'index.html',
    defaultPersistence: 'session'
});

/**
 * HomeEasy Auth — Fase 3B
 * Identidad de la sesión dentro del Index.
 * No modifica el HTML persistente: el control se monta únicamente después de
 * que el guard 3A haya validado Firebase + la sesión general de HomeEasy.
 */
(function installHomeEasyAccountIdentity() {
    'use strict';

    const page = String(window.location && window.location.pathname || '').split('/').pop().toLowerCase() || 'index.html';
    if (page !== 'index.html') return;

    const STYLE_ID = 'homeeasy-account-v3b-style';
    const CONTROL_ID = 'homeeasyAccountControl';
    const MENU_ID = 'homeeasyAccountMenu';
    let currentProfile = null;

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
        const labels = {
            PROPIETARIO: 'PROPIETARIO',
            ADMINISTRADOR: 'ADMINISTRADOR',
            COMERCIAL: 'COMERCIAL',
            CAJA: 'CAJA / FINANZAS',
            OPERACIONES: 'OPERACIONES',
            CONSULTA: 'CONSULTA'
        };
        return labels[value] || value || 'USUARIO';
    }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${CONTROL_ID} {
                position: relative;
                display: inline-flex;
                align-items: center;
                flex: 0 0 auto;
                margin-right: 8px;
            }
            .homeeasy-account-trigger {
                width: 48px;
                height: 48px;
                padding: 0;
                border: 1px solid rgba(60,60,67,.10);
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 7px 20px rgba(42,32,36,.08);
                display: grid;
                place-items: center;
                color: #fff;
                transition: transform .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s ease, border-color .18s ease;
            }
            .homeeasy-account-avatar {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                display: grid;
                place-items: center;
                background: linear-gradient(145deg, #b75a70 0%, #a6455a 56%, #823646 100%);
                color: #fff;
                font-size: .70rem;
                line-height: 1;
                font-weight: 800;
                letter-spacing: .035em;
                box-shadow: inset 0 1px 0 rgba(255,255,255,.20), 0 4px 11px rgba(130,54,70,.20);
            }
            .homeeasy-account-trigger[aria-expanded="true"] {
                border-color: rgba(166,69,90,.24);
                box-shadow: 0 10px 26px rgba(42,32,36,.13);
            }
            #${MENU_ID} {
                position: absolute;
                z-index: 3200;
                top: 58px;
                right: 0;
                width: min(292px, calc(100vw - 34px));
                padding: 10px;
                border: 1px solid rgba(60,60,67,.10);
                border-radius: 22px;
                background: rgba(255,255,255,.97);
                box-shadow: 0 24px 60px rgba(39,31,35,.18), 0 6px 20px rgba(39,31,35,.08);
                backdrop-filter: blur(22px) saturate(126%);
                -webkit-backdrop-filter: blur(22px) saturate(126%);
                transform-origin: top right;
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
                transform: translateY(-7px) scale(.975);
                transition: opacity .18s ease, visibility .18s ease, transform .20s cubic-bezier(.2,.8,.2,1);
            }
            #${MENU_ID}.open {
                opacity: 1;
                visibility: visible;
                pointer-events: auto;
                transform: translateY(0) scale(1);
            }
            .homeeasy-account-profile {
                padding: 12px 12px 13px;
                text-align: left;
            }
            .homeeasy-account-profile-top {
                display: flex;
                align-items: center;
                gap: 11px;
                min-width: 0;
            }
            .homeeasy-account-profile-avatar {
                width: 42px;
                height: 42px;
                flex: 0 0 42px;
                border-radius: 13px;
                display: grid;
                place-items: center;
                background: linear-gradient(145deg, #b75a70, #a6455a 58%, #823646);
                color: #fff;
                font-size: .75rem;
                font-weight: 800;
                letter-spacing: .04em;
                box-shadow: inset 0 1px 0 rgba(255,255,255,.20), 0 5px 13px rgba(130,54,70,.19);
            }
            .homeeasy-account-profile-copy { min-width: 0; flex: 1; }
            .homeeasy-account-profile-name {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: #2b2629;
                font-size: .88rem;
                line-height: 1.22;
                font-weight: 740;
                letter-spacing: -.018em;
            }
            .homeeasy-account-profile-email {
                margin-top: 3px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: #8c8589;
                font-size: .64rem;
                line-height: 1.25;
                font-weight: 500;
            }
            .homeeasy-account-role {
                width: fit-content;
                max-width: 100%;
                margin-top: 10px;
                padding: 5px 8px;
                border: 1px solid rgba(194,164,104,.27);
                border-radius: 999px;
                background: rgba(194,164,104,.10);
                color: #8a6d37;
                font-size: .58rem;
                line-height: 1;
                font-weight: 800;
                letter-spacing: .075em;
                text-transform: uppercase;
            }
            .homeeasy-account-divider {
                height: 1px;
                margin: 0 8px 7px;
                background: rgba(60,60,67,.10);
                transform: scaleY(.5);
                transform-origin: center;
            }
            .homeeasy-account-action {
                width: 100%;
                min-height: 46px;
                padding: 0 12px;
                border: 0;
                border-radius: 13px;
                display: flex;
                align-items: center;
                gap: 11px;
                background: transparent;
                color: #393336;
                text-decoration: none;
                text-align: left;
                font-size: .76rem;
                font-weight: 620;
                transition: background .16s ease, color .16s ease, transform .16s ease;
            }
            .homeeasy-account-action i {
                width: 22px;
                color: #a6455a;
                text-align: center;
                font-size: .88rem;
            }
            .homeeasy-account-action:active { transform: scale(.985); background: #f6f1f3; }
            .homeeasy-account-action.logout { color: #a33e55; }
            .homeeasy-account-action.logout i { color: #a33e55; }
            .homeeasy-account-action:disabled { opacity: .55; cursor: wait; }
            @media (any-hover:hover) and (any-pointer:fine) {
                .homeeasy-account-trigger:hover {
                    transform: translateY(-3px) scale(1.025);
                    border-color: rgba(166,69,90,.18);
                    box-shadow: 0 13px 30px rgba(42,32,36,.14);
                }
                .homeeasy-account-action:hover { background: #f8f4f5; color: #a6455a; }
            }
            @media (max-width: 430px) {
                #${MENU_ID} { right: -56px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .homeeasy-account-trigger, #${MENU_ID}, .homeeasy-account-action { transition-duration: .01ms !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function syncGreeting(profile) {
        const greeting = document.getElementById('homeGreeting');
        const name = firstName(profile && profile.nombre);
        if (!greeting || !name) return;

        const apply = () => {
            const raw = clean(greeting.textContent, 80) || 'Hola';
            const base = raw.replace(/,\s*[^,]+$/, '').trim();
            greeting.textContent = base + ', ' + name;
        };

        apply();
        // El Index también calcula el saludo según la hora. Se vuelve a aplicar
        // después para conservar "Buenos días/tardes/noches, Alejandro".
        window.setTimeout(apply, 80);
        window.setTimeout(apply, 650);
    }

    function closeMenu() {
        const menu = document.getElementById(MENU_ID);
        const trigger = document.getElementById('homeeasyLogoutButton');
        if (menu) menu.classList.remove('open');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    function toggleMenu() {
        const menu = document.getElementById(MENU_ID);
        const trigger = document.getElementById('homeeasyLogoutButton');
        if (!menu || !trigger) return;
        const opening = !menu.classList.contains('open');
        menu.classList.toggle('open', opening);
        trigger.setAttribute('aria-expanded', String(opening));
    }

    async function logout(button) {
        if (button && button.disabled) return;
        if (button) button.disabled = true;
        try {
            if (window.HomeEasyAuth && typeof window.HomeEasyAuth.signOut === 'function') {
                await window.HomeEasyAuth.signOut({
                    meta: window.HomeEasyCore && typeof window.HomeEasyCore.buildMeta === 'function'
                        ? window.HomeEasyCore.buildMeta()
                        : {}
                });
            }
        } finally {
            if (window.HomeEasyCore && typeof window.HomeEasyCore.clearSensitiveBrowserCaches === 'function') {
                window.HomeEasyCore.clearSensitiveBrowserCaches();
            }
            window.location.replace('login.html');
        }
    }

    function mount(profile) {
        currentProfile = profile || currentProfile || (window.HomeEasyAuth && window.HomeEasyAuth.getCurrentProfile ? window.HomeEasyAuth.getCurrentProfile() : null);
        if (!currentProfile) return;

        const install = () => {
            const topActions = document.querySelector('.top-actions');
            if (!topActions) return;

            const old = document.getElementById(CONTROL_ID);
            if (old) old.remove();
            // El id homeeasyLogoutButton evita que el guard 3A monte el botón
            // provisional de salida; ahora este trigger representa la cuenta.
            const provisional = document.getElementById('homeeasyLogoutButton');
            if (provisional) provisional.remove();

            addStyles();

            const name = clean(currentProfile.nombre, 160) || 'Usuario HomeEasy';
            const email = clean(currentProfile.email, 180);
            const role = roleLabel(currentProfile.rol);
            const avatarText = initials(name, email);

            const control = document.createElement('div');
            control.id = CONTROL_ID;

            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.id = 'homeeasyLogoutButton';
            trigger.className = 'homeeasy-account-trigger';
            trigger.setAttribute('aria-label', 'Abrir mi cuenta');
            trigger.setAttribute('aria-haspopup', 'menu');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.innerHTML = '<span class="homeeasy-account-avatar" aria-hidden="true"></span>';
            trigger.querySelector('.homeeasy-account-avatar').textContent = avatarText;

            const menu = document.createElement('div');
            menu.id = MENU_ID;
            menu.setAttribute('role', 'menu');
            menu.innerHTML = `
                <div class="homeeasy-account-profile">
                    <div class="homeeasy-account-profile-top">
                        <div class="homeeasy-account-profile-avatar" aria-hidden="true"></div>
                        <div class="homeeasy-account-profile-copy">
                            <div class="homeeasy-account-profile-name"></div>
                            <div class="homeeasy-account-profile-email"></div>
                        </div>
                    </div>
                    <div class="homeeasy-account-role"></div>
                </div>
                <div class="homeeasy-account-divider"></div>
                <a class="homeeasy-account-action" href="configuracion.html" role="menuitem">
                    <i class="fa-solid fa-gear" aria-hidden="true"></i><span>Configuración</span>
                </a>
                <button class="homeeasy-account-action logout" type="button" role="menuitem">
                    <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i><span>Cerrar sesión</span>
                </button>
            `;
            menu.querySelector('.homeeasy-account-profile-avatar').textContent = avatarText;
            menu.querySelector('.homeeasy-account-profile-name').textContent = name;
            menu.querySelector('.homeeasy-account-profile-email').textContent = email;
            menu.querySelector('.homeeasy-account-role').textContent = role;

            control.append(trigger, menu);
            topActions.insertBefore(control, topActions.firstChild);

            trigger.addEventListener('click', event => {
                event.stopPropagation();
                toggleMenu();
            });
            menu.addEventListener('click', event => event.stopPropagation());
            menu.querySelector('.logout').addEventListener('click', event => logout(event.currentTarget));

            syncGreeting(currentProfile);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', install, { once: true });
        } else {
            install();
        }
    }

    window.addEventListener('homeeasy:index-auth-ready', event => {
        mount(event && event.detail ? event.detail.profile : null);
    });

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMenu();
    });

    // Recuperación defensiva para recargas en las que la sesión ya estaba lista.
    window.setTimeout(() => {
        if (!document.getElementById(CONTROL_ID) && window.HomeEasyAuth && window.HomeEasyAuth.getCurrentProfile) {
            mount(window.HomeEasyAuth.getCurrentProfile());
        }
    }, 1200);
})();
