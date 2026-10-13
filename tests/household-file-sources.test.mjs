import test from 'node:test';
import assert from 'node:assert/strict';
import { FILE_URL_FIELDS, projectFileSources } from '../scripts/lib/household-file-sources.mjs';

const bucket = 'demo-household.firebasestorage.app';
const path = 'healthDocuments/document-test/owner-test/file-test.pdf';
const source = (hasBearerToken = false, name = bucket, objectPath = path) => ({ kind: 'firebase-storage', bucket: name, path: objectPath, hasBearerToken });
const classify = value => projectFileSources('healthRecords', { documentURL: value }).documentURL;

test('the classifier covers only actual application URL fields and never inspects unrelated or nested data', () => {
  assert.deepEqual(FILE_URL_FIELDS, { members: ['photoURL'], familySettings: ['photoURL'], healthRecords: ['documentURL'], quickProducts: ['imageURL'] });
  assert.deepEqual(projectFileSources('unknown', { documentURL: 'https://private.invalid/POISON', fileSources: { documentURL: source() } }), {});
  assert.deepEqual(projectFileSources('members', { password: 'POISON', nested: { photoURL: 'https://private.invalid' } }), {});
  assert.deepEqual(projectFileSources('members', null), {});
});

test('empty references do not fabricate persistent files', () => {
  for (const value of ['', ' ', '\t']) assert.equal(classify(value), undefined);
});

test('Firebase download URLs become a bucket/path DTO without retaining query or fragment values', () => {
  const value = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=POISON_TOKEN#POISON_FRAGMENT`;
  assert.deepEqual(classify(value), source(true));
  assert.equal(JSON.stringify(classify(value)).includes('POISON'), false);
});

test('percent-encoded object names preserve Unicode and spaces without guessing another bucket', () => {
  const objectPath = 'quick-products/uploader-test/123-Zdjęcie produktu.png';
  assert.deepEqual(classify(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}`), source(false, bucket, objectPath));
  const foreign = 'demo-other-household.appspot.com';
  assert.deepEqual(classify(`https://firebasestorage.googleapis.com/v0/b/${foreign}/o/${encodeURIComponent(path)}`), source(false, foreign));
});

test('path-style GCS, virtual-host GCS and gs URLs identify the same object', () => {
  for (const value of [`https://storage.googleapis.com/${bucket}/${path}`, `https://${bucket}.storage.googleapis.com/${path}`, `gs://${bucket}/${path}`]) {
    assert.deepEqual(classify(value), source());
  }
});

test('signed GCS query values are reduced to a boolean and never copied', () => {
  for (const value of [`https://storage.googleapis.com/${bucket}/${path}?X-Goog-Signature=POISON_SIGNATURE&X-Goog-Credential=POISON_CREDENTIAL`,
    `https://${bucket}.storage.googleapis.com/${path}?TOKEN=POISON_TOKEN`, `gs://${bucket}/${path}?token=POISON_TOKEN`]) {
    assert.deepEqual(classify(value), source(true));
    assert.equal(JSON.stringify(classify(value)).includes('POISON'), false);
  }
});

test('only approved HTTPS Google image hosts are classified as Google avatars', () => {
  for (const value of ['https://googleusercontent.com/private-photo?token=POISON', 'https://lh3.googleusercontent.com/photo#POISON']) {
    assert.deepEqual(projectFileSources('members', { photoURL: value }), { photoURL: { kind: 'google-avatar' } });
  }
  for (const value of ['http://lh3.googleusercontent.com/photo', 'https://googleusercontent.com.evil.invalid/photo']) assert.deepEqual(classify(value), { kind: 'external-url' });
});

test('application assets and remote URL references are classified without retaining locations or queries', () => {
  for (const value of ['/start-banner.png?POISON#SECRET', 'images/product.png?POISON', 'public/wojanek-mus.png']) assert.deepEqual(classify(value), { kind: 'app-asset' });
  for (const value of ['https://private.invalid/POISON?secret=TOKEN', 'http://example.invalid/image.png', '//example.invalid/private?POISON']) assert.deepEqual(classify(value), { kind: 'external-url' });
});

test('inline images and local blobs are not treated as verified durable Storage objects', () => {
  assert.deepEqual(classify('data:image/png;base64,POISON_BASE64'), { kind: 'inline-data' });
  assert.deepEqual(classify('blob:https://private.invalid/POISON_BLOB'), { kind: 'ephemeral-blob' });
  assert.equal(JSON.stringify(classify('data:image/png;base64,POISON_BASE64')).includes('POISON'), false);
});

test('malformed fields, credentials, unsupported schemes and unsafe paths fail closed', () => {
  const bad = [null, undefined, 4, {}, [], 'javascript:POISON', 'ftp://private.invalid/file',
    `https://user:POISON@storage.googleapis.com/${bucket}/${path}`, `gs://user:POISON@${bucket}/${path}`,
    `https://storage.googleapis.com:8080/${bucket}/${path}`, `http://storage.googleapis.com/${bucket}/${path}`,
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/health%2F..%2Fprivate.pdf`,
    `https://storage.googleapis.com/${bucket}/health/../private.pdf`, `https://${bucket}.storage.googleapis.com/health/%2e%2e/private.pdf`,
    `gs://${bucket}/health/%00private.pdf`, `gs://${bucket}/health/%5Cprivate.pdf`, `gs://${bucket}/health//private.pdf`,
    `gs://${bucket}/`, `gs://${bucket}/file/`, `gs://INVALID_BUCKET/file.pdf`, '/images/../private.pdf', 'images/%2e%2e/file.pdf',
    `https://storage.googleapis.com/${bucket}/file%ZZ.pdf`, 'https://private.invalid/\nPOISON'];
  for (const value of bad) assert.deepEqual(classify(value), { kind: 'invalid' }, `Unexpected classification of ${typeof value}`);
});

test('valid offline DTOs survive sanitization and are newly allocated', () => {
  for (const value of [source(true), ...['google-avatar', 'app-asset', 'external-url', 'inline-data', 'ephemeral-blob', 'invalid'].map(kind => ({ kind }))]) {
    const projected = projectFileSources('healthRecords', { fileSources: { documentURL: value } });
    assert.deepEqual(projected.documentURL, value);
    assert.notEqual(projected.documentURL, value);
  }
});

test('offline DTOs cannot inject URLs, secrets, wrong types or unsafe paths', () => {
  const bad = [null, [], 'https://private.invalid/POISON', {}, { kind: 'unknown' },
    Object.assign(Object.create({ kind: 'google-avatar' }), { token: 'POISON_TOKEN' }),
    { ...source(), hasBearerToken: 'false' }, { ...source(), path: '../private.pdf' }, { ...source(), bucket: 'INVALID_BUCKET' },
    { ...source(), token: 'POISON_TOKEN' }, { ...source(), url: 'https://private.invalid/POISON' },
    { kind: 'app-asset', url: '/POISON' }, { kind: 'google-avatar', headers: { Authorization: 'POISON_TOKEN' } },
    { kind: 'inline-data', payload: 'POISON_BASE64' }];
  for (const value of bad) {
    const projected = projectFileSources('healthRecords', { fileSources: { documentURL: value } });
    assert.deepEqual(projected, { documentURL: { kind: 'invalid' } });
    assert.equal(JSON.stringify(projected).includes('POISON'), false);
  }
});

test('malformed offline maps fail closed but unknown and nested fields never become sources', () => {
  for (const fileSources of [null, [], 'POISON']) assert.deepEqual(projectFileSources('healthRecords', { fileSources }), { documentURL: { kind: 'invalid' } });
  assert.deepEqual(projectFileSources('members', { fileSources: { imageURL: source(), nested: { photoURL: source() }, token: 'POISON' } }), {});
});

test('raw fields take precedence over offline claims and no secret value is passed through', () => {
  const data = { imageURL: 'https://private.invalid/POISON', fileSources: { imageURL: source(), photoURL: source() },
    headers: { Authorization: 'POISON_TOKEN' }, password: 'POISON_PASSWORD' };
  assert.deepEqual(projectFileSources('quickProducts', data), { imageURL: { kind: 'external-url' } });
  assert.deepEqual(projectFileSources('quickProducts', { ...data, imageURL: '' }), {});
  assert.equal(JSON.stringify(projectFileSources('quickProducts', data)).includes('POISON'), false);
});

test('source classification has no HTTP, Storage, Auth or file read dependencies', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No network requests are permitted'); };
  try {
    assert.deepEqual(classify(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?token=POISON`), source(true));
    assert.deepEqual(classify('https://private.invalid/document.pdf'), { kind: 'external-url' });
  } finally { globalThis.fetch = originalFetch; }
});
