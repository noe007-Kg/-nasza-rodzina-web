import test from 'node:test';
import assert from 'node:assert/strict';
import { googleLoginAction, verifyGoogleIdentity } from '../server/account-auth.mjs';
import { createAccountHandler } from '../server/account-http.mjs';

const active = { name: 'Rodzic', role: 'parent', active: true, canLogin: true };
function services({ profile = active, disabled = false, linked = true } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      getUserByProviderUid: async (provider, subject) => {
        calls.push(['provider', provider, subject]);
        if (!linked) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
        return { uid: 'existing-family-uid', disabled, providerData: [{ providerId: 'google.com', uid: 'google-subject' }] };
      },
      createCustomToken: async (uid) => { calls.push(['token', uid]); return 'synthetic-test-token'; },
      getUserByEmail: async () => { throw new Error('Login must not find users by email'); },
      createUser: async () => { throw new Error('Login must not create users'); },
    },
    db: { collection: (collection) => ({ doc: (uid) => ({ get: async () => {
      calls.push(['profile', collection, uid]);
      return { exists: Boolean(profile), data: () => profile };
    } }) }) },
  };
}
const identity = async () => ({ subject: 'google-subject', email: 'existing@example.test' });

test('Google login authenticates an already linked provider with the exact existing family UID', async () => {
  const context = services();
  assert.deepEqual(await googleLoginAction({ credential: 'synthetic-credential' }, context, identity), { token: 'synthetic-test-token' });
  assert.deepEqual(context.calls, [
    ['provider', 'google.com', 'google-subject'], ['profile', 'members', 'existing-family-uid'], ['token', 'existing-family-uid'],
  ]);
});

test('an unlinked Google email never causes a duplicate Auth user or a new family member', async () => {
  const context = services({ linked: false });
  await assert.rejects(googleLoginAction({ credential: 'synthetic' }, context, identity), { code: 'ACCOUNT_GOOGLE_NOT_LINKED', status: 403 });
  assert.deepEqual(context.calls, [['provider', 'google.com', 'google-subject']]);
});

test('Google login requires the active verified member role, active and canLogin flags', async () => {
  for (const profile of [null, { ...active, active: false }, { ...active, canLogin: false }, { ...active, archived: true }, { ...active, role: 'admin' }]) {
    const context = services({ profile });
    await assert.rejects(googleLoginAction({ credential: 'synthetic' }, context, identity), { code: 'ACCOUNT_MEMBER_REQUIRED', status: 403 });
    assert.equal(context.calls.some(([kind]) => kind === 'token'), false);
  }
  const child = services({ profile: { ...active, role: 'child' } });
  assert.equal((await googleLoginAction({ credential: 'synthetic' }, child, identity)).token, 'synthetic-test-token');
});

test('a disabled Auth user or mismatched provider subject cannot receive a custom token', async () => {
  const disabled = services({ disabled: true });
  await assert.rejects(googleLoginAction({ credential: 'synthetic' }, disabled, identity), { code: 'ACCOUNT_GOOGLE_DISABLED' });
  const mismatched = services();
  await assert.rejects(googleLoginAction({ credential: 'synthetic' }, mismatched, async () => ({ subject: 'another-google-subject' })), { code: 'ACCOUNT_GOOGLE_DISABLED' });
  assert.equal(mismatched.calls.some(([kind]) => kind === 'token'), false);
});

test('Google login rejects client-selected UID, e-mail or member roles before any identity lookup', async () => {
  for (const field of ['uid', 'email', 'role', 'token']) {
    const context = services();
    await assert.rejects(googleLoginAction({ credential: 'synthetic', [field]: 'injected' }, context, identity), { code: 'ACCOUNT_INVALID_REQUEST' });
    assert.deepEqual(context.calls, []);
  }
});

test('Google credential format and OAuth client configuration are validated before network verification', async () => {
  await assert.rejects(verifyGoogleIdentity('a.b.c', ''), { code: 'ACCOUNT_GOOGLE_NOT_CONFIGURED', status: 503 });
  await assert.rejects(verifyGoogleIdentity('invalid', 'test.apps.googleusercontent.com'), { code: 'ACCOUNT_INVALID_GOOGLE_CREDENTIAL', status: 400 });
  await assert.rejects(verifyGoogleIdentity('x'.repeat(16385), 'test.apps.googleusercontent.com'), { code: 'ACCOUNT_INVALID_GOOGLE_CREDENTIAL', status: 400 });
});

function response() {
  return { headers: {}, statusCode: 0, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.result = JSON.parse(value); } };
}
const request = (body, extra = {}) => ({ method: 'POST', headers: { origin: 'https://rodzina.example', host: 'rodzina.example', 'content-type': 'application/json' }, body, ...extra });

test('account HTTP responses are private and redact internal failures and incoming Google credentials', async () => {
  const handler = createAccountHandler(async () => { throw new Error('synthetic-secret-token-that-must-not-leak'); }, { public: true, services: () => services() });
  const input = request({ credential: 'synthetic-private-google-credential' });
  const output = response();
  await handler(input, output);
  assert.equal(output.statusCode, 500);
  assert.match(output.headers['Cache-Control'], /no-store/);
  assert.doesNotMatch(JSON.stringify(output.result), /synthetic-secret|synthetic-private/);
  assert.equal(input.body, undefined);
});

test('account endpoint denies cross-origin and unsupported method before running an action', async () => {
  let actions = 0;
  const handler = createAccountHandler(async () => { actions += 1; return {}; }, { public: true, services: () => services() });
  const crossOrigin = response();
  await handler(request({}, { headers: { origin: 'https://intruder.example', host: 'rodzina.example', 'content-type': 'application/json' } }), crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);
  const wrongMethod = response();
  await handler(request({}, { method: 'GET' }), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, 'POST');
  assert.equal(actions, 0);
});

test('family administration verifies revoked tokens and refuses a child before mutation', async () => {
  const checks = [];
  let actions = 0;
  const context = services({ profile: { ...active, role: 'child' } });
  context.auth.verifyIdToken = async (token, revoked) => { checks.push([token, revoked]); return { uid: 'existing-family-uid' }; };
  const handler = createAccountHandler(async () => { actions += 1; return {}; }, { services: () => context });
  const output = response();
  const input = request({ action: 'archive', uid: 'another-member', confirmed: true });
  input.headers.authorization = 'Bearer header.payload.signature';
  await handler(input, output);
  assert.equal(output.statusCode, 403);
  assert.deepEqual(checks, [['header.payload.signature', true]]);
  assert.equal(actions, 0);
});
