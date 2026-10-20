#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { GoogleAuth } from 'google-auth-library';
import { inspectSchoolProfileRules, SCHOOL_PROFILE_RULE_HASHES } from './lib/school-profile-plan.mjs';
import { captureProfileImpact, assessProfileImpact, PROFILE_IMPACT_FIELDS } from './lib/music-school-profile-impact.mjs';
import { validateProfileUpdateEvidence, validateCurrentProfiles, applyProfileTransaction, rollbackProfileTransaction } from './lib/school-profile-update.mjs';

let app, prompt, writeAttempted = false;
try {
  const [mode, directory, projectFlag, project, ...extra] = process.argv.slice(2);
  if (!['--check', '--apply', '--rollback'].includes(mode) || !directory || projectFlag !== '--project' || project !== 'nasza-rodzina' || extra.length) throw new Error('EXPLICIT_MODE_DIRECTORY_PROJECT_REQUIRED');
  if (process.versions.node.split('.')[0] !== '22') throw new Error('NODE_22_REQUIRED');
  if (Object.keys(process.env).some(k => k.endsWith('EMULATOR_HOST') && process.env[k])) throw new Error('UNEXPECTED_EMULATOR_ENVIRONMENT');
  const load = async file => JSON.parse(await readFile(join(directory, file), 'utf8'));
  const backup = await load('fields-before.private.json'), plan = await load('plan.private.json'), preparation = await load('preparation.private.json');
  const receipts = [];
  for (const name of await readdir(directory)) if (/^restore-emulator-[a-f0-9-]+\.private\.json$/.test(name)) receipts.push(await load(name));
  const binding = validateProfileUpdateEvidence(backup, plan, preparation, receipts);
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  async function checkRules() {
    for (const [service, release] of [['firestore', 'cloud.firestore'], ['storage', 'firebase.storage/nasza-rodzina.firebasestorage.app']]) {
      const active = await client.request({ method: 'GET', url: `https://firebaserules.googleapis.com/v1/projects/nasza-rodzina/releases/${release}` });
      const name = active.data.rulesetName;
      if (!/^projects\/nasza-rodzina\/rulesets\/[A-Za-z0-9_-]+$/.test(name)) throw new Error('RULESET_REFERENCE_INVALID');
      const response = await client.request({ method: 'GET', url: `https://firebaserules.googleapis.com/v1/${name}` });
      if (!inspectSchoolProfileRules(response.data.source?.files, SCHOOL_PROFILE_RULE_HASHES[service]).matched) throw new Error('PRODUCTION_RULES_CHANGED');
    }
  }
  await checkRules();
  app = initializeApp({ projectId: project, credential: applicationDefault() }, 'bounded-school-profile-update');
  const db = getFirestore(app), auth = getAuth(app);
  if (mode !== '--rollback') {
    const first = await captureProfileImpact({ db, auth }), second = await captureProfileImpact({ db, auth });
    const report = assessProfileImpact(first, second);
    if (!report.metadataComplete || !report.metadataStableBetweenReads || !report.auth.verified || report.auth.disabledLogins
      || Object.values(report.potentialAccessLoss).some(n => n > 0)
      || report.blockers.some(b => ['UNRESOLVED_UID_REFERENCES', 'PERSON_ONLY_REFERENCE_REVIEW_REQUIRED', 'INVALID_FAMILY_ID_REVIEW_REQUIRED'].includes(b.code))) throw new Error('CURRENT_IMPACT_REVIEW_REQUIRED');
    const profiles = second.collections.members.rows.map(p => ({ uid: p.id, data: p.data, version: p.versionParts }));
    const authResult = await auth.getUsers(profiles.filter(p => p.data.canLogin === true).map(p => ({ uid: p.uid })));
    const authUsers = authResult.users.map(u => ({ uid: u.uid, disabled: u.disabled === true }));
    validateCurrentProfiles(profiles, backup, plan, authUsers);
    console.log('PASS: kopia i plan powiązane z dowodem odtworzenia; reguły zgodne z przejrzanym wzorcem; aktualne UID/Auth i wersje 5 profili zgodne; brak wykrytej utraty dostępu w sprawdzonych metadanych.');
    console.log('Zakres: dokładnie 7 pól w members. Brak zmian planów lekcji, sesji SP4, ról, reguł i innych kolekcji.');
    console.log('Ograniczenia: kopia tylko wskazanych pól; starsze reguły nie zapewniają pełnej izolacji gospodarstw; kontrola metadanych nie jest atomowym snapshotem całej bazy; Storage plików nie zinwentaryzowano.');
    if (mode === '--check') {
      console.log('Zapisy: 0. Jest to kontrola ograniczonej zmiany profili, NIE zgoda na wdrożenie całej aplikacji ani odblokowanie Zadań/Finansów.');
    } else {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_INTERACTIVE_TERMINAL_REQUIRED');
      prompt = createInterface({ input: process.stdin, output: process.stdout });
      if ((await prompt.question('Zapis 7 pól w produkcji. Wpisz ZAPISZ 7, aby zatwierdzić wyłącznie ten plan: ')).trim() !== 'ZAPISZ 7') throw new Error('CANCELLED_BY_OWNER');
      await checkRules();
      // Persistent intent prevents blind retries after a network failure or terminal disconnect.
      await writeFile(join(directory, 'apply-intent.private.json'), JSON.stringify({ ...binding, at: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
      const refreshedAuth = await auth.getUsers(profiles.filter(p => p.data.canLogin === true).map(p => ({ uid: p.uid })));
      const currentAuthUsers = refreshedAuth.users.map(u => ({ uid: u.uid, disabled: u.disabled === true }));
      validateCurrentProfiles(profiles, backup, plan, currentAuthUsers);
      writeAttempted = true;
      await applyProfileTransaction(db, backup, plan, currentAuthUsers, PROFILE_IMPACT_FIELDS);
      const docs = await db.getAll(...plan.profiles.map(p => db.collection('members').doc(p.uid)), { fieldMask: ['familyId', 'schoolEnabled'] });
      const profilesAfter = docs.map(d => ({ uid: d.id, version: { seconds: d.updateTime.seconds, nanoseconds: d.updateTime.nanoseconds } }));
      if (docs.some(d => Object.entries(plan.profiles.find(p => p.uid === d.id).patch).some(([k, v]) => d.data()?.[k] !== v))) throw new Error('POST_WRITE_REVIEW_REQUIRED');
      await writeFile(join(directory, 'applied.private.json'), JSON.stringify({ ...binding, status: 'applied', verifiedAt: new Date().toISOString(), profiles: profilesAfter }), { mode: 0o600, flag: 'wx' });
      console.log('PASS: zapisano 7 pól w jednej transakcji i odczytano wynik. Prywatny dowód do rollbacku zapisany. Niczego nie wdrożono.');
    }
  } else {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_INTERACTIVE_TERMINAL_REQUIRED');
    const receipt = await load('applied.private.json');
    prompt = createInterface({ input: process.stdin, output: process.stdout });
    if ((await prompt.question('Wycofanie wyłącznie 7 pól. Wpisz COFNIJ 7: ')).trim() !== 'COFNIJ 7') throw new Error('CANCELLED_BY_OWNER');
    await checkRules();
    await writeFile(join(directory, 'rollback-intent.private.json'), JSON.stringify({ ...binding, at: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    writeAttempted = true;
    await rollbackProfileTransaction(db, backup, plan, receipt, () => FieldValue.delete(), PROFILE_IMPACT_FIELDS);
    const restored = await db.getAll(...plan.profiles.map(p => db.collection('members').doc(p.uid)), { fieldMask: ['familyId', 'schoolEnabled'] });
    for (const doc of restored) {
      const before = backup.profiles.find(p => p.uid === doc.id), patch = plan.profiles.find(p => p.uid === doc.id).patch;
      const data = doc.data() ?? {};
      for (const key of Object.keys(patch)) {
        const field = before.fields[key];
        if (Object.hasOwn(data, key) !== field.present || field.present && data[key] !== field.value) throw new Error('ROLLBACK_POST_READ_REVIEW_REQUIRED');
      }
    }
    await writeFile(join(directory, 'rolled-back.private.json'), JSON.stringify({ ...binding, status: 'rolled-back', at: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    console.log('PASS: transakcja wycofania 7 pól zakończona; pozostałe pola bez zmian.');
  }
} catch (error) {
  console.error('Kontrola/operacja zatrzymana:', /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'CHECK_OR_OPERATION_FAILED');
  console.error(writeAttempted ? 'Zapis był próbowany. Nie ponawiaj w ciemno: wynik wymaga sprawdzenia z prywatnym dziennikiem.' : 'Nie próbowano zapisu danych produkcyjnych.');
  process.exitCode = 1;
} finally { prompt?.close(); if (app) await deleteApp(app); }
