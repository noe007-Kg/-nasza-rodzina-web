import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, stat, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertHouseholdEnvironment, parseHouseholdArguments, prepareLocalProposal } from '../scripts/prepare-household-migration.mjs';
import { HOUSEHOLD_FIELDS, STORAGE_PREFIXES } from '../scripts/lib/household-migration-inventory.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/prepare-household-migration.mjs', import.meta.url));
function config() { return { schemaVersion: 1, projectId: 'demo-migration-test', bucket: 'demo-migration-test.appspot.com', householdConfirmed: true,
  members: Array.from({ length: 5 }, (_, index) => ({ uid: `test-person-${index}`, expectedName: `Synthetic ${index}`,
    expectedRole: index < 2 ? 'parent' : 'child', expectedCanLogin: index !== 4 })) }; }
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'nr-household-private-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const c = config(), collections = Object.fromEntries(Object.keys(HOUSEHOLD_FIELDS).map(name => [name, []]));
  for (const member of c.members) {
    collections.members.push({ id: member.uid, path: `members/${member.uid}`, updateTime: { seconds: '1791878400', nanoseconds: 11 },
      data: { name: member.expectedName, role: member.expectedRole, active: true, canLogin: member.expectedCanLogin } });
    collections[`notificationInbox/${member.uid}/items`] = [];
  }
  const inventory = { schemaVersion: 1, projectId: c.projectId, bucket: c.bucket, collections, auth: c.members.map(member => ({ uid: member.uid, exists: member.expectedCanLogin, disabled: false })), storage: [],
    coverage: { complete: true, authVerified: true, storagePrefixes: [...STORAGE_PREFIXES], collections: Object.keys(collections), missingCollections: [] },
    envelope: 'POISON_HIDDEN_SECRET' };
  const input = path.join(directory, 'household.private.json'), snapshot = path.join(directory, 'snapshot.private.json'), output = path.join(directory, 'output');
  await writeFile(input, JSON.stringify(c), { mode: 0o600 });
  await writeFile(snapshot, JSON.stringify(inventory), { mode: 0o600 });
  const env = { ...process.env };
  for (const key of ['NODE_TEST_CONTEXT', 'GCLOUD_PROJECT', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) delete env[key];
  return { directory, c, inventory, input, snapshot, output, env,
    run: extra => exec(process.execPath, [cli, '--config', input, '--output', output, '--snapshot', snapshot, ...(extra || [])], { env }) };
}

test('there is no Firebase write/apply/rollback mode and conflicting/duplicate options fail before initialization', () => {
  for (const flag of ['--apply', '--migrate', '--rollback', '--force', '--deploy']) assert.throws(() => parseHouseholdArguments([flag]), { code: 'UNSUPPORTED_ARGUMENT' });
  assert.throws(() => parseHouseholdArguments(['--config', 'one', '--config', 'two', '--output', 'dir']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseHouseholdArguments(['--config', 'one']), { code: 'CONFIG_AND_OUTPUT_REQUIRED' });
  assert.throws(() => parseHouseholdArguments(['--config', 'one', '--output', 'dir', '--max-documents', 'Infinity']), { code: 'INVALID_LIMIT' });
  assert.equal(parseHouseholdArguments(['--config', 'one', '--output', 'dir']).maximum, 10000);
});

test('project/emulator mismatches and implicit demo live access are refused', () => {
  const c = config(), hosts = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' };
  assert.doesNotThrow(() => assertHouseholdEnvironment(c, { emulators: true }, hosts));
  assert.throws(() => assertHouseholdEnvironment({ ...c, projectId: 'nasza-rodzina' }, { emulators: true }, hosts), { code: 'EMULATOR_PROJECT_REQUIRED' });
  assert.throws(() => assertHouseholdEnvironment(c, { emulators: true }, { ...hosts, FIRESTORE_EMULATOR_HOST: 'firebase.invalid:8080' }), { code: 'EXPLICIT_LOCAL_EMULATORS_REQUIRED' });
  assert.throws(() => assertHouseholdEnvironment(c, {}, {}), { code: 'EMULATOR_MODE_REQUIRED' });
  assert.throws(() => assertHouseholdEnvironment(c, { snapshot: 'snapshot' }, { GCLOUD_PROJECT: 'another-project' }), { code: 'PROJECT_ENVIRONMENT_MISMATCH' });
  assert.throws(() => assertHouseholdEnvironment(c, { snapshot: 'snapshot' }, hosts), { code: 'EMULATOR_MODE_REQUIRED' });
});

test('a full offline CLI run writes only private local artifacts, never secrets, and reuses one proposal ID', async t => {
  const f = await fixture(t);
  const first = await f.run();
  assert.match(first.stdout, /Zapisów Firebase: 0/);
  assert.equal(first.stdout.includes('test-person'), false);
  assert.equal(first.stdout.includes('POISON'), false);
  const proposal = JSON.parse(await readFile(path.join(f.output, 'proposal.private.json'), 'utf8'));
  assert.match(proposal.familyId, /^family-[a-f0-9-]{36}$/);
  await f.run(['--dry-run']);
  const runs = (await readdir(f.output)).filter(name => name.startsWith('run-'));
  assert.equal(runs.length, 2);
  for (const name of runs) {
    const dir = path.join(f.output, name);
    assert.equal((await stat(dir)).mode & 0o077, 0);
    const plan = JSON.parse(await readFile(path.join(dir, 'plan.private.json'), 'utf8'));
    assert.equal(plan.familyId, proposal.familyId);
    assert.equal(plan.mode, 'dry-run'); assert.equal(plan.canApply, false); assert.equal(plan.writesPerformed, 0);
    assert.equal(plan.status, 'prepared-requires-approval'); assert.equal(plan.changes.length, 5);
    assert.ok(plan.warnings.some(item => item.code === 'OFFLINE_METADATA_NOT_PRODUCTION_VERIFICATION'));
    const rollback = JSON.parse(await readFile(path.join(dir, 'rollback.private.json'), 'utf8'));
    assert.equal(rollback.canApply, false); assert.equal(rollback.requiresApprovedBackupAndPostApplyVersions, true);
    assert.equal(rollback.changes.length, 5);
    for (const file of await readdir(dir)) {
      assert.equal((await stat(path.join(dir, file))).mode & 0o077, 0);
      assert.equal((await readFile(path.join(dir, file), 'utf8')).includes('POISON'), false);
    }
  }
});

test('a blocked offline plan exits nonzero yet leaves a reviewable private report with zero cloud writes', async t => {
  const f = await fixture(t);
  f.inventory.collections.members[0].data.role = 'child';
  await writeFile(f.snapshot, JSON.stringify(f.inventory), { mode: 0o600 });
  await assert.rejects(f.run(), error => error.code === 2 && error.stdout.includes('blocked') && !error.stderr.includes('POISON'));
  const name = (await readdir(f.output)).find(name => name.startsWith('run-'));
  const plan = JSON.parse(await readFile(path.join(f.output, name, 'plan.private.json'), 'utf8'));
  assert.ok(plan.blockers.some(item => item.code === 'MEMBER_IDENTITY_MISMATCH'));
  assert.equal(plan.writesPerformed, 0);
});

for (const [httpStatus, status, code] of [[404, 'not-found', 'STORAGE_BUCKET_NOT_FOUND'], [403, 'forbidden', 'STORAGE_ACCESS_DENIED']]) {
  test(`CLI saves a private Firestore/Auth report with a Storage HTTP ${httpStatus} migration blocker and exits 2`, async t => {
    const f = await fixture(t);
    f.inventory.coverage.complete = false;
    f.inventory.coverage.storagePrefixes = [];
    f.inventory.coverage.missingCollections = ['storage'];
    f.inventory.coverage.storageCheck = { verified: false, status, code, httpStatus, message: 'POISON_PRIVATE_ERROR' };
    await writeFile(f.snapshot, JSON.stringify(f.inventory), { mode: 0o600 });
    await assert.rejects(f.run(), error => error.code === 2 && error.stdout.includes('blocked')
      && error.stdout.includes('Zapisów Firebase: 0') && error.stdout.includes(`HTTP ${httpStatus}`)
      && error.stdout.includes('raport Firestore/Auth zachowano') && !error.stderr.includes('Dry-run przerwany'));
    const run = (await readdir(f.output)).find(name => name.startsWith('run-'));
    const directory = path.join(f.output, run);
    const plan = JSON.parse(await readFile(path.join(directory, 'plan.private.json'), 'utf8'));
    const inventory = JSON.parse(await readFile(path.join(directory, 'inventory.private.json'), 'utf8'));
    const report = await readFile(path.join(directory, 'report.md'), 'utf8');
    assert.equal(plan.status, 'blocked'); assert.equal(plan.canApply, false); assert.equal(plan.writesPerformed, 0);
    assert.equal(plan.summary.storageVerified, false);
    assert.ok(plan.blockers.some(item => item.code === code));
    assert.equal(inventory.collections.members.length, 5);
    assert.equal(inventory.auth.length, 5);
    assert.equal(inventory.coverage.authVerified, true);
    assert.equal(inventory.coverage.complete, false);
    assert.match(report, /NIE ZWERYFIKOWANO — BLOKADA MIGRACJI/);
    assert.ok(report.includes(`HTTP ${httpStatus}`));
    assert.match(report, /Zaobserwowane obiekty Storage \(wyłącznie metadane\): 0/);
    assert.match(report, /nie potwierdza braku plików/);
    assert.match(report, /Nie utworzono magazynu ani nie zmieniono jego uprawnień/);
    for (const file of await readdir(directory)) {
      assert.equal((await stat(path.join(directory, file))).mode & 0o077, 0);
      assert.equal((await readFile(path.join(directory, file), 'utf8')).includes('POISON'), false);
    }
  });
}

test('CLI reports file source counts and rejects another bucket without leaking the original URL', async t => {
  const f = await fixture(t);
  f.inventory.collections.quickProducts.push({ id: 'synthetic-product', path: 'quickProducts/synthetic-product',
    data: { imageURL: 'https://firebasestorage.googleapis.com/v0/b/other-bucket.appspot.com/o/quick-products%2Ftest-person-0%2Fproduct.png?token=POISON_SECRET' },
    updateTime: { seconds: '1791878400', nanoseconds: 11 } });
  await writeFile(f.snapshot, JSON.stringify(f.inventory), { mode: 0o600 });
  await assert.rejects(f.run(), error => error.code === 2 && error.stdout.includes('blocked'));
  const run = (await readdir(f.output)).find(name => name.startsWith('run-'));
  const dir = path.join(f.output, run);
  const plan = JSON.parse(await readFile(path.join(dir, 'plan.private.json'), 'utf8'));
  assert.ok(plan.blockers.some(item => item.code === 'FILE_SOURCE_BUCKET_NOT_VERIFIED'));
  const report = await readFile(path.join(dir, 'report.md'), 'utf8');
  assert.match(report, /firebase-storage: 1/);
  assert.match(report, /Nie sprawdzono wszystkich bucketów projektu, lokalizacji UE/);
  for (const file of await readdir(dir)) assert.equal((await readFile(path.join(dir, file), 'utf8')).includes('POISON'), false);
});

test('publicly readable or symlinked identity files cannot initialize a live or offline inventory', async t => {
  const f = await fixture(t);
  await chmod(f.input, 0o644);
  await assert.rejects(f.run(), error => error.code === 2 && error.stderr.includes('PRIVATE_FILE_PERMISSIONS_REQUIRED'));
  await chmod(f.input, 0o600);
  const link = path.join(f.directory, 'linked.private.json');
  await symlink(f.input, link);
  await assert.rejects(exec(process.execPath, [cli, '--config', link, '--output', f.output, '--snapshot', f.snapshot], { env: f.env }), error => error.code === 2 && error.stderr.includes('PRIVATE_FILE_PERMISSIONS_REQUIRED'));
});

test('a changed UID mapping cannot silently reuse an earlier proposal and unsupported write flags create nothing', async t => {
  const f = await fixture(t);
  await f.run();
  const before = await readFile(path.join(f.output, 'proposal.private.json'), 'utf8');
  const different = structuredClone(f.c); different.members[2].uid = 'another-child-test';
  await assert.rejects(prepareLocalProposal(f.output, different), { code: 'PROPOSAL_MAPPING_CHANGED' });
  assert.equal(await readFile(path.join(f.output, 'proposal.private.json'), 'utf8'), before);
  const forbiddenOutput = path.join(f.directory, 'forbidden-output');
  await assert.rejects(exec(process.execPath, [cli, '--config', f.input, '--output', forbiddenOutput, '--apply'], { env: f.env }), error => error.code === 2 && error.stderr.includes('UNSUPPORTED_ARGUMENT'));
  await assert.rejects(stat(forbiddenOutput), { code: 'ENOENT' });
});
