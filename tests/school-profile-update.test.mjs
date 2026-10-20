import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareSchoolProfilePlan, profilePlanHash } from '../scripts/lib/school-profile-plan.mjs';
import { validateProfileUpdateEvidence, validateCurrentProfiles, applyProfileTransaction, rollbackProfileTransaction } from '../scripts/lib/school-profile-update.mjs';
function fixture() {
  const profiles = Array.from({ length: 5 }, (_, i) => ({ uid: `uid-${i}`, version: { seconds: 10, nanoseconds: i }, data: { active: true, canLogin: i !== 4, role: i < 2 ? 'parent' : 'child', ...(i === 1 ? { familyId: null, schoolEnabled: false } : {}) } }));
  const authUsers = profiles.slice(0, 4).map(p => ({ uid: p.uid, disabled: false }));
  const { backup, plan } = prepareSchoolProfilePlan({ profiles, authUsers, schoolUids: ['uid-2', 'uid-3'], householdConfirmed: true, familyId: 'family-12345678-1234-4234-8234-123456789abc', projectId: 'nasza-rodzina' });
  const preparation = { backupSha256: profilePlanHash(backup), planSha256: profilePlanHash(plan), fieldCount: 7, productionWrites: 0 };
  const receipts = [{ ...preparation, schemaVersion: 1, scope: backup.scope, emulatorProject: 'demo-school-profile-restore', restoredProfiles: 5, emulatorFieldRestoreVerified: true, canApply: false, verifiedAt: new Date().toISOString() }];
  return { backup: structuredClone(backup), plan: structuredClone(plan), preparation, receipts, profiles: structuredClone(profiles), authUsers };
}
function database(profiles) {
  const writes = [];
  let read = false;
  return { writes, collection: name => ({ doc: uid => ({ name, uid }) }), runTransaction: async (fn, options) => {
    assert.equal(options.maxAttempts, 1);
    return fn({ getAll: async (...args) => { assert.equal(writes.length, 0); assert.ok(args.at(-1).fieldMask); read = true; return profiles.map(p => ({ id: p.uid, data: () => p.data, updateTime: p.version })); }, update: (ref, patch) => { assert.ok(read); assert.equal(ref.name, 'members'); writes.push({ ref, patch }); } });
  } };
}
test('bounded plan requires exact backup, preparation and real-emulator receipt bindings', () => {
  const f = fixture();
  assert.equal(validateProfileUpdateEvidence(f.backup, f.plan, f.preparation, f.receipts).fieldCount, 7);
  for (const receipts of [[], [{ ...f.receipts[0], planSha256: 'different' }], [{ ...f.receipts[0], emulatorFieldRestoreVerified: false }], [{ ...f.receipts[0], emulatorProject: 'nasza-rodzina' }]]) assert.throws(() => validateProfileUpdateEvidence(f.backup, f.plan, f.preparation, receipts), /EMULATOR_RESTORE_EVIDENCE_REQUIRED/);
});
test('foreign UID, changed household, extra patch and missing fields cannot be approved', () => {
  for (const mutate of [f => { f.plan.profiles[0].uid = 'foreign'; }, f => { f.plan.profiles[0].patch.familyId = 'other-family'; }, f => { f.plan.profiles[0].patch.role = 'parent'; }, f => { delete f.backup.profiles[0].fields.familyId; }, f => { f.plan.profiles[2].patch.schoolEnabled = false; }]) {
    const f = fixture(); mutate(f); assert.throws(() => validateProfileUpdateEvidence(f.backup, f.plan, f.preparation, f.receipts));
  }
});
test('changed version, revoked Auth and parent substituted for student fail closed', () => {
  for (const mutate of [f => { f.profiles[0].version.nanoseconds++; }, f => { f.authUsers[0].disabled = true; }, f => { f.profiles[2].data.role = 'parent'; }, f => { f.profiles[0].data.familyId = 'foreign'; }]) {
    const f = fixture(); mutate(f); assert.throws(() => validateCurrentProfiles(f.profiles, f.backup, f.plan, f.authUsers));
  }
});
test('apply reads all profiles before queueing only five bounded updates in one transaction', async () => {
  const f = fixture(), db = database(f.profiles);
  await applyProfileTransaction(db, f.backup, f.plan, f.authUsers, ['familyId']);
  assert.equal(db.writes.length, 5);
  assert.equal(db.writes.reduce((n, w) => n + Object.keys(w.patch).length, 0), 7);
});
test('one stale profile prevents every update', async () => {
  const f = fixture(); f.profiles[4].version.nanoseconds++;
  const db = database(f.profiles);
  await assert.rejects(applyProfileTransaction(db, f.backup, f.plan, f.authUsers, ['familyId']), /PROFILE_VERSION_CHANGED/);
  assert.equal(db.writes.length, 0);
});
function applied(f) {
  for (const p of f.profiles) { Object.assign(p.data, f.plan.profiles.find(x => x.uid === p.uid).patch); p.version = { seconds: 20, nanoseconds: p.version.nanoseconds }; }
  return { status: 'applied', backupSha256: profilePlanHash(f.backup), planSha256: profilePlanHash(f.plan), profiles: f.profiles.map(p => ({ uid: p.uid, version: { ...p.version } })) };
}
test('rollback restores absent and null fields and never touches unrelated fields', async () => {
  const f = fixture(), receipt = applied(f), db = database(f.profiles), deleted = Symbol('delete');
  await rollbackProfileTransaction(db, f.backup, f.plan, receipt, () => deleted, ['familyId']);
  assert.equal(db.writes[0].patch.familyId, deleted);
  assert.equal(db.writes[1].patch.familyId, null);
  assert.equal(db.writes[2].patch.schoolEnabled, deleted);
  assert.equal(db.writes.reduce((n, w) => n + Object.keys(w.patch).length, 0), 7);
});
test('rollback blocks foreign receipt and concurrent modification without any update', async () => {
  for (const mutate of [(f, r) => { r.planSha256 = 'other'; }, f => { f.profiles[0].version.nanoseconds++; }, f => { f.profiles[3].data.schoolEnabled = false; }]) {
    const f = fixture(), receipt = applied(f); mutate(f, receipt); const db = database(f.profiles);
    await assert.rejects(rollbackProfileTransaction(db, f.backup, f.plan, receipt, () => null, ['familyId']));
    assert.equal(db.writes.length, 0);
  }
});
test('production CLI keeps check read-only, requires explicit terminal confirmation and private intent before attempting commit', async () => {
  const source = await readFile(new URL('../scripts/update-school-profiles.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf("if (mode === '--check')") < source.indexOf('await applyProfileTransaction'));
  assert.ok(source.indexOf("'apply-intent.private.json'") < source.indexOf('await applyProfileTransaction'));
  assert.match(source, /ZAPISZ 7/); assert.match(source, /COFNIJ 7/);
  assert.match(source, /flag: 'wx'/);
  assert.doesNotMatch(source, /collection\(['"](?:calendarEvents|tasks|schoolItems)['"]\).*\.(?:update|set|delete)/);
});
