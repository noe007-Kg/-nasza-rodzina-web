import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDocFromServer, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { getBytes, getMetadata, ref, uploadBytes } from 'firebase/storage';

// This suite never imports the migration CLI, production Admin credentials or a
// write runner. Bypassed writes below are synthetic fixtures in this demo only.
const projectId = 'demo-nasza-rodzina';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
  || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199') {
  throw new Error('Household migration rules tests require the explicitly local Firestore and Storage emulators.');
}
const familyId = 'household-test-5f0a908a-4993-4f57-b35a-fd33d457a1b4';
const householdUids = ['migration-parent-a', 'migration-parent-b', 'migration-adult', 'migration-child', 'migration-sibling'];
const parents = householdUids.slice(0, 2);
const foreignUid = 'migration-foreign-parent';
const personKeys = {
  'migration-parent-a': 'member-aaaaaaaaaaaaaaaaaaaaaaaa',
  'migration-parent-b': 'member-bbbbbbbbbbbbbbbbbbbbbbbb',
  'migration-adult': 'member-111111111111111111111111',
  'migration-child': 'member-222222222222222222222222',
  'migration-sibling': 'member-333333333333333333333333',
  [foreignUid]: 'member-ffffffffffffffffffffffff',
};
const child = 'migration-child';
const sibling = 'migration-sibling';
const adult = 'migration-adult';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
let environment;
let fixture;
const dbFor = uid => environment.authenticatedContext(uid).firestore();
const storageFor = uid => environment.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`);

before(async () => {
  environment = await initializeTestEnvironment({ projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await environment?.cleanup(); });

function syntheticFixture() {
  const proofUploadId = randomUUID();
  const rewardUploadId = randomUUID();
  const documentId = randomUUID();
  const proofPath = `taskProof/migration-task/${child}/${proofUploadId}.png`;
  const rewardPath = `taskRewardImages/migration-reward/${parents[0]}/${rewardUploadId}.png`;
  const documentPath = `healthDocuments/${documentId}/${parents[0]}/${randomUUID()}.png`;
  const timestamp = Timestamp.fromMillis(Date.UTC(2026, 9, 13, 8));
  const rows = new Map();
  for (const uid of householdUids) rows.set(`members/${uid}`, {
    name: `Synthetic profile ${uid}`, personKey: personKeys[uid],
    role: parents.includes(uid) ? 'parent' : uid === adult ? 'adult' : 'child',
    active: true, canLogin: true, archived: false,
  });
  rows.set(`members/${foreignUid}`, { name: 'Synthetic foreign profile', personKey: personKeys[foreignUid],
    role: 'parent', active: true, canLogin: true, archived: false, familyId: 'another-household' });
  rows.set('tasks/migration-task', { title: 'Synthetic photo task', person: personKeys[child], createdBy: parents[0],
    submittedBy: child, done: false, points: 7, pointsBooked: false, approvalStatus: 'pending',
    verificationMode: 'photo', requireApproval: true, proofPath, proofUploadId, familyId: null });
  rows.set(`_taskPhotoUploads/${proofUploadId}`, { taskId: 'migration-task', uid: child, person: personKeys[child],
    familyId: null, path: proofPath, state: 'submitted', contentType: 'image/png', size: png.length,
    expiresAt: Timestamp.fromMillis(Date.now() + 600_000), orphanAfter: Timestamp.fromMillis(Date.now() + 86_400_000) });
  rows.set('taskRewards/migration-reward', { title: 'Synthetic reward', createdBy: parents[0], people: [personKeys[child]],
    cost: 20, active: true, imagePath: rewardPath, imageUploadId: rewardUploadId });
  rows.set(`_taskRewardImageUploads/${rewardUploadId}`, { rewardId: 'migration-reward', uid: parents[0],
    people: [personKeys[child]], active: true, path: rewardPath, state: 'attached', contentType: 'image/png', size: png.length });
  rows.set(`healthDocuments/${documentId}`, { title: 'Synthetic attachment', ownerProfileId: adult,
    ownerUid: adult, ownerPersonKey: personKeys[adult], createdBy: parents[0],
    // Explicit synthetic ACLs represent authorized access, not rights inferred from a parent role.
    readers: [...parents, adult, child], editors: [...parents], attachmentKind: 'health-record',
    attachmentRecordId: 'migration-visit', attachmentPrivate: true, familyId: null, state: 'ready', protected: true,
    storagePath: documentPath, mimeType: 'image/png', size: png.length, createdAt: timestamp, updatedAt: timestamp });
  rows.set('healthRecords/migration-visit', { title: 'Synthetic visit', type: 'visit', person: personKeys[adult],
    createdBy: parents[0], privateToParents: true, attachmentDocumentId: documentId,
    documentPath: '', documentURL: '', calendarEventId: 'health-visit-migration-visit', familyId: null });
  rows.set(`healthDocumentGrants/${adult}`, { ownerProfileId: adult, ownerUid: adult, authorizedUids: [...parents, child],
    grants: [...parents, child].map(uid => ({ uid, basis: 'consent', canEdit: parents.includes(uid), authorizedBy: adult })) });
  rows.set(`taskPointBalances/person-${sha256(personKeys[child])}`, {
    person: personKeys[child], balance: 37, earned: 57, spent: 20, completedCount: 4 });
  rows.set(`taskPointLedger/${sha256('task:completed-task')}`, {
    person: personKeys[child], taskId: 'completed-task', actorUid: parents[1], kind: 'earned', delta: 7 });
  rows.set('taskCompletions/completed-task', { taskId: 'completed-task', person: personKeys[child],
    submittedBy: child, approvedBy: parents[1], points: 7, completedAt: timestamp });
  rows.set('tasks/completed-task', { title: 'Synthetic completed task', person: personKeys[child], createdBy: parents[1],
    done: true, points: 7, pointsBooked: true, approvalStatus: 'approved' });
  rows.set('taskRewardRequests/migration-request', { rewardId: 'migration-reward', person: personKeys[child],
    uid: child, cost: 20, state: 'pending' });
  rows.set(`_taskRewardPending/${sha256(`${personKeys[child]}:migration-reward`)}`, {
    person: personKeys[child], rewardId: 'migration-reward', requestId: 'migration-request' });
  rows.set('calendarEvents/health-visit-migration-visit', { title: 'Synthetic family event', person: personKeys[adult],
    createdBy: parents[0], ownerProfileId: adult, private: false, visibility: 'family',
    source: 'health', sourceRecordId: 'migration-visit', date: timestamp, endDate: timestamp });
  rows.set('privateCalendarEvents/migration-private-event', { title: 'Synthetic private event', person: personKeys[parents[0]],
    createdBy: parents[0], ownerUid: parents[0], private: true, source: 'manual', date: timestamp, endDate: timestamp });
  const bill = { title: 'Synthetic bill', category: 'Inne', amountGrosze: 12000, dueDate: '2026-10-20',
    familyId: '__legacy__', ownerUid: parents[0], status: 'unpaid', archived: false, calendarEnabled: false };
  rows.set('financeBills/migration-parent-only', { ...bill, sharedWith: [] });
  rows.set('financeBills/migration-shared-child', { ...bill, sharedWith: [child] });
  rows.set('financeBillAudit/migration-audit', { billId: 'migration-shared-child', actorUid: parents[0],
    familyId: '__legacy__', kind: 'created', createdAt: timestamp });
  const unchangedPaths = new Set([`members/${foreignUid}`]);
  return { rows, proofUploadId, rewardUploadId, documentId, paths: [proofPath, rewardPath, documentPath],
    patchPaths: [...rows.keys()].filter(path => !unchangedPaths.has(path)), unchangedPaths };
}

beforeEach(async () => {
  await environment.clearFirestore();
  fixture = syntheticFixture();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const [path, value] of fixture.rows) batch.set(doc(db, path), value);
    await batch.commit();
    for (const path of fixture.paths) await uploadBytes(ref(context.storage(`gs://${projectId}.appspot.com`), path), png,
      { contentType: 'image/png' });
  });
});

function metadataPatch(path) {
  const value=fixture.rows.get(path);
  if (!path.startsWith('calendarEvents/') && !path.startsWith('privateCalendarEvents/')) return {familyId};
  const privateRecord=path.startsWith('privateCalendarEvents/');
  return {familyId,private:privateRecord,visibility:privateRecord?'private':'family',ownerUid:value.ownerUid||value.createdBy,
    ownerProfileId:value.ownerProfileId||Object.keys(personKeys).find(uid=>personKeys[uid]===value.person)};
}

async function patchSyntheticFamily(paths) {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const path of paths) batch.update(doc(db, path), metadataPatch(path));
    await batch.commit();
  });
}

async function expectFileRead(uid, path) {
  const object = ref(storageFor(uid), path);
  const metadata = await assertSucceeds(getMetadata(object));
  assert.equal(metadata.contentType, 'image/png');
  assert.equal(metadata.size, png.length);
  const bytes = await assertSucceeds(getBytes(object, 1024));
  assert.deepEqual(new Uint8Array(bytes), png);
}

async function expectFileDenied(uid, path) {
  await assertFails(getMetadata(ref(storageFor(uid), path)));
  await assertFails(getBytes(ref(storageFor(uid), path), 1024));
}

test('strict Rules quarantine unassigned legacy files and finance until the complete reviewed migration', async () => {
  for (const uid of [...parents, child]) {
    for (const path of fixture.paths) await expectFileDenied(uid, path);
  }
  await expectFileDenied(adult, fixture.paths[2]);
  await assertFails(getDocFromServer(doc(dbFor(adult), 'healthDocuments', fixture.documentId)));
  for (const path of fixture.paths) {
    await expectFileDenied(sibling, path);
    await expectFileDenied(foreignUid, path);
  }
  for (const uid of [...householdUids, foreignUid]) {
    for (const id of ['migration-parent-only', 'migration-shared-child']) {
      await assertFails(getDocFromServer(doc(dbFor(uid), 'financeBills', id)));
    }
  }
});

test('assigning only member familyId cuts off legacy files; the complete companion batch restores the same authorized access', async () => {
  for (const uid of parents) for (const path of fixture.paths) await expectFileDenied(uid, path);
  await patchSyntheticFamily(householdUids.map(uid => `members/${uid}`));
  for (const uid of [...parents, child]) for (const path of fixture.paths) await expectFileDenied(uid, path);
  for (const uid of [...parents, adult, child]) {
    await assertFails(getDocFromServer(doc(dbFor(uid), 'healthDocuments', fixture.documentId)));
  }
  await patchSyntheticFamily(fixture.patchPaths);
  for (const uid of [...parents, child]) for (const path of fixture.paths) await expectFileRead(uid, path);
  await expectFileRead(adult, fixture.paths[2]);
  for (const uid of [...parents, adult, child]) {
    await assertSucceeds(getDocFromServer(doc(dbFor(uid), 'healthDocuments', fixture.documentId)));
  }
});

test('a single complete isolation-metadata fixture batch preserves shared files and per-bill child sharing while excluding other households', async () => {
  await patchSyntheticFamily(fixture.patchPaths);
  for (const uid of [...parents, child]) for (const path of fixture.paths) await expectFileRead(uid, path);
  for (const uid of [sibling, foreignUid]) {
    for (const path of fixture.paths) await expectFileDenied(uid, path);
    await assertFails(getDocFromServer(doc(dbFor(uid), 'healthDocuments', fixture.documentId)));
  }
  for (const uid of parents) {
    for (const id of ['migration-parent-only', 'migration-shared-child']) {
      await assertSucceeds(getDocFromServer(doc(dbFor(uid), 'financeBills', id)));
    }
  }
  await assertSucceeds(getDocFromServer(doc(dbFor(child), 'financeBills', 'migration-shared-child')));
  await assertFails(getDocFromServer(doc(dbFor(child), 'financeBills', 'migration-parent-only')));
  for (const uid of [sibling, adult, foreignUid]) {
    for (const id of ['migration-parent-only', 'migration-shared-child']) {
      await assertFails(getDocFromServer(doc(dbFor(uid), 'financeBills', id)));
    }
  }
});

test('isolation patches leave IDs, balances, ledger, legal consent, medical ACLs and calendar privacy unchanged', async () => {
  await patchSyntheticFamily(fixture.patchPaths);
  await environment.withSecurityRulesDisabled(async context => {
    for (const [path, beforeData] of fixture.rows) {
      const snapshot = await getDocFromServer(doc(context.firestore(), path));
      assert.equal(snapshot.exists(), true, path);
      const actual = snapshot.data();
      if (fixture.unchangedPaths.has(path)) assert.deepEqual(actual, beforeData, path);
      else {
        assert.equal(actual.familyId, familyId, path);
        assert.deepEqual(actual, {...beforeData,...metadataPatch(path)}, path);
      }
    }
  });
  await assertSucceeds(getDocFromServer(doc(dbFor(parents[0]), 'privateCalendarEvents', 'migration-private-event')));
  for (const uid of [parents[1], child, sibling, foreignUid]) {
    await assertFails(getDocFromServer(doc(dbFor(uid), 'privateCalendarEvents', 'migration-private-event')));
  }
  for (const uid of [...parents, adult]) {
    await assertSucceeds(getDocFromServer(doc(dbFor(uid), 'healthDocumentGrants', adult)));
  }
  await assertFails(getDocFromServer(doc(dbFor(sibling), 'healthDocumentGrants', adult)));
  await assertFails(getDocFromServer(doc(dbFor(foreignUid), 'healthDocumentGrants', adult)));
  // The same object paths still contain the exact synthetic bytes after patching.
  for (const path of fixture.paths) await expectFileRead(parents[0], path);
});

test('after assignment all clients still cannot change family IDs, financial ACLs, upload tickets or points', async () => {
  await patchSyntheticFamily(fixture.patchPaths);
  for (const uid of [...parents, child, foreignUid]) {
    const db = dbFor(uid);
    await assertFails(updateDoc(doc(db, 'members', uid), { familyId: 'forged-household' }));
    await assertFails(updateDoc(doc(db, 'members', parents[0]), { familyId: 'forged-household' }));
    await assertFails(setDoc(doc(db, 'members', 'forged-member'), { familyId, role: 'parent', active: true, canLogin: true }));
    await assertFails(updateDoc(doc(db, 'financeBills', 'migration-shared-child'), { sharedWith: [sibling], familyId: 'forged-household' }));
    await assertFails(setDoc(doc(db, 'financeBills', `forged-${uid}`), { familyId, ownerUid: uid, archived: false, sharedWith: [] }));
    await assertFails(deleteDoc(doc(db, 'financeBills', 'migration-parent-only')));
    await assertFails(updateDoc(doc(db, '_taskPhotoUploads', fixture.proofUploadId), { familyId: 'forged-household' }));
    await assertFails(updateDoc(doc(db, '_taskRewardImageUploads', fixture.rewardUploadId), { familyId: 'forged-household' }));
    await assertFails(updateDoc(doc(db, 'healthDocuments', fixture.documentId), { readers: [sibling], familyId: 'forged-household' }));
    await assertFails(updateDoc(doc(db, 'taskPointBalances', `person-${sha256(personKeys[child])}`), { balance: 99999 }));
  }
});
