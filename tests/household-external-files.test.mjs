import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { backupDigest } from '../scripts/lib/household-backup-archive.mjs';
import { captureExternalFiles, collectExternalReferences } from '../scripts/lib/household-external-files.mjs';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const ref = (url, kind = 'external-url') => ({ url, kind, id: backupDigest(url) });
const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
const response = (bytes = png, headers = {}, statusCode = 200) => Object.assign(Readable.from([bytes]), { statusCode, headers: { 'content-type': 'image/png', ...headers } });
test('native references select only actual URL fields, keeping raw URLs out of public evidence', () => {
  const rows = collectExternalReferences([{ name: 'projects/demo-test/databases/(default)/documents/members/a', fields: {
    photoURL: { stringValue: 'https://lh3.googleusercontent.com/photo?token=POISON' }, password: { stringValue: 'POISON' } } }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, 'google-avatar');
});
test('approved file captures exact bytes/hash while URL secrets and fragments never enter result', async () => {
  const url = 'https://lh3.googleusercontent.com/photo?token=POISON#POISON';
  const result = await captureExternalFiles([ref(url)], { resolve, request: async (url, options) => {
    assert.equal(url.hash, '');
    await new Promise((accept, reject) => options.lookup(url.hostname, { all: true }, (error, values) => error ? reject(error) : (assert.deepEqual(values, [{ address: '93.184.216.34', family: 4 }]), accept())));
    return response();
  } });
  assert.equal(result[0].status, 'captured'); assert.equal(result[0].sha256, backupDigest(png));
  assert.equal(JSON.stringify(result).includes('POISON'), false);
});
test('unapproved hosts, credentials, ports and private DNS never cause an HTTP request', async () => {
  let calls = 0;
  const request = async () => { calls++; return response(); };
  for (const url of ['http://lh3.googleusercontent.com/image.png', 'https://unknown.invalid/image.png',
    'https://user:POISON@lh3.googleusercontent.com/image.png', 'https://lh3.googleusercontent.com:8443/image.png', 'https://127.0.0.1/image.png']) {
    assert.equal((await captureExternalFiles([ref(url)], { resolve, request }))[0].status, 'blocked');
  }
  for (const address of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '100.64.0.1', '192.168.1.1', '::1', 'fc00::1', '2001:db8::1']) {
    assert.equal((await captureExternalFiles([ref('https://lh3.googleusercontent.com/photo')], {
      resolve: async () => [{ address, family: address.includes(':') ? 6 : 4 }], request }))[0].code, 'EXTERNAL_DNS_NOT_PUBLIC');
  }
  assert.equal(calls, 0);
});
test('redirects are rechecked and cannot reach an internal or unapproved host', async () => {
  let calls = 0;
  const result = await captureExternalFiles([ref('https://lh3.googleusercontent.com/photo')], { resolve, request: async () => {
    calls++; return response(Buffer.alloc(0), { location: 'https://169.254.169.254/latest/meta-data' }, 302);
  } });
  assert.equal(calls, 1); assert.equal(result[0].status, 'blocked');
});
test('size, MIME, file signature, truncation and compression failures stay unverified', async () => {
  for (const [bytes, headers, code] of [[Buffer.alloc(30), {}, 'EXTERNAL_FILE_TOO_LARGE'],
    [png, { 'content-type': 'text/html' }, 'EXTERNAL_FILE_TYPE_NOT_ALLOWED'],
    [Buffer.from('HTML'), {}, 'EXTERNAL_FILE_SIGNATURE_INVALID'],
    [png, { 'content-length': '20' }, 'EXTERNAL_RESPONSE_INCOMPLETE'],
    [png, { 'content-encoding': 'gzip' }, 'EXTERNAL_ENCODING_NOT_ALLOWED']]) {
    const result = await captureExternalFiles([ref('https://lh3.googleusercontent.com/photo')], { maxBytes: 25, resolve, request: async () => response(bytes, headers) });
    assert.equal(result[0].code, code);
  }
});
test('timeout and HTTP authentication failure do not expose tokens or attempt a bypass', async () => {
  const timeout = await captureExternalFiles([ref('https://lh3.googleusercontent.com/POISON')], {
    timeoutMs: 5, resolve, request: () => new Promise(() => {}) });
  assert.equal(timeout[0].code, 'EXTERNAL_READ_TIMEOUT');
  const denied = await captureExternalFiles([ref('https://lh3.googleusercontent.com/POISON')], { resolve, request: async () => response(png, {}, 403) });
  assert.equal(denied[0].status, 'failed'); assert.equal(JSON.stringify(denied).includes('POISON'), false);
});
test('inline images can be backed up, blobs cannot, and repeated URLs are downloaded once', async () => {
  const inline = await captureExternalFiles([ref(`data:image/png;base64,${png.toString('base64')}`, 'inline-data'), ref('blob:https://example.invalid/id', 'ephemeral-blob')]);
  assert.equal(inline[0].status, 'captured'); assert.equal(inline[1].status, 'blocked');
  let calls = 0; const r = ref('https://lh3.googleusercontent.com/image');
  await captureExternalFiles([r, r], { resolve, request: async () => { calls++; return response(); } });
  assert.equal(calls, 1);
});
