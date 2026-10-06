import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMemberChangeAllowed, manageMemberAction, validateMemberCreation } from '../server/account-members.mjs';

const parent = { name: 'Rodzic', personKey: 'Rodzic', role: 'parent', active: true, canLogin: true };
const child = { name: 'Dziecko', personKey: 'Dziecko', role: 'child', active: true, canLogin: true };
const definition = { action: 'create', name: 'Nowa osoba', role: 'child', canLogin: false, schoolEnabled: false };

function services(initial = { actor: parent, sibling: child }, existingAccount = null) {
  const rows = new Map(Object.entries(initial));
  const calls = [];
  const snapshot = () => ({ docs: [...rows].map(([id, value]) => ({ id, data: () => value })) });
  const document = (uid) => ({ id: uid, update: async (value) => { rows.set(uid, { ...rows.get(uid), ...value }); calls.push(['profile-update', uid]); } });
  const db = {
    collection: (collection) => {
      assert.equal(collection, 'members');
      return { get: async () => snapshot(), doc: document };
    },
    runTransaction: async (operation) => operation({
      get: async () => snapshot(),
      create: (ref, value) => { assert.equal(rows.has(ref.id), false); rows.set(ref.id, value); calls.push(['profile-create', ref.id]); },
      update: (ref, value) => { rows.set(ref.id, { ...rows.get(ref.id), ...value }); calls.push(['profile-update', ref.id]); },
    }),
  };
  const auth = {
    getUserByEmail: async (email) => {
      calls.push(['auth-email', email]);
      if (!existingAccount) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      return existingAccount;
    },
    createUser: async (data) => { calls.push(['auth-create', data]); return { uid: 'new-auth-uid', ...data }; },
    updateUser: async (uid, data) => { calls.push(['auth-update', uid, data]); },
    getUser: async (uid) => { calls.push(['auth-get', uid]); return { uid, disabled: false }; },
    revokeRefreshTokens: async (uid) => { calls.push(['revoke', uid]); },
    deleteUser: async () => { throw new Error('Auth deletion is forbidden'); },
  };
  return { uid: 'actor', profile: initial.actor || parent, db, auth, rows, calls };
}

test('family creation accepts explicit school/canLogin flags and never accepts credentials or arbitrary UID', () => {
  assert.deepEqual(validateMemberCreation(definition), { name: 'Nowa osoba', role: 'child', canLogin: false, schoolEnabled: false });
  assert.equal(validateMemberCreation({ ...definition, canLogin: true, email: 'Person@Example.Test' }).email, 'person@example.test');
  for (const change of [{ password: 'forbidden' }, { token: 'forbidden' }, { uid: 'chosen' }, { role: 'admin' }, { canLogin: 'true' }, { name: '../path' }, { schoolEnabled: 1 }, { canLogin: true, email: 'invalid' }]) {
    assert.throws(() => validateMemberCreation({ ...definition, ...change }), { code: 'ACCOUNT_INVALID_REQUEST' });
  }
});

test('adding an offline profile does not create Authentication users and uses a stable distinct personKey', async () => {
  const context = services();
  const result = await manageMemberAction(context, definition);
  assert.match(result.memberUid, /^profile-/);
  assert.match(result.personKey, /^member-[a-f0-9]{24}$/);
  assert.equal(context.rows.get(result.memberUid).canLogin, false);
  assert.equal(context.rows.get('actor').name, 'Rodzic');
  assert.equal(context.calls.some(([kind]) => kind.startsWith('auth-')), false);
});

test('explicit parent onboarding reuses an existing orphan Auth UID without changing its providers/password', async () => {
  const context = services(undefined, { uid: 'existing-orphan-uid', disabled: false, providerData: [{ providerId: 'password' }] });
  const result = await manageMemberAction(context, { ...definition, canLogin: true, email: 'new@example.test' });
  assert.equal(result.memberUid, 'existing-orphan-uid');
  assert.equal(result.resetEmail, 'new@example.test');
  assert.equal(context.rows.get('existing-orphan-uid').canLogin, true);
  assert.equal(context.calls.some(([kind]) => kind === 'auth-create' || kind === 'auth-update'), false);
});

test('a family member UID or duplicate person cannot be reassigned to a new profile', async () => {
  const context = services(undefined, { uid: 'sibling', disabled: false });
  await assert.rejects(manageMemberAction(context, { ...definition, canLogin: true, email: 'sibling@example.test' }), { code: 'ACCOUNT_DUPLICATE_MEMBER' });
  assert.equal(context.rows.size, 2);
  assert.equal(context.rows.get('sibling').name, 'Dziecko');
  await assert.rejects(manageMemberAction(context, { ...definition, name: 'Dziecko' }), { code: 'ACCOUNT_DUPLICATE_MEMBER' });
  assert.equal(context.calls.some(([kind]) => kind === 'profile-create' || kind === 'auth-create'), false);
});

test('new login accounts are initially disabled, have no password in the request and retain the new member UID', async () => {
  const context = services();
  const result = await manageMemberAction(context, { ...definition, canLogin: true, email: 'new@example.test' });
  const create = context.calls.find(([kind]) => kind === 'auth-create');
  assert.equal(create[1].disabled, true);
  assert.equal(Object.hasOwn(create[1], 'password'), false);
  assert.equal(result.memberUid, 'new-auth-uid');
  assert.equal(context.rows.get(result.memberUid).canLogin, true);
  assert.deepEqual(context.calls.filter(([kind]) => kind === 'auth-update'), [['auth-update', 'new-auth-uid', { disabled: false }]]);
});

test('archiving preserves member UID and history and revokes sessions without deleting Auth', async () => {
  const context = services();
  const result = await manageMemberAction(context, { action: 'archive', uid: 'sibling', confirmed: true });
  assert.deepEqual(result, { memberUid: 'sibling', archived: true });
  assert.equal(context.rows.get('sibling').name, 'Dziecko');
  assert.equal(context.rows.get('sibling').active, false);
  assert.equal(context.rows.get('sibling').canLogin, false);
  assert.equal(context.rows.get('sibling').archived, true);
  assert.deepEqual(context.calls.filter(([kind]) => kind === 'revoke'), [['revoke', 'sibling']]);
  assert.equal(context.rows.has('sibling'), true);
});

test('family mutations require a verified parent and archive confirmation', async () => {
  const context = services();
  await assert.rejects(manageMemberAction(context, { action: 'archive', uid: 'sibling' }), { code: 'ACCOUNT_CONFIRMATION_REQUIRED' });
  await assert.rejects(manageMemberAction({ ...context, profile: child }, definition), { code: 'ACCOUNT_PARENT_REQUIRED' });
  await assert.rejects(manageMemberAction(context, { action: 'archive', uid: '../actor', confirmed: true }), { code: 'ACCOUNT_INVALID_REQUEST' });
  assert.equal(context.calls.length, 0);
});

test('parents cannot revoke their own access or remove the final active parent', () => {
  const profiles = new Map([['actor', parent], ['other', { ...parent, name: 'Drugi rodzic' }]]);
  assert.throws(() => assertMemberChangeAllowed('actor', profiles, 'actor', { ...parent, active: false }), { code: 'ACCOUNT_SELF_LOCKOUT' });
  profiles.set('actor', { ...parent, canLogin: false });
  assert.throws(() => assertMemberChangeAllowed('actor', profiles, 'other', { ...parent, active: false }), { code: 'ACCOUNT_PARENT_REQUIRED' });
  const lastParent = new Map([['actor', parent], ['other', child]]);
  assert.throws(() => assertMemberChangeAllowed('actor', lastParent, 'actor', { ...parent, role: 'child' }), { code: 'ACCOUNT_SELF_LOCKOUT' });
  assertMemberChangeAllowed('actor', lastParent, 'other', { ...child, archived: true, active: false });
});

test('parent authorization is checked again against the transaction roster before committing', async () => {
  const context = services({ actor: { ...parent, active: false }, sibling: child });
  context.profile = parent; // Simulates revocation after the request token was verified.
  await assert.rejects(manageMemberAction(context, definition), { code: 'ACCOUNT_PARENT_REQUIRED' });
  assert.equal(context.rows.size, 2);
  assert.equal(context.calls.some(([kind]) => kind === 'profile-create'), false);
});

test('updating role/school flags retains UID, name, personKey and all additional profile metadata', async () => {
  const context = services({ actor: parent, sibling: { ...child, photoURL: '/existing.jpg', birthDate: '2013-01-01' } });
  await manageMemberAction(context, { action: 'update', uid: 'sibling', role: 'child', canLogin: true, active: true, schoolEnabled: false });
  const result = context.rows.get('sibling');
  assert.equal(result.name, 'Dziecko');
  assert.equal(result.personKey, 'Dziecko');
  assert.equal(result.photoURL, '/existing.jpg');
  assert.equal(result.birthDate, '2013-01-01');
  assert.equal(result.schoolEnabled, false);
});

test('a parent can enable login for an offline profile by provisioning Auth with that SAME UID', async () => {
  const context = services({ actor: parent, 'profile-existing-offline': { ...child, canLogin: false, photoURL: '/kept-photo.jpg' } });
  context.auth.getUser = async () => { throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); };
  const result = await manageMemberAction(context, { action: 'update', uid: 'profile-existing-offline', role: 'child', canLogin: true, schoolEnabled: true, active: true, email: 'offline-enabled@example.test' });
  assert.equal(result.memberUid, 'profile-existing-offline');
  assert.equal(result.resetEmail, 'offline-enabled@example.test');
  assert.equal(context.rows.get(result.memberUid).canLogin, true);
  assert.equal(context.rows.get(result.memberUid).personKey, 'Dziecko');
  assert.equal(context.rows.get(result.memberUid).photoURL, '/kept-photo.jpg');
  const creation = context.calls.find(([kind]) => kind === 'auth-create')[1];
  assert.equal(creation.uid, 'profile-existing-offline');
  assert.equal(creation.disabled, true);
  assert.equal(Object.hasOwn(creation, 'password'), false);
});

test('enabling offline login refuses an e-mail already attached to a different UID', async () => {
  const context = services({ actor: parent, offline: { ...child, canLogin: false } }, { uid: 'another-auth-uid', disabled: false });
  context.auth.getUser = async () => { throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); };
  await assert.rejects(manageMemberAction(context, { action: 'update', uid: 'offline', role: 'child', canLogin: true, schoolEnabled: true, active: true, email: 'taken@example.test' }), { code: 'ACCOUNT_EMAIL_UID_CONFLICT' });
  assert.equal(context.rows.get('offline').canLogin, false);
  assert.equal(context.rows.get('offline').personKey, 'Dziecko');
  assert.equal(context.calls.some(([kind]) => kind === 'auth-create' || kind === 'profile-update'), false);
});

const enableOffline = (overrides = {}) => ({
  action: 'update', uid: 'offline', role: 'child', canLogin: true,
  schoolEnabled: true, active: true, email: 'offline@example.test', ...overrides,
});

function offlineServices() {
  const context = services({ actor: parent, offline: {
    ...child, canLogin: false, name: 'Istniejący profil', personKey: 'existing-person',
    photoURL: '/kept-photo.jpg', birthDate: '2014-08-16',
  } });
  context.auth.getUser = async (uid) => {
    context.calls.push(['auth-get', uid]);
    throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
  };
  return context;
}

test('offline account activation requires a valid email before changing Auth or member history', async () => {
  for (const email of [undefined, '', 'invalid', 'with space@example.test']) {
    const context = offlineServices();
    const before = { ...context.rows.get('offline') };
    await assert.rejects(manageMemberAction(context, enableOffline({ email })), { code: 'ACCOUNT_INVALID_REQUEST' });
    assert.deepEqual(context.rows.get('offline'), before);
    assert.equal(context.calls.some(([kind]) => ['auth-create', 'auth-update', 'profile-update'].includes(kind)), false);
  }
});

test('a revoked parent cannot provision Authentication for an existing offline UID', async () => {
  const context = offlineServices();
  context.rows.set('actor', { ...parent, active: false });
  // The request context was validated earlier; the live roster must still authorize it.
  await assert.rejects(manageMemberAction(context, enableOffline()), { code: 'ACCOUNT_PARENT_REQUIRED' });
  assert.equal(context.calls.some(([kind]) => kind === 'auth-create' || kind === 'profile-update'), false);
  assert.equal(context.rows.get('offline').canLogin, false);
});

test('offline provisioning checks parent authority again inside the member transaction', async () => {
  const context = offlineServices();
  const before = { ...context.rows.get('offline') };
  const createUser = context.auth.createUser;
  context.auth.createUser = async (data) => {
    const account = await createUser(data);
    // Simulate a concurrent revocation between Auth creation and the Firestore commit.
    context.rows.set('actor', { ...parent, canLogin: false });
    return account;
  };
  await assert.rejects(manageMemberAction(context, enableOffline()), { code: 'ACCOUNT_PARENT_REQUIRED' });
  assert.deepEqual(context.rows.get('offline'), before);
  assert.deepEqual(context.calls.filter(([kind]) => kind === 'auth-update'), [['auth-update', 'offline', { disabled: true }]]);
});

test('a failed member transaction leaves the newly provisioned same-UID account disabled', async () => {
  const context = offlineServices();
  const before = { ...context.rows.get('offline') };
  context.db.runTransaction = async () => { throw new Error('transaction unavailable'); };
  await assert.rejects(manageMemberAction(context, enableOffline()), /transaction unavailable/);
  assert.deepEqual(context.rows.get('offline'), before);
  assert.deepEqual(context.calls.filter(([kind]) => kind === 'auth-update'), [['auth-update', 'offline', { disabled: true }]]);
  assert.equal(context.calls.find(([kind]) => kind === 'auth-create')[1].uid, 'offline');
});

test('failed Authentication activation keeps the profile inaccessible without deleting its history', async () => {
  const context = offlineServices();
  const updateUser = context.auth.updateUser;
  context.auth.updateUser = async (uid, data) => {
    await updateUser(uid, data);
    if (data.disabled === false) throw new Error('Auth activation unavailable');
  };
  await assert.rejects(manageMemberAction(context, enableOffline()), /Auth activation unavailable/);
  const profile = context.rows.get('offline');
  assert.equal(profile.canLogin, false);
  assert.equal(profile.name, 'Istniejący profil');
  assert.equal(profile.personKey, 'existing-person');
  assert.equal(profile.photoURL, '/kept-photo.jpg');
  assert.equal(profile.birthDate, '2014-08-16');
  assert.deepEqual(context.calls.filter(([kind]) => kind === 'auth-update').at(-1), ['auth-update', 'offline', { disabled: true }]);
});

test('a failed final profile activation disables Authentication again and preserves the member UID', async () => {
  const context = offlineServices();
  const collection = context.db.collection;
  context.db.collection = (name) => {
    const original = collection(name);
    return { ...original, doc: (uid) => {
      const ref = original.doc(uid);
      return { ...ref, update: async () => { throw new Error('profile activation unavailable'); } };
    } };
  };
  await assert.rejects(manageMemberAction(context, enableOffline()), /profile activation unavailable/);
  assert.equal(context.rows.get('offline').canLogin, false);
  assert.equal(context.rows.get('offline').personKey, 'existing-person');
  assert.deepEqual(context.calls.filter(([kind]) => kind === 'auth-update'), [
    ['auth-update', 'offline', { disabled: false }],
    ['auth-update', 'offline', { disabled: true }],
  ]);
});

test('enabling an existing Authentication UID never recreates it or changes its email/providers', async () => {
  const context = services({ actor: parent, offline: { ...child, canLogin: false } });
  const result = await manageMemberAction(context, enableOffline({ email: 'ignored-new-email@example.test' }));
  assert.equal(result.memberUid, 'offline');
  assert.equal(Object.hasOwn(result, 'resetEmail'), false);
  assert.equal(context.rows.get('offline').canLogin, true);
  assert.equal(context.calls.some(([kind]) => ['auth-create', 'auth-update', 'auth-email'].includes(kind)), false);
});

test('offline activation does not automatically re-enable a disabled existing Auth account', async () => {
  const context = offlineServices();
  context.auth.getUser = async (uid) => ({ uid, disabled: true });
  await assert.rejects(manageMemberAction(context, enableOffline()), { code: 'ACCOUNT_EXISTING_DISABLED' });
  assert.equal(context.rows.get('offline').canLogin, false);
  assert.equal(context.calls.some(([kind]) => ['auth-create', 'auth-update', 'profile-update'].includes(kind)), false);
});
