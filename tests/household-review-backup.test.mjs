import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { inspectReviewBackup } from '../scripts/lib/household-review-backup.mjs';
import { sealHouseholdBackup, canonicalJson, backupDigest } from '../scripts/lib/household-backup-archive.mjs';

const t = '2026-10-15T08:00:00.123456789Z', now = new Date('2026-10-15T09:00:00Z');
const sha = value => backupDigest(canonicalJson(value));
function fixture() {
  const key = randomBytes(32), familyId = 'family-synthetic-review';
  const config = { schemaVersion: 1, projectId: 'demo-review-backup', bucket: 'demo-review-backup.appspot.com',
    householdConfirmed: true, familyId, reviewedRecordPaths: [], members: Array.from({ length: 5 }, (_, i) => ({
      uid: `synthetic-review-${i}`, expectedName: `Synthetic ${i}`, expectedPersonKey: `synthetic-person-${i}`,
      expectedRole: i < 2 ? 'parent' : 'child', expectedCanLogin: i < 4 })) };
  const documents = config.members.map(member => ({ name: `projects/${config.projectId}/databases/(default)/documents/members/${member.uid}`,
    createTime: t, updateTime: t, fields: { name: { stringValue: member.expectedName }, role: { stringValue: member.expectedRole },
      personKey: { stringValue: member.expectedPersonKey }, canLogin: { booleanValue: member.expectedCanLogin }, active: { booleanValue: true } } }));
  const plan = { schemaVersion: 1, mode: 'dry-run', migrationContract: 'household-isolation-v1',
    projectId: config.projectId, bucket: config.bucket, familyId, canApply: false, writesPerformed: 0, blockers: [], changes: documents.map(row => ({
      path: row.name.split('/documents/')[1], field: 'familyId', before: { present: false }, after: { present: true, value: familyId },
      updateTime: { seconds: String(Math.floor(Date.parse(t) / 1000)), nanoseconds: 123456789 } })) };
  const bytes = Buffer.from('SYNTHETIC FILE ONLY'), id = backupDigest('https://example.invalid/synthetic.png');
  documents[0].fields.photoURL={stringValue:'https://example.invalid/synthetic.png'};
  const objects = [{ name: 'avatars/family/synthetic-review-0/synthetic.png', generation: '10000000000000001', metageneration: '2',
    contentType: 'image/png', size: bytes.length, bytesBase64: bytes.toString('base64'), sha256: backupDigest(bytes), metadata: {} }];
  const payload = { schemaVersion: 1, createdAt: t, projectId: config.projectId, bucket: config.bucket, documents, objects,
    auth: config.members.map(member => ({ uid: member.uid, exists: member.expectedCanLogin, ...(member.expectedCanLogin ? { disabled: false } : {}) })),
    externalFiles: [{ id, status: 'captured', size: bytes.length, bytesBase64: bytes.toString('base64'), sha256: backupDigest(bytes) }],
    references: [{ id }], config, plan, consistency: { firestore: { stable: true }, storage: { stable: true }, auth: { stable: true } },
    manifest: { captureComplete: true, firestoreComplete: true, storageComplete: true, planBoundToBackup: true,
      documentCount: documents.length, objectCount: objects.length, externalReferenceCount: 1,
      documentsSha256: sha(documents), objectsSha256: sha(objects), authScope: 'five-profile-metadata-only',
      objectScope: 'current-live-selected-bucket-objects', archivedObjectVersionsIncluded: false, secretManagerKeysIncluded: false },
    evidence: { planDigest: sha(plan) } };
  const f = { key, config, plan, payload, now };
  f.inspect = (options = {}) => inspectReviewBackup({ ...f, archive: sealHouseholdBackup(payload, key), ...options });
  return f;
}

test('actual encrypted bytes, manifest hashes and exact five UID plan bind without claiming a fresh restore or production state', () => {
  const f = fixture(), result = f.inspect();
  assert.equal(result.verified, true); assert.deepEqual(result.codes, []);
  assert.equal(result.backup.bodyIntegrityVerified, true); assert.equal(result.backup.complete, true);
  assert.equal(result.backup.sourceIdentityMatched, true); assert.equal(result.backup.boundToCurrentPlan, true);
  assert.equal(result.restore.verified, false); assert.equal(result.needsFreshRestore, true);
  assert.equal(result.sourceRecheckRequired, true); assert.equal(result.isCurrentProductionSnapshotVerified, false);
  assert.ok(result.restore.codes.includes('REVIEW_FRESH_RESTORE_REQUIRED'));
  assert.deepEqual(result.payload, f.payload);
});
test('missing archive, incorrect key and modified ciphertext cannot become evidence from supplied booleans', () => {
  const f = fixture();
  assert.ok(f.inspect({ archive: null, proof: { backup: { complete: true }, restore: { verified: true } } }).codes.includes('REVIEW_BACKUP_ARCHIVE_MISSING'));
  const wrongKey = f.inspect({ key: randomBytes(32) });
  assert.equal(wrongKey.verified, false); assert.equal(wrongKey.payload, undefined);
  assert.ok(wrongKey.codes.includes('REVIEW_BACKUP_AUTHENTICATION_FAILED'));
  const archive = sealHouseholdBackup(f.payload, f.key); archive[archive.length - 1] ^= 1;
  assert.equal(f.inspect({ archive }).verified, false);
});
test('manifest counts, body digests, completeness and consistency are recomputed rather than inferred', () => {
  for (const mutate of [f => f.payload.manifest.documentCount++, f => f.payload.manifest.objectCount = 0,
    f => f.payload.manifest.documentsSha256 = '0'.repeat(64), f => f.payload.manifest.objectsSha256 = '0'.repeat(64),
    f => f.payload.manifest.captureComplete = false, f => f.payload.manifest.storageComplete = false,
    f => f.payload.manifest.planBoundToBackup = false, f => f.payload.consistency.firestore.stable = false,
    f => f.payload.manifest.externalReferenceCount = 0, f => f.payload.references = [],
    f => { f.payload.externalFiles[0].status = 'blocked'; delete f.payload.externalFiles[0].bytesBase64; }]) {
    const f = fixture(); mutate(f); const result = f.inspect();
    assert.equal(result.verified, false); assert.equal(result.payload, undefined);
  }
});
test('same names with a foreign UID, another household, bucket or missing actual profile never match the five-profile archive', () => {
  for (const mutate of [f => f.config = { ...f.config, familyId: 'family-foreign' },
    f => f.config = { ...f.config, bucket: 'foreign-bucket.appspot.com' },
    f => f.config = { ...f.config, members: f.config.members.map((row, i) => i === 2 ? { ...row, uid: 'foreign-same-name' } : row) },
    f => f.payload.auth[2].uid = 'foreign-same-name', f => f.payload.auth[0].disabled = true,
    f => { f.payload.documents[2].name += '-foreign'; f.payload.manifest.documentsSha256 = sha(f.payload.documents); },
    f => { f.payload.documents[2].fields.active = { booleanValue: false }; f.payload.manifest.documentsSha256 = sha(f.payload.documents); }]) {
    const f = fixture(); mutate(f); assert.equal(f.inspect().verified, false);
  }
});
test('malformed household values and impossible capture chronology cannot become valid archive evidence',()=>{
  for(const mutate of [f=>{f.payload.documents[0].fields.familyId={booleanValue:false};},
    f=>{f.payload.documents[0].updateTime='2026-10-16T08:00:00Z';},
    f=>{f.payload.documents[0].createTime='2026-10-16T08:00:00Z';},
    f=>{f.payload.documents[0].fields=null;}]) {
    const f=fixture();mutate(f);f.payload.manifest.documentsSha256=sha(f.payload.documents);
    assert.equal(f.inspect().verified,false);
  }
});
test('missing external document and Auth/Google photo references are discovered from the actual archive contents',()=>{
  for(const mutate of [f=>{f.payload.auth[0].photoURL='https://example.invalid/uncaptured-google.png';},
    f=>{f.payload.auth[0].providerData=[{providerId:'google.com',photoURL:'https://example.invalid/uncaptured-provider.png'}];},
    f=>{f.payload.documents[1].fields.photoURL={stringValue:'https://example.invalid/uncaptured-profile.png'};}]) {
    const f=fixture();mutate(f);f.payload.manifest.documentsSha256=sha(f.payload.documents);
    assert.equal(f.inspect().verified,false);
  }
});
test('a new plan or changed document version invalidates archive binding even if all manifest flags remain true', () => {
  for (const mutate of [f => f.plan = { ...f.plan, generatedAt: t },
    f => { f.payload.documents[0].updateTime = '2026-10-15T08:00:00.123456788Z'; f.payload.manifest.documentsSha256 = sha(f.payload.documents); },
    f => f.payload.evidence.planDigest = '0'.repeat(64),
    f => { f.plan.blockers.push({ code: 'ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED' }); f.payload.evidence.planDigest = sha(f.plan); }]) {
    const f = fixture(); mutate(f); const result = f.inspect();
    assert.equal(result.verified, false); assert.ok(result.codes.includes('REVIEW_BACKUP_DIFFERENT_OR_UNBOUND_PLAN'));
  }
});
test('historical restore report is cross-checked against actual archive and counts but always requires a fresh demo execution', () => {
  const f = fixture(), archive = sealHouseholdBackup(f.payload, f.key), digest = backupDigest(archive);
  const proof = { backup: { complete: true, manifestHashesVerified: true, archiveDigestSha256: digest },
    restore: { verified: true, safetyVerified: true, emulatorExitCode: 0, sourceProjectId: f.config.projectId,
      targetProjectId: 'demo-household-restore-abcdef', archiveDigestSha256: digest,
      documentCount: 5, objectCount: 1, externalFileCount: 1, externalFilesUnverifiedCount: 0,
      authMetadataCount: 4, authMissingCount: 1, checkedAt: '2026-10-15T08:10:00Z',
      rollback: { verified: true, concurrentChangeRejected: true, postApplyReceiptIsDemoOnly: true, changeCount: 5 } } };
  let result = f.inspect({ archive, proof });
  assert.equal(result.verified, true); assert.equal(result.restore.historicalReportMatched, true);
  assert.equal(result.restore.verified, false); assert.equal(result.restore.needsFreshRestore, true);
  for (const mutate of [value => value.restore.archiveDigestSha256 = '0'.repeat(64), value => value.restore.documentCount = 1,
    value => value.restore.targetProjectId = f.config.projectId, value => value.restore.emulatorExitCode = 1,
    value => value.restore.rollback.concurrentChangeRejected = false, value => value.restore.checkedAt = '2026-10-15T09:01:00Z']) {
    const altered = structuredClone(proof); mutate(altered); result = f.inspect({ archive, proof: altered });
    assert.equal(result.restore.historicalReportMatched, false); assert.equal(result.restore.verified, false);
  }
});
test('future dates, duplicate archive rows and invalid input errors stay fail-closed and contain no raw data', () => {
  const f = fixture(); f.payload.documents.push(f.payload.documents[0]); f.payload.manifest.documentCount++;
  f.payload.manifest.documentsSha256 = sha(f.payload.documents);
  assert.equal(f.inspect().verified, false);
  const other = fixture(); other.payload.createdAt = '2099-01-01T00:00:00Z';
  assert.ok(other.inspect().codes.includes('REVIEW_BACKUP_CAPTURE_TIME_INVALID'));
  const invalid = other.inspect({ config: { secret: 'POISON_PRIVATE_VALUE' } });
  assert.equal(invalid.verified, false); assert.equal(JSON.stringify(invalid).includes('POISON_PRIVATE_VALUE'), false);
});
