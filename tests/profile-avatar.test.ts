import assert from 'node:assert/strict';
import test from 'node:test';
import { AVATAR_MAX_BYTES, avatarFileExtension, canEditFamilyProfile, chatEligibleProfiles, profileAvatarPath, validProfileAvatarPath } from '../src/account/profile-avatar';

const uuid = '3d5e2a2e-9654-4b25-8545-8b9b15ec11a0';
test('avatars accept only actual image MIME types up to the protected 5 MB boundary', () => {
  for (const [type, extension] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif']]) assert.equal(avatarFileExtension({ type, size: AVATAR_MAX_BYTES }), extension);
  for (const file of [{ type: 'image/svg+xml', size: 10 }, { type: 'application/pdf', size: 10 }, { type: 'image/png', size: 0 }, { type: 'image/png', size: AVATAR_MAX_BYTES + 1 }]) assert.throws(() => avatarFileExtension(file));
});
test('protected avatar paths preserve target UID and uploader UID without public download URLs', () => {
  const member = profileAvatarPath('profile-child', 'parent-uid', 'png', uuid);
  assert.equal(member, `avatars/members/profile-child/parent-uid/${uuid}.png`);
  assert.equal(validProfileAvatarPath(member, 'profile-child'), true);
  assert.equal(validProfileAvatarPath(member, 'sibling-uid'), false);
  const family = profileAvatarPath(null, 'parent-uid', 'jpg', uuid);
  assert.equal(validProfileAvatarPath(family), true);
  assert.equal(validProfileAvatarPath(family, 'profile-child'), false);
});
test('avatar path validation rejects medical files, external URLs and path traversal', () => {
  for (const path of [`health/profile-child/document.pdf`, `https://example.test/photo.png`, `avatars/members/profile-child/../${uuid}.png`, `avatars/family/parent-uid/${uuid}.svg`, `avatars/family/parent-uid/not-a-uuid.png`]) assert.equal(validProfileAvatarPath(path, 'profile-child'), false);
  assert.throws(() => profileAvatarPath('parent/child', 'parent-uid', 'png', uuid));
  assert.throws(() => profileAvatarPath(null, '../other', 'png', uuid));
  assert.throws(() => profileAvatarPath(null, 'parent-uid', 'svg', uuid));
  assert.equal(validProfileAvatarPath({ private: 'corrupt metadata' }), false);
  assert.equal(validProfileAvatarPath(null), false);
});
test('parents can edit their own photo, children and passive profiles, never another active adult account', () => {
  const actor = { id: 'parent', role: 'parent' };
  assert.equal(canEditFamilyProfile(actor, { id: 'parent', role: 'parent', active: true, canLogin: true }), true);
  assert.equal(canEditFamilyProfile(actor, { id: 'child', role: 'child', active: true, canLogin: true }), true);
  assert.equal(canEditFamilyProfile(actor, { id: 'grandmother', role: 'adult', active: true, canLogin: false }), true);
  assert.equal(canEditFamilyProfile(actor, { id: 'other-parent', role: 'parent', active: true, canLogin: true }), false);
  assert.equal(canEditFamilyProfile(actor, { id: 'adult', role: 'adult', active: true, canLogin: true }), false);
});
test('children and adults can edit only themselves and an archived profile is not editable', () => {
  for (const role of ['adult', 'child']) {
    const actor = { id: 'self', role };
    assert.equal(canEditFamilyProfile(actor, { id: 'self', role, active: true }), true);
    assert.equal(canEditFamilyProfile(actor, { id: 'sibling', role: 'child', active: true }), false);
    assert.equal(canEditFamilyProfile(actor, { id: 'parent', role: 'parent', active: true }), false);
    assert.equal(canEditFamilyProfile(actor, { id: 'self', role, archived: true }), false);
  }
});
test('chat recipients are dynamic active login profiles, including adults, without passive or archived accounts', () => {
  const profiles = [
    { id: 'one', role: 'parent', active: true, canLogin: true },
    { id: 'two', role: 'adult', active: true, canLogin: true },
    { id: 'three', role: 'child', active: true, canLogin: true },
    { id: 'baby', role: 'child', active: true, canLogin: false },
    { id: 'archived', role: 'adult', active: true, canLogin: true, archived: true },
    { id: 'disabled', role: 'child', active: true, canLogin: true, disabled: true },
    { id: 'unknown', role: 'owner', active: true, canLogin: true },
    { id: 'missing-active', role: 'child', canLogin: true },
  ];
  assert.deepEqual(chatEligibleProfiles(profiles).map(profile => profile.id), ['one', 'two', 'three']);
  assert.equal(profiles.length, 8, 'Filtering does not erase historical profiles.');
});
