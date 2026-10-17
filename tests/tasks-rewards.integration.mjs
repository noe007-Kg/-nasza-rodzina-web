import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { manageTasksAction } from '../server/tasks-service.mjs';

// Refuse production, non-loopback services and inherited service-account credentials.
const demoProject = 'demo-nasza-rodzina';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
  || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199'
  || process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== demoProject
  || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== demoProject
  || process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== demoProject
  || process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
  || process.env.VERCEL) throw new Error('Task integration requires the explicit loopback demo Firestore/Storage emulators.');
for (const name of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_BASE64', 'GOOGLE_APPLICATION_CREDENTIALS']) delete process.env[name];
const app = initializeApp({ projectId: demoProject, storageBucket: `${demoProject}.firebasestorage.app` }, `tasks-integration-${randomUUID()}`);
const db = getFirestore(app);
const bucket = getStorage(app).bucket();
const fixtures = [];
const ownedCollections = ['members', 'tasks', 'taskPointBalances', 'taskPointLedger', 'taskCompletions', 'taskRewards',
  'taskRewardRequests', '_taskRewardPending', '_taskPhotoUploads', '_taskPhotoCleanup', '_taskRewardImageUploads', '_taskRewardImageCleanup'];
const errorCode = expected => error => error?.code === expected;

async function fixture() {
  const familyId = `tasks-test-${randomUUID()}`;
  const foreignFamilyId = `tasks-foreign-${randomUUID()}`;
  const profiles = new Map();
  const ids = {};
  for (const [key, role, family, person] of [
    ['parentA', 'parent', familyId, 'test-parent-a'], ['parentB', 'parent', familyId, 'test-parent-b'],
    ['child', 'child', familyId, 'test-child'], ['sibling', 'child', familyId, 'test-sibling'], ['passive', 'child', familyId, 'test-passive'],
    ['foreignParent', 'parent', foreignFamilyId, 'foreign-parent'], ['foreignChild', 'child', foreignFamilyId, 'test-child'],
  ]) {
    const uid = randomUUID(); ids[key] = uid;
    const profile = { name: `Synthetic ${key}`, personKey: person, familyId: family, role, active: true, canLogin: key !== 'passive' };
    profiles.set(key, profile);
    await db.collection('members').doc(uid).set(profile);
  }
  const item = { familyId, foreignFamilyId, ids, profiles, objectPaths: [],
    as: key => ({ app, db, bucket, uid: ids[key], profile: profiles.get(key) }) };
  fixtures.push(item);
  return item;
}
const action = (item, who, body) => manageTasksAction(item.as(who), body);
const collection = (item, name) => db.collection(name).where('familyId', '==', item.familyId).get();
const draft = changes => ({ action: 'save-task', id: randomUUID(), title: 'Synthetic obligation', person: 'test-child', points: 12,
  dueDate: '', priority: 'normal', note: 'Synthetic description', verificationMode: 'trust', repeat: 'none', ...changes });
async function createTask(item, changes = {}) {
  const body = draft(changes); await action(item, 'parentA', body); return body.id;
}
async function earned(item, points = 12) {
  const taskId = await createTask(item, { points }); await action(item, 'child', { action: 'submit', taskId });
}
async function reward(item, cost = 5) {
  const id = randomUUID();
  await action(item, 'parentB', { action: 'save-reward', id, title: 'Synthetic reward', note: 'Synthetic reward description', cost, people: ['test-child'], active: true });
  return id;
}
async function balance(item) {
  const rows = await collection(item, 'taskPointBalances');
  assert.equal(rows.size, 1); return rows.docs[0].data();
}

after(async () => {
  // Remove only namespaced synthetic rows created by this suite, never clear a database.
  for (const item of fixtures) {
    for (const path of item.objectPaths) await bucket.file(path).delete({ ignoreNotFound: true });
    for (const familyId of [item.familyId, item.foreignFamilyId]) for (const name of ownedCollections) {
      const rows = await db.collection(name).where('familyId', '==', familyId).get();
      for (const row of rows.docs) await row.ref.delete();
    }
  }
  await deleteApp(app);
});

test('real transactions create tasks and award trust completion once under simultaneous retries', { timeout: 120000 }, async () => {
  const item = await fixture(); const taskId = await createTask(item);
  await assert.rejects(action(item, 'child', draft()), errorCode('TASK_PARENT_REQUIRED'));
  await Promise.all([1, 2, 3].map(() => action(item, 'child', { action: 'submit', taskId })));
  assert.equal((await balance(item)).balance, 12);
  assert.equal((await collection(item, 'taskPointLedger')).size, 1);
  assert.equal((await collection(item, 'taskCompletions')).size, 1);
  assert.equal((await db.collection('tasks').doc(taskId).get()).data().pointsBooked, true);
});

test('real parent approval and rework preserve zero points until one successful approval', { timeout: 120000 }, async () => {
  const item = await fixture(); const taskId = await createTask(item, { verificationMode: 'parent' });
  await action(item, 'child', { action: 'submit', taskId });
  assert.equal((await collection(item, 'taskPointBalances')).size, 0);
  await assert.rejects(action(item, 'child', { action: 'approve', taskId }), errorCode('TASK_PARENT_REQUIRED'));
  await action(item, 'parentB', { action: 'rework', taskId, comment: 'Synthetic revision' });
  assert.equal((await collection(item, 'taskPointLedger')).size, 0);
  assert.equal((await db.collection('tasks').doc(taskId).get()).data().approvalStatus, 'none');
  await action(item, 'child', { action: 'submit', taskId });
  await Promise.all(['parentA', 'parentB'].map(who => action(item, who, { action: 'approve', taskId })));
  assert.equal((await balance(item)).balance, 12);
  assert.equal((await collection(item, 'taskCompletions')).size, 1);
  assert.equal((await collection(item, 'taskPointLedger')).size, 1);
});

test('real pending requests deduplicate and two parents spend the snapshotted reward cost exactly once', { timeout: 120000 }, async () => {
  const item = await fixture(); await earned(item); const rewardId = await reward(item);
  const requests = await Promise.all([1, 2, 3].map(() => action(item, 'child', { action: 'request-reward', rewardId })));
  assert.equal(new Set(requests.map(result => result.requestId)).size, 1);
  const requestId = requests[0].requestId;
  await assert.rejects(action(item, 'child', { action: 'decide-reward', requestId, approved: true }), errorCode('TASK_PARENT_REQUIRED'));
  await Promise.all(['parentA', 'parentB'].map(who => action(item, who, { action: 'decide-reward', requestId, approved: true })));
  assert.equal((await balance(item)).balance, 7);
  assert.equal((await balance(item)).spent, 5);
  assert.equal((await collection(item, 'taskPointLedger')).docs.filter(row => row.data().kind === 'redeemed').length, 1);
  assert.equal((await collection(item, '_taskRewardPending')).size, 0);
});

test('real rejection preserves balance and concurrent different rewards cannot overdraw it', { timeout: 120000 }, async () => {
  const item = await fixture(); await earned(item, 9);
  const rejected = await action(item, 'child', { action: 'request-reward', rewardId: await reward(item, 6) });
  await action(item, 'parentA', { action: 'decide-reward', requestId: rejected.requestId, approved: false });
  assert.equal((await balance(item)).balance, 9);
  const requests = [];
  for (let index = 0; index < 2; index += 1) requests.push(await action(item, 'child', { action: 'request-reward', rewardId: await reward(item, 6) }));
  const decisions = await Promise.allSettled(requests.map((request, index) => action(item, index ? 'parentB' : 'parentA', { action: 'decide-reward', requestId: request.requestId, approved: true })));
  assert.equal(decisions.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(decisions.find(result => result.status === 'rejected').reason.code, 'TASK_NOT_ENOUGH_POINTS');
  assert.equal((await balance(item)).balance, 3);
  assert.equal((await collection(item, 'taskPointLedger')).docs.filter(row => row.data().kind === 'redeemed').length, 1);
});

test('real foreign-household and sibling attempts fail without mutation despite identical person keys', { timeout: 120000 }, async () => {
  const item = await fixture(); const taskId = await createTask(item, { verificationMode: 'parent' });
  await action(item, 'child', { action: 'submit', taskId });
  const taskRef = db.collection('tasks').doc(taskId); const before = (await taskRef.get()).data();
  for (const who of ['foreignParent', 'foreignChild']) {
    await assert.rejects(action(item, who, { action: 'submit', taskId }), errorCode('TASK_NOT_FOUND'));
    if (who === 'foreignParent') for (const operation of ['approve', 'rework']) await assert.rejects(action(item, who, { action: operation, taskId }), errorCode('TASK_NOT_FOUND'));
  }
  await assert.rejects(action(item, 'sibling', { action: 'submit', taskId }), errorCode('TASK_FORBIDDEN'));
  assert.deepEqual((await taskRef.get()).data(), before);
  assert.equal((await collection(item, 'taskPointLedger')).size, 0);
  assert.deepEqual((await action(item, 'foreignParent', { action: 'state' })).history, []);
});

test('real uploaded proof awards no points early and approval deletes the actual Storage object and references', { timeout: 120000 }, async () => {
  const item = await fixture(); const taskId = await createTask(item, { verificationMode: 'photo' });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const upload = await action(item, 'child', { action: 'begin-photo', taskId, contentType: 'image/png', size: png.length });
  item.objectPaths.push(upload.path);
  const file = bucket.file(upload.path);
  await file.save(png, { resumable: false, metadata: { contentType: 'image/png', metadata: { taskId, uploadId: upload.uploadId,
    uploaderUid: item.ids.child, familyId: item.familyId } } });
  assert.equal((await file.exists())[0], true);
  await action(item, 'child', { action: 'submit', taskId, uploadId: upload.uploadId });
  assert.equal((await collection(item, 'taskPointBalances')).size, 0);
  await action(item, 'parentB', { action: 'approve', taskId });
  assert.equal((await balance(item)).balance, 12);
  assert.equal((await file.exists())[0], false);
  const task = (await db.collection('tasks').doc(taskId).get()).data();
  assert.equal(task.proofPath, undefined); assert.equal(task.proofUploadId, undefined);
  const receipt = (await db.collection('_taskPhotoUploads').doc(upload.uploadId).get()).data();
  assert.equal(receipt.state, 'deleted'); assert.equal(receipt.path, undefined);
});
