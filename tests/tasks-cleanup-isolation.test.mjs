import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyTaskPhoto, enqueueTaskPhotoCleanup, deleteQueuedTaskPhoto, runTaskPhotoCleanup, taskPhotoCleanupId } from '../server/tasks-photos.mjs';
import { verifyRewardImage, revokeRewardImage, deleteQueuedRewardImage, rewardImageCleanupId } from '../server/tasks-reward-images.mjs';
import { familyMemoryContext, memoryBucket, familyTestNow } from './family-v2-test-helpers.mjs';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const ids = { proof: '00000000-0000-4000-8000-000000000001', reward: '00000000-0000-4000-8000-000000000002' };
const collections = { proof: '_taskPhotoUploads', reward: '_taskRewardImageUploads' };
const cleanupCollections = { proof: '_taskPhotoCleanup', reward: '_taskRewardImageCleanup' };
const deleteFunctions = { proof: deleteQueuedTaskPhoto, reward: deleteQueuedRewardImage };
const verifyFunctions = { proof: verifyTaskPhoto, reward: verifyRewardImage };
const hashFunctions = { proof: taskPhotoCleanupId, reward: rewardImageCleanupId };

function fixture(kind, { state = 'open', target = true } = {}) {
  const uid = kind === 'proof' ? 'child' : 'parent';
  const targetKey = kind === 'proof' ? 'taskId' : 'rewardId';
  const targetId = kind === 'proof' ? 'test-task' : 'test-reward';
  const path = `${kind === 'proof' ? 'taskProof' : 'taskRewardImages'}/${targetId}/${uid}/${ids[kind]}.png`;
  const ticket = { id: ids[kind], uid, [targetKey]: targetId, person: 'child-person', familyId: 'fixture-family', path,
    state, contentType: 'image/png', size: png.length, revokedAt: Timestamp.fromDate(familyTestNow),
    orphanAfter: Timestamp.fromMillis(familyTestNow.getTime() - 1000) };
  const targetPath = `${kind === 'proof' ? 'tasks' : 'taskRewards'}/${targetId}`;
  const context = familyMemoryContext({ [`${collections[kind]}/${ticket.id}`]: ticket,
    ...(target ? { [targetPath]: { familyId: 'fixture-family', person: 'child-person' } } : {}) }, uid);
  context.bucket = memoryBucket({ [path]: { bytes: png, metadata: { size: png.length, contentType: 'image/png', metadata: {
    [targetKey]: targetId, uploaderUid: uid, uploadId: ticket.id, firebaseStorageDownloadTokens: 'synthetic-private-token',
  } } } });
  const originalFile = context.bucket.file; let fileTouches = 0;
  context.bucket.file = path => { fileTouches += 1; return originalFile(path); };
  const queue = { path, uploadId: ticket.id, uid, [targetKey]: targetId, familyId: ticket.familyId,
    reason: 'abandoned', state: 'pending', attempts: 0, nextAttemptAt: Timestamp.fromDate(familyTestNow) };
  const queuePath = `${cleanupCollections[kind]}/${hashFunctions[kind](path)}`;
  const putQueue = changes => context.rows.set(queuePath, { ...queue, ...changes });
  return { context, ticket, targetPath, queue, queuePath, putQueue, fileTouches: () => fileTouches,
    uploader: uid, parent: () => context.as('parent'), worker: () => ({ db: context.db, bucket: context.bucket }) };
}

for (const kind of ['proof', 'reward']) {
  test(`${kind}: explicit same-household legacy object paths are verified without requiring new file metadata`, async () => {
    const item = fixture(kind);
    await verifyFunctions[kind](item.context, item.ticket);
    assert.equal(item.context.bucket.objects.get(item.ticket.path).metadata.metadata.firebaseStorageDownloadTokens, null);
  });

  test(`${kind}: other households, missing household and __legacy__ cannot verify or revoke tokens`, async () => {
    for (const familyId of ['foreign-family', undefined, '__legacy__']) {
      const item = fixture(kind); const supplied = { ...item.ticket, familyId };
      await assert.rejects(verifyFunctions[kind](item.context, supplied));
      assert.equal(item.fileTouches(), 0);
      assert.equal(item.context.bucket.objects.get(item.ticket.path).metadata.metadata.firebaseStorageDownloadTokens, 'synthetic-private-token');
    }
  });

  test(`${kind}: every path segment and fresh linked member/target must belong to its ticket`, async () => {
    for (const change of ['path-uid', 'path-target', 'path-upload', 'fresh-member', 'foreign-target', 'persisted-family', 'metadata-family']) {
      const item = fixture(kind); let ticket = { ...item.ticket };
      if (change === 'path-uid') ticket.path = ticket.path.replace(`/${item.uploader}/`, '/foreign-user/');
      if (change === 'path-target') ticket.path = ticket.path.replace('/test-', '/another-');
      if (change === 'path-upload') ticket.path = ticket.path.replace(ticket.id, '00000000-0000-4000-8000-000000000003');
      if (change === 'fresh-member') item.context.rows.get(`members/${item.uploader}`).familyId = 'foreign-family';
      if (change === 'foreign-target') item.context.rows.get(item.targetPath).familyId = 'foreign-family';
      if (change === 'persisted-family') item.context.rows.get(`${collections[kind]}/${ticket.id}`).familyId = 'foreign-family';
      if (change === 'metadata-family') item.context.bucket.objects.get(ticket.path).metadata.metadata.familyId = 'foreign-family';
      await assert.rejects(verifyFunctions[kind](item.context, ticket), change);
      assert.equal(item.context.bucket.objects.get(item.ticket.path).metadata.metadata.firebaseStorageDownloadTokens, 'synthetic-private-token', change);
    }
  });

  test(`${kind}: cleanup does not delete active, attached, unrevoked or unbound tickets`, async () => {
    for (const change of ['open', 'submitted', 'attached', 'no-revocation', 'foreign-ticket', 'no-family', 'legacy-family', 'no-queue', 'foreign-queue', 'queue-uid', 'foreign-uploader', 'foreign-target', 'live-reference']) {
      const item = fixture(kind, { state: 'revoked' }); item.putQueue();
      const persisted = item.context.rows.get(`${collections[kind]}/${item.ticket.id}`);
      if (['open', 'submitted', 'attached'].includes(change)) persisted.state = change;
      if (change === 'no-revocation') delete persisted.revokedAt;
      if (change === 'foreign-ticket') persisted.familyId = 'foreign-family';
      if (change === 'no-family') delete persisted.familyId;
      if (change === 'legacy-family') persisted.familyId = '__legacy__';
      if (change === 'no-queue') item.context.rows.delete(item.queuePath);
      if (change === 'foreign-queue') item.putQueue({ familyId: 'foreign-family' });
      if (change === 'queue-uid') item.putQueue({ uid: 'other-person' });
      if (change === 'foreign-uploader') item.context.rows.get(`members/${item.uploader}`).familyId = 'foreign-family';
      if (change === 'foreign-target') item.context.rows.get(item.targetPath).familyId = 'foreign-family';
      if (change === 'live-reference') item.context.rows.get(item.targetPath)[kind === 'proof' ? 'proofPath' : 'imagePath'] = item.ticket.path;
      assert.equal(await deleteFunctions[kind](item.worker(), item.queue, familyTestNow), false, change);
      assert.equal(item.context.bucket.objects.has(item.ticket.path), true, change);
      assert.equal(item.context.bucket.deletes.length, 0, change);
      assert.equal(item.context.calls.length, 0, change);
    }
  });

  test(`${kind}: caller from a foreign household cannot trigger Storage access or cleanup receipt writes`, async () => {
    const item = fixture(kind, { state: 'revoked' }); item.putQueue();
    const foreign = { ...item.parent(), profile: { ...item.parent().profile, familyId: 'foreign-family' } };
    assert.equal(await deleteFunctions[kind](foreign, item.queue, familyTestNow), false);
    assert.equal(item.fileTouches(), 0);
    assert.equal(item.context.calls.length, 0);
  });

  test(`${kind}: safely revoked detached files are actually deleted and receipts retain household binding`, async () => {
    const item = fixture(kind, { state: 'revoked' }); item.putQueue();
    assert.equal(await deleteFunctions[kind](item.parent(), item.queue, familyTestNow), true);
    assert.equal(item.context.bucket.objects.has(item.ticket.path), false);
    assert.equal(item.context.rows.get(item.queuePath).familyId, 'fixture-family');
    assert.equal(item.context.rows.get(item.queuePath).state, 'deleted');
    assert.equal(item.context.rows.get(item.queuePath).path, undefined);
    assert.equal(item.context.rows.get(`${collections[kind]}/${item.ticket.id}`).path, undefined);
  });

  test(`${kind}: transient deletion retries remain bound to the same persisted household`, async () => {
    const item = fixture(kind, { state: 'revoked' }); item.putQueue(); item.context.bucket.controls.failDeletes = 1;
    assert.equal(await deleteFunctions[kind](item.worker(), item.queue, familyTestNow), false);
    const pending = item.context.rows.get(item.queuePath);
    assert.equal(pending.familyId, 'fixture-family'); assert.equal(pending.attempts, 1);
    assert.equal(item.context.bucket.objects.has(item.ticket.path), true);
    assert.equal(await deleteFunctions[kind](item.worker(), pending, new Date(familyTestNow.getTime() + 3_600_000)), true);
  });
}

test('enqueue and revoke helpers reject missing/legacy/cross-path household tickets and stamp valid jobs', async () => {
  for (const kind of ['proof', 'reward']) {
    for (const change of ['missing', 'legacy', 'bad-path', 'valid']) {
      const item = fixture(kind); const ticket = { ...item.ticket };
      if (change === 'missing') delete ticket.familyId;
      if (change === 'legacy') ticket.familyId = '__legacy__';
      if (change === 'bad-path') ticket.path = ticket.path.replace(ticket.id, '00000000-0000-4000-8000-000000000009');
      await item.context.db.runTransaction(async transaction => {
        if (kind === 'proof') enqueueTaskPhotoCleanup(transaction, item.context.db, ticket, 'abandoned', familyTestNow);
        else revokeRewardImage(transaction, item.context.db, ticket, 'abandoned', familyTestNow);
      });
      assert.equal(item.context.rows.has(item.queuePath), change === 'valid');
      if (change === 'valid') {
        assert.equal(item.context.rows.get(item.queuePath).familyId, 'fixture-family');
        assert.equal(item.context.rows.get(item.queuePath).uid, item.uploader);
      } else assert.equal(item.context.calls.length, 0);
    }
  }
});

test('actorless scheduler removes only expired orphan uploads with validated explicit household identity', async () => {
  for (const kind of ['proof', 'reward']) {
    for (const change of ['valid', 'missing-family', 'foreign-uploader', 'live-reference', 'submitted']) {
      const item = fixture(kind, { target: change === 'live-reference' });
      const persisted = item.context.rows.get(`${collections[kind]}/${item.ticket.id}`);
      if (change === 'missing-family') delete persisted.familyId;
      if (change === 'foreign-uploader') item.context.rows.get(`members/${item.uploader}`).familyId = 'foreign-family';
      if (change === 'live-reference') item.context.rows.get(item.targetPath)[kind === 'proof' ? 'proofUploadId' : 'imageUploadId'] = item.ticket.id;
      if (change === 'submitted') persisted.state = kind === 'proof' ? 'submitted' : 'attached';
      await runTaskPhotoCleanup(item.worker(), { now: familyTestNow });
      assert.equal(item.context.bucket.objects.has(item.ticket.path), change !== 'valid', `${kind}: ${change}`);
      if (change === 'valid') assert.equal(item.context.rows.get(item.queuePath).familyId, 'fixture-family');
      else assert.equal(item.context.calls.length, 0, `${kind}: ${change}`);
    }
  }
});

test('proof verification cannot inspect or revoke tokens after assignment changes to a sibling', async () => {
  const item = fixture('proof');
  const updated = { ...item.ticket, person: 'other-child-person' };
  item.context.rows.get(item.targetPath).person = updated.person;
  item.context.rows.set(`_taskPhotoUploads/${item.ticket.id}`, updated);
  await assert.rejects(verifyTaskPhoto(item.context, updated));
  assert.equal(item.fileTouches(), 0);
});

test('interactive maintenance needs the fresh parent role; background cleanup retains safe inactive-uploader cleanup', async () => {
  const item = fixture('proof'); const parent = item.parent();
  item.context.rows.get('members/parent').role = 'child';
  await runTaskPhotoCleanup(parent, { now: familyTestNow });
  assert.equal(item.context.bucket.objects.has(item.ticket.path), true);
  assert.equal(item.context.calls.length, 0);
  item.context.rows.get('members/child').active = false;
  item.context.rows.get('members/child').canLogin = false;
  await runTaskPhotoCleanup(item.worker(), { now: familyTestNow });
  assert.equal(item.context.bucket.objects.has(item.ticket.path), false);
});
