import { getStorage } from 'firebase-admin/storage';
import { EduServerError } from './edu-auth.mjs';
import { explicitFamilyId } from './family-identity.mjs';
import { HEALTH_DOCUMENT_MAX_BYTES, validHealthFileHeader } from './health-access.mjs';

const legacyPeople = new Set(['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla']);
const medicalTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const active = value => value?.active === true && value.canLogin === true && value.archived !== true
  && value.disabled !== true && ['parent', 'adult', 'child'].includes(value.role);
const personKey = value => String(value?.personKey || value?.name || '');
const fail = (code = 'STORAGE_HEALTH_FILE_INVALID', status = 400) => { throw new EduServerError(code, status,
  status === 403 ? 'Brak uprawnień do tego dokumentu.' : 'Nie udało się bezpiecznie zapisać dokumentu. Spróbuj ponownie.'); };

function healthPath(context, path) {
  if (typeof path !== 'string' || path.length > 600 || /[\u0000-\u001f\\]/.test(path)) fail();
  const parts = path.split('/');
  if (parts.length !== 5 || parts.some(part => !part || ['.', '..'].includes(part))
    || parts[0] !== 'health' || !['parents', 'shared'].includes(parts[1])
    || !(parts[2] === 'family' || legacyPeople.has(parts[2]) || /^member-[a-f0-9]{24}$/.test(parts[2]))) fail();
  if (parts[3] !== context.uid) fail('STORAGE_HEALTH_FILE_FORBIDDEN', 403);
  return { path, visibility: parts[1], person: parts[2] };
}

/** The uploader's current household and the real target profile authorize a legacy path.
 * The legacy parent/person privacy policy is retained; this does not widen protected-document ACLs. */
async function authorization(context, selection) {
  return context.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(context.db.collection('members').doc(context.uid));
    const actor = snapshot.data(), familyId = explicitFamilyId(actor);
    if (!snapshot.exists || !active(actor) || !familyId
      || context.profile && explicitFamilyId(context.profile) !== familyId) fail('STORAGE_HOUSEHOLD_REQUIRED', 403);
    if (actor.role !== 'parent' && (selection.visibility !== 'shared' || selection.person !== personKey(actor))) {
      fail('STORAGE_HEALTH_FILE_FORBIDDEN', 403);
    }
    if (selection.person === 'family') return { familyId, ownerProfileId: 'family' };
    const members = await transaction.get(context.db.collection('members').where('familyId', '==', familyId));
    const targets = members.docs.filter(item => item.data()?.active === true && item.data().archived !== true
      && item.data().disabled !== true && personKey(item.data()) === selection.person
      && explicitFamilyId(item.data()) === familyId);
    if (targets.length !== 1) fail('STORAGE_HEALTH_FILE_FORBIDDEN', 403);
    return { familyId, ownerProfileId: targets[0].id };
  }, { readOnly: true });
}

/** Validate bytes and revoke any SDK-created bearer token before the UI publishes a path.
 * Generation guards protect exactly the verified object; no download URL is created or returned. */
export async function finalizeLegacyHealthFile(context, path) {
  const selection = healthPath(context, path);
  const checked = await authorization(context, selection);
  try {
    const bucket = context.bucket || getStorage(context.app).bucket(context.storageBucket
      || process.env.FIREBASE_STORAGE_BUCKET || context.app?.options?.storageBucket);
    const [metadata] = await bucket.file(path).getMetadata();
    const size = Number(metadata.size);
    if (metadata.name !== path || !medicalTypes.has(metadata.contentType) || !Number.isSafeInteger(size)
      || size <= 0 || size > HEALTH_DOCUMENT_MAX_BYTES || !/^\d+$/.test(String(metadata.generation))
      || !/^\d+$/.test(String(metadata.metageneration))
      || Object.hasOwn(metadata.metadata || {}, 'familyId') && explicitFamilyId(metadata.metadata) !== checked.familyId
      || Object.hasOwn(metadata.metadata || {}, 'uploaderUid') && metadata.metadata.uploaderUid !== context.uid) fail();
    const generation = String(metadata.generation), metageneration = String(metadata.metageneration);
    const pinned = bucket.file(path, { generation });
    const [bytes] = await pinned.download({ validation: 'crc32c', decompress: false });
    const validHeader = metadata.contentType === 'image/gif'
      ? Buffer.isBuffer(bytes) && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
      : validHealthFileHeader(metadata.contentType, bytes);
    if (!Buffer.isBuffer(bytes) || bytes.length !== size || !validHeader) fail();
    const current = await authorization(context, selection);
    if (current.familyId !== checked.familyId || current.ownerProfileId !== checked.ownerProfileId) fail('STORAGE_HEALTH_FILE_FORBIDDEN', 403);
    await pinned.setMetadata({ cacheControl: 'private, no-store', metadata: {
      ...(metadata.metadata || {}), familyId: checked.familyId, uploaderUid: context.uid,
      ownerProfileId: checked.ownerProfileId, visibility: selection.visibility, firebaseStorageDownloadTokens: null,
    } }, { ifGenerationMatch: generation, ifMetagenerationMatch: metageneration });
    const [confirmed] = await bucket.file(path).getMetadata();
    const finalAuthorization = await authorization(context, selection);
    if (String(confirmed.generation) !== generation || confirmed.metadata?.familyId !== checked.familyId
      || confirmed.metadata?.uploaderUid !== context.uid || confirmed.metadata?.firebaseStorageDownloadTokens
      || finalAuthorization.familyId !== checked.familyId || finalAuthorization.ownerProfileId !== checked.ownerProfileId) {
      fail('STORAGE_HEALTH_FILE_NOT_READY', 409);
    }
    return { path, familyId: checked.familyId };
  } catch (error) {
    if (error instanceof EduServerError) throw error;
    fail('STORAGE_HEALTH_FILE_NOT_READY', 409);
  }
}

export async function manageLegacyHealthFileAction(context, body) {
  if (!body || (body.operation || body.action) !== 'finalizeHealthFile'
    || Object.keys(body).some(key => !['operation', 'action', 'path'].includes(key))) fail();
  return finalizeLegacyHealthFile(context, body.path);
}
