#!/usr/bin/env node
/** Read-only production control. All rehearsal writes run in a separate demo child. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, access } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import { GoogleAuth } from 'google-auth-library';
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { validateHouseholdConfig } from './lib/household-migration-plan.mjs';
import { assertHouseholdEnvironment, prepareLocalProposal } from './prepare-household-migration.mjs';
import { captureHouseholdEvidence } from './lib/household-evidence-capture.mjs';
import { sealHouseholdBackup, openHouseholdBackup, canonicalJson, backupDigest } from './lib/household-backup-archive.mjs';
import { assessHouseholdReadiness } from './lib/household-readiness-policy.mjs';
import { readPrivateJson, readPrivateBytes, securePrivateDirectory, writePrivateFile, safeControlError, controlFailure as fail } from './lib/household-private-files.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const quote = value => `'${value.replace(/'/g, "'\\''")}'`;
export function parsePreflightArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' && !options.help) options.help = true;
    else if (['--config', '--output', '--key-file', '--external-domains-file', '--app-origin'].includes(args[i])
      && !Object.hasOwn(options, args[i].slice(2)) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
    else fail('PREFLIGHT_ARGUMENT_INVALID');
  }
  if (!options.help && (!options.config || !options.output)) fail('PREFLIGHT_CONFIG_AND_OUTPUT_REQUIRED');
  if (options['app-origin']) {
    const origin = new URL(options['app-origin']);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port || origin.pathname !== '/' || origin.search || origin.hash
      || isIP(origin.hostname.replace(/^\[|\]$/g, '')) || !origin.hostname.includes('.')) fail('PREFLIGHT_APP_ORIGIN_INVALID');
  }
  return options;
}
export async function runAutomaticRestore(directory, archiveFile, keyFile, payload) {
  const project = `demo-household-restore-${randomBytes(4).toString('hex')}`;
  const emulatorConfig = { firestore: { rules: 'restore-firestore.rules' }, storage: { rules: 'restore-storage.rules' },
    emulators: { auth: { host: '127.0.0.1', port: 19099 }, firestore: { host: '127.0.0.1', port: 18080 },
      storage: { host: '127.0.0.1', port: 19199 }, hub: { host: '127.0.0.1', port: 14400 },
      ui: { enabled: false }, singleProjectMode: true } };
  const source = async service => payload.rules[service]?.sourceFiles?.length === 1
    ? payload.rules[service].sourceFiles[0].content : readFile(path.join(repository, `${service}.rules`), 'utf8');
  await writePrivateFile(path.join(directory, 'restore-firestore.rules'), await source('firestore'));
  await writePrivateFile(path.join(directory, 'restore-storage.rules'), await source('storage'));
  const configFile = path.join(directory, 'restore-emulators.private.json'), resultFile = path.join(directory, 'restore-proof.private.json');
  await writePrivateFile(configFile, JSON.stringify(emulatorConfig));
  const cli = path.join(repository, 'node_modules/firebase-tools/lib/bin/firebase.js');
  await access(cli);
  const command = [process.execPath, path.join(repository, 'scripts/verify-household-backup.mjs'), '--backup', archiveFile,
    '--key-file', keyFile, '--output', resultFile, '--project', project, '--emulators'].map(quote).join(' ');
  // A whitelist avoids passing arbitrary production keys to the rehearsal.
  // Keep the existing HOME value; never repurpose it as a task directory.
  const keep = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'JAVA_HOME', 'JAVA_TOOL_OPTIONS',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'FIREBASE_EMULATORS_PATH'];
  const env = { ...Object.fromEntries(keep.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
    GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: project, XDG_CONFIG_HOME: path.join(directory, 'emulator-config'),
    // The CLI normally starts Firestore with FINE request logs. Java reads
    // _JAVA_OPTIONS last: prevent document contents entering those debug logs.
    _JAVA_OPTIONS: '-Dgoogle.cloud_firestore.debug_log_level=OFF' };
  let lastControlCode = null;
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'emulators:exec', '--project', project, '--only', 'auth,firestore,storage', '--config', configFile, command],
      { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let outputSize = 0;
    const discard = bytes => {
      outputSize += bytes.length;
      const match = /Test odtworzenia przerwany \(([A-Z_0-9]{1,100})\)/.exec(bytes.toString('utf8'));
      if (match) lastControlCode = match[1];
      if (outputSize > 4 * 1024 * 1024) child.kill('SIGTERM');
    };
    child.stdout.on('data', discard); child.stderr.on('data', discard);
    child.on('error', () => reject(Object.assign(new Error('RESTORE_EMULATOR_START_FAILED'), { code: 'RESTORE_EMULATOR_START_FAILED' })));
    child.on('exit', code => resolve(code));
  });
  try { return { ...(await readPrivateJson(resultFile)), emulatorExitCode: exit }; }
  catch { return { verified: false, code: lastControlCode || 'RESTORE_EMULATOR_RUN_FAILED', emulatorExitCode: exit }; }
}
export async function runHouseholdPreflight(options) {
  const config = validateHouseholdConfig(await readPrivateJson(options.config));
  assertHouseholdEnvironment(config, {});
  const directory = await securePrivateDirectory(options.output);
  const proposal = await prepareLocalProposal(directory, config);
  const run = await securePrivateDirectory(path.join(directory, `evidence-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`));
  const key = options['key-file'] ? await readPrivateBytes(options['key-file'], 32) : randomBytes(32);
  if (key.length !== 32) fail('BACKUP_KEY_INVALID');
  const keyFile = options['key-file'] ? path.resolve(options['key-file']) : path.join(run, 'backup.key');
  if (!options['key-file']) await writePrivateFile(keyFile, key);
  let app, proof;
  try {
    const authClient = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
    const request = requestOptions => authClient.request({ ...requestOptions, maxContentLength: 64 * 1024 * 1024, maxRedirects: 0, timeout: 30000 });
    app = initializeApp({ credential: applicationDefault(), projectId: config.projectId, storageBucket: config.bucket }, `household-preflight-${randomUUID()}`);
    const allowedDomains = options['external-domains-file'] ? await readPrivateJson(options['external-domains-file'], 16384) : [];
    const capture = await captureHouseholdEvidence(config, proposal.familyId, { db: getFirestore(app), auth: getAuth(app), bucket: getStorage(app).bucket(config.bucket), request,
      localFirestoreRules: await readFile(path.join(repository, 'firestore.rules'), 'utf8'), localStorageRules: await readFile(path.join(repository, 'storage.rules'), 'utf8') },
    { appOrigin: options['app-origin'], allowedDomains });
    await deleteApp(app); app = null; // Source credentials/app do not enter the restore process.
    await writePrivateFile(path.join(run, 'plan.private.json'), JSON.stringify(capture.plan, null, 2));
    await writePrivateFile(path.join(run, 'rollback.private.json'), JSON.stringify({ mode: 'instructions-only', canApply: false,
      changes: capture.plan.rollback, postApplyReceiptRequired: true, archiveRequired: true }, null, 2));
    let backup = { complete: false }, restore = { verified: false };
    if (capture.payload) {
      const bytes = sealHouseholdBackup(capture.payload, key), file = path.join(run, 'household-backup.nrb');
      await writePrivateFile(file, bytes);
      const disk = await readPrivateBytes(file);
      const recovered = openHouseholdBackup(disk, key);
      const valid = canonicalJson(recovered) === canonicalJson(capture.payload);
      backup = { complete: capture.captureComplete, manifestHashesVerified: valid, archiveDigestSha256: backupDigest(disk),
        capturedAt: capture.payload.createdAt, scope: 'full-default-firestore-and-current-selected-bucket-plus-captured-external-files' };
      await writePrivateFile(path.join(run, 'attestation-template.private.json'), JSON.stringify({ ownerReviewed: false, boundPlanDigest: capture.planDigest,
        projectId: config.projectId, profiles: config.members, statement: 'Potwierdź rzeczywiste istniejące UID, role i jedno gospodarstwo. Nie zaznaczaj na podstawie samych imion.' }, null, 2));
      restore = await runAutomaticRestore(run, file, keyFile, capture.payload);
    }
    proof = { ...assessHouseholdReadiness({ ...capture, backup, restore, planDigest: capture.planDigest,
      isolation: restore.isolation, household: { ownerReviewed: false }, tokens: capture.payload?.evidence.tokens }),
    backup, restore, sourceProjectId: config.projectId, productionWritesPerformed: 0,
    ruleChecks: Object.fromEntries(Object.entries(capture.rules || {}).map(([service, item]) => [service, { verified: item.verified, status: item.status, sha256: item.sha256, localSha256: item.localSha256, code: item.code }])),
    externalCapturedCount: (capture.externalFiles || []).filter(row => row.status === 'captured').length,
    externalUnverifiedCount: (capture.externalFiles || []).filter(row => row.status !== 'captured').length };
  } catch (error) { proof = { status: 'blocked', code: safeControlError(error), canApply: false, migrationExecutable: false,
    productionWritesPerformed: 0, backup: { complete: false }, restore: { verified: false } }; }
  finally { if (app) await deleteApp(app); key.fill(0); }
  await writePrivateFile(path.join(run, 'control-proof.private.json'), JSON.stringify(proof, null, 2));
  await writePrivateFile(path.join(run, 'report.md'), `# Kontrola przed migracją\n\nStatus: ${proof.status}. Zapisów produkcyjnych: 0. Migracja: niedostępna.\n\n` +
    `Kompletna kopia danych: ${proof.backup?.complete === true ? 'TAK, w zadeklarowanym zakresie' : 'NIE ZWERYFIKOWANO'}. Test odtworzenia: ${proof.restore?.verified === true ? 'PASS, lokalny projekt demo' : 'NIE ZWERYFIKOWANO'}.\n\n` +
    `Blokady: ${(proof.blockers || [proof.code]).filter(Boolean).join(', ')}.\n\n` +
    'Nie skopiowano haseł Auth, sekretów Secret Manager ani niedostępnej historii dostawców. Zgodność bieżących odczytów nie jest atomową migawką między usługami. Pełna izolacja backendu i powiadomień nie jest potwierdzona przez sam test reguł. Kopię i klucz należy przechowywać oddzielnie oraz zachować drugą zweryfikowaną kopię poza środowiskiem tymczasowym.\n');
  return proof;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parsePreflightArguments(process.argv.slice(2));
    if (options.help) console.log('node scripts/household-preflight.mjs --config PRIVATE_CONFIG --output PRIVATE_DIRECTORY [--key-file PRIVATE_KEY] [--external-domains-file PRIVATE_DOMAINS] [--app-origin HTTPS_ORIGIN]. Tylko odczyt produkcji; odtworzenie i rollback wyłącznie lokalnie w demo. Brak apply/deploy/delete.');
    else {
      const proof = await runHouseholdPreflight(options);
      console.log(`Kontrola: ${proof.status}; kopia kompletna: ${proof.backup?.complete === true ? 'tak' : 'niezweryfikowana'}; odtworzenie: ${proof.restore?.verified === true ? 'PASS' : 'niezweryfikowane'}. Zapisów produkcyjnych: 0.`);
      console.log('Wyniki i zaszyfrowana kopia znajdują się wyłącznie w prywatnym katalogu --output. Migracji nie wykonano.');
      if (proof.status === 'blocked') process.exitCode = 2;
    }
  } catch (error) { console.error(`Kontrola przerwana (${safeControlError(error)}). Zapisów produkcyjnych: 0.`); process.exitCode = 2; }
}
