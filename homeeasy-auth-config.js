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
