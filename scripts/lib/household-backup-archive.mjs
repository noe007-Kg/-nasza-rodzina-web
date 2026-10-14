import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

// This module has no filesystem, Firebase, environment or network access. The
// caller supplies a dedicated backup key; the eduVULCAN session key is unrelated.
const MAGIC = Buffer.from('NRHB1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES + TAG_BYTES;
const MAX_PLAINTEXT_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = MAX_PLAINTEXT_BYTES + HEADER_BYTES;
const plainObject = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail('BACKUP_KEY_INVALID');
}

/** Stable JSON without invoking toJSON methods or prototype setters. */
export function canonicalJson(value) {
  const ancestors = new Set();
  const serialize = (item, depth) => {
    if (depth > 128) fail('BACKUP_JSON_INVALID');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('BACKUP_JSON_INVALID');
      return Object.is(item, -0) ? '-0' : JSON.stringify(item);
    }
    if (!Array.isArray(item) && !plainObject(item) || ancestors.has(item)) fail('BACKUP_JSON_INVALID');
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) {
      const values = [];
      for (let index = 0; index < item.length; index += 1) {
        if (!Object.hasOwn(item, index)) fail('BACKUP_JSON_INVALID');
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('BACKUP_JSON_INVALID');
        values.push(serialize(descriptor.value, depth + 1));
      }
      result = `[${values.join(',')}]`;
    } else {
      const entries = [];
      for (const key of Object.keys(item).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('BACKUP_JSON_INVALID');
        entries.push(`${JSON.stringify(key)}:${serialize(descriptor.value, depth + 1)}`);
      }
      result = `{${entries.join(',')}}`;
    }
    ancestors.delete(item);
    return result;
  };
  return serialize(value, 0);
}

export function backupDigest(bytes) {
  if (!Buffer.isBuffer(bytes) && typeof bytes !== 'string') fail('BACKUP_DIGEST_INPUT_INVALID');
  return createHash('sha256').update(bytes).digest('hex');
}

function verifyCapturedBytes(item) {
  if (typeof item.bytesBase64 !== 'string' || item.bytesBase64.length > Math.ceil(MAX_PLAINTEXT_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.bytesBase64)
    || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) fail('BACKUP_FILE_INVALID');
  const size = typeof item.size === 'number' && Number.isSafeInteger(item.size) && item.size >= 0
    ? item.size : typeof item.size === 'string' && /^(?:0|[1-9]\d*)$/.test(item.size) ? Number(item.size) : NaN;
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_PLAINTEXT_BYTES) fail('BACKUP_FILE_INVALID');
  const bytes = Buffer.from(item.bytesBase64, 'base64');
  if (bytes.length !== size || bytes.toString('base64') !== item.bytesBase64
    || !timingSafeEqual(Buffer.from(backupDigest(bytes), 'hex'), Buffer.from(item.sha256, 'hex'))) fail('BACKUP_FILE_INVALID');
}

function validatePayload(payload) {
  if (!plainObject(payload) || payload.schemaVersion !== 1
    || typeof payload.projectId !== 'string' || !/^[a-z][a-z0-9-]{3,61}[a-z0-9]$/.test(payload.projectId)
    || typeof payload.bucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,221}[a-z0-9]$/.test(payload.bucket)
    || ['documents', 'objects', 'auth', 'externalFiles'].some(key => !Array.isArray(payload[key]))) fail('BACKUP_PAYLOAD_INVALID');
  for (const item of payload.objects) {
    if (!plainObject(item) || typeof item.name !== 'string' || !item.name.length
      || Buffer.byteLength(item.name, 'utf8') > 1024 || /[\u0000-\u001f]/.test(item.name)) fail('BACKUP_FILE_INVALID');
    verifyCapturedBytes(item);
  }
  for (const item of payload.externalFiles) {
    if (!plainObject(item) || !['captured', 'blocked', 'failed'].includes(item.status)) fail('BACKUP_FILE_INVALID');
    if (item.status === 'captured') verifyCapturedBytes(item);
    else if (Object.hasOwn(item, 'bytesBase64')) fail('BACKUP_FILE_INVALID');
  }
}

/** NRHB1 | random 12-byte IV | 16-byte GCM tag | encrypted gzip JSON. */
export function sealHouseholdBackup(payload, key) {
  assertKey(key);
  // Canonicalization first rejects getters/unsupported JS values; validation
  // subsequently operates on data with no executable accessors or prototypes.
  const json = canonicalJson(payload);
  if (Buffer.byteLength(json, 'utf8') > MAX_PLAINTEXT_BYTES) fail('BACKUP_SIZE_LIMIT');
  validatePayload(JSON.parse(json));
  const compressed = gzipSync(Buffer.from(json, 'utf8'));
  if (compressed.length + HEADER_BYTES > MAX_ARCHIVE_BYTES) fail('BACKUP_SIZE_LIMIT');
  const iv = randomBytes(IV_BYTES);
  const aad = Buffer.concat([MAGIC, iv]);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.concat([aad, cipher.getAuthTag(), encrypted]);
}

export function openHouseholdBackup(bytes, key, options = {}) {
  assertKey(key);
  if (!plainObject(options)) fail('BACKUP_LIMIT_INVALID');
  const maxPlaintextBytes = options.maxPlaintextBytes ?? MAX_PLAINTEXT_BYTES;
  if (!Number.isSafeInteger(maxPlaintextBytes) || maxPlaintextBytes < 1
    || maxPlaintextBytes > MAX_PLAINTEXT_BYTES) fail('BACKUP_LIMIT_INVALID');
  if (!Buffer.isBuffer(bytes) || bytes.length <= HEADER_BYTES || bytes.length > MAX_ARCHIVE_BYTES) fail('BACKUP_ARCHIVE_INVALID');
  if (!timingSafeEqual(bytes.subarray(0, MAGIC.length), MAGIC)) fail('BACKUP_ARCHIVE_INVALID');
  const aad = bytes.subarray(0, MAGIC.length + IV_BYTES);
  const iv = bytes.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = bytes.subarray(MAGIC.length + IV_BYTES, HEADER_BYTES);
  let compressed;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    compressed = Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES)), decipher.final()]);
  } catch { fail('BACKUP_AUTHENTICATION_FAILED'); }
  let plaintext;
  try { plaintext = gunzipSync(compressed, { maxOutputLength: maxPlaintextBytes }); }
  catch (error) { fail(error?.code === 'ERR_BUFFER_TOO_LARGE' ? 'BACKUP_SIZE_LIMIT' : 'BACKUP_COMPRESSION_INVALID'); }
  if (plaintext.length > maxPlaintextBytes) fail('BACKUP_SIZE_LIMIT');
  let payload;
  try { payload = JSON.parse(plaintext.toString('utf8')); }
  catch { fail('BACKUP_JSON_INVALID'); }
  validatePayload(payload);
  // Validation is read-only. JSON.parse creates own __proto__ fields and never
  // invokes setters; raw Firestore map fields with that name remain intact.
  canonicalJson(payload);
  return payload;
}
