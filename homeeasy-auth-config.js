/**
 * HomeEasy Auth configuration.
 *
 * This file intentionally contains no credentials yet. Firebase Web API keys
 * identify a Firebase project but are not passwords; nevertheless, configure
 * API restrictions in Google Cloud before enabling production access.
 */
window.HOMEEASY_AUTH_CONFIG = Object.freeze({
    enabled: false,
    apiKey: '',
    projectId: '',
    loginPath: 'login.html',
    homePath: 'index.html',
    defaultPersistence: 'session'
});
