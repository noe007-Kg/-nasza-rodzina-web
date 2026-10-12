import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { deleteObject, getMetadata, ref, uploadBytes } from 'firebase/storage';

// No production fallback: generated fixtures run against both explicitly local emulators.
const projectId = 'demo-nasza-rodzina';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
  || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199') {
  throw new Error('Four-package security tests require local Firestore and Storage emulators.');
}
let environment;
const childPerson = 'member-111111111111111111111111';
const siblingPerson = 'member-222222222222222222222222';
const adultPerson = 'member-333333333333333333333333';
const profiles = {
  'parent-a': { role: 'parent', familyId: 'family-a', personKey: 'member-aaaaaaaaaaaaaaaaaaaaaaaa' },
  'mother-a': { role: 'parent', familyId: 'family-a', personKey: 'member-bbbbbbbbbbbbbbbbbbbbbbbb' },
  'child-a': { role: 'child', familyId: 'family-a', personKey: childPerson },
  'sibling-a': { role: 'child', familyId: 'family-a', personKey: siblingPerson },
  'adult-a': { role: 'adult', familyId: 'family-a', personKey: adultPerson },
  'parent-b': { role: 'parent', familyId: 'family-b', personKey: 'member-cccccccccccccccccccccccc' },
  'child-b': { role: 'child', familyId: 'family-b', personKey: 'member-dddddddddddddddddddddddd' },
  'legacy-parent': { role: 'parent', personKey: 'member-eeeeeeeeeeeeeeeeeeeeeeee' },
  'legacy-child': { role: 'child', personKey: 'member-ffffffffffffffffffffffff' },
  'archived-a': { role: 'parent', familyId: 'family-a', personKey: 'member-000000000000000000000000', archived: true },
  'inactive-a': { role: 'parent', familyId: 'family-a', personKey: 'member-999999999999999999999999', canLogin: false },
};
const dbFor = uid => environment.authenticatedContext(uid).firestore();
const storageFor = uid => environment.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`);
// A generated one-pixel PNG, without names, medical data or other personal content.
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const future = () => Timestamp.fromMillis(Date.now() + 10 * 60_000);
const past = () => Timestamp.fromMillis(Date.now() - 60_000);

before(async () => {
  environment = await initializeTestEnvironment({ projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const batch = writeBatch(context.firestore());
    for (const [uid, profile] of Object.entries(profiles)) batch.set(doc(context.firestore(), 'members', uid), {
      name: `Profil testowy ${uid}`, active: true, canLogin: true, archived: false, ...profile,
    });
    await batch.commit();
  });
});
after(async () => { await environment?.cleanup(); });

async function seedRecords(collectionName, records) {
  await environment.withSecurityRulesDisabled(async context => {
    const batch = writeBatch(context.firestore());
    for (const [id, value] of Object.entries(records)) batch.set(doc(context.firestore(), collectionName, id), value);
    await batch.commit();
  });
}
const bill = (overrides = {}) => ({ title: 'Opłata testowa', category: 'Inne', amountGrosze: 12345,
  dueDate: '2026-10-20', familyId: 'family-a', ownerUid: 'parent-a', status: 'unpaid', archived: false,
  sharedWith: [], calendarEnabled: false, ...overrides });

async function seedVisitFile(overrides = {}) {
  const id = randomUUID();
  const path = `healthDocuments/${id}/parent-a/${randomUUID()}.png`;
  const data = { title: 'Załącznik testowy', ownerProfileId: 'adult-a', ownerUid: 'adult-a', ownerPersonKey: adultPerson,
    readers: ['parent-a'], editors: ['parent-a'], createdBy: 'parent-a', familyId: 'family-a',
    attachmentRecordId: 'visit-test', attachmentKind: 'health-record', attachmentPrivate: true,
    protected: true, state: 'draft', storagePath: path, mimeType: 'image/png', size: png.length,
    uploadExpiresAt: future(), createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...overrides };
  await seedRecords('healthDocuments', { [id]: data });
  return { id, path, data };
}
async function seedRewardImage(overrides = {}) {
  const id = randomUUID();
  const path = `taskRewardImages/reward-test/parent-a/${id}.png`;
  const data = { rewardId: 'reward-test', uid: 'parent-a', path, contentType: 'image/png', size: png.length,
    familyId: 'family-a', people: [childPerson], active: true, state: 'open', expiresAt: future(),
    orphanAfter: Timestamp.fromMillis(Date.now() + 24 * 60 * 60_000), ...overrides };
  await seedRecords('_taskRewardImageUploads', { [id]: data });
  return { id, path, data };
}
async function seedObject(path) {
  await environment.withSecurityRulesDisabled(context => uploadBytes(ref(context.storage(`gs://${projectId}.appspot.com`), path), png, { contentType: 'image/png' }));
}

test('finance bills default to parents in the same household; a child sees only the specifically shared bill', async () => {
  await seedRecords('financeBills', {
    private: bill(), shared: bill({ sharedWith: ['child-a'] }),
    foreign: bill({ familyId: 'family-b', ownerUid: 'parent-b', sharedWith: ['child-a'] }),
    archived: bill({ archived: true, sharedWith: ['child-a'] }),
  });
  for (const uid of ['parent-a', 'mother-a']) {
    await assertSucceeds(getDoc(doc(dbFor(uid), 'financeBills', 'private')));
    await assertSucceeds(getDoc(doc(dbFor(uid), 'financeBills', 'shared')));
    await assertFails(getDoc(doc(dbFor(uid), 'financeBills', 'foreign')));
    await assertFails(getDoc(doc(dbFor(uid), 'financeBills', 'archived')));
  }
  await assertSucceeds(getDoc(doc(dbFor('child-a'), 'financeBills', 'shared')));
  for (const id of ['private', 'foreign', 'archived']) await assertFails(getDoc(doc(dbFor('child-a'), 'financeBills', id)));
  for (const uid of ['sibling-a', 'adult-a', 'child-b', 'legacy-parent', 'archived-a', 'inactive-a', 'outsider']) {
    await assertFails(getDoc(doc(dbFor(uid), 'financeBills', 'shared')));
  }
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'financeBills', 'shared')));
  await assertSucceeds(getDoc(doc(dbFor('parent-b'), 'financeBills', 'foreign')));
});

test('finance list queries must prove household and each child sharing constraint', async () => {
  await seedRecords('financeBills', { private: bill(), shared: bill({ sharedWith: ['child-a'] }), foreign: bill({ familyId: 'family-b' }) });
  const parentRows = await assertSucceeds(getDocs(query(collection(dbFor('parent-a'), 'financeBills'),
    where('familyId', '==', 'family-a'), where('archived', '==', false))));
  assert.deepEqual(parentRows.docs.map(row => row.id).sort(), ['private', 'shared']);
  const childRows = await assertSucceeds(getDocs(query(collection(dbFor('child-a'), 'financeBills'),
    where('familyId', '==', 'family-a'), where('sharedWith', 'array-contains', 'child-a'), where('archived', '==', false))));
  assert.deepEqual(childRows.docs.map(row => row.id), ['shared']);
  for (const uid of ['parent-a', 'child-a']) await assertFails(getDocs(collection(dbFor(uid), 'financeBills')));
  await assertFails(getDocs(query(collection(dbFor('child-a'), 'financeBills'), where('familyId', '==', 'family-a'), where('archived', '==', false))));
  await assertFails(getDocs(query(collection(dbFor('child-a'), 'financeBills'), where('sharedWith', 'array-contains', 'child-a'), where('archived', '==', false))));
  await assertFails(getDocs(query(collection(dbFor('parent-b'), 'financeBills'), where('familyId', '==', 'family-a'), where('archived', '==', false))));
});

test('finance bill creation, status, ACL and audit writes remain server-only even for a parent', async () => {
  await seedRecords('financeBills', { shared: bill({ sharedWith: ['child-a'] }) });
  await seedRecords('financeBillAudit', { private: { billId: 'shared', familyId: 'family-a', actorUid: 'parent-a', kind: 'paid' } });
  for (const uid of ['parent-a', 'child-a', 'parent-b']) {
    const db = dbFor(uid);
    await assertFails(setDoc(doc(db, 'financeBills', `forged-${uid}`), bill({ ownerUid: uid })));
    await assertFails(updateDoc(doc(db, 'financeBills', 'shared'), { status: 'paid', paidBy: uid, sharedWith: ['sibling-a'], familyId: 'family-b' }));
    await assertFails(deleteDoc(doc(db, 'financeBills', 'shared')));
    await assertFails(setDoc(doc(db, 'financeBillAudit', `forged-${uid}`), { familyId: 'family-a', kind: 'paid', actorUid: uid }));
    await assertFails(getDoc(doc(db, 'financeBillAudit', 'private')));
    await assertFails(getDocs(collection(db, 'financeBillAudit')));
  }
});

test('legacy finance records are limited to legacy members rather than every project parent', async () => {
  await seedRecords('financeBills', { legacy: bill({ familyId: '__legacy__', ownerUid: 'legacy-parent', sharedWith: ['legacy-child'] }) });
  for (const uid of ['legacy-parent', 'legacy-child']) await assertSucceeds(getDoc(doc(dbFor(uid), 'financeBills', 'legacy')));
  for (const uid of ['parent-a', 'parent-b', 'child-a']) await assertFails(getDoc(doc(dbFor(uid), 'financeBills', 'legacy')));
});

test('private calendar metadata is UID-isolated and clients cannot disguise a finance bill as a family event', async () => {
  await seedRecords('privateCalendarEvents', { private: { ownerUid: 'parent-a', createdBy: 'parent-a', private: true,
    familyId: 'family-a', person: profiles['parent-a'].personKey, title: 'Termin opłaty testowej', source: 'finance', billId: 'private' } });
  await assertSucceeds(getDoc(doc(dbFor('parent-a'), 'privateCalendarEvents', 'private')));
  for (const uid of ['mother-a', 'child-a', 'sibling-a', 'parent-b', 'outsider']) {
    await assertFails(getDoc(doc(dbFor(uid), 'privateCalendarEvents', 'private')));
  }
  for (const uid of ['parent-a', 'child-a']) await assertFails(setDoc(doc(dbFor(uid), 'calendarEvents', `forged-${uid}`), {
    title: 'Opłata ukryta w kalendarzu', person: 'family', private: false, createdBy: uid, source: 'finance', billId: 'private',
  }));
});

test('a protected visit attachment requires its UID ACL and its household, never just a parent role or selected profile', async () => {
  const document = await seedVisitFile({ state: 'ready', readers: ['parent-a', 'adult-a', 'parent-b'] });
  await seedObject(document.path);
  for (const uid of ['parent-a', 'adult-a']) {
    await assertSucceeds(getDoc(doc(dbFor(uid), 'healthDocuments', document.id)));
    await assertSucceeds(getMetadata(ref(storageFor(uid), document.path)));
  }
  for (const uid of ['mother-a', 'child-a', 'sibling-a', 'parent-b', 'child-b', 'archived-a', 'inactive-a', 'outsider']) {
    await assertFails(getDoc(doc(dbFor(uid), 'healthDocuments', document.id)));
    await assertFails(getMetadata(ref(storageFor(uid), document.path)));
  }
  await assertFails(getMetadata(ref(environment.unauthenticatedContext().storage(`gs://${projectId}.appspot.com`), document.path)));
  await assertFails(updateDoc(doc(dbFor('parent-a'), 'healthDocuments', document.id), { readers: ['parent-a', 'mother-a'] }));
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'healthDocuments', document.id), { readers: ['adult-a'], editors: ['adult-a'] }));
  await assertFails(getDoc(doc(dbFor('parent-a'), 'healthDocuments', document.id)));
  await assertFails(getMetadata(ref(storageFor('parent-a'), document.path)));
  await assertSucceeds(getMetadata(ref(storageFor('adult-a'), document.path)));
});

test('visit attachment upload uses an immutable, exact, live server draft and stays unreadable until finalization', async () => {
  const document = await seedVisitFile();
  const target = ref(storageFor('parent-a'), document.path);
  await assertSucceeds(uploadBytes(target, png, { contentType: 'image/png' }));
  await assertFails(getMetadata(target));
  await assertFails(uploadBytes(target, png, { contentType: 'image/png' }));
  await assertFails(deleteObject(target));
  for (const overrides of [{ uploadExpiresAt: past() }, { mimeType: 'application/pdf' }, { size: png.length + 1 },
    { editors: [] }, { createdBy: 'mother-a' }, { state: 'deleting' }, { familyId: 'family-b' }]) {
    const invalid = await seedVisitFile(overrides);
    await assertFails(uploadBytes(ref(storageFor('parent-a'), invalid.path), png, { contentType: 'image/png' }));
  }
  await assertFails(uploadBytes(ref(storageFor('mother-a'), document.path), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(storageFor('parent-a'), `healthDocuments/${document.id}/parent-a/${randomUUID()}.png`), png, { contentType: 'image/png' }));
  await assertFails(setDoc(doc(dbFor('parent-a'), 'healthDocuments', randomUUID()), document.data));
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'healthDocuments', document.id), { state: 'ready' }));
  await assertSucceeds(getMetadata(target));
});

test('clients cannot forge a visit attachment link or move an existing protected file to another patient', async () => {
  const document = await seedVisitFile({ state: 'ready' });
  const visit = { title: 'Wizyta testowa', person: adultPerson, type: 'visit', privateToParents: true,
    createdBy: 'parent-a', familyId: 'family-a', documentPath: '', documentURL: '', attachmentDocumentId: document.id };
  await seedRecords('healthRecords', { 'visit-test': visit, 'unlinked-test': {
    title: 'Wizyta bez załącznika', person: adultPerson, type: 'visit', privateToParents: true,
    createdBy: 'parent-a', documentPath: '', documentURL: '',
  } });
  await assertSucceeds(updateDoc(doc(dbFor('parent-a'), 'healthRecords', 'visit-test'), { title: 'Poprawiona wizyta testowa' }));
  for (const uid of ['parent-a', 'mother-a', 'parent-b']) {
    await assertFails(setDoc(doc(dbFor(uid), 'healthRecords', `forged-${uid}`), { ...visit, createdBy: uid }));
    await assertFails(setDoc(doc(dbFor(uid), 'healthRecords', `empty-forged-${uid}`), { ...visit, createdBy: uid, attachmentDocumentId: '' }));
    await assertFails(updateDoc(doc(dbFor(uid), 'healthRecords', 'unlinked-test'), { attachmentDocumentId: document.id }));
    for (const patch of [{ attachmentDocumentId: randomUUID() }, { person: childPerson }, { privateToParents: false },
      { documentPath: `health/parents/${adultPerson}/${uid}/forged.png` }, { documentURL: 'https://example.test/file.pdf' }]) {
      await assertFails(updateDoc(doc(dbFor(uid), 'healthRecords', 'visit-test'), patch));
    }
  }
  for (const uid of ['mother-a', 'parent-b', 'adult-a', 'child-a']) {
    await assertFails(updateDoc(doc(dbFor(uid), 'healthRecords', 'visit-test'), { title: 'Nieuprawniona zmiana' }));
    await assertFails(deleteDoc(doc(dbFor(uid), 'healthRecords', 'visit-test')));
  }
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'healthDocuments', document.id), { state: 'deleting' }));
  await assertFails(updateDoc(doc(dbFor('parent-a'), 'healthRecords', 'visit-test'), { title: 'Zmiana po odwołaniu załącznika' }));
});

test('a visit link with a mismatched record ID or household does not authorize client edits', async () => {
  for (const overrides of [{ attachmentRecordId: 'different-visit' }, { familyId: 'family-b' }]) {
    const document = await seedVisitFile({ state: 'ready', ...overrides });
    await seedRecords('healthRecords', { 'visit-test': { title: 'Wizyta testowa', person: adultPerson, type: 'visit',
      privateToParents: true, createdBy: 'parent-a', familyId: 'family-a', documentPath: '', documentURL: '', attachmentDocumentId: document.id } });
    await assertFails(updateDoc(doc(dbFor('parent-a'), 'healthRecords', 'visit-test'), { title: 'Zmiana niepoprawnego powiązania' }));
    await assertFails(deleteDoc(doc(dbFor('parent-a'), 'healthRecords', 'visit-test')));
  }
});

test('reward image creation is restricted to the exact live parent upload ticket', async () => {
  const ticket = await seedRewardImage();
  const target = ref(storageFor('parent-a'), ticket.path);
  await assertSucceeds(uploadBytes(target, png, { contentType: 'image/png' }));
  await assertSucceeds(getMetadata(target));
  for (const uid of ['mother-a', 'child-a', 'sibling-a', 'parent-b']) await assertFails(getMetadata(ref(storageFor(uid), ticket.path)));
  await assertFails(uploadBytes(target, png, { contentType: 'image/png' }));
  await assertFails(deleteObject(target));
  await assertFails(uploadBytes(ref(storageFor('parent-a'), `taskRewardImages/reward-test/parent-a/${randomUUID()}.png`), png, { contentType: 'image/png' }));
  for (const overrides of [{ expiresAt: past() }, { state: 'revoked' }, { state: 'deleted' }, { state: 'attached' },
    { size: png.length + 1 }, { contentType: 'image/jpeg' }, { familyId: 'family-b' }, { uid: 'child-a' }]) {
    const invalid = await seedRewardImage(overrides);
    await assertFails(uploadBytes(ref(storageFor('parent-a'), invalid.path), png, { contentType: 'image/png' }));
  }
  const childTicket = await seedRewardImage();
  const childPath = `taskRewardImages/reward-test/child-a/${childTicket.id}.png`;
  await seedRecords('_taskRewardImageUploads', { [childTicket.id]: { ...childTicket.data, uid: 'child-a', path: childPath } });
  await assertFails(uploadBytes(ref(storageFor('child-a'), childPath), png, { contentType: 'image/png' }));
  for (const uid of ['parent-a', 'child-a']) for (const collectionName of ['_taskRewardImageUploads', '_taskRewardImageCleanup']) {
    await assertFails(getDoc(doc(dbFor(uid), collectionName, ticket.id)));
    await assertFails(getDocs(collection(dbFor(uid), collectionName)));
    await assertFails(setDoc(doc(dbFor(uid), collectionName, 'forged'), ticket.data));
  }
});

test('attached reward images keep permanent access only for the same household and allowed people', async () => {
  const restricted = await seedRewardImage({ state: 'attached', expiresAt: past() });
  await seedObject(restricted.path);
  for (const uid of ['parent-a', 'mother-a', 'child-a']) await assertSucceeds(getMetadata(ref(storageFor(uid), restricted.path)));
  for (const uid of ['sibling-a', 'adult-a', 'parent-b', 'child-b', 'legacy-parent', 'archived-a', 'inactive-a', 'outsider']) {
    await assertFails(getMetadata(ref(storageFor(uid), restricted.path)));
  }
  // Older profiles can identify their existing task/reward assignments by name.
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'members', 'child-a'), {
    personKey: deleteField(), name: childPerson,
  }));
  await assertSucceeds(getMetadata(ref(storageFor('child-a'), restricted.path)));
  const allPeople = await seedRewardImage({ state: 'attached', people: [], expiresAt: past() });
  await seedObject(allPeople.path);
  for (const uid of ['child-a', 'sibling-a', 'adult-a']) await assertSucceeds(getMetadata(ref(storageFor(uid), allPeople.path)));
  await assertFails(getMetadata(ref(storageFor('child-b'), allPeople.path)));
  const inactive = await seedRewardImage({ state: 'attached', active: false, people: [] });
  await seedObject(inactive.path);
  await assertSucceeds(getMetadata(ref(storageFor('parent-a'), inactive.path)));
  await assertFails(getMetadata(ref(storageFor('child-a'), inactive.path)));
});

test('revoking a task proof immediately removes proof access while the reward image remains accessible', async () => {
  const reward = await seedRewardImage({ state: 'attached', expiresAt: past() });
  const proofId = randomUUID();
  const proofPath = `taskProof/task-test/child-a/${proofId}.png`;
  await seedRecords('_taskPhotoUploads', { [proofId]: { taskId: 'task-test', uid: 'child-a', person: childPerson,
    path: proofPath, state: 'submitted', familyId: 'family-a', expiresAt: future(), size: png.length, contentType: 'image/png' } });
  await Promise.all([seedObject(proofPath), seedObject(reward.path)]);
  await assertSucceeds(getMetadata(ref(storageFor('parent-a'), proofPath)));
  await assertSucceeds(getMetadata(ref(storageFor('child-a'), proofPath)));
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), '_taskPhotoUploads', proofId), { state: 'revoked' }));
  for (const uid of ['parent-a', 'child-a']) {
    await assertFails(getMetadata(ref(storageFor(uid), proofPath)));
    await assertSucceeds(getMetadata(ref(storageFor(uid), reward.path)));
  }
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), '_taskRewardImageUploads', reward.id), { state: 'revoked' }));
  for (const uid of ['parent-a', 'child-a']) await assertFails(getMetadata(ref(storageFor(uid), reward.path)));
});
