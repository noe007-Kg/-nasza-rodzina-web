/**
 * Production evidence reader. The injected transport only receives GET and
 * Firestore's read-only POST :listCollectionIds. No application write service,
 * Firestore commit/export, IAM, token or Storage mutation is used here.
 * Native Firestore JSON is preserved, including int64 strings and nanoseconds.
 * Full documents can contain encrypted provider sessions; never log this data.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from './household-backup-archive.mjs';

const MAX_PAGES = 10000;
const MAX_DEPTH = 64;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = (code, httpStatus = null) => { throw Object.assign(new Error(code), { code, httpStatus }); };
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function projectRoot(projectId) {
  if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) fail('EVIDENCE_PROJECT_INVALID');
  return `projects/${projectId}/databases/(default)/documents`;
}
function safeBucket(bucket) {
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket) || bucket.includes('..')) fail('EVIDENCE_BUCKET_INVALID');
  return bucket;
}
const encodedResource = name => name.split('/').map(encodeURIComponent).join('/');
function httpStatusOf(error) {
  const status = [error?.httpStatus, error?.code, error?.statusCode, error?.status, error?.response?.status]
    .find(value => Number.isInteger(value) && value >= 400 && value <= 599 || typeof value === 'string' && /^[45]\d{2}$/.test(value));
  return status === undefined ? null : Number(status);
}
async function read(request, options, code) {
  if (typeof request !== 'function') fail('EVIDENCE_TRANSPORT_INVALID');
  let result;
  try { result = await request(options); } catch (error) { fail(code, httpStatusOf(error)); }
  if (!isObject(result?.data)) fail(`${code}_RESPONSE_INVALID`);
  return result.data;
}
function id(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\/\u0000-\u001f\u007f]/.test(value)) fail('FIRESTORE_BACKUP_RESOURCE_INVALID');
  return value;
}
function docPath(name, root) {
  if (typeof name !== 'string' || !name.startsWith(`${root}/`)) fail('FIRESTORE_BACKUP_RESOURCE_INVALID');
  const parts = name.slice(root.length + 1).split('/');
  if (!parts.length || parts.length % 2 || parts.length / 2 > MAX_DEPTH) fail('FIRESTORE_BACKUP_RESOURCE_INVALID');
  parts.forEach(id);
  return parts;
}
function nativeDocument(value, root) {
  if (!isObject(value)) fail('FIRESTORE_BACKUP_DOCUMENT_INVALID');
  docPath(value.name, root);
  if (Object.keys(value).some(key => !['name', 'fields', 'createTime', 'updateTime'].includes(key))) fail('FIRESTORE_BACKUP_DOCUMENT_INVALID');
  const missing = !Object.hasOwn(value, 'fields') && !Object.hasOwn(value, 'createTime') && !Object.hasOwn(value, 'updateTime');
  if (missing) return { document: { name: value.name }, missing: true };
  if (Object.hasOwn(value, 'fields') && !isObject(value.fields)
    || typeof value.createTime !== 'string' || !Number.isFinite(Date.parse(value.createTime))
    || typeof value.updateTime !== 'string' || !Number.isFinite(Date.parse(value.updateTime))) fail('FIRESTORE_BACKUP_DOCUMENT_INVALID');
  // Clone native values without SDK conversion (int64, timestamp and reference
  // types must survive the eventual restore rehearsal).
  return { document: JSON.parse(canonicalJson(value)), missing: false };
}
function nextPage(data, tokens) {
  const value = data.nextPageToken;
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 1048576 || tokens.has(value)) fail('FIRESTORE_BACKUP_PAGINATION_INVALID');
  tokens.add(value);
  return value;
}

/** Captures every collection, including descendants of absent parent documents. */
export async function collectFirestoreBackup({ request, projectId, maxDocuments = 50000, maxBytes = 128 * 1024 * 1024 }) {
  const root = projectRoot(projectId);
  if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 1000000) fail('FIRESTORE_BACKUP_LIMIT_INVALID');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 128 * 1024 * 1024) fail('FIRESTORE_BACKUP_LIMIT_INVALID');
  const documents = [], missingAncestors = [], seen = new Set(), visited = new Set();
  let pages = 0, bytes = 0;
  const page = async (options) => {
    if (++pages > MAX_PAGES) fail('FIRESTORE_BACKUP_PAGE_LIMIT_REACHED');
    return read(request, options, 'FIRESTORE_BACKUP_READ_FAILED');
  };
  async function visit(parent, depth) {
    if (depth > MAX_DEPTH) fail('FIRESTORE_BACKUP_DEPTH_LIMIT_REACHED');
    if (visited.has(parent)) fail('FIRESTORE_BACKUP_TRAVERSAL_DUPLICATE');
    visited.add(parent);
    const collections = [], collectionSeen = new Set(), tokens = new Set();
    let pageToken;
    do {
      const data = await page({ method: 'POST', url: `https://firestore.googleapis.com/v1/${encodedResource(parent)}:listCollectionIds`,
        data: { pageSize: 100, ...(pageToken ? { pageToken } : {}) } });
      if (data.collectionIds !== undefined && !Array.isArray(data.collectionIds)) fail('FIRESTORE_BACKUP_COLLECTIONS_INVALID');
      for (const collection of data.collectionIds || []) {
        id(collection);
        if (collectionSeen.has(collection)) fail('FIRESTORE_BACKUP_COLLECTION_DUPLICATE');
        collectionSeen.add(collection);
        collections.push(collection);
      }
      pageToken = nextPage(data, tokens);
    } while (pageToken);
    for (const collection of collections.sort(lexical)) {
      if (depth === MAX_DEPTH) fail('FIRESTORE_BACKUP_DEPTH_LIMIT_REACHED');
      const collectionName = `${parent}/${collection}`, children = [], documentTokens = new Set();
      let documentPageToken;
      do {
        const query = new URLSearchParams({ pageSize: '500', showMissing: 'true', ...(documentPageToken ? { pageToken: documentPageToken } : {}) });
        const data = await page({ method: 'GET', url: `https://firestore.googleapis.com/v1/${encodedResource(collectionName)}?${query}` });
        if (data.documents !== undefined && !Array.isArray(data.documents)) fail('FIRESTORE_BACKUP_DOCUMENTS_INVALID');
        for (const value of data.documents || []) {
          const { document, missing } = nativeDocument(value, root);
          bytes += Buffer.byteLength(canonicalJson(document));
          if (bytes > maxBytes) fail('FIRESTORE_BACKUP_BYTE_LIMIT_REACHED');
          const expectedPrefix = `${collectionName}/`;
          if (!document.name.startsWith(expectedPrefix) || document.name.slice(expectedPrefix.length).includes('/')) fail('FIRESTORE_BACKUP_RESOURCE_INVALID');
          if (seen.has(document.name)) fail('FIRESTORE_BACKUP_DOCUMENT_DUPLICATE');
          if (seen.size >= maxDocuments) fail('FIRESTORE_BACKUP_DOCUMENT_LIMIT_REACHED');
          seen.add(document.name);
          (missing ? missingAncestors : documents).push(document);
          children.push(document.name);
        }
        documentPageToken = nextPage(data, documentTokens);
      } while (documentPageToken);
      for (const child of children.sort(lexical)) await visit(child, depth + 1);
    }
  }
  await visit(root, 0);
  documents.sort((a, b) => lexical(a.name, b.name));
  missingAncestors.sort((a, b) => lexical(a.name, b.name));
  return { documents, missingAncestors, complete: true, totalBytes: bytes, capturedAt: new Date().toISOString() };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort(lexical).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return Object.is(value, -0) ? '-0' : JSON.stringify(value);
}
function documentMap(values, root, expectedMissing) {
  if (!Array.isArray(values)) fail('FIRESTORE_BACKUP_RECHECK_INPUT_INVALID');
  const map = new Map();
  for (const value of values) {
    const { document, missing } = nativeDocument(value, root);
    if (missing !== expectedMissing || map.has(document.name)) fail('FIRESTORE_BACKUP_RECHECK_INPUT_INVALID');
    map.set(document.name, canonical(document));
  }
  return map;
}
const mapDigest = (documents, missing) => sha256(canonical({ documents: [...documents].sort(([a], [b]) => lexical(a, b)), missing: [...missing].sort(([a], [b]) => lexical(a, b)) }));
/** A second full scan also catches additions and deletions; not an atomic snapshot. */
export async function recheckFirestoreBackup({ request, projectId, documents, missingAncestors = [], maxDocuments = 50000 }) {
  const root = projectRoot(projectId), before = documentMap(documents, root, false), beforeMissing = documentMap(missingAncestors, root, true);
  if ([...before.keys()].some(name => beforeMissing.has(name))) fail('FIRESTORE_BACKUP_RECHECK_INPUT_INVALID');
  const current = await collectFirestoreBackup({ request, projectId, maxDocuments });
  const after = documentMap(current.documents, root, false), afterMissing = documentMap(current.missingAncestors, root, true);
  const addedDocumentCount = [...after.keys()].filter(name => !before.has(name)).length;
  const deletedDocumentCount = [...before.keys()].filter(name => !after.has(name)).length;
  const changedDocumentCount = [...after].filter(([name, content]) => before.has(name) && content !== before.get(name)).length;
  const addedMissingAncestorCount = [...afterMissing.keys()].filter(name => !beforeMissing.has(name)).length;
  const deletedMissingAncestorCount = [...beforeMissing.keys()].filter(name => !afterMissing.has(name)).length;
  return { stable: !(addedDocumentCount || deletedDocumentCount || changedDocumentCount || addedMissingAncestorCount || deletedMissingAncestorCount), complete: true,
    checkedAt: current.capturedAt, previousDocumentCount: before.size, currentDocumentCount: after.size,
    addedDocumentCount, deletedDocumentCount, changedDocumentCount, addedMissingAncestorCount, deletedMissingAncestorCount,
    previousSha256: mapDigest(before, beforeMissing), currentSha256: mapDigest(after, afterMissing) };
}

async function inspectRules({ request, projectId, releaseId, localSource }) {
  const localSha256 = sha256(localSource), releaseName = `projects/${projectId}/releases/${releaseId}`;
  const base = { verified: false, status: 'unavailable', localSha256, sha256: null, releaseName, rulesetName: null, createTime: null, code: null, httpStatus: null };
  try {
    const releaseURL = `https://firebaserules.googleapis.com/v1/${encodedResource(releaseName)}`;
    const release = await read(request, { method: 'GET', url: releaseURL }, 'PRODUCTION_RULES_READ_FAILED');
    if (release.name !== releaseName || typeof release.rulesetName !== 'string'
      || !release.rulesetName.startsWith(`projects/${projectId}/rulesets/`)
      || !/^[A-Za-z0-9_-]+$/.test(release.rulesetName.slice(`projects/${projectId}/rulesets/`.length))) fail('PRODUCTION_RULES_RESOURCE_INVALID');
    const ruleset = await read(request, { method: 'GET', url: `https://firebaserules.googleapis.com/v1/${encodedResource(release.rulesetName)}` }, 'PRODUCTION_RULES_READ_FAILED');
    if (ruleset.name !== release.rulesetName || !Array.isArray(ruleset.source?.files) || !ruleset.source.files.length
      || ruleset.source.files.some(file => !isObject(file) || typeof file.name !== 'string' || typeof file.content !== 'string')) fail('PRODUCTION_RULES_SOURCE_INVALID');
    const repeated = await read(request, { method: 'GET', url: releaseURL }, 'PRODUCTION_RULES_READ_FAILED');
    const sourceFiles = ruleset.source.files.map(({ name, content }) => ({ name, content }));
    const sourceHash = sourceFiles.length === 1 ? sha256(sourceFiles[0].content) : sha256(canonical(sourceFiles));
    const common = { ...base, sha256: sourceHash, rulesetName: release.rulesetName,
      createTime: typeof ruleset.createTime === 'string' ? ruleset.createTime : null, sourceFiles };
    if (repeated.name !== releaseName || repeated.rulesetName !== release.rulesetName
      || repeated.updateTime !== release.updateTime || repeated.createTime !== release.createTime) return { ...common, status: 'changed', code: 'PRODUCTION_RULES_CHANGED_DURING_READ' };
    const verified = sourceFiles.length === 1 && sourceFiles[0].content === localSource;
    return { ...common, verified, status: verified ? 'matched' : 'mismatch', code: verified ? null : 'PRODUCTION_RULES_SOURCE_MISMATCH' };
  } catch (error) { return { ...base, code: typeof error?.code === 'string' && /^PRODUCTION_RULES_[A-Z_]+$/.test(error.code) ? error.code : 'PRODUCTION_RULES_READ_FAILED', httpStatus: httpStatusOf(error) }; }
}

/** Exact source comparison; different single-file names do not alter semantics. */
export async function verifyProductionRules({ request, projectId, bucket, localFirestoreRules, localStorageRules }) {
  projectRoot(projectId); safeBucket(bucket);
  if (typeof localFirestoreRules !== 'string' || typeof localStorageRules !== 'string') fail('PRODUCTION_RULES_LOCAL_SOURCE_INVALID');
  const firestore = await inspectRules({ request, projectId, releaseId: 'cloud.firestore', localSource: localFirestoreRules });
  const storage = await inspectRules({ request, projectId, releaseId: `firebase.storage/${bucket}`, localSource: localStorageRules });
  return { firestore, storage };
}

// Conservative list: europe-west2 is the UK and europe-west6 is Switzerland,
// both European locations but outside the EU. Unknown future regions stay false.
const EU_LOCATIONS = new Set(['eur3', 'eu', 'europe-west1', 'europe-west3', 'europe-west4', 'europe-west8', 'europe-west9', 'europe-west10', 'europe-west12', 'europe-north1', 'europe-north2', 'europe-central2', 'europe-southwest1']);
const inEU = location => typeof location === 'string' && EU_LOCATIONS.has(location.toLowerCase());
async function locationEvidence(readValue, code) {
  try { return await readValue(); }
  catch (error) { return { verified: false, status: 'unavailable', code: typeof error?.code === 'string' && /^PRODUCTION_LOCATION_[A-Z_]+$/.test(error.code) ? error.code : code, httpStatus: httpStatusOf(error), europeanUnion: false }; }
}

/** Scope is only primary Firestore and selected bucket, not all data residency. */
export async function readProductionLocations({ request, projectId, bucket }) {
  projectRoot(projectId); safeBucket(bucket);
  const databaseName = `projects/${projectId}/databases/(default)`;
  const firestore = await locationEvidence(async () => {
    const data = await read(request, { method: 'GET', url: `https://firestore.googleapis.com/v1/${encodedResource(databaseName)}` }, 'PRODUCTION_LOCATION_FIRESTORE_READ_FAILED');
    if (data.name !== databaseName || typeof data.locationId !== 'string' || !data.locationId) fail('PRODUCTION_LOCATION_FIRESTORE_RESPONSE_INVALID');
    return { verified: true, status: 'verified', name: data.name, location: data.locationId, europeanUnion: inEU(data.locationId), code: null, httpStatus: null };
  }, 'PRODUCTION_LOCATION_FIRESTORE_READ_FAILED');
  const storage = await locationEvidence(async () => {
    const fields = 'name,location,locationType,storageClass,softDeletePolicy,versioning,retentionPolicy';
    const data = await read(request, { method: 'GET', url: `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}?${new URLSearchParams({ fields })}` }, 'PRODUCTION_LOCATION_STORAGE_READ_FAILED');
    if (data.name !== bucket || typeof data.location !== 'string' || !data.location) fail('PRODUCTION_LOCATION_STORAGE_RESPONSE_INVALID');
    // Deliberately omit IAM, labels, URL tokens and unrelated bucket metadata.
    const policies = Object.fromEntries(['softDeletePolicy', 'versioning', 'retentionPolicy'].filter(key => isObject(data[key])).map(key => [key, JSON.parse(JSON.stringify(data[key]))]));
    return { verified: true, status: 'verified', name: data.name, location: data.location,
      locationType: typeof data.locationType === 'string' ? data.locationType : null,
      storageClass: typeof data.storageClass === 'string' ? data.storageClass : null,
      ...policies, europeanUnion: inEU(data.location), code: null, httpStatus: null };
  }, 'PRODUCTION_LOCATION_STORAGE_READ_FAILED');
  return { firestore, storage, complete: firestore.verified && storage.verified, scope: 'primary-firestore-and-selected-storage-bucket-only' };
}
