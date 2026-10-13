/** Classify file references without fetching them or retaining URLs, credentials or file contents. */
export const FILE_URL_FIELDS = Object.freeze({
  members: Object.freeze(['photoURL']),
  familySettings: Object.freeze(['photoURL']),
  healthRecords: Object.freeze(['documentURL']),
  quickProducts: Object.freeze(['imageURL']),
});

const simpleKinds = new Set(['google-avatar', 'app-asset', 'external-url', 'inline-data', 'ephemeral-blob', 'invalid']);
const control = /[\u0000-\u001f\u007f]/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => ({ kind: 'invalid' });
const validBucket = value => typeof value === 'string' && value.length >= 3 && value.length <= 222
  && /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(value)
  && !value.includes('..') && !/^\d+\.\d+\.\d+\.\d+$/.test(value);
const validPath = value => typeof value === 'string' && value.length > 0 && value.length <= 1024
  && !control.test(value) && !value.includes('\\') && !value.startsWith('/') && !value.endsWith('/')
  && value.split('/').every(part => part && part !== '.' && part !== '..');

function firebaseSource(bucket, path, hasBearerToken) {
  return validBucket(bucket) && validPath(path) && typeof hasBearerToken === 'boolean'
    ? { kind: 'firebase-storage', bucket, path, hasBearerToken } : invalid();
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return null; }
}

function sanitizeSource(value) {
  if (!record(value) || !Object.hasOwn(value, 'kind') || typeof value.kind !== 'string') return invalid();
  const keys = Object.keys(value);
  if (value.kind === 'firebase-storage') {
    if (keys.length !== 4 || keys.some(key => !['kind', 'bucket', 'path', 'hasBearerToken'].includes(key))) return invalid();
    return firebaseSource(value.bucket, value.path, value.hasBearerToken);
  }
  return keys.length === 1 && keys[0] === 'kind' && simpleKinds.has(value.kind) ? { kind: value.kind } : invalid();
}

function classify(value) {
  if (typeof value !== 'string') return invalid();
  if (!value.trim()) return null;
  if (value !== value.trim() || value.length > 1_048_576 || control.test(value) || value.includes('\\')) return invalid();
  if (/^data:/i.test(value)) return { kind: 'inline-data' };
  if (/^blob:/i.test(value)) return { kind: 'ephemeral-blob' };

  // Inspect the original path before URL normalizes away dot segments.
  const original = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(value);
  if (!original) {
    // A protocol-relative URL names a remote host, not an application asset.
    if (value.startsWith('//')) return classify(`https:${value}`);
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return invalid();
    const path = decode(value.split(/[?#]/, 1)[0]);
    return path !== null && validPath(path.startsWith('/') ? path.slice(1) : path)
      ? { kind: 'app-asset' } : invalid();
  }
  const scheme = original[1].toLowerCase();
  let url;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.username || url.password || original[2].includes('@') || url.port && url.port !== '443') return invalid();
  if (!['https', 'http', 'gs'].includes(scheme)) return invalid();
  const encodedPath = original[3];
  const hasBearerToken = [...url.searchParams.keys()].some(key => ['token', 'x-goog-signature'].includes(key.toLowerCase()));

  if (scheme === 'gs') {
    if (url.port || !encodedPath.startsWith('/')) return invalid();
    return firebaseSource(url.hostname, decode(encodedPath.slice(1)), hasBearerToken);
  }
  if (url.hostname === 'firebasestorage.googleapis.com') {
    const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(encodedPath);
    return scheme === 'https' && match ? firebaseSource(decode(match[1]), decode(match[2]), hasBearerToken) : invalid();
  }
  if (url.hostname === 'storage.googleapis.com') {
    const match = /^\/([^/]+)\/(.+)$/.exec(encodedPath);
    return scheme === 'https' && match ? firebaseSource(decode(match[1]), decode(match[2]), hasBearerToken) : invalid();
  }
  if (url.hostname.endsWith('.storage.googleapis.com')) {
    return scheme === 'https' && encodedPath.startsWith('/')
      ? firebaseSource(url.hostname.slice(0, -'.storage.googleapis.com'.length), decode(encodedPath.slice(1)), hasBearerToken) : invalid();
  }
  if (scheme === 'https' && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))) {
    return { kind: 'google-avatar' };
  }
  return { kind: 'external-url' };
}

/** Known URL fields only; offline references are validated rather than trusted. */
export function projectFileSources(collection, data) {
  const result = {};
  if (!record(data)) return result;
  for (const field of FILE_URL_FIELDS[collection] || []) {
    if (Object.hasOwn(data, field)) {
      const source = classify(data[field]);
      if (source) result[field] = source;
    } else if (Object.hasOwn(data, 'fileSources')) {
      if (!record(data.fileSources)) result[field] = invalid();
      else if (Object.hasOwn(data.fileSources, field)) result[field] = sanitizeSource(data.fileSources[field]);
    }
  }
  return result;
}
