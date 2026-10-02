import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EduServerError } from './edu-auth.mjs';

const MAX_SESSION_BYTES = 512 * 1024;
const FORBIDDEN_KEYS = new Set(['password', 'passwd', 'haslo', 'hasło', 'credentials']);

function validateContext({ uid, purpose = 'eduvulcan-session' }) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || typeof purpose !== 'string' || !purpose || purpose.length > 80) {
    throw new EduServerError('EDU_INVALID_SESSION', 400, 'Nieprawidłowy kontekst sesji dziennika.');
  }
  return { uid, purpose };
}

function loadKey() {
  const value = process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Administrator musi ustawić klucz szyfrowania integracji.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Nieprawidłowy klucz szyfrowania integracji.');
  return key;
}

function rejectPasswords(value, depth = 0) {
  if (depth > 40) throw new EduServerError('EDU_INVALID_SESSION', 400, 'Sesja dziennika ma nieprawidłowy format.');
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new EduServerError('EDU_PASSWORD_RETENTION', 400, 'Hasło do dziennika nie może zostać zapisane w sesji.');
    rejectPasswords(entry, depth + 1);
  }
}

function aad(context, keyId) { return Buffer.from(JSON.stringify({ v: 1, keyId, ...validateContext(context) }), 'utf8'); }

export function encryptionConfigured() {
  try { loadKey(); return true; } catch { return false; }
}

/** Store only the adapter's session/cookies. Login credentials are deliberately rejected. */
export function encryptSession(session, context) {
  const key = loadKey();
  validateContext(context);
  rejectPasswords(session);
  let plaintext;
  try { plaintext = Buffer.from(JSON.stringify(session), 'utf8'); }
  catch { throw new EduServerError('EDU_INVALID_SESSION', 400, 'Sesja dziennika ma nieprawidłowy format.'); }
  if (!plaintext.length || plaintext.length > MAX_SESSION_BYTES) throw new EduServerError('EDU_INVALID_SESSION', 400, 'Sesja dziennika jest zbyt duża.');
  const keyId = process.env.EDUVULCAN_ENCRYPTION_KEY_ID || 'v1';
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(context, keyId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  plaintext.fill(0);
  return { v: 1, keyId, nonce: nonce.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}

export function decryptSession(envelope, context) {
  const key = loadKey();
  validateContext(context);
  const keyId = process.env.EDUVULCAN_ENCRYPTION_KEY_ID || 'v1';
  if (!envelope || envelope.v !== 1 || envelope.keyId !== keyId
    || typeof envelope.nonce !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string'
    || !/^[A-Za-z0-9_-]{16}$/.test(envelope.nonce) || !/^[A-Za-z0-9_-]{22}$/.test(envelope.tag)
    || envelope.ciphertext.length > Math.ceil(MAX_SESSION_BYTES * 4 / 3) + 4) {
    throw new EduServerError('EDU_SESSION_INVALID', 401, 'Połącz dziennik ponownie. Zapisana sesja jest nieaktualna.');
  }
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64url'));
    decipher.setAAD(aad(context, keyId));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new EduServerError('EDU_SESSION_INVALID', 401, 'Połącz dziennik ponownie. Nie można odczytać zapisanej sesji.');
  } finally { plaintext?.fill(0); }
}
