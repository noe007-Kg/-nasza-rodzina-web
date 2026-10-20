import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPLOY_ARGUMENTS } from '../scripts/deploy-music-school-job.mjs';
import { prepareMusicDeployPackage } from '../scripts/lib/music-school-deploy-package.mjs';
test('release targets only the new production function and fails instead of asking for secrets', () => {
  assert.deepEqual([...DEPLOY_ARGUMENTS], ['-y', 'firebase-tools@latest', 'deploy', '--non-interactive', '--project', 'nasza-rodzina', '--only', 'functions:nasza-rodzina:musicSchoolPublicHourly']);
});
test('isolated upload declares only music job, no Calendar or SP4 secrets or unrelated env files', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const staged = await prepareMusicDeployPackage(root);
  try {
    const config = JSON.parse(await readFile(staged.configFile, 'utf8'));
    assert.equal(config.firestore, undefined); assert.equal(config.storage, undefined);
    assert.equal(config.functions[0].codebase, 'nasza-rodzina');
    assert.equal(config.functions[0].predeploy, undefined);
    const index = await readFile(join(staged.directory, 'functions/index.mjs'), 'utf8');
    assert.deepEqual([...index.matchAll(/export const (\w+)/g)].map(m => m[1]), ['musicSchoolPublicHourly']);
    assert.doesNotMatch(index, /defineSecret|CALENDAR_ENCRYPTION_KEY|EDUVULCAN_ENCRYPTION_KEY|GOOGLE_CALENDAR_CLIENT_SECRET/);
    assert.equal(await readFile(join(staged.directory, 'functions/.env.nasza-rodzina'), 'utf8'), 'MUSIC_SCHOOL_ENABLED=true\n');
    assert.equal(JSON.parse(await readFile(join(staged.directory, 'functions/package.json'), 'utf8')).scripts, undefined);
    const modules = await readdir(join(staged.directory, 'functions/server'));
    assert.ok(modules.includes('music-school-service.mjs'));
    assert.equal(modules.includes('calendar-scheduler.mjs'), false);
    for (const name of modules) assert.doesNotMatch(await readFile(join(staged.directory, 'functions/server', name), 'utf8'), /defineSecret/);
  } finally { await rm(staged.directory, { recursive: true, force: true }); }
});
