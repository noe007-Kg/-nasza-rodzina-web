import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFirestoreBackup, recheckFirestoreBackup, verifyProductionRules, readProductionLocations } from '../scripts/lib/household-production-evidence.mjs';

const project = 'demo-evidence-source', bucket = `${project}.appspot.com`;
const root = `projects/${project}/databases/(default)/documents`;
const timestamp = '2026-10-14T08:00:00.123456789Z';
const document = (path, fields = {}) => ({ name: `${root}/${path}`, fields, createTime: timestamp, updateTime: timestamp });
function reader(rows) {
  const calls = [];
  return { calls, request: async options => {
    calls.push(options); const url = new URL(options.url), resource = decodeURIComponent(url.pathname.slice('/v1/'.length));
    if (options.method === 'POST') {
      assert.ok(resource.endsWith(':listCollectionIds'), 'No commit/export/create POST is permitted');
      const parent = resource.replace(':listCollectionIds', '');
      const ids = [...new Set(rows.filter(row => row.name.startsWith(parent + '/')).map(row => row.name.slice(parent.length + 1).split('/')[0]))];
      return { data: { collectionIds: ids } };
    }
    assert.equal(options.method, 'GET');
    assert.equal(url.searchParams.get('showMissing'), 'true');
    const direct = rows.filter(row => row.name.startsWith(resource + '/') && !row.name.slice(resource.length + 1).includes('/'));
    return { data: { documents: direct } };
  } };
}
test('full native backup retains int64 and descends beneath missing ancestors using read-only endpoints', async () => {
  const rows = [document('members/parent', { count: { integerValue: '9223372036854775807' }, timestamp: { timestampValue: timestamp } }),
    { name: `${root}/notificationInbox/parent` }, document('notificationInbox/parent/items/alert', { envelope: { bytesValue: 'AAH/' } })];
  const fake = reader(rows);
  const result = await collectFirestoreBackup({ request: fake.request, projectId: project });
  assert.equal(result.complete, true); assert.equal(result.documents.length, 2);
  assert.equal(result.documents[0].fields.count.integerValue, '9223372036854775807');
  assert.deepEqual(result.missingAncestors, [{ name: `${root}/notificationInbox/parent` }]);
  assert.ok(fake.calls.every(row => !/commit|export|delete|update|setRules/.test(row.url)));
});
test('full second scan detects additions, deletions and changed versions instead of claiming an atomic snapshot', async () => {
  const a = document('members/a'), b = document('members/b');
  for (const rows of [[a, b], [], [{ ...a, updateTime: '2026-10-14T08:01:00Z' }]]) {
    const result = await recheckFirestoreBackup({ request: reader(rows).request, projectId: project, documents: [a] });
    assert.equal(result.stable, false);
  }
  assert.equal((await recheckFirestoreBackup({ request: reader([a]).request, projectId: project, documents: [a] })).stable, true);
});
test('foreign resources, duplicates and size limits fail closed without disclosing record data', async () => {
  await assert.rejects(collectFirestoreBackup({ request: reader([document('members/a'), document('members/b')]).request, projectId: project, maxDocuments: 1 }), { code: 'FIRESTORE_BACKUP_DOCUMENT_LIMIT_REACHED' });
  await assert.rejects(collectFirestoreBackup({ request: reader([document('members/a')]).request, projectId: project, maxBytes: 1 }), { code: 'FIRESTORE_BACKUP_BYTE_LIMIT_REACHED' });
  const bad = async options => options.method === 'POST' ? { data: { collectionIds: ['members'] } }
    : { data: { documents: [{ ...document('members/a'), name: 'projects/foreign/databases/(default)/documents/members/POISON' }] } };
  await assert.rejects(collectFirestoreBackup({ request: bad, projectId: project }), error => error.code === 'FIRESTORE_BACKUP_RESOURCE_INVALID' && !error.message.includes('POISON'));
});
test('pagination includes all pages and rejects a repeated token', async () => {
  const request = async options => options.method === 'POST' ? { data: {} }
    : { data: { documents: [], nextPageToken: 'repeat' } };
  const loop = async options => options.method === 'POST' && options.url.endsWith('/documents:listCollectionIds')
    ? { data: { collectionIds: ['members'] } } : request(options);
  await assert.rejects(collectFirestoreBackup({ request: loop, projectId: project }), { code: 'FIRESTORE_BACKUP_PAGINATION_INVALID' });
});
function rulesReader({ source = 'rules_version = "2";', changed = false, forbidden = false, foreign = false } = {}) {
  const counts = new Map();
  return async options => {
    assert.equal(options.method, 'GET');
    if (forbidden) throw Object.assign(new Error('POISON_TOKEN'), { response: { status: 403, data: 'POISON_RESPONSE' } });
    const name = decodeURIComponent(new URL(options.url).pathname.slice('/v1/'.length));
    if (name.includes('/releases/')) {
      const count = (counts.get(name) || 0) + 1; counts.set(name, count);
      return { data: { name, rulesetName: `projects/${foreign ? 'foreign' : project}/rulesets/${changed && count > 1 ? 'second' : 'first'}`, updateTime: timestamp } };
    }
    return { data: { name, createTime: timestamp, source: { files: [{ name: 'deployed-name.rules', content: source }] } } };
  };
}
test('production rules require real GET evidence, exact source match and an unchanged release', async () => {
  const local = 'rules_version = "2";';
  const call = request => verifyProductionRules({ request, projectId: project, bucket, localFirestoreRules: local, localStorageRules: local });
  const matched = await call(rulesReader());
  assert.equal(matched.firestore.verified, true); assert.equal(matched.storage.verified, true);
  assert.equal(matched.firestore.sha256, matched.firestore.localSha256);
  assert.equal((await call(rulesReader({ source: 'different' }))).firestore.status, 'mismatch');
  assert.equal((await call(rulesReader({ changed: true }))).storage.status, 'changed');
  assert.equal((await call(rulesReader({ foreign: true }))).firestore.verified, false);
});
test('403 never verifies production rules and never exports raw error headers or messages', async () => {
  const result = await verifyProductionRules({ request: rulesReader({ forbidden: true }), projectId: project, bucket, localFirestoreRules: 'local', localStorageRules: 'local' });
  assert.equal(result.firestore.verified, false); assert.equal(result.storage.httpStatus, 403);
  assert.equal(JSON.stringify(result).includes('POISON'), false);
});
test('EU location evidence distinguishes Belgium from UK/Switzerland and does not claim all data residency', async () => {
  const request = region => async options => ({ data: options.url.includes('firestore.googleapis.com')
    ? { name: `projects/${project}/databases/(default)`, locationId: region }
    : { name: bucket, location: 'EUROPE-WEST1', storageClass: 'STANDARD' } });
  for (const [region, expected] of [['europe-west1', true], ['eur3', true], ['europe-west2', false], ['europe-west6', false], ['nam5', false]]) {
    const result = await readProductionLocations({ request: request(region), projectId: project, bucket });
    assert.equal(result.firestore.europeanUnion, expected); assert.equal(result.storage.europeanUnion, true);
    assert.match(result.scope, /primary-firestore-and-selected/);
  }
});
