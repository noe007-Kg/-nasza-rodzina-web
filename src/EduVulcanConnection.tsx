import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { auth } from './firebase';
import { SCHOOL_PEOPLE } from './school-import';
import './edu-vulcan.css';

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
type EduVulcanReply = {
  ok: true;
  status: EduVulcanStatus;
  sync?: { counts: Record<string, number>; warnings?: string[] };
};
type ApiAction = 'status' | 'connect' | 'select' | 'sync' | 'disconnect';
type Operation = 'loading' | 'connect' | 'select' | 'sync' | 'disconnect' | null;

const CONFIGURATION_TEXT = 'Połączenie z eduVULCAN wymaga funkcji serwerowych Vercel i konfiguracji integracji. Samo wgranie plików strony na hosting statyczny nie uruchamia synchronizacji.';
const COUNT_LABELS: Record<string, string> = {
  grade: 'Oceny', grades: 'Oceny', lesson: 'Lekcje', lessons: 'Lekcje', timetable: 'Lekcje',
  test: 'Sprawdziany', tests: 'Sprawdziany', exams: 'Sprawdziany',
  homework: 'Zadania domowe', homeworks: 'Zadania domowe',
  message: 'Wiadomości rodzica', messages: 'Wiadomości rodzica', activity: 'Zajęcia dodatkowe',
};

function normalizedCode(code: string): string { return code.toUpperCase().replace(/[-.]/g, '_').replace(/^EDU_/, ''); }
function messageForCode(code: string): string {
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

class EduVulcanError extends Error {
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

async function callApi(action: ApiAction, user: User, signal: AbortSignal, body?: Record<string, string>): Promise<EduVulcanReply> {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (window.location.protocol !== 'https:' && !local) throw new EduVulcanError('HTTPS_REQUIRED');
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== user.uid) throw new EduVulcanError('AUTH_REQUIRED');
  const token = await currentUser.getIdToken();
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
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

function displayTime(value?: string): string {
  return value ? new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Jeszcze nie odświeżano';
}

export function EduVulcanConnection({ user, member, onSelectedStudent }: { user: User; member: { role?: string } | null; onSelectedStudent?: (personKey: string) => void }) {
  const parent = member?.role === 'parent';
  const [status, setStatus] = useState<EduVulcanStatus | null>(null);
  const [operation, setOperation] = useState<Operation>(parent ? 'loading' : null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [profileId, setProfileId] = useState('');
  const [personKey, setPersonKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncResult, setSyncResult] = useState<EduVulcanReply['sync']>();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  const [backendMissing, setBackendMissing] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const controller = useRef<AbortController | null>(null);
  const identity = `${user.uid}:${parent}`;
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const selectionCallback = useRef(onSelectedStudent);
  selectionCallback.current = onSelectedStudent;
  const headingId = useId();
  const errorId = useId();
  const busy = operation !== null;
  const expired = status?.state === 'expired' || !!(status?.expiresAt && new Date(status.expiresAt).getTime() <= clock);
  const cooldown = !!(status?.nextSyncAt && new Date(status.nextSyncAt).getTime() > clock);
  const connectionProfile = status?.profiles.find((profile) => profile.id === status.selectedStudent?.profileId);
  const chosenProfile = status?.profiles.find((profile) => profile.id === profileId);
  const showLogin = !backendMissing && !accessDenied && status?.configured !== false && (!status || status.state === 'disconnected' || expired || reconnect);
  const showProfiles = !!status?.configured && status.state === 'needs_profile' && !expired && !reconnect;

  useEffect(() => {
    setStatus(null); setPassword(''); setLogin(''); setProfileId(''); setPersonKey(''); setError(''); setNotice('');
    setSyncResult(undefined); setConfirmDisconnect(false); setReconnect(false); setBackendMissing(false); setAccessDenied(false);
    if (!parent) { setOperation(null); return; }
    const request = new AbortController();
    controller.current?.abort(); controller.current = request; setOperation('loading');
    const originalIdentity = identity;
    void callApi('status', user, request.signal).then((reply) => {
      if (!request.signal.aborted && activeIdentity.current === originalIdentity) {
        setStatus(reply.status); setClock(Date.now());
        if (reply.status.selectedStudent) selectionCallback.current?.(reply.status.selectedStudent.personKey);
        if (reply.status.counts) setSyncResult({ counts: reply.status.counts, warnings: reply.status.warnings });
      }
    }).catch((error: unknown) => {
      if (request.signal.aborted || activeIdentity.current !== originalIdentity) return;
      setBackendMissing(error instanceof EduVulcanError && ['BACKEND_UNAVAILABLE', 'NOT_CONFIGURED', 'BACKEND_NOT_CONFIGURED'].includes(normalizedCode(error.code)));
      setAccessDenied(error instanceof EduVulcanError && ['AUTH_REQUIRED', 'UNAUTHORIZED', 'UNAUTHENTICATED', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'FORBIDDEN', 'PARENT_REQUIRED', 'MEMBER_REQUIRED', 'MEMBER_INACTIVE', 'MEMBER_PROFILE_INVALID', 'PROFILE_INCOMPLETE'].includes(normalizedCode(error.code)));
      setError(error instanceof EduVulcanError ? error.message : messageForCode('NETWORK_ERROR'));
    }).finally(() => { if (!request.signal.aborted && activeIdentity.current === originalIdentity) setOperation(null); });
    return () => { request.abort(); controller.current?.abort(); };
  }, [parent, user.uid, refresh]);

  useEffect(() => {
    if (!parent || (!status?.expiresAt && !status?.nextSyncAt)) return;
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [parent, status?.expiresAt, status?.nextSyncAt]);

  async function perform(action: Exclude<ApiAction, 'status'>, body?: Record<string, string>): Promise<EduVulcanReply | undefined> {
    if (!parent || busy) return;
    const request = new AbortController();
    controller.current?.abort(); controller.current = request;
    const originalIdentity = identity;
    setOperation(action); setError(''); setNotice('');
    try {
      const reply = await callApi(action, user, request.signal, body);
      if (request.signal.aborted || activeIdentity.current !== originalIdentity) return;
      setStatus(reply.status); setClock(Date.now());
      if (action === 'select' && reply.status.selectedStudent) selectionCallback.current?.(reply.status.selectedStudent.personKey);
      if (reply.sync) setSyncResult(reply.sync);
      else if (reply.status.counts) setSyncResult({ counts: reply.status.counts, warnings: reply.status.warnings });
      else if (action === 'select') setSyncResult(undefined);
      if (action === 'connect') { setProfileId(''); setPersonKey(''); setReconnect(false); setSyncResult(undefined); setNotice('Wybierz właściwy dziennik i przypisz go do dziecka.'); }
      if (action === 'sync') setNotice('Odświeżanie danych zostało zakończone. Sprawdź zakres i ewentualne ostrzeżenia poniżej.');
      if (action === 'disconnect') { setProfileId(''); setPersonKey(''); setLogin(''); setSyncResult(undefined); setConfirmDisconnect(false); setReconnect(false); setNotice('Dostęp do eduVULCAN został usunięty. Wpisy ręczne i pobrana historia pozostają w Naszej Rodzinie. Historia z dziennika jest tylko do odczytu.'); }
      return reply;
    } catch (error) {
      if (request.signal.aborted || activeIdentity.current !== originalIdentity) return;
      if (error instanceof EduVulcanError) {
        setError(error.message);
        if (['SESSION_EXPIRED', 'SESSION_INVALID', 'EXPIRED', 'SESSION_MISSING', 'PROVIDER_SESSION_EXPIRED'].includes(normalizedCode(error.code))) {
          setStatus((previous) => previous ? { ...previous, state: 'expired', lastErrorCode: error.code } : previous);
          setProfileId(''); setPersonKey('');
        }
        if (['BACKEND_UNAVAILABLE', 'NOT_CONFIGURED', 'BACKEND_NOT_CONFIGURED'].includes(normalizedCode(error.code))) setBackendMissing(true);
        if (['AUTH_REQUIRED', 'UNAUTHORIZED', 'UNAUTHENTICATED', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'FORBIDDEN', 'PARENT_REQUIRED', 'MEMBER_REQUIRED', 'MEMBER_INACTIVE', 'MEMBER_PROFILE_INVALID', 'PROFILE_INCOMPLETE'].includes(normalizedCode(error.code))) setAccessDenied(true);
      } else setError(messageForCode('NETWORK_ERROR'));
    } finally {
      if (action === 'connect') setPassword('');
      if (!request.signal.aborted && activeIdentity.current === originalIdentity) setOperation(null);
    }
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    if (!login.trim() || !password || busy) return;
    await perform('connect', { login: login.trim(), password });
  }
  async function selectProfile(event: FormEvent) {
    event.preventDefault();
    if (!chosenProfile || !(SCHOOL_PEOPLE as readonly string[]).includes(personKey) || busy) return;
    const selected = await perform('select', { profileId: chosenProfile.id, personKey });
    if (selected?.status.state === 'connected' && selected.status.selectedStudent) {
      await perform('sync');
    }
  }

  if (!parent) return null;
  return <section className="edu-vulcan-connection" aria-labelledby={headingId} aria-busy={busy}>
    <header className="edu-vulcan-heading"><div className="edu-vulcan-brand" aria-hidden="true">🔗</div><div><span className="edu-vulcan-eyebrow">Dziennik szkolny · wspólne konto rodziny</span><h2 id={headingId}>eduVULCAN</h2><p>Jedno aktywne konto rodzica w eduVULCAN udostępnia szkolne dane dziecka rodzinie. Oboje rodzice mogą zarządzać połączeniem w Naszej Rodzinie.</p></div><span className={`edu-vulcan-state ${status?.state === 'connected' && !expired ? 'connected' : ''}`} role="status">{operation === 'loading' ? 'Sprawdzanie…' : operation === 'sync' ? 'Synchronizowanie…' : expired ? 'Sesja wygasła' : status?.state === 'connected' ? 'Połączono' : status?.state === 'needs_profile' ? 'Wybierz dziennik' : 'Niepołączono'}</span></header>
    <div className="edu-vulcan-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Sprawdź stan połączenia</button></div>
    {error && !backendMissing && <div id={errorId} className="edu-vulcan-error" role="alert">{error}</div>}
    {notice && <p className="edu-vulcan-notice" role="status">{notice}</p>}
    {(backendMissing || status?.configured === false) && <div className="edu-vulcan-configuration" role={backendMissing ? 'alert' : undefined}><strong>Integracja wymaga backendu Vercel</strong><p>{CONFIGURATION_TEXT}</p></div>}
    {expired && <p className="edu-vulcan-expired">Sesja dziennika wygasła. Dotychczas pobrane informacje mogą być nieaktualne; zaloguj się ponownie, aby je odświeżyć.</p>}
    {showLogin && !backendMissing && <form className="edu-vulcan-login" onSubmit={(event) => void submitLogin(event)}><fieldset disabled={busy}>
      <div className="edu-vulcan-login-intro"><h3>Połącz konto</h3><p>{expired || reconnect ? 'Połącz ponownie aktywne konto rodzica w eduVULCAN. ' : 'Podaj login i hasło aktywnego konta rodzica w eduVULCAN, np. konta Dominiki z dostępem do Nikodema. '}Są to dane dziennika, niezależne od konta, którym logujesz się do Naszej Rodziny. Po logowaniu wybierz właściwą szkołę dziecka. <a href="https://eduvulcan.pl/" target="_blank" rel="noopener noreferrer">Otwórz portal eduVULCAN ↗</a></p></div>
      <label className="edu-vulcan-field"><span>Login lub e-mail eduVULCAN</span><input name="eduvulcan-login" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required value={login} onChange={(event) => setLogin(event.target.value)} aria-describedby={error ? errorId : undefined} /></label>
      <label className="edu-vulcan-field"><span>Hasło eduVULCAN</span><input name="eduvulcan-password" type="password" autoComplete="current-password" maxLength={1024} required value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={error ? errorId : undefined} /></label>
      <p className="edu-vulcan-secret-note">Dane logowania trafiają przez HTTPS do zabezpieczonego backendu. Hasła nie zapisujemy w przeglądarce ani w Firestore; pole jest czyszczone po próbie połączenia. Sesja dziennika jest szyfrowana na serwerze.</p>
      <div className="edu-vulcan-actions"><button className="primary-button" disabled={busy || !login.trim() || !password}>{operation === 'connect' ? 'Łączenie…' : 'Połącz'}</button>{reconnect && !expired && <button type="button" className="secondary-button" onClick={() => { setReconnect(false); setPassword(''); setError(''); }}>Anuluj</button>}</div>
    </fieldset></form>}
    {showProfiles && !backendMissing && <form className="edu-vulcan-select" onSubmit={(event) => void selectProfile(event)}><fieldset disabled={busy}>
      <legend>Wybierz właściwy dziennik</legend><p>To samo dziecko może mieć kilka dostępów, np. przedszkole i Szkołę Podstawową nr 4 (SP4). Sprawdź szkołę, klasę i rok. Wybór wymaga Twojego potwierdzenia.</p>
      <div className="edu-vulcan-profiles">{status.profiles.map((profile) => <label className={`edu-vulcan-profile ${profileId === profile.id ? 'selected' : ''}`} key={profile.id}><input type="radio" name="eduvulcan-profile" value={profile.id} checked={profileId === profile.id} onChange={() => setProfileId(profile.id)} /><span><strong>{profile.studentName}</strong><span>{profile.schoolName}{profile.schoolSymbol ? ` · ${profile.schoolSymbol}` : ''}</span><small>{[profile.className ? `Klasa ${profile.className}` : '', profile.academicYear ? `Rok ${profile.academicYear}` : ''].filter(Boolean).join(' · ')}</small></span></label>)}</div>
      {!status.profiles.length && <p className="edu-vulcan-empty">Dziennik nie zwrócił dostępnych profili. Sprawdź przyznane dostępy w portalu eduVULCAN.</p>}
      <label className="edu-vulcan-field"><span>Dziecko w Naszej Rodzinie</span><select aria-label="Dziecko w Naszej Rodzinie" value={personKey} onChange={(event) => setPersonKey(event.target.value)} required><option value="">Wybierz dziecko…</option>{SCHOOL_PEOPLE.map((person) => <option value={person} key={person}>{person}</option>)}</select></label>
      {chosenProfile && personKey && <p className="edu-vulcan-mapping"><strong>{chosenProfile.schoolName}</strong> · {chosenProfile.studentName} → <strong>{personKey}</strong></p>}
      <div className="edu-vulcan-actions"><button className="primary-button" disabled={busy || !chosenProfile || !personKey}>{operation === 'select' ? 'Zapisywanie wyboru…' : 'Połącz wybrany dziennik'}</button><button type="button" className="secondary-button" onClick={() => { setReconnect(true); setProfileId(''); setPersonKey(''); setPassword(''); }}>Użyj innego konta</button></div>
    </fieldset></form>}
    {status?.configured && status.selectedStudent && connectionProfile && <div className="edu-vulcan-summary"><h3>Wybrany dostęp</h3><strong>{connectionProfile.studentName} · {connectionProfile.schoolName}</strong><p>{[connectionProfile.schoolSymbol, connectionProfile.className ? `Klasa ${connectionProfile.className}` : '', connectionProfile.academicYear].filter(Boolean).join(' · ')}<span>Przypisano do: <b>{status.selectedStudent.personKey}</b></span></p><dl><div><dt>Ostatnia udana synchronizacja</dt><dd>{displayTime(status.lastSuccessAt)}</dd></div>{status.lastSyncAt && status.lastSyncAt !== status.lastSuccessAt && <div><dt>Ostatnia próba synchronizacji</dt><dd>{displayTime(status.lastSyncAt)}</dd></div>}{status.expiresAt && <div><dt>Ważność sesji dziennika</dt><dd>{displayTime(status.expiresAt)}</dd></div>}</dl></div>}
    {status?.lastErrorCode && !error && <p className="edu-vulcan-error" role="alert">{messageForCode(status.lastErrorCode)}</p>}
    {syncResult && <div className="edu-vulcan-sync-result"><h3>Zakres ostatniego odświeżenia</h3><div className="edu-vulcan-counts">{Object.entries(syncResult.counts).map(([kind, count]) => <div key={kind}><strong>{count}</strong><span>{COUNT_LABELS[kind] || 'Wpisy szkolne'}</span></div>)}</div>{syncResult.warnings?.length ? <div className="edu-vulcan-warnings" role="status"><strong>Nie wszystkie dane udało się odczytać</strong><ul>{syncResult.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><p>Brak odczytu nie oznacza braku wpisów w dzienniku. Sprawdź te informacje w eduVULCAN.</p></div> : <p className="edu-vulcan-readonly">Wpisy z eduVULCAN są tylko do odczytu. Własne wpisy rodzinne pozostają zachowane.</p>}</div>}
    {status?.configured && status.state === 'connected' && !expired && !reconnect && <><div className="edu-vulcan-actions"><button type="button" className="primary-button" disabled={busy || backendMissing || cooldown || status.syncing} onClick={() => void perform('sync')}>{operation === 'sync' || status.syncing ? 'Synchronizowanie…' : 'Synchronizuj teraz'}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { setReconnect(true); setProfileId(''); setPersonKey(''); setPassword(''); }}>Zmień dostęp</button></div>{cooldown && <p className="edu-vulcan-readonly">Kolejna synchronizacja będzie dostępna od {displayTime(status.nextSyncAt)}. Dane odświeżamy najwyżej co 5 minut.</p>}</>}
    {status?.configured && (status.state !== 'disconnected' || status.selectedStudent) && <div className="edu-vulcan-disconnect">{confirmDisconnect ? <><strong>Rozłączyć eduVULCAN dla rodziny?</strong><p>Usuniemy wspólną sesję po stronie serwera i zatrzymamy synchronizację dla obojga rodziców. Własne wpisy i pobrana historia pozostają zachowane; historia dziennika nadal jest tylko do odczytu.</p><div className="edu-vulcan-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Anuluj rozłączenie</button><button type="button" className="danger-button" disabled={busy} onClick={() => void perform('disconnect')}>{operation === 'disconnect' ? 'Usuwanie dostępu…' : 'Rozłącz i usuń dostęp'}</button></div></> : <button type="button" className="edu-vulcan-disconnect-link" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Rozłącz</button>}</div>}
    <footer className="edu-vulcan-footer"><span>Wiadomości pobrane z dziennika są dostępne tylko rodzicom. Integracja nie wysyła wiadomości ani nie zmienia danych w szkole.</span><a href="https://uczen.eduvulcan.pl/" target="_blank" rel="noopener noreferrer">Otwórz eduVULCAN ↗</a></footer>
  </section>;
}

export default EduVulcanConnection;
