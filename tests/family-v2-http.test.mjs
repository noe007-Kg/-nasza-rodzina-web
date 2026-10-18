import test from 'node:test';
import assert from 'node:assert/strict';
import { createFamilyRouter } from '../server/family-http.mjs';
import { EduServerError } from '../server/edu-auth.mjs';

const host = 'family-v2-preview.example.vercel.app';
const preview = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: host, FAMILY_V2_WRITES_ENABLED: 'true' };
const context = { uid: 'test-child', profile: { name: 'Dziecko testowe', personKey: 'member-111111111111111111111111', role: 'child', active: true, canLogin: true }, app: { options: { projectId: 'nasza-rodzina' } } };
const request = (operation = 'state', extra = {}) => ({ url: '/api/family/tasks', method: 'POST',
  headers: { host, origin: `https://${host}`, authorization: 'Bearer aaa.bbb.ccc', 'content-type': 'application/json' }, body: { operation }, ...extra });
function response() {
  return { statusCode: 0, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
}
function mocked(overrides = {}) {
  const calls = { guard: 0, tasks: 0, health: 0 };
  const router = createFamilyRouter({ env: preview, services: () => ({}), memberGuard: async () => { calls.guard += 1; return context; },
    tasksAction: async () => { calls.tasks += 1; return { count: 0 }; }, healthAction: async () => { calls.health += 1; return { count: 0 }; }, ...overrides });
  return { router, calls };
}

test('Preview authenticated state can be read but writes remain blocked even when enabled', async () => {
  const { router, calls } = mocked();
  const state = response(); await router(request(), state);
  assert.equal(state.statusCode, 200); assert.equal(calls.tasks, 1);
  const write = response(); await router(request('save'), write);
  assert.equal(write.statusCode, 503); assert.equal(write.body.error.code, 'FAMILY_V2_READ_ONLY');
  assert.equal(calls.tasks, 1);
  assert.equal(state.headers['Cache-Control'], 'no-store, private, max-age=0');
  assert.equal(state.headers['Referrer-Policy'], 'no-referrer');
});

test('router selects only the exact tasks or health path and rejects query overrides', async () => {
  const { router, calls } = mocked();
  const health = response(); await router(request('status', { url: '/api/family/health' }), health);
  assert.equal(health.statusCode, 200); assert.equal(calls.health, 1);
  for (const url of ['/api/family/tasks/other', '/api/family/tasks? action=health', '/api/family/tasks?action=health',
    '/api/family/tasks?action=tasks&action=tasks', '/api/family/%74asks', 'https://attacker.invalid/api/family/tasks', '/api/family/tasks#hidden']) {
    const res = response(); await router(request('state', { url }), res);
    assert.equal(res.statusCode, 404, url);
  }
  const queryOverride = response(); await router(request('state', { query: { action: ['tasks', 'health'] } }), queryOverride);
  assert.equal(queryOverride.statusCode, 404);
});

test('unsupported methods and unauthenticated members cannot reach an action', async () => {
  const { router, calls } = mocked();
  const method = response(); await router(request('state', { method: 'GET' }), method);
  assert.equal(method.statusCode, 405); assert.equal(method.headers.Allow, 'POST'); assert.equal(calls.guard, 0);
  const denied = mocked({ memberGuard: async () => { throw new EduServerError('EDU_MEMBER_REQUIRED', 403, 'Nieuprawniony profil testowy.'); } });
  const res = response(); await denied.router(request(), res);
  assert.equal(res.statusCode, 403); assert.equal(denied.calls.tasks, 0); assert.equal(denied.calls.health, 0);
});

test('independent family origin guard accepts only the exact configured Preview origin', async () => {
  const { router, calls } = mocked();
  const success = response(); await router(request(), success);
  assert.equal(success.statusCode, 200);
  for (const origin of ['https://evil.example.invalid', `https://${host}.evil.example.invalid`, `http://${host}`, 'null', 'not a URL']) {
    const res = response(); await router(request('state', { headers: { ...request().headers, origin } }), res);
    assert.equal(res.statusCode, 403, origin);
  }
  assert.equal(calls.tasks, 1);
});

test('new family authentication does not inherit the eduVULCAN production-origin restriction', async () => {
  const previous = process.env.EDUVULCAN_SITE_ORIGIN;
  process.env.EDUVULCAN_SITE_ORIGIN = 'https://nasza-rodzina-web.vercel.app';
  try {
    let verified = 0; let acted = 0;
    const services = () => ({ app: context.app,
      auth: { verifyIdToken: async (token, revoked) => { assert.equal(token, 'aaa.bbb.ccc'); assert.equal(revoked, true); verified += 1; return { uid: context.uid }; } },
      db: { collection: name => { assert.equal(name, 'members'); return { doc: uid => { assert.equal(uid, context.uid); return { get: async () => ({ exists: true, data: () => context.profile }) }; } }; } },
    });
    const router = createFamilyRouter({ env: preview, services, tasksAction: async ctx => { acted += 1; assert.equal(ctx.uid, context.uid); return { count: 0 }; } });
    const res = response(); await router(request(), res);
    assert.equal(res.statusCode, 200); assert.equal(verified, 1); assert.equal(acted, 1);
    const invalid = response(); await router(request('state', { headers: { ...request().headers, authorization: 'Bearer invalid' } }), invalid);
    assert.equal(invalid.statusCode, 401); assert.equal(acted, 1);
  } finally {
    if (previous === undefined) delete process.env.EDUVULCAN_SITE_ORIGIN;
    else process.env.EDUVULCAN_SITE_ORIGIN = previous;
  }
});

test('demo writes require both exact local emulators and cannot be enabled by a request body', async () => {
  const demoContext = { ...context, app: { options: { projectId: 'demo-nasza-rodzina' } } };
  const env = { FIREBASE_PROJECT_ID: 'demo-nasza-rodzina', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
  const demoRequest = () => request('save', { headers: { ...request().headers, host: 'localhost:5173', origin: 'http://localhost:5173' } });
  const { router, calls } = mocked({ env, memberGuard: async () => demoContext });
  const good = response(); await router(demoRequest(), good);
  assert.equal(good.statusCode, 200); assert.equal(calls.tasks, 1);
  const productionMock = mocked({ env: { FAMILY_V2_SITE_ORIGIN: `https://${host}` } });
  const spoof = response(); await productionMock.router(request('save', { body: { operation: 'save', FAMILY_V2_WRITES_ENABLED: 'true', projectId: 'demo-nasza-rodzina' } }), spoof);
  assert.equal(spoof.statusCode, 503); assert.equal(productionMock.calls.tasks, 0);
});

test('malformed bodies and mismatched operations are rejected and discarded', async () => {
  const { router, calls } = mocked();
  for (const body of [[], '{invalid', { operation: 'state', action: 'save' }]) {
    const req = request('state', { body }); const res = response(); await router(req, res);
    assert.equal(res.statusCode, 400); assert.equal(req.body, undefined);
  }
  assert.equal(calls.tasks, 0);
});

test('internal errors never expose secrets or upstream stack traces and raw body buffers are zeroed', async () => {
  const { router } = mocked({ tasksAction: async () => { throw new Error('cookie=synthetic-private-value session-token-placeholder stack'); } });
  const body = Buffer.from('{"operation":"state"}');
  const req = request('state', { body }); const res = response(); await router(req, res);
  assert.equal(res.statusCode, 500); assert.equal(res.body.error.code, 'FAMILY_SERVER_ERROR');
  assert.doesNotMatch(JSON.stringify(res.body), /synthetic-private-value|session-token-placeholder|cookie=|stack/);
  assert.equal(req.body, undefined); assert.equal(body.every(byte => byte === 0), true);
});

test('finance reuses the authenticated family route and Preview never enables its writes', async () => {
  let financeCalls = 0;
  const { router } = mocked({ financeAction: async ctx => {
    assert.equal(ctx.uid, context.uid); financeCalls++; return { bills: [] };
  } });
  const read = response();
  await router(request('state', { url: '/api/family/finance' }), read);
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.writesEnabled, false);
  assert.equal(financeCalls, 1);
  for (const operation of ['save', 'markPaid', 'generatePeriods']) {
    const result = response();
    await router(request(operation, { url: '/api/family/finance' }), result);
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.code, 'FAMILY_V2_READ_ONLY');
  }
  assert.equal(financeCalls, 1);
});

test('Tasks has a separate server switch and never unlocks Health or Finance', async () => {
  const production = { VERCEL: '1', VERCEL_ENV: 'production', FAMILY_V2_SITE_ORIGIN: `https://${host}`,
    FAMILY_TASKS_WRITES_ENABLED: 'true', FAMILY_V2_WRITES_ENABLED: 'false' };
  const scoped = { ...context, profile: { ...context.profile, familyId: 'test-household' } };
  let actions = 0;
  const { router } = mocked({ env: production, memberGuard: async () => scoped,
    financeAction: async () => ({}),
    tasksAction: async () => { actions++; return {}; } });
  const state = response(); await router(request(), state);
  assert.equal(state.body.writesEnabled, true);
  const save = response(); await router(request('save-task'), save);
  assert.equal(save.statusCode, 200); assert.equal(actions, 2);
  for (const domain of ['health', 'finance']) {
    const read = response(); await router(request('state', { url: `/api/family/${domain}` }), read);
    assert.equal(read.body.writesEnabled, false);
    const write = response(); await router(request('save', { url: `/api/family/${domain}` }), write);
    assert.equal(write.statusCode, 503);
  }
  for (const familyId of [undefined, '', '__legacy__', 'unsafe/id']) {
    const unavailable = mocked({ env: production, memberGuard: async () => ({ ...scoped, profile: { ...scoped.profile, familyId } }) });
    const res = response(); await unavailable.router(request('save-task'), res);
    assert.equal(res.statusCode, 503); assert.equal(unavailable.calls.tasks, 0);
  }
});

test('global V2 flag alone cannot enable Tasks and its own flag cannot override Preview', async () => {
  const scoped = { ...context, profile: { ...context.profile, familyId: 'test-household' } };
  for (const env of [{ VERCEL_ENV: 'production', FAMILY_V2_SITE_ORIGIN: `https://${host}`, FAMILY_V2_WRITES_ENABLED: 'true' },
    { ...preview, FAMILY_TASKS_WRITES_ENABLED: 'true' }]) {
    const { router, calls } = mocked({ env, memberGuard: async () => scoped });
    const res = response(); await router(request('save-task', { body: { action: 'save-task', FAMILY_TASKS_WRITES_ENABLED: 'true' } }), res);
    assert.equal(res.statusCode, 503); assert.equal(calls.tasks, 0);
  }
});

test('Finance opt-in is independent and cannot be spoofed or used in Preview', async () => {
  const scoped = { ...context, profile: { ...context.profile, familyId: 'test-household' } };
  const enabled = { VERCEL_ENV: 'production', VERCEL_URL: host, FAMILY_V2_SITE_ORIGIN: `https://${host}`, FAMILY_FINANCE_WRITES_ENABLED: 'true' };
  let actions = 0;
  const { router } = mocked({ env: enabled, memberGuard: async () => scoped,
    financeAction: async () => { actions++; return {}; } });
  const write = response(); await router(request('save', { url: '/api/family/finance' }), write);
  assert.equal(write.statusCode, 200); assert.equal(write.body.writesEnabled, true); assert.equal(actions, 1);
  for (const domain of ['tasks', 'health']) {
    const denied = response(); await router(request('save', { url: `/api/family/${domain}` }), denied);
    assert.equal(denied.statusCode, 503);
  }
  for (const env of [{ ...enabled, VERCEL_ENV: 'preview' }, { ...enabled, FAMILY_FINANCE_WRITES_ENABLED: 'false', FAMILY_V2_WRITES_ENABLED: 'true' }]) {
    const closed = mocked({ env, memberGuard: async () => scoped, financeAction: async () => { throw new Error('Must not dispatch'); } });
    const result = response(); await closed.router(request('save', { url: '/api/family/finance', body: { action: 'save', FAMILY_FINANCE_WRITES_ENABLED: 'true' } }), result);
    assert.equal(result.statusCode, 503);
  }
});
