import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../homeeasy-auth-config.js', import.meta.url), 'utf8');

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fakeJwt(projectId = 'homeeasy-auth') {
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: 'firebase-user-1',
    exp: Math.floor(Date.now() / 1000) - 120,
  })}.signature`;
}

function makeSession({ appExpired = false, projectId = 'homeeasy-auth', validatedAt = Date.now() - 10_000 } = {}) {
  return {
    version: 2,
    persistence: 'session',
    localId: 'firebase-user-1',
    email: 'qa@example.test',
    displayName: 'QA User',
    idToken: fakeJwt(projectId),
    refreshToken: 'fake-refresh-token',
    // Deliberately expired Firebase ID-token window: this reproduces the incident.
    expiresAt: Date.now() - 120_000,
    appSessionToken: 'opaque-homeeasy-session',
    appSessionExpiresAt: new Date(Date.now() + (appExpired ? -60_000 : 3_600_000)).toISOString(),
    appSessionValidatedAt: validatedAt,
    profile: {
      uid: 'homeeasy-user-1',
      nombre: 'QA User',
      email: 'qa@example.test',
      rol: 'ADMINISTRADOR',
      estado: 'ACTIVO',
    },
    permissions: ['app.access', 'clientes.read', 'documentos.read'],
    savedAt: Date.now(),
  };
}

function makeContext(session) {
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  sessionStorage.setItem('HOMEEASY_AUTH_SESSION_V1', JSON.stringify(session));

  const sandbox = {
    console,
    Date,
    Object,
    Array,
    Set,
    JSON,
    Number,
    String,
    Boolean,
    Math,
    Promise,
    decodeURIComponent,
    encodeURIComponent,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    sessionStorage,
    localStorage,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'homeeasy-auth-config.js' });
  return sandbox;
}

function authError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function testExpiredFirebaseStillUsesValidOperationalSession() {
  const sandbox = makeContext(makeSession());
  let validateCalls = 0;
  let openCalls = 0;
  let legacyRestoreCalls = 0;
  sandbox.HomeEasyAuth = Object.freeze({
    getCachedHomeEasySession: () => null,
    shouldRevalidateAppSession: () => true,
    validateAppSession: async () => { validateCalls += 1; return { validated: true }; },
    openAppSession: async () => { openCalls += 1; return { opened: true }; },
    restoreHomeEasySession: async () => { legacyRestoreCalls += 1; return { native: true }; },
    isTransientError: error => ['AUTH_TIMEOUT', 'AUTH_NETWORK_ERROR', 'BACKEND_TIMEOUT', 'BACKEND_NETWORK_ERROR', 'BACKEND_INVALID_RESPONSE'].includes(error?.code),
  });

  const cached = sandbox.HomeEasyAuth.getCachedHomeEasySession();
  assert.ok(cached, 'valid HomeEasy operational session should survive Firebase token expiry');
  assert.equal(cached.profile.uid, 'homeeasy-user-1');
  assert.equal(cached.source, 'operational-session');
  assert.equal(sandbox.HomeEasyAuth.shouldRevalidateAppSession(5 * 60 * 1000), false);

  const restored = await sandbox.HomeEasyAuth.restoreHomeEasySession({ preferCache: true });
  assert.equal(restored.profile.uid, 'homeeasy-user-1');
  assert.equal(validateCalls, 0, 'navigation must not hit backend while the operational cache is valid');
  assert.equal(openCalls, 0, 'navigation must not refresh Firebase while the operational cache is valid');
  assert.equal(legacyRestoreCalls, 0, 'legacy restore path must not run while the app session is valid');
}

async function testStaleOperationalSessionRevalidatesBeforeFirebaseRefresh() {
  const sandbox = makeContext(makeSession({ appExpired: true }));
  let validateCalls = 0;
  let openCalls = 0;
  let legacyRestoreCalls = 0;
  sandbox.HomeEasyAuth = Object.freeze({
    getCachedHomeEasySession: () => null,
    validateAppSession: async () => {
      validateCalls += 1;
      return { profile: { uid: 'homeeasy-user-1' }, permissions: ['clientes.read'] };
    },
    openAppSession: async () => { openCalls += 1; return { opened: true }; },
    restoreHomeEasySession: async () => { legacyRestoreCalls += 1; return { native: true }; },
    isTransientError: () => false,
  });

  assert.equal(sandbox.HomeEasyAuth.getCachedHomeEasySession(), null);
  const result = await sandbox.HomeEasyAuth.restoreHomeEasySession({ preferCache: true });
  assert.equal(result.profile.uid, 'homeeasy-user-1');
  assert.equal(validateCalls, 1, 'opaque HomeEasy session must be revalidated first');
  assert.equal(openCalls, 0, 'Firebase/open-session must not run when opaque session revalidates');
  assert.equal(legacyRestoreCalls, 0, 'legacy destructive restore path must be bypassed');
}

async function testTransientRevalidationNeverFallsThroughToFirebaseOrDeletesSession() {
  const initial = makeSession({ appExpired: true });
  const sandbox = makeContext(initial);
  let openCalls = 0;
  let legacyRestoreCalls = 0;
  sandbox.HomeEasyAuth = Object.freeze({
    getCachedHomeEasySession: () => null,
    validateAppSession: async () => { throw authError('BACKEND_NETWORK_ERROR', 'temporary outage'); },
    openAppSession: async () => { openCalls += 1; return { opened: true }; },
    restoreHomeEasySession: async () => { legacyRestoreCalls += 1; return { native: true }; },
    isTransientError: error => error?.code === 'BACKEND_NETWORK_ERROR',
  });

  await assert.rejects(
    sandbox.HomeEasyAuth.restoreHomeEasySession({ preferCache: true, silent: true }),
    error => error?.code === 'BACKEND_NETWORK_ERROR',
  );
  assert.equal(openCalls, 0, 'temporary HomeEasy outage must not trigger Firebase refresh/open');
  assert.equal(legacyRestoreCalls, 0, 'temporary outage must not call legacy restore that can clear session');
  const stored = JSON.parse(sandbox.sessionStorage.getItem('HOMEEASY_AUTH_SESSION_V1'));
  assert.equal(stored.appSessionToken, initial.appSessionToken, 'temporary outage must preserve stored session');
  assert.equal(stored.refreshToken, initial.refreshToken, 'temporary outage must preserve Firebase refresh token');
}

async function testRejectedOpaqueSessionMayOpenNewSessionWithoutLegacyRestore() {
  const sandbox = makeContext(makeSession({ appExpired: true }));
  let openCalls = 0;
  let legacyRestoreCalls = 0;
  sandbox.HomeEasyAuth = Object.freeze({
    getCachedHomeEasySession: () => null,
    validateAppSession: async () => { throw authError('APP_SESSION_EXPIRED'); },
    openAppSession: async () => { openCalls += 1; return { profile: { uid: 'homeeasy-user-1' }, permissions: ['clientes.read'] }; },
    restoreHomeEasySession: async () => { legacyRestoreCalls += 1; return { native: true }; },
    isTransientError: () => false,
  });

  const result = await sandbox.HomeEasyAuth.restoreHomeEasySession({ preferCache: true, reopen: true });
  assert.equal(result.profile.uid, 'homeeasy-user-1');
  assert.equal(openCalls, 1, 'rejected opaque session may reopen via the safe public openAppSession path');
  assert.equal(legacyRestoreCalls, 0, 'legacy restore path must stay bypassed');
}

async function testWrongFirebaseProjectIsNeverAccepted() {
  const sandbox = makeContext(makeSession({ projectId: 'another-project' }));
  sandbox.HomeEasyAuth = Object.freeze({
    getCachedHomeEasySession: () => null,
    validateAppSession: async () => null,
    openAppSession: async () => null,
    restoreHomeEasySession: async () => null,
    isTransientError: () => false,
  });
  assert.equal(sandbox.HomeEasyAuth.getCachedHomeEasySession(), null, 'project binding must remain enforced');
}

await testExpiredFirebaseStillUsesValidOperationalSession();
await testStaleOperationalSessionRevalidatesBeforeFirebaseRefresh();
await testTransientRevalidationNeverFallsThroughToFirebaseOrDeletesSession();
await testRejectedOpaqueSessionMayOpenNewSessionWithoutLegacyRestore();
await testWrongFirebaseProjectIsNeverAccepted();
console.log('HomeEasy long-lived session stability: PASS');
