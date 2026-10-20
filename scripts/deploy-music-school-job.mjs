#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { GoogleAuth } from 'google-auth-library';
import { validateProfileUpdateEvidence } from './lib/school-profile-update.mjs';
import { prepareMusicDeployPackage } from './lib/music-school-deploy-package.mjs';
import { inspectSchoolProfileRules, SCHOOL_PROFILE_RULE_HASHES } from './lib/school-profile-plan.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const DEPLOY_ARGUMENTS = Object.freeze(['-y', 'firebase-tools@latest', 'deploy', '--non-interactive', '--project', 'nasza-rodzina', '--only', 'functions:nasza-rodzina:musicSchoolPublicHourly']);
async function run() {
  const [directory, flag, project, ...extra] = process.argv.slice(2);
  if (!directory || flag !== '--project' || project !== 'nasza-rodzina' || extra.length) throw new Error('EXPLICIT_DIRECTORY_PROJECT_REQUIRED');
  if (process.versions.node.split('.')[0] !== '22') throw new Error('NODE_22_REQUIRED');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PRIVATE_INTERACTIVE_TERMINAL_REQUIRED');
  if (Object.keys(process.env).some(k => k.endsWith('EMULATOR_HOST') && process.env[k])) throw new Error('UNEXPECTED_EMULATOR_ENVIRONMENT');
  const load = async file => JSON.parse(await readFile(join(directory, file), 'utf8'));
  const backup = await load('fields-before.private.json'), plan = await load('plan.private.json'), preparation = await load('preparation.private.json'), applied = await load('applied.private.json');
  const receipts = [];
  for (const name of await readdir(directory)) if (/^restore-emulator-[a-f0-9-]+\.private\.json$/.test(name)) receipts.push(await load(name));
  const binding = validateProfileUpdateEvidence(backup, plan, preparation, receipts);
  if (applied.status !== 'applied' || applied.backupSha256 !== binding.backupSha256 || applied.planSha256 !== binding.planSha256) throw new Error('APPLIED_PROFILE_EVIDENCE_REQUIRED');
  const config = JSON.parse(await readFile(join(root, 'firebase.json'), 'utf8'));
  if (!config.functions?.some(f => f.codebase === 'nasza-rodzina' && f.source === 'functions' && f.runtime === 'nodejs22')) throw new Error('FUNCTIONS_TARGET_CHANGED');
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  for (const [service, release] of [['firestore', 'cloud.firestore'], ['storage', 'firebase.storage/nasza-rodzina.firebasestorage.app']]) {
    const active = await client.request({ method: 'GET', url: `https://firebaserules.googleapis.com/v1/projects/nasza-rodzina/releases/${release}` });
    const name = active.data.rulesetName;
    if (!/^projects\/nasza-rodzina\/rulesets\/[A-Za-z0-9_-]+$/.test(name)) throw new Error('RULESET_REFERENCE_INVALID');
    const response = await client.request({ method: 'GET', url: `https://firebaserules.googleapis.com/v1/${name}` });
    if (!inspectSchoolProfileRules(response.data.source?.files, SCHOOL_PROFILE_RULE_HASHES[service]).matched) throw new Error('PRODUCTION_RULES_CHANGED');
  }
  const app = initializeApp({ projectId: project, credential: applicationDefault() }, 'music-job-release-check');
  try {
    const db = getFirestore(app);
    const docs = await db.getAll(...plan.profiles.map(p => db.collection('members').doc(p.uid)), { fieldMask: ['familyId', 'schoolEnabled', 'active', 'archived', 'disabled', 'canLogin', 'role'] });
    if (docs.filter(d => d.data()?.role === 'parent').length !== 2 || docs.filter(d => d.data()?.canLogin === true).length !== 4) throw new Error('PROFILE_ROSTER_CHANGED');
    for (const doc of docs) {
      const data = doc.data(), patch = plan.profiles.find(p => p.uid === doc.id).patch;
      if (!doc.exists || data.active !== true || data.archived || data.disabled || !['parent', 'child', 'adult'].includes(data.role)
        || Object.entries(patch).some(([k, v]) => data[k] !== v) || patch.schoolEnabled && (data.role === 'parent' || data.canLogin !== true)) throw new Error('LIVE_PROFILE_CONFIGURATION_CHANGED');
    }
    const auth = await getAuth(app).getUsers(docs.filter(d => d.data().canLogin === true).map(d => ({ uid: d.id })));
    if (auth.users.length !== 4 || auth.notFound.length || auth.users.some(u => u.disabled)) throw new Error('AUTH_CHECK_FAILED');
  } finally { await deleteApp(app); }
  const staged = await prepareMusicDeployPackage(root);
  console.log('Kontrole PASS. Osobny pakiet zawiera tylko musicSchoolPublicHourly i jego zależności, bez deklaracji sekretów innych modułów.');
  const status = await new Promise((accept, reject) => {
    const child = spawn('npx', [...DEPLOY_ARGUMENTS, '--config', staged.configFile], { cwd: staged.directory, stdio: 'inherit', env: { ...process.env, npm_config_cache: '/tmp/nasza-rodzina-npm-cache' } });
    child.on('error', reject); child.on('exit', (code, signal) => accept(signal ? 1 : code));
  });
  if (status !== 0) throw new Error('DEPLOY_NOT_CONFIRMED');
  console.log('Firebase CLI potwierdził wdrożenie nowej funkcji. Frontend Vercel i zapis planu ucznia wymagają osobnej weryfikacji.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error('Wdrożenie zatrzymane lub niepotwierdzone:', /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'RELEASE_CHECK_FAILED'); process.exitCode = 1; });
}
