import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { SCHOOL_PEOPLE } from '../school-import';

export type EduVulcanProfile = {
  id: string;
  studentName: string;
  schoolName: string;
  schoolSymbol?: string;
  className?: string;
  academicYear?: string;
};
export type EduVulcanStatus = {
  configured: boolean;
  scope?: 'family' | 'student';
  accountRole?: 'parent' | 'student';
  connectedByUid?: string;
  state: 'disconnected' | 'needs_profile' | 'connected' | 'expired';
  profiles: EduVulcanProfile[];
  selectedStudent?: { profileId: string; personKey: string };
  expiresAt?: string;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  lastErrorCode?: string;
  nextSyncAt?: string;
  syncing?: boolean;
  counts?: Record<string, number>;
  warnings?: string[];
};
export type EduVulcanReply = {
  ok: true;
  status: EduVulcanStatus;
  sync?: { counts: Record<string, number>; warnings?: string[] };
};
export type ApiAction = 'status' | 'connect' | 'select' | 'sync' | 'disconnect';

export const CONFIGURATION_TEXT = 'Połączenie z eduVULCAN wymaga funkcji serwerowych Vercel i konfiguracji integracji. Samo wgranie plików strony na hosting statyczny nie uruchamia synchronizacji.';


export function normalizedCode(code: string): string { return code.toUpperCase().replace(/[-.]/g, '_').replace(/^EDU_/, ''); }
export function messageForCode(code: string): string {
  switch (normalizedCode(code)) {
    case 'NOT_CONFIGURED': case 'BACKEND_NOT_CONFIGURED': case 'BACKEND_UNAVAILABLE': return CONFIGURATION_TEXT;
    case 'INVALID_CREDENTIALS': case 'AUTHENTICATION_FAILED': case 'LOGIN_FAILED':
      return 'Nie udało się zalogować do eduVULCAN. Sprawdź login i hasło do konta eduVULCAN.';
    case 'SESSION_EXPIRED': case 'SESSION_INVALID': case 'EXPIRED': case 'SESSION_MISSING': case 'PROVIDER_SESSION_EXPIRED':
      return 'Sesja eduVULCAN wygasła. Zaloguj się ponownie, aby odświeżyć szkolne dane.';
    case 'AUTH_REQUIRED': case 'UNAUTHORIZED': case 'UNAUTHENTICATED': case 'INVALID_TOKEN': case 'TOKEN_EXPIRED':
      return 'Sesja Naszej Rodziny wymaga ponownego zalogowania. Wyloguj się i zaloguj ponownie.';
    case 'FORBIDDEN': case 'PARENT_REQUIRED': return 'Wspólnym połączeniem rodziny zarządza aktywne konto Naszej Rodziny z rolą rodzica. Sprawdź rolę konta w ustawieniach rodziny.';
    case 'MEMBER_REQUIRED': case 'MEMBER_INACTIVE': case 'MEMBER_PROFILE_INVALID': case 'PROFILE_INCOMPLETE':
      return 'Konto Naszej Rodziny nie ma aktywnego profilu z dostępem do aplikacji. Sprawdź jego rolę i uprawnienia w ustawieniach rodziny, a następnie zaloguj się ponownie.';
    case 'PROFILE_NOT_FOUND': case 'INVALID_PROFILE': case 'PROFILE_CHANGED': case 'INVALID_STUDENT':
      return 'Wybrany dziennik jest niedostępny. Pobierz listę dostępów i ponownie wybierz szkołę.';
    case 'NO_PROFILES': return 'Konto eduVULCAN nie ma dostępnych, przyznanych dzienników. Sprawdź dostępy do dziecka w portalu eduVULCAN.';
    case 'PROFILE_AMBIGUOUS': return 'Lista dostępów jest niejednoznaczna. Sprawdź szkołę i klasę w portalu eduVULCAN, następnie jawnie wybierz właściwy dziennik.';
    case 'STUDENT_INACTIVE': return 'Wybrany dostęp jest nieaktywny lub archiwalny. Wybierz aktualny dziennik szkoły dziecka, zamiast wcześniejszego dostępu przedszkola.';
    case 'INVALID_PERSON': case 'INVALID_PERSON_KEY': return 'Wybierz dziecko z listy Naszej Rodziny.';
    case 'MFA_REQUIRED': case 'CAPTCHA_REQUIRED': case 'CHALLENGE_REQUIRED': case 'INTERACTIVE_LOGIN_REQUIRED':
      return 'eduVULCAN wymaga dodatkowego potwierdzenia logowania. Sprawdź konto w portalu eduVULCAN.';
    case 'SYNC_COOLDOWN': return 'Dane dziennika odświeżamy najwyżej co 5 minut. Odczekaj przed kolejną synchronizacją.';
    case 'LOGIN_COOLDOWN': return 'Zbyt wiele prób logowania do eduVULCAN. Odczekaj 15 minut, zanim spróbujesz ponownie.';
    case 'CONNECT_BUSY': return 'Serwer obsługuje już połączenie z dziennikiem. Poczekaj chwilę i sprawdź stan połączenia.';
    case 'SYNC_BUSY': return 'Synchronizacja już trwa. Poczekaj na jej zakończenie i sprawdź stan połączenia.';
    case 'NOT_CONNECTED': return 'Nie ma aktywnego połączenia z eduVULCAN. Sprawdź stan połączenia i zaloguj się do dziennika.';
    case 'SELECT_STUDENT': return 'Najpierw jawnie wybierz właściwy dziennik i dziecko w Naszej Rodzinie.';
    case 'CONNECTION_CHANGED': return 'Połączenie z dziennikiem zmieniło się podczas operacji. Sprawdź stan połączenia i ponownie wybierz właściwą szkołę.';
    case 'PROVIDER_BLOCKED': return 'eduVULCAN zablokował odczyt przez serwer integracji. Sprawdź dane w portalu dziennika; kolejne odświeżenie wymaga przywrócenia dostępu.';
    case 'RATE_LIMITED': case 'TOO_MANY_REQUESTS': return 'Dziennik ograniczył liczbę żądań. Odczekaj chwilę i spróbuj ponownie.';
    case 'PROVIDER_UNAVAILABLE': case 'UPSTREAM_UNAVAILABLE': case 'UPSTREAM_ERROR': case 'PROVIDER_ERROR':
      return 'eduVULCAN jest teraz niedostępny. Spróbuj ponownie później; dotychczasowe dane pozostają widoczne.';
    case 'UPSTREAM_TIMEOUT': return 'Odczyt eduVULCAN przekroczył limit czasu. Spróbuj ponownie później; dotychczasowe dane pozostają widoczne.';
    case 'PROVIDER_MARKUP_CHANGED': case 'SCHEMA_CHANGED': case 'UNSUPPORTED_PORTAL': case 'UNSUPPORTED_RESPONSE': case 'INVALID_DATA':
      return 'eduVULCAN zmienił format udostępnianych danych. Integracja wymaga aktualizacji po stronie serwera; dotychczasowe dane pozostają widoczne.';
    case 'DATA_LIMIT': return 'Dziennik zwrócił zbyt duży zakres danych do jednego odświeżenia. Dotychczasowe dane pozostają widoczne; potrzebne jest ograniczenie zakresu po stronie integracji.';
    case 'IMPORT_LIMIT': return 'Dziennik zwrócił zbyt wiele zmian do jednego odświeżenia. Dane lokalne nie zostały usunięte; potrzebna jest zmiana zakresu po stronie integracji.';
    case 'IMPORT_CONFLICT': return 'Własny wpis koliduje z wpisem dziennika. Został zachowany; integracja wymaga sprawdzenia po stronie serwera.';
    case 'INVALID_REQUEST': case 'METHOD_NOT_ALLOWED': return 'Nieprawidłowe żądanie integracji. Odśwież stronę i spróbuj ponownie.';
    case 'FORBIDDEN_ORIGIN': return 'Domena Naszej Rodziny nie odpowiada konfiguracji integracji na serwerze Vercel.';
    case 'SYNC_FAILED': case 'SERVER_ERROR': return 'Odświeżenie danych nie powiodło się. Dotychczasowe dane pozostają widoczne; spróbuj ponownie później.';
    case 'NETWORK_ERROR': case 'TIMEOUT': return 'Nie udało się połączyć z serwerem. Sprawdź internet i spróbuj ponownie.';
    case 'INVALID_RESPONSE': return 'Serwer integracji zwrócił nieprawidłową odpowiedź. Odśwież stan połączenia i spróbuj ponownie.';
    case 'HTTPS_REQUIRED': return 'Połączenie z eduVULCAN wymaga otwarcia Naszej Rodziny przez bezpieczny adres HTTPS.';
    default: return 'Nie udało się wykonać operacji eduVULCAN. Spróbuj ponownie lub otwórz dziennik w jego portalu.';
  }
}

export class EduVulcanError extends Error {
  constructor(public code: string) { super(messageForCode(code)); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EduVulcanError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function requiredText(value: unknown, limit = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new EduVulcanError('INVALID_RESPONSE');
  return value;
}
function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredText(value);
}
function optionalTime(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') throw new EduVulcanError('INVALID_RESPONSE');
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) throw new EduVulcanError('INVALID_RESPONSE');
  return time.toISOString();
}
function parseCounts(value: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(object(value))) {
    if (key.length > 80 || typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 100000) throw new EduVulcanError('INVALID_RESPONSE');
    counts[key] = count;
  }
  return counts;
}
function parseWarnings(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 50) throw new EduVulcanError('INVALID_RESPONSE');
  return value.map((warning) => requiredText(warning, 1500));
}

/** Validate server responses before rendering school/profile choices; never infer a selected profile. */
function parseReply(value: unknown): EduVulcanReply {
  const reply = object(value);
  if (reply.ok === false) {
    const error = object(reply.error);
    throw new EduVulcanError(requiredText(error.code, 100));
  }
  if (reply.ok !== true) throw new EduVulcanError('INVALID_RESPONSE');
  const source = object(reply.status);
  if (typeof source.configured !== 'boolean' || !['disconnected', 'needs_profile', 'connected', 'expired'].includes(String(source.state)) || !Array.isArray(source.profiles) || source.profiles.length > 100) throw new EduVulcanError('INVALID_RESPONSE');
  const profiles: EduVulcanProfile[] = source.profiles.map((value) => {
    const profile = object(value);
    return { id: requiredText(profile.id, 512), studentName: requiredText(profile.studentName), schoolName: requiredText(profile.schoolName),
      schoolSymbol: optionalText(profile.schoolSymbol), className: optionalText(profile.className), academicYear: optionalText(profile.academicYear) };
  });
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new EduVulcanError('INVALID_RESPONSE');
  let selectedStudent: EduVulcanStatus['selectedStudent'];
  if (source.selectedStudent !== undefined && source.selectedStudent !== null) {
    const selected = object(source.selectedStudent);
    selectedStudent = { profileId: requiredText(selected.profileId, 512), personKey: requiredText(selected.personKey, 80) };
    if (!(SCHOOL_PEOPLE as readonly string[]).includes(selectedStudent.personKey)) throw new EduVulcanError('INVALID_RESPONSE');
  }
  if (source.state === 'connected' && (!selectedStudent || !profiles.some((profile) => profile.id === selectedStudent?.profileId))) throw new EduVulcanError('INVALID_RESPONSE');
  const status: EduVulcanStatus = {
    configured: source.configured, state: source.state as EduVulcanStatus['state'], profiles, selectedStudent,
    expiresAt: optionalTime(source.expiresAt), lastSyncAt: optionalTime(source.lastSyncAt), lastSuccessAt: optionalTime(source.lastSuccessAt),
    lastErrorCode: optionalText(source.lastErrorCode),
    nextSyncAt: optionalTime(source.nextSyncAt),
    counts: source.counts === undefined || source.counts === null ? undefined : parseCounts(source.counts), warnings: parseWarnings(source.warnings),
  };
  if (source.scope !== undefined) {
    if (source.scope !== 'family' && source.scope !== 'student') throw new EduVulcanError('INVALID_RESPONSE');
    status.scope = source.scope;
  }
  if (source.accountRole !== undefined) {
    if (source.accountRole !== 'parent' && source.accountRole !== 'student') throw new EduVulcanError('INVALID_RESPONSE');
    status.accountRole = source.accountRole;
  }
  status.connectedByUid = optionalText(source.connectedByUid);
  if (source.syncing !== undefined) {
    if (typeof source.syncing !== 'boolean') throw new EduVulcanError('INVALID_RESPONSE');
    status.syncing = source.syncing;
  }
  let sync: EduVulcanReply['sync'];
  if (reply.sync !== undefined) {
    const data = object(reply.sync);
    sync = { counts: parseCounts(data.counts), warnings: parseWarnings(data.warnings) };
  }
  return { ok: true, status, sync };
}

async function requestApi(action: ApiAction, user: User, signal: AbortSignal, body?: Record<string, string>): Promise<EduVulcanReply> {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (window.location.protocol !== 'https:' && !local) throw new EduVulcanError('HTTPS_REQUIRED');
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== user.uid) throw new EduVulcanError('AUTH_REQUIRED');
  const token = await currentUser.getIdToken();
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  if (auth.currentUser?.uid !== user.uid) throw new EduVulcanError('AUTH_REQUIRED');
  let response: Response;
  try {
    response = await fetch(`/api/eduvulcan/${action}`, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(action === 'status' ? {} : { 'Content-Type': 'application/json' }) },
      ...(action === 'status' ? {} : { body: JSON.stringify(body || {}) }),
      signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
  } catch (error) {
    if (signal.aborted || (error as Error).name === 'AbortError') throw error;
    throw new EduVulcanError('NETWORK_ERROR');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new EduVulcanError('BACKEND_UNAVAILABLE');
  let value: unknown;
  try { value = await response.json(); } catch { throw new EduVulcanError('INVALID_RESPONSE'); }
  const reply = parseReply(value);
  if (!response.ok) throw new EduVulcanError(response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'FORBIDDEN' : 'PROVIDER_UNAVAILABLE');
  if (action === 'connect' && reply.status.state !== 'needs_profile') throw new EduVulcanError('INVALID_RESPONSE');
  if (action === 'select' && (reply.status.state !== 'connected' || reply.status.selectedStudent?.profileId !== body?.profileId || reply.status.selectedStudent?.personKey !== body?.personKey)) throw new EduVulcanError('INVALID_RESPONSE');
  if (action === 'disconnect' && reply.status.state !== 'disconnected') throw new EduVulcanError('INVALID_RESPONSE');
  if (action === 'sync' && reply.status.state !== 'connected') throw new EduVulcanError(reply.status.state === 'expired' ? 'SESSION_EXPIRED' : 'CONNECTION_CHANGED');
  return reply;
}

type PublicStatusCache = {
  reply?: EduVulcanReply;
  error?: unknown;
  checkedAt?: number;
  request?: Promise<EduVulcanReply>;
  sync?: Promise<EduVulcanReply>;
};
const statusCache = new Map<string, PublicStatusCache>();
const statusListeners = new Map<string, Set<(status: EduVulcanStatus) => void>>();
const STATUS_CACHE_MS = 60_000;

function entryFor(uid: string): PublicStatusCache {
  let entry = statusCache.get(uid);
  if (!entry) { entry = {}; statusCache.set(uid, entry); }
  return entry;
}

function remember(uid: string, reply: EduVulcanReply) {
  const entry = entryFor(uid);
  entry.reply = reply;
  entry.error = undefined;
  entry.checkedAt = Date.now();
  if (auth.currentUser?.uid === uid) statusListeners.get(uid)?.forEach(listener => listener(reply.status));
}

async function forCaller(request: Promise<EduVulcanReply>, user: User, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  const reply = await request;
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  if (auth.currentUser?.uid !== user.uid) throw new EduVulcanError('AUTH_REQUIRED');
  return reply;
}

async function boundedRequest(action: ApiAction, user: User) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try { return await requestApi(action, user, controller.signal); }
  finally { window.clearTimeout(timeout); }
}

/** A single public status request is shared by startup and the School panel.
 * The cache is memory-only, UID-specific, and contains no credentials/session.
 */
export async function readEduStatus(user: User, signal: AbortSignal, force = false): Promise<EduVulcanReply> {
  if (auth.currentUser?.uid !== user.uid) throw new EduVulcanError('AUTH_REQUIRED');
  const entry = entryFor(user.uid);
  if (entry.sync) return forCaller(entry.sync, user, signal);
  if (entry.request) return forCaller(entry.request, user, signal);
  if (!force && entry.checkedAt !== undefined && Date.now() - entry.checkedAt < STATUS_CACHE_MS) {
    if (entry.error) throw entry.error;
    if (entry.reply) return forCaller(Promise.resolve(entry.reply), user, signal);
  }
  entry.request = boundedRequest('status', user).then(reply => {
    remember(user.uid, reply);
    return reply;
  }).catch(error => {
    entry.error = error;
    entry.checkedAt = Date.now();
    throw error;
  }).finally(() => { entry.request = undefined; });
  return forCaller(entry.request, user, signal);
}

export function subscribeEduStatus(uid: string, listener: (status: EduVulcanStatus) => void) {
  let listeners = statusListeners.get(uid);
  if (!listeners) { listeners = new Set(); statusListeners.set(uid, listeners); }
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) statusListeners.delete(uid); };
}

/** Mutations keep the existing endpoint bodies and backend rate limits. */
export async function callApi(action: ApiAction, user: User, signal: AbortSignal, body?: Record<string, string>): Promise<EduVulcanReply> {
  if (action === 'status') return readEduStatus(user, signal, true);
  if (action !== 'sync') {
    const reply = await requestApi(action, user, signal, body);
    remember(user.uid, reply);
    return reply;
  }
  const entry = entryFor(user.uid);
  if (!entry.sync) {
    const previous = entry.reply;
    if (previous) remember(user.uid, { ...previous, status: { ...previous.status, syncing: true } });
    entry.sync = boundedRequest('sync', user).then(reply => {
      remember(user.uid, reply);
      return reply;
    }).catch(error => {
      if (previous) {
        const expired = error instanceof EduVulcanError && ['SESSION_EXPIRED', 'SESSION_INVALID', 'EXPIRED', 'SESSION_MISSING', 'PROVIDER_SESSION_EXPIRED'].includes(normalizedCode(error.code));
        remember(user.uid, { ...previous, status: { ...previous.status, syncing: false,
          ...(expired ? { state: 'expired', lastErrorCode: (error as EduVulcanError).code } : {}) } });
      }
      throw error;
    }).finally(() => { entry.sync = undefined; });
  }
  return forCaller(entry.sync, user, signal);
}
