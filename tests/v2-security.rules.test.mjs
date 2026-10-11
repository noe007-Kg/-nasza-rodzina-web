import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { deleteObject, getMetadata, ref, uploadBytes } from 'firebase/storage';

// This suite has no production path. It only accepts the explicitly selected local emulators.
const projectId = 'demo-nasza-rodzina';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
  || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199') {
  throw new Error('V2 security tests require local Firestore and Storage emulators.');
}
let environment;
const childPerson = 'member-111111111111111111111111';
const siblingPerson = 'member-222222222222222222222222';
const adultPerson = 'member-333333333333333333333333';
const people = {
  'parent-a': { name: 'Rodzic testowy A', personKey: 'member-aaaaaaaaaaaaaaaaaaaaaaaa', role: 'parent' },
  'parent-b': { name: 'Rodzic testowy B', personKey: 'member-bbbbbbbbbbbbbbbbbbbbbbbb', role: 'parent' },
  'child-a': { name: 'Dziecko testowe A', personKey: childPerson, role: 'child' },
  'child-b': { name: 'Dziecko testowe B', personKey: siblingPerson, role: 'child' },
  'adult-a': { name: 'Dorosły testowy A', personKey: adultPerson, role: 'adult' },
};
const dbFor = uid => environment.authenticatedContext(uid).firestore();
const storageFor = uid => environment.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const now = () => Timestamp.now();
const future = () => Timestamp.fromMillis(Date.now() + 60_000);
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
    const db = context.firestore();
    await Promise.all(Object.entries(people).map(([uid, profile]) => setDoc(doc(db, 'members', uid), {
      ...profile, active: true, canLogin: true, archived: false,
    })));
    await Promise.all([
      setDoc(doc(db, 'tasks', 'assigned'), { person: childPerson, title: 'Zadanie testowe', points: 20,
        done: false, requireApproval: true, approvalStatus: 'none', verificationMode: 'photo', createdBy: 'parent-a' }),
      setDoc(doc(db, 'familyMessages', 'family-test'), { channel: 'family', participants: [], text: 'Wiadomość testowa', uid: 'parent-a', name: 'Rodzic testowy A', createdAt: now() }),
      setDoc(doc(db, 'familyMessages', 'parents-test'), { channel: 'private:parent-a:parent-b', participants: ['parent-a', 'parent-b'], text: 'Prywatna wiadomość testowa', uid: 'parent-a', name: 'Rodzic testowy A', createdAt: now() }),
      setDoc(doc(db, 'schoolParentMessages', 'parent-test'), { person: childPerson, title: 'Prywatna wiadomość szkolna testowa', source: 'eduvulcan' }),
    ]);
  });
});
after(async () => { await environment?.cleanup(); });

async function seedProof(overrides = {}) {
  const id = randomUUID();
  const path = `taskProof/assigned/child-a/${id}.png`;
  const data = { taskId: 'assigned', uid: 'child-a', person: childPerson, path, state: 'open', expiresAt: future(),
    orphanAfter: Timestamp.fromMillis(Date.now() + 24 * 60 * 60_000), size: png.length, contentType: 'image/png', ...overrides };
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), '_taskPhotoUploads', id), data));
  return { id, path, data };
}
async function seedDocument(overrides = {}) {
  const id = randomUUID();
  const path = `healthDocuments/${id}/parent-a/${randomUUID()}.png`;
  const data = { ownerProfileId: 'adult-a', ownerUid: 'adult-a', readers: ['parent-a'], editors: ['parent-a'],
    createdBy: 'parent-a', state: 'draft', protected: true, documentType: 'general', title: 'Dokument testowy',
    storagePath: path, mimeType: 'image/png', size: png.length, uploadExpiresAt: future(), createdAt: now(), updatedAt: now(), ...overrides };
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'healthDocuments', id), data));
  return { id, path, data };
}

test('task and finance writes are exclusively server-authorized, including for parents', async () => {
  const balances = ['taskPointBalances', 'taskPointLedger', 'taskCompletions', 'taskRewards', 'taskRewardRequests'];
  for (const uid of ['parent-a', 'child-a']) {
    const db = dbFor(uid);
    await assertSucceeds(getDoc(doc(db, 'tasks', 'assigned')));
    await assertFails(updateDoc(doc(db, 'tasks', 'assigned'), { done: true, approvalStatus: 'approved', pointsBooked: true }));
    await assertFails(updateDoc(doc(db, 'tasks', 'assigned'), { points: 999, approvalStatus: 'pending' }));
    await assertFails(setDoc(doc(db, 'tasks', 'forged'), { title: 'Fałszywe zadanie', person: childPerson, createdBy: uid, done: true, points: 999 }));
    await assertFails(deleteDoc(doc(db, 'tasks', 'assigned')));
    for (const name of balances) {
      await assertFails(setDoc(doc(db, name, 'forged'), { person: childPerson, balance: 999, delta: 999 }));
      await assertFails(getDocs(collection(db, name)));
    }
  }
});

test('task photo upload requires the exact live server ticket, executor, type and size', async () => {
  const ticket = await seedProof();
  const childStorage = storageFor('child-a');
  await assertSucceeds(uploadBytes(ref(childStorage, ticket.path), png, { contentType: 'image/png' }));
  await assertSucceeds(getMetadata(ref(childStorage, ticket.path)));
  await assertSucceeds(getMetadata(ref(storageFor('parent-a'), ticket.path)));
  await assertFails(getMetadata(ref(storageFor('child-b'), ticket.path)));
  await assertFails(uploadBytes(ref(childStorage, ticket.path), png, { contentType: 'image/png' }));
  await assertFails(deleteObject(ref(childStorage, ticket.path)));
  await assertFails(uploadBytes(ref(storageFor('child-b'), ticket.path), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(childStorage, `taskProof/assigned/child-a/${randomUUID()}.png`), png, { contentType: 'image/png' }));
  for (const overrides of [{ expiresAt: past() }, { state: 'revoked' }, { size: png.length + 1 }, { contentType: 'image/jpeg' }]) {
    const invalid = await seedProof(overrides);
    await assertFails(uploadBytes(ref(childStorage, invalid.path), png, { contentType: 'image/png' }));
  }
  await assertFails(getDoc(doc(dbFor('child-a'), '_taskPhotoUploads', ticket.id)));
});

test('approved task proof becomes inaccessible immediately even before a failed deletion retry', async () => {
  const ticket = await seedProof({ state: 'submitted' });
  await environment.withSecurityRulesDisabled(async context => {
    await uploadBytes(ref(context.storage(`gs://${projectId}.appspot.com`), ticket.path), png, { contentType: 'image/png' });
  });
  await assertSucceeds(getMetadata(ref(storageFor('parent-a'), ticket.path)));
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, 'tasks', 'assigned'), { done: true, approvalStatus: 'approved' });
    batch.update(doc(db, '_taskPhotoUploads', ticket.id), { state: 'revoked' });
    await batch.commit();
  });
  for (const uid of ['parent-a', 'child-a', 'child-b']) await assertFails(getMetadata(ref(storageFor(uid), ticket.path)));
  await assertFails(setDoc(doc(dbFor('parent-a'), '_taskPhotoCleanup', 'forged'), { path: ticket.path }));
});

test('a revoked proof ticket denies reads and uploads even while task metadata still appears open', async () => {
  const ticket = await seedProof({ state: 'submitted' });
  await environment.withSecurityRulesDisabled(context => uploadBytes(ref(context.storage(`gs://${projectId}.appspot.com`), ticket.path), png, { contentType: 'image/png' }));
  await assertSucceeds(getMetadata(ref(storageFor('parent-a'), ticket.path)));
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), '_taskPhotoUploads', ticket.id), { state: 'revoked' }));
  assert.equal((await getDoc(doc(dbFor('child-a'), 'tasks', 'assigned'))).data().done, false);
  for (const uid of ['parent-a', 'child-a']) {
    await assertFails(getMetadata(ref(storageFor(uid), ticket.path)));
    await assertFails(uploadBytes(ref(storageFor(uid), ticket.path), png, { contentType: 'image/png' }));
  }
});

test('adult document metadata requires an explicit UID ACL, never the parent role alone', async () => {
  const document = await seedDocument({ state: 'ready' });
  await assertSucceeds(getDoc(doc(dbFor('parent-a'), 'healthDocuments', document.id)));
  for (const uid of ['parent-b', 'adult-a', 'child-a', 'child-b', 'outsider']) {
    await assertFails(getDoc(doc(dbFor(uid), 'healthDocuments', document.id)));
    await assertFails(getDocs(collection(dbFor(uid), 'healthDocuments')));
  }
  const readable = await assertSucceeds(getDocs(query(collection(dbFor('parent-a'), 'healthDocuments'), where('readers', 'array-contains', 'parent-a'), where('state', '==', 'ready'))));
  assert.equal(readable.size, 1);
  await assertFails(getDocs(query(collection(dbFor('parent-b'), 'healthDocuments'), where('readers', 'array-contains', 'parent-a'), where('state', '==', 'ready'))));
  for (const uid of ['parent-a', 'adult-a']) {
    await assertFails(updateDoc(doc(dbFor(uid), 'healthDocuments', document.id), { readers: ['parent-a', 'parent-b', 'adult-a'] }));
    await assertFails(setDoc(doc(dbFor(uid), 'healthDocumentGrants', 'adult-a'), { ownerUid: 'adult-a', authorizedUids: [uid] }));
  }
});

test('protected document upload is exact, immutable and unreadable until Admin finalization', async () => {
  const document = await seedDocument();
  const uploader = storageFor('parent-a');
  await assertSucceeds(uploadBytes(ref(uploader, document.path), png, { contentType: 'image/png' }));
  await assertFails(getMetadata(ref(uploader, document.path)));
  await assertFails(uploadBytes(ref(uploader, document.path), png, { contentType: 'image/png' }));
  await assertFails(deleteObject(ref(uploader, document.path)));
  await assertFails(uploadBytes(ref(storageFor('parent-b'), document.path), png, { contentType: 'image/png' }));
  for (const overrides of [{ uploadExpiresAt: past() }, { mimeType: 'application/pdf' }, { size: png.length + 1 }, { editors: [] }]) {
    const invalid = await seedDocument(overrides);
    await assertFails(uploadBytes(ref(uploader, invalid.path), png, { contentType: 'image/png' }));
  }
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'healthDocuments', document.id), { state: 'ready' }));
  await assertSucceeds(getMetadata(ref(uploader, document.path)));
  await assertFails(getMetadata(ref(storageFor('adult-a'), document.path)));
  await assertFails(getMetadata(ref(storageFor('parent-b'), document.path)));
});

test('sharing and revocation protect both metadata and file despite an unchanged creator', async () => {
  const document = await seedDocument({ state: 'ready', readers: ['parent-a', 'adult-a'] });
  await environment.withSecurityRulesDisabled(context => uploadBytes(ref(context.storage(`gs://${projectId}.appspot.com`), document.path), png, { contentType: 'image/png' }));
  await assertSucceeds(getDoc(doc(dbFor('adult-a'), 'healthDocuments', document.id)));
  await assertSucceeds(getMetadata(ref(storageFor('adult-a'), document.path)));
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'healthDocuments', document.id), { readers: ['adult-a'], editors: ['adult-a'] }));
  await assertFails(getDoc(doc(dbFor('parent-a'), 'healthDocuments', document.id)));
  await assertFails(getMetadata(ref(storageFor('parent-a'), document.path)));
  await assertSucceeds(getDoc(doc(dbFor('adult-a'), 'healthDocuments', document.id)));
  await assertSucceeds(getMetadata(ref(storageFor('adult-a'), document.path)));
});

test('health grants cannot be fabricated or inspected by an unrelated parent', async () => {
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'healthDocumentGrants', 'adult-a'), {
    ownerUid: 'adult-a', authorizedUids: ['parent-a'], grants: [{ uid: 'parent-a', basis: 'consent', canEdit: true }],
  }));
  await assertSucceeds(getDoc(doc(dbFor('adult-a'), 'healthDocumentGrants', 'adult-a')));
  await assertSucceeds(getDoc(doc(dbFor('parent-a'), 'healthDocumentGrants', 'adult-a')));
  await assertFails(getDoc(doc(dbFor('parent-b'), 'healthDocumentGrants', 'adult-a')));
  await assertFails(getDocs(collection(dbFor('parent-a'), 'healthDocumentGrants')));
  await assertFails(updateDoc(doc(dbFor('parent-a'), 'healthDocumentGrants', 'adult-a'), { authorizedUids: ['parent-a', 'parent-b'] }));
});

test('one shopping item supports several shops with bounded validated identifiers', async () => {
  const target = doc(dbFor('child-a'), 'shoppingItems', 'milk-test');
  await assertSucceeds(setDoc(target, { title: 'Produkt testowy', createdBy: 'child-a', done: false, shopIds: ['biedronka', 'lidl'] }));
  await assertSucceeds(updateDoc(target, { done: true }));
  const item = await assertSucceeds(getDoc(target));
  assert.deepEqual(item.data().shopIds, ['biedronka', 'lidl']);
  assert.equal(item.data().done, true);
  for (const ids of [['lidl', 'lidl'], ['../private'], [99], Array.from({ length: 21 }, (_, i) => `store-${i}`), 'lidl']) {
    await assertFails(updateDoc(target, { shopIds: ids }));
  }
  await assertSucceeds(setDoc(doc(dbFor('parent-a'), 'shoppingItems', 'legacy-test'), { title: 'Stary produkt testowy', createdBy: 'parent-a', done: false }));
});

test('custom store edits belong to its creator or a parent and preserve creation identity', async () => {
  const id = 'store-test';
  const data = { name: 'Sklep testowy', createdBy: 'child-a', createdAt: now(), updatedAt: now(), archived: false };
  await assertSucceeds(setDoc(doc(dbFor('child-a'), 'shoppingStores', id), data));
  await assertFails(updateDoc(doc(dbFor('child-b'), 'shoppingStores', id), { name: 'Cudzy sklep' }));
  await assertSucceeds(updateDoc(doc(dbFor('parent-a'), 'shoppingStores', id), { name: 'Poprawiony sklep testowy', archived: true }));
  await assertFails(updateDoc(doc(dbFor('parent-a'), 'shoppingStores', id), { createdBy: 'parent-a' }));
  await assertFails(updateDoc(doc(dbFor('parent-a'), 'shoppingStores', id), { createdAt: past() }));
  await assertFails(deleteDoc(doc(dbFor('parent-a'), 'shoppingStores', id)));
  await assertFails(setDoc(doc(dbFor('child-a'), 'shoppingStores', 'invalid..id'), data));
});

test('emoji reactions inherit message participant privacy and cannot impersonate another UID', async () => {
  const reaction = uid => ({ uid, emoji: '👍', updatedAt: serverTimestamp() });
  const own = doc(dbFor('parent-a'), 'familyMessages', 'parents-test', 'reactions', 'parent-a');
  await assertSucceeds(setDoc(own, reaction('parent-a')));
  await assertSucceeds(getDocs(collection(dbFor('parent-b'), 'familyMessages', 'parents-test', 'reactions')));
  await assertFails(getDocs(collection(dbFor('child-a'), 'familyMessages', 'parents-test', 'reactions')));
  await assertFails(setDoc(doc(dbFor('child-a'), 'familyMessages', 'parents-test', 'reactions', 'child-a'), reaction('child-a')));
  await assertFails(setDoc(doc(dbFor('parent-b'), 'familyMessages', 'parents-test', 'reactions', 'parent-a'), reaction('parent-a')));
  await assertFails(updateDoc(own, { emoji: 'unsupported', updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(dbFor('child-a'), 'familyMessages', 'family-test', 'reactions', 'child-a'), reaction('child-a')));
  await assertFails(updateDoc(doc(dbFor('parent-a'), 'familyMessages', 'parents-test'), { text: 'Nadpisana wiadomość' }));
});

test('chat unread cursors are isolated by UID and cannot mark another private channel', async () => {
  const data = { channel: 'family', participants: [], lastReadAt: now(), updatedAt: serverTimestamp(), lastMessageId: 'family-test' };
  const own = doc(dbFor('child-a'), 'chatReadStates', 'child-a', 'channels', 'family');
  await assertSucceeds(setDoc(own, data));
  await assertSucceeds(getDoc(own));
  await assertFails(getDoc(doc(dbFor('parent-a'), 'chatReadStates', 'child-a', 'channels', 'family')));
  await assertFails(setDoc(doc(dbFor('parent-a'), 'chatReadStates', 'child-a', 'channels', 'family'), data));
  await assertFails(updateDoc(own, { lastReadAt: future(), updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(dbFor('child-a'), 'chatReadStates', 'child-a', 'channels', 'private:parent-a:parent-b'), {
    ...data, channel: 'private:parent-a:parent-b', participants: ['parent-a', 'parent-b'],
  }));
});

test('important family calendar fields do not expose another UID private calendar or school inbox', async () => {
  const event = { title: 'Ważny termin testowy', person: 'family', private: false, createdBy: 'parent-a', important: true };
  await assertSucceeds(setDoc(doc(dbFor('parent-a'), 'calendarEvents', 'family-test'), event));
  await assertSucceeds(getDoc(doc(dbFor('child-a'), 'calendarEvents', 'family-test')));
  await assertFails(updateDoc(doc(dbFor('parent-a'), 'calendarEvents', 'family-test'), { important: 'yes' }));
  await assertSucceeds(setDoc(doc(dbFor('parent-a'), 'privateCalendarEvents', 'private-test'), { ...event, private: true, ownerUid: 'parent-a' }));
  await assertFails(getDoc(doc(dbFor('parent-b'), 'privateCalendarEvents', 'private-test')));
  await assertFails(getDoc(doc(dbFor('child-a'), 'privateCalendarEvents', 'private-test')));
  await assertSucceeds(getDoc(doc(dbFor('parent-a'), 'schoolParentMessages', 'parent-test')));
  await assertFails(getDoc(doc(dbFor('child-a'), 'schoolParentMessages', 'parent-test')));
});

test('anonymous, archived and unrelated accounts cannot use any new family access path', async () => {
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'members', 'archived-test'), {
    ...people['parent-a'], active: true, canLogin: true, archived: true,
  }));
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('outsider'), environment.authenticatedContext('archived-test')]) {
    const db = context.firestore();
    await assertFails(getDocs(collection(db, 'shoppingStores')));
    await assertFails(getDocs(collection(db, 'tasks')));
    await assertFails(getDocs(collection(db, 'healthDocuments')));
    await assertFails(getDocs(collection(db, 'familyMessages', 'family-test', 'reactions')));
  }
});


test('task photo tickets never grant access to a parent from another explicit family', async () => {
  const ticket = await seedProof();
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'members', 'foreign-parent'), {
    name: 'Inna rodzina testowa', personKey: 'member-eeeeeeeeeeeeeeeeeeeeeeee', role: 'parent',
    familyId: 'another-test-family', active: true, canLogin: true, archived: false,
  }));
  await assertSucceeds(uploadBytes(ref(storageFor('child-a'), ticket.path), png, { contentType: 'image/png' }));
  await assertFails(getMetadata(ref(storageFor('foreign-parent'), ticket.path)));
});
