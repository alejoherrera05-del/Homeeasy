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

function makeSession({ appExpired = false, projectId = 'homeeasy-auth' } = {}) {
  return {
    version: 2,
    persistence: 'session',
    localId: 'firebase-user-1',
    email: 'qa@example.test',
    displayName: 'QA User',
    idToken: fakeJwt(projectId),
    refreshToken: 'fake-refresh-token',
    // Deliberately expired Firebase ID token window. This is the incident case.
    expiresAt: Date.now() - 120_000,
    appSessionToken: 'opaque-homeeasy-session',
    appSessionExpiresAt: new Date(Date.now() + (appExpired ? -60_000 : 3_600_000)).toISOString(),
    appSessionValidatedAt: Date.now() - 10_000,
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

async function testExpiredFirebaseStillUsesValidOperationalSession() {
  const sandbox = makeContext(makeSession());
  let nativeRestoreCalls = 0;
  sandbox.HomeEasyAuth = Object.freeze({
    getCachedHomeEasySession: () => null,
    shouldRevalidateAppSession: () => true,
    restoreHomeEasySession: async () => {
      nativeRestoreCalls += 1;
      return { native: true };
    },
  });

  const cached = sandbox.HomeEasyAuth.getCachedHomeEasySession();
  assert.ok(cached, 'valid HomeEasy operational session should survive Firebase token expiry');
  assert.equal(cached.profile.uid, 'homeeasy-user-1');
  assert.equal(cached.source, 'operational-session');
  assert.equal(sandbox.HomeEasyAuth.shouldRevalidateAppSession(5 * 60 * 1000), false);

  const restored = await sandbox.HomeEasyAuth.restoreHomeEasySession({ preferCache: true });
  assert.equal(restored.profile.uid, 'homeeasy-user-1');
  assert.equal(nativeRestoreCalls, 0, 'navigation must not force Firebase refresh while app session is valid');
}

async function testExpiredOperationalSessionFallsBackToNativeRestore() {
  const sandbox = makeContext(makeSession({ appExpired: true }));
  let nativeRestoreCalls = 0;
  sandbox.HomeEasyAuth = Object.freeze({
    getCachedHomeEasySession: () => null,
    restoreHomeEasySession: async () => {
      nativeRestoreCalls += 1;
      return { native: true };
    },
  });

  assert.equal(sandbox.HomeEasyAuth.getCachedHomeEasySession(), null);
  const result = await sandbox.HomeEasyAuth.restoreHomeEasySession({ preferCache: true });
  assert.deepEqual(result, { native: true });
  assert.equal(nativeRestoreCalls, 1, 'expired HomeEasy app session must not be extended locally');
}

async function testWrongFirebaseProjectIsNeverAccepted() {
  const sandbox = makeContext(makeSession({ projectId: 'another-project' }));
  sandbox.HomeEasyAuth = Object.freeze({
    getCachedHomeEasySession: () => null,
    restoreHomeEasySession: async () => null,
  });
  assert.equal(sandbox.HomeEasyAuth.getCachedHomeEasySession(), null, 'project binding must remain enforced');
}

await testExpiredFirebaseStillUsesValidOperationalSession();
await testExpiredOperationalSessionFallsBackToNativeRestore();
await testWrongFirebaseProjectIsNeverAccepted();
console.log('HomeEasy long-lived session stability: PASS');
