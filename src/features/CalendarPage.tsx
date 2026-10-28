import { useMusicSchoolPlans, musicCalendarEvents } from '../school/music-school-client';
import { auth, addDays, addMonths, capitalize, collection, db, DetailRow, doc, downloadFile, endOfDay, errorMessage, eventActivityIcon, formatDateInput, formatTime, formatTimeInput, generateOccurrences, isParent, Modal, ModuleHeader, notify, ownPerson, parseLocalDate, personColor, personEventClass, personLabel, PersonSelect, React, sameDay, startOfDay, startOfWeek, useEffect, useMemo, useRef, useState, weekTitle, type CalendarEventData, type CalendarOccurrence, type CalendarView, type EventForm, type Member, type Page, type PersonKey, type RepeatType, type User } from '../app-shared';
import { exportCalendarIcs, importCalendarIcs } from '../calendar-ics';
import { planSeriesDelete, planSeriesUpdate, seriesScopeLabel, type SeriesScope } from '../calendar-series';
import { commitCalendarPlan, subscribeCalendar } from '../calendar-store';
import { describeRecurrence, type RecurrenceUnit } from '../calendar-utils';
import { useFamilyDirectory } from '../family-directory';
import { memberPersonKey } from '../family-members';
import { projectOkruszekCalendar, projectSchoolCalendar } from '../calendar-source-projections';
import { projectManualSchoolCalendar } from '../calendar-school-display';
import { useCalendarSchoolSources } from '../useCalendarSchoolSources';
import { calendarSourceDisplayEvent, canChangeGoogleVisibility } from '../calendar-source-metadata';
import { calendarRequest } from '../calendars/calendar-client';
import { CalendarRequestError, calendarErrorMessage } from '../calendars/model';
import './calendar-package.css';
import './calendar-sources.css';
import './calendar-v2.css';
import './calendar-timeline.css';
import './calendar-schedule.css';
import { calendarEventInView, calendarOwnerColor, calendarOwnerProfile, projectFamilyBirthdays, isImportantCalendarEvent } from '../calendar-v2';
import { calendarOccurrencesOnDay, calendarRangeDisplaySources, calendarTimelineRange, formatWarsawTime, layoutCalendarTimeline, timelineMinuteLabel, warsawCalendarDayRange, warsawDayKey, type CalendarTimelineBlock } from '../calendar-timeline';
import { CalendarOwnerBadge } from '../CalendarOwnerBadge';
import { generateCalendarOccurrencesFromSources } from '../calendars/google-occurrences';
import { useCalendarHealthSources } from '../health/useCalendarHealthSources';
import { useFinanceCalendarSources } from '../finance/useFinanceCalendarSources';
import { CalendarGoogleExportControls, CalendarGoogleBulkSharing, CalendarGoogleEditControls } from '../calendars/GoogleCalendarV2Controls';


export function CalendarPage({ user, member, goTo, requestedSelection }: { user: User; member: Member | null; goTo: (page:Page)=>void; requestedSelection?: { person: PersonKey; requestId: number } }) {
  const familyDirectory = useFamilyDirectory();
  const activeProfiles = useMemo(() => familyDirectory.filter(profile => profile.active !== false && !profile.archived && !profile.disabled), [familyDirectory]);
  const personOptions = ['family', ...new Set(activeProfiles.map(memberPersonKey).filter(Boolean))];
  const [view, setView] = useState<CalendarView>('schedule');
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [calendarState, setCalendarState] = useState<{ uid: string; events: CalendarEventData[] }>({ uid: user.uid, events: [] });
  const events = calendarState.uid === user.uid ? calendarState.events : [];
  const currentCalendarUid = useRef(user.uid);
  currentCalendarUid.current = user.uid;
  const schoolSources = useCalendarSchoolSources(user.uid, member);
  const musicSources = useMusicSchoolPlans(user.uid, schoolSources.scope);
  const musicEvents = useMemo(() => musicCalendarEvents(musicSources.data?.plans || [], activeProfiles), [musicSources.data, activeProfiles]);
  const schoolProjection = useMemo(() => projectSchoolCalendar(schoolSources.rows, events, schoolSources.access, activeProfiles), [schoolSources.rows, schoolSources.scope, events, activeProfiles]);
  const manualSchoolProjection = useMemo(() => projectManualSchoolCalendar(schoolSources.rows, events, schoolSources.access), [schoolSources.rows, schoolSources.scope, events]);
  const okruszekEvents = useMemo(() => projectOkruszekCalendar(schoolSources.rows, events, schoolSources.access, activeProfiles), [schoolSources.rows, schoolSources.scope, events, activeProfiles]);
  const healthSources = useCalendarHealthSources({ uid: user.uid, member });
  const financeSources = useFinanceCalendarSources({ uid: user.uid, member });
  const birthdayEvents = useMemo(() => projectFamilyBirthdays(activeProfiles), [activeProfiles]);
  const projectionEvents = useMemo(() => [...schoolProjection.events, ...manualSchoolProjection.events, ...okruszekEvents, ...musicEvents, ...healthSources.events, ...financeSources.events, ...birthdayEvents], [schoolProjection.events, manualSchoolProjection.events, okruszekEvents, musicEvents, healthSources.events, financeSources.events, birthdayEvents]);
  const projectionScope = `${schoolSources.scope}|${user.uid}|${musicSources.data?.plans.map(p => p.id + ':' + p.revision).join(',') || ''}`;
  const displayEvents = useMemo(() => [...events.map(calendarSourceDisplayEvent), ...projectionEvents], [events, projectionEvents]);
  const own = ownPerson(member);
  const [selectedPerson, setSelectedPerson] = useState<PersonKey>(() => isParent(member) ? 'family' : ownPerson(member));
  const [importantExpanded, setImportantExpanded] = useState(false);
  const selectionUid = useRef(user.uid);
  useEffect(() => { if (selectionUid.current !== user.uid) { selectionUid.current = user.uid; setSelectedPerson(isParent(member) ? 'family' : ownPerson(member)); } }, [user.uid, member]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EventForm>(() => createDefaultEventForm(new Date()));
  const [saving, setSaving] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventData | null>(null);
  const [selectedDisplayEvent, setSelectedDisplayEvent] = useState<CalendarEventData | null>(null);
  const [selectedCalendarUid, setSelectedCalendarUid] = useState(user.uid);
  const [selectedSchoolScope, setSelectedSchoolScope] = useState<string | null>(null);
  const [visibilityRequest, setVisibilityRequest] = useState<{ uid: string; eventId: string; private: boolean; confirmed: boolean } | null>(null);
  const [visibilityError, setVisibilityError] = useState('');
  const visibilityAbort = useRef<AbortController | null>(null);
  const currentSelectionId = useRef<string | null>(null);
  currentSelectionId.current = selectedEvent?.id || null;
  const [selectedOccurrenceDate, setSelectedOccurrenceDate] = useState<Date | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EventForm>(() => createDefaultEventForm(new Date()));
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editScope, setEditScope] = useState<SeriesScope>('one');
  const [deleteScope, setDeleteScope] = useState<SeriesScope>('one');
  const [showDeleteScope, setShowDeleteScope] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferPerson, setTransferPerson] = useState<PersonKey>('family');
  const [exportMine, setExportMine] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [importPrivate, setImportPrivate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [transferNote, setTransferNote] = useState('');
  const importInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (requestedSelection) setSelectedPerson(requestedSelection.person); }, [requestedSelection]);

  useEffect(() => {
    let active = true;
    const uid = user.uid;
    const stop = subscribeCalendar(uid, (loaded) => {
      if (!active || currentCalendarUid.current !== uid) return;
      setCalendarState({ uid, events: loaded });
      setSelectedEvent((current) => current ? loaded.find((item) => item.id === current.id) || current : null);
    }, (error) => {
      if (!active || currentCalendarUid.current !== uid) return;
      console.error('Błąd kalendarza:', error); notify('Nie udało się odczytać kalendarza.', 'error');
    });
    return () => { active = false; stop(); };
  }, [user.uid]);

  const schoolSelection = selectedSchoolScope !== null;
  const currentSchoolSelection = schoolSelection && selectedSchoolScope === projectionScope
    ? projectionEvents.find(event => event.id === selectedEvent?.id) || null : null;
  const currentCalendarSelection = selectedEvent && !schoolSelection
    ? events.find(event => event.id === selectedEvent.id) || null : null;
  // Keeping a snapshot for an occurrence must not keep an inaccessible event
  // visible after deletion or a move to another user's private calendar.
  const currentSelection = schoolSelection ? currentSchoolSelection : currentCalendarSelection;
  const selectionVisible = selectedCalendarUid === user.uid && !!currentSelection
    && calendarEventInView(currentSelection, selectedPerson, own, user.uid);
  const visibleDisplayEvent = schoolSelection ? currentSchoolSelection
    : currentCalendarSelection?.repeat === 'none' ? calendarSourceDisplayEvent(currentCalendarSelection) : selectedDisplayEvent;
  const waitingOwnVisibility = visibilityRequest?.uid === user.uid && visibilityRequest.eventId === selectedEvent?.id && auth.currentUser?.uid === user.uid;
  useEffect(() => {
    // An atomic move can arrive through the two authorized listeners in different
    // orders. Hide absent data immediately, but retain only the owned operation
    // until its new snapshot arrives; no stale details stay on screen.
    if (!selectionVisible && !waitingOwnVisibility) { setSelectedEvent(null); setSelectedDisplayEvent(null); setEditing(false); }
  }, [selectionVisible, waitingOwnVisibility]);
  useEffect(() => {
    setVisibilityRequest(null); setVisibilityError('');
    return () => { visibilityAbort.current?.abort(); visibilityAbort.current = null; };
  }, [user.uid, selectedEvent?.id]);
  useEffect(() => {
    if (visibilityRequest?.confirmed && visibilityRequest.uid === user.uid && auth.currentUser?.uid === user.uid
      && currentCalendarSelection?.id === visibilityRequest.eventId && !!currentCalendarSelection.private === visibilityRequest.private) {
      visibilityAbort.current = null; setVisibilityRequest(null);
      notify('Zmieniono widoczność wydarzenia.', 'info');
    }
  }, [visibilityRequest, currentCalendarSelection, user.uid]);

  const weekStart = useMemo(() => startOfWeek(focusDate), [focusDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const monthDays = useMemo(() => {
    const first = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [focusDate]);

  const range = useMemo(() => {
    if (view === 'day' || view === 'schedule') return warsawCalendarDayRange(focusDate);
    if (view === 'week') return { start: warsawCalendarDayRange(weekStart).start, end: warsawCalendarDayRange(addDays(weekStart, 6)).end };
    return { start: warsawCalendarDayRange(monthDays[0]).start, end: warsawCalendarDayRange(monthDays[monthDays.length - 1]).end };
  }, [view, focusDate, weekStart, monthDays]);

  const selectedEvents = useMemo(() => displayEvents.filter(event => calendarEventInView(event, selectedPerson, own, user.uid)), [displayEvents, selectedPerson, own, user.uid]);
  const occurrences = useMemo(() => generateCalendarOccurrencesFromSources(calendarRangeDisplaySources(selectedEvents, range.start, range.end), range.start, range.end), [selectedEvents, range]);

  const todayRange = useMemo(() => warsawCalendarDayRange(new Date()), []);
  const todayOccurrences = useMemo(() => generateCalendarOccurrencesFromSources(calendarRangeDisplaySources(selectedEvents, todayRange.start, todayRange.end), todayRange.start, todayRange.end), [selectedEvents, todayRange]);

  const upcomingOccurrences = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const futureEnd = endOfDay(addDays(now, 30));
    return generateCalendarOccurrencesFromSources(calendarRangeDisplaySources(selectedEvents, todayStart, futureEnd), todayStart, futureEnd)
      .filter((item) => item.date >= todayStart)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 5);
  }, [selectedEvents]);
  const importantOccurrences = useMemo(() => {
    const now = new Date();
    const start = startOfDay(now), end = endOfDay(addDays(now, 366));
    return generateCalendarOccurrencesFromSources(calendarRangeDisplaySources(selectedEvents, start, end, true), start, end)
      .filter(item => isImportantCalendarEvent(item.source) && item.endDate >= now);
  }, [selectedEvents]);
  useEffect(() => setImportantExpanded(false), [selectedPerson, user.uid]);

  function titleForView() {
    if (view === 'day' || view === 'schedule') return capitalize(focusDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    if (view === 'week') return weekTitle(weekStart);
    return capitalize(focusDate.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }));
  }

  function navigate(direction: number) {
    if (view === 'schedule') setSelectedEvent(null);
    if (view === 'day' || view === 'schedule') setFocusDate((current) => addDays(current, direction));
    else if (view === 'week') setFocusDate((current) => addDays(current, direction * 7));
    else setFocusDate((current) => addMonths(current, direction));
  }

  function openNewEvent(date = focusDate, time = '12:00', allDay = false) {
    setForm(createDefaultEventForm(date, time, allDay));
    setShowForm(true);
  }

  function openEvent(event: CalendarEventData, occurrenceDate = event.date, originalDate = occurrenceDate) {
    const master = displayEvents.find((item) => item.id === event.id);
    if (!master) return;
    const duration = event.endDate.getTime() - event.date.getTime();
    setSelectedCalendarUid(user.uid);
    setSelectedSchoolScope(projectionEvents.some(item => item.id === master.id) ? projectionScope : null);
    setSelectedOccurrenceDate(originalDate);
    setSelectedEvent(master);
    setSelectedDisplayEvent({ ...master, ...event, date: occurrenceDate, endDate: new Date(occurrenceDate.getTime() + duration) });
    setEditing(false); setShowDeleteScope(false); setEditScope('one'); setDeleteScope('one');
    setEditForm(eventToForm({ ...master, ...event, date: occurrenceDate, endDate: new Date(occurrenceDate.getTime() + duration) }));
  }

  function eventFromForm(fields: EventForm, original?: CalendarEventData): CalendarEventData | null {
    const dates = buildEventDates(fields);
    if (!fields.title.trim() || !dates) return null;
    if (fields.repeat !== 'none' && fields.repeatEnd === 'date' && (!fields.repeatUntil || fields.repeatUntil < fields.date)) { notify('Koniec powtarzania nie może być przed wydarzeniem.', 'error'); return null; }
    if (fields.repeat !== 'none' && fields.repeatEnd === 'count' && (!Number.isInteger(fields.repeatCount) || Number(fields.repeatCount) < 1 || Number(fields.repeatCount) > 100000)) { notify('Podaj liczbę wystąpień od 1 do 100000.', 'error'); return null; }
    const interval = fields.recurrenceInterval || 1;
    if (fields.repeat === 'custom' && (!Number.isInteger(interval) || interval < 1 || interval > 1000)) { notify('Interwał musi wynosić od 1 do 1000.', 'error'); return null; }
    if (fields.repeat === 'custom' && fields.recurrenceUnit === 'week' && !fields.recurrenceWeekdays?.length) { notify('Wybierz przynajmniej jeden dzień tygodnia.', 'error'); return null; }
    return { id: original?.id || doc(collection(db, fields.private ? 'privateCalendarEvents' : 'calendarEvents')).id, title: fields.title.trim(), person: fields.person, date: dates.start, endDate: dates.end, allDay: fields.allDay, description: fields.description.trim(), important: fields.important === true, location: (fields.location || '').trim(), createdBy: original?.createdBy || user.uid, ownerUid: original?.ownerUid || original?.createdBy || user.uid, private: fields.private === true, repeat: fields.repeat, repeatUntil: fields.repeat !== 'none' && fields.repeatEnd === 'date' && fields.repeatUntil ? endOfDay(parseLocalDate(fields.repeatUntil, '12:00')) : null, repeatCount: fields.repeat !== 'none' && fields.repeatEnd === 'count' ? fields.repeatCount : null, ...(fields.repeat === 'custom' ? { recurrence: { interval, unit: fields.recurrenceUnit || 'day', ...(fields.recurrenceUnit === 'week' ? { weekdays: fields.recurrenceWeekdays || [] } : {}) } } : {}), recurrenceExceptions: original?.recurrenceExceptions || [], recurrenceOverrides: original?.recurrenceOverrides || {}, repeatBefore: original?.repeatBefore || null, seriesId: original?.seriesId || original?.id, timeZone: original?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  function changeEditScope(scope: SeriesScope) {
    setEditScope(scope);
    if (!selectedEvent) return;
    const related = events.filter((item) => (item.seriesId || item.id) === (selectedEvent.seriesId || selectedEvent.id)).sort((a,b) => a.date.getTime() - b.date.getTime());
    const source = scope === 'all' ? related[0] || selectedEvent : selectedEvent;
    setEditForm((current) => ({ ...current, repeatCount: source.repeatCount || 10 }));
  }

  async function saveEvent(e: React.FormEvent) {
    e.preventDefault(); if (saving) return;
    const event = eventFromForm(form); if (!event) return;
    setSaving(true);
    try { await commitCalendarPlan({ upserts: [event], deletes: [] }, events, user.uid); setFocusDate(event.date); setShowForm(false); }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { setSaving(false); }
  }

  async function updateEvent(e: React.FormEvent) {
    e.preventDefault(); if (!selectedEvent || selectedEvent.readOnly || !selectionVisible || updating) return;
    const event = eventFromForm(editForm, selectedEvent); if (!event) return;
    setUpdating(true);
    try {
      const { id: _id, createdBy: _createdBy, seriesId: _seriesId, ...patch } = event;
      const plan = planSeriesUpdate(events, selectedEvent, selectedOccurrenceDate || selectedEvent.date, editScope, patch);
      await commitCalendarPlan(plan, events, user.uid);
      setEditing(false);
      const savedRecord = editScope === 'future' || (editScope === 'one' && !!event.private !== !!selectedEvent.private)
        ? plan.upserts[1] || plan.upserts[0] : plan.upserts.find((item) => item.id === selectedEvent.id) || plan.upserts[0];
      setSelectedEvent(savedRecord || selectedEvent);
      if (savedRecord && savedRecord.id !== selectedEvent.id) setSelectedOccurrenceDate(savedRecord.date);
      setSelectedDisplayEvent(event);
      setEditForm(eventToForm({ ...savedRecord, ...event, ...(savedRecord ? { repeatCount: savedRecord.repeatCount } : {}) }));
      notify('Zapisano zmiany w kalendarzu.', 'info');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setUpdating(false); }
  }

  async function removeEvent() {
    if (!selectedEvent || selectedEvent.readOnly || !selectionVisible || deleting) return;
    if (selectedEvent.repeat !== 'none' && !showDeleteScope) { setShowDeleteScope(true); return; }
    const scope = selectedEvent.repeat === 'none' ? 'all' : deleteScope;
    if (!window.confirm(`Czy na pewno chcesz usunąć „${selectedEvent.title}”?${selectedEvent.repeat !== 'none' ? '\nZakres: ' + seriesScopeLabel(scope, true) : ''}`)) return;
    setDeleting(true);
    try { await commitCalendarPlan(planSeriesDelete(events, selectedEvent, selectedOccurrenceDate || selectedEvent.date, scope), events, user.uid); setSelectedEvent(null); }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { setDeleting(false); }
  }

  async function changeGoogleVisibility() {
    const event = currentCalendarSelection, uid = user.uid;
    if (!selectionVisible || visibilityRequest || (visibilityAbort.current && !visibilityAbort.current.signal.aborted)
      || auth.currentUser?.uid !== uid || !event || !canChangeGoogleVisibility(event, uid)) return;
    const makePrivate = !event.private;
    if (!makePrivate && !window.confirm('Udostępnić to wydarzenie w kalendarzu rodzinnym? Członkowie rodziny zobaczą jego szczegóły.')) return;
    const controller = new AbortController();
    visibilityAbort.current?.abort(); visibilityAbort.current = controller;
    setVisibilityError(''); setVisibilityRequest({ uid, eventId: event.id, private: makePrivate, confirmed: false });
    const current = () => !controller.signal.aborted && currentCalendarUid.current === uid
      && auth.currentUser?.uid === uid && currentSelectionId.current === event.id;
    try {
      const visibility = makePrivate ? 'private' : 'family';
      const reply = await calendarRequest<{ ok: true; eventId: string; visibility: 'private' | 'family' }>('visibility', user,
        { connectionId: event.sourceConnectionId, eventId: event.id, visibility }, controller.signal);
      if (!current()) return;
      if (reply.eventId !== event.id || reply.visibility !== visibility) throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE');
      // A response alone is not success: wait for the authorized calendar snapshot.
      if (makePrivate) setSelectedPerson(own);
      setVisibilityRequest({ uid, eventId: event.id, private: makePrivate, confirmed: true });
    } catch (error) {
      if (!current()) return;
      visibilityAbort.current = null; setVisibilityRequest(null); setVisibilityError(calendarErrorMessage(error));
    }
  }

  function downloadCalendar() {
    try {
      if ((exportFrom && !exportTo) || (!exportFrom && exportTo)) { notify('Wybierz początek i koniec zakresu.', 'error'); return; }
      const content = exportCalendarIcs(events, { uid: user.uid, person: transferPerson, mine: exportMine, ...(exportFrom ? { from: startOfDay(parseLocalDate(exportFrom, '12:00')), to: endOfDay(parseLocalDate(exportTo, '12:00')) } : {}) });
      downloadFile(content, 'nasza-rodzina.ics', 'text/calendar;charset=utf-8');
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  async function importCalendar(file: File) {
    if (importing) return; setImporting(true); setTransferNote('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Plik ICS może mieć maksymalnie 2 MB.');
      const parsed = importCalendarIcs(await file.text(), { uid: user.uid, person: transferPerson, private: importPrivate });
      const existing = new Set(events.map((item) => item.id)), fresh = parsed.events.filter((item) => !existing.has(item.id));
      for (let index = 0; index < fresh.length; index += 200) await commitCalendarPlan({ upserts: fresh.slice(index, index + 200), deletes: [] }, events, user.uid);
      setTransferNote(`Zaimportowano: ${fresh.length}. Pominięto istniejące: ${parsed.events.length - fresh.length}.${parsed.warnings.length ? ' Uwagi: ' + parsed.warnings.join(' ') : ''}`);
      if (fresh[0]) setFocusDate(fresh[0].date);
    } catch (error) { setTransferNote(errorMessage(error)); }
    finally { setImporting(false); if (importInput.current) importInput.current.value = ''; }
  }

  const detailsPanel = (selectedEvent && selectionVisible && (
        <Modal title={visibleDisplayEvent?.title || selectedEvent.title} subtitle={selectedEvent.readOnly ? `${calendarSourceLabel(selectedEvent)} · Dane źródłowe` : selectedEvent.repeat !== 'none' ? 'Wydarzenie cykliczne' : 'Wydarzenie'} onClose={() => setSelectedEvent(null)} wide>
          {(!editing || selectedEvent.readOnly) ? (
            <>
              {selectedEvent.readOnly && visibleDisplayEvent && <div className="calendar-source-detail"><CalendarSourceBadges event={visibleDisplayEvent} />{schoolSelection ? <><p>Dane pochodzą z {selectedEvent.source === 'health' ? 'modułu Zdrowie' : ['sp4', 'okruszek', 'fryderyk'].includes(selectedEvent.source || '') ? 'modułu Szkoła' : 'zapisanego profilu'}. Podgląd nie zmienia danych źródłowych.</p><button className="secondary-button" type="button" onClick={() => goTo(selectedEvent.source === 'health' ? 'Zdrowie' : ['sp4', 'okruszek', 'fryderyk'].includes(selectedEvent.source || '') ? 'Szkoła' : 'Ustawienia')}>Otwórz źródło</button></> : <><p>Treść wydarzenia pochodzi z Google Calendar. Zmień ją w kalendarzu źródłowym; kolejne pobranie zachowa lokalną widoczność.</p><button className="secondary-button" type="button" onClick={() => goTo('Ustawienia')}>Połączone kalendarze</button></>}</div>}
              <div className="details-grid">
                <DetailRow label="Osoba" value={personLabel((visibleDisplayEvent || selectedEvent).person)} />
                <DetailRow label="Termin wydarzenia" value={capitalize((visibleDisplayEvent?.date || selectedOccurrenceDate || selectedEvent.date).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} />
                <DetailRow label="Godzina" value={(visibleDisplayEvent || selectedEvent).allDay ? 'Cały dzień' : `${formatWarsawTime((visibleDisplayEvent || selectedEvent).date)} – ${formatWarsawTime((visibleDisplayEvent || selectedEvent).endDate)}`} />
                {(visibleDisplayEvent || selectedEvent).timingConfidence === 'estimated' && <DetailRow label="Dokładność godzin" value="Orientacyjne — harmonogram roboczy, do potwierdzenia" />}
                <DetailRow label="Przypomnienia" value="Ten typ wydarzenia nie ma zapisanych osobnych przypomnień. Ustawienia powiadomień znajdziesz w Ustawieniach." />
                <DetailRow label="Powtarzanie" value={describeRecurrence(selectedEvent)} />
                {selectedEvent.repeatUntil && <DetailRow label="Powtarzaj do" value={selectedEvent.repeatUntil.toLocaleDateString('pl-PL')} />}
                {(visibleDisplayEvent || selectedEvent).private ? <DetailRow label="Widoczność" value="Prywatny — tylko Ty" /> : ['google', 'okruszek', 'fryderyk'].includes(selectedEvent.source || '') ? <DetailRow label="Widoczność" value="Rodzinny" /> : null}
                {(visibleDisplayEvent || selectedEvent).location && <DetailRow label="Lokalizacja" value={(visibleDisplayEvent || selectedEvent).location!} />}
                {selectedEvent.repeatCount && <DetailRow label="Liczba wystąpień" value={String(selectedEvent.repeatCount)} />}
                {(visibleDisplayEvent || selectedEvent).description && <DetailRow label="Notatka" value={(visibleDisplayEvent || selectedEvent).description} />}
              </div>
              {selectedEvent.source === 'google' && <CalendarGoogleEditControls user={user} event={selectedEvent} />}
              {!selectedEvent.readOnly && selectedEvent.createdBy === user.uid && <CalendarGoogleExportControls user={user} eventId={selectedEvent.id} />}
              {canChangeGoogleVisibility(currentCalendarSelection, user.uid) && <div className="calendar-source-visibility">
                <button type="button" className="secondary-button" disabled={!!visibilityRequest} onClick={() => void changeGoogleVisibility()}>{visibilityRequest ? 'Zapisywanie widoczności…' : currentCalendarSelection?.private ? 'Udostępnij rodzinie' : 'Ustaw jako prywatny'}</button>
                <small>Przypisanie do profilu nie udostępnia prywatnego wydarzenia innym osobom.</small>
                {visibilityError && <p role="alert">{visibilityError}</p>}
                {visibilityRequest?.confirmed && <p role="status">Potwierdzono zmianę. Czekamy na odświeżenie kalendarza.</p>}
              </div>}
              {showDeleteScope && selectedEvent.repeat !== 'none' && <SeriesScopeSelector value={deleteScope} onChange={setDeleteScope} deleting />}
              <div className="modal-actions">{!selectedEvent.readOnly && (isParent(member) || selectedEvent.createdBy === user.uid) && <><button className="secondary-button" onClick={() => { setEditing(true); setShowDeleteScope(false); }}>✏️ Edytuj</button><button className="danger-button" onClick={removeEvent} disabled={deleting}>{deleting ? 'Usuwanie…' : showDeleteScope ? 'Potwierdź usunięcie' : '🗑️ Usuń'}</button></>}</div>
            </>
          ) : (
            <><SeriesScopeSelector hidden={selectedEvent.repeat === 'none'} value={editScope} onChange={changeEditScope} /><EventFormFields allowPrivacyChange={selectedEvent.createdBy === user.uid} scope={selectedEvent.repeat !== 'none' ? editScope : undefined} allowed={isParent(member) ? undefined : ['family', ownPerson(member)]} form={editForm} setForm={setEditForm} onSubmit={updateEvent} buttonText={updating ? 'Zapisywanie…' : '✓ Zapisz zmiany'} disabled={updating} onCancel={() => setEditing(false)} /></>
          )}
        </Modal>
      ));
  return (
    <div className="page-content compact-page calendar-package">
      <ModuleHeader icon="Kalendarz" title="Kalendarz" text="Twój plan dnia i terminy udostępnione rodzinie." action={<button className="primary-button" type="button" onClick={() => openNewEvent()}>＋ Dodaj wydarzenie</button>} />

      <section className="calendar-toolbar">
        <div className="calendar-navigation"><button onClick={() => navigate(-1)}>‹</button><strong>{titleForView()}</strong><button onClick={() => navigate(1)}>›</button></div>
        <button className="secondary-button" type="button" onClick={() => { setFocusDate(new Date()); if (view === 'schedule') setSelectedEvent(null); }}>Dzisiaj</button>
        <div className="view-switch">
          {(['schedule', 'day', 'week', 'month'] as CalendarView[]).map((item) => <button key={item} type="button" className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'schedule' ? 'Harmonogram' : item === 'day' ? 'Dzień' : item === 'week' ? 'Tydzień' : 'Miesiąc'}</button>)}
        </div>
      </section>

      <section className="person-filters">
        {personOptions.map((person) => <button key={person} type="button" className={selectedPerson === person ? 'active' : ''} onClick={() => setSelectedPerson(person)}><span style={{ background: calendarOwnerColor(person, activeProfiles.find(profile => memberPersonKey(profile) === person)) }} />{activeProfiles.find(profile => memberPersonKey(profile) === person)?.name || personLabel(person)}</button>)}
      </section>
      <CalendarGoogleBulkSharing user={user} events={events} />
      {musicSources.error && <p className="calendar-source-notice" role="status">Nie udało się odczytać planu szkoły muzycznej. Kalendarz może nie pokazywać wszystkich zajęć.<button type="button" onClick={musicSources.reload}>Ponów odczyt planu</button><button type="button" onClick={() => goTo('Szkoła')}>Sprawdź w Szkole</button></p>}
      {schoolSources.error && <p className="calendar-source-notice" role="status">Nie udało się odczytać zajęć SP4. Pozostałe wydarzenia nadal są dostępne.</p>}
      {schoolProjection.incomplete > 0 && <p className="calendar-source-notice" role="status">SP4: {schoolProjection.incomplete} wpisów bez pełnej daty lub godzin. Nie dopisujemy brakujących terminów.<button type="button" onClick={() => goTo('Szkoła')}>Sprawdź w Szkole</button></p>}

      <section className="calendar-v2-important" aria-labelledby="important-calendar-title"><header><h2 id="important-calendar-title">⭐ Najważniejsze terminy</h2><span>{importantOccurrences.length}</span></header>
        {importantOccurrences.length ? <div className="calendar-v2-important-list">{(importantExpanded ? importantOccurrences : importantOccurrences.slice(0, 3)).map(item => <button type="button" key={item.key} onClick={() => openEvent(item.source, item.date, item.originalDate || item.date)}><time dateTime={item.date.toISOString()}><b>{item.date.getDate()}</b>{item.date.toLocaleDateString('pl-PL', { month: 'short' })}</time><span><strong>{item.source.title}</strong><small>{item.source.allDay ? 'Cały dzień' : formatWarsawTime(item.date)}</small><CalendarOwnerBadge event={item.source}/></span></button>)}</div> : <p>Brak ważnych terminów. Możesz oznaczyć wydarzenie jako ważne przy jego dodawaniu.</p>}
        {importantOccurrences.length > 3 && <button type="button" className="calendar-v2-expand" aria-expanded={importantExpanded} onClick={() => setImportantExpanded(value => !value)}>{importantExpanded ? 'Zwiń listę' : `Pokaż wszystkie (${importantOccurrences.length})`}</button>}
      </section>
      {view === 'schedule' && <div className="calendar-schedule-layout"><ScheduleDay date={focusDate} occurrences={occurrences} onOpen={openEvent} onAdd={openNewEvent} /></div>}
      {view === 'day' && <CalendarDay date={focusDate} occurrences={occurrences} onOpen={openEvent} onAdd={openNewEvent} />}
      {view === 'week' && (
        <div className="calendar-week-layout">
          <section className="calendar-week-card">
            <CalendarWeek days={weekDays} occurrences={occurrences} onOpen={openEvent} onAdd={openNewEvent} onDay={day => { setFocusDate(day); setView('day'); }} />
          </section>
          <CalendarSide today={todayOccurrences} upcoming={upcomingOccurrences} onOpen={openEvent} />
        </div>
      )}
      {view === 'month' && <CalendarMonth focusDate={focusDate} days={monthDays} occurrences={occurrences} onOpen={openEvent} onAdd={openNewEvent} onDay={(day) => { setFocusDate(day); setView('day'); }} />}

      <section className="calendar-lower-grid">
        <article className="calendar-lower-card"><header><strong>⏭️ Nadchodzące wydarzenia</strong></header>{upcomingOccurrences.slice(0,4).map((item) => { const done=!item.source.cancelled&&sameDay(item.date,new Date())&&item.endDate<new Date(); return <button key={item.key} className={`${done?'completed-today':''} ${item.source.cancelled?'is-source-cancelled':''}`} onClick={()=>openEvent(item.source, item.date, item.originalDate || item.date)}><span>{eventActivityIcon(item.source.title)}</span><div><strong>{item.source.title}</strong><small>{item.date.toLocaleDateString('pl-PL')} · {item.source.allDay?'Cały dzień':`${formatWarsawTime(item.date)}–${formatWarsawTime(item.endDate)}`}</small><CalendarSourceBadges event={item.source} /></div><em>{done?'✓ Zakończone':'›'}</em></button>; })}</article>
        <article className="calendar-lower-card"><header><strong>🔔 Twoje przypomnienia</strong></header><p>Sprawdź nadchodzące wydarzenia tutaj, a przypomnienia o lekach w zakładce Zdrowie.</p><button className="secondary-button" onClick={()=>goTo('Ustawienia')}>Ustawienia przypomnień</button></article>
      </section>
      <section className="connected-calendars-footer"><header><div><strong>🔗 Połączone kalendarze</strong><small>Nasza Rodzina jest kalendarzem domyślnym.</small></div></header><div><span className="connected active">● Nasza Rodzina</span>{schoolProjection.events.length > 0 && <span>SP4 — podgląd danych szkolnych</span>}{okruszekEvents.length > 0 && <span>Okruszek — plan Pawła</span>}<button type="button" onClick={() => goTo('Ustawienia')}>Google Calendar — {events.some(event => event.source === 'google') ? 'zapisane wydarzenia' : 'połącz w Ustawieniach'}</button><span>Apple / iCloud — ICS</span><span>Outlook — import ICS</span></div></section>
      <div className="calendar-transfer-toolbar"><button className="secondary-button" onClick={() => { setTransferPerson(selectedPerson); setShowTransfer(true); }}>Importuj / pobierz kalendarz .ics</button></div>

      {showTransfer && <Modal title="Import i eksport kalendarza" subtitle="Pliki .ics" onClose={() => setShowTransfer(false)} wide>
        <div className="form-grid calendar-transfer-form">
          <label className="field"><span>Wybrana osoba</span><PersonSelect allowed={isParent(member) ? undefined : ['family', ownPerson(member)]} value={transferPerson} onChange={setTransferPerson} /></label>
          <label className="checkbox-field"><input type="checkbox" checked={exportMine} onChange={(e) => setExportMine(e.target.checked)} /><span>Mój kalendarz — wydarzenia utworzone przeze mnie</span></label>
          <label className="field"><span>Zakres od</span><input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} /></label>
          <label className="field"><span>Zakres do</span><input type="date" min={exportFrom} value={exportTo} onChange={(e) => setExportTo(e.target.value)} /></label>
          <p className="field-wide muted">Bez zakresu pobierzesz całe serie; w wybranym zakresie — ich wystąpienia. Prywatne wydarzenia innych osób nie są udostępniane.</p>
          <p className="field-wide muted">Podgląd zajęć SP4 nie tworzy zapisanych wydarzeń. Eksport obejmuje dotychczasowy kalendarz.</p>
          <button className="primary-button" onClick={downloadCalendar}>Pobierz kalendarz</button>
          <label className="checkbox-field"><input type="checkbox" checked={importPrivate} onChange={(e) => setImportPrivate(e.target.checked)} /><span>Importuj jako prywatne</span></label>
          <input ref={importInput} className="calendar-file-input" type="file" accept=".ics,text/calendar" aria-label="Plik kalendarza ICS" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importCalendar(file); }} />
          <button className="secondary-button" disabled={importing} onClick={() => importInput.current?.click()}>{importing ? 'Importowanie…' : 'Importuj kalendarz'}</button>
          {transferNote && <p className="field-wide calendar-transfer-note" role="status">{transferNote}</p>}
        </div>
      </Modal>}

      {showForm && (
        <Modal title="➕ Nowe wydarzenie" subtitle="Kalendarz" onClose={() => setShowForm(false)} wide>
          <EventFormFields allowed={isParent(member) ? undefined : ['family', ownPerson(member)]} form={form} setForm={setForm} onSubmit={saveEvent} buttonText={saving ? 'Zapisywanie…' : '✓ Zapisz wydarzenie'} disabled={saving} onCancel={() => setShowForm(false)} />
        </Modal>
      )}

      {detailsPanel}
    </div>
  );
}

export function createDefaultEventForm(date: Date, time = '12:00', allDay = false): EventForm {
  const start = new Date(date);
  const [hours, minutes] = time.split(':').map(Number);
  start.setHours(hours || 0, minutes || 0, 0, 0);
  const end = new Date(start.getTime() + 3600000);
  return { title: '', person: 'family', date: formatDateInput(start), allDay, startTime: formatTimeInput(start), endTime: formatTimeInput(end), description: '', repeat: 'none', repeatUntil: '', repeatEnd: 'never', repeatCount: 10, recurrenceInterval: 1, recurrenceUnit: 'week', recurrenceWeekdays: [start.getDay()], private: false, important: false, location: '' };
}

export function eventToForm(event: CalendarEventData): EventForm {
  return {
    title: event.title, person: event.person, date: formatDateInput(event.date), allDay: event.allDay,
    startTime: formatTimeInput(event.date), endTime: formatTimeInput(event.endDate), description: event.description,
    repeat: event.repeat, repeatUntil: event.repeatUntil ? formatDateInput(event.repeatUntil) : '', repeatEnd: event.repeatCount ? 'count' : event.repeatUntil ? 'date' : 'never', repeatCount: event.repeatCount || 10, recurrenceInterval: event.recurrence?.interval || 1, recurrenceUnit: event.recurrence?.unit || 'week', recurrenceWeekdays: event.recurrence?.weekdays || [event.date.getDay()], private: event.private === true, important: event.important === true, location: event.location || '',
  };
}

export function buildEventDates(form: EventForm) {
  if (!form.date) return null;
  if (form.allDay) {
    const start = new Date(`${form.date}T00:00:00`);
    const end = new Date(`${form.date}T23:59:59`);
    return { start, end };
  }
  const start = parseLocalDate(form.date, form.startTime || '00:00');
  const end = parseLocalDate(form.date, form.endTime || '00:00');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    alert('Godzina zakończenia musi być późniejsza niż rozpoczęcia.');
    return null;
  }
  return { start, end };
}

export function EventFormFields({ form, setForm, onSubmit, buttonText, disabled, onCancel, allowed, scope, allowPrivacyChange = true }: { form: EventForm; setForm: React.Dispatch<React.SetStateAction<EventForm>>; onSubmit: (e: React.FormEvent) => void; buttonText: string; disabled: boolean; onCancel?: () => void; allowed?: PersonKey[]; scope?: SeriesScope; allowPrivacyChange?: boolean }) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="field field-wide"><span>Nazwa wydarzenia</span><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Np. dentysta, urodziny, basen…" required /></label>
      <label className="field"><span>Osoba</span><PersonSelect allowed={allowed} value={form.person} onChange={(person) => setForm((f) => ({ ...f, person }))} /></label>
      <label className="field"><span>Data</span><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required /></label>
      <label className="checkbox-field"><input type="checkbox" checked={form.allDay} onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))} /><span>Cały dzień</span></label>
      {!form.allDay && <>
        <label className="field"><span>Od</span><input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} required /></label>
        <label className="field"><span>Do</span><input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} required /></label>
      </>}
      {scope !== 'one' && <>
        <label className="field"><span>Powtarzanie</span><select aria-label="Powtarzanie" value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as RepeatType, repeatUntil: e.target.value === 'none' ? '' : f.repeatUntil }))}><option value="none">Nie powtarzaj</option><option value="daily">Codziennie</option><option value="weekdays">Poniedziałek–piątek</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option><option value="yearly">Co rok</option><option value="custom">Niestandardowo</option></select></label>
        {form.repeat === 'custom' && <>
          <label className="field"><span>Powtarzaj co</span><input type="number" min="1" max="1000" value={form.recurrenceInterval || 1} onChange={(e) => setForm((f) => ({ ...f, recurrenceInterval: Number(e.target.value) }))} required /></label>
          <label className="field"><span>Jednostka powtarzania</span><select value={form.recurrenceUnit || 'week'} onChange={(e) => setForm((f) => ({ ...f, recurrenceUnit: e.target.value as RecurrenceUnit }))}><option value="day">dzień</option><option value="week">tydzień</option><option value="month">miesiąc</option><option value="year">rok</option></select></label>
          {form.recurrenceUnit === 'week' && <fieldset className="field-wide calendar-weekdays"><legend>Dni tygodnia</legend>{[[1,'Pon'],[2,'Wt'],[3,'Śr'],[4,'Czw'],[5,'Pt'],[6,'Sob'],[0,'Nd']].map(([day,label]) => <label key={day}><input type="checkbox" checked={(form.recurrenceWeekdays || []).includes(Number(day))} onChange={(e) => setForm((f) => ({ ...f, recurrenceWeekdays: e.target.checked ? [...(f.recurrenceWeekdays || []), Number(day)] : (f.recurrenceWeekdays || []).filter((value) => value !== Number(day)) }))} /><span>{label}</span></label>)}</fieldset>}
        </>}
        {form.repeat !== 'none' && <>
          <label className="field"><span>Zakończenie powtarzania</span><select value={form.repeatEnd || (form.repeatUntil ? 'date' : 'never')} onChange={(e) => setForm((f) => ({ ...f, repeatEnd: e.target.value as 'never'|'date'|'count' }))}><option value="never">Bez końca</option><option value="date">Do konkretnej daty</option><option value="count">Po X wystąpieniach</option></select></label>
          {form.repeatEnd === 'date' && <label className="field"><span>Powtarzaj do</span><input type="date" min={form.date} value={form.repeatUntil} onChange={(e) => setForm((f) => ({ ...f, repeatUntil: e.target.value }))} required /></label>}
          {form.repeatEnd === 'count' && <label className="field"><span>Liczba wystąpień</span><input type="number" min="1" max="100000" value={form.repeatCount || 1} onChange={(e) => setForm((f) => ({ ...f, repeatCount: Number(e.target.value) }))} required /></label>}
        </>}
      </>}
      <label className="field field-wide"><span>Lokalizacja</span><input value={form.location || ''} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Opcjonalnie" /></label>
      <label className="checkbox-field field-wide"><input type="checkbox" checked={form.private === true} disabled={!allowPrivacyChange} onChange={(e) => setForm((f) => ({ ...f, private: e.target.checked }))} /><span>Prywatne — widoczne wyłącznie dla właściciela</span></label>

      <label className="checkbox-field field-wide"><input type="checkbox" checked={form.important === true} onChange={e => setForm(current => ({ ...current, important: e.target.checked }))} /><span>⭐ Oznacz jako ważne</span></label>
      <label className="field field-wide"><span>Notatka</span><textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Opcjonalna informacja…" rows={3} /></label>
      <div className="form-actions field-wide">{onCancel && <button className="secondary-button" type="button" onClick={onCancel}>Anuluj</button>}<button className="primary-button" type="submit" disabled={disabled}>{buttonText}</button></div>
    </form>
  );
}

export function SeriesScopeSelector({ value, onChange, deleting = false, hidden = false }: { value: SeriesScope; onChange: (value: SeriesScope) => void; deleting?: boolean; hidden?: boolean }) {
  if (hidden) return null;
  return <fieldset className="calendar-series-scope"><legend>{deleting ? 'Usuń' : 'Zastosuj zmiany do'}</legend>{(['one','future','all'] as SeriesScope[]).map((scope) => <label key={scope}><input type="radio" name={deleting ? 'deleteSeriesScope' : 'editSeriesScope'} value={scope} checked={value === scope} onChange={() => onChange(scope)} /><span>{seriesScopeLabel(scope, deleting)}</span></label>)}</fieldset>;
}

export function CalendarEventButton({ occurrence, onClick, timelineBlock }: { occurrence: CalendarOccurrence; onClick: () => void; timelineBlock?: CalendarTimelineBlock }) {
  const event = occurrence.source;
  const profile = calendarOwnerProfile(event, useFamilyDirectory());
  const ownerColor = calendarOwnerColor(event.person, profile);
  const completed = !event.cancelled && sameDay(occurrence.date, new Date()) && occurrence.endDate < new Date();
  const timeLabel = event.allDay ? 'Cały dzień' : `${formatWarsawTime(occurrence.date)}–${formatWarsawTime(occurrence.endDate)}`;
  const name = event.person === 'family' ? 'Cała rodzina' : profile?.name || personLabel(event.person);
  const estimated = event.timingConfidence === 'estimated';
  const label = `${name} · ${event.title} · ${timeLabel}${estimated ? ' · Godziny orientacyjne' : ''}${event.cancelled ? ' · Odwołane' : ''}`;
  return (
    <button type="button" className={`calendar-event ${personEventClass(event.person)} ${timelineBlock ? 'nr-calendar-timed-event' : ''} ${event.eventKind === 'break' ? 'nr-calendar-break-event' : ''} ${estimated ? 'nr-calendar-estimated-event' : ''} ${completed ? 'completed-today' : ''} ${event.cancelled ? 'is-source-cancelled' : ''}`} data-source={event.source || 'manual'} data-event-id={event.id} data-event-kind={event.eventKind} data-start-minute={timelineBlock?.startMinute} data-end-minute={timelineBlock?.endMinute} data-compact={timelineBlock ? timelineBlock.height < 34 : undefined} aria-label={label} title={label} style={{ '--calendar-owner-color': ownerColor,
      '--event-surface': `color-mix(in srgb, ${ownerColor} 12%, var(--brand-card, white))`,
      ...(timelineBlock ? { top: timelineBlock.top, height: timelineBlock.height, insetInlineStart: `calc(${timelineBlock.column * 100 / timelineBlock.columns}% + 2px)`, width: `calc(${100 / timelineBlock.columns}% - 4px)` } : {}) } as React.CSSProperties} onClick={onClick}>
      <strong>{event.important ? '⭐ ' : ''}{event.title}</strong>
      <CalendarOwnerBadge event={event} />
      <span className="calendar-event-time">{timeLabel}{event.repeat !== 'none' ? ' · ↻' : ''}{completed ? ' · ✓ Zakończone' : ''}</span>
      {estimated && <span className="calendar-timing-badge">Godziny orientacyjne</span>}
      <CalendarSourceBadges event={event} />
    </button>
  );
}

function calendarSourceLabel(event: CalendarEventData): string {
  return { google: 'Google Calendar', sp4: 'SP4', okruszek: 'Okruszek', health: 'Zdrowie', finance: 'Finanse', fryderyk: 'Fryderyk', ics: 'ICS', manual: 'Profil rodziny' }[event.source || 'manual'];
}

function CalendarSourceBadges({ event }: { event: CalendarEventData }) {
  if (!event.source || event.source === 'manual') return null;
  return <span className="calendar-source-badges"><span className={`calendar-source-badge ${event.source === 'google' ? 'calendar-google-badge' : ''}`} data-testid="calendar-source-badge">{calendarSourceLabel(event)}</span>{event.cancelled && <span className="calendar-source-badge calendar-cancelled-badge">ODWOŁANE</span>}</span>;
}

export function CalendarDay({ date, occurrences, onOpen, onAdd }: { date: Date; occurrences: CalendarOccurrence[]; onOpen: (event: CalendarEventData, occurrenceDate?: Date, originalDate?: Date) => void; onAdd: (date?: Date, time?: string, allDay?: boolean) => void }) {
  const dayItems = calendarOccurrencesOnDay(occurrences, date);
  const allDay = dayItems.filter((item) => item.source.allDay);
  const axisRange = calendarTimelineRange(occurrences, [date]);
  return (
    <section className="calendar-day-view">
      <div className="calendar-day-title"><div className="big-date">{date.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric' })}</div><div><strong>{capitalize(date.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'long' }))}</strong><span>{capitalize(date.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', month: 'long', year: 'numeric' }))}</span></div><button className="secondary-button" onClick={() => onAdd(date, '12:00', true)}>＋ Cały dzień</button></div>
      <div className="all-day-row"><span>Cały dzień</span><div>{allDay.length === 0 ? <small className="muted">Brak wydarzeń</small> : allDay.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date, item.originalDate || item.date)} />)}</div></div>
      <div className="nr-calendar-axis-scroll" data-testid="calendar-day-time-axis"><CalendarTimeAxis days={[date]} occurrences={occurrences} range={axisRange} onOpen={onOpen} onAdd={onAdd} /></div>
    </section>
  );
}

type CalendarAxisActions = { onOpen: (event: CalendarEventData, occurrenceDate?: Date, originalDate?: Date) => void; onAdd: (date?: Date, time?: string, allDay?: boolean) => void };

function CalendarTimeAxis({ days, occurrences, range, onOpen, onAdd }: CalendarAxisActions & { days: Date[]; occurrences: CalendarOccurrence[]; range: { startMinute: number; endMinute: number } }) {
  const pixelsPerMinute = 1;
  const height = (range.endMinute - range.startMinute) * pixelsPerMinute;
  const ticks = Array.from({ length: (range.endMinute - range.startMinute) / 60 + 1 }, (_, index) => range.startMinute + index * 60);
  const blocksByDay = days.map(day => layoutCalendarTimeline(occurrences, day, range.startMinute, pixelsPerMinute)
    .filter(block => block.endMinute > range.startMinute && block.startMinute < range.endMinute)
    .map(block => ({ ...block, top: Math.max(0, block.top), height: (Math.min(range.endMinute, block.endMinute) - Math.max(range.startMinute, block.startMinute)) * pixelsPerMinute })));
  const columns = Math.max(1, ...blocksByDay.flatMap(rows => rows.map(item => item.columns)));
  return <div className={`nr-calendar-axis ${days.length > 1 ? 'nr-calendar-week-axis' : ''}`} style={{ '--calendar-axis-columns': days.length, '--calendar-axis-min-width': `${days.length > 1 ? 168 : Math.max(0, columns * 76)}px` } as React.CSSProperties}>
    <div className="nr-calendar-time-ruler" style={{ height }} aria-label="Godziny Europe/Warsaw">{ticks.map(minute => <time key={minute} style={{ top: (minute - range.startMinute) * pixelsPerMinute }}>{timelineMinuteLabel(minute)}</time>)}</div>
    {days.map((day, index) => <div className="nr-calendar-time-canvas" key={warsawDayKey(day)} style={{ height }} data-day={warsawDayKey(day)}>
      {ticks.filter(minute => minute < range.endMinute).map(minute => <button type="button" key={minute} className="nr-calendar-hour-space" style={{ top: (minute - range.startMinute) * pixelsPerMinute, height: 60 * pixelsPerMinute }} aria-label={`Dodaj wydarzenie ${warsawDayKey(day)} o ${timelineMinuteLabel(minute)}`} onClick={() => onAdd(day, timelineMinuteLabel(minute))}><span aria-hidden="true">＋</span></button>)}
      {!blocksByDay[index].length && <small className="nr-calendar-no-timed-events">Brak wydarzeń godzinowych</small>}
      {blocksByDay[index].map(item => <CalendarEventButton key={item.occurrence.key} timelineBlock={item} occurrence={item.occurrence} onClick={() => onOpen(item.occurrence.source, item.occurrence.date, item.occurrence.originalDate || item.occurrence.date)} />)}
    </div>)}
  </div>;
}

export function CalendarWeek({ days, occurrences, onOpen, onAdd, onDay }: CalendarAxisActions & { days: Date[]; occurrences: CalendarOccurrence[]; onDay: (date: Date) => void }) {
  const range = calendarTimelineRange(occurrences, days);
  return <div className="nr-calendar-week-scroll" data-testid="calendar-week-time-axis"><div className="nr-calendar-week-content">
    <div className="nr-calendar-week-header"><span>Godziny</span>{days.map(day => <div key={warsawDayKey(day)}><button className={`calendar-day-heading ${warsawDayKey(day) === warsawDayKey(new Date()) ? 'today' : ''}`} type="button" onClick={() => onDay(day)}><span>{capitalize(day.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'short' }))}</span><strong>{day.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric' })}</strong></button><button className="calendar-plus" type="button" aria-label={`Dodaj wydarzenie ${warsawDayKey(day)}`} onClick={() => onAdd(day)}>＋</button></div>)}</div>
    <div className="nr-calendar-week-all-day"><span>Cały dzień</span>{days.map(day => <div key={warsawDayKey(day)}>{calendarOccurrencesOnDay(occurrences, day).filter(item => item.source.allDay).map(item => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date, item.originalDate || item.date)} />)}</div>)}</div>
    <CalendarTimeAxis days={days} occurrences={occurrences} range={range} onOpen={onOpen} onAdd={onAdd} />
  </div></div>;
}

export function CalendarMonth({ focusDate, days, occurrences, onOpen, onAdd, onDay }: { focusDate: Date; days: Date[]; occurrences: CalendarOccurrence[]; onOpen: (event: CalendarEventData, occurrenceDate?: Date, originalDate?: Date) => void; onAdd: (date?: Date) => void; onDay: (date: Date) => void }) {
  return (
    <section className="calendar-month-card">
      <div className="month-grid month-head">{['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'].map((name) => <div key={name}>{name}</div>)}</div>
      <div className="month-grid">
        {days.map((day) => {
          const items = occurrences.filter((item) => item.date <= endOfDay(day) && item.endDate >= startOfDay(day));
          return (
            <div key={formatDateInput(day)} className={`month-day ${day.getMonth() !== focusDate.getMonth() ? 'dim' : ''} ${sameDay(day, new Date()) ? 'today' : ''}`}>
              <div className="month-day-top"><button type="button" onClick={() => onDay(day)}>{day.getDate()}</button><button type="button" onClick={() => onAdd(day)}>＋</button></div>
              <div className="month-events">{items.slice(0, 3).map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date, item.originalDate || item.date)} />)}{items.length > 3 && <button className="more-link" type="button" onClick={() => onDay(day)}>+{items.length - 3} więcej</button>}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CalendarSide({ today, upcoming, onOpen }: { today: CalendarOccurrence[]; upcoming: CalendarOccurrence[]; onOpen: (event: CalendarEventData, occurrenceDate?: Date, originalDate?: Date) => void }) {
  return (
    <aside className="calendar-side">
      <section><h3>📍 Dzisiaj</h3>{today.length === 0 ? <p className="muted">Brak wydarzeń.</p> : today.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date, item.originalDate || item.date)} />)}</section>
      <section><h3>⏭️ Nadchodzące</h3>{upcoming.length === 0 ? <p className="muted">Nic w najbliższych 30 dniach.</p> : upcoming.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date, item.originalDate || item.date)} />)}</section>
    </aside>
  );
}

function ScheduleDay({ date, occurrences, onOpen, onAdd }: CalendarAxisActions & { date: Date; occurrences: CalendarOccurrence[] }) {
  const range = { startMinute: 360, endMinute: 1320 };
  const items = calendarOccurrencesOnDay(occurrences, date);
  const outside = layoutCalendarTimeline(occurrences, date).filter(block => block.endMinute <= 360 || block.startMinute >= 1320);
  return <section className="calendar-schedule-day" aria-label="Harmonogram dnia"><h2>Harmonogram dnia</h2><div className="all-day-row"><span>Cały dzień</span><div>{items.filter(item => item.source.allDay).map(item => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date, item.originalDate || item.date)} />)}</div></div>{outside.length > 0 && <div className="calendar-outside-hours"><h3>Poza godzinami 06–22</h3>{outside.map(({occurrence:item}) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source,item.date,item.originalDate || item.date)} />)}</div>}<CalendarTimeAxis days={[date]} occurrences={occurrences} range={range} onOpen={onOpen} onAdd={onAdd} /></section>;
}
