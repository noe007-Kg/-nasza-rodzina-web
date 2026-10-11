import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { EduServerError } from './edu-auth.mjs';
import { activeHealthMember, activeHealthProfile, canManageHealthOwner, HEALTH_DOCUMENT_MAX_BYTES,
  HEALTH_DOCUMENT_MIME_TYPES, normalizeHealthDocumentMetadata, validHealthFileHeader } from './health-access.mjs';

const fail = (code = 'HEALTH_FORBIDDEN', status = 403) => { throw new EduServerError(code, status,
  code === 'HEALTH_FORBIDDEN' ? 'Brak upoważnienia do tej kartoteki. W przypadku osoby dorosłej potrzebna jest jej zgoda lub potwierdzone umocowanie prawne.' : 'Nie udało się zapisać dokumentu. Spróbuj ponownie.'); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const stamp = () => FieldValue.serverTimestamp();
export function healthStorageBucket(context) {
  if (context.bucket) return context.bucket;
  const projectId = context.app?.options?.projectId || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  const bucket = process.env.FIREBASE_STORAGE_BUCKET || context.app?.options?.storageBucket
    || (projectId ? `${projectId}.firebasestorage.app` : '');
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{2,220}$/.test(bucket)) fail('HEALTH_NOT_CONFIGURED', 503);
  return getStorage(context.app).bucket(bucket);
}

/** Fresh authorization participates in the same transaction as each document write. */
async function ownerContext(transaction, context, ownerProfileId) {
  if (!identifier(ownerProfileId)) fail('HEALTH_INVALID_DOCUMENT', 400);
  const refs = [context.db.collection('members').doc(context.uid), context.db.collection('members').doc(ownerProfileId),
    context.db.collection('healthDocumentGrants').doc(ownerProfileId)];
  const [actorSnapshot, ownerSnapshot, grantSnapshot] = await transaction.getAll(...refs);
  const actor = actorSnapshot.exists ? { ...actorSnapshot.data(), id: context.uid } : null;
  const owner = ownerSnapshot.exists ? { ...ownerSnapshot.data(), id: ownerProfileId } : null;
  if (!activeHealthMember(actor) || !activeHealthProfile(owner)
    || actor.familyId && owner.familyId && actor.familyId !== owner.familyId
    || !canManageHealthOwner(actor, owner, grantSnapshot.data(), context.now || new Date())) fail();
  return { actor, owner, grant: grantSnapshot.data(), grantRef: refs[2] };
}

async function documentContext(transaction, context, documentId) {
  if (!identifier(documentId)) fail('HEALTH_INVALID_DOCUMENT', 400);
  const ref = context.db.collection('healthDocuments').doc(documentId);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) fail('HEALTH_DOCUMENT_NOT_FOUND', 404);
  const record = snapshot.data();
  if (!Array.isArray(record.editors) || !record.editors.includes(context.uid)) fail();
  const permission = await ownerContext(transaction, context, record.ownerProfileId);
  return { ...permission, ref, record };
}

function documentReaders(record, metadata) {
  const editors = [...new Set(record.editors || [])];
  const readers = [...new Set([...(record.readers || []).filter(uid => uid !== record.ownerUid || editors.includes(uid)), ...editors,
    ...(metadata.shareOwner && record.ownerUid ? [record.ownerUid] : [])])];
  return readers;
}

async function prepareDocument(context, body) {
  const metadata = normalizeHealthDocumentMetadata(body.metadata);
  if (!HEALTH_DOCUMENT_MIME_TYPES.includes(body.mimeType) || !Number.isInteger(body.size) || body.size <= 0
    || body.size > HEALTH_DOCUMENT_MAX_BYTES || typeof body.fileName !== 'string' || body.fileName.length > 250) fail('HEALTH_INVALID_DOCUMENT', 400);
  const documentId = randomUUID();
  const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[body.mimeType];
  const storagePath = `healthDocuments/${documentId}/${context.uid}/${randomUUID()}.${extension}`;
  await context.db.runTransaction(async transaction => {
    const { owner } = await ownerContext(transaction, context, body.ownerProfileId);
    const ownerUid = owner.canLogin === true ? owner.id : null;
    const record = { ...metadata, ownerProfileId: owner.id, ownerUid, ownerPersonKey: owner.personKey || owner.name || owner.id,
      readers: [...new Set([context.uid, ...(metadata.shareOwner && ownerUid ? [ownerUid] : [])])], editors: [context.uid],
      createdBy: context.uid, state: 'draft', protected: true, storagePath, mimeType: body.mimeType, size: body.size,
      fileName: body.fileName.replace(/[\u0000-\u001f/\\]/g, '-'), createdAt: stamp(), updatedAt: stamp(),
      uploadExpiresAt: Timestamp.fromMillis((context.now || new Date()).getTime() + 3600000) };
    transaction.create(context.db.collection('healthDocuments').doc(documentId), record);
  });
  return { documentId, storagePath };
}

async function saveDocument(context, body) {
  const target = context.db.collection('healthDocuments').doc(identifier(body.documentId) ? body.documentId : 'invalid');
  const snapshot = await target.get();
  const record = snapshot.data();
  if (!record || record.createdBy !== context.uid || !record.editors?.includes(context.uid)
    || !['draft', 'ready'].includes(record.state)) fail();
  if (record.state === 'ready') return { documentId: snapshot.id, state: 'ready' };
  const file = healthStorageBucket(context).file(record.storagePath);
  let actual;
  try { [actual] = await file.getMetadata(); }
  catch { fail('HEALTH_FILE_NOT_READY', 409); }
  if (Number(actual.size) !== record.size || actual.contentType !== record.mimeType) fail('HEALTH_INVALID_FILE', 400);
  const [header] = await file.download({ start: 0, end: 15 });
  if (!validHealthFileHeader(record.mimeType, header)) fail('HEALTH_INVALID_FILE', 400);
  // Protected files are accessed using authenticated Storage rules, never a public bearer URL.
  await file.setMetadata({ metadata: { ...(actual.metadata || {}), firebaseStorageDownloadTokens: null } });
  await context.db.runTransaction(async transaction => {
    const current = await documentContext(transaction, context, body.documentId);
    if (current.record.state === 'ready') return;
    if (current.record.state !== 'draft' || current.record.storagePath !== record.storagePath) fail('HEALTH_INVALID_DOCUMENT', 409);
    transaction.update(current.ref, { state: 'ready', uploadedAt: stamp(), updatedAt: stamp() });
  });
  return { documentId: body.documentId, state: 'ready' };
}

async function updateDocument(context, body) {
  const metadata = normalizeHealthDocumentMetadata(body.metadata);
  await context.db.runTransaction(async transaction => {
    const { ref, record } = await documentContext(transaction, context, body.documentId);
    if (record.state !== 'ready') fail('HEALTH_INVALID_DOCUMENT', 409);
    transaction.update(ref, { ...metadata, readers: documentReaders(record, metadata), updatedAt: stamp() });
  });
  return { documentId: body.documentId };
}

async function deleteDocument(context, body) {
  if (body.confirm !== true) fail('HEALTH_CONFIRMATION_REQUIRED', 400);
  let storagePath;
  await context.db.runTransaction(async transaction => {
    const { ref, record } = await documentContext(transaction, context, body.documentId);
    storagePath = record.storagePath;
    transaction.update(ref, { state: 'deleting', deletionRequestedBy: context.uid, deletionRequestedAt: stamp(), updatedAt: stamp() });
  });
  try {
    await healthStorageBucket(context).file(storagePath).delete({ ignoreNotFound: true });
    await context.db.collection('healthDocuments').doc(body.documentId).delete();
    return { deleted: true };
  } catch {
    return { deleted: false, deletionPending: true };
  }
}

/** Only the person owning an active login can give consent. Legal authority is provisioned independently by Admin. */
async function changeGrant(context, body, revoke) {
  if (!identifier(body.ownerProfileId) || !identifier(body.granteeUid) || body.ownerProfileId !== context.uid
    || body.granteeUid === context.uid || !revoke && typeof body.canEdit !== 'boolean') fail();
  await context.db.runTransaction(async transaction => {
    const actorRef = context.db.collection('members').doc(context.uid);
    const recipientRef = context.db.collection('members').doc(body.granteeUid);
    const ref = context.db.collection('healthDocumentGrants').doc(body.ownerProfileId);
    const [actorSnapshot, recipientSnapshot, prior] = await transaction.getAll(actorRef, recipientRef, ref);
    const actor = actorSnapshot.data(); const recipient = recipientSnapshot.data();
    if (!activeHealthMember(actor) || !activeHealthMember(recipient)
      || actor.familyId && recipient.familyId && actor.familyId !== recipient.familyId) fail();
    const documents = revoke ? await transaction.get(context.db.collection('healthDocuments').where('ownerProfileId', '==', body.ownerProfileId).limit(401)) : null;
    if (documents?.size > 400) fail('HEALTH_TOO_MANY_DOCUMENTS', 409);
    const grants = (prior.data()?.grants || []).filter(item => item.uid !== body.granteeUid);
    if (!revoke) grants.push({ uid: body.granteeUid, basis: 'consent', canEdit: body.canEdit, authorizedBy: context.uid });
    transaction.set(ref, { ownerProfileId: body.ownerProfileId, ownerUid: context.uid, grants,
      authorizedUids: [...new Set(grants.map(item => item.uid))], updatedAt: stamp() });
    documents?.docs.forEach(document => transaction.update(document.ref, {
      readers: (document.data().readers || []).filter(uid => uid !== body.granteeUid),
      editors: (document.data().editors || []).filter(uid => uid !== body.granteeUid), updatedAt: stamp() }));
  });
  return { saved: true };
}

export async function manageHealthAction(context, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('HEALTH_INVALID_DOCUMENT', 400);
  if (body.operation === 'state' || body.operation === 'status') return { documentsReady: true };
  const actions = { prepare: prepareDocument, save: saveDocument, update: updateDocument, delete: deleteDocument,
    grant: (ctx, value) => changeGrant(ctx, value, false), revoke: (ctx, value) => changeGrant(ctx, value, true) };
  const action = Object.hasOwn(actions, body.operation) ? actions[body.operation] : null;
  if (!action) fail('HEALTH_INVALID_DOCUMENT', 400);
  return action(context, body);
}

/** Only files whose authorized user explicitly requested deletion are retried. Expiry never deletes health documents. */
export async function retryHealthDocumentDeletes(context) {
  const pending = await context.db.collection('healthDocuments').where('state', '==', 'deleting').limit(100).get();
  let deleted = 0;
  for (const snapshot of pending.docs) {
    const record = snapshot.data();
    if (!record.deletionRequestedBy || !record.deletionRequestedAt || !record.storagePath?.startsWith(`healthDocuments/${snapshot.id}/`)) continue;
    try {
      await healthStorageBucket(context).file(record.storagePath).delete({ ignoreNotFound: true });
      await context.db.runTransaction(async transaction => {
        const current = await transaction.get(snapshot.ref);
        if (current.data()?.state === 'deleting' && current.data()?.storagePath === record.storagePath) transaction.delete(snapshot.ref);
      });
      deleted += 1;
    } catch { /* Retry later without logging file names or medical information. */ }
  }
  return { deleted };
}
