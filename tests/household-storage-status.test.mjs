import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_PREFIXES,
  householdStorageCheck,
  sanitizeStorageCheck,
  storagePrefixVerified,
  storageReadFailure,
} from '../scripts/lib/household-storage-status.mjs';

const verified = () => ({ verified: true, status: 'verified', code: null, httpStatus: null });
const invalid = () => ({ verified: false, status: 'failed', code: 'STORAGE_COVERAGE_INVALID', httpStatus: null });
const fullCoverage = () => ({ complete: true, missingCollections: [], storagePrefixes: [...STORAGE_PREFIXES] });

test('Storage 404 from numeric/string error codes and response status means unavailable bucket, never verified empty storage', () => {
  for (const error of [{ code: 404 }, { code: '404' }, { statusCode: 404 }, { status: '404' }, { response: { status: 404 } }]) {
    assert.deepEqual(storageReadFailure(error), {
      verified: false, status: 'not-found', code: 'STORAGE_BUCKET_NOT_FOUND', httpStatus: 404,
    });
  }
});

test('Storage 403 from numeric/string error codes and response status means denied inspection', () => {
  for (const error of [{ code: 403 }, { code: '403' }, { statusCode: '403' }, { status: 403 }, { response: { status: '403' } }]) {
    assert.deepEqual(storageReadFailure(error), {
      verified: false, status: 'forbidden', code: 'STORAGE_ACCESS_DENIED', httpStatus: 403,
    });
  }
});

test('other valid HTTP failures remain failed and retain only a safe numeric HTTP status', () => {
  for (const status of [400, 401, 429, 500, 503, 599]) {
    assert.deepEqual(storageReadFailure({ response: { status: String(status) } }), {
      verified: false, status: 'failed', code: 'STORAGE_READ_FAILED', httpStatus: status,
    });
  }
});

test('missing, malformed and non-HTTP errors never fabricate a successful storage inspection', () => {
  for (const error of [undefined, null, {}, new Error('offline'), { code: 'ENOTFOUND' }, { code: '404 secret' },
    { status: 200 }, { status: 600 }, { status: 403.5 }, { response: { status: 'POISON_TOKEN' } }]) {
    assert.deepEqual(storageReadFailure(error), {
      verified: false, status: 'failed', code: 'STORAGE_READ_FAILED', httpStatus: null,
    });
  }
});

test('error message, stack, response bodies and authorization headers never enter exported status', () => {
  const error = Object.assign(new Error('POISON_PASSWORD https://private.invalid'), {
    code: 403, stack: 'POISON_STACK', headers: { Authorization: 'POISON_TOKEN' },
    response: { status: 403, headers: { Authorization: 'POISON_COOKIE' }, data: 'POISON_RESPONSE' },
  });
  const check = storageReadFailure(error);
  assert.deepEqual(Object.keys(check).sort(), ['code', 'httpStatus', 'status', 'verified']);
  assert.equal(JSON.stringify(check).includes('POISON'), false);
  assert.equal(JSON.stringify(check).includes('private.invalid'), false);
});

test('sanitization preserves valid status values and strips all unrelated private fields', () => {
  for (const check of [verified(), storageReadFailure({ code: 404 }), storageReadFailure({ code: 403 }),
    storageReadFailure({ code: 503 }), { verified: false, status: 'incomplete', code: 'STORAGE_SCAN_LIMIT_REACHED', httpStatus: null }]) {
    assert.deepEqual(sanitizeStorageCheck({ ...check, message: 'POISON', stack: 'POISON', headers: 'POISON' }), check);
  }
});

test('missing, malformed or unsupported status fields become a safe invalid coverage failure', () => {
  for (const value of [undefined, null, 'verified', {}, { ...verified(), verified: 'true' },
    { ...verified(), status: 'unknown' }, { ...verified(), code: 'POISON' },
    { ...verified(), httpStatus: '404' }, { ...verified(), httpStatus: 200 }, { ...verified(), httpStatus: 600 }]) {
    assert.deepEqual(sanitizeStorageCheck(value), invalid());
  }
});

test('contradictory verified flags, failure codes and HTTP values cannot verify coverage', () => {
  for (const value of [
    { ...verified(), verified: false },
    { ...verified(), code: 'STORAGE_BUCKET_NOT_FOUND' },
    { ...verified(), httpStatus: 404 },
    { verified: true, status: 'forbidden', code: 'STORAGE_ACCESS_DENIED', httpStatus: 403 },
    { verified: false, status: 'not-found', code: 'STORAGE_ACCESS_DENIED', httpStatus: 404 },
    { verified: false, status: 'not-found', code: 'STORAGE_BUCKET_NOT_FOUND', httpStatus: 403 },
    { verified: false, status: 'forbidden', code: 'STORAGE_ACCESS_DENIED', httpStatus: 404 },
    { verified: false, status: 'failed', code: null, httpStatus: null },
  ]) assert.deepEqual(sanitizeStorageCheck(value), invalid());
});

test('a complete legacy snapshot remains compatible only with all explicitly completed prefixes', () => {
  const coverage = fullCoverage();
  assert.deepEqual(householdStorageCheck(coverage), verified());
  for (const prefix of STORAGE_PREFIXES) assert.equal(storagePrefixVerified(coverage, `${prefix}test/file.png`), true);
});

test('incomplete legacy coverage, omitted prefixes and a declared storage gap cannot become verified', () => {
  for (const coverage of [undefined, {}, { ...fullCoverage(), complete: false },
    { ...fullCoverage(), storagePrefixes: STORAGE_PREFIXES.slice(1) },
    { ...fullCoverage(), missingCollections: ['storage'] }]) {
    assert.equal(householdStorageCheck(coverage).verified, false);
    assert.equal(storagePrefixVerified(coverage, 'taskProof/test/file.png'), false);
  }
});

test('new 404/403 checks override contradictory complete coverage claims', () => {
  for (const code of [404, 403]) {
    const check = storageReadFailure({ code });
    const coverage = { ...fullCoverage(), storageCheck: check };
    assert.deepEqual(householdStorageCheck(coverage), check);
    assert.equal(householdStorageCheck(coverage).verified, false);
  }
});

test('a new successful status with missing prefixes or an explicit storage gap is invalid', () => {
  for (const coverage of [
    { ...fullCoverage(), storageCheck: verified(), storagePrefixes: STORAGE_PREFIXES.slice(1) },
    { ...fullCoverage(), storageCheck: verified(), missingCollections: ['storage'] },
    { ...fullCoverage(), storageCheck: { ...verified(), verified: false } },
  ]) assert.deepEqual(householdStorageCheck(coverage), invalid());
});

test('partial scans only verify objects under completed prefixes, not attempted or later prefixes', () => {
  const coverage = { complete: false, missingCollections: ['storage'], storagePrefixes: ['taskProof/'],
    storageCheck: storageReadFailure({ code: 403 }) };
  assert.equal(householdStorageCheck(coverage).verified, false);
  assert.equal(storagePrefixVerified(coverage, 'taskProof/test-task/test-owner/test.png'), true);
  for (const path of ['taskRewardImages/test.png', 'healthDocuments/test.pdf', 'health/test.png', 'avatars/test.png',
    'unknown/test.png', '', undefined]) assert.equal(storagePrefixVerified(coverage, path), false);
  const failedFirstPrefix = { ...coverage, storagePrefixes: [] };
  assert.equal(storagePrefixVerified(failedFirstPrefix, 'taskProof/test.png'), false);
});

test('invalid new checks do not authorize an individual completed-prefix claim', () => {
  const coverage = { ...fullCoverage(), storageCheck: { ...verified(), code: 'STORAGE_ACCESS_DENIED' } };
  for (const prefix of STORAGE_PREFIXES) assert.equal(storagePrefixVerified(coverage, `${prefix}test.png`), false);
});
