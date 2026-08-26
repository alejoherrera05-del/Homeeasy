/**
 * HomeEasy Auth configuration.
 *
 * Firebase Web API configurada para el proyecto gratuito HomeEasy Auth.
 * `enabled` debe permanecer en false hasta instalar y probar el
 * Cerebro HomeEasy 9A en modo PREPARACION.
 */
window.HOMEEASY_AUTH_CONFIG = Object.freeze({
    enabled: false,
    apiKey: 'AIzaSyCc-kiqZ3WxpulA_fKEgNuSNLI2ofCL7eY',
    projectId: 'homeeasy-auth',
    backendUrl: 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec',
    loginPath: 'login.html',
    homePath: 'index.html',
    defaultPersistence: 'session'
});
