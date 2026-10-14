import { controlFailure as fail } from './household-private-files.mjs';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
/** Compare Firestore typed values, not irrelevant protobuf JSON spellings. */
export function normalizedFirestoreFields(fields = {}) {
  if (!object(fields)) fail('RESTORE_NATIVE_FIELDS_INVALID');
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, normalizeValue(value)]));
}
function normalizeValue(value) {
  if (!object(value) || Object.keys(value).length !== 1) fail('RESTORE_NATIVE_VALUE_INVALID');
  const [kind] = Object.keys(value), data = value[kind];
  if (kind === 'nullValue') {
    if (![null, 'NULL_VALUE', 0].includes(data)) fail('RESTORE_NATIVE_VALUE_INVALID');
    return { nullValue: null };
  }
  if (kind === 'integerValue') {
    if (typeof data !== 'string' && !Number.isSafeInteger(data) || !/^-?\d+$/.test(String(data))) fail('RESTORE_NATIVE_VALUE_INVALID');
    const integer = BigInt(data);
    if (integer < -9223372036854775808n || integer > 9223372036854775807n) fail('RESTORE_NATIVE_VALUE_INVALID');
    return { integerValue: String(integer) };
  }
  if (kind === 'timestampValue') {
    const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(data || '');
    if (!match || !Number.isFinite(Date.parse(match[1] + 'Z'))) fail('RESTORE_NATIVE_VALUE_INVALID');
    return { timestampValue: `${match[1]}.${(match[2] || '').padEnd(9, '0')}Z` };
  }
  if (kind === 'arrayValue') {
    if (!object(data) || data.values !== undefined && !Array.isArray(data.values)) fail('RESTORE_NATIVE_VALUE_INVALID');
    return { arrayValue: { values: (data.values || []).map(normalizeValue) } };
  }
  if (kind === 'mapValue') {
    if (!object(data)) fail('RESTORE_NATIVE_VALUE_INVALID');
    return { mapValue: { fields: normalizedFirestoreFields(data.fields || {}) } };
  }
  if (kind === 'geoPointValue') {
    if (!object(data) || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') fail('RESTORE_NATIVE_VALUE_INVALID');
    return { geoPointValue: { latitude: data.latitude, longitude: data.longitude } };
  }
  if (kind === 'doubleValue') {
    if (typeof data !== 'number' && !['NaN', 'Infinity', '-Infinity'].includes(data)) fail('RESTORE_NATIVE_VALUE_INVALID');
    return { doubleValue: data };
  }
  if (kind === 'booleanValue' && typeof data === 'boolean' || ['bytesValue', 'stringValue', 'referenceValue'].includes(kind) && typeof data === 'string') return { [kind]: data };
  fail('RESTORE_NATIVE_VALUE_INVALID');
}
