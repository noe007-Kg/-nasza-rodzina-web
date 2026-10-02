import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { getMetadata, ref, uploadBytes } from 'firebase/storage';

let environment;
let parentDb;
let childDb;
let siblingDb;
// Run sequentially after browser tests: Storage's cross-service lookup uses the CLI project.
const projectId = 'demo-nasza-rodzina';
const profiles = {
  parent: { name: 'Sebastian', personKey: 'Sebastian', role: 'parent', active: true, canLogin: true },
  child: { name: 'Paweł', personKey: 'Paweł', role: 'child', active: true, canLogin: true },
  sibling: { name: 'Nikodem', personKey: 'Nikodem', role: 'child', active: true, canLogin: true },
  disabled: { name: 'Dominika', personKey: 'Dominika', role: 'parent', active: false, canLogin: true },
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
  parentDb = environment.authenticatedContext('parent').firestore();
  childDb = environment.authenticatedContext('child').firestore();
  siblingDb = environment.authenticatedContext('sibling').firestore();
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(Object.entries(profiles).map(([uid, profile]) => setDoc(doc(db, 'members', uid), profile)));
    await Promise.all([
      setDoc(doc(db, 'schoolItems', 'pawel'), { person: 'Paweł', type: 'grade', title: '5', createdBy: 'parent' }),
      setDoc(doc(db, 'schoolItems', 'nikodem'), { person: 'Nikodem', type: 'lesson', title: 'Polski', createdBy: 'parent' }),
      setDoc(doc(db, 'healthRecords', 'private'), { person: 'Paweł', title: 'Wynik prywatny', type: 'result', privateToParents: true, createdBy: 'parent' }),
      setDoc(doc(db, 'healthRecords', 'own'), { person: 'Paweł', title: 'Lek', type: 'medicine', privateToParents: false, createdBy: 'parent' }),
      setDoc(doc(db, 'healthRecords', 'sibling'), { person: 'Nikodem', title: 'Wizyta', type: 'visit', privateToParents: false, createdBy: 'parent' }),
      setDoc(doc(db, 'healthRecords', 'family'), { person: 'family', title: 'Apteczka', type: 'history', privateToParents: false, createdBy: 'parent' }),
      setDoc(doc(db, 'familyMessages', 'family'), { channel: 'family', participants: [], uid: 'parent', text: 'Cześć', name: 'Sebastian', createdAt: Timestamp.now() }),
      setDoc(doc(db, 'familyMessages', 'private'), { channel: 'private:child:parent', participants: ['child', 'parent'], uid: 'child', text: 'Prywatne', name: 'Paweł', createdAt: Timestamp.now() }),
      setDoc(doc(db, 'tasks', 'reward'), { person: 'Paweł', title: 'Pokój', done: false, points: 10, requireApproval: true, approvalStatus: 'none', createdBy: 'parent' }),
      setDoc(doc(db, 'tasks', 'sibling'), { person: 'Nikodem', title: 'Zabawki', done: false, points: 2, requireApproval: true, approvalStatus: 'none', createdBy: 'parent' }),
    ]);
  });
});

after(async () => { await environment?.cleanup(); });

test('anonymous, unknown and disabled accounts cannot access family collections', async () => {
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('outsider'), environment.authenticatedContext('disabled')]) {
    await assertFails(getDocs(collection(context.firestore(), 'members')));
    await assertFails(getDocs(collection(context.firestore(), 'tasks')));
  }
  await assertSucceeds(getDoc(doc(environment.authenticatedContext('disabled').firestore(), 'members', 'disabled')));
});

test('child cannot grant their own account a parent role or rename it', async () => {
  await assertFails(updateDoc(doc(childDb, 'members', 'child'), { role: 'parent' }));
  await assertFails(updateDoc(doc(childDb, 'members', 'child'), { personKey: 'Nikodem', name: 'Nikodem' }));
  await assertFails(setDoc(doc(parentDb, 'members', 'stranger'), profiles.child));
});

test('school data is enforced by the backend and supports only the own-person child query', async () => {
  await assertSucceeds(getDocs(query(collection(childDb, 'schoolItems'), where('person', '==', 'Paweł'))));
  await assertFails(getDocs(collection(childDb, 'schoolItems')));
  await assertFails(getDoc(doc(childDb, 'schoolItems', 'nikodem')));
  await assertSucceeds(getDocs(collection(parentDb, 'schoolItems')));
});

test('child may manage homework, but cannot fabricate grades or school messages', async () => {
  const homework = { person: 'Paweł', type: 'homework', title: 'Ćwiczenia', createdBy: 'child' };
  await assertSucceeds(setDoc(doc(childDb, 'schoolItems', 'new'), homework));
  await assertFails(setDoc(doc(childDb, 'schoolItems', 'grade'), { ...homework, type: 'grade' }));
  await assertFails(setDoc(doc(childDb, 'schoolItems', 'message'), { ...homework, type: 'message' }));
  await assertFails(setDoc(doc(childDb, 'schoolItems', 'other'), { ...homework, person: 'Nikodem' }));
  await assertFails(updateDoc(doc(childDb, 'schoolItems', 'pawel'), { title: '6' }));
});

test('health query exposes only shared records for the own person or family', async () => {
  await assertSucceeds(getDocs(query(collection(childDb, 'healthRecords'), where('privateToParents', '==', false), where('person', 'in', ['family', 'Paweł']))));
  await assertFails(getDocs(collection(childDb, 'healthRecords')));
  await assertFails(getDoc(doc(childDb, 'healthRecords', 'private')));
  await assertFails(getDoc(doc(childDb, 'healthRecords', 'sibling')));
  await assertSucceeds(getDocs(collection(parentDb, 'healthRecords')));
});

test('a child confirms own medicine but cannot expose a private record', async () => {
  await assertSucceeds(updateDoc(doc(childDb, 'healthRecords', 'own'), { confirmedDate: '2026-09-30', updatedAt: Timestamp.now() }));
  await assertFails(updateDoc(doc(childDb, 'healthRecords', 'own'), { person: 'Nikodem' }));
  await assertFails(updateDoc(doc(childDb, 'healthRecords', 'private'), { privateToParents: false }));
});

test('private chat has participant queries and is invisible to another child or parent', async () => {
  await assertSucceeds(getDocs(query(collection(childDb, 'familyMessages'), where('channel', '==', 'family'))));
  await assertSucceeds(getDocs(query(collection(childDb, 'familyMessages'), where('participants', 'array-contains', 'child'))));
  await assertFails(getDocs(collection(childDb, 'familyMessages')));
  await assertFails(getDoc(doc(siblingDb, 'familyMessages', 'private')));
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'familyMessages', 'children'), { channel: 'private:child:sibling', participants: ['child', 'sibling'], uid: 'child', text: 'Sekret', name: 'Paweł', createdAt: Timestamp.now() }));
  await assertFails(getDoc(doc(parentDb, 'familyMessages', 'children')));
});

test('chat send cannot impersonate another account or invent a mismatched channel', async () => {
  const message = { channel: 'private:child:parent', participants: ['child', 'parent'], uid: 'child', text: 'Wiadomość', name: 'Paweł', createdAt: Timestamp.now() };
  await assertSucceeds(setDoc(doc(childDb, 'familyMessages', 'sent'), message));
  await assertFails(setDoc(doc(childDb, 'familyMessages', 'spoof'), { ...message, uid: 'parent', name: 'Sebastian' }));
  await assertFails(setDoc(doc(childDb, 'familyMessages', 'channel'), { ...message, channel: 'private:parent:sibling' }));
  await assertFails(setDoc(doc(childDb, 'familyMessages', 'unknown'), { ...message, participants: ['child', 'unknown'], channel: 'private:child:unknown' }));
});

test('children submit their assigned tasks without granting themselves rewards', async () => {
  await assertSucceeds(updateDoc(doc(childDb, 'tasks', 'reward'), { approvalStatus: 'pending', updatedAt: Timestamp.now() }));
  await assertFails(updateDoc(doc(childDb, 'tasks', 'reward'), { done: true, approvalStatus: 'approved' }));
  await assertFails(updateDoc(doc(childDb, 'tasks', 'reward'), { points: 100 }));
  await assertFails(updateDoc(doc(childDb, 'tasks', 'sibling'), { approvalStatus: 'pending' }));
  await assertSucceeds(updateDoc(doc(parentDb, 'tasks', 'reward'), { done: true, approvalStatus: 'approved' }));
});

test('new health entries cannot contain publicly tokenized document URLs', async () => {
  const record = { person: 'Paweł', title: 'Dokument', type: 'document', privateToParents: true, createdBy: 'parent', documentPath: 'health/parents/Paweł/parent/result.pdf', documentURL: '' };
  await assertSucceeds(setDoc(doc(parentDb, 'healthRecords', 'new'), record));
  await assertFails(setDoc(doc(parentDb, 'healthRecords', 'public-url'), { ...record, documentURL: 'https://example.com/file?token=secret' }));
  await assertFails(setDoc(doc(parentDb, 'healthRecords', 'shared-path'), { ...record, documentPath: 'health/shared/Paweł/parent/result.pdf' }));
});

test('eduVULCAN session secrets are server-only, including for parents', async () => {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), '_eduConnections', 'parent'), { envelope: { ciphertext: 'encrypted' }, students: [] }));
  await assertFails(getDoc(doc(parentDb, '_eduConnections', 'parent')));
  await assertFails(getDocs(collection(parentDb, '_eduConnections')));
  await assertFails(setDoc(doc(parentDb, '_eduConnections', 'parent'), { session: 'forged' }));
});

test('browser users cannot forge eduVULCAN provenance or change imported school entries', async () => {
  const manual = { person: 'Paweł', type: 'lesson', title: 'Polski', createdBy: 'parent' };
  await assertSucceeds(setDoc(doc(parentDb, 'schoolItems', 'manual'), manual));
  await assertFails(setDoc(doc(parentDb, 'schoolItems', 'forged'), { ...manual, source: 'eduvulcan', sourceRecordId: 'provider-1' }));
  await assertFails(updateDoc(doc(parentDb, 'schoolItems', 'manual'), { provider: 'eduvulcan' }));
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'schoolItems', 'synced'), { ...manual, source: 'eduvulcan', provider: 'eduvulcan', sourceRecordId: 'provider-2' }));
  await assertSucceeds(getDoc(doc(parentDb, 'schoolItems', 'synced')));
  await assertSucceeds(getDoc(doc(childDb, 'schoolItems', 'synced')));
  await assertFails(updateDoc(doc(parentDb, 'schoolItems', 'synced'), { title: 'Sfałszowany wpis' }));
  await assertFails(updateDoc(doc(childDb, 'schoolItems', 'synced'), { title: 'Inny wpis' }));
  await assertFails(deleteDoc(doc(parentDb, 'schoolItems', 'synced')));
});

test('synchronized parent messages are readable only by parents and cannot be forged by the browser', async () => {
  const message = { person: 'Paweł', personKey: 'Paweł', type: 'message', title: 'Wiadomość wychowawcy', note: 'Tylko rodzice', source: 'eduvulcan' };
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'schoolParentMessages', 'synced'), message));
  await assertSucceeds(getDocs(collection(parentDb, 'schoolParentMessages')));
  await assertFails(getDocs(collection(childDb, 'schoolParentMessages')));
  await assertFails(getDoc(doc(childDb, 'schoolParentMessages', 'synced')));
  await assertFails(setDoc(doc(parentDb, 'schoolParentMessages', 'forged'), message));
});

test('storage protects private health documents, own shared documents, file types and old paths', async () => {
  const parentStorage = environment.authenticatedContext('parent').storage(`gs://${projectId}.appspot.com`);
  const childStorage = environment.authenticatedContext('child').storage(`gs://${projectId}.appspot.com`);
  const siblingStorage = environment.authenticatedContext('sibling').storage(`gs://${projectId}.appspot.com`);
  const file = new Uint8Array([37, 80, 68, 70, 45]);
  const privatePath = 'health/parents/Paweł/parent/private.pdf';
  const ownPath = 'health/shared/Paweł/child/own.pdf';
  await assertSucceeds(uploadBytes(ref(parentStorage, privatePath), file, { contentType: 'application/pdf' }));
  await assertSucceeds(getMetadata(ref(parentStorage, privatePath)));
  await assertFails(getMetadata(ref(childStorage, privatePath)));
  await assertSucceeds(uploadBytes(ref(childStorage, ownPath), file, { contentType: 'application/pdf' }));
  await assertSucceeds(getMetadata(ref(childStorage, ownPath)));
  await assertFails(getMetadata(ref(siblingStorage, ownPath)));
  await assertFails(uploadBytes(ref(childStorage, 'health/parents/Paweł/child/new.pdf'), file, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(parentStorage, 'health/Paweł/legacy.pdf'), file, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(childStorage, 'quick-products/child/script.js'), file, { contentType: 'application/javascript' }));
  await assertFails(uploadBytes(ref(childStorage, 'quick-products/parent/image.png'), file, { contentType: 'image/png' }));
});
