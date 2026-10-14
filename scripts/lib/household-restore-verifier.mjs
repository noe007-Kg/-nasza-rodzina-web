import { canonicalJson, backupDigest } from './household-backup-archive.mjs';
import { controlFailure as fail } from './household-private-files.mjs';
import { normalizedFirestoreFields } from './household-native-values.mjs';
import { get as httpGet } from 'node:http';

export function assertRestoreTarget({ projectId, firestoreHost, authHost, storageHost }) {
  if (!/^demo-household-restore-[a-z0-9-]{6,32}$/.test(projectId || '')) fail('RESTORE_DEMO_PROJECT_REQUIRED');
  for (const host of [firestoreHost, authHost, storageHost]) {
    if (typeof host !== 'string' || !/^127\.0\.0\.1:\d{4,5}$/.test(host)) fail('RESTORE_LOCAL_EMULATORS_REQUIRED');
    const port = Number(host.split(':')[1]);
    if (port < 1024 || port > 65535) fail('RESTORE_LOCAL_EMULATORS_REQUIRED');
  }
  if (new Set([firestoreHost, authHost, storageHost]).size !== 3) fail('RESTORE_DISTINCT_EMULATORS_REQUIRED');
}
const encoded = name => name.split('/').map(encodeURIComponent).join('/');
const clone = value => JSON.parse(JSON.stringify(value));
function rebind(value, original, target) {
  if (Array.isArray(value)) return value.map(item => rebind(item, original, target));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === 'referenceValue' && typeof item === 'string' && item.startsWith(`projects/${original}/databases/(default)/documents/`)
      ? item.replace(`projects/${original}/`, `projects/${target}/`) : rebind(item, original, target)]));
  return value;
}
async function requestJson(request, url, options = {}) {
  const response = await request(url, { ...options, headers: { Authorization: 'Bearer owner', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) fail(`RESTORE_EMULATOR_REQUEST_FAILED_${response.status}`);
  try { return await response.json(); } catch { fail('RESTORE_EMULATOR_RESPONSE_INVALID'); }
}
// Fetch transparently decompresses gzip responses. A byte-for-byte rehearsal
// must instead read the original representation, bounded to the manifest size.
async function readOriginalBytes(url, maximum) {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, { headers: { Authorization: 'Bearer owner', 'Accept-Encoding': 'gzip, identity' },
      signal: AbortSignal.timeout(30000) }, async response => {
      if (response.statusCode !== 200) { response.destroy(); reject(Object.assign(new Error('RESTORE_FILE_READ_FAILED'), { code: 'RESTORE_FILE_READ_FAILED' })); return; }
      try {
        const chunks = []; let size = 0;
        for await (const chunk of response) {
          size += chunk.length;
          if (size > maximum) { response.destroy(); fail('RESTORE_FILE_SIZE_MISMATCH'); }
          chunks.push(chunk);
        }
        resolve(Buffer.concat(chunks, size));
      } catch (error) { reject(error); }
    });
    request.on('error', () => reject(Object.assign(new Error('RESTORE_FILE_READ_FAILED'), { code: 'RESTORE_FILE_READ_FAILED' })));
  });
}
function importedAccount(account) {
  return { localId: account.uid, disabled: account.disabled === true, emailVerified: account.emailVerified === true,
    ...Object.fromEntries(['email', 'displayName', 'phoneNumber'].filter(key => account[key]).map(key => [key, account[key]])),
    ...(account.photoURL ? { photoUrl: account.photoURL } : {}),
    ...(account.customClaims ? { customAttributes: canonicalJson(account.customClaims) } : {}),
    ...(account.providerData ? { providerUserInfo: account.providerData.filter(row => !['password', 'phone'].includes(row.providerId))
      .map(row => ({ providerId: row.providerId, rawId: row.uid,
        ...Object.fromEntries(['email', 'displayName', 'phoneNumber'].filter(key => row[key]).map(key => [key, row[key]])),
        ...(row.photoURL ? { photoUrl: row.photoURL } : {}) })) } : {}) };
}
function accountComparison(account) {
  return { localId: account.localId, disabled: account.disabled === true, emailVerified: account.emailVerified === true,
    ...Object.fromEntries(['email', 'displayName', 'phoneNumber', 'photoUrl'].filter(key => account[key]).map(key => [key, account[key]])),
    customClaims: JSON.parse(account.customAttributes || '{}'),
    providers: (account.providerUserInfo || []).filter(row => !['password', 'phone'].includes(row.providerId)).map(row =>
      Object.fromEntries(['providerId', 'rawId', 'email', 'displayName', 'phoneNumber', 'photoUrl'].filter(key => row[key]).map(key => [key, row[key]])))
      .sort((a, b) => a.providerId.localeCompare(b.providerId)) };
}
async function allTargetDocuments(request, base, root) {
  const found = [], seen = new Set();
  async function walk(parent) {
    const children = await requestJson(request, `${base}/${encoded(parent)}:listCollectionIds`, { method: 'POST', body: JSON.stringify({ pageSize: 100 }) });
    if (children.nextPageToken) fail('RESTORE_VERIFICATION_COLLECTION_LIMIT');
    for (const collection of children.collectionIds || []) {
      let token;
      do {
        const query = new URLSearchParams({ pageSize: '100', showMissing: 'true', ...(token ? { pageToken: token } : {}) });
        const page = await requestJson(request, `${base}/${encoded(parent)}/${encodeURIComponent(collection)}?${query}`);
        for (const document of page.documents || []) {
          if (seen.has(document.name) || !document.name.startsWith(root + '/')) fail('RESTORE_VERIFICATION_RESOURCE_INVALID');
          seen.add(document.name);
          if (document.createTime || document.updateTime) found.push(document);
          await walk(document.name);
        }
        if (page.nextPageToken === token && token) fail('RESTORE_VERIFICATION_PAGINATION_INVALID');
        token = page.nextPageToken;
      } while (token);
    }
  }
  await walk(root);
  return found;
}

/** The only writes in the control suite are confined to this fresh demo target. */
export async function verifyHouseholdRestore(payload, options) {
  assertRestoreTarget(options);
  const { projectId, firestoreHost, authHost, storageHost, request = fetch } = options;
  const sourceRoot = `projects/${payload.projectId}/databases/(default)/documents`;
  const root = `projects/${projectId}/databases/(default)/documents`;
  const base = `http://${firestoreHost}/v1`, bucket = `${projectId}.appspot.com`;
  if (!Array.isArray(payload.documents) || !Array.isArray(payload.objects) || !Array.isArray(payload.auth) || !Array.isArray(payload.externalFiles)) fail('RESTORE_PAYLOAD_INVALID');
  const documents = payload.documents.map(document => {
    if (!document.name?.startsWith(sourceRoot + '/') || document.name.slice(sourceRoot.length + 1).split('/').length % 2) fail('RESTORE_SOURCE_RESOURCE_INVALID');
    if (document.name.slice(sourceRoot.length + 1).split('/').some(part => !part || ['.', '..'].includes(part) || /[\u0000-\u001f]/.test(part))) fail('RESTORE_SOURCE_RESOURCE_INVALID');
    return { name: document.name.replace(sourceRoot, root), fields: rebind(document.fields || {}, payload.projectId, projectId) };
  });
  if (new Set(documents.map(row => row.name)).size !== documents.length) fail('RESTORE_DUPLICATE_DOCUMENT');
  const files = [...payload.objects.map(item => ({ ...clone(item), restoredName: item.name })),
    ...payload.externalFiles.filter(item => item.status === 'captured').map(item => ({ ...clone(item), restoredName: `external-restore/${item.id}`, metadata: {} }))];
  if (new Set(files.map(row => row.restoredName)).size !== files.length) fail('RESTORE_DUPLICATE_OBJECT');
  for (const file of files) {
    const bytes = Buffer.from(file.bytesBase64 || '', 'base64');
    if (!file.restoredName || /[\u0000-\u001f]/.test(file.restoredName) || bytes.length !== Number(file.size) || backupDigest(bytes) !== file.sha256) fail('RESTORE_FILE_HASH_MISMATCH');
  }
  const authUids = payload.auth.map(row => row.uid);
  if (new Set(authUids).size !== authUids.length || authUids.some(uid => !/^[A-Za-z0-9_-]{1,128}$/.test(uid || ''))) fail('RESTORE_AUTH_UID_INVALID');
  for (let offset = 0; offset < documents.length; offset += 100) {
    if (Buffer.byteLength(JSON.stringify({ writes: documents.slice(offset, offset + 100).map(update => ({ update })) })) > 8 * 1024 * 1024) fail('RESTORE_BATCH_TOO_LARGE');
  }
  // Validate everything before allowing the first write. Existing targets are
  // rejected rather than cleared or overwritten.
  const existing = await allTargetDocuments(request, base, root);
  const listing = await requestJson(request, `http://${storageHost}/storage/v1/b/${encodeURIComponent(bucket)}/o?maxResults=1`);
  const authListing = await requestJson(request, `http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchGet?maxResults=1`);
  if (existing.length || listing.items?.length || listing.nextPageToken || authListing.users?.length || authListing.nextPageToken) fail('RESTORE_TARGET_NOT_EMPTY');
  for (let offset = 0; offset < documents.length; offset += 100) {
    const writes = documents.slice(offset, offset + 100).map(update => ({ update, currentDocument: { exists: false } }));
    const body = JSON.stringify({ writes });
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) fail('RESTORE_BATCH_TOO_LARGE');
    await requestJson(request, `${base}/${encoded(root)}:commit`, { method: 'POST', body });
  }
  let authMetadataCount = 0;
  for (const account of payload.auth.filter(row => row.exists !== false)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(account.uid || '')) fail('RESTORE_AUTH_UID_INVALID');
    // No passwords, OAuth credentials, sessions or MFA are imported.
    const user = importedAccount(account);
    const imported = await requestJson(request, `http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchCreate`, { method: 'POST', body: JSON.stringify({ users: [user], allowOverwrite: false }) });
    if (imported.error?.length) fail('RESTORE_AUTH_IMPORT_FAILED');
    authMetadataCount++;
  }
  for (const file of files) {
    const bytes = Buffer.from(file.bytesBase64, 'base64');
    const query = new URLSearchParams({ uploadType: 'media', name: file.restoredName, ifGenerationMatch: '0' });
    await requestJson(request, `http://${storageHost}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`, {
      method: 'POST', body: bytes, headers: { 'Content-Type': file.contentType || 'application/octet-stream' } });
    // The emulator's GCS metadata PATCH route uses /b, unlike its GET alias.
    await requestJson(request, `http://${storageHost}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(file.restoredName)}`, {
      method: 'PATCH', body: JSON.stringify({ contentType: file.contentType || 'application/octet-stream', metadata: file.metadata || {},
        ...Object.fromEntries(['cacheControl', 'contentDisposition', 'contentEncoding'].filter(key => typeof file[key] === 'string').map(key => [key, file[key]])) }) });
  }
  const restored = await allTargetDocuments(request, base, root);
  const digestDocuments = rows => backupDigest(canonicalJson(rows.map(row => ({ name: row.name, fields: normalizedFirestoreFields(row.fields || {}) })).sort((a, b) => a.name.localeCompare(b.name))));
  if (restored.length !== documents.length || digestDocuments(restored) !== digestDocuments(documents)) fail('RESTORE_DOCUMENT_HASH_MISMATCH');
  for (const file of files) {
    const uri = `http://${storageHost}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(file.restoredName)}`;
    const metadata = await requestJson(request, uri);
    let bytes;
    if (request === fetch) bytes = await readOriginalBytes(`${uri}?alt=media`, Number(file.size));
    else {
      const response = await request(`${uri}?alt=media`, { headers: { Authorization: 'Bearer owner' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) fail('RESTORE_FILE_READ_FAILED');
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (backupDigest(bytes) !== file.sha256 || bytes.length !== Number(file.size)) fail('RESTORE_FILE_HASH_MISMATCH');
    if (metadata.contentType !== (file.contentType || 'application/octet-stream')) fail('RESTORE_FILE_CONTENT_TYPE_MISMATCH');
    if (canonicalJson(metadata.metadata || {}) !== canonicalJson(file.metadata || {})) fail('RESTORE_FILE_METADATA_MISMATCH');
    if (['cacheControl', 'contentDisposition', 'contentEncoding'].some(key => file[key] !== undefined && metadata[key] !== file[key])) fail('RESTORE_FILE_PROPERTIES_MISMATCH');
  }
  const accounts = await requestJson(request, `http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchGet?maxResults=1000`);
  const expectedAccounts = payload.auth.filter(row => row.exists !== false).map(importedAccount).map(accountComparison).sort((a, b) => a.localId.localeCompare(b.localId));
  const actualAccounts = (accounts.users || []).map(accountComparison).sort((a, b) => a.localId.localeCompare(b.localId));
  if (accounts.nextPageToken || canonicalJson(actualAccounts) !== canonicalJson(expectedAccounts)) fail('RESTORE_AUTH_METADATA_MISMATCH');
  const unverified = payload.externalFiles.filter(item => item.status !== 'captured').length;
  return { verified: unverified === 0, sourceProjectId: payload.projectId, targetProjectId: projectId, documentCount: documents.length,
    objectCount: payload.objects.length, externalFileCount: files.length - payload.objects.length,
    authMetadataCount, authMissingCount: payload.auth.length - authMetadataCount, externalFilesUnverifiedCount: unverified,
    authenticationCredentialsRestored: false, authVerifiedScope: 'uid-email-phone-avatar-disabled-claims-provider-profile-metadata',
    authSessionAndHistoricalTimestampsRestored: false, safetyVerified: true, checkedAt: new Date().toISOString() };
}
