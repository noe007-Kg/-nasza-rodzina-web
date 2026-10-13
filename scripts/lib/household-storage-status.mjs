/** Pure, sanitized Storage coverage shared by collector, offline planner and report. */
export const STORAGE_PREFIXES = Object.freeze(['taskProof/', 'taskRewardImages/', 'healthDocuments/', 'health/', 'avatars/']);
const statuses = new Set(['verified', 'not-found', 'forbidden', 'incomplete', 'failed']);
const codes = new Set(['STORAGE_BUCKET_NOT_FOUND', 'STORAGE_ACCESS_DENIED', 'STORAGE_READ_FAILED',
  'STORAGE_SCAN_LIMIT_REACHED', 'STORAGE_PAGINATION_STALLED', 'STORAGE_NOT_VERIFIED', 'STORAGE_COVERAGE_INVALID']);
const invalid = () => ({ verified: false, status: 'failed', code: 'STORAGE_COVERAGE_INVALID', httpStatus: null });

export function storageReadFailure(error) {
  // Never retain response bodies, URLs, authorization headers, messages or stacks.
  const status = [error?.code, error?.statusCode, error?.status, error?.response?.status]
    .find(value => typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599
      || typeof value === 'string' && /^[45]\d{2}$/.test(value));
  const httpStatus = status === undefined ? null : Number(status);
  return { verified: false, status: httpStatus === 404 ? 'not-found' : httpStatus === 403 ? 'forbidden' : 'failed',
    code: httpStatus === 404 ? 'STORAGE_BUCKET_NOT_FOUND' : httpStatus === 403 ? 'STORAGE_ACCESS_DENIED' : 'STORAGE_READ_FAILED', httpStatus };
}

export function sanitizeStorageCheck(value) {
  if (!value || typeof value !== 'object' || typeof value.verified !== 'boolean' || !statuses.has(value.status)
    || value.code !== null && !codes.has(value.code)
    || value.httpStatus !== null && (!Number.isInteger(value.httpStatus) || value.httpStatus < 400 || value.httpStatus > 599)) return invalid();
  if (value.verified !== (value.status === 'verified') || value.verified && (value.code !== null || value.httpStatus !== null)
    || !value.verified && value.code === null
    || value.status === 'not-found' && (value.code !== 'STORAGE_BUCKET_NOT_FOUND' || value.httpStatus !== 404)
    || value.status === 'forbidden' && (value.code !== 'STORAGE_ACCESS_DENIED' || value.httpStatus !== 403)) return invalid();
  return { verified: value.verified, status: value.status, code: value.code, httpStatus: value.httpStatus };
}

export function householdStorageCheck(coverage) {
  const prefixesComplete = Array.isArray(coverage?.storagePrefixes) && STORAGE_PREFIXES.every(prefix => coverage.storagePrefixes.includes(prefix));
  const storageMissing = Array.isArray(coverage?.missingCollections) && coverage.missingCollections.includes('storage');
  // Old successful snapshots predate storageCheck; their reader aborted on
  // errors, so only explicit complete coverage can count as a legacy success.
  if (!Object.hasOwn(coverage || {}, 'storageCheck')) return coverage?.complete === true && prefixesComplete
    && !storageMissing
    ? { verified: true, status: 'verified', code: null, httpStatus: null }
    : { verified: false, status: 'incomplete', code: 'STORAGE_NOT_VERIFIED', httpStatus: null };
  const check = sanitizeStorageCheck(coverage.storageCheck);
  return check.verified && (!prefixesComplete || storageMissing) ? invalid() : check;
}

export function storagePrefixVerified(coverage, path) {
  const prefix = typeof path === 'string' ? STORAGE_PREFIXES.find(item => path.startsWith(item)) : null;
  if (!prefix || !Array.isArray(coverage?.storagePrefixes) || !coverage.storagePrefixes.includes(prefix)) return false;
  return Object.hasOwn(coverage, 'storageCheck') ? sanitizeStorageCheck(coverage.storageCheck).code !== 'STORAGE_COVERAGE_INVALID'
    : householdStorageCheck(coverage).verified;
}
