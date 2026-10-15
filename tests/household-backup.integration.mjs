import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { sealHouseholdBackup, backupDigest } from '../scripts/lib/household-backup-archive.mjs';
import { writePrivateFile } from '../scripts/lib/household-private-files.mjs';
import { runAutomaticRestore } from '../scripts/household-preflight.mjs';

test('encrypted synthetic backup restores exact data and atomically rehearses multi-field isolation rollback in fresh demo emulators', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'household-backup-integration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = 'demo-backup-source';
  const root = `projects/${source}/databases/(default)/documents/`;
  const fields = { name: { stringValue: 'Synthetic parent' }, familyId: { nullValue: null },
    longInteger: { integerValue: '9223372036854775807' }, specialNumber: { doubleValue: 'NaN' },
    time: { timestampValue: '2026-10-14T08:00:00.123456000Z' }, bytes: { bytesValue: 'AAH/' },
    reference: { referenceValue: root + 'members/synthetic-parent' } };
  const pdf = Buffer.from('%PDF-SYNTHETIC_ORIGINAL_BYTES');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const compressed = gzipSync(Buffer.from('SYNTHETIC_COMPRESSED_ORIGINAL'));
  const calendarFields = { title: { stringValue: 'Synthetic shared event' }, person: { stringValue: 'synthetic-person' },
    createdBy: { stringValue: 'synthetic-parent' }, private: { booleanValue: false },
    startAt: { timestampValue: '2026-10-14T06:00:00.000000000Z' }, endAt: { timestampValue: '2026-10-14T14:00:00.000000000Z' },
    description: { stringValue: 'Preserve event contents and exact original fields' } };
  const payload = { schemaVersion: 1, projectId: source, bucket: `${source}.appspot.com`,
    documents: [{ name: root + 'members/synthetic-parent', fields, updateTime: '2026-10-14T08:00:00.123456789Z', createTime: '2026-10-14T08:00:00.123456789Z' },
      { name: root + 'calendarEvents/synthetic-shared', fields: calendarFields, updateTime: '2026-10-14T08:00:00.123456789Z', createTime: '2026-10-14T08:00:00.123456789Z' },
      { name: root + 'notificationInbox/synthetic-parent/items/synthetic', fields: { read: { booleanValue: false } } }],
    objects: [{ name: 'healthDocuments/synthetic/parent/original.pdf', generation: '10000000000000001', metageneration: '7',
      contentType: 'application/pdf', cacheControl: 'private, no-store', metadata: { firebaseStorageDownloadTokens: 'SYNTHETIC_BEARER_ONLY', pageCount: '2' },
      bytesBase64: pdf.toString('base64'), size: pdf.length, sha256: backupDigest(pdf) },
      { name: 'synthetic-compressed.txt', contentType: 'text/plain', contentEncoding: 'gzip', metadata: {},
        bytesBase64: compressed.toString('base64'), size: compressed.length, sha256: backupDigest(compressed) }],
    auth: [{ uid: 'synthetic-parent', exists: true, disabled: false, email: 'synthetic@example.invalid', emailVerified: true,
      displayName: 'Synthetic parent', phoneNumber: '+48123456789', photoURL: 'https://synthetic.invalid/photo.png',
      customClaims: { familyId: 'household-demo-synthetic', authorizationVersion: 7 },
      providerData: [{ providerId: 'google.com', uid: 'synthetic-google-id', email: 'synthetic@example.invalid', displayName: 'Synthetic parent' }] },
      { uid: 'synthetic-passive', exists: false }],
    externalFiles: [{ id: backupDigest('https://synthetic.invalid/avatar'), status: 'captured', contentType: 'image/png',
      bytesBase64: png.toString('base64'), size: png.length, sha256: backupDigest(png) }], missingAncestors: [{ name: root + 'notificationInbox/synthetic-parent' }],
    rules: { firestore: { sourceFiles: [{ content: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') }] },
      storage: { sourceFiles: [{ content: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') }] } },
    plan: { canApply: false, writesPerformed: 0, blockers: [], familyId: 'household-demo-synthetic',
      changes: [{ path: 'members/synthetic-parent', field: 'familyId', before: { present: true, value: null }, after: { present: true, value: 'household-demo-synthetic' } },
        ...Object.entries({ familyId: 'household-demo-synthetic', private: false, visibility: 'family',
          ownerUid: 'synthetic-parent', ownerProfileId: 'synthetic-parent' }).map(([field, value]) => ({
          path: 'calendarEvents/synthetic-shared', field, before: field === 'private' ? { present: true, value: false } : { present: false },
          after: { present: true, value } }))] } };
  const keyFile = path.join(directory, 'backup.key'), archive = path.join(directory, 'backup.nrb'), key = randomBytes(32);
  await writePrivateFile(keyFile, key); await writePrivateFile(archive, sealHouseholdBackup(payload, key));
  const proof = await runAutomaticRestore(directory, archive, keyFile, payload);
  assert.equal(proof.verified, true, JSON.stringify(proof));
  assert.equal(proof.documentCount, 3); assert.equal(proof.authMetadataCount, 1);
  assert.equal(proof.objectCount, 2); assert.equal(proof.externalFileCount, 1);
  assert.equal(proof.authenticationCredentialsRestored, false);
  assert.equal(proof.rollback.verified, true); assert.equal(proof.rollback.concurrentChangeRejected, true);
  assert.equal(proof.rollback.changeCount, 2, 'Six field patches are grouped into two atomic document writes');
  assert.equal(proof.rollback.postApplyReceiptIsDemoOnly, true);
  assert.equal(Object.hasOwn(calendarFields, 'familyId'), false);
  assert.equal(Object.hasOwn(calendarFields, 'ownerUid'), false);
  assert.equal(Object.hasOwn(calendarFields, 'ownerProfileId'), false);
  assert.equal(Object.hasOwn(calendarFields, 'visibility'), false);
  assert.deepEqual(calendarFields.private, { booleanValue: false }, 'Explicit false is preserved separately from absent metadata');
  assert.equal(proof.isolation.fullMultiHouseholdVerified, false, 'Rules-only probes must never claim full backend isolation');
  assert.ok(proof.isolation.scenarios.find(row => row.id === 'foreign-bill').passed);
  assert.ok(proof.isolation.scenarios.find(row => row.id === 'shared-child-bill').passed);
  assert.equal(proof.isolation.scenarios.find(row => row.id === 'foreign-calendar').passed, true);
  assert.equal(proof.isolation.scenarios.find(row => row.id === 'foreign-avatar-storage').passed, true);
  assert.equal(proof.isolation.scenarios.find(row => row.id === 'foreign-legacy-health-storage').passed, true);
  assert.equal(proof.isolation.scenarios.find(row => row.id === 'foreign-health-document-storage').passed, true);
  assert.equal(proof.isolation.scenarios.find(row => row.id === 'child-unshared-health-storage').passed, true);
});
