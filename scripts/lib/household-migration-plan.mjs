import { createHash } from 'node:crypto';
import { explicitFamilyId } from '../../server/family-identity.mjs';
import { STORAGE_PREFIXES, householdStorageCheck, storagePrefixVerified } from './household-storage-status.mjs';
import { projectFileSources } from './household-file-sources.mjs';

// Pure planning only: no Firebase SDK, filesystem, provider or write capability.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uidValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
  && !/^(?:replace|your[_-]?uid|uid[_-]?here|example|placeholder|todo|change[_-]?me)/i.test(value);
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 1500
  && !/[\u0000-\u001f/]/.test(value) && !['.', '..'].includes(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const REQUIRED_COLLECTIONS = Object.freeze(['members', 'familySettings', 'quickProducts', 'tasks', 'taskCompletions', 'taskPointBalances', 'taskPointLedger',
  'taskRewards', 'taskRewardRequests', '_taskRewardPending', '_taskPhotoUploads', '_taskRewardImageUploads',
  '_taskPhotoCleanup', '_taskRewardImageCleanup', 'healthRecords', 'healthDocuments', 'healthDocumentGrants',
  'calendarEvents', 'privateCalendarEvents', '_calendarConnections', '_calendarExports', '_eduStudentBindings',
  'schoolItems', 'schoolParentMessages', 'schoolStudentMessages', 'schoolPlans', 'financeBills', 'financeBillAudit']);
const UID_FIELDS = Object.freeze(['createdBy', 'ownerUid', 'ownerProfileId', 'uid', 'actorUid', 'submittedBy', 'approvedBy',
  'completedBy', 'decidedBy', 'sourceOwnerUid', 'establishedByUid']);
const KNOWN_COLLECTION = value => REQUIRED_COLLECTIONS.includes(value) || value === 'medicalContacts' || /^notificationInbox\/[A-Za-z0-9_-]{1,128}\/items$/.test(value);
const versionValid = value => object(value) && typeof value.seconds === 'string' && /^\d+$/.test(value.seconds)
  && Number.isInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds < 1e9;
const reservedLegacy = value => value === undefined || value === null || value === '' || value === '__legacy__';
const avatarFilename = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:jpg|jpeg|png|webp|gif)$/i;
function error(code) { const failure = new Error(code); failure.code = code; throw failure; }
function exactKeys(value, allowed, code) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) error(code); }
function nonemptyText(value, maximum = 128) { return typeof value === 'string' && value.trim() === value && value.length > 0
  && value.length <= maximum && !/[\u0000-\u001f]/.test(value); }

export function validateHouseholdConfig(input) {
  exactKeys(input, ['schemaVersion', 'projectId', 'bucket', 'householdConfirmed', 'members', 'familyId', 'reviewedRecordPaths', 'reviewedRecordVersions'], 'CONFIG_FIELDS_INVALID');
  if (input.schemaVersion !== 1 || !/^[a-z][a-z0-9-]{3,61}[a-z0-9]$/.test(input.projectId || '')
    || !/^[a-z0-9][a-z0-9._-]{2,221}[a-z0-9]$/.test(input.bucket || '')) error('CONFIG_PROJECT_INVALID');
  if (input.householdConfirmed !== true) error('HOUSEHOLD_ATTESTATION_REQUIRED');
  if (!Array.isArray(input.members) || input.members.length !== 5) error('EXACT_FIVE_UIDS_REQUIRED');
  const seen = new Set();
  const members = input.members.map(member => {
    exactKeys(member, ['uid', 'expectedName', 'expectedRole', 'expectedCanLogin', 'expectedPersonKey'], 'CONFIG_MEMBER_FIELDS_INVALID');
    if (!uidValid(member.uid) || seen.has(member.uid)) error('CONFIG_UID_INVALID_OR_DUPLICATE');
    seen.add(member.uid);
    if (!nonemptyText(member.expectedName, 80) || !['parent', 'adult', 'child'].includes(member.expectedRole)
      || typeof member.expectedCanLogin !== 'boolean' || member.expectedPersonKey !== undefined && !nonemptyText(member.expectedPersonKey)) error('CONFIG_MEMBER_IDENTITY_INVALID');
    return { ...member };
  });
  if (members.filter(member => member.expectedRole === 'parent' && member.expectedCanLogin).length !== 2
    || members.filter(member => member.expectedRole === 'parent').length !== 2) error('TWO_LOGIN_PARENTS_REQUIRED');
  if (input.familyId !== undefined && explicitFamilyId(input) === null) error('CONFIG_FAMILY_ID_INVALID');
  const paths = input.reviewedRecordPaths || [];
  if (!Array.isArray(paths) || paths.length > 5000 || paths.some(path => typeof path !== 'string'
    || !/^(?:financeBills|financeBillAudit|quickProducts|familySettings|medicalContacts)\/[^/]+$/.test(path) || !safeId(path.split('/')[1]))
    || new Set(paths).size !== paths.length) error('CONFIG_REVIEWED_PATHS_INVALID');
  let versions;
  if (Object.hasOwn(input, 'reviewedRecordVersions')) {
    if (!Array.isArray(input.reviewedRecordVersions) || input.reviewedRecordVersions.length > 5000) error('CONFIG_REVIEWED_VERSIONS_INVALID');
    const versionPaths = new Set();
    versions = input.reviewedRecordVersions.map(entry => {
      exactKeys(entry, ['path', 'updateTime'], 'CONFIG_REVIEWED_VERSIONS_INVALID');
      exactKeys(entry.updateTime, ['seconds', 'nanoseconds'], 'CONFIG_REVIEWED_VERSIONS_INVALID');
      if (!paths.includes(entry.path) || versionPaths.has(entry.path) || !versionValid(entry.updateTime)) error('CONFIG_REVIEWED_VERSIONS_INVALID');
      versionPaths.add(entry.path);
      return { path: entry.path, updateTime: { seconds: entry.updateTime.seconds, nanoseconds: entry.updateTime.nanoseconds } };
    }).sort((a, b) => a.path.localeCompare(b.path));
  }
  return { schemaVersion: 1, projectId: input.projectId, bucket: input.bucket, householdConfirmed: true,
    members, ...(input.familyId !== undefined ? { familyId: input.familyId } : {}), reviewedRecordPaths: [...paths].sort(),
    ...(versions !== undefined ? { reviewedRecordVersions: versions } : {}) };
}

export function buildHouseholdMigrationPlan(input, inventory, { familyId = input?.familyId, now = new Date() } = {}) {
  const config = validateHouseholdConfig(input);
  if (explicitFamilyId({ familyId }) === null || config.familyId !== undefined && config.familyId !== familyId) error('PLAN_FAMILY_ID_INVALID');
  const at = new Date(now);
  if (!Number.isFinite(at.getTime())) error('PLAN_TIME_INVALID');
  exactKeys(inventory, ['schemaVersion', 'projectId', 'bucket', 'source', 'collections', 'auth', 'storage', 'coverage'], 'INVENTORY_FIELDS_INVALID');
  if (inventory.schemaVersion !== 1 || inventory.projectId !== config.projectId || inventory.bucket !== config.bucket
    || !['firebase-admin-read-only', 'offline'].includes(inventory.source) || !object(inventory.collections)
    || !Array.isArray(inventory.auth) || !Array.isArray(inventory.storage) || !object(inventory.coverage)) error('INVENTORY_CONTEXT_INVALID');
  const blockers = [], warnings = [], changes = [], rows = new Map(), byCollection = new Map();
  const issue = (list, code, path = '', identifiers) => {
    if (!list.some(item => item.code === code && item.path === path)) list.push({ code, path,
      ...(identifiers?.length ? { details: { identifiers: [...new Set(identifiers)].filter(value => safeId(value)).sort() } } : {}) });
  };
  const block = (code, path, ids) => issue(blockers, code, path, ids);
  const warn = (code, path, ids) => issue(warnings, code, path, ids);
  const uids = new Set(config.members.map(member => member.uid));
  const reviewed = new Set(config.reviewedRecordPaths);
  const staleReviewed = new Set();
  const coverage = inventory.coverage;
  const storageCheck = householdStorageCheck(coverage);
  if (!storageCheck.verified) block(storageCheck.code, 'storage');
  if (coverage.complete !== true || coverage.authVerified !== true || !Array.isArray(coverage.missingCollections)
    || coverage.missingCollections.length || !Array.isArray(coverage.collections) || !Array.isArray(coverage.storagePrefixes)) block('INVENTORY_INCOMPLETE');
  for (const name of REQUIRED_COLLECTIONS) if (!Object.hasOwn(inventory.collections, name)
    || !Array.isArray(coverage.collections) || !coverage.collections.includes(name)) block('COLLECTION_NOT_VERIFIED', name);
  for (const uid of uids) if (!Object.hasOwn(inventory.collections, `notificationInbox/${uid}/items`)
    || !Array.isArray(coverage.collections) || !coverage.collections.includes(`notificationInbox/${uid}/items`)) block('INBOX_NOT_VERIFIED', `notificationInbox/${uid}/items`);
  for (const prefix of STORAGE_PREFIXES) if (!Array.isArray(coverage.storagePrefixes) || !coverage.storagePrefixes.includes(prefix)) block('STORAGE_PREFIX_NOT_VERIFIED', prefix);
  if (inventory.source === 'offline') warn('OFFLINE_METADATA_NOT_PRODUCTION_VERIFICATION');
  warn('OPERATOR_ATTESTATION_IS_NOT_INDEPENDENT_HOUSEHOLD_PROOF');
  warn('LEGACY_NON_FINANCIAL_RULES_ARE_NOT_FULL_MULTI_HOUSEHOLD_ISOLATION');
  warn('NO_SECRET_SESSION_OR_PROVIDER_CONTENT_INSPECTED');
  warn('STORAGE_DOWNLOAD_TOKEN_REVOCATION_NOT_PERFORMED');
  warn('METADATA_SNAPSHOT_NOT_ATOMIC');
  warn('DEPLOYED_RULES_NOT_VERIFIED');
  warn('FULL_DOCUMENT_AND_BINARY_BACKUP_NOT_CAPTURED');
  for (const [collection, list] of Object.entries(inventory.collections)) {
    if (!KNOWN_COLLECTION(collection) || !Array.isArray(list)) { block('INVENTORY_COLLECTION_INVALID', KNOWN_COLLECTION(collection) ? collection : ''); continue; }
    byCollection.set(collection, []);
    for (const row of list) {
      if (!object(row) || !safeId(row.id) || row.path !== `${collection}/${row.id}` || !object(row.data) || rows.has(row.path)) {
        block('INVENTORY_RECORD_INVALID', collection); continue;
      }
      rows.set(row.path, row); byCollection.get(collection).push(row);
    }
  }
  const list = name => byCollection.get(name) || [];
  const get = (name, id) => safeId(id) ? rows.get(`${name}/${id}`) : undefined;
  for (const path of reviewed) if (!rows.has(path)) block('REVIEWED_RECORD_MISSING', path);
  for (const receipt of config.reviewedRecordVersions || []) {
    const actual = rows.get(receipt.path)?.updateTime;
    if (!versionValid(actual) || actual.seconds !== receipt.updateTime.seconds || actual.nanoseconds !== receipt.updateTime.nanoseconds) {
      block('REVIEWED_RECORD_VERSION_CHANGED', receipt.path);
      staleReviewed.add(receipt.path); reviewed.delete(receipt.path);
    }
  }
  const members = new Map(list('members').map(row => [row.id, row]));
  const persons = new Map();
  const parentUids = new Set(config.members.filter(member => member.expectedRole === 'parent').map(member => member.uid));
  const uidFields = row => UID_FIELDS.flatMap(field => typeof row.data[field] === 'string' && row.data[field] !== 'family' ? [row.data[field]] : []);
  const personValues = row => ['person', 'completedPerson', 'ownerPersonKey'].flatMap(field => typeof row.data[field] === 'string'
    && row.data[field] !== 'family' ? [row.data[field]] : []).concat(Array.isArray(row.data.people) ? row.data.people : []);
  const foreignFamily = row => explicitFamilyId(row.data) !== null && row.data.familyId !== familyId;
  const targetLink = row => uidFields(row).some(uid => uids.has(uid)) || personValues(row).some(person => persons.has(person));
  const checkRefs = row => {
    let ok = true;
    for (const field of UID_FIELDS) {
      const value = row.data[field];
      if (value !== undefined && value !== null && value !== '' && value !== 'family' && (!uidValid(value) || !uids.has(value))) {
        block('FOREIGN_OR_INVALID_UID_REFERENCE', row.path, typeof value === 'string' ? [value] : []); ok = false;
      }
    }
    for (const value of personValues(row)) if (!persons.has(value)) { block('UNVERIFIED_PERSON_REFERENCE', row.path); ok = false; }
    return ok;
  };
  const assign = row => {
    if (staleReviewed.has(row.path)) return;
    if (row.data.familyId === familyId) return;
    if (!reservedLegacy(row.data.familyId)) { block('EXISTING_FAMILY_CONFLICT', row.path); return; }
    if (!versionValid(row.updateTime)) { block('DOCUMENT_VERSION_NOT_VERIFIED', row.path); return; }
    changes.push({ path: row.path, field: 'familyId', before: Object.hasOwn(row.data, 'familyId')
      ? { present: true, value: row.data.familyId } : { present: false }, after: { present: true, value: familyId }, updateTime: { ...row.updateTime } });
  };
  for (const expected of config.members) {
    const row = members.get(expected.uid);
    if (!row) { block('MEMBER_UID_NOT_FOUND', `members/${expected.uid}`); continue; }
    const data = row.data;
    const person = data.personKey || data.name;
    if (data.name !== expected.expectedName || data.role !== expected.expectedRole || data.canLogin !== expected.expectedCanLogin
      || expected.expectedPersonKey !== undefined && data.personKey !== expected.expectedPersonKey
      || !nonemptyText(person) || person === 'family') block('MEMBER_IDENTITY_MISMATCH', row.path);
    if (data.active !== true || data.archived === true || data.disabled === true) block('MEMBER_NOT_ACTIVE', row.path);
    if (persons.has(person)) block('DUPLICATE_PERSON_KEY', row.path);
    else persons.set(person, row.id);
    if (data.familyId !== undefined && data.familyId !== null && data.familyId !== '' && data.familyId !== familyId) block('MEMBER_ALREADY_ASSIGNED_OR_INVALID', row.path);
    else assign(row);
    const accounts = inventory.auth.filter(account => account.uid === expected.uid);
    if (accounts.length !== 1 || typeof accounts[0]?.exists !== 'boolean'
      || expected.expectedCanLogin && (accounts[0]?.exists !== true || accounts[0]?.disabled !== false)
      || accounts[0]?.exists === true && typeof accounts[0]?.disabled !== 'boolean') block('AUTH_UID_NOT_VERIFIED', row.path);
  }
  for (const row of list('members')) if (!uids.has(row.id)) {
    if (row.data.familyId === familyId) block('FAMILY_ID_COLLISION', row.path);
    if (persons.has(row.data.personKey || row.data.name)) block('PERSON_KEY_COLLISION_WITH_FOREIGN_MEMBER', row.path);
    if (row.data.active === true && row.data.archived !== true) {
      // Legacy modules still use project-wide member/parent checks. A sixth
      // active profile cannot be treated as safely isolated by this manifest.
      block('ADDITIONAL_ACTIVE_MEMBER_REQUIRES_ISOLATION_REVIEW', row.path);
    }
  }
  const proven = new Set(config.members.map(member => `members/${member.uid}`));
  const prove = row => { if (!staleReviewed.has(row.path)) { proven.add(row.path); assign(row); } };
  const legacyCandidate = row => {
    if (foreignFamily(row)) { if (targetLink(row)) block('EXISTING_FAMILY_CONFLICT', row.path); return false; }
    if (!reservedLegacy(row.data.familyId) && row.data.familyId !== familyId) { block('INVALID_RECORD_FAMILY_ID', row.path); return false; }
    return true;
  };
  for (const name of ['tasks', 'taskRewards', 'healthRecords']) for (const row of list(name)) {
    if (!legacyCandidate(row)) continue;
    if (!uids.has(row.data.createdBy)) { block('UNPROVEN_LEGACY_ROOT_OWNER', row.path); continue; }
    if (checkRefs(row)) prove(row);
  }
  const requireLink = (row, collection, field) => {
    const linked = get(collection, row.data[field]);
    if (!linked || !proven.has(linked.path)) { block('MISSING_OR_UNVERIFIED_RECORD_LINK', row.path); return null; }
    return linked;
  };
  for (const row of list('taskRewardRequests')) {
    if (!legacyCandidate(row)) continue;
    const reward = requireLink(row, 'taskRewards', 'rewardId');
    if (reward && uids.has(row.data.uid) && persons.has(row.data.person) && checkRefs(row)) prove(row);
    else if (reward) block('REWARD_REQUEST_OWNER_NOT_VERIFIED', row.path);
  }
  for (const row of list('taskCompletions')) {
    if (!legacyCandidate(row)) continue;
    const task = requireLink(row, 'tasks', 'taskId');
    if (task && row.id === row.data.taskId && uids.has(row.data.submittedBy) && persons.has(row.data.person) && checkRefs(row)) prove(row);
    else if (task) block('TASK_COMPLETION_NOT_VERIFIED', row.path);
  }
  for (const row of list('taskPointLedger')) {
    if (!legacyCandidate(row)) continue;
    const earned = row.data.taskId !== undefined;
    const linked = requireLink(row, earned ? 'tasks' : 'taskRewardRequests', earned ? 'taskId' : 'rewardRequestId');
    const expectedId = sha(`${earned ? 'task' : 'reward'}:${earned ? row.data.taskId : row.data.rewardRequestId}`);
    if (linked && row.id === expectedId && uids.has(row.data.actorUid) && persons.has(row.data.person) && checkRefs(row)) prove(row);
    else if (linked) block('POINT_LEDGER_NOT_VERIFIED', row.path);
  }
  for (const row of list('taskPointBalances')) {
    if (!legacyCandidate(row)) continue;
    const linked = [...list('tasks'), ...list('taskPointLedger'), ...list('taskCompletions')].some(other => proven.has(other.path)
      && (other.data.person === row.data.person || other.data.completedPerson === row.data.person));
    const validBalanceId = row.id === `person-${sha(row.data.person)}`
      || row.data.familyId === familyId && row.id === `family-${sha(`${familyId}:${row.data.person}`)}`;
    if (persons.has(row.data.person) && validBalanceId && linked && checkRefs(row)) prove(row);
    else block('POINT_BALANCE_NOT_VERIFIED', row.path);
  }
  for (const row of list('_taskRewardPending')) {
    const linked = get('taskRewardRequests', row.data.requestId);
    if (foreignFamily(row) && !targetLink(row)) continue;
    if (!linked || !proven.has(linked.path) || linked.data.rewardId !== row.data.rewardId || linked.data.person !== row.data.person
      || !(row.id === sha(`${row.data.person}:${row.data.rewardId}`)
        || row.data.familyId === familyId && row.id === sha(`${familyId}:${row.data.person}:${row.data.rewardId}`))) block('REWARD_PENDING_LINK_NOT_VERIFIED', row.path);
    else proven.add(row.path);
    // The isolation extension stamps verified pointers; the legacy planner preserves them.
  }
  const files = new Map();
  for (const file of inventory.storage) {
    if (!object(file) || typeof file.path !== 'string' || !STORAGE_PREFIXES.some(prefix => file.path.startsWith(prefix))
      || /[\u0000-\u001f]/.test(file.path) || file.path.split('/').some(part => !safeId(part)) || files.has(file.path)
      || typeof file.exists !== 'boolean' || file.links !== undefined && !object(file.links)) { block('STORAGE_INVENTORY_INVALID'); continue; }
    files.set(file.path, file);
    if (file.hasDownloadToken === true) warn('STORAGE_BEARER_DOWNLOAD_TOKEN_PRESENT', file.path);
  }
  const verifiedFiles = new Set();
  const verifyFile = (row, path, expectedLinks = {}, contentTypeField = 'contentType') => {
    const file = files.get(path);
    if (!file || !file.exists) {
      block(storagePrefixVerified(coverage, path) ? 'STORAGE_OBJECT_MISSING' : 'STORAGE_OBJECT_NOT_VERIFIED', row.path);
      return false;
    }
    if (!/^\d+$/.test(String(file.generation || '')) || !/^\d+$/.test(String(file.metageneration || ''))
      || !Number.isSafeInteger(Number(file.size)) || Number(file.size) <= 0) { block('STORAGE_VERSION_NOT_VERIFIED', row.path); return false; }
    if (/^(avatars|quick-products)\//.test(path) && Number(file.size) > 5 * 1024 * 1024) {
      block('STORAGE_FILE_SIZE_EXCEEDS_APP_LIMIT', row.path); return false;
    }
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const types = path.startsWith('healthDocuments/') ? [...imageTypes, 'application/pdf']
      : path.startsWith('health/') ? [...imageTypes, 'image/gif', 'application/pdf']
        : path.startsWith('avatars/') || path.startsWith('quick-products/') ? [...imageTypes, 'image/gif'] : imageTypes;
    if (!types.includes(file.contentType)) { block('STORAGE_CONTENT_TYPE_NOT_VERIFIED', row.path); return false; }
    if (row.data.size !== undefined && Number(file.size) !== row.data.size
      || row.data[contentTypeField] !== undefined && file.contentType !== row.data[contentTypeField]
      || Object.entries(expectedLinks).some(([key, value]) => file.links?.[key] !== value)) { block('STORAGE_METADATA_LINK_MISMATCH', row.path); return false; }
    verifiedFiles.add(path); return true;
  };
  for (const name of ['_taskPhotoUploads', '_taskRewardImageUploads']) for (const row of list(name)) {
    if (!legacyCandidate(row)) continue;
    const proof = name === '_taskPhotoUploads';
    if (['deleted', 'revoked'].includes(row.data.state)) { if (targetLink(row) && !checkRefs(row)) continue; else continue; }
    const linked = requireLink(row, proof ? 'tasks' : 'taskRewards', proof ? 'taskId' : 'rewardId');
    if (row.data.state === 'open') block('ACTIVE_UPLOAD_REQUIRES_MAINTENANCE_WINDOW', row.path);
    if (!linked || !uids.has(row.data.uid) || !checkRefs(row)) continue;
    const expectedState = proof ? 'submitted' : 'attached';
    const path = row.data.path;
    const prefix = `${proof ? 'taskProof' : 'taskRewardImages'}/${linked.id}/${row.data.uid}/${row.id}.`;
    if (row.data.state !== expectedState || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.id)
      || typeof path !== 'string' || !path.startsWith(prefix) || !/^(jpg|png|webp)$/.test(path.slice(prefix.length))) {
      block('UPLOAD_STATE_OR_PATH_NOT_VERIFIED', row.path); continue;
    }
    if (proof && (linked.data.proofUploadId !== row.id || linked.data.proofPath !== path || linked.data.submittedBy !== row.data.uid
      || linked.data.person !== row.data.person || linked.data.approvalStatus !== 'pending')
      || !proof && (linked.data.imageUploadId !== row.id || linked.data.imagePath !== path
        || JSON.stringify(linked.data.people || []) !== JSON.stringify(row.data.people || []) || linked.data.active !== row.data.active)) {
      block('UPLOAD_RECIPROCAL_LINK_MISMATCH', row.path); continue;
    }
    if (verifyFile(row, path, { [proof ? 'taskId' : 'rewardId']: linked.id, uploadId: row.id, uploaderUid: row.data.uid })) prove(row);
  }
  for (const row of [...list('_taskPhotoCleanup'), ...list('_taskRewardImageCleanup')]) {
    if (row.data.state === 'pending') block('PENDING_FILE_CLEANUP_REQUIRES_MAINTENANCE_WINDOW', row.path);
  }
  for (const row of list('healthDocuments')) {
    if (foreignFamily(row) && !targetLink(row)) continue;
    const owner = members.get(row.data.ownerProfileId);
    const expectedOwnerUid = owner?.data.canLogin === true ? row.data.ownerProfileId : null;
    if (!uids.has(row.data.ownerProfileId) || !uids.has(row.data.createdBy) || !checkRefs(row)
      || row.data.ownerUid !== expectedOwnerUid || row.data.ownerPersonKey !== (owner?.data.personKey || owner?.data.name)
      || !Array.isArray(row.data.readers) || !Array.isArray(row.data.editors)
      || [...row.data.readers, ...row.data.editors].some(uid => !uids.has(uid))
      || !row.data.readers.includes(row.data.createdBy) || !row.data.editors.includes(row.data.createdBy)
      || row.data.editors.some(uid => !row.data.readers.includes(uid))) { block('HEALTH_DOCUMENT_ACL_NOT_VERIFIED', row.path); continue; }
    if (row.data.state !== 'ready') { block('HEALTH_DRAFT_OR_DELETION_REQUIRES_MAINTENANCE_WINDOW', row.path); continue; }
    const path = row.data.storagePath;
    if (typeof path !== 'string' || !path.startsWith(`healthDocuments/${row.id}/${row.data.createdBy}/`)
      || !/\.(pdf|jpg|png|webp)$/.test(path)) { block('HEALTH_STORAGE_PATH_NOT_VERIFIED', row.path); continue; }
    if (!verifyFile(row, path, {}, 'mimeType')) continue;
    if (row.data.attachmentKind === 'health-record') {
      const record = requireLink(row, 'healthRecords', 'attachmentRecordId');
      if (!record || record.data.attachmentDocumentId !== row.id || record.data.person !== row.data.ownerPersonKey
        || record.data.privateToParents !== row.data.attachmentPrivate) { block('HEALTH_ATTACHMENT_RECIPROCAL_LINK_MISMATCH', row.path); continue; }
      if (legacyCandidate(row)) prove(row);
    } else { proven.add(row.path); warn('STANDALONE_HEALTH_DOCUMENT_ACL_PRESERVED', row.path); }
  }
  for (const row of list('healthRecords')) if (proven.has(row.path)) {
    if (row.data.attachmentDocumentId) {
      const document = get('healthDocuments', row.data.attachmentDocumentId);
      if (!document || !proven.has(document.path)) block('HEALTH_RECORD_ATTACHMENT_NOT_VERIFIED', row.path);
    }
    if (row.data.calendarEventId) {
      const calendar = get('calendarEvents', row.data.calendarEventId);
      const expectedOwner = row.data.person === 'family' ? 'family' : persons.get(row.data.person);
      if (!calendar) block('HEALTH_CALENDAR_LINK_MISSING', row.path);
      else if (calendar.data.source !== 'health' || calendar.data.sourceRecordId !== row.id
        || calendar.data.person !== row.data.person || calendar.data.ownerProfileId !== expectedOwner
        || calendar.data.createdBy !== row.data.createdBy || !uids.has(calendar.data.createdBy)
        || calendar.data.ownerUid !== undefined && !uids.has(calendar.data.ownerUid)) block('HEALTH_CALENDAR_LINK_NOT_VERIFIED', row.path);
    }
    if (row.data.documentPath) {
      if (typeof row.data.documentPath !== 'string' || !row.data.documentPath.startsWith('health/')) block('LEGACY_HEALTH_PATH_NOT_VERIFIED', row.path);
      else verifyFile(row, row.data.documentPath, {}, 'mimeType');
    }
  }
  for (const row of list('healthDocumentGrants')) {
    const owner = row.data.ownerProfileId || row.id;
    if (!uids.has(owner)) { if (targetLink(row)) block('HEALTH_GRANT_OWNER_CONFLICT', row.path); continue; }
    if (!checkRefs(row) || Array.isArray(row.data.authorizedUids) && row.data.authorizedUids.some(uid => !uids.has(uid))) block('HEALTH_GRANT_ACL_NOT_VERIFIED', row.path);
    if (Array.isArray(row.data.grants) && row.data.grants.some(grant => !object(grant) || !uids.has(grant.uid)
      || grant.authorizedBy && !uids.has(grant.authorizedBy) || grant.verifiedBy && !uids.has(grant.verifiedBy))) block('HEALTH_GRANT_ACL_NOT_VERIFIED', row.path);
    warn('ADULT_HEALTH_CONSENT_AND_GRANTS_PRESERVED', row.path);
  }
  for (const row of list('financeBills')) {
    if (foreignFamily(row) && !targetLink(row)) continue;
    if (!legacyCandidate(row)) continue;
    if (!parentUids.has(row.data.ownerUid) || !Array.isArray(row.data.sharedWith)
      || new Set(row.data.sharedWith).size !== row.data.sharedWith.length
      || row.data.sharedWith.some(uid => {
        const recipient = members.get(uid)?.data;
        return !uids.has(uid) || recipient?.role !== 'child' || recipient.active !== true || recipient.canLogin !== true
          || recipient.archived === true || recipient.disabled === true;
      }) || !checkRefs(row)) {
      block('FINANCE_OWNER_OR_SHARE_NOT_VERIFIED', row.path); continue;
    }
    const root = get('financeBills', row.data.seriesId);
    if (!root || root.data.periodIndex !== 0 || root.id !== root.data.seriesId || root.data.ownerUid !== row.data.ownerUid
      || !Number.isSafeInteger(row.data.periodIndex) || row.data.periodIndex < 0 || row.data.periodIndex > 100000
      || row.id !== (row.data.periodIndex === 0 ? root.id : `period-${sha(`${root.id}:${row.data.periodIndex}`)}`)
      || foreignFamily(root) || root.data.familyId !== row.data.familyId) { block('FINANCE_SERIES_NOT_VERIFIED', row.path); continue; }
    if (row.data.familyId !== familyId && !reviewed.has(row.path)) { block('FINANCE_INDIVIDUAL_REVIEW_REQUIRED', row.path); continue; }
    prove(row);
  }
  for (const row of list('financeBillAudit')) {
    if (foreignFamily(row) && !targetLink(row)) continue;
    const bill = requireLink(row, 'financeBills', 'billId');
    if (!bill || !parentUids.has(row.data.actorUid) || !checkRefs(row)) { block('FINANCE_AUDIT_NOT_VERIFIED', row.path); continue; }
    if (!legacyCandidate(row)) continue;
    if (row.data.familyId !== familyId && !reviewed.has(row.path)) { block('FINANCE_INDIVIDUAL_REVIEW_REQUIRED', row.path); continue; }
    prove(row);
  }
  // Read-only inventory for ownership inconsistencies. Provider data and inbox
  // records are NEVER migration candidates, including their opaque source IDs.
  for (const name of ['calendarEvents', 'privateCalendarEvents', '_calendarConnections', '_calendarExports', '_eduStudentBindings',
    'schoolItems', 'schoolParentMessages', 'schoolStudentMessages', 'schoolPlans']) for (const row of list(name)) {
    if (foreignFamily(row) && !targetLink(row)) continue;
    if (targetLink(row) && !checkRefs(row)) continue;
    if (targetLink(row)) proven.add(row.path);
    if (name === 'privateCalendarEvents' && !uids.has(row.data.ownerUid)) {
      if (targetLink(row) || !members.has(row.data.ownerUid)) block('PRIVATE_CALENDAR_OWNER_NOT_VERIFIED', row.path);
    }
    if (name === '_calendarConnections' && (!uids.has(row.data.ownerUid) || row.data.ownerProfileId !== 'family' && !uids.has(row.data.ownerProfileId))) {
      if (targetLink(row)) block('CALENDAR_CONNECTION_OWNER_NOT_VERIFIED', row.path);
    }
    if (name === '_calendarExports' && targetLink(row)) {
      const connection = get('_calendarConnections', row.data.sourceConnectionId);
      const event = get('calendarEvents', row.data.localEventId) || get('privateCalendarEvents', row.data.localEventId);
      if (!connection || connection.data.ownerUid !== row.data.ownerUid || !event
        || event.data.ownerUid !== row.data.ownerUid && event.data.createdBy !== row.data.ownerUid) block('CALENDAR_EXPORT_LINK_NOT_VERIFIED', row.path);
    }
    if (row.data.calendarEventId && targetLink(row) && !get('calendarEvents', row.data.calendarEventId)) block('SCHOOL_CALENDAR_LINK_MISSING', row.path);
  }
  for (const uid of uids) {
    const member = members.get(uid), path = member?.data.avatarPath;
    if (!path) continue;
    const parts = typeof path === 'string' ? path.split('/') : [];
    if (parts.length !== 5 || parts[0] !== 'avatars' || parts[1] !== 'members' || parts[2] !== uid || !uids.has(parts[3]) || !avatarFilename.test(parts[4])) {
      block('MEMBER_AVATAR_PATH_NOT_VERIFIED', member.path); continue;
    }
    verifyFile(member, path);
  }
  // Presentation records use legacy global collections. Audit their files,
  // but never automatically adopt or rewrite their ownership or familyId.
  for (const row of list('familySettings')) if (row.data.avatarPath) {
    const parts = typeof row.data.avatarPath === 'string' ? row.data.avatarPath.split('/') : [];
    if (!(row.id === 'profile' || row.id === familyId && row.data.familyId === familyId) || parts.length !== 4 || parts[0] !== 'avatars' || parts[1] !== 'family'
      || !parentUids.has(parts[2]) || !parentUids.has(row.data.updatedBy) || !avatarFilename.test(parts[3])) {
      block('FAMILY_AVATAR_OWNER_NOT_VERIFIED', row.path); continue;
    }
    verifyFile(row, row.data.avatarPath);
  }
  const fileSourceCounts = Object.fromEntries(['firebase-storage', 'google-avatar', 'app-asset', 'external-url', 'inline-data', 'ephemeral-blob', 'invalid'].map(kind => [kind, 0]));
  for (const row of rows.values()) {
    const collection = row.path.split('/')[0];
    for (const [field, source] of Object.entries(projectFileSources(collection, row.data))) {
      fileSourceCounts[source.kind]++;
      if (collection === 'members' && !uids.has(row.id) || foreignFamily(row) && !targetLink(row)) continue;
      if (source.kind !== 'firebase-storage') {
        if (source.kind === 'invalid' || source.kind === 'inline-data' || source.kind === 'ephemeral-blob'
          || collection === 'healthRecords') block('FILE_SOURCE_REQUIRES_REVIEW', row.path);
        else warn('NON_STORAGE_FILE_SOURCE_NOT_FETCHED', row.path);
        continue;
      }
      if (source.hasBearerToken) warn('STORAGE_BEARER_URL_PRESENT', row.path);
      if (source.bucket !== config.bucket) { block('FILE_SOURCE_BUCKET_NOT_VERIFIED', row.path); continue; }
      const explicitPath = collection === 'healthRecords' ? row.data.documentPath : row.data.avatarPath;
      if (explicitPath && explicitPath !== source.path) { block('FILE_SOURCE_PATH_MISMATCH', row.path); continue; }
      if (collection === 'quickProducts') {
        const parts = source.path.split('/');
        if (field !== 'imageURL' || parts.length !== 3 || parts[0] !== 'quick-products' || !uids.has(parts[1])) {
          block('QUICK_PRODUCT_OWNER_NOT_VERIFIED', row.path); continue;
        }
      } else if (collection === 'members') {
        const parts = source.path.split('/');
        if (parts.length !== 5 || parts[0] !== 'avatars' || parts[1] !== 'members' || parts[2] !== row.id || !uids.has(parts[3]) || !avatarFilename.test(parts[4])) {
          block('MEMBER_AVATAR_PATH_NOT_VERIFIED', row.path); continue;
        }
      } else if (collection === 'familySettings') {
        const parts = source.path.split('/');
        if (!(row.id === 'profile' || row.id === familyId && row.data.familyId === familyId) || parts.length !== 4 || parts[0] !== 'avatars' || parts[1] !== 'family'
          || !parentUids.has(parts[2]) || !parentUids.has(row.data.updatedBy) || !avatarFilename.test(parts[3])) {
          block('FAMILY_AVATAR_OWNER_NOT_VERIFIED', row.path); continue;
        }
      } else if (collection === 'healthRecords' && !explicitPath) {
        // A familyId-only migration cannot make a legacy medical bearer URL
        // private. It requires a separately reviewed conversion and backup.
        block('LEGACY_HEALTH_URL_REQUIRES_REVIEW', row.path); continue;
      }
      verifyFile(row, source.path);
    }
  }
  for (const [path, file] of files) if (file.exists && !verifiedFiles.has(path) && /^(taskProof|taskRewardImages|healthDocuments)\//.test(path)) {
    const parts = path.split('/');
    const linked = parts[0] === 'healthDocuments' ? get('healthDocuments', parts[1])
      : get(parts[0] === 'taskProof' ? '_taskPhotoUploads' : '_taskRewardImageUploads', parts[3]?.split('.')[0]);
    if (linked && foreignFamily(linked) && !targetLink(linked) && !uids.has(parts[2])) {
      warn('FOREIGN_HOUSEHOLD_STORAGE_PRESERVED', path); continue;
    }
    block('STORAGE_ORPHAN_REQUIRES_REVIEW', path);
  }
  for (const [path, file] of files) if (file.exists && !verifiedFiles.has(path) && /^(avatars|quick-products)\//.test(path)) {
    warn('STORAGE_UNREFERENCED_PRESENTATION_FILE', path);
  }
  // A candidate ID must not already denote foreign or unproven data anywhere.
  for (const row of rows.values()) if (row.data.familyId === familyId && !proven.has(row.path)
    && row.path.split('/')[0] !== 'notificationInbox') block('FAMILY_ID_COLLISION_OR_UNPROVEN_RECORD', row.path);
  for (const row of [...list('tasks'), ...list('taskRewards')]) if (proven.has(row.path)) {
    for (const [field, collection] of [['proofUploadId', '_taskPhotoUploads'], ['imageUploadId', '_taskRewardImageUploads'], ['nextTaskId', 'tasks'], ['previousTaskId', 'tasks']]) {
      if (row.data[field] && (!get(collection, row.data[field]) || !proven.has(get(collection, row.data[field]).path))) block('TASK_RECIPROCAL_REFERENCE_NOT_VERIFIED', row.path);
    }
  }
  if (changes.length > 450) block('ATOMIC_PLAN_TOO_LARGE');
  const sorted = [...new Map(changes.map(change => [change.path, change])).values()].sort((a, b) => a.path.localeCompare(b.path));
  const changedPaths = new Set(sorted.map(change => change.path));
  const preservedCollections = Object.fromEntries([...byCollection].map(([name, records]) => [name, {
    inspected: records.length, familyIdChanges: records.filter(row => changedPaths.has(row.path)).length,
    unchanged: records.filter(row => !changedPaths.has(row.path)).length,
  }]));
  return { schemaVersion: 1, mode: 'dry-run', writesPerformed: 0, canApply: false,
    status: blockers.length ? 'blocked' : 'prepared-requires-approval', familyId, projectId: config.projectId, bucket: config.bucket,
    generatedAt: at.toISOString(), inventorySource: inventory.source, blockers, warnings, changes: sorted,
    rollback: sorted.map(change => ({ path: change.path, field: 'familyId', before: { ...change.after }, after: { ...change.before },
      conditions: { familyIdEquals: familyId, postApplyUpdateTimeRequired: true, noConcurrentChanges: true } })),
    preservation: { collections: preservedCollections, storageObjects: files.size, storageWrites: 0, authWrites: 0,
      uidChanges: 0, aclChanges: 0, pointRecalculations: 0, calendarWrites: 0, sessionChanges: 0, notificationWrites: 0 },
    summary: { storageVerified: storageCheck.verified, storageScope: 'known-app-prefixes', fileSources: fileSourceCounts,
      membersVerified: config.members.filter(member => !blockers.some(item => item.path === `members/${member.uid}`)).length,
      proposedFamilyIdChanges: sorted.length, inspectedRecords: rows.size, inspectedStorageObjects: files.size,
      requiresSeparateApprovalAndBackup: true, migrationExecutable: false } };
}
