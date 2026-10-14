import { collectHouseholdInventory } from './household-migration-inventory.mjs';
import { buildHouseholdMigrationPlan } from './household-migration-plan.mjs';
import { collectFirestoreBackup, recheckFirestoreBackup, verifyProductionRules, readProductionLocations } from './household-production-evidence.mjs';
import { collectStorageBackup, recheckStorageBackup } from './household-storage-backup.mjs';
import { collectExternalReferences, captureExternalFiles } from './household-external-files.mjs';
import { projectFileSources } from './household-file-sources.mjs';
import { backupDigest, canonicalJson } from './household-backup-archive.mjs';
import { safeControlError } from './household-private-files.mjs';

function partsOfTimestamp(value) {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value || '');
  if (!match || !Number.isFinite(Date.parse(match[1] + 'Z'))) return null;
  return { seconds: String(Math.floor(Date.parse(match[1] + 'Z') / 1000)), nanoseconds: Number((match[2] || '').padEnd(9, '0')) };
}
export function planMatchesBackup(plan, documents) {
  const root = `projects/${plan.projectId}/databases/(default)/documents/`;
  const map = new Map(documents.map(row => [row.name, row]));
  return (plan.changes || []).every(change => {
    const row = map.get(root + change.path), version = partsOfTimestamp(row?.updateTime);
    if (!version || version.seconds !== change.updateTime?.seconds || version.nanoseconds !== change.updateTime?.nanoseconds) return false;
    const native = row.fields?.familyId;
    if (change.before?.present !== (native !== undefined)) return false;
    const value = native === undefined ? undefined : native.stringValue !== undefined ? native.stringValue : Object.hasOwn(native, 'nullValue') ? null : Symbol();
    return !change.before.present || value === change.before.value;
  });
}
async function metadataOfAuth(auth, members) {
  const records = [];
  for (const member of members) {
    try {
      const user = (await auth.getUser(member.uid)).toJSON();
      records.push({ uid: member.uid, exists: true, disabled: user.disabled === true,
        ...Object.fromEntries(['email', 'emailVerified', 'displayName', 'photoURL', 'phoneNumber', 'providerData', 'customClaims', 'metadata', 'tokensValidAfterTime'].filter(key => user[key] !== undefined).map(key => [key, user[key]])) });
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw Object.assign(new Error('AUTH_BACKUP_READ_FAILED'), { code: 'AUTH_BACKUP_READ_FAILED' });
      records.push({ uid: member.uid, exists: false });
    }
  }
  return records;
}

/** Source dependencies are read-only. No production write/apply capability is passed in. */
export async function captureHouseholdEvidence(config, familyId, dependencies, options = {}) {
  const { db, auth, bucket, request, localFirestoreRules, localStorageRules } = dependencies;
  const inventory = await collectHouseholdInventory({ db, auth, bucket }, config);
  const plan = buildHouseholdMigrationPlan(config, inventory, { familyId });
  const planDigest = backupDigest(canonicalJson(plan));
  // The full-project data copy is not started for an unreviewed extra active
  // household or any failed metadata prerequisite.
  if (plan.blockers.length) return { plan, planDigest, inventory, captureComplete: false, code: 'INVENTORY_BLOCKED', payload: null };
  const database = await collectFirestoreBackup({ request, projectId: config.projectId, maxDocuments: options.maxDocuments || 10000 });
  const authMetadata = await metadataOfAuth(auth, config.members);
  let storage;
  try { storage = await collectStorageBackup(bucket); }
  catch (error) { storage = { objects: [], complete: false, code: safeControlError(error, 'STORAGE_BACKUP_READ_FAILED'), privateTokenCount: null, productTokenCount: null }; }
  const authPhotoDocuments = authMetadata.flatMap(account => [account.photoURL, ...(account.providerData || []).map(row => row.photoURL)]
    .filter(url => typeof url === 'string' && url.trim()).map((url, index) => ({
      name: `projects/${config.projectId}/databases/(default)/documents/members/auth-photo-${account.uid}-${index}`,
      fields: { photoURL: { stringValue: url } } })));
  const references = collectExternalReferences([...database.documents, ...authPhotoDocuments]);
  const unique = [...new Map(references.map(row => [row.id, row])).values()];
  const origin = new URL(options.appOrigin || 'https://nasza-rodzina-web.vercel.app');
  const eligible = [], externalFiles = [];
  for (const reference of unique) {
    if (reference.kind === 'firebase-storage') {
      const collection = reference.recordName.split('/documents/')[1].split('/')[0];
      const source = projectFileSources(collection, { [reference.field]: reference.url })[reference.field];
      const object = storage.objects.find(item => source.bucket === config.bucket && item.name === source.path);
      externalFiles.push(object ? { id: reference.id, status: 'captured', bytesBase64: object.bytesBase64,
        size: object.size, sha256: object.sha256, contentType: object.contentType, capturedVia: 'authenticated-storage' }
        : { id: reference.id, status: 'blocked', code: 'FILE_REFERENCE_NOT_IN_CAPTURED_STORAGE' });
    } else if (reference.kind === 'app-asset') {
      const url = new URL(reference.url, origin);
      if (url.origin !== origin.origin || url.pathname.startsWith('/api/') || !/\.(png|jpe?g|gif|webp|pdf)$/i.test(url.pathname)) {
        externalFiles.push({ id: reference.id, status: 'blocked', code: 'APP_ASSET_PATH_NOT_APPROVED' });
      } else eligible.push({ ...reference, kind: 'external-url', url: url.href, id: backupDigest(url.href), originalId: reference.id });
    } else eligible.push(reference);
  }
  const captured = await captureExternalFiles(eligible, { allowedDomains: [...new Set([origin.hostname, ...(options.allowedDomains || [])])],
    ...(dependencies.externalTransport || {}) });
  const originalIds = new Map();
  for (const row of eligible) originalIds.set(row.id, [...(originalIds.get(row.id) || []), row.originalId || row.id]);
  externalFiles.push(...captured.flatMap(row => (originalIds.get(row.id) || [row.id]).map(id => ({ ...row, id }))));
  const rules = await verifyProductionRules({ request, projectId: config.projectId, bucket: config.bucket, localFirestoreRules, localStorageRules });
  const locations = await readProductionLocations({ request, projectId: config.projectId, bucket: config.bucket });
  let consistency;
  try {
    consistency = { firestore: await recheckFirestoreBackup({ request, projectId: config.projectId, documents: database.documents,
      missingAncestors: database.missingAncestors, maxDocuments: options.maxDocuments || 10000 }),
    storage: storage.complete ? await recheckStorageBackup(bucket, storage.objects) : { stable: false, complete: false },
    auth: { stable: canonicalJson(authMetadata) === canonicalJson(await metadataOfAuth(auth, config.members)) } };
  } catch (error) { consistency = { firestore: { stable: false }, storage: { stable: false }, code: safeControlError(error, 'CAPTURE_RECHECK_FAILED') }; }
  const bound = planMatchesBackup(plan, database.documents);
  const authMatchesProfiles = authMetadata.every((row, index) => !config.members[index].expectedCanLogin || row.exists && row.disabled === false);
  const captureComplete = storage.complete && externalFiles.length === unique.length && externalFiles.every(row => row.status === 'captured')
    && bound && authMatchesProfiles && consistency.firestore?.stable === true && consistency.storage?.stable === true && consistency.auth?.stable === true;
  const payload = { schemaVersion: 1, createdAt: new Date().toISOString(), projectId: config.projectId, bucket: config.bucket,
    documents: database.documents, missingAncestors: database.missingAncestors, objects: storage.objects, auth: authMetadata,
    externalFiles, config, plan, inventory, rules, locations, consistency, references,
    manifest: { captureComplete, firestoreComplete: database.complete, storageComplete: storage.complete,
      planBoundToBackup: bound, authScope: 'five-profile-metadata-only', objectScope: 'current-live-selected-bucket-objects',
      archivedObjectVersionsIncluded: false, secretManagerKeysIncluded: false,
      documentCount: database.documents.length, objectCount: storage.objects.length, externalReferenceCount: unique.length,
      documentsSha256: backupDigest(canonicalJson(database.documents)), objectsSha256: backupDigest(canonicalJson(storage.objects)) },
    evidence: { tokens: { scanVerified: storage.complete, privateTokenCount: storage.privateTokenCount, productTokenCount: storage.productTokenCount }, planDigest } };
  return { plan, planDigest, inventory, rules, locations, consistency, externalFiles, storage, payload, captureComplete };
}
