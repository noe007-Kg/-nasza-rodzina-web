import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { backupDigest, canonicalJson, openHouseholdBackup, sealHouseholdBackup } from '../scripts/lib/household-backup-archive.mjs';
import { normalizedFirestoreFields } from '../scripts/lib/household-native-values.mjs';

const key = Buffer.alloc(32, 17);
const file = bytes => ({ name: 'healthDocuments/synthetic/report.pdf', generation: '17000000000000001',
  metageneration: '1', size: String(bytes.length), contentType: 'application/pdf',
  metadata: { privateNote: 'SYNTHETIC_PRIVATE_METADATA', firebaseStorageDownloadTokens: 'SYNTHETIC_BEARER_TOKEN' },
  bytesBase64: bytes.toString('base64'), sha256: backupDigest(bytes) });
const payload = () => ({ schemaVersion: 1, projectId: 'demo-nasza-rodzina', bucket: 'demo-nasza-rodzina.firebasestorage.app',
  documents: [{ name: 'projects/demo-nasza-rodzina/databases/(default)/documents/members/synthetic-parent',
    fields: { integer: { integerValue: '9223372036854775807' }, nan: { doubleValue: 'NaN' },
      positiveInfinity: { doubleValue: 'Infinity' }, negativeInfinity: { doubleValue: '-Infinity' },
      location: { geoPointValue: { latitude: 52.1, longitude: 21.2 } },
      bytes: { bytesValue: 'AAH/' }, time: { timestampValue: '2026-10-14T08:00:00.123456789Z' },
      nested: { mapValue: { fields: { name: { stringValue: 'SYNTHETIC_PRIVATE_NAME' },
        list: { arrayValue: { values: [{ nullValue: null }, { booleanValue: true }] } } } } },
      reference: { referenceValue: 'projects/demo-nasza-rodzina/databases/(default)/documents/tasks/task' } },
    createTime: '2026-10-14T08:00:00.123456789Z', updateTime: '2026-10-14T08:00:01.123456789Z' }],
  objects: [file(Buffer.from('SYNTHETIC_PDF_FILE\u0000\u00ff'))],
  auth: [{ uid: 'synthetic-parent', passwordHash: 'SYNTHETIC_AUTH_HASH', salt: 'SYNTHETIC_AUTH_SALT',
    providerUserInfo: [{ providerId: 'google.com', rawId: 'SYNTHETIC_PROVIDER_ID' }] }],
  externalFiles: [{ id: backupDigest('https://synthetic.invalid/private?token=SYNTHETIC_URL_TOKEN'), status: 'captured',
    bytesBase64: Buffer.from('SYNTHETIC_EXTERNAL_FILE').toString('base64'), size: 23,
    sha256: backupDigest('SYNTHETIC_EXTERNAL_FILE'), contentType: 'image/png' },
  { id: backupDigest('https://blocked.invalid'), status: 'blocked', code: 'EXTERNAL_FETCH_NOT_APPROVED' }],
  missingAncestors: ['projects/demo-nasza-rodzina/databases/(default)/documents/notificationInbox/synthetic-parent'],
  manifest: { count: 1 }, evidence: { fullBackup: false }, rules: { firestore: 'SYNTHETIC_RULES' },
  config: { region: 'europe-west1' }, inventory: { complete: false }, plan: { canApply: false } });
// Fixture plaintext is deliberately synthetic. This helper constructs malformed
// authenticated archives to exercise the parser independently of seal validation.
const authenticatedArchive = plaintext => {
  const iv = randomBytes(12), header = Buffer.concat([Buffer.from('NRHB1'), iv]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), encrypted]);
};
const code = expected => error => error?.code === expected && error.message === expected;

test('native comparisons preserve int64, negative zero and timestamp precision without false protobuf differences', () => {
  const original = payload(); original.documents[0].fields.zero = { doubleValue: -0 };
  assert.equal(Object.is(openHouseholdBackup(sealHouseholdBackup(original, key), key).documents[0].fields.zero.doubleValue, -0), true);
  const a = normalizedFirestoreFields({ n: { nullValue: 'NULL_VALUE' }, i: { integerValue: '0007' },
    t: { timestampValue: '2026-10-14T08:00:00.123Z' }, a: { arrayValue: {} }, m: { mapValue: {} } });
  const b = normalizedFirestoreFields({ n: { nullValue: null }, i: { integerValue: 7 },
    t: { timestampValue: '2026-10-14T08:00:00.123000000Z' }, a: { arrayValue: { values: [] } }, m: { mapValue: { fields: {} } } });
  assert.deepEqual(a, b);
  assert.throws(() => normalizedFirestoreFields({ i: { integerValue: '9223372036854775808' } }));
  assert.notDeepEqual(normalizedFirestoreFields({ t: { timestampValue: '2026-10-14T08:00:00.123456789Z' } }),
    normalizedFirestoreFields({ t: { timestampValue: '2026-10-14T08:00:00.123456788Z' } }));
});

test('encrypted backup round-trips full Firestore native JSON, auth, metadata and exact file bytes', () => {
  const original = payload();
  const bytes = sealHouseholdBackup(original, key);
  assert.equal(bytes.subarray(0, 5).toString(), 'NRHB1');
  assert.deepEqual(openHouseholdBackup(bytes, key), original);
  assert.deepEqual(Buffer.from(openHouseholdBackup(bytes, key).objects[0].bytesBase64, 'base64'),
    Buffer.from(original.objects[0].bytesBase64, 'base64'));
  assert.equal(original.evidence.fullBackup, false, 'archive does not fabricate verification claims');
});

test('ciphertext never contains synthetic credentials, download tokens, private names or file content', () => {
  const sealed = sealHouseholdBackup(payload(), key);
  for (const marker of ['SYNTHETIC_BEARER_TOKEN', 'SYNTHETIC_AUTH_HASH', 'SYNTHETIC_AUTH_SALT',
    'SYNTHETIC_PRIVATE_NAME', 'SYNTHETIC_PRIVATE_METADATA', 'SYNTHETIC_PDF_FILE', 'SYNTHETIC_EXTERNAL_FILE']) {
    assert.equal(sealed.includes(Buffer.from(marker)), false);
  }
});

test('fresh random IV makes repeated encrypted backups different while contents remain identical', () => {
  const original = payload(), first = sealHouseholdBackup(original, key), second = sealHouseholdBackup(original, key);
  assert.notDeepEqual(first, second);
  assert.notDeepEqual(first.subarray(5, 17), second.subarray(5, 17));
  assert.deepEqual(openHouseholdBackup(first, key), openHouseholdBackup(second, key));
});

test('wrong key fails authentication with a static error that contains no private plaintext', () => {
  assert.throws(() => openHouseholdBackup(sealHouseholdBackup(payload(), key), Buffer.alloc(32, 18)), code('BACKUP_AUTHENTICATION_FAILED'));
});

test('tampering with IV, GCM tag or ciphertext is rejected', () => {
  const sealed = sealHouseholdBackup(payload(), key);
  for (const position of [5, 16, 17, 32, 33, sealed.length - 1]) {
    const corrupted = Buffer.from(sealed);
    corrupted[position] ^= 1;
    assert.throws(() => openHouseholdBackup(corrupted, key), code('BACKUP_AUTHENTICATION_FAILED'));
  }
});

test('unknown format, non-buffer and truncated archives are safely rejected', () => {
  const bytes = sealHouseholdBackup(payload(), key);
  const wrongMagic = Buffer.from(bytes); wrongMagic[0] = 0;
  for (const invalid of [undefined, null, bytes.toString('base64'), new Uint8Array(bytes), Buffer.alloc(0),
    Buffer.from('NRHB1'), bytes.subarray(0, 33), wrongMagic]) {
    assert.throws(() => openHouseholdBackup(invalid, key), code('BACKUP_ARCHIVE_INVALID'));
  }
  assert.throws(() => openHouseholdBackup(bytes.subarray(0, bytes.length - 1), key), code('BACKUP_AUTHENTICATION_FAILED'));
});

test('keys must be exactly 32 raw bytes for both encryption and decryption', () => {
  for (const invalid of [null, undefined, key.toString('base64'), Buffer.alloc(31), Buffer.alloc(33), new Uint8Array(32)]) {
    assert.throws(() => sealHouseholdBackup(payload(), invalid), code('BACKUP_KEY_INVALID'));
    assert.throws(() => openHouseholdBackup(Buffer.from('NRHB1'), invalid), code('BACKUP_KEY_INVALID'));
  }
});

test('opening a backup respects the requested plaintext cap', () => {
  const original = payload(), sealed = sealHouseholdBackup(original, key), size = Buffer.byteLength(canonicalJson(original));
  assert.deepEqual(openHouseholdBackup(sealed, key, { maxPlaintextBytes: size }), original);
  assert.throws(() => openHouseholdBackup(sealed, key, { maxPlaintextBytes: size - 1 }), code('BACKUP_SIZE_LIMIT'));
});

test('authenticated gzip decompression bombs are bounded before JSON parsing', () => {
  const compressed = gzipSync(Buffer.alloc(1024 * 1024, 0x61));
  assert.ok(compressed.length < 2048);
  assert.throws(() => openHouseholdBackup(authenticatedArchive(compressed), key, { maxPlaintextBytes: 4096 }), code('BACKUP_SIZE_LIMIT'));
});

test('invalid compression and invalid JSON produce static distinct errors', () => {
  assert.throws(() => openHouseholdBackup(authenticatedArchive(Buffer.from('PRIVATE_INVALID_GZIP')), key), code('BACKUP_COMPRESSION_INVALID'));
  assert.throws(() => openHouseholdBackup(authenticatedArchive(gzipSync(Buffer.from('PRIVATE_INVALID_JSON'))), key), code('BACKUP_JSON_INVALID'));
});

test('invalid limits do not bypass the maximum plaintext size', () => {
  const sealed = sealHouseholdBackup(payload(), key);
  for (const value of [0, -1, 1.5, Infinity, '4096', 256 * 1024 * 1024 + 1]) {
    assert.throws(() => openHouseholdBackup(sealed, key, { maxPlaintextBytes: value }), code('BACKUP_LIMIT_INVALID'));
  }
  for (const options of [null, '4096', []]) assert.throws(() => openHouseholdBackup(sealed, key, options), code('BACKUP_LIMIT_INVALID'));
});

test('payload context and required arrays must be valid on seal and open', () => {
  for (const change of [{ schemaVersion: 2 }, { projectId: 'production?secret=SYNTHETIC' }, { bucket: 'gs://private-bucket' },
    { documents: {} }, { auth: null }, { externalFiles: undefined }, { objects: {} }]) {
    const original = { ...payload(), ...change };
    assert.throws(() => sealHouseholdBackup(original, key), code(change.externalFiles === undefined && Object.hasOwn(change, 'externalFiles')
      ? 'BACKUP_JSON_INVALID' : 'BACKUP_PAYLOAD_INVALID'));
    const json = JSON.stringify(original);
    assert.throws(() => openHouseholdBackup(authenticatedArchive(gzipSync(Buffer.from(json))), key), code('BACKUP_PAYLOAD_INVALID'));
  }
});

test('backup rejects object byte size or digest mismatches', () => {
  for (const change of [{ size: '999' }, { size: -1 }, { size: '01' }, { size: '9007199254740992' },
    { sha256: '0'.repeat(64) }, { sha256: 'PRIVATE_INVALID_HASH' }, { bytesBase64: '%%%PRIVATE' }, { bytesBase64: 'AB==' }]) {
    const original = payload(); original.objects[0] = { ...original.objects[0], ...change };
    assert.throws(() => sealHouseholdBackup(original, key), code('BACKUP_FILE_INVALID'));
    assert.throws(() => openHouseholdBackup(authenticatedArchive(gzipSync(Buffer.from(JSON.stringify(original)))), key), code('BACKUP_FILE_INVALID'));
  }
});

test('external file bytes are required only for captured entries and must match hashes', () => {
  for (const change of [{ status: 'unknown' }, { bytesBase64: '' }, { sha256: '0'.repeat(64) }, { size: 0 }]) {
    const original = payload(); original.externalFiles[0] = { ...original.externalFiles[0], ...change };
    assert.throws(() => sealHouseholdBackup(original, key), code('BACKUP_FILE_INVALID'));
  }
  const original = payload();
  original.externalFiles.push({ id: backupDigest('https://failed.invalid'), status: 'failed', code: 'EXTERNAL_FETCH_FAILED' });
  assert.deepEqual(openHouseholdBackup(sealHouseholdBackup(original, key), key), original);
  original.externalFiles[1].bytesBase64 = '';
  assert.throws(() => sealHouseholdBackup(original, key), code('BACKUP_FILE_INVALID'));
});

test('empty captured files are still valid with an exact zero size and SHA-256', () => {
  const original = payload(); original.objects = [file(Buffer.alloc(0))];
  original.externalFiles = [{ id: backupDigest('https://empty.invalid'), status: 'captured', bytesBase64: '',
    size: 0, sha256: backupDigest(Buffer.alloc(0)), contentType: 'application/pdf' }];
  assert.deepEqual(openHouseholdBackup(sealHouseholdBackup(original, key), key), original);
});

test('canonical JSON sorts nested object keys and retains array order', () => {
  assert.equal(canonicalJson({ z: 1, a: [{ y: 2, b: 3 }, 4], c: null }), '{"a":[{"b":3,"y":2},4],"c":null,"z":1}');
  assert.equal(backupDigest(canonicalJson({ a: 1, b: 2 })), backupDigest(canonicalJson({ b: 2, a: 1 })));
});

test('canonical JSON rejects cycles and values JSON cannot preserve without changing meaning', () => {
  const cyclic = {}; cyclic.next = cyclic;
  for (const value of [cyclic, undefined, NaN, Infinity, 1n, () => {}, new Date(), Buffer.from('x'), [, 1]]) {
    assert.throws(() => canonicalJson(value), code('BACKUP_JSON_INVALID'));
  }
});

test('canonical JSON never calls getters or toJSON methods', () => {
  let invoked = false;
  const getter = Object.defineProperty({}, 'private', { enumerable: true, get() { invoked = true; throw new Error('PRIVATE_ERROR'); } });
  assert.throws(() => canonicalJson(getter), code('BACKUP_JSON_INVALID'));
  assert.equal(invoked, false);
  const toJson = { toJSON() { invoked = true; return { wrong: true }; } };
  assert.throws(() => canonicalJson(toJson), code('BACKUP_JSON_INVALID'));
  assert.equal(invoked, false);
});

test('raw Firestore map fields named __proto__ or constructor survive without prototype pollution', () => {
  const original = payload();
  original.documents[0].fields.special = { mapValue: { fields: JSON.parse('{"__proto__":{"stringValue":"PRIVATE_PROTO"},"constructor":{"stringValue":"PRIVATE_CONSTRUCTOR"}}') } };
  const restored = openHouseholdBackup(sealHouseholdBackup(original, key), key);
  assert.deepEqual(restored, original);
  assert.equal(Object.prototype.PRIVATE_PROTO, undefined);
  assert.equal(Object.hasOwn(restored.documents[0].fields.special.mapValue.fields, '__proto__'), true);
});

test('digest matches SHA-256 for both Buffer and UTF-8 string', () => {
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(backupDigest('abc'), expected);
  assert.equal(backupDigest(Buffer.from('abc')), expected);
  for (const value of [null, 17, {}, new Uint8Array(3)]) assert.throws(() => backupDigest(value), code('BACKUP_DIGEST_INPUT_INVALID'));
});
