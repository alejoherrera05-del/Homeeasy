from pathlib import Path
import subprocess

CORE_EXPECTED = "f03d35310b36daedebdf853c50004746c85662b5"
INDEX_EXPECTED = "9b43807a579ebf95c4669c44503ab0ebffe4946f"


def blob_sha(path):
    return subprocess.check_output(["git", "hash-object", path], text=True).strip()


def once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing expected block: {label}")
    return text.replace(old, new, 1)


if blob_sha("homeeasy-core.js") != CORE_EXPECTED:
    raise SystemExit("homeeasy-core.js baseline changed; refusing to patch")
if blob_sha("index.html") != INDEX_EXPECTED:
    raise SystemExit("index.html baseline changed; refusing to patch")

core_path = Path("homeeasy-core.js")
core = core_path.read_text(encoding="utf-8")
core = core.replace(" * HomeEasy Core v2.5", " * HomeEasy Core v3.3", 1)
core = core.replace("    const APP_VERSION = '2.5';", "    const APP_VERSION = '3.3';", 1)
core = once(
    core,
    "    const AUTH_LOGOUT_STYLE_ID = 'homeeasy-auth-logout-style';",
    "    const AUTH_LOGOUT_STYLE_ID = 'homeeasy-auth-logout-style';\n"
    "    const FAST_RETURN_STYLE_ID = 'homeeasy-fast-home-return-style';\n"
    "    const AUTH_SESSION_STORAGE_KEY = 'HOMEEASY_AUTH_SESSION_V1';\n"
    "    const INTERNAL_HOME_RETURN_KEY = 'HOMEEASY_INTERNAL_HOME_RETURN_V1';",
    "core constants",
)

helpers = r'''    function readStorageValue(storage, key) {
        try { return storage.getItem(key) || ''; } catch (error) { return ''; }
    }

    function writeSessionValue(key, value) {
        try { global.sessionStorage.setItem(key, String(value)); } catch (error) {}
    }

    function removeSessionValue(key) {
        try { global.sessionStorage.removeItem(key); } catch (error) {}
    }

    function parseStoredAuthSession(raw) {
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function getStoredAuthSessionSnapshot() {
        return parseStoredAuthSession(readStorageValue(global.sessionStorage, AUTH_SESSION_STORAGE_KEY))
            || parseStoredAuthSession(readStorageValue(global.localStorage, AUTH_SESSION_STORAGE_KEY));
    }

    function hasFreshCachedAppSession() {
        const session = getStoredAuthSessionSnapshot();
        if (!session || !session.appSessionToken) return false;
        const expiresAt = Date.parse(session.appSessionExpiresAt || '');
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30000) return false;
        const validatedAt = Number(session.appSessionValidatedAt || 0);
        return validatedAt > 0 && Date.now() - validatedAt <= 5 * 60 * 1000;
    }

    function cameFromInternalModule() {
        try {
            if (!global.document || !global.document.referrer) return false;
            const previous = new URL(global.document.referrer, global.location.href);
            const current = new URL(global.location.href);
            const page = (previous.pathname.split('/').pop() || '').toLowerCase();
            if (previous.origin !== current.origin || !page) return false;
            return page !== 'index.html' && page !== 'login.html' && page !== 'activar-cuenta.html';
        } catch (error) {
            return false;
        }
    }

    function isFastHomeReturn() {
        if (!INDEX_AUTH_PROTECTED) return false;
        const appWasOpened = readStorageValue(global.sessionStorage, 'APP_INIT_DONE') === 'true';
        const explicitReturn = readStorageValue(global.sessionStorage, INTERNAL_HOME_RETURN_KEY) === '1';
        return (appWasOpened || explicitReturn || cameFromInternalModule()) && hasFreshCachedAppSession();
    }

    function installFastHomeReturnStyle() {
        if (!isFastHomeReturn() || !global.document || !global.document.head) return;
        if (global.document.getElementById(FAST_RETURN_STYLE_ID)) return;
        const style = global.document.createElement('style');
        style.id = FAST_RETURN_STYLE_ID;
        style.textContent = '#intro-curtain{display:none!important}';
        global.document.head.appendChild(style);
    }

'''
core = once(core, "    const nativeFetch = global.fetch.bind(global);\n", helpers + "    const nativeFetch = global.fetch.bind(global);\n", "fast-return helpers")

core = once(
    core,
    "    function scheduleIndexPending() {\n        clearTimeout(indexPendingTimer);\n        indexPendingTimer = global.setTimeout(showIndexPending, 220);\n    }",
    "    function scheduleIndexPending() {\n        clearTimeout(indexPendingTimer);\n        if (isFastHomeReturn()) return;\n        indexPendingTimer = global.setTimeout(showIndexPending, 220);\n    }",
    "pending suppression",
)

nav = r'''    function markInternalHomeReturn() {
        writeSessionValue('APP_INIT_DONE', 'true');
        writeSessionValue(INTERNAL_HOME_RETURN_KEY, '1');
    }

    function goHome() {
        markInternalHomeReturn();
        let previousWasIndex = false;
        try {
            if (global.document && global.document.referrer) {
                const previous = new URL(global.document.referrer, global.location.href);
                const current = new URL(global.location.href);
                const previousPage = (previous.pathname.split('/').pop() || 'index.html').toLowerCase();
                previousWasIndex = previous.origin === current.origin && previousPage === 'index.html';
            }
        } catch (error) {}

        if (previousWasIndex && global.history && global.history.length > 1) {
            global.history.back();
            return;
        }
        global.location.assign('index.html');
    }

    function installInternalHomeNavigation() {
        if (!global.document || INDEX_AUTH_PROTECTED) return;
        const install = () => {
            global.document.addEventListener('click', event => {
                if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                const target = event.target && event.target.closest ? event.target.closest('a[href]') : null;
                if (!target || target.target === '_blank' || target.hasAttribute('download')) return;
                let url;
                try { url = new URL(target.getAttribute('href'), global.location.href); } catch (error) { return; }
                const current = new URL(global.location.href);
                const page = (url.pathname.split('/').pop() || 'index.html').toLowerCase();
                if (url.origin !== current.origin || page !== 'index.html') return;
                event.preventDefault();
                goHome();
            }, true);
        };
        if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', install, { once: true });
        else install();
    }

'''
core = once(core, "    function installLogoutControl() {\n", nav + "    function installLogoutControl() {\n", "home navigation")

core = once(
    core,
    "        if (global.document && global.document.documentElement) {\n            global.document.documentElement.classList.remove(AUTH_PENDING_CLASS);\n        }\n        try {",
    "        if (global.document && global.document.documentElement) {\n            global.document.documentElement.classList.remove(AUTH_PENDING_CLASS);\n        }\n        removeSessionValue(INTERNAL_HOME_RETURN_KEY);\n        try {",
    "return marker cleanup",
)

core = once(
    core,
    "        createRequestId: createUuid,\n        indexAuthProtected: INDEX_AUTH_PROTECTED\n    });\n\n    installIndexAuthGuard();",
    "        createRequestId: createUuid,\n        indexAuthProtected: INDEX_AUTH_PROTECTED,\n        goHome\n    });\n\n    installFastHomeReturnStyle();\n    installInternalHomeNavigation();\n    installIndexAuthGuard();",
    "core exports",
)
core_path.write_text(core, encoding="utf-8")

# Preserve every existing byte/line ending in legacy HTML files. Only the exact
# cache-busting token and Caja PIN back action are replaced.
changed_html = []
core_old = b"homeeasy-core.js?v=3.1"
core_new = b"homeeasy-core.js?v=3.3"
caja_old = b"onclick=\"window.location.href='index.html'\""
caja_new = b"onclick=\"window.HomeEasyCore&&HomeEasyCore.goHome?HomeEasyCore.goHome():(window.location.href='index.html')\""

for path in Path(".").glob("*.html"):
    data = path.read_bytes()
    updated = data.replace(core_old, core_new)
    if path.name == "caja.html":
        updated = updated.replace(caja_old, caja_new)
    if updated != data:
        path.write_bytes(updated)
        changed_html.append(path.name)

print("HTML cache-busted:", ", ".join(changed_html))
