import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { manageHealthAction, retryHealthDocumentDeletes } from '../server/health-service.mjs';
import { familyMemoryContext, familyTestNow, memoryBucket } from './family-v2-test-helpers.mjs';

const bytes = Buffer.from('%PDF-1.7\n% non-personal test document\n%%EOF');
const metadata = { title: 'Załącznik testowy', documentType: 'general', issuedOn: '', expiresOn: '', indefinite: false,
  number: '', note: '', pinned: false, shareOwner: false };
const visit = { title: 'Wizyta testowa', type: 'visit', person: 'child-person', date: '2026-10-12', time: '12:00', status: 'planned',
  doctor: '', location: '', note: '', specialty: '', referralCode: '', nextControl: '', callReminderDate: '', dose: '', medicineTime: '20:00', privateToParents: false };
const request = changes => ({ operation: 'prepare-visit-attachment', recordId: 'visit-test', documentId: 'attachment-test',
  ownerProfileId: 'child', privateToParents: false, mimeType: 'application/pdf', size: bytes.length, fileName: 'fixture.pdf', metadata, ...changes });
const makeContext = initial => { const context = familyMemoryContext(initial); context.bucket = memoryBucket(); return context; };
const finalize = changes => ({ operation: 'finalize-visit-attachment', recordId: 'visit-test', documentId: 'attachment-test', record: visit, addToCalendar: true, ...changes });
function store(context, ticket, content = bytes, changes = {}) {
  context.bucket.objects.set(ticket.storagePath, { bytes: content, metadata: { size: bytes.length, contentType: 'application/pdf',
    metadata: { firebaseStorageDownloadTokens: 'non-personal-fixture-token' }, ...changes } });
}
const code = expected => error => error.code === expected;

test('prepare is idempotent and does not prematurely save the visit or file metadata in legacy healthRecords', async () => {
  const context = makeContext();
  const first = await manageHealthAction(context, request());
  const retry = await manageHealthAction(context, request());
  assert.deepEqual(retry, first);
  assert.equal([...context.rows.keys()].filter(key => key.startsWith('healthDocuments/')).length, 1);
  assert.equal(context.rows.has('healthRecords/visit-test'), false);
  assert.equal(context.rows.get('healthDocuments/attachment-test').attachmentRecordId, 'visit-test');
});

test('the parent role does not permit attaching files to an adult without actual consent', async () => {
  const context = makeContext();
  await assert.rejects(manageHealthAction(context, request({ ownerProfileId: 'adult' })), code('HEALTH_FORBIDDEN'));
  assert.equal(context.rows.has('healthRecords/visit-test'), false);
  assert.equal(context.bucket.objects.size, 0);
});

test('PDF and JPEG finalization atomically saves one visit, one calendar entry and no bearer URL; duplicate retries add nothing', async () => {
  for (const [mimeType, contents] of [['application/pdf', bytes], ['image/jpeg', Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0])]]) {
    const context = makeContext();
    const ticket = await manageHealthAction(context, request({ mimeType, size: contents.length }));
    store(context, ticket, contents, { size: contents.length, contentType: mimeType });
    await Promise.all([manageHealthAction(context, finalize()), manageHealthAction(context, finalize())]);
    const record = context.rows.get('healthRecords/visit-test');
    assert.equal(record.attachmentDocumentId, 'attachment-test');
    assert.equal(record.documentURL, ''); assert.equal(record.documentPath, '');
    assert.equal(Object.hasOwn(record, 'fileName'), false);
    assert.equal(context.rows.get('healthDocuments/attachment-test').state, 'ready');
    assert.equal([...context.rows.keys()].filter(key => key.startsWith('calendarEvents/')).length, 1);
    assert.equal([...context.rows.keys()].filter(key => key.startsWith('healthRecords/')).length, 1);
    assert.equal(context.rows.get('calendarEvents/health-visit-visit-test').date.toDate().toISOString(), '2026-10-12T10:00:00.000Z');
    assert.equal(context.bucket.objects.get(ticket.storagePath).metadata.metadata.firebaseStorageDownloadTokens, null);
  }
});

test('missing, forged MIME/signature and incomplete uploads leave the form draft without a saved visit', async () => {
  const context = makeContext();
  const ticket = await manageHealthAction(context, request());
  await assert.rejects(manageHealthAction(context, finalize()), code('HEALTH_FILE_NOT_READY'));
  store(context, ticket, Buffer.from('<html>not a medical PDF</html>'));
  await assert.rejects(manageHealthAction(context, finalize()), code('HEALTH_INVALID_FILE'));
  store(context, ticket, bytes, { contentType: 'image/jpeg' });
  await assert.rejects(manageHealthAction(context, finalize()), code('HEALTH_INVALID_FILE'));
  store(context, ticket, bytes, { size: bytes.length - 1 });
  await assert.rejects(manageHealthAction(context, finalize()), code('HEALTH_INVALID_FILE'));
  assert.equal(context.rows.has('healthRecords/visit-test'), false);
  assert.equal(context.rows.get('healthDocuments/attachment-test').state, 'draft');
});

test('an ambiguous successful response can be retried, but changed form values never silently overwrite or falsely report a second save', async () => {
  const context = makeContext(); const ticket = await manageHealthAction(context, request()); store(context, ticket);
  await manageHealthAction(context, finalize());
  await manageHealthAction(context, finalize());
  await assert.rejects(manageHealthAction(context, finalize({ record: { ...visit, title: 'Different edited fixture' } })), code('HEALTH_ATTACHMENT_CHANGED'));
  assert.equal(context.rows.get('healthRecords/visit-test').title, visit.title);
});

test('invalid MIME, zero bytes and over-limit sizes are rejected before a Storage upload ticket exists', async () => {
  const context = makeContext();
  for (const changes of [{ mimeType: 'text/html' }, { size: 0 }, { size: 10 * 1024 * 1024 + 1 }]) {
    await assert.rejects(manageHealthAction(context, request(changes)), code('HEALTH_INVALID_ATTACHMENT'));
  }
  assert.equal(context.rows.has('healthDocuments/attachment-test'), false);
});

test('the authenticated retry probe confirms complete bytes without changing Storage or prematurely finalizing the visit', async () => {
  const context = makeContext(); const ticket = await manageHealthAction(context, request());
  assert.equal((await manageHealthAction(context, { operation: 'status', documentId: ticket.documentId })).attachmentStored, false);
  store(context, ticket);
  const result = await manageHealthAction(context, { operation: 'status', documentId: ticket.documentId });
  assert.equal(result.attachmentStored, true);
  assert.equal(context.bucket.objects.get(ticket.storagePath).metadata.metadata.firebaseStorageDownloadTokens, 'non-personal-fixture-token');
  assert.equal(context.rows.get('healthDocuments/attachment-test').state, 'draft');
  assert.equal(context.rows.has('healthRecords/visit-test'), false);
  await assert.rejects(manageHealthAction(context.as('child'), { operation: 'status', documentId: ticket.documentId }), code('HEALTH_FORBIDDEN'));
});

test('revoking adult consent after upload rejects finalization and retains no falsely saved visit', async () => {
  const context = makeContext();
  await manageHealthAction(context.as('adult'), { operation: 'grant', ownerProfileId: 'adult', granteeUid: 'parent', canEdit: true });
  const ticket = await manageHealthAction(context, request({ ownerProfileId: 'adult' })); store(context, ticket);
  await manageHealthAction(context.as('adult'), { operation: 'revoke', ownerProfileId: 'adult', granteeUid: 'parent' });
  await assert.rejects(manageHealthAction(context, finalize({ record: { ...visit, person: 'adult-person' } })), code('HEALTH_FORBIDDEN'));
  assert.equal(context.rows.has('healthRecords/visit-test'), false);
});

test('attachment finalization rejects switching the patient, privacy, record ID or uploader', async () => {
  const context = makeContext();
  const ticket = await manageHealthAction(context, request()); store(context, ticket);
  for (const changed of [{ record: { ...visit, person: 'adult-person' } }, { record: { ...visit, privateToParents: true } }, { recordId: 'other-visit' }]) {
    await assert.rejects(manageHealthAction(context, finalize(changed)), code('HEALTH_FORBIDDEN'));
  }
  await assert.rejects(manageHealthAction(context.as('child'), finalize()), code('HEALTH_FORBIDDEN'));
  await assert.rejects(manageHealthAction(context, { operation: 'save', documentId: ticket.documentId }), code('HEALTH_INVALID_DOCUMENT'));
  assert.equal(context.rows.has('healthRecords/visit-test'), false);
});

test('expired unlinked drafts and explicitly discarded drafts are cleaned; ready files and visit history remain', async () => {
  const context = makeContext();
  const ready = await manageHealthAction(context, request()); store(context, ready);
  await manageHealthAction(context, finalize());
  const abandoned = await manageHealthAction(context, request({ documentId: 'abandoned', recordId: 'abandoned-visit' })); store(context, abandoned);
  context.rows.get('healthDocuments/abandoned').uploadExpiresAt = Timestamp.fromMillis(familyTestNow.getTime() - 1);
  context.bucket.controls.failDeletes = 1;
  await retryHealthDocumentDeletes(context);
  assert.equal(context.rows.get('healthDocuments/abandoned').state, 'deleting');
  await retryHealthDocumentDeletes(context);
  assert.equal(context.rows.has('healthDocuments/abandoned'), false);
  assert.equal(context.bucket.objects.has(ready.storagePath), true);
  assert.equal(context.rows.has('healthRecords/visit-test'), true);
  await assert.rejects(manageHealthAction(context, { operation: 'discard-visit-attachment', documentId: ready.documentId }), code('HEALTH_FORBIDDEN'));
  const discarded = await manageHealthAction(context, request({ documentId: 'discarded', recordId: 'discarded-visit' })); store(context, discarded);
  await manageHealthAction(context, { operation: 'discard-visit-attachment', documentId: discarded.documentId });
  assert.equal(context.bucket.objects.has(discarded.storagePath), false);
});

test('replacing a linked attachment updates the existing visit and queues only its superseded file for real deletion', async () => {
  const context = makeContext();
  const first = await manageHealthAction(context, request()); store(context, first);
  await manageHealthAction(context, finalize());
  const second = await manageHealthAction(context, request({ documentId: 'second-attachment' })); store(context, second);
  await manageHealthAction(context, finalize({ documentId: 'second-attachment', record: { ...visit, note: 'Updated fixture' } }));
  assert.equal(context.rows.get('healthRecords/visit-test').attachmentDocumentId, second.documentId);
  await retryHealthDocumentDeletes(context);
  assert.equal(context.bucket.objects.has(first.storagePath), false);
  assert.equal(context.bucket.objects.has(second.storagePath), true);
  assert.equal([...context.rows.keys()].filter(key => key.startsWith('calendarEvents/')).length, 1);
});

test('authorized state lists own ready documents with a fresh family check, preserves migrated legacy ACLs and omits private bearer URLs', async () => {
  const context = makeContext();
  const document = changes => ({ title: 'Synthetic document', ownerProfileId: 'child', createdBy: 'parent', state: 'ready',
    readers: ['parent'], editors: ['parent'], storagePath: 'healthDocuments/owned/parent/test.pdf',
    documentURL: 'https://private.example/ignored?token=not-a-real-token', secret: 'not-returned', ...changes });
  context.rows.set('healthDocuments/owned', document({ attachmentKind: 'health-record', familyId: 'fixture-family' }));
  context.rows.set('healthDocuments/foreign-family', document({ attachmentKind: 'health-record', familyId: 'foreign-family', storagePath: 'healthDocuments/foreign-family/parent/test.pdf' }));
  context.rows.set('healthDocuments/legacy', document({ familyId: 'fixture-family', storagePath: 'healthDocuments/legacy/parent/test.pdf' }));
  context.rows.set('healthDocuments/other-uid', document({ readers: ['adult'], storagePath: 'healthDocuments/other-uid/adult/test.pdf' }));
  context.rows.set('healthDocuments/draft', document({ state: 'draft', storagePath: 'healthDocuments/draft/parent/test.pdf' }));
  const result = await manageHealthAction(context, { operation: 'state', uid: 'adult', familyId: 'foreign-family' });
  assert.deepEqual(result.documents.map(item => item.id).sort(), ['legacy', 'owned']);
  assert.equal(JSON.stringify(result).includes('not-a-real-token'), false);
  assert.equal(JSON.stringify(result).includes('not-returned'), false);
  context.rows.get('members/parent').active = false;
  await assert.rejects(manageHealthAction(context, { operation: 'state' }), code('HEALTH_FORBIDDEN'));
});
