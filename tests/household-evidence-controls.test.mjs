import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { collectStorageBackup, recheckStorageBackup } from '../scripts/lib/household-storage-backup.mjs';
import { assessHouseholdReadiness } from '../scripts/lib/household-readiness-policy.mjs';
import { assertRestoreTarget, verifyHouseholdRestore } from '../scripts/lib/household-restore-verifier.mjs';
import { parseRestoreArguments, runBackupVerification } from '../scripts/verify-household-backup.mjs';
import { parsePreflightArguments } from '../scripts/household-preflight.mjs';
import { planMatchesBackup } from '../scripts/lib/household-evidence-capture.mjs';
import { readPrivateBytes, writePrivateFile, securePrivateDirectory } from '../scripts/lib/household-private-files.mjs';
import { backupDigest } from '../scripts/lib/household-backup-archive.mjs';

const bytes = Buffer.from('%PDF-SYNTHETIC_ONLY');
function fakeBucket() {
  const metadata = { name: 'healthDocuments/synthetic/owner/file.pdf', generation: '10000000000000001',
    metageneration: '1', size: String(bytes.length), contentType: 'application/pdf', metadata: { firebaseStorageDownloadTokens: 'POISON_BEARER' } };
  const calls = [];
  return { metadata, calls, getFiles: async options => { calls.push(['list', options]); return [[structuredClone(metadata)], null]; },
    file: (name, options) => { assert.equal(name, metadata.name); assert.equal(options.generation, metadata.generation);
      return { getMetadata: async () => [structuredClone(metadata)], download: async options => { calls.push(['download', options]); return [Buffer.from(bytes)]; } }; } };
}
test('full Storage backup pins generation, validates size, retains encrypted metadata and only reads', async () => {
  const bucket = fakeBucket(); const backup = await collectStorageBackup(bucket);
  assert.equal(backup.complete, true); assert.equal(backup.objects.length, 1);
  assert.equal(backup.objects[0].sha256, backupDigest(bytes));
  assert.equal(backup.privateTokenCount, 1); assert.equal(backup.productTokenCount, 0);
  assert.deepEqual(bucket.calls.find(row => row[0] === 'download')[1], { validation: 'crc32c', decompress: false });
  assert.equal((await recheckStorageBackup(bucket, backup.objects)).stable, true);
  bucket.metadata.metageneration = '2';
  assert.equal((await recheckStorageBackup(bucket, backup.objects)).stable, false);
});
test('storage limits and metadata races cannot be passed off as a complete backup', async () => {
  const bucket = fakeBucket();
  await assert.rejects(collectStorageBackup(bucket, { maxBytes: 1 }), { code: 'STORAGE_BACKUP_BYTE_LIMIT' });
  bucket.file = () => ({ getMetadata: async () => [{ ...bucket.metadata, metageneration: '2' }] });
  await assert.rejects(collectStorageBackup(bucket), { code: 'STORAGE_CHANGED_DURING_BACKUP' });
});
test('empty evidence and zero migration blockers never prove backup, rules, isolation or restoration', () => {
  const result = assessHouseholdReadiness({ plan: { projectId: 'nasza-rodzina', canApply: false, blockers: [], writesPerformed: 0 } });
  assert.equal(result.status, 'blocked'); assert.equal(result.canApply, false); assert.equal(result.migrationExecutable, false);
  for (const code of ['FULL_BACKUP_NOT_VERIFIED', 'RESTORE_NOT_VERIFIED', 'PRODUCTION_FIRESTORE_RULES_NOT_VERIFIED',
    'LEGACY_HOUSEHOLD_ISOLATION_NOT_VERIFIED', 'OWNER_HOUSEHOLD_REVIEW_REQUIRED']) assert.ok(result.blockers.includes(code));
});
function goodEvidence() {
  const hash = 'a'.repeat(64), projectId = 'demo-source-data';
  return { plan: { projectId, canApply: false, blockers: [], writesPerformed: 0 }, planDigest: hash,
    backup: { complete: true, manifestHashesVerified: true, archiveDigestSha256: hash },
    restore: { verified: true, safetyVerified: true, sourceProjectId: projectId, targetProjectId: 'demo-household-restore-abcdef',
      archiveDigestSha256: hash, emulatorExitCode: 0, rollback: { verified: true, concurrentChangeRejected: true, postApplyReceiptIsDemoOnly: true } },
    rules: { firestore: { verified: true, status: 'matched', sha256: hash, localSha256: hash }, storage: { verified: true, status: 'matched', sha256: hash, localSha256: hash } },
    consistency: { firestore: { stable: true }, storage: { stable: true }, auth: { stable: true } },
    locations: { firestore: { verified: true, europeanUnion: true }, storage: { verified: true, europeanUnion: true } },
    isolation: { fullMultiHouseholdVerified: true }, household: { ownerReviewed: true, boundPlanDigest: hash }, externalFiles: [],
    tokens: { scanVerified: true, privateTokenCount: 0, productTokenCount: 0 },
    recovery: { authRecoveryVerified: true, providerKeysRetainedVerified: true },
    custody: { secondCopyVerified: true, secondCopyArchiveDigest: hash, keyStoredSeparately: true } };
}
test('proofs bind restore to the archive and still never expose an apply or deploy capability', () => {
  const good = goodEvidence(); assert.equal(assessHouseholdReadiness(good).status, 'evidence-prepared-requires-approval');
  assert.equal(assessHouseholdReadiness(good).canApply, false);
  for (const modify of [value => value.restore.archiveDigestSha256 = 'b'.repeat(64), value => value.restore.emulatorExitCode = 1,
    value => value.restore.sourceProjectId = 'other-household', value => value.restore.targetProjectId = 'nasza-rodzina',
    value => value.restore.rollback.concurrentChangeRejected = false, value => value.tokens.privateTokenCount = 1,
    value => value.externalFiles.push({ status: 'blocked' }), value => value.household.boundPlanDigest = 'b'.repeat(64),
    value => value.isolation.fullMultiHouseholdVerified = false, value => value.recovery.authRecoveryVerified = false,
    value => value.custody.keyStoredSeparately = false, value => value.custody.secondCopyArchiveDigest = 'b'.repeat(64)]) {
    const value = structuredClone(good); modify(value); assert.equal(assessHouseholdReadiness(value).status, 'blocked');
  }
});
test('restore refuses production IDs, remote/tunnel hosts and invalid source data before the first request', async () => {
  const target = { projectId: 'demo-household-restore-abcdef', firestoreHost: '127.0.0.1:18080', authHost: '127.0.0.1:19099', storageHost: '127.0.0.1:19199' };
  for (const change of [{ projectId: 'nasza-rodzina' }, { projectId: 'demo-other' }, { firestoreHost: 'localhost:18080' },
    { authHost: 'firebase.invalid:9099' }, { storageHost: '127.0.0.1:443' }, { storageHost: target.authHost }]) assert.throws(() => assertRestoreTarget({ ...target, ...change }));
  let calls = 0;
  const request = async () => { calls++; throw new Error('Unexpected network call'); };
  await assert.rejects(verifyHouseholdRestore({ projectId: 'demo-source-data', documents: [{ name: 'projects/foreign/databases/(default)/documents/members/a' }],
    objects: [], auth: [], externalFiles: [] }, { ...target, request }), { code: 'RESTORE_SOURCE_RESOURCE_INVALID' });
  await assert.rejects(runBackupVerification({ project: 'nasza-rodzina', emulators: true }, { GCLOUD_PROJECT: 'nasza-rodzina' }), { code: 'RESTORE_DEMO_PROJECT_REQUIRED' });
  assert.equal(calls, 0);
});
test('restore rejects a nonempty target rather than overwriting or deleting any data', async () => {
  const target = { projectId: 'demo-household-restore-abcdef', firestoreHost: '127.0.0.1:18080', authHost: '127.0.0.1:19099', storageHost: '127.0.0.1:19199' };
  const mutations = [];
  const request = async (url, options = {}) => {
    if (options.method && options.method !== 'POST' || options.method === 'POST' && !url.endsWith(':listCollectionIds')) mutations.push(url);
    const json = url.includes('/storage/v1') ? { items: [{ name: 'already-here' }] } : {};
    return { ok: true, json: async () => json };
  };
  await assert.rejects(verifyHouseholdRestore({ projectId: 'demo-source-data', documents: [], objects: [], auth: [], externalFiles: [] }, { ...target, request }), { code: 'RESTORE_TARGET_NOT_EMPTY' });
  assert.deepEqual(mutations, []);
});
test('no CLI offers migrate, apply, rollback-to-production, bucket creation or deletion', () => {
  for (const flag of ['--apply', '--deploy', '--migrate', '--delete', '--create-bucket', '--skip-rules', '--skip-backup']) {
    assert.throws(() => parsePreflightArguments([flag])); assert.throws(() => parseRestoreArguments([flag]));
  }
});
test('private artifacts reject symlinks/world-readable keys and stay outside the repository', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'household-control-private-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'backup.key'); await writePrivateFile(file, randomBytes(32));
  assert.equal((await readPrivateBytes(file, 32)).length, 32);
  const link = path.join(directory, 'key-link'); await symlink(file, link);
  await assert.rejects(readPrivateBytes(link));
  await chmod(file, 0o644); await assert.rejects(readPrivateBytes(file), { code: 'PRIVATE_FILE_PERMISSIONS_REQUIRED' });
  await assert.rejects(securePrivateDirectory(process.cwd()), { code: 'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY' });
});
test('plan binding preserves nanoseconds and distinguishes absent familyId from null or a different value', () => {
  const plan = { projectId: 'demo-source-data', changes: [{ path: 'members/a', field: 'familyId', before: { present: false },
    updateTime: { seconds: String(Date.parse('2026-10-14T08:00:00Z') / 1000), nanoseconds: 123456789 } }] };
  const row = { name: 'projects/demo-source-data/databases/(default)/documents/members/a', fields: {}, updateTime: '2026-10-14T08:00:00.123456789Z' };
  assert.equal(planMatchesBackup(plan, [row]), true);
  row.fields.familyId = { nullValue: null }; assert.equal(planMatchesBackup(plan, [row]), false);
  plan.changes[0].before = { present: true, value: null }; assert.equal(planMatchesBackup(plan, [row]), true);
  row.updateTime = '2026-10-14T08:00:00.123456788Z'; assert.equal(planMatchesBackup(plan, [row]), false);
});
