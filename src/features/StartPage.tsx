import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { User } from 'firebase/auth';
import { collection, query, where, Timestamp } from 'firebase/firestore';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { db } from '../firebase';
import { onSnapshot } from '../feedback';
import { AppIcon, capitalize, formatShortDate, formatTime, isParent, isPersonKey, ownPerson, personLabel, schoolQuery, isSchoolType, type CalendarEventData, type Member, type Page, type SchoolRecord, type TaskItem, type ChatMessage } from '../app-shared';
import { addDays, endOfDay, formatDateInput, generateOccurrences, parseLocalDate, startOfDay } from '../calendar-utils';
import { subscribeCalendar } from '../calendar-store';
import { Icon } from '../ui';
import { useDashboardOrder } from './useDashboardOrder';
import { reorderDashboardCards, type StartCardId } from './start-layout';
import './start-dashboard.css';

type Weather = { temp: number; max: number; min: number; wind: number; label: string; icon: string };
type HealthPreview = { id: string; title: string; person: string; type: string; date: string; time: string; status: string; medicineTime: string; confirmedDate: string };
type Tile = { id: StartCardId; label: string; page: Page; value: ReactNode; status: string; preview: ReactNode };
function timestampDate(value: unknown) { return value instanceof Timestamp ? value.toDate() : undefined; }

/** No sortable transforms: all seven source tiles keep their positions until drop. */
function DashboardTile({ tile, active, onOpen, suppressClick, dragDisabled }: { tile: Tile; active: boolean; onOpen: () => void; suppressClick: () => boolean; dragDisabled: boolean }) {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id: tile.id, disabled: dragDisabled });
  const { setNodeRef: setDropRef } = useDroppable({ id: tile.id });
  return <button ref={node => { setDragRef(node); setDropRef(node); }} {...attributes} {...listeners}
    type="button" className={`start-dashboard-card start-card--${tile.id}${active ? ' is-drag-source' : ''}`}
    data-testid={`start-card-${tile.id}`} data-card-id={tile.id} aria-label={tile.label} aria-describedby={`start-card-preview-${tile.id}`}
    onClick={event => { if (suppressClick()) { event.preventDefault(); return; } onOpen(); }} onContextMenu={event => event.preventDefault()}>
    <TileContents tile={tile}/>
  </button>;
}

function TileContents({ tile, overlay = false }: { tile: Tile; overlay?: boolean }) {
  return <>
    <span className="start-card-heading"><span className="start-card-icon"><AppIcon page={tile.id === 'family-time' ? 'Rodzina' : tile.page} size={26}/></span><strong>{tile.label}</strong><Icon name="arrow-right" size={17}/></span>
    <span className="start-card-value">{tile.value}</span><span className="start-card-status">{tile.status}</span>
    <span className="start-card-preview" id={overlay ? undefined : `start-card-preview-${tile.id}`}>{tile.preview}</span>
  </>;
}

export function StartPage({ user, member, goTo }: { user: User; member: Member | null; goTo: (page: Page) => void }) {
  const name = member?.name || 'Rodzina';
  const parent = isParent(member); const own = ownPerson(member);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<CalendarEventData[]>([]);
  const [schoolRecords, setSchoolRecords] = useState<SchoolRecord[]>([]);
  const [shopping, setShopping] = useState<{ id: string; title: string; done: boolean; quantity: string; unit: string }[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [health, setHealth] = useState<HealthPreview[]>([]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [activeCard, setActiveCard] = useState<StartCardId | null>(null);
  const [now, setNow] = useState(() => new Date());
  const { order, saveOrder, loaded } = useDashboardOrder(user.uid);
  const suppressClickUntil = useRef(0);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 550, tolerance: 8 } }),
    // Preserve ordinary scrolling until the delayed gesture activates on Safari.
    useSensor(TouchSensor, { activationConstraint: { delay: 550, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => onSnapshot(collection(db, 'tasks'), snap => {
    setTasks(snap.docs.map(d => {
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
    const x = d.data(); return { id: d.id, title: String(x.title || ''), done: x.done === true, quantity: typeof x.quantity === 'string' ? x.quantity : '', unit: typeof x.unit === 'string' ? x.unit : '' };
  }))), [user.uid]);
  useEffect(() => subscribeCalendar(user.uid, setEvents), [user.uid]);
  useEffect(() => onSnapshot(schoolQuery(member), snap => setSchoolRecords(snap.docs.map(d => {
    const x = d.data();
    return { id: d.id, title: String(x.title || ''), person: isPersonKey(x.person) ? x.person : 'Nikodem', type: isSchoolType(x.type) ? x.type : 'homework',
      subject: typeof x.subject === 'string' ? x.subject : '', date: typeof x.date === 'string' ? x.date : '', time: typeof x.time === 'string' ? x.time : '',
      endTime: typeof x.endTime === 'string' ? x.endTime : '', weekday: Number(x.weekday || 0), note: typeof x.note === 'string' ? x.note : '', createdAt: timestampDate(x.createdAt) };
  }))), [user.uid, parent, own]);
  useEffect(() => {
    const groups: Record<string, ChatMessage[]> = { family: [], private: [] };
    const load = (group: string, snap: import('firebase/firestore').QuerySnapshot) => {
      groups[group] = snap.docs.map(d => { const x = d.data(); return { id: d.id, text: String(x.text || ''), name: String(x.name || 'Rodzina'), uid: String(x.uid || ''), channel: String(x.channel || 'family'), createdAt: timestampDate(x.createdAt) }; });
      setMessages([...groups.family, ...groups.private].sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)));
    };
    const family = onSnapshot(query(collection(db, 'familyMessages'), where('channel', '==', 'family')), snap => load('family', snap));
    const privateMessages = onSnapshot(query(collection(db, 'familyMessages'), where('participants', 'array-contains', user.uid)), snap => load('private', snap));
    return () => { family(); privateMessages(); };
  }, [user.uid]);
  useEffect(() => onSnapshot(parent ? collection(db, 'healthRecords') : query(collection(db, 'healthRecords'), where('privateToParents', '==', false), where('person', 'in', ['family', own])), snap => {
    setHealth(snap.docs.map(d => { const x = d.data(); return { id: d.id, title: String(x.title || ''), person: String(x.person || 'family'), type: String(x.type || ''), date: String(x.date || ''), time: String(x.time || ''), status: String(x.status || ''), medicineTime: String(x.medicineTime || x.time || ''), confirmedDate: String(x.confirmedDate || '') }; }));
  }), [user.uid, parent, own]);
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

  const todayKey = formatDateInput(now); const todayWeekday = now.getDay() === 0 ? 7 : now.getDay();
  const todayOccurrences = useMemo(() => events.flatMap(event => generateOccurrences(event, startOfDay(now), endOfDay(now))).sort((a, b) => a.date.getTime() - b.date.getTime()), [events, todayKey]);
  const upcomingEvents = useMemo(() => events.flatMap(event => generateOccurrences(event, startOfDay(now), endOfDay(addDays(now, 45)))).filter(occurrence => occurrence.endDate >= now).sort((a, b) => a.date.getTime() - b.date.getTime()), [events, now]);
  const todaySchoolItems = useMemo(() => schoolRecords.filter(record => (record.type === 'lesson' || record.type === 'activity') && (record.weekday === todayWeekday || (!!record.date && record.date === todayKey))).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')), [schoolRecords, todayWeekday, todayKey]);
  function schoolEnd(record: SchoolRecord) {
    const start = parseLocalDate(todayKey, record.time || '08:00'); const end = parseLocalDate(todayKey, record.endTime || record.time || '08:45');
    return end > start ? end : new Date(start.getTime() + 45 * 60000);
  }
  const allFreeAt = useMemo(() => {
    const ends = todayOccurrences.filter(occurrence => occurrence.source.person !== 'family' && !occurrence.source.allDay).map(occurrence => occurrence.endDate);
    for (const item of todaySchoolItems) ends.push(schoolEnd(item));
    return ends.length ? formatTime(ends.reduce((max, value) => value > max ? value : max, ends[0])) : 'Teraz';
  }, [todayOccurrences, todaySchoolItems, todayKey]);
  const openTasks = tasks.filter(item => !item.done).sort((a, b) => ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority] || (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99')));
  const openShopping = shopping.filter(item => !item.done);
  const latestConversations = messages.filter((message, index, all) => all.findIndex(other => other.channel === message.channel) === index).slice(0, 3);
  const healthUpcoming = health.filter(record => record.type === 'visit' && record.date >= todayKey && record.status !== 'cancelled' && record.status !== 'done').sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const medicines = health.filter(record => record.type === 'medicine' && record.confirmedDate !== todayKey).sort((a, b) => a.medicineTime.localeCompare(b.medicineTime));
  const schoolUpcoming = schoolRecords.filter(record => (record.type === 'homework' || record.type === 'test') && (!record.date || record.date >= todayKey)).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const rows = (items: ReactNode[]) => items.length ? <span className="start-preview-rows">{items.map((item, index) => <span key={index}>{item}</span>)}</span> : null;
  const tiles: Tile[] = [
    { id: 'family-time', label: 'Rodzinny czas', page: 'Kalendarz', value: allFreeAt, status: allFreeAt === 'Teraz' ? 'Wszyscy wolni' : 'Wszyscy wolni od…', preview: 'Liczymy godziny zakończenia pracy, szkoły i zajęć.' },
    { id: 'calendar', label: 'Kalendarz', page: 'Kalendarz', value: todayOccurrences.length, status: 'wydarzeń dzisiaj', preview: rows(upcomingEvents.slice(0, 3).map(occurrence => <><time>{formatShortDate(formatDateInput(occurrence.date))} · {occurrence.source.allDay ? 'cały dzień' : formatTime(occurrence.date)}</time><span>{occurrence.source.title}</span></>)) || 'Brak nadchodzących wydarzeń.' },
    { id: 'tasks', label: 'Zadania', page: 'Zadania', value: openTasks.length, status: 'zadań do zrobienia', preview: rows(openTasks.slice(0, 3).map(item => <><span className={`start-preview-dot${item.priority === 'high' ? ' important' : ''}`}/><span>{item.title}</span></>)) || 'Brak zadań do zrobienia.' },
    { id: 'shopping', label: 'Zakupy', page: 'Zakupy', value: openShopping.length, status: 'produktów na liście', preview: rows(openShopping.slice(0, 3).map(item => <><span className="start-preview-dot"/><span>{item.title}{item.quantity ? ` · ${item.quantity} ${item.unit}` : ''}</span></>)) || 'Lista zakupów jest pusta.' },
    { id: 'chat', label: 'Czat', page: 'Czat', value: latestConversations.length, status: 'ostatnie rozmowy', preview: rows(latestConversations.map(message => <><span className="start-chat-name">{message.channel === 'family' ? 'Rodzina' : message.name}</span><span>{message.text.slice(0, 85)}</span></>)) || 'Napisz pierwszą wiadomość.' },
    { id: 'health', label: 'Zdrowie', page: 'Zdrowie', value: healthUpcoming.length, status: 'nadchodzących wizyt', preview: rows([...healthUpcoming.slice(0, 2).map(record => <><time>{formatShortDate(record.date)} · {record.time || '—'}</time><span>{record.title} · {record.person}</span></>), ...medicines.slice(0, 1).map(record => <><time>{record.medicineTime || 'Lek'}</time><span>{record.title} · {record.person}</span></>)]) || 'Brak nadchodzących wizyt i leków do potwierdzenia.' },
    { id: 'school', label: 'Szkoła', page: 'Szkoła', value: todaySchoolItems.length, status: 'lekcji i zajęć dzisiaj', preview: rows([...todaySchoolItems.slice(0, 1).map(record => <><time>{record.time || '—'}</time><span>{record.subject || record.title} · {personLabel(record.person)}</span></>), ...schoolUpcoming.slice(0, 2).map(record => <><span className="start-school-kind">{record.type === 'test' ? 'Sprawdzian' : 'Zadanie'}</span><span>{record.title} · {personLabel(record.person)}</span></>)]) || 'Brak zaplanowanych zajęć i nowych zadań.' },
  ];
  const byId = Object.fromEntries(tiles.map(tile => [tile.id, tile])) as Record<StartCardId, Tile>;
  function finishDrag(event: DragEndEvent) {
    setActiveCard(null); suppressClickUntil.current = Date.now() + 250;
    if (event.over && event.active.id !== event.over.id) saveOrder(reorderDashboardCards(order, event.active.id, event.over.id));
  }
  return <div className="page-content start-dashboard-page family-ui start-dashboard-v151" data-testid="start-dashboard">
    <section className="start-family-banner" data-testid="start-merged-banner" aria-label="Powitanie i pogoda">
      <div className="start-welcome-copy"><h1>Cześć, <span>{name}!</span> <span aria-hidden="true">👋</span></h1><p>Miło Cię znowu widzieć.<br/>Dobrego dnia dla całej rodziny!</p></div>
      <div className="start-family-art" aria-hidden="true"><img src="/start-banner.png" alt=""/></div>
      <div className="start-banner-weather" title="Pogoda: Open-Meteo"><span className="start-weather-symbol" aria-hidden="true">{weather?.icon || '🌤️'}</span><div className="start-weather-reading"><strong>Kołobrzeg</strong><b>{weather ? `${weather.temp}°C` : '—°C'}</b><small>{weather?.label || 'Pobieranie pogody…'}</small></div><div className="start-weather-date"><strong>{capitalize(now.toLocaleDateString('pl-PL', { weekday: 'long' }))}</strong><time dateTime={todayKey}>{now.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}</time>{weather && <small>↑ {weather.max}°C · ↓ {weather.min}°C<br/>Wiatr {weather.wind} km/h</small>}</div></div>
    </section>
    <p className="start-drag-hint" id="start-drag-hint"><Icon name="users" size={15}/> Przytrzymaj kafel, aby przenieść. Układ zapisuje się na Twoim koncie.</p>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={event => { suppressClickUntil.current = Number.POSITIVE_INFINITY; setActiveCard(event.active.id as StartCardId); }} onDragEnd={finishDrag} onDragCancel={() => { setActiveCard(null); suppressClickUntil.current = Date.now() + 250; }} accessibility={{ screenReaderInstructions: { draggable: 'Naciśnij spację, aby przenieść kafel. Użyj strzałek, następnie spacji, aby zapisać kolejność. Escape anuluje.' }, announcements: {
      onDragStart: ({ active }) => `Przenosisz ${byId[active.id as StartCardId]?.label || 'kafel'}. Kolejność zmieni się po puszczeniu.`,
      onDragOver: ({ over }) => over ? `Upuść przy ${byId[over.id as StartCardId]?.label || 'kaflu'}.` : 'Poza kaflami.',
      onDragEnd: ({ active, over }) => over ? `Zapisano pozycję ${byId[active.id as StartCardId]?.label || 'kafla'}.` : 'Anulowano przenoszenie.',
      onDragCancel: () => 'Anulowano przenoszenie. Kolejność bez zmian.',
    } }}>
      <section className="start-dashboard-grid" aria-label="Twój rodzinny Start" aria-describedby="start-drag-hint" data-order={order.join(',')} data-layout-ready={loaded}>
        {order.map(id => <DashboardTile key={id} tile={byId[id]} active={activeCard === id} onOpen={() => goTo(byId[id].page)} suppressClick={() => Date.now() < suppressClickUntil.current} dragDisabled={!loaded}/>)}
      </section>
      {createPortal(<DragOverlay dropAnimation={null} zIndex={1200}>{activeCard && <div className={`start-dashboard-card start-card--${activeCard} start-card-overlay`} data-testid="start-drag-overlay" aria-hidden="true"><TileContents tile={byId[activeCard]} overlay/></div>}</DragOverlay>, document.body)}
    </DndContext>
  </div>;
}
