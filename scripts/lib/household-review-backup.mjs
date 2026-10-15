/** Pure local-file evidence checks. This module cannot read files or contact a service. */
import { openHouseholdBackup, backupDigest, canonicalJson } from './household-backup-archive.mjs';
import { validateHouseholdConfig } from './household-migration-plan.mjs';
import { planMatchesBackup } from './household-evidence-capture.mjs';
import { ISOLATION_PLAN_FIELDS } from './household-isolation-plan.mjs';
import { collectExternalReferences } from './household-external-files.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const checksum = value => backupDigest(canonicalJson(value));
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const unique = values => new Set(values).size === values.length;
const safePath = value => typeof value === 'string' && value.split('/').length % 2 === 0
  && value.split('/').every(part => part && !['.', '..'].includes(part) && !/[\u0000-\u001f\u007f]/.test(part));
const native = (row, key) => row.fields?.[key]?.stringValue ?? row.fields?.[key]?.booleanValue;
const archiveErrors = new Set(['BACKUP_KEY_INVALID', 'BACKUP_AUTHENTICATION_FAILED', 'BACKUP_ARCHIVE_INVALID',
  'BACKUP_SIZE_LIMIT', 'BACKUP_COMPRESSION_INVALID', 'BACKUP_JSON_INVALID', 'BACKUP_PAYLOAD_INVALID', 'BACKUP_FILE_INVALID']);

function configIdentity(config, familyId) {
  const checked = validateHouseholdConfig(config);
  return { ...checked, familyId: checked.familyId || familyId,
    members: [...checked.members].sort((a, b) => a.uid.localeCompare(b.uid)) };
}

function inspectHistoricalRestore(proof, payload, archiveDigestSha256, now) {
  const restored = proof?.restore;
  const matched = restored?.verified === true && restored.safetyVerified === true && restored.emulatorExitCode === 0
    && /^demo-household-restore-[a-z0-9-]{6,32}$/.test(restored.targetProjectId || '')
    && restored.sourceProjectId === payload.projectId && restored.archiveDigestSha256 === archiveDigestSha256
    && proof?.backup?.archiveDigestSha256 === archiveDigestSha256
    && proof.backup.complete === true && proof.backup.manifestHashesVerified === true
    && restored.documentCount === payload.documents.length && restored.objectCount === payload.objects.length
    && restored.externalFileCount === payload.externalFiles.length && restored.externalFilesUnverifiedCount === 0
    && restored.authMetadataCount === payload.auth.filter(row => row.exists !== false).length
    && restored.authMissingCount === payload.auth.filter(row => row.exists === false).length
    && restored.rollback?.verified === true && restored.rollback.concurrentChangeRejected === true
    && restored.rollback.postApplyReceiptIsDemoOnly === true
    && restored.rollback.changeCount === new Set(payload.plan.changes.map(row => row.path)).size
    && date(restored.checkedAt) && Date.parse(restored.checkedAt) >= Date.parse(payload.createdAt)
    && Date.parse(restored.checkedAt) <= now.getTime();
  return { verified: false, needsFreshRestore: true, historicalReportMatched: matched,
    evidenceKind: 'untrusted-local-json-compared-with-decrypted-archive',
    codes: ['REVIEW_FRESH_RESTORE_REQUIRED', ...(matched ? [] : ['REVIEW_HISTORICAL_RESTORE_MISSING_OR_MISMATCHED'])] };
}

/**
 * `verified` concerns actual archive bytes, completeness and current-plan binding
 * only. A supplied restore JSON is never treated as an independently executed
 * restore, nor do these offline checks prove current production state. The
 * caller must rerun the local demo restore and production read-only rechecks.
 * A verified payload is returned only in memory; never serialize it in reports.
 */
export function inspectReviewBackup({ archive, key, config, plan, proof, now = new Date() } = {}) {
  const result = { verified: false, codes: [], archiveDigestSha256: null, needsFreshRestore: true,
    sourceRecheckRequired: true, isCurrentProductionSnapshotVerified: false,
    backup: { complete: false, manifestHashesVerified: false, bodyIntegrityVerified: false,
      boundToCurrentPlan: false, sourceIdentityMatched: false },
    restore: { verified: false, needsFreshRestore: true, historicalReportMatched: false,
      codes: ['REVIEW_FRESH_RESTORE_REQUIRED'] } };
  const add = code => { if (!result.codes.includes(code)) result.codes.push(code); };
  if (!Buffer.isBuffer(archive) || !archive.length) { add('REVIEW_BACKUP_ARCHIVE_MISSING'); return result; }
  result.archiveDigestSha256 = backupDigest(archive);
  let payload;
  try { payload = openHouseholdBackup(archive, key); }
  catch (error) {
    add(archiveErrors.has(error?.code) ? `REVIEW_${error.code}` : 'REVIEW_BACKUP_INVALID');
    return result;
  }
  try {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) { add('REVIEW_CHECK_TIME_INVALID'); return result; }
    if (!date(payload.createdAt) || Date.parse(payload.createdAt) > now.getTime()) add('REVIEW_BACKUP_CAPTURE_TIME_INVALID');
    const documents = payload.documents, objects = payload.objects, external = payload.externalFiles, manifest = payload.manifest;
    const root = `projects/${payload.projectId}/databases/(default)/documents/`;
    const documentsValid = unique(documents.map(row => row.name)) && documents.every(row => object(row)
      && typeof row.name === 'string' && row.name.startsWith(root) && safePath(row.name.slice(root.length))
      && (!Object.hasOwn(row,'fields') || object(row.fields)) && date(row.createTime) && date(row.updateTime)
      && Date.parse(row.createTime)<=Date.parse(row.updateTime) && Date.parse(row.updateTime)<=Date.parse(payload.createdAt));
    const objectsValid = unique(objects.map(row => row.name)) && objects.every(row => /^\d+$/.test(row.generation || '')
      && /^\d+$/.test(row.metageneration || ''));
    const externalValid = external.every(row => row.status === 'captured' && hash(row.id)) && unique(external.map(row => row.id));
    const authPhotoDocuments=payload.auth.flatMap(account=>[account.photoURL,...(Array.isArray(account.providerData)?account.providerData:[]).map(row=>row.photoURL)]
      .filter(url=>typeof url==='string'&&url.trim()).map((url,index)=>({name:`${root}members/auth-photo-${account.uid}-${index}`,fields:{photoURL:{stringValue:url}}})));
    const observedReferences=new Set(collectExternalReferences([...documents,...authPhotoDocuments]).map(row=>row.id));
    const referencesValid = Array.isArray(payload.references) && payload.references.every(row => hash(row.id))
      && new Set(payload.references.map(row => row.id)).size === external.length
      && observedReferences.size===external.length && external.every(row=>observedReferences.has(row.id))
      && payload.references.every(row => external.some(file => file.id === row.id));
    if (!documentsValid || !objectsValid || !externalValid || !referencesValid) add('REVIEW_BACKUP_CAPTURE_STRUCTURE_INVALID');
    const hashesMatch = object(manifest) && hash(manifest.documentsSha256) && hash(manifest.objectsSha256)
      && manifest.documentsSha256 === checksum(documents) && manifest.objectsSha256 === checksum(objects);
    if (!hashesMatch) add('REVIEW_BACKUP_MANIFEST_HASH_MISMATCH');
    result.backup.bodyIntegrityVerified = documentsValid && objectsValid && externalValid && referencesValid && hashesMatch;
    const complete = manifest?.captureComplete === true && manifest.firestoreComplete === true && manifest.storageComplete === true
      && manifest.planBoundToBackup === true && manifest.documentCount === documents.length && manifest.objectCount === objects.length
      && manifest.externalReferenceCount === external.length && manifest.authScope === 'five-profile-metadata-only'
      && manifest.objectScope === 'current-live-selected-bucket-objects'
      && manifest.archivedObjectVersionsIncluded === false && manifest.secretManagerKeysIncluded === false;
    if (!complete) add('REVIEW_BACKUP_COMPLETENESS_NOT_VERIFIED');
    result.backup.complete = complete && result.backup.bodyIntegrityVerified;
    result.backup.manifestHashesVerified = hashesMatch;
    result.backup.archiveDigestSha256 = result.archiveDigestSha256;
    result.backup.capturedAt = date(payload.createdAt) ? payload.createdAt : null;
    result.backup.scope = 'full-default-firestore-and-current-selected-bucket-plus-captured-external-files';

    const expected = configIdentity(config, plan?.familyId), saved = configIdentity(payload.config, payload.plan?.familyId);
    const identityMatches = payload.projectId === expected.projectId && payload.bucket === expected.bucket
      && saved.projectId === expected.projectId && saved.bucket === expected.bucket && checksum(saved) === checksum(expected);
    if (!identityMatches) add('REVIEW_BACKUP_CONFIG_OR_HOUSEHOLD_MISMATCH');
    const identities = new Map(documents.map(row => [row.name, row]));
    const authMatches = payload.auth.length === expected.members.length && unique(payload.auth.map(row => row.uid))
      && expected.members.every(member => {
        const account = payload.auth.find(row => row.uid === member.uid);
        const record = identities.get(`${root}members/${member.uid}`);
        return account && typeof account.exists === 'boolean' && (account.exists !== true || typeof account.disabled === 'boolean')
          && (!member.expectedCanLogin || account.exists === true && account.disabled === false)
          && record && native(record, 'name') === member.expectedName && native(record, 'role') === member.expectedRole
          && native(record, 'canLogin') === member.expectedCanLogin && native(record, 'active') === true
          && native(record, 'archived') !== true && native(record, 'disabled') !== true
          && (member.expectedPersonKey === undefined || native(record, 'personKey') === member.expectedPersonKey)
          && (!Object.hasOwn(record.fields || {},'familyId') || Object.hasOwn(record.fields.familyId,'nullValue')
            || typeof record.fields.familyId.stringValue === 'string' && ['',plan.familyId].includes(record.fields.familyId.stringValue));
      });
    if (!authMatches) add('REVIEW_BACKUP_FIVE_UID_IDENTITIES_NOT_VERIFIED');
    result.backup.sourceIdentityMatched = identityMatches && authMatches;

    const planValid = object(plan) && plan.canApply === false && plan.writesPerformed === 0
      && plan.migrationContract === 'household-isolation-v1' && plan.projectId === expected.projectId && plan.bucket === expected.bucket
      && plan.familyId === expected.familyId && Array.isArray(plan.blockers) && plan.blockers.length === 0 && Array.isArray(plan.changes)
      && unique(plan.changes.map(row => `${row.path}:${row.field}`)) && new Set(plan.changes.map(row => row.path)).size <= 450
      && plan.changes.every(row => safePath(row.path) && ISOLATION_PLAN_FIELDS.includes(row.field)
        && row.after?.present === true && (row.field !== 'familyId' || row.after.value === expected.familyId));
    if (!planValid) add('REVIEW_CURRENT_PLAN_NOT_VERIFIED');
    const currentDigest = planValid ? checksum(plan) : null;
    const planSame = planValid && checksum(payload.plan) === currentDigest && payload.evidence?.planDigest === currentDigest
      && payload.plan.familyId === plan.familyId && planMatchesBackup(plan, documents);
    if (!planSame) add('REVIEW_BACKUP_DIFFERENT_OR_UNBOUND_PLAN');
    result.backup.boundToCurrentPlan = planSame;
    result.backup.planDigest = currentDigest;
    if (payload.consistency?.firestore?.stable !== true || payload.consistency?.storage?.stable !== true
      || payload.consistency?.auth?.stable !== true) add('REVIEW_BACKUP_CAPTURE_CONSISTENCY_NOT_VERIFIED');
    if (result.codes.length === 0) {
      result.verified = true;
      result.restore = inspectHistoricalRestore(proof, payload, result.archiveDigestSha256, now);
      result.payload = payload;
    }
  } catch {
    add('REVIEW_BACKUP_EVIDENCE_INVALID');
  }
  return result;
}
