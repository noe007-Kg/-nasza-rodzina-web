import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { manageTasksAction } from '../server/tasks-service.mjs';
import { runTaskPhotoCleanup, taskPhotoCleanupId } from '../server/tasks-photos.mjs';
import { canManageHealthOwner, validHealthFileHeader } from '../server/health-access.mjs';
import { manageHealthAction, retryHealthDocumentDeletes } from '../server/health-service.mjs';
import { runHealthDocumentReminders } from '../server/health-reminders.mjs';
import { familyMemoryContext, memoryBucket, familyTestNow, fixtureParent, fixtureChild, fixtureAdult } from './family-v2-test-helpers.mjs';

const task = changes => ({ title: 'Obowiązek testowy', person: 'child-person', points: 12, done: false, archived: false,
  approvalStatus: 'none', verificationMode: 'trust', repeat: 'none', familyId: 'fixture-family', createdBy: 'parent', ...changes });
const inCollection = (context, name) => [...context.rows.entries()].filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === name.split('/').length + 1);
const balance = context => inCollection(context, 'taskPointBalances').find(([, value]) => value.person === 'child-person')?.[1];
const errorCode = code => error => error?.code === code;
const metadata = changes => ({ title: 'Dokument testowy', documentType: 'court_document', issuedOn: '2026-01-02',
  expiresOn: '', indefinite: true, number: '', note: '', pinned: true, shareOwner: false, ...changes });
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test('trust completion awards points once under concurrent retries and retains one history record', async () => {
  const context = familyMemoryContext({ 'tasks/trust-task': task({}) });
  const child = context.as('child');
  await Promise.all([manageTasksAction(child, { action: 'submit', taskId: 'trust-task' }), manageTasksAction(child, { action: 'submit', taskId: 'trust-task' })]);
  assert.equal(balance(context).balance, 12);
  assert.equal(balance(context).completedCount, 1);
  assert.equal(inCollection(context, 'taskPointLedger').length, 1);
  assert.equal(inCollection(context, 'taskCompletions').length, 1);
  assert.equal(context.rows.get('tasks/trust-task').pointsBooked, true);
});

test('parent approval waits without points, rejects child approval and awards once after a parent approves', async () => {
  const context = familyMemoryContext({ 'tasks/parent-task': task({ verificationMode: 'parent', requireApproval: true }) });
  await manageTasksAction(context.as('child'), { action: 'submit', taskId: 'parent-task' });
  assert.equal(context.rows.get('tasks/parent-task').approvalStatus, 'pending');
  assert.equal(balance(context), undefined);
  await assert.rejects(manageTasksAction(context.as('child'), { action: 'approve', taskId: 'parent-task' }), errorCode('TASK_PARENT_REQUIRED'));
  await Promise.all([manageTasksAction(context, { action: 'approve', taskId: 'parent-task' }), manageTasksAction(context, { action: 'approve', taskId: 'parent-task' })]);
  assert.equal(balance(context).balance, 12);
  assert.equal(inCollection(context, 'taskCompletions').length, 1);
});

test('legacy completed tasks become an opening balance without changing historic task records', async () => {
  const historic = task({ done: true, points: 8, approvalStatus: 'approved', title: 'Historia' });
  const context = familyMemoryContext({ 'tasks/historic': historic, 'tasks/new': task({}) });
  await manageTasksAction(context.as('child'), { action: 'submit', taskId: 'new' });
  assert.equal(balance(context).balance, 20);
  assert.deepEqual(context.rows.get('tasks/historic'), historic);
});

test('task state never exposes the points history of a different family', async () => {
  const context = familyMemoryContext({
    'members/foreign-child': { ...fixtureChild, name: 'Inna osoba testowa', personKey: 'foreign-person', familyId: 'foreign-family' },
    'taskPointLedger/foreign-ledger': { person: 'foreign-person', delta: 99, kind: 'earned', title: 'Obca historia testowa', familyId: 'foreign-family' },
    'taskPointLedger/own-ledger': { person: 'child-person', delta: 12, kind: 'earned', title: 'Własna historia testowa', familyId: 'fixture-family' },
  });
  context.bucket = memoryBucket();
  const state = await manageTasksAction(context, { action: 'state' });
  assert.deepEqual(state.history.map(entry => entry.title), ['Własna historia testowa']);
  assert.equal(state.balances.some(entry => entry.person === 'foreign-person'), false);
});

async function rewardContext(points = 12, cost = 5) {
  const context = familyMemoryContext({ 'tasks/earned': task({}) });
  context.rows.get('tasks/earned').points = points;
  await manageTasksAction(context.as('child'), { action: 'submit', taskId: 'earned' });
  await manageTasksAction(context, { action: 'save-reward', id: 'reward-one', title: 'Nagroda testowa', note: 'Opis nagrody testowej', cost, people: ['child-person'], active: true });
  const request = await manageTasksAction(context.as('child'), { action: 'request-reward', rewardId: 'reward-one' });
  return { context, request };
}

test('reward request retries share one pending request; parent denial never spends points', async () => {
  const { context, request } = await rewardContext();
  const repeated = await manageTasksAction(context.as('child'), { action: 'request-reward', rewardId: 'reward-one' });
  assert.equal(repeated.requestId, request.requestId);
  assert.equal(balance(context).balance, 12);
  await manageTasksAction(context, { action: 'decide-reward', requestId: request.requestId, approved: false });
  assert.equal(balance(context).balance, 12);
  assert.equal(context.rows.get(`taskRewardRequests/${request.requestId}`).state, 'rejected');
  assert.equal(inCollection(context, 'taskPointLedger').filter(([, value]) => value.kind === 'redeemed').length, 0);
});

test('only a parent can approve a reward and concurrent approval spends its snapshotted cost once', async () => {
  const { context, request } = await rewardContext();
  context.rows.get('taskRewards/reward-one').cost = 10;
  await assert.rejects(manageTasksAction(context.as('child'), { action: 'decide-reward', requestId: request.requestId, approved: true }), errorCode('TASK_PARENT_REQUIRED'));
  await Promise.all([manageTasksAction(context, { action: 'decide-reward', requestId: request.requestId, approved: true }),
    manageTasksAction(context, { action: 'decide-reward', requestId: request.requestId, approved: true })]);
  assert.equal(balance(context).balance, 7);
  assert.equal(balance(context).spent, 5);
  assert.equal(inCollection(context, 'taskPointLedger').filter(([, value]) => value.kind === 'redeemed').length, 1);
});

test('insufficient reward balance leaves the request pending and the ledger and balance unchanged', async () => {
  const { context, request } = await rewardContext(3, 5);
  await assert.rejects(manageTasksAction(context, { action: 'decide-reward', requestId: request.requestId, approved: true }), errorCode('TASK_NOT_ENOUGH_POINTS'));
  assert.equal(balance(context).balance, 3);
  assert.equal(balance(context).spent, 0);
  assert.equal(context.rows.get(`taskRewardRequests/${request.requestId}`).state, 'pending');
  assert.equal(inCollection(context, 'taskPointLedger').length, 1);
});

async function submittedPhoto() {
  const context = familyMemoryContext({ 'tasks/photo-task': task({ verificationMode: 'photo', requireApproval: true }) });
  context.bucket = memoryBucket();
  const child = { ...context.as('child'), bucket: context.bucket };
  const ticket = await manageTasksAction(child, { action: 'begin-photo', taskId: 'photo-task', contentType: 'image/png', size: png.length }, { now: familyTestNow });
  context.bucket.objects.set(ticket.path, { bytes: png, metadata: { size: png.length, contentType: 'image/png',
    metadata: { taskId: 'photo-task', uploadId: ticket.uploadId, uploaderUid: 'child', firebaseStorageDownloadTokens: 'test-only-non-secret-token' } } });
  await manageTasksAction(child, { action: 'submit', taskId: 'photo-task', uploadId: ticket.uploadId }, { now: familyTestNow });
  return { context, child, ticket };
}

test('photo submission requires a complete validated file and never awards points before approval', async () => {
  const context = familyMemoryContext({ 'tasks/photo-task': task({ verificationMode: 'photo' }) }, 'child');
  context.bucket = memoryBucket();
  await assert.rejects(manageTasksAction(context, { action: 'submit', taskId: 'photo-task' }), errorCode('TASK_PHOTO_REQUIRED'));
  const ticket = await manageTasksAction(context, { action: 'begin-photo', taskId: 'photo-task', contentType: 'image/png', size: png.length }, { now: familyTestNow });
  await assert.rejects(manageTasksAction(context, { action: 'submit', taskId: 'photo-task', uploadId: ticket.uploadId }), errorCode('TASK_PHOTO_INCOMPLETE'));
  assert.equal(context.rows.get('tasks/photo-task').approvalStatus, 'none');
  assert.equal(balance(context), undefined);
  const submitted = await submittedPhoto();
  assert.equal(submitted.context.rows.get('tasks/photo-task').approvalStatus, 'pending');
  assert.equal(balance(submitted.context), undefined);
  assert.equal(submitted.context.bucket.objects.get(submitted.ticket.path).metadata.metadata.firebaseStorageDownloadTokens, null);
});

test('approving a photo task actually deletes Storage and removes every live file reference', async () => {
  const { context, ticket } = await submittedPhoto();
  await manageTasksAction(context, { action: 'approve', taskId: 'photo-task' }, { now: familyTestNow });
  assert.equal(balance(context).balance, 12);
  assert.equal(context.bucket.objects.has(ticket.path), false);
  assert.equal(context.rows.get('tasks/photo-task').proofPath, undefined);
  assert.equal(context.rows.get('tasks/photo-task').proofUploadId, undefined);
  assert.equal(context.rows.get(`_taskPhotoUploads/${ticket.uploadId}`).path, undefined);
  assert.equal(context.rows.get(`_taskPhotoUploads/${ticket.uploadId}`).state, 'deleted');
});

test('a Storage deletion failure revokes access immediately and a later cleanup retries the real deletion', async () => {
  const { context, ticket } = await submittedPhoto();
  context.bucket.controls.failDeletes = 1;
  await manageTasksAction(context, { action: 'approve', taskId: 'photo-task' }, { now: familyTestNow });
  assert.equal(context.bucket.objects.has(ticket.path), true);
  assert.equal(context.rows.get('tasks/photo-task').proofPath, undefined);
  assert.equal(context.rows.get(`_taskPhotoUploads/${ticket.uploadId}`).state, 'revoked');
  const jobPath = `_taskPhotoCleanup/${taskPhotoCleanupId(ticket.path)}`;
  const job = context.rows.get(jobPath);
  assert.equal(job.state, 'pending');
  assert.equal(job.lastErrorCode, 'TASK_PHOTO_DELETE_FAILED');
  const retry = await runTaskPhotoCleanup(context, { now: new Date(familyTestNow.getTime() + 3600000) });
  assert.equal(retry.deleted, 1);
  assert.equal(context.bucket.objects.has(ticket.path), false);
  assert.equal(context.rows.get(`_taskPhotoUploads/${ticket.uploadId}`).path, undefined);
  assert.equal(balance(context).balance, 12);
});

test('rework removes the old proof through retry and requires a new proof before points', async () => {
  const { context, child, ticket } = await submittedPhoto();
  context.bucket.controls.failDeletes = 1;
  await manageTasksAction(context, { action: 'rework', taskId: 'photo-task', comment: 'Popraw wykonanie' }, { now: familyTestNow });
  assert.equal(balance(context), undefined);
  assert.equal(context.rows.get('tasks/photo-task').reworkComment, 'Popraw wykonanie');
  assert.equal(context.rows.get('tasks/photo-task').proofPath, undefined);
  await assert.rejects(manageTasksAction(child, { action: 'submit', taskId: 'photo-task', uploadId: ticket.uploadId }, { now: familyTestNow }));
  const fresh = await manageTasksAction(child, { action: 'begin-photo', taskId: 'photo-task', contentType: 'image/png', size: png.length }, { now: familyTestNow });
  context.bucket.objects.set(fresh.path, { bytes: png, metadata: { size: png.length, contentType: 'image/png',
    metadata: { taskId: 'photo-task', uploadId: fresh.uploadId, uploaderUid: 'child' } } });
  await manageTasksAction(child, { action: 'submit', taskId: 'photo-task', uploadId: fresh.uploadId }, { now: familyTestNow });
  await runTaskPhotoCleanup(context, { now: new Date(familyTestNow.getTime() + 3600000) });
  assert.equal(context.bucket.objects.has(ticket.path), false);
  assert.equal(context.bucket.objects.has(fresh.path), true);
  assert.equal(balance(context), undefined);
  await manageTasksAction(context, { action: 'approve', taskId: 'photo-task' }, { now: familyTestNow });
  assert.equal(balance(context).balance, 12);
  assert.equal(context.bucket.objects.size, 0);
});

for (const storageFails of [true, false]) test(`approval survives cleanup bookkeeping outage (Storage failure: ${storageFails})`, async () => {
  const { context, ticket } = await submittedPhoto();
  context.bucket.controls.failDeletes = storageFails ? 1 : 0;
  const batch = context.db.batch;
  const collection = context.db.collection;
  context.db.batch = () => { const writer = batch(); return { ...writer, commit: async () => { throw new Error('FIRESTORE_UNAVAILABLE'); } }; };
  context.db.collection = name => {
    const query = collection(name);
    if (name !== '_taskPhotoCleanup') return query;
    return { ...query, doc: id => ({ ...query.doc(id), set: async () => { throw new Error('FIRESTORE_UNAVAILABLE'); } }) };
  };
  const result = await manageTasksAction(context, { action: 'approve', taskId: 'photo-task' }, { now: familyTestNow });
  assert.equal(result.completed, true);
  assert.equal(balance(context).balance, 12);
  assert.equal(context.rows.get('tasks/photo-task').proofPath, undefined);
  assert.equal(context.rows.get(`_taskPhotoUploads/${ticket.uploadId}`).state, 'revoked');
  const job = context.rows.get(`_taskPhotoCleanup/${taskPhotoCleanupId(ticket.path)}`);
  assert.equal(job.state, 'pending');
  assert.equal(job.path, ticket.path);
  context.db.batch = batch;
  context.db.collection = collection;
  const retry = await runTaskPhotoCleanup(context, { now: familyTestNow });
  assert.equal(retry.deleted, 1);
  assert.equal(context.bucket.objects.has(ticket.path), false);
  await manageTasksAction(context, { action: 'approve', taskId: 'photo-task' }, { now: familyTestNow });
  assert.equal(balance(context).balance, 12);
  assert.equal(inCollection(context, 'taskPointLedger').length, 1);
});

test('orphan cleanup deletes abandoned uploads but preserves submitted photos awaiting a parent', async () => {
  const { context, ticket } = await submittedPhoto();
  const orphanId = '00112233-4455-6677-8899-aabbccddeeff';
  const orphanPath = `taskProof/orphan-task/child/${orphanId}.png`;
  context.rows.set(`_taskPhotoUploads/${orphanId}`, { taskId: 'orphan-task', uid: 'child', path: orphanPath, state: 'open',
    orphanAfter: Timestamp.fromMillis(familyTestNow.getTime() - 1) });
  context.bucket.objects.set(orphanPath, { bytes: png, metadata: { size: png.length, contentType: 'image/png' } });
  const result = await runTaskPhotoCleanup(context, { now: familyTestNow });
  assert.equal(result.abandoned, 1);
  assert.equal(context.bucket.objects.has(orphanPath), false);
  assert.equal(context.bucket.objects.has(ticket.path), true);
  assert.equal(context.rows.get(`_taskPhotoUploads/${ticket.uploadId}`).state, 'submitted');
});

test('every photo ticket is atomically invalidated on reassignment, verification change, submission, approval, rework and archive', async () => {
  async function fixture() {
    const context = familyMemoryContext({ 'tasks/multiple-photos': task({ verificationMode: 'photo', requireApproval: true }) });
    context.bucket = memoryBucket();
    const child = { ...context.as('child'), bucket: context.bucket };
    const uploads = [];
    for (let i = 0; i < 3; i += 1) {
      const ticket = await manageTasksAction(child, { action: 'begin-photo', taskId: 'multiple-photos', contentType: 'image/png', size: png.length }, { now: familyTestNow });
      context.bucket.objects.set(ticket.path, { bytes: png, metadata: { size: png.length, contentType: 'image/png', metadata: {
        taskId: 'multiple-photos', uploadId: ticket.uploadId, uploaderUid: 'child' } } });
      uploads.push(ticket);
    }
    return { context, child, uploads };
  }
  for (const change of [ { person: 'adult-person', verificationMode: 'photo' }, { person: 'child-person', verificationMode: 'trust' } ]) {
    const { context, uploads } = await fixture();
    await manageTasksAction(context, { action: 'save-task', id: 'multiple-photos', title: 'Obowiązek testowy',
      dueDate: '', note: '', priority: 'normal', points: 12, repeat: 'none', ...change }, { now: familyTestNow });
    for (const ticket of uploads) assert.equal(context.rows.get(`_taskPhotoUploads/${ticket.uploadId}`).state, 'revoked');
    assert.equal(inCollection(context, '_taskPhotoCleanup').length, 3);
  }
  for (const action of ['approve', 'rework', 'archive-task']) {
    const { context, child, uploads } = await fixture();
    await manageTasksAction(child, { action: 'submit', taskId: 'multiple-photos', uploadId: uploads[0].uploadId }, { now: familyTestNow });
    assert.equal(context.rows.get(`_taskPhotoUploads/${uploads[0].uploadId}`).state, 'submitted');
    for (const ticket of uploads.slice(1)) assert.equal(context.rows.get(`_taskPhotoUploads/${ticket.uploadId}`).state, 'revoked');
    // Represent an older still-open ticket which must not survive a terminal transition.
    context.rows.get(`_taskPhotoUploads/${uploads[1].uploadId}`).state = 'open';
    await manageTasksAction(context, { action, taskId: 'multiple-photos', ...(action === 'archive-task' ? { confirmed: true } : {}) }, { now: familyTestNow });
    for (const ticket of uploads) assert.equal(['revoked', 'deleted'].includes(context.rows.get(`_taskPhotoUploads/${ticket.uploadId}`).state), true);
    assert.equal(context.bucket.objects.has(uploads[0].path), false);
    assert.equal(context.bucket.objects.has(uploads[1].path), false);
    await runTaskPhotoCleanup(context, { now: new Date(familyTestNow.getTime() + 3600000) });
    assert.equal(context.bucket.objects.size, 0);
    if (action === 'approve') assert.equal(balance(context).balance, 12);
    else assert.equal(balance(context), undefined);
  }
});

test('a parent role alone grants no authority over an adult or an owner with an unknown age', async () => {
  const actor = { id: 'parent', ...fixtureParent };
  assert.equal(canManageHealthOwner(actor, { id: 'adult', ...fixtureAdult }, undefined, familyTestNow), false);
  assert.equal(canManageHealthOwner(actor, { id: 'unknown', ...fixtureAdult, birthDate: undefined }, undefined, familyTestNow), false);
  assert.equal(canManageHealthOwner(actor, { id: 'child', ...fixtureChild }, undefined, familyTestNow), true);
  const context = familyMemoryContext();
  await assert.rejects(manageHealthAction(context, { operation: 'prepare', ownerProfileId: 'adult', metadata: metadata({}),
    mimeType: 'application/pdf', size: 16, fileName: 'test.pdf' }), errorCode('HEALTH_FORBIDDEN'));
  assert.equal(inCollection(context, 'healthDocuments').length, 0);
});

test('a parent cannot create a protected document for a child belonging to a different family', async () => {
  const context = familyMemoryContext({ 'members/foreign-child': { ...fixtureChild, familyId: 'foreign-family' } });
  await assert.rejects(manageHealthAction(context, { operation: 'prepare', ownerProfileId: 'foreign-child', metadata: metadata({}),
    mimeType: 'application/pdf', size: 16, fileName: 'test.pdf' }), errorCode('HEALTH_FORBIDDEN'));
  assert.equal(inCollection(context, 'healthDocuments').length, 0);
});

test('an adult can give consent, a parent cannot self-authorize, and owner sharing is per document', async () => {
  const context = familyMemoryContext();
  await assert.rejects(manageHealthAction(context, { operation: 'grant', ownerProfileId: 'adult', granteeUid: 'parent', canEdit: true }), errorCode('HEALTH_FORBIDDEN'));
  await manageHealthAction(context.as('adult'), { operation: 'grant', ownerProfileId: 'adult', granteeUid: 'parent', canEdit: true });
  const first = await manageHealthAction(context, { operation: 'prepare', ownerProfileId: 'adult', metadata: metadata({}), mimeType: 'application/pdf', size: 16, fileName: 'test.pdf' });
  const second = await manageHealthAction(context, { operation: 'prepare', ownerProfileId: 'adult', metadata: metadata({ shareOwner: true }), mimeType: 'application/pdf', size: 16, fileName: 'test.pdf' });
  assert.deepEqual(context.rows.get(`healthDocuments/${first.documentId}`).readers, ['parent']);
  assert.deepEqual(context.rows.get(`healthDocuments/${second.documentId}`).readers, ['parent', 'adult']);
  assert.equal(context.rows.get(`healthDocuments/${first.documentId}`).state, 'draft');
});

test('revoking adult consent removes access to existing documents and rejects further edits', async () => {
  const context = familyMemoryContext();
  await manageHealthAction(context.as('adult'), { operation: 'grant', ownerProfileId: 'adult', granteeUid: 'parent', canEdit: true });
  const prepared = await manageHealthAction(context, { operation: 'prepare', ownerProfileId: 'adult', metadata: metadata({ shareOwner: true }), mimeType: 'image/png', size: png.length, fileName: 'test.png' });
  context.rows.get(`healthDocuments/${prepared.documentId}`).state = 'ready';
  await manageHealthAction(context.as('adult'), { operation: 'revoke', ownerProfileId: 'adult', granteeUid: 'parent' });
  const record = context.rows.get(`healthDocuments/${prepared.documentId}`);
  assert.equal(record.readers.includes('parent'), false);
  assert.equal(record.editors.includes('parent'), false);
  await assert.rejects(manageHealthAction(context, { operation: 'update', documentId: prepared.documentId, metadata: metadata({}) }), errorCode('HEALTH_FORBIDDEN'));
});

test('finalizing a health upload requires correct Storage size and file signature and strips bearer download tokens', async () => {
  const context = familyMemoryContext(); context.bucket = memoryBucket();
  const prepared = await manageHealthAction(context, { operation: 'prepare', ownerProfileId: 'child', metadata: metadata({}), mimeType: 'image/png', size: png.length, fileName: 'test.png' });
  context.bucket.objects.set(prepared.storagePath, { bytes: Buffer.alloc(png.length), metadata: { size: png.length, contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: 'test-only-token' } } });
  await assert.rejects(manageHealthAction(context, { operation: 'save', documentId: prepared.documentId }), errorCode('HEALTH_INVALID_FILE'));
  assert.equal(context.rows.get(`healthDocuments/${prepared.documentId}`).state, 'draft');
  context.bucket.objects.get(prepared.storagePath).bytes = png;
  await manageHealthAction(context, { operation: 'save', documentId: prepared.documentId });
  assert.equal(context.rows.get(`healthDocuments/${prepared.documentId}`).state, 'ready');
  assert.equal(context.bucket.objects.get(prepared.storagePath).metadata.metadata.firebaseStorageDownloadTokens, null);
  await manageHealthAction(context, { operation: 'save', documentId: prepared.documentId });
  assert.equal(context.rows.get(`healthDocuments/${prepared.documentId}`).state, 'ready');
});

test('health file validation accepts only actual PDF/JPEG/PNG/WebP signatures', () => {
  const files = [ ['application/pdf', Buffer.from('%PDF-1.7 fixture')], ['image/jpeg', Buffer.from([255, 216, 255, 0])],
    ['image/png', png], ['image/webp', Buffer.from('RIFF0000WEBPfixture')] ];
  for (const [mimeType, bytes] of files) {
    assert.equal(validHealthFileHeader(mimeType, bytes), true);
    assert.equal(validHealthFileHeader(mimeType, Buffer.from('<script>test</script>')), false);
  }
  assert.equal(validHealthFileHeader('text/html', Buffer.from('%PDF-')), false);
});

test('explicit health deletion is retried while expired or indefinite stored documents are never automatically deleted', async () => {
  const context = familyMemoryContext(); context.bucket = memoryBucket();
  const prepared = await manageHealthAction(context, { operation: 'prepare', ownerProfileId: 'child', metadata: metadata({}), mimeType: 'image/png', size: png.length, fileName: 'test.png' });
  context.bucket.objects.set(prepared.storagePath, { bytes: png, metadata: { size: png.length, contentType: 'image/png' } });
  await manageHealthAction(context, { operation: 'save', documentId: prepared.documentId });
  await assert.rejects(manageHealthAction(context, { operation: 'delete', documentId: prepared.documentId }), errorCode('HEALTH_CONFIRMATION_REQUIRED'));
  context.bucket.controls.failDeletes = 1;
  assert.equal((await manageHealthAction(context, { operation: 'delete', documentId: prepared.documentId, confirm: true })).deletionPending, true);
  context.rows.set('healthDocuments/expired-document', { state: 'ready', indefinite: false, expiresOn: '2020-01-01', storagePath: 'healthDocuments/expired-document/parent/file.pdf' });
  context.rows.set('healthDocuments/indefinite-document', { state: 'ready', indefinite: true, storagePath: 'healthDocuments/indefinite-document/parent/file.pdf' });
  assert.equal((await retryHealthDocumentDeletes(context)).deleted, 1);
  assert.equal(context.rows.has(`healthDocuments/${prepared.documentId}`), false);
  assert.equal(context.bucket.objects.has(prepared.storagePath), false);
  assert.equal(context.rows.has('healthDocuments/expired-document'), true);
  assert.equal(context.rows.has('healthDocuments/indefinite-document'), true);
});

test('90/30/7-day document reminders are deduplicated, ACL-only, preference-aware and ignore indefinite documents', async () => {
  const context = familyMemoryContext({ 'userPreferences/parent': { notifications: { categories: { health: false } } } });
  const dates = { 90: '2027-01-09', 30: '2026-11-10', 7: '2026-10-18' };
  for (const [days, expiresOn] of Object.entries(dates)) context.rows.set(`healthDocuments/doc-${days}`, {
    state: 'ready', indefinite: false, expiresOn, readers: ['adult', 'adult', 'parent'], title: 'Poufna nazwa dokumentu', number: 'POUFNY-NUMER' });
  context.rows.set('healthDocuments/indefinite', { state: 'ready', indefinite: true, expiresOn: dates[7], readers: ['adult'] });
  assert.equal((await runHealthDocumentReminders(context, familyTestNow)).delivered, 3);
  assert.equal((await runHealthDocumentReminders(context, familyTestNow)).delivered, 0);
  const inbox = inCollection(context, 'notificationInbox/adult/items');
  assert.equal(inbox.length, 3);
  assert.equal(inCollection(context, 'notificationInbox/parent/items').length, 0);
  assert.equal(inCollection(context, 'notificationInbox/child/items').length, 0);
  for (const [, entry] of inbox) {
    assert.equal(entry.body.includes('Poufna'), false);
    assert.equal(entry.body.includes('POUFNY-NUMER'), false);
    assert.equal(entry.important, true);
    assert.equal(entry.read, false);
  }
});
