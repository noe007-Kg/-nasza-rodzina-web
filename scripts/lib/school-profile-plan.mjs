import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const SCHOOL_PROFILE_RULE_HASHES = Object.freeze({
  firestore: '255078250043a5e45245c891debf294968d910ec9059269e445f059c46ab404c',
  storage: 'e656d238ee388d951268ca38d1eca2dbf2f5fdc55ef4b20e22911413d3dc935b',
});
export const profilePlanHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
/** Safe diagnostics: fingerprints only, never source, credentials or rule resource IDs. */
export function inspectSchoolProfileRules(files, expected) {
  const validShape = Array.isArray(files) && files.length === 1 && typeof files[0]?.content === 'string';
  const actual = validShape ? profilePlanHash(files[0].content) : null;
  const configured = typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected);
  return { matched: validShape && configured && actual === expected,
    fileCount: Array.isArray(files) ? files.length : null, expected: configured ? expected : null, actual,
    firstDifferentPosition: actual && configured ? [...expected].findIndex((c, index) => c !== actual[index]) : null };
}
const validUid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const own = (object, field) => Object.hasOwn(object, field);
export function sameProfileVersion(a, b) {
  return Number.isInteger(a?.seconds) && Number.isInteger(a?.nanoseconds)
    && Number.isInteger(b?.seconds) && Number.isInteger(b?.nanoseconds)
    && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
}
function captureField(data, field) { return own(data, field) ? { present: true, value: data[field] } : { present: false }; }

/** A private proposal and before-images, not authorization to execute writes. */
export function prepareSchoolProfilePlan({ profiles, schoolUids, authUsers, householdConfirmed, familyId, projectId, now = new Date().toISOString() }) {
  if (projectId !== 'nasza-rodzina' || !householdConfirmed || profiles.length !== 5 || new Set(profiles.map(p => p.uid)).size !== 5
    || profiles.filter(p => p.data.role === 'parent').length !== 2) throw new Error('ROSTER_REVIEW_REQUIRED');
  if (!/^family-[a-f0-9-]{36}$/.test(familyId)) throw new Error('INVALID_PROPOSED_FAMILY');
  for (const p of profiles) {
    if (!validUid(p.uid) || !Number.isInteger(p.version?.seconds) || !Number.isInteger(p.version?.nanoseconds)
      || p.version.nanoseconds < 0 || p.version.nanoseconds >= 1e9
      || p.data.active !== true || p.data.archived === true || p.data.disabled === true
      || !['parent', 'child', 'adult'].includes(p.data.role)
      || own(p.data, 'canLogin') && typeof p.data.canLogin !== 'boolean'
      || p.data.role === 'parent' && p.data.canLogin !== true) throw new Error('INVALID_PROFILE');
    // Never overwrite an already configured household or malformed flag.
    if (own(p.data, 'familyId') && p.data.familyId !== null && p.data.familyId !== '') throw new Error('PROFILE_ALREADY_HAS_FAMILY');
    if (own(p.data, 'schoolEnabled') && p.data.schoolEnabled !== null && typeof p.data.schoolEnabled !== 'boolean') throw new Error('INVALID_SCHOOL_FLAG');
    if (p.data.canLogin && !authUsers.some(u => u.uid === p.uid && u.disabled === false)) throw new Error('AUTH_UID_NOT_VERIFIED');
  }
  if (profiles.filter(p => p.data.canLogin).length !== 4) throw new Error('LOGIN_ROSTER_CHANGED');
  if (schoolUids.length !== 2 || new Set(schoolUids).size !== 2 || schoolUids.some(uid =>
    !profiles.some(p => p.uid === uid && ['child', 'adult'].includes(p.data.role) && p.data.canLogin === true))) throw new Error('SELECT_TWO_VERIFIED_STUDENT_UIDS');
  const backup = { schemaVersion: 1, projectId, scope: 'members.familyId-and-selected-schoolEnabled-only', capturedAt: now,
    profiles: profiles.map(p => ({ uid: p.uid, version: p.version, fields: {
      familyId: captureField(p.data, 'familyId'), schoolEnabled: captureField(p.data, 'schoolEnabled'),
    } })) };
  const plan = { schemaVersion: 1, projectId, mode: 'private-proposal-only', canApply: false, writesPerformed: 0,
    createdAt: now, backupSha256: profilePlanHash(backup), familyId,
    profiles: profiles.map(p => ({ uid: p.uid, expectedVersion: p.version,
      patch: { familyId, ...(schoolUids.includes(p.uid) && p.data.schoolEnabled !== true ? { schoolEnabled: true } : {}) } })),
    ownerConfirmation: 'Owner selected actual UID entries; names alone were not used for assignment.',
    evidence: { fullApplicationBackupVerified: false, firestoreRestoreVerified: false, productionApplyImplemented: false },
  };
  return { backup, plan };
}

/** Pure rehearsal only. Does NOT certify a real Firestore/emulator restoration. */
export function rehearseSchoolProfileFields(backup, plan) {
  if (profilePlanHash(backup) !== plan.backupSha256 || backup.profiles.length !== plan.profiles.length) throw new Error('BACKUP_INTEGRITY_FAILED');
  for (const before of backup.profiles) {
    const patch = plan.profiles.find(p => p.uid === before.uid)?.patch;
    if (!patch || Object.keys(patch).some(k => !['familyId', 'schoolEnabled'].includes(k))) throw new Error('PATCH_SCOPE_INVALID');
    const original = { untouchedMarker: 'preserved' };
    for (const [key, field] of Object.entries(before.fields)) if (field.present) original[key] = field.value;
    const state = { ...original, ...patch };
    for (const key of Object.keys(patch)) {
      const field = before.fields[key];
      if (!field) throw new Error('BACKUP_FIELD_MISSING');
      if (field.present) state[key] = field.value; else delete state[key];
    }
    if (!isDeepStrictEqual(original, state)) throw new Error('FIELD_ROLLBACK_FAILED');
  }
  return { logicalFieldRollbackVerified: true, restoredProfiles: backup.profiles.length,
    firestoreRestoreVerified: false, fullApplicationBackupVerified: false };
}
