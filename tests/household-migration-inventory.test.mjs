import test from 'node:test';
import assert from 'node:assert/strict';
import { collectHouseholdInventory, HOUSEHOLD_FIELDS, INBOX_FIELDS, projectedHouseholdData, sanitizeHouseholdSnapshot, STORAGE_FIELDS, STORAGE_PREFIXES } from '../scripts/lib/household-migration-inventory.mjs';

const config = { schemaVersion: 1, projectId: 'demo-nasza-rodzina', bucket: 'demo-nasza-rodzina.appspot.com', householdConfirmed: true,
  members: Array.from({ length: 5 }, (_, index) => ({ uid: `test-migration-${index}`, expectedName: `Test ${index}`,
    expectedRole: index < 2 ? 'parent' : 'child', expectedCanLogin: index !== 4 })) };
const names = () => [...Object.keys(HOUSEHOLD_FIELDS), ...config.members.map(member => `notificationInbox/${member.uid}/items`)];
const version = { seconds: 1791878400, nanoseconds: 123456789 };

function readerFixture(rows = {}, files = []) {
  const calls = [];
  const db = { collection(name) {
    assert.ok(names().includes(name));
    const requested = { name, selected: null, cursor: undefined, limit: 0 };
    const query = {
      select(...fields) { assert.deepEqual(fields, HOUSEHOLD_FIELDS[name] || INBOX_FIELDS); requested.selected = fields; return query; },
      orderBy() { return query; },
      limit(count) { assert.ok(count > 0 && count <= 500); requested.limit = count; return query; },
      startAfter(id) { requested.cursor = id; return query; },
      async get() {
        assert.ok(requested.selected, 'Every Firestore read must be projected');
        calls.push({ type: 'query', ...requested });
        const values = (rows[name] || []).filter(item => requested.cursor === undefined || item.id > requested.cursor).slice(0, requested.limit);
        // Deliberately return extra poisoned fields: the second allowlist still strips them.
        return { docs: values.map(item => ({ id: item.id, data: () => item.data, updateTime: version })) };
      },
    };
    return query;
  } };
  const auth = { async getUser(uid) {
    calls.push({ type: 'auth-read', uid });
    if (uid === config.members[4].uid) throw Object.assign(new Error('synthetic missing Auth'), { code: 'auth/user-not-found' });
    return { uid, disabled: false, passwordHash: 'POISON_PASSWORD_HASH', refreshToken: 'POISON_TOKEN' };
  } };
  const bucket = { async getFiles(options) {
    assert.equal(options.autoPaginate, false);
    assert.equal(options.fields, STORAGE_FIELDS);
    assert.ok(STORAGE_PREFIXES.includes(options.prefix));
    calls.push({ type: 'storage-list', options });
    const matches = files.filter(file => file.name.startsWith(options.prefix));
    const offset = Number(options.pageToken || 0);
    const selected = matches.slice(offset, offset + options.maxResults);
    const next = offset + selected.length < matches.length ? { pageToken: String(offset + selected.length) } : null;
    return [selected, next];
  } };
  // No mutating functions exist. A stray .set/.update/.download/.runTransaction fails immediately.
  return { db, auth, bucket, calls };
}

test('inventory performs only bounded projected reads and strips secrets, clinical text, transfer details and Auth secrets', async () => {
  const context = readerFixture({
    members: [{ id: config.members[0].uid, data: { name: 'Test 0', role: 'parent', email: 'POISON_EMAIL' } }],
    healthDocuments: [{ id: 'test-document', data: { ownerUid: config.members[0].uid, readers: [], title: 'POISON_DIAGNOSIS', number: 'POISON_DOCUMENT_NUMBER', documentURL: 'POISON_URL' } }],
    financeBills: [{ id: 'test-bill', data: { ownerUid: config.members[0].uid, sharedWith: [], bankAccount: 'POISON_BANK' } }],
    _calendarConnections: [{ id: 'test-connection', data: { ownerUid: config.members[0].uid, envelope: { token: 'POISON_OAUTH' }, syncToken: 'POISON_CURSOR' } }],
  }, [{ name: 'taskProof/test-task/test-owner/test-file.png', metadata: { generation: '7', metageneration: '2', size: '68', contentType: 'image/png',
    metadata: { taskId: 'test-task', uploaderUid: 'test-owner', firebaseStorageDownloadTokens: 'POISON_BEARER' } } }]);
  const inventory = await collectHouseholdInventory(context, config);
  assert.equal(inventory.coverage.complete, true);
  assert.equal(inventory.auth.length, 5);
  assert.deepEqual(inventory.auth.at(-1), { uid: config.members[4].uid, exists: false, disabled: false });
  assert.equal(JSON.stringify(inventory).includes('POISON'), false);
  assert.deepEqual(inventory.collections.members[0].updateTime, { seconds: String(version.seconds), nanoseconds: version.nanoseconds });
  assert.equal(inventory.storage[0].generation, '7');
  assert.equal(Object.hasOwn(inventory.storage[0], 'hasDownloadToken'), false, 'Unread bearer tokens must not be reported as absent');
  assert.ok(!context.calls.some(call => call.name === '_eduConnections' || call.name === '_calendarOAuthStates'));
  assert.equal(context.calls.filter(call => call.type === 'auth-read').length, 5);
});

test('Firestore inventory paginates instead of losing linked records after the first page', async () => {
  const context = readerFixture({ tasks: Array.from({ length: 507 }, (_, index) => ({ id: String(index).padStart(5, '0'), data: { person: 'Test person' } })) });
  const inventory = await collectHouseholdInventory(context, config, { maximum: 600 });
  assert.equal(inventory.collections.tasks.length, 507);
  assert.equal(inventory.coverage.complete, true);
  assert.equal(context.calls.filter(call => call.name === 'tasks').length, 2);
});

test('exceeding a document or Storage limit marks an incomplete inventory, never success', async () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({ id: `row-${index}`, data: {} }));
  const files = Array.from({ length: 4 }, (_, index) => ({ name: `taskProof/file-${index}`, metadata: { size: '1' } }));
  const inventory = await collectHouseholdInventory(readerFixture({ tasks: rows }, files), config, { maximum: 3 });
  assert.equal(inventory.coverage.complete, false);
  assert.deepEqual(inventory.coverage.missingCollections.sort(), ['storage', 'tasks']);
  assert.equal(inventory.collections.tasks.length, 3);
  assert.equal(inventory.storage.length, 3);
});

test('Storage inventory follows pages and uses partial JSON metadata responses without fetching files', async () => {
  const files = Array.from({ length: 502 }, (_, index) => ({ name: `healthDocuments/file-${index}`, metadata: { size: '1', generation: '1', metageneration: '1' } }));
  const context = readerFixture({}, files);
  const inventory = await collectHouseholdInventory(context, config, { maximum: 600 });
  assert.equal(inventory.storage.length, 502);
  assert.equal(inventory.coverage.complete, true);
  assert.equal(context.calls.filter(call => call.type === 'storage-list' && call.options.prefix === 'healthDocuments/').length, 2);
});
test('Storage partial responses are raw resources rather than File instances and retain verified custom links', async () => {
  const context = readerFixture({}, [{ name: 'taskProof/test-task/test-owner/test.png', generation: '3', metageneration: '2', size: '68', contentType: 'image/png',
    metadata: { taskId: 'test-task', uploadId: 'test-upload', uploaderUid: 'test-owner', firebaseStorageDownloadTokens: 'POISON_TOKEN' } }]);
  const inventory = await collectHouseholdInventory(context, config);
  assert.deepEqual(inventory.storage[0], { path: 'taskProof/test-task/test-owner/test.png', exists: true, generation: '3', metageneration: '2', size: 68, contentType: 'image/png',
    links: { taskId: 'test-task', uploadId: 'test-upload', uploaderUid: 'test-owner' } });
  assert.equal(JSON.stringify(inventory).includes('POISON'), false);
});

test('failed Auth read aborts rather than treating permissions/network errors as a non-login profile', async () => {
  const context = readerFixture();
  context.auth.getUser = async () => { throw Object.assign(new Error('POISON_SERVER_TOKEN'), { code: 'auth/insufficient-permission' }); };
  await assert.rejects(collectHouseholdInventory(context, config), /AUTH_INVENTORY_FAILED/);
});
test('an Auth lookup returning another UID never verifies the requested profile', async () => {
  const context = readerFixture();
  context.auth.getUser = async () => ({ uid: 'different-household-user', disabled: false });
  await assert.rejects(collectHouseholdInventory(context, config), /AUTH_INVENTORY_FAILED/);
});

test('private offline snapshots lose unknown fields and cannot fabricate a missing collection as complete', () => {
  const raw = { schemaVersion: 1, projectId: config.projectId, bucket: config.bucket, collections: {}, auth: [], storage: [],
    coverage: { complete: true, storagePrefixes: [...STORAGE_PREFIXES], authVerified: true } };
  for (const name of names()) raw.collections[name] = [];
  raw.collections._calendarConnections = [{ id: 'test', path: '_calendarConnections/test', data: { ownerUid: 'test-owner', token: 'POISON' }, updateTime: version }];
  raw.envelope = 'POISON';
  assert.equal(sanitizeHouseholdSnapshot(raw, config).coverage.complete, true);
  assert.equal(JSON.stringify(sanitizeHouseholdSnapshot(raw, config)).includes('POISON'), false);
  delete raw.collections.tasks;
  assert.equal(sanitizeHouseholdSnapshot(raw, config).coverage.complete, false);
});

test('health authorization projection preserves only authorization metadata, never notes or legal document content', () => {
  const value = projectedHouseholdData('healthDocumentGrants', { ownerUid: 'test-owner', grants: [{ uid: 'test-parent', basis: 'consent', canEdit: true,
    note: 'POISON_PRIVATE_CONTENT', attachment: 'POISON_LEGAL_DOCUMENT' }], title: 'POISON' });
  assert.deepEqual(value, { ownerUid: 'test-owner', grants: [{ uid: 'test-parent', basis: 'consent', canEdit: true }] });
});
test('malformed objects under known metadata keys cannot leak nested secrets or turn into adoptable null families', () => {
  for (const [collection, data] of [
    ['members', { familyId: { token: 'POISON' } }], ['members', { familyId: 17 }],
    ['_calendarConnections', { ownerUid: { envelope: 'POISON' } }],
    ['healthDocuments', { readers: [{ token: 'POISON' }] }],
    ['healthDocumentGrants', { grants: [{ uid: 'test-parent', basis: { secret: 'POISON' } }] }],
  ]) assert.throws(() => projectedHouseholdData(collection, data), /INVENTORY_FIELD_TYPE_INVALID/);
  assert.deepEqual(projectedHouseholdData('members', { familyId: null }), { familyId: null });
  assert.deepEqual(projectedHouseholdData('members', {}), {});
});
