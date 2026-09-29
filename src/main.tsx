import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import './style.css';

const APP_VERSION = '1.1.0';
const APP_UPDATED = '29.09.2026';

/* =========================================================
   TYPES
   ========================================================= */

type Member = {
  name?: string;
  role?: string;
  photoURL?: string;
  active?: boolean;
  canLogin?: boolean;
};

type Page =
  | 'Start'
  | 'Kalendarz'
  | 'Zadania'
  | 'Zakupy'
  | 'Czat'
  | 'Zdrowie'
  | 'Szkoła'
  | 'Rodzina'
  | 'Ustawienia';

type PersonKey =
  | 'family'
  | 'Sebastian'
  | 'Dominika'
  | 'Paweł'
  | 'Nikodem'
  | 'Layla';

type CalendarView = 'day' | 'week' | 'month';
type RepeatType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type TaskPriority = 'low' | 'normal' | 'high';

type CalendarEventData = {
  id: string;
  title: string;
  person: PersonKey;
  date: Date;
  endDate: Date;
  allDay: boolean;
  description: string;
  createdBy: string;
  repeat: RepeatType;
  repeatUntil: Date | null;
};

type CalendarOccurrence = {
  key: string;
  source: CalendarEventData;
  date: Date;
  endDate: Date;
};

type EventForm = {
  title: string;
  person: PersonKey;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  description: string;
  repeat: RepeatType;
  repeatUntil: string;
};

type TaskItem = {
  id: string;
  title: string;
  person: PersonKey;
  done: boolean;
  dueDate: string;
  priority: TaskPriority;
  note: string;
  createdAt?: Date;
};

type TaskForm = {
  title: string;
  person: PersonKey;
  dueDate: string;
  priority: TaskPriority;
  note: string;
};

type ShoppingCategory =
  | 'owoce'
  | 'warzywa'
  | 'nabial'
  | 'pieczywo'
  | 'mieso'
  | 'mrozonki'
  | 'napoje'
  | 'chemia'
  | 'zwierzeta'
  | 'dzieci'
  | 'inne';

type ShoppingItem = {
  id: string;
  title: string;
  done: boolean;
  category: ShoppingCategory;
  quantity: string;
  unit: string;
  createdAt?: Date;
};

type ChatMessage = {
  id: string;
  text: string;
  name: string;
  uid: string;
  createdAt?: Date;
};

type HealthType = 'visit' | 'doctor' | 'medicine' | 'result' | 'history';
type HealthRecord = {
  id: string;
  title: string;
  person: PersonKey;
  type: HealthType;
  date: string;
  time: string;
  doctor: string;
  location: string;
  note: string;
  createdAt?: Date;
};

type HealthForm = Omit<HealthRecord, 'id' | 'createdAt'> & {
  addToCalendar: boolean;
};

type SchoolType = 'lesson' | 'homework' | 'test' | 'grade' | 'message' | 'activity';
type SchoolRecord = {
  id: string;
  title: string;
  person: PersonKey;
  type: SchoolType;
  subject: string;
  date: string;
  time: string;
  note: string;
  createdAt?: Date;
};

type SchoolForm = Omit<SchoolRecord, 'id' | 'createdAt'> & {
  addToCalendar: boolean;
};

type FamilyMemberDoc = {
  id: string;
  name: string;
  role: string;
  photoURL?: string;
  active?: boolean;
};

/* =========================================================
   HELPERS
   ========================================================= */

const PEOPLE: PersonKey[] = ['family', 'Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'];

function isPersonKey(value: unknown): value is PersonKey {
  return PEOPLE.includes(value as PersonKey);
}

function personLabel(person: PersonKey) {
  return person === 'family' ? 'Cała rodzina' : person;
}

function personColor(person: PersonKey) {
  switch (person) {
    case 'Sebastian': return '#3182f6';
    case 'Dominika': return '#8b5cf6';
    case 'Paweł': return '#22c55e';
    case 'Nikodem': return '#f59e0b';
    case 'Layla': return '#ec4899';
    default: return '#64748b';
  }
}

function personEventClass(person: PersonKey) {
  switch (person) {
    case 'Sebastian': return 'event-sebastian';
    case 'Dominika': return 'event-dominika';
    case 'Paweł': return 'event-pawel';
    case 'Nikodem': return 'event-nikodem';
    case 'Layla': return 'event-layla';
    default: return 'event-family';
  }
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function startOfWeek(date: Date) {
  const result = startOfDay(date);
  const day = result.getDay();
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day));
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function addYears(date: Date, years: number) {
  const result = new Date(date);
  const month = result.getMonth();
  result.setFullYear(result.getFullYear() + years);
  if (result.getMonth() !== month) result.setDate(0);
  return result;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function formatShortDate(value: string) {
  if (!value) return 'Bez terminu';
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function dynamicTodayLabel() {
  return capitalize(new Date().toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }));
}

function weekTitle(weekStart: Date) {
  const end = addDays(weekStart, 6);
  const startMonth = weekStart.toLocaleDateString('pl-PL', { month: 'short' });
  const endMonth = end.toLocaleDateString('pl-PL', { month: 'short' });
  if (weekStart.getMonth() === end.getMonth()) {
    return `${weekStart.getDate()}–${end.getDate()} ${endMonth} ${end.getFullYear()}`;
  }
  return `${weekStart.getDate()} ${startMonth} – ${end.getDate()} ${endMonth} ${end.getFullYear()}`;
}

function parseLocalDate(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

function isRepeatType(value: unknown): value is RepeatType {
  return value === 'none' || value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly';
}

function repeatLabel(value: RepeatType) {
  switch (value) {
    case 'daily': return 'Codziennie';
    case 'weekly': return 'Co tydzień';
    case 'monthly': return 'Co miesiąc';
    case 'yearly': return 'Co rok';
    default: return 'Nie powtarzaj';
  }
}

function occurrenceAt(base: Date, repeat: RepeatType, index: number) {
  if (repeat === 'daily') return addDays(base, index);
  if (repeat === 'weekly') return addDays(base, index * 7);
  if (repeat === 'monthly') return addMonths(base, index);
  if (repeat === 'yearly') return addYears(base, index);
  return new Date(base);
}

function generateOccurrences(event: CalendarEventData, rangeStart: Date, rangeEnd: Date): CalendarOccurrence[] {
  const duration = event.endDate.getTime() - event.date.getTime();
  const occurrences: CalendarOccurrence[] = [];

  if (event.repeat === 'none') {
    if (event.date <= rangeEnd && event.endDate >= rangeStart) {
      occurrences.push({ key: `${event.id}-${event.date.getTime()}`, source: event, date: event.date, endDate: event.endDate });
    }
    return occurrences;
  }

  const repeatUntil = event.repeatUntil ? endOfDay(event.repeatUntil) : rangeEnd;
  const hardEnd = repeatUntil < rangeEnd ? repeatUntil : rangeEnd;

  for (let index = 0; index < 2000; index += 1) {
    const date = occurrenceAt(event.date, event.repeat, index);
    if (date > hardEnd) break;
    const endDate = new Date(date.getTime() + duration);
    if (date <= rangeEnd && endDate >= rangeStart) {
      occurrences.push({ key: `${event.id}-${date.getTime()}`, source: event, date, endDate });
    }
  }

  return occurrences;
}

function initials(name?: string) {
  if (!name) return '🙂';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '🙂';
}

function memberEmoji(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes('dominika')) return '👩';
  if (normalized.includes('sebastian')) return '👨';
  if (normalized.includes('nikodem')) return '👦';
  if (normalized.includes('layla')) return '👶';
  if (normalized.includes('paweł') || normalized.includes('pawel')) return '🧑';
  return '🙂';
}

/* =========================================================
   APP + LOGIN
   ========================================================= */

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (currentUser) => {
    setUser(currentUser);
    setLoading(false);
  }), []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="family-logo">👨‍👩‍👧‍👦</div>
          <h2>Nasza Rodzina</h2>
          <p>Ładowanie rodzinnego centrum…</p>
        </div>
      </div>
    );
  }

  return user ? <FamilyApp user={user} /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoggingIn(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      console.error(err);
      setError('Nie udało się zalogować. Sprawdź e-mail i hasło.');
    } finally {
      setLoggingIn(false);
    }
  }

  const features = [
    ['📅', 'Kalendarz'], ['✅', 'Zadania'], ['🛒', 'Zakupy'], ['💬', 'Czat'],
    ['❤️', 'Zdrowie'], ['🎒', 'Szkoła'], ['👨‍👩‍👧‍👦', 'Rodzina'],
  ];

  return (
    <div className="login-v11">
      <div className="login-v11-overlay" />
      <div className="login-v11-brand">
        <span className="login-v11-mark">👨‍👩‍👧‍👦</span>
        <div><strong>Nasza Rodzina</strong><small>Rodzinne centrum</small></div>
      </div>

      <div className="login-v11-panel">
        <div className="login-v11-title">
          <span>👨‍👩‍👧‍👦</span>
          <div>
            <h1>Nasza Rodzina</h1>
            <p>Wszystko, co ważne. Razem.</p>
          </div>
        </div>

        <form className="login-v11-form" onSubmit={handleLogin}>
          <label>
            <span>E-mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Twój e-mail" required />
          </label>
          <label>
            <span>Hasło</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Hasło" required />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" disabled={loggingIn}>{loggingIn ? 'Logowanie…' : 'Zaloguj się'}</button>
        </form>

        <div className="login-v11-divider"><span>Rodzinne centrum w jednym miejscu ❤️</span></div>
        <div className="login-v11-features">
          {features.map(([icon, label]) => <div key={label}><span>{icon}</span><small>{label}</small></div>)}
        </div>
      </div>

      <div className="login-v11-version">v{APP_VERSION}</div>
    </div>
  );
}

/* =========================================================
   APP SHELL
   ========================================================= */

function FamilyApp({ user }: { user: User }) {
  const [page, setPage] = useState<Page>('Start');
  const [member, setMember] = useState<Member | null>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  useEffect(() => {
    async function loadMember() {
      try {
        const snapshot = await getDoc(doc(db, 'members', user.uid));
        if (snapshot.exists()) setMember(snapshot.data() as Member);
      } catch (error) {
        console.error('Błąd profilu:', error);
      }
    }
    void loadMember();
  }, [user.uid]);

  function goTo(next: Page) {
    setPage(next);
    setMobileMoreOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderPage() {
    switch (page) {
      case 'Start': return <StartPage member={member} goTo={goTo} />;
      case 'Kalendarz': return <CalendarPage user={user} />;
      case 'Zadania': return <TasksPage user={user} />;
      case 'Zakupy': return <ShoppingPage user={user} />;
      case 'Czat': return <ChatPage user={user} member={member} />;
      case 'Zdrowie': return <HealthPage user={user} />;
      case 'Szkoła': return <SchoolPage user={user} />;
      case 'Rodzina': return <FamilyPage />;
      case 'Ustawienia': return <SettingsPage member={member} />;
      default: return <StartPage member={member} goTo={goTo} />;
    }
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} goTo={goTo} member={member} />
      <main className="main-area">
        <FamilyHeader member={member} onLogout={() => signOut(auth)} />
        {renderPage()}
      </main>
      <MobileNavigation page={page} goTo={goTo} onMore={() => setMobileMoreOpen(true)} />
      {mobileMoreOpen && (
        <MobileMoreMenu page={page} goTo={goTo} onClose={() => setMobileMoreOpen(false)} onLogout={() => signOut(auth)} />
      )}
    </div>
  );
}

function Sidebar({ page, goTo, member }: { page: Page; goTo: (page: Page) => void; member: Member | null }) {
  const items: Array<[Page, string]> = [
    ['Start', '🏠'], ['Kalendarz', '📅'], ['Zadania', '✅'], ['Zakupy', '🛒'], ['Czat', '💬'],
    ['Zdrowie', '❤️'], ['Szkoła', '🎒'], ['Rodzina', '👨‍👩‍👧‍👦'], ['Ustawienia', '⚙️'],
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">👨‍👩‍👧‍👦</div>
        <div><strong>Nasza Rodzina</strong><small>Rodzinne centrum</small></div>
      </div>
      <nav className="sidebar-nav">
        {items.map(([label, icon]) => (
          <button key={label} type="button" className={`nav-button ${page === label ? 'active' : ''}`} onClick={() => goTo(label)}>
            <span>{icon}</span>{label}
          </button>
        ))}
      </nav>
      <div className="sidebar-profile">
        <div className="profile-avatar">{member?.photoURL ? <img src={member.photoURL} alt="" /> : initials(member?.name)}</div>
        <div><strong>{member?.name || 'Rodzina'}</strong><small>{member?.role || 'Użytkownik'}</small></div>
      </div>
    </aside>
  );
}

function FamilyHeader({ member, onLogout }: { member: Member | null; onLogout: () => void }) {
  return (
    <header className="top-header">
      <div><small>Rodzinne centrum</small><strong>Nasza Rodzina</strong></div>
      <div className="header-user">
        <div className="header-user-text"><strong>{member?.name || 'Użytkownik'}</strong><small>{member?.role || 'Rodzina'}</small></div>
        <button type="button" onClick={onLogout}>Wyloguj</button>
      </div>
    </header>
  );
}

/* =========================================================
   START
   ========================================================= */

function StartPage({ member, goTo }: { member: Member | null; goTo: (page: Page) => void }) {
  const name = member?.name || 'Rodzina';
  const cards: Array<[Page, string, string, string]> = [
    ['Kalendarz', '📅', 'Kalendarz', 'Wydarzenia i plany całej rodziny.'],
    ['Zadania', '✅', 'Zadania', 'Obowiązki, terminy i priorytety.'],
    ['Zakupy', '🛒', 'Zakupy', 'Lista pogrupowana według działów sklepu.'],
    ['Czat', '💬', 'Czat rodzinny', 'Wiadomości w jednym miejscu.'],
    ['Zdrowie', '❤️', 'Zdrowie', 'Wizyty, lekarze, leki i historia.'],
    ['Szkoła', '🎒', 'Szkoła', 'Sprawdziany, zadania i zajęcia.'],
  ];

  return (
    <div className="page-content compact-page">
      <section className="welcome-card">
        <div><small>{dynamicTodayLabel()}</small><h1>Cześć, {name}! 👋</h1><p>Miło Cię widzieć w Waszym rodzinnym centrum.</p></div>
        <div className="welcome-illustration">🏡</div>
      </section>
      <section className="dashboard-grid compact-dashboard">
        {cards.map(([page, icon, title, text]) => (
          <button className="app-card dashboard-link" type="button" key={page} onClick={() => goTo(page)}>
            <div className="card-icon">{icon}</div><h3>{title}</h3><p>{text}</p><span>Otwórz →</span>
          </button>
        ))}
      </section>
    </div>
  );
}

/* =========================================================
   SHARED UI
   ========================================================= */

function ModuleHeader({ icon, title, text, action }: { icon: string; title: string; text: string; action?: React.ReactNode }) {
  return (
    <section className="page-header compact-header">
      <div><small>Nasza Rodzina</small><h1>{icon} {title}</h1><p>{text}</p></div>
      {action}
    </section>
  );
}

function PersonSelect({ value, onChange, includeFamily = true, schoolOnly = false }: { value: PersonKey; onChange: (v: PersonKey) => void; includeFamily?: boolean; schoolOnly?: boolean }) {
  const options: PersonKey[] = schoolOnly ? ['Paweł', 'Nikodem'] : (includeFamily ? PEOPLE : PEOPLE.filter((p) => p !== 'family'));
  return (
    <select value={value} onChange={(e) => isPersonKey(e.target.value) && onChange(e.target.value)}>
      {options.map((person) => <option key={person} value={person}>{personLabel(person)}</option>)}
    </select>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return <div className="empty-state"><span>{icon}</span><p>{text}</p></div>;
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={`modal-card ${wide ? 'wide' : ''}`}>
        <header className="modal-header">
          <div><small>{subtitle || 'Nasza Rodzina'}</small><h2>{title}</h2></div>
          <button type="button" onClick={onClose} aria-label="Zamknij">✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

/* =========================================================
   CALENDAR 2.1
   ========================================================= */

function CalendarPage({ user }: { user: User }) {
  const [view, setView] = useState<CalendarView>('week');
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEventData[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonKey>('family');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EventForm>(() => createDefaultEventForm(new Date()));
  const [saving, setSaving] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventData | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EventForm>(() => createDefaultEventForm(new Date()));
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => onSnapshot(collection(db, 'calendarEvents'), (snapshot) => {
    const loaded: CalendarEventData[] = [];
    snapshot.forEach((eventDoc) => {
      const data = eventDoc.data();
      if (!(data.date instanceof Timestamp)) return;
      const start = data.date.toDate();
      const end = data.endDate instanceof Timestamp ? data.endDate.toDate() : new Date(start.getTime() + 3600000);
      loaded.push({
        id: eventDoc.id,
        title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Wydarzenie',
        person: isPersonKey(data.person) ? data.person : 'family',
        date: start,
        endDate: end,
        allDay: data.allDay === true,
        description: typeof data.description === 'string' ? data.description : '',
        createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
        repeat: isRepeatType(data.repeat) ? data.repeat : 'none',
        repeatUntil: data.repeatUntil instanceof Timestamp ? data.repeatUntil.toDate() : null,
      });
    });
    loaded.sort((a, b) => a.date.getTime() - b.date.getTime());
    setEvents(loaded);
    setSelectedEvent((current) => current ? loaded.find((item) => item.id === current.id) || null : null);
  }, (error) => console.error('Błąd kalendarza:', error)), []);

  const weekStart = useMemo(() => startOfWeek(focusDate), [focusDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const monthDays = useMemo(() => {
    const first = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [focusDate]);

  const range = useMemo(() => {
    if (view === 'day') return { start: startOfDay(focusDate), end: endOfDay(focusDate) };
    if (view === 'week') return { start: startOfDay(weekStart), end: endOfDay(addDays(weekStart, 6)) };
    return { start: startOfDay(monthDays[0]), end: endOfDay(monthDays[monthDays.length - 1]) };
  }, [view, focusDate, weekStart, monthDays]);

  const occurrences = useMemo(() => {
    return events
      .filter((event) => selectedPerson === 'family' || event.person === selectedPerson || event.person === 'family')
      .flatMap((event) => generateOccurrences(event, range.start, range.end))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [events, selectedPerson, range]);

  const todayRange = useMemo(() => ({ start: startOfDay(new Date()), end: endOfDay(new Date()) }), []);
  const todayOccurrences = useMemo(() => events
    .filter((event) => selectedPerson === 'family' || event.person === selectedPerson || event.person === 'family')
    .flatMap((event) => generateOccurrences(event, todayRange.start, todayRange.end)), [events, selectedPerson, todayRange]);

  const upcomingOccurrences = useMemo(() => {
    const now = new Date();
    const futureEnd = endOfDay(addDays(now, 30));
    return events
      .filter((event) => selectedPerson === 'family' || event.person === selectedPerson || event.person === 'family')
      .flatMap((event) => generateOccurrences(event, now, futureEnd))
      .filter((item) => item.date >= now)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 5);
  }, [events, selectedPerson]);

  function titleForView() {
    if (view === 'day') return capitalize(focusDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    if (view === 'week') return weekTitle(weekStart);
    return capitalize(focusDate.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }));
  }

  function navigate(direction: number) {
    if (view === 'day') setFocusDate((current) => addDays(current, direction));
    else if (view === 'week') setFocusDate((current) => addDays(current, direction * 7));
    else setFocusDate((current) => addMonths(current, direction));
  }

  function openNewEvent(date = focusDate, time = '12:00', allDay = false) {
    setForm(createDefaultEventForm(date, time, allDay));
    setShowForm(true);
  }

  function openEvent(event: CalendarEventData) {
    setSelectedEvent(event);
    setEditing(false);
    setEditForm(eventToForm(event));
  }

  async function saveEvent(e: React.FormEvent) {
    e.preventDefault();
    const dates = buildEventDates(form);
    if (!form.title.trim() || !dates) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'calendarEvents'), {
        title: form.title.trim(), person: form.person,
        date: Timestamp.fromDate(dates.start), endDate: Timestamp.fromDate(dates.end),
        allDay: form.allDay, description: form.description.trim(),
        repeat: form.repeat,
        repeatUntil: form.repeat !== 'none' && form.repeatUntil ? Timestamp.fromDate(new Date(`${form.repeatUntil}T23:59:59`)) : null,
        createdBy: user.uid, createdAt: Timestamp.now(),
      });
      setFocusDate(dates.start);
      setShowForm(false);
    } catch (error) {
      console.error(error); alert('Nie udało się zapisać wydarzenia.');
    } finally { setSaving(false); }
  }

  async function updateEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEvent) return;
    const dates = buildEventDates(editForm);
    if (!editForm.title.trim() || !dates) return;
    setUpdating(true);
    try {
      await updateDoc(doc(db, 'calendarEvents', selectedEvent.id), {
        title: editForm.title.trim(), person: editForm.person,
        date: Timestamp.fromDate(dates.start), endDate: Timestamp.fromDate(dates.end),
        allDay: editForm.allDay, description: editForm.description.trim(),
        repeat: editForm.repeat,
        repeatUntil: editForm.repeat !== 'none' && editForm.repeatUntil ? Timestamp.fromDate(new Date(`${editForm.repeatUntil}T23:59:59`)) : null,
        updatedBy: user.uid, updatedAt: Timestamp.now(),
      });
      setEditing(false);
    } catch (error) {
      console.error(error); alert('Nie udało się zapisać zmian.');
    } finally { setUpdating(false); }
  }

  async function removeEvent() {
    if (!selectedEvent) return;
    if (!window.confirm(`Czy na pewno chcesz usunąć „${selectedEvent.title}”?${selectedEvent.repeat !== 'none' ? '\nUsunięta zostanie cała seria.' : ''}`)) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'calendarEvents', selectedEvent.id));
      setSelectedEvent(null);
    } catch (error) {
      console.error(error); alert('Nie udało się usunąć wydarzenia.');
    } finally { setDeleting(false); }
  }

  return (
    <div className="page-content compact-page">
      <ModuleHeader icon="📅" title="Kalendarz" text="Wydarzenia całej rodziny — dzień, tydzień i miesiąc." action={<button className="primary-button" type="button" onClick={() => openNewEvent()}>＋ Dodaj wydarzenie</button>} />

      <section className="calendar-toolbar">
        <div className="calendar-navigation"><button onClick={() => navigate(-1)}>‹</button><strong>{titleForView()}</strong><button onClick={() => navigate(1)}>›</button></div>
        <button className="secondary-button" type="button" onClick={() => setFocusDate(new Date())}>Dzisiaj</button>
        <div className="view-switch">
          {(['day', 'week', 'month'] as CalendarView[]).map((item) => <button key={item} type="button" className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'day' ? 'Dzień' : item === 'week' ? 'Tydzień' : 'Miesiąc'}</button>)}
        </div>
      </section>

      <section className="person-filters">
        {PEOPLE.map((person) => <button key={person} type="button" className={selectedPerson === person ? 'active' : ''} onClick={() => setSelectedPerson(person)}><span style={{ background: personColor(person) }} />{personLabel(person)}</button>)}
      </section>

      {view === 'day' && <CalendarDay date={focusDate} occurrences={occurrences} onOpen={openEvent} onAdd={openNewEvent} />}
      {view === 'week' && (
        <div className="calendar-week-layout">
          <section className="calendar-week-card">
            <div className="calendar-week-grid">
              {weekDays.map((day) => {
                const dayItems = occurrences.filter((item) => sameDay(item.date, day));
                return (
                  <div className={`calendar-week-day ${sameDay(day, new Date()) ? 'today' : ''}`} key={formatDateInput(day)}>
                    <button className="calendar-day-heading" type="button" onClick={() => { setFocusDate(day); setView('day'); }}><span>{capitalize(day.toLocaleDateString('pl-PL', { weekday: 'short' }))}</span><strong>{day.getDate()}</strong></button>
                    <button className="calendar-plus" type="button" onClick={() => openNewEvent(day)}>＋</button>
                    <div className="calendar-day-events">
                      {dayItems.length === 0 && <small className="muted">Brak wydarzeń</small>}
                      {dayItems.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => openEvent(item.source)} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <CalendarSide today={todayOccurrences} upcoming={upcomingOccurrences} onOpen={openEvent} />
        </div>
      )}
      {view === 'month' && <CalendarMonth focusDate={focusDate} days={monthDays} occurrences={occurrences} onOpen={openEvent} onAdd={openNewEvent} onDay={(day) => { setFocusDate(day); setView('day'); }} />}

      {showForm && (
        <Modal title="➕ Nowe wydarzenie" subtitle="Kalendarz" onClose={() => setShowForm(false)} wide>
          <EventFormFields form={form} setForm={setForm} onSubmit={saveEvent} buttonText={saving ? 'Zapisywanie…' : '✓ Zapisz wydarzenie'} disabled={saving} onCancel={() => setShowForm(false)} />
        </Modal>
      )}

      {selectedEvent && (
        <Modal title={selectedEvent.title} subtitle={selectedEvent.repeat !== 'none' ? 'Wydarzenie cykliczne — edytujesz całą serię' : 'Wydarzenie'} onClose={() => setSelectedEvent(null)} wide>
          {!editing ? (
            <>
              <div className="details-grid">
                <DetailRow label="Osoba" value={personLabel(selectedEvent.person)} />
                <DetailRow label="Data rozpoczęcia" value={capitalize(selectedEvent.date.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} />
                <DetailRow label="Godzina" value={selectedEvent.allDay ? 'Cały dzień' : `${formatTime(selectedEvent.date)} – ${formatTime(selectedEvent.endDate)}`} />
                <DetailRow label="Powtarzanie" value={repeatLabel(selectedEvent.repeat)} />
                {selectedEvent.repeatUntil && <DetailRow label="Powtarzaj do" value={selectedEvent.repeatUntil.toLocaleDateString('pl-PL')} />}
                {selectedEvent.description && <DetailRow label="Notatka" value={selectedEvent.description} />}
              </div>
              <div className="modal-actions"><button className="secondary-button" onClick={() => setEditing(true)}>✏️ Edytuj</button><button className="danger-button" onClick={removeEvent} disabled={deleting}>{deleting ? 'Usuwanie…' : '🗑️ Usuń'}</button></div>
            </>
          ) : (
            <EventFormFields form={editForm} setForm={setEditForm} onSubmit={updateEvent} buttonText={updating ? 'Zapisywanie…' : '✓ Zapisz zmiany'} disabled={updating} onCancel={() => setEditing(false)} />
          )}
        </Modal>
      )}
    </div>
  );
}

function createDefaultEventForm(date: Date, time = '12:00', allDay = false): EventForm {
  const start = new Date(date);
  const [hours, minutes] = time.split(':').map(Number);
  start.setHours(hours || 0, minutes || 0, 0, 0);
  const end = new Date(start.getTime() + 3600000);
  return { title: '', person: 'family', date: formatDateInput(start), allDay, startTime: formatTimeInput(start), endTime: formatTimeInput(end), description: '', repeat: 'none', repeatUntil: '' };
}

function eventToForm(event: CalendarEventData): EventForm {
  return {
    title: event.title, person: event.person, date: formatDateInput(event.date), allDay: event.allDay,
    startTime: formatTimeInput(event.date), endTime: formatTimeInput(event.endDate), description: event.description,
    repeat: event.repeat, repeatUntil: event.repeatUntil ? formatDateInput(event.repeatUntil) : '',
  };
}

function buildEventDates(form: EventForm) {
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

function EventFormFields({ form, setForm, onSubmit, buttonText, disabled, onCancel }: { form: EventForm; setForm: React.Dispatch<React.SetStateAction<EventForm>>; onSubmit: (e: React.FormEvent) => void; buttonText: string; disabled: boolean; onCancel?: () => void }) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="field field-wide"><span>Nazwa wydarzenia</span><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Np. dentysta, urodziny, basen…" required /></label>
      <label className="field"><span>Osoba</span><PersonSelect value={form.person} onChange={(person) => setForm((f) => ({ ...f, person }))} /></label>
      <label className="field"><span>Data</span><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required /></label>
      <label className="checkbox-field"><input type="checkbox" checked={form.allDay} onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))} /><span>Cały dzień</span></label>
      {!form.allDay && <>
        <label className="field"><span>Od</span><input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} required /></label>
        <label className="field"><span>Do</span><input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} required /></label>
      </>}
      <label className="field"><span>Powtarzanie</span><select value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as RepeatType, repeatUntil: e.target.value === 'none' ? '' : f.repeatUntil }))}><option value="none">Nie powtarzaj</option><option value="daily">Codziennie</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option><option value="yearly">Co rok</option></select></label>
      {form.repeat !== 'none' && <label className="field"><span>Powtarzaj do</span><input type="date" min={form.date} value={form.repeatUntil} onChange={(e) => setForm((f) => ({ ...f, repeatUntil: e.target.value }))} /></label>}
      <label className="field field-wide"><span>Notatka</span><textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Opcjonalna informacja…" rows={3} /></label>
      <div className="form-actions field-wide">{onCancel && <button className="secondary-button" type="button" onClick={onCancel}>Anuluj</button>}<button className="primary-button" type="submit" disabled={disabled}>{buttonText}</button></div>
    </form>
  );
}

function CalendarEventButton({ occurrence, onClick }: { occurrence: CalendarOccurrence; onClick: () => void }) {
  const event = occurrence.source;
  return (
    <button type="button" className={`calendar-event ${personEventClass(event.person)}`} onClick={onClick}>
      <strong>{event.title}</strong>
      <span>{event.allDay ? 'Cały dzień' : formatTime(occurrence.date)}{event.repeat !== 'none' ? ' · ↻' : ''}</span>
    </button>
  );
}

function CalendarDay({ date, occurrences, onOpen, onAdd }: { date: Date; occurrences: CalendarOccurrence[]; onOpen: (event: CalendarEventData) => void; onAdd: (date?: Date, time?: string, allDay?: boolean) => void }) {
  const dayItems = occurrences.filter((item) => sameDay(item.date, date));
  const allDay = dayItems.filter((item) => item.source.allDay);
  const timed = dayItems.filter((item) => !item.source.allDay);
  return (
    <section className="calendar-day-view">
      <div className="calendar-day-title"><div className="big-date">{date.getDate()}</div><div><strong>{capitalize(date.toLocaleDateString('pl-PL', { weekday: 'long' }))}</strong><span>{capitalize(date.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }))}</span></div><button className="secondary-button" onClick={() => onAdd(date, '12:00', true)}>＋ Cały dzień</button></div>
      <div className="all-day-row"><span>Cały dzień</span><div>{allDay.length === 0 ? <small className="muted">Brak wydarzeń</small> : allDay.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source)} />)}</div></div>
      <div className="hours-list">
        {Array.from({ length: 18 }, (_, i) => i + 6).map((hour) => {
          const items = timed.filter((item) => item.date.getHours() === hour);
          return <div className="hour-row" key={hour}><span>{String(hour).padStart(2, '0')}:00</span><div><button type="button" className="hour-add" onClick={() => onAdd(date, `${String(hour).padStart(2, '0')}:00`)}>＋</button>{items.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source)} />)}</div></div>;
        })}
      </div>
    </section>
  );
}

function CalendarMonth({ focusDate, days, occurrences, onOpen, onAdd, onDay }: { focusDate: Date; days: Date[]; occurrences: CalendarOccurrence[]; onOpen: (event: CalendarEventData) => void; onAdd: (date?: Date) => void; onDay: (date: Date) => void }) {
  return (
    <section className="calendar-month-card">
      <div className="month-grid month-head">{['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'].map((name) => <div key={name}>{name}</div>)}</div>
      <div className="month-grid">
        {days.map((day) => {
          const items = occurrences.filter((item) => sameDay(item.date, day));
          return (
            <div key={formatDateInput(day)} className={`month-day ${day.getMonth() !== focusDate.getMonth() ? 'dim' : ''} ${sameDay(day, new Date()) ? 'today' : ''}`}>
              <div className="month-day-top"><button type="button" onClick={() => onDay(day)}>{day.getDate()}</button><button type="button" onClick={() => onAdd(day)}>＋</button></div>
              <div className="month-events">{items.slice(0, 3).map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source)} />)}{items.length > 3 && <button className="more-link" type="button" onClick={() => onDay(day)}>+{items.length - 3} więcej</button>}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CalendarSide({ today, upcoming, onOpen }: { today: CalendarOccurrence[]; upcoming: CalendarOccurrence[]; onOpen: (event: CalendarEventData) => void }) {
  return (
    <aside className="calendar-side">
      <section><h3>📍 Dzisiaj</h3>{today.length === 0 ? <p className="muted">Brak wydarzeń.</p> : today.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source)} />)}</section>
      <section><h3>⏭️ Nadchodzące</h3>{upcoming.length === 0 ? <p className="muted">Nic w najbliższych 30 dniach.</p> : upcoming.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source)} />)}</section>
    </aside>
  );
}

/* =========================================================
   TASKS
   ========================================================= */

function TasksPage({ user }: { user: User }) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [form, setForm] = useState<TaskForm>({ title: '', person: 'family', dueDate: '', priority: 'normal', note: '' });
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');

  useEffect(() => onSnapshot(collection(db, 'tasks'), (snap) => {
    const next = snap.docs.map((d): TaskItem => {
      const x = d.data();
      return {
        id: d.id,
        title: String(x.title || ''), person: isPersonKey(x.person) ? x.person : 'family', done: x.done === true,
        dueDate: typeof x.dueDate === 'string' ? x.dueDate : '',
        priority: x.priority === 'low' || x.priority === 'high' ? x.priority : 'normal',
        note: typeof x.note === 'string' ? x.note : '', createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
      };
    });
    next.sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    setItems(next);
  }), []);

  const visible = items.filter((item) => filter === 'all' || (filter === 'done' ? item.done : !item.done));

  function openAdd() {
    setEditing(null); setForm({ title: '', person: 'family', dueDate: '', priority: 'normal', note: '' }); setShowForm(true);
  }
  function openEdit(item: TaskItem) {
    setEditing(item); setForm({ title: item.title, person: item.person, dueDate: item.dueDate, priority: item.priority, note: item.note }); setShowForm(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    const payload = { ...form, title: form.title.trim(), updatedAt: Timestamp.now() };
    if (editing) await updateDoc(doc(db, 'tasks', editing.id), payload);
    else await addDoc(collection(db, 'tasks'), { ...payload, done: false, createdBy: user.uid, createdAt: Timestamp.now() });
    setShowForm(false);
  }

  return (
    <div className="page-content compact-page">
      <ModuleHeader icon="✅" title="Zadania" text="Obowiązki z terminem, osobą i priorytetem." action={<button className="primary-button" onClick={openAdd}>＋ Dodaj zadanie</button>} />
      <section className="summary-strip">
        <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}><strong>{items.filter((i) => !i.done).length}</strong><span>Do zrobienia</span></button>
        <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}><strong>{items.filter((i) => i.done).length}</strong><span>Wykonane</span></button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}><strong>{items.length}</strong><span>Wszystkie</span></button>
      </section>
      <section className="module-list compact-list">
        {visible.length === 0 ? <EmptyState icon="✨" text="Tutaj jest czysto — brak zadań w tym widoku." /> : visible.map((item) => (
          <article className={`module-row task-row ${item.done ? 'done' : ''}`} key={item.id}>
            <button className="check-button" onClick={() => updateDoc(doc(db, 'tasks', item.id), { done: !item.done, updatedAt: Timestamp.now() })}>{item.done ? '✓' : '○'}</button>
            <div className="row-main"><strong>{item.title}</strong><small>{personLabel(item.person)} · {item.dueDate ? `termin ${formatShortDate(item.dueDate)}` : 'bez terminu'}{item.note ? ` · ${item.note}` : ''}</small></div>
            <span className={`priority-badge ${item.priority}`}>{item.priority === 'high' ? 'Pilne' : item.priority === 'low' ? 'Niski' : 'Normalny'}</span>
            <button className="icon-button" onClick={() => openEdit(item)}>✏️</button>
            <button className="icon-danger" onClick={() => deleteDoc(doc(db, 'tasks', item.id))}>🗑️</button>
          </article>
        ))}
      </section>
      {showForm && <Modal title={editing ? '✏️ Edytuj zadanie' : '➕ Nowe zadanie'} onClose={() => setShowForm(false)}>
        <form className="form-grid" onSubmit={save}>
          <label className="field field-wide"><span>Zadanie</span><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Np. wyrzucić śmieci…" required /></label>
          <label className="field"><span>Osoba</span><PersonSelect value={form.person} onChange={(person) => setForm((f) => ({ ...f, person }))} /></label>
          <label className="field"><span>Termin</span><input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} /></label>
          <label className="field"><span>Priorytet</span><select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}><option value="low">Niski</option><option value="normal">Normalny</option><option value="high">Pilne</option></select></label>
          <label className="field field-wide"><span>Notatka</span><textarea rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Opcjonalnie…" /></label>
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Anuluj</button><button className="primary-button">✓ Zapisz</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* =========================================================
   SHOPPING
   ========================================================= */

const SHOPPING_META: Record<ShoppingCategory, { label: string; icon: string }> = {
  owoce: { label: 'Owoce', icon: '🍎' }, warzywa: { label: 'Warzywa', icon: '🥕' }, nabial: { label: 'Nabiał', icon: '🥛' },
  pieczywo: { label: 'Pieczywo', icon: '🥖' }, mieso: { label: 'Mięso i wędliny', icon: '🥩' }, mrozonki: { label: 'Mrożonki', icon: '🧊' },
  napoje: { label: 'Napoje', icon: '🥤' }, chemia: { label: 'Chemia i dom', icon: '🧴' }, zwierzeta: { label: 'Zwierzęta', icon: '🐾' },
  dzieci: { label: 'Dzieci', icon: '👶' }, inne: { label: 'Inne', icon: '📦' },
};

function isShoppingCategory(value: unknown): value is ShoppingCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHOPPING_META, value);
}

function normalizeProduct(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function categorizeProduct(title: string): ShoppingCategory {
  const text = normalizeProduct(title);
  const tests: Array<[ShoppingCategory, string[]]> = [
    ['owoce', ['jabl', 'banan', 'gruszk', 'pomarancz', 'mandaryn', 'winogron', 'truskaw', 'malin', 'cytryn', 'kiwi', 'arbuz', 'brzoskw']],
    ['warzywa', ['marchew', 'ziemni', 'pomidor', 'ogorek', 'papryk', 'cebula', 'salat', 'brokul', 'kalafior', 'cukini', 'burak', 'kapust']],
    ['nabial', ['mleko', 'jogurt', 'ser', 'smietan', 'maslo', 'kefir', 'twarog', 'serek']],
    ['pieczywo', ['chleb', 'bulka', 'bagiet', 'kajzer', 'pieczyw', 'tost']],
    ['mieso', ['kurcz', 'mieso', 'szynk', 'kielbas', 'parow', 'boczek', 'wolow', 'wieprz']],
    ['mrozonki', ['mrozon', 'lody', 'pizza mroz', 'frytki']],
    ['napoje', ['woda', 'sok', 'cola', 'napoj', 'kawa', 'herbat', 'oranż', 'oran z']],
    ['chemia', ['domestos', 'plyn do', 'proszek', 'kapsulki', 'papier toalet', 'recznik papier', 'mydlo', 'szampon', 'pasta do zeb', 'worki na smieci']],
    ['zwierzeta', ['karma', 'zwirek', 'pies', 'kota', 'kot ', 'przysmak dla']],
    ['dzieci', ['pieluch', 'chusteczk', 'bebilon', 'mleko modyfik', 'smoczek']],
  ];
  for (const [category, words] of tests) if (words.some((word) => text.includes(word))) return category;
  return 'inne';
}

function ShoppingPage({ user }: { user: User }) {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [title, setTitle] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('szt.');
  const [categoryChoice, setCategoryChoice] = useState<'auto' | ShoppingCategory>('auto');

  useEffect(() => onSnapshot(collection(db, 'shoppingItems'), (snap) => {
    const next = snap.docs.map((d): ShoppingItem => {
      const x = d.data();
      const titleValue = String(x.title || '');
      return { id: d.id, title: titleValue, done: x.done === true, category: isShoppingCategory(x.category) ? x.category : categorizeProduct(titleValue), quantity: typeof x.quantity === 'string' ? x.quantity : '', unit: typeof x.unit === 'string' ? x.unit : '', createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    });
    next.sort((a, b) => Number(a.done) - Number(b.done) || (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
    setItems(next);
  }), []);

  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim()) return;
    const category = categoryChoice === 'auto' ? categorizeProduct(title) : categoryChoice;
    await addDoc(collection(db, 'shoppingItems'), { title: title.trim(), done: false, category, quantity: quantity.trim(), unit, createdBy: user.uid, createdAt: Timestamp.now() });
    setTitle(''); setQuantity('1'); setUnit('szt.'); setCategoryChoice('auto');
  }

  const grouped = useMemo(() => {
    const order = Object.keys(SHOPPING_META) as ShoppingCategory[];
    return order.map((category) => ({ category, items: items.filter((item) => item.category === category) })).filter((group) => group.items.length > 0);
  }, [items]);

  async function clearDone() {
    const done = items.filter((item) => item.done);
    if (done.length === 0) return;
    if (!window.confirm(`Usunąć kupione produkty (${done.length})?`)) return;
    await Promise.all(done.map((item) => deleteDoc(doc(db, 'shoppingItems', item.id))));
  }

  return (
    <div className="page-content compact-page">
      <ModuleHeader icon="🛒" title="Zakupy" text="Produkty automatycznie grupują się według działów sklepu." action={items.some((i) => i.done) ? <button className="secondary-button" onClick={clearDone}>🧹 Usuń kupione</button> : undefined} />
      <form className="shopping-bar" onSubmit={add}>
        <input className="shopping-product" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Np. jabłka, mleko, Domestos…" />
        <input className="shopping-quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Ilość" />
        <select value={unit} onChange={(e) => setUnit(e.target.value)}><option>szt.</option><option>kg</option><option>g</option><option>l</option><option>ml</option><option>opak.</option></select>
        <select value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value as 'auto' | ShoppingCategory)}><option value="auto">✨ Kategoria auto</option>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((category) => <option key={category} value={category}>{SHOPPING_META[category].icon} {SHOPPING_META[category].label}</option>)}</select>
        <button className="primary-button">＋ Dodaj</button>
      </form>
      <section className="shopping-groups">
        {grouped.length === 0 ? <EmptyState icon="🛍️" text="Lista zakupów jest pusta." /> : grouped.map((group) => (
          <article className="shopping-group" key={group.category}>
            <header><div><span>{SHOPPING_META[group.category].icon}</span><strong>{SHOPPING_META[group.category].label}</strong></div><small>{group.items.filter((i) => !i.done).length} do kupienia</small></header>
            <div>{group.items.map((item) => (
              <div className={`shopping-row ${item.done ? 'done' : ''}`} key={item.id}>
                <button className="check-button" onClick={() => updateDoc(doc(db, 'shoppingItems', item.id), { done: !item.done, updatedAt: Timestamp.now() })}>{item.done ? '✓' : '○'}</button>
                <strong>{item.title}</strong><span>{[item.quantity, item.unit].filter(Boolean).join(' ')}</span><small>{item.done ? 'Kupione' : 'Do kupienia'}</small>
                <button className="icon-danger" onClick={() => deleteDoc(doc(db, 'shoppingItems', item.id))}>🗑️</button>
              </div>
            ))}</div>
          </article>
        ))}
      </section>
    </div>
  );
}

/* =========================================================
   CHAT
   ========================================================= */

function ChatPage({ user, member }: { user: User; member: Member | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => onSnapshot(collection(db, 'familyMessages'), (snap) => {
    const loaded = snap.docs.map((d): ChatMessage => {
      const x = d.data();
      return { id: d.id, text: String(x.text || ''), name: String(x.name || 'Rodzina'), uid: String(x.uid || ''), createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    }).sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
    setMessages(loaded.slice(-150));
  }), []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return;
    await addDoc(collection(db, 'familyMessages'), { text: text.trim(), name: member?.name || 'Rodzina', uid: user.uid, createdAt: Timestamp.now() });
    setText('');
  }

  return (
    <div className="page-content compact-page chat-page">
      <ModuleHeader icon="💬" title="Czat" text="Prywatna rozmowa całej rodziny." />
      <section className="chat-shell">
        <div className="chat-messages">
          {messages.length === 0 ? <EmptyState icon="💬" text="Napisz pierwszą wiadomość." /> : messages.map((message) => (
            <div key={message.id} className={`chat-bubble ${message.uid === user.uid ? 'mine' : ''}`}><strong>{message.name}</strong><p>{message.text}</p><small>{message.createdAt ? formatTime(message.createdAt) : ''}</small></div>
          ))}
          <div ref={endRef} />
        </div>
        <form className="chat-compose" onSubmit={send}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Napisz wiadomość…" /><button className="primary-button">Wyślij</button></form>
      </section>
    </div>
  );
}

/* =========================================================
   HEALTH
   ========================================================= */

const HEALTH_META: Record<HealthType, { label: string; icon: string }> = {
  visit: { label: 'Wizyty', icon: '🩺' }, doctor: { label: 'Lekarze', icon: '👨‍⚕️' }, medicine: { label: 'Leki', icon: '💊' }, result: { label: 'Wyniki', icon: '📄' }, history: { label: 'Historia', icon: '🕘' },
};

function isHealthType(value: unknown): value is HealthType { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HEALTH_META, value); }

function HealthPage({ user }: { user: User }) {
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [person, setPerson] = useState<PersonKey>('family');
  const [typeFilter, setTypeFilter] = useState<'all' | HealthType>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<HealthForm>({ title: '', person: 'Sebastian', type: 'visit', date: '', time: '12:00', doctor: '', location: '', note: '', addToCalendar: false });

  useEffect(() => onSnapshot(collection(db, 'healthRecords'), (snap) => {
    const next = snap.docs.map((d): HealthRecord => {
      const x = d.data();
      return { id: d.id, title: String(x.title || ''), person: isPersonKey(x.person) ? x.person : 'family', type: isHealthType(x.type) ? x.type : 'history', date: typeof x.date === 'string' ? x.date : '', time: typeof x.time === 'string' ? x.time : '', doctor: typeof x.doctor === 'string' ? x.doctor : '', location: typeof x.location === 'string' ? x.location : '', note: typeof x.note === 'string' ? x.note : '', createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    });
    next.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    setRecords(next);
  }), []);

  const visible = records.filter((record) => (person === 'family' || record.person === person) && (typeFilter === 'all' || record.type === typeFilter));

  function openAdd() {
    setForm({ title: '', person: person === 'family' ? 'Sebastian' : person, type: 'visit', date: formatDateInput(new Date()), time: '12:00', doctor: '', location: '', note: '', addToCalendar: false }); setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    const { addToCalendar, ...record } = form;
    await addDoc(collection(db, 'healthRecords'), { ...record, title: form.title.trim(), createdBy: user.uid, createdAt: Timestamp.now() });
    if (form.addToCalendar && form.date) {
      const start = parseLocalDate(form.date, form.time || '12:00');
      const end = new Date(start.getTime() + 3600000);
      await addDoc(collection(db, 'calendarEvents'), { title: `❤️ ${form.title.trim()}`, person: form.person, date: Timestamp.fromDate(start), endDate: Timestamp.fromDate(end), allDay: false, description: [form.doctor, form.location, form.note].filter(Boolean).join(' · '), repeat: 'none', repeatUntil: null, createdBy: user.uid, createdAt: Timestamp.now() });
    }
    setShowForm(false);
  }

  return (
    <div className="page-content compact-page">
      <ModuleHeader icon="❤️" title="Zdrowie" text="Rodzinna kartoteka: wizyty, lekarze, leki, wyniki i historia." action={<button className="primary-button" onClick={openAdd}>＋ Dodaj wpis</button>} />
      <section className="person-filters health-people">{PEOPLE.map((p) => <button key={p} type="button" className={person === p ? 'active' : ''} onClick={() => setPerson(p)}><span style={{ background: personColor(p) }} />{p === 'family' ? 'Wszyscy' : p}</button>)}</section>
      <section className="icon-tabs"><button className={typeFilter === 'all' ? 'active' : ''} onClick={() => setTypeFilter('all')}>🗂️ Wszystko</button>{(Object.keys(HEALTH_META) as HealthType[]).map((type) => <button key={type} className={typeFilter === type ? 'active' : ''} onClick={() => setTypeFilter(type)}>{HEALTH_META[type].icon} {HEALTH_META[type].label}</button>)}</section>
      <section className="record-grid">
        {visible.length === 0 ? <EmptyState icon="❤️" text="Brak wpisów w tym widoku." /> : visible.map((record) => (
          <article className="record-card" key={record.id}><div className="record-icon">{HEALTH_META[record.type].icon}</div><div className="record-content"><div className="record-title"><strong>{record.title}</strong><span style={{ color: personColor(record.person) }}>{personLabel(record.person)}</span></div><p>{[record.date ? formatShortDate(record.date) : '', record.time, record.doctor, record.location].filter(Boolean).join(' · ') || HEALTH_META[record.type].label}</p>{record.note && <small>{record.note}</small>}</div><button className="icon-danger" onClick={() => deleteDoc(doc(db, 'healthRecords', record.id))}>🗑️</button></article>
        ))}
      </section>
      <div className="info-banner">📎 Zdjęcia i pliki wyników będą kolejnym etapem po podłączeniu Firebase Storage — tutaj nie pokazujemy martwego przycisku.</div>
      {showForm && <Modal title="❤️ Nowy wpis zdrowotny" onClose={() => setShowForm(false)} wide>
        <form className="form-grid" onSubmit={save}>
          <label className="field"><span>Osoba</span><PersonSelect includeFamily={false} value={form.person} onChange={(value) => setForm((f) => ({ ...f, person: value }))} /></label>
          <label className="field"><span>Rodzaj</span><select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as HealthType }))}>{(Object.keys(HEALTH_META) as HealthType[]).map((type) => <option key={type} value={type}>{HEALTH_META[type].icon} {HEALTH_META[type].label}</option>)}</select></label>
          <label className="field field-wide"><span>Nazwa</span><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Np. kontrola u dentysty" required /></label>
          <label className="field"><span>Data</span><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></label>
          <label className="field"><span>Godzina</span><input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} /></label>
          <label className="field"><span>Lekarz / specjalizacja</span><input value={form.doctor} onChange={(e) => setForm((f) => ({ ...f, doctor: e.target.value }))} placeholder="Np. stomatolog" /></label>
          <label className="field"><span>Miejsce</span><input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Przychodnia / adres" /></label>
          <label className="field field-wide"><span>Notatka</span><textarea rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></label>
          <label className="checkbox-field field-wide"><input type="checkbox" checked={form.addToCalendar} onChange={(e) => setForm((f) => ({ ...f, addToCalendar: e.target.checked }))} /><span>Dodaj również do rodzinnego Kalendarza</span></label>
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Anuluj</button><button className="primary-button">✓ Zapisz</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* =========================================================
   SCHOOL
   ========================================================= */

const SCHOOL_META: Record<SchoolType, { label: string; icon: string }> = {
  lesson: { label: 'Plan lekcji', icon: '📚' }, homework: { label: 'Zadania', icon: '📝' }, test: { label: 'Sprawdziany', icon: '📅' }, grade: { label: 'Oceny', icon: '⭐' }, message: { label: 'Wiadomości', icon: '💬' }, activity: { label: 'Zajęcia', icon: '🎯' },
};

function isSchoolType(value: unknown): value is SchoolType { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCHOOL_META, value); }

function SchoolPage({ user }: { user: User }) {
  const [records, setRecords] = useState<SchoolRecord[]>([]);
  const [person, setPerson] = useState<PersonKey>('Nikodem');
  const [typeFilter, setTypeFilter] = useState<'all' | SchoolType>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SchoolForm>({ title: '', person: 'Nikodem', type: 'homework', subject: '', date: '', time: '08:00', note: '', addToCalendar: false });

  useEffect(() => onSnapshot(collection(db, 'schoolItems'), (snap) => {
    const next = snap.docs.map((d): SchoolRecord => {
      const x = d.data();
      return { id: d.id, title: String(x.title || ''), person: isPersonKey(x.person) ? x.person : 'Nikodem', type: isSchoolType(x.type) ? x.type : 'homework', subject: typeof x.subject === 'string' ? x.subject : '', date: typeof x.date === 'string' ? x.date : '', time: typeof x.time === 'string' ? x.time : '', note: typeof x.note === 'string' ? x.note : '', createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    });
    next.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    setRecords(next);
  }), []);

  const visible = records.filter((record) => record.person === person && (typeFilter === 'all' || record.type === typeFilter));

  function openAdd() {
    setForm({ title: '', person, type: 'homework', subject: '', date: formatDateInput(new Date()), time: '08:00', note: '', addToCalendar: false }); setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    const { addToCalendar, ...record } = form;
    await addDoc(collection(db, 'schoolItems'), { ...record, title: form.title.trim(), createdBy: user.uid, createdAt: Timestamp.now() });
    if (form.addToCalendar && form.date) {
      const start = parseLocalDate(form.date, form.time || '08:00');
      const end = new Date(start.getTime() + 3600000);
      await addDoc(collection(db, 'calendarEvents'), { title: `🎒 ${form.title.trim()}`, person: form.person, date: Timestamp.fromDate(start), endDate: Timestamp.fromDate(end), allDay: false, description: [form.subject, form.note].filter(Boolean).join(' · '), repeat: 'none', repeatUntil: null, createdBy: user.uid, createdAt: Timestamp.now() });
    }
    setShowForm(false);
  }

  return (
    <div className="page-content compact-page">
      <ModuleHeader icon="🎒" title="Szkoła" text="Plan, zadania, sprawdziany, oceny, wiadomości i zajęcia." action={<button className="primary-button" onClick={openAdd}>＋ Dodaj</button>} />
      <section className="school-person-switch"><button className={person === 'Paweł' ? 'active' : ''} onClick={() => setPerson('Paweł')}>🧑 Paweł</button><button className={person === 'Nikodem' ? 'active' : ''} onClick={() => setPerson('Nikodem')}>👦 Nikodem</button></section>
      <section className="icon-tabs school-tabs"><button className={typeFilter === 'all' ? 'active' : ''} onClick={() => setTypeFilter('all')}>🗂️ Wszystko</button>{(Object.keys(SCHOOL_META) as SchoolType[]).map((type) => <button key={type} className={typeFilter === type ? 'active' : ''} onClick={() => setTypeFilter(type)}>{SCHOOL_META[type].icon} {SCHOOL_META[type].label}</button>)}</section>
      <div className="school-layout">
        <section className="record-grid">
          {visible.length === 0 ? <EmptyState icon="🎒" text="Brak wpisów dla wybranego dziecka i kategorii." /> : visible.map((record) => (
            <article className="record-card" key={record.id}><div className="record-icon">{SCHOOL_META[record.type].icon}</div><div className="record-content"><div className="record-title"><strong>{record.title}</strong><span>{record.subject || SCHOOL_META[record.type].label}</span></div><p>{[record.date ? formatShortDate(record.date) : '', record.time].filter(Boolean).join(' · ') || SCHOOL_META[record.type].label}</p>{record.note && <small>{record.note}</small>}</div><button className="icon-danger" onClick={() => deleteDoc(doc(db, 'schoolItems', record.id))}>🗑️</button></article>
          ))}
        </section>
        <aside className="integration-card"><span>🔗</span><h3>Vulcan</h3><p>Miejsce na przyszłą integrację z planem, ocenami, zadaniami i wiadomościami.</p><small>Nie jest jeszcze połączone — bez udawania działania.</small></aside>
      </div>
      {showForm && <Modal title="🎒 Nowy wpis szkolny" onClose={() => setShowForm(false)} wide>
        <form className="form-grid" onSubmit={save}>
          <label className="field"><span>Dziecko</span><PersonSelect schoolOnly value={form.person} onChange={(value) => setForm((f) => ({ ...f, person: value }))} /></label>
          <label className="field"><span>Rodzaj</span><select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as SchoolType }))}>{(Object.keys(SCHOOL_META) as SchoolType[]).map((type) => <option key={type} value={type}>{SCHOOL_META[type].icon} {SCHOOL_META[type].label}</option>)}</select></label>
          <label className="field field-wide"><span>Nazwa</span><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Np. sprawdzian z matematyki" required /></label>
          <label className="field"><span>Przedmiot</span><input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Matematyka" /></label>
          <label className="field"><span>Data</span><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></label>
          <label className="field"><span>Godzina</span><input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} /></label>
          <label className="field field-wide"><span>Notatka</span><textarea rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></label>
          <label className="checkbox-field field-wide"><input type="checkbox" checked={form.addToCalendar} onChange={(e) => setForm((f) => ({ ...f, addToCalendar: e.target.checked }))} /><span>Dodaj również do rodzinnego Kalendarza</span></label>
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Anuluj</button><button className="primary-button">✓ Zapisz</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* =========================================================
   FAMILY
   ========================================================= */

function FamilyPage() {
  const [members, setMembers] = useState<FamilyMemberDoc[]>([]);
  const [selected, setSelected] = useState<FamilyMemberDoc | null>(null);

  useEffect(() => onSnapshot(collection(db, 'members'), (snap) => {
    setMembers(snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, name: String(x.name || 'Rodzina'), role: String(x.role || 'Członek rodziny'), photoURL: typeof x.photoURL === 'string' ? x.photoURL : undefined, active: x.active !== false };
    }).sort((a, b) => a.name.localeCompare(b.name, 'pl')));
  }), []);

  return (
    <div className="page-content compact-page">
      <ModuleHeader icon="👨‍👩‍👧‍👦" title="Rodzina" text="Profile wszystkich członków Waszego rodzinnego centrum." />
      <section className="family-grid">
        {members.map((member) => (
          <button type="button" className="family-profile-card" key={member.id} onClick={() => setSelected(member)}>
            <div className="family-profile-avatar">{member.photoURL ? <img src={member.photoURL} alt="" /> : memberEmoji(member.name)}</div>
            <h3>{member.name}</h3><p>{member.role}</p><span className={member.active ? 'status-active' : 'status-muted'}>{member.active ? '● Aktywny' : '○ Nieaktywny'}</span><small>Otwórz profil →</small>
          </button>
        ))}
      </section>
      {selected && <Modal title={selected.name} subtitle="Profil rodzinny" onClose={() => setSelected(null)}>
        <div className="profile-detail"><div className="family-profile-avatar large">{selected.photoURL ? <img src={selected.photoURL} alt="" /> : memberEmoji(selected.name)}</div><h3>{selected.name}</h3><p>{selected.role}</p><span className={selected.active ? 'status-active' : 'status-muted'}>{selected.active ? '● Aktywny' : '○ Nieaktywny'}</span></div>
        <div className="info-banner">W kolejnych wersjach ten profil może zbierać wydarzenia, zadania, zdrowie i szkołę tej osoby w jednym miejscu.</div>
      </Modal>}
    </div>
  );
}

/* =========================================================
   SETTINGS
   ========================================================= */

function SettingsPage({ member }: { member: Member | null }) {
  return (
    <div className="page-content compact-page">
      <ModuleHeader icon="⚙️" title="Ustawienia" text="Konto, integracje i informacje o aplikacji." />
      <section className="settings-grid">
        <article className="app-card"><div className="settings-icon">👤</div><h3>Twoje konto</h3><p><strong>{member?.name || 'Użytkownik'}</strong><br />{member?.role || 'Rodzina'}</p></article>
        <article className="app-card"><div className="settings-icon">📅</div><h3>Połączone kalendarze</h3><p>Google Calendar, Outlook oraz eksport do Apple Calendar.</p><span className="setting-badge">Do podłączenia</span></article>
        <article className="app-card"><div className="settings-icon">🔔</div><h3>Powiadomienia</h3><p>Przypomnienia push wymagają osobnego etapu konfiguracji.</p><span className="setting-badge">Planowane</span></article>
        <article className="app-card"><div className="settings-icon">🔐</div><h3>Prywatność</h3><p>Dane modułów są dostępne po zalogowaniu zgodnie z regułami Firestore.</p></article>
        <article className="app-card version-card"><div className="settings-icon">🚀</div><h3>Nasza Rodzina</h3><p>Wersja <strong>{APP_VERSION}</strong><br />Aktualizacja: {APP_UPDATED}</p><span className="setting-badge green">Aktualna wersja</span></article>
        <article className="app-card whats-new"><div className="settings-icon">✨</div><h3>Co nowego w 1.1.0</h3><p>Nowe logowanie, kompaktowy iPad, powtarzanie w Kalendarzu, priorytety Zadań, inteligentne Zakupy, rozbudowane Zdrowie i Szkoła oraz lepszy Czat.</p></article>
      </section>
    </div>
  );
}

/* =========================================================
   MOBILE NAV
   ========================================================= */

function MobileNavigation({ page, goTo, onMore }: { page: Page; goTo: (page: Page) => void; onMore: () => void }) {
  const items: Array<[Page, string, string]> = [['Start', '🏠', 'Start'], ['Kalendarz', '📅', 'Kalendarz'], ['Zadania', '✅', 'Zadania'], ['Zakupy', '🛒', 'Zakupy']];
  return (
    <nav className="mobile-navigation">
      {items.map(([target, icon, label]) => <button type="button" key={target} className={page === target ? 'active' : ''} onClick={() => goTo(target)}><span>{icon}</span><small>{label}</small></button>)}
      <button type="button" onClick={onMore}><span>☰</span><small>Więcej</small></button>
    </nav>
  );
}

function MobileMoreMenu({ page, goTo, onClose, onLogout }: { page: Page; goTo: (page: Page) => void; onClose: () => void; onLogout: () => void }) {
  const items: Array<[Page, string]> = [['Czat', '💬'], ['Zdrowie', '❤️'], ['Szkoła', '🎒'], ['Rodzina', '👨‍👩‍👧‍👦'], ['Ustawienia', '⚙️']];
  return (
    <div className="mobile-more-backdrop" onClick={onClose}>
      <section className="mobile-more" onClick={(e) => e.stopPropagation()}><header><strong>Więcej</strong><button onClick={onClose}>✕</button></header>{items.map(([target, icon]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => goTo(target)}><span>{icon}</span>{target}</button>)}<button className="logout-mobile" onClick={onLogout}><span>↪️</span>Wyloguj</button></section>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Nie znaleziono elementu #root.');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
