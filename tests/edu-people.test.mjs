import test from 'node:test';
import assert from 'node:assert/strict';
import { activeEduActor, assertCurrentSchoolTarget, schoolPersonKey, schoolProfileEnabled, schoolProfileRoster, validSchoolPersonKey } from '../server/edu-people.mjs';

const key = 'member-0123456789abcdef01234567';
const child = { role: 'child', active: true, canLogin: false, personKey: key, schoolEnabled: true };
function database(rows) {
  return { collection: name => {
    assert.equal(name, 'members');
    return { where: (field, operator, role) => {
      assert.deepEqual([field, operator, role], ['role', '==', 'child']);
      return { limit: limit => { assert.equal(limit, 65); return { get: async () => ({
        size: Math.min(rows.length, limit), docs: rows.slice(0, limit).map(([id, profile]) => ({ id, data: () => profile })),
      }) }; } };
    }, doc: id => ({ id }) };
  } };
}

test('dynamic school person keys are separate from document IDs and display names', () => {
  for (const value of [key, 'Paweł', 'Nikodem', 'Layla']) assert.equal(validSchoolPersonKey(value), true);
  for (const value of ['profile-01234567-89ab-cdef', 'family', 'Sebastian', 'Nowe dziecko', 'member-A'.repeat(24), 'member-short', 'nested/path', null, '']) assert.equal(validSchoolPersonKey(value), false);
});

test('explicit malformed personKey cannot fall back to a matching legacy display name', () => {
  assert.equal(schoolPersonKey({ name: 'Nikodem' }), 'Nikodem');
  for (const personKey of ['', null, undefined, 'nested/person']) assert.equal(schoolPersonKey({ name: 'Nikodem', personKey }), personKey);
});

test('school targets include passive children; actor eligibility still requires login', () => {
  assert.equal(schoolProfileEnabled(child), true);
  assert.equal(activeEduActor(child), false);
  assert.equal(activeEduActor({ ...child, canLogin: true }), true);
  for (const override of [{ role: 'parent' }, { role: 'adult' }, { active: false }, { archived: true }, { disabled: true }, { schoolEnabled: false }]) {
    assert.equal(schoolProfileEnabled({ ...child, ...override }), false);
  }
});

test('legacy school defaults apply only when flags are missing; explicit settings win', () => {
  for (const personKey of ['Paweł', 'Nikodem']) assert.equal(schoolProfileEnabled({ role: 'child', active: true, personKey }), true);
  assert.equal(schoolProfileEnabled({ role: 'child', active: true, personKey: 'Layla' }), false);
  assert.equal(schoolProfileEnabled({ role: 'child', active: true, personKey: 'Layla', schoolEnabled: true }), true);
  assert.equal(schoolProfileEnabled({ ...child, schoolEnabled: undefined }), false);
  assert.equal(schoolProfileEnabled({ ...child, personKey: 'Nikodem', schoolEnabled: false }), false);
  for (const personKey of ['Paweł', 'Nikodem']) {
    for (const schoolEnabled of [undefined, null, 'true', 'false', 0, 1, {}, []]) {
      assert.equal(schoolProfileEnabled({ ...child, personKey, schoolEnabled }), false);
    }
  }
});

test('roster authorization comes from actual eligible documents including passive profiles', async () => {
  const legacyNikodem = { ...child, personKey: 'Nikodem' };
  delete legacyNikodem.schoolEnabled;
  const result = await schoolProfileRoster(database([
    ['profile-real-child', child], ['legacy-nikodem', legacyNikodem],
    ['nonschool', { ...child, personKey: 'Layla', schoolEnabled: false }], ['archived', { ...child, archived: true }],
  ]));
  assert.deepEqual(result.allowedPersonKeys, ['Nikodem', key]);
  assert.deepEqual({ ...result.personProfileIds }, { [key]: 'profile-real-child', Nikodem: 'legacy-nikodem' });
});

test('duplicate, forged and malformed eligible roster entries fail closed', async () => {
  for (const rows of [
    [['first', child], ['second', child]], [['bad', { ...child, personKey: 'profile-UUID' }]],
    [['nested/path', child]], [['bad', { ...child, personKey: '' }]],
  ]) await assert.rejects(schoolProfileRoster(database(rows)), { code: 'EDU_STUDENT_LINK_REQUIRED' });
  await assert.rejects(schoolProfileRoster(database(Array.from({ length: 65 }, (_, index) => [`profile-${index}`, { ...child, schoolEnabled: false }]))), { code: 'EDU_MEMBER_LIMIT' });
});

test('empty school roster is an authorized empty list, not a legacy grant', async () => {
  const result = await schoolProfileRoster(database([]));
  assert.deepEqual(result.allowedPersonKeys, []);
  assert.deepEqual({ ...result.personProfileIds }, {});
});

test('transaction target revalidation rejects eligibility changes and personal UID substitution', async () => {
  const db = database([]);
  const scope = { scope: 'family', actorUid: 'parent', allowedPersonKeys: [key], personProfileIds: { [key]: 'profile-real-child' } };
  const transaction = profile => ({ get: async ref => { assert.equal(ref.id, 'profile-real-child'); return { exists: profile !== null, data: () => profile }; } });
  await assertCurrentSchoolTarget(transaction(child), { db }, scope, key);
  for (const profile of [null, { ...child, archived: true }, { ...child, schoolEnabled: false }, { ...child, active: false }, { ...child, personKey: 'Nikodem' }]) {
    await assert.rejects(assertCurrentSchoolTarget(transaction(profile), { db }, scope, key), { code: 'EDU_STUDENT_LINK_REQUIRED' });
  }
  await assert.rejects(assertCurrentSchoolTarget(transaction({ ...child, canLogin: true }), { db }, { ...scope, scope: 'student', actorUid: 'other-uid' }, key), { code: 'EDU_STUDENT_LINK_REQUIRED' });
});
