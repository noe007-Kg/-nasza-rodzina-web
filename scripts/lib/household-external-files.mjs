/** Read-only capture of known file references. Raw URLs and bytes belong only in an encrypted backup. */
import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { FILE_URL_FIELDS, projectFileSources } from './household-file-sources.mjs';

const MAX_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = (id, code, status = 'blocked') => ({ id, status, code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Firestore REST/native JSON documents, not metadata-only dry-run projections. No recursive URL discovery. */
export function collectExternalReferences(documents) {
  const references = [];
  for (const document of documents || []) {
    if (!plain(document) || typeof document.name !== 'string' || !plain(document.fields)) continue;
    const path = document.name.split('/documents/')[1] || document.name;
    const segments = path.split('/');
    if (segments.length !== 2) continue;
    const collection = segments[0];
    for (const field of FILE_URL_FIELDS[collection] || []) {
      const native = document.fields[field];
      if (!plain(native) || typeof native.stringValue !== 'string' || !native.stringValue.trim()) continue;
      const url = native.stringValue;
      const source = projectFileSources(collection, { [field]: url })[field];
      if (!source) continue;
      references.push({ id: hash(url), url, kind: source.kind, recordName: document.name, field });
    }
  }
  return references;
}

function ipv4Number(address) {
  return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
}
const V4_DENY = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4']
  .map(range => { const [address, prefix] = range.split('/'); return [ipv4Number(address), 2 ** (32 - Number(prefix))]; });

function ipv6Number(address) {
  // An IPv4-mapped answer is deliberately rejected, even when its mapped address is public.
  if (address.includes('.') || address.includes('%')) return null;
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const zeros = halves.length === 2 ? 8 - left.length - right.length : 0;
  const pieces = [...left, ...Array(Math.max(0, zeros)).fill('0'), ...right];
  if (pieces.length !== 8 || pieces.some(piece => !/^[a-f0-9]{1,4}$/i.test(piece))) return null;
  return pieces.reduce((value, piece) => value * 65536n + BigInt(`0x${piece}`), 0n);
}

function publicAddress(address) {
  if (typeof address !== 'string') return false;
  if (isIP(address) === 4) {
    const value = ipv4Number(address);
    return !V4_DENY.some(([base, size]) => Math.floor(value / size) === Math.floor(base / size));
  }
  if (isIP(address) !== 6) return false;
  const value = ipv6Number(address);
  // Conservatively accept ordinary global unicast only; exclude special-use/tunnel/documentation blocks.
  if (value === null || value >> 125n !== 1n) return false; // 2000::/3
  return ![
    [ipv6Number('2001::'), 23n], [ipv6Number('2001:db8::'), 32n],
    [ipv6Number('2002::'), 16n], [ipv6Number('3ffe::'), 16n], [ipv6Number('3fff::'), 20n],
  ].some(([base, prefix]) => value >> (128n - prefix) === base >> (128n - prefix));
}

function allowedUrl(raw, allowedDomains) {
  if (typeof raw !== 'string' || raw !== raw.trim() || raw.length > 16_384 || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || isIP(url.hostname.replace(/^\[|\]$/g, '')) || url.hostname.endsWith('.')) return null;
  const host = url.hostname.toLowerCase();
  const google = host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
  if (!google && !allowedDomains.has(host)) return null;
  url.hash = '';
  return url;
}

function pinnedLookup(answers) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    const family = typeof options === 'number' ? options : options?.family;
    const candidates = family ? answers.filter(answer => answer.family === family) : answers;
    if (!candidates.length) return callback(Object.assign(new Error('No permitted address'), { code: 'ENOTFOUND' }));
    if (options?.all) return callback(null, candidates.map(answer => ({ ...answer })));
    return callback(null, candidates[0].address, candidates[0].family);
  };
}

function defaultRequest(url, { lookup, signal, timeoutMs }) {
  // Do not silently bypass a session's required proxy. A CONNECT transport
  // must preserve DNS pinning; an unsupported proxy is an unverified source.
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
    throw Object.assign(new Error('EXTERNAL_PROXY_TRANSPORT_NOT_SUPPORTED'), { code: 'EXTERNAL_PROXY_TRANSPORT_NOT_SUPPORTED' });
  }
  return new Promise((resolve, reject) => {
    // No agent: never reuse a connection from another DNS validation. No cookies or authorization.
    const request = httpsRequest(url, { method: 'GET', agent: false, lookup, signal,
      servername: url.hostname, headers: { Accept: 'image/jpeg,image/png,image/webp,image/gif,application/pdf', 'Accept-Encoding': 'identity' } }, resolve);
    request.on('error', reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Request timed out')));
    request.end();
  });
}

function matchesContent(bytes, type) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (type === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return type === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
}

function captured(id, bytes, contentType) {
  return { id, status: 'captured', bytesBase64: bytes.toString('base64'), size: bytes.length, sha256: hash(bytes), contentType };
}

function inlineCapture(reference, maxBytes) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/]*={0,2})$/i.exec(reference.url);
  if (!match || !MIME_TYPES.has(match[1].toLowerCase())) return failure(reference.id, 'EXTERNAL_INLINE_FORMAT_UNSUPPORTED');
  if (match[2].length > Math.ceil(maxBytes / 3) * 4) return failure(reference.id, 'EXTERNAL_FILE_TOO_LARGE');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[2] || bytes.length > maxBytes) return failure(reference.id, 'EXTERNAL_INLINE_DATA_INVALID');
  const type = match[1].toLowerCase();
  return matchesContent(bytes, type) ? captured(reference.id, bytes, type) : failure(reference.id, 'EXTERNAL_FILE_SIGNATURE_INVALID');
}

async function captureUrl(reference, options) {
  const { allowedDomains, maxBytes, timeoutMs, resolve, request } = options;
  const controller = new AbortController();
  let response;
  let timedOut = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); response?.destroy?.(); reject(new Error('Deadline exceeded')); }, timeoutMs);
  });
  const work = async () => {
    let raw = reference.url;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const url = allowedUrl(raw, allowedDomains);
      if (!url) return failure(reference.id, 'EXTERNAL_URL_NOT_ALLOWED');
      const answers = await resolve(url.hostname, { all: true, verbatim: true });
      if (controller.signal.aborted) throw new Error('Deadline exceeded');
      if (!Array.isArray(answers) || !answers.length || answers.some(answer => !plain(answer)
        || !publicAddress(answer.address) || answer.family !== isIP(answer.address))) return failure(reference.id, 'EXTERNAL_DNS_NOT_PUBLIC');
      response = await request(url, { lookup: pinnedLookup(answers), signal: controller.signal, timeoutMs });
      if (controller.signal.aborted) { response?.destroy?.(); throw new Error('Deadline exceeded'); }
      const status = response?.statusCode;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers?.location;
        response.destroy?.();
        if (redirects === 3 || typeof location !== 'string') return failure(reference.id, 'EXTERNAL_REDIRECT_NOT_ALLOWED');
        try { raw = new URL(location, url).href; } catch { return failure(reference.id, 'EXTERNAL_REDIRECT_NOT_ALLOWED'); }
        continue;
      }
      if (status !== 200) { response?.destroy?.(); return failure(reference.id, 'EXTERNAL_HTTP_READ_FAILED', 'failed'); }
      const type = typeof response.headers?.['content-type'] === 'string' ? response.headers['content-type'].split(';')[0].trim().toLowerCase() : '';
      if (!MIME_TYPES.has(type)) { response.destroy?.(); return failure(reference.id, 'EXTERNAL_FILE_TYPE_NOT_ALLOWED'); }
      if (response.headers?.['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy?.(); return failure(reference.id, 'EXTERNAL_ENCODING_NOT_ALLOWED'); }
      const length = response.headers?.['content-length'];
      if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)) {
        response.destroy?.(); return failure(reference.id, 'EXTERNAL_FILE_TOO_LARGE');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response) {
        if (controller.signal.aborted) throw new Error('Deadline exceeded');
        if (!(chunk instanceof Uint8Array)) { response.destroy?.(); return failure(reference.id, 'EXTERNAL_RESPONSE_INVALID', 'failed'); }
        size += chunk.length;
        if (size > maxBytes) { response.destroy?.(); return failure(reference.id, 'EXTERNAL_FILE_TOO_LARGE'); }
        chunks.push(Buffer.from(chunk));
      }
      if (length !== undefined && size !== Number(length)) return failure(reference.id, 'EXTERNAL_RESPONSE_INCOMPLETE', 'failed');
      const bytes = Buffer.concat(chunks, size);
      return matchesContent(bytes, type) ? captured(reference.id, bytes, type) : failure(reference.id, 'EXTERNAL_FILE_SIGNATURE_INVALID');
    }
    return failure(reference.id, 'EXTERNAL_REDIRECT_NOT_ALLOWED');
  };
  try { return await Promise.race([work(), timeout]); }
  catch (error) { response?.destroy?.(); return failure(reference.id, timedOut ? 'EXTERNAL_READ_TIMEOUT'
    : error?.code === 'EXTERNAL_PROXY_TRANSPORT_NOT_SUPPORTED' ? error.code : 'EXTERNAL_READ_FAILED', 'failed'); }
  finally { clearTimeout(timer); }
}

/** No Storage writes, HTTP writes, credential forwarding, hidden fallback or raw error output. */
export async function captureExternalFiles(references, { allowedDomains = [], maxBytes = MAX_BYTES,
  timeoutMs = 15_000, resolve = dnsLookup, request = defaultRequest } = {}) {
  if (!Array.isArray(allowedDomains) || allowedDomains.some(domain => typeof domain !== 'string'
    || domain !== domain.toLowerCase() || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes('..')
    || isIP(domain)) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000
    || typeof resolve !== 'function' || typeof request !== 'function') throw new Error('Invalid external capture configuration');
  const options = { allowedDomains: new Set(allowedDomains), maxBytes, timeoutMs, resolve, request };
  const results = [];
  const seen = new Set();
  for (const reference of references || []) {
    if (!plain(reference) || typeof reference.url !== 'string' || reference.id !== hash(reference.url)) {
      results.push(failure(typeof reference?.id === 'string' && /^[a-f0-9]{64}$/.test(reference.id) ? reference.id : 'invalid-reference', 'EXTERNAL_REFERENCE_INVALID'));
      continue;
    }
    if (seen.has(reference.id)) continue;
    seen.add(reference.id);
    if (reference.kind === 'inline-data') results.push(inlineCapture(reference, maxBytes));
    else if (reference.kind === 'ephemeral-blob') results.push(failure(reference.id, 'EXTERNAL_BLOB_NOT_DURABLE'));
    else if (reference.kind === 'firebase-storage') results.push(failure(reference.id, 'EXTERNAL_STORAGE_ADMIN_CAPTURE_REQUIRED'));
    else if (reference.kind === 'app-asset') results.push(failure(reference.id, 'EXTERNAL_APP_ASSET_LOCAL_CAPTURE_REQUIRED'));
    else if (['google-avatar', 'external-url'].includes(reference.kind)) results.push(await captureUrl(reference, options));
    else results.push(failure(reference.id, 'EXTERNAL_REFERENCE_INVALID'));
  }
  return results;
}
