import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validateHouseholdConfig, buildHouseholdMigrationPlan } from '../scripts/lib/household-migration-plan.mjs';
import { HOUSEHOLD_FIELDS, STORAGE_PREFIXES } from '../scripts/lib/household-migration-inventory.mjs';
import { canReadFinanceBill } from '../server/finance-model.mjs';
import { deriveNotificationEvent } from '../server/notification-events.mjs';

const FAMILY = 'family-11111111-2222-4333-8444-555555555555';
const UPLOAD = 'aaaaaaaa-1111-4222-8333-444444444444';
const hash = value => createHash('sha256').update(value).digest('hex');
const version = () => ({ seconds: '1791849600', nanoseconds: 123 });
const config = () => ({ schemaVersion: 1, projectId: 'demo-household-audit', bucket: 'demo-household-audit.firebasestorage.app',
  householdConfirmed: true, familyId: FAMILY, members: [
    { uid: 'parent-one', expectedName: 'Parent A', expectedRole: 'parent', expectedCanLogin: true, expectedPersonKey: 'parent-a' },
    { uid: 'parent-two', expectedName: 'Parent B', expectedRole: 'parent', expectedCanLogin: true, expectedPersonKey: 'parent-b' },
    { uid: 'child-one', expectedName: 'Child A', expectedRole: 'child', expectedCanLogin: true, expectedPersonKey: 'child-a' },
    { uid: 'child-two', expectedName: 'Child B', expectedRole: 'child', expectedCanLogin: true, expectedPersonKey: 'child-b' },
    { uid: 'passive-one', expectedName: 'Passive', expectedRole: 'child', expectedCanLogin: false, expectedPersonKey: 'passive' },
  ], reviewedRecordPaths: [] });
function fixture() {
  const c = config(), collections = Object.fromEntries(Object.keys(HOUSEHOLD_FIELDS).map(name => [name, []]));
  for (const member of c.members) {
    collections.members.push({ id: member.uid, path: `members/${member.uid}`, data: { name: member.expectedName,
      personKey: member.expectedPersonKey, role: member.expectedRole, canLogin: member.expectedCanLogin, active: true }, updateTime: version() });
    collections[`notificationInbox/${member.uid}/items`] = [];
  }
  const inventory = { schemaVersion: 1, projectId: c.projectId, bucket: c.bucket, source: 'offline', collections,
    auth: c.members.map(member => ({ uid: member.uid, exists: member.expectedCanLogin, disabled: false })), storage: [],
    coverage: { complete: true, missingCollections: [], collections: Object.keys(collections), storagePrefixes: [...STORAGE_PREFIXES], authVerified: true } };
  const add = (collection, id, data) => {
    const row = { id, path: `${collection}/${id}`, data, updateTime: version() };
    collections[collection].push(row); return row;
  };
  return { c, inventory, add, run: () => buildHouseholdMigrationPlan(c, inventory, { now: '2026-10-13T08:00:00Z' }) };
}
const codes = plan => plan.blockers.map(item => item.code);
function addFinance(f, changes = {}) {
  const bill = f.add('financeBills', 'bill-one', { ownerUid: 'parent-one', familyId: '__legacy__', sharedWith: ['child-one'],
    seriesId: 'bill-one', periodIndex: 0, archived: false, ...changes });
  const audit = f.add('financeBillAudit', 'audit-one', { actorUid: 'parent-one', billId: 'bill-one', familyId: '__legacy__', kind: 'created' });
  return { bill, audit };
}
function addRewardImage(f) {
  const path = `taskRewardImages/reward-one/parent-one/${UPLOAD}.png`;
  const reward = f.add('taskRewards', 'reward-one', { createdBy: 'parent-one', people: ['child-a'], active: true, imageUploadId: UPLOAD, imagePath: path });
  const ticket = f.add('_taskRewardImageUploads', UPLOAD, { uid: 'parent-one', rewardId: 'reward-one', people: ['child-a'], active: true,
    path, state: 'attached', contentType: 'image/png', size: 42 });
  const file = { path, exists: true, generation: '1', metageneration: '2', size: 42, contentType: 'image/png',
    links: { rewardId: 'reward-one', uploadId: UPLOAD, uploaderUid: 'parent-one' } };
  f.inventory.storage.push(file);
  return { reward, ticket, file };
}
function addHealth(f, attachment = true) {
  const path = `healthDocuments/doc-one/parent-one/${UPLOAD}.pdf`;
  const document = f.add('healthDocuments', 'doc-one', { ownerProfileId: 'child-one', ownerUid: 'child-one', ownerPersonKey: 'child-a',
    createdBy: 'parent-one', readers: ['parent-one', 'parent-two'], editors: ['parent-one'], state: 'ready', storagePath: path,
    size: 42, mimeType: 'application/pdf', ...(attachment ? { familyId: null, attachmentKind: 'health-record', attachmentRecordId: 'visit-one', attachmentPrivate: true } : {}) });
  const record = attachment ? f.add('healthRecords', 'visit-one', { createdBy: 'parent-one', person: 'child-a', familyId: null,
    attachmentDocumentId: 'doc-one', privateToParents: true }) : null;
  f.inventory.storage.push({ path, exists: true, generation: '1', metageneration: '1', size: 42, contentType: 'application/pdf', links: {} });
  return { document, record };
}

test('five explicit synthetic UIDs require attestation and a metadata-only read-only plan', () => {
  const f = fixture(), before = structuredClone(f.inventory), plan = f.run();
  assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.canApply, false); assert.equal(plan.mode, 'dry-run'); assert.equal(plan.writesPerformed, 0);
  assert.equal(plan.changes.length, 5); assert.equal(plan.familyId, FAMILY);
  assert.ok(plan.warnings.some(item => item.code === 'OPERATOR_ATTESTATION_IS_NOT_INDEPENDENT_HOUSEHOLD_PROOF'));
  assert.deepEqual(f.inventory, before);
});
test('config rejects credentials, unknown fields and missing operator confirmation without echoing input', () => {
  for (const extra of [{ password: 'secret-never-return' }, { token: 'secret-never-return' }, { householdConfirmed: false }, { householdConfirmed: undefined }]) {
    assert.throws(() => validateHouseholdConfig({ ...config(), ...extra }), error => /^[A-Z_]+$/.test(error.code) && !error.message.includes('secret'));
  }
});
test('config validates exactly five unique concrete UIDs and two login parents', () => {
  const variants = [c => c.members.pop(), c => c.members[4].uid = c.members[0].uid,
    c => c.members[2].uid = 'REPLACE_UID', c => c.members[0].expectedCanLogin = false,
    c => c.members[1].expectedRole = 'adult', c => c.members[2].uid = 'uid/escape', c => c.members[2].password = 'secret'];
  for (const change of variants) { const c = config(); change(c); assert.throws(() => validateHouseholdConfig(c)); }
});
test('config rejects reserved/malformed family IDs and review paths outside Finance', () => {
  for (const familyId of ['__legacy__', '', ' family-one', '_group', 'group/path', 42]) assert.throws(() => validateHouseholdConfig({ ...config(), familyId }));
  assert.throws(() => validateHouseholdConfig({ ...config(), reviewedRecordPaths: ['members/parent-one'] }));
  assert.throws(() => validateHouseholdConfig({ ...config(), reviewedRecordPaths: ['financeBills/one', 'financeBills/one'] }));
});
test('member identities and actual Auth metadata must match each expected UID', () => {
  for (const mutate of [f => f.inventory.collections.members[0].data.name = 'Different',
    f => f.inventory.collections.members[0].data.role = 'adult', f => f.inventory.collections.members[1].data.canLogin = false,
    f => f.inventory.auth[0].exists = false, f => f.inventory.auth[0].disabled = true,
    f => f.inventory.collections.members[0].data.active = false]) {
    const f = fixture(); mutate(f); assert.equal(f.run().status, 'blocked');
  }
});
test('passive profile without an Auth account remains a profile without login', () => {
  const f = fixture(); assert.equal(f.inventory.auth.at(-1).exists, false); const plan = f.run();
  assert.equal(plan.status, 'prepared-requires-approval'); assert.equal(plan.preservation.authWrites, 0);
});
test('preassigned, invalid and reserved membership never gets silently moved', () => {
  for (const familyId of ['foreign-family', '__legacy__', '_invalid']) {
    const f = fixture(); f.inventory.collections.members[0].data.familyId = familyId;
    const plan = f.run(); assert.ok(codes(plan).includes('MEMBER_ALREADY_ASSIGNED_OR_INVALID'));
    assert.equal(plan.changes.some(change => change.path === 'members/parent-one'), false);
  }
});
test('foreign UID with same personKey or candidate household ID blocks ambiguous ownership', () => {
  for (const data of [{ personKey: 'child-a', familyId: 'foreign-family' }, { personKey: 'foreign-person', familyId: FAMILY }]) {
    const f = fixture(); f.add('members', 'foreign', data); assert.equal(f.run().status, 'blocked');
  }
});
test('incomplete scans, missing collections, absent Auth checks and Storage prefixes block preparation', () => {
  for (const mutate of [f => f.inventory.coverage.complete = false, f => delete f.inventory.collections.tasks,
    f => f.inventory.coverage.collections.pop(), f => f.inventory.coverage.authVerified = false,
    f => f.inventory.coverage.storagePrefixes.pop()]) { const f = fixture(); mutate(f); assert.equal(f.run().status, 'blocked'); }
});

for (const [httpStatus, status, code] of [[404, 'not-found', 'STORAGE_BUCKET_NOT_FOUND'], [403, 'forbidden', 'STORAGE_ACCESS_DENIED']]) {
  test(`Storage HTTP ${httpStatus} blocks migration even with no file references and otherwise complete Firestore/Auth`, () => {
    const f = fixture();
    f.inventory.coverage.complete = false;
    f.inventory.coverage.missingCollections = ['storage'];
    f.inventory.coverage.storagePrefixes = [];
    f.inventory.coverage.storageCheck = { verified: false, status, code, httpStatus };
    const plan = f.run();
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.canApply, false); assert.equal(plan.writesPerformed, 0);
    assert.equal(plan.summary.membersVerified, 5); assert.equal(plan.summary.storageVerified, false);
    assert.ok(codes(plan).includes(code));
    assert.ok(!codes(plan).includes('STORAGE_OBJECT_MISSING'));
    assert.equal(plan.changes.length, 5, 'Keep reviewable candidate Firestore changes without allowing them to be applied');
  });
}

test('planner independently rejects a Storage failure disguised as complete coverage', () => {
  const f = fixture();
  f.inventory.coverage.storageCheck = { verified: false, status: 'not-found', code: 'STORAGE_BUCKET_NOT_FOUND', httpStatus: 404 };
  const plan = f.run();
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.storageVerified, false);
  assert.ok(codes(plan).includes('STORAGE_BUCKET_NOT_FOUND'));
  f.inventory.coverage.storageCheck.verified = true;
  assert.ok(codes(f.run()).includes('STORAGE_COVERAGE_INVALID'));
});

test('a referenced file in an unread prefix is unverified, never reported as confirmed missing', () => {
  const f = fixture();
  addHealth(f);
  f.inventory.storage = [];
  f.inventory.coverage.complete = false;
  f.inventory.coverage.missingCollections = ['storage'];
  f.inventory.coverage.storagePrefixes = [];
  f.inventory.coverage.storageCheck = { verified: false, status: 'forbidden', code: 'STORAGE_ACCESS_DENIED', httpStatus: 403 };
  const plan = f.run();
  assert.equal(plan.status, 'blocked');
  assert.ok(codes(plan).includes('STORAGE_OBJECT_NOT_VERIFIED'));
  assert.ok(!codes(plan).includes('STORAGE_OBJECT_MISSING'));
});

function presentationFile(f, path, contentType = 'image/png') {
  f.inventory.storage.push({ path, exists: true, generation: '1', metageneration: '1', size: 68, contentType, links: {} });
  return `https://firebasestorage.googleapis.com/v0/b/${f.c.bucket}/o/${encodeURIComponent(path)}?token=POISON_TOKEN`;
}

test('quick-product photos are verified without rewriting the product or exposing its bearer token', () => {
  const f = fixture();
  const path = 'quick-products/parent-one/test-product.gif';
  f.add('quickProducts', 'test-product', { imageURL: presentationFile(f, path, 'image/gif') });
  const plan = f.run();
  assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.summary.fileSources['firebase-storage'], 1);
  assert.ok(plan.warnings.some(item => item.code === 'STORAGE_BEARER_URL_PRESENT'));
  assert.equal(plan.changes.some(change => change.path === 'quickProducts/test-product'), false);
  assert.equal(JSON.stringify(plan).includes('POISON'), false);
  f.inventory.storage = [];
  assert.ok(codes(f.run()).includes('STORAGE_OBJECT_MISSING'));
});

test('an unscanned product-photo prefix blocks a seemingly complete Storage scan', () => {
  const f = fixture();
  f.inventory.coverage.storagePrefixes = STORAGE_PREFIXES.filter(prefix => prefix !== 'quick-products/');
  const plan = f.run();
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.storageVerified, false);
  assert.ok(plan.blockers.some(item => item.code === 'STORAGE_PREFIX_NOT_VERIFIED' && item.path === 'quick-products/'));
});

test('a family avatar must refer to a real verified file and is never automatically adopted', () => {
  const f = fixture();
  const path = `avatars/family/parent-one/${UPLOAD}.png`;
  presentationFile(f, path);
  const row = f.add('familySettings', 'profile', { updatedBy: 'parent-two', avatarSource: 'custom', avatarPath: path });
  assert.equal(f.run().status, 'prepared-requires-approval');
  assert.equal(f.run().changes.some(change => change.path === row.path), false);
  f.inventory.storage = [];
  assert.ok(codes(f.run()).includes('STORAGE_OBJECT_MISSING'));
  row.data.updatedBy = 'foreign-parent';
  assert.ok(codes(f.run()).includes('FAMILY_AVATAR_OWNER_NOT_VERIFIED'));
});

test('a URL referencing another bucket cannot be verified by an empty or complete scan of the selected bucket', () => {
  const f = fixture();
  f.add('quickProducts', 'legacy', { imageURL: 'https://firebasestorage.googleapis.com/v0/b/other-bucket.appspot.com/o/quick-products%2Fparent-one%2Ftest.png?token=POISON' });
  const plan = f.run();
  assert.equal(plan.status, 'blocked');
  assert.ok(codes(plan).includes('FILE_SOURCE_BUCKET_NOT_VERIFIED'));
  assert.equal(plan.changes.some(change => change.path === 'quickProducts/legacy'), false);
  assert.equal(JSON.stringify(plan).includes('POISON'), false);
});

test('Google avatars and local assets are counted as separate, unrequested sources', () => {
  const f = fixture();
  f.inventory.collections.members[0].data.photoURL = 'https://lh3.googleusercontent.com/POISON_PHOTO';
  f.add('quickProducts', 'asset', { imageURL: '/wojanek-product.png' });
  const plan = f.run();
  assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.summary.storageScope, 'known-app-prefixes');
  assert.equal(plan.summary.fileSources['google-avatar'], 1);
  assert.equal(plan.summary.fileSources['app-asset'], 1);
  assert.ok(plan.warnings.some(item => item.code === 'NON_STORAGE_FILE_SOURCE_NOT_FETCHED'));
  assert.equal(JSON.stringify(plan).includes('POISON'), false);
});

test('ephemeral files and URL-only medical documents require review rather than pretending a protected file was verified', () => {
  for (const source of ['blob:https://example.invalid/POISON', 'data:image/png;base64,POISON',
    'https://external.invalid/POISON_MEDICAL', 'https://storage.googleapis.com/demo-household-audit.firebasestorage.app/health/shared/child-a/parent-one/test.pdf?token=POISON']) {
    const f = fixture();
    f.add('healthRecords', 'legacy-file', { person: 'child-a', createdBy: 'parent-one', documentURL: source });
    const plan = f.run();
    assert.equal(plan.status, 'blocked');
    assert.ok(codes(plan).some(code => ['FILE_SOURCE_REQUIRES_REVIEW', 'LEGACY_HEALTH_URL_REQUIRES_REVIEW'].includes(code)));
    assert.equal(JSON.stringify(plan).includes('POISON'), false);
  }
});

test('conflicting avatar path/URL and product ownership remain blocked without changing data', () => {
  const f = fixture();
  const path = `avatars/members/parent-one/parent-one/${UPLOAD}.png`;
  const member = f.inventory.collections.members[0];
  member.data.photoURL = presentationFile(f, path);
  member.data.avatarPath = `avatars/members/parent-one/parent-one/different.png`;
  assert.ok(codes(f.run()).includes('FILE_SOURCE_PATH_MISMATCH'));
  f.add('quickProducts', 'foreign-owner', { imageURL: presentationFile(f, 'quick-products/foreign-parent/test.png') });
  assert.ok(codes(f.run()).includes('QUICK_PRODUCT_OWNER_NOT_VERIFIED'));
});

test('unreferenced presentation objects are reported for review, never scheduled for deletion', () => {
  const f = fixture();
  presentationFile(f, 'quick-products/parent-one/old-product.png');
  const plan = f.run();
  assert.equal(plan.status, 'prepared-requires-approval');
  assert.ok(plan.warnings.some(item => item.code === 'STORAGE_UNREFERENCED_PRESENTATION_FILE'));
  assert.equal(plan.preservation.storageWrites, 0);
});

test('additional active membership cannot appear migration-ready while legacy modules remain project-wide', () => {
  const f = fixture();
  const row = f.add('members', 'foreign-active', { name: 'Unreviewed adult', personKey: 'other-adult',
    active: true, canLogin: true, role: 'parent', familyId: 'other-household' });
  const plan = f.run();
  assert.equal(plan.status, 'blocked');
  assert.ok(codes(plan).includes('ADDITIONAL_ACTIVE_MEMBER_REQUIRES_ISOLATION_REVIEW'));
  assert.equal(plan.changes.some(change => change.path === row.path), false);
  row.data.disabled = true;
  assert.ok(codes(f.run()).includes('ADDITIONAL_ACTIVE_MEMBER_REQUIRES_ISOLATION_REVIEW'), 'A presentation disabled flag does not revoke a valid token in legacy Rules');
  row.data.archived = true;
  assert.ok(!codes(f.run()).includes('ADDITIONAL_ACTIVE_MEMBER_REQUIRES_ISOLATION_REVIEW'));
});

test('avatar verification matches the application UUID filename and 5 MiB download limit', () => {
  for (const kind of ['member-path', 'family-path', 'member-url', 'family-url']) {
    const f = fixture();
    const family = kind.startsWith('family'), urlOnly = kind.endsWith('url');
    const badPath = family ? 'avatars/family/parent-one/test.png' : 'avatars/members/parent-one/parent-one/test.png';
    const url = presentationFile(f, badPath);
    const row = family ? f.add('familySettings', 'profile', { updatedBy: 'parent-one' }) : f.inventory.collections.members[0];
    row.data[urlOnly ? 'photoURL' : 'avatarPath'] = urlOnly ? url : badPath;
    assert.ok(codes(f.run()).includes(family ? 'FAMILY_AVATAR_OWNER_NOT_VERIFIED' : 'MEMBER_AVATAR_PATH_NOT_VERIFIED'));
    const goodPath = badPath.replace('test.png', `${UPLOAD}.png`);
    f.inventory.storage[0].path = goodPath;
    f.inventory.storage[0].size = 5 * 1024 * 1024 + 1;
    row.data[urlOnly ? 'photoURL' : 'avatarPath'] = urlOnly
      ? `https://storage.googleapis.com/${f.c.bucket}/${goodPath}` : goodPath;
    assert.ok(codes(f.run()).includes('STORAGE_FILE_SIZE_EXCEEDS_APP_LIMIT'));
    f.inventory.storage[0].size = 5 * 1024 * 1024;
    assert.equal(f.run().status, 'prepared-requires-approval');
  }
});
test('proven Tasks roots/ledger/balance get only familyId without minting or recomputing points', () => {
  const f = fixture(); f.add('tasks', 'task-one', { createdBy: 'parent-one', person: 'child-a', points: 9, done: true });
  f.add('taskCompletions', 'task-one', { taskId: 'task-one', person: 'child-a', submittedBy: 'child-one', approvedBy: 'parent-one', points: 9 });
  f.add('taskPointLedger', hash('task:task-one'), { taskId: 'task-one', actorUid: 'parent-one', person: 'child-a', delta: 9, kind: 'earned' });
  f.add('taskPointBalances', `person-${hash('child-a')}`, { person: 'child-a', balance: 9, earned: 9, spent: 0 });
  const before = structuredClone(f.inventory), plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.changes.length, 9); assert.ok(plan.changes.every(change => change.field === 'familyId'));
  assert.equal(plan.preservation.pointRecalculations, 0); assert.deepEqual(f.inventory, before);
  assert.equal(JSON.stringify(plan).includes('"delta"'), false); assert.equal(JSON.stringify(plan).includes('"balance"'), false);
});
test('person-only legacy root, missing ledger link and unanchored balance are ambiguous', () => {
  for (const add of [f => f.add('tasks', 'task-one', { person: 'child-a' }),
    f => f.add('taskPointLedger', hash('task:missing'), { taskId: 'missing', actorUid: 'parent-one', person: 'child-a' }),
    f => f.add('taskPointBalances', `person-${hash('child-a')}`, { person: 'child-a' })]) {
    const f = fixture(); add(f); assert.equal(f.run().status, 'blocked');
  }
});
test('foreign valid household records are preserved while mixed ownership blocks reassignment', () => {
  const f = fixture(); f.add('members', 'foreign-parent', { name: 'Foreign', personKey: 'foreign', familyId: 'foreign-family' });
  f.add('tasks', 'foreign-task', { familyId: 'foreign-family', createdBy: 'foreign-parent', person: 'foreign' });
  const first = f.run(); assert.equal(first.status, 'prepared-requires-approval'); assert.equal(first.changes.length, 5);
  f.add('tasks', 'mixed-task', { familyId: 'foreign-family', createdBy: 'parent-one', person: 'child-a' });
  assert.ok(codes(f.run()).includes('EXISTING_FAMILY_CONFLICT'));
});
test('Finance legacy adoption requires individual review for both bill and audit', () => {
  const f = fixture(), { bill, audit } = addFinance(f);
  assert.ok(codes(f.run()).includes('FINANCE_INDIVIDUAL_REVIEW_REQUIRED'));
  f.c.reviewedRecordPaths = [bill.path]; assert.equal(f.run().status, 'blocked');
  f.c.reviewedRecordPaths.push(audit.path); const plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.changes.length, 7); assert.equal(plan.changes.find(change => change.path === bill.path).before.value, '__legacy__');
});
test('Finance adopted explicit household gives both parents same bill and only its selected child access', () => {
  const f = fixture(), { bill, audit } = addFinance(f); f.c.reviewedRecordPaths = [bill.path, audit.path];
  const plan = f.run(), household = { ...bill.data, familyId: plan.familyId };
  const profiles = f.inventory.collections.members.map(row => ({ id: row.id, ...row.data, familyId: plan.familyId }));
  assert.equal(canReadFinanceBill(profiles[0], household), true); assert.equal(canReadFinanceBill(profiles[1], household), true);
  assert.equal(canReadFinanceBill(profiles[2], household), true); assert.equal(canReadFinanceBill(profiles[3], household), false);
  assert.equal(canReadFinanceBill({ ...profiles[0], id: 'foreign', familyId: 'foreign-family' }, household), false);
});
test('Finance foreign owner, foreign child, nonchild share and audit actor are never adopted', () => {
  for (const mutate of [(bill) => bill.data.ownerUid = 'foreign', bill => bill.data.sharedWith.push('foreign'),
    bill => bill.data.sharedWith = ['parent-two'], (_, audit) => audit.data.actorUid = 'foreign']) {
    const f = fixture(), { bill, audit } = addFinance(f); f.c.reviewedRecordPaths = [bill.path, audit.path]; mutate(bill, audit);
    assert.equal(f.run().status, 'blocked');
  }
});
test('Finance sharing a passive or revoked child blocks the plan without dropping the original per-bill ACL', () => {
  for (const change of [{ uid: 'passive-one' }, { uid: 'child-one', canLogin: false },
    { uid: 'child-one', active: false }, { uid: 'child-one', archived: true }, { uid: 'child-one', disabled: true }]) {
    const f = fixture(), { bill, audit } = addFinance(f, { sharedWith: [change.uid] });
    f.c.reviewedRecordPaths = [bill.path, audit.path];
    const member = f.inventory.collections.members.find(row => row.id === change.uid);
    for (const [key, value] of Object.entries(change)) if (key !== 'uid') member.data[key] = value;
    const before = structuredClone(bill.data.sharedWith), plan = f.run();
    assert.ok(codes(plan).includes('FINANCE_OWNER_OR_SHARE_NOT_VERIFIED'));
    assert.equal(plan.status, 'blocked'); assert.deepEqual(bill.data.sharedWith, before);
    assert.equal(plan.changes.some(entry => entry.path === bill.path), false);
  }
});
test('recurring Finance IDs stay stable and a contradictory period cannot be imported', () => {
  const f = fixture(), { bill, audit } = addFinance(f), periodId = `period-${hash('bill-one:1')}`;
  const period = f.add('financeBills', periodId, { ...bill.data, periodIndex: 1, sharedWith: [] });
  f.c.reviewedRecordPaths = [bill.path, audit.path, period.path]; assert.equal(f.run().status, 'prepared-requires-approval');
  period.data.ownerUid = 'parent-two'; assert.ok(codes(f.run()).includes('FINANCE_SERIES_NOT_VERIFIED'));
});
test('attached reward image patches reciprocal ticket and reward together, with existing object/version/link checks', () => {
  const f = fixture(); addRewardImage(f); const plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.changes.length, 7); assert.equal(plan.preservation.storageWrites, 0);
});
test('missing file, wrong metadata link, size, generation and mismatched reciprocal reward refs block', () => {
  for (const mutate of [(r, t, f) => f.exists = false, (r, t, f) => f.links.uploadId = 'other',
    (r, t, f) => f.size = 40, (r, t, f) => f.generation = '', (r, t) => r.data.imagePath = 'other']) {
    const f = fixture(), { reward, ticket, file } = addRewardImage(f); mutate(reward, ticket, file); assert.equal(f.run().status, 'blocked');
  }
});
test('submitted photo proof patches ticket and task preserving pending review and real file', () => {
  const f = fixture(), path = `taskProof/task-one/child-one/${UPLOAD}.png`;
  f.add('tasks', 'task-one', { createdBy: 'parent-one', person: 'child-a', proofUploadId: UPLOAD, proofPath: path, submittedBy: 'child-one', approvalStatus: 'pending' });
  f.add('_taskPhotoUploads', UPLOAD, { taskId: 'task-one', uid: 'child-one', person: 'child-a', path, state: 'submitted', contentType: 'image/png', size: 42 });
  f.inventory.storage.push({ path, exists: true, generation: '1', metageneration: '1', size: 42, contentType: 'image/png', links: { taskId: 'task-one', uploadId: UPLOAD, uploaderUid: 'child-one' } });
  const plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval'); assert.equal(plan.changes.length, 7);
});
test('open uploads and pending cleanup require an explicit quiescent maintenance window', () => {
  const f = fixture(), { ticket } = addRewardImage(f); ticket.data.state = 'open';
  assert.ok(codes(f.run()).includes('ACTIVE_UPLOAD_REQUIRES_MAINTENANCE_WINDOW'));
  const other = fixture(); other.add('_taskPhotoCleanup', 'cleanup', { state: 'pending' });
  assert.ok(codes(other.run()).includes('PENDING_FILE_CLEANUP_REQUIRES_MAINTENANCE_WINDOW'));
});
test('linked health attachment migrates familyId on both sides without changing private ACLs', () => {
  const f = fixture(); addHealth(f); const before = structuredClone(f.inventory), plan = f.run();
  assert.equal(plan.status, 'prepared-requires-approval'); assert.equal(plan.changes.length, 7);
  assert.equal(plan.preservation.aclChanges, 0); assert.deepEqual(f.inventory, before);
});
test('missing/reversed health link, foreign reader and draft document block unsafe access changes', () => {
  for (const mutate of [(d, r) => r.data.attachmentDocumentId = 'other', d => d.data.readers.push('foreign'),
    d => d.data.state = 'draft', d => d.data.attachmentRecordId = 'missing', d => d.data.storagePath = 'healthDocuments/doc-one/child-one/file.pdf']) {
    const f = fixture(), { document, record } = addHealth(f); mutate(document, record); assert.equal(f.run().status, 'blocked');
  }
});
test('standalone adult health document and consent grant stay untouched with their precise ACLs', () => {
  const f = fixture(); addHealth(f, false);
  f.add('healthDocumentGrants', 'child-one', { ownerProfileId: 'child-one', ownerUid: 'child-one', authorizedUids: ['parent-one'],
    grants: [{ uid: 'parent-one', basis: 'consent', canEdit: true, authorizedBy: 'child-one' }] });
  const before = structuredClone(f.inventory), plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.changes.length, 5); assert.deepEqual(f.inventory, before);
});
test('calendar, private Google provenance, school and inbox are inventoried but never changed', () => {
  const f = fixture();
  f.add('privateCalendarEvents', 'google-event', { ownerUid: 'parent-one', createdBy: 'parent-one', person: 'parent-a', private: true,
    source: 'google', sourceOwnerUid: 'parent-one', sourceConnectionId: 'connection-one', externalEventId: 'opaque-provider-event' });
  f.add('_calendarConnections', 'connection-one', { ownerUid: 'parent-one', ownerProfileId: 'parent-one', provider: 'google' });
  f.add('calendarEvents', 'manual-event', { createdBy: 'parent-two', person: 'family', private: false });
  f.add('schoolItems', 'school-event', { person: 'child-a', sourceOwnerUid: 'parent-one', sourceProfileId: 'provider-not-member-uid', sourceConnectionId: 'family' });
  f.add('notificationInbox/parent-one/items', 'inbox-one', { eventId: 'stable-finance-event', recordId: 'one', category: 'important', module: 'Finanse', starred: true, read: true });
  const before = structuredClone(f.inventory), plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.changes.length, 5); assert.equal(plan.preservation.calendarWrites, 0); assert.equal(plan.preservation.notificationWrites, 0);
  assert.deepEqual(f.inventory, before); assert.equal(JSON.stringify(plan).includes('opaque-provider-event'), false);
});
test('private calendar linked to selected person but owned by foreign UID is a blocker, not a visibility rewrite', () => {
  const f = fixture(); f.add('privateCalendarEvents', 'private-event', { ownerUid: 'foreign', createdBy: 'parent-one', person: 'child-a', private: true });
  const plan = f.run(); assert.equal(plan.status, 'blocked'); assert.equal(plan.changes.some(change => change.path.includes('Calendar')), false);
});
test('adding only familyId metadata does not manufacture notifications', () => {
  const before = { title: 'Synthetic task', person: 'child-a', done: false, createdBy: 'parent-one' };
  assert.equal(deriveNotificationEvent('tasks', 'task-one', before, { ...before, familyId: FAMILY }), null);
  assert.equal(deriveNotificationEvent('healthRecords', 'health-one', before, { ...before, familyId: FAMILY }), null);
  assert.equal(deriveNotificationEvent('calendarEvents', 'calendar-one', before, { ...before, familyId: FAMILY }), null);
});
test('repeat with same proposed familyId is deterministic; already migrated records produce zero changes', () => {
  const f = fixture(); addRewardImage(f); addHealth(f);
  const first = f.run(); assert.deepEqual(f.run(), first);
  for (const change of first.changes) f.inventory.collections[change.path.split('/')[0]].find(row => row.path === change.path).data.familyId = FAMILY;
  const repeated = f.run(); assert.equal(repeated.status, 'prepared-requires-approval'); assert.equal(repeated.changes.length, 0);
});
test('rollback retains absence versus null and requires actual post-apply version plus no concurrent change', () => {
  const f = fixture(); f.inventory.collections.members[1].data.familyId = null; const plan = f.run();
  assert.deepEqual(plan.rollback.find(change => change.path === 'members/parent-one').after, { present: false });
  assert.deepEqual(plan.rollback.find(change => change.path === 'members/parent-two').after, { present: true, value: null });
  assert.ok(plan.rollback.every(change => change.conditions.familyIdEquals === FAMILY && change.conditions.postApplyUpdateTimeRequired && change.conditions.noConcurrentChanges));
});
test('missing document updateTime blocks plan instead of authorizing blind writes', () => {
  const f = fixture(); delete f.inventory.collections.members[0].updateTime;
  const plan = f.run(); assert.ok(codes(plan).includes('DOCUMENT_VERSION_NOT_VERIFIED'));
  assert.equal(plan.changes.some(change => change.path === 'members/parent-one'), false);
});
test('more than 450 proposed changes rejects uncoordinated non-atomic migration', () => {
  const f = fixture(); for (let index = 0; index < 446; index++) f.add('tasks', `task-${index}`, { createdBy: 'parent-one', person: 'child-a' });
  assert.ok(codes(f.run()).includes('ATOMIC_PLAN_TOO_LARGE'));
});
test('storage bearer token presence is only a warning and never leads to token changes', () => {
  const f = fixture(), { file } = addRewardImage(f); file.hasDownloadToken = true;
  const plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval');
  assert.ok(plan.warnings.some(item => item.code === 'STORAGE_BEARER_DOWNLOAD_TOKEN_PRESENT')); assert.equal(plan.preservation.storageWrites, 0);
});
test('foreign household files with their explicit foreign tickets remain outside the target patch', () => {
  const f = fixture(), path = `taskRewardImages/foreign-reward/foreign-parent/${UPLOAD}.png`;
  f.add('members', 'foreign-parent', { familyId: 'foreign-family', personKey: 'foreign' });
  f.add('taskRewards', 'foreign-reward', { familyId: 'foreign-family', createdBy: 'foreign-parent', people: [] });
  f.add('_taskRewardImageUploads', UPLOAD, { familyId: 'foreign-family', rewardId: 'foreign-reward', uid: 'foreign-parent', state: 'attached', path });
  f.inventory.storage.push({ path, exists: true, generation: '1', metageneration: '1', size: 42, contentType: 'image/png', links: {} });
  const plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval'); assert.equal(plan.changes.length, 5);
});
test('member avatar existence is checked and never copied, replaced or removed', () => {
  const f = fixture(), path = `avatars/members/child-one/parent-one/${UPLOAD}.png`;
  f.inventory.collections.members[2].data.avatarPath = path;
  assert.ok(codes(f.run()).includes('STORAGE_OBJECT_MISSING'));
  f.inventory.storage.push({ path, exists: true, generation: '1', metageneration: '1', size: 42, contentType: 'image/png', links: {} });
  const plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval'); assert.equal(plan.preservation.storageWrites, 0);
});
test('already scoped preserved calendar metadata does not falsely collide on repeated dry-run', () => {
  const f = fixture(); f.add('calendarEvents', 'event-one', { familyId: FAMILY, createdBy: 'parent-one', person: 'family' });
  const plan = f.run(); assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.changes.some(change => change.path === 'calendarEvents/event-one'), false);
});
test('upload filename must match Storage UUID.extension exactly rather than a prefix and ending', () => {
  const f = fixture(), { reward, ticket, file } = addRewardImage(f);
  const incorrect = file.path.replace('.png', '.extra.png');
  reward.data.imagePath = incorrect; ticket.data.path = incorrect; file.path = incorrect;
  assert.ok(codes(f.run()).includes('UPLOAD_STATE_OR_PATH_NOT_VERIFIED'));
});
test('existing health-calendar linkage must preserve the actual health source, person and owner', () => {
  const f = fixture(), { record } = addHealth(f); record.data.calendarEventId = 'health-calendar';
  const event = f.add('calendarEvents', 'health-calendar', { source: 'health', sourceRecordId: record.id,
    person: 'child-a', ownerProfileId: 'child-one', createdBy: 'parent-one' });
  assert.equal(f.run().status, 'prepared-requires-approval');
  for (const change of [{ sourceRecordId: 'other-visit' }, { person: 'child-b' }, { ownerProfileId: 'foreign' }, { source: 'manual' }, { createdBy: 'foreign' }]) {
    const before = { ...event.data }; Object.assign(event.data, change);
    assert.ok(codes(f.run()).includes('HEALTH_CALENDAR_LINK_NOT_VERIFIED')); event.data = before;
  }
});
test('Storage metadata version and supported content type are required for a referenced object', () => {
  for (const change of [{ metageneration: undefined }, { contentType: undefined }, { contentType: 'application/octet-stream' }]) {
    const f = fixture(), { file } = addRewardImage(f); Object.assign(file, change); assert.equal(f.run().status, 'blocked');
  }
});
test('preparation clearly distinguishes metadata inventory from a coordinated snapshot, deployed-rules check and backup', () => {
  const plan = fixture().run(); assert.equal(plan.status, 'prepared-requires-approval');
  for (const code of ['METADATA_SNAPSHOT_NOT_ATOMIC', 'DEPLOYED_RULES_NOT_VERIFIED', 'FULL_DOCUMENT_AND_BINARY_BACKUP_NOT_CAPTURED']) {
    assert.ok(plan.warnings.some(item => item.code === code));
  }
});
