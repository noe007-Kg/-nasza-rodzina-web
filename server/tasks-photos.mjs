import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { EduServerError } from './edu-auth.mjs';
import { explicitFamilyId } from './family-identity.mjs';

export const TASK_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const TASK_PHOTO_TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const proofPath = /^taskProof\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/([a-f0-9-]{36})\.(jpg|png|webp)$/;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const sameFamily = (left, right) => !!explicitFamilyId(left) && explicitFamilyId(left) === explicitFamilyId(right);
const activeActor = member => member?.active === true && member.canLogin === true && member.archived !== true && member.disabled !== true
  && ['parent', 'adult', 'child'].includes(member.role);

/** The legacy object path remains valid only when every segment is bound to the private ticket. */
export function taskPhotoTicketBinding(ticket) {
  const match = proofPath.exec(ticket?.path || '');
  return !!match && !!explicitFamilyId(ticket) && identifier(ticket.uid) && identifier(ticket.taskId) && uuid(ticket.id)
    && match[1] === ticket.taskId && match[2] === ticket.uid && match[3] === ticket.id
    && match[4] === TASK_PHOTO_TYPES[ticket.contentType] && validTaskPhotoMetadata(ticket.contentType, ticket.size);
}

/** Interactive byte verification cannot act on another household or a stale login. */
export async function taskPhotoActorAllowed(context, ticket) {
  if (!identifier(context.uid) || !activeActor(context.profile) || !sameFamily(context.profile, ticket) || context.uid !== ticket.uid) return false;
  const snapshot = await context.db.collection('members').doc(context.uid).get();
  return snapshot.exists && activeActor(snapshot.data()) && sameFamily(snapshot.data(), ticket);
}

export async function taskPhotoCleanupActorAllowed(context) {
  if (!context.profile) return true; // Trusted scheduled server invocation.
  if (!identifier(context.uid) || !activeActor(context.profile) || context.profile.role !== 'parent' || !explicitFamilyId(context.profile)) return false;
  const snapshot = await context.db.collection('members').doc(context.uid).get();
  return snapshot.exists && activeActor(snapshot.data()) && snapshot.data().role === 'parent' && sameFamily(snapshot.data(), context.profile);
}

export function taskPhotoObjectBinding(metadata, ticket, targetKey = 'taskId') {
  return metadata.metadata?.[targetKey] === ticket[targetKey] && metadata.metadata?.uploadId === ticket.id
    && metadata.metadata?.uploaderUid === ticket.uid
    && (!Object.hasOwn(metadata.metadata || {}, 'familyId') || sameFamily(metadata.metadata, ticket));
}

export function taskPhotoMissingObject(error) { return [404, '404', 'NOT_FOUND'].includes(error?.code) || error?.message === 'NOT_FOUND'; }

export function taskPhotoBucket(context) {
  if (context.bucket) return context.bucket;
  const name = process.env.FIREBASE_STORAGE_BUCKET || context.app?.options?.storageBucket;
  if (!name || typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,221}[a-z0-9]$/.test(name)) {
    throw new EduServerError('TASK_STORAGE_NOT_CONFIGURED', 503, 'Zdjęcia zadań wymagają skonfigurowania chronionego magazynu przez administratora.');
  }
  return getStorage(context.app).bucket(name);
}

export function validTaskPhotoMetadata(type, size) {
  return Object.hasOwn(TASK_PHOTO_TYPES, type || '') && Number.isInteger(size) && size > 0 && size <= TASK_PHOTO_MAX_BYTES;
}

export function taskPhotoSignature(bytes, type) {
  if (!Buffer.isBuffer(bytes)) return false;
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return type === 'image/webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

/** Validation happens before a submission can become eligible for approval. */
export async function verifyTaskPhoto(context, ticket) {
  if (!taskPhotoTicketBinding(ticket)) {
    throw new EduServerError('TASK_PHOTO_INVALID', 400, 'Zdjęcie zgłoszenia ma nieprawidłowy format. Dodaj je ponownie.');
  }
  if (!['open', 'submitted'].includes(ticket.state) || !await taskPhotoActorAllowed(context, ticket)) throw new EduServerError('TASK_PHOTO_FORBIDDEN', 403, 'To zdjęcie nie należy do Twojego gospodarstwa.');
  const [persisted, task, actor] = await Promise.all([context.db.collection('_taskPhotoUploads').doc(ticket.id).get(), context.db.collection('tasks').doc(ticket.taskId).get(), context.db.collection('members').doc(context.uid).get()]);
  const current = persisted.exists ? { ...persisted.data(), id: persisted.id } : null;
  if (!taskPhotoTicketBinding(current) || !sameFamily(current, ticket) || current.path !== ticket.path
    || current.state !== ticket.state || current.person !== ticket.person || current.size !== ticket.size || !task.exists || !sameFamily(task.data(), ticket) || task.data().person !== ticket.person || !actor.exists || !sameFamily(actor.data(), ticket)
    || actor.data().role !== 'parent' && task.data().person !== 'family' && task.data().person !== String(actor.data().personKey || actor.data().name || '')) {
    throw new EduServerError('TASK_PHOTO_FORBIDDEN', 403, 'Nie potwierdzono przypisania zdjęcia do zadania.');
  }
  try {
    const file = taskPhotoBucket(context).file(ticket.path);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== ticket.size || metadata.contentType !== ticket.contentType
      || !taskPhotoObjectBinding(metadata, ticket)) throw new Error('metadata');
    const [head] = await file.download({ start: 0, end: 15 });
    if (!taskPhotoSignature(head, ticket.contentType)) throw new Error('signature');
    // An approval photo is not a public download-link document. Revoke any
    // Firebase bearer download token generated during the resumable upload.
    if (metadata.metadata?.firebaseStorageDownloadTokens) {
      await file.setMetadata({ metadata: { ...metadata.metadata, firebaseStorageDownloadTokens: null } });
    }
    const [confirmed] = await file.getMetadata();
    if (confirmed.metadata?.firebaseStorageDownloadTokens || Number(confirmed.size) !== ticket.size
      || confirmed.contentType !== ticket.contentType || !taskPhotoObjectBinding(confirmed, ticket)
      || metadata.generation && String(confirmed.generation) !== String(metadata.generation)
      || !await taskPhotoActorAllowed(context, ticket)) throw new Error('finalization');
  } catch (error) {
    if (error instanceof EduServerError) throw error;
    throw new EduServerError('TASK_PHOTO_INCOMPLETE', 409, 'Nie potwierdzono pełnego przesłania poprawnego zdjęcia. Prześlij zdjęcie ponownie.');
  }
}

export function taskPhotoCleanupId(path) { return createHash('sha256').update(path).digest('hex'); }

export function enqueueTaskPhotoCleanup(transaction, db, ticket, reason, now = new Date()) {
  if (!taskPhotoTicketBinding(ticket)) return;
  const ref = db.collection('_taskPhotoCleanup').doc(taskPhotoCleanupId(ticket.path));
  transaction.set(ref, { path: ticket.path, uploadId: ticket.id, taskId: ticket.taskId, uid: ticket.uid,
    familyId: explicitFamilyId(ticket), reason, attempts: 0, state: 'pending',
    nextAttemptAt: Timestamp.fromDate(now), createdAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** A persisted revoked ticket, a matching private queue and detached task are required before deletion. */
export async function deleteQueuedTaskPhoto(context, job, now = new Date()) {
  const uploadId = job?.uploadId || job?.id;
  if (!uuid(uploadId) || !proofPath.test(job?.path || '') || !explicitFamilyId(job)
    || context.profile && !sameFamily(context.profile, job)) return false;
  const cleanupRef = context.db.collection('_taskPhotoCleanup').doc(taskPhotoCleanupId(job.path));
  let ticket;
  try {
    const [queueSnapshot, uploadSnapshot] = await Promise.all([
      cleanupRef.get(), context.db.collection('_taskPhotoUploads').doc(uploadId).get(),
    ]);
    const queue = queueSnapshot.exists ? queueSnapshot.data() : null;
    ticket = uploadSnapshot.exists ? { ...uploadSnapshot.data(), id: uploadSnapshot.id } : null;
    if (!queue || queue.state !== 'pending' || !taskPhotoTicketBinding(ticket) || ticket.state !== 'revoked'
      || !ticket.revokedAt || !sameFamily(job, queue) || !sameFamily(ticket, queue)
      || queue.path !== ticket.path || job.path !== ticket.path || queue.uploadId !== ticket.id
      || queue.taskId !== ticket.taskId || queue.uid !== ticket.uid
      || job.taskId !== ticket.taskId || job.uid !== ticket.uid) return false;
    const [member, task] = await Promise.all([
      context.db.collection('members').doc(ticket.uid).get(), context.db.collection('tasks').doc(ticket.taskId).get(),
    ]);
    if (!member.exists || !sameFamily(member.data(), ticket) || !task.exists && queue.reason !== 'abandoned'
      || task.exists && (!sameFamily(task.data(), ticket) || task.data().proofPath === ticket.path || task.data().proofUploadId === ticket.id)) return false;
    if (context.profile) {
      const actor = await context.db.collection('members').doc(context.uid).get();
      if (!actor.exists || !activeActor(actor.data()) || actor.data().role !== 'parent' || !sameFamily(actor.data(), ticket)) return false;
    }
  } catch { return false; }
  try {
    const file = taskPhotoBucket(context).file(ticket.path);
    let metadata;
    try { [metadata] = await file.getMetadata(); } catch (error) { if (!taskPhotoMissingObject(error)) throw error; }
    if (metadata && !taskPhotoObjectBinding(metadata, ticket)) return false;
    if (metadata) await file.delete({ ignoreNotFound: true, ...(metadata.generation ? { ifGenerationMatch: metadata.generation } : {}) });
    const batch = context.db.batch();
    batch.set(cleanupRef, { familyId: ticket.familyId, state: 'deleted', path: FieldValue.delete(), deletedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(context.db.collection('_taskPhotoUploads').doc(ticket.id), {
      familyId: ticket.familyId, state: 'deleted', path: FieldValue.delete(), deletedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return true;
  } catch {
    const attempts = Math.min(30, Number(job.attempts || 0) + 1);
    const delay = Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(attempts, 10));
    await cleanupRef.set({ familyId: ticket.familyId, attempts, state: 'pending', lastErrorCode: 'TASK_PHOTO_DELETE_FAILED',
      nextAttemptAt: Timestamp.fromMillis(now.getTime() + delay), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return false;
  }
}

/** Background work has no actor; each persisted identity is validated independently. */
export async function runTaskPhotoCleanup(context, { now = new Date(), limit = 100 } = {}) {
  if (!await taskPhotoCleanupActorAllowed(context)) return { abandoned: 0, attempted: 0, deleted: 0, retry: 0, rewardImages: { abandoned: 0, attempted: 0, deleted: 0, retry: 0 } };
  const count = Math.min(200, Math.max(1, Number(limit) || 100));
  const uploads = context.db.collection('_taskPhotoUploads');
  const scopedUploads = context.profile ? uploads.where('familyId', '==', explicitFamilyId(context.profile)) : uploads;
  const stale = await scopedUploads.where('state', '==', 'open')
    .where('orphanAfter', '<=', Timestamp.fromDate(now)).limit(count).get();
  let abandoned = 0;
  for (const item of stale.docs) {
    const revoked = await context.db.runTransaction(async transaction => {
      const latest = await transaction.get(item.ref);
      const ticket = latest.exists ? { ...latest.data(), id: latest.id } : null;
      if (!taskPhotoTicketBinding(ticket) || ticket.state !== 'open' || !Number.isFinite(ticket.orphanAfter?.toMillis())
        || ticket.orphanAfter.toMillis() > now.getTime() || context.profile && !sameFamily(context.profile, ticket)) return false;
      const task = await transaction.get(context.db.collection('tasks').doc(ticket.taskId));
      const member = await transaction.get(context.db.collection('members').doc(ticket.uid));
      if (!member.exists || !sameFamily(member.data(), ticket) || task.exists && (!sameFamily(task.data(), ticket)
        || task.data().proofPath === ticket.path || task.data().proofUploadId === ticket.id)) return false;
      transaction.update(item.ref, { familyId: ticket.familyId, state: 'revoked', revokedAt: FieldValue.serverTimestamp() });
      enqueueTaskPhotoCleanup(transaction, context.db, ticket, 'abandoned', now);
      return true;
    });
    if (revoked) abandoned += 1;
  }
  const cleanup = context.db.collection('_taskPhotoCleanup');
  const scopedCleanup = context.profile ? cleanup.where('familyId', '==', explicitFamilyId(context.profile)) : cleanup;
  const jobs = await scopedCleanup.where('state', '==', 'pending')
    .where('nextAttemptAt', '<=', Timestamp.fromDate(now)).limit(count).get();
  let deleted = 0;
  for (const item of jobs.docs) if (await deleteQueuedTaskPhoto(context, item.data(), now)) deleted += 1;
  const { runTaskRewardImageCleanup } = await import('./tasks-reward-images.mjs');
  const rewardImages = await runTaskRewardImageCleanup(context, { now, limit: count });
  return { abandoned, attempted: jobs.size, deleted, retry: jobs.size - deleted, rewardImages };
}
