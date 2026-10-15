import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { captureHouseholdEvidence } from '../scripts/lib/household-evidence-capture.mjs';
import { HOUSEHOLD_FIELDS, INBOX_FIELDS } from '../scripts/lib/household-migration-inventory.mjs';
import { assessHouseholdReadiness } from '../scripts/lib/household-readiness-policy.mjs';
import { sealHouseholdBackup, openHouseholdBackup, backupDigest, canonicalJson } from '../scripts/lib/household-backup-archive.mjs';

// Every identity, binary and provider envelope below is synthetic. The facade
// deliberately exposes only reads: no production SDK writes or network access.
const PROJECT = 'demo-household-capture', BUCKET = `${PROJECT}.appspot.com`;
const FAMILY = 'family-11111111-2222-4333-8444-555555555555';
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const TIME = '2026-10-14T08:00:00.123456000Z';
const VERSION = { seconds: Date.parse('2026-10-14T08:00:00Z') / 1000, nanoseconds: 123456000 };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const RULES = 'rules_version = "2"; // synthetic evidence fixture';
const ORIGIN = 'https://family-fixture.example';
const clone = value => structuredClone(value);
function native(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(native) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, native(item)])) } };
}
const document = (path, data) => ({ name: `${ROOT}/${path}`, createTime: TIME, updateTime: TIME,
  fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, native(value)])) });

function fixture({ rules403 = false, storageFailure = false, storageDrift = false,
  firestoreDrift = false, authDrift = false, externalFailure = false, extraMember = false } = {}) {
  const calls = [], mediaCalls = [], authCounts = new Map();
  const config = { schemaVersion: 1, projectId: PROJECT, bucket: BUCKET, householdConfirmed: true, familyId: FAMILY,
    reviewedRecordPaths: [], members: Array.from({ length: 5 }, (_, index) => ({ uid: `capture-profile-${index}`,
      expectedName: `Synthetic profile ${index}`, expectedPersonKey: `capture-person-${index}`,
      expectedRole: index < 2 ? 'parent' : 'child', expectedCanLogin: index !== 4 })) };
  const rows = { members: config.members.map(member => ({ id: member.uid, data: { name: member.expectedName,
    personKey: member.expectedPersonKey, role: member.expectedRole, canLogin: member.expectedCanLogin,
    active: true, ...(member.uid === 'capture-profile-0' ? { photoURL: 'https://lh3.googleusercontent.com/member.png' } : {}) } })),
    quickProducts: [{ id: 'asset-a', data: { imageURL: '/assets/product.png', createdBy: 'capture-profile-0' } },
      { id: 'asset-b', data: { imageURL: 'assets/product.png', createdBy: 'capture-profile-0' } }] };
  if (extraMember) rows.members.push({ id: 'other-household-active', data: { name: 'Other fixture', role: 'parent', active: true, canLogin: true } });
  const nativeRows = Object.entries(rows).flatMap(([collection, values]) => values.map(row => document(`${collection}/${row.id}`, row.data)));
  const opaque = document('_eduConnections/encrypted-fixture', { envelope: { keyId: 'v1', ciphertext: 'SYNTHETIC_OPAQUE_PROVIDER_CIPHERTEXT' } });
  opaque.fields.int64 = { integerValue: '9223372036854775807' };
  opaque.fields.nativeBytes = { bytesValue: 'AAH/' };
  opaque.fields.precision = { timestampValue: TIME };
  nativeRows.push(opaque, { name: `${ROOT}/notificationInbox/capture-profile-0` },
    document('notificationInbox/capture-profile-0/items/synthetic-alert', { body: 'SYNTHETIC_FULL_ALERT_TEXT' }));
  let firestoreScan = 0, wholeBucketScans = 0;
  const currentObject = { name: 'unclassified-files/capture.png', generation: '10000000000000001', metageneration: '1',
    size: String(PNG.length), contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: 'SYNTHETIC_BEARER_TOKEN' } };
  const db = { collection(name) {
    const queryState = { name, selected: null, limit: null, cursor: undefined };
    const query = {
      select(...fields) { assert.deepEqual(fields, HOUSEHOLD_FIELDS[name] || INBOX_FIELDS); queryState.selected = fields; return query; },
      orderBy() { return query; }, limit(value) { queryState.limit = value; return query; },
      startAfter(value) { queryState.cursor = value; return query; },
      async get() {
        assert.ok(queryState.selected); calls.push({ kind: 'firestore-query-read', name });
        const selected = (rows[name] || []).filter(row => queryState.cursor === undefined || row.id > queryState.cursor).slice(0, queryState.limit);
        return { docs: selected.map(row => ({ id: row.id, data: () => clone(row.data), updateTime: VERSION })) };
      },
    };
    return query;
  } };
  const auth = { async getUser(uid) {
    assert.ok(config.members.some(member => member.uid === uid));
    const count = (authCounts.get(uid) || 0) + 1; authCounts.set(uid, count);
    calls.push({ kind: 'auth-read', uid });
    if (uid === 'capture-profile-4') throw Object.assign(new Error('Synthetic passive profile'), { code: 'auth/user-not-found' });
    const metadata = { uid, disabled: false, email: `${uid}@fixture.example`, emailVerified: true,
      displayName: `Synthetic ${uid}`, customClaims: { fixtureOnly: true },
      // Password/token fields must never survive the explicit metadata allowlist.
      passwordHash: 'SYNTHETIC_PASSWORD_HASH_NOT_FOR_BACKUP', passwordSalt: 'SYNTHETIC_PASSWORD_SALT_NOT_FOR_BACKUP',
      refreshToken: 'SYNTHETIC_REFRESH_TOKEN_NOT_FOR_BACKUP',
      ...(uid === 'capture-profile-0' ? { photoURL: 'https://lh3.googleusercontent.com/auth-only.png',
        providerData: [{ providerId: 'google.com', uid: 'synthetic-provider-id', photoURL: 'https://lh3.googleusercontent.com/provider-only.png' }] } : {}) };
    if (authDrift && count >= 3 && uid === 'capture-profile-0') metadata.email = 'changed@fixture.example';
    return { uid, disabled: false, toJSON: () => clone(metadata) };
  } };
  const bucket = {
    async getFiles(options) {
      calls.push({ kind: 'storage-list-read', prefix: options.prefix || null });
      assert.equal(options.autoPaginate, false);
      if (options.prefix) return [[], null]; // The full copy must also cover unclassified objects.
      wholeBucketScans++;
      return [[{ ...clone(currentObject), ...(storageDrift && wholeBucketScans >= 2 ? { metageneration: '2' } : {}) }], null];
    },
    file(name, options) {
      assert.equal(name, currentObject.name); assert.equal(options.generation, currentObject.generation);
      return { getMetadata: async () => { calls.push({ kind: 'storage-metadata-read' }); return [clone(currentObject)]; },
        download: async settings => {
          assert.deepEqual(settings, { validation: 'crc32c', decompress: false }); calls.push({ kind: 'storage-byte-read' });
          if (storageFailure) throw Object.assign(new Error('SYNTHETIC_PRIVATE_FAILURE_BODY'), { code: 403 });
          return [Buffer.from(PNG)];
        } };
    },
  };
  const request = async options => {
    const url = new URL(options.url), resource = decodeURIComponent(url.pathname.replace(/^\/v1\//, ''));
    calls.push({ kind: 'rest-read', method: options.method, host: url.hostname });
    assert.ok(options.method === 'GET' || options.method === 'POST' && resource.endsWith(':listCollectionIds'), 'Source transport has no mutation endpoints');
    if (url.hostname === 'firebaserules.googleapis.com') {
      if (rules403) throw Object.assign(new Error('SYNTHETIC_PRIVATE_RULES_RESPONSE'), { response: { status: 403, data: 'SYNTHETIC_UNLOGGABLE_BODY' } });
      if (resource.includes('/releases/')) return { data: { name: resource, rulesetName: `projects/${PROJECT}/rulesets/fixture`, updateTime: TIME } };
      return { data: { name: resource, createTime: TIME, source: { files: [{ name: 'synthetic.rules', content: RULES }] } } };
    }
    if (url.hostname === 'storage.googleapis.com') return { data: { name: BUCKET, location: 'EUROPE-WEST1', storageClass: 'STANDARD' } };
    assert.equal(url.hostname, 'firestore.googleapis.com');
    if (resource === `projects/${PROJECT}/databases/(default)`) return { data: { name: resource, locationId: 'europe-west1' } };
    if (options.method === 'POST') {
      const parent = resource.replace(':listCollectionIds', '');
      if (parent === ROOT) firestoreScan++;
      return { data: { collectionIds: [...new Set(nativeRows.filter(row => row.name.startsWith(parent + '/'))
        .map(row => row.name.slice(parent.length + 1).split('/')[0]))] } };
    }
    assert.equal(url.searchParams.get('showMissing'), 'true');
    const selected = nativeRows.filter(row => row.name.startsWith(resource + '/') && !row.name.slice(resource.length + 1).includes('/')).map(clone);
    if (firestoreDrift && firestoreScan >= 2 && selected.some(row => row.name === opaque.name)) selected.find(row => row.name === opaque.name).fields.int64.integerValue = '7';
    return { data: { documents: selected } };
  };
  const externalTransport = { resolve: async () => [{ address: '8.8.8.8', family: 4 }], request: async (url, options) => {
    assert.equal(typeof options.lookup, 'function'); assert.equal(options.signal.aborted, false);
    mediaCalls.push(url.href);
    const response = Readable.from([Buffer.from(PNG)]);
    response.statusCode = externalFailure ? 403 : 200;
    response.headers = { 'content-type': 'image/png', 'content-length': String(PNG.length) };
    return response;
  } };
  const dependencies = { db, auth, bucket, request, externalTransport, localFirestoreRules: RULES, localStorageRules: RULES };
  return { config, calls, mediaCalls, nativeRows, opaque, dependencies,
    capture: () => captureHouseholdEvidence(config, FAMILY, dependencies, { appOrigin: ORIGIN }) };
}

test('read-only capture copies full native records, encrypted provider envelopes, all current objects and Auth/photo sources', async () => {
  const f = fixture(), result = await f.capture();
  assert.deepEqual(result.plan.blockers, []);
  assert.equal(result.captureComplete, true); assert.equal(result.plan.writesPerformed, 0); assert.equal(result.plan.canApply, false);
  assert.equal(result.plan.changes.length, 7); assert.equal(result.payload.documents.length, 9);
  const provider = result.payload.documents.find(row => row.name === f.opaque.name);
  assert.equal(provider.fields.int64.integerValue, '9223372036854775807');
  assert.equal(provider.fields.envelope.mapValue.fields.ciphertext.stringValue, 'SYNTHETIC_OPAQUE_PROVIDER_CIPHERTEXT');
  assert.equal(provider.fields.precision.timestampValue, TIME);
  assert.deepEqual(result.payload.missingAncestors, [{ name: `${ROOT}/notificationInbox/capture-profile-0` }]);
  assert.equal(result.payload.objects[0].name, 'unclassified-files/capture.png');
  assert.equal(result.payload.objects[0].sha256, backupDigest(PNG));
  assert.equal(result.payload.evidence.tokens.privateTokenCount, 1);
  assert.equal(result.payload.downloadTokenReview.canApply, false);
  assert.equal(result.payload.downloadTokenReview.writesPerformed, 0);
  assert.equal(result.payload.downloadTokenReview.objects.length, 1);
  assert.equal(result.payload.downloadTokenReview.objects[0].generation, '10000000000000001');
  assert.doesNotMatch(JSON.stringify(result.payload.downloadTokenReview), /SYNTHETIC_BEARER_TOKEN/);
  assert.equal(result.payload.auth.at(-1).exists, false); assert.equal(result.payload.manifest.secretManagerKeysIncluded, false);
  assert.equal(canonicalJson(result.payload.auth).includes('NOT_FOR_BACKUP'), false);
  assert.equal(canonicalJson(result.inventory).includes('SYNTHETIC_BEARER_TOKEN'), false);
  for (const url of ['https://lh3.googleusercontent.com/member.png', 'https://lh3.googleusercontent.com/auth-only.png', 'https://lh3.googleusercontent.com/provider-only.png']) {
    assert.ok(result.payload.references.some(row => row.url === url)); assert.ok(f.mediaCalls.includes(url));
  }
  assert.ok(result.rules.firestore.verified); assert.ok(result.rules.storage.verified);
  assert.equal(result.locations.firestore.europeanUnion, true);
  assert.ok(f.calls.every(row => !row.method || ['GET', 'POST'].includes(row.method)));
  assert.equal(typeof f.dependencies.db.runTransaction, 'undefined'); assert.equal(typeof f.dependencies.auth.updateUser, 'undefined');
  assert.equal(typeof f.dependencies.bucket.delete, 'undefined');
});

test('relative asset aliases share one download while retaining a captured record for every original reference', async () => {
  const f = fixture(), result = await f.capture();
  const aliases = ['/assets/product.png', 'assets/product.png'];
  assert.equal(f.mediaCalls.filter(url => url === `${ORIGIN}/assets/product.png`).length, 1);
  for (const value of aliases) assert.ok(result.payload.externalFiles.some(row => row.id === backupDigest(value) && row.status === 'captured'));
  assert.equal(result.payload.externalFiles.length, result.payload.manifest.externalReferenceCount);
  assert.equal(result.captureComplete, true);
  assert.equal(result.payload.downloadTokenReview.canApply, false);
  assert.equal(result.payload.downloadTokenReview.writesPerformed, 0);
  assert.equal(result.payload.downloadTokenReview.objects.length, 1);
  assert.equal(result.payload.downloadTokenReview.objects[0].generation, '10000000000000001');
  assert.doesNotMatch(JSON.stringify(result.payload.downloadTokenReview), /SYNTHETIC_BEARER_TOKEN/);
});

test('the captured fixture payload survives authenticated encryption without exposing URLs, bearer tokens or clinical/provider contents', async () => {
  const result = await fixture().capture(), key = randomBytes(32), archive = sealHouseholdBackup(result.payload, key);
  for (const marker of ['SYNTHETIC_OPAQUE_PROVIDER_CIPHERTEXT', 'SYNTHETIC_BEARER_TOKEN', 'googleusercontent.com', 'SYNTHETIC_FULL_ALERT_TEXT']) assert.equal(archive.includes(Buffer.from(marker)), false);
  assert.match(backupDigest(archive), /^[a-f0-9]{64}$/);
  assert.equal(canonicalJson(openHouseholdBackup(archive, key)), canonicalJson(result.payload));
  const tampered = Buffer.from(archive); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => openHouseholdBackup(tampered, key), { code: 'BACKUP_AUTHENTICATION_FAILED' });
});

test('Rules403 does not erase an otherwise valid backup, but cannot count as verified production configuration', async () => {
  const result = await fixture({ rules403: true }).capture();
  assert.equal(result.captureComplete, true);
  assert.equal(result.rules.firestore.verified, false); assert.equal(result.rules.storage.httpStatus, 403);
  assert.equal(JSON.stringify(result.rules).includes('SYNTHETIC_PRIVATE'), false);
  const proof = assessHouseholdReadiness(result);
  assert.equal(proof.status, 'blocked'); assert.ok(proof.blockers.includes('PRODUCTION_FIRESTORE_RULES_NOT_VERIFIED'));
  assert.ok(proof.blockers.includes('PRODUCTION_STORAGE_RULES_NOT_VERIFIED')); assert.equal(proof.canApply, false);
});

test('Storage byte failure remains incomplete after successful metadata inventory and never implies an empty verified bucket', async () => {
  const result = await fixture({ storageFailure: true }).capture();
  assert.deepEqual(result.plan.blockers, []); assert.equal(result.captureComplete, false);
  assert.equal(result.storage.complete, false); assert.equal(result.payload.manifest.storageComplete, false);
  assert.equal(result.payload.evidence.tokens.scanVerified, false);
  assert.equal(result.consistency.storage.stable, false);
  assert.equal(JSON.stringify(result.storage).includes('SYNTHETIC_PRIVATE_FAILURE_BODY'), false);
});

for (const [option, service] of [['storageDrift', 'storage'], ['firestoreDrift', 'firestore'], ['authDrift', 'auth']]) {
  test(`${service} changes during capture invalidate consistency and backup completeness`, async () => {
    const result = await fixture({ [option]: true }).capture();
    assert.deepEqual(result.plan.blockers, []); assert.equal(result.captureComplete, false);
    assert.equal(result.consistency[service].stable, false);
    assert.equal(assessHouseholdReadiness(result).status, 'blocked');
  });
}

test('an inaccessible external photo is unverified instead of silently omitted from the backup', async () => {
  const result = await fixture({ externalFailure: true }).capture();
  assert.equal(result.captureComplete, false);
  assert.equal(result.payload.externalFiles.length, result.payload.manifest.externalReferenceCount);
  assert.ok(result.payload.externalFiles.every(row => row.status === 'failed'));
});

test('an unreviewed active household stops the full-data/byte copy before any provider documents or file bytes are read', async () => {
  const f = fixture({ extraMember: true }), result = await f.capture();
  assert.equal(result.code, 'INVENTORY_BLOCKED'); assert.equal(result.payload, null); assert.equal(result.captureComplete, false);
  assert.ok(result.plan.blockers.length > 0);
  assert.equal(f.calls.some(row => row.kind === 'rest-read' || row.kind === 'storage-byte-read'), false);
  assert.deepEqual(f.mediaCalls, []);
});
