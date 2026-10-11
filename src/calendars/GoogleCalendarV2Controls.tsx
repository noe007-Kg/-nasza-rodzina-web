import { useEffect, useId, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import type { CalendarEventData } from '../app-shared';
import { familyV2WritesAllowed, assertFamilyV2WriteAllowed } from '../family-v2-client';
import { SecondaryButton } from '../ui';
import { calendarRequest, calendarsChanged, readCalendarStatus } from './calendar-client';
import { authorizedCalendarUrl, calendarErrorMessage, type CalendarConnection } from './model';

function useGoogleAction(user: User) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, [user.uid]);
  const current = () => alive.current && auth.currentUser?.uid === user.uid;
  async function run(operation: (signal: AbortSignal) => Promise<string | void>) {
    if (controller.current || !current()) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setNotice('');
    try { assertFamilyV2WriteAllowed(); const message = await operation(request.signal); if (current() && !request.signal.aborted) { setNotice(message || 'Zapisano.'); calendarsChanged(); } }
    catch (reason) { if (current() && !request.signal.aborted) setNotice(calendarErrorMessage(reason)); }
    finally { if (controller.current === request) controller.current = null; if (current()) setBusy(false); }
  }
  return { busy, notice, run, enabled: familyV2WritesAllowed() };
}

export function CalendarHistoryControls({ user, connection }: { user: User; connection: CalendarConnection }) {
  const action = useGoogleAction(user), [progress, setProgress] = useState(connection.historyProgress);
  useEffect(() => { setProgress(connection.historyProgress); }, [connection.id, connection.historyProgress]);
  async function history(operation: 'preview' | 'import', restart = false) {
    await action.run(async signal => {
      let first = true;
      while (!signal.aborted && auth.currentUser?.uid === user.uid) {
        const reply = await calendarRequest<{ historyProgress: NonNullable<CalendarConnection['historyProgress']>; complete: boolean }>('history', user, { connectionId: connection.id, operation, ...(first && restart ? { restart: true } : {}) }, signal);
        if (signal.aborted || auth.currentUser?.uid !== user.uid) return;
        setProgress(reply.historyProgress); first = false;
        if (reply.complete) return operation === 'preview' ? `Sprawdzono ${reply.historyProgress.processed} wydarzeń i serii. Import pozostaje prywatny.` : 'Historia została zaimportowana do Twojego prywatnego kalendarza.';
      }
    });
  }
  const eligible = connection.selectionConfirmed && connection.status === 'connected';
  return <div className="calendar-history-tools">
    <h4>Pełna historia Google</h4>
    <p className="calendar-connection-help">Wszystkie lata, bez ograniczenia do ostatnich miesięcy. Serie są liczone jako jeden wpis; ich terminy i wyjątki pozostają zachowane. Nowe wydarzenia: tylko Ty.</p>
    {progress && <p role="status" className="calendar-connection-help">{progress.phase === 'preview' ? 'Sprawdzono' : 'Przetworzono'}: {progress.processed}{progress.total !== null ? ` z około ${progress.total}` : ''}{progress.complete ? ' — zakończono' : ' — trwa pobieranie stron'}</p>}
    {progress?.phase === 'import' && progress.total !== null && <progress aria-label="Postęp importu historii" max={Math.max(progress.total, 1)} value={progress.complete ? Math.max(progress.total, 1) : Math.min(progress.processed, Math.max(progress.total - 1, 0))} />}
    <div className="calendar-connection-actions">
      <SecondaryButton disabled={action.busy || !eligible || !action.enabled} onClick={() => void history('preview', true)}>Sprawdź liczbę wydarzeń</SecondaryButton>
      {progress?.phase === 'preview' && progress.complete && <SecondaryButton disabled={action.busy || !eligible || !action.enabled} onClick={() => void history('import')}>Importuj historię — tylko ja</SecondaryButton>}
      {progress?.phase === 'import' && !progress.complete && <SecondaryButton disabled={action.busy || !eligible || !action.enabled} onClick={() => void history('import')}>Kontynuuj import</SecondaryButton>}
    </div>
    {!action.enabled && <p className="calendar-connection-help">Preview: import do danych produkcyjnych jest zablokowany. Testowanie zapisu wymaga oddzielnego projektu Firebase.</p>}
    {action.notice && <p role="status" className="calendar-connection-help">{action.notice}</p>}
  </div>;
}

export function CalendarGoogleWriteSettings({ user, connection }: { user: User; connection: CalendarConnection }) {
  const action = useGoogleAction(user);
  return <details className="calendar-write-settings"><summary>Eksport i synchronizacja dwukierunkowa</summary>
    <p className="calendar-connection-help">Domyślnie tylko odczyt. Zapis wymaga zakończonego importu historii i osobnej zgody OAuth. Udostępnienie rodzinie nie zmienia uprawnień oryginalnego kalendarza Google.</p>
    <p className="calendar-connection-help">Zgoda na zapis: {connection.writeAuthorized ? 'udzielona' : 'nieudzielona'} · Synchronizacja dwukierunkowa: {connection.twoWayEnabled ? 'włączona' : 'wyłączona'}</p>
    <div className="calendar-connection-actions">
      {!connection.writeAuthorized && <SecondaryButton disabled={action.busy || !action.enabled || !connection.historyComplete} onClick={() => void action.run(async signal => {
        const reply = await calendarRequest<{ authorizationUrl: string }>('start', user, { connectionId: connection.id, ownerProfileId: connection.ownerProfileId, visibility: connection.visibility, mode: connection.mode, write: true }, signal);
        if (!signal.aborted && auth.currentUser?.uid === user.uid) window.location.assign(authorizedCalendarUrl(reply.authorizationUrl));
      })}>Udziel Google zgody na zapis</SecondaryButton>}
      {connection.writeAuthorized && <SecondaryButton disabled={action.busy || !action.enabled || !connection.historyComplete || !connection.selectionConfirmed || connection.status !== 'connected' || connection.mode !== 'sync'} onClick={() => {
        if (!connection.twoWayEnabled && !window.confirm('Włączyć zapis zmian w oryginalnym kalendarzu Google? Konflikty nie będą automatycznie nadpisywane, a usunięcia wymagają sprawdzenia.')) return;
        void action.run(async signal => { await calendarRequest('twoway', user, { connectionId: connection.id, enabled: !connection.twoWayEnabled }, signal); return connection.twoWayEnabled ? 'Wyłączono zapis dwukierunkowy.' : 'Włączono synchronizację dwukierunkową.'; });
      }}>{connection.twoWayEnabled ? 'Wyłącz synchronizację dwukierunkową' : 'Włącz synchronizację dwukierunkową'}</SecondaryButton>}
    </div>{action.notice && <p role="status" className="calendar-connection-help">{action.notice}</p>}
  </details>;
}

function useOwnedConnections(user: User) {
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void readCalendarStatus(user, controller.signal).then(reply => { if (!controller.signal.aborted && auth.currentUser?.uid === user.uid) setConnections(reply.connections); }).catch(() => {}); };
    refresh(); window.addEventListener('calendar-connections-changed', refresh);
    return () => { controller.abort(); window.removeEventListener('calendar-connections-changed', refresh); };
  }, [user.uid]);
  return connections;
}

export function CalendarGoogleExportControls({ user, eventId }: { user: User; eventId: string }) {
  const action = useGoogleAction(user), connections = useOwnedConnections(user).filter(connection => connection.writeAuthorized && connection.historyComplete && connection.selectionConfirmed && connection.status === 'connected');
  const [selected, setSelected] = useState(''), prefix = useId();
  if (!connections.length) return <p className="calendar-connection-help">Eksport do Google: najpierw sprawdź import i udziel zgody na zapis w Ustawieniach → Połączone kalendarze.</p>;
  return <div className="calendar-export-tools"><label htmlFor={prefix}>Wyślij kopię do kalendarza Google</label>
    <select id={prefix} value={selected} onChange={event => setSelected(event.target.value)} disabled={action.busy}><option value="">Wybierz kalendarz</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.calendarName}</option>)}</select>
    <SecondaryButton disabled={!selected || action.busy || !action.enabled} onClick={() => void action.run(async signal => {
      const reply = await calendarRequest<{ alreadyExported?: boolean }>('export', user, { connectionId: selected, eventId }, signal);
      return reply.alreadyExported ? 'To wydarzenie jest już powiązane z Google — nie utworzono duplikatu.' : 'Wyeksportowano do wybranego kalendarza Google.';
    })}>Eksportuj świadomie</SecondaryButton>{action.notice && <p role="status">{action.notice}</p>}
  </div>;
}

const inputDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function CalendarGoogleEditControls({ user, event }: { user: User; event: CalendarEventData }) {
  const action = useGoogleAction(user), connections = useOwnedConnections(user), connection = connections.find(value => value.id === event.sourceConnectionId);
  const [title, setTitle] = useState(event.title), [description, setDescription] = useState(event.description), [location, setLocation] = useState(event.location || ''), [start, setStart] = useState(inputDate(event.date)), [end, setEnd] = useState(inputDate(event.endDate));
  if (!connection?.twoWayEnabled || !connection.historyComplete || event.sourceOwnerUid !== user.uid || event.sourceExceptionTombstone) return null;
  return <details className="calendar-write-settings"><summary>Edytuj i zapisz w Google</summary>
    {event.sourceRecurrence?.length ? <p className="calendar-connection-help">To definicja serii. Zmiana dotyczy całej serii w Google. Pojedyncze przeniesione wystąpienia zachowują swoje wyjątki.</p> : null}
    <form className="calendar-source-form" onSubmit={submit => { submit.preventDefault(); void action.run(async signal => {
      await calendarRequest('update', user, { connectionId: connection.id, eventId: event.id, patch: { title, description, location, date: new Date(start).toISOString(), endDate: new Date(end).toISOString(), allDay: event.allDay } }, signal); return 'Zapisano w Google i odświeżono lokalną wersję.';
    }); }}>
      <label>Nazwa<input value={title} onChange={value => setTitle(value.target.value)} required maxLength={500} /></label>
      <label>Początek<input type="datetime-local" value={start} onChange={value => setStart(value.target.value)} required /></label>
      <label>Koniec<input type="datetime-local" value={end} onChange={value => setEnd(value.target.value)} required /></label>
      <label>Opis<textarea value={description} onChange={value => setDescription(value.target.value)} maxLength={10000} /></label>
      <label>Lokalizacja<input value={location} onChange={value => setLocation(value.target.value)} maxLength={2000} /></label>
      <SecondaryButton type="submit" disabled={action.busy || !action.enabled}>Zapisz zmianę w Google</SecondaryButton>
    </form>{action.notice && <p role="status">{action.notice}</p>}
  </details>;
}

export function CalendarGoogleBulkSharing({ user, events }: { user: User; events: readonly CalendarEventData[] }) {
  const action = useGoogleAction(user), [selected, setSelected] = useState<string[]>([]), [visibility, setVisibility] = useState<'private' | 'family'>('family');
  const own = events.filter(event => event.source === 'google' && event.sourceOwnerUid === user.uid && event.ownerUid === user.uid && !!event.sourceConnectionId && !event.sourceExceptionTombstone).slice().sort((a, b) => b.date.getTime() - a.date.getTime());
  if (!own.length) return null;
  return <details className="calendar-google-sharing"><summary>Udostępnij wybrane wydarzenia Google</summary>
    <p className="calendar-connection-help">Zmienia wyłącznie widoczność w Naszej Rodzinie. Google nie otrzymuje zmian ustawień udostępniania. Maksymalnie 100 wydarzeń naraz.</p>
    <div className="calendar-sharing-list">{own.map(event => <label key={event.id}><input type="checkbox" checked={selected.includes(event.id)} disabled={action.busy || selected.length >= 100 && !selected.includes(event.id)} onChange={value => setSelected(ids => value.target.checked ? [...ids, event.id] : ids.filter(id => id !== event.id))} /><span>{event.title} · {event.date.toLocaleDateString('pl-PL')} · {event.private ? 'Tylko ja' : 'Rodzinny'}</span></label>)}</div>
    <label>Widoczność<select value={visibility} onChange={event => setVisibility(event.target.value as 'private' | 'family')}><option value="private">Tylko ja</option><option value="family">Udostępnij rodzinie</option></select></label>
    <SecondaryButton disabled={action.busy || !selected.length || !action.enabled} onClick={() => void action.run(async signal => {
      const groups = new Map<string, string[]>(); for (const id of selected) { const event = own.find(value => value.id === id); if (!event?.sourceConnectionId) continue; const ids = groups.get(event.sourceConnectionId) || []; ids.push(id); groups.set(event.sourceConnectionId, ids); }
      for (const [connectionId, eventIds] of groups) await calendarRequest('visibilitybatch', user, { connectionId, eventIds, visibility }, signal);
      if (!signal.aborted && auth.currentUser?.uid === user.uid) setSelected([]); return 'Zmieniono widoczność wybranych wydarzeń. Oryginalny kalendarz Google nie został udostępniony.';
    })}>Zastosuj do {selected.length} wydarzeń</SecondaryButton>{action.notice && <p role="status">{action.notice}</p>}
  </details>;
}
