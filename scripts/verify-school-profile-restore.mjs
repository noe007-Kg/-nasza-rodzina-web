import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rehearseSchoolProfileFields, profilePlanHash } from './lib/school-profile-plan.mjs';

// No Admin SDK, ADC, production project URL or credential headers are used.
export function emulatorEndpoint(host) {
  if (host !== '127.0.0.1:8787') throw new Error('LOCAL_EMULATOR_REQUIRED');
  return `http://${host}/v1/projects/demo-school-profile-restore/databases/(default)/documents`;
}
export async function verifyRestore(directory, host) {
  const endpoint = emulatorEndpoint(host);
  const backup = JSON.parse(await readFile(join(directory, 'fields-before.private.json'), 'utf8'));
  const plan = JSON.parse(await readFile(join(directory, 'plan.private.json'), 'utf8'));
  if (backup.projectId !== 'nasza-rodzina' || backup.profiles?.length !== 5 || new Set(backup.profiles.map(p => p.uid)).size !== 5) throw new Error('BACKUP_SCOPE_INVALID');
  rehearseSchoolProfileFields(backup, plan);
  const encode = value => value === null ? { nullValue: null } : typeof value === 'boolean' ? { booleanValue: value } : typeof value === 'string' ? { stringValue: value } : (() => { throw new Error('FIELD_TYPE_INVALID'); })();
  const run = randomUUID();
  async function request(path, method = 'GET', body) {
    const response = await fetch(`${endpoint}/${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`EMULATOR_REQUEST_FAILED_${response.status}`);
    return response.json();
  }
  // Anonymous synthetic document IDs: real UIDs never leave the private local files.
  for (const [index, before] of backup.profiles.entries()) {
    const path = `restore_${run}/${index}`;
    if (Object.keys(before.fields).some(k => !['familyId', 'schoolEnabled'].includes(k))) throw new Error('BACKUP_SCOPE_INVALID');
    const fields = { untouchedMarker: { stringValue: 'preserved' } };
    for (const [key, field] of Object.entries(before.fields)) {
      if (typeof field.present !== 'boolean') throw new Error('BACKUP_FIELD_INVALID');
      if (field.present) fields[key] = encode(field.value);
    }
    await request(path, 'PATCH', { fields });
    assert.deepEqual((await request(path)).fields, fields);
    const patch = plan.profiles.find(p => p.uid === before.uid).patch;
    const changed = { ...fields };
    for (const [key, value] of Object.entries(patch)) changed[key] = encode(value);
    const masks = Object.keys(patch).map(k => `updateMask.fieldPaths=${k}`).join('&');
    await request(`${path}?${masks}`, 'PATCH', { fields: changed });
    assert.deepEqual((await request(path)).fields, changed);
    // Missing fields omitted under updateMask are deleted, preserving absent vs null/false.
    await request(`${path}?${masks}`, 'PATCH', { fields });
    assert.deepEqual((await request(path)).fields, fields);
  }
  const receipt = { schemaVersion: 1, scope: backup.scope, verifiedAt: new Date().toISOString(), backupSha256: profilePlanHash(backup), planSha256: profilePlanHash(plan), emulatorProject: 'demo-school-profile-restore', restoredProfiles: 5, emulatorFieldRestoreVerified: true, productionRestoreVerified: false, fullApplicationBackupVerified: false, productionWrites: 0, canApply: false };
  await writeFile(join(directory, `restore-emulator-${run}.private.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('PASS: odtworzenie i rollback pól 5 profili w emulatorze; zachowano brak/null/false i pole kontrolne. Produkcyjne zapisy: 0. Pełna kopia aplikacji: NIEZWERYFIKOWANA.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    if (process.versions.node.split('.')[0] !== '22') throw new Error('NODE_22_REQUIRED');
    if (process.argv[2] === '--worker') {
      await verifyRestore(process.env.NR_PROFILE_RESTORE_DIRECTORY, process.env.FIRESTORE_EMULATOR_HOST);
    } else {
      if (process.argv.length !== 3) throw new Error('PRIVATE_BACKUP_DIRECTORY_REQUIRED');
      const directory = resolve(process.argv[2]);
      const configDirectory = await mkdtemp(join(tmpdir(), 'nr-school-restore-'));
      const config = join(configDirectory, 'firebase.json');
      await writeFile(config, JSON.stringify({ emulators: { firestore: { host: '127.0.0.1', port: 8787 }, ui: { enabled: false }, singleProjectMode: true } }), { mode: 0o600 });
      const child = spawnSync('npx', ['-y', 'firebase-tools@latest', 'emulators:exec', '--project', 'demo-school-profile-restore', '--config', config, '--only', 'firestore', 'node scripts/verify-school-profile-restore.mjs --worker'], { cwd: resolve(new URL('..', import.meta.url).pathname), stdio: 'inherit', env: { ...process.env, NR_PROFILE_RESTORE_DIRECTORY: directory, npm_config_cache: '/tmp/nasza-rodzina-npm-cache' } });
      if (child.error || child.status !== 0) throw new Error('EMULATOR_RESTORE_NOT_VERIFIED');
    }
  } catch (error) {
    console.error('Test odtworzenia niezaliczony. Brak zapisów produkcyjnych. Kod:', /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'RESTORE_CHECK_FAILED');
    process.exitCode = 1;
  }
}
