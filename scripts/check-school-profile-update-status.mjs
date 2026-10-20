#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { sameProfileVersion } from './lib/school-profile-plan.mjs';
let app;
try {
  const [directory, flag, project, ...extra] = process.argv.slice(2);
  if (!directory || flag !== '--project' || project !== 'nasza-rodzina' || extra.length) throw new Error('EXPLICIT_DIRECTORY_PROJECT_REQUIRED');
  if (Object.keys(process.env).some(k => k.endsWith('EMULATOR_HOST') && process.env[k])) throw new Error('UNEXPECTED_EMULATOR_ENVIRONMENT');
  const plan = JSON.parse(await readFile(join(directory, 'plan.private.json'), 'utf8'));
  const backup = JSON.parse(await readFile(join(directory, 'fields-before.private.json'), 'utf8'));
  if (plan.projectId !== project || backup.projectId !== project || plan.profiles?.length !== 5 || backup.profiles?.length !== 5
    || plan.profiles.some(p => !/^[A-Za-z0-9_-]{1,128}$/.test(p.uid))) throw new Error('INVALID_PLAN');
  app = initializeApp({ projectId: project, credential: applicationDefault() }, 'read-only-school-update-status');
  const db = getFirestore(app);
  const docs = await db.getAll(...plan.profiles.map(p => db.collection('members').doc(p.uid)), { fieldMask: ['familyId', 'schoolEnabled'] });
  let planned = 0, original = 0, versionsChanged = 0;
  for (const doc of docs) {
    const p = plan.profiles.find(p => p.uid === doc.id), b = backup.profiles.find(p => p.uid === doc.id), data = doc.data() ?? {};
    if (!b || !doc.exists) throw new Error('PROFILE_MISSING');
    if (Object.entries(p.patch).every(([key, value]) => data[key] === value)) planned++;
    if (Object.entries(b.fields).every(([key, f]) => Object.hasOwn(data, key) === f.present && (!f.present || data[key] === f.value))) original++;
    if (!sameProfileVersion(doc.updateTime, b.version)) versionsChanged++;
  }
  console.log('Profile zgodne z planowanymi polami:', planned, '/ 5');
  console.log('Profile z polami jak w kopii:', original, '/ 5');
  console.log('Profile o wersji zmienionej od kopii:', versionsChanged, '/ 5');
  for (const name of ['apply-intent.private.json', 'applied.private.json', 'rollback-intent.private.json', 'rolled-back.private.json']) {
    let exists = false;
    try { await readFile(join(directory, name)); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw new Error('LOCAL_EVIDENCE_UNREADABLE'); }
    console.log(name + ':', exists ? 'ISTNIEJE' : 'BRAK');
  }
  console.log('Kontrola tylko do odczytu. Nie wykonano zapisów ani ponowienia operacji.');
} catch (error) {
  console.error('Kontrola nieukończona:', /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'READ_CHECK_FAILED');
  console.error('Brak zapisów. Nie ponawiaj --apply do wyjaśnienia wyniku.');
  process.exitCode = 1;
} finally { if (app) await deleteApp(app); }
