import test from 'node:test';
import assert from 'node:assert/strict';
import { googleAvatarURL, googleLoginAction, verifyGoogleIdentity } from '../server/account-auth.mjs';
import { createAccountHandler } from '../server/account-http.mjs';
import { resolveConnectionAccess } from '../server/edu-access.mjs';

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

function avatarServices(initial) {
  let profile = { ...initial };
  let beforeTransaction;
  const context = services({ profile: initial });
  const writes = [];
  const reference = { uid: 'existing-family-uid', get: async () => ({ exists: true, data: () => ({ ...profile }) }) };
  context.db = {
    collection: name => {
      assert.equal(name, 'members');
      return { doc: uid => { assert.equal(uid, 'existing-family-uid'); return reference; } };
    },
    runTransaction: async operation => {
      beforeTransaction?.();
      let pending;
      const result = await operation({
        get: ref => ref.get(),
        update: (ref, changes) => { assert.equal(ref.uid, 'existing-family-uid'); pending = changes; },
      });
      if (pending) { profile = { ...profile, ...pending }; writes.push(pending); }
      return result;
    },
  };
  return { ...context, writes, profile: () => profile, setProfile: next => { profile = next; }, before: hook => { beforeTransaction = hook; } };
}
const picture = 'https://lh3.googleusercontent.com/a/example-photo=s96-c';
const identityWithPhoto = async () => ({ subject: 'google-subject', email: 'existing@example.test', picture });

test('Google avatars accept only HTTPS Googleusercontent image URLs with no credentials or foreign hosts', () => {
  assert.equal(googleAvatarURL(picture), picture);
  for (const value of [null, 'http://lh3.googleusercontent.com/a/photo', 'https://googleusercontent.com.attacker.test/photo', 'https://attacker.test/photo', 'https://user:secret@lh3.googleusercontent.com/photo', 'https://lh3.googleusercontent.com:8443/photo', 'data:image/png;base64,anything', 'x'.repeat(2049)]) assert.equal(googleAvatarURL(value), null);
});

test('Google login assigns a verified photo to an empty/default profile with the exact existing UID', async () => {
  for (const initial of [active, { ...active, role: 'adult', avatarSource: 'default' }, { ...active, role: 'child', avatarSource: 'default' }]) {
    const context = avatarServices(initial);
    assert.deepEqual(await googleLoginAction({ credential: 'synthetic' }, context, identityWithPhoto), { token: 'synthetic-test-token' });
    assert.equal(context.profile().photoURL, picture);
    assert.equal(context.profile().avatarSource, 'google');
    assert.deepEqual(context.calls.filter(([kind]) => kind === 'token'), [['token', 'existing-family-uid']]);
    assert.equal(context.writes.length, 1);
  }
});

test('subsequent Google login refreshes Google photos but never custom or legacy photos', async () => {
  const google = avatarServices({ ...active, avatarSource: 'google', photoURL: 'https://lh3.googleusercontent.com/old' });
  await googleLoginAction({ credential: 'synthetic' }, google, identityWithPhoto);
  assert.equal(google.profile().photoURL, picture);
  for (const initial of [{ avatarSource: 'custom', avatarPath: 'avatars/members/existing-family-uid/existing-family-uid/owned.png' }, { photoURL: '/legacy-custom-photo.jpg' }, { avatarSource: 'custom' }, { avatarSource: 'default', photoURL: '/legacy-photo.jpg' }]) {
    const context = avatarServices({ ...active, ...initial });
    await googleLoginAction({ credential: 'synthetic' }, context, identityWithPhoto);
    assert.equal(context.writes.length, 0);
    assert.equal(context.profile().photoURL, initial.photoURL);
    assert.equal(context.profile().avatarPath, initial.avatarPath);
  }
});

test('a custom avatar uploaded concurrently with Google login wins inside the transaction', async () => {
  const context = avatarServices({ ...active, avatarSource: 'google', photoURL: 'https://lh3.googleusercontent.com/old' });
  context.before(() => context.setProfile({ ...active, avatarSource: 'custom', avatarPath: 'avatars/members/existing-family-uid/existing-family-uid/custom.png' }));
  await googleLoginAction({ credential: 'synthetic' }, context, identityWithPhoto);
  assert.equal(context.profile().avatarSource, 'custom');
  assert.match(context.profile().avatarPath, /custom\.png$/);
  assert.equal(context.writes.length, 0);
});

test('Google avatar refresh rechecks membership and cosmetic database errors do not break login', async () => {
  const revoked = avatarServices(active);
  revoked.before(() => revoked.setProfile({ ...active, archived: true, active: false }));
  await assert.rejects(googleLoginAction({ credential: 'synthetic' }, revoked, identityWithPhoto), { code: 'ACCOUNT_MEMBER_REQUIRED' });
  assert.equal(revoked.calls.some(([kind]) => kind === 'token'), false);
  const unavailable = avatarServices(active);
  unavailable.db.runTransaction = async () => { throw new Error('cosmetic database outage'); };
  assert.deepEqual(await googleLoginAction({ credential: 'synthetic' }, unavailable, identityWithPhoto), { token: 'synthetic-test-token' });
  assert.equal(unavailable.writes.length, 0);
});

test('an unsafe verified picture is ignored and unchanged Google photos do not create writes', async () => {
  const unsafe = avatarServices(active);
  await googleLoginAction({ credential: 'synthetic' }, unsafe, async () => ({ ...(await identity()), picture: 'https://attacker.test/photo' }));
  assert.equal(unsafe.writes.length, 0);
  const unchanged = avatarServices({ ...active, avatarSource: 'google', photoURL: picture });
  await googleLoginAction({ credential: 'synthetic' }, unchanged, identityWithPhoto);
  assert.equal(unchanged.writes.length, 0);
});

test('memberOnly endpoints admit adults, while the default parent endpoint and eduVULCAN connection management deny them', async () => {
  const adult = { ...active, role: 'adult' };
  for (const memberOnly of [true, false]) {
    let calls = 0;
    const context = services({ profile: adult });
    context.auth.verifyIdToken = async (token, revoked) => { assert.equal(revoked, true); return { uid: 'existing-family-uid' }; };
    const handler = createAccountHandler(async () => { calls++; return {}; }, { memberOnly, services: () => context });
    const input = request({});
    input.headers.authorization = 'Bearer header.payload.signature';
    const output = response();
    await handler(input, output);
    assert.equal(output.statusCode, memberOnly ? 200 : 403);
    assert.equal(calls, memberOnly ? 1 : 0);
  }
  const context = { uid: 'adult', profile: adult };
  await assert.rejects(resolveConnectionAccess(context, 'family'), { code: 'EDU_PARENT_REQUIRED' });
  await assert.rejects(resolveConnectionAccess(context, 'student'), { code: 'EDU_STUDENT_REQUIRED' });
});
