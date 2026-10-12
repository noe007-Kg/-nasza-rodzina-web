import { useEffect, useId, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import type { CalendarEventData } from '../app-shared';
import { familyV2WritesAllowed, assertFamilyV2WriteAllowed } from '../family-v2-client';
import { SecondaryButton } from '../ui';
import { calendarRequest, calendarsChanged } from './calendar-client';
import { calendarErrorMessage, type CalendarConnection } from './model';

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
  const [range, setRange] = useState(connection.historyRange || { from: '', to: '' });
  const prefix = useId();
  const validRange = !!range.from && !!range.to && range.from <= range.to;
  useEffect(() => { setRange(connection.historyRange || { from: '', to: '' }); }, [connection.id, connection.historyRange?.from, connection.historyRange?.to]);
  useEffect(() => { setProgress(connection.historyProgress); }, [connection.id, connection.historyProgress]);
  async function history(operation: 'preview' | 'import', restart = false) {
    await action.run(async signal => {
      let first = true;
      while (!signal.aborted && auth.currentUser?.uid === user.uid) {
        const reply = await calendarRequest<{ historyProgress: NonNullable<CalendarConnection['historyProgress']>; complete: boolean }>('history', user, { connectionId: connection.id, operation, ...range, ...(first && restart ? { restart: true } : {}) }, signal);
        if (signal.aborted || auth.currentUser?.uid !== user.uid) return;
        setProgress(reply.historyProgress); first = false;
        if (reply.complete) return operation === 'preview' ? `Sprawdzono ${reply.historyProgress.processed} wpisów i serii w wybranym okresie. Import pozostaje prywatny.` : 'Historia została zaimportowana do Twojego prywatnego kalendarza.';
      }
    });
  }
  const eligible = connection.selectionConfirmed && connection.status === 'connected';
  return <div className="calendar-history-tools">
    <h4>Prywatny import z Google Calendar</h4>
    <p className="calendar-connection-help">Wybierz okres historii. Najpierw sprawdzimy liczbę wpisów, a skopiujemy je dopiero po Twoim potwierdzeniu. Serie są liczone jako jeden wpis; ich wyjątki pozostają zachowane. Nowe wydarzenia trafiają tylko do Twojego prywatnego kalendarza.</p>
    <div className="calendar-history-range">
      <label htmlFor={`${prefix}-from`}>Historia od<input id={`${prefix}-from`} type="date" value={range.from} disabled={action.busy || !!connection.historyComplete && !!connection.historyRange} onChange={event => { setRange(value => ({ ...value, from: event.target.value })); setProgress(null); }} /></label>
      <label htmlFor={`${prefix}-to`}>Historia do<input id={`${prefix}-to`} type="date" min={range.from || undefined} value={range.to} disabled={action.busy || !!connection.historyComplete && !!connection.historyRange} onChange={event => { setRange(value => ({ ...value, to: event.target.value })); setProgress(null); }} /></label>
    </div>
    {connection.mode === 'sync' && <p className="calendar-connection-help">Po imporcie będziemy odświeżać zmiany w tym okresie oraz nowe przyszłe wydarzenia. Wcześniejsza historia poza wybranym zakresem nie zostanie automatycznie skopiowana.</p>}
    {progress && <p role="status" className="calendar-connection-help">{progress.phase === 'preview' ? 'Sprawdzono' : 'Przetworzono'}: {progress.processed}{progress.total !== null ? ` z około ${progress.total}` : ''}{progress.complete ? ' — zakończono' : ' — trwa pobieranie stron'}</p>}
    {progress?.phase === 'import' && progress.total !== null && <progress aria-label="Postęp importu historii" max={Math.max(progress.total, 1)} value={progress.complete ? Math.max(progress.total, 1) : Math.min(progress.processed, Math.max(progress.total - 1, 0))} />}
    <div className="calendar-connection-actions">
      <SecondaryButton disabled={action.busy || !eligible || !action.enabled || !validRange} onClick={() => void history('preview', true)}>Sprawdź liczbę wydarzeń</SecondaryButton>
      {progress?.phase === 'preview' && progress.complete && <SecondaryButton disabled={action.busy || !eligible || !action.enabled || !validRange} onClick={() => void history('import')}>Potwierdzam prywatny import wybranego okresu</SecondaryButton>}
      {progress?.phase === 'import' && !progress.complete && <SecondaryButton disabled={action.busy || !eligible || !action.enabled || !validRange} onClick={() => void history('import')}>Kontynuuj import</SecondaryButton>}
    </div>
    {!action.enabled && <p className="calendar-connection-help">Preview: import do danych produkcyjnych jest zablokowany. Testowanie zapisu wymaga oddzielnego projektu Firebase.</p>}
    {action.notice && <p role="status" className="calendar-connection-help">{action.notice}</p>}
  </div>;
}

// Stage one is read-only even if an old connection still carries write flags.
// Keep the public component names so the existing calendar integration remains
// compatible; no authorization or provider-write controls are rendered.
export function CalendarGoogleWriteSettings(_props: { user: User; connection: CalendarConnection }) { return null; }
export function CalendarGoogleExportControls(_props: { user: User; eventId: string }) { return null; }
export function CalendarGoogleEditControls(_props: { user: User; event: CalendarEventData }) { return null; }

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
