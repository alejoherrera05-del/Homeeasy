from pathlib import Path


def _newline_for(data: bytes) -> str:
    return "\r\n" if b"\r\n" in data else "\n"


def replace_block(path: str, old: str, new: str, count: int = 1) -> None:
    p = Path(path)
    data = p.read_bytes()
    nl = _newline_for(data)
    old_bytes = old.replace("\n", nl).encode("utf-8")
    new_bytes = new.replace("\n", nl).encode("utf-8")
    found = data.count(old_bytes)
    if found < count:
        raise SystemExit(f"Expected block not found in {path}: needed {count}, found {found}")
    p.write_bytes(data.replace(old_bytes, new_bytes, count))


def replace_token(path: str, old: str, new: str, *, required: bool = True) -> int:
    p = Path(path)
    data = p.read_bytes()
    old_bytes = old.encode("utf-8")
    found = data.count(old_bytes)
    if required and found == 0:
        raise SystemExit(f"Expected token not found in {path}: {old}")
    if found:
        p.write_bytes(data.replace(old_bytes, new.encode("utf-8")))
    return found


# -----------------------------------------------------------------------------
# 1. HomeEasy session bridge 3.3
# -----------------------------------------------------------------------------
replace_token("homeeasy-auth-config.js", "session stability bridge v3.2", "session stability bridge v3.3")
replace_token("homeeasy-auth-config.js", "__HOMEEASY_SESSION_STABILITY_V32__", "__HOMEEASY_SESSION_STABILITY_V33__")
replace_token("homeeasy-auth-config.js", "__SESSION_STABILITY_BRIDGE__: '3.2'", "__SESSION_STABILITY_BRIDGE__: '3.3'")

replace_block(
    "homeeasy-auth-config.js",
    """                    } catch (error) {
                        if (transient(error)) throw error;
                        if (!opts.reopen) {
                            if (opts.silent) return null;
                            throw error;
                        }
                    }
                }

                if (!opts.reopen) return null;
""",
    """                    } catch (error) {
                        if (transient(error)) throw error;
                        const code = String(error && error.code || '').trim().toUpperCase();
                        const mayReopen = code === 'APP_SESSION_EXPIRED' || code === 'APP_SESSION_REJECTED' || code === 'NO_SESSION';
                        if (!mayReopen) {
                            if (opts.silent) return null;
                            throw error;
                        }
                        if (!opts.reopen) {
                            if (opts.silent) return null;
                            throw error;
                        }
                    }
                }

                if (!opts.reopen) return null;
""",
)


# -----------------------------------------------------------------------------
# 2. Module guard 3.6: transparently recover ordinary session expiry
# -----------------------------------------------------------------------------
replace_token("homeeasy-page-guard.js", "HomeEasy Page Guard v3.5", "HomeEasy Page Guard v3.6")
replace_block(
    "homeeasy-page-guard.js",
    """    let pendingTimer = null;
    const pageReady = new Promise(resolve => { resolvePageReady = resolve; });
""",
    """    let pendingTimer = null;
    let sessionRecoveryPromise = null;
    const pageReady = new Promise(resolve => { resolvePageReady = resolve; });
""",
)

replace_block(
    "homeeasy-page-guard.js",
    """    function handleSecurityResponse(response) {
        try {
            response.clone().json().then(data => {
                if (!data || typeof data !== 'object') return;
                if (data.requiresLogin === true) redirectToLogin();
                else if (data.forbidden === true || data.code === 'PERMISSION_DENIED') showDenied(data.msg || 'Tu rol no tiene permiso para realizar esta acción.');
            }).catch(() => {});
        } catch (error) {}
        return response;
    }

    function installFetchBridge() {
        global.fetch = function homeEasyAuthorizedFetch(resource, init) {
            const rawUrl = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
            const options = { ...(init || {}) };
            const method = String(options.method || (resource && resource.method) || 'GET').toUpperCase();
            const targetsHomeEasy = rawUrl.startsWith(API_URL);
            if (!targetsHomeEasy) return nativeFetch(resource, options);

            let isAuth = false;
            let finalUrl = rawUrl;
            if (method === 'POST') isAuth = enrichPost(options).isAuth;
            if (method === 'GET') finalUrl = buildMetaQuery(rawUrl);

            const execute = () => nativeFetch(finalUrl || resource, options).then(handleSecurityResponse);
            if (isAuth) return execute();
            return pageReady.then(allowed => {
                if (!allowed) throw new Error('PERMISSION_DENIED');
                return execute();
            });
        };
    }
""",
    """    async function readSecurityPayload(response) {
        try {
            const data = await response.clone().json();
            return data && typeof data === 'object' ? data : null;
        } catch (error) {
            return null;
        }
    }

    function authErrorCode(error) {
        return String(error && error.code || '').trim().toUpperCase();
    }

    function isRecoverableSessionError(error) {
        const code = authErrorCode(error);
        return code === 'APP_SESSION_EXPIRED' || code === 'APP_SESSION_REJECTED' || code === 'NO_SESSION';
    }

    async function recoverOperationalSession() {
        const auth = global.HomeEasyAuth;
        if (!auth || typeof auth.restoreHomeEasySession !== 'function') return false;
        if (sessionRecoveryPromise) return sessionRecoveryPromise;

        sessionRecoveryPromise = (async () => {
            try {
                const recovered = await auth.restoreHomeEasySession({
                    validateFirebase: false,
                    reopen: true,
                    silent: false,
                    preferCache: false,
                    meta: global.HomeEasyCore && global.HomeEasyCore.buildMeta ? global.HomeEasyCore.buildMeta() : {}
                });
                if (!recovered) return false;
                if (!auth.hasPermission(requiredPermission)) {
                    showDenied('Tu rol cambió y ya no tiene acceso a este módulo.');
                    return false;
                }
                return true;
            } catch (error) {
                if (isTransientAuthError(error)) {
                    showConnectionIssue(error);
                    return null;
                }
                console.warn('HomeEasy: no fue posible recuperar la sesión operativa.', error);
                return false;
            } finally {
                sessionRecoveryPromise = null;
            }
        })();
        return sessionRecoveryPromise;
    }

    function installFetchBridge() {
        global.fetch = function homeEasyAuthorizedFetch(resource, init) {
            const rawUrl = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
            const options = { ...(init || {}) };
            const method = String(options.method || (resource && resource.method) || 'GET').toUpperCase();
            const targetsHomeEasy = rawUrl.startsWith(API_URL);
            if (!targetsHomeEasy) return nativeFetch(resource, options);

            let isAuth = false;
            if (method === 'POST') isAuth = enrichPost(options).isAuth;

            const execute = async (allowRecovery) => {
                if (method === 'POST' && !isAuth) enrichPost(options);
                const finalUrl = method === 'GET' ? buildMetaQuery(rawUrl) : rawUrl;
                const response = await nativeFetch(finalUrl || resource, options);
                const data = await readSecurityPayload(response);

                if (data && data.requiresLogin === true) {
                    if (allowRecovery) {
                        const recovered = await recoverOperationalSession();
                        if (recovered === true) return execute(false);
                        if (recovered === null) return response;
                    }
                    redirectToLogin();
                } else if (data && (data.forbidden === true || data.code === 'PERMISSION_DENIED')) {
                    showDenied(data.msg || 'Tu rol no tiene permiso para realizar esta acción.');
                }
                return response;
            };

            if (isAuth) return execute(false);
            return pageReady.then(allowed => {
                if (!allowed) throw new Error('PERMISSION_DENIED');
                return execute(true);
            });
        };
    }
""",
)

replace_block(
    "homeeasy-page-guard.js",
    """    function revalidateInBackground() {
        const auth = global.HomeEasyAuth;
        if (!auth || !auth.validateAppSession) return;
        if (auth.shouldRevalidateAppSession && !auth.shouldRevalidateAppSession(REVALIDATE_AFTER_MS)) return;
        auth.validateAppSession({ meta: global.HomeEasyCore && global.HomeEasyCore.buildMeta ? global.HomeEasyCore.buildMeta() : {} })
            .then(() => {
                if (!auth.hasPermission(requiredPermission)) showDenied('Tu rol cambió y ya no tiene acceso a este módulo.');
            })
            .catch(error => {
                if (isTransientAuthError(error)) {
                    console.warn('HomeEasy: revalidación del módulo aplazada por conexión.', error);
                    return;
                }
                redirectToLogin();
            });
    }
""",
    """    function revalidateInBackground() {
        const auth = global.HomeEasyAuth;
        if (!auth || !auth.validateAppSession) return;
        if (auth.shouldRevalidateAppSession && !auth.shouldRevalidateAppSession(REVALIDATE_AFTER_MS)) return;
        auth.validateAppSession({ meta: global.HomeEasyCore && global.HomeEasyCore.buildMeta ? global.HomeEasyCore.buildMeta() : {} })
            .then(() => {
                if (!auth.hasPermission(requiredPermission)) showDenied('Tu rol cambió y ya no tiene acceso a este módulo.');
            })
            .catch(async error => {
                if (isTransientAuthError(error)) {
                    console.warn('HomeEasy: revalidación del módulo aplazada por conexión.', error);
                    return;
                }
                if (isRecoverableSessionError(error)) {
                    const recovered = await recoverOperationalSession();
                    if (recovered !== false) return;
                }
                redirectToLogin();
            });
    }
""",
)
replace_token("homeeasy-page-guard.js", "homeeasy-auth-config.js?v=3.2", "homeeasy-auth-config.js?v=3.3")


# -----------------------------------------------------------------------------
# 3. Index Core 3.5: same transparent recovery semantics
# -----------------------------------------------------------------------------
replace_token("homeeasy-core.js", "HomeEasy Core v3.4", "HomeEasy Core v3.5")
replace_token("homeeasy-core.js", "const APP_VERSION = '3.4';", "const APP_VERSION = '3.5';")
replace_token("homeeasy-core.js", "homeeasy-auth-config.js?v=3.1", "homeeasy-auth-config.js?v=3.3")
replace_block(
    "homeeasy-core.js",
    """            if (global.HomeEasyAuth.shouldRevalidateAppSession && global.HomeEasyAuth.shouldRevalidateAppSession(5 * 60 * 1000)) {
                global.HomeEasyAuth.validateAppSession({ meta: buildMeta() }).catch(error => {
                    if (isTransientAuthError(error)) {
                        console.warn('HomeEasy: revalidación del Index aplazada por conexión.', error);
                        return;
                    }
                    redirectIndexToLogin();
                });
            }
""",
    """            if (global.HomeEasyAuth.shouldRevalidateAppSession && global.HomeEasyAuth.shouldRevalidateAppSession(5 * 60 * 1000)) {
                global.HomeEasyAuth.validateAppSession({ meta: buildMeta() }).catch(async error => {
                    if (isTransientAuthError(error)) {
                        console.warn('HomeEasy: revalidación del Index aplazada por conexión.', error);
                        return;
                    }
                    const code = String(error && error.code || '').trim().toUpperCase();
                    const mayRecover = code === 'APP_SESSION_EXPIRED' || code === 'APP_SESSION_REJECTED' || code === 'NO_SESSION';
                    if (mayRecover && global.HomeEasyAuth.restoreHomeEasySession) {
                        try {
                            const recovered = await global.HomeEasyAuth.restoreHomeEasySession({
                                validateFirebase: false,
                                reopen: true,
                                silent: false,
                                preferCache: false,
                                meta: buildMeta()
                            });
                            if (recovered) {
                                const refreshedProfile = global.HomeEasyAuth.getCurrentProfile();
                                if (refreshedProfile) setOperator(refreshedProfile.nombre || refreshedProfile.email || 'Sin identificar');
                                return;
                            }
                        } catch (recoveryError) {
                            if (isTransientAuthError(recoveryError)) {
                                showIndexConnectionIssue(recoveryError);
                                return;
                            }
                        }
                    }
                    redirectIndexToLogin();
                });
            }
""",
)


# -----------------------------------------------------------------------------
# 4. iOS/Safari cache bust without normalizing or reformatting legacy HTML
# -----------------------------------------------------------------------------
PROTECTED = (
    "Hommychat.html",
    "perfil.html",
    "caja.html",
    "abono.html",
    "ventas.html",
    "pedido.html",
    "reportes.html",
    "seguimiento.html",
    "clientes.html",
    "cotizacion.html",
    "documentos.html",
    "calendario.html",
    "configuracion.html",
)

for name in PROTECTED:
    replace_token(name, "homeeasy-page-guard.js?v=3.4", "homeeasy-page-guard.js?v=3.6")
    replace_token(name, "homeeasy-core.js?v=3.4", "homeeasy-core.js?v=3.5")

replace_token("index.html", "homeeasy-core.js?v=3.4", "homeeasy-core.js?v=3.5")
replace_token("login.html", "homeeasy-auth-config.js?v=3.1", "homeeasy-auth-config.js?v=3.3")
replace_token("activar-cuenta.html", "homeeasy-auth-config.js?v=3.1", "homeeasy-auth-config.js?v=3.3")

# Remove navigation-only traces of the retired Hommy page, while preserving bytes.
for name in ("homeeasy-account.js", "homeeasy-account-template.js"):
    if Path(name).exists():
        replace_token(name, "        'asistente.html': 'app.access',\r\n", "", required=False)
        replace_token(name, "        'asistente.html': 'app.access',\n", "", required=False)
        replace_token(name, "        'asistente.html': 'app.access'\r\n", "", required=False)
        replace_token(name, "        'asistente.html': 'app.access'\n", "", required=False)


# -----------------------------------------------------------------------------
# 5. Static acceptance checks
# -----------------------------------------------------------------------------
for name in PROTECTED:
    data = Path(name).read_bytes()
    assert b"homeeasy-page-guard.js?v=3.6" in data, name
    assert b"homeeasy-core.js?v=3.5" in data, name
    assert b"homeeasy-page-guard.js?v=3.4" not in data, name

assert b"recoverOperationalSession" in Path("homeeasy-page-guard.js").read_bytes()
assert b"homeeasy-auth-config.js?v=3.3" in Path("homeeasy-page-guard.js").read_bytes()
assert b"homeeasy-auth-config.js?v=3.3" in Path("homeeasy-core.js").read_bytes()
assert b"__SESSION_STABILITY_BRIDGE__: '3.3'" in Path("homeeasy-auth-config.js").read_bytes()
assert b"asistente.html" not in Path("homeeasy-page-guard.js").read_bytes()

print("HomeEasy byte-safe stability hotfix prepared successfully")
