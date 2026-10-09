import { GoogleAuthProvider, EmailAuthProvider, linkWithPopup, reauthenticateWithCredential, reauthenticateWithPopup, reload, signInWithCustomToken, unlink, updatePassword, verifyBeforeUpdateEmail, type User } from 'firebase/auth';
import { auth } from '../firebase';

export class AccountRequestError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

export function accountActionMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (error instanceof AccountRequestError) return error.message;
  const messages: Record<string, string> = {
    'auth/account-exists-with-different-credential': 'Ten adres jest już związany z inną metodą logowania. Użyj dotychczasowego e-maila i hasła, a następnie połącz Google z tym samym kontem w Ustawieniach.',
    'auth/credential-already-in-use': 'To konto Google jest już połączone z innym kontem Firebase. Nie zmieniono Twojego UID ani profilu.',
    'auth/provider-already-linked': 'Google jest już połączone z tym kontem.',
    'auth/requires-recent-login': 'Potwierdź ponownie logowanie, aby zmienić dane konta.',
    'auth/wrong-password': 'Nieprawidłowe aktualne hasło.',
    'auth/invalid-credential': 'Nie udało się potwierdzić aktualnego logowania.',
    'auth/weak-password': 'Nowe hasło jest za krótkie. Użyj co najmniej 8 znaków.',
    'auth/email-already-in-use': 'Ten e-mail jest już używany. Nie utworzono nowego konta.',
    'auth/invalid-email': 'Wpisz poprawny adres e-mail.',
    'auth/popup-blocked': 'Przeglądarka zablokowała okno Google. Zezwól na okna dla tej strony i spróbuj ponownie.',
    'auth/popup-closed-by-user': 'Zamknięto okno Google. Możesz spróbować ponownie.',
    'auth/unauthorized-domain': 'Ta domena wymaga dodania do autoryzowanych domen Firebase Authentication.',
    'auth/operation-not-allowed': 'Administrator musi włączyć tę metodę w Firebase Authentication.',
    'auth/network-request-failed': 'Sprawdź połączenie z internetem i spróbuj ponownie.',
    'auth/too-many-requests': 'Zbyt wiele prób. Spróbuj ponownie za chwilę.',
  };
  return messages[code] || 'Nie udało się zmienić konta. Spróbuj ponownie.';
}

export async function accountRequest<T extends Record<string, unknown>>(path: 'members' | 'profile' | 'google-login', body: Record<string, unknown>, user?: User): Promise<T> {
  const token = user ? await user.getIdToken() : null;
  const response = await fetch(`/api/account/${path}`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new AccountRequestError('Serwer konta nie odpowiedział. Spróbuj ponownie.', 'ACCOUNT_UNAVAILABLE'); }
  if (!response.ok || result?.ok !== true) throw new AccountRequestError(result?.error?.message || 'Nie udało się zapisać konta.', result?.error?.code || 'ACCOUNT_UNAVAILABLE');
  return result as T;
}

export function activeLoginProviders(user: Pick<User, 'providerData'>): string[] {
  return [...new Set(user.providerData.map((provider) => provider.providerId).filter((provider) => ['password', 'google.com'].includes(provider)))];
}

export async function linkGoogleToExistingAccount(user: User) {
  const uid = user.uid;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  // Linking operates on the authenticated user; signInWithPopup is deliberately never used.
  const result = await linkWithPopup(user, provider);
  if (result.user.uid !== uid) throw new AccountRequestError('Połączenie nie potwierdziło tego samego konta.', 'ACCOUNT_UID_MISMATCH');
  await reload(user);
}

export async function unlinkGoogleFromAccount(user: User) {
  const providers = activeLoginProviders(user);
  if (!providers.includes('google.com')) return;
  if (providers.length < 2) throw new AccountRequestError('Najpierw dodaj hasło. Nie można odłączyć ostatniej metody logowania.', 'ACCOUNT_LAST_PROVIDER');
  await unlink(user, 'google.com');
  await reload(user);
}

async function reauthenticateAccount(user: User, currentPassword: string) {
  if (currentPassword && user.email) {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
    return;
  }
  if (!activeLoginProviders(user).includes('password') && activeLoginProviders(user).includes('google.com')) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ login_hint: user.email || '', prompt: 'select_account' });
    const result = await reauthenticateWithPopup(user, provider);
    if (result.user.uid !== user.uid) throw new AccountRequestError('Potwierdź to samo konto Google.', 'ACCOUNT_UID_MISMATCH');
    return;
  }
  throw new AccountRequestError('Wpisz aktualne hasło, aby potwierdzić zmianę.', 'ACCOUNT_REAUTH_REQUIRED');
}

export async function changeAccountEmail(user: User, email: string, currentPassword: string) {
  await reauthenticateAccount(user, currentPassword);
  // Firebase updates the existing UID only after the new address is verified.
  await verifyBeforeUpdateEmail(user, email.trim());
}

export async function changeAccountPassword(user: User, password: string, currentPassword: string) {
  await reauthenticateAccount(user, currentPassword);
  await updatePassword(user, password);
  await reload(user);
}

export async function loginWithLinkedGoogle(credential: string) {
  const result = await accountRequest<{ token: string }>('google-login', { credential });
  if (typeof result.token !== 'string' || !result.token) throw new AccountRequestError('Brak potwierdzenia logowania Google.', 'ACCOUNT_UNAVAILABLE');
  // The backend issues a token exclusively for a provider already linked to an active family UID.
  await signInWithCustomToken(auth, result.token);
}

