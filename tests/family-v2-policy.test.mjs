import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFamilyV2WriteAllowed, familyV2WritesAllowed } from '../server/family-v2-policy.mjs';

const context = projectId => ({ app: { options: { projectId } } });
const production = context('nasza-rodzina');
const demo = context('demo-nasza-rodzina');
const local = { FIREBASE_PROJECT_ID: 'demo-nasza-rodzina', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };

test('finance release enables only finance and never Preview or mixed emulator configuration', () => {
  const env = { FINANCE_WRITES_ENABLED: 'true' };
  assert.equal(familyV2WritesAllowed(production, env, 'finance'), true);
  for (const domain of [undefined, 'tasks', 'health']) assert.equal(familyV2WritesAllowed(production, env, domain), false);
  assert.equal(familyV2WritesAllowed(production, { ...env, VERCEL_ENV: 'preview' }, 'finance'), false);
  assert.equal(familyV2WritesAllowed(production, { ...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, 'finance'), false);
});

test('tasks-only release cannot enable health or finance, or bypass Preview and emulator guards', () => {
  const env = { TASKS_WRITES_ENABLED: 'true' };
  assert.equal(familyV2WritesAllowed(production, env, 'tasks'), true);
  for (const domain of [undefined, 'finance', 'health']) assert.equal(familyV2WritesAllowed(production, env, domain), false);
  assert.equal(familyV2WritesAllowed(production, { ...env, VERCEL_ENV: 'preview' }, 'tasks'), false);
  assert.equal(familyV2WritesAllowed(production, { ...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, 'tasks'), false);
});

test('health-only release does not enable finance/tasks and keeps production and Preview boundaries', () => {
  const env = { HEALTH_WRITES_ENABLED: 'true' };
  assert.equal(familyV2WritesAllowed(production, env, 'health'), true);
  for (const domain of ['finance', 'tasks', undefined]) assert.equal(familyV2WritesAllowed(production, env, domain), false);
  assert.equal(familyV2WritesAllowed(production, { ...env, VERCEL_ENV: 'preview' }, 'health'), false);
  assert.equal(familyV2WritesAllowed(production, { ...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, 'health'), false);
});

test('v2 writes are disabled by default and require the exact server-owned opt-in', () => {
  assert.equal(familyV2WritesAllowed(production, {}), false);
  for (const value of ['false', 'TRUE', '1', 'yes', true]) assert.equal(familyV2WritesAllowed(production, { FAMILY_V2_WRITES_ENABLED: value }), false);
  assert.equal(familyV2WritesAllowed(production, { FAMILY_V2_WRITES_ENABLED: 'true' }), true);
  assert.throws(() => assertFamilyV2WriteAllowed(production, {}), error => error.status === 503 && error.code === 'FAMILY_V2_READ_ONLY');
});

test('Preview can never enable writes, including a locally bound demo or a true switch', () => {
  for (const ctx of [production, demo]) {
    for (const env of [{ VERCEL_ENV: 'preview' }, { VERCEL: '1', VERCEL_ENV: 'preview', FAMILY_V2_WRITES_ENABLED: 'true' },
      { ...local, VERCEL_ENV: 'preview' }, { ...local, VERCEL_ENV: 'preview', FAMILY_V2_WRITES_ENABLED: 'true' }]) {
      assert.equal(familyV2WritesAllowed(ctx, env), false);
    }
  }
});

test('automatic emulator writes are confined to a demo project and both exact local endpoints', () => {
  assert.equal(familyV2WritesAllowed(demo, local), true);
  assert.equal(familyV2WritesAllowed(production, local), false);
  const invalid = [
    { ...local, FIREBASE_AUTH_EMULATOR_HOST: 'remote.example.invalid:9099' },
    { ...local, FIRESTORE_EMULATOR_HOST: 'remote.example.invalid:8080' },
    { ...local, FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' },
    { ...local, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181' },
    { ...local, FIREBASE_AUTH_EMULATOR_HOST: undefined },
    { ...local, FIRESTORE_EMULATOR_HOST: undefined },
    { ...local, VERCEL: '1' },
    { ...local, FIREBASE_PROJECT_ID: 'another-demo' },
  ];
  for (const env of invalid) {
    assert.equal(familyV2WritesAllowed(demo, env), false);
    assert.equal(familyV2WritesAllowed(demo, { ...env, FAMILY_V2_WRITES_ENABLED: 'true' }), false);
  }
  assert.equal(familyV2WritesAllowed(demo, { FAMILY_V2_WRITES_ENABLED: 'true' }), false);
});

test('production opt-in cannot make a production project use emulator credentials', () => {
  assert.equal(familyV2WritesAllowed(production, { ...local, FAMILY_V2_WRITES_ENABLED: 'true' }), false);
  assert.equal(familyV2WritesAllowed(production, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FAMILY_V2_WRITES_ENABLED: 'true' }), false);
});
