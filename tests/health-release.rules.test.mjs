import { before, after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getMetadata, deleteObject } from 'firebase/storage';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199') throw Error('LOCAL_DEMO_EMULATORS_REQUIRED');
const projectId = 'demo-nasza-rodzina'; let env;
const db = uid => env.authenticatedContext(uid).firestore();
const store = uid => env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`);
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
before(async () => { env = await initializeTestEnvironment({ projectId,
  firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../deploy/health/firestore.rules', import.meta.url), 'utf8') },
  storage: { host: '127.0.0.1', port: 9199, rules: await readFile(new URL('../deploy/health/storage.rules', import.meta.url), 'utf8') } }); });
after(async () => env?.cleanup());
beforeEach(async () => { await env.clearFirestore(); await env.withSecurityRulesDisabled(async c => {
  for (const [uid, role, familyId] of [['parent', 'parent', 'one'], ['other-parent', 'parent', 'one'], ['adult', 'adult', 'one'], ['foreign', 'parent', 'two']]) {
    await setDoc(doc(c.firestore(), 'members', uid), { name: uid, personKey: uid, role, familyId, active: true, canLogin: true, archived: false });
  }
}); });
async function document(overrides = {}) {
  const id = randomUUID(), path = `healthDocuments/${id}/parent/${randomUUID()}.png`;
  const value = { state: 'draft', protected: true, familyId: 'one', ownerProfileId: 'adult', ownerUid: 'adult', readers: ['parent'], editors: ['parent'], createdBy: 'parent', storagePath: path,
    mimeType: 'image/png', size: bytes.length, uploadExpiresAt: Timestamp.fromMillis(Date.now() + 60000), ...overrides };
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'healthDocuments', id), value));
  return { id, path };
}
test('exact health release admits only immutable ticket-bound uploads and explicit readers after finalization', async () => {
  const d = await document();
  await assertSucceeds(uploadBytes(ref(store('parent'), d.path), bytes, { contentType: 'image/png' }));
  await assertFails(getMetadata(ref(store('parent'), d.path)));
  await assertFails(uploadBytes(ref(store('parent'), d.path), bytes, { contentType: 'image/png' }));
  await assertFails(deleteObject(ref(store('parent'), d.path)));
  await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'healthDocuments', d.id), { state: 'ready' }));
  await assertSucceeds(getDoc(doc(db('parent'), 'healthDocuments', d.id)));
  await assertSucceeds(getMetadata(ref(store('parent'), d.path)));
  for (const uid of ['adult', 'other-parent', 'foreign']) {
    await assertFails(getDoc(doc(db(uid), 'healthDocuments', d.id)));
    await assertFails(getMetadata(ref(store(uid), d.path)));
  }
  await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'healthDocuments', d.id), { readers: ['adult'] }));
  await assertSucceeds(getMetadata(ref(store('adult'), d.path)));
  await assertFails(getMetadata(ref(store('parent'), d.path)));
});
test('a parent cannot forge consent, a document ACL, or an attachment link in a health record', async () => {
  await assertFails(setDoc(doc(db('parent'), 'healthDocumentGrants', 'adult'), { ownerUid: 'adult', authorizedUids: ['parent'] }));
  const d = await document({ state: 'ready' });
  await assertFails(updateDoc(doc(db('parent'), 'healthDocuments', d.id), { readers: ['parent', 'other-parent'] }));
  await assertFails(setDoc(doc(db('parent'), 'healthRecords', 'forged'), { title: 'Test', person: 'Sebastian', type: 'visit', privateToParents: false, documentPath: '', documentURL: '', attachmentDocumentId: d.id }));
  await assertFails(setDoc(doc(db('parent'), 'tasks', 'forged'), { title: 'Test', points: 999 }));
});
test('an explicit foreign family is denied even when a malformed ACL contains that UID', async () => {
  const d = await document({ state: 'ready', readers: ['parent', 'foreign'] });
  await env.withSecurityRulesDisabled(c => uploadBytes(ref(c.storage(`gs://${projectId}.appspot.com`), d.path), bytes, { contentType: 'image/png' }));
  await assertFails(getDoc(doc(db('foreign'), 'healthDocuments', d.id)));
  await assertFails(getMetadata(ref(store('foreign'), d.path)));
});
