import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { Modal, type Member } from '../app-shared';
import { useFamilyDirectory } from '../family-directory';
import { Card, Icon, PrimaryButton, SecondaryButton, StatusPill } from '../ui';
import { calendarRequest, listExternalCalendars, readCalendarStatus } from './calendar-client';
import { authorizedCalendarUrl, availableCalendarOwners, calendarErrorMessage, calendarOwnerName, manualCalendarSyncAvailableAt, type CalendarConnection, type CalendarMode, type CalendarNotice, type CalendarStatusResponse, type CalendarVisibility, type ExternalCalendar } from './model';
import './calendars.css';

type Choices = { ownerProfileId: string; visibility: CalendarVisibility | ''; mode: CalendarMode };
type Setup = { connection: CalendarConnection; calendars: ExternalCalendar[]; calendarId: string; choices: Choices };
const statusLabels: Record<CalendarConnection['status'], string> = { connected: 'Połączono', disconnected: 'Rozłączono', 'needs-reconnect': 'Połącz ponownie', imported: 'Import zakończony' };
function syncDate(value: string | null) { return value ? new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Jeszcze nie pobierano'; }

function CalendarChoices({ value, onChange, profiles, prefix, disabled, locked = false }: { value: Choices; onChange(value: Choices): void; profiles: ReturnType<typeof availableCalendarOwners>; prefix: string; disabled: boolean; locked?: boolean }) {
  return <>
    <label htmlFor={`${prefix}-owner`}>Przypisz wydarzenia do</label>
    <select id={`${prefix}-owner`} value={value.ownerProfileId} onChange={event => onChange({ ...value, ownerProfileId: event.target.value })} required disabled={disabled || locked}>
      <option value="" disabled>Wybierz profil</option><option value="family">Cała rodzina</option>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name || profile.personKey || 'Profil rodziny'}</option>)}
    </select>
    <fieldset className="calendar-visibility-choice" disabled={disabled}>
      <legend>Gdzie mają być widoczne wydarzenia?</legend>
      <label><input type="radio" name={`${prefix}-visibility`} value="private" checked={value.visibility === 'private'} onChange={() => onChange({ ...value, visibility: 'private' })} required /><span><Icon name="shield" /> Prywatny</span></label>
      <label><input type="radio" name={`${prefix}-visibility`} value="family" checked={value.visibility === 'family'} onChange={() => onChange({ ...value, visibility: 'family' })} required /><span><Icon name="users" /> Rodzinny</span></label>
    </fieldset>
    <p className="calendar-connection-help">{value.visibility === 'private' ? 'Prywatne wydarzenia zobaczysz tylko Ty, także po przypisaniu ich do profilu innej osoby.' : value.visibility === 'family' ? 'Wydarzenia będą widoczne w kalendarzu rodzinnym dla uprawnionych członków.' : 'Wybierz widoczność. Przypisanie profilu samo nie udostępnia wydarzeń.'}</p>
    <label htmlFor={`${prefix}-mode`}>Sposób pobierania</label>
    <select id={`${prefix}-mode`} value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as CalendarMode })} disabled={disabled || locked}>
      <option value="sync">Synchronizacja z Google do Naszej Rodziny</option><option value="import">Import jednorazowy</option>
    </select>
  </>;
}

export function ConnectedCalendarsSettings({ user, member, notice, children }: { user: User; member: Member | null; notice?: CalendarNotice; children?: ReactNode }) {
  const directory = useFamilyDirectory();
  const profiles = availableCalendarOwners(directory, user.uid, member?.role === 'parent');
  const [status, setStatus] = useState<CalendarStatusResponse | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [choices, setChoices] = useState<Choices>({ ownerProfileId: user.uid, visibility: '', mode: 'sync' });
  const [setup, setSetup] = useState<Setup | null>(null);
  const [disconnect, setDisconnect] = useState<CalendarConnection | null>(null);
  const [removeEvents, setRemoveEvents] = useState<boolean | null>(null);
  const prefix = useId();
  const controllers = useRef(new Set<AbortController>()), alive = useRef(false), refreshVersion = useRef(0), busyRef = useRef(false);
  const current = () => alive.current && auth.currentUser?.uid === user.uid;
  async function refresh(signal?: AbortSignal) {
    const version = ++refreshVersion.current;
    const reply = await readCalendarStatus(user, signal);
    if (current() && !signal?.aborted && version === refreshVersion.current) { setStatus(reply); setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController(); controllers.current.add(controller);
    const reload = () => { if (current()) void refresh(controller.signal).catch(reason => { if (current() && !controller.signal.aborted) { setError(calendarErrorMessage(reason)); setLoading(false); } }); };
    reload(); window.addEventListener('calendar-connections-changed', reload);
    return () => { alive.current = false; ++refreshVersion.current; controllers.current.forEach(value => value.abort()); controllers.current.clear(); window.removeEventListener('calendar-connections-changed', reload); };
  }, [user.uid]);

  async function perform(operation: (signal: AbortSignal) => Promise<void>) {
    if (busyRef.current || !current()) return;
    busyRef.current = true; setBusy(true); setError(''); setSuccess('');
    const controller = new AbortController(); controllers.current.add(controller);
    try { await operation(controller.signal); }
    catch (reason) {
      if (current() && !controller.signal.aborted) {
        setError(calendarErrorMessage(reason));
        try { await refresh(controller.signal); } catch { /* Keep the last safe public status while offline. */ }
      }
    }
    finally { controllers.current.delete(controller); busyRef.current = false; if (current()) setBusy(false); }
  }
  async function start(event?: FormEvent, connection?: CalendarConnection) {
    event?.preventDefault();
    const selection = connection ? { ownerProfileId: connection.ownerProfileId, visibility: connection.visibility, mode: connection.mode } : choices;
    if (!selection.visibility || !selection.ownerProfileId) { setError('Wybierz profil i widoczność wydarzeń.'); return; }
    await perform(async signal => {
      const reply = await calendarRequest<{ ok: true; authorizationUrl: string }>('start', user, { ...selection, ...(connection ? { connectionId: connection.id } : {}) }, signal);
      if (current() && !signal.aborted) window.location.assign(authorizedCalendarUrl(reply.authorizationUrl));
    });
  }
  async function chooseCalendar(connection: CalendarConnection) {
    await perform(async signal => {
      const calendars = await listExternalCalendars(user, connection.id, signal);
      if (!current() || signal.aborted) return;
      if (!calendars.length) { setError('Google nie udostępnił żadnego kalendarza. Sprawdź dostęp na swoim koncie Google.'); return; }
      const selected = calendars.find(calendar => calendar.id === connection.calendarId) || calendars.find(calendar => calendar.primary) || calendars[0];
      setSetup({ connection, calendars, calendarId: selected.id, choices: { ownerProfileId: connection.ownerProfileId, visibility: connection.visibility, mode: connection.mode } });
    });
  }
  async function saveSelection(event: FormEvent) {
    event.preventDefault();
    if (!setup || !setup.choices.visibility || !setup.choices.ownerProfileId || !setup.calendarId) return;
    const selected = setup;
    await perform(async signal => {
      await calendarRequest('configure', user, { connectionId: selected.connection.id, calendarId: selected.calendarId, ...selected.choices }, signal);
      await refresh(signal);
      if (current() && !signal.aborted) setSetup(null);
      await calendarRequest('sync', user, { connectionId: selected.connection.id }, signal);
      await refresh(signal);
      if (current() && !signal.aborted) { setSetup(null); setSuccess(selected.choices.mode === 'import' ? 'Pobrano wydarzenia. Import jednorazowy zakończony.' : 'Pobrano wydarzenia. Kalendarz będzie odświeżany automatycznie, także przy zamkniętej aplikacji.'); }
    });
  }
  async function synchronize(connection: CalendarConnection) {
    const availableAt = manualCalendarSyncAvailableAt(connection);
    if (availableAt !== null && availableAt > Date.now()) { setError('Dane były odświeżane przed chwilą. Odczekaj minutę przed kolejnym pobraniem.'); return; }
    await perform(async signal => { await calendarRequest('sync', user, { connectionId: connection.id }, signal); await refresh(signal); if (current() && !signal.aborted) setSuccess('Kalendarz został odświeżony.'); });
  }
  async function removeConnection(event: FormEvent) {
    event.preventDefault(); if (!disconnect || removeEvents === null) return;
    const connectionId = disconnect.id, remove = removeEvents;
    await perform(async signal => { await calendarRequest('disconnect', user, { connectionId, removeEvents: remove }, signal); await refresh(signal); if (current() && !signal.aborted) { setDisconnect(null); setSuccess(remove ? 'Rozłączono kalendarz i usunięto wyłącznie wydarzenia z tego źródła.' : 'Rozłączono kalendarz. Wcześniej pobrane wydarzenia pozostają w aplikacji.'); } });
  }

  return <Card as="section" className="connected-calendars family-ui" id="connected-calendars" data-testid="connected-calendars">
    <header className="account-section-heading"><span className="account-section-icon"><Icon name="calendar" /></span><div><h2>Połączone kalendarze</h2><p>Google Calendar i istniejący import plików .ics</p></div></header>
    {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={notice.tone === 'error' ? 'account-error' : 'account-success'}>{notice.message}</p>}
    {success && <p role="status" className="account-success">{success}</p>}
    {error && <p role="alert" className="account-error">{error}</p>}
    {loading && <p role="status" className="calendar-connection-help">Sprawdzam połączone kalendarze…</p>}
    {!loading && <SecondaryButton disabled={busy} onClick={() => void perform(async signal => { await refresh(signal); })}>Sprawdź stan połączeń</SecondaryButton>}
    {status?.configured === false && <p className="calendar-connection-help" data-testid="calendar-not-configured">Google Calendar wymaga konfiguracji serwera. Pozostałe funkcje aplikacji oraz import i eksport .ics działają bez tej konfiguracji.</p>}
    {status && status.connections.length > 0 && <div className="calendar-connection-list">{status.connections.map(connection => <article key={connection.id} className="calendar-connection" data-testid="calendar-connection" data-connection-id={connection.id}>
      <header><div><h3>{connection.calendarName || 'Google Calendar'}</h3><p>{calendarOwnerName(connection, directory)} · {connection.visibility === 'private' ? 'Prywatny — tylko Ty' : 'Rodzinny'}</p></div><StatusPill tone={connection.status === 'connected' || connection.status === 'imported' ? 'success' : 'warning'}>{connection.selectionConfirmed || connection.status !== 'connected' ? statusLabels[connection.status] : 'Wybierz kalendarz'}</StatusPill></header>
      <p className="calendar-connection-help">{connection.mode === 'sync' ? 'Synchronizacja w jedną stronę' : 'Import jednorazowy'} · Ostatnie pobranie: {syncDate(connection.lastSuccessfulSyncAt)}</p>
      {connection.lastErrorCode && <p className="calendar-connection-help">{connection.status === 'needs-reconnect' ? 'Google wymaga ponownego połączenia. Zapisane wydarzenia pozostają w aplikacji.' : 'Nie udało się odświeżyć. Spróbujemy ponownie.'}</p>}
      <div className="calendar-connection-actions">
        {status.configured && connection.status === 'connected' && (connection.selectionConfirmed ? <SecondaryButton disabled={busy} onClick={() => void synchronize(connection)}>{connection.mode === 'import' ? 'Importuj teraz' : 'Synchronizuj teraz'}</SecondaryButton> : <PrimaryButton disabled={busy} onClick={() => void chooseCalendar(connection)}>Wybierz kalendarz</PrimaryButton>)}
        {status.configured && connection.status === 'connected' && connection.selectionConfirmed && <SecondaryButton disabled={busy} onClick={() => void chooseCalendar(connection)}>Ustawienia źródła</SecondaryButton>}
        {status.configured && (connection.status === 'needs-reconnect' || connection.status === 'disconnected') && <SecondaryButton disabled={busy} onClick={() => void start(undefined, connection)}>Połącz ponownie</SecondaryButton>}
        {connection.status !== 'disconnected' && <SecondaryButton disabled={busy} onClick={() => { setRemoveEvents(null); setDisconnect(connection); }}>Rozłącz</SecondaryButton>}
      </div>
    </article>)}</div>}
    {status?.configured && <form className="calendar-source-form" onSubmit={event => void start(event)}>
      <h3>Dodaj Google Calendar</h3><p className="calendar-connection-help">Zgoda na odczyt kalendarza jest niezależna od logowania Google do Naszej Rodziny. Nie wysyłamy zmian do Google.</p>
      <CalendarChoices value={choices} onChange={setChoices} profiles={profiles} prefix={`${prefix}-new`} disabled={busy} />
      <PrimaryButton type="submit" disabled={busy || !choices.visibility || !choices.ownerProfileId}>Połącz Google Calendar</PrimaryButton>
    </form>}
    <div className="calendar-ics-tools"><h3>Apple / iCloud, Outlook i pliki .ics</h3><p className="calendar-connection-help">Obecnie obsługujemy je przez jednorazowy import lub eksport .ics. Automatyczna synchronizacja tych źródeł nie jest włączona.</p>{children}</div>
    {setup && <Modal title="Wybierz kalendarz Google" onClose={() => { if (!busy) setSetup(null); }}>
      <form className="calendar-source-form" onSubmit={event => void saveSelection(event)} data-testid="calendar-selection-form">
        <label htmlFor={`${prefix}-calendar`}>Kalendarz Google</label><select id={`${prefix}-calendar`} value={setup.calendarId} disabled={busy || !!setup.connection.lastSuccessfulSyncAt} onChange={event => setSetup({ ...setup, calendarId: event.target.value })}>{setup.calendars.map(calendar => <option value={calendar.id} key={calendar.id}>{calendar.name}{calendar.primary ? ' (główny)' : ''} · {calendar.timeZone}</option>)}</select>
        <CalendarChoices value={setup.choices} onChange={value => setSetup({ ...setup, choices: value })} profiles={profiles} prefix={`${prefix}-configure`} disabled={busy} locked={!!setup.connection.lastSuccessfulSyncAt} />
        <p className="calendar-connection-help">Domyślna widoczność dotyczy nowych wydarzeń. Kolejna synchronizacja zachowa indywidualną widoczność wcześniej pobranych wydarzeń.</p>
        {error && <p className="account-error" role="alert">{error}</p>}
        <div className="calendar-connection-actions"><SecondaryButton disabled={busy} onClick={() => setSetup(null)}>Anuluj</SecondaryButton><PrimaryButton type="submit" disabled={busy || !setup.choices.visibility}>{busy ? 'Pobieram…' : 'Potwierdź i pobierz wydarzenia'}</PrimaryButton></div>
      </form>
    </Modal>}
    {disconnect && <Modal title="Rozłączyć kalendarz?" onClose={() => { if (!busy) setDisconnect(null); }}>
      <form className="calendar-source-form" onSubmit={event => void removeConnection(event)}>
        <p>Wybierz, co zrobić z wydarzeniami pochodzącymi z tego źródła.</p>
        <fieldset className="calendar-disconnect-choice" disabled={busy}><legend>Wcześniej pobrane wydarzenia</legend>
          <label><input type="radio" name={`${prefix}-disconnect`} checked={removeEvents === false} onChange={() => setRemoveEvents(false)} required />Pozostaw wcześniej pobrane wydarzenia</label>
          <label><input type="radio" name={`${prefix}-disconnect`} checked={removeEvents === true} onChange={() => setRemoveEvents(true)} required />Usuń wydarzenia pochodzące wyłącznie z tego źródła</label>
        </fieldset>
        {error && <p className="account-error" role="alert">{error}</p>}
        <div className="calendar-connection-actions"><SecondaryButton disabled={busy} onClick={() => setDisconnect(null)}>Anuluj</SecondaryButton><PrimaryButton type="submit" disabled={busy || removeEvents === null}>{busy ? 'Rozłączam…' : 'Potwierdź rozłączenie'}</PrimaryButton></div>
      </form>
    </Modal>}
  </Card>;
}
