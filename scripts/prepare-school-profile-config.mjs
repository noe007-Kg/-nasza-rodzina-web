#!/usr/bin/env node
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { captureProfileImpact, assessProfileImpact, PROFILE_IMPACT_FIELDS } from './lib/music-school-profile-impact.mjs';
import { prepareSchoolProfilePlan, rehearseSchoolProfileFields, profilePlanHash, SCHOOL_PROFILE_RULE_HASHES, sameProfileVersion } from './lib/school-profile-plan.mjs';

const args = process.argv.slice(2);
let app, prompt;
try {
  if (args.length !== 2 || args[0] !== '--project' || args[1] !== 'nasza-rodzina') throw new Error('EXPLICIT_PROJECT_REQUIRED');
  if (process.versions.node.split('.')[0] !== '22') throw new Error('NODE_22_REQUIRED');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_INTERACTIVE_TERMINAL_REQUIRED');
  if (Object.keys(process.env).some(k => k.endsWith('EMULATOR_HOST') && process.env[k])) throw new Error('UNEXPECTED_EMULATOR_ENVIRONMENT');
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  for (const [service, release] of [['firestore', 'cloud.firestore'], ['storage', 'firebase.storage/nasza-rodzina.firebasestorage.app']]) {
    const active = await client.request({ method: 'GET', url: `https://firebaserules.googleapis.com/v1/projects/nasza-rodzina/releases/${release}` });
    const name = active.data.rulesetName;
    if (!/^projects\/nasza-rodzina\/rulesets\/[A-Za-z0-9_-]+$/.test(name)) throw new Error('RULESET_REFERENCE_INVALID');
    const response = await client.request({ method: 'GET', url: `https://firebaserules.googleapis.com/v1/${name}` });
    const files = response.data.source?.files;
    if (!Array.isArray(files) || files.length !== 1 || typeof files[0].content !== 'string'
      || profilePlanHash(files[0].content) !== SCHOOL_PROFILE_RULE_HASHES[service]) throw new Error('PRODUCTION_RULES_CHANGED');
  }
  app = initializeApp({ projectId: args[1], credential: applicationDefault() }, 'prepare-school-profile-config');
  const context = { db: getFirestore(app), auth: getAuth(app) };
  console.log('Wyłącznie przygotowanie prywatnej kopii pól. Brak zapisów Firebase. Sprawdzam aktualne metadane.');
  const first = await captureProfileImpact(context), second = await captureProfileImpact(context);
  const report = assessProfileImpact(first, second);
  const unresolved = report.blockers.some(b => ['UNRESOLVED_UID_REFERENCES', 'PERSON_ONLY_REFERENCE_REVIEW_REQUIRED', 'INVALID_FAMILY_ID_REVIEW_REQUIRED'].includes(b.code));
  if (!report.metadataComplete || !report.metadataStableBetweenReads || !report.auth.verified || report.auth.disabledLogins || unresolved
    || Object.values(report.potentialAccessLoss).some(n => n > 0)) throw new Error('PROFILE_IMPACT_REVIEW_REQUIRED');
  const records = await context.db.collection('members').select(...PROFILE_IMPACT_FIELDS, 'name', 'personKey').limit(6).get();
  const profiles = records.docs.map(doc => ({ uid: doc.id, data: doc.data(), version: { seconds: doc.updateTime.seconds, nanoseconds: doc.updateTime.nanoseconds } })).sort((a, b) => a.uid.localeCompare(b.uid));
  if (profiles.length !== 5 || profiles.some(p => !second.collections.members.rows.some(old => old.id === p.uid
    && sameProfileVersion(old.versionParts, p.version)))) throw new Error('PROFILE_SNAPSHOT_CHANGED');
  const authResult = await context.auth.getUsers(profiles.filter(p => p.data.canLogin === true).map(p => ({ uid: p.uid })));
  const authUsers = authResult.users.map(u => ({ uid: u.uid, disabled: u.disabled === true }));
  console.log('Prywatny przegląd profili. Numer wskazuje rzeczywisty UID, nie wyszukiwanie po imieniu.');
  profiles.forEach((p, i) => console.log(`${i + 1}. ${String(p.data.name || p.data.personKey || 'Profil').replace(/[\r\n\u001b]/g, '')} | ${p.data.role} | końcówka UID: …${p.uid.slice(-8)} | konto: ${p.data.canLogin ? authUsers.some(u => u.uid === p.uid && !u.disabled) ? 'UID potwierdzony w Auth' : 'NIEZWERYFIKOWANE' : 'profil bez logowania'}`));
  prompt = createInterface({ input: process.stdin, output: process.stdout });
  const confirmation = await prompt.question('Czy te pięć profili należy do Twojego gospodarstwa? Wpisz TAK, aby przygotować plan (bez zapisu): ');
  if (confirmation.trim() !== 'TAK') throw new Error('CANCELLED_BY_OWNER');
  const selection = (await prompt.question('Wpisz dwa numery z tej listy: profil Pawła i profil Nikodema, np. 2,4: ')).trim();
  if (!/^[1-5]\s*,\s*[1-5]$/.test(selection)) throw new Error('INVALID_STUDENT_SELECTION');
  const schoolUids = selection.split(',').map(n => profiles[Number(n.trim()) - 1].uid);
  const { backup, plan } = prepareSchoolProfilePlan({ projectId: args[1], profiles, schoolUids, authUsers,
    householdConfirmed: true, familyId: `family-${randomUUID()}` });
  const directory = await mkdtemp(join(homedir(), '.nr-school-profiles-'));
  const backupFile = join(directory, 'fields-before.private.json'), planFile = join(directory, 'plan.private.json');
  await writeFile(backupFile, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(planFile, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const storedBackup = JSON.parse(await readFile(backupFile, 'utf8')), storedPlan = JSON.parse(await readFile(planFile, 'utf8'));
  const rehearsal = rehearseSchoolProfileFields(storedBackup, storedPlan);
  const receipt = { backupSha256: profilePlanHash(storedBackup), planSha256: profilePlanHash(storedPlan), ...rehearsal,
    fieldCount: plan.profiles.reduce((n, p) => n + Object.keys(p.patch).length, 0), productionWrites: 0 };
  await writeFile(join(directory, 'preparation.private.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('\nPODSUMOWANIE — bez danych osobowych');
  console.log('Prywatny katalog kopii:', directory);
  console.log('Profile: 5; wybrani uczniowie: 2; proponowane zmiany pól:', receipt.fieldCount);
  console.log('Integralność pliku i logiczne wycofanie pól: PASS. Odtworzenie Firestore: JESZCZE NIEZWERYFIKOWANE.');
  console.log('Kopia dotyczy wyłącznie wskazanych pól profili; nie jest pełną kopią aplikacji.');
  console.log('Zapisy produkcyjne: 0. Narzędzie nie zawiera trybu zastosowania planu.');
} catch (error) {
  const allowed = new Set(['EXPLICIT_PROJECT_REQUIRED', 'NODE_22_REQUIRED', 'PRIVATE_INTERACTIVE_TERMINAL_REQUIRED', 'UNEXPECTED_EMULATOR_ENVIRONMENT', 'RULESET_REFERENCE_INVALID', 'PRODUCTION_RULES_CHANGED', 'PROFILE_IMPACT_REVIEW_REQUIRED', 'PROFILE_SNAPSHOT_CHANGED', 'CANCELLED_BY_OWNER', 'INVALID_STUDENT_SELECTION', 'ROSTER_REVIEW_REQUIRED', 'INVALID_PROPOSED_FAMILY', 'INVALID_PROFILE', 'PROFILE_ALREADY_HAS_FAMILY', 'INVALID_SCHOOL_FLAG', 'AUTH_UID_NOT_VERIFIED', 'LOGIN_ROSTER_CHANGED', 'SELECT_TWO_VERIFIED_STUDENT_UIDS', 'BACKUP_INTEGRITY_FAILED', 'PATCH_SCOPE_INVALID', 'BACKUP_FIELD_MISSING', 'FIELD_ROLLBACK_FAILED']);
  console.error('Nie przygotowano potwierdzonego planu:', allowed.has(error.code || error.message) ? error.code || error.message : 'PREPARATION_FAILED');
  console.error('Nie zmieniono danych produkcyjnych.'); process.exitCode = 1;
} finally { prompt?.close(); if (app) await deleteApp(app); }
