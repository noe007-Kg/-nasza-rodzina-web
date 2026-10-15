import { getStorage } from 'firebase-admin/storage';
import { EduServerError } from './edu-auth.mjs';
import { explicitFamilyId } from './family-identity.mjs';

const fail = (code = 'STORAGE_IMAGE_INVALID', status = 400) => { throw new EduServerError(code, status,
  status === 403 ? 'Brak uprawnień do tego zdjęcia.' : 'Nie udało się bezpiecznie zapisać zdjęcia. Spróbuj ponownie.'); };
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
async function actor(context) {
  const profile = (await context.db.collection('members').doc(context.uid).get()).data();
  const familyId = explicitFamilyId(profile);
  if (!familyId || !profile || profile.active !== true || profile.canLogin !== true || profile.archived === true
    || profile.disabled === true || !['parent', 'adult', 'child'].includes(profile.role)
    || context.profile && explicitFamilyId(context.profile) !== familyId) fail('STORAGE_HOUSEHOLD_REQUIRED', 403);
  return familyId;
}
function signature(bytes, type) {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString());
  return type === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}
/** Authenticated paths only. Never mint or return a bearer download URL. */
export async function sanitizePresentationImage(context, path) {
  if (typeof path !== 'string' || path.length > 600 || /[\u0000-\u001f\\]/.test(path)
    || path.split('/').some(part => !part || ['.', '..'].includes(part))) fail();
  const parts = path.split('/');
  const uploader = parts[0] === 'quick-products' && parts.length === 3 ? parts[1]
    : parts[0] === 'avatars' && parts[1] === 'family' && parts.length === 4 ? parts[2]
      : parts[0] === 'avatars' && parts[1] === 'members' && parts.length === 5 ? parts[3] : null;
  if (uploader !== context.uid) fail('STORAGE_IMAGE_FORBIDDEN', 403);
  const familyId = await actor(context);
  const bucket = context.bucket || getStorage(context.app).bucket(context.storageBucket || process.env.FIREBASE_STORAGE_BUCKET);
  try {
    const [metadata] = await bucket.file(path).getMetadata();
    if (Object.hasOwn(metadata.metadata || {}, 'familyId') && explicitFamilyId(metadata.metadata) !== familyId
      || Object.hasOwn(metadata.metadata || {}, 'uploaderUid') && metadata.metadata.uploaderUid !== context.uid) {
      fail('STORAGE_IMAGE_FORBIDDEN', 403);
    }
    if (metadata.name !== path || !imageTypes.has(metadata.contentType) || !Number.isSafeInteger(Number(metadata.size))
      || Number(metadata.size) <= 0 || Number(metadata.size) > 5 * 1024 * 1024
      || !/^\d+$/.test(String(metadata.generation)) || !/^\d+$/.test(String(metadata.metageneration))) fail();
    const generation = String(metadata.generation), metageneration = String(metadata.metageneration);
    const pinned = bucket.file(path, { generation });
    const [bytes] = await pinned.download({ validation: 'crc32c', decompress: false });
    if (!Buffer.isBuffer(bytes) || bytes.length !== Number(metadata.size) || !signature(bytes, metadata.contentType)) fail();
    if (await actor(context) !== familyId) fail('STORAGE_HOUSEHOLD_REQUIRED', 403);
    // Generation and metageneration bind sanitization to precisely the verified
    // upload. SDK uploads may automatically have a bearer token: revoke it
    // before publishing the protected path, preserving other custom metadata.
    await pinned.setMetadata({ cacheControl: 'private, no-store', metadata: {
      ...(metadata.metadata || {}), familyId, uploaderUid: context.uid, firebaseStorageDownloadTokens: null,
    } }, { ifGenerationMatch: generation, ifMetagenerationMatch: metageneration });
    const [confirmed] = await bucket.file(path).getMetadata();
    if (String(confirmed.generation) !== generation || confirmed.metadata?.familyId !== familyId
      || confirmed.metadata?.uploaderUid !== context.uid || confirmed.metadata?.firebaseStorageDownloadTokens
      || await actor(context) !== familyId) fail('STORAGE_IMAGE_NOT_READY', 409);
    return { path, familyId };
  } catch (error) {
    if (error instanceof EduServerError) throw error;
    fail('STORAGE_IMAGE_NOT_READY', 409);
  }
}
export async function managePresentationImageAction(context, body) {
  if (!body || !['finalizeProductImage'].includes(body.operation || body.action)
    || Object.keys(body).some(key => !['operation', 'action', 'path'].includes(key))
    || typeof body.path !== 'string' || !body.path.startsWith(`quick-products/${context.uid}/`)) fail();
  return sanitizePresentationImage(context, body.path);
}
