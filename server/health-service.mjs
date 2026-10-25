import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { EduServerError } from './edu-auth.mjs';
import { activeHealthMember, activeHealthProfile, canManageHealthOwner, HEALTH_DOCUMENT_MAX_BYTES,
  HEALTH_DOCUMENT_MIME_TYPES, normalizeHealthDocumentMetadata, validHealthFileHeader, validHealthDate } from './health-access.mjs';
import { discardVisitAttachment, finalizeVisitAttachment, prepareVisitAttachment } from './health-visit-attachments.mjs';
import { configuredCopyFolder, copyFolderFor } from './health-copy-folders.mjs';

const fail = (code = 'HEALTH_FORBIDDEN', status = 403) => { throw new EduServerError(code, status,
  code === 'HEALTH_FORBIDDEN' ? 'Brak upoważnienia do tej kartoteki. W przypadku osoby dorosłej potrzebna jest jej zgoda lub potwierdzone umocowanie prawne.'
    : code === 'HEALTH_BIRTH_DATE_REQUIRED' ? 'Uzupełnij datę urodzenia w profilu dziecka. Bez potwierdzenia małoletności nie można przyznać rodzicowi dostępu do dokumentów.'
      : 'Nie udało się zapisać dokumentu. Spróbuj ponownie.'); };
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
async function ownerContext(transaction, context, ownerProfileId, options = {}) {
  if (!identifier(ownerProfileId)) fail('HEALTH_INVALID_DOCUMENT', 400);
  const refs = [context.db.collection('members').doc(context.uid), context.db.collection('members').doc(ownerProfileId),
    context.db.collection('healthDocumentGrants').doc(ownerProfileId)];
  const [actorSnapshot, ownerSnapshot, grantSnapshot] = await transaction.getAll(...refs);
  const actor = actorSnapshot.exists ? { ...actorSnapshot.data(), id: context.uid } : null;
  const owner = ownerSnapshot.exists ? { ...ownerSnapshot.data(), id: ownerProfileId } : null;
  if (!activeHealthMember(actor) || !activeHealthProfile(owner)
    || (actor.familyId ?? null) !== (owner.familyId ?? null)) fail();
  const copyFolder = options.copyFolder ? await copyFolderFor(context, transaction, actor, ownerProfileId) : null;
  if (options.copyFolder && !copyFolder) fail();
  if (!copyFolder && !canManageHealthOwner(actor, owner, grantSnapshot.data(), context.now || new Date())) {
    if (actor.role === 'parent' && owner.role === 'child' && !validHealthDate(owner.birthDate)) fail('HEALTH_BIRTH_DATE_REQUIRED', 409);
    fail();
  }
  return { actor, owner, copyFolder, grant: grantSnapshot.data(), grantRef: refs[2] };
}

async function documentContext(transaction, context, documentId) {
  if (!identifier(documentId)) fail('HEALTH_INVALID_DOCUMENT', 400);
  const ref = context.db.collection('healthDocuments').doc(documentId);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) fail('HEALTH_DOCUMENT_NOT_FOUND', 404);
  const record = snapshot.data();
  if (!Array.isArray(record.editors) || !record.editors.includes(context.uid)) fail();
  const permission = await ownerContext(transaction, context, record.ownerProfileId, { copyFolder: record.accessScope === 'shared-copies' });
  return { ...permission, ref, record };
}

function documentReaders(record, metadata) {
  const editors = [...new Set(record.editors || [])];
  const readers = [...new Set([...(record.readers || []).filter(uid => uid !== record.ownerUid || editors.includes(uid)), ...editors,
    ...(metadata.shareOwner && record.ownerUid ? [record.ownerUid] : [])])];
  return readers;
}

/** Admin queries may inspect only this authenticated UID's ready documents. */
async function healthDocumentState(context) {
  const actorSnapshot = await context.db.collection('members').doc(context.uid).get();
  const actor = actorSnapshot.data();
  if (!activeHealthMember(actor)) fail();
  const snapshot = await context.db.collection('healthDocuments').where('state', '==', 'ready').where('readers', 'array-contains', context.uid).get();
  const text = (record, key, maximum = 4000) => typeof record[key] === 'string' ? record[key].slice(0, maximum) : '';
  const identities = value => Array.isArray(value) ? value.filter(identifier) : [];
  const documents = snapshot.docs.flatMap(document => {
    const record = document.data();
    if (record.state !== 'ready' || !record.readers?.includes(context.uid)
      || (record.familyId !== undefined || record.attachmentKind === 'health-record') && (record.familyId ?? null) !== (actor.familyId ?? null)
      || !identifier(record.ownerProfileId) || typeof record.storagePath !== 'string'
      || !record.storagePath.startsWith(`healthDocuments/${document.id}/`)) return [];
    return [{ id: document.id, title: text(record, 'title', 300), documentType: text(record, 'documentType', 50),
      ownerProfileId: record.ownerProfileId, ownerUid: identifier(record.ownerUid) ? record.ownerUid : null,
      ownerPersonKey: text(record, 'ownerPersonKey', 128), readers: identities(record.readers), editors: identities(record.editors),
      createdBy: text(record, 'createdBy', 128), state: 'ready', protected: true, storagePath: record.storagePath,
      accessScope: record.accessScope === 'shared-copies' ? 'shared-copies' : '', fileName: text(record, 'fileName', 250), mimeType: text(record, 'mimeType', 100), size: Number(record.size) || 0,
      issuedOn: text(record, 'issuedOn', 10), expiresOn: text(record, 'expiresOn', 10), indefinite: record.indefinite === true,
      number: text(record, 'number', 200), note: text(record, 'note', 4000), pinned: record.pinned === true, shareOwner: record.shareOwner === true }];
  });
  const folderConfig = configuredCopyFolder();
  const folder = folderConfig ? await copyFolderFor(context, null, actor, folderConfig.ownerProfileId) : null;
  return { documentsReady: true, documents, copyFolders: folder ? [folder] : [] };
}

async function prepareDocument(context, body) {
  const metadata = normalizeHealthDocumentMetadata(body.metadata);
  if (!HEALTH_DOCUMENT_MIME_TYPES.includes(body.mimeType) || !Number.isInteger(body.size) || body.size <= 0
    || body.size > HEALTH_DOCUMENT_MAX_BYTES || typeof body.fileName !== 'string' || body.fileName.length > 250) fail('HEALTH_INVALID_DOCUMENT', 400);
  const documentId = randomUUID();
  const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[body.mimeType];
  const storagePath = `healthDocuments/${documentId}/${context.uid}/${randomUUID()}.${extension}`;
  await context.db.runTransaction(async transaction => {
    const { owner, copyFolder } = await ownerContext(transaction, context, body.ownerProfileId, { copyFolder: body.copyFolder === true });
    const ownerUid = owner.canLogin === true ? owner.id : null;
    const record = { ...metadata, ownerProfileId: owner.id, ownerUid, ownerPersonKey: owner.personKey || owner.name || owner.id,
      readers: copyFolder ? copyFolder.memberUids : [...new Set([context.uid, ...(metadata.shareOwner && ownerUid ? [ownerUid] : [])])], editors: copyFolder ? copyFolder.memberUids : [context.uid],
      ...(copyFolder ? { accessScope: 'shared-copies', pinned: true, shareOwner: true } : {}),
      createdBy: context.uid, familyId: owner.familyId || null, state: 'draft', protected: true, storagePath, mimeType: body.mimeType, size: body.size,
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
  if (record?.attachmentKind === 'health-record') fail('HEALTH_INVALID_DOCUMENT', 400);
  if (!record || record.createdBy !== context.uid || !record.editors?.includes(context.uid)
    || !['draft', 'ready'].includes(record.state)) fail();
  if (record.state === 'ready') return { documentId: snapshot.id, state: 'ready' };
  await validateStoredDocument(context, record);
  await context.db.runTransaction(async transaction => {
    const current = await documentContext(transaction, context, body.documentId);
    if (current.record.state === 'ready') return;
    if (current.record.state !== 'draft' || current.record.storagePath !== record.storagePath) fail('HEALTH_INVALID_DOCUMENT', 409);
    transaction.update(current.ref, { state: 'ready', uploadedAt: stamp(), updatedAt: stamp() });
  });
  return { documentId: body.documentId, state: 'ready' };
}

async function validateStoredDocument(context, record) {
  const file = await verifyStoredDocument(context, record);
  const [actual] = await file.getMetadata();
  // Protected files are accessed using authenticated Storage rules, never a public bearer URL.
  await file.setMetadata({ metadata: { ...(actual.metadata || {}), firebaseStorageDownloadTokens: null } });
}

async function verifyStoredDocument(context, record) {
  const file = healthStorageBucket(context).file(record.storagePath);
  let actual;
  try { [actual] = await file.getMetadata(); }
  catch { fail('HEALTH_FILE_NOT_READY', 409); }
  if (Number(actual.size) !== record.size || actual.contentType !== record.mimeType) fail('HEALTH_INVALID_FILE', 400);
  const [header] = await file.download({ start: 0, end: 15 });
  if (!validHealthFileHeader(record.mimeType, header)) fail('HEALTH_INVALID_FILE', 400);
  return file;
}

async function healthDocumentStatus(context, body) {
  if (!body.documentId) return { documentsReady: true };
  const current = await context.db.runTransaction(transaction => documentContext(transaction, context, body.documentId));
  if (current.record.attachmentKind !== 'health-record' || current.record.createdBy !== context.uid
    || !['draft', 'ready'].includes(current.record.state)) fail();
  let attachmentStored = false;
  try { await verifyStoredDocument(context, current.record); attachmentStored = true; }
  catch (error) { if (!['HEALTH_FILE_NOT_READY', 'HEALTH_INVALID_FILE'].includes(error.code)) throw error; }
  return { documentsReady: true, documentId: body.documentId, attachmentStored };
}

async function updateDocument(context, body) {
  const metadata = normalizeHealthDocumentMetadata(body.metadata);
  await context.db.runTransaction(async transaction => {
    const { ref, record } = await documentContext(transaction, context, body.documentId);
    if (record.state !== 'ready') fail('HEALTH_INVALID_DOCUMENT', 409);
    if (record.attachmentKind === 'health-record' && record.attachmentPrivate === true && metadata.shareOwner) fail('HEALTH_INVALID_DOCUMENT', 400);
    transaction.update(ref, { ...metadata, ...(record.accessScope === 'shared-copies' ? { pinned: true, shareOwner: true } : {}), readers: documentReaders(record, metadata), updatedAt: stamp() });
  });
  return { documentId: body.documentId };
}

async function deleteDocument(context, body) {
  if (body.confirm !== true) fail('HEALTH_CONFIRMATION_REQUIRED', 400);
  let storagePath;
  await context.db.runTransaction(async transaction => {
    const { ref, record } = await documentContext(transaction, context, body.documentId);
    storagePath = record.storagePath;
    let linked;
    if (record.attachmentKind === 'health-record' && identifier(record.attachmentRecordId)) {
      linked = await transaction.get(context.db.collection('healthRecords').doc(record.attachmentRecordId));
    }
    transaction.update(ref, { state: 'deleting', deletionRequestedBy: context.uid, deletionRequestedAt: stamp(), updatedAt: stamp() });
    if (linked?.data()?.attachmentDocumentId === body.documentId) {
      transaction.update(linked.ref, { attachmentDocumentId: FieldValue.delete(), updatedAt: stamp() });
    }
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
      || (actor.familyId ?? null) !== (recipient.familyId ?? null)) fail();
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

async function shareCopy(context, body) {
  if (!Array.isArray(body.readerUids) || body.readerUids.length > 20 || body.readerUids.some(uid => !identifier(uid))) fail('HEALTH_INVALID_DOCUMENT', 400);
  await context.db.runTransaction(async transaction => {
    const { actor, ref, record, copyFolder } = await documentContext(transaction, context, body.documentId);
    if (!copyFolder || record.state !== 'ready') fail();
    const extras = [...new Set(body.readerUids)].filter(uid => !copyFolder.memberUids.includes(uid));
    const profiles = extras.length ? await transaction.getAll(...extras.map(uid => context.db.collection('members').doc(uid))) : [];
    if (profiles.some(profile => !profile.exists || !activeHealthMember(profile.data()) || profile.data().familyId !== actor.familyId)) fail();
    transaction.update(ref, { readers: [...copyFolder.memberUids, ...extras], editors: copyFolder.memberUids, sharingUpdatedBy: context.uid, updatedAt: stamp() });
  });
  return { documentId: body.documentId };
}

export async function manageHealthAction(context, body) {
  if (body?.operation === 'share-copy') return shareCopy(context, body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('HEALTH_INVALID_DOCUMENT', 400);
  if (body.operation === 'state') return healthDocumentState(context);
  if (body.operation === 'status') return healthDocumentStatus(context, body);
  const attachmentHelpers = { ownerContext, documentContext, validateStoredDocument };
  const actions = { prepare: prepareDocument, save: saveDocument, update: updateDocument, delete: deleteDocument,
    'prepare-visit-attachment': (ctx, value) => prepareVisitAttachment(ctx, value, attachmentHelpers),
    'finalize-visit-attachment': (ctx, value) => finalizeVisitAttachment(ctx, value, attachmentHelpers),
    'discard-visit-attachment': async (ctx, value) => {
      const result = await discardVisitAttachment(ctx, value, attachmentHelpers);
      await retryHealthDocumentDeletes(ctx);
      return result;
    },
    grant: (ctx, value) => changeGrant(ctx, value, false), revoke: (ctx, value) => changeGrant(ctx, value, true) };
  const action = Object.hasOwn(actions, body.operation) ? actions[body.operation] : null;
  if (!action) fail('HEALTH_INVALID_DOCUMENT', 400);
  return action(context, body);
}

/** Ready medical files never expire. Only explicit deletion and abandoned, unlinked upload drafts are cleaned. */
export async function retryHealthDocumentDeletes(context) {
  const drafts = await context.db.collection('healthDocuments').where('state', '==', 'draft').limit(100).get();
  for (const snapshot of drafts.docs) {
    const record = snapshot.data();
    if (!record.uploadExpiresAt?.toMillis || record.uploadExpiresAt.toMillis() > (context.now || new Date()).getTime()) continue;
    await context.db.runTransaction(async transaction => {
      const current = await transaction.get(snapshot.ref);
      const linked = record.attachmentRecordId ? await transaction.get(context.db.collection('healthRecords').doc(record.attachmentRecordId)) : null;
      if (current.data()?.state !== 'draft'
        || current.data()?.uploadExpiresAt?.toMillis() > (context.now || new Date()).getTime()
        || linked?.data()?.attachmentDocumentId === snapshot.id) return;
      transaction.update(snapshot.ref, { state: 'deleting', deletionRequestedBy: record.createdBy,
        deletionRequestedAt: stamp(), updatedAt: stamp() });
    });
  }
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
