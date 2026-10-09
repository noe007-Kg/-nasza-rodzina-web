import type { FamilyMemberProfile } from '../family-members';

export type CalendarVisibility = 'private' | 'family';
export type CalendarMode = 'sync' | 'import';
export type CalendarConnection = {
  id: string; provider: 'google'; calendarId: string | null; calendarName: string | null;
  ownerProfileId: string; person: string; visibility: CalendarVisibility; mode: CalendarMode;
  status: 'connected' | 'disconnected' | 'needs-reconnect' | 'imported'; selectionConfirmed: boolean;
  lastSuccessfulSyncAt: string | null; lastAttemptAt: string | null; lastErrorCode: string | null;
};
export type ExternalCalendar = { id: string; name: string; timeZone: string; primary: boolean };
export type CalendarStatusResponse = { ok: true; configured: boolean; connections: CalendarConnection[] };
export type CalendarNotice = { tone: 'success' | 'error'; message: string };

export function calendarMessage(code: string): string {
  const messages: Record<string, string> = {
    CALENDAR_NOT_CONFIGURED: 'Połączenie Google Calendar wymaga konfiguracji serwera. Pozostałe kalendarze i pliki .ics nadal działają.',
    CALENDAR_RATE_LIMITED: 'Dane były odświeżane przed chwilą. Odczekaj minutę przed kolejnym pobraniem.',
    CALENDAR_BUSY: 'Odświeżanie kalendarza już trwa. Poczekaj chwilę i sprawdź stan połączenia.',
    CALENDAR_SELECTION_REQUIRED: 'Najpierw wybierz kalendarz Google i potwierdź miejsce oraz widoczność wydarzeń.',
    CALENDAR_RECONNECT_REQUIRED: 'Google wymaga ponownego połączenia. Zapisane wydarzenia pozostają w aplikacji.',
    CALENDAR_DECRYPT_FAILED: 'Nie udało się odświeżyć połączenia. Zapisane wydarzenia pozostają widoczne; administrator musi sprawdzić konfigurację kalendarzy.',
    CALENDAR_OAUTH_CANCELLED: 'Anulowano zgodę Google. Nie pobrano wydarzeń.',
    CALENDAR_OAUTH_EXPIRED: 'Potwierdzenie Google wygasło. Rozpocznij połączenie ponownie.',
    CALENDAR_OAUTH_INVALID: 'Nie udało się potwierdzić połączenia dla tego konta. Rozpocznij je ponownie w Ustawieniach.',
    CALENDAR_PROVIDER_UNAVAILABLE: 'Google Calendar jest teraz niedostępny. Zapisane wydarzenia pozostają widoczne; spróbuj ponownie później.',
    CALENDAR_PROVIDER_DATA: 'Google nie przekazał pełnych danych kalendarza. Zapisane wydarzenia pozostają widoczne; spróbuj ponownie później.',
    CALENDAR_FORBIDDEN: 'Nie masz dostępu do tego połączenia lub wybranego profilu.',
    CALENDAR_CONNECTION_FORBIDDEN: 'Nie masz dostępu do tego połączenia kalendarza.',
    CALENDAR_PROFILE_FORBIDDEN: 'Możesz przypisać kalendarz do siebie albo do całej rodziny.',
    CALENDAR_PROFILE_UNAVAILABLE: 'Wybrany profil jest niedostępny. Wybierz aktywny profil rodziny.',
    CALENDAR_MEMBER_REQUIRED: 'Konto wymaga aktywnego dostępu do Naszej Rodziny.',
    CALENDAR_OAUTH_FORBIDDEN: 'Dokończ połączenie na tym samym koncie Naszej Rodziny, na którym je rozpoczęto.',
    CALENDAR_NOT_FOUND: 'Połączenie jest niedostępne. Sprawdź jego aktualny stan.',
    CALENDAR_CONFIGURATION_LOCKED: 'Po imporcie zmiana kalendarza lub właściciela wymaga osobnego połączenia.',
    CALENDAR_SOURCE_LOCKED: 'Po imporcie zmiana kalendarza lub właściciela wymaga osobnego połączenia.',
    CALENDAR_SOURCE_NOT_FOUND: 'Google nie udostępnia tego kalendarza. Sprawdź dostęp na swoim koncie Google.',
    CALENDAR_SOURCE_ALREADY_EXISTS: 'Ten kalendarz ma już wydarzenia w aplikacji. Połącz ponownie jego dotychczasowe źródło, aby zachować historię bez duplikatów.',
    CALENDAR_CONNECTION_LIMIT: 'Masz już dziesięć aktywnych źródeł Google Calendar. Rozłącz nieużywane połączenie.',
    CALENDAR_SOURCE_HISTORY_LIMIT: 'Osiągnięto limit 30 zapisanych źródeł kalendarza. Możesz ponownie połączyć istniejące źródło; historia nie jest usuwana automatycznie.',
    CALENDAR_SYNC_STALE: 'Połączenie zmieniło się podczas odświeżania. Sprawdź jego aktualny stan.',
    CALENDAR_IMPORT_COMPLETE: 'Import jednorazowy został już zakończony. Wydarzenia pozostają w aplikacji.',
    CALENDAR_PROVIDER_RATE_LIMITED: 'Google ograniczył liczbę żądań. Odczekaj chwilę i spróbuj ponownie.',
    CALENDAR_PROVIDER_LIMIT: 'Google zwrócił zbyt wiele wydarzeń do jednego pobrania. Zapisane dane pozostają widoczne.',
    CALENDAR_EVENT_CONFLICT: 'Wydarzenie wymaga sprawdzenia ustawień prywatności. Dotychczasowe dane pozostają bez zmian.',
    CALENDAR_EVENT_FORBIDDEN: 'Nie masz uprawnienia do zmiany widoczności tego wydarzenia.',
    CALENDAR_AUTH_REQUIRED: 'Zaloguj się ponownie do Naszej Rodziny, aby zarządzać kalendarzem.',
    CALENDAR_ACCOUNT_CHANGED: 'Konto zalogowane w aplikacji zmieniło się. Nie wykonano operacji na nowym koncie.',
    CALENDAR_NETWORK_ERROR: 'Nie udało się połączyć z serwerem. Sprawdź internet i spróbuj ponownie.',
    CALENDAR_INVALID_RESPONSE: 'Nie udało się odczytać stanu połączenia. Spróbuj ponownie.',
  };
  return messages[code] || 'Nie udało się odświeżyć kalendarza. Zapisane wydarzenia pozostają widoczne. Spróbuj ponownie.';
}
export class CalendarRequestError extends Error {
  constructor(public code: string) { super(calendarMessage(code)); }
}
export function calendarErrorMessage(error: unknown) {
  return error instanceof CalendarRequestError ? error.message : calendarMessage('CALENDAR_NETWORK_ERROR');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function text(value: unknown, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
  return value;
}
function time(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const input = text(value)!;
  if (!Number.isFinite(Date.parse(input))) throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
  return input;
}
export function parseCalendarStatus(value: unknown): CalendarStatusResponse {
  const reply = object(value);
  if (reply.ok !== true || typeof reply.configured !== 'boolean' || !Array.isArray(reply.connections) || reply.connections.length > 100) throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
  const connections = reply.connections.map(value => {
    const row = object(value);
    if (row.provider !== 'google' || !['private', 'family'].includes(String(row.visibility)) || !['sync', 'import'].includes(String(row.mode)) || !['connected', 'disconnected', 'needs-reconnect', 'imported'].includes(String(row.status)) || typeof row.selectionConfirmed !== 'boolean') throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
    return { id: text(row.id)!, provider: 'google' as const, calendarId: text(row.calendarId, true), calendarName: text(row.calendarName, true), ownerProfileId: text(row.ownerProfileId)!, person: text(row.person)!, visibility: row.visibility as CalendarVisibility, mode: row.mode as CalendarMode, status: row.status as CalendarConnection['status'], selectionConfirmed: row.selectionConfirmed, lastSuccessfulSyncAt: time(row.lastSuccessfulSyncAt), lastAttemptAt: time(row.lastAttemptAt), lastErrorCode: text(row.lastErrorCode, true) };
  });
  if (new Set(connections.map(row => row.id)).size !== connections.length) throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
  return { ok: true, configured: reply.configured, connections };
}
export function parseExternalCalendars(value: unknown): ExternalCalendar[] {
  const reply = object(value);
  if (reply.ok !== true || !Array.isArray(reply.calendars) || reply.calendars.length > 250) throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
  const calendars = reply.calendars.map(value => {
    const row = object(value);
    if (typeof row.primary !== 'boolean') throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
    return { id: text(row.id)!, name: text(row.name)!, timeZone: text(row.timeZone)!, primary: row.primary };
  });
  if (new Set(calendars.map(row => row.id)).size !== calendars.length) throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
  return calendars;
}
export function authorizedCalendarUrl(value: unknown): string {
  if (typeof value !== 'string') throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
  let url: URL;
  try { url = new URL(value); } catch { throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE'); }
  if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.username || url.password || url.port || url.hash || !['/o/oauth2/v2/auth', '/o/oauth2/auth'].includes(url.pathname) || ['access_token', 'refresh_token', 'id_token', 'token', 'code'].some(key => url.searchParams.has(key))) throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
  return url.href;
}
/** Profile assignment never grants access to the importing user's private data. */
export function availableCalendarOwners(profiles: readonly FamilyMemberProfile[], uid: string, parent: boolean) {
  return profiles.filter(profile => profile.active === true && profile.archived !== true && profile.disabled !== true && (parent || profile.id === uid));
}
export function calendarOwnerName(connection: Pick<CalendarConnection, 'ownerProfileId'>, profiles: readonly FamilyMemberProfile[]): string {
  if (connection.ownerProfileId === 'family') return 'Cała rodzina';
  return profiles.find(profile => profile.id === connection.ownerProfileId)?.name || 'Profil rodziny';
}
export function manualCalendarSyncAvailableAt(connection: Pick<CalendarConnection, 'lastSuccessfulSyncAt'> & Partial<Pick<CalendarConnection, 'lastAttemptAt'>>): number | null {
  const times = [connection.lastSuccessfulSyncAt, connection.lastAttemptAt].map(value => value ? Date.parse(value) : NaN).filter(Number.isFinite);
  return times.length ? Math.max(...times) + 60_000 : null;
}
const completionPattern = /^[A-Za-z0-9_-]{43}$/;
const callbackCodes = new Set(['CALENDAR_OAUTH_CANCELLED', 'CALENDAR_OAUTH_INVALID', 'CALENDAR_OAUTH_EXPIRED', 'CALENDAR_RECONNECT_REQUIRED', 'CALENDAR_PROVIDER_UNAVAILABLE', 'CALENDAR_NOT_CONFIGURED']);
export function calendarCompletion(url: URL): { completionId?: string; errorCode?: string } | null {
  if (!url.searchParams.has('calendarOAuth') && !url.searchParams.has('calendarOAuthError')) return null;
  const completionId = url.searchParams.get('calendarOAuth');
  const errorCode = url.searchParams.get('calendarOAuthError');
  if (errorCode || !completionId || !completionPattern.test(completionId) || url.searchParams.getAll('calendarOAuth').length !== 1) return { errorCode: errorCode && callbackCodes.has(errorCode) ? errorCode : 'CALENDAR_OAUTH_INVALID' };
  return { completionId };
}
export function withoutCalendarCompletion(url: URL): string {
  const clean = new URL(url.href);
  clean.searchParams.delete('calendarOAuth'); clean.searchParams.delete('calendarOAuthError');
  return `${clean.pathname}${clean.search}${clean.hash}`;
}
