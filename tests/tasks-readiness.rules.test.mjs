import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { deleteObject, getMetadata, ref, uploadBytes } from 'firebase/storage';

// Synthetic households only. Never infer production identities or use a cloud endpoint.
const projectId = 'demo-nasza-rodzina';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
  || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199') {
  throw new Error('Task readiness Rules tests require the local Firestore and Storage emulators.');
}
const familyId = 'task-fixture-household';
const childPerson = 'member-111111111111111111111111';
const siblingPerson = 'member-222222222222222222222222';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let environment;
const databaseFor = uid => environment.authenticatedContext(uid).firestore();
const storageFor = uid => environment.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`);
const profile = (role, personKey, overrides = {}) => ({ name: 'Osoba testowa', personKey, role,
  active: true, canLogin: true, archived: false, familyId, ...overrides });
const put = (name, id, data) => environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), name, id), data));

before(async () => {
  environment = await initializeTestEnvironment({ projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  const people = {
    'parent-a': profile('parent', 'parent-person-a'),
    'parent-b': profile('parent', 'parent-person-b'),
    'child-a': profile('child', childPerson),
    'child-b': profile('child', siblingPerson),
    'adult-a': profile('adult', 'adult-person'),
    'foreign-parent': profile('parent', 'foreign-parent', { familyId: 'another-household' }),
    'foreign-child': profile('child', childPerson, { familyId: 'another-household' }),
    'disabled-parent': profile('parent', 'disabled-parent', { disabled: true }),
    'disabled-child': profile('child', childPerson, { disabled: true }),
    'archived-parent': profile('parent', 'archived-parent', { archived: true }),
    'no-login-parent': profile('parent', 'no-login-parent', { canLogin: false }),
  };
  await Promise.all(Object.entries(people).map(([uid, data]) => put('members', uid, data)));
  for (const [id, person] of [['own', childPerson], ['sibling', siblingPerson], ['family', 'family'], ['adult', 'adult-person']]) {
    await put('tasks', id, { title: 'Zadanie testowe', familyId, person, points: 5, done: false, createdBy: 'parent-a' });
  }
  await put('tasks', 'foreign', { title: 'Zadanie obcej rodziny', familyId: 'another-household', person: childPerson, points: 99 });
});
after(async () => { await environment?.cleanup(); });

test('both parents read household tasks; a child reads only own and family assignments', async () => {
  for (const uid of ['parent-a', 'parent-b']) {
    for (const id of ['own', 'sibling', 'family']) await assertSucceeds(getDoc(doc(databaseFor(uid), 'tasks', id)));
    const result = await assertSucceeds(getDocs(query(collection(databaseFor(uid), 'tasks'), where('familyId', '==', familyId))));
    assert.equal(result.size, 4);
  }
  for (const id of ['own', 'family']) await assertSucceeds(getDoc(doc(databaseFor('child-a'), 'tasks', id)));
  await assertFails(getDoc(doc(databaseFor('child-a'), 'tasks', 'sibling')));
  const own = await assertSucceeds(getDocs(query(collection(databaseFor('child-a'), 'tasks'),
    where('familyId', '==', familyId), where('person', 'in', [childPerson, 'family']))));
  assert.equal(own.size, 2);
  await assertFails(getDocs(query(collection(databaseFor('child-a'), 'tasks'), where('familyId', '==', familyId))));
  await assertFails(getDocs(collection(databaseFor('parent-a'), 'tasks')));
  await assertSucceeds(getDoc(doc(databaseFor('adult-a'), 'tasks', 'adult')));
  await assertFails(getDoc(doc(databaseFor('adult-a'), 'tasks', 'own')));
});

test('foreign households cannot read a task even with the same person key', async () => {
  for (const uid of ['foreign-parent', 'foreign-child']) {
    for (const id of ['own', 'family']) await assertFails(getDoc(doc(databaseFor(uid), 'tasks', id)));
    await assertFails(getDocs(query(collection(databaseFor(uid), 'tasks'), where('familyId', '==', familyId))));
  }
  await assertFails(getDoc(doc(databaseFor('parent-a'), 'tasks', 'foreign')));
});

test('missing, empty, legacy and malformed household IDs never establish task membership', async () => {
  for (const invalid of [undefined, null, '', ' ', '__legacy__', 12, 'invalid/family']) {
    const actor = profile('parent', 'unscoped-parent');
    const task = { title: 'Stare zadanie testowe', person: 'family' };
    if (invalid !== undefined) { actor.familyId = invalid; task.familyId = invalid; }
    else delete actor.familyId;
    await put('members', 'unscoped-parent', actor);
    await put('tasks', 'unscoped', task);
    await assertFails(getDoc(doc(databaseFor('unscoped-parent'), 'tasks', 'unscoped')));
    await assertFails(getDoc(doc(databaseFor('unscoped-parent'), 'tasks', 'own')));
    await assertFails(getDoc(doc(databaseFor('parent-a'), 'tasks', 'unscoped')));
  }
});

test('disabled, archived, non-login, unrelated and anonymous actors cannot read tasks', async () => {
  for (const uid of ['disabled-parent', 'disabled-child', 'archived-parent', 'no-login-parent', 'unknown']) {
    await assertFails(getDoc(doc(databaseFor(uid), 'tasks', 'own')));
  }
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'tasks', 'own')));
});

test('all task transitions and point/reward writes remain server-only for every role', async () => {
  const collections = ['taskPointBalances', 'taskPointLedger', 'taskCompletions', 'taskRewards', 'taskRewardRequests',
    '_taskRewardPending', '_taskPhotoUploads', '_taskPhotoCleanup', '_taskRewardImageUploads', '_taskRewardImageCleanup'];
  for (const name of collections) await put(name, 'existing', { familyId, person: childPerson, balance: 10 });
  for (const uid of ['parent-a', 'parent-b', 'child-a', 'foreign-parent']) {
    const db = databaseFor(uid);
    await assertFails(setDoc(doc(db, 'tasks', 'forged'), { familyId, person: childPerson, done: true, points: 999, createdBy: uid }));
    await assertFails(updateDoc(doc(db, 'tasks', 'own'), { done: true, pointsBooked: true, approvalStatus: 'approved' }));
    await assertFails(deleteDoc(doc(db, 'tasks', 'own')));
    for (const name of collections) {
      await assertFails(getDoc(doc(db, name, 'existing')));
      await assertFails(setDoc(doc(db, name, 'forged'), { familyId, person: childPerson, balance: 999, delta: 999 }));
      await assertFails(updateDoc(doc(db, name, 'existing'), { balance: 999 }));
      await assertFails(deleteDoc(doc(db, name, 'existing')));
    }
  }
});

async function proof(overrides = {}) {
  const id = randomUUID(); const path = `taskProof/own/child-a/${id}.png`;
  const ticket = { familyId, taskId: 'own', uid: 'child-a', person: childPerson, path, state: 'open',
    expiresAt: Timestamp.fromMillis(Date.now() + 60_000), size: png.length, contentType: 'image/png', ...overrides };
  await put('_taskPhotoUploads', id, ticket);
  return { id, path };
}
async function stored(path) {
  await environment.withSecurityRulesDisabled(context => uploadBytes(ref(context.storage(`gs://${projectId}.appspot.com`), path), png, { contentType: 'image/png' }));
}

test('proof upload needs a live exact ticket; both parents and only its child can read it', async () => {
  const ticket = await proof();
  await assertSucceeds(uploadBytes(ref(storageFor('child-a'), ticket.path), png, { contentType: 'image/png' }));
  for (const uid of ['parent-a', 'parent-b', 'child-a']) await assertSucceeds(getMetadata(ref(storageFor(uid), ticket.path)));
  for (const uid of ['child-b', 'foreign-parent', 'foreign-child', 'disabled-parent', 'disabled-child']) {
    await assertFails(getMetadata(ref(storageFor(uid), ticket.path)));
    await assertFails(uploadBytes(ref(storageFor(uid), ticket.path), png, { contentType: 'image/png' }));
  }
  await assertFails(uploadBytes(ref(storageFor('child-a'), ticket.path), png, { contentType: 'image/png' }));
  await assertFails(deleteObject(ref(storageFor('parent-a'), ticket.path)));
  for (const overrides of [{ state: 'revoked' }, { expiresAt: Timestamp.fromMillis(1) }, { size: png.length + 1 }, { contentType: 'image/jpeg' }, { familyId: 'another-household' }]) {
    const denied = await proof(overrides);
    await assertFails(uploadBytes(ref(storageFor('child-a'), denied.path), png, { contentType: 'image/png' }));
  }
});

test('unscoped or legacy proof tickets never allow null-to-null household access', async () => {
  for (const invalid of [undefined, null, '', '__legacy__', ' ', 'invalid/family']) {
    const actor = profile('parent', 'unscoped-parent');
    if (invalid === undefined) delete actor.familyId; else actor.familyId = invalid;
    await put('members', 'unscoped-parent', actor);
    const ticket = await proof({ familyId: invalid ?? null }); await stored(ticket.path);
    if (invalid === undefined) {
      await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), '_taskPhotoUploads', ticket.id), {
        taskId: 'own', uid: 'child-a', person: childPerson, path: ticket.path, state: 'submitted' }));
    }
    for (const uid of ['unscoped-parent', 'parent-a']) await assertFails(getMetadata(ref(storageFor(uid), ticket.path)));
  }
});

test('missing or empty personKey uses the child name for own tasks and proofs without widening access', async () => {
  for (const personKey of [undefined, '']) {
    const actor = profile('child', childPerson); actor.name = 'Uczeń testowy bez klucza';
    if (personKey === undefined) delete actor.personKey; else actor.personKey = personKey;
    await put('members', 'child-a', actor);
    await put('tasks', 'own', { title: 'Zadanie testowe', familyId, person: actor.name, points: 5 });
    await assertSucceeds(getDoc(doc(databaseFor('child-a'), 'tasks', 'own')));
    await assertFails(getDoc(doc(databaseFor('child-a'), 'tasks', 'sibling')));
    await assertFails(getDoc(doc(databaseFor('child-a'), 'tasks', 'foreign')));
    const rows = await assertSucceeds(getDocs(query(collection(databaseFor('child-a'), 'tasks'),
      where('familyId', '==', familyId), where('person', 'in', [actor.name, 'family']))));
    assert.equal(rows.size, 2);
    const ticket = await proof({ person: actor.name });
    await assertSucceeds(uploadBytes(ref(storageFor('child-a'), ticket.path), png, { contentType: 'image/png' }));
    await assertSucceeds(getMetadata(ref(storageFor('child-a'), ticket.path)));
    await assertSucceeds(getMetadata(ref(storageFor('parent-a'), ticket.path)));
    for (const uid of ['child-b', 'foreign-parent', 'foreign-child']) await assertFails(getMetadata(ref(storageFor(uid), ticket.path)));
    const otherPerson = await proof({ person: siblingPerson });
    await assertFails(uploadBytes(ref(storageFor('child-a'), otherPerson.path), png, { contentType: 'image/png' }));
  }
});

async function rewardImage(overrides = {}) {
  const id = randomUUID(); const path = `taskRewardImages/reward/parent-a/${id}.png`;
  await put('_taskRewardImageUploads', id, { familyId, rewardId: 'reward', uid: 'parent-a', path, state: 'open',
    people: [childPerson], active: true, expiresAt: Timestamp.fromMillis(Date.now() + 60_000), size: png.length, contentType: 'image/png', ...overrides });
  return { id, path };
}

test('reward image upload belongs to its parent and attached image respects household and assigned child', async () => {
  const ticket = await rewardImage();
  await assertSucceeds(uploadBytes(ref(storageFor('parent-a'), ticket.path), png, { contentType: 'image/png' }));
  await assertSucceeds(getMetadata(ref(storageFor('parent-a'), ticket.path)));
  for (const uid of ['parent-b', 'child-a', 'foreign-parent', 'disabled-parent']) await assertFails(getMetadata(ref(storageFor(uid), ticket.path)));
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), '_taskRewardImageUploads', ticket.id), { state: 'attached' }));
  for (const uid of ['parent-a', 'parent-b', 'child-a']) await assertSucceeds(getMetadata(ref(storageFor(uid), ticket.path)));
  for (const uid of ['child-b', 'foreign-parent', 'foreign-child', 'disabled-parent', 'disabled-child']) await assertFails(getMetadata(ref(storageFor(uid), ticket.path)));
  await assertFails(deleteObject(ref(storageFor('parent-a'), ticket.path)));
  const open = await rewardImage();
  for (const uid of ['parent-b', 'child-a', 'foreign-parent', 'disabled-parent']) await assertFails(uploadBytes(ref(storageFor(uid), open.path), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(storageFor('parent-a'), open.path), png, { contentType: 'image/jpeg' }));
});

test('reward image family scope rejects missing and reserved IDs even for an unscoped parent', async () => {
  for (const invalid of [undefined, null, '', '__legacy__', ' ']) {
    const actor = profile('parent', 'unscoped-parent');
    if (invalid === undefined) delete actor.familyId; else actor.familyId = invalid;
    await put('members', 'unscoped-parent', actor);
    const ticket = await rewardImage({ familyId: invalid ?? null, state: 'attached', people: [] });
    if (invalid === undefined) {
      await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), '_taskRewardImageUploads', ticket.id), {
        rewardId: 'reward', uid: 'parent-a', path: ticket.path, state: 'attached', people: [], active: true }));
    }
    await stored(ticket.path);
    for (const uid of ['unscoped-parent', 'parent-a']) await assertFails(getMetadata(ref(storageFor(uid), ticket.path)));
  }
});
