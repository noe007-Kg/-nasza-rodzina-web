import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { deleteObject, getBytes, getMetadata, listAll, ref, updateMetadata, uploadBytes } from 'firebase/storage';

// These tests create synthetic households only in the explicitly selected demo
// project. No production SDK, service account, or non-loopback host is accepted.
const projectId = 'demo-nasza-rodzina';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
  || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199') {
  throw new Error('Household Rules tests require the local demo Firestore and Storage emulators.');
}
const A = 'household-test-a', B = 'household-test-b';
const childPerson = 'member-111111111111111111111111';
const siblingPerson = 'member-222222222222222222222222';
const parentPerson = 'member-aaaaaaaaaaaaaaaaaaaaaaaa';
const foreignPerson = 'member-bbbbbbbbbbbbbbbbbbbbbbbb';
const profiles = {
  'parent-a': { role: 'parent', personKey: parentPerson, familyId: A },
  'mother-a': { role: 'parent', personKey: 'member-cccccccccccccccccccccccc', familyId: A },
  'child-a': { role: 'child', personKey: childPerson, familyId: A },
  'sibling-a': { role: 'child', personKey: siblingPerson, familyId: A },
  'adult-a': { role: 'adult', personKey: 'member-dddddddddddddddddddddddd', familyId: A },
  'parent-b': { role: 'parent', personKey: foreignPerson, familyId: B },
  'child-b': { role: 'child', personKey: childPerson, familyId: B },
  'missing-family': { role: 'parent', personKey: parentPerson },
  'legacy-family': { role: 'parent', personKey: parentPerson, familyId: '__legacy__' },
  'invalid-family': { role: 'parent', personKey: parentPerson, familyId: ' house test ' },
  'disabled-a': { role: 'parent', personKey: parentPerson, familyId: A, disabled: true },
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let environment;
const dbFor = uid => environment.authenticatedContext(uid).firestore();
const storageFor = uid => environment.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`);
const sharedEvent = (uid = 'parent-a', overrides = {}) => ({ title: 'Synthetic calendar event', person: parentPerson,
  createdBy: uid, ownerUid: uid, ownerProfileId: 'parent-a', familyId: A, private: false, visibility: 'family',
  source: 'manual', date: Timestamp.fromMillis(1800000000000), endDate: Timestamp.fromMillis(1800003600000), ...overrides });
const future = () => Timestamp.fromMillis(Date.now() + 60_000);
before(async () => {
  environment = await initializeTestEnvironment({ projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all(Object.entries(profiles).map(([uid, profile]) => setDoc(doc(db, 'members', uid), {
      name: 'Synthetic household profile', active: true, canLogin: true, archived: false, ...profile })));
    await Promise.all([
      setDoc(doc(db, 'familySettings', 'profile'), { familyId: A, emoji: '🏠' }),
      setDoc(doc(db, 'familySettings', A), { familyId: A, emoji: '🏠' }),
      setDoc(doc(db, 'calendarEvents', 'shared-a'), sharedEvent()),
      setDoc(doc(db, 'calendarEvents', 'hidden-private-a'), sharedEvent('parent-a', { private: true, visibility: 'private' })),
      setDoc(doc(db, 'calendarEvents', 'unassigned'), sharedEvent('parent-a', { familyId: null })),
      setDoc(doc(db, 'privateCalendarEvents', 'private-a'), sharedEvent('parent-a', { private: true, visibility: 'private' })),
      setDoc(doc(db, 'privateCalendarEvents', 'legacy-private-a'), { title: 'Synthetic legacy private event',
        person: parentPerson, ownerUid: 'parent-a', createdBy: 'parent-a', private: true }),
      setDoc(doc(db, 'tasks', 'own-a'), { familyId: A, person: childPerson, title: 'Synthetic own task', createdBy: 'parent-a' }),
      setDoc(doc(db, 'tasks', 'sibling-a'), { familyId: A, person: siblingPerson, title: 'Synthetic sibling task', createdBy: 'parent-a' }),
      setDoc(doc(db, 'tasks', 'family-a'), { familyId: A, person: 'family', title: 'Synthetic shared task', createdBy: 'parent-a' }),
      setDoc(doc(db, 'tasks', 'unassigned'), { person: childPerson, title: 'Synthetic unassigned task', createdBy: 'parent-a' }),
    ]);
  });
});
after(async () => { await environment?.cleanup(); });
const adminSet = (collectionName, id, data) => environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), collectionName, id), data));
const adminUpload = path => environment.withSecurityRulesDisabled(context => uploadBytes(ref(context.storage(`gs://${projectId}.appspot.com`), path), png, { contentType: 'image/png' }));

test('both parents retain same-household shared calendar CRUD and creator identity', async () => {
  for (const uid of ['parent-a', 'mother-a']) await assertSucceeds(getDoc(doc(dbFor(uid), 'calendarEvents', 'shared-a')));
  const target = doc(dbFor('mother-a'), 'calendarEvents', 'shared-a');
  await assertSucceeds(updateDoc(target, { title: 'Updated by second parent' }));
  await assertSucceeds(updateDoc(target, { person: childPerson, ownerProfileId: 'child-a' }));
  assert.equal((await getDoc(target)).data().createdBy, 'parent-a');
  await assertSucceeds(deleteDoc(target));
  await assertSucceeds(setDoc(doc(dbFor('mother-a'), 'calendarEvents', 'new-a'), sharedEvent('mother-a', {
    person: childPerson, ownerProfileId: 'child-a' })));
});

test('foreign household cannot get, list, create, edit or delete shared calendar events', async () => {
  for (const uid of ['parent-b', 'child-b']) {
    const db = dbFor(uid), target = doc(db, 'calendarEvents', 'shared-a');
    await assertFails(getDoc(target));
    await assertFails(getDocs(query(collection(db, 'calendarEvents'), where('familyId', '==', A), where('private', '==', false), where('visibility', '==', 'family'))));
    await assertFails(setDoc(doc(db, 'calendarEvents', `foreign-${uid}`), sharedEvent(uid)));
    await assertFails(updateDoc(target, { title: 'Foreign update' }));
    await assertFails(updateDoc(target, { familyId: B, createdBy: uid, ownerUid: uid, ownerProfileId: uid, person: profiles[uid].personKey }));
    await assertFails(deleteDoc(target));
  }
  await assertFails(getDocs(collection(dbFor('parent-a'), 'calendarEvents')));
  const result = await assertSucceeds(getDocs(query(collection(dbFor('parent-a'), 'calendarEvents'),
    where('familyId', '==', A), where('private', '==', false), where('visibility', '==', 'family'))));
  assert.equal(result.size, 1);
});

test('calendar owner must be a real same-household profile matching the selected person', async () => {
  const db = dbFor('parent-a');
  for (const fields of [{ ownerProfileId: 'parent-b', person: foreignPerson }, { ownerProfileId: 'absent' },
    { ownerUid: 'parent-b' }, { ownerProfileId: 'child-a', person: siblingPerson }, { ownerProfileId: 'family', person: childPerson }]) {
    await assertFails(setDoc(doc(db, 'calendarEvents', randomUUID()), sharedEvent('parent-a', fields)));
    await assertFails(updateDoc(doc(db, 'calendarEvents', 'shared-a'), fields));
  }
  await assertSucceeds(setDoc(doc(db, 'calendarEvents', 'family-event'), sharedEvent('parent-a', { person: 'family', ownerProfileId: 'family' })));
  await assertFails(updateDoc(doc(db, 'calendarEvents', 'shared-a'), { familyId: B }));
  await assertFails(updateDoc(doc(db, 'calendarEvents', 'shared-a'), { createdBy: 'mother-a' }));
});

test('private calendar stays UID-owned even between parents and rejects forged household fields', async () => {
  for (const id of ['private-a', 'legacy-private-a']) await assertSucceeds(getDoc(doc(dbFor('parent-a'), 'privateCalendarEvents', id)));
  for (const uid of ['mother-a', 'parent-b', 'child-a', 'sibling-a']) {
    for (const id of ['private-a', 'legacy-private-a']) {
      const target = doc(dbFor(uid), 'privateCalendarEvents', id);
      await assertFails(getDoc(target)); await assertFails(updateDoc(target, { title: 'Read another member private event' })); await assertFails(deleteDoc(target));
    }
  }
  await assertSucceeds(getDocs(query(collection(dbFor('parent-a'), 'privateCalendarEvents'), where('familyId', '==', A), where('ownerUid', '==', 'parent-a'))));
  await assertSucceeds(updateDoc(doc(dbFor('parent-a'), 'privateCalendarEvents', 'private-a'), { title: 'Own edit' }));
  await assertFails(updateDoc(doc(dbFor('parent-a'), 'privateCalendarEvents', 'private-a'), { ownerUid: 'mother-a' }));
  await assertFails(setDoc(doc(dbFor('parent-b'), 'privateCalendarEvents', 'forged'), sharedEvent('parent-b', { ownerUid: 'parent-b', private: true, visibility: 'private' })));
  for (const uid of ['parent-a', 'mother-a', 'child-a']) await assertFails(getDoc(doc(dbFor(uid), 'calendarEvents', 'hidden-private-a')));
});

test('children can manage their own family-visible events but cannot mutate sibling or parent events', async () => {
  const db = dbFor('child-a');
  const event = sharedEvent('child-a', { person: childPerson, ownerProfileId: 'child-a' });
  await assertSucceeds(setDoc(doc(db, 'calendarEvents', 'child-own'), event));
  await assertSucceeds(updateDoc(doc(db, 'calendarEvents', 'child-own'), { title: 'Own update' }));
  await assertFails(updateDoc(doc(db, 'calendarEvents', 'child-own'), { person: siblingPerson, ownerProfileId: 'sibling-a' }));
  await assertFails(updateDoc(doc(db, 'calendarEvents', 'shared-a'), { title: 'Edit parent event' }));
  await assertFails(deleteDoc(doc(db, 'calendarEvents', 'shared-a')));
  await assertSucceeds(deleteDoc(doc(db, 'calendarEvents', 'child-own')));
});

test('tasks allow same-household parents all tasks and other members only own or family assignments', async () => {
  for (const uid of ['parent-a', 'mother-a']) for (const id of ['own-a', 'sibling-a', 'family-a']) await assertSucceeds(getDoc(doc(dbFor(uid), 'tasks', id)));
  for (const id of ['own-a', 'family-a']) await assertSucceeds(getDoc(doc(dbFor('child-a'), 'tasks', id)));
  await assertFails(getDoc(doc(dbFor('child-a'), 'tasks', 'sibling-a')));
  for (const uid of ['adult-a', 'parent-b', 'child-b']) await assertFails(getDoc(doc(dbFor(uid), 'tasks', 'own-a')));
  await assertSucceeds(getDocs(query(collection(dbFor('child-a'), 'tasks'), where('familyId', '==', A), where('person', 'in', [childPerson, 'family']))));
  await assertSucceeds(getDocs(query(collection(dbFor('parent-a'), 'tasks'), where('familyId', '==', A))));
  await assertFails(getDocs(query(collection(dbFor('child-a'), 'tasks'), where('familyId', '==', A))));
  await assertFails(getDocs(query(collection(dbFor('parent-b'), 'tasks'), where('familyId', '==', A))));
  for (const uid of ['parent-a', 'child-a', 'parent-b']) {
    await assertFails(setDoc(doc(dbFor(uid), 'tasks', 'forged'), { familyId: A, title: 'Forgery', person: childPerson, createdBy: uid }));
    await assertFails(updateDoc(doc(dbFor(uid), 'tasks', 'own-a'), { done: true, points: 999 }));
    await assertFails(deleteDoc(doc(dbFor(uid), 'tasks', 'own-a')));
  }
});

test('missing, sentinel, malformed and disabled household membership fails closed', async () => {
  for (const uid of ['missing-family', 'legacy-family', 'invalid-family', 'disabled-a']) {
    await assertSucceeds(getDoc(doc(dbFor(uid), 'members', uid)));
    for (const [collectionName, id] of [['calendarEvents', 'shared-a'], ['privateCalendarEvents', 'private-a'], ['tasks', 'own-a'], ['tasks', 'unassigned']]) {
      await assertFails(getDoc(doc(dbFor(uid), collectionName, id)));
    }
    await assertFails(setDoc(doc(dbFor(uid), 'calendarEvents', randomUUID()), sharedEvent(uid)));
    await assertFails(uploadBytes(ref(storageFor(uid), `quick-products/${uid}/${randomUUID()}.png`), png, { contentType: 'image/png' }));
  }
  for (const uid of ['parent-a', 'parent-b']) await assertFails(getDoc(doc(dbFor(uid), 'tasks', 'unassigned')));
  await assertFails(getDoc(doc(dbFor('parent-a'), 'calendarEvents', 'unassigned')));
});

test('roster and family-avatar metadata cannot be read or forged by another household', async () => {
  const own = await assertSucceeds(getDocs(query(collection(dbFor('parent-a'), 'members'), where('familyId', '==', A))));
  assert.equal(own.size, 6);
  await assertSucceeds(getDoc(doc(dbFor('mother-a'), 'members', 'child-a')));
  await assertFails(getDoc(doc(dbFor('parent-b'), 'members', 'child-a')));
  await assertFails(getDocs(collection(dbFor('parent-a'), 'members')));
  for (const path of ['profile', A]) {
    await assertSucceeds(getDoc(doc(dbFor('parent-a'), 'familySettings', path)));
    await assertFails(getDoc(doc(dbFor('parent-b'), 'familySettings', path)));
  }
  await assertFails(updateDoc(doc(dbFor('parent-a'), 'members', 'parent-a'), { familyId: B }));
  await assertFails(setDoc(doc(dbFor('parent-b'), 'familySettings', A), { familyId: B }));
});

test('avatars and quick products preserve household reads while denying all foreign file mutations', async () => {
  const paths = [`avatars/members/child-a/parent-a/${randomUUID()}.png`, `avatars/family/parent-a/${randomUUID()}.png`,
    `quick-products/parent-a/${randomUUID()}.png`];
  for (const path of paths) {
    await assertSucceeds(uploadBytes(ref(storageFor('parent-a'), path), png, { contentType: 'image/png' }));
    for (const uid of ['mother-a', 'child-a']) await assertSucceeds(getBytes(ref(storageFor(uid), path)));
    for (const uid of ['parent-b', 'child-b']) {
      const object = ref(storageFor(uid), path);
      await assertFails(getMetadata(object)); await assertFails(getBytes(object));
      await assertFails(uploadBytes(object, png, { contentType: 'image/png' }));
      await assertFails(updateMetadata(object, { customMetadata: { forged: 'yes' } }));
      await assertFails(deleteObject(object));
    }
    await assertSucceeds(deleteObject(ref(storageFor('mother-a'), path)));
  }
  await assertFails(listAll(ref(storageFor('parent-b'), 'quick-products/parent-a')));
  await assertFails(uploadBytes(ref(storageFor('parent-b'), `avatars/members/child-a/parent-b/${randomUUID()}.png`), png, { contentType: 'image/png' }));
});

test('a child can edit only its own avatar, never sibling or parent avatars', async () => {
  const self = `avatars/members/child-a/child-a/${randomUUID()}.png`;
  await assertSucceeds(uploadBytes(ref(storageFor('child-a'), self), png, { contentType: 'image/png' }));
  await assertSucceeds(deleteObject(ref(storageFor('child-a'), self)));
  for (const target of ['sibling-a', 'parent-a', 'parent-b']) {
    await assertFails(uploadBytes(ref(storageFor('child-a'), `avatars/members/${target}/child-a/${randomUUID()}.png`), png, { contentType: 'image/png' }));
  }
});

test('legacy medical files require the uploader household plus the existing person/privacy rules', async () => {
  const own = `health/shared/${childPerson}/parent-a/${randomUUID()}.png`;
  const privateFile = `health/parents/${childPerson}/parent-a/${randomUUID()}.png`;
  for (const path of [own, privateFile]) await assertSucceeds(uploadBytes(ref(storageFor('parent-a'), path), png, { contentType: 'image/png' }));
  await assertSucceeds(getBytes(ref(storageFor('child-a'), own)));
  await assertFails(getBytes(ref(storageFor('sibling-a'), own)));
  await assertFails(getBytes(ref(storageFor('child-a'), privateFile)));
  for (const path of [own, privateFile]) {
    await assertSucceeds(getBytes(ref(storageFor('mother-a'), path)));
    for (const uid of ['parent-b', 'child-b']) {
      const object = ref(storageFor(uid), path);
      await assertFails(getBytes(object)); await assertFails(deleteObject(object));
      await assertFails(uploadBytes(object, png, { contentType: 'image/png' }));
      await assertFails(updateMetadata(object, { customMetadata: { spoofed: 'yes' } }));
    }
    await assertSucceeds(deleteObject(ref(storageFor('mother-a'), path)));
  }
  await assertFails(uploadBytes(ref(storageFor('parent-b'), `health/parents/${childPerson}/parent-a/new.png`), png, { contentType: 'image/png' }));
});

async function seedTicket(kind, overrides = {}) {
  const id = randomUUID(), reward = kind === 'reward';
  const namespace = reward ? 'taskRewardImages' : 'taskProof';
  const uploader = reward ? 'parent-a' : 'child-a';
  const target = reward ? 'synthetic-reward' : 'synthetic-task';
  const path = `${namespace}/${target}/${uploader}/${id}.png`;
  const ticket = { familyId: A, uid: uploader, path, state: reward ? 'attached' : 'submitted', person: childPerson,
    active: true, people: [childPerson], size: png.length, contentType: 'image/png', expiresAt: future(),
    ...(reward ? { rewardId: target } : { taskId: target }), ...overrides };
  await adminSet(reward ? '_taskRewardImageUploads' : '_taskPhotoUploads', id, ticket);
  await adminUpload(path);
  return { id, path, namespace: reward ? '_taskRewardImageUploads' : '_taskPhotoUploads', ticket };
}

test('proof and reward tickets require explicit household IDs before their existing UID/privacy checks', async () => {
  for (const kind of ['proof', 'reward']) {
    const item = await seedTicket(kind);
    for (const uid of ['parent-a', 'mother-a', 'child-a']) await assertSucceeds(getBytes(ref(storageFor(uid), item.path)));
    for (const uid of ['parent-b', 'child-b', 'sibling-a', 'missing-family', 'legacy-family']) {
      await assertFails(getBytes(ref(storageFor(uid), item.path)));
      await assertFails(deleteObject(ref(storageFor(uid), item.path)));
      await assertFails(updateMetadata(ref(storageFor(uid), item.path), { customMetadata: { spoofed: 'yes' } }));
    }
    for (const familyId of [null, '__legacy__', B]) {
      await adminSet(item.namespace, item.id, { ...item.ticket, familyId });
      await assertFails(getBytes(ref(storageFor('parent-a'), item.path)));
      await assertFails(getBytes(ref(storageFor('child-a'), item.path)));
    }
  }
});

test('live proof/reward uploads still work and foreign executor/upload-ticket forgery fails', async () => {
  for (const kind of ['proof', 'reward']) {
    const id = randomUUID(), reward = kind === 'reward';
    const uid = reward ? 'parent-a' : 'child-a';
    const target = reward ? 'reward-new' : 'task-new';
    const path = `${reward ? 'taskRewardImages' : 'taskProof'}/${target}/${uid}/${id}.png`;
    const ticket = { familyId: A, uid, person: childPerson, path, state: 'open', size: png.length,
      contentType: 'image/png', expiresAt: future(), active: true, people: [], ...(reward ? { rewardId: target } : { taskId: target }) };
    await adminSet(reward ? '_taskRewardImageUploads' : '_taskPhotoUploads', id, ticket);
    await assertFails(uploadBytes(ref(storageFor('parent-b'), path), png, { contentType: 'image/png' }));
    await assertSucceeds(uploadBytes(ref(storageFor(uid), path), png, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(storageFor(uid), path), png, { contentType: 'image/png' }));
    await assertFails(setDoc(doc(dbFor('parent-b'), reward ? '_taskRewardImageUploads' : '_taskPhotoUploads', id), { ...ticket, familyId: B }));
  }
});

async function seedProtected(overrides = {}) {
  const id = randomUUID(), path = `healthDocuments/${id}/parent-a/${randomUUID()}.png`;
  const data = { familyId: A, state: 'ready', createdBy: 'parent-a', ownerUid: 'adult-a', ownerProfileId: 'adult-a',
    readers: ['parent-a'], editors: ['parent-a'], storagePath: path, size: png.length, mimeType: 'image/png',
    uploadExpiresAt: future(), ...overrides };
  await adminSet('healthDocuments', id, data); await adminUpload(path);
  return { id, path, data };
}

test('protected medical metadata and binaries require both UID ACL and same explicit household', async () => {
  const item = await seedProtected({ readers: ['parent-a', 'child-a', 'parent-b'] });
  for (const uid of ['parent-a', 'child-a']) {
    await assertSucceeds(getDoc(doc(dbFor(uid), 'healthDocuments', item.id)));
    await assertSucceeds(getBytes(ref(storageFor(uid), item.path)));
  }
  for (const uid of ['mother-a', 'sibling-a', 'adult-a', 'parent-b', 'missing-family', 'legacy-family']) {
    await assertFails(getDoc(doc(dbFor(uid), 'healthDocuments', item.id)));
    await assertFails(getBytes(ref(storageFor(uid), item.path)));
    await assertFails(deleteObject(ref(storageFor(uid), item.path)));
  }
  await assertSucceeds(getDocs(query(collection(dbFor('parent-a'), 'healthDocuments'), where('familyId', '==', A),
    where('readers', 'array-contains', 'parent-a'), where('state', '==', 'ready'))));
  await assertFails(getDocs(query(collection(dbFor('parent-b'), 'healthDocuments'), where('familyId', '==', A),
    where('readers', 'array-contains', 'parent-b'), where('state', '==', 'ready'))));
  await adminSet('healthDocuments', item.id, { ...item.data, familyId: null });
  await assertFails(getDoc(doc(dbFor('parent-a'), 'healthDocuments', item.id)));
  await assertFails(getBytes(ref(storageFor('parent-a'), item.path)));
});

test('protected draft upload works only for exact household creator and never foreign ACL entries', async () => {
  const id = randomUUID(), path = `healthDocuments/${id}/parent-a/${randomUUID()}.png`;
  const data = { familyId: A, state: 'draft', createdBy: 'parent-a', readers: ['parent-a', 'parent-b'],
    editors: ['parent-a', 'parent-b'], storagePath: path, size: png.length, mimeType: 'image/png', uploadExpiresAt: future() };
  await adminSet('healthDocuments', id, data);
  await assertFails(uploadBytes(ref(storageFor('parent-b'), path), png, { contentType: 'image/png' }));
  await assertSucceeds(uploadBytes(ref(storageFor('parent-a'), path), png, { contentType: 'image/png' }));
  await assertFails(getBytes(ref(storageFor('parent-a'), path)));
  await assertFails(uploadBytes(ref(storageFor('parent-a'), path), png, { contentType: 'image/png' }));
  await adminSet('healthDocuments', id, { ...data, state: 'ready' });
  await assertSucceeds(getBytes(ref(storageFor('parent-a'), path)));
  await assertFails(getBytes(ref(storageFor('parent-b'), path)));
});

test('medical grants remain household-bound even when a former authorized UID is now in another family', async()=>{
  await adminSet('healthDocumentGrants','child-a',{familyId:A,ownerUid:'child-a',authorizedUids:['parent-a','parent-b']});
  await assertSucceeds(getDoc(doc(dbFor('parent-a'),'healthDocumentGrants','child-a')));
  await assertSucceeds(getDoc(doc(dbFor('child-a'),'healthDocumentGrants','child-a')));
  await assertFails(getDoc(doc(dbFor('parent-b'),'healthDocumentGrants','child-a')));
  await assertFails(getDocs(query(collection(dbFor('parent-b'),'healthDocumentGrants'),where('authorizedUids','array-contains','parent-b'))));
  await adminSet('healthDocumentGrants','parent-b',{familyId:A,ownerUid:'parent-b',authorizedUids:[]});
  await assertFails(getDoc(doc(dbFor('parent-b'),'healthDocumentGrants','parent-b')));
});

test('legacy child without personKey retains authorized own health file access through its profile name', async()=>{
  await adminSet('members','child-a',{familyId:A,role:'child',name:'Paweł',active:true,canLogin:true});
  const path=`health/shared/Paweł/parent-a/${randomUUID()}.png`;
  await adminUpload(path);
  await assertSucceeds(getBytes(ref(storageFor('child-a'),path)));
  await assertFails(getBytes(ref(storageFor('child-b'),path)));
});

test('marked legacy objects cannot follow a moved uploader into another household or lose their family metadata', async()=>{
  const paths=[`health/shared/Paweł/parent-a/${randomUUID()}.png`, `quick-products/parent-a/${randomUUID()}.png`,
    `avatars/family/parent-a/${randomUUID()}.png`];
  await environment.withSecurityRulesDisabled(async context=>{
    for(const path of paths) await uploadBytes(ref(context.storage(`gs://${projectId}.appspot.com`),path),png,
      {contentType:'image/png',customMetadata:{familyId:A}});
  });
  for(const path of paths){
    await assertSucceeds(getBytes(ref(storageFor('mother-a'),path)));
    await assertFails(updateMetadata(ref(storageFor('parent-a'),path),{customMetadata:{familyId:B}}));
  }
  await adminSet('members','parent-a',{role:'parent',name:'Moved uploader',active:true,canLogin:true,familyId:B});
  for(const path of paths){
    await assertFails(getBytes(ref(storageFor('parent-b'),path)));
    await assertFails(getBytes(ref(storageFor('parent-a'),path)));
    await assertFails(deleteObject(ref(storageFor('parent-b'),path)));
  }
});
