import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { PROJECT, parseTaskPreflightArguments, readOnlyTaskTransport, inspectTaskHouseholds,
  runTaskReleasePreflight, renderTaskPreflightSummary } from '../scripts/tasks-release-preflight.mjs';
import { openHouseholdBackup, backupDigest } from '../scripts/lib/household-backup-archive.mjs';

const root = `projects/${PROJECT}/databases/(default)/documents`;
const native = value => typeof value === 'boolean' ? { booleanValue: value } : { stringValue: value };
const document = (collection, id, data) => ({ name: `${root}/${collection}/${id}`,
  fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, native(value)])),
  createTime: '2026-10-18T08:00:00Z', updateTime: '2026-10-18T08:00:00Z' });
function fixtures() {
  const members = Array.from({ length: 5 }, (_, i) => document('members', `synthetic-${i}`, {
    name: `PRIVATE_SYNTHETIC_NAME_${i}`, personKey: `private-person-${i}`, familyId: 'synthetic-household',
    active: true, canLogin: true, role: i < 2 ? 'parent' : 'child' }));
  const tasks = [document('tasks', 'synthetic-task', { person: 'private-person-2', familyId: 'synthetic-household', createdBy: 'synthetic-0' })];
  const accounts = members.map((_, i) => ({ localId: `synthetic-${i}`, displayName: `PRIVATE_SYNTHETIC_NAME_${i}`, disabled: false }));
  return { members, tasks, accounts };
}
function clientOf(data = fixtures(), { bucketError, authError, unknownBucket = false } = {}) {
  const calls = [], source = 'rules_version = "2"; service cloud.firestore {}';
  return { calls, source, async request(options) {
    calls.push(options);
    const url = new URL(options.url), pathname = decodeURIComponent(url.pathname);
    if (url.hostname === 'firebase.googleapis.com') return { data: { projectId: PROJECT, projectNumber: '340731425852', ...(unknownBucket ? {} : { resources: { storageBucket: 'nasza-rodzina.firebasestorage.app' } }) } };
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      if (authError) throw Object.assign(new Error('DO_NOT_PRINT_PRIVATE_OAUTH_RESPONSE'), { response: { status: authError } });
      assert.ok(url.searchParams.get('fields').includes('localId')); assert.ok(!url.searchParams.get('fields').includes('password'));
      return { data: { users: data.accounts } };
    }
    if (url.hostname === 'storage.googleapis.com') {
      if (bucketError) throw Object.assign(new Error('DO_NOT_PRINT_TOKEN_OR_URL'), { response: { status: bucketError } });
      return { data: { name: 'nasza-rodzina.firebasestorage.app', projectNumber: '340731425852', location: 'EU' } };
    }
    if (url.hostname === 'firebaserules.googleapis.com') {
      const name = pathname.slice(4);
      if (pathname.includes('/releases/')) return { data: { name, rulesetName: `projects/${PROJECT}/rulesets/synthetic-rules`, updateTime: 'synthetic-version' } };
      return { data: { name, source: { files: [{ name: 'synthetic.rules', content: source }] } } };
    }
    if (pathname === `/v1/projects/${PROJECT}/databases/(default)`) return { data: { name: `projects/${PROJECT}/databases/(default)`, locationId: 'eur3' } };
    const collection = pathname.split('/').at(-1);
    assert.equal(options.method, 'GET');
    assert.ok(url.searchParams.getAll('mask.fieldPaths').includes('familyId'));
    return { data: { documents: collection === 'members' ? data.members : collection === 'tasks' ? data.tasks : [] } };
  } };
}
async function directory(t) {
  const result = await mkdtemp(path.join(tmpdir(), 'tasks-preflight-unit-'));
  t.after(() => rm(result, { recursive: true, force: true }));
  return path.join(result, 'private-output');
}
const disk = async () => ({ bavail: 4096, bsize: 1024 ** 2 });

test('CLI defaults to read-only nasza-rodzina and never accepts write/skip/foreign-project flags', () => {
  assert.deepEqual(parseTaskPreflightArguments([]), { project: PROJECT, backup: false });
  assert.equal(parseTaskPreflightArguments(['--backup']).backup, true);
  for (const args of [['--project', 'foreign-project'], ['--deploy'], ['--apply'], ['--migrate'], ['--skip-backup'], ['--confirm-household'],
    ['--backup', '--check'], ['--bucket', 'https://other.invalid'], ['--check', '--check']]) assert.throws(() => parseTaskPreflightArguments(args));
});

test('cloud transport permits only scoped GET and read-only listCollectionIds; prevents writes and redirect auth leaks', async () => {
  const calls = [], request = readOnlyTaskTransport({ request: async options => { calls.push(options); return { data: {} }; } });
  await request({ method: 'GET', url: `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}` });
  await request({ method: 'POST', url: `https://firestore.googleapis.com/v1/${root}:listCollectionIds`, data: { pageSize: 100 } });
  for (const options of [
    { method: 'POST', url: `https://firestore.googleapis.com/v1/${root}:commit`, data: {} },
    { method: 'PATCH', url: `https://firestore.googleapis.com/v1/${root}/members/private` },
    { method: 'DELETE', url: 'https://storage.googleapis.com/storage/v1/b/nasza-rodzina.firebasestorage.app/o/private' },
    { method: 'GET', url: 'https://secretmanager.googleapis.com/v1/projects/nasza-rodzina/secrets/private/versions/latest:access' },
    { method: 'GET', url: 'https://firestore.googleapis.com/v1/projects/foreign-project/databases/(default)/documents' },
    { method: 'GET', url: 'https://attacker.invalid/private' },
    { method: 'GET', url: `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}`, data: { token: 'private' } },
    { method: 'GET', url: `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}`, headers: { 'X-HTTP-Method-Override': 'DELETE' } },
  ]) await assert.rejects(request(options), { code: 'TASK_PREFLIGHT_TRANSPORT_FORBIDDEN' });
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.maxRedirects === 0));
});

test('missing familyId and __legacy__ never prove household ownership; names do not assign records', () => {
  const data = fixtures(), accounts = data.accounts.map(row => ({ uid: row.localId, disabled: false }));
  assert.equal(inspectTaskHouseholds([...data.members, ...data.tasks], accounts).verified, true);
  delete data.members[0].fields.familyId;
  data.tasks[0].fields.familyId = native('__legacy__');
  const result = inspectTaskHouseholds([...data.members, ...data.tasks], accounts);
  assert.equal(result.verified, false);
  assert.ok(result.blockers.includes('TASK_EXPLICIT_HOUSEHOLD_ASSIGNMENT_REQUIRED'));
  assert.ok(result.blockers.includes('TASK_RECORD_HOUSEHOLD_ASSIGNMENT_REQUIRED'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_SYNTHETIC_NAME'));
});

test('reward eligibility, child person ownership and proof/image references require valid same-household links', () => {
  const data = fixtures(), accounts = data.accounts.map(row => ({ uid: row.localId, disabled: false }));
  const reward = document('taskRewards', 'reward', { familyId: 'synthetic-household', imageUploadId: 'missing-image' });
  reward.fields.people = { arrayValue: { values: [{ stringValue: 'foreign-person' }] } };
  data.tasks[0].fields.proofUploadId = native('missing-proof');
  const request = document('taskRewardRequests', 'request', { familyId: 'synthetic-household', uid: 'synthetic-2', person: 'private-person-3', rewardId: 'reward' });
  const result = inspectTaskHouseholds([...data.members, ...data.tasks, reward, request], accounts);
  assert.equal(result.verified, false); assert.equal(result.fullAuthorizationVerified, false);
  assert.ok(result.blockers.includes('TASK_OWNERSHIP_LINK_REVIEW_REQUIRED')); assert.ok(result.invalidLinkCount >= 4);
});

test('default probe records actual response evidence but never claims backup, owner proof or release ready', async t => {
  const client = clientOf();
  const { report } = await runTaskReleasePreflight({ project: PROJECT, backup: false, output: await directory(t) }, {
    client, env: {}, disk, releaseRules: async () => ({ localFirestoreRules: client.source, localStorageRules: client.source }) });
  assert.equal(report.authentication, 'project-read-verified'); assert.equal(report.taskHouseholds.verified, true);
  assert.equal(report.rules.firestore.verified, true); assert.equal(report.rules.storage.verified, true);
  assert.equal(report.backup.captured, false); assert.equal(report.restore.attempted, false); assert.equal(report.readyForDeployment, false);
  assert.equal(report.productionWritesPerformed, 0);
  assert.ok(report.blockers.includes('OWNER_HOUSEHOLD_CONFIRMATION_REQUIRED'));
  assert.ok(report.blockers.includes('COMPLETE_CURRENT_BACKUP_NOT_VERIFIED'));
  const rendered = renderTaskPreflightSummary(report) + JSON.stringify(report);
  assert.ok(!rendered.includes('PRIVATE_SYNTHETIC_NAME')); assert.ok(!rendered.includes('synthetic-0'));
  assert.ok(!rendered.includes('private-person')); assert.ok(!rendered.includes('synthetic-household'));
  assert.ok(client.calls.every(call => call.method === 'GET'));
});

test('Storage 404/403 and unknown bucket retain successful Auth and task checks, never mean empty bucket', async t => {
  for (const options of [{ bucketError: 404 }, { bucketError: 403 }, { unknownBucket: true }]) {
    const { report } = await runTaskReleasePreflight({ project: PROJECT, backup: false, output: await directory(t) }, {
      client: clientOf(fixtures(), options), env: {}, disk });
    assert.equal(report.authentication, 'project-read-verified'); assert.equal(report.authMetadataCount, 5);
    assert.equal(report.taskHouseholds.verified, true); assert.equal(report.backup.captured, false); assert.equal(report.backup.complete, false);
    assert.ok(report.blockers.includes(options.unknownBucket ? 'STORAGE_BUCKET_NOT_DISCOVERED' : options.bucketError === 404 ? 'RESOURCE_NOT_FOUND' : 'READ_PERMISSION_DENIED'));
    assert.ok(!JSON.stringify(report).includes('DO_NOT_PRINT'));
  }
});

test('low disk space prevents cloud reads and backup; no deletion or fake auth success', async t => {
  let calls = 0;
  const { report } = await runTaskReleasePreflight({ project: PROJECT, backup: true, output: await directory(t) }, {
    client: { request: async () => { calls++; throw new Error('must not run'); } }, env: {}, disk: async () => ({ bavail: 1, bsize: 1024 }) });
  assert.equal(calls, 0); assert.equal(report.authentication, 'not-verified');
  assert.ok(report.blockers.includes('LOCAL_DISK_SPACE_INSUFFICIENT')); assert.equal(report.backup.complete, false);
});

test('all emulator overrides, including GCS SDK override, are refused before production evidence checks', async t => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST']) {
    await assert.rejects(runTaskReleasePreflight({ project: PROJECT, backup: false, output: await directory(t) }, {
      env: { [key]: 'http://127.0.0.1:9199' } }), { code: 'TASK_PREFLIGHT_ENVIRONMENT_MISMATCH' });
  }
});

test('ADC and authorization errors are redacted and cannot count as verified Auth access', async t => {
  for (const status of [401, 403]) {
    const { report } = await runTaskReleasePreflight({ project: PROJECT, backup: false, output: await directory(t) }, {
      client: clientOf(fixtures(), { authError: status }), env: {}, disk });
    assert.equal(report.authMetadataCount, undefined); assert.equal(report.taskHouseholds, null);
    assert.ok(report.blockers.includes(status === 401 ? 'AUTHENTICATION_REQUIRED' : 'READ_PERMISSION_DENIED'));
    assert.ok(!renderTaskPreflightSummary(report).includes('PRIVATE_OAUTH'));
    assert.equal(report.readyForDeployment, false);
  }
});

test('full archive capture is independent of missing familyId; private ciphertext and exact restore hash remain separate from rollback', async t => {
  const data = fixtures(); delete data.members[0].fields.familyId;
  const client = clientOf(data), output = await directory(t);
  const { report } = await runTaskReleasePreflight({ project: PROJECT, backup: true, output }, {
    client, env: {}, disk, releaseRules: async () => ({ localFirestoreRules: client.source, localStorageRules: client.source }),
    bucket: { getFiles: async () => [[], null] },
    collectFirestore: async () => ({ documents: [...data.members, ...data.tasks], missingAncestors: [], complete: true }),
    recheckFirestore: async () => ({ stable: true, complete: true }),
    // Unit stub, explicitly not an actual production archive/emulator proof.
    restore: async (_directory, archiveFile) => ({ verified: true, safetyVerified: true, sourceProjectId: PROJECT,
      targetProjectId: 'demo-household-restore-synthetic', emulatorExitCode: 0,
      archiveDigestSha256: backupDigest(await readFile(archiveFile)) }),
  });
  assert.equal(report.backup.captured, true); assert.equal(report.backup.complete, true); assert.equal(report.restore.verified, true);
  assert.equal(report.taskHouseholds.verified, false); assert.equal(report.readyForDeployment, false);
  assert.equal(report.rollback.verified, false); assert.ok(report.blockers.includes('TASK_ROLLBACK_REHEARSAL_NOT_VERIFIED'));
  const bytes = await readFile(path.join(output, 'tasks-release-backup.nrb')), key = await readFile(path.join(output, 'backup.key'));
  assert.ok(!bytes.toString().includes('PRIVATE_SYNTHETIC_NAME'));
  const payload = openHouseholdBackup(bytes, key);
  assert.equal(payload.documents.length, 6); assert.equal(payload.plan, undefined); assert.equal(payload.config, undefined);
  assert.equal((await stat(path.join(output, 'backup.key'))).mode & 0o777, 0o600);
  assert.ok(client.calls.every(call => call.method === 'GET'));
});

test('rules mismatch, rejected restore hash and archive limitations cannot be promoted into readiness', async t => {
  const client = clientOf();
  const { report } = await runTaskReleasePreflight({ project: PROJECT, backup: true, output: await directory(t) }, {
    client, env: {}, disk, releaseRules: async () => ({ localFirestoreRules: 'different', localStorageRules: 'different' }),
    bucket: { getFiles: async () => [[], null] },
    collectFirestore: async () => ({ documents: [], missingAncestors: [], complete: true }),
    recheckFirestore: async () => ({ stable: true, complete: true }),
    restore: async () => ({ verified: true, safetyVerified: true, sourceProjectId: PROJECT,
      targetProjectId: 'demo-household-restore-synthetic', emulatorExitCode: 0, archiveDigestSha256: 'f'.repeat(64) }),
  });
  assert.equal(report.rules.firestore.status, 'mismatch'); assert.equal(report.restore.verified, false);
  assert.ok(report.blockers.includes('PRODUCTION_FIRESTORE_RULES_DIFF_REVIEW_REQUIRED'));
  assert.ok(report.blockers.includes('ACTUAL_ARCHIVE_RESTORE_NOT_VERIFIED'));
  assert.equal(report.readyForDeployment, false);
});

test('missing Storage preserves a real encrypted Firestore/Auth partial archive but cannot imply no files or completeness', async t => {
  const data = fixtures(), client = clientOf(data, { bucketError: 404 }), output = await directory(t);
  const { report } = await runTaskReleasePreflight({ project: PROJECT, backup: true, output }, {
    client, env: {}, disk, releaseRules: async () => ({ localFirestoreRules: client.source, localStorageRules: client.source }),
    collectFirestore: async () => ({ documents: [...data.members, ...data.tasks], missingAncestors: [], complete: true }),
    recheckFirestore: async () => ({ stable: true, complete: true }),
    restore: async (_directory, archiveFile) => ({ verified: true, safetyVerified: true, sourceProjectId: PROJECT,
      targetProjectId: 'demo-household-restore-synthetic', emulatorExitCode: 0,
      archiveDigestSha256: backupDigest(await readFile(archiveFile)) }),
  });
  assert.equal(report.backup.captured, true); assert.equal(report.backup.firestoreCaptured, true);
  assert.equal(report.backup.storageCaptured, false); assert.equal(report.backup.objectCount, null);
  assert.equal(report.backup.complete, false); assert.equal(report.restore.verified, false);
  assert.equal(report.restore.capturedDataVerified, true); // Matching partial data is not a complete restore proof.
  assert.ok(report.blockers.includes('RESOURCE_NOT_FOUND')); assert.equal(report.readyForDeployment, false);
  const payload = openHouseholdBackup(await readFile(path.join(output, 'tasks-release-backup.nrb')), await readFile(path.join(output, 'backup.key')));
  assert.equal(payload.documents.length, 6); assert.equal(payload.auth.length, 5); assert.equal(payload.manifest.captureComplete, false);
});
