import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { SCHOOL_PEOPLE } from './school-import';
import { Card, Icon, StatusPill } from './ui';
import './edu-vulcan.css';

export type { EduVulcanProfile, EduVulcanStatus } from './school/edu-client';
import { callApi, readEduStatus, subscribeEduStatus, CONFIGURATION_TEXT, normalizedCode, messageForCode, EduVulcanError, type EduVulcanStatus, type EduVulcanReply, type ApiAction } from './school/edu-client';
import { manualSyncAvailableAt } from './school/activation-sync';
type Operation = 'loading' | 'connect' | 'select' | 'sync' | 'disconnect' | null;

const COUNT_LABELS: Record<string, string> = {
  grade: 'Oceny', grades: 'Oceny', lesson: 'Lekcje', lessons: 'Lekcje', timetable: 'Lekcje',
  test: 'Sprawdziany', tests: 'Sprawdziany', exams: 'Sprawdziany',
  homework: 'Zadania domowe', homeworks: 'Zadania domowe',
  message: 'Wiadomości rodzica', messages: 'Wiadomości rodzica', activity: 'Zajęcia dodatkowe',
};

function displayTime(value?: string): string {
  return value ? new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Jeszcze nie odświeżano';
}

export function EduVulcanConnection({ user, member, onSelectedStudent, onConnectionStatus }: { user: User; member: { role?: string } | null; onSelectedStudent?: (personKey: string) => void; onConnectionStatus?: (status: EduVulcanStatus | null) => void }) {
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
  const statusCallback = useRef(onConnectionStatus);
  statusCallback.current = onConnectionStatus;
  const headingId = useId();
  const errorId = useId();
  const busy = operation !== null;
  const expired = status?.state === 'expired' || !!(status?.expiresAt && new Date(status.expiresAt).getTime() <= clock);
  const availableAt = manualSyncAvailableAt(status);
  const cooldown = availableAt !== undefined && availableAt > clock;
  const connectionProfile = status?.profiles.find((profile) => profile.id === status.selectedStudent?.profileId);
  const chosenProfile = status?.profiles.find((profile) => profile.id === profileId);
  const showLogin = !backendMissing && !accessDenied && status?.configured !== false && (!status || status.state === 'disconnected' || expired || reconnect);
  const showProfiles = !!status?.configured && status.state === 'needs_profile' && !expired && !reconnect;

  // Share already loaded public status with the visual school header. This does
  // not add a request, change synchronization or expose any session credentials.
  useEffect(() => {
    statusCallback.current?.(parent ? (status && expired ? { ...status, state: 'expired' } : status) : null);
  }, [status, expired, parent, user.uid]);

  useEffect(() => {
    setStatus(null); setPassword(''); setLogin(''); setProfileId(''); setPersonKey(''); setError(''); setNotice('');
    setSyncResult(undefined); setConfirmDisconnect(false); setReconnect(false); setBackendMissing(false); setAccessDenied(false);
    if (!parent) { setOperation(null); return; }
    const request = new AbortController();
    controller.current?.abort(); controller.current = request; setOperation('loading');
    const originalIdentity = identity;
    void readEduStatus(user, request.signal, refresh > 0).then((reply) => {
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
    if (!parent) return;
    return subscribeEduStatus(user.uid, next => {
      setStatus(next); setClock(Date.now());
      if (next.configured) { setBackendMissing(false); setAccessDenied(false); }
      if (next.configured && !next.lastErrorCode) setError('');
      if (next.selectedStudent) selectionCallback.current?.(next.selectedStudent.personKey);
      if (next.counts) setSyncResult({ counts: next.counts, warnings: next.warnings });
    });
  }, [parent, user.uid]);

  useEffect(() => {
    if (!parent) return;
    // Only UI expiry/cooldown boundaries use a one-shot timeout. No interval
    // fetches a journal while the app is open or in the background.
    let timer: number | undefined;
    const update = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      setClock(now);
      const boundaries = [availableAt, status?.expiresAt ? Date.parse(status.expiresAt) : undefined]
        .filter((time): time is number => time !== undefined && time > now);
      if (boundaries.length) timer = window.setTimeout(update, Math.min(2_147_483_647, Math.min(...boundaries) - now + 100));
    };
    document.addEventListener('visibilitychange', update);
    update();
    return () => { if (timer !== undefined) window.clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
  }, [parent, availableAt, status?.expiresAt]);

  async function perform(action: Exclude<ApiAction, 'status'>, body?: Record<string, string>): Promise<EduVulcanReply | undefined> {
    if (!parent || busy) return;
    const available = manualSyncAvailableAt(status);
    if (action === 'sync' && available !== undefined && available > Date.now()) {
      setClock(Date.now());
      setNotice(`Dane odświeżono bardzo niedawno. Kolejna synchronizacja będzie dostępna od ${displayTime(new Date(available).toISOString())}.`);
      return;
    }
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
  return <Card as="section" tone="blue" className="edu-vulcan-connection" aria-labelledby={headingId} aria-busy={busy}>
    <header className="edu-vulcan-heading"><div className="edu-vulcan-brand" aria-hidden="true"><Icon name="link" /></div><div><span className="edu-vulcan-eyebrow">Dziennik szkolny · wspólne konto rodziny</span><h2 id={headingId}>eduVULCAN</h2><p>Jedno aktywne konto rodzica w eduVULCAN udostępnia szkolne dane dziecka rodzinie. Oboje rodzice mogą zarządzać połączeniem w Naszej Rodzinie.</p></div><StatusPill tone={expired ? 'warning' : status?.state === 'connected' ? 'success' : 'neutral'} className={`edu-vulcan-state ${status?.state === 'connected' && !expired ? 'connected' : ''}`} role="status">{operation === 'loading' ? 'Sprawdzanie…' : operation === 'sync' ? 'Synchronizowanie…' : expired ? 'Sesja wygasła' : status?.state === 'connected' ? 'Połączono' : status?.state === 'needs_profile' ? 'Wybierz dziennik' : 'Niepołączono'}</StatusPill></header>
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
    {status?.configured && status.state === 'connected' && !expired && !reconnect && <><div className="edu-vulcan-actions"><button type="button" className="primary-button" disabled={busy || backendMissing || cooldown || status.syncing} onClick={() => void perform('sync')}>{operation === 'sync' || status.syncing ? 'Synchronizowanie…' : 'Synchronizuj teraz'}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { setReconnect(true); setProfileId(''); setPersonKey(''); setPassword(''); }}>Zmień dostęp</button></div>{cooldown && <p className="edu-vulcan-readonly" role="status">Dane odświeżono bardzo niedawno. Kolejna synchronizacja będzie dostępna od {displayTime(new Date(availableAt!).toISOString())}. Dane odświeżamy najwyżej co 5 minut.</p>}</>}
    {status?.configured && (status.state !== 'disconnected' || status.selectedStudent) && <div className="edu-vulcan-disconnect">{confirmDisconnect ? <><strong>Rozłączyć eduVULCAN dla rodziny?</strong><p>Usuniemy wspólną sesję po stronie serwera i zatrzymamy synchronizację dla obojga rodziców. Własne wpisy i pobrana historia pozostają zachowane; historia dziennika nadal jest tylko do odczytu.</p><div className="edu-vulcan-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Anuluj rozłączenie</button><button type="button" className="danger-button" disabled={busy} onClick={() => void perform('disconnect')}>{operation === 'disconnect' ? 'Usuwanie dostępu…' : 'Rozłącz i usuń dostęp'}</button></div></> : <button type="button" className="edu-vulcan-disconnect-link" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Rozłącz</button>}</div>}
    <footer className="edu-vulcan-footer"><span>Wiadomości pobrane z dziennika są dostępne tylko rodzicom. Integracja nie wysyła wiadomości ani nie zmienia danych w szkole.</span><a href="https://uczen.eduvulcan.pl/" target="_blank" rel="noopener noreferrer">Otwórz eduVULCAN ↗</a></footer>
  </Card>;
}

export default EduVulcanConnection;
