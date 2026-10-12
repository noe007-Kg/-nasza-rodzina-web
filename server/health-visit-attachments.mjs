import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';
import { HEALTH_DOCUMENT_MAX_BYTES, HEALTH_DOCUMENT_MIME_TYPES, normalizeHealthDocumentMetadata, validHealthDate } from './health-access.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (code = 'HEALTH_INVALID_ATTACHMENT', status = 400) => { throw new EduServerError(code, status,
  code === 'HEALTH_FORBIDDEN' ? 'Brak upoważnienia do tego załącznika i kartoteki.'
    : code === 'HEALTH_ATTACHMENT_CHANGED' ? 'Ta wizyta została już zapisana z wcześniejszymi danymi. Otwórz ją z listy, aby bezpiecznie zapisać dalsze zmiany.'
      : 'Nie udało się zapisać załącznika wizyty. Dane formularza pozostają dostępne do ponowienia.'); };
const stamp = () => FieldValue.serverTimestamp();

function normalizeVisit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['visit', 'doctor'].includes(value.type)
    || typeof value.privateToParents !== 'boolean' || !['planned', 'toBook', 'booked', 'done', 'cancelled'].includes(value.status)) fail();
  const fields = { title: 500, person: 128, date: 10, time: 5, doctor: 500, location: 1000, note: 12000,
    specialty: 200, referralCode: 200, nextControl: 500, callReminderDate: 10, dose: 500, medicineTime: 5 };
  const record = {};
  for (const [key, maximum] of Object.entries(fields)) {
    if (typeof value[key] !== 'string' || value[key].length > maximum) fail();
    record[key] = value[key].trim();
  }
  if (!record.title || !validHealthDate(record.date, true) || !validHealthDate(record.callReminderDate, true)
    || record.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time)) fail();
  return { ...record, type: value.type, status: value.status, privateToParents: value.privateToParents };
}

/** Civil Warsaw time, independently of the runtime machine's timezone. */
function visitStart(date, time) {
  const local = `${date}T${time || '12:00'}:00`;
  const desired = Date.parse(`${local}Z`);
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = desired;
  for (let iteration = 0; iteration < 3; iteration++) {
    const shown = formatter.format(new Date(instant)).replace(' ', 'T');
    instant += desired - Date.parse(`${shown}Z`);
  }
  if (formatter.format(new Date(instant)).replace(' ', 'T') !== local) fail();
  return new Date(instant);
}

async function existingVisit(transaction, context, reference, owner, actor, ownRetry = false) {
  const snapshot = await transaction.get(reference);
  const current = snapshot.data();
  if (!snapshot.exists) return null;
  if (!['visit', 'doctor'].includes(current.type) || current.person !== (owner.personKey || owner.name || owner.id)
    || !(actor.role === 'parent' || ownRetry && owner.id === context.uid && current.createdBy === context.uid)
    || current.familyId && actor.familyId && current.familyId !== actor.familyId) fail('HEALTH_FORBIDDEN', 403);
  // Legacy records do not have a familyId. Check their real creator instead of accepting a guessed record ID.
  if (!current.familyId && current.createdBy && current.createdBy !== context.uid) {
    const creator = await transaction.get(context.db.collection('members').doc(current.createdBy));
    if (!creator.exists || actor.familyId && creator.data().familyId !== actor.familyId) fail('HEALTH_FORBIDDEN', 403);
  }
  return current;
}

export async function prepareVisitAttachment(context, body, helpers) {
  if (!id(body.recordId) || !id(body.documentId) || typeof body.privateToParents !== 'boolean'
    || !HEALTH_DOCUMENT_MIME_TYPES.includes(body.mimeType) || !Number.isInteger(body.size) || body.size <= 0
    || body.size > HEALTH_DOCUMENT_MAX_BYTES || typeof body.fileName !== 'string' || !body.fileName || body.fileName.length > 250) fail();
  const metadata = normalizeHealthDocumentMetadata(body.metadata);
  const reference = context.db.collection('healthDocuments').doc(body.documentId);
  const visit = context.db.collection('healthRecords').doc(body.recordId);
  let storagePath;
  await context.db.runTransaction(async transaction => {
    const permission = await helpers.ownerContext(transaction, context, body.ownerProfileId);
    if (body.privateToParents && permission.actor.role !== 'parent') fail('HEALTH_FORBIDDEN', 403);
    await existingVisit(transaction, context, visit, permission.owner, permission.actor);
    const prior = await transaction.get(reference);
    if (prior.exists) {
      const record = prior.data();
      if (record.createdBy !== context.uid || record.attachmentRecordId !== body.recordId || record.ownerProfileId !== permission.owner.id
        || record.state !== 'draft' || record.mimeType !== body.mimeType || record.size !== body.size
        || record.fileName !== body.fileName.replace(/[\u0000-\u001f/\\]/g, '-') || record.attachmentPrivate !== body.privateToParents
        || record.uploadExpiresAt.toMillis() <= (context.now || new Date()).getTime()) fail('HEALTH_ATTACHMENT_EXPIRED', 409);
      storagePath = record.storagePath;
      return;
    }
    const ownerUid = permission.owner.canLogin === true ? permission.owner.id : null;
    const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[body.mimeType];
    storagePath = `healthDocuments/${body.documentId}/${context.uid}/${randomUUID()}.${extension}`;
    transaction.create(reference, { ...metadata, shareOwner: !body.privateToParents && metadata.shareOwner,
      ownerProfileId: permission.owner.id, ownerUid, ownerPersonKey: permission.owner.personKey || permission.owner.name || permission.owner.id,
      readers: [...new Set([context.uid, ...(!body.privateToParents && metadata.shareOwner && ownerUid ? [ownerUid] : [])])], editors: [context.uid],
      familyId: permission.owner.familyId || permission.actor.familyId || null, attachmentRecordId: body.recordId,
      attachmentKind: 'health-record', attachmentPrivate: body.privateToParents, createdBy: context.uid, protected: true,
      state: 'draft', storagePath, mimeType: body.mimeType, size: body.size, fileName: body.fileName.replace(/[\u0000-\u001f/\\]/g, '-'),
      createdAt: stamp(), updatedAt: stamp(), uploadExpiresAt: Timestamp.fromMillis((context.now || new Date()).getTime() + 3600000) });
  });
  return { documentId: body.documentId, recordId: body.recordId, storagePath };
}

export async function finalizeVisitAttachment(context, body, helpers) {
  if (!id(body.recordId) || !id(body.documentId) || typeof body.addToCalendar !== 'boolean') fail();
  const record = normalizeVisit(body.record);
  const finalizedFingerprint = createHash('sha256').update(JSON.stringify({ record, addToCalendar: body.addToCalendar })).digest('hex');
  const reference = context.db.collection('healthDocuments').doc(body.documentId);
  const visit = context.db.collection('healthRecords').doc(body.recordId);
  // Authorization is checked before touching Storage and again atomically with the final writes.
  const checked = await context.db.runTransaction(transaction => helpers.documentContext(transaction, context, body.documentId));
  if (checked.record.attachmentKind !== 'health-record' || checked.record.attachmentRecordId !== body.recordId
    || checked.record.ownerPersonKey !== record.person || checked.record.attachmentPrivate !== record.privateToParents) fail('HEALTH_FORBIDDEN', 403);
  if (!['draft', 'ready'].includes(checked.record.state)) fail('HEALTH_ATTACHMENT_EXPIRED', 409);
  if (checked.record.state === 'draft') await helpers.validateStoredDocument(context, checked.record);
  let supersededDocumentId = '';
  await context.db.runTransaction(async transaction => {
    const current = await helpers.documentContext(transaction, context, body.documentId);
    const existing = await existingVisit(transaction, context, visit, current.owner, current.actor, current.record.state === 'ready');
    if (current.record.attachmentRecordId !== body.recordId || current.record.ownerPersonKey !== record.person
      || current.record.attachmentPrivate !== record.privateToParents || !['draft', 'ready'].includes(current.record.state)) fail('HEALTH_FORBIDDEN', 403);
    if (current.record.state === 'ready') {
      if (!existing || existing.attachmentDocumentId !== body.documentId) fail('HEALTH_ATTACHMENT_CHANGED', 409);
      if (current.record.finalizedFingerprint !== finalizedFingerprint) fail('HEALTH_ATTACHMENT_CHANGED', 409);
      return; // An ambiguous network retry never creates a second visit/calendar entry or re-applies stale data.
    }
    if (current.record.uploadExpiresAt.toMillis() <= (context.now || new Date()).getTime()) fail('HEALTH_ATTACHMENT_EXPIRED', 409);
    let previous;
    if (existing?.attachmentDocumentId && existing.attachmentDocumentId !== body.documentId) {
      previous = await transaction.get(context.db.collection('healthDocuments').doc(existing.attachmentDocumentId));
      if (!previous.exists || previous.data().attachmentRecordId !== body.recordId || !previous.data().editors?.includes(context.uid)) fail('HEALTH_FORBIDDEN', 403);
    }
    const calendarId = `health-visit-${body.recordId}`;
    const calendar = body.addToCalendar && !existing && !record.privateToParents && record.type === 'visit' && record.date
      ? context.db.collection('calendarEvents').doc(calendarId) : null;
    const payload = { ...record, documentPath: '', documentURL: '', attachmentDocumentId: body.documentId,
      updatedAt: stamp(), ...(existing ? {} : { createdBy: context.uid, confirmedDate: '', createdAt: stamp(), familyId: current.owner.familyId || current.actor.familyId || null }),
      ...(calendar ? { calendarEventId: calendarId } : {}) };
    if (existing) transaction.update(visit, payload);
    else transaction.create(visit, payload);
    if (calendar) {
      const start = visitStart(record.date, record.time);
      transaction.create(calendar, { title: `❤️ ${record.title}`, person: record.person, date: Timestamp.fromDate(start),
        endDate: Timestamp.fromMillis(start.getTime() + 3600000), allDay: false, private: false, visibility: 'family',
        description: [record.specialty, record.doctor, record.location].filter(Boolean).join(' · '), location: record.location,
        repeat: 'none', repeatUntil: null, source: 'health', sourceRecordId: body.recordId, ownerProfileId: current.owner.id,
        readOnly: true, createdBy: context.uid, createdAt: stamp(), updatedAt: stamp() });
    }
    transaction.update(reference, { title: record.title.slice(0, 300), state: 'ready', finalizedFingerprint, uploadedAt: stamp(), linkedAt: stamp(), updatedAt: stamp() });
    if (previous) {
      supersededDocumentId = previous.id;
      transaction.update(previous.ref, { state: 'deleting', deletionRequestedBy: context.uid, deletionRequestedAt: stamp(), updatedAt: stamp() });
    }
  });
  return { saved: true, recordId: body.recordId, documentId: body.documentId, ...(supersededDocumentId ? { supersededDocumentId } : {}) };
}

/** Only a draft selected in this form may be discarded. Ready medical files are never expired. */
export async function discardVisitAttachment(context, body, helpers) {
  if (!id(body.documentId)) fail();
  await context.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(context.db.collection('healthDocuments').doc(body.documentId));
    if (!snapshot.exists) return;
    const current = await helpers.documentContext(transaction, context, body.documentId);
    if (current.record.attachmentKind !== 'health-record' || current.record.createdBy !== context.uid || current.record.state !== 'draft') fail('HEALTH_FORBIDDEN', 403);
    transaction.update(current.ref, { state: 'deleting', deletionRequestedBy: context.uid, deletionRequestedAt: stamp(), updatedAt: stamp() });
  });
  return { discarded: true };
}
