import test from 'node:test';
import assert from 'node:assert/strict';
import { manageProfileAction, assertProfileEditAllowed } from '../server/account-profiles.mjs';
import { manageMemberAction } from '../server/account-members.mjs';
import { manageHealthAction, retryHealthDocumentDeletes } from '../server/health-service.mjs';
import { familyMemoryContext, memoryBucket, fixtureChild, fixtureParent, fixtureAdult, familyTestNow } from './family-v2-test-helpers.mjs';
import { Timestamp } from 'firebase-admin/firestore';

const meta = { title: 'Synthetic protected document', documentType: 'general', issuedOn: '', expiresOn: '', indefinite: false,
  number: '', note: '', pinned: false, shareOwner: false };
const prepare = changes => ({ operation: 'prepare', ownerProfileId: 'child', metadata: meta, mimeType: 'application/pdf', size: 16, fileName: 'test.pdf', ...changes });
const foreignRows = { 'members/foreign': { ...fixtureChild, familyId: 'foreign-family', personKey: 'foreign-person' },
  'members/foreign-parent': { ...fixtureParent, familyId: 'foreign-family' } };
const forbidden = code => ({ code });
const context = initial => { const result = familyMemoryContext({ ...foreignRows, ...initial }); result.bucket = memoryBucket(); return result; };

const ready = changes => ({ familyId: 'fixture-family', ownerProfileId: 'child', ownerUid: 'child', ownerPersonKey: 'child-person',
  state: 'ready', title: 'Synthetic document', readers: ['parent'], editors: ['parent'], createdBy: 'parent',
  storagePath: 'healthDocuments/ready/parent/test.pdf', ...changes });

test('a parent cannot edit a foreign child or a foreign offline avatar profile, even with the same personKey', async () => {
  for (const changes of [{}, { canLogin: false }, { personKey: fixtureChild.personKey }]) {
    const model = context({ 'members/foreign': { ...foreignRows['members/foreign'], ...changes } });
    const before = { ...model.rows.get('members/foreign') };
    await assert.rejects(manageProfileAction(model, { action: 'update', uid: 'foreign', emoji: '👦' }), forbidden('ACCOUNT_FAMILY_FORBIDDEN'));
    assert.deepEqual(model.rows.get('members/foreign'), before);
    assert.equal(model.calls.length, 0);
  }
});

test('missing, malformed and __legacy__ family IDs never authorize profile edits, even self edits', () => {
  for (const familyId of [undefined, null, '', '__legacy__', 'not/a/family', ' household ']) {
    assert.throws(() => assertProfileEditAllowed('parent', { ...fixtureParent, familyId }, 'parent', { ...fixtureParent, familyId }), forbidden('ACCOUNT_FAMILY_FORBIDDEN'));
  }
});

test('family avatar presentation is keyed by household and cannot overwrite another household singleton', async () => {
  const existing = { familyId: 'foreign-family', emoji: '🧩', updatedBy: 'foreign-parent' };
  const model = context({ 'familySettings/profile': existing });
  await manageProfileAction(model, { action: 'family', emoji: '🏡' });
  assert.deepEqual(model.rows.get('familySettings/profile'), existing);
  assert.equal(model.rows.get('familySettings/fixture-family').emoji, '🏡');
  assert.equal(model.rows.get('familySettings/fixture-family').familyId, 'fixture-family');
});

test('the reviewed legacy family avatar document remains editable only by its matching household', async () => {
  const model = context({ 'familySettings/profile': { familyId: 'fixture-family', emoji: '🏡' } });
  await manageProfileAction(model, { action: 'family', emoji: '👨‍👩‍👧‍👦' });
  assert.equal(model.rows.get('familySettings/profile').emoji, '👨‍👩‍👧‍👦');
  assert.equal(model.rows.has('familySettings/fixture-family'), false);
});

test('foreign member archive refuses before revoking Auth tokens or writing profiles', async () => {
  const model = context();
  model.auth = { revokeRefreshTokens: () => { throw new Error('Foreign Auth operation'); } };
  await assert.rejects(manageMemberAction(model, { action: 'archive', uid: 'foreign', confirmed: true }), forbidden('ACCOUNT_FAMILY_FORBIDDEN'));
  assert.equal(model.calls.length, 0);
});

test('all standalone medical document tickets get the trusted household and preserve individual ACLs', async () => {
  const model = context();
  const ticket = await manageHealthAction(model, prepare());
  const document = model.rows.get(`healthDocuments/${ticket.documentId}`);
  assert.equal(document.familyId, 'fixture-family');
  assert.deepEqual(document.readers, ['parent']);
  assert.deepEqual(document.editors, ['parent']);
  assert.equal(document.ownerProfileId, 'child');
  assert.equal(model.bucket.objects.size, 0);
});

test('foreign minor owners, stale family request context and unassigned owners cannot obtain upload tickets', async () => {
  for (const owner of [foreignRows['members/foreign'], { ...fixtureChild, familyId: undefined }, { ...fixtureChild, familyId: '__legacy__' }]) {
    const model = context({ 'members/foreign': owner });
    model.profile = { ...fixtureParent, familyId: owner.familyId };
    await assert.rejects(manageHealthAction(model, prepare({ ownerProfileId: 'foreign' })), forbidden('HEALTH_FORBIDDEN'));
    assert.equal(model.calls.length, 0);
  }
});

test('forged same-UID editors cannot read, finalize, change or delete foreign-family files', async () => {
  const model = context({ 'healthDocuments/ready': ready({ familyId: 'foreign-family', ownerProfileId: 'foreign', ownerUid: 'foreign' }) });
  const seen = [];
  model.bucket.file = path => { seen.push(path); throw new Error('Unauthorized Storage access'); };
  for (const body of [{ operation: 'save' }, { operation: 'update', metadata: meta }, { operation: 'delete', confirm: true }, { operation: 'status' }]) {
    await assert.rejects(manageHealthAction(model, { ...body, documentId: 'ready' }), forbidden('HEALTH_FORBIDDEN'));
  }
  assert.deepEqual((await manageHealthAction(model, { operation: 'state' })).documents, []);
  assert.equal(seen.length, 0);
  assert.equal(model.calls.length, 0);
});

test('a foreign recipient or a forged grant with foreign-family scope cannot authorize adult medical files', async () => {
  const model = context();
  await assert.rejects(manageHealthAction(model.as('adult'), { operation: 'grant', ownerProfileId: 'adult', granteeUid: 'foreign-parent', canEdit: true }), forbidden('HEALTH_FORBIDDEN'));
  model.rows.set('healthDocumentGrants/adult', { familyId: 'foreign-family', ownerProfileId: 'adult', ownerUid: 'adult',
    grants: [{ uid: 'parent', basis: 'consent', canEdit: true, authorizedBy: 'adult' }], authorizedUids: ['parent'] });
  await assert.rejects(manageHealthAction(model, prepare({ ownerProfileId: 'adult' })), forbidden('HEALTH_FORBIDDEN'));
});

test('adult consent and legal authorization remain necessary in the same family; sharing one file stays explicit', async () => {
  const model = context();
  await assert.rejects(manageHealthAction(model, prepare({ ownerProfileId: 'adult' })), forbidden('HEALTH_FORBIDDEN'));
  await manageHealthAction(model.as('adult'), { operation: 'grant', ownerProfileId: 'adult', granteeUid: 'parent', canEdit: true });
  assert.equal(model.rows.get('healthDocumentGrants/adult').familyId, 'fixture-family');
  const unshared = await manageHealthAction(model, prepare({ ownerProfileId: 'adult' }));
  const shared = await manageHealthAction(model, prepare({ ownerProfileId: 'adult', metadata: { ...meta, shareOwner: true } }));
  assert.deepEqual(model.rows.get(`healthDocuments/${unshared.documentId}`).readers, ['parent']);
  assert.deepEqual(model.rows.get(`healthDocuments/${shared.documentId}`).readers, ['parent', 'adult']);
});

test('protected document state requires household scope and rejects moved-owner/foreign ACL and unmigrated legacy records', async () => {
  const model = context({ 'healthDocuments/ready': ready(),
    'healthDocuments/missing': ready({ familyId: undefined, storagePath: 'healthDocuments/missing/parent/test.pdf' }),
    'healthDocuments/foreign-reader': ready({ readers: ['parent', 'foreign-parent'], storagePath: 'healthDocuments/foreign-reader/parent/test.pdf' }),
    'healthDocuments/moved-owner': ready({ ownerProfileId: 'foreign', storagePath: 'healthDocuments/moved-owner/parent/test.pdf' }) });
  assert.deepEqual((await manageHealthAction(model, { operation: 'state' })).documents.map(item => item.id), ['ready']);
  model.rows.get('members/parent').familyId = '__legacy__';
  await assert.rejects(manageHealthAction(model, { operation: 'state' }), forbidden('HEALTH_FORBIDDEN'));
});

test('authenticated cleanup never deletes another family file and rejects forged deletion ownership', async () => {
  const pending = { ...ready(), state: 'deleting', deletionRequestedBy: 'parent', deletionRequestedAt: Timestamp.fromDate(familyTestNow) };
  const model = context({ 'healthDocuments/ready': pending,
    'healthDocuments/foreign': { ...pending, familyId: 'foreign-family', ownerProfileId: 'foreign', createdBy: 'foreign-parent', storagePath: 'healthDocuments/foreign/foreign-parent/test.pdf' },
    'healthDocuments/forged': { ...pending, ownerProfileId: 'foreign', storagePath: 'healthDocuments/forged/parent/test.pdf' } });
  const result = await retryHealthDocumentDeletes(model);
  assert.equal(result.deleted, 1);
  assert.deepEqual(model.bucket.deletes, ['healthDocuments/ready/parent/test.pdf']);
  assert.equal(model.rows.has('healthDocuments/foreign'), true);
  assert.equal(model.rows.has('healthDocuments/forged'), true);
});
