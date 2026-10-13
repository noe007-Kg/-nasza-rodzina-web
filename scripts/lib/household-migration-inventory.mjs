/** Read-only, metadata-only inventory. Never import mutating application services. */
import { FieldPath } from 'firebase-admin/firestore';

export const HOUSEHOLD_FIELDS = Object.freeze({
  members: ['name', 'personKey', 'familyId', 'role', 'active', 'archived', 'disabled', 'canLogin', 'avatarPath', 'avatarSource'],
  tasks: ['person', 'familyId', 'createdBy', 'submittedBy', 'completedBy', 'completedPerson', 'proofUploadId', 'proofPath', 'previousTaskId', 'nextTaskId', 'done', 'approvalStatus', 'verificationMode', 'requireApproval', 'pointsBooked'],
  taskCompletions: ['taskId', 'person', 'familyId', 'submittedBy', 'approvedBy'],
  taskPointBalances: ['person', 'familyId'],
  taskPointLedger: ['person', 'familyId', 'taskId', 'rewardRequestId', 'actorUid', 'kind'],
  taskRewards: ['familyId', 'createdBy', 'people', 'imageUploadId', 'imagePath', 'active'],
  taskRewardRequests: ['rewardId', 'person', 'uid', 'familyId', 'state', 'decidedBy'],
  _taskRewardPending: ['requestId', 'person', 'rewardId'],
  _taskPhotoUploads: ['taskId', 'uid', 'person', 'familyId', 'path', 'state', 'expiresAt', 'orphanAfter', 'contentType', 'size'],
  _taskRewardImageUploads: ['rewardId', 'uid', 'people', 'familyId', 'path', 'state', 'active', 'expiresAt', 'orphanAfter', 'contentType', 'size'],
  _taskPhotoCleanup: ['taskId', 'uploadId', 'path', 'state'],
  _taskRewardImageCleanup: ['rewardId', 'uploadId', 'path', 'state'],
  healthRecords: ['person', 'familyId', 'createdBy', 'type', 'privateToParents', 'attachmentDocumentId', 'documentPath', 'calendarEventId'],
  healthDocuments: ['ownerProfileId', 'ownerUid', 'ownerPersonKey', 'createdBy', 'readers', 'editors', 'familyId', 'attachmentKind', 'attachmentRecordId', 'attachmentPrivate', 'state', 'storagePath', 'size', 'mimeType', 'protected', 'uploadExpiresAt'],
  healthDocumentGrants: ['ownerProfileId', 'ownerUid', 'authorizedUids', 'grants'],
  calendarEvents: ['familyId', 'person', 'createdBy', 'updatedBy', 'ownerUid', 'ownerProfileId', 'private', 'visibility', 'source', 'sourceRecordId', 'sourceConnectionId', 'sourceOwnerUid', 'externalCalendarId', 'externalEventId', 'externalSeriesId', 'seriesId'],
  privateCalendarEvents: ['familyId', 'person', 'createdBy', 'updatedBy', 'ownerUid', 'ownerProfileId', 'private', 'visibility', 'source', 'sourceRecordId', 'sourceConnectionId', 'sourceOwnerUid', 'externalCalendarId', 'externalEventId', 'externalSeriesId', 'seriesId'],
  _calendarConnections: ['ownerUid', 'ownerProfileId', 'person', 'provider', 'status', 'calendarId', 'selectionConfirmed'],
  _calendarExports: ['ownerUid', 'sourceConnectionId', 'localEventId', 'externalEventId', 'ready', 'conflict'],
  _eduStudentBindings: ['establishedByUid'],
  schoolItems: ['familyId', 'person', 'createdBy', 'ownerProfileId', 'sourceOwnerUid', 'sourceConnectionId', 'sourceProfileId', 'sourceConnectionScope', 'sourceRecordId', 'calendarEventId', 'schoolPlanId'],
  schoolParentMessages: ['familyId', 'person', 'createdBy', 'ownerProfileId', 'sourceOwnerUid', 'sourceConnectionId', 'sourceProfileId', 'sourceConnectionScope', 'sourceRecordId'],
  schoolStudentMessages: ['familyId', 'person', 'createdBy', 'ownerProfileId', 'sourceOwnerUid', 'sourceConnectionId', 'sourceProfileId', 'sourceConnectionScope', 'sourceRecordId'],
  schoolPlans: ['familyId', 'person', 'createdBy', 'ownerProfileId', 'source'],
  financeBills: ['ownerUid', 'familyId', 'sharedWith', 'seriesId', 'periodIndex', 'archived'],
  financeBillAudit: ['billId', 'familyId', 'actorUid', 'kind'],
});
export const INBOX_FIELDS = ['eventId', 'recordId', 'recordKey', 'category', 'module', 'importantKey'];
export const STORAGE_PREFIXES = Object.freeze(['taskProof/', 'taskRewardImages/', 'healthDocuments/', 'health/', 'avatars/']);
// Google JSON partial responses exclude bearer tokens, filenames in document contents and binary data.
export const STORAGE_FIELDS = 'items(name,generation,metageneration,size,contentType,metadata(taskId,rewardId,uploadId,uploaderUid)),nextPageToken';

const listFields = new Set(['people', 'readers', 'editors', 'authorizedUids', 'sharedWith']);
const booleanFields = new Set(['active', 'archived', 'disabled', 'canLogin', 'done', 'pointsBooked', 'requireApproval', 'privateToParents', 'attachmentPrivate', 'protected', 'private', 'selectionConfirmed', 'ready', 'conflict', 'canEdit', 'verified']);
const numericFields = new Set(['size', 'periodIndex']);
const timestampFields = new Set(['expiresAt', 'orphanAfter', 'uploadExpiresAt']);
const inventoryFailure = code => { throw Object.assign(new Error(code), { code }); };
function metadataValue(key, value) {
  const invalid = () => inventoryFailure('INVENTORY_FIELD_TYPE_INVALID');
  if (value === null) return null; // Preserve explicit null, never coerce malformed familyId into null.
  if (listFields.has(key)) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length > 1500 || /[\u0000-\u001f]/.test(item))) return invalid();
    return [...value];
  }
  if (booleanFields.has(key)) return typeof value === 'boolean' ? value : invalid();
  if (numericFields.has(key)) return Number.isSafeInteger(value) && value >= 0 ? value : invalid();
  if (timestampFields.has(key)) {
    const date = value instanceof Date ? value : typeof value?.toDate === 'function' ? value.toDate()
      : typeof value === 'string' ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : invalid();
  }
  if (typeof value !== 'string' || value.length > 1500 || /[\u0000-\u001f]/.test(value)) return invalid();
  return value;
}
export function projectedHouseholdData(collection, value) {
  const fields = HOUSEHOLD_FIELDS[collection] || (collection.startsWith('notificationInbox/') ? INBOX_FIELDS : []);
  return Object.fromEntries(fields.filter(key => Object.hasOwn(value || {}, key)).map(key => {
    if (key !== 'grants') return [key, metadataValue(key, value[key])];
    if (!Array.isArray(value.grants) || value.grants.some(grant => !grant || typeof grant !== 'object' || Array.isArray(grant))) inventoryFailure('INVENTORY_FIELD_TYPE_INVALID');
    const keys = ['uid', 'basis', 'canEdit', 'authorizedBy', 'verified', 'verifiedBy'];
    return [key, value.grants.map(grant => Object.fromEntries(keys.filter(name => Object.hasOwn(grant, name)).map(name => [name, metadataValue(name, grant[name])])))];
  }));
}
export function documentVersion(value) {
  return value && Number.isInteger(value.nanoseconds) && value.seconds !== undefined
    ? { seconds: String(value.seconds), nanoseconds: value.nanoseconds } : null;
}

/** Only .select/.orderBy/.limit/.startAfter/.get are exposed to this inventory. */
async function readCollection(db, name, maximum) {
  const fields = HOUSEHOLD_FIELDS[name] || INBOX_FIELDS;
  const rows = [];
  let cursor;
  while (rows.length <= maximum) {
    let query = db.collection(name).select(...fields).orderBy(FieldPath.documentId()).limit(Math.min(500, maximum + 1 - rows.length));
    if (cursor !== undefined) query = query.startAfter(cursor);
    const result = await query.get();
    for (const item of result.docs) rows.push({ id: item.id, path: `${name}/${item.id}`, data: projectedHouseholdData(name, item.data()), updateTime: documentVersion(item.updateTime) });
    if (!result.docs.length || result.docs.length < Math.min(500, maximum + 1 - (rows.length - result.docs.length))) break;
    cursor = result.docs.at(-1).id;
  }
  return { rows: rows.slice(0, maximum), complete: rows.length <= maximum };
}

async function readStorage(bucket, maximum) {
  const rows = [], seen = new Set();
  let complete = true;
  for (const prefix of STORAGE_PREFIXES) {
    let pageToken;
    do {
      const [files, next] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: Math.min(500, maximum + 1 - rows.length), fields: STORAGE_FIELDS, ...(pageToken ? { pageToken } : {}) });
      for (const file of files) {
        if (seen.has(file.name)) continue;
        seen.add(file.name);
        // With a fields selector @google-cloud/storage returns raw object JSON,
        // not File instances: raw.metadata is the CUSTOM metadata map. Its
        // unfiltered File form instead nests the entire resource in .metadata.
        const value = ['generation', 'metageneration', 'size', 'contentType'].some(key => Object.hasOwn(file, key))
          ? file : file.metadata || {};
        const links = Object.fromEntries(['taskId', 'rewardId', 'uploadId', 'uploaderUid'].filter(key => typeof value.metadata?.[key] === 'string').map(key => [key, value.metadata[key]]));
        rows.push({ path: file.name, exists: true, generation: String(value.generation || ''), metageneration: String(value.metageneration || ''), size: Number(value.size), contentType: value.contentType || '', links });
      }
      if (rows.length > maximum) { complete = false; break; }
      if (next?.pageToken && next.pageToken === pageToken) inventoryFailure('STORAGE_PAGINATION_STALLED');
      pageToken = next?.pageToken;
    } while (pageToken);
    if (!complete) break;
  }
  return { rows: rows.slice(0, maximum), complete };
}

/** Dependencies deliberately exclude transactions/batches, Auth mutators and Storage files/downloads. */
export async function collectHouseholdInventory({ db, auth, bucket }, config, { maximum = 10000 } = {}) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 50000) inventoryFailure('INVENTORY_LIMIT_INVALID');
  const collections = {}, missingCollections = [];
  const names = [...Object.keys(HOUSEHOLD_FIELDS), ...config.members.map(member => `notificationInbox/${member.uid}/items`)];
  for (const name of names) {
    const result = await readCollection(db, name, maximum);
    collections[name] = result.rows;
    if (!result.complete) missingCollections.push(name);
  }
  const accounts = [];
  for (const member of config.members) {
    try {
      const account = await auth.getUser(member.uid);
      if (account.uid !== member.uid) throw new Error('AUTH_UID_RESPONSE_MISMATCH');
      accounts.push({ uid: member.uid, exists: true, disabled: account.disabled === true });
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') inventoryFailure('AUTH_INVENTORY_FAILED');
      accounts.push({ uid: member.uid, exists: false, disabled: false });
    }
  }
  const files = await readStorage(bucket, maximum);
  if (!files.complete) missingCollections.push('storage');
  return { schemaVersion: 1, projectId: config.projectId, bucket: config.bucket, source: 'firebase-admin-read-only', collections, auth: accounts, storage: files.rows,
    coverage: { complete: missingCollections.length === 0, missingCollections, collections: names, storagePrefixes: [...STORAGE_PREFIXES], authVerified: true } };
}

/** Offline snapshots are filtered through the same allowlist before any report is built. */
export function sanitizeHouseholdSnapshot(snapshot, config) {
  const collections = {};
  const names = [...Object.keys(HOUSEHOLD_FIELDS), ...config.members.map(member => `notificationInbox/${member.uid}/items`)];
  for (const name of names) collections[name] = (snapshot.collections?.[name] || []).map(item => ({
    id: item.id, path: item.path, data: projectedHouseholdData(name, item.data), updateTime: documentVersion(item.updateTime),
  }));
  return { schemaVersion: snapshot.schemaVersion, projectId: snapshot.projectId, bucket: snapshot.bucket, source: 'offline', collections,
    auth: (snapshot.auth || []).map(item => ({ uid: item.uid, exists: item.exists, disabled: item.disabled })),
    storage: (snapshot.storage || []).map(item => ({ path: item.path, exists: item.exists, generation: item.generation,
      metageneration: item.metageneration, size: item.size, contentType: item.contentType,
      links: Object.fromEntries(['taskId', 'rewardId', 'uploadId', 'uploaderUid'].filter(key => typeof item.links?.[key] === 'string').map(key => [key, item.links[key]])),
      ...(typeof item.hasDownloadToken === 'boolean' ? { hasDownloadToken: item.hasDownloadToken } : {}) })),
    coverage: { complete: snapshot.coverage?.complete === true && names.every(name => Object.hasOwn(snapshot.collections || {}, name)),
      missingCollections: names.filter(name => !Object.hasOwn(snapshot.collections || {}, name)).concat(snapshot.coverage?.missingCollections || []),
      collections: names, storagePrefixes: snapshot.coverage?.storagePrefixes || [], authVerified: snapshot.coverage?.authVerified === true } };
}
