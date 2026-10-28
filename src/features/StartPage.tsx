import { FamilyHome } from './FamilyHome';
import { familyAgendaRange, upcomingFamilyEvents } from './family-home-model';
import { formatWarsawTime } from '../calendar-timeline';
import { useMusicSchoolPlans, musicCalendarEvents } from '../school/music-school-client';
import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { onSnapshot } from '../feedback';
import { isPersonKey, ownPerson, type CalendarEventData, type Member, type Page, type TaskItem, Modal, DetailRow } from '../app-shared';
import { subscribeCalendar } from '../calendar-store';
import { useDashboardOrder } from './useDashboardOrder';
import { useCalendarSchoolSources } from '../useCalendarSchoolSources';
import { useFamilyDirectory, orderedFamilyProfiles } from '../family-directory';
import { categorizeProduct, isShoppingCategory } from './ShoppingPage';
import { buildFamilyTime, familyStatusRefreshDelay, latestConversations, warsawCalendarDay, type StartChatMessage, type StartShoppingItem } from './start-tile-projections';
import { familyCalendarEvents, projectFamilyBirthdays } from '../calendar-v2';
import { CalendarOwnerBadge } from '../CalendarOwnerBadge';
import { projectOkruszekCalendar, projectSchoolCalendar } from '../calendar-source-projections';
import { projectManualSchoolCalendar } from '../calendar-school-display';
import { calendarRangeDisplaySources } from '../calendar-timeline';
import { calendarSourceDisplayEvent } from '../calendar-source-metadata';
import { generateCalendarOccurrencesFromSources } from '../calendars/google-occurrences';
import { useCalendarHealthSources } from '../health/useCalendarHealthSources';
import './calendar-v2.css';
import { useSchoolNewness } from '../school/useSchoolNewness';
import { schoolHomeEntries } from './school-home';

type Weather = { temp: number; max: number; min: number; wind: number; label: string; icon: string };
function timestampDate(value: unknown) { return value instanceof Timestamp ? value.toDate() : undefined; }

export function StartPage({ user, member, goTo }: { user: User; member: Member | null; goTo: (page: Page) => void }) {
  const name = member?.name || 'Rodzina';
  const own = ownPerson(member);
  const directory = useFamilyDirectory();
  const profiles = useMemo(() => orderedFamilyProfiles(directory, user.uid), [directory, user.uid]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [calendarData, setCalendarData] = useState<{ uid: string; rows: CalendarEventData[] }>({ uid: user.uid, rows: [] });
  const events = calendarData.uid === user.uid ? calendarData.rows : [];
  const [calendarDetail, setCalendarDetail] = useState<{ uid: string; key: string } | null>(null);
  const healthSources = useCalendarHealthSources({ uid: user.uid, member });
  const schoolSources = useCalendarSchoolSources(user.uid, member);
  const schoolNewness = useSchoolNewness(user.uid);
  const schoolPreview = schoolHomeEntries(schoolSources.rows, schoolNewness.isNew);
  const musicSources = useMusicSchoolPlans(user.uid, schoolSources.scope);
  const musicEvents = useMemo(() => musicCalendarEvents(musicSources.data?.plans || [], profiles), [musicSources.data, profiles]);
  const schoolRecords = schoolSources.rows;
  const [shopping, setShopping] = useState<StartShoppingItem[]>([]);
  const [messages, setMessages] = useState<StartChatMessage[]>([]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [now, setNow] = useState(() => new Date());
  const { order, saveOrder, loaded } = useDashboardOrder(user.uid);

  useEffect(() => onSnapshot(collection(db, 'tasks'), snap => {
    setTasks(snap.docs.filter(d => d.data().archived !== true).map(d => {
      const x = d.data();
      return { id: d.id, title: String(x.title || ''), person: isPersonKey(x.person) ? x.person : 'family', done: x.done === true,
        dueDate: typeof x.dueDate === 'string' ? x.dueDate : '', priority: x.priority === 'low' || x.priority === 'high' ? x.priority : 'normal',
        note: typeof x.note === 'string' ? x.note : '', points: Number(x.points || 0), requireApproval: x.requireApproval === true,
        approvalStatus: x.approvalStatus === 'pending' || x.approvalStatus === 'approved' ? x.approvalStatus : 'none',
        repeat: x.repeat === 'daily' || x.repeat === 'weekly' || x.repeat === 'monthly' ? x.repeat : 'none',
        createdAt: timestampDate(x.createdAt), completedAt: timestampDate(x.completedAt) };
    }));
  }), [user.uid]);
  useEffect(() => onSnapshot(collection(db, 'shoppingItems'), snap => setShopping(snap.docs.map(d => {
    const x = d.data(); const title = String(x.title || ''); return { id: d.id, title, done: x.done === true, category: isShoppingCategory(x.category) ? x.category : categorizeProduct(title), quantity: typeof x.quantity === 'string' ? x.quantity : '', unit: typeof x.unit === 'string' ? x.unit : '', createdAt: timestampDate(x.createdAt) };
  }))), [user.uid]);
  useEffect(() => { let active = true; const uid = user.uid; const stop = subscribeCalendar(uid, rows => { if (active) setCalendarData({ uid, rows }); }); return () => { active = false; stop(); }; }, [user.uid]);
  useEffect(() => {
    const groups: Record<string, StartChatMessage[]> = { family: [], private: [] };
    const load = (group: string, snap: import('firebase/firestore').QuerySnapshot) => {
      groups[group] = snap.docs.map(d => { const x = d.data(); return { id: d.id, text: String(x.text || ''), name: String(x.name || 'Rodzina'), uid: String(x.uid || ''), channel: String(x.channel || 'family'), participants: Array.isArray(x.participants) ? x.participants.filter((value: unknown) => typeof value === 'string') : [], createdAt: timestampDate(x.createdAt) }; });
      setMessages([...groups.family, ...groups.private].sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)));
    };
    const family = onSnapshot(query(collection(db, 'familyMessages'), where('channel', '==', 'family')), snap => load('family', snap));
    const privateMessages = onSnapshot(query(collection(db, 'familyMessages'), where('participants', 'array-contains', user.uid)), snap => load('private', snap));
    return () => { family(); privateMessages(); };
  }, [user.uid]);
  useEffect(() => {
    const controller = new AbortController();
    async function loadWeather() {
      try {
        // Same established source, Kołobrzeg location and refresh interval.
        const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=54.176&longitude=15.576&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FWarsaw&forecast_days=1', { signal: controller.signal });
        if (!response.ok) throw new Error('weather');
        const data = await response.json(); const code = Number(data.current?.weather_code ?? 0);
        const meta = code <= 1 ? ['Słonecznie', '☀️'] : code <= 3 ? ['Częściowe zachmurzenie', '⛅'] : code <= 48 ? ['Mgła / chmury', '🌫️'] : code <= 67 ? ['Deszcz', '🌧️'] : code <= 77 ? ['Śnieg', '🌨️'] : code <= 82 ? ['Przelotny deszcz', '🌦️'] : ['Burze', '⛈️'];
        setWeather({ temp: Math.round(data.current?.temperature_2m ?? 0), max: Math.round(data.daily?.temperature_2m_max?.[0] ?? 0), min: Math.round(data.daily?.temperature_2m_min?.[0] ?? 0), wind: Math.round(data.current?.wind_speed_10m ?? 0), label: meta[0], icon: meta[1] });
      } catch (error) { if ((error as Error).name !== 'AbortError') console.warn('Pogoda chwilowo niedostępna'); }
    }
    void loadWeather(); const timer = window.setInterval(() => void loadWeather(), 30 * 60 * 1000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  const statusDay = warsawCalendarDay(now); const todayKey = statusDay.key;
  const schoolProjection = useMemo(() => projectSchoolCalendar(schoolRecords, events, schoolSources.access, profiles), [schoolRecords, events, schoolSources.scope, profiles]);
  const okruszekEvents = useMemo(() => projectOkruszekCalendar(schoolRecords, events, schoolSources.access, profiles), [schoolRecords, events, schoolSources.scope, profiles]);
  const manualSchoolProjection = useMemo(() => projectManualSchoolCalendar(schoolRecords, events, schoolSources.access), [schoolRecords, events, schoolSources.scope]);
  const calendarSources = useMemo(() => [...events.map(calendarSourceDisplayEvent), ...schoolProjection.events, ...okruszekEvents,
    ...manualSchoolProjection.events, ...musicEvents, ...healthSources.events, ...projectFamilyBirthdays(profiles)], [events, schoolProjection.events, okruszekEvents, manualSchoolProjection.events, musicEvents, healthSources.events, profiles]);
  const sharedEvents = useMemo(() => familyCalendarEvents(calendarSources), [calendarSources]);
  const statusViewer = useMemo(() => ({ uid: user.uid, person: own }), [user.uid, own]);
  const statusEvents = useMemo(() => calendarSources.filter(event => !event.private || ((event.person === own || event.person === 'family')
    && (event.ownerUid || event.createdBy) === user.uid)), [calendarSources, own, user.uid]);
  const statusOccurrences = useMemo(() => generateCalendarOccurrencesFromSources(calendarRangeDisplaySources(statusEvents, statusDay.start, statusDay.end), statusDay.start, statusDay.end), [statusEvents, todayKey]);
  const nextStatusRefreshAt = now.getTime() + familyStatusRefreshDelay(statusOccurrences, now, statusViewer);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') setNow(new Date()); };
    // A snapshot rerender must not move the boundary into the future. Use an
    // absolute deadline and account for time since React's last clock update.
    const timer = window.setTimeout(refresh, Math.max(0, nextStatusRefreshAt - Date.now()));
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [nextStatusRefreshAt, user.uid]);
  const agendaRange = useMemo(() => familyAgendaRange(now), [todayKey]);
  const agendaOccurrences = useMemo(() => generateCalendarOccurrencesFromSources(calendarRangeDisplaySources(sharedEvents, agendaRange.start, agendaRange.end), agendaRange.start, agendaRange.end), [sharedEvents, agendaRange]);
  const upcoming = useMemo(() => upcomingFamilyEvents(agendaOccurrences, now), [agendaOccurrences, now]);
  const openedCalendarOccurrence = calendarDetail?.uid === user.uid ? upcoming.find(item => item.key === calendarDetail.key) : null;
  const familyTime = buildFamilyTime(profiles, statusOccurrences, [], now, statusViewer);
  const openTasks = tasks.filter(item => !item.done).sort((a, b) => ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority] || (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99')));
  const openShopping = shopping.filter(item => !item.done);
  const conversations = latestConversations(messages, profiles, user.uid);
  return <>
    {musicSources.error && <p className="calendar-source-notice" role="status">Nie udało się odczytać planu szkoły muzycznej. Terminy i status rodziny mogą nie uwzględniać tych zajęć.<button type="button" onClick={musicSources.reload}>Ponów odczyt planu</button></p>}
    <FamilyHome name={name} now={now} weather={weather} familyTime={familyTime} profiles={profiles} upcoming={upcoming}
      tasks={openTasks} school={schoolPreview} schoolError={schoolSources.error} shoppingCount={openShopping.length} chatCount={conversations.length} order={order} loaded={loaded}
      saveOrder={saveOrder} goTo={goTo} onOpenEvent={key => setCalendarDetail({ uid: user.uid, key })}/>
    {openedCalendarOccurrence && <Modal title={openedCalendarOccurrence.source.title} subtitle="Wydarzenie rodzinne" onClose={() => setCalendarDetail(null)}><div className="details-grid"><CalendarOwnerBadge event={openedCalendarOccurrence.source}/><DetailRow label="Termin" value={openedCalendarOccurrence.date.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })}/><DetailRow label="Godzina" value={openedCalendarOccurrence.source.allDay ? 'Cały dzień' : `${formatWarsawTime(openedCalendarOccurrence.date)}–${formatWarsawTime(openedCalendarOccurrence.endDate)}`}/>{openedCalendarOccurrence.source.cancelled && <DetailRow label="Status" value="ODWOŁANE"/>}{openedCalendarOccurrence.source.description && <DetailRow label="Opis" value={openedCalendarOccurrence.source.description}/>}</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setCalendarDetail(null); goTo('Kalendarz'); }}>Otwórz Kalendarz</button></div></Modal>}
  </>;
}
