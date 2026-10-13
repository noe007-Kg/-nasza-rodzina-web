#!/usr/bin/env node
/** This program has NO apply/rollback mode and never writes to Firebase. */
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { buildHouseholdMigrationPlan, validateHouseholdConfig } from './lib/household-migration-plan.mjs';
import { collectHouseholdInventory, sanitizeHouseholdSnapshot } from './lib/household-migration-inventory.mjs';
import { householdStorageCheck } from './lib/household-storage-status.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function parseHouseholdArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (['--help', '--dry-run', '--emulators'].includes(argument)) {
      if (options[argument.slice(2)]) fail('DUPLICATE_ARGUMENT');
      options[argument.slice(2)] = true;
    } else if (['--config', '--output', '--snapshot', '--max-documents'].includes(argument)) {
      const value = args[++i];
      if (!value || value.startsWith('--') || Object.hasOwn(options, argument.slice(2))) fail('INVALID_ARGUMENT');
      options[argument.slice(2)] = value;
    } else fail('UNSUPPORTED_ARGUMENT'); // --apply, --rollback and --migrate are deliberately rejected.
  }
  if (!options.help && (!options.config || !options.output)) fail('CONFIG_AND_OUTPUT_REQUIRED');
  if (options['max-documents'] && !/^\d+$/.test(options['max-documents'])) fail('INVALID_LIMIT');
  options.maximum = Number(options['max-documents'] || 10000);
  if (!Number.isInteger(options.maximum) || options.maximum < 1 || options.maximum > 50000) fail('INVALID_LIMIT');
  return options;
}

export function assertHouseholdEnvironment(config, options, env = process.env) {
  const names = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'];
  if (options.emulators) {
    if (!config.projectId.startsWith('demo-') || options.snapshot) fail('EMULATOR_PROJECT_REQUIRED');
    for (const [key, expected] of [[names[0], '127.0.0.1:8080'], [names[1], '127.0.0.1:9099'], [names[2], '127.0.0.1:9199']]) {
      if (env[key] !== expected) fail('EXPLICIT_LOCAL_EMULATORS_REQUIRED');
    }
  } else if (names.some(name => env[name])) fail('EMULATOR_MODE_REQUIRED');
  else if (!options.snapshot && config.projectId.startsWith('demo-')) fail('EMULATOR_MODE_REQUIRED');
  if (env.GCLOUD_PROJECT && env.GCLOUD_PROJECT !== config.projectId) fail('PROJECT_ENVIRONMENT_MISMATCH');
}

async function privateJson(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) fail('PRIVATE_FILE_PERMISSIONS_REQUIRED');
  if (info.size > 64 * 1024 * 1024) fail('PRIVATE_FILE_TOO_LARGE');
  return JSON.parse(await readFile(file, 'utf8'));
}
async function secureDirectory(directory) {
  const proposedRelative = path.relative(projectRoot, directory);
  if (proposedRelative === '' || (!proposedRelative.startsWith('..' + path.sep) && !path.isAbsolute(proposedRelative)
    && proposedRelative !== 'migration-private' && !proposedRelative.startsWith('migration-private' + path.sep))) fail('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) fail('PRIVATE_DIRECTORY_PERMISSIONS_REQUIRED');
  const resolved = await realpath(directory);
  const relative = path.relative(projectRoot, resolved);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
    && relative !== 'migration-private' && !relative.startsWith('migration-private' + path.sep))) fail('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  return resolved;
}
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const digest = value => createHash('sha256').update(value).digest('hex');
async function writePrivate(file, content) { await writeFile(file, content, { mode: 0o600, flag: 'wx' }); }

/** The local proposal is reused; changing the UID map requires a new private directory. */
export async function prepareLocalProposal(directory, config) {
  const fingerprint = digest(JSON.stringify({ projectId: config.projectId, bucket: config.bucket,
    members: [...config.members].sort((a, b) => a.uid.localeCompare(b.uid)) }));
  const proposalPath = path.join(directory, 'proposal.private.json');
  try {
    const previous = await privateJson(proposalPath);
    if (previous.schemaVersion !== 1 || previous.configFingerprint !== fingerprint || config.familyId && previous.familyId !== config.familyId
      || !/^family-[a-f0-9-]{36}$/.test(previous.familyId) && previous.familyId !== config.familyId) fail('PROPOSAL_MAPPING_CHANGED');
    return previous;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const proposed = { schemaVersion: 1, configFingerprint: fingerprint, familyId: config.familyId || `family-${randomUUID()}` };
    try { await writePrivate(proposalPath, encode(proposed)); }
    catch (value) { if (value.code === 'EEXIST') return prepareLocalProposal(directory, config); throw value; }
    return proposed;
  }
}

function report(plan, inventory, checks) {
  const counts = Object.entries(inventory.collections).map(([name, rows]) => `- \`${name}\`: ${rows.length}`).join('\n');
  const storage = householdStorageCheck(inventory.coverage);
  const storageMessage = storage.verified ? 'Zweryfikowano skan wymaganych prefiksów.'
    : `NIE ZWERYFIKOWANO — BLOKADA MIGRACJI (${storage.code}${storage.httpStatus ? ', HTTP ' + storage.httpStatus : ''}). ` +
      'Zaobserwowana liczba obiektów nie potwierdza braku plików. Nie utworzono magazynu ani nie zmieniono jego uprawnień.';
  // Paths/UIDs and candidate patches remain only in protected JSON, never in terminal output.
  return `# Przygotowanie gospodarstwa — dry-run\n\nStatus: ${plan.status}. Zapisów Firebase: 0. Tryb wykonania migracji: niedostępny.\n\nŹródło: ${inventory.source}. Propozycja familyId: ${plan.familyId}.\n\n` +
    `Planowanych zmian wyłącznie pola familyId: ${plan.changes.length}. Blokad: ${plan.blockers.length}. Ostrzeżeń: ${plan.warnings.length}.\n\n` +
    `## Zakres odczytu\n\n${counts}\n- Zaobserwowane obiekty Storage (wyłącznie metadane): ${inventory.storage.length}\n\nStorage: ${storageMessage}\n\n` +
    `## Ograniczenia\n\nUID ↔ gospodarstwo wymaga jawnego potwierdzenia operatora; brak starego familyId nie dowodzi wspólnego gospodarstwa. ` +
    `Nie czytano treści medycznych, danych przelewów, sesji eduVULCAN, tokenów OAuth ani tokenów pobierania Storage. Nie zmieniono ACL, punktów, plików lub kalendarzy. ` +
    `Nie zweryfikowano aktywnych reguł chmurowych ani pobranych bajtów plików. Migrowanie jest osobnym etapem wymagającym zgody, kopii bezpieczeństwa, okna spójności i ponownego odczytu wersji.\n\n` +
    `## Lokalne kontrakty reguł\n\nSHA-256 firestore.rules: ${checks.firestore}\n\nSHA-256 storage.rules: ${checks.storage}\n\n` +
    `## Pliki prywatne\n\nplan.private.json: dokładny manifest i blokady; rollback.private.json: warunki odtworzenia pola familyId; ` +
    `inventory.private.json: ograniczona inwentaryzacja; checksums.private.json: integralność lokalnych plików. ` +
    `To NIE jest pełna kopia Firestore ani kopia binarnych dokumentów. Nie dodawać katalogu wyników do GitHub.\n`;
}

export async function runHouseholdDryRun(options) {
  const config = validateHouseholdConfig(await privateJson(path.resolve(options.config)));
  assertHouseholdEnvironment(config, options);
  const directory = await secureDirectory(path.resolve(options.output));
  const proposal = await prepareLocalProposal(directory, config);
  let app, inventory;
  try {
    if (options.snapshot) inventory = sanitizeHouseholdSnapshot(await privateJson(path.resolve(options.snapshot)), config);
    else {
      // Explicit project and bucket; never infer a production destination from default app configuration.
      app = initializeApp({ projectId: config.projectId, storageBucket: config.bucket,
        ...(!options.emulators ? { credential: applicationDefault() } : {}) }, `household-dry-run-${randomUUID()}`);
      inventory = await collectHouseholdInventory({ db: getFirestore(app), auth: getAuth(app), bucket: getStorage(app).bucket(config.bucket) }, config, { maximum: options.maximum });
    }
    const plan = buildHouseholdMigrationPlan(config, inventory, { familyId: proposal.familyId, now: new Date() });
    const runDirectory = await secureDirectory(path.join(directory, `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`));
    const checks = { firestore: digest(await readFile(path.join(projectRoot, 'firestore.rules'))), storage: digest(await readFile(path.join(projectRoot, 'storage.rules'))) };
    const outputs = { 'plan.private.json': encode(plan), 'rollback.private.json': encode({ mode: 'instructions-only', canApply: false,
      familyId: plan.familyId, projectId: config.projectId, requiresApprovedBackupAndPostApplyVersions: true, changes: plan.rollback }),
      'inventory.private.json': encode(inventory), 'report.md': report(plan, inventory, checks) };
    for (const [name, content] of Object.entries(outputs)) await writePrivate(path.join(runDirectory, name), content);
    await writePrivate(path.join(runDirectory, 'checksums.private.json'), encode(Object.fromEntries(Object.entries(outputs).map(([name, content]) => [name, digest(content)]))));
    console.log(`Dry-run zakończony: ${plan.status}; zmian planowanych ${plan.changes.length}; blokad ${plan.blockers.length}; ostrzeżeń ${plan.warnings.length}. Zapisów Firebase: 0.`);
    const storage = householdStorageCheck(inventory.coverage);
    if (!storage.verified) console.log(`Storage NIE ZWERYFIKOWANO (${storage.code}${storage.httpStatus ? ', HTTP ' + storage.httpStatus : ''}). Blokada migracji; raport Firestore/Auth zachowano.`);
    console.log('Wyniki zapisano wyłącznie w prywatnym katalogu --output. Migracji nie wykonano.');
    return { plan, runDirectory };
  } finally { if (app) await deleteApp(app); }
}

async function main() {
  try {
    const options = parseHouseholdArguments(process.argv.slice(2));
    if (options.help) {
      console.log('node scripts/prepare-household-migration.mjs --config household.private.json --output PRIVATE_DIRECTORY [--dry-run] [--snapshot inventory.private.json | --emulators] [--max-documents 10000]');
      console.log('Tylko odczyt Firebase i plan lokalny. Brak --apply, --rollback, migracji, deploymentu lub włączania zapisów. Prywatne pliki: chmod 600; katalog wyników: chmod 700.');
      return;
    }
    const { plan } = await runHouseholdDryRun(options);
    if (plan.blockers.length) process.exitCode = 2;
  } catch (error) {
    const safe = typeof error.code === 'string' && /^[A-Z_0-9]{1,80}$/.test(error.code) ? error.code : 'DRY_RUN_FAILED';
    console.error(`Dry-run przerwany (${safe}). Nie wykonano zapisów Firebase. Sprawdź prywatną konfigurację, uprawnienia odczytu i instrukcję.`);
    process.exitCode = 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
