import { isDeepStrictEqual } from 'node:util';
import { profilePlanHash, rehearseSchoolProfileFields, sameProfileVersion } from './school-profile-plan.mjs';
const own = (o, k) => Object.hasOwn(o, k);
const fail = code => { throw new Error(code); };
export function validateProfileUpdateEvidence(backup, plan, preparation, receipts) {
  if (backup?.schemaVersion !== 1 || plan?.schemaVersion !== 1 || backup.projectId !== 'nasza-rodzina' || plan.projectId !== 'nasza-rodzina'
    || backup.scope !== 'members.familyId-and-selected-schoolEnabled-only' || plan.mode !== 'private-proposal-only'
    || plan.canApply !== false || plan.writesPerformed !== 0 || !/^family-[a-f0-9-]{36}$/.test(plan.familyId)
    || !plan.ownerConfirmation || backup.profiles?.length !== 5 || plan.profiles?.length !== 5) fail('PLAN_SCOPE_INVALID');
  const ids = new Set(backup.profiles.map(p => p.uid));
  if (ids.size !== 5 || backup.profiles.some(p => !/^[A-Za-z0-9_-]{1,128}$/.test(p.uid)) || new Set(plan.profiles.map(p => p.uid)).size !== 5) fail('UID_ROSTER_INVALID');
  let flags = 0;
  for (const p of plan.profiles) {
    const before = backup.profiles.find(b => b.uid === p.uid);
    if (!before || !sameProfileVersion(before.version, p.expectedVersion) || Object.keys(before.fields).sort().join(',') !== 'familyId,schoolEnabled'
      || Object.keys(p.patch).some(k => !['familyId', 'schoolEnabled'].includes(k)) || p.patch.familyId !== plan.familyId) fail('PLAN_SCOPE_INVALID');
    for (const [key, field] of Object.entries(before.fields)) {
      if (typeof field.present !== 'boolean' || (field.present && !own(field, 'value')) || (!field.present && own(field, 'value'))) fail('BACKUP_FIELD_INVALID');
      if (field.present && (key === 'familyId' ? ![null, ''].includes(field.value) : ![true, false, null].includes(field.value))) fail('BACKUP_FIELD_INVALID');
    }
    if (own(p.patch, 'schoolEnabled')) { if (p.patch.schoolEnabled !== true) fail('PLAN_SCOPE_INVALID'); flags++; }
  }
  if (flags !== 2) fail('EXACT_SEVEN_FIELDS_REQUIRED');
  rehearseSchoolProfileFields(backup, plan);
  const bh = profilePlanHash(backup), ph = profilePlanHash(plan);
  if (preparation?.backupSha256 !== bh || preparation?.planSha256 !== ph || preparation.fieldCount !== 7 || preparation.productionWrites !== 0) fail('PREPARATION_EVIDENCE_INVALID');
  if (!receipts.some(r => r.schemaVersion === 1 && r.scope === backup.scope && r.backupSha256 === bh && r.planSha256 === ph
    && r.emulatorProject === 'demo-school-profile-restore' && r.restoredProfiles === 5 && r.emulatorFieldRestoreVerified === true
    && r.productionWrites === 0 && r.canApply === false && Number.isFinite(Date.parse(r.verifiedAt)))) fail('EMULATOR_RESTORE_EVIDENCE_REQUIRED');
  return { backupSha256: bh, planSha256: ph, profileCount: 5, fieldCount: 7 };
}
export function validateCurrentProfiles(profiles, backup, plan, authUsers) {
  if (profiles.length !== 5 || new Set(profiles.map(p => p.uid)).size !== 5 || profiles.filter(p => p.data.role === 'parent').length !== 2) fail('CURRENT_ROSTER_CHANGED');
  for (const before of backup.profiles) {
    const p = profiles.find(p => p.uid === before.uid), patch = plan.profiles.find(p => p.uid === before.uid).patch;
    if (!p || !sameProfileVersion(p.version, before.version)) fail('PROFILE_VERSION_CHANGED');
    if (p.data.active !== true || p.data.archived || p.data.disabled || !['parent', 'child', 'adult'].includes(p.data.role)
      || (p.data.role === 'parent' && p.data.canLogin !== true)) fail('CURRENT_ROSTER_CHANGED');
    for (const [key, field] of Object.entries(before.fields)) if (own(p.data, key) !== field.present || field.present && !isDeepStrictEqual(p.data[key], field.value)) fail('PROFILE_FIELDS_CHANGED');
    if (own(patch, 'schoolEnabled') && (p.data.role === 'parent' || p.data.canLogin !== true)) fail('STUDENT_AUTH_CHANGED');
    if (p.data.canLogin === true && !authUsers.some(u => u.uid === p.uid && u.disabled === false)) fail('AUTH_UID_NOT_VERIFIED');
  }
  if (profiles.filter(p => p.data.canLogin === true).length !== 4 || authUsers.length !== 4) fail('AUTH_UID_NOT_VERIFIED');
}
export async function applyProfileTransaction(db, backup, plan, authUsers, fieldMask) {
  return db.runTransaction(async tx => {
    const refs = plan.profiles.map(p => db.collection('members').doc(p.uid));
    const docs = await tx.getAll(...refs, { fieldMask });
    const profiles = docs.map(d => ({ uid: d.id, data: d.data() ?? {}, version: d.updateTime && { seconds: d.updateTime.seconds, nanoseconds: d.updateTime.nanoseconds } }));
    validateCurrentProfiles(profiles, backup, plan, authUsers);
    plan.profiles.forEach((p, i) => tx.update(refs[i], p.patch));
  }, { maxAttempts: 1 });
}
export async function rollbackProfileTransaction(db, backup, plan, receipt, deleteField, fieldMask) {
  if (receipt?.planSha256 !== profilePlanHash(plan) || receipt?.backupSha256 !== profilePlanHash(backup) || receipt?.status !== 'applied'
    || receipt.profiles?.length !== 5 || new Set(receipt.profiles.map(p => p.uid)).size !== 5) fail('APPLY_RECEIPT_REQUIRED');
  return db.runTransaction(async tx => {
    const refs = plan.profiles.map(p => db.collection('members').doc(p.uid));
    const docs = await tx.getAll(...refs, { fieldMask });
    for (const [i, p] of plan.profiles.entries()) {
      const d = docs[i], expected = receipt.profiles.find(x => x.uid === p.uid);
      if (!expected || !sameProfileVersion(d.updateTime, expected.version)) fail('ROLLBACK_VERSION_CHANGED');
      const data = d.data();
      if (Object.entries(p.patch).some(([k, v]) => !isDeepStrictEqual(data?.[k], v))) fail('ROLLBACK_FIELDS_CHANGED');
    }
    for (const [i, p] of plan.profiles.entries()) {
      const before = backup.profiles.find(b => b.uid === p.uid);
      tx.update(refs[i], Object.fromEntries(Object.keys(p.patch).map(k => [k, before.fields[k].present ? before.fields[k].value : deleteField()])));
    }
  }, { maxAttempts: 1 });
}
