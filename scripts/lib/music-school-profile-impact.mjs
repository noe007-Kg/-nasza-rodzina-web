import { createHash } from 'node:crypto';

// Explicit metadata allowlist. Never scan provider/session collections or fetch file URLs.
export const PROFILE_IMPACT_COLLECTIONS = Object.freeze([
  'members', 'financeBills', 'financeBillAudit', 'tasks', 'taskPointBalances',
  'taskPointLedger', 'taskCompletions', 'taskRewards', 'taskRewardRequests',
  '_taskPhotoUploads', '_taskRewardImageUploads', 'healthRecords', 'healthDocuments',
  'healthDocumentGrants', 'calendarEvents', 'privateCalendarEvents',
  'schoolItems', 'schoolParentMessages', 'schoolStudentMessages', 'musicSchoolPlans',
]);
export const PROFILE_IMPACT_FIELDS = Object.freeze([
  'familyId', 'ownerProfileId', 'ownerUid', 'createdBy', 'uid', 'person',
  'role', 'active', 'canLogin', 'schoolEnabled', 'archived', 'disabled',
  'state', 'attachmentKind', 'readers', 'editors', 'sharedWith', 'authorizedUids',
]);
const maximumDocuments = 1000;
const familyKind = value => value === undefined || value === null || value === '' ? 'missing'
  : value === '__legacy__' || value === 'legacy' ? 'legacy'
    : typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? 'explicit' : 'invalid';

/** Uses select/get only. No transaction, writer, Storage object or provider credentials. */
export async function captureProfileImpact({ db, auth }) {
  const collections = {}, failures = [];
  for (const name of PROFILE_IMPACT_COLLECTIONS) {
    try {
      const result = await db.collection(name).select(...PROFILE_IMPACT_FIELDS).limit(maximumDocuments + 1).get();
      collections[name] = { complete: result.size <= maximumDocuments, rows: result.docs.map(doc => ({
        id: doc.id, version: doc.updateTime?.toMillis?.() ?? null,
        versionParts: Number.isInteger(doc.updateTime?.seconds) && Number.isInteger(doc.updateTime?.nanoseconds)
          ? { seconds: doc.updateTime.seconds, nanoseconds: doc.updateTime.nanoseconds } : null,
        data: doc.data(),
      })).sort((a, b) => a.id.localeCompare(b.id)) };
    } catch { failures.push(name); }
  }
  const profiles = collections.members?.rows || [];
  const loginProfiles = profiles.filter(p => p.data.canLogin === true && p.data.active !== false && !p.data.archived && !p.data.disabled);
  let authCheck = { verified: false, expectedLogins: loginProfiles.length, foundLogins: 0, disabledLogins: 0 };
  if (profiles.length <= maximumDocuments && collections.members?.complete) {
    try {
      const users = [];
      for (let start = 0; start < loginProfiles.length; start += 100) {
        const result = await auth.getUsers(loginProfiles.slice(start, start + 100).map(p => ({ uid: p.id })));
        users.push(...result.users.map(u => ({ uid: u.uid, disabled: u.disabled === true })));
      }
      const expected = new Set(loginProfiles.map(p => p.id));
      const returned = new Set(users.map(u => u.uid));
      authCheck = { verified: expected.size > 0 && returned.size === expected.size && users.every(u => expected.has(u.uid)), expectedLogins: expected.size,
        foundLogins: returned.size, disabledLogins: users.filter(u => u.disabled).length,
        // Internal digest only, never the identities themselves in stdout.
        digest: createHash('sha256').update(JSON.stringify(users.sort((a, b) => a.uid.localeCompare(b.uid)))).digest('hex') };
    } catch { failures.push('authentication'); }
  }
  return { collections, authCheck, failures };
}
function fingerprint(capture) {
  return createHash('sha256').update(JSON.stringify(capture)).digest('hex');
}

/** A forecast, NEVER an executable migration, ownership decision or backup certificate. */
export function assessProfileImpact(before, after, { expectedProfiles = 5 } = {}) {
  const blockers = [], add = (code, count) => {
    if (!blockers.some(x => x.code === code)) blockers.push({ code, ...(count === undefined ? {} : { count }) });
  };
  const complete = [before, after].every(c => c.failures.length === 0
    && PROFILE_IMPACT_COLLECTIONS.every(n => c.collections[n]?.complete === true));
  const stable = complete && fingerprint(before) === fingerprint(after);
  if (!complete) add('METADATA_INVENTORY_INCOMPLETE');
  if (!stable) add('METADATA_CHANGED_OR_NOT_VERIFIED');
  const members = after.collections.members?.rows || [];
  const active = members.filter(x => x.data.active !== false && !x.data.archived && !x.data.disabled);
  const ids = new Set(active.map(x => x.id));
  if (active.length !== expectedProfiles || members.length !== expectedProfiles) add('EXPLICIT_UID_ROSTER_REVIEW_REQUIRED');
  if (!after.authCheck.verified || after.authCheck.disabledLogins > 0) add('PROFILE_AUTH_UID_CHECK_FAILED');
  // Even five matching Auth UIDs + two parent roles do not independently prove one household.
  add('OWNER_UID_HOUSEHOLD_CONFIRMATION_REQUIRED');
  const summaries = {};
  for (const name of PROFILE_IMPACT_COLLECTIONS) {
    const capture = after.collections[name], rows = capture?.rows || [];
    summaries[name] = { records: rows.length, complete: capture?.complete === true,
      missingFamilyId: rows.filter(x => familyKind(x.data.familyId) === 'missing').length,
      legacyFamilyId: rows.filter(x => familyKind(x.data.familyId) === 'legacy').length,
      invalidFamilyId: rows.filter(x => familyKind(x.data.familyId) === 'invalid').length };
    if (summaries[name].invalidFamilyId) add('INVALID_FAMILY_ID_REVIEW_REQUIRED');
  }
  const rows = name => after.collections[name]?.rows || [];
  // Changing missing member.familyId to a new value changes these existing equality checks.
  const legacyFinance = rows('financeBills').filter(x => ['missing', 'legacy'].includes(familyKind(x.data.familyId))).length;
  const legacyTickets = ['_taskPhotoUploads', '_taskRewardImageUploads'].reduce((total, name) => total
    + rows(name).filter(x => familyKind(x.data.familyId) === 'missing'
      && (name === '_taskPhotoUploads' ? ['open', 'submitted'].includes(x.data.state) : ['open', 'attached'].includes(x.data.state))).length, 0);
  const legacyHealth = rows('healthDocuments').filter(x => x.data.attachmentKind === 'health-record'
    && x.data.state !== 'deleted' && familyKind(x.data.familyId) === 'missing').length;
  if (legacyFinance) add('FINANCE_ACCESS_WOULD_CHANGE', legacyFinance);
  if (legacyTickets) add('TASK_FILE_ACCESS_WOULD_CHANGE', legacyTickets);
  if (legacyHealth) add('HEALTH_ATTACHMENT_ACCESS_WOULD_CHANGE', legacyHealth);
  const allOtherRows = PROFILE_IMPACT_COLLECTIONS.filter(n => n !== 'members').flatMap(rows);
  const unknownReferences = allOtherRows.filter(x => ['ownerProfileId', 'ownerUid', 'createdBy', 'uid'].some(key =>
    typeof x.data[key] === 'string' && x.data[key] !== '' && !ids.has(x.data[key]))).length;
  if (unknownReferences) add('UNRESOLVED_UID_REFERENCES', unknownReferences);
  const personOnly = allOtherRows.filter(x => typeof x.data.person === 'string'
    && !['ownerProfileId', 'ownerUid', 'createdBy', 'uid'].some(key => ids.has(x.data[key]))).length;
  if (personOnly) add('PERSON_ONLY_REFERENCE_REVIEW_REQUIRED', personOnly);
  if (active.some(x => familyKind(x.data.familyId) !== 'explicit')) add('PROFILE_FAMILY_ID_NOT_CONFIGURED');
  if (active.filter(x => x.data.role === 'child').some(x => typeof x.data.schoolEnabled !== 'boolean')) add('SCHOOL_FLAGS_REQUIRE_EXPLICIT_UID_SELECTION');
  // These checks require actual evidence and are intentionally not inferred from empty lists.
  for (const code of ['FULL_BACKUP_AND_RESTORE_NOT_VERIFIED', 'PRODUCTION_RULES_NOT_VERIFIED',
    'STORAGE_OBJECTS_NOT_VERIFIED', 'LEGACY_CROSS_HOUSEHOLD_ISOLATION_NOT_VERIFIED']) add(code);
  return {
    schemaVersion: 1, mode: 'read-only-profile-impact', canApply: false, writesPerformed: 0,
    profileUpdateReady: false, metadataComplete: complete, metadataStableBetweenReads: stable,
    profiles: { total: members.length, active: active.length, parents: active.filter(x => x.data.role === 'parent').length,
      missingFamilyId: active.filter(x => familyKind(x.data.familyId) === 'missing').length,
      legacyFamilyId: active.filter(x => familyKind(x.data.familyId) === 'legacy').length,
      explicitHouseholds: new Set(active.filter(x => familyKind(x.data.familyId) === 'explicit').map(x => x.data.familyId)).size,
      schoolEnabled: active.filter(x => x.data.schoolEnabled === true).length },
    auth: { verified: after.authCheck.verified, expectedLogins: after.authCheck.expectedLogins,
      foundLogins: after.authCheck.foundLogins, disabledLogins: after.authCheck.disabledLogins },
    potentialAccessLoss: { financeBills: legacyFinance, taskUploadTickets: legacyTickets, healthAttachments: legacyHealth },
    collections: summaries, blockers,
    evidence: { backup: 'not-verified', restore: 'not-verified', deployedRules: 'not-verified',
      storageObjects: 'not-inspected', providerSessions: 'not-inspected' },
    warnings: ['METADATA_REPORT_IS_NOT_A_BACKUP', 'TWO_READS_ARE_NOT_AN_ATOMIC_SNAPSHOT',
      'NAMES_AND_PARENT_ROLES_ARE_NOT_HOUSEHOLD_PROOF', 'DO_NOT_CHANGE_PROFILES_IN_ISOLATION',
      'NO_APPLY_COMMAND_OR_PRODUCTION_WRITER_EXISTS_IN_THIS_TOOL'],
  };
}
