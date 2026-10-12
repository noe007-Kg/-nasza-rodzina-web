import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';
import { taskPhotoBucket, taskPhotoSignature, validTaskPhotoMetadata } from './tasks-photos.mjs';

const imagePath = /^taskRewardImages\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[a-f0-9-]{36}\.(jpg|png|webp)$/;
export const rewardImageCleanupId = path => createHash('sha256').update(path).digest('hex');

/** Reward illustrations are permanent while attached. They never enter the task-proof queue. */
export async function verifyRewardImage(context, ticket) {
  if (!imagePath.test(ticket?.path || '') || !validTaskPhotoMetadata(ticket.contentType, ticket.size)) {
    throw new EduServerError('TASK_REWARD_IMAGE_INVALID', 400, 'Wybierz zdjęcie nagrody JPG, PNG lub WebP do 8 MB.');
  }
  try {
    const file = taskPhotoBucket(context).file(ticket.path);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== ticket.size || metadata.contentType !== ticket.contentType
      || metadata.metadata?.rewardId !== ticket.rewardId || metadata.metadata?.uploadId !== ticket.id
      || metadata.metadata?.uploaderUid !== ticket.uid) throw new Error('metadata');
    const [head] = await file.download({ start: 0, end: 15 });
    if (!taskPhotoSignature(head, ticket.contentType)) throw new Error('signature');
    // Storage Rules authorize reads, so bearer download URLs must not bypass them.
    if (metadata.metadata?.firebaseStorageDownloadTokens) {
      await file.setMetadata({ metadata: { ...metadata.metadata, firebaseStorageDownloadTokens: null } });
    }
  } catch (error) {
    if (error instanceof EduServerError) throw error;
    throw new EduServerError('TASK_REWARD_IMAGE_INCOMPLETE', 409, 'Nie potwierdzono poprawnego przesłania zdjęcia nagrody. Spróbuj ponownie.');
  }
}

export function revokeRewardImage(transaction, db, ticket, reason, now) {
  if (!ticket?.path || !imagePath.test(ticket.path)) return;
  transaction.update(db.collection('_taskRewardImageUploads').doc(ticket.id), { state: 'revoked', revokedAt: FieldValue.serverTimestamp() });
  transaction.set(db.collection('_taskRewardImageCleanup').doc(rewardImageCleanupId(ticket.path)), {
    path: ticket.path, uploadId: ticket.id, rewardId: ticket.rewardId, reason, state: 'pending', attempts: 0,
    nextAttemptAt: Timestamp.fromDate(now), createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function deleteQueuedRewardImage(context, job, now = new Date()) {
  if (!job?.path || !imagePath.test(job.path) || typeof job.uploadId !== 'string') return false;
  const ref = context.db.collection('_taskRewardImageCleanup').doc(rewardImageCleanupId(job.path));
  try {
    // An attached illustration is never disposable, including during approval of a reward.
    const ticket = await context.db.collection('_taskRewardImageUploads').doc(job.uploadId).get();
    if (ticket.exists && ticket.data().state === 'attached') return false;
    await taskPhotoBucket(context).file(job.path).delete({ ignoreNotFound: true });
    const batch = context.db.batch();
    batch.set(ref, { state: 'deleted', path: FieldValue.delete(), deletedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(context.db.collection('_taskRewardImageUploads').doc(job.uploadId), {
      state: 'deleted', path: FieldValue.delete(), deletedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return true;
  } catch {
    const attempts = Math.min(30, Number(job.attempts || 0) + 1);
    await ref.set({ attempts, state: 'pending', lastErrorCode: 'TASK_REWARD_IMAGE_DELETE_FAILED',
      nextAttemptAt: Timestamp.fromMillis(now.getTime() + Math.min(86_400_000, 60_000 * 2 ** Math.min(attempts, 10))),
      updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return false;
  }
}

/** Reuses the existing task-photo hourly maintenance job; only open orphan uploads expire. */
export async function runTaskRewardImageCleanup(context, { now = new Date(), limit = 100 } = {}) {
  const count = Math.min(200, Math.max(1, Number(limit) || 100));
  const stale = await context.db.collection('_taskRewardImageUploads').where('state', '==', 'open')
    .where('orphanAfter', '<=', Timestamp.fromDate(now)).limit(count).get();
  for (const item of stale.docs) {
    await context.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(item.ref);
      const ticket = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
      if (!ticket || ticket.state !== 'open' || ticket.orphanAfter?.toMillis() > now.getTime()) return;
      revokeRewardImage(transaction, context.db, ticket, 'abandoned', now);
    });
  }
  const jobs = await context.db.collection('_taskRewardImageCleanup').where('state', '==', 'pending')
    .where('nextAttemptAt', '<=', Timestamp.fromDate(now)).limit(count).get();
  let deleted = 0;
  for (const item of jobs.docs) if (await deleteQueuedRewardImage(context, item.data(), now)) deleted += 1;
  return { abandoned: stale.size, attempted: jobs.size, deleted, retry: jobs.size - deleted };
}
