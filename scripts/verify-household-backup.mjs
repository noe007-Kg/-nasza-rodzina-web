#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openHouseholdBackup, backupDigest } from './lib/household-backup-archive.mjs';
import { readPrivateBytes, securePrivateDirectory, writePrivateFile, safeControlError, controlFailure as fail } from './lib/household-private-files.mjs';
import { verifyHouseholdRestore, assertRestoreTarget } from './lib/household-restore-verifier.mjs';
import { rehearseHouseholdRollback } from './lib/household-rollback-rehearsal.mjs';
import { probeHouseholdRules } from './lib/household-isolation-probes.mjs';

export async function runBackupVerification(options, env = process.env) {
  if (options.emulators !== true || env.GCLOUD_PROJECT !== options.project) fail('RESTORE_EXPLICIT_EMULATOR_MODE_REQUIRED');
  const target = { projectId: options.project, firestoreHost: env.FIRESTORE_EMULATOR_HOST,
    authHost: env.FIREBASE_AUTH_EMULATOR_HOST, storageHost: env.FIREBASE_STORAGE_EMULATOR_HOST };
  assertRestoreTarget(target);
  const output = await securePrivateDirectory(path.dirname(path.resolve(options.output)));
  const archive = await readPrivateBytes(options.backup), key = await readPrivateBytes(options['key-file'], 32);
  const payload = openHouseholdBackup(archive, key);
  const result = await verifyHouseholdRestore(payload, target);
  if (payload.plan?.blockers?.length === 0) result.rollback = await rehearseHouseholdRollback(payload, target);
  if (payload.rules?.firestore?.sourceFiles?.length === 1 && payload.rules?.storage?.sourceFiles?.length === 1) {
    result.isolation = await probeHouseholdRules(target, { firestoreRules: payload.rules.firestore.sourceFiles[0].content,
      storageRules: payload.rules.storage.sourceFiles[0].content });
  }
  result.archiveDigestSha256 = backupDigest(archive);
  await writePrivateFile(path.join(output, path.basename(options.output)), JSON.stringify(result, null, 2) + '\n');
  return result;
}
export function parseRestoreArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i].replace(/^--/, '');
    if (args[i] === '--emulators' && !options.emulators) options.emulators = true;
    else if (['project', 'backup', 'key-file', 'output'].includes(name) && !Object.hasOwn(options, name)
      && args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) options[name] = args[++i];
    else fail('RESTORE_ARGUMENT_INVALID');
  }
  if (!options.emulators || ['project', 'backup', 'key-file', 'output'].some(name => !options[name])) fail('RESTORE_ARGUMENT_REQUIRED');
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runBackupVerification(parseRestoreArguments(process.argv.slice(2)));
    console.log(`Test odtworzenia lokalnego: ${result.verified ? 'PASS' : 'NIEKOMPLETNY'}. Zapisy produkcyjne: 0.`);
    if (!result.verified) process.exitCode = 2;
  } catch (error) { console.error(`Test odtworzenia przerwany (${safeControlError(error)}). Zapisy produkcyjne: 0.`); process.exitCode = 2; }
}
