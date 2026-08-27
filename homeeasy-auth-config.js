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
    defaultPersistence: 'session',
    activationPath: 'activar-cuenta.html'
});
