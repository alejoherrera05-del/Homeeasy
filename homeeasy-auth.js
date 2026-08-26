/**
 * HomeEasy Auth v0.3.0
 * Firebase Authentication + sesión general emitida por el Cerebro HomeEasy.
 *
 * - Usa únicamente las API REST oficiales de Firebase; no añade SDK externo.
 * - Mantiene la sesión por pestaña de forma predeterminada.
 * - Renueva automáticamente el ID token de Firebase.
 * - Intercambia el ID token por una sesión opaca de HomeEasy.
 * - Vincula la sesión de HomeEasy al usuario, rol y dispositivo.
 * - No ofrece registro público.
 */
(function (global) {
    'use strict';

    const VERSION = '0.3.0';
    const STORAGE_KEY = 'HOMEEASY_AUTH_SESSION_V1';
    const DEVICE_ID_KEY = 'HOMEEASY_DEVICE_ID';
    const DEVICE_NAME_KEY = 'HOMEEASY_DEVICE_NAME';
    const AUTH_EVENT = 'homeeasy:auth-change';
    const EXPIRY_SKEW_MS = 2 * 60 * 1000;
    const REQUEST_TIMEOUT_MS = 25000;
    const APP_SESSION_REVALIDATE_MS = 5 * 60 * 1000;
    const APP_SESSION_EXPIRY_SKEW_MS = 30 * 1000;
    const VALID_PERSISTENCE = new Set(['session', 'local']);

    const rawConfig = global.HOMEEASY_AUTH_CONFIG || {};
    const config = Object.freeze({
        enabled: rawConfig.enabled === true,
        apiKey: String(rawConfig.apiKey || '').trim(),
        projectId: String(rawConfig.projectId || '').trim(),
        backendUrl: String(rawConfig.backendUrl || '').trim(),
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
            /^https:\/\//i.test(config.backendUrl) &&
            !/PENDIENTE|REEMPLAZAR|YOUR_/i.test(config.apiKey + config.projectId + config.backendUrl)
        );
    }

    function ensureConfigured() {
        if (!isConfigured()) {
            throw new HomeEasyAuthError(
                'AUTH_NOT_CONFIGURED',
                'El acceso seguro todavía no está conectado por completo.'
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

    function normalizeProfile(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            uid: String(source.uid || '').trim(),
            nombre: String(source.nombre || '').trim().slice(0, 160),
            email: normalizeEmail(source.email),
            rol: String(source.rol || '').trim().toUpperCase(),
            estado: String(source.estado || '').trim().toUpperCase(),
            emailVerificado: source.emailVerificado === true,
            ultimoAcceso: source.ultimoAcceso || '',
            ultimoDispositivo: String(source.ultimoDispositivo || '').trim().slice(0, 160)
        };
    }

    function normalizePermissions(value) {
        if (!Array.isArray(value)) return [];
        return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean))).slice(0, 120);
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
            version: 2,
            persistence,
            localId: String(session.localId || ''),
            email: normalizeEmail(session.email),
            displayName: String(session.displayName || '').trim().slice(0, 160),
            idToken: String(session.idToken || ''),
            refreshToken: String(session.refreshToken || ''),
            expiresAt: Number(session.expiresAt || 0),
            appSessionToken: String(session.appSessionToken || ''),
            appSessionExpiresAt: session.appSessionExpiresAt || '',
            appSessionValidatedAt: Number(session.appSessionValidatedAt || 0),
            profile: normalizeProfile(session.profile),
            permissions: normalizePermissions(session.permissions),
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

    function updateStoredSession(changes) {
        const current = readStoredSession();
        if (!current) throw new HomeEasyAuthError('NO_SESSION', 'No hay una sesión activa.');
        return storeSession({ ...current, ...(changes || {}) });
    }

    function clearAppSessionOnly() {
        const current = readStoredSession();
        if (!current) return null;
        return storeSession({
            ...current,
            appSessionToken: '',
            appSessionExpiresAt: '',
            appSessionValidatedAt: 0,
            profile: {},
            permissions: []
        });
    }

    function createUuid() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
            const random = Math.random() * 16 | 0;
            const value = character === 'x' ? random : (random & 0x3 | 0x8);
            return value.toString(16);
        });
    }

    function detectBrowser() {
        const ua = global.navigator && global.navigator.userAgent ? global.navigator.userAgent : '';
        if (/Edg\//.test(ua)) return 'Microsoft Edge';
        if (/OPR\//.test(ua)) return 'Opera';
        if (/CriOS\//.test(ua)) return 'Chrome';
        if (/FxiOS\//.test(ua)) return 'Firefox';
        if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
        if (/Firefox\//.test(ua)) return 'Firefox';
        if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
        return 'Navegador';
    }

    function detectPlatform() {
        const nav = global.navigator || {};
        const ua = nav.userAgent || '';
        const platform = nav.userAgentData && nav.userAgentData.platform
            ? nav.userAgentData.platform
            : (nav.platform || '');
        if (/iPad/i.test(ua) || (/Mac/i.test(platform) && Number(nav.maxTouchPoints || 0) > 1)) return 'iPad';
        if (/iPhone/i.test(ua)) return 'iPhone';
        if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android' : 'Tablet Android';
        if (/Win/i.test(platform)) return 'PC Windows';
        if (/Mac/i.test(platform)) return 'Mac';
        if (/Linux/i.test(platform)) return 'Linux';
        return 'Dispositivo';
    }

    function getDeviceId() {
        let id = safeGet(global.localStorage, DEVICE_ID_KEY);
        if (!id) {
            id = createUuid();
            safeSet(global.localStorage, DEVICE_ID_KEY, id);
        }
        return id;
    }

    function getDeviceName() {
        return safeGet(global.localStorage, DEVICE_NAME_KEY) || (detectPlatform() + ' · ' + detectBrowser());
    }

    function buildMeta(extra) {
        const current = readStoredSession();
        const profile = current ? normalizeProfile(current.profile) : {};
        const page = global.location && global.location.pathname
            ? (global.location.pathname.split('/').pop() || 'index.html')
            : 'index.html';
        return {
            operador: profile.nombre || profile.email || (current && current.displayName) || 'Sin identificar',
            usuarioUid: profile.uid || (current && current.localId) || '',
            usuarioRol: profile.rol || '',
            dispositivoId: getDeviceId(),
            dispositivoNombre: getDeviceName(),
            plataforma: detectPlatform(),
            navegador: detectBrowser(),
            pagina: page,
            versionApp: '2.9A',
            horaCliente: new Date().toISOString(),
            ...(extra && typeof extra === 'object' ? extra : {})
        };
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
                detail: Object.freeze({
                    type,
                    user: user || null,
                    profile: getCurrentProfile(),
                    timestamp: Date.now()
                })
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
            FIREBASE_USER_DISABLED: 'Esta cuenta está desactivada. Comunícate con un administrador.',
            USER_NOT_INVITED: 'Esta cuenta todavía no está autorizada en HomeEasy.',
            TOO_MANY_ATTEMPTS_TRY_LATER: 'Se hicieron demasiados intentos. Intenta nuevamente más tarde.',
            OPERATION_NOT_ALLOWED: 'El acceso por correo y contraseña todavía no está habilitado.',
            INVALID_EMAIL: 'Revisa el formato del correo electrónico.',
            WEAK_PASSWORD: 'La nueva contraseña no cumple la política de seguridad.',
            TOKEN_EXPIRED: 'Tu sesión venció. Ingresa nuevamente.',
            INVALID_REFRESH_TOKEN: 'Tu sesión venció. Ingresa nuevamente.',
            USER_NOT_FOUND: 'Tu sesión ya no es válida. Ingresa nuevamente.',
            PROJECT_NUMBER_MISMATCH: 'La configuración de autenticación no corresponde a este proyecto.',
            PROJECT_MISMATCH: 'La configuración de autenticación no corresponde a HomeEasy.',
            INVALID_ID_TOKEN: 'Tu sesión venció. Ingresa nuevamente.',
            API_KEY_INVALID: 'La configuración de Firebase no es válida.',
            CONFIGURATION_NOT_FOUND: 'La configuración de Firebase no está completa.',
            AUTH_NOT_CONFIGURED: 'El acceso seguro todavía no está configurado por completo.',
            APP_SESSION_EXPIRED: 'La sesión de HomeEasy venció. Ingresa nuevamente.',
            APP_SESSION_REVOKED: 'La sesión fue cerrada por un cambio de seguridad.',
            DEVICE_MISMATCH: 'Esta sesión pertenece a otro dispositivo.'
        };
        return messages[normalized] || 'No fue posible completar la autenticación.';
    }

    function extractFirebaseCode(payload, status) {
        const raw = payload && payload.error && payload.error.message
            ? String(payload.error.message)
            : (status ? 'HTTP_' + status : 'AUTH_ERROR');
        return raw.split(' : ')[0].trim().replace(/\s+/g, '_').toUpperCase();
    }

    async function requestFirebase(url, options) {
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

    async function requestBackend(payload, options) {
        ensureConfigured();
        const controller = new AbortController();
        const timeoutMs = Number(options && options.timeoutMs) || REQUEST_TIMEOUT_MS;
        const timer = global.setTimeout(() => controller.abort(), timeoutMs);
        const requestId = payload && payload.requestId ? String(payload.requestId) : createUuid();
        const body = {
            ...(payload || {}),
            requestId,
            meta: buildMeta({
                ...(payload && payload.meta && typeof payload.meta === 'object' ? payload.meta : {}),
                requestId
            })
        };

        try {
            const response = await global.fetch(config.backendUrl, {
                method: 'POST',
                // Sin Content-Type personalizado: conserva compatibilidad CORS con Apps Script.
                body: JSON.stringify(body),
                cache: 'no-store',
                redirect: 'follow',
                signal: controller.signal
            });
            const raw = await response.text();
            const data = raw ? parseJson(raw) : null;
            if (!response.ok || !data) {
                throw new HomeEasyAuthError('BACKEND_INVALID_RESPONSE', 'HomeEasy devolvió una respuesta que no se pudo leer.');
            }
            return data;
        } catch (error) {
            if (error instanceof HomeEasyAuthError) throw error;
            if (error && error.name === 'AbortError') {
                throw new HomeEasyAuthError('BACKEND_TIMEOUT', 'HomeEasy tardó demasiado en responder. Intenta nuevamente.');
            }
            throw new HomeEasyAuthError('BACKEND_NETWORK_ERROR', 'No fue posible conectarse con HomeEasy. Revisa internet e intenta nuevamente.', error);
        } finally {
            global.clearTimeout(timer);
        }
    }

    function sessionFromSignIn(payload, persistence, preserved) {
        const expiresInSeconds = Math.max(60, Number(payload.expiresIn || 3600));
        const session = {
            ...(preserved || {}),
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

        const payload = await requestFirebase(firebaseEndpoint('signInWithPassword'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: cleanEmail,
                password: cleanPassword,
                returnSecureToken: true
            })
        });

        const session = sessionFromSignIn(payload, persistence, {
            appSessionToken: '',
            appSessionExpiresAt: '',
            profile: {},
            permissions: []
        });
        const user = sessionToUser(session);
        emitAuthChange('firebase-signed-in', user);

        if (!options || options.openAppSession !== false) {
            try {
                await openAppSession({ meta: options && options.meta ? options.meta : {} });
            } catch (error) {
                clearStoredSessions();
                emitAuthChange('session-rejected', null);
                throw error;
            }
        }
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
            const payload = await requestFirebase(tokenEndpoint(), {
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

        const payload = await requestFirebase(firebaseEndpoint('lookup'), {
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

    async function restoreFirebaseSession(options) {
        ensureConfigured();
        const opts = { validate: false, ...(options || {}) };
        const stored = readStoredSession();
        if (!stored) return null;

        try {
            await getIdToken();
            const user = opts.validate ? await fetchAccount() : sessionToUser(readStoredSession());
            if (user) emitAuthChange('firebase-restored', user);
            return user;
        } catch (error) {
            clearStoredSessions();
            emitAuthChange('session-expired', null);
            return null;
        }
    }

    async function restoreSession(options) {
        const opts = { validate: false, homeEasy: true, silent: true, meta: {}, preferCache: true, ...(options || {}) };
        const user = await restoreFirebaseSession({ validate: opts.validate });
        if (!user || opts.homeEasy === false) return user;

        try {
            if (opts.preferCache !== false && getCachedHomeEasySession()) return user;
            const current = readStoredSession();
            if (current && current.appSessionToken) await validateAppSession({ meta: opts.meta });
            else await openAppSession({ meta: opts.meta });
            return user;
        } catch (error) {
            clearStoredSessions();
            emitAuthChange('session-rejected', null);
            if (opts.silent) return null;
            throw error;
        }
    }

    async function openAppSession(options) {
        ensureConfigured();
        const opts = options || {};
        const idToken = await getIdToken();
        if (!idToken) throw new HomeEasyAuthError('NO_SESSION', 'Ingresa nuevamente para abrir HomeEasy.');

        const response = await requestBackend({
            tipo: 'AUTH_ABRIR_SESION',
            firebaseIdToken: idToken,
            meta: opts.meta || {}
        });
        if (!response || response.status !== 'success' || !response.valido || !response.appSessionToken) {
            const code = response && response.code ? response.code : 'APP_SESSION_REJECTED';
            throw new HomeEasyAuthError(code, (response && response.msg) || friendlyMessage(code), response);
        }

        const stored = updateStoredSession({
            appSessionToken: response.appSessionToken,
            appSessionExpiresAt: response.expiresAt || '',
            appSessionValidatedAt: Date.now(),
            profile: response.perfil || {},
            permissions: response.permisos || []
        });
        const profile = normalizeProfile(stored.profile);
        emitAuthChange('signed-in', sessionToUser(stored));
        return Object.freeze({
            profile,
            permissions: normalizePermissions(stored.permissions),
            expiresAt: stored.appSessionExpiresAt
        });
    }

    async function validateAppSession(options) {
        const opts = options || {};
        const current = readStoredSession();
        if (!current || !current.appSessionToken) return null;

        const response = await requestBackend({
            tipo: 'AUTH_VALIDAR_SESION',
            appSessionToken: current.appSessionToken,
            meta: opts.meta || {}
        });
        if (!response || response.status !== 'success' || !response.valido) {
            clearAppSessionOnly();
            const code = response && response.code ? response.code : 'APP_SESSION_EXPIRED';
            throw new HomeEasyAuthError(code, (response && response.msg) || friendlyMessage(code), response);
        }

        const stored = updateStoredSession({
            appSessionExpiresAt: response.expiresAt || current.appSessionExpiresAt || '',
            appSessionValidatedAt: Date.now(),
            profile: response.perfil || current.profile || {},
            permissions: response.permisos || current.permissions || []
        });
        return Object.freeze({
            profile: normalizeProfile(stored.profile),
            permissions: normalizePermissions(stored.permissions),
            expiresAt: stored.appSessionExpiresAt
        });
    }

    async function restoreHomeEasySession(options) {
        const opts = { validateFirebase: false, reopen: true, silent: false, meta: {}, preferCache: true, ...(options || {}) };
        const user = await restoreFirebaseSession({ validate: opts.validateFirebase });
        if (!user) return null;

        if (opts.preferCache !== false) {
            const cached = getCachedHomeEasySession();
            if (cached) return cached;
        }

        const current = readStoredSession();
        if (current && current.appSessionToken) {
            try { return await validateAppSession({ meta: opts.meta }); }
            catch (error) {
                if (!opts.reopen) {
                    if (opts.silent) return null;
                    throw error;
                }
            }
        }

        if (!opts.reopen) return null;
        try { return await openAppSession({ meta: opts.meta }); }
        catch (error) {
            clearStoredSessions();
            emitAuthChange('session-rejected', null);
            if (opts.silent) return null;
            throw error;
        }
    }

    function getCurrentUser() {
        const session = readStoredSession();
        if (!session || !validateProjectAudience(session.idToken)) return null;
        return sessionToUser(session);
    }

    function getCurrentProfile() {
        const session = readStoredSession();
        if (!session || !session.appSessionToken) return null;
        const profile = normalizeProfile(session.profile);
        return profile.uid ? Object.freeze(profile) : null;
    }

    function getPermissions() {
        const session = readStoredSession();
        return Object.freeze(normalizePermissions(session && session.permissions));
    }

    function hasPermission(permission) {
        const required = String(permission || '').trim();
        if (!required) return false;
        const permissions = getPermissions();
        return permissions.includes('*') || permissions.includes(required);
    }

    function getAppSessionToken() {
        const session = readStoredSession();
        return session ? String(session.appSessionToken || '') : '';
    }

    function parseExpiryMs(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value > 100000000000 ? value : value * 1000;
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric > 100000000000 ? numeric : numeric * 1000;
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function getCachedHomeEasySession() {
        const current = readStoredSession();
        if (!current || !current.appSessionToken || !validateProjectAudience(current.idToken)) return null;
        if (!current.expiresAt || current.expiresAt <= Date.now() + APP_SESSION_EXPIRY_SKEW_MS) return null;
        const appExpiry = parseExpiryMs(current.appSessionExpiresAt);
        if (appExpiry && appExpiry <= Date.now() + APP_SESSION_EXPIRY_SKEW_MS) return null;
        const profile = normalizeProfile(current.profile);
        if (!profile.uid || profile.estado === 'INACTIVO') return null;
        return Object.freeze({
            profile,
            permissions: normalizePermissions(current.permissions),
            expiresAt: current.appSessionExpiresAt,
            validatedAt: Number(current.appSessionValidatedAt || 0),
            cached: true
        });
    }

    function shouldRevalidateAppSession(maxAgeMs) {
        const cached = getCachedHomeEasySession();
        if (!cached) return true;
        const maxAge = Math.max(30000, Number(maxAgeMs || APP_SESSION_REVALIDATE_MS));
        return !cached.validatedAt || Date.now() - cached.validatedAt >= maxAge;
    }

    async function signOut(options) {
        const opts = { notifyBackend: true, meta: {}, ...(options || {}) };
        const current = readStoredSession();
        if (opts.notifyBackend && current && current.appSessionToken && isConfigured()) {
            try {
                await requestBackend({
                    tipo: 'AUTH_CERRAR_SESION',
                    appSessionToken: current.appSessionToken,
                    meta: opts.meta || {}
                }, { timeoutMs: 12000 });
            } catch (error) {}
        }
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
            await requestFirebase(firebaseEndpoint('sendOobCode'), {
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

        const payload = await requestFirebase(firebaseEndpoint('update'), {
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
        }, current.persistence, {
            appSessionToken: current.appSessionToken,
            appSessionExpiresAt: current.appSessionExpiresAt,
            appSessionValidatedAt: current.appSessionValidatedAt || Date.now(),
            profile: current.profile,
            permissions: current.permissions
        });
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
            const basePath = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
            if (!resolved.pathname.startsWith(basePath)) return defaultValue;
            return resolved.pathname.slice(basePath.length) + resolved.search + resolved.hash;
        } catch (error) {
            return defaultValue;
        }
    }

    function buildLoginUrl(returnUrl) {
        const login = new URL(config.loginPath, global.location.href);
        const currentTarget = global.location.pathname.split('/').pop() + global.location.search + global.location.hash;
        const target = safeReturnUrl(returnUrl || currentTarget, config.homePath);
        login.searchParams.set('return', target);
        return login.href;
    }

    function redirectToLogin(returnUrl) {
        global.location.replace(buildLoginUrl(returnUrl));
    }

    async function requireAuth(options) {
        const opts = { redirect: true, validateFirebase: false, returnUrl: '', permission: '', meta: {}, ...(options || {}) };
        const result = await restoreHomeEasySession({
            validateFirebase: opts.validateFirebase,
            reopen: true,
            silent: true,
            meta: opts.meta
        });
        const authorized = Boolean(result && (!opts.permission || hasPermission(opts.permission)));
        if (!authorized && opts.redirect) redirectToLogin(opts.returnUrl);
        return authorized ? result : null;
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
        restoreHomeEasySession,
        requireAuth,
        refreshSession,
        getIdToken,
        getCurrentUser,
        getCurrentProfile,
        getPermissions,
        hasPermission,
        getAppSessionToken,
        getCachedHomeEasySession,
        shouldRevalidateAppSession,
        fetchAccount,
        openAppSession,
        validateAppSession,
        requestBackend,
        sendPasswordReset,
        changePassword,
        buildMeta,
        safeReturnUrl,
        buildLoginUrl,
        redirectToLogin,
        onAuthChange
    });
})(window);
