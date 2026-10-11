import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { EduServerError } from './edu-auth.mjs';

export const TASK_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const TASK_PHOTO_TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const proofPath = /^taskProof\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[a-f0-9-]{36}\.(jpg|png|webp)$/;

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
  if (!proofPath.test(ticket.path || '') || !validTaskPhotoMetadata(ticket.contentType, ticket.size)) {
    throw new EduServerError('TASK_PHOTO_INVALID', 400, 'Zdjęcie zgłoszenia ma nieprawidłowy format. Dodaj je ponownie.');
  }
  try {
    const file = taskPhotoBucket(context).file(ticket.path);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== ticket.size || metadata.contentType !== ticket.contentType
      || metadata.metadata?.taskId !== ticket.taskId || metadata.metadata?.uploadId !== ticket.id
      || metadata.metadata?.uploaderUid !== ticket.uid) throw new Error('metadata');
    const [head] = await file.download({ start: 0, end: 15 });
    if (!taskPhotoSignature(head, ticket.contentType)) throw new Error('signature');
    // An approval photo is not a public download-link document. Revoke any
    // Firebase bearer download token generated during the resumable upload.
    if (metadata.metadata?.firebaseStorageDownloadTokens) {
      await file.setMetadata({ metadata: { ...metadata.metadata, firebaseStorageDownloadTokens: null } });
    }
  } catch (error) {
    if (error instanceof EduServerError) throw error;
    throw new EduServerError('TASK_PHOTO_INCOMPLETE', 409, 'Nie potwierdzono pełnego przesłania poprawnego zdjęcia. Prześlij zdjęcie ponownie.');
  }
}

export function taskPhotoCleanupId(path) { return createHash('sha256').update(path).digest('hex'); }

export function enqueueTaskPhotoCleanup(transaction, db, ticket, reason, now = new Date()) {
  if (!ticket?.path || !proofPath.test(ticket.path)) return;
  const ref = db.collection('_taskPhotoCleanup').doc(taskPhotoCleanupId(ticket.path));
  transaction.set(ref, { path: ticket.path, uploadId: ticket.id, taskId: ticket.taskId, reason,
    attempts: 0, state: 'pending', nextAttemptAt: Timestamp.fromDate(now), createdAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Deletion is real Storage deletion; a missing object already satisfies it. */
export async function deleteQueuedTaskPhoto(context, job, now = new Date()) {
  if (!job?.path || !proofPath.test(job.path)) return false;
  const cleanupRef = context.db.collection('_taskPhotoCleanup').doc(taskPhotoCleanupId(job.path));
  try {
    await taskPhotoBucket(context).file(job.path).delete({ ignoreNotFound: true });
    // No live task keeps an attachment after approval/rework. The ticket is
    // retained as a small deletion receipt, without a usable file reference.
    const batch = context.db.batch();
    batch.set(cleanupRef, { state: 'deleted', path: FieldValue.delete(), deletedAt: FieldValue.serverTimestamp() }, { merge: true });
    const uploadId = job.uploadId || job.id;
    if (typeof uploadId === 'string' && /^[a-f0-9-]{36}$/.test(uploadId)) batch.set(context.db.collection('_taskPhotoUploads').doc(uploadId), {
      state: 'deleted', path: FieldValue.delete(), deletedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return true;
  } catch {
    const attempts = Math.min(30, Number(job.attempts || 0) + 1);
    const delay = Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(attempts, 10));
    await cleanupRef.set({ attempts, state: 'pending', lastErrorCode: 'TASK_PHOTO_DELETE_FAILED',
      nextAttemptAt: Timestamp.fromMillis(now.getTime() + delay), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return false;
  }
}

/** Run from one Gen2 hourly job. Queries are bounded, no credentials are logged. */
export async function runTaskPhotoCleanup(context, { now = new Date(), limit = 100 } = {}) {
  const count = Math.min(200, Math.max(1, Number(limit) || 100));
  const stale = await context.db.collection('_taskPhotoUploads').where('state', '==', 'open')
    .where('orphanAfter', '<=', Timestamp.fromDate(now)).limit(count).get();
  for (const item of stale.docs) {
    await context.db.runTransaction(async transaction => {
      const latest = await transaction.get(item.ref);
      const ticket = latest.exists ? { id: latest.id, ...latest.data() } : null;
      if (!ticket || ticket.state !== 'open' || ticket.orphanAfter?.toMillis() > now.getTime()) return;
      transaction.update(item.ref, { state: 'revoked', revokedAt: FieldValue.serverTimestamp() });
      enqueueTaskPhotoCleanup(transaction, context.db, ticket, 'abandoned', now);
    });
  }
  const jobs = await context.db.collection('_taskPhotoCleanup').where('state', '==', 'pending')
    .where('nextAttemptAt', '<=', Timestamp.fromDate(now)).limit(count).get();
  let deleted = 0;
  for (const item of jobs.docs) if (await deleteQueuedTaskPhoto(context, item.data(), now)) deleted += 1;
  return { abandoned: stale.size, attempted: jobs.size, deleted, retry: jobs.size - deleted };
}
