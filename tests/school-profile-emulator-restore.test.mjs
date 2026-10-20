import test from 'node:test';
import assert from 'node:assert/strict';
import { emulatorEndpoint } from '../scripts/verify-school-profile-restore.mjs';
test('restore only accepts exact loopback emulator endpoint with fixed demo project', () => {
  assert.equal(emulatorEndpoint('127.0.0.1:8787'), 'http://127.0.0.1:8787/v1/projects/demo-school-profile-restore/databases/(default)/documents');
  for (const host of [undefined, '', 'firestore.googleapis.com', 'localhost:8787', '127.0.0.1:8787@evil.example', '127.0.0.1:8080', 'https://127.0.0.1:8787']) assert.throws(() => emulatorEndpoint(host), /LOCAL_EMULATOR_REQUIRED/);
});

test('complete REST rehearsal verifies updates and rollback and binds evidence to private files', async () => {
  const { mkdtemp, writeFile, readdir, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { prepareSchoolProfilePlan } = await import('../scripts/lib/school-profile-plan.mjs');
  const { verifyRestore } = await import('../scripts/verify-school-profile-restore.mjs');
  const profiles = Array.from({ length: 5 }, (_, i) => ({ uid: `private-uid-${i}`, version: { seconds: 1, nanoseconds: i }, data: { active: true, canLogin: i !== 4, role: i < 2 ? 'parent' : 'child', ...(i === 1 ? { familyId: null, schoolEnabled: false } : {}) } }));
  const { backup, plan } = prepareSchoolProfilePlan({ profiles, schoolUids: ['private-uid-2', 'private-uid-3'], authUsers: profiles.slice(0, 4).map(p => ({ uid: p.uid, disabled: false })), householdConfirmed: true, familyId: 'family-12345678-1234-4234-8234-123456789abc', projectId: 'nasza-rodzina' });
  const dir = await mkdtemp(join(tmpdir(), 'restore-test-'));
  const savedFetch = globalThis.fetch;
  let writes = 0;
  const docs = new Map();
  try {
    await writeFile(join(dir, 'fields-before.private.json'), JSON.stringify(backup));
    await writeFile(join(dir, 'plan.private.json'), JSON.stringify(plan));
    globalThis.fetch = async (url, options) => {
      assert.ok(url.startsWith(emulatorEndpoint('127.0.0.1:8787') + '/'));
      assert.equal(url.includes('private-uid'), false);
      assert.equal(options.headers.Authorization, undefined);
      const u = new URL(url), key = u.pathname;
      if (options.method === 'PATCH') {
        writes++;
        const input = JSON.parse(options.body).fields, masks = u.searchParams.getAll('updateMask.fieldPaths');
        if (!masks.length) docs.set(key, input);
        else { const fields = docs.get(key); for (const k of masks) { if (Object.hasOwn(input, k)) fields[k] = input[k]; else delete fields[k]; } }
      }
      return { ok: true, json: async () => ({ fields: structuredClone(docs.get(key)) }) };
    };
    await verifyRestore(dir, '127.0.0.1:8787');
    assert.equal(writes, 15);
    const receiptName = (await readdir(dir)).find(n => n.startsWith('restore-emulator-'));
    const receipt = JSON.parse(await readFile(join(dir, receiptName), 'utf8'));
    assert.equal(receipt.backupSha256, plan.backupSha256);
    assert.equal(receipt.productionRestoreVerified, false);
    assert.equal(receipt.canApply, false);
  } finally { globalThis.fetch = savedFetch; await rm(dir, { recursive: true, force: true }); }
});
