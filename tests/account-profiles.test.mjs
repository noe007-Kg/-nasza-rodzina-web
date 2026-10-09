import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue } from 'firebase-admin/firestore';
import { assertProfileEditAllowed, manageProfileAction, validProfileAvatarPath } from '../server/account-profiles.mjs';

const key = suffix => `member-${suffix.repeat(24)}`;
const parent = { name: 'Sebastian', personKey: 'Sebastian', role: 'parent', active: true, canLogin: true };
const child = { name: 'Nikodem', personKey: 'Nikodem', role: 'child', active: true, canLogin: true };
const adult = { name: 'Babcia', personKey: key('a'), role: 'adult', active: true, canLogin: true };
const uuid = 'fbaa5624-4dfb-4c49-a380-0d34b432d425';
const memberPath = (target = 'child', uploader = 'actor', ext = 'jpg') => `avatars/members/${target}/${uploader}/${uuid}.${ext}`;
const familyPath = (uploader = 'actor') => `avatars/family/${uploader}/${uuid}.png`;

function services(initial = { actor: parent, child, adult }) {
  const rows = new Map(Object.entries(initial).map(([id, profile]) => [`members/${id}`, { ...profile }]));
  const calls = [];
  const ref = path => ({ path });
  const snapshot = path => ({ exists: rows.has(path), data: () => rows.get(path) && { ...rows.get(path) } });
  const apply = (path, changes, merge) => {
    const next = merge ? { ...rows.get(path) } : {};
    for (const [name, value] of Object.entries(changes)) {
      if (FieldValue.delete().isEqual(value)) delete next[name]; else next[name] = value;
    }
    rows.set(path, next);
  };
  const db = {
    collection: name => ({ name, doc: uid => ref(`${name}/${uid}`) }),
    runTransaction: async operation => {
      const writes = [];
      const result = await operation({
        get: async reference => reference.path ? snapshot(reference.path) : {
          docs: [...rows].filter(([path]) => path.startsWith(`${reference.name}/`)).map(([path]) => ({ id: path.split('/')[1], ...snapshot(path) })),
        },
        update: (reference, changes) => writes.push([reference.path, changes, true]),
        set: (reference, changes, options) => writes.push([reference.path, changes, options?.merge === true]),
      });
      for (const [path, changes, merge] of writes) { apply(path, changes, merge); calls.push(path); }
      return result;
    },
  };
  return { uid: 'actor', profile: initial.actor, db, rows, calls };
}

test('profile edits authorize self and parent child/offline, never another active parent or adult', () => {
  for (const role of ['parent', 'adult', 'child']) {
    assertProfileEditAllowed('self', { ...child, role }, 'self', { ...child, role });
  }
  assertProfileEditAllowed('actor', parent, 'child', child);
  assertProfileEditAllowed('actor', parent, 'offline', { ...adult, canLogin: false });
  for (const target of [parent, adult]) {
    assert.throws(() => assertProfileEditAllowed('actor', parent, 'other', target), { code: 'ACCOUNT_PROFILE_EDIT_DENIED' });
  }
  for (const actor of [adult, child]) {
    assert.throws(() => assertProfileEditAllowed('actor', actor, 'other', child), { code: 'ACCOUNT_PROFILE_EDIT_DENIED' });
  }
});

test('profile authorization denies revoked actors and archived or inactive targets', async () => {
  for (const change of [{ active: false }, { canLogin: false }, { archived: true }, { role: 'admin' }]) {
    const context = services({ actor: { ...parent, ...change }, child });
    context.profile = parent; // Earlier request context is stale.
    await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'child', emoji: '👦' }), { code: 'ACCOUNT_MEMBER_REQUIRED' });
    assert.equal(context.calls.length, 0);
  }
  for (const change of [{ active: false }, { archived: true }, { active: undefined }]) {
    const context = services({ actor: parent, child: { ...child, ...change } });
    await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'child', emoji: '👦' }), { code: 'ACCOUNT_PROFILE_ARCHIVED' });
    assert.equal(context.calls.length, 0);
  }
});

test('renaming a legacy self profile freezes its OLD key and leaves role, UID and school metadata intact', async () => {
  const legacy = { ...child, schoolEnabled: true, birthDate: '2014-08-16' };
  delete legacy.personKey;
  const context = services({ actor: legacy, sibling: { ...child, name: 'Paweł', personKey: 'Paweł' } });
  const result = await manageProfileAction(context, { action: 'update', uid: 'actor', name: 'Niko' });
  assert.deepEqual(result, { memberUid: 'actor' });
  const updated = context.rows.get('members/actor');
  assert.equal(updated.name, 'Niko');
  assert.equal(updated.personKey, 'Nikodem');
  assert.equal(updated.role, 'child');
  assert.equal(updated.schoolEnabled, true);
  assert.equal(updated.birthDate, '2014-08-16');
  assert.equal(context.rows.get('members/sibling').name, 'Paweł');
});

test('duplicate names and renamed legacy identity aliases cannot be acquired by another profile', async () => {
  const context = services({ actor: child, sibling: { ...child, name: 'Paweł', personKey: 'Paweł' } });
  for (const name of ['Paweł', 'paweł']) {
    await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'actor', name }), { code: 'ACCOUNT_DUPLICATE_MEMBER' });
  }
  context.rows.set('members/sibling', { ...child, name: 'Pawcio', personKey: 'Paweł' });
  await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'actor', name: 'Paweł' }), { code: 'ACCOUNT_DUPLICATE_MEMBER' });
  assert.equal(context.rows.get('members/actor').personKey, 'Nikodem');
  assert.equal(context.calls.length, 0);
});

test('a present invalid personKey never falls back to name or gains a replacement during rename', async () => {
  for (const personKey of ['', null, 17, 'other-person', 'family']) {
    const context = services({ actor: { ...child, personKey } });
    await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'actor', name: 'Nowe imię' }), { code: 'ACCOUNT_PROFILE_IDENTITY_INVALID' });
    assert.equal(context.rows.get('members/actor').personKey, personKey);
    assert.equal(context.calls.length, 0);
  }
  const invalidLegacy = { ...child, name: 'Niewiązany profil' };
  delete invalidLegacy.personKey;
  const context = services({ actor: invalidLegacy });
  await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'actor', name: 'Niko' }), { code: 'ACCOUNT_PROFILE_IDENTITY_INVALID' });
});

test('new dynamic profile rename preserves its hashed identity and supports profiles without Auth', async () => {
  const context = services({ actor: parent, offline: { ...adult, canLogin: false, name: 'Nowy dorosły' } });
  await manageProfileAction(context, { action: 'update', uid: 'offline', name: 'Babcia', emoji: '👵' });
  const result = context.rows.get('members/offline');
  assert.equal(result.personKey, key('a'));
  assert.equal(result.canLogin, false);
  assert.equal(result.role, 'adult');
  assert.equal(result.emoji, '👵');
});

test('profile endpoint rejects identity, permissions, URLs and unknown actions before writing', async () => {
  const context = services();
  for (const extra of [{ role: 'parent' }, { personKey: 'Paweł' }, { canLogin: true }, { schoolEnabled: true }, { photoURL: 'https://example.test/photo.jpg' }, { avatarSource: 'google' }, { password: 'forbidden' }, { action: 'archive' }]) {
    await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'child', emoji: '👦', ...extra }), { code: 'ACCOUNT_INVALID_REQUEST' });
  }
  for (const body of [null, [], { action: 'update', uid: '../child', emoji: '👦' }, { action: 'update', uid: 'child' }, { action: 'update', uid: 'child', name: '' }, { action: 'family', uid: 'child', emoji: '👨‍👩‍👧‍👦' }]) {
    await assert.rejects(manageProfileAction(context, body), { code: 'ACCOUNT_INVALID_REQUEST' });
  }
  assert.equal(context.calls.length, 0);
});

test('avatar metadata requires matching target, uploader, UUID and approved image extension', async () => {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) assert.equal(validProfileAvatarPath(memberPath('child', 'actor', ext), { uid: 'actor', targetUid: 'child' }), true);
  assert.equal(validProfileAvatarPath(familyPath(), { uid: 'actor', family: true }), true);
  const context = services();
  for (const avatarPath of [memberPath('adult'), memberPath('child', 'adult'), familyPath(), memberPath('child', 'actor', 'svg'), 'avatars/members/child/actor/not-a-uuid.png', `avatars/members/child/actor/../${uuid}.png`, `https://example.test/${uuid}.jpg`, `avatars/members/child/actor/${uuid}.jpg?token=forbidden`]) {
    await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'child', avatarAction: 'set', avatarPath }), { code: 'ACCOUNT_INVALID_AVATAR' });
  }
  for (const body of [{ avatarPath: memberPath() }, { avatarAction: 'reset', avatarPath: memberPath() }, { avatarAction: 'unknown' }]) {
    await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'child', ...body }), { code: 'ACCOUNT_INVALID_REQUEST' });
  }
  assert.equal(context.calls.length, 0);
});

test('setting and resetting avatars stores only a protected path and never changes account fields', async () => {
  const context = services({ actor: parent, child: { ...child, photoURL: '/legacy-photo.jpg', avatarSource: 'google' } });
  await manageProfileAction(context, { action: 'update', uid: 'child', avatarAction: 'set', avatarPath: memberPath() });
  let profile = context.rows.get('members/child');
  assert.equal(profile.avatarPath, memberPath());
  assert.equal(profile.avatarSource, 'custom');
  assert.equal(Object.hasOwn(profile, 'photoURL'), false);
  await manageProfileAction(context, { action: 'update', uid: 'child', avatarAction: 'reset' });
  profile = context.rows.get('members/child');
  assert.equal(profile.avatarSource, 'default');
  assert.equal(Object.hasOwn(profile, 'avatarPath'), false);
  assert.equal(Object.hasOwn(profile, 'photoURL'), false);
  assert.equal(profile.personKey, 'Nikodem');
  assert.equal(profile.canLogin, true);
});

test('family presentation has a dedicated metadata document and cannot become an account', async () => {
  const context = services();
  await manageProfileAction(context, { action: 'family', emoji: '👨‍👩‍👧‍👦', avatarAction: 'set', avatarPath: familyPath() });
  assert.equal(context.rows.get('familySettings/profile').avatarPath, familyPath());
  assert.equal(context.rows.get('familySettings/profile').avatarSource, 'custom');
  assert.equal(context.rows.has('members/family'), false);
  await manageProfileAction(context, { action: 'family', avatarAction: 'reset' });
  assert.equal(context.rows.get('familySettings/profile').avatarSource, 'default');
  assert.equal(context.rows.get('familySettings/profile').emoji, '👨‍👩‍👧‍👦');
  assert.equal(Object.hasOwn(context.rows.get('familySettings/profile'), 'avatarPath'), false);
  for (const actor of [adult, child, { ...parent, canLogin: false }]) {
    const denied = services({ actor });
    await assert.rejects(manageProfileAction(denied, { action: 'family', emoji: '👪' }), { code: 'ACCOUNT_PARENT_REQUIRED' });
    assert.equal(denied.calls.length, 0);
  }
});

test('role changes concurrent with profile editing are rechecked inside the transaction', async () => {
  const context = services();
  context.rows.set('members/child', { ...adult, name: 'Nikodem' });
  await assert.rejects(manageProfileAction(context, { action: 'update', uid: 'child', emoji: '👦' }), { code: 'ACCOUNT_PROFILE_EDIT_DENIED' });
  assert.equal(context.calls.length, 0);
});
