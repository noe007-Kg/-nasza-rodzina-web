import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarConfiguration } from '../server/calendar-config.mjs';
import { calendarEncryptionConfigured, decryptCalendarSecrets, encryptCalendarSecrets } from '../server/calendar-secrets.mjs';
import { calendarTestEnvironment } from './calendar-test-helpers.mjs';

test('calendar encryption authenticates UID, connection and purpose, and stores no plaintext tokens', () => {
  const restore = calendarTestEnvironment();
  try {
    const binding = { uid: 'actor', id: 'connection', purpose: 'connection' }, value = { tokens: { accessToken: 'test-access-placeholder', refreshToken: 'test-refresh-placeholder' } };
    const envelope = encryptCalendarSecrets(value, binding);
    assert.deepEqual(decryptCalendarSecrets(envelope, binding), value);
    assert.equal(JSON.stringify(envelope).includes('test-access-placeholder'), false);
    for (const change of [{ uid: 'other' }, { id: 'different' }, { purpose: 'oauth' }]) assert.throws(() => decryptCalendarSecrets(envelope, { ...binding, ...change }), { code: 'CALENDAR_DECRYPT_FAILED' });
    const damaged = { ...envelope, tag: `${envelope.tag[0] === 'a' ? 'b' : 'a'}${envelope.tag.slice(1)}` };
    assert.throws(() => decryptCalendarSecrets(damaged, binding), { code: 'CALENDAR_DECRYPT_FAILED' });
  } finally { restore(); }
});
test('a different calendar key fails safely and never changes eduVULCAN configuration', () => {
  const restore = calendarTestEnvironment(), eduKey = process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64, eduId = process.env.EDUVULCAN_ENCRYPTION_KEY_ID;
  try {
    const binding = { uid: 'actor', id: 'connection', purpose: 'connection' }, envelope = encryptCalendarSecrets({ test: true }, binding);
    process.env.CALENDAR_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 62).toString('base64');
    assert.throws(() => decryptCalendarSecrets(envelope, binding), { code: 'CALENDAR_DECRYPT_FAILED' });
    assert.equal(process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64, eduKey);
    assert.equal(process.env.EDUVULCAN_ENCRYPTION_KEY_ID, eduId);
  } finally { restore(); }
});
test('calendar refuses the eduVULCAN key, invalid base64 and missing configuration', () => {
  const restore = calendarTestEnvironment(), originalEdu = process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64;
  try {
    process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = process.env.CALENDAR_ENCRYPTION_KEY_BASE64;
    assert.equal(calendarEncryptionConfigured(), false);
    if (originalEdu === undefined) delete process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64; else process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = originalEdu;
    for (const value of ['', 'invalid', Buffer.alloc(16).toString('base64')]) { process.env.CALENDAR_ENCRYPTION_KEY_BASE64 = value; assert.equal(calendarEncryptionConfigured(), false); }
  } finally { if (originalEdu === undefined) delete process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64; else process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = originalEdu; restore(); }
});
test('OAuth redirect is canonical HTTPS and configuration refuses paths or credentials', () => {
  const restore = calendarTestEnvironment();
  try {
    assert.equal(calendarConfiguration().redirectUri, 'https://family.example.test/api/calendars/callback');
    for (const origin of ['http://family.example.test', 'https://user:password@family.example.test', 'https://family.example.test/path', 'https://family.example.test?x=y', 'https://localhost']) {
      assert.throws(() => calendarConfiguration({ ...process.env, CALENDAR_SITE_ORIGIN: origin }), { code: 'CALENDAR_NOT_CONFIGURED' });
    }
  } finally { restore(); }
});
