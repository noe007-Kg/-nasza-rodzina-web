import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { failCalendar } from './calendar-config.mjs';

function key(env = process.env) {
  const value = env.CALENDAR_ENCRYPTION_KEY_BASE64;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value) || value === env.EDUVULCAN_ENCRYPTION_KEY_BASE64) {
    failCalendar('CALENDAR_NOT_CONFIGURED', 503, 'Administrator musi ustawić osobny klucz szyfrowania kalendarzy.');
  }
  const result = Buffer.from(value, 'base64');
  if (result.length !== 32 || result.toString('base64') !== value) failCalendar('CALENDAR_NOT_CONFIGURED', 503, 'Nieprawidłowy klucz szyfrowania kalendarzy.');
  return result;
}
function context({ uid, id, purpose }) {
  if (![uid, id].every(value => typeof value === 'string' && value && value.length <= 128 && !/[\x00-\x1f/\\]/.test(value))
    || !['oauth', 'connection'].includes(purpose)) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Nieprawidłowy kontekst połączenia kalendarza.');
  return { uid, id, purpose };
}
export function calendarEncryptionConfigured() { try { key(); return /^[a-zA-Z0-9_-]{1,40}$/.test(process.env.CALENDAR_ENCRYPTION_KEY_ID || 'v1'); } catch { return false; } }
export function encryptCalendarSecrets(value, binding) {
  const keyId = process.env.CALENDAR_ENCRYPTION_KEY_ID || 'v1';
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(keyId)) failCalendar('CALENDAR_NOT_CONFIGURED', 503, 'Nieprawidłowy identyfikator klucza kalendarzy.');
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  if (!plaintext.length || plaintext.length > 128 * 1024) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Połączenie kalendarza ma zbyt duży rozmiar.');
  try {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), nonce);
    cipher.setAAD(Buffer.from(JSON.stringify({ v: 1, keyId, ...context(binding) })));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { v: 1, keyId, nonce: nonce.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
  } finally { plaintext.fill(0); }
}
export function decryptCalendarSecrets(envelope, binding) {
  const keyId = process.env.CALENDAR_ENCRYPTION_KEY_ID || 'v1';
  const encryptionKey = key();
  if (!envelope || envelope.v !== 1 || envelope.keyId !== keyId || typeof envelope.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{16}$/.test(envelope.nonce) || typeof envelope.tag !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(envelope.tag)
    || typeof envelope.ciphertext !== 'string' || !/^[A-Za-z0-9_-]+$/.test(envelope.ciphertext) || envelope.ciphertext.length > 175000) {
    failCalendar('CALENDAR_DECRYPT_FAILED', 503, 'Nie udało się odczytać połączenia kalendarza. Zapisane wydarzenia pozostają widoczne.');
  }
  let plaintext;
  try {
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(envelope.nonce, 'base64url'));
    cipher.setAAD(Buffer.from(JSON.stringify({ v: 1, keyId, ...context(binding) })));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    plaintext = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64url')), cipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch { failCalendar('CALENDAR_DECRYPT_FAILED', 503, 'Nie udało się odczytać połączenia kalendarza. Zapisane wydarzenia pozostają widoczne.'); }
  finally { plaintext?.fill(0); }
}
