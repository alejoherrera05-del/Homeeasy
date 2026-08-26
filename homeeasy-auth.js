/**
 * HomeEasy Auth v0.1.0
 * Firebase Authentication client through the official REST API.
 *
 * Goals for this first isolated stage:
 * - Email/password sign-in without adding a third-party JavaScript SDK.
 * - Session persistence by tab by default; optional trusted-device persistence.
 * - Automatic ID-token renewal using the Firebase refresh token.
 * - Password-reset email and current-user password change.
 * - No changes to the active HomeEasy modules until the backend authorization
 *   layer is ready.
 */
(function (global) {
    'use strict';

    const VERSION = '0.1.0';
    const STORAGE_KEY = 'HOMEEASY_AUTH_SESSION_V1';
    const AUTH_EVENT = 'homeeasy:auth-change';
    const EXPIRY_SKEW_MS = 2 * 60 * 1000;
    const REQUEST_TIMEOUT_MS = 25000;
    const VALID_PERSISTENCE = new Set(['session', 'local']);

    const rawConfig = global.HOMEEASY_AUTH_CONFIG || {};
    const config = Object.freeze({
        enabled: rawConfig.enabled === true,
        apiKey: String(rawConfig.apiKey || '').trim(),
        projectId: String(rawConfig.projectId || '').trim(),
        loginPath: String(rawConfig.loginPath || 'login.html').trim() || 'login.html',
        homePath: String(rawConfig.homePath || 'index.html').trim() || 'index.html',
        defaultPersistence: VALID_PERSISTENCE.has(rawConfig.defaultPersistence)
            ? rawConfig.defaultPersistence
            : 'session'
    });

    class HomeEasyAuthError extends Error {
        constructor(code, message, details) {
            super(message || 'No fue posible completar la autenticación.');
            this.name = 'HomeEasyAuthError';
            this.code = String(code || 'AUTH_ERROR');
            this.details = details || null;
        }
    }

    function getStorage(type) {
        return type === 'local' ? global.localStorage : global.sessionStorage;
    }

    function safeGet(storage, key) {
        try {
            return storage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    function safeSet(storage, key, value) {
        try {
            storage.setItem(key, value);
            return true;
        } catch (error) {
            return false;
        }
    }

    function safeRemove(storage, key) {
        try {
            storage.removeItem(key);
        } catch (error) {}
    }

    function clearStoredSessions() {
        safeRemove(global.sessionStorage, STORAGE_KEY);
        safeRemove(global.localStorage, STORAGE_KEY);
    }

    function isConfigured() {
        return Boolean(
            config.enabled &&
            config.apiKey &&
            config.projectId &&
            !/PENDIENTE|REEMPLAZAR|YOUR_/i.test(config.apiKey + config.projectId)
        );
    }

    function ensureConfigured() {
        if (!isConfigured()) {
            throw new HomeEasyAuthError(
                'AUTH_NOT_CONFIGURED',
                'El acceso seguro todavía no está conectado al proyecto de Firebase.'
            );
        }
    }

    function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
    }

    function normalizePersistence(value) {
        return VALID_PERSISTENCE.has(value) ? value : config.defaultPersistence;
    }

    function parseJson(value) {
        try {
            return JSON.parse(value);
        } catch (error) {
            return null;
        }
    }

    function readStoredSession() {
        const sessionRaw = safeGet(global.sessionStorage, STORAGE_KEY);
        if (sessionRaw) {
            const parsed = parseJson(sessionRaw);
            if (parsed && parsed.refreshToken && parsed.persistence === 'session') return parsed;
            safeRemove(global.sessionStorage, STORAGE_KEY);
        }

        const localRaw = safeGet(global.localStorage, STORAGE_KEY);
        if (localRaw) {
            const parsed = parseJson(localRaw);
            if (parsed && parsed.refreshToken && parsed.persistence === 'local') return parsed;
            safeRemove(global.localStorage, STORAGE_KEY);
        }
        return null;
    }

    function storeSession(session) {
        const persistence = normalizePersistence(session && session.persistence);
        const normalized = {
            version: 1,
            persistence,
            localId: String(session.localId || ''),
            email: normalizeEmail(session.email),
            displayName: String(session.displayName || '').trim(),
            idToken: String(session.idToken || ''),
            refreshToken: String(session.refreshToken || ''),
            expiresAt: Number(session.expiresAt || 0),
            savedAt: Date.now()
        };

        if (!normalized.refreshToken || !normalized.idToken || !normalized.localId) {
            throw new HomeEasyAuthError('INVALID_SESSION', 'La sesión recibida no es válida.');
        }

        clearStoredSessions();
        const stored = safeSet(getStorage(persistence), STORAGE_KEY, JSON.stringify(normalized));
        if (!stored) {
            throw new HomeEasyAuthError(
                'STORAGE_UNAVAILABLE',
                'El navegador no permitió guardar la sesión. Revisa el modo privado o la configuración de almacenamiento.'
            );
        }
        return normalized;
    }

    function base64UrlDecode(value) {
        const input = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
        const padded = input + '='.repeat((4 - input.length % 4) % 4);
        try {
            return decodeURIComponent(Array.prototype.map.call(global.atob(padded), character => {
                return '%' + ('00' + character.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
        } catch (error) {
            return '';
        }
    }

    function decodeIdToken(token) {
        const parts = String(token || '').split('.');
        if (parts.length !== 3) return null;
        return parseJson(base64UrlDecode(parts[1]));
    }

    function validateProjectAudience(token) {
        const payload = decodeIdToken(token);
        if (!payload) return false;
        const audience = String(payload.aud || '');
        const issuer = String(payload.iss || '');
        return audience === config.projectId && issuer === 'https://securetoken.google.com/' + config.projectId;
    }

    function sessionToUser(session) {
        if (!session) return null;
        const payload = decodeIdToken(session.idToken) || {};
        return Object.freeze({
            uid: String(session.localId || payload.user_id || payload.sub || ''),
            email: normalizeEmail(session.email || payload.email),
            displayName: String(session.displayName || payload.name || '').trim(),
            emailVerified: payload.email_verified === true,
            persistence: session.persistence,
            expiresAt: Number(session.expiresAt || 0)
        });
    }

    function emitAuthChange(type, user) {
        try {
            global.dispatchEvent(new CustomEvent(AUTH_EVENT, {
                detail: Object.freeze({ type, user: user || null, timestamp: Date.now() })
            }));
        } catch (error) {}
    }

    function firebaseEndpoint(action) {
        return 'https://identitytoolkit.googleapis.com/v1/accounts:' + action + '?key=' + encodeURIComponent(config.apiKey);
    }

    function tokenEndpoint() {
        return 'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(config.apiKey);
    }

    function friendlyMessage(code) {
        const normalized = String(code || '').toUpperCase();
        const messages = {
            INVALID_LOGIN_CREDENTIALS: 'Correo o contraseña incorrectos.',
            EMAIL_NOT_FOUND: 'Correo o contraseña incorrectos.',
            INVALID_PASSWORD: 'Correo o contraseña incorrectos.',
            USER_DISABLED: 'Esta cuenta está desactivada. Comunícate con un administrador.',
            TOO_MANY_ATTEMPTS_TRY_LATER: 'Se hicieron demasiados intentos. Intenta nuevamente más tarde.',
            OPERATION_NOT_ALLOWED: 'El acceso por correo y contraseña todavía no está habilitado.',
            INVALID_EMAIL: 'Revisa el formato del correo electrónico.',
            WEAK_PASSWORD: 'La nueva contraseña no cumple la política de seguridad.',
            TOKEN_EXPIRED: 'Tu sesión venció. Ingresa nuevamente.',
            INVALID_REFRESH_TOKEN: 'Tu sesión venció. Ingresa nuevamente.',
            USER_NOT_FOUND: 'Tu sesión ya no es válida. Ingresa nuevamente.',
            PROJECT_NUMBER_MISMATCH: 'La configuración de autenticación no corresponde a este proyecto.',
            INVALID_ID_TOKEN: 'Tu sesión venció. Ingresa nuevamente.',
            API_KEY_INVALID: 'La configuración de Firebase no es válida.',
            CONFIGURATION_NOT_FOUND: 'La configuración de Firebase no está completa.'
        };
        return messages[normalized] || 'No fue posible completar la autenticación.';
    }

    function extractFirebaseCode(payload, status) {
        const raw = payload && payload.error && payload.error.message
            ? String(payload.error.message)
            : (status ? 'HTTP_' + status : 'AUTH_ERROR');
        return raw.split(' : ')[0].trim().replace(/\s+/g, '_').toUpperCase();
    }

    async function request(url, options) {
        const controller = new AbortController();
        const timer = global.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await global.fetch(url, {
                cache: 'no-store',
                redirect: 'follow',
                ...options,
                signal: controller.signal
            });
            const raw = await response.text();
            const payload = raw ? parseJson(raw) : {};

            if (!response.ok || !payload) {
                const code = extractFirebaseCode(payload, response.status);
                throw new HomeEasyAuthError(code, friendlyMessage(code), payload);
            }
            return payload;
        } catch (error) {
            if (error instanceof HomeEasyAuthError) throw error;
            if (error && error.name === 'AbortError') {
                throw new HomeEasyAuthError(
                    'AUTH_TIMEOUT',
                    'La conexión tardó demasiado. Revisa internet e intenta nuevamente.'
                );
            }
            throw new HomeEasyAuthError(
                'AUTH_NETWORK_ERROR',
                'No fue posible conectarse al servicio de acceso. Revisa internet e intenta nuevamente.',
                error
            );
        } finally {
            global.clearTimeout(timer);
        }
    }

    function sessionFromSignIn(payload, persistence) {
        const expiresInSeconds = Math.max(60, Number(payload.expiresIn || 3600));
        const session = {
            persistence: normalizePersistence(persistence),
            localId: payload.localId,
            email: payload.email,
            displayName: payload.displayName,
            idToken: payload.idToken,
            refreshToken: payload.refreshToken,
            expiresAt: Date.now() + expiresInSeconds * 1000
        };

        if (!validateProjectAudience(session.idToken)) {
            throw new HomeEasyAuthError(
                'PROJECT_MISMATCH',
                'La sesión recibida no corresponde al proyecto HomeEasy configurado.'
            );
        }
        return storeSession(session);
    }

    async function signIn(email, password, options) {
        ensureConfigured();
        const cleanEmail = normalizeEmail(email);
        const cleanPassword = String(password || '');
        const persistence = options && options.remember === true ? 'local' : 'session';

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            throw new HomeEasyAuthError('INVALID_EMAIL', friendlyMessage('INVALID_EMAIL'));
        }
        if (!cleanPassword) {
            throw new HomeEasyAuthError('MISSING_PASSWORD', 'Escribe tu contraseña.');
        }

        const payload = await request(firebaseEndpoint('signInWithPassword'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: cleanEmail,
                password: cleanPassword,
                returnSecureToken: true
            })
        });

        const session = sessionFromSignIn(payload, persistence);
        const user = sessionToUser(session);
        emitAuthChange('signed-in', user);
        return user;
    }

    async function refreshSession(currentSession) {
        ensureConfigured();
        const session = currentSession || readStoredSession();
        if (!session || !session.refreshToken) {
            throw new HomeEasyAuthError('NO_SESSION', 'No hay una sesión activa.');
        }

        const form = new URLSearchParams();
        form.set('grant_type', 'refresh_token');
        form.set('refresh_token', session.refreshToken);

        try {
            const payload = await request(tokenEndpoint(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form.toString()
            });

            const refreshed = storeSession({
                ...session,
                localId: payload.user_id || session.localId,
                idToken: payload.id_token,
                refreshToken: payload.refresh_token || session.refreshToken,
                expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000
            });

            if (!validateProjectAudience(refreshed.idToken)) {
                clearStoredSessions();
                throw new HomeEasyAuthError('PROJECT_MISMATCH', 'La sesión renovada no corresponde a HomeEasy.');
            }
            return refreshed;
        } catch (error) {
            if (['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED', 'USER_NOT_FOUND', 'PROJECT_NUMBER_MISMATCH'].includes(error.code)) {
                clearStoredSessions();
                emitAuthChange('session-expired', null);
            }
            throw error;
        }
    }

    async function getIdToken(options) {
        const opts = { forceRefresh: false, ...(options || {}) };
        let session = readStoredSession();
        if (!session) return '';

        if (!validateProjectAudience(session.idToken)) {
            clearStoredSessions();
            emitAuthChange('invalid-session', null);
            return '';
        }

        const needsRefresh = opts.forceRefresh || !session.expiresAt || session.expiresAt <= Date.now() + EXPIRY_SKEW_MS;
        if (needsRefresh) session = await refreshSession(session);
        return session.idToken;
    }

    async function fetchAccount() {
        const idToken = await getIdToken();
        if (!idToken) return null;

        const payload = await request(firebaseEndpoint('lookup'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
        });
        const account = Array.isArray(payload.users) ? payload.users[0] : null;
        if (!account) {
            clearStoredSessions();
            emitAuthChange('invalid-session', null);
            return null;
        }

        const current = readStoredSession();
        if (!current) return null;
        const stored = storeSession({
            ...current,
            localId: account.localId || current.localId,
            email: account.email || current.email,
            displayName: account.displayName || current.displayName
        });
        return Object.freeze({
            ...sessionToUser(stored),
            emailVerified: account.emailVerified === true,
            disabled: account.disabled === true,
            createdAt: account.createdAt ? Number(account.createdAt) : null,
            lastLoginAt: account.lastLoginAt ? Number(account.lastLoginAt) : null
        });
    }

    async function restoreSession(options) {
        ensureConfigured();
        const opts = { validate: false, ...(options || {}) };
        const stored = readStoredSession();
        if (!stored) return null;

        try {
            await getIdToken();
            const user = opts.validate ? await fetchAccount() : sessionToUser(readStoredSession());
            if (user) emitAuthChange('restored', user);
            return user;
        } catch (error) {
            clearStoredSessions();
            emitAuthChange('session-expired', null);
            return null;
        }
    }

    function getCurrentUser() {
        const session = readStoredSession();
        if (!session || !validateProjectAudience(session.idToken)) return null;
        return sessionToUser(session);
    }

    async function signOut() {
        clearStoredSessions();
        emitAuthChange('signed-out', null);
    }

    async function sendPasswordReset(email) {
        ensureConfigured();
        const cleanEmail = normalizeEmail(email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            throw new HomeEasyAuthError('INVALID_EMAIL', friendlyMessage('INVALID_EMAIL'));
        }

        try {
            await request(firebaseEndpoint('sendOobCode'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Firebase-Locale': 'es'
                },
                body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: cleanEmail })
            });
        } catch (error) {
            // Do not reveal whether a particular email exists.
            if (error.code !== 'EMAIL_NOT_FOUND') throw error;
        }
        return true;
    }

    async function changePassword(newPassword) {
        ensureConfigured();
        const password = String(newPassword || '');
        if (password.length < 8) {
            throw new HomeEasyAuthError(
                'WEAK_PASSWORD',
                'La contraseña debe tener al menos 8 caracteres.'
            );
        }

        const idToken = await getIdToken({ forceRefresh: true });
        if (!idToken) throw new HomeEasyAuthError('NO_SESSION', 'Ingresa nuevamente para cambiar la contraseña.');

        const payload = await request(firebaseEndpoint('update'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, password, returnSecureToken: true })
        });

        const current = readStoredSession();
        if (!current) throw new HomeEasyAuthError('NO_SESSION', 'La sesión ya no está disponible.');
        const session = sessionFromSignIn({
            ...payload,
            localId: payload.localId || current.localId,
            email: payload.email || current.email,
            displayName: payload.displayName || current.displayName,
            refreshToken: payload.refreshToken || current.refreshToken,
            expiresIn: payload.expiresIn || 3600
        }, current.persistence);
        const user = sessionToUser(session);
        emitAuthChange('password-changed', user);
        return user;
    }

    function safeReturnUrl(value, fallback) {
        const defaultValue = String(fallback || config.homePath || 'index.html');
        const raw = String(value || '').trim();
        if (!raw) return defaultValue;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\\\\)/i.test(raw)) return defaultValue;
        if (raw.includes('\0')) return defaultValue;

        try {
            const resolved = new URL(raw, global.location.href);
            if (resolved.origin !== global.location.origin) return defaultValue;
            const currentPath = global.location.pathname;
            if (resolved.pathname === currentPath && resolved.search === global.location.search) return defaultValue;
            return resolved.pathname.split('/').pop() + resolved.search + resolved.hash;
        } catch (error) {
            return defaultValue;
        }
    }

    function buildLoginUrl(returnUrl) {
        const login = new URL(config.loginPath, global.location.href);
        const target = safeReturnUrl(returnUrl || (global.location.pathname.split('/').pop() + global.location.search + global.location.hash), config.homePath);
        login.searchParams.set('return', target);
        return login.href;
    }

    function redirectToLogin(returnUrl) {
        global.location.replace(buildLoginUrl(returnUrl));
    }

    async function requireAuth(options) {
        const opts = { redirect: true, validate: false, returnUrl: '', ...(options || {}) };
        const user = await restoreSession({ validate: opts.validate });
        if (!user && opts.redirect) redirectToLogin(opts.returnUrl);
        return user;
    }

    function onAuthChange(listener) {
        if (typeof listener !== 'function') return function noop() {};
        const handler = event => listener(event.detail);
        global.addEventListener(AUTH_EVENT, handler);
        return () => global.removeEventListener(AUTH_EVENT, handler);
    }

    global.HomeEasyAuth = Object.freeze({
        VERSION,
        config,
        HomeEasyAuthError,
        isConfigured,
        signIn,
        signOut,
        restoreSession,
        requireAuth,
        refreshSession,
        getIdToken,
        getCurrentUser,
        fetchAccount,
        sendPasswordReset,
        changePassword,
        safeReturnUrl,
        buildLoginUrl,
        redirectToLogin,
        onAuthChange
    });
})(window);
