/**
 * HomeEasy Auth configuration.
 *
 * `apiKey` and `projectId` se completarán con la aplicación web gratuita
 * de Firebase. `enabled` debe permanecer en false hasta instalar y probar
 * el Cerebro HomeEasy 9A.
 */
window.HOMEEASY_AUTH_CONFIG = Object.freeze({
    enabled: false,
    apiKey: '',
    projectId: '',
    backendUrl: 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec',
    loginPath: 'login.html',
    homePath: 'index.html',
    defaultPersistence: 'session'
});
