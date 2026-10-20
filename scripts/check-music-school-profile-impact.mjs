#!/usr/bin/env node
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { captureProfileImpact, assessProfileImpact } from './lib/music-school-profile-impact.mjs';

// No --apply, --migrate, inferred production target or credentials accepted in arguments.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--project' || !/^[a-z][a-z0-9-]{4,62}$/.test(args[1])) {
  console.error('Użycie: node scripts/check-music-school-profile-impact.mjs --project PROJECT_ID (wyłącznie odczyt)');
  process.exitCode = 1;
} else if (Object.keys(process.env).some(key => key.endsWith('EMULATOR_HOST') && process.env[key])) {
  console.error('EMULATOR_ENVIRONMENT_DETECTED: kontrola produkcyjna nie została wykonana.');
  process.exitCode = 1;
} else if (Number(process.versions.node.split('.')[0]) !== 22) {
  console.error('NODE_22_REQUIRED'); process.exitCode = 1;
} else {
  let app;
  try {
    app = initializeApp({ projectId: args[1], credential: applicationDefault() }, 'music-profile-impact');
    const context = { db: getFirestore(app), auth: getAuth(app) };
    const first = await captureProfileImpact(context), second = await captureProfileImpact(context);
    console.log(JSON.stringify({ projectId: args[1], node: process.versions.node, ...assessProfileImpact(first, second) }, null, 2));
  } catch {
    console.error('PROFILE_IMPACT_CHECK_FAILED: nie potwierdzono dostępu lub kompletności kontroli. Niczego nie zapisano.');
    process.exitCode = 1;
  } finally { if (app) await deleteApp(app); }
}
