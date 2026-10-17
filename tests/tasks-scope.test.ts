import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase/app';
import { collection, getFirestore, query, queryEqual, where } from 'firebase/firestore';
import { taskFamilyId, tasksHouseholdQuery, tasksReadScope } from '../src/task-scope';

const database = getFirestore(initializeApp({ projectId: 'demo-tasks-query-only' }, 'tasks-query-only'));
const member = { familyId: 'test-household', role: 'parent', active: true, canLogin: true, personKey: 'test-person' };

test('client refuses unassigned legacy or inactive scopes rather than issuing an unbounded task query', () => {
  for (const familyId of [undefined, '', '__legacy__', 'unsafe/id', ' ', 'test household']) {
    assert.equal(taskFamilyId({ familyId }), null);
    assert.equal(tasksHouseholdQuery(database, { ...member, familyId }), null);
  }
  for (const changed of [{ active: false }, { canLogin: false }, { archived: true }, { disabled: true }, { role: 'unknown' }]) {
    assert.equal(tasksHouseholdQuery(database, { ...member, ...changed }), null);
  }
});

test('parent and child use actual SDK queries matching household and own/family Rules', () => {
  const parent = tasksHouseholdQuery(database, member)!;
  assert.ok(queryEqual(parent, query(collection(database, 'tasks'), where('familyId', '==', member.familyId))));
  for (const role of ['child', 'adult']) {
    const own = tasksHouseholdQuery(database, { ...member, role })!;
    assert.ok(queryEqual(own, query(collection(database, 'tasks'), where('familyId', '==', member.familyId),
      where('person', 'in', [member.personKey, 'family']))));
    assert.equal(queryEqual(own, parent), false);
  }
});

test('task display cache scope changes on user, household, person, role or access revocation', () => {
  const original = tasksReadScope('test-uid-a', member);
  assert.notEqual(original, tasksReadScope('test-uid-b', member));
  for (const changed of [{ familyId: 'other-household' }, { role: 'child' }, { personKey: 'other-person' },
    { active: false }, { canLogin: false }, { archived: true }, { disabled: true }]) {
    assert.notEqual(original, tasksReadScope('test-uid-a', { ...member, ...changed }));
  }
});
