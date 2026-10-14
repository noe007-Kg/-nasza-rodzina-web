import { backupDigest, canonicalJson } from './household-backup-archive.mjs';
import { controlFailure as fail } from './household-private-files.mjs';

const safeName = name => typeof name === 'string' && name.length && Buffer.byteLength(name) <= 1024 && !/[\u0000-\u001f]/.test(name);
const version = value => typeof value === 'string' && /^\d+$/.test(value);
const fields = 'items(name,generation,metageneration,size,contentType,metadata,cacheControl,contentDisposition,contentEncoding,crc32c),nextPageToken';
async function listCurrentObjects(bucket, maximum) {
  const rows = [], names = new Set(), tokens = new Set();
  let pageToken;
  do {
    const [page, next] = await bucket.getFiles({ autoPaginate: false, maxResults: 100, fields, ...(pageToken ? { pageToken } : {}) });
    for (const file of page) {
      const item = Object.hasOwn(file, 'generation') ? file : { ...file.metadata, name: file.name };
      if (!safeName(item.name) || names.has(item.name) || !version(String(item.generation || '')) || !version(String(item.metageneration || ''))) fail('STORAGE_BACKUP_METADATA_INVALID');
      if (rows.length >= maximum) fail('STORAGE_BACKUP_OBJECT_LIMIT');
      rows.push({ ...item, generation: String(item.generation), metageneration: String(item.metageneration) }); names.add(item.name);
    }
    pageToken = next?.pageToken;
    if (pageToken && tokens.has(pageToken)) fail('STORAGE_BACKUP_PAGINATION_INVALID');
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
export async function collectStorageBackup(bucket, { maximum = 10000, maxBytes = 128 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 128 * 1024 * 1024) fail('STORAGE_BACKUP_LIMIT_INVALID');
  const metadata = await listCurrentObjects(bucket, maximum), objects = [];
  let totalBytes = 0, privateTokenCount = 0, productTokenCount = 0;
  for (const item of metadata) {
    const size = Number(item.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024 || totalBytes + size > maxBytes) fail('STORAGE_BACKUP_BYTE_LIMIT');
    const pinned = bucket.file(item.name, { generation: item.generation });
    const [current] = await pinned.getMetadata();
    if (current.name !== item.name || Number(current.size) !== size || String(current.generation) !== item.generation || String(current.metageneration) !== item.metageneration) fail('STORAGE_CHANGED_DURING_BACKUP');
    const [bytes] = await pinned.download({ validation: 'crc32c', decompress: false });
    if (!Buffer.isBuffer(bytes) || bytes.length !== size) fail('STORAGE_BACKUP_SIZE_MISMATCH');
    totalBytes += bytes.length;
    const properties = Object.fromEntries(['cacheControl', 'contentDisposition', 'contentEncoding'].filter(key => typeof current[key] === 'string').map(key => [key, current[key]]));
    objects.push({ name: item.name, generation: item.generation, metageneration: item.metageneration, size,
      contentType: current.contentType || 'application/octet-stream', metadata: current.metadata || {}, ...properties,
      bytesBase64: bytes.toString('base64'), sha256: backupDigest(bytes) });
    if (typeof current.metadata?.firebaseStorageDownloadTokens === 'string' && current.metadata.firebaseStorageDownloadTokens.trim()) {
      if (/^(taskProof|taskRewardImages|healthDocuments|health|avatars)\//.test(item.name)) privateTokenCount++;
      else if (item.name.startsWith('quick-products/')) productTokenCount++;
      else privateTokenCount++; // Unclassified objects do not count as safely public.
    }
  }
  return { objects, complete: true, totalBytes, privateTokenCount, productTokenCount, capturedAt: new Date().toISOString() };
}
export async function recheckStorageBackup(bucket, objects, { maximum = 10000 } = {}) {
  const after = await listCurrentObjects(bucket, maximum);
  const versions = rows => rows.map(({ name, generation, metageneration }) => ({ name, generation: String(generation), metageneration: String(metageneration) })).sort((a, b) => a.name.localeCompare(b.name));
  return { stable: canonicalJson(versions(after)) === canonicalJson(versions(objects)), checkedAt: new Date().toISOString(), complete: true };
}
