/**
 * HomeEasy Auth configuration.
 *
 * Firebase Web API configurada para el proyecto gratuito HomeEasy Auth.
 * Autenticación habilitada únicamente en la rama aislada feature/auth-rbac.
 * El Cerebro permanece en modo PREPARACION: no bloquea las rutas antiguas.
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

(function installApprovedLoginVisuals() {
    'use strict';

    const path = String(window.location && window.location.pathname || '');
    if (!/(^|\/)login\.html$/i.test(path)) return;

    const style = document.createElement('style');
    style.id = 'homeeasy-login-phase2b';
    style.textContent = `
        :root {
            --bg-desktop: url('assets/auth/login-bg-desktop.webp') !important;
            --bg-mobile: url('assets/auth/login-bg-mobile.webp') !important;
        }
        body {
            background-image: linear-gradient(rgba(249,249,250,.035), rgba(249,249,250,.035)), var(--bg-desktop) !important;
            background-size: cover !important;
            background-position: center !important;
        }
        .brand-panel {
            background: linear-gradient(148deg, #b6526a 0%, #a6455a 46%, #843548 100%) !important;
        }
        .hommy-hero {
            left: 50% !important;
            bottom: -3% !important;
            width: min(610px, 132%) !important;
            transform: translateX(-54%) !important;
            object-fit: contain !important;
            object-position: center bottom !important;
            filter: drop-shadow(0 32px 42px rgba(70,18,35,.35)) drop-shadow(0 8px 16px rgba(70,18,35,.18)) !important;
        }
        @media (max-width: 930px) {
            body {
                background-image: linear-gradient(rgba(249,249,250,.025), rgba(249,249,250,.025)), var(--bg-mobile) !important;
                background-size: cover !important;
                background-position: center !important;
                background-attachment: scroll !important;
            }
        }
    `;
    document.head.appendChild(style);

    document.addEventListener('DOMContentLoaded', function () {
        const hommy = document.querySelector('.hommy-hero');
        if (hommy) {
            hommy.src = 'assets/auth/hommy-crossed.webp';
            hommy.removeAttribute('onerror');
        }
    }, { once: true });
})();
