import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareSchoolProfilePlan, rehearseSchoolProfileFields, profilePlanHash, sameProfileVersion, inspectSchoolProfileRules, SCHOOL_PROFILE_RULE_HASHES } from '../scripts/lib/school-profile-plan.mjs';

const familyId = 'family-12345678-1234-4234-8234-123456789abc';
test('rule diagnostics report exact match and single-character hash differences without weakening the guard', () => {
  const content = 'rules_version = "2"; private-test-marker', hash = profilePlanHash(content);
  assert.equal(inspectSchoolProfileRules([{ content }], hash).matched, true);
  const changed = `${hash[0] === 'a' ? 'b' : 'a'}${hash.slice(1)}`;
  const result = inspectSchoolProfileRules([{ content }], changed);
  assert.equal(result.matched, false); assert.equal(result.firstDifferentPosition, 0);
  assert.equal(JSON.stringify(result).includes('private-test-marker'), false);
});
test('invalid/multiple source files and missing pin remain blocked', () => {
  const hash = profilePlanHash('source');
  for (const files of [null, [], [{ content: 'source' }, { content: 'source' }], [{}], [{ content: null }]]) assert.equal(inspectSchoolProfileRules(files, hash).matched, false);
  assert.equal(inspectSchoolProfileRules([{ content: 'source' }], null).matched, false);
});
test('profile version matching preserves nanoseconds instead of comparing truncated SDK milliseconds', () => {
  const a = { seconds: 1792480000, nanoseconds: 123456000 };
  assert.equal(sameProfileVersion(a, { ...a }), true);
  assert.equal(sameProfileVersion(a, { ...a, nanoseconds: 123457000 }), false);
});
test('missing version evidence cannot be accepted', () => {
  assert.equal(sameProfileVersion(null, null), false);
  assert.equal(sameProfileVersion({ seconds: 1 }, { seconds: 1 }), false);
});
function input() {
  return { projectId: 'nasza-rodzina', householdConfirmed: true, familyId,
    profiles: Array.from({ length: 5 }, (_, i) => ({ uid: `uid-${i}`, version: { seconds: 1792480000, nanoseconds: i * 1000 },
      data: { active: true, canLogin: i !== 4, role: i < 2 ? 'parent' : 'child' } })),
    schoolUids: ['uid-2', 'uid-3'], authUsers: Array.from({ length: 4 }, (_, i) => ({ uid: `uid-${i}`, disabled: false })) };
}
test('proposal is limited to five household fields and two explicitly selected school flags', () => {
  const { plan } = prepareSchoolProfilePlan(input());
  assert.equal(plan.canApply, false); assert.equal(plan.writesPerformed, 0);
  assert.equal(plan.profiles.reduce((n, p) => n + Object.keys(p.patch).length, 0), 7);
  for (const p of plan.profiles) assert.deepEqual(p.patch, { familyId, ...(['uid-2', 'uid-3'].includes(p.uid) ? { schoolEnabled: true } : {}) });
});
test('UID selection never derives school assignment from name or array order', () => {
  const data = input(); data.profiles.forEach(p => p.data.name = 'Same name'); data.profiles.reverse();
  const { plan } = prepareSchoolProfilePlan(data);
  assert.deepEqual(plan.profiles.filter(p => p.patch.schoolEnabled).map(p => p.uid).sort(), ['uid-2', 'uid-3']);
});
test('missing login flag on a non-login child and old null school flags are preserved without extra writes', () => {
  const data = input(); delete data.profiles[4].data.canLogin;
  data.profiles[0].data.schoolEnabled = null; data.profiles[2].data.schoolEnabled = null;
  const { backup, plan } = prepareSchoolProfilePlan(data);
  assert.deepEqual(plan.profiles[4].patch, { familyId });
  assert.deepEqual(plan.profiles[0].patch, { familyId });
  assert.equal(plan.profiles[2].patch.schoolEnabled, true);
  assert.equal(rehearseSchoolProfileFields(backup, plan).logicalFieldRollbackVerified, true);
});
test('an existing adult student keeps their role and receives no administrator rights', () => {
  const data = input(); data.profiles[2].data.role = 'adult';
  const { plan } = prepareSchoolProfilePlan(data);
  assert.deepEqual(plan.profiles[2].patch, { familyId, schoolEnabled: true });
  assert.equal(Object.hasOwn(plan.profiles[2].patch, 'role'), false);
  assert.equal(data.profiles[2].data.role, 'adult');
});
test('unconfirmed household and different project cannot generate a plan', () => {
  assert.throws(() => prepareSchoolProfilePlan({ ...input(), householdConfirmed: false }));
  assert.throws(() => prepareSchoolProfilePlan({ ...input(), projectId: 'another-project' }));
});
test('missing/foreign/disabled Auth account is rejected', () => {
  for (const users of [[], input().authUsers.slice(1), input().authUsers.map(u => ({ ...u, disabled: u.uid === 'uid-2' }))]) {
    assert.throws(() => prepareSchoolProfilePlan({ ...input(), authUsers: users }), /AUTH_UID_NOT_VERIFIED/);
  }
});
test('parent, absent UID, duplicate UID or non-login profile cannot be selected as these students', () => {
  for (const schoolUids of [['uid-0', 'uid-2'], ['foreign', 'uid-3'], ['uid-2', 'uid-2'], ['uid-2', 'uid-4']]) {
    assert.throws(() => prepareSchoolProfilePlan({ ...input(), schoolUids }), /SELECT_TWO_VERIFIED_STUDENT_UIDS/);
  }
});
test('existing explicit/legacy household is never overwritten', () => {
  for (const value of ['existing-family', '__legacy__', undefined]) {
    const data = input(); data.profiles[0].data.familyId = value;
    assert.throws(() => prepareSchoolProfilePlan(data), /PROFILE_ALREADY_HAS_FAMILY/);
  }
});
test('modified role, inactive profile, invalid flags and duplicate roster are rejected', () => {
  for (const change of [d => d.profiles[2].data.active = false,
    d => d.profiles[2].data.schoolEnabled = 'true', d => d.profiles[2].data.role = 'parent',
    d => d.profiles[2].uid = d.profiles[1].uid]) {
    const data = input(); change(data); assert.throws(() => prepareSchoolProfilePlan(data));
  }
});
test('backup retains absent vs null vs false and full version precision through disk-format JSON', () => {
  const data = input(); data.profiles[0].data.familyId = null; data.profiles[1].data.schoolEnabled = false;
  const { backup, plan } = prepareSchoolProfilePlan(data);
  const stored = JSON.parse(JSON.stringify(backup));
  assert.deepEqual(stored.profiles[0].fields.familyId, { present: true, value: null });
  assert.deepEqual(stored.profiles[1].fields.schoolEnabled, { present: true, value: false });
  assert.deepEqual(stored.profiles[2].fields.familyId, { present: false });
  assert.equal(stored.profiles[3].version.nanoseconds, 3000);
  assert.equal(profilePlanHash(stored), plan.backupSha256);
  assert.equal(rehearseSchoolProfileFields(stored, JSON.parse(JSON.stringify(plan))).logicalFieldRollbackVerified, true);
});
test('logical rollback never claims full backup or actual Firestore restore evidence', () => {
  const { backup, plan } = prepareSchoolProfilePlan(input()), result = rehearseSchoolProfileFields(backup, plan);
  assert.equal(result.restoredProfiles, 5); assert.equal(result.firestoreRestoreVerified, false);
  assert.equal(result.fullApplicationBackupVerified, false); assert.equal(plan.evidence.productionApplyImplemented, false);
});
test('tampered backup, unknown fields and missing UID in plan are rejected', () => {
  const { backup, plan } = prepareSchoolProfilePlan(input());
  const damaged = structuredClone(backup); damaged.profiles[0].fields.familyId = { present: true, value: 'tampered' };
  assert.throws(() => rehearseSchoolProfileFields(damaged, plan), /BACKUP_INTEGRITY_FAILED/);
  const altered = structuredClone(plan); altered.profiles[0].patch.role = 'parent';
  assert.throws(() => rehearseSchoolProfileFields(backup, altered), /PATCH_SCOPE_INVALID/);
  const missing = structuredClone(plan); missing.profiles[0].uid = 'other';
  assert.throws(() => rehearseSchoolProfileFields(backup, missing), /PATCH_SCOPE_INVALID/);
});
test('CLI has no production writer/apply mode, persists private files outside repo and suppresses raw errors', async () => {
  const source = await readFile(new URL('../scripts/prepare-school-profile-config.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.(?:set|update|delete|create|commit|runTransaction)\(/);
  assert.match(source, /args\.length !== 2/); assert.match(source, /args\[0\] !== '--project'/);
  assert.match(source, /mode: 0o600/); assert.match(source, /mkdtemp\(join\(homedir\(\)/);
  assert.match(source, /flag: 'wx'/); assert.doesNotMatch(source, /console\.error\(error\)/);
});

test('reviewed Storage fingerprint accepts observed production digest and rejects transcription error', () => {
  assert.equal(SCHOOL_PROFILE_RULE_HASHES.storage, 'e656d238ee388d951268ca38d1eca2dbf2f5fdc55ef4b20e22911413d3dc935b');
  assert.notEqual(SCHOOL_PROFILE_RULE_HASHES.storage, 'e656d238ee388d951268ca38d1eca2abf2f5fdc55ef4b20e22911413d3dc935b');
});
