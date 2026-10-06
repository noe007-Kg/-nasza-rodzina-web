import { OAuth2Client } from 'google-auth-library';
import { EduServerError, assertSameOrigin, getServerFirebase } from './edu-auth.mjs';

const activeMember = (profile) => profile?.active === true && profile?.canLogin === true
  && ['parent', 'child'].includes(profile.role) && profile.archived !== true;

/** Verifies a Google Identity Services credential. Google tokens never enter Firestore. */
export async function verifyGoogleIdentity(credential, clientId = process.env.GOOGLE_CLIENT_ID) {
  if (!clientId || !/^[a-zA-Z0-9_.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new EduServerError('ACCOUNT_GOOGLE_NOT_CONFIGURED', 503, 'Logowanie Google wymaga konfiguracji administratora. Nadal możesz użyć e-maila i hasła.');
  }
  if (typeof credential !== 'string' || credential.length > 16384
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(credential)) {
    throw new EduServerError('ACCOUNT_INVALID_GOOGLE_CREDENTIAL', 400, 'Nieprawidłowe potwierdzenie konta Google.');
  }
  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email_verified || !payload.email) throw new Error('unverified');
    return { subject: payload.sub, email: payload.email };
  } catch {
    throw new EduServerError('ACCOUNT_INVALID_GOOGLE_CREDENTIAL', 401, 'Nie udało się potwierdzić konta Google. Spróbuj ponownie.');
  }
}

/** Never creates or finds a Firebase user by e-mail: only an already linked provider is admitted. */
export async function googleLoginAction(body, services = getServerFirebase(), verify = verifyGoogleIdentity) {
  if (!body || Object.keys(body).some((key) => key !== 'credential')) {
    throw new EduServerError('ACCOUNT_INVALID_REQUEST', 400, 'Nieprawidłowe dane logowania.');
  }
  const identity = await verify(body.credential);
  let user;
  try { user = await services.auth.getUserByProviderUid('google.com', identity.subject); }
  catch (error) {
    if (error?.code === 'auth/user-not-found') {
      throw new EduServerError('ACCOUNT_GOOGLE_NOT_LINKED', 403, 'Najpierw zaloguj się e-mailem i hasłem, a następnie połącz Google w Ustawieniach → Konto i logowanie.');
    }
    throw error;
  }
  if (user.disabled || !user.providerData?.some((provider) => provider.providerId === 'google.com' && provider.uid === identity.subject)) {
    throw new EduServerError('ACCOUNT_GOOGLE_DISABLED', 403, 'To konto nie ma aktywnego połączenia Google.');
  }
  const snapshot = await services.db.collection('members').doc(user.uid).get();
  if (!snapshot.exists || !activeMember(snapshot.data())) {
    throw new EduServerError('ACCOUNT_MEMBER_REQUIRED', 403, 'Konto nie ma aktywnego dostępu do Naszej Rodziny.');
  }
  // The exact Firebase UID is retained. No account, member or provider is created here.
  return { token: await services.auth.createCustomToken(user.uid) };
}

export function assertAccountOrigin(request) { assertSameOrigin(request); }

