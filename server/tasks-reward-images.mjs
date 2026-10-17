import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';
import { explicitFamilyId } from './family-identity.mjs';
import { TASK_PHOTO_TYPES, taskPhotoBucket, taskPhotoSignature, validTaskPhotoMetadata,
  taskPhotoActorAllowed, taskPhotoCleanupActorAllowed, taskPhotoObjectBinding, taskPhotoMissingObject } from './tasks-photos.mjs';

const imagePath = /^taskRewardImages\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/([a-f0-9-]{36})\.(jpg|png|webp)$/;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const sameFamily = (left, right) => !!explicitFamilyId(left) && explicitFamilyId(left) === explicitFamilyId(right);
export const rewardImageCleanupId = path => createHash('sha256').update(path).digest('hex');

export function rewardImageTicketBinding(ticket) {
  const match = imagePath.exec(ticket?.path || '');
  return !!match && !!explicitFamilyId(ticket) && identifier(ticket.uid) && identifier(ticket.rewardId) && uuid(ticket.id)
    && match[1] === ticket.rewardId && match[2] === ticket.uid && match[3] === ticket.id
    && match[4] === TASK_PHOTO_TYPES[ticket.contentType] && validTaskPhotoMetadata(ticket.contentType, ticket.size);
}

/** An illustration may be verified only by its active parent uploader, in its own household. */
export async function verifyRewardImage(context, ticket) {
  if (!rewardImageTicketBinding(ticket)) {
    throw new EduServerError('TASK_REWARD_IMAGE_INVALID', 400, 'Wybierz zdjęcie nagrody JPG, PNG lub WebP do 8 MB.');
  }
  if (!['open', 'attached'].includes(ticket.state) || context.profile?.role !== 'parent' || !await taskPhotoActorAllowed(context, ticket)) {
    throw new EduServerError('TASK_REWARD_IMAGE_FORBIDDEN', 403, 'To zdjęcie nie należy do Twojego gospodarstwa.');
  }
  const [actor, reward, persisted] = await Promise.all([
    context.db.collection('members').doc(context.uid).get(), context.db.collection('taskRewards').doc(ticket.rewardId).get(),
    context.db.collection('_taskRewardImageUploads').doc(ticket.id).get(),
  ]);
  const current = persisted.exists ? { ...persisted.data(), id: persisted.id } : null;
  if (!rewardImageTicketBinding(current) || !sameFamily(current, ticket) || current.path !== ticket.path
    || current.size !== ticket.size || current.state !== ticket.state || actor.data()?.role !== 'parent' || reward.exists && !sameFamily(reward.data(), ticket)) {
    throw new EduServerError('TASK_REWARD_IMAGE_FORBIDDEN', 403, 'Nie potwierdzono przypisania zdjęcia do nagrody.');
  }
  try {
    const file = taskPhotoBucket(context).file(ticket.path);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== ticket.size || metadata.contentType !== ticket.contentType
      || !taskPhotoObjectBinding(metadata, ticket, 'rewardId')) throw new Error('metadata');
    const [head] = await file.download({ start: 0, end: 15 });
    if (!taskPhotoSignature(head, ticket.contentType)) throw new Error('signature');
    if (metadata.metadata?.firebaseStorageDownloadTokens) {
      await file.setMetadata({ metadata: { ...metadata.metadata, firebaseStorageDownloadTokens: null } });
    }
    const [confirmed] = await file.getMetadata();
    if (confirmed.metadata?.firebaseStorageDownloadTokens || Number(confirmed.size) !== ticket.size
      || confirmed.contentType !== ticket.contentType || !taskPhotoObjectBinding(confirmed, ticket, 'rewardId')
      || metadata.generation && String(confirmed.generation) !== String(metadata.generation)
      || !await taskPhotoActorAllowed(context, ticket)) throw new Error('finalization');
  } catch (error) {
    if (error instanceof EduServerError) throw error;
    throw new EduServerError('TASK_REWARD_IMAGE_INCOMPLETE', 409, 'Nie potwierdzono poprawnego przesłania zdjęcia nagrody. Spróbuj ponownie.');
  }
}

export function revokeRewardImage(transaction, db, ticket, reason, now = new Date()) {
  if (!rewardImageTicketBinding(ticket)) return;
  transaction.update(db.collection('_taskRewardImageUploads').doc(ticket.id), {
    familyId: ticket.familyId, state: 'revoked', revokedAt: FieldValue.serverTimestamp(),
  });
  transaction.set(db.collection('_taskRewardImageCleanup').doc(rewardImageCleanupId(ticket.path)), {
    path: ticket.path, uploadId: ticket.id, rewardId: ticket.rewardId, uid: ticket.uid, familyId: ticket.familyId,
    reason, state: 'pending', attempts: 0, nextAttemptAt: Timestamp.fromDate(now), createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function deleteQueuedRewardImage(context, job, now = new Date()) {
  if (!job?.path || !imagePath.test(job.path) || !uuid(job.uploadId) || !explicitFamilyId(job)
    || context.profile && !sameFamily(context.profile, job)) return false;
  const ref = context.db.collection('_taskRewardImageCleanup').doc(rewardImageCleanupId(job.path));
  let ticket;
  try {
    const [upload, cleanup] = await Promise.all([
      context.db.collection('_taskRewardImageUploads').doc(job.uploadId).get(), ref.get(),
    ]);
    const queue = cleanup.exists ? cleanup.data() : null;
    ticket = upload.exists ? { ...upload.data(), id: upload.id } : null;
    if (!queue || queue.state !== 'pending' || !rewardImageTicketBinding(ticket) || ticket.state !== 'revoked'
      || !ticket.revokedAt || !sameFamily(ticket, queue) || !sameFamily(job, queue)
      || job.path !== ticket.path || queue.path !== ticket.path || queue.uploadId !== ticket.id
      || queue.rewardId !== ticket.rewardId || queue.uid !== ticket.uid
      || job.rewardId !== ticket.rewardId || job.uid !== ticket.uid) return false;
    const [uploader, reward] = await Promise.all([
      context.db.collection('members').doc(ticket.uid).get(), context.db.collection('taskRewards').doc(ticket.rewardId).get(),
    ]);
    if (!uploader.exists || !sameFamily(uploader.data(), ticket) || !reward.exists && queue.reason !== 'abandoned'
      || reward.exists && (!sameFamily(reward.data(), ticket) || reward.data().imagePath === ticket.path || reward.data().imageUploadId === ticket.id)) return false;
    if (context.profile) {
      const actor = await context.db.collection('members').doc(context.uid).get();
      if (!actor.exists || actor.data().active !== true || actor.data().canLogin !== true || actor.data().archived === true
        || actor.data().role !== 'parent' || !sameFamily(actor.data(), ticket)) return false;
    }
  } catch { return false; }
  try {
    const file = taskPhotoBucket(context).file(ticket.path);
    let metadata;
    try { [metadata] = await file.getMetadata(); } catch (error) { if (!taskPhotoMissingObject(error)) throw error; }
    if (metadata && !taskPhotoObjectBinding(metadata, ticket, 'rewardId')) return false;
    if (metadata) await file.delete({ ignoreNotFound: true, ...(metadata.generation ? { ifGenerationMatch: metadata.generation } : {}) });
    const batch = context.db.batch();
    batch.set(ref, { familyId: ticket.familyId, state: 'deleted', path: FieldValue.delete(), deletedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(context.db.collection('_taskRewardImageUploads').doc(ticket.id), {
      familyId: ticket.familyId, state: 'deleted', path: FieldValue.delete(), deletedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return true;
  } catch {
    const attempts = Math.min(30, Number(job.attempts || 0) + 1);
    await ref.set({ familyId: ticket.familyId, attempts, state: 'pending', lastErrorCode: 'TASK_REWARD_IMAGE_DELETE_FAILED',
      nextAttemptAt: Timestamp.fromMillis(now.getTime() + Math.min(86_400_000, 60_000 * 2 ** Math.min(attempts, 10))),
      updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return false;
  }
}

/** Only unattached, expired and fully bound uploads enter the existing maintenance queue. */
export async function runTaskRewardImageCleanup(context, { now = new Date(), limit = 100 } = {}) {
  if (!await taskPhotoCleanupActorAllowed(context)) return { abandoned: 0, attempted: 0, deleted: 0, retry: 0 };
  const count = Math.min(200, Math.max(1, Number(limit) || 100));
  const uploads = context.db.collection('_taskRewardImageUploads');
  const scopedUploads = context.profile ? uploads.where('familyId', '==', explicitFamilyId(context.profile)) : uploads;
  const stale = await scopedUploads.where('state', '==', 'open')
    .where('orphanAfter', '<=', Timestamp.fromDate(now)).limit(count).get();
  let abandoned = 0;
  for (const item of stale.docs) {
    const revoked = await context.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(item.ref);
      const ticket = snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
      if (!rewardImageTicketBinding(ticket) || ticket.state !== 'open' || !Number.isFinite(ticket.orphanAfter?.toMillis())
        || ticket.orphanAfter.toMillis() > now.getTime() || context.profile && !sameFamily(context.profile, ticket)) return false;
      const reward = await transaction.get(context.db.collection('taskRewards').doc(ticket.rewardId));
      const member = await transaction.get(context.db.collection('members').doc(ticket.uid));
      if (!member.exists || !sameFamily(member.data(), ticket) || reward.exists && (!sameFamily(reward.data(), ticket)
        || reward.data().imagePath === ticket.path || reward.data().imageUploadId === ticket.id)) return false;
      revokeRewardImage(transaction, context.db, ticket, 'abandoned', now);
      return true;
    });
    if (revoked) abandoned += 1;
  }
  const cleanup = context.db.collection('_taskRewardImageCleanup');
  const scopedCleanup = context.profile ? cleanup.where('familyId', '==', explicitFamilyId(context.profile)) : cleanup;
  const jobs = await scopedCleanup.where('state', '==', 'pending')
    .where('nextAttemptAt', '<=', Timestamp.fromDate(now)).limit(count).get();
  let deleted = 0;
  for (const item of jobs.docs) if (await deleteQueuedRewardImage(context, item.data(), now)) deleted += 1;
  return { abandoned, attempted: jobs.size, deleted, retry: jobs.size - deleted };
}
