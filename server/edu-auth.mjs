import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const APP_NAME = 'nasza-rodzina-eduvulcan';
const PEOPLE = new Set(['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla']);

/** Safe, user-facing errors. Never attach tokens, credentials or upstream bodies. */
export class EduServerError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'EduServerError';
    this.code = code;
    this.status = status;
  }
}

export function getServerFirebase() {
  const env = process.env;
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Administrator musi skonfigurować integrację na serwerze.');
  const emulators = env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST;
  if (emulators && (env.VERCEL || !projectId.startsWith('demo-'))) {
    throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Emulatory Firebase są dozwolone wyłącznie lokalnie z projektem demo.');
  }

  let app = getApps().find((item) => item.name === APP_NAME);
  if (!app) {
    let credential;
    const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const encoded = env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (raw && encoded) throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Konfiguracja serwera zawiera dwa klucze Firebase.');
    if (raw || encoded) {
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(raw || Buffer.from(encoded, 'base64').toString('utf8'));
      } catch {
        throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Klucz Firebase na serwerze ma nieprawidłowy format.');
      }
      if (serviceAccount.project_id !== projectId || typeof serviceAccount.client_email !== 'string' || typeof serviceAccount.private_key !== 'string') {
        throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Klucz Firebase musi należeć do skonfigurowanego projektu.');
      }
      try { credential = cert(serviceAccount); }
      catch { throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Nieprawidłowy klucz Firebase na serwerze.'); }
    } else if (env.GOOGLE_APPLICATION_CREDENTIALS && !env.VERCEL) {
      credential = applicationDefault();
    } else if (projectId.startsWith('demo-') && env.FIREBASE_AUTH_EMULATOR_HOST && env.FIRESTORE_EMULATOR_HOST && !env.VERCEL) {
      // Firebase emulators do not require production credentials.
      credential = undefined;
    } else {
      throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Brak klucza Firebase dla integracji na serwerze.');
    }
    app = initializeApp({ projectId, ...(credential ? { credential } : {}) }, APP_NAME);
  }
  return { app, auth: getAuth(app), db: getFirestore(app) };
}

function header(request, name) {
  if (typeof request.headers?.get === 'function') return request.headers.get(name) || '';
  const value = request.headers?.[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}

function boundLocalAuthEmulator(services) {
  const projectId = services.app?.options?.projectId;
  return typeof projectId === 'string' && projectId.startsWith('demo-')
    && process.env.FIREBASE_PROJECT_ID === projectId
    && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
    && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
    && !process.env.VERCEL;
}

export function assertSameOrigin(request) {
  const origin = header(request, 'origin');
  if (!origin) return; // Non-browser clients still need a valid parent ID token.
  let actual;
  try { actual = new URL(origin).origin; }
  catch { throw new EduServerError('EDU_FORBIDDEN_ORIGIN', 403, 'Niedozwolona domena żądania.'); }
  const configured = process.env.EDUVULCAN_SITE_ORIGIN;
  if (configured) {
    let expected;
    try { expected = new URL(configured).origin; }
    catch { throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Nieprawidłowa domena integracji na serwerze.'); }
    if (actual !== expected) throw new EduServerError('EDU_FORBIDDEN_ORIGIN', 403, 'Niedozwolona domena żądania.');
    return;
  }
  const host = header(request, 'host');
  if (host && new URL(actual).host !== host) throw new EduServerError('EDU_FORBIDDEN_ORIGIN', 403, 'Niedozwolona domena żądania.');
}

/** Authentication is checked on every request, including token revocation. */
export async function requireParent(request, services = getServerFirebase()) {
  assertSameOrigin(request);
  const authorization = header(request, 'authorization');
  const signed = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization);
  // Auth emulator JWTs have an empty signature. The exception is restricted to
  // the explicitly bound local demo project; the Admin SDK must still verify it.
  const localUnsigned = boundLocalAuthEmulator(services)
    && /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.$/i.test(authorization);
  if (authorization.length > 16384 || (!signed && !localUnsigned)) {
    throw new EduServerError('EDU_UNAUTHENTICATED', 401, 'Zaloguj się ponownie do Naszej Rodziny.');
  }
  let user;
  try { user = await services.auth.verifyIdToken(authorization.slice(7), true); }
  catch { throw new EduServerError('EDU_UNAUTHENTICATED', 401, 'Sesja Naszej Rodziny wygasła. Zaloguj się ponownie.'); }
  const snapshot = await services.db.collection('members').doc(user.uid).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.role !== 'parent' || profile.active !== true || profile.canLogin !== true
    || !PEOPLE.has(profile.personKey) || profile.name !== profile.personKey) {
    throw new EduServerError('EDU_PARENT_REQUIRED', 403, 'Połączeniem z dziennikiem może zarządzać aktywny rodzic.');
  }
  return { uid: user.uid, user, profile, ...services };
}
