import { auth } from './firebase';

/** Build-time Preview protection is convenience; the server independently enforces it. */
export function familyV2WritesAllowed(): boolean {
  return import.meta.env.VITE_V2_PREVIEW_READ_ONLY !== 'true';
}

export function assertFamilyV2WriteAllowed(): void {
  if (!familyV2WritesAllowed()) throw new Error('Wersja Preview: nowe operacje zapisu są wyłączone, aby chronić dane produkcyjne.');
}

export async function familyAction<T>(domain: 'tasks' | 'health' | 'finance' | 'music-school', body: Record<string, unknown>): Promise<T> {
  if (!['state', 'status'].includes(String(body.operation || body.action))) assertFamilyV2WriteAllowed();
  const user = auth.currentUser;
  if (!user) throw new Error('Zaloguj się ponownie do Naszej Rodziny.');
  const uid = user.uid;
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== uid) throw new Error('Konto zostało zmienione. Spróbuj ponownie.');
  let response: Response;
  try {
    response = await fetch(`/api/family/${domain}`, { method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  } catch { throw new Error('Nie udało się połączyć. Sprawdź połączenie i spróbuj ponownie.'); }
  if (auth.currentUser?.uid !== uid) throw new Error('Konto zostało zmienione. Spróbuj ponownie.');
  let result: { ok?: boolean; error?: { message?: unknown } };
  try { result = await response.json(); }
  catch { throw new Error('Nowe funkcje wymagają skonfigurowania backendu aplikacji.'); }
  if (auth.currentUser?.uid !== uid) throw new Error('Konto zostało zmienione. Spróbuj ponownie.');
  if (!response.ok || result.ok !== true) throw new Error(typeof result.error?.message === 'string' && result.error.message.length < 500
    ? result.error.message : 'Nie udało się wykonać operacji. Spróbuj ponownie.');
  return result as T;
}
