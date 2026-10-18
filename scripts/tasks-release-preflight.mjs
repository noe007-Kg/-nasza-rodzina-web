#!/usr/bin/env node
/** Task-only release evidence. No production commit, migration, deployment or delete. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statfs } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleAuth } from 'google-auth-library';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { collectFirestoreBackup, recheckFirestoreBackup, verifyProductionRules, readProductionLocations } from './lib/household-production-evidence.mjs';
import { collectStorageBackup, recheckStorageBackup } from './lib/household-storage-backup.mjs';
import { collectExternalReferences, captureExternalFiles } from './lib/household-external-files.mjs';
import { projectFileSources } from './lib/household-file-sources.mjs';
import { backupDigest, canonicalJson, sealHouseholdBackup, openHouseholdBackup } from './lib/household-backup-archive.mjs';
import { securePrivateDirectory, writePrivateFile, readPrivateBytes, controlFailure as fail } from './lib/household-private-files.mjs';
import { runAutomaticRestore } from './household-preflight.mjs';

export const PROJECT = 'nasza-rodzina';
export const RELEASE_REVISION = 'f46f197b344f6d7a951d2f38fef3ff4d34b35631';
const PROJECT_NUMBER = '340731425852';
const repository = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const root = `projects/${PROJECT}/databases/(default)/documents`;
const taskCollections = ['tasks', 'taskCompletions', 'taskPointBalances', 'taskPointLedger', 'taskRewards', 'taskRewardRequests',
  '_taskRewardPending', '_taskPhotoUploads', '_taskRewardImageUploads', '_taskPhotoCleanup', '_taskRewardImageCleanup'];
const metadataFields = ['familyId', 'name', 'personKey', 'role', 'active', 'disabled', 'archived', 'canLogin', 'person', 'people',
  'uid', 'createdBy', 'submittedBy', 'approvedBy', 'completedBy', 'actorUid', 'decidedBy', 'taskId', 'rewardId', 'requestId',
  'rewardRequestId', 'proofUploadId', 'imageUploadId', 'state'];
const validBucket = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(value) && !value.includes('..');
const family = value => typeof value === 'string' && value !== '__legacy__' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null;
const safeCode = error => ({ 401: 'AUTHENTICATION_REQUIRED', 403: 'READ_PERMISSION_DENIED', 404: 'RESOURCE_NOT_FOUND' }[Number(error?.response?.status || error?.httpStatus || error?.statusCode || error?.code)]
  || (typeof error?.code === 'string' && /^[A-Z][A-Z_0-9]{1,99}$/.test(error.code) ? error.code : 'READ_ONLY_CHECK_FAILED'));
const json = value => JSON.stringify(value, null, 2) + '\n';

export function parseTaskPreflightArguments(args) {
  const options = { project: PROJECT, backup: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) fail('TASK_PREFLIGHT_ARGUMENT_INVALID');
    seen.add(flag);
    if (['--help', '--backup', '--check'].includes(flag)) options[flag.slice(2)] = true;
    else if (['--project', '--bucket', '--output'].includes(flag) && args[index + 1] && !args[index + 1].startsWith('--')) options[flag.slice(2)] = args[++index];
    else fail('TASK_PREFLIGHT_ARGUMENT_INVALID');
  }
  if (options.project !== PROJECT) fail('TASK_PREFLIGHT_EXPLICIT_PROJECT_REQUIRED');
  if (options.backup && options.check) fail('TASK_PREFLIGHT_MODE_CONFLICT');
  if (options.bucket !== undefined && !validBucket(options.bucket)) fail('TASK_PREFLIGHT_BUCKET_INVALID');
  return options;
}

/** Whitelist transport: even a caller error cannot turn this into a cloud write. */
export function readOnlyTaskTransport(client) {
  return async options => {
    if (!options || Object.keys(options).some(key => !['method', 'url', 'data'].includes(key))) fail('TASK_PREFLIGHT_TRANSPORT_FORBIDDEN');
    let url;
    try { url = new URL(options.url); } catch { fail('TASK_PREFLIGHT_TRANSPORT_FORBIDDEN'); }
    const method = options.method || 'GET';
    const pathname = decodeURIComponent(url.pathname);
    const allowed = url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && (
      url.hostname === 'firebase.googleapis.com' && pathname === `/v1beta1/projects/${PROJECT}`
      || url.hostname === 'identitytoolkit.googleapis.com' && pathname === `/v1/projects/${PROJECT}/accounts:batchGet`
      || url.hostname === 'firebaserules.googleapis.com' && pathname.startsWith(`/v1/projects/${PROJECT}/`) && /\/(releases|rulesets)\//.test(pathname)
      || url.hostname === 'firestore.googleapis.com' && pathname.startsWith(`/v1/projects/${PROJECT}/databases/(default)`)
      || url.hostname === 'storage.googleapis.com' && pathname.startsWith('/storage/v1/b/'));
    const listCollections = method === 'POST' && url.hostname === 'firestore.googleapis.com'
      && pathname.startsWith(`/v1/${root}`) && pathname.endsWith(':listCollectionIds');
    if (!allowed || method !== 'GET' && !listCollections || method === 'GET' && options.data !== undefined) fail('TASK_PREFLIGHT_TRANSPORT_FORBIDDEN');
    return client.request({ ...options, method, maxRedirects: 0, timeout: 30000, maxContentLength: 128 * 1024 * 1024 });
  };
}

async function readAuthMetadata(request) {
  const result = [], tokens = new Set(); let pageToken;
  do {
    const query = new URLSearchParams({ maxResults: '1000', fields: 'users(localId,email,emailVerified,displayName,photoUrl,phoneNumber,disabled,providerUserInfo,customAttributes),nextPageToken', ...(pageToken ? { nextPageToken: pageToken } : {}) });
    const response = (await request({ method: 'GET', url: `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet?${query}` })).data;
    if (!response || response.users !== undefined && !Array.isArray(response.users)) fail('AUTH_METADATA_RESPONSE_INVALID');
    for (const row of response.users || []) {
      if (typeof row.localId !== 'string' || !row.localId || result.some(account => account.uid === row.localId)) fail('AUTH_METADATA_RESPONSE_INVALID');
      if (row.providerUserInfo !== undefined && (!Array.isArray(row.providerUserInfo)
        || row.providerUserInfo.some(provider => typeof provider?.providerId !== 'string' || typeof provider?.rawId !== 'string'))) fail('AUTH_METADATA_RESPONSE_INVALID');
      result.push({ uid: row.localId, exists: true, disabled: row.disabled === true,
        ...Object.fromEntries(['email', 'emailVerified', 'displayName', 'phoneNumber'].filter(key => row[key] !== undefined).map(key => [key, row[key]])),
        ...(row.photoUrl ? { photoURL: row.photoUrl } : {}),
        ...(row.customAttributes ? { customClaims: JSON.parse(row.customAttributes) } : {}),
        providerData: (row.providerUserInfo || []).map(provider => ({ providerId: provider.providerId, uid: provider.rawId,
          ...Object.fromEntries(['email', 'displayName', 'phoneNumber'].filter(key => provider[key] !== undefined).map(key => [key, provider[key]])),
          ...(provider.photoUrl ? { photoURL: provider.photoUrl } : {}) })) });
      // Existing byte-restore verifier intentionally rejects paginated Auth restoration.
      if (result.length > 1000) fail('AUTH_METADATA_RESTORE_LIMIT_REACHED');
    }
    pageToken = response.nextPageToken;
    if (pageToken && (typeof pageToken !== 'string' || tokens.has(pageToken))) fail('AUTH_METADATA_PAGINATION_INVALID');
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  return result.sort((a, b) => a.uid.localeCompare(b.uid));
}

async function readTaskMetadata(request) {
  const documents = [];
  for (const collection of ['members', ...taskCollections]) {
    let pageToken; const tokens = new Set();
    do {
      const query = new URLSearchParams({ pageSize: '500', ...(pageToken ? { pageToken } : {}) });
      for (const field of metadataFields) query.append('mask.fieldPaths', field);
      const response = (await request({ method: 'GET', url: `https://firestore.googleapis.com/v1/${root}/${collection}?${query}` })).data;
      if (!response || response.documents !== undefined && !Array.isArray(response.documents)) fail('TASK_METADATA_RESPONSE_INVALID');
      for (const document of response.documents || []) {
        if (typeof document.name !== 'string' || !document.name.startsWith(`${root}/${collection}/`) || document.name.slice(`${root}/${collection}/`.length).includes('/')) fail('TASK_METADATA_RESPONSE_INVALID');
        documents.push(document); if (documents.length > 10000) fail('TASK_METADATA_LIMIT_REACHED');
      }
      pageToken = response.nextPageToken;
      if (pageToken && (typeof pageToken !== 'string' || tokens.has(pageToken))) fail('TASK_METADATA_PAGINATION_INVALID');
      if (pageToken) tokens.add(pageToken);
    } while (pageToken);
  }
  return documents;
}

function scalar(document, key) {
  const value = document.fields?.[key];
  if (value?.stringValue !== undefined) return value.stringValue;
  if (value?.booleanValue !== undefined) return value.booleanValue;
  return null;
}

/** Counts only: no name, UID, person key or family ID may leave this projection. */
export function inspectTaskHouseholds(documents, accounts) {
  const blockers = new Set(), collection = name => documents.filter(row => row.name.startsWith(`${root}/${name}/`));
  const members = collection('members').filter(row => scalar(row, 'active') === true && scalar(row, 'archived') !== true && scalar(row, 'disabled') !== true);
  const ids = new Set(members.map(row => row.name.slice(`${root}/members/`.length)));
  const families = new Set(members.map(row => family(scalar(row, 'familyId'))).filter(Boolean));
  if (members.length !== 5) blockers.add('TASK_FIVE_ACTIVE_PROFILES_NOT_VERIFIED');
  if (families.size !== 1 || members.some(row => !family(scalar(row, 'familyId')))) blockers.add('TASK_EXPLICIT_HOUSEHOLD_ASSIGNMENT_REQUIRED');
  if (members.filter(row => scalar(row, 'role') === 'parent' && scalar(row, 'canLogin') === true).length !== 2) blockers.add('TASK_TWO_ACTIVE_PARENTS_NOT_VERIFIED');
  if (members.some(row => !['parent', 'adult', 'child'].includes(scalar(row, 'role')))) blockers.add('TASK_MEMBER_ROLE_NOT_VERIFIED');
  if (members.some(row => typeof scalar(row, 'canLogin') !== 'boolean')) blockers.add('TASK_MEMBER_LOGIN_POLICY_NOT_VERIFIED');
  const persons = members.map(row => scalar(row, 'personKey') || scalar(row, 'name'));
  if (persons.some(person => typeof person !== 'string' || !person) || new Set(persons).size !== members.length) blockers.add('TASK_PROFILE_PERSON_KEY_AMBIGUOUS');
  if (members.some(row => scalar(row, 'canLogin') === true && !accounts.some(account => account.uid === row.name.slice(`${root}/members/`.length) && account.disabled === false))) blockers.add('TASK_AUTH_PROFILE_LINK_NOT_VERIFIED');
  let unassigned = 0, foreign = 0, invalidLinks = 0;
  const familyId = families.size === 1 ? [...families][0] : null;
  const keys = new Set([...persons, 'family']);
  for (const name of taskCollections) {
    for (const row of collection(name)) {
      const recordFamily = family(scalar(row, 'familyId'));
      if (!recordFamily) unassigned++;
      else if (!familyId || recordFamily !== familyId) foreign++;
      const person = scalar(row, 'person');
      if (person !== null && !keys.has(person)) invalidLinks++;
      if (row.fields?.people !== undefined) {
        const people = row.fields.people.arrayValue?.values || [];
        if (!row.fields.people.arrayValue || !Array.isArray(people)
          || people.some(value => typeof value.stringValue !== 'string' || !persons.includes(value.stringValue))) invalidLinks++;
      }
      for (const field of ['uid', 'createdBy', 'submittedBy', 'approvedBy', 'completedBy', 'actorUid', 'decidedBy']) {
        const uid = scalar(row, field); if (uid !== null && !ids.has(uid)) invalidLinks++;
      }
      const uid = scalar(row, 'uid'), actor = members.find(member => member.name === `${root}/members/${uid}`);
      if (uid !== null && person !== null && actor && scalar(actor, 'role') !== 'parent'
        && person !== 'family' && person !== (scalar(actor, 'personKey') || scalar(actor, 'name'))) invalidLinks++;
      for (const [field, source] of [['taskId', 'tasks'], ['rewardId', 'taskRewards'], ['requestId', 'taskRewardRequests'],
        ['rewardRequestId', 'taskRewardRequests'], ['proofUploadId', '_taskPhotoUploads'], ['imageUploadId', '_taskRewardImageUploads']]) {
        const reference = scalar(row, field);
        const target = reference !== null ? collection(source).find(target => target.name === `${root}/${source}/${reference}`
          && family(scalar(target, 'familyId')) === recordFamily) : null;
        if (reference !== null && !target) invalidLinks++;
        if (target && field === 'proofUploadId' && name === 'tasks' && scalar(target, 'taskId') !== row.name.slice(`${root}/tasks/`.length)) invalidLinks++;
        if (target && field === 'imageUploadId' && name === 'taskRewards' && scalar(target, 'rewardId') !== row.name.slice(`${root}/taskRewards/`.length)) invalidLinks++;
      }
    }
  }
  const duplicate = name => {
    const keys = collection(name).map(row => [scalar(row, 'familyId'), scalar(row, 'person'), name === '_taskRewardPending' ? scalar(row, 'rewardId') : null].join('\u0000'));
    return keys.length !== new Set(keys).size;
  };
  if (unassigned) blockers.add('TASK_RECORD_HOUSEHOLD_ASSIGNMENT_REQUIRED');
  if (foreign) blockers.add('TASK_OTHER_HOUSEHOLD_RECORDS_REQUIRE_SEPARATE_REVIEW');
  if (invalidLinks) blockers.add('TASK_OWNERSHIP_LINK_REVIEW_REQUIRED');
  if (duplicate('taskPointBalances') || duplicate('_taskRewardPending')) blockers.add('TASK_BALANCE_OR_PENDING_CONFLICT');
  return { verified: blockers.size === 0, scope: 'metadata-only-family-and-record-references', fullAuthorizationVerified: false,
    activeProfileCount: members.length, householdCount: families.size,
    taskRecordCount: collection('tasks').length, unassignedRecordCount: unassigned, otherHouseholdRecordCount: foreign,
    invalidLinkCount: invalidLinks, blockers: [...blockers].sort(), householdOwnerConfirmationVerified: false };
}

async function releaseRules() {
  const files = await Promise.all(['firestore.rules', 'storage.rules'].map(async name => (await execute('git', ['show', `${RELEASE_REVISION}:${name}`], { cwd: repository, maxBuffer: 8 * 1024 * 1024 })).stdout));
  return { localFirestoreRules: files[0], localStorageRules: files[1] };
}
const projectedRules = rules => Object.fromEntries(['firestore', 'storage'].map(service => [service, { verified: rules?.[service]?.verified === true,
  status: ['matched', 'mismatch', 'changed', 'unavailable'].includes(rules?.[service]?.status) ? rules[service].status : 'unavailable',
  sha256: /^[a-f0-9]{64}$/.test(rules?.[service]?.sha256 || '') ? rules[service].sha256 : null,
  localSha256: /^[a-f0-9]{64}$/.test(rules?.[service]?.localSha256 || '') ? rules[service].localSha256 : null }]));

export async function runTaskReleasePreflight(options, dependencies = {}) {
  if (options.project !== PROJECT) fail('TASK_PREFLIGHT_EXPLICIT_PROJECT_REQUIRED');
  const env = dependencies.env || process.env;
  if (['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST'].some(key => env[key])
    || [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].some(value => value && value !== PROJECT)) fail('TASK_PREFLIGHT_ENVIRONMENT_MISMATCH');
  const directory = await securePrivateDirectory(options.output || path.join('/tmp', `nasza-rodzina-tasks-preflight-${randomUUID()}`));
  const report = { schemaVersion: 1, projectId: PROJECT, releaseRevision: RELEASE_REVISION, checkedAt: new Date().toISOString(),
    mode: options.backup ? 'backup-and-check' : 'check-only', productionWritesPerformed: 0, migrationsPerformed: 0, readyForDeployment: false,
    authentication: 'not-verified', disk: {}, rules: projectedRules(), taskHouseholds: null,
    backup: { captured: false, complete: false, scope: 'default-firestore-current-selected-bucket-auth-metadata-known-file-fields' },
    restore: { attempted: false, verified: false }, rollback: { verified: false },
    ownerProofs: { householdConfirmationVerified: false, secondCopyVerified: false, separateKeyCustodyVerified: false }, blockers: [], warnings: [
      'BACKUP_EXCLUDES_AUTH_PASSWORDS_OAUTH_CREDENTIALS_SECRET_MANAGER_AND_ARCHIVED_OBJECT_VERSIONS',
      'LOCAL_EVIDENCE_DIRECTORY_MAY_BE_EPHEMERAL_KEEP_ARCHIVE_AND_KEY_SEPARATELY', 'CAPTURE_IS_NOT_A_CROSS_SERVICE_ATOMIC_SNAPSHOT',
      'KNOWN_FILE_FIELD_SCAN_IS_NOT_A_PROOF_OF_ALL_EXTERNAL_DATA_SOURCES'] };
  const block = code => { if (!report.blockers.includes(code)) report.blockers.push(code); };
  let app;
  try {
    const disk = await (dependencies.disk || statfs)(directory);
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    const required = options.backup ? 2 * 1024 ** 3 : 16 * 1024 ** 2;
    report.disk = { verified: Number.isSafeInteger(freeBytes) && freeBytes >= required, availableBytes: Number.isSafeInteger(freeBytes) ? freeBytes : null, minimumBytes: required };
    if (!report.disk.verified) fail('LOCAL_DISK_SPACE_INSUFFICIENT');
    let client = dependencies.client;
    if (!client) {
      try { client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient(); }
      catch { fail('APPLICATION_DEFAULT_CREDENTIALS_NOT_AVAILABLE'); }
    }
    const request = readOnlyTaskTransport(client);
    const project = (await request({ method: 'GET', url: `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}` })).data;
    if (project?.projectId !== PROJECT || String(project.projectNumber) !== PROJECT_NUMBER) fail('TASK_PREFLIGHT_PROJECT_NOT_VERIFIED');
    report.authentication = 'project-read-verified';
    // Auth/Firestore evidence remains useful if Storage is absent or forbidden.
    const accounts = await readAuthMetadata(request);
    report.authMetadataCount = accounts.length;
    const metadataDocuments = await readTaskMetadata(request);
    report.taskHouseholds = inspectTaskHouseholds(metadataDocuments, accounts);
    for (const code of report.taskHouseholds.blockers) block(code);
    const bucketName = options.bucket || project.resources?.storageBucket;
    if (!validBucket(bucketName)) fail('STORAGE_BUCKET_NOT_DISCOVERED');
    let bucketUsable = false;
    try {
      const metadata = (await request({ method: 'GET', url: `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}?fields=name,projectNumber,location` })).data;
      if (metadata?.name !== bucketName || String(metadata.projectNumber) !== PROJECT_NUMBER) fail('STORAGE_BUCKET_PROJECT_NOT_VERIFIED');
      bucketUsable = true;
    } catch (error) { block(safeCode(error)); }
    let sources;
    try { sources = await (dependencies.releaseRules || releaseRules)(); }
    catch { block('RULES_BASELINE_NOT_AVAILABLE'); }
    const locations = await readProductionLocations({ request, projectId: PROJECT, bucket: bucketName });
    report.locations = Object.fromEntries(['firestore', 'storage'].map(service => [service, { verified: locations[service].verified === true,
      europeanUnion: locations[service].europeanUnion === true }]));
    if (!locations.complete || !locations.firestore.europeanUnion || !locations.storage.europeanUnion) block('PRIMARY_DATA_EU_LOCATION_NOT_VERIFIED');
    let rules;
    if (sources) {
      rules = await verifyProductionRules({ request, projectId: PROJECT, bucket: bucketName, ...sources });
      report.rules = projectedRules(rules);
    }
    for (const service of ['firestore', 'storage']) if (report.rules[service].verified !== true) {
      block(report.rules[service].status === 'mismatch' ? `PRODUCTION_${service.toUpperCase()}_RULES_DIFF_REVIEW_REQUIRED`
        : `PRODUCTION_${service.toUpperCase()}_RULES_NOT_VERIFIED`);
    }
    if (options.backup) {
      const database = await (dependencies.collectFirestore || collectFirestoreBackup)({ request, projectId: PROJECT, maxDocuments: 10000 });
      let bucket, storage = { complete: false, objects: [], privateTokenCount: null, productTokenCount: null };
      if (bucketUsable) {
        if (!dependencies.bucket) app = initializeApp({ credential: applicationDefault(), projectId: PROJECT, storageBucket: bucketName }, `tasks-release-read-only-${randomUUID()}`);
        bucket = dependencies.bucket || getStorage(app).bucket(bucketName);
        try { storage = await collectStorageBackup(bucket); }
        catch (error) { block(safeCode(error)); }
      }
      const authPhotos = accounts.flatMap(account => [account.photoURL, ...account.providerData.map(provider => provider.photoURL)].filter(Boolean)
        .map((url, index) => ({ name: `${root}/members/auth-photo-${account.uid}-${index}`, fields: { photoURL: { stringValue: url } } })));
      const references = [...new Map(collectExternalReferences([...database.documents, ...authPhotos]).map(row => [row.id, row])).values()];
      const externalFiles = [];
      for (const reference of references) {
        if (reference.kind === 'firebase-storage') {
          const collection = reference.recordName.split('/documents/')[1].split('/')[0];
          const source = projectFileSources(collection, { [reference.field]: reference.url })[reference.field];
          const object = storage.objects.find(item => source.bucket === bucketName && item.name === source.path);
          externalFiles.push(object ? { id: reference.id, status: 'captured', size: object.size, bytesBase64: object.bytesBase64,
            sha256: object.sha256, contentType: object.contentType, capturedVia: 'authenticated-storage' }
            : { id: reference.id, status: 'blocked', code: 'EXTERNAL_REFERENCE_OUTSIDE_CAPTURED_BUCKET' });
        } else if (reference.kind === 'app-asset') externalFiles.push({ id: reference.id, status: 'blocked', code: 'APP_ASSET_BACKUP_REQUIRES_REVIEW' });
        else externalFiles.push(...await captureExternalFiles([reference]));
      }
      const consistency = { firestore: await (dependencies.recheckFirestore || recheckFirestoreBackup)({ request, projectId: PROJECT,
        documents: database.documents, missingAncestors: database.missingAncestors, maxDocuments: 10000 }),
      storage: storage.complete ? await recheckStorageBackup(bucket, storage.objects) : { stable: false, complete: false },
      auth: { stable: canonicalJson(accounts) === canonicalJson(await readAuthMetadata(request)) } };
      const complete = database.complete === true && storage.complete === true && externalFiles.every(row => row.status === 'captured')
        && Object.values(consistency).every(row => row.stable === true);
      const payload = { schemaVersion: 1, createdAt: new Date().toISOString(), projectId: PROJECT, bucket: bucketName,
        documents: database.documents, missingAncestors: database.missingAncestors, objects: storage.objects, auth: accounts,
        externalFiles, references, locations, consistency, rules: rules || {},
        manifest: { captureComplete: complete, scope: report.backup.scope, archivedObjectVersionsIncluded: false,
          secretManagerKeysIncluded: false, documentCount: database.documents.length, objectCount: storage.objects.length } };
      const key = randomBytes(32), keyFile = path.join(directory, 'backup.key'), archiveFile = path.join(directory, 'tasks-release-backup.nrb');
      try {
        const bytes = sealHouseholdBackup(payload, key);
        await writePrivateFile(keyFile, key); await writePrivateFile(archiveFile, bytes);
        const diskArchive = await readPrivateBytes(archiveFile);
        const hashesVerified = canonicalJson(openHouseholdBackup(diskArchive, key)) === canonicalJson(payload);
        report.backup = { ...report.backup, captured: true, complete: complete && hashesVerified, manifestHashesVerified: hashesVerified,
          archiveDigestSha256: backupDigest(diskArchive), documentCount: database.documents.length,
          firestoreCaptured: database.complete === true, storageCaptured: storage.complete === true,
          objectCount: storage.complete ? storage.objects.length : null,
          externalReferenceCount: references.length, externalFilesUnverifiedCount: externalFiles.filter(row => row.status !== 'captured').length,
          captureStable: Object.values(consistency).every(row => row.stable === true), privateTokenCount: storage.privateTokenCount, productTokenCount: storage.productTokenCount };
        if (storage.privateTokenCount || storage.productTokenCount) block('STORAGE_DOWNLOAD_TOKENS_REQUIRE_REVIEW');
        report.restore.attempted = true;
        try {
          const restored = await (dependencies.restore || runAutomaticRestore)(directory, archiveFile, keyFile, payload);
          const capturedDataVerified = restored.verified === true && restored.safetyVerified === true
            && restored.sourceProjectId === PROJECT && /^demo-household-restore-/.test(restored.targetProjectId || '')
            && restored.archiveDigestSha256 === report.backup.archiveDigestSha256 && restored.emulatorExitCode === 0;
          report.restore = { attempted: true, capturedDataVerified, verified: report.backup.complete && capturedDataVerified,
          emulatorExitCode: Number.isInteger(restored.emulatorExitCode) ? restored.emulatorExitCode : null,
          archiveDigestSha256: restored.archiveDigestSha256 === report.backup.archiveDigestSha256 ? restored.archiveDigestSha256 : null };
          if (typeof restored.code === 'string' && /^RESTORE_[A-Z_0-9]{1,85}$/.test(restored.code)) {
            report.restore.code = restored.code; block(restored.code);
          }
        } catch (error) { report.restore.code = safeCode(error); block('ACTUAL_ARCHIVE_RESTORE_NOT_VERIFIED'); }
      } finally { key.fill(0); }
    }
  } catch (error) { block(safeCode(error)); }
  finally { if (app) await deleteApp(app); }
  if (!report.backup.complete) block('COMPLETE_CURRENT_BACKUP_NOT_VERIFIED');
  if (!report.restore.verified) block('ACTUAL_ARCHIVE_RESTORE_NOT_VERIFIED');
  block('TASK_ROLLBACK_REHEARSAL_NOT_VERIFIED');
  block('TASK_OBJECT_TICKET_LINKS_NOT_VERIFIED');
  block('RUNTIME_STORAGE_DELETE_IAM_NOT_VERIFIED');
  block('OWNER_HOUSEHOLD_CONFIRMATION_REQUIRED');
  block('SECOND_BACKUP_COPY_AND_SEPARATE_KEY_CUSTODY_REQUIRED');
  report.blockers.sort();
  await writePrivateFile(path.join(directory, 'tasks-release-summary.json'), json(report));
  return { report, directory };
}

export function renderTaskPreflightSummary(report) {
  // This receives only the fixed, allowlisted public projection above; no raw cloud errors.
  return `Projekt: ${PROJECT}. Tryb: ${report.mode}. Zapisów produkcyjnych: 0.\n` +
    `Autoryzacja: ${report.authentication}. Kopia kompletna: ${report.backup.complete ? 'TAK' : 'NIE ZWERYFIKOWANO'}. Odtworzenie: ${report.restore.verified ? 'PASS' : 'NIE ZWERYFIKOWANO'}.\n` +
    `GOTOWE DO WDROŻENIA ZADAŃ: NIE. Blokady: ${report.blockers.join(', ')}.\n`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseTaskPreflightArguments(process.argv.slice(2));
    if (options.help) console.log('node scripts/tasks-release-preflight.mjs [--check | --backup] [--project nasza-rodzina] [--bucket VERIFIED_EXISTING_BUCKET] [--output NEW_PRIVATE_DIRECTORY]. Domyślnie kontrola odczytowa. --backup: zaszyfrowana kopia i próba odtworzenia w lokalnych emulatorach demo; wymaga Node 22, Java 21 i co najmniej 2 GiB wolnego miejsca. Brak migracji, deployu, zmian reguł i zapisów produkcyjnych. Domyślny prywatny katalog /tmp jest tymczasowy; zachowaj kopię i klucz oddzielnie.');
    else {
      const { report, directory } = await runTaskReleasePreflight(options);
      console.log(renderTaskPreflightSummary(report));
      console.log(`Prywatny katalog wyniku: ${directory}. Nie przesyłaj kopii ani klucza do rozmowy/GitHub.\nZachowaj archiwum i klucz w oddzielnych bezpiecznych miejscach oraz drugą kopię poza tym środowiskiem.`);
      process.exitCode = 2;
    }
  } catch (error) { console.error(`Kontrola przerwana: ${safeCode(error)}. Zapisów produkcyjnych: 0. GOTOWE DO WDROŻENIA: NIE.`); process.exitCode = 2; }
}
