from pathlib import Path
import subprocess

EXPECTED={
 'homeeasy-auth.js':'b940017e3aaa0c57e090877faf38aaa62b444469',
 'homeeasy-core.js':'f01216afae5f8d0019c8dae4323c53936aad6f9c',
 'homeeasy-page-guard.js':'e891c8560b9cd0e49c3260757c13aa3f9fe2f3bb',
}

def sha(p): return subprocess.check_output(['git','hash-object',p],text=True).strip()
def once(text,old,new,label):
    if old not in text: raise SystemExit('Missing expected block: '+label)
    return text.replace(old,new,1)
for p,s in EXPECTED.items():
    if sha(p)!=s: raise SystemExit(f'{p} baseline changed: {sha(p)} != {s}')

# ---------- AUTH 0.4.1 ----------
p=Path('homeeasy-auth.js'); t=p.read_text(encoding='utf-8')
t=t.replace('HomeEasy Auth v0.4.0','HomeEasy Auth v0.4.1',1)
t=t.replace("const VERSION = '0.4.0';","const VERSION = '0.4.1';",1)
t=t.replace("versionApp: '3.1',","versionApp: '3.4',",1)
marker="""    class HomeEasyAuthError extends Error {
        constructor(code, message, details) {
            super(message || 'No fue posible completar la autenticación.');
            this.name = 'HomeEasyAuthError';
            this.code = String(code || 'AUTH_ERROR');
            this.details = details || null;
        }
    }

"""
insert=marker+"""    const TRANSIENT_ERROR_CODES = new Set([
        'AUTH_TIMEOUT',
        'AUTH_NETWORK_ERROR',
        'BACKEND_TIMEOUT',
        'BACKEND_NETWORK_ERROR',
        'BACKEND_INVALID_RESPONSE'
    ]);

    function isTransientError(error) {
        const code = String(error && error.code || '').trim().toUpperCase();
        if (TRANSIENT_ERROR_CODES.has(code)) return true;
        if (/^(?:HTTP_)?5\\d\\d$/.test(code)) return true;
        const name = String(error && error.name || '').toUpperCase();
        return name === 'ABORTERROR' || name === 'NETWORKERROR';
    }

"""
t=once(t,marker,insert,'auth transient classifier')
old="""            } catch (error) {
                clearStoredSessions();
                emitAuthChange('session-rejected', null);
                throw error;
            }
"""
new="""            } catch (error) {
                // Una caída temporal del Cerebro no invalida las credenciales de Firebase.
                // Conservamos la identidad para que el usuario pueda reintentar sin perder sesión.
                if (!isTransientError(error)) {
                    clearStoredSessions();
                    emitAuthChange('session-rejected', null);
                }
                throw error;
            }
"""
t=once(t,old,new,'signIn app session failure')
old="""            try { return await validateAppSession({ meta: opts.meta }); }
            catch (error) {
                if (!opts.reopen) {
                    if (opts.silent) return null;
                    throw error;
                }
            }
"""
new="""            try { return await validateAppSession({ meta: opts.meta }); }
            catch (error) {
                // No convertimos una caída de red en una revocación de sesión.
                // Además evitamos golpear el mismo backend dos veces seguidas mientras está caído.
                if (isTransientError(error)) throw error;
                if (!opts.reopen) {
                    if (opts.silent) return null;
                    throw error;
                }
            }
"""
t=once(t,old,new,'restore validation transient')
old="""        try { return await openAppSession({ meta: opts.meta }); }
        catch (error) {
            clearStoredSessions();
            emitAuthChange('session-rejected', null);
            if (opts.silent) return null;
            throw error;
        }
"""
new="""        try { return await openAppSession({ meta: opts.meta }); }
        catch (error) {
            if (!isTransientError(error)) {
                clearStoredSessions();
                emitAuthChange('session-rejected', null);
                if (opts.silent) return null;
            }
            // Los errores transitorios se propagan para que la UI muestre recuperación,
            // sin destruir la sesión ni redirigir al login.
            throw error;
        }
"""
t=once(t,old,new,'restore open session transient')
old="""        redirectToLogin,
        onAuthChange
"""
new="""        redirectToLogin,
        isTransientError,
        onAuthChange
"""
t=once(t,old,new,'auth export transient')
p.write_text(t,encoding='utf-8')

# ---------- CORE 3.4 ----------
p=Path('homeeasy-core.js'); t=p.read_text(encoding='utf-8')
t=t.replace('HomeEasy Core v3.3','HomeEasy Core v3.4',1)
t=t.replace("const APP_VERSION = '3.3';","const APP_VERSION = '3.4';",1)
t=t.replace("'homeeasy-auth.js?v=3.1'","'homeeasy-auth.js?v=3.4'",1)
old="""    function hasFreshCachedAppSession() {
        const session = getStoredAuthSessionSnapshot();
        if (!session || !session.appSessionToken) return false;
        const expiresAt = Date.parse(session.appSessionExpiresAt || '');
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30000) return false;
        return true;
    }
"""
new="""    function parseExpiryMs(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value > 100000000000 ? value : value * 1000;
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric > 100000000000 ? numeric : numeric * 1000;
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function hasFreshCachedAppSession() {
        const session = getStoredAuthSessionSnapshot();
        if (!session || !session.appSessionToken) return false;
        if (!Number(session.expiresAt || 0) || Number(session.expiresAt) <= Date.now() + 30000) return false;
        const appExpiry = parseExpiryMs(session.appSessionExpiresAt);
        if (!appExpiry || appExpiry <= Date.now() + 30000) return false;
        return true;
    }
"""
t=once(t,old,new,'core cached session expiry')
anchor="""    function redirectIndexToLogin() {
        indexAuthStatus = 'redirecting';
        clearSensitiveBrowserCaches();
        setOperator('Sin identificar');
        if (global.HomeEasyAuth && typeof global.HomeEasyAuth.redirectToLogin === 'function') {
            global.HomeEasyAuth.redirectToLogin('index.html');
            return;
        }
        const fallback = new URL('login.html', global.location.href);
        fallback.searchParams.set('return', 'index.html');
        global.location.replace(fallback.href);
    }

"""
insert=anchor+"""    function isTransientAuthError(error) {
        return Boolean(global.HomeEasyAuth && typeof global.HomeEasyAuth.isTransientError === 'function' && global.HomeEasyAuth.isTransientError(error));
    }

    function showIndexConnectionIssue(error) {
        indexAuthStatus = 'network-error';
        clearTimeout(indexPendingTimer);
        if (global.document && global.document.documentElement) global.document.documentElement.classList.remove(AUTH_PENDING_CLASS);
        const render = () => {
            if (!global.document || !global.document.body || global.document.getElementById('homeeasyIndexConnectionIssue')) return;
            const box = global.document.createElement('div');
            box.id = 'homeeasyIndexConnectionIssue';
            box.setAttribute('role', 'alert');
            box.style.cssText = 'position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;background:rgba(242,242,247,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#252125';
            box.innerHTML = '<section style="width:min(430px,100%);padding:28px;border-radius:24px;background:#fff;box-shadow:0 22px 60px rgba(45,35,40,.14);text-align:center"><div style="font-size:30px;margin-bottom:12px">↻</div><h1 style="margin:0;font-size:1.35rem;letter-spacing:-.035em">Conexión interrumpida</h1><p style="margin:10px auto 20px;max-width:34ch;color:#777075;font-size:.84rem;line-height:1.5">Tu sesión sigue guardada. HomeEasy no pudo verificarla en este momento.</p><button id="homeeasyRetryIndex" style="width:100%;height:50px;border:0;border-radius:14px;background:#a6455a;color:#fff;font-weight:720">Reintentar</button></section>';
            global.document.body.appendChild(box);
            global.document.getElementById('homeeasyRetryIndex').addEventListener('click', () => global.location.reload());
        };
        if (global.document && global.document.body) render();
        else if (global.document) global.document.addEventListener('DOMContentLoaded', render, { once: true });
        console.warn('HomeEasy: sesión conservada por error transitorio.', error);
    }

"""
t=once(t,anchor,insert,'core connection recovery')
old="""            if (global.HomeEasyAuth.shouldRevalidateAppSession && global.HomeEasyAuth.shouldRevalidateAppSession(5 * 60 * 1000)) {
                global.HomeEasyAuth.validateAppSession({ meta: buildMeta() }).catch(() => redirectIndexToLogin());
            }
        } catch (error) {
            console.error('HomeEasy Auth Guard:', error);
            redirectIndexToLogin();
        }
"""
new="""            if (global.HomeEasyAuth.shouldRevalidateAppSession && global.HomeEasyAuth.shouldRevalidateAppSession(5 * 60 * 1000)) {
                global.HomeEasyAuth.validateAppSession({ meta: buildMeta() }).catch(error => {
                    if (isTransientAuthError(error)) {
                        console.warn('HomeEasy: revalidación del Index aplazada por conexión.', error);
                        return;
                    }
                    redirectIndexToLogin();
                });
            }
        } catch (error) {
            console.error('HomeEasy Auth Guard:', error);
            if (isTransientAuthError(error)) {
                showIndexConnectionIssue(error);
                return;
            }
            redirectIndexToLogin();
        }
"""
t=once(t,old,new,'core validation recovery')
p.write_text(t,encoding='utf-8')

# ---------- PAGE GUARD 3.4 ----------
p=Path('homeeasy-page-guard.js'); t=p.read_text(encoding='utf-8')
t=t.replace('HomeEasy Page Guard v3.2','HomeEasy Page Guard v3.4',1)
t=t.replace("versionApp', '3.1'","versionApp', '3.4'",1)
t=t.replace("versionApp: '3.1'","versionApp: '3.4'",2)
t=t.replace("'homeeasy-auth.js?v=3.1'","'homeeasy-auth.js?v=3.4'",1)
anchor="""    function redirectToLogin() {
        if (pageAuthStatus === 'redirecting') return;
        pageAuthStatus = 'redirecting';
        reveal();
        if (global.HomeEasyCore && global.HomeEasyCore.clearSensitiveBrowserCaches) global.HomeEasyCore.clearSensitiveBrowserCaches();
        if (global.HomeEasyAuth && global.HomeEasyAuth.redirectToLogin) global.HomeEasyAuth.redirectToLogin(currentPage + global.location.search + global.location.hash);
        else {
            const url = new URL('login.html', global.location.href);
            url.searchParams.set('return', currentPage + global.location.search + global.location.hash);
            global.location.replace(url.href);
        }
    }

"""
insert=anchor+"""    function isTransientAuthError(error) {
        return Boolean(global.HomeEasyAuth && typeof global.HomeEasyAuth.isTransientError === 'function' && global.HomeEasyAuth.isTransientError(error));
    }

    function showConnectionIssue(error) {
        if (pageAuthStatus === 'network-error') return;
        pageAuthStatus = 'network-error';
        reveal();
        const render = () => {
            if (!global.document || !global.document.body || global.document.getElementById('homeeasyModuleConnectionIssue')) return;
            const overlay = global.document.createElement('div');
            overlay.id = 'homeeasyModuleConnectionIssue';
            overlay.setAttribute('role', 'alert');
            overlay.style.cssText = 'position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;background:rgba(242,242,247,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#252125';
            overlay.innerHTML = '<section style="width:min(430px,100%);padding:28px;border-radius:24px;background:#fff;box-shadow:0 22px 60px rgba(45,35,40,.14);text-align:center"><div style="font-size:30px;margin-bottom:12px">↻</div><h1 style="margin:0;font-size:1.35rem;letter-spacing:-.035em">Conexión interrumpida</h1><p style="margin:10px auto 20px;max-width:35ch;color:#777075;font-size:.84rem;line-height:1.5">No se cerró tu sesión. Reintenta cuando tengas conexión con HomeEasy.</p><button id="homeeasyRetryModule" style="width:100%;height:50px;border:0;border-radius:14px;background:#a6455a;color:#fff;font-weight:720">Reintentar</button><button id="homeeasyBackFromConnection" style="width:100%;height:46px;margin-top:8px;border:0;background:transparent;color:#a6455a;font-weight:680">Volver al Inicio</button></section>';
            global.document.body.appendChild(overlay);
            global.document.getElementById('homeeasyRetryModule').addEventListener('click', () => global.location.reload());
            global.document.getElementById('homeeasyBackFromConnection').addEventListener('click', () => {
                if (global.HomeEasyCore && typeof global.HomeEasyCore.goHome === 'function') global.HomeEasyCore.goHome();
                else global.location.assign('index.html');
            });
        };
        if (global.document && global.document.body) render();
        else if (global.document) global.document.addEventListener('DOMContentLoaded', render, { once: true });
        console.warn('HomeEasy: módulo conservado por error transitorio.', error);
    }

"""
t=once(t,anchor,insert,'guard connection recovery')
old="""        global.document.getElementById('heBackHome').addEventListener('click', () => global.location.replace('index.html'));
"""
new="""        global.document.getElementById('heBackHome').addEventListener('click', () => {
            if (global.HomeEasyCore && typeof global.HomeEasyCore.goHome === 'function') global.HomeEasyCore.goHome();
            else global.location.assign('index.html');
        });
"""
t=once(t,old,new,'guard denied back')
old="""        auth.validateAppSession({ meta: global.HomeEasyCore && global.HomeEasyCore.buildMeta ? global.HomeEasyCore.buildMeta() : {} })
            .then(() => {
                if (!auth.hasPermission(requiredPermission)) showDenied('Tu rol cambió y ya no tiene acceso a este módulo.');
            })
            .catch(() => redirectToLogin());
"""
new="""        auth.validateAppSession({ meta: global.HomeEasyCore && global.HomeEasyCore.buildMeta ? global.HomeEasyCore.buildMeta() : {} })
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
"""
t=once(t,old,new,'guard background validation')
old="""        } catch (error) {
            console.error('HomeEasy Page Guard:', error);
            redirectToLogin();
        }
"""
new="""        } catch (error) {
            console.error('HomeEasy Page Guard:', error);
            if (isTransientAuthError(error)) {
                showConnectionIssue(error);
                return;
            }
            redirectToLogin();
        }
"""
t=once(t,old,new,'guard foreground validation')
p.write_text(t,encoding='utf-8')

# ---------- cache-bust root HTML without normalizing CRLF ----------
changed=[]
for p in Path('.').glob('*.html'):
    data=p.read_bytes(); new=data
    new=new.replace(b'homeeasy-core.js?v=3.3',b'homeeasy-core.js?v=3.4')
    new=new.replace(b'homeeasy-page-guard.js?v=3.1',b'homeeasy-page-guard.js?v=3.4')
    new=new.replace(b'homeeasy-page-guard.js?v=3.2',b'homeeasy-page-guard.js?v=3.4')
    new=new.replace(b'homeeasy-auth.js?v=3.1',b'homeeasy-auth.js?v=3.4')
    if new!=data:
        p.write_bytes(new); changed.append(p.name)

print('Robustness 3.4 patched.')
print('HTML cache keys updated:', ', '.join(sorted(changed)))
