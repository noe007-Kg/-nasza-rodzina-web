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
  getDocs,
  onSnapshot,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import './style.css';

const APP_VERSION = '1.3.12';
const APP_UPDATED = '30.09.2026';

/* =========================================================
   TYPES
   ========================================================= */

type MemberPermissions = {
  viewFamilySchedule: boolean;
  viewFamilyTasks: boolean;
  viewFamilySchool: boolean;
  viewFamilyHealth: boolean;
};

type Member = {
  name?: string;
  role?: string;
  photoURL?: string;
  active?: boolean;
  canLogin?: boolean;
  permissions?: Partial<MemberPermissions>;
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

type TaskApproval = 'none' | 'pending' | 'approved';
type TaskRepeat = 'none' | 'daily' | 'weekly' | 'monthly';

type TaskItem = {
  id: string;
  title: string;
  person: PersonKey;
  done: boolean;
  dueDate: string;
  priority: TaskPriority;
  note: string;
  points: number;
  requireApproval: boolean;
  approvalStatus: TaskApproval;
  repeat: TaskRepeat;
  createdAt?: Date;
  completedAt?: Date;
};

type TaskForm = {
  title: string;
  person: PersonKey;
  dueDate: string;
  priority: TaskPriority;
  note: string;
  points: number;
  requireApproval: boolean;
  repeat: TaskRepeat;
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
  | 'szkola'
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

type QuickProduct = {
  id: string;
  title: string;
  category: ShoppingCategory;
  icon?: string;
  imageURL?: string;
  adultOnly?: boolean;
  defaultQuantity: string;
  defaultUnit: string;
  custom?: boolean;
  hidden?: boolean;
};

type ChatMessage = {
  id: string;
  text: string;
  name: string;
  uid: string;
  channel: string;
  createdAt?: Date;
};

type HealthType = 'visit' | 'doctor' | 'medicine' | 'result' | 'history' | 'document';
type HealthStatus = 'planned' | 'toBook' | 'booked' | 'done' | 'cancelled';
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
  specialty: string;
  status: HealthStatus;
  referralCode: string;
  nextControl: string;
  callReminderDate: string;
  documentURL: string;
  privateToParents: boolean;
  sharedWithPerson: boolean;
  blocksSchoolDay: boolean;
  dose: string;
  medicineTime: string;
  medicineTimes: string[];
  escalationMinutes: number;
  confirmedDate: string;
  createdAt?: Date;
};

type HealthForm = Omit<HealthRecord, 'id' | 'createdAt' | 'confirmedDate' | 'documentURL'> & {
  addToCalendar: boolean;
  file: File | null;
};

type MedicationIntake = {
  id: string;
  recordId: string;
  person: PersonKey;
  date: string;
  time: string;
  confirmedBy: string;
  confirmedAt?: Date;
};

type HealthAlert = {
  id: string;
  recordId: string;
  person: PersonKey;
  date: string;
  time: string;
  title: string;
  dose: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt?: Date;
};

type MedicalContact = {
  id: string;
  person: PersonKey;
  specialty: string;
  name: string;
  doctor: string;
  phone: string;
  address: string;
  note: string;
};

type SchoolType = 'lesson' | 'homework' | 'test' | 'grade' | 'message' | 'activity' | 'attendance';
type SchoolRecord = {
  id: string;
  title: string;
  person: PersonKey;
  type: SchoolType;
  subject: string;
  date: string;
  time: string;
  endTime: string;
  weekday: number;
  note: string;
  createdAt?: Date;
};

type SchoolForm = Omit<SchoolRecord, 'id' | 'createdAt'> & {
  addToCalendar: boolean;
};

type SchoolStudentFilter = 'Paweł' | 'Nikodem' | 'all';
type SchoolTab = 'summary' | 'plan' | 'homework' | 'tests' | 'grades' | 'attendance' | 'messages';

type FamilyMemberDoc = {
  id: string;
  name: string;
  role: string;
  photoURL?: string;
  active?: boolean;
  birthDate?: string;
  permissions?: Partial<MemberPermissions>;
};

/* =========================================================
   HELPERS
   ========================================================= */

const PEOPLE: PersonKey[] = ['family', 'Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'];
const FAMILY_ORDER = ['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'];
const FAMILY_BIRTHDAYS: Partial<Record<PersonKey, string>> = {
  Dominika: '1990-12-27',
  Paweł: '2008-01-28',
  Nikodem: '2019-01-25',
  Layla: '2025-10-10',
};
const PARENT_NAMES = new Set(['Sebastian', 'Dominika']);

const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
  viewFamilySchedule: true,
  viewFamilyTasks: true,
  viewFamilySchool: false,
  viewFamilyHealth: false,
};

function normalizeMemberPermissions(value: unknown): MemberPermissions {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    viewFamilySchedule: typeof raw.viewFamilySchedule === 'boolean' ? raw.viewFamilySchedule : DEFAULT_MEMBER_PERMISSIONS.viewFamilySchedule,
    viewFamilyTasks: typeof raw.viewFamilyTasks === 'boolean' ? raw.viewFamilyTasks : DEFAULT_MEMBER_PERMISSIONS.viewFamilyTasks,
    viewFamilySchool: typeof raw.viewFamilySchool === 'boolean' ? raw.viewFamilySchool : DEFAULT_MEMBER_PERMISSIONS.viewFamilySchool,
    viewFamilyHealth: typeof raw.viewFamilyHealth === 'boolean' ? raw.viewFamilyHealth : DEFAULT_MEMBER_PERMISSIONS.viewFamilyHealth,
  };
}

function effectiveMemberPermissions(member: Member | null | undefined): MemberPermissions {
  if (isParent(member)) return { viewFamilySchedule:true, viewFamilyTasks:true, viewFamilySchool:true, viewFamilyHealth:true };
  return normalizeMemberPermissions(member?.permissions);
}

function isParent(member: Member | null | undefined) {
  const name = member?.name || '';
  const role = (member?.role || '').toLowerCase();
  return PARENT_NAMES.has(name) || role.includes('tata') || role.includes('mama') || role.includes('rodzic');
}

function ageFromBirthDate(value?: string) {
  if (!value) return null;
  const birth = new Date(`${value}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function isAdultMember(member: Member | null | undefined) {
  if (isParent(member)) return true;
  const name = (member?.name || '') as PersonKey;
  const age = ageFromBirthDate(FAMILY_BIRTHDAYS[name]);
  return age !== null && age >= 18;
}

function personRole(name: string, role?: string) {
  if (role) return role;
  if (name === 'Sebastian') return 'Tata';
  if (name === 'Dominika') return 'Mama';
  if (name === 'Paweł' || name === 'Nikodem') return 'Syn';
  if (name === 'Layla') return 'Córka';
  return 'Rodzina';
}

function dateKey(date = new Date()) {
  return formatDateInput(date);
}

function subjectIcon(subject: string) {
  const text = normalizeProduct(subject);
  if (text.includes('matem')) return 'π';
  if (text.includes('polski')) return '📖';
  if (text.includes('angiel')) return '🇬🇧';
  if (text.includes('niemiec')) return '🇩🇪';
  if (text.includes('informat')) return '💻';
  if (text.includes('fizyk')) return '⚛️';
  if (text.includes('chem')) return '🧪';
  if (text.includes('biolog') || text.includes('przyrod')) return '🌿';
  if (text.includes('histor')) return '🏛️';
  if (text.includes('geograf')) return '🌍';
  if (text.includes('wf') || text.includes('wychowanie fizycz')) return '⚽';
  if (text.includes('muzyk') || text.includes('fortepian')) return '🎹';
  if (text.includes('plast')) return '🎨';
  return '📚';
}

function eventActivityIcon(title: string) {
  const text = normalizeProduct(title);
  if (text.includes('praca')) return '💼';
  if (text.includes('basen') || text.includes('ratownik')) return '🛟';
  if (text.includes('korepety')) return '📐';
  if (text.includes('szkol')) return '🎒';
  if (text.includes('fortepian') || text.includes('muzyk')) return '🎹';
  if (text.includes('kino')) return '🎬';
  if (text.includes('lekar') || text.includes('wizyta')) return '🩺';
  return '📅';
}

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
          <img className="loading-logo" src="/nasza-rodzina-logo.svg" alt="" />
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
        <img className="login-v11-brand-logo" src="/nasza-rodzina-logo.svg" alt="" />
        <div><strong>Nasza Rodzina</strong><small>Rodzinne centrum</small></div>
      </div>

      <div className="login-v11-panel">
        <div className="login-v11-title">
          <img className="login-v11-title-logo" src="/nasza-rodzina-logo.svg" alt="" />
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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('nr-theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('nr-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => onSnapshot(doc(db, 'members', user.uid), (snapshot) => {
    if (snapshot.exists()) setMember(snapshot.data() as Member);
  }, (error) => console.error('Błąd profilu:', error)), [user.uid]);

  function goTo(next: Page) {
    setPage(next);
    setMobileMoreOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderPage() {
    switch (page) {
      case 'Start': return <StartPage member={member} goTo={goTo} />;
      case 'Kalendarz': return <CalendarPage user={user} member={member} goTo={goTo} />;
      case 'Zadania': return <TasksPage user={user} member={member} />;
      case 'Zakupy': return <ShoppingPage user={user} member={member} />;
      case 'Czat': return <ChatPage user={user} member={member} />;
      case 'Zdrowie': return <HealthPage user={user} member={member} />;
      case 'Szkoła': return <SchoolPage user={user} member={member} />;
      case 'Rodzina': return <FamilyPage user={user} member={member} goTo={goTo} />;
      case 'Ustawienia': return <SettingsPage member={member} theme={theme} setTheme={setTheme} goTo={goTo} />;
      default: return <StartPage member={member} goTo={goTo} />;
    }
  }

  return (
    <div className={`app-shell theme-${theme}`}>
      <Sidebar page={page} goTo={goTo} member={member} />
      <main className="main-area">
        {page !== 'Start' && page !== 'Kalendarz' && <FamilyHeader member={member} onLogout={() => signOut(auth)} />}
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
    ['Start', '⌂'], ['Kalendarz', '▣'], ['Zadania', '✓'], ['Zakupy', '🛒'], ['Czat', '◌'],
    ['Zdrowie', '♡'], ['Szkoła', '🎓'], ['Rodzina', '👥'], ['Ustawienia', '⚙'],
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-mark" src="/nasza-rodzina-logo.svg" alt="" />
        <div className="brand-copy"><strong>Nasza<br />Rodzina</strong><small>v{APP_VERSION}</small></div>
      </div>
      <nav className="sidebar-nav">
        {items.map(([label, icon]) => (
          <button key={label} type="button" className={`nav-button ${page === label ? 'active' : ''}`} onClick={() => goTo(label)}>
            <span>{icon}</span>{label}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom-art sidebar-logo-art">
        <img src="/nasza-rodzina-logo.svg" alt="Nasza Rodzina" />
        <strong>Nasza Rodzina</strong>
        <span>Razem zawsze lepiej ♡</span>
        <small>v{APP_VERSION}</small>
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
  const [members, setMembers] = useState<FamilyMemberDoc[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<CalendarEventData[]>([]);
  const [schoolRecords, setSchoolRecords] = useState<SchoolRecord[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [healthRecords, setHealthRecords] = useState<HealthRecord[]>([]);
  const [healthAlerts, setHealthAlerts] = useState<HealthAlert[]>([]);
  const [healthIntakes, setHealthIntakes] = useState<MedicationIntake[]>([]);
  const [weather, setWeather] = useState<{ temp: number; max: number; min: number; wind: number; label: string; icon: string } | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [editMode, setEditMode] = useState(false);
  const [widgetMenu, setWidgetMenu] = useState<string | null>(null);
  const access = effectiveMemberPermissions(member);
  const defaultWidgetOrder = ['day','ends','free','school','tasks','shopping','health','events','quick'];
  const userLayoutId = auth.currentUser?.uid || member?.name || 'family';
  const layoutKey=`nr-start-order:${userLayoutId}`;
  const hiddenKey=`nr-start-hidden:${userLayoutId}`;
  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(layoutKey);
      const parsed = saved ? JSON.parse(saved) : null;
      if (!Array.isArray(parsed)) return defaultWidgetOrder;
      const valid = parsed.filter((id): id is string => typeof id === 'string' && defaultWidgetOrder.includes(id));
      return [...valid, ...defaultWidgetOrder.filter((id) => !valid.includes(id))];
    } catch { return defaultWidgetOrder; }
  });
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(hiddenKey);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && defaultWidgetOrder.includes(id)) : [];
    } catch { return []; }
  });
  type WidgetSize = 'small' | 'medium' | 'wide' | 'large';
  const defaultWidgetSizes: Record<string, WidgetSize> = { day:'medium', ends:'medium', free:'small', school:'medium', tasks:'medium', shopping:'wide', health:'medium', events:'medium', quick:'medium' };
  const sizeKey=`nr-start-sizes:${userLayoutId}`;
  const readNoticeKey=`nr-start-read-notices:${userLayoutId}`;
  const [widgetSizes, setWidgetSizes] = useState<Record<string, WidgetSize>>(() => {
    try {
      const saved=localStorage.getItem(sizeKey); const parsed=saved ? JSON.parse(saved) : {};
      const next={...defaultWidgetSizes};
      if(parsed && typeof parsed==='object') for(const id of defaultWidgetOrder){ const value=parsed[id]; if(value==='small'||value==='medium'||value==='wide'||value==='large') next[id]=value; }
      return next;
    } catch { return {...defaultWidgetSizes}; }
  });
  const [readNoticeIds, setReadNoticeIds] = useState<string[]>(() => {
    try { const parsed=JSON.parse(localStorage.getItem(readNoticeKey) || '[]'); return Array.isArray(parsed) ? parsed.filter((v):v is string=>typeof v==='string') : []; }
    catch { return []; }
  });
  const widgetOrderRef = useRef<string[]>(widgetOrder);
  useEffect(() => { widgetOrderRef.current = widgetOrder; }, [widgetOrder]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  const dragRef = useRef<{
    id:string; pointerId:number; startX:number; startY:number; offsetX:number; offsetY:number;
    timer:number; active:boolean; source:HTMLElement; ghost:HTMLElement | null;
  } | null>(null);
  const resizeRef = useRef<{ id:string; pointerId:number; startX:number; startY:number; startIndex:number } | null>(null);

  useEffect(() => onSnapshot(collection(db, 'members'), (snap) => {
    const next = snap.docs.map((d): FamilyMemberDoc => {
      const x = d.data();
      const personName = String(x.name || 'Rodzina');
      return {
        id: d.id,
        name: personName,
        role: personRole(personName, typeof x.role === 'string' ? x.role : ''),
        photoURL: typeof x.photoURL === 'string' ? x.photoURL : undefined,
        active: x.active !== false,
        birthDate: typeof x.birthDate === 'string' ? x.birthDate : FAMILY_BIRTHDAYS[personName as PersonKey],
        permissions: normalizeMemberPermissions(x.permissions),
      };
    });
    next.sort((a, b) => FAMILY_ORDER.indexOf(a.name) - FAMILY_ORDER.indexOf(b.name));
    setMembers(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'tasks'), (snap) => {
    setTasks(snap.docs.map((d): TaskItem => {
      const x = d.data();
      return {
        id: d.id, title: String(x.title || ''), person: isPersonKey(x.person) ? x.person : 'family', done: x.done === true,
        dueDate: typeof x.dueDate === 'string' ? x.dueDate : '', priority: x.priority === 'low' || x.priority === 'high' ? x.priority : 'normal',
        note: typeof x.note === 'string' ? x.note : '', points: Number(x.points || 0), requireApproval: x.requireApproval === true,
        approvalStatus: x.approvalStatus === 'pending' || x.approvalStatus === 'approved' ? x.approvalStatus : 'none',
        repeat: x.repeat === 'daily' || x.repeat === 'weekly' || x.repeat === 'monthly' ? x.repeat : 'none',
        createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
        completedAt: x.completedAt instanceof Timestamp ? x.completedAt.toDate() : undefined,
      };
    }));
  }), []);

  useEffect(() => onSnapshot(collection(db, 'shoppingItems'), (snap) => {
    setShopping(snap.docs.map((d): ShoppingItem => {
      const x = d.data(); const productTitle = String(x.title || '');
      return { id:d.id, title:productTitle, done:x.done === true, category:isShoppingCategory(x.category) ? x.category : categorizeProduct(productTitle), quantity:typeof x.quantity === 'string' ? x.quantity : '', unit:typeof x.unit === 'string' ? x.unit : '', createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    }));
  }), []);

  useEffect(() => onSnapshot(collection(db, 'calendarEvents'), (snap) => {
    const next: CalendarEventData[] = [];
    snap.forEach((d) => {
      const x=d.data(); if (!(x.date instanceof Timestamp)) return;
      const start=x.date.toDate();
      next.push({ id:d.id, title:String(x.title || 'Wydarzenie'), person:isPersonKey(x.person) ? x.person : 'family', date:start, endDate:x.endDate instanceof Timestamp ? x.endDate.toDate() : new Date(start.getTime()+3600000), allDay:x.allDay === true, description:typeof x.description === 'string' ? x.description : '', createdBy:typeof x.createdBy === 'string' ? x.createdBy : '', repeat:isRepeatType(x.repeat) ? x.repeat : 'none', repeatUntil:x.repeatUntil instanceof Timestamp ? x.repeatUntil.toDate() : null });
    });
    setEvents(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'schoolItems'), (snap) => {
    setSchoolRecords(snap.docs.map((d): SchoolRecord => {
      const x=d.data();
      return { id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'Nikodem', type:isSchoolType(x.type) ? x.type : 'homework', subject:typeof x.subject === 'string' ? x.subject : '', date:typeof x.date === 'string' ? x.date : '', time:typeof x.time === 'string' ? x.time : '', endTime:typeof x.endTime === 'string' ? x.endTime : '', weekday:Number(x.weekday || 0), note:typeof x.note === 'string' ? x.note : '', createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    }));
  }), []);

  useEffect(() => onSnapshot(collection(db, 'healthRecords'), (snap) => {
    setHealthRecords(snap.docs.map((d): HealthRecord => {
      const x=d.data();
      const legacyTime=typeof x.medicineTime === 'string' ? x.medicineTime : (typeof x.time === 'string' ? x.time : '');
      const rawTimes=Array.isArray(x.medicineTimes) ? x.medicineTimes.filter((v:unknown)=>typeof v === 'string') as string[] : [];
      return { id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'family', type:isHealthType(x.type) ? x.type : 'history', date:typeof x.date === 'string' ? x.date : '', time:typeof x.time === 'string' ? x.time : '', doctor:typeof x.doctor === 'string' ? x.doctor : '', location:typeof x.location === 'string' ? x.location : '', note:typeof x.note === 'string' ? x.note : '', specialty:typeof x.specialty === 'string' ? x.specialty : '', status:isHealthStatus(x.status) ? x.status : (x.type === 'visit' ? 'planned' : 'done'), referralCode:typeof x.referralCode === 'string' ? x.referralCode : '', nextControl:typeof x.nextControl === 'string' ? x.nextControl : '', callReminderDate:typeof x.callReminderDate === 'string' ? x.callReminderDate : '', documentURL:typeof x.documentURL === 'string' ? x.documentURL : '', privateToParents:x.privateToParents === true, sharedWithPerson:x.sharedWithPerson === true, blocksSchoolDay:x.blocksSchoolDay === true, dose:typeof x.dose === 'string' ? x.dose : '', medicineTime:legacyTime, medicineTimes:rawTimes.length ? rawTimes : (legacyTime ? [legacyTime] : []), escalationMinutes:Number.isFinite(Number(x.escalationMinutes)) ? Math.max(1,Number(x.escalationMinutes)) : 15, confirmedDate:typeof x.confirmedDate === 'string' ? x.confirmedDate : '', createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    }));
  }), []);

  useEffect(() => onSnapshot(collection(db, 'healthAlerts'), (snap) => {
    setHealthAlerts(snap.docs.map((d): HealthAlert => {
      const x=d.data();
      return { id:d.id, recordId:String(x.recordId || ''), person:isPersonKey(x.person) ? x.person : 'family', date:String(x.date || ''), time:String(x.time || ''), title:String(x.title || ''), dose:String(x.dose || ''), status:x.status === 'acknowledged' || x.status === 'resolved' ? x.status : 'open', createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    }));
  }), []);

  useEffect(() => onSnapshot(collection(db, 'healthMedicationIntakes'), (snap) => {
    setHealthIntakes(snap.docs.map((d): MedicationIntake => {
      const x=d.data();
      return { id:d.id, recordId:String(x.recordId || ''), person:isPersonKey(x.person) ? x.person : 'family', date:String(x.date || ''), time:String(x.time || ''), confirmedBy:String(x.confirmedBy || ''), confirmedAt:x.confirmedAt instanceof Timestamp ? x.confirmedAt.toDate() : undefined };
    }));
  }), []);

  useEffect(() => {
    const controller=new AbortController();
    async function loadWeather() {
      try {
        const url='https://api.open-meteo.com/v1/forecast?latitude=54.176&longitude=15.576&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FWarsaw&forecast_days=1';
        const response=await fetch(url,{signal:controller.signal}); if(!response.ok) throw new Error('weather');
        const data=await response.json(); const code=Number(data.current?.weather_code ?? 0);
        const meta=code<=1 ? ['Słonecznie','☀️'] : code<=3 ? ['Częściowe zachmurzenie','⛅'] : code<=48 ? ['Mgła / chmury','🌫️'] : code<=67 ? ['Deszcz','🌧️'] : code<=77 ? ['Śnieg','🌨️'] : code<=82 ? ['Przelotny deszcz','🌦️'] : ['Burze','⛈️'];
        setWeather({temp:Math.round(data.current?.temperature_2m ?? 0),max:Math.round(data.daily?.temperature_2m_max?.[0] ?? 0),min:Math.round(data.daily?.temperature_2m_min?.[0] ?? 0),wind:Math.round(data.current?.wind_speed_10m ?? 0),label:meta[0],icon:meta[1]});
      } catch(error) { if ((error as Error).name !== 'AbortError') console.warn('Pogoda chwilowo niedostępna'); }
    }
    void loadWeather(); const timer=window.setInterval(()=>void loadWeather(),30*60*1000);
    return ()=>{controller.abort();window.clearInterval(timer);};
  },[]);

  const now=clock;
  const clockTick=clock.getTime();
  const todayKey=formatDateInput(now);
  const todayWeekday=now.getDay()===0 ? 7 : now.getDay();
  const todayStart=startOfDay(now); const todayEnd=endOfDay(now);
  const todayOccurrences=useMemo(()=>events.flatMap((event)=>generateOccurrences(event,todayStart,todayEnd)).sort((a,b)=>a.date.getTime()-b.date.getTime()),[events,todayKey]);
  const todaySchoolItems=useMemo(()=>schoolRecords.filter((r)=>(r.type==='lesson' || r.type==='activity') && (r.weekday===todayWeekday || (!!r.date && r.date===todayKey))).sort((a,b)=>(a.time || '99:99').localeCompare(b.time || '99:99')),[schoolRecords,todayWeekday,todayKey]);
  const todayHealthVisits=useMemo(()=>healthRecords.filter((r)=>r.type==='visit' && r.status!=='cancelled' && r.date===todayKey),[healthRecords,todayKey]);

  function schoolStart(record:SchoolRecord){ return parseLocalDate(todayKey,record.time || '08:00'); }
  function schoolEnd(record:SchoolRecord){ const start=schoolStart(record); const end=parseLocalDate(todayKey,record.endTime || record.time || '08:45'); return end>start ? end : new Date(start.getTime()+45*60000); }
  function healthStart(record:HealthRecord){ return parseLocalDate(todayKey,record.time || '12:00'); }
  function healthEnd(record:HealthRecord){ return new Date(healthStart(record).getTime()+60*60000); }
  function isMedicalText(value:string){ const normalized=normalizeProduct(value); return ['lekar','dentyst','neurolog','kardiolog','ortoped','pediatr','wizyta','szpital','poradn','badani'].some((word)=>normalized.includes(word)); }
  function rowsOverlap(a:{start:Date;end:Date},b:{start:Date;end:Date}){ return a.start < b.end && a.end > b.start; }
  function titlesClose(a:string,b:string){ const aa=normalizeProduct(a).replace(/[^a-z0-9 ]/g,' ').trim(); const bb=normalizeProduct(b).replace(/[^a-z0-9 ]/g,' ').trim(); return !!aa && !!bb && (aa.includes(bb) || bb.includes(aa)); }

  type StartPlanRow={ key:string; person:PersonKey; start:Date; end:Date; title:string; icon:string; place:string; source:'calendar'|'school'|'health'; allDay:boolean; priority:number };
  function planForPerson(personName:string):StartPlanRow[] {
    const key=personName as PersonKey;
    const healthRows=todayHealthVisits.filter((r)=>r.person===key).map((r):StartPlanRow=>({
      key:`health-${r.id}`, person:key, start:healthStart(r), end:healthEnd(r), title:r.title || r.specialty || 'Wizyta lekarska', icon:'🩺',
      place:[r.specialty,r.doctor,r.location].filter(Boolean).join(' · '), source:'health', allDay:false, priority:110,
    }));
    const blocksSchoolDay=todayHealthVisits.some((r)=>r.person===key && r.blocksSchoolDay);
    let schoolRows=todaySchoolItems.filter((r)=>r.person===key).map((r):StartPlanRow=>({
      key:`school-${r.id}`, person:key, start:schoolStart(r), end:schoolEnd(r), title:r.type==='activity' ? r.title : (r.subject || r.title),
      icon:subjectIcon(r.subject || r.title), place:r.note || 'Szkoła', source:'school', allDay:false, priority:r.type==='activity' ? 85 : 80,
    }));
    if (blocksSchoolDay) schoolRows=[];
    else schoolRows=schoolRows.filter((school)=>!healthRows.some((visit)=>rowsOverlap(school,visit)));

    let calendarRows=todayOccurrences.filter((o)=>o.source.person===key || o.source.person==='family').map((o):StartPlanRow=>({
      key:o.key, person:key, start:o.date, end:o.endDate, title:o.source.title, icon:eventActivityIcon(o.source.title), place:o.source.description || '',
      source:'calendar', allDay:o.source.allDay, priority:isMedicalText(`${o.source.title} ${o.source.description}`) ? 105 : (o.source.allDay ? 20 : 60),
    }));
    calendarRows=calendarRows.filter((row)=>!healthRows.some((visit)=>Math.abs(row.start.getTime()-visit.start.getTime())<10*60000 && titlesClose(row.title,visit.title)));
    if (key==='Paweł' || key==='Nikodem') {
      calendarRows=calendarRows.filter((row)=>row.allDay || row.priority>=100 || !schoolRows.some((school)=>rowsOverlap(row,school)));
      schoolRows=schoolRows.filter((school)=>!calendarRows.some((row)=>row.priority>=100 && rowsOverlap(row,school)));
    }
    return [...healthRows,...calendarRows,...schoolRows].sort((a,b)=>a.start.getTime()-b.start.getTime() || b.priority-a.priority);
  }

  function liveStatus(personName:string) {
    const rows=planForPerson(personName).filter((r)=>!r.allDay);
    if (!rows.length) return { tone:'unknown', label:'Brak planu', detail:'Brak danych na dziś', until:'', next:'Brak danych' };
    const activeRows=rows.filter((r)=>r.start<=now && r.end>now).sort((a,b)=>b.priority-a.priority || b.start.getTime()-a.start.getTime());
    const active=activeRows[0];
    const next=rows.filter((r)=>r.start>now).sort((a,b)=>a.start.getTime()-b.start.getTime() || b.priority-a.priority)[0];
    if (active) {
      return { tone:'busy', label:active.title, detail:active.place || `do ${formatTime(active.end)}`, until:`do ${formatTime(active.end)}`, next:next ? `${next.title} ${formatTime(next.start)}` : 'Później wolny' };
    }
    if (next) {
      const minutes=Math.round((next.start.getTime()-now.getTime())/60000);
      if (minutes<=30) return { tone:'break', label:'Przerwa', detail:`do ${formatTime(next.start)}`, until:`za ${Math.max(1,minutes)} min`, next:`${next.title} ${formatTime(next.start)}` };
      return { tone:'free', label:personName==='Layla' ? 'W domu' : 'Wolny', detail:'Brak zajęć teraz', until:'', next:`${next.title} ${formatTime(next.start)}` };
    }
    return { tone:'free', label:personName==='Layla' ? 'W domu' : 'Wolny', detail:'Brak planów', until:'', next:'Brak kolejnych zajęć' };
  }

  const canSeeFamilyContext=isParent(member) || access.viewFamilySchedule;
  const visibleFamilyMembers=canSeeFamilyContext
    ? members.slice(0,5)
    : members.filter((m)=>m.name===member?.name).slice(0,1);
  const personalMembers=members.filter((m)=>m.name===member?.name).slice(0,1);
  const familyStatus=visibleFamilyMembers.map((m)=>({member:m,status:liveStatus(m.name)}));
  const allFreeInfo=useMemo(()=>{
    const incomplete=visibleFamilyMembers.some((m)=>planForPerson(m.name).filter((r)=>!r.allDay).length===0);
    if(incomplete) return { time:'—', countdown:'Brak pełnego planu', latestPerson:'' };
    let latest:Date | null=null; let latestPerson='';
    visibleFamilyMembers.forEach((m)=>planForPerson(m.name).forEach((r)=>{
      if(r.allDay || r.end<=now) return;
      if(!latest || r.end>latest){ latest=r.end; latestPerson=m.name; }
    }));
    if(!latest) return { time:'Teraz', countdown:'Wszyscy wolni teraz', latestPerson:'' };
    const total=Math.max(0,Math.ceil((latest.getTime()-now.getTime())/60000));
    const hours=Math.floor(total/60); const minutes=total%60;
    const countdown=hours>0 ? `Wszyscy wolni za ${hours} godz. ${minutes} min` : `Wszyscy wolni za ${minutes} min`;
    return { time:formatTime(latest), countdown, latestPerson };
  },[todayOccurrences,todaySchoolItems,todayHealthVisits,visibleFamilyMembers.map((m)=>m.id).join('|'),todayKey,clockTick]);

  const dayPlan=useMemo(()=>{
    const rows:StartPlanRow[]=[];
    const sourceMembers=personalMembers.length ? personalMembers : visibleFamilyMembers.slice(0,1);
    const familySeen=new Set<string>();
    sourceMembers.forEach((m)=>{
      planForPerson(m.name).forEach((row)=>{
        const familyOccurrence=row.source==='calendar' && todayOccurrences.find((o)=>o.key===row.key)?.source.person==='family';
        if(familyOccurrence){
          if(familySeen.has(row.key)) return;
          familySeen.add(row.key);
          rows.push({...row,person:'family'});
        } else rows.push(row);
      });
    });
    return rows.sort((a,b)=>a.allDay===b.allDay ? (a.start.getTime()-b.start.getTime() || b.priority-a.priority) : (a.allDay ? -1 : 1)).slice(0,4);
  },[todayOccurrences,todaySchoolItems,todayHealthVisits,personalMembers.map((m)=>m.id).join('|'),visibleFamilyMembers.map((m)=>m.id).join('|'),todayKey,clockTick]);

  const priorityTasks=useMemo(()=>tasks.filter((t)=>!t.done && (t.person===member?.name || t.person==='family')).sort((a,b)=>(({high:0,normal:1,low:2}[a.priority]-{high:0,normal:1,low:2}[b.priority]) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))).slice(0,4),[tasks,member?.name]);
  const upcomingEvents=useMemo(()=>events.flatMap((e)=>generateOccurrences(e,startOfDay(now),endOfDay(addDays(now,45)))).filter((o)=>o.endDate>=now && (o.source.person===member?.name || o.source.person==='family')).sort((a,b)=>a.date.getTime()-b.date.getTime()).slice(0,4),[events,todayKey,clockTick,member?.name]);
  const visibleHealthRecords=useMemo(()=>healthRecords.filter((r)=>r.person===member?.name || r.person==='family'),[healthRecords,member?.name]);
  const upcomingVisits=useMemo(()=>visibleHealthRecords.filter((r)=>r.type==='visit' && r.status!=='cancelled' && r.date>=todayKey).sort((a,b)=>(`${a.date} ${a.time}`).localeCompare(`${b.date} ${b.time}`)).slice(0,2),[visibleHealthRecords,todayKey]);
  const dueMedicineDoses=useMemo(()=>visibleHealthRecords.filter((r)=>r.type==='medicine').flatMap((r)=>{
    const times=r.medicineTimes.length ? r.medicineTimes : (r.medicineTime ? [r.medicineTime] : []);
    return times.filter((time)=>parseLocalDate(todayKey,time).getTime()<=now.getTime()).filter((time)=>!healthIntakes.some((i)=>i.recordId===r.id && i.date===todayKey && i.time===time)).map((time)=>({record:r,time}));
  }),[visibleHealthRecords,healthIntakes,todayKey,clockTick]);
  const visibleSchoolRecords=useMemo(()=>schoolRecords.filter((r)=>r.person===member?.name),[schoolRecords,member?.name]);
  const schoolTests=useMemo(()=>visibleSchoolRecords.filter((r)=>r.type==='test' && r.date>=todayKey).sort((a,b)=>(a.date || '9999').localeCompare(b.date || '9999')).slice(0,2),[visibleSchoolRecords,todayKey]);
  const schoolHomework=useMemo(()=>visibleSchoolRecords.filter((r)=>r.type==='homework' && (!r.date || r.date>=todayKey)).sort((a,b)=>(a.date || '9999').localeCompare(b.date || '9999')).slice(0,2),[visibleSchoolRecords,todayKey]);
  const shoppingGroups=useMemo(()=>{
    const order=Object.keys(SHOPPING_META) as ShoppingCategory[];
    return order.map((category)=>({ category, items:shopping.filter((item)=>item.category===category).sort((a,b)=>Number(a.done)-Number(b.done) || (b.createdAt?.getTime()||0)-(a.createdAt?.getTime()||0)) })).filter((group)=>group.items.length>0);
  },[shopping]);
  const todayLabel=capitalize(now.toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long',year:'numeric'}));

  type StartNotice={id:string;icon:string;title:string;meta:string;page:Page;level:'critical'|'important'|'info';score:number};
  const tomorrowKey=formatDateInput(addDays(now,1));
  const urgentItems=useMemo(()=>{
    const list:StartNotice[]=[];
    const canSeeHealth=(person:PersonKey)=>isParent(member) || access.viewFamilyHealth || person===member?.name || person==='family';
    healthAlerts.filter((a)=>a.status==='open' && canSeeHealth(a.person)).forEach((a)=>list.push({id:`h-${a.id}`,icon:'🚨',title:`Brak potwierdzenia leku: ${a.title}`,meta:`${personLabel(a.person)} · ${a.time || 'do potwierdzenia'}`,page:'Zdrowie',level:'critical',score:100}));
    dueMedicineDoses.forEach(({record,time})=>{
      const alreadyAlerted=healthAlerts.some((a)=>a.status==='open' && a.recordId===record.id && a.date===todayKey && a.time===time);
      if(!alreadyAlerted) list.push({id:`dose-${record.id}-${todayKey}-${time}`,icon:'💊',title:`Lek do przyjęcia: ${record.title}`,meta:`${personLabel(record.person)} · plan ${time}${record.dose?` · ${record.dose}`:''}`,page:'Zdrowie',level:'important',score:84});
    });
    upcomingVisits.filter((r)=>r.date===todayKey && !!r.time).forEach((r)=>{
      const start=parseLocalDate(r.date,r.time); const minutes=(start.getTime()-now.getTime())/60000;
      if(minutes>=0 && minutes<=120) list.push({id:`visit-${r.id}`,icon:'🩺',title:`Wizyta: ${r.specialty || r.title}`,meta:`${personLabel(r.person)} · ${r.time}${r.location ? ` · ${r.location}` : ''}`,page:'Zdrowie',level:minutes<=60?'critical':'important',score:minutes<=60?95:85});
    });
    priorityTasks.filter((t)=>t.dueDate && t.dueDate<=todayKey).forEach((t)=>list.push({id:`task-${t.id}`,icon:'✅',title:t.title,meta:`${personLabel(t.person)} · ${t.dueDate<todayKey?'po terminie':'na dziś'}`,page:'Zadania',level:t.dueDate<todayKey||t.priority==='high'?'critical':'important',score:t.dueDate<todayKey?92:(t.priority==='high'?82:70)}));
    schoolTests.filter((r)=>r.date===todayKey || r.date===tomorrowKey).forEach((r)=>list.push({id:`test-${r.id}`,icon:'🎓',title:`Sprawdzian: ${r.subject || r.title}`,meta:`${personLabel(r.person)} · ${r.date===todayKey?'dzisiaj':'jutro'}`,page:'Szkoła',level:r.date===todayKey?'critical':'important',score:r.date===todayKey?88:76}));
    upcomingEvents.filter((o)=>!o.source.allDay && o.date.getTime()>=now.getTime() && o.date.getTime()-now.getTime()<=60*60000).forEach((o)=>{
      const duplicateVisit=upcomingVisits.some((r)=>r.person===o.source.person && r.date===formatDateInput(o.date) && (!!r.time && Math.abs(parseLocalDate(r.date,r.time).getTime()-o.date.getTime())<10*60000) && titlesClose(r.title,o.source.title));
      if(!duplicateVisit) list.push({id:`event-${o.key}`,icon:'📅',title:o.source.title,meta:`${o.source.person==='family'?'Rodzina':personLabel(o.source.person)} · za ${Math.max(1,Math.round((o.date.getTime()-now.getTime())/60000))} min`,page:'Kalendarz',level:'info',score:60});
    });
    const seen=new Set<string>();
    return list.sort((a,b)=>b.score-a.score).filter((item)=>{const key=`${normalizeProduct(item.title)}|${normalizeProduct(item.meta)}`; if(seen.has(key)) return false; seen.add(key); return true;}).slice(0,5);
  },[healthAlerts,dueMedicineDoses,upcomingVisits,priorityTasks,schoolTests,upcomingEvents,todayKey,tomorrowKey,clockTick,member?.name,access.viewFamilyHealth]);

  const notificationItems=useMemo(()=>{
    const list:StartNotice[]=[...urgentItems];
    tasks.filter((t)=>!t.done && t.approvalStatus==='pending' && (isParent(member) || access.viewFamilyTasks || t.person===member?.name)).forEach((t)=>list.push({id:`approval-${t.id}`,icon:'✅',title:t.title,meta:`${personLabel(t.person)} · do zatwierdzenia`,page:'Zadania',level:'info',score:50}));
    schoolTests.forEach((r)=>list.push({id:`s-${r.id}`,icon:'🎓',title:`Sprawdzian: ${r.subject || r.title}`,meta:`${personLabel(r.person)} · ${formatShortDate(r.date)}`,page:'Szkoła',level:'info',score:45}));
    upcomingEvents.filter((o)=>o.date.getTime()-now.getTime()<=24*3600000).forEach((o)=>{
      const duplicateVisit=upcomingVisits.some((r)=>r.person===o.source.person && r.date===formatDateInput(o.date) && (!!r.time && Math.abs(parseLocalDate(r.date,r.time).getTime()-o.date.getTime())<10*60000) && titlesClose(r.title,o.source.title));
      if(!duplicateVisit) list.push({id:`e-${o.key}`,icon:'📅',title:o.source.title,meta:`${o.source.person==='family' ? 'Rodzina' : personLabel(o.source.person)} · ${o.source.allDay?'cały dzień':formatTime(o.date)}`,page:'Kalendarz',level:'info',score:40});
    });
    const seen=new Set<string>();
    return list.sort((a,b)=>b.score-a.score).filter((item)=>{const key=`${normalizeProduct(item.title.replace(/^brak potwierdzenia leku:\s*/i,''))}|${normalizeProduct(item.meta)}`; if(seen.has(key)) return false; seen.add(key); return true;}).slice(0,8);
  },[urgentItems,tasks,schoolTests,upcomingEvents,upcomingVisits,todayKey,clockTick,member?.name,access.viewFamilyTasks]);

  const unreadNotificationCount=notificationItems.filter((item)=>!readNoticeIds.includes(item.id)).length;
  function persistReadNotices(next:string[]) {
    const unique=Array.from(new Set(next)).slice(-250);
    setReadNoticeIds(unique);
    try { localStorage.setItem(readNoticeKey,JSON.stringify(unique)); } catch { /* ignore */ }
  }
  function markNoticeRead(id:string) { if(!readNoticeIds.includes(id)) persistReadNotices([...readNoticeIds,id]); }
  function markAllNoticesRead() { persistReadNotices([...readNoticeIds,...notificationItems.map((item)=>item.id)]); }

  async function toggleShoppingFromStart(item:ShoppingItem) {
    await updateDoc(doc(db,'shoppingItems',item.id),{done:!item.done,updatedAt:Timestamp.now()});
  }

  function openFamily(person?:string) {
    try { sessionStorage.setItem('nr-family-focus', person && isPersonKey(person) ? person : 'family'); } catch { /* ignore */ }
    goTo('Rodzina');
  }

  function lastEndFor(personName:string) {
    const rows=planForPerson(personName).filter((r)=>!r.allDay && r.end>now);
    if(!rows.length) return null;
    return rows.reduce((max,r)=>r.end>max ? r.end : max,rows[0].end);
  }

  function persistOrder(next:string[]) {
    widgetOrderRef.current=next;
    setWidgetOrder(next);
    try { localStorage.setItem(layoutKey,JSON.stringify(next)); } catch { /* ignore */ }
  }

  function persistHidden(next:string[]) {
    setHiddenWidgets(next);
    try { localStorage.setItem(hiddenKey,JSON.stringify(next)); } catch { /* ignore */ }
  }

  function hideWidget(id:string) {
    persistHidden(Array.from(new Set([...hiddenWidgets,id])));
    setWidgetMenu(null);
  }

  function restoreWidget(id:string) {
    persistHidden(hiddenWidgets.filter((item)=>item!==id));
    setWidgetMenu(null);
  }

  function restoreWidgetPosition(id:string) {
    const current=widgetOrderRef.current.filter((item)=>item!==id);
    const wanted=defaultWidgetOrder.indexOf(id);
    const before=defaultWidgetOrder.slice(0,wanted).filter((item)=>current.includes(item));
    const insertAt=before.length ? current.indexOf(before[before.length-1])+1 : 0;
    current.splice(Math.max(0,insertAt),0,id);
    persistOrder(current);
    setWidgetMenu(null);
  }

  function persistWidgetSizes(next:Record<string,WidgetSize>) {
    setWidgetSizes(next);
    try { localStorage.setItem(sizeKey,JSON.stringify(next)); } catch { /* ignore */ }
  }
  function setWidgetSize(id:string,size:WidgetSize) { persistWidgetSizes({...widgetSizes,[id]:size}); setWidgetMenu(null); }

  function resetDashboardLayout() {
    persistOrder([...defaultWidgetOrder]);
    persistHidden([]);
    persistWidgetSizes({...defaultWidgetSizes});
    setWidgetMenu(null);
  }

  function beginResize(id:string,e:React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault(); e.stopPropagation();
    const sizes:WidgetSize[]=['small','medium','wide','large'];
    const current=widgetSizes[id] || defaultWidgetSizes[id] || 'medium';
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    resizeRef.current={id,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,startIndex:Math.max(0,sizes.indexOf(current))};
  }
  function moveResize(e:React.PointerEvent<HTMLButtonElement>) {
    const r=resizeRef.current; if(!r || r.pointerId!==e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    const sizes:WidgetSize[]=['small','medium','wide','large'];
    const delta=(e.clientX-r.startX)+((e.clientY-r.startY)*.35);
    const step=Math.round(delta/90);
    const index=Math.max(0,Math.min(sizes.length-1,r.startIndex+step));
    const size=sizes[index];
    setWidgetSizes((current)=>{
      if(current[r.id]===size) return current;
      const next={...current,[r.id]:size};
      try { localStorage.setItem(sizeKey,JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  function endResize(e?:React.PointerEvent<HTMLButtonElement>) {
    if(!resizeRef.current) return;
    e?.preventDefault(); e?.stopPropagation();
    resizeRef.current=null;
  }

  function beginTilePress(id:string,e:React.PointerEvent<HTMLElement>) {
    if (e.pointerType==='mouse' && e.button!==0) return;
    const source=e.currentTarget;
    const rect=source.getBoundingClientRect();
    try { source.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const holder={id,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top,timer:0,active:false,source,ghost:null as HTMLElement|null};
    holder.timer=window.setTimeout(()=>{
      const ghost=source.cloneNode(true) as HTMLElement;
      ghost.classList.add('start-drag-ghost');
      ghost.style.width=`${rect.width}px`; ghost.style.height=`${rect.height}px`;
      ghost.style.left=`${e.clientX-holder.offsetX}px`; ghost.style.top=`${e.clientY-holder.offsetY}px`;
      document.body.appendChild(ghost);
      source.classList.add('start-drag-source');
      holder.ghost=ghost; holder.active=true;
      setEditMode(true);
      setWidgetMenu(null);
      document.body.classList.add('start-is-dragging');
      if (navigator.vibrate) navigator.vibrate(20);
    },430);
    dragRef.current=holder;
  }

  function moveTile(e:React.PointerEvent<HTMLElement>) {
    const d=dragRef.current; if(!d || d.pointerId!==e.pointerId) return;
    if(!d.active) {
      if(Math.hypot(e.clientX-d.startX,e.clientY-d.startY)>12) { window.clearTimeout(d.timer); dragRef.current=null; }
      return;
    }
    e.preventDefault();
    if(d.ghost) { d.ghost.style.left=`${e.clientX-d.offsetX}px`; d.ghost.style.top=`${e.clientY-d.offsetY}px`; }
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-start-widget]');
    const targetId=target?.dataset.startWidget;
    if(targetId && targetId!==d.id) {
      setWidgetOrder((current)=>{
        const next=[...current]; const from=next.indexOf(d.id); const to=next.indexOf(targetId);
        if(from<0 || to<0 || from===to) return current;
        next.splice(from,1); next.splice(to,0,d.id); widgetOrderRef.current=next; return next;
      });
    }
    const edge=72;
    if(e.clientY<edge) window.scrollBy({top:-18,behavior:'auto'});
    else if(e.clientY>window.innerHeight-edge) window.scrollBy({top:18,behavior:'auto'});
  }

  function endTilePress(e?:React.PointerEvent<HTMLElement>) {
    const d=dragRef.current; if(!d) return;
    window.clearTimeout(d.timer);
    if(d.active) {
      d.ghost?.remove(); d.source.classList.remove('start-drag-source'); document.body.classList.remove('start-is-dragging');
      persistOrder(widgetOrderRef.current);
      e?.preventDefault();
    }
    dragRef.current=null;
  }

  function tileProps(id:string) {
    return {
      'data-start-widget':id,
      onPointerDown:(e:React.PointerEvent<HTMLElement>)=>beginTilePress(id,e),
      onPointerMove:moveTile,
      onPointerUp:endTilePress,
      onPointerCancel:endTilePress,
    };
  }

  const studentSummary=(person:'Paweł'|'Nikodem')=>{
    const rows=planForPerson(person).filter((r)=>r.source==='school');
    const active=rows.find((r)=>r.start<=now && r.end>now);
    const last=rows[rows.length-1];
    return { active, last };
  };
  const dashboardStudents: Array<'Paweł'|'Nikodem'> = member?.name==='Paweł' || member?.name==='Nikodem' ? [member.name] : [];
  const visibleHealthAlerts=healthAlerts.filter((a)=>a.status==='open' && (isParent(member) || access.viewFamilyHealth || a.person===member?.name));
  const permissionHiddenWidgets=canSeeFamilyContext ? [] : ['ends','free'];
  const widgetLabels:Record<string,string>={day:'Plan dnia',ends:'Kto kiedy kończy',free:'Wszyscy wolni od',school:'Szkoła',tasks:'Zadania',shopping:'Zakupy',health:'Zdrowie',events:'Wydarzenia',quick:'Szybkie dodawanie'};

  const widgets:Record<string,React.ReactNode>={
    day:<article className="start1310-card start1310-day"><header><div><span>📅</span><strong>Plan dnia – dziś</strong></div><button onClick={()=>goTo('Kalendarz')}>Zobacz cały dzień ›</button></header><div className="start1310-day-list">{dayPlan.length ? dayPlan.map((item)=><button key={`${item.person}-${item.key}`} onClick={()=>goTo(item.source==='school' ? 'Szkoła' : 'Kalendarz')}><i style={{background:personColor(item.person)}}/><span className="mini-person">{members.find((m)=>m.name===item.person)?.photoURL ? <img src={members.find((m)=>m.name===item.person)?.photoURL} alt=""/> : memberEmoji(item.person)}</span><time>{item.allDay ? 'Cały dzień' : `${formatTime(item.start)} – ${formatTime(item.end)}`}</time><strong>{personLabel(item.person)}</strong><span>{item.icon} {item.title}</span><em>›</em></button>) : <p className="start1310-empty">Brak wpisów na dziś.</p>}</div></article>,
    ends:<article className="start1310-card start1310-ends" onClick={()=>goTo('Kalendarz')}><header><div><span>🕒</span><strong>Kto kiedy kończy?</strong></div><button onClick={(e)=>{e.stopPropagation();goTo('Kalendarz');}}>Zobacz więcej ›</button></header><div>{visibleFamilyMembers.map((m)=>{const s=liveStatus(m.name);const last=lastEndFor(m.name);return <div key={m.id} className="start1312-end-row" role="button" tabIndex={0} onClick={()=>goTo('Kalendarz')} onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goTo('Kalendarz');}}}><button className="start1312-person-link" onClick={(e)=>{e.stopPropagation();openFamily(m.name);}}><span className="mini-person">{m.photoURL ? <img src={m.photoURL} alt=""/> : memberEmoji(m.name)}</span><strong>{m.name}</strong></button><time>{last ? formatTime(last) : '—'}</time><small className={`status-dot ${s.tone}`}/><em>{s.label}</em><b>›</b></div>;})}</div></article>,
    free:<article className="start1310-card start1310-free"><header><span>👥</span><strong>Wszyscy wolni od</strong></header><b>{allFreeInfo.time}</b><strong className="start1312-free-countdown">{allFreeInfo.countdown}</strong><p>{allFreeInfo.latestPerson ? `Najpóźniej kończy ${allFreeInfo.latestPerson}` : 'Na podstawie dzisiejszego planu'}</p><div aria-hidden="true">⌂ ♡</div></article>,
    school:<article className="start1310-card start1310-school"><header><div><span>🎓</span><strong>Szkoła</strong></div><button onClick={()=>goTo('Szkoła')}>Zobacz więcej ›</button></header>{dashboardStudents.map((person)=>{const info=studentSummary(person);return <button className="school-person-summary" key={person} onClick={()=>goTo('Szkoła')}><span className="mini-person">{members.find((m)=>m.name===person)?.photoURL ? <img src={members.find((m)=>m.name===person)?.photoURL} alt=""/> : memberEmoji(person)}</span><span><strong>{person}</strong>{info.active ? <><b>Trwa lekcja: {info.active.title}</b><small>{formatTime(info.active.start)} – {formatTime(info.active.end)}{info.active.place ? ` · ${info.active.place}` : ''}</small></> : <><b>{info.last ? `Koniec lekcji: ${formatTime(info.last.end)}` : 'Brak lekcji dziś'}</b></>}</span></button>;})}{schoolTests[0] && <button className="school-next" onClick={()=>goTo('Szkoła')}><span>📝</span><div><strong>Najbliżej: {formatShortDate(schoolTests[0].date)} · Sprawdzian</strong><small>{schoolTests[0].subject || schoolTests[0].title}</small></div><em>›</em></button>}{!schoolTests[0] && schoolHomework[0] && <button className="school-next" onClick={()=>goTo('Szkoła')}><span>📚</span><div><strong>Zadanie domowe</strong><small>{schoolHomework[0].subject || schoolHomework[0].title}</small></div><em>›</em></button>}</article>,
    tasks:<article className="start1310-card start1310-tasks"><header><div><span>✅</span><strong>Zadania – najważniejsze</strong></div><button onClick={()=>goTo('Zadania')}>Zobacz wszystkie ›</button></header><div>{priorityTasks.length ? priorityTasks.map((t)=>{const taskMember=members.find((m)=>m.name===t.person);return <button key={t.id} onClick={()=>goTo('Zadania')}><span className="mini-person task-person-avatar">{taskMember?.photoURL ? <img src={taskMember.photoURL} alt=""/> : memberEmoji(t.person)}</span><span><strong>{t.title}</strong><small>{personLabel(t.person)}{t.points ? ` · +${t.points} pkt` : ''}</small></span><em>{t.dueDate===todayKey ? 'Dziś' : t.dueDate ? formatShortDate(t.dueDate) : 'Bez terminu'}</em></button>;}) : <p className="start1310-empty">Brak pilnych zadań ✨</p>}</div></article>,
    shopping:<article className="start1310-card start1310-shopping start1312-shopping"><header><div><span>🛒</span><strong>Zakupy</strong></div><button onClick={()=>goTo('Zakupy')}>Zobacz wszystkie ›</button></header><div className="start1312-shopping-scroll">{shoppingGroups.length ? shoppingGroups.map((group)=><section className="start1312-shopping-group" key={group.category}><header><span>{SHOPPING_META[group.category].icon}</span><strong>{SHOPPING_META[group.category].label}</strong><small>{group.items.filter((item)=>!item.done).length}</small></header><div>{group.items.map((item)=><button key={item.id} className={item.done?'done':''} onClick={()=>void toggleShoppingFromStart(item)}><span className="start1312-shop-check">{item.done?'✓':''}</span><strong>{item.title}</strong><small>{item.quantity ? `${item.quantity} ${item.unit}` : ''}</small></button>)}</div></section>) : <p className="start1310-empty">Lista zakupów jest pusta.</p>}</div></article>,
    health:<article className="start1310-card start1310-health"><header><div><span>♡</span><strong>Zdrowie</strong></div><button onClick={()=>goTo('Zdrowie')}>Zobacz więcej ›</button></header><div>{upcomingVisits.length ? upcomingVisits.map((r)=><button key={r.id} onClick={()=>goTo('Zdrowie')}><span className="mini-person">{members.find((m)=>m.name===r.person)?.photoURL ? <img src={members.find((m)=>m.name===r.person)?.photoURL} alt=""/> : memberEmoji(r.person)}</span><span>🩺</span><div><strong>{personLabel(r.person)} · {r.specialty || r.title}</strong><small>{r.date===todayKey ? 'Dziś' : formatShortDate(r.date)}{r.time ? `, ${r.time}` : ''}</small></div><em>›</em></button>) : <p className="start1310-empty">Brak zaplanowanych wizyt.</p>}</div><div className={`start1310-med-status ${dueMedicineDoses.length || visibleHealthAlerts.length ? 'alert' : 'ok'}`}>{dueMedicineDoses.length || visibleHealthAlerts.length ? `🔔 ${dueMedicineDoses.length || visibleHealthAlerts.length} lek(i) wymagają uwagi` : '✓ Brak leków do podania dziś'}</div></article>,
    events:<article className="start1310-card start1310-events"><header><div><span>📅</span><strong>Nadchodzące wydarzenia</strong></div><button onClick={()=>goTo('Kalendarz')}>Zobacz więcej ›</button></header><div>{upcomingEvents.length ? upcomingEvents.map((o)=><button key={o.key} onClick={()=>goTo('Kalendarz')}><span className="date-box"><b>{o.date.getDate()}</b><small>{o.date.toLocaleDateString('pl-PL',{month:'short'}).replace('.','').toUpperCase()}</small></span><div><strong>{o.source.title}{o.source.person!=='family' ? ` – ${personLabel(o.source.person)}` : ''}</strong><small>{o.source.allDay ? 'Cały dzień' : `${formatTime(o.date)} – ${formatTime(o.endDate)}`}</small></div></button>) : <p className="start1310-empty">Brak nadchodzących wydarzeń.</p>}</div></article>,
    quick:<article className="start1310-card start1310-quick"><header><div><span>⚡</span><strong>Szybkie dodawanie</strong></div></header><div><button onClick={()=>goTo('Kalendarz')}>📅<span>Dodaj wydarzenie</span></button><button onClick={()=>goTo('Zadania')}>✅<span>Dodaj zadanie</span></button><button onClick={()=>goTo('Zakupy')}>🛒<span>Dodaj zakup</span></button><button onClick={()=>goTo('Zdrowie')}>➕<span>Dodaj wizytę</span></button></div></article>,
  };

  return <div className="start-v1310">
    <header className="start1310-header">
      <div><h1>Dzień dobry, {name}!</h1><p>{todayLabel}</p></div>
      <div className="start1310-header-right">
        <div className="start1310-weather"><span>{weather?.icon || '🌤️'}</span><div><small>Kołobrzeg</small><strong>{weather ? `${weather.temp}°C` : '—°C'}</strong></div>{weather && <p><b>{weather.label}</b><span>↑ {weather.max}° ↓ {weather.min}°</span></p>}</div>
        <button className="start1310-icon-btn" title="Szukaj" type="button">⌕</button>
        <div className="start1310-notification-wrap"><button className="start1310-icon-btn" type="button" title="Powiadomienia" onClick={()=>setNotificationsOpen((v)=>!v)}>🔔{unreadNotificationCount>0 && <i>{unreadNotificationCount}</i>}</button>{notificationsOpen && <aside className="start1310-notifications"><header><strong>Powiadomienia</strong><div>{notificationItems.length>0 && <button className="mark-all-read" onClick={markAllNoticesRead}>Przeczytane</button>}<button onClick={()=>setNotificationsOpen(false)}>✕</button></div></header>{notificationItems.length ? notificationItems.map((n)=>{const read=readNoticeIds.includes(n.id);return <button key={n.id} className={read?'read':'unread'} onClick={()=>{markNoticeRead(n.id);setNotificationsOpen(false);goTo(n.page);}}><span>{n.icon}</span><div><strong>{n.title}</strong><small>{n.meta}</small></div>{!read && <i className="notice-unread-dot"/>}</button>;}) : <p>Wszystko załatwione ✓</p>}<footer><button onClick={()=>{try{sessionStorage.setItem('nr-settings-focus','notifications');}catch{} setNotificationsOpen(false);goTo('Ustawienia');}}>Ustawienia powiadomień</button><button title="Wycisz na godzinę">🔕 Wycisz</button></footer></aside>}</div>
        <button className="start1310-user" type="button" onClick={()=>openFamily(name)}>{member?.photoURL ? <img src={member.photoURL} alt=""/> : memberEmoji(name)}</button>
      </div>
    </header>

    <section className="start1310-family-strip">
      {familyStatus.map(({member:person,status})=><button key={person.id} className={`start1310-person-card ${status.tone}`} onClick={()=>openFamily(person.name)}><span className="start1310-person-photo">{person.photoURL ? <img src={person.photoURL} alt=""/> : memberEmoji(person.name)}</span><div><strong>{person.name}</strong><b><i className={`status-dot ${status.tone}`}/>{status.label}</b><small>{status.detail}</small></div><p><small>Następnie</small><strong>{status.next}</strong></p></button>)}
    </section>

    {urgentItems.length>0 && <section className="start1311-urgent-strip">
      <header><div><span>⚠️</span><strong>Najważniejsze teraz</strong></div><small>{urgentItems.length} {urgentItems.length===1?'sprawa wymaga':'spraw wymaga'} uwagi</small></header>
      <div>{urgentItems.slice(0,3).map((item)=><button key={item.id} className={item.level} onClick={()=>goTo(item.page)}><span>{item.icon}</span><div><strong>{item.title}</strong><small>{item.meta}</small></div><em>›</em></button>)}</div>
    </section>}

    <section className={`start1311-edit-bar ${editMode?'editing':''}`}>
      <small>Dane aktualne: {formatTime(now)}</small>
      <div>{editMode && hiddenWidgets.length>0 && <button className="secondary-button" onClick={()=>setWidgetMenu(widgetMenu==='__hidden' ? null : '__hidden')}>＋ Dodaj kafelek ({hiddenWidgets.length})</button>}<button className={editMode?'primary-button':'secondary-button'} onClick={()=>{setEditMode((v)=>!v);setWidgetMenu(null);}}>{editMode?'✓ Gotowe':'✥ Edytuj pulpit'}</button>{editMode&&<button className="secondary-button" onClick={resetDashboardLayout}>↺ Przywróć układ</button>}</div>
      {editMode && widgetMenu==='__hidden' && hiddenWidgets.length>0 && <aside className="start1311-hidden-menu">{hiddenWidgets.map((id)=><button key={id} onClick={()=>restoreWidget(id)}>＋ {widgetLabels[id] || id}</button>)}</aside>}
    </section>

    <section className={`start1310-widget-grid ${editMode?'is-editing':''}`}>
      {widgetOrder.filter((id)=>!hiddenWidgets.includes(id) && !permissionHiddenWidgets.includes(id)).map((id)=><div key={id} className={`start1311-widget-shell widget-${id}`} data-widget-size={widgetSizes[id] || defaultWidgetSizes[id] || 'medium'} {...tileProps(id)}>
        {editMode && <button className="start1311-widget-menu-button" type="button" aria-label={`Opcje: ${widgetLabels[id] || id}`} onPointerDown={(e)=>e.stopPropagation()} onClick={(e)=>{e.stopPropagation();setWidgetMenu((current)=>current===id?null:id);}}>⋮</button>}
        {editMode && widgetMenu===id && <aside className="start1311-widget-menu" onPointerDown={(e)=>e.stopPropagation()}><button onClick={()=>hideWidget(id)}>👁️ Ukryj z pulpitu</button><button onClick={()=>restoreWidgetPosition(id)}>↺ Przywróć pozycję</button><div className="start1312-size-options"><small>Rozmiar kafelka</small><div>{(['small','medium','wide','large'] as WidgetSize[]).map((size)=><button key={size} className={(widgetSizes[id]||defaultWidgetSizes[id])===size?'active':''} onClick={()=>setWidgetSize(id,size)}>{size==='small'?'Mały':size==='medium'?'Średni':size==='wide'?'Szeroki':'Duży'}</button>)}</div></div></aside>}
        {widgets[id]}
        {editMode && <button className="start1312-resize-handle" type="button" aria-label="Zmień rozmiar kafelka" onPointerDown={(e)=>beginResize(id,e)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize}>⌟</button>}
      </div>)}
    </section>
    <div className="start1310-layout-tip">Przytrzymaj kafelek, aby go przesunąć. W trybie edycji użyj ⋮ lub uchwytu w prawym dolnym rogu, aby zmienić jego rozmiar.</div>
  </div>;
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

function CalendarPage({ user, member, goTo }: { user: User; member: Member | null; goTo: (page: Page) => void }) {
  const calendarAccess = effectiveMemberPermissions(member);
  const calendarParent = isParent(member);
  const ownCalendarPerson = isPersonKey(member?.name) ? member!.name as PersonKey : 'family';
  const [view, setView] = useState<CalendarView>('week');
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEventData[]>([]);
  const [members, setMembers] = useState<FamilyMemberDoc[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonKey>('family');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EventForm>(() => createDefaultEventForm(new Date()));
  const [saving, setSaving] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventData | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EventForm>(() => createDefaultEventForm(new Date()));
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lastChecked, setLastChecked] = useState(() => new Date());

  useEffect(() => onSnapshot(collection(db, 'members'), (snapshot) => {
    const loaded = snapshot.docs.map((memberDoc): FamilyMemberDoc => {
      const data = memberDoc.data();
      return {
        id: memberDoc.id,
        name: String(data.name || 'Rodzina'),
        role: personRole(String(data.name || ''), typeof data.role === 'string' ? data.role : ''),
        photoURL: typeof data.photoURL === 'string' ? data.photoURL : undefined,
        active: data.active !== false,
        birthDate: typeof data.birthDate === 'string' ? data.birthDate : undefined,
        permissions: normalizeMemberPermissions(data.permissions),
      };
    });
    loaded.sort((a, b) => FAMILY_ORDER.indexOf(a.name) - FAMILY_ORDER.indexOf(b.name));
    setMembers(loaded);
  }, (error) => console.error('Błąd profili w kalendarzu:', error)), []);

  useEffect(() => onSnapshot(collection(db, 'calendarEvents'), (snapshot) => {
    const loaded: CalendarEventData[] = [];
    snapshot.forEach((eventDoc) => {
      const data = eventDoc.data();
      if (!(data.date instanceof Timestamp)) return;
      const start = data.date.toDate();
      const endDate = data.endDate instanceof Timestamp ? data.endDate.toDate() : new Date(start.getTime() + 3600000);
      loaded.push({
        id: eventDoc.id,
        title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Wydarzenie',
        person: isPersonKey(data.person) ? data.person : 'family',
        date: start,
        endDate,
        allDay: data.allDay === true,
        description: typeof data.description === 'string' ? data.description : '',
        createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
        repeat: isRepeatType(data.repeat) ? data.repeat : 'none',
        repeatUntil: data.repeatUntil instanceof Timestamp ? data.repeatUntil.toDate() : null,
      });
    });
    loaded.sort((a, b) => a.date.getTime() - b.date.getTime());
    setEvents(loaded);
    setLastChecked(new Date());
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

  const calendarPeople = (calendarParent || calendarAccess.viewFamilySchedule)
    ? (['Sebastian','Dominika','Paweł','Nikodem','Layla'] as PersonKey[])
    : (ownCalendarPerson === 'family' ? [] : [ownCalendarPerson]);

  useEffect(() => {
    if (!calendarParent && !calendarAccess.viewFamilySchedule && selectedPerson !== 'family' && selectedPerson !== ownCalendarPerson) setSelectedPerson(ownCalendarPerson);
  }, [calendarParent,calendarAccess.viewFamilySchedule,ownCalendarPerson,selectedPerson]);

  const visibleEvents = useMemo(() => events.filter((event) => {
    const allowed = calendarParent || calendarAccess.viewFamilySchedule || event.person === ownCalendarPerson || event.person === 'family';
    if (!allowed) return false;
    return selectedPerson === 'family' || event.person === selectedPerson || event.person === 'family';
  }), [events, selectedPerson, calendarParent, calendarAccess.viewFamilySchedule, ownCalendarPerson]);

  const occurrences = useMemo(() => visibleEvents
    .flatMap((event) => generateOccurrences(event, range.start, range.end))
    .sort((a, b) => a.date.getTime() - b.date.getTime()), [visibleEvents, range]);

  const todayRange = useMemo(() => ({ start: startOfDay(new Date()), end: endOfDay(new Date()) }), []);
  const todayOccurrences = useMemo(() => visibleEvents
    .flatMap((event) => generateOccurrences(event, todayRange.start, todayRange.end)), [visibleEvents, todayRange]);

  const upcomingOccurrences = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const futureEnd = endOfDay(addDays(now, 30));
    return visibleEvents
      .flatMap((event) => generateOccurrences(event, todayStart, futureEnd))
      .filter((item) => item.date >= todayStart)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 7);
  }, [visibleEvents]);

  const loggedMember = members.find((item) => item.id === user.uid) || members.find((item) => item.name === 'Sebastian') || null;
  const selectedDayOccurrences = useMemo(() => occurrences.filter((item) => sameDay(item.date, focusDate)), [occurrences, focusDate]);

  function memberForPerson(person: PersonKey) {
    if (person === 'family') return null;
    return members.find((item) => item.name === person) || null;
  }

  function personAvatar(person: PersonKey) {
    const familyMember = memberForPerson(person);
    return familyMember?.photoURL ? <img src={familyMember.photoURL} alt="" /> : <>{memberEmoji(person)}</>;
  }

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

  const syncText = navigator.onLine ? 'Dane rodzinne są synchronizowane na bieżąco' : 'Tryb offline — zmiany zsynchronizują się po odzyskaniu połączenia';

  return (
    <div className="page-content calendar-page-v131">
      <div className="calendar-mobile-appbar">
        <button type="button" className="calendar-mobile-menu" aria-label="Menu">☰</button>
        <div><img src="/nasza-rodzina-logo.svg" alt="" /><strong>Nasza Rodzina</strong></div>
        <span className="calendar-mobile-bell">🔔</span>
        <span className="calendar-mobile-user">{loggedMember?.photoURL ? <img src={loggedMember.photoURL} alt="" /> : memberEmoji(loggedMember?.name || 'Sebastian')}</span>
      </div>

      <section className="calendar-family-top">
        <div className="calendar-family-people" aria-label="Profile rodziny">
          {members.slice(0, 5).map((person) => (
            <button key={person.id} type="button" className="calendar-family-person" onClick={() => setSelectedPerson(person.name as PersonKey)}>
              <span className="calendar-family-avatar">{person.photoURL ? <img src={person.photoURL} alt="" /> : memberEmoji(person.name)}</span>
              <span className={`calendar-family-dot ${person.active ? 'on' : ''}`} />
              <strong>{person.name}</strong>
              <small>{personRole(person.name, person.role)}</small>
            </button>
          ))}
        </div>
        <div className="calendar-family-actions">
          <button type="button" title="Szukaj">⌕</button>
          <button type="button" title="Powiadomienia" className="calendar-bell">🔔<i>3</i></button>
          <span className="calendar-account-avatar">{loggedMember?.photoURL ? <img src={loggedMember.photoURL} alt="" /> : memberEmoji(loggedMember?.name || 'Sebastian')}</span>
        </div>
      </section>

      <section className="calendar-heading-row">
        <div>
          <h1>Kalendarz</h1>
          <p>Wszystkie wydarzenia w jednym miejscu</p>
        </div>
        <div className="calendar-heading-actions">
          <button className="calendar-add-button" type="button" onClick={() => openNewEvent()}>＋ Dodaj wydarzenie</button>
          <button className="calendar-today-button" type="button" onClick={() => setFocusDate(new Date())}>▣ Dzisiaj</button>
          <div className="calendar-view-switch">
            {(['day', 'week', 'month'] as CalendarView[]).map((item) => (
              <button key={item} type="button" className={view === item ? 'active' : ''} onClick={() => setView(item)}>
                {item === 'day' ? 'Dzień' : item === 'week' ? 'Tydzień' : 'Miesiąc'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={`calendar-sync-strip ${navigator.onLine ? 'online' : 'offline'}`}>
        <span className="calendar-sync-icon">↻</span>
        <div>
          <strong>Synchronizacja kalendarza</strong>
          <small>{syncText} · ostatnie sprawdzenie {lastChecked.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
        <button type="button" onClick={() => setLastChecked(new Date())}>↻ Sprawdź</button>
        <button type="button" className="calendar-sync-settings" onClick={() => goTo('Ustawienia')}>⋮</button>
      </section>

      <section className="calendar-mobile-primary-action">
        <button className="calendar-add-button" type="button" onClick={() => openNewEvent()}>＋ Dodaj wydarzenie</button>
        <div className="calendar-view-switch">
          {(['day', 'week', 'month'] as CalendarView[]).map((item) => (
            <button key={item} type="button" className={view === item ? 'active' : ''} onClick={() => setView(item)}>
              {item === 'day' ? 'Dzień' : item === 'week' ? 'Tydzień' : 'Miesiąc'}
            </button>
          ))}
        </div>
      </section>

      <section className="calendar-period-row">
        <strong>{titleForView()}</strong>
        <span>{view === 'week' ? `Tydzień ${getWeekNumber(focusDate)}` : ''}</span>
        <div>
          <button type="button" onClick={() => navigate(-1)}>‹</button>
          <button type="button" onClick={() => setFocusDate(new Date())}>Dzisiaj</button>
          <button type="button" onClick={() => navigate(1)}>›</button>
        </div>
      </section>

      {view === 'week' && (
        <>
          <section className="calendar-mobile-week-strip">
            {weekDays.map((day) => (
              <button key={formatDateInput(day)} type="button" className={sameDay(day, focusDate) ? 'active' : ''} onClick={() => setFocusDate(day)}>
                <small>{capitalize(day.toLocaleDateString('pl-PL', { weekday: 'short' })).replace('.', '')}</small>
                <strong>{day.getDate()}</strong>
              </button>
            ))}
          </section>

          <div className="calendar-main-layout">
            <CalendarWeekTimetable days={weekDays} occurrences={occurrences} onOpen={openEvent} onAdd={openNewEvent} />

            <aside className="calendar-right-column">
              <CalendarMiniMonth focusDate={focusDate} setFocusDate={setFocusDate} />

              <section className="calendar-side-card calendar-visible-calendars">
                <h3>Widoczne kalendarze</h3>
                <button type="button" className={selectedPerson === 'family' ? 'active' : ''} onClick={() => setSelectedPerson('family')}>
                  <span className="calendar-filter-dot family" /> <strong>Wydarzenia rodzinne</strong><em>✓</em>
                </button>
                {calendarPeople.map((person) => (
                  <button type="button" key={person} className={selectedPerson === person ? 'active' : ''} onClick={() => setSelectedPerson(person)}>
                    <span className="calendar-filter-avatar">{personAvatar(person)}</span><strong>{person}</strong><em>✓</em>
                  </button>
                ))}
              </section>

              <section className="calendar-side-card calendar-connected-card">
                <h3>Połączone kalendarze</h3>
                <div><span className="source-icon family-source">NR</span><p><strong>Nasza Rodzina</strong><small className="connected-label">● Aktywny</small></p></div>
                <div><span className="source-icon google-source">G</span><p><strong>Google Calendar</strong><small>Do podłączenia w Ustawieniach</small></p></div>
                <div><span className="source-icon apple-source"></span><p><strong>Apple / iCloud</strong><small>Do podłączenia w Ustawieniach</small></p></div>
                <button type="button" className="calendar-source-settings" onClick={() => goTo('Ustawienia')}>⚙ Źródła kalendarzy ustawisz w Ustawieniach</button>
              </section>

              <CalendarUpcomingCard items={upcomingOccurrences.slice(0, 4)} onOpen={openEvent} />
            </aside>
          </div>

          <section className="calendar-mobile-agenda">
            <h2>{capitalize(focusDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h2>
            {selectedDayOccurrences.length === 0 ? <p className="calendar-empty-mobile">Brak wydarzeń tego dnia.</p> : selectedDayOccurrences.map((item) => (
              <button type="button" key={item.key} className={`calendar-mobile-event ${personEventClass(item.source.person)}`} onClick={() => openEvent(item.source)}>
                <time>{item.source.allDay ? 'Cały dzień' : <>{formatTime(item.date)}<small>{formatTime(item.endDate)}</small></>}</time>
                <span className="calendar-mobile-event-icon">{eventActivityIcon(item.source.title)}</span>
                <span className="calendar-mobile-event-copy"><strong>{item.source.title}</strong><small>{personLabel(item.source.person)}</small></span>
                <span className="calendar-mobile-event-avatar">{personAvatar(item.source.person)}</span>
                <em>⋮</em>
              </button>
            ))}
            <CalendarUpcomingCard items={upcomingOccurrences.slice(0, 4)} onOpen={openEvent} mobile />
          </section>
        </>
      )}

      {view === 'day' && <CalendarDay date={focusDate} occurrences={occurrences} onOpen={openEvent} onAdd={openNewEvent} />}
      {view === 'month' && <CalendarMonth focusDate={focusDate} days={monthDays} occurrences={occurrences} onOpen={openEvent} onAdd={openNewEvent} onDay={(day) => { setFocusDate(day); setView('day'); }} />}

      <section className="calendar-summary-tiles">
        <button type="button" onClick={() => setFocusDate(new Date())}><span>▣</span><div><strong>Dzisiaj</strong><small>{todayOccurrences.length} wydarzeń</small></div></button>
        <button type="button"><span>◷</span><div><strong>Najbliższe</strong><small>{upcomingOccurrences.length} wydarzeń</small></div></button>
        <button type="button"><span>♛</span><div><strong>Urodziny</strong><small>Rodzinne daty</small></div></button>
        <button type="button"><span>↻</span><div><strong>Powtarzające się</strong><small>{events.filter((item) => item.repeat !== 'none').length} wydarzeń</small></div></button>
        <button type="button" onClick={() => goTo('Ustawienia')}><span>▱</span><div><strong>Połączone kalendarze</strong><small>Ustaw źródła</small></div></button>
      </section>

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

      <button type="button" className="calendar-mobile-fab" onClick={() => openNewEvent()}>＋</button>
    </div>
  );
}

function getWeekNumber(date: Date) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function CalendarWeekTimetable({ days, occurrences, onOpen, onAdd }: { days: Date[]; occurrences: CalendarOccurrence[]; onOpen: (event: CalendarEventData) => void; onAdd: (date?: Date, time?: string, allDay?: boolean) => void }) {
  const firstHour = 6;
  const lastHour = 22;
  const hourHeight = 42;
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);

  function eventStyle(item: CalendarOccurrence): React.CSSProperties {
    const startMinutes = Math.max(firstHour * 60, item.date.getHours() * 60 + item.date.getMinutes());
    const endMinutes = Math.min((lastHour + 1) * 60, item.endDate.getHours() * 60 + item.endDate.getMinutes());
    const top = ((startMinutes - firstHour * 60) / 60) * hourHeight;
    const height = Math.max(32, ((Math.max(endMinutes, startMinutes + 30) - startMinutes) / 60) * hourHeight - 3);
    return { top, height };
  }

  return (
    <section className="calendar-week-timetable">
      <div className="calendar-week-head">
        <span className="calendar-time-corner">Godzina</span>
        {days.map((day) => (
          <button type="button" key={formatDateInput(day)} className={sameDay(day, new Date()) ? 'today' : ''} onClick={() => onAdd(day)}>
            <strong>{capitalize(day.toLocaleDateString('pl-PL', { weekday: 'short' })).replace('.', '')}</strong>
            <span>{day.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}</span>
          </button>
        ))}
      </div>
      <div className="calendar-all-day-row">
        <span>Cały dzień</span>
        {days.map((day) => {
          const allDay = occurrences.filter((item) => sameDay(item.date, day) && item.source.allDay);
          return <div key={formatDateInput(day)}>{allDay.slice(0, 2).map((item) => <button type="button" key={item.key} className={`calendar-week-event all-day ${personEventClass(item.source.person)}`} onClick={() => onOpen(item.source)}><strong>{item.source.title}</strong></button>)}</div>;
        })}
      </div>
      <div className="calendar-time-grid" style={{ '--hour-height': `${hourHeight}px`, '--hour-count': hours.length } as React.CSSProperties}>
        <div className="calendar-hour-axis">{hours.map((hour) => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div>
        {days.map((day) => {
          const timed = occurrences.filter((item) => sameDay(item.date, day) && !item.source.allDay && item.endDate.getHours() >= firstHour && item.date.getHours() <= lastHour);
          return (
            <div className={`calendar-day-column ${sameDay(day, new Date()) ? 'today' : ''}`} key={formatDateInput(day)}>
              {timed.map((item) => (
                <button type="button" key={item.key} style={eventStyle(item)} className={`calendar-week-event ${personEventClass(item.source.person)}`} onClick={() => onOpen(item.source)}>
                  <span>{eventActivityIcon(item.source.title)}</span>
                  <strong>{item.source.title}</strong>
                  <small>{formatTime(item.date)}–{formatTime(item.endDate)}</small>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CalendarMiniMonth({ focusDate, setFocusDate }: { focusDate: Date; setFocusDate: React.Dispatch<React.SetStateAction<Date>> }) {
  const first = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(null);

  return (
    <section className="calendar-side-card calendar-mini-month">
      <header>
        <button type="button" onClick={() => setFocusDate((current) => addMonths(current, -1))}>‹</button>
        <strong>{capitalize(focusDate.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }))}</strong>
        <button type="button" onClick={() => setFocusDate((current) => addMonths(current, 1))}>›</button>
      </header>
      <div className="calendar-mini-weekdays">{['Pn','Wt','Śr','Cz','Pt','So','Nd'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-mini-days">
        {cells.map((day, index) => day ? (
          <button type="button" key={`${day}-${index}`} className={day === focusDate.getDate() ? 'active' : ''} onClick={() => setFocusDate(new Date(focusDate.getFullYear(), focusDate.getMonth(), day))}>{day}</button>
        ) : <span key={`empty-${index}`} />)}
      </div>
    </section>
  );
}

function CalendarUpcomingCard({ items, onOpen, mobile = false }: { items: CalendarOccurrence[]; onOpen: (event: CalendarEventData) => void; mobile?: boolean }) {
  return (
    <section className={`calendar-side-card calendar-upcoming-card ${mobile ? 'mobile' : ''}`}>
      <header><h3>Nadchodzące wydarzenia</h3><span>Zobacz wszystkie</span></header>
      {items.length === 0 ? <p className="muted">Brak nadchodzących wydarzeń.</p> : items.map((item) => (
        <button type="button" key={item.key} onClick={() => onOpen(item.source)}>
          <span className="calendar-upcoming-date"><b>{String(item.date.getDate()).padStart(2, '0')}</b><small>{item.date.toLocaleDateString('pl-PL', { month: 'short' }).replace('.', '').toUpperCase()}</small></span>
          <span><strong>{item.source.title}</strong><small>{item.source.allDay ? 'Cały dzień' : `${formatTime(item.date)}–${formatTime(item.endDate)}`}</small></span>
          <em>›</em>
        </button>
      ))}
    </section>
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
  const completed = sameDay(occurrence.date, new Date()) && occurrence.endDate < new Date();
  return (
    <button type="button" className={`calendar-event ${personEventClass(event.person)} ${completed ? 'completed-today' : ''}`} onClick={onClick}>
      <strong>{event.title}</strong>
      <span>{event.allDay ? 'Cały dzień' : formatTime(occurrence.date)}{event.repeat !== 'none' ? ' · ↻' : ''}{completed ? ' · ✓ Zakończone' : ''}</span>
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
   TASKS + POINTS
   ========================================================= */


const TASK_TEMPLATES = [
  ['🗑️', 'Wynieść śmieci'], ['🛏️', 'Posprzątać pokój'], ['🛁', 'Umyć łazienkę'], ['🪟', 'Umyć okna'],
  ['🧹', 'Odkurzyć'], ['🧺', 'Pranie'], ['🍽️', 'Zmywarka'], ['🐶', 'Nakarmić psa'],
] as const;

const TASK_TEMPLATE_COLORS: Record<string, string> = {
  'Wynieść śmieci': '#dff7ea',
  'Posprzątać pokój': '#ffe6ee',
  'Umyć łazienkę': '#e5f7ff',
  'Umyć okna': '#fff1dd',
  'Odkurzyć': '#efe7ff',
  'Pranie': '#fff5cf',
  'Zmywarka': '#ddf5ee',
  'Nakarmić psa': '#ffe9df',
};

function taskTemplateIcon(title: string) {
  const found = TASK_TEMPLATES.find(([, label]) => label === title);
  return found?.[0] || '📝';
}

function taskRepeatLabel(repeat: TaskRepeat) {
  switch (repeat) {
    case 'daily': return 'Codziennie';
    case 'weekly': return 'Co tydzień';
    case 'monthly': return 'Co miesiąc';
    default: return 'Jednorazowe';
  }
}

function taskPriorityLabel(priority: TaskPriority) {
  switch (priority) {
    case 'high': return 'Wysoki';
    case 'low': return 'Niski';
    default: return 'Normalny';
  }
}

function taskStatusLabel(item: TaskItem) {
  if (item.done) return 'Wykonane';
  if (item.approvalStatus === 'pending') return 'Do zatwierdzenia';
  return 'Do zrobienia';
}

function taskStatusClass(item: TaskItem) {
  if (item.done) return 'done';
  if (item.approvalStatus === 'pending') return 'pending';
  return 'todo';
}

function taskPointsTone(points: number) {
  if (points >= 15) return 'hot';
  if (points >= 10) return 'gold';
  return 'green';
}

function TasksPage({ user, member }: { user: User; member: Member | null }) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [form, setForm] = useState<TaskForm>({ title: '', person: 'family', dueDate: '', priority: 'normal', note: '', points: 5, requireApproval: true, repeat: 'none' });
  const [filter, setFilter] = useState<'all' | 'today' | 'upcoming' | 'pending' | 'done'>('all');
  const parent = isParent(member);
  const taskAccess = effectiveMemberPermissions(member);
  const today = formatDateInput(new Date());
  const tomorrow = formatDateInput(addDays(new Date(), 1));

  useEffect(() => onSnapshot(collection(db, 'tasks'), (snap) => {
    const next = snap.docs.map((d): TaskItem => {
      const x = d.data();
      return {
        id: d.id,
        title: String(x.title || ''),
        person: isPersonKey(x.person) ? x.person : 'family',
        done: x.done === true,
        dueDate: typeof x.dueDate === 'string' ? x.dueDate : '',
        priority: x.priority === 'low' || x.priority === 'high' ? x.priority : 'normal',
        note: typeof x.note === 'string' ? x.note : '',
        points: Number(x.points || 0),
        requireApproval: x.requireApproval === true,
        approvalStatus: x.approvalStatus === 'pending' || x.approvalStatus === 'approved' ? x.approvalStatus : 'none',
        repeat: x.repeat === 'daily' || x.repeat === 'weekly' || x.repeat === 'monthly' ? x.repeat : 'none',
        createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
        completedAt: x.completedAt instanceof Timestamp ? x.completedAt.toDate() : undefined,
      };
    });
    next.sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    setItems(next);
  }), []);

  const accessibleItems = useMemo(() => items.filter((item)=>parent || taskAccess.viewFamilyTasks || item.person===member?.name || item.person==='family'),[items,parent,taskAccess.viewFamilyTasks,member?.name]);

  const visible = useMemo(() => accessibleItems.filter((item) => {
    if (filter === 'today') return !item.done && item.dueDate === today;
    if (filter === 'upcoming') return !item.done && !!item.dueDate && item.dueDate > today;
    if (filter === 'pending') return item.approvalStatus === 'pending';
    if (filter === 'done') return item.done;
    return true;
  }), [accessibleItems, filter, today]);

  const pointsByPerson = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of accessibleItems) {
      if (item.done && (item.approvalStatus === 'approved' || !item.requireApproval)) {
        result[item.person] = (result[item.person] || 0) + item.points;
      }
    }
    return result;
  }, [accessibleItems]);

  const totals = useMemo(() => ({
    today: accessibleItems.filter((i) => !i.done && i.dueDate === today).length,
    pending: accessibleItems.filter((i) => i.approvalStatus === 'pending').length,
    done: accessibleItems.filter((i) => i.done).length,
    points: Object.values(pointsByPerson).reduce((a, b) => a + b, 0),
  }), [accessibleItems, pointsByPerson, today]);

  const groupedSections = useMemo(() => {
    const next: Array<{ key: string; title: string; subtitle: string; items: TaskItem[] }> = [];
    const addSection = (key: string, title: string, subtitle: string, list: TaskItem[]) => {
      if (list.length) next.push({ key, title, subtitle, items: list });
    };

    if (filter === 'done') {
      addSection('done', 'Wykonane', 'Zadania zamknięte i rozliczone punktowo.', visible);
      return next;
    }
    if (filter === 'pending') {
      addSection('pending', 'Do zatwierdzenia', 'Czekają na akceptację rodzica.', visible);
      return next;
    }

    const notDone = visible.filter((item) => !item.done);
    addSection('today', 'Dzisiaj', capitalize(new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })), notDone.filter((item) => item.dueDate === today));
    addSection('tomorrow', 'Jutro', capitalize(addDays(new Date(), 1).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })), notDone.filter((item) => item.dueDate === tomorrow));
    addSection('upcoming', 'Nadchodzące', 'Zadania zaplanowane na kolejne dni.', notDone.filter((item) => !!item.dueDate && item.dueDate > tomorrow));
    addSection('later', 'Bez terminu', 'Stałe obowiązki i zadania bez daty.', notDone.filter((item) => !item.dueDate));
    if (filter === 'all') addSection('completed', 'Ostatnio wykonane', 'Dla szybkiego podglądu postępów.', visible.filter((item) => item.done).slice(0, 4));
    return next;
  }, [visible, filter, today, tomorrow]);

  const statCounts = useMemo(() => ({
    created: accessibleItems.length,
    completed: accessibleItems.filter((item) => item.done).length,
    pending: accessibleItems.filter((item) => item.approvalStatus === 'pending').length,
    assignedPoints: accessibleItems.reduce((sum, item) => sum + item.points, 0),
  }), [accessibleItems]);

  const quickList = TASK_TEMPLATES.slice(0, 4);

  function openAdd(template?: string) {
    setEditing(null);
    setForm({ title: template || '', person: 'family', dueDate: today, priority: 'normal', note: '', points: 5, requireApproval: true, repeat: 'none' });
    setShowForm(true);
  }
  function openEdit(item: TaskItem) {
    setEditing(item);
    setForm({ title: item.title, person: item.person, dueDate: item.dueDate, priority: item.priority, note: item.note, points: item.points, requireApproval: item.requireApproval, repeat: item.repeat });
    setShowForm(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    const payload = { ...form, title: form.title.trim(), points: parent ? Math.max(0, Number(form.points || 0)) : 0, updatedAt: Timestamp.now() };
    if (editing) await updateDoc(doc(db, 'tasks', editing.id), payload);
    else await addDoc(collection(db, 'tasks'), { ...payload, done: false, approvalStatus: 'none', createdBy: user.uid, createdAt: Timestamp.now() });
    setShowForm(false);
  }

  async function toggleDone(item: TaskItem) {
    if (item.done) {
      if (!parent) return;
      await updateDoc(doc(db, 'tasks', item.id), { done: false, approvalStatus: 'none', completedAt: null, updatedAt: Timestamp.now() });
      return;
    }
    if (item.requireApproval && !parent) {
      await updateDoc(doc(db, 'tasks', item.id), { approvalStatus: 'pending', updatedAt: Timestamp.now() });
    } else {
      await updateDoc(doc(db, 'tasks', item.id), { done: true, approvalStatus: item.requireApproval ? 'approved' : 'none', completedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    }
  }

  async function approve(item: TaskItem) {
    await updateDoc(doc(db, 'tasks', item.id), { done: true, approvalStatus: 'approved', completedAt: Timestamp.now(), updatedAt: Timestamp.now() });
  }
  async function reject(item: TaskItem) {
    await updateDoc(doc(db, 'tasks', item.id), { done: false, approvalStatus: 'none', updatedAt: Timestamp.now() });
  }

  return (
    <div className="page-content compact-page tasks-versa-page">
      <ModuleHeader icon="✅" title="Zadania" text="Obowiązki, szybkie zadania, punkty i nagrody." action={<button className="primary-button tasks-add-button" onClick={() => openAdd()}>＋ Dodaj zadanie</button>} />

      <section className="tasks-top-summary">
        <button type="button" className="tasks-summary-card summary-today" onClick={() => setFilter('today')}>
          <span className="summary-icon">📅</span>
          <div><strong>{totals.today}</strong><small>Dzisiaj</small><em>z {items.filter((i) => !i.done).length} zadań</em></div>
        </button>
        <button type="button" className="tasks-summary-card summary-pending" onClick={() => setFilter('pending')}>
          <span className="summary-icon">⏳</span>
          <div><strong>{totals.pending}</strong><small>Do zatwierdzenia</small><em>oczekuje na rodzica</em></div>
        </button>
        <button type="button" className="tasks-summary-card summary-done" onClick={() => setFilter('done')}>
          <span className="summary-icon">✅</span>
          <div><strong>{totals.done}</strong><small>Wykonane</small><em>w tym miesiącu</em></div>
        </button>
        <button type="button" className="tasks-summary-card summary-points" onClick={() => setFilter('all')}>
          <span className="summary-icon">⭐</span>
          <div><strong>{totals.points}</strong><small>Punkty razem</small><em>dla całej rodziny</em></div>
        </button>
      </section>

      <section className="tasks-quick-section">
        <header>
          <div><strong>⚡ Szybkie zadania</strong><small>Kliknij gotowiec i wybierz osobę, termin oraz punkty.</small></div>
          <button type="button" className="tasks-link-button" onClick={() => setFilter('all')}>Zobacz wszystkie</button>
        </header>
        <div className="tasks-quick-grid">
          {TASK_TEMPLATES.map(([icon, title]) => (
            <button key={title} type="button" className="task-template-card" style={{ background: TASK_TEMPLATE_COLORS[title] || '#eff5ff' }} onClick={() => openAdd(title)}>
              <span>{icon}</span>
              <strong>{title}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="tasks-layout-grid">
        <section className="tasks-primary-column">
          <div className="tasks-filter-row">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Wszystkie</button>
            <button className={filter === 'today' ? 'active' : ''} onClick={() => setFilter('today')}>Dzisiaj</button>
            <button className={filter === 'upcoming' ? 'active' : ''} onClick={() => setFilter('upcoming')}>Nadchodzące</button>
            <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Do zatwierdzenia</button>
            <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>Wykonane</button>
            <button className="tasks-filter-ghost" type="button">⌕ Filtry</button>
          </div>

          {groupedSections.length === 0 ? <section className="module-list"><EmptyState icon="✨" text="Brak zadań w tym widoku." /></section> : groupedSections.map((section) => (
            <section className="task-section-card" key={section.key}>
              <header className="task-section-header">
                <div><h3>{section.title}</h3><small>{section.subtitle}</small></div>
              </header>
              <div className="task-card-list">
                {section.items.map((item) => (
                  <article className={`task-card-row ${item.done ? 'done' : ''} ${item.approvalStatus === 'pending' ? 'pending' : ''}`} key={item.id}>
                    <button className="check-button task-check-button" onClick={() => void toggleDone(item)}>{item.done ? '✓' : item.approvalStatus === 'pending' ? '⌛' : '○'}</button>
                    <div className="task-icon-box">{taskTemplateIcon(item.title)}</div>
                    <div className="task-card-main">
                      <div className="task-title-line">
                        <strong>{item.title}</strong>
                        {item.repeat !== 'none' && <span className="task-repeat-chip">↻ {taskRepeatLabel(item.repeat)}</span>}
                      </div>
                      <small>{item.note ? `${item.note} · ` : ''}{taskPriorityLabel(item.priority)} · {item.dueDate ? formatShortDate(item.dueDate) : 'Bez terminu'}</small>
                    </div>
                    <div className="task-assignee-card">
                      <span className="task-assignee-avatar" style={{ background: `${personColor(item.person)}20`, color: personColor(item.person) }}>{memberEmoji(item.person)}</span>
                      <div><strong>{personLabel(item.person)}</strong><small>{item.dueDate ? formatShortDate(item.dueDate) : 'Cały dzień'}</small></div>
                    </div>
                    <span className={`task-points-pill ${taskPointsTone(item.points)}`}>⭐ +{item.points} pkt</span>
                    <span className={`task-status-pill ${taskStatusClass(item)}`}>{taskStatusLabel(item)}</span>
                    {parent && item.approvalStatus === 'pending' ? <div className="approval-actions tasks-approval-actions"><button onClick={() => void approve(item)}>✓ Zatwierdź</button><button onClick={() => void reject(item)}>✕ Odrzuć</button></div> : null}
                    <div className="task-row-actions">
                      {parent && <button className="icon-button" onClick={() => openEdit(item)}>✏️</button>}
                      {parent && <button className="icon-danger" onClick={() => deleteDoc(doc(db, 'tasks', item.id))}>🗑️</button>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </section>

        <aside className="tasks-side-column">
          <section className="tasks-side-card rewards-card">
            <header><div><strong>🏆 Punkty i nagrody</strong><small>100 pkt = nagroda</small></div></header>
            {(['Nikodem', 'Paweł', 'Layla'] as PersonKey[]).map((person) => {
              const points = pointsByPerson[person] || 0;
              const progress = Math.max(0, Math.min(100, points % 100));
              return (
                <article key={person} className="reward-person-row">
                  <div className="reward-person-title">
                    <span className="task-assignee-avatar" style={{ background: `${personColor(person)}20`, color: personColor(person) }}>{memberEmoji(person)}</span>
                    <div><strong>{person}</strong><small>{points} pkt</small></div>
                  </div>
                  <div className="reward-progress-line"><span style={{ width: `${progress}%`, background: personColor(person) }} /></div>
                  <em>{progress}/100</em>
                </article>
              );
            })}
            <div className="reward-highlight-box"><span>🎁</span><div><strong>Nagroda przy 100 pkt</strong><small>Rodzice ustalają nagrodę razem z dzieckiem. Punkty za zadanie może ustawić tylko rodzic.</small></div></div>
          </section>

          <section className="tasks-side-card stats-card">
            <header><div><strong>📊 Statystyki</strong><small>Ten tydzień</small></div></header>
            <div className="stats-list">
              <div><span>Utworzone</span><strong>{statCounts.created}</strong></div>
              <div><span>Wykonane</span><strong>{statCounts.completed}</strong></div>
              <div><span>Do zatwierdzenia</span><strong>{statCounts.pending}</strong></div>
              <div><span>Punkty przyznane</span><strong>{statCounts.assignedPoints}</strong></div>
            </div>
          </section>

          <section className="tasks-side-card quick-add-card">
            <header><div><strong>⚡ Najszybciej dodawane</strong><small>Stałe obowiązki z ikonkami</small></div></header>
            <div className="quick-add-list">
              {quickList.map(([icon, title]) => (
                <button key={title} type="button" className="quick-add-row" onClick={() => openAdd(title)}>
                  <span className="quick-add-icon">{icon}</span>
                  <strong>{title}</strong>
                  <em>＋</em>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {showForm && <Modal title={editing ? '✏️ Edytuj zadanie' : '➕ Nowe zadanie'} onClose={() => setShowForm(false)} wide>
        <form className="form-grid" onSubmit={save}>
          <label className="field field-wide"><span>Zadanie</span><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Np. wyrzucić śmieci…" required /></label>
          <label className="field"><span>Osoba</span><PersonSelect value={form.person} onChange={(person) => setForm((f) => ({ ...f, person }))} /></label>
          <label className="field"><span>Termin</span><input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} /></label>
          <label className="field"><span>Priorytet</span><select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}><option value="low">Niski</option><option value="normal">Normalny</option><option value="high">Wysoki</option></select></label>
          <label className="field"><span>Powtarzanie</span><select value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as TaskRepeat }))}><option value="none">Brak</option><option value="daily">Codziennie</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option></select></label>
          <label className="field"><span>Punkty</span><input type="number" min={0} value={form.points} onChange={(e) => setForm((f) => ({ ...f, points: Number(e.target.value || 0) }))} disabled={!parent} /></label>
          <label className="field field-wide"><span>Notatka</span><textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Opcjonalna notatka" /></label>
          <label className="toggle-row field-wide"><input type="checkbox" checked={form.requireApproval} onChange={(e) => setForm((f) => ({ ...f, requireApproval: e.target.checked }))} /><span>Wymaga zatwierdzenia przez rodzica</span></label>
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Anuluj</button><button type="submit" className="primary-button">{editing ? 'Zapisz zmiany' : 'Dodaj zadanie'}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

const SHOPPING_META: Record<ShoppingCategory, { label: string; icon: string }> = {
  owoce: { label: 'Owoce', icon: '🍎' }, warzywa: { label: 'Warzywa', icon: '🥕' }, nabial: { label: 'Nabiał', icon: '🥛' },
  pieczywo: { label: 'Pieczywo', icon: '🥖' }, mieso: { label: 'Mięso i wędliny', icon: '🥩' }, mrozonki: { label: 'Mrożonki', icon: '🧊' },
  napoje: { label: 'Napoje', icon: '🥤' }, chemia: { label: 'Chemia i dom', icon: '🧴' }, zwierzeta: { label: 'Dla psa', icon: '🐶' },
  dzieci: { label: 'Dzieci', icon: '👶' }, szkola: { label: 'Szkoła i biuro', icon: '✏️' }, inne: { label: 'Inne', icon: '📦' },
};

const DEFAULT_QUICK_PRODUCTS: QuickProduct[] = [
  { id:'truskawki', title:'Truskawki', category:'owoce', icon:'🍓', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'maliny', title:'Maliny', category:'owoce', icon:'🫐', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'mandarynki', title:'Mandarynki', category:'owoce', icon:'🍊', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'jablka', title:'Jabłka', category:'owoce', icon:'🍎', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'banany', title:'Banany', category:'owoce', icon:'🍌', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'winogrona', title:'Winogrona', category:'owoce', icon:'🍇', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'salata', title:'Sałata', category:'warzywa', icon:'🥬', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'pomidory', title:'Pomidory', category:'warzywa', icon:'🍅', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'ogorki', title:'Ogórki', category:'warzywa', icon:'🥒', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'marchew', title:'Marchew', category:'warzywa', icon:'🥕', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'ziemniaki', title:'Ziemniaki', category:'warzywa', icon:'🥔', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'papryka', title:'Papryka', category:'warzywa', icon:'🫑', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'cebula', title:'Cebula', category:'warzywa', icon:'🧅', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'czosnek', title:'Czosnek', category:'warzywa', icon:'🧄', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'brokul', title:'Brokuł', category:'warzywa', icon:'🥦', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'kalafior', title:'Kalafior', category:'warzywa', icon:'🥦', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'pieczarki', title:'Pieczarki', category:'warzywa', icon:'🍄', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'cukinia', title:'Cukinia', category:'warzywa', icon:'🥒', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'rzodkiewka', title:'Rzodkiewka', category:'warzywa', icon:'🔴', defaultQuantity:'1', defaultUnit:'pęczek' },
  { id:'pietruszka', title:'Pietruszka', category:'warzywa', icon:'🌿', defaultQuantity:'1', defaultUnit:'pęczek' },
  { id:'koper', title:'Koper', category:'warzywa', icon:'🌿', defaultQuantity:'1', defaultUnit:'pęczek' },
  { id:'kukurydza', title:'Kukurydza', category:'warzywa', icon:'🌽', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'mleko', title:'Mleko', category:'nabial', icon:'🥛', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'jajka', title:'Jajka', category:'nabial', icon:'🥚', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'jogurt', title:'Jogurt', category:'nabial', icon:'🥣', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'smietana', title:'Śmietana', category:'nabial', icon:'🥛', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'maslo', title:'Masło', category:'nabial', icon:'🧈', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'ser', title:'Ser', category:'nabial', icon:'🧀', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'chleb', title:'Chleb', category:'pieczywo', icon:'🍞', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'bulki', title:'Bułki', category:'pieczywo', icon:'🥯', defaultQuantity:'4', defaultUnit:'szt.' },
  { id:'tortilla', title:'Tortilla', category:'pieczywo', icon:'🫓', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'wedlina', title:'Wędlina', category:'mieso', icon:'🥓', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'platki', title:'Płatki śniadaniowe', category:'inne', icon:'🥣', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'wojanek-napoj', title:'Wojanek napój', category:'napoje', imageURL:'/wojanek-napoj.png', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'wojanek-mus', title:'Wojanek mus', category:'dzieci', imageURL:'/wojanek-mus.png', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'sok', title:'Sok', category:'napoje', icon:'🧃', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'cola', title:'Napój gazowany', category:'napoje', icon:'🥤', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'woda', title:'Woda', category:'napoje', icon:'💧', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'chipsy', title:'Chipsy', category:'inne', icon:'🥔', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'ciastka', title:'Ciastka', category:'inne', icon:'🍪', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'slodycze', title:'Słodycze', category:'inne', icon:'🍫', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'kawa', title:'Kawa', category:'napoje', icon:'☕', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'herbata', title:'Herbata', category:'napoje', icon:'🍵', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'cukier', title:'Cukier', category:'inne', icon:'🧂', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'sol', title:'Sól', category:'inne', icon:'🧂', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'pieprz', title:'Pieprz', category:'inne', icon:'⚫', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'olej', title:'Olej', category:'inne', icon:'🫗', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'ocet', title:'Ocet', category:'inne', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'makaron', title:'Makaron', category:'inne', icon:'🍝', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'ryz', title:'Ryż', category:'inne', icon:'🍚', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'maka', title:'Mąka', category:'inne', icon:'🌾', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'kasza', title:'Kasza', category:'inne', icon:'🌾', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'ketchup', title:'Ketchup', category:'inne', icon:'🍅', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'majonez', title:'Majonez', category:'inne', icon:'🥫', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'musztarda', title:'Musztarda', category:'inne', icon:'🟡', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'papier', title:'Papier toaletowy', category:'chemia', icon:'🧻', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'reczniki', title:'Ręczniki papierowe', category:'chemia', icon:'🧻', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'worki', title:'Worki na śmieci', category:'chemia', icon:'🗑️', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'plyn-naczynia', title:'Płyn do naczyń', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'tabletki-zmywarka', title:'Tabletki do zmywarki', category:'chemia', icon:'🧊', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'sol-zmywarka', title:'Sól do zmywarki', category:'chemia', icon:'🧂', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'nablyszczacz', title:'Nabłyszczacz do zmywarki', category:'chemia', icon:'✨', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'proszek', title:'Proszek do prania', category:'chemia', icon:'🧺', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'zel-pranie', title:'Żel do prania', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'kapsulki-pranie', title:'Kapsułki do prania', category:'chemia', icon:'🟢', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'chusteczki-pranie', title:'Chusteczki do prania', category:'chemia', imageURL:'/oxy-chusteczki.png', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'plyn-plukanie', title:'Płyn do płukania', category:'chemia', icon:'🌸', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'szampon', title:'Szampon', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'odzywka', title:'Odżywka', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'zel-prysznic', title:'Żel pod prysznic', category:'chemia', icon:'🧼', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'dezodorant', title:'Dezodorant', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'pasta', title:'Pasta do zębów', category:'chemia', icon:'🪥', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'szczoteczka', title:'Szczoteczka do zębów', category:'chemia', icon:'🪥', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'pieluchy', title:'Pieluchy', category:'dzieci', icon:'👶', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'chusteczki-dzieci', title:'Chusteczki dla dzieci', category:'dzieci', icon:'🧻', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'karma-pies', title:'Karma dla psa', category:'zwierzeta', icon:'🐶', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'dlugopis', title:'Długopis', category:'szkola', icon:'🖊️', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'gumka', title:'Gumka', category:'szkola', icon:'🩷', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'zeszyt', title:'Zeszyt', category:'szkola', icon:'📓', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'wodka', title:'Wódka', category:'napoje', icon:'🍾', adultOnly:true, defaultQuantity:'1', defaultUnit:'szt.' },
];

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
    ['warzywa', ['marchew', 'ziemni', 'pomidor', 'ogorek', 'papryk', 'cebula', 'salat', 'brokul', 'kalafior', 'cukini', 'burak', 'kapust', 'koper', 'pietrusz', 'rzodkiew', 'kukurydz', 'czosn', 'pieczark']],
    ['nabial', ['mleko', 'jogurt', 'ser', 'smietan', 'maslo', 'kefir', 'serek']],
    ['pieczywo', ['chleb', 'bulka', 'bagiet', 'kajzer', 'pieczyw', 'tost', 'tortill']],
    ['mieso', ['kurcz', 'mieso', 'szynk', 'kielbas', 'parow', 'boczek', 'wolow', 'wieprz', 'wedlin']],
    ['mrozonki', ['mrozon', 'lody', 'pizza mroz', 'frytki']],
    ['napoje', ['woda', 'sok', 'cola', 'napoj', 'wojanek napoj', 'kawa', 'herbat', 'wodka']],
    ['chemia', ['domestos', 'plyn do', 'proszek', 'kapsulki', 'papier toalet', 'recznik papier', 'mydlo', 'szampon', 'pasta do zeb', 'worki na smieci', 'tabletki do zmywarki', 'sol do zmywarki', 'nablyszczacz', 'chusteczki do prania']],
    ['zwierzeta', ['karma', 'pies', 'przysmak dla psa']],
    ['dzieci', ['pieluch', 'chusteczk dla dzieci', 'bebilon', 'mleko modyfik', 'smoczek', 'wojanek mus']],
    ['szkola', ['dlugopis', 'gumka', 'zeszyt', 'kredk', 'klej', 'teczk', 'olowek', 'pisak']],
  ];
  for (const [category, words] of tests) if (words.some((word) => text.includes(word))) return category;
  return 'inne';
}

function ShoppingPage({ user, member }: { user: User; member: Member | null }) {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [customQuick, setCustomQuick] = useState<QuickProduct[]>([]);
  const [title, setTitle] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('szt.');
  const [categoryChoice, setCategoryChoice] = useState<'auto' | ShoppingCategory>('auto');
  const [quickNote, setQuickNote] = useState('');
  const [quickCategory, setQuickCategory] = useState<ShoppingCategory | 'all'>('all');
  const [quickSort, setQuickSort] = useState<'default' | 'az'>('default');
  const [editingQuick, setEditingQuick] = useState<QuickProduct | null>(null);
  const [quickMenu, setQuickMenu] = useState<QuickProduct | null>(null);
  const [quickForm, setQuickForm] = useState({ title:'', category:'inne' as ShoppingCategory, quantity:'1', unit:'szt.', imageURL:'', icon:'📦' });
  const holdTimer = useRef<number | null>(null);
  const adult = isAdultMember(member);

  useEffect(() => onSnapshot(collection(db, 'shoppingItems'), (snap) => {
    const next = snap.docs.map((d): ShoppingItem => {
      const x = d.data();
      const titleValue = String(x.title || '');
      return { id: d.id, title: titleValue, done: x.done === true, category: isShoppingCategory(x.category) ? x.category : categorizeProduct(titleValue), quantity: typeof x.quantity === 'string' ? x.quantity : '', unit: typeof x.unit === 'string' ? x.unit : '', createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    });
    next.sort((a, b) => Number(a.done) - Number(b.done) || (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
    setItems(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'quickProducts'), (snap) => {
    setCustomQuick(snap.docs.map((d) => {
      const x = d.data();
      return { id:d.id, title:String(x.title || 'Produkt'), category:isShoppingCategory(x.category) ? x.category : 'inne', icon:typeof x.icon === 'string' ? x.icon : undefined, imageURL:typeof x.imageURL === 'string' ? x.imageURL : undefined, adultOnly:typeof x.adultOnly === 'boolean' ? x.adultOnly : undefined, defaultQuantity:String(x.defaultQuantity || '1'), defaultUnit:String(x.defaultUnit || 'szt.'), custom:x.custom === true, hidden:x.hidden === true };
    }));
  }), []);

  const quickProducts = useMemo(() => {
    const overrides = new Map(customQuick.map((x) => [x.id, x]));
    const merged = DEFAULT_QUICK_PRODUCTS.map((base) => overrides.has(base.id) ? { ...base, ...overrides.get(base.id) } as QuickProduct : base);
    for (const custom of customQuick) if (!DEFAULT_QUICK_PRODUCTS.some((b) => b.id === custom.id)) merged.push(custom);
    const filtered = merged.filter((p) => !p.hidden && (!p.adultOnly || adult) && (quickCategory === 'all' || p.category === quickCategory));
    if (quickSort === 'az') return [...filtered].sort((a, b) => a.title.localeCompare(b.title, 'pl'));
    return filtered;
  }, [customQuick, adult, quickCategory, quickSort]);

  async function addItem(productTitle: string, qty = '1', productUnit = 'szt.', category?: ShoppingCategory) {
    const clean = productTitle.trim(); if (!clean) return;
    await addDoc(collection(db, 'shoppingItems'), { title: clean, done: false, category: category || categorizeProduct(clean), quantity: qty, unit: productUnit, createdBy: user.uid, createdAt: Timestamp.now() });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim()) return;
    await addItem(title, quantity.trim(), unit, categoryChoice === 'auto' ? categorizeProduct(title) : categoryChoice);
    setTitle(''); setQuantity('1'); setUnit('szt.'); setCategoryChoice('auto');
  }

  async function addQuick(product: QuickProduct) {
    await addItem(product.title, product.defaultQuantity, product.defaultUnit, product.category);
  }

  function parseNote(value: string) {
    const trimmed = value.trim(); if (!trimmed) return [] as string[];
    if (/[\n,;]/.test(trimmed)) return trimmed.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    const known = quickProducts.map((p) => p.title).sort((a,b) => b.length-a.length);
    let work = ` ${trimmed} `;
    const result: string[] = [];
    for (const title of known) {
      const rx = new RegExp(`(^|\\s)${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
      if (rx.test(work.trim())) { result.push(title); work = work.replace(rx, ' '); }
    }
    result.push(...work.trim().split(/\s+/).filter(Boolean));
    return result;
  }

  async function addQuickNote() {
    const products = parseNote(quickNote);
    if (!products.length) return;
    for (const product of products) await addItem(product, '1', 'szt.', categorizeProduct(product));
    setQuickNote('');
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

  function startHold(product: QuickProduct) {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setQuickMenu(product), 550);
  }
  function cancelHold() { if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = null; }

  function openQuickEditor(product?: QuickProduct) {
    const item = product || { id:`custom-${Date.now()}`, title:'', category:'inne' as ShoppingCategory, icon:'📦', defaultQuantity:'1', defaultUnit:'szt.', custom:true };
    setEditingQuick(item);
    setQuickForm({ title:item.title, category:item.category, quantity:item.defaultQuantity, unit:item.defaultUnit, imageURL:item.imageURL || '', icon:item.icon || '📦' });
    setQuickMenu(null);
  }

  async function normalizeQuickImage(file: File) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Nie można odczytać zdjęcia.'));
        element.src = objectUrl;
      });
      const size = 900;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Brak obsługi obrazu.');
      const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
      const width = img.naturalWidth * scale;
      const height = img.naturalHeight * scale;
      const x = (size - width) / 2;
      const y = (size - height) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, x, y, width, height);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Nie udało się przygotować zdjęcia.')), 'image/jpeg', 0.9));
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function uploadQuickImage(file: File) {
    const normalized = await normalizeQuickImage(file);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/\.[^.]+$/, '') || 'produkt';
    const target = storageRef(storage, `quick-products/${user.uid}/${Date.now()}-${safeName}.jpg`);
    await uploadBytes(target, normalized, { contentType: 'image/jpeg' });
    const url = await getDownloadURL(target);
    setQuickForm((f) => ({ ...f, imageURL:url }));
  }

  async function saveQuick(e: React.FormEvent) {
    e.preventDefault(); if (!editingQuick || !quickForm.title.trim()) return;
    await setDoc(doc(db, 'quickProducts', editingQuick.id), { title:quickForm.title.trim(), category:quickForm.category, defaultQuantity:quickForm.quantity || '1', defaultUnit:quickForm.unit || 'szt.', imageURL:quickForm.imageURL, icon:quickForm.icon || '📦', adultOnly:editingQuick.adultOnly === true, custom:editingQuick.custom === true || !DEFAULT_QUICK_PRODUCTS.some((p) => p.id === editingQuick.id), hidden:false, updatedAt:Timestamp.now() }, { merge:true });
    setEditingQuick(null);
  }

  async function removeQuick(product: QuickProduct) {
    if (!window.confirm(`Usunąć kafelek „${product.title}” z szybkich zakupów?`)) return;
    if (DEFAULT_QUICK_PRODUCTS.some((p) => p.id === product.id)) {
      await setDoc(doc(db, 'quickProducts', product.id), { hidden:true, updatedAt:Timestamp.now() }, { merge:true });
    } else {
      await deleteDoc(doc(db, 'quickProducts', product.id));
    }
    setQuickMenu(null);
  }

  return (
    <div className="page-content compact-page shopping-v130">
      <section className="shopping-hero">
        <div className="shopping-hero-icon">🛒</div>
        <div className="shopping-hero-copy"><small>Nasza Rodzina</small><h1>Zakupy</h1><p>Szybkie kafelki, notatka wielu produktów i jedna wspólna lista.</p></div>
        <div className="shopping-hero-basket" aria-hidden="true">🧺</div>
        {items.some((i) => i.done) ? <button className="secondary-button shopping-clear-button" onClick={clearDone}>🧹 Usuń kupione</button> : null}
      </section>

      <form className="shopping-bar" onSubmit={add}>
        <input className="shopping-product" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Np. jabłka, mleko, bułki…" />
        <input className="shopping-quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Ilość" />
        <select value={unit} onChange={(e) => setUnit(e.target.value)}><option>szt.</option><option>kg</option><option>g</option><option>l</option><option>ml</option><option>opak.</option><option>pęczek</option></select>
        <select value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value as 'auto' | ShoppingCategory)}><option value="auto">✨ Kategoria auto</option>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((category) => <option key={category} value={category}>{SHOPPING_META[category].icon} {SHOPPING_META[category].label}</option>)}</select>
        <button className="primary-button">＋ Dodaj</button>
      </form>

      <section className="quick-note-card"><header><strong>📝 Szybka notatka zakupowa</strong><small>Wpisz kilka rzeczy naraz — rozdzielimy je i dodamy do jednej listy.</small></header><div><textarea rows={2} value={quickNote} onChange={(e) => setQuickNote(e.target.value)} placeholder="Np. długopis, gumka, zeszyt, lampka, zegarek…" /><button className="primary-button" onClick={() => void addQuickNote()}>✨ Dodaj wszystkie</button></div></section>

      <div className="shopping-category-chips"><button className={quickCategory === 'all' ? 'active' : ''} onClick={() => setQuickCategory('all')}>▦ Wszystkie</button>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((cat) => <button key={cat} className={quickCategory === cat ? 'active' : ''} onClick={() => setQuickCategory(cat)}>{SHOPPING_META[cat].icon} {SHOPPING_META[cat].label}</button>)}</div>

      <section className="quick-products-card">
        <header>
          <div><strong>⭐ Szybkie zakupy</strong><small>Długie przytrzymanie: zmień zdjęcie lub edytuj produkt.</small></div>
          <div className="quick-products-tools">
            <select aria-label="Sortowanie szybkich zakupów" value={quickSort} onChange={(e) => setQuickSort(e.target.value as 'default' | 'az')}><option value="default">Sortuj: Najczęściej</option><option value="az">Sortuj: A–Z</option></select>
            <button className="quick-view-button active" type="button" aria-label="Widok kafelków">▦</button>
            <button className="quick-custom-button" type="button" onClick={() => openQuickEditor()}>＋ Własny produkt</button>
          </div>
        </header>
        <div className="quick-products-grid">{quickProducts.map((product) => <button key={product.id} className={`quick-product-tile category-${product.category}`} onClick={() => void addQuick(product)} onPointerDown={() => startHold(product)} onPointerUp={cancelHold} onPointerCancel={cancelHold} onContextMenu={(e) => { e.preventDefault(); setQuickMenu(product); }}><span className="quick-product-visual">{product.imageURL ? <img src={product.imageURL} alt={product.title} /> : <span className="quick-product-emoji">{product.icon}</span>}</span><strong className="quick-product-title">{product.title}</strong><span className="quick-product-plus" aria-hidden="true">＋</span>{product.adultOnly && <em>18+</em>}<i onClick={(e) => { e.stopPropagation(); setQuickMenu(product); }}>⋯</i></button>)}</div>
      </section>

      <section className="shopping-list-title"><div><strong>🛒 Lista zakupów</strong><small>{items.filter((i) => !i.done).length} do kupienia</small></div></section>
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

      {quickMenu && <div className="quick-product-menu-backdrop" onClick={() => setQuickMenu(null)}><div className="quick-product-menu" onClick={(e) => e.stopPropagation()}><strong>{quickMenu.title}</strong><button onClick={() => openQuickEditor(quickMenu)}>🖼️ Zmień ikonkę / Edytuj</button><button className="danger" onClick={() => void removeQuick(quickMenu)}>🗑️ Usuń</button><button onClick={() => setQuickMenu(null)}>Anuluj</button></div></div>}

      {editingQuick && <Modal title={editingQuick.custom ? '➕ Własny produkt' : `🖼️ ${editingQuick.title}`} onClose={() => setEditingQuick(null)}>
        <form className="form-grid" onSubmit={saveQuick}>
          <label className="field field-wide"><span>Nazwa</span><input value={quickForm.title} onChange={(e) => setQuickForm((f) => ({ ...f, title:e.target.value }))} required /></label>
          <label className="field"><span>Kategoria</span><select value={quickForm.category} onChange={(e) => setQuickForm((f) => ({ ...f, category:e.target.value as ShoppingCategory }))}>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((cat) => <option key={cat} value={cat}>{SHOPPING_META[cat].label}</option>)}</select></label>
          <label className="field"><span>Emoji awaryjne</span><input value={quickForm.icon} onChange={(e) => setQuickForm((f) => ({ ...f, icon:e.target.value }))} /></label>
          <label className="field"><span>Domyślna ilość</span><input value={quickForm.quantity} onChange={(e) => setQuickForm((f) => ({ ...f, quantity:e.target.value }))} /></label>
          <label className="field"><span>Jednostka</span><select value={quickForm.unit} onChange={(e) => setQuickForm((f) => ({ ...f, unit:e.target.value }))}><option>szt.</option><option>kg</option><option>g</option><option>l</option><option>ml</option><option>opak.</option><option>pęczek</option></select></label>
          <label className="field field-wide"><span>Własne zdjęcie / ikonka</span><small className="image-normalize-hint">Zdjęcie zostanie automatycznie wykadrowane do kwadratu i dopasowane do wszystkich kafelków.</small><input type="file" accept="image/*" onChange={(e) => { const file=e.target.files?.[0]; if (file) void uploadQuickImage(file).catch(() => alert('Nie udało się wysłać zdjęcia. Sprawdź Firebase Storage.')); }} />{quickForm.imageURL && <img className="quick-image-preview" src={quickForm.imageURL} alt="Podgląd" />}</label>
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={() => setEditingQuick(null)}>Anuluj</button><button className="primary-button">✓ Zapisz</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* =========================================================
   CHAT
   ========================================================= */

function privateChannel(a: string, b: string) {
  return `private:${[a, b].sort().join(':')}`;
}

function ChatPage({ user, member }: { user: User; member: Member | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<FamilyMemberDoc[]>([]);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'family' | 'private'>('family');
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [messageMenu, setMessageMenu] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [search, setSearch] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => onSnapshot(collection(db, 'members'), (snap) => {
    const next = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        name: String(x.name || 'Rodzina'),
        role: personRole(String(x.name || ''), typeof x.role === 'string' ? x.role : ''),
        photoURL: typeof x.photoURL === 'string' ? x.photoURL : undefined,
        active: x.active !== false,
      };
    }).sort((a, b) => FAMILY_ORDER.indexOf(a.name) - FAMILY_ORDER.indexOf(b.name));
    setMembers(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'familyMessages'), (snap) => {
    const loaded = snap.docs.map((d): ChatMessage => {
      const x = d.data();
      return {
        id: d.id,
        text: String(x.text || ''),
        name: String(x.name || 'Rodzina'),
        uid: String(x.uid || ''),
        channel: typeof x.channel === 'string' ? x.channel : 'family',
        createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
      };
    }).sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
    setMessages(loaded.slice(-400));
  }), []);

  const channel = mode === 'family' ? 'family' : selectedUid ? privateChannel(user.uid, selectedUid) : '';
  const visible = messages.filter((m) => m.channel === channel);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [visible.length, channel]);

  const selectedMember = members.find((m) => m.id === selectedUid);
  const privateMembers = members.filter((m) => m.id !== user.uid && m.name.toLowerCase().includes(search.trim().toLowerCase()));

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !channel) return;
    const body = replyTo ? `↩ ${replyTo.name}: ${replyTo.text.slice(0, 60)}\n${text.trim()}` : text.trim();
    await addDoc(collection(db, 'familyMessages'), {
      text: body,
      name: member?.name || 'Rodzina',
      uid: user.uid,
      channel,
      createdAt: Timestamp.now(),
    });
    setText('');
    setReplyTo(null);
  }

  async function removeMessage(message: ChatMessage) {
    if (message.uid !== user.uid && !isParent(member)) return;
    await deleteDoc(doc(db, 'familyMessages', message.id));
    setMessageMenu(null);
  }

  const lastForChannel = (uid: string) => {
    const ch = privateChannel(user.uid, uid);
    return [...messages].reverse().find((m) => m.channel === ch);
  };

  const lastFamily = [...messages].reverse().find((m) => m.channel === 'family');

  function openFamily() {
    setMode('family');
    setSelectedUid('');
  }

  function openPrivate(uid?: string) {
    setMode('private');
    if (uid) setSelectedUid(uid);
  }

  return (
    <div className="page-content compact-page chat-page chat-v134">
      <section className="chat-page-heading">
        <div><small>Rodzinne centrum</small><h1>💬 Czat</h1><p>Rozmowy z całą rodziną i prywatne wiadomości 1:1.</p></div>
      </section>

      <section className="chat-mode-tabs-v134" aria-label="Tryb rozmowy">
        <button className={mode === 'family' ? 'active' : ''} onClick={openFamily}>👥 Rodzina</button>
        <button className={mode === 'private' ? 'active' : ''} onClick={() => openPrivate()}>👤 Prywatne</button>
      </section>

      <section className="chat-layout-v134">
        <aside className="chat-conversations-v134">
          <div className="chat-search-v134"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Szukaj rozmów…" /></div>

          <button className={`conversation-row-v134 ${mode === 'family' ? 'active' : ''}`} onClick={openFamily}>
            <span className="conversation-group-avatar-v134">👨‍👩‍👧‍👦</span>
            <div><strong>Czat rodzinny</strong><small>{lastFamily?.text || 'Wspólna rozmowa całej rodziny'}</small></div>
            <time>{lastFamily?.createdAt ? formatTime(lastFamily.createdAt) : ''}</time>
          </button>

          <div className="private-conversation-list-v134">
            {privateMembers.map((person) => {
              const last = lastForChannel(person.id);
              return (
                <button key={person.id} className={`conversation-row-v134 ${mode === 'private' && selectedUid === person.id ? 'active' : ''}`} onClick={() => openPrivate(person.id)}>
                  <span className="chat-avatar-v134">{person.photoURL ? <img src={person.photoURL} alt="" /> : memberEmoji(person.name)}</span>
                  <div><strong>{person.name}</strong><small>{last ? last.text : 'Rozpocznij rozmowę'}</small></div>
                  <time>{last?.createdAt ? formatTime(last.createdAt) : ''}</time>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="chat-shell-v134">
          <header className="chat-room-header-v134">
            <span className="chat-avatar-v134 large">{mode === 'family' ? '👨‍👩‍👧‍👦' : selectedMember?.photoURL ? <img src={selectedMember.photoURL} alt="" /> : selectedMember ? memberEmoji(selectedMember.name) : '💬'}</span>
            <div>
              <strong>{mode === 'family' ? 'Czat rodzinny' : selectedMember?.name || 'Wybierz osobę'}</strong>
              <small>{mode === 'family' ? `${members.length || 5} uczestników` : selectedMember ? 'Prywatna rozmowa 1:1' : 'Wybierz członka rodziny z listy'}</small>
            </div>
          </header>

          <div className="chat-messages-v134">
            {!channel ? <EmptyState icon="👤" text="Wybierz osobę z listy prywatnych rozmów." /> : visible.length === 0 ? <EmptyState icon="💬" text="Napisz pierwszą wiadomość." /> : visible.map((message, index) => {
              const previous = visible[index - 1];
              const showIdentity = !previous || previous.uid !== message.uid;
              const person = members.find((m) => m.id === message.uid);
              return (
                <div key={message.id} className={`chat-message-line-v134 ${message.uid === user.uid ? 'mine' : ''}`}>
                  {message.uid !== user.uid && <span className={`chat-avatar-v134 message-avatar ${showIdentity ? '' : 'ghost'}`}>{showIdentity ? (person?.photoURL ? <img src={person.photoURL} alt="" /> : memberEmoji(message.name)) : ''}</span>}
                  <div className={`chat-bubble-v134 ${message.uid === user.uid ? 'mine' : ''}`}>
                    {showIdentity && message.uid !== user.uid && <strong>{message.name}</strong>}
                    <p>{message.text}</p>
                    <small>{message.createdAt ? formatTime(message.createdAt) : ''}{message.uid === user.uid ? '  ✓✓' : ''}</small>
                    <button className="message-more-v134" type="button" aria-label="Opcje wiadomości" onClick={() => setMessageMenu(message)}>⋯</button>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {replyTo && <div className="reply-banner-v134"><span>Odpowiadasz: <strong>{replyTo.name}</strong> — {replyTo.text.slice(0, 80)}</span><button onClick={() => setReplyTo(null)}>✕</button></div>}

          <form className="chat-compose-v134" onSubmit={send}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={channel ? 'Napisz wiadomość…' : 'Najpierw wybierz rozmowę'} disabled={!channel} />
            <button className="chat-send-v134" disabled={!channel || !text.trim()}>Wyślij</button>
          </form>
        </section>
      </section>

      {messageMenu && <div className="chat-menu-backdrop-v134" onClick={() => setMessageMenu(null)}>
        <div className="message-menu-v134" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setReplyTo(messageMenu); setMessageMenu(null); }}>↩ Odpowiedz</button>
          <button onClick={() => { void navigator.clipboard?.writeText(messageMenu.text); setMessageMenu(null); }}>📋 Kopiuj</button>
          {(messageMenu.uid === user.uid || isParent(member)) && <button className="danger" onClick={() => void removeMessage(messageMenu)}>🗑️ Usuń</button>}
        </div>
      </div>}
    </div>
  );
}

/* =========================================================
   HEALTH
   ========================================================= */

const HEALTH_META: Record<HealthType, { label: string; icon: string }> = {
  visit: { label: 'Wizyta', icon: '🩺' }, doctor: { label: 'Lekarz / placówka', icon: '👨‍⚕️' }, medicine: { label: 'Lek', icon: '💊' }, result: { label: 'Wynik', icon: '📄' }, history: { label: 'Historia', icon: '🕘' }, document: { label: 'Dokument', icon: '📁' },
};
const SPECIALTIES = ['Neurologia', 'Okulistyka', 'Urologia', 'Immunologia', 'Logopedia', 'Stomatologia', 'Pediatria', 'Inne'];

function isHealthType(value: unknown): value is HealthType { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HEALTH_META, value); }
function isHealthStatus(value: unknown): value is HealthStatus { return value === 'planned' || value === 'toBook' || value === 'booked' || value === 'done' || value === 'cancelled'; }

function HealthPage({ user, member }: { user: User; member: Member | null }) {
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [contacts, setContacts] = useState<MedicalContact[]>([]);
  const [members, setMembers] = useState<FamilyMemberDoc[]>([]);
  const [intakes, setIntakes] = useState<MedicationIntake[]>([]);
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const parent = isParent(member);
  const healthAccess = effectiveMemberPermissions(member);
  const ownPerson = isPersonKey(member?.name) ? member!.name as PersonKey : 'family';
  const [person, setPerson] = useState<PersonKey>(() => parent ? (ownPerson === 'family' ? 'Sebastian' : ownPerson) : ownPerson);
  const [healthTab, setHealthTab] = useState<'summary' | 'visits' | 'meds' | 'results' | 'documents' | 'contacts' | 'notes'>('summary');
  const [specialtyFilter, setSpecialtyFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => typeof Notification === 'undefined' ? 'denied' : Notification.permission);

  const emptyForm = (): HealthForm => ({
    title: '', person: person === 'family' ? (parent ? 'Paweł' : ownPerson) : person, type: 'visit', date: formatDateInput(new Date()), time: '12:00',
    doctor: '', location: '', note: '', specialty: '', status: 'planned', referralCode: '', nextControl: '', callReminderDate: '',
    privateToParents: false, sharedWithPerson: false, blocksSchoolDay: false, dose: '', medicineTime: '08:00', medicineTimes: ['08:00', '20:00'], escalationMinutes: 15,
    addToCalendar: true, file: null,
  });
  const [form, setForm] = useState<HealthForm>(emptyForm);
  const [contactForm, setContactForm] = useState({ person:'family' as PersonKey, specialty:'', name:'', doctor:'', phone:'', address:'', note:'' });

  useEffect(() => onSnapshot(collection(db, 'members'), (snap) => {
    const next = snap.docs.map((d) => {
      const x=d.data();
      return {
        id:d.id, name:String(x.name || 'Rodzina'), role:personRole(String(x.name || ''), typeof x.role === 'string' ? x.role : ''),
        photoURL:typeof x.photoURL === 'string' ? x.photoURL : undefined, active:x.active !== false,
        birthDate:typeof x.birthDate === 'string' ? x.birthDate : FAMILY_BIRTHDAYS[String(x.name || '') as PersonKey],
      } as FamilyMemberDoc;
    }).sort((a,b)=>FAMILY_ORDER.indexOf(a.name)-FAMILY_ORDER.indexOf(b.name));
    setMembers(next);
    if (!parent && ownPerson !== 'family') setPerson(ownPerson);
  }), [parent, ownPerson]);

  useEffect(() => onSnapshot(collection(db, 'healthRecords'), (snap) => {
    const next = snap.docs.map((d): HealthRecord => {
      const x = d.data();
      const legacyTime = typeof x.medicineTime === 'string' ? x.medicineTime : (typeof x.time === 'string' ? x.time : '');
      const rawTimes = Array.isArray(x.medicineTimes) ? x.medicineTimes.filter((v: unknown) => typeof v === 'string') : [];
      return {
        id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'family', type:isHealthType(x.type) ? x.type : 'history',
        date:typeof x.date === 'string' ? x.date : '', time:typeof x.time === 'string' ? x.time : '', doctor:typeof x.doctor === 'string' ? x.doctor : '',
        location:typeof x.location === 'string' ? x.location : '', note:typeof x.note === 'string' ? x.note : '', specialty:typeof x.specialty === 'string' ? x.specialty : '',
        status:isHealthStatus(x.status) ? x.status : (x.type === 'visit' ? 'planned' : 'done'), referralCode:typeof x.referralCode === 'string' ? x.referralCode : '',
        nextControl:typeof x.nextControl === 'string' ? x.nextControl : '', callReminderDate:typeof x.callReminderDate === 'string' ? x.callReminderDate : '',
        documentURL:typeof x.documentURL === 'string' ? x.documentURL : '', privateToParents:x.privateToParents === true, sharedWithPerson:x.sharedWithPerson === true, blocksSchoolDay:x.blocksSchoolDay === true,
        dose:typeof x.dose === 'string' ? x.dose : '', medicineTime:legacyTime, medicineTimes:rawTimes.length ? rawTimes : (legacyTime ? [legacyTime] : []),
        escalationMinutes:Number.isFinite(Number(x.escalationMinutes)) ? Math.max(1, Number(x.escalationMinutes)) : 15,
        confirmedDate:typeof x.confirmedDate === 'string' ? x.confirmedDate : '', createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
      };
    });
    next.sort((a,b)=>(b.date || '').localeCompare(a.date || '') || (b.createdAt?.getTime() || 0)-(a.createdAt?.getTime() || 0));
    setRecords(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'medicalContacts'), (snap) => {
    setContacts(snap.docs.map((d) => { const x=d.data(); return { id:d.id, person:isPersonKey(x.person) ? x.person : 'family', specialty:String(x.specialty || ''), name:String(x.name || ''), doctor:String(x.doctor || ''), phone:String(x.phone || ''), address:String(x.address || ''), note:String(x.note || '') }; }));
  }), []);

  useEffect(() => onSnapshot(collection(db, 'healthMedicationIntakes'), (snap) => {
    setIntakes(snap.docs.map((d): MedicationIntake => {
      const x=d.data();
      return { id:d.id, recordId:String(x.recordId || ''), person:isPersonKey(x.person) ? x.person : 'family', date:String(x.date || ''), time:String(x.time || ''), confirmedBy:String(x.confirmedBy || ''), confirmedAt:x.confirmedAt instanceof Timestamp ? x.confirmedAt.toDate() : undefined };
    }));
  }), []);

  useEffect(() => onSnapshot(collection(db, 'healthAlerts'), (snap) => {
    setAlerts(snap.docs.map((d): HealthAlert => {
      const x=d.data();
      return { id:d.id, recordId:String(x.recordId || ''), person:isPersonKey(x.person) ? x.person : 'family', date:String(x.date || ''), time:String(x.time || ''), title:String(x.title || ''), dose:String(x.dose || ''), status:x.status === 'acknowledged' || x.status === 'resolved' ? x.status : 'open', createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    }));
  }), []);

  const allowedRecords = records.filter((r) => {
    if (r.privateToParents) {
      if (parent) return true;
      return r.person === ownPerson && r.sharedWithPerson;
    }
    if (parent || healthAccess.viewFamilyHealth) return true;
    return r.person === ownPerson || r.person === 'family';
  });
  const selectableMembers = (parent || healthAccess.viewFamilyHealth) ? members : members.filter((m) => m.name === ownPerson);
  const personRecords = allowedRecords.filter((r) => person === 'family' || r.person === person);
  const visibleRecords = personRecords.filter((r) => specialtyFilter === 'all' || r.specialty === specialtyFilter);
  const today = formatDateInput(new Date());
  const upcomingVisits = personRecords.filter((r) => r.type === 'visit' && r.date && r.date >= today && r.status !== 'cancelled').sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
  const medicines = personRecords.filter((r) => r.type === 'medicine');
  const results = visibleRecords.filter((r) => r.type === 'result').sort((a,b)=>(b.date || '').localeCompare(a.date || ''));
  const history = visibleRecords.filter((r) => r.type === 'visit' || r.type === 'history' || r.type === 'result').sort((a,b)=>(b.date || '').localeCompare(a.date || '')).slice(0,10);
  const documents = personRecords.filter((r) => r.type === 'document' || r.type === 'result').slice(0,12);
  const controlItems = personRecords.filter((r) => r.nextControl || r.callReminderDate).slice(0,6);
  const visibleContacts = contacts.filter((c) => c.person === 'family' || person === 'family' || c.person === person).slice(0,8);
  const importantDocs = personRecords.filter((r) => r.type === 'document' && r.privateToParents).slice(0,6);
  const activeAlerts = alerts.filter((a) => a.status !== 'resolved' && a.date === today && (person === 'family' || a.person === person));

  function intakeId(recordId: string, date: string, time: string) { return `${recordId}_${date}_${time.replace(':','')}`; }
  function isDoseConfirmed(recordId: string, time: string, date = today) { return intakes.some((i) => i.recordId === recordId && i.date === date && i.time === time); }
  function medicineTimes(record: HealthRecord) { return record.medicineTimes.length ? record.medicineTimes : (record.medicineTime ? [record.medicineTime] : []); }

  async function requestNotifications() {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotificationPermission(result);
  }

  useEffect(() => {
    const check = async () => {
      const now = new Date();
      const currentDate = formatDateInput(now);
      for (const r of records.filter((x) => x.type === 'medicine')) {
        const times = medicineTimes(r);
        for (const time of times) {
          if (isDoseConfirmed(r.id, time, currentDate)) continue;
          const due = parseLocalDate(currentDate, time);
          const minutes = (now.getTime() - due.getTime()) / 60000;
          const selfKey = `nr-med-${r.id}-${currentDate}-${time}-self`;
          if (member?.name === r.person && minutes >= 0 && minutes < 10 && notificationPermission === 'granted' && !localStorage.getItem(selfKey)) {
            new Notification('Czas na lek', { body: `${r.title}${r.dose ? ` · ${r.dose}` : ''} · ${time}` });
            localStorage.setItem(selfKey, '1');
          }
          if (minutes >= r.escalationMinutes && minutes < 24 * 60) {
            const alertId = intakeId(r.id, currentDate, time);
            const existingAlert = alerts.find((a) => a.id === alertId);
            if (!existingAlert) {
              const alertRef = doc(db, 'healthAlerts', alertId);
              await setDoc(alertRef, { recordId:r.id, person:r.person, date:currentDate, time, title:r.title, dose:r.dose, status:'open', createdAt:Timestamp.now() }, { merge:true });
            }
          }
        }
      }
    };
    void check();
    const timer=window.setInterval(() => void check(),60000);
    return()=>window.clearInterval(timer);
  }, [records, intakes, alerts, member?.name, notificationPermission]);

  useEffect(() => {
    if (!parent || notificationPermission !== 'granted') return;
    alerts.filter((a) => a.status === 'open' && a.date === today).forEach((a) => {
      const key=`nr-parent-alert-${a.id}`;
      if (!localStorage.getItem(key)) {
        new Notification(`Brak potwierdzenia leku — ${a.person}`, { body:`${a.title}${a.dose ? ` · ${a.dose}` : ''} · plan ${a.time}` });
        localStorage.setItem(key,'1');
      }
    });
  }, [alerts, parent, notificationPermission, today]);

  function openAdd(type: HealthType = 'visit') {
    const base=emptyForm();
    const selectedPerson = person === 'family' ? (parent ? 'Paweł' : ownPerson) : person;
    setForm({ ...base, type, person:selectedPerson, privateToParents:type === 'document' && selectedPerson === 'Paweł', medicineTimes:type === 'medicine' ? ['08:00','20:00'] : base.medicineTimes });
    setShowForm(true);
  }

  async function uploadHealthFile(file: File, recordPerson: PersonKey) {
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'-');
    const target=storageRef(storage, `health/${recordPerson}/${Date.now()}-${safe}`);
    await uploadBytes(target,file); return getDownloadURL(target);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    let documentURL='';
    if (form.file) {
      try { documentURL=await uploadHealthFile(form.file,form.person); }
      catch { alert('Nie udało się wysłać pliku. Włącz Firebase Storage i sprawdź reguły.'); return; }
    }
    const { addToCalendar, file, ...record }=form;
    const cleanTimes = form.type === 'medicine' ? Array.from(new Set(form.medicineTimes.filter(Boolean))).sort() : [];
    await addDoc(collection(db,'healthRecords'), { ...record, medicineTimes:cleanTimes, medicineTime:cleanTimes[0] || form.medicineTime || '', title:form.title.trim(), documentURL, confirmedDate:'', createdBy:user.uid, createdAt:Timestamp.now() });
    if (addToCalendar && form.type === 'visit' && form.date) {
      const start=parseLocalDate(form.date,form.time || '12:00'); const end=new Date(start.getTime()+3600000);
      await addDoc(collection(db,'calendarEvents'), { title:`❤️ ${form.title.trim()}`, person:form.person, date:Timestamp.fromDate(start), endDate:Timestamp.fromDate(end), allDay:false, description:[form.specialty,form.doctor,form.location,form.referralCode ? `Kod skierowania: ${form.referralCode}` : ''].filter(Boolean).join(' · '), repeat:'none', repeatUntil:null, createdBy:user.uid, createdAt:Timestamp.now() });
    }
    setShowForm(false);
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault(); if (!contactForm.name.trim()) return;
    await addDoc(collection(db,'medicalContacts'), { ...contactForm, createdBy:user.uid, createdAt:Timestamp.now() }); setShowContactForm(false);
  }

  async function confirmMedicine(record: HealthRecord, time: string) {
    const id=intakeId(record.id,today,time);
    await setDoc(doc(db,'healthMedicationIntakes',id), { recordId:record.id, person:record.person, date:today, time, confirmedBy:user.uid, confirmedAt:Timestamp.now() }, { merge:true });
    await updateDoc(doc(db,'healthRecords',record.id), { confirmedDate:today, updatedAt:Timestamp.now() });
    await setDoc(doc(db,'healthAlerts',id), { recordId:record.id, person:record.person, date:today, time, title:record.title, dose:record.dose, status:'resolved', resolvedAt:Timestamp.now() }, { merge:true });
  }

  async function acknowledgeAlert(alert: HealthAlert) {
    await updateDoc(doc(db,'healthAlerts',alert.id), { status:'acknowledged', acknowledgedBy:user.uid, acknowledgedAt:Timestamp.now() });
  }

  async function toggleDocumentShare(record: HealthRecord) {
    if (!parent) return;
    await updateDoc(doc(db,'healthRecords',record.id), { sharedWithPerson:!record.sharedWithPerson, updatedAt:Timestamp.now() });
  }

  const selectedMember = members.find((m) => m.name === person);
  const tabItems: Array<[typeof healthTab, string, string]> = [
    ['summary','⌂','Podsumowanie'], ['visits','🩺','Wizyty'], ['meds','💊','Leki'], ['results','🧪','Wyniki'], ['documents','📄','Dokumenty'], ['contacts','☎','Kontakty'], ['notes','✎','Notatki'],
  ];

  const recordList = (type: HealthType | 'notes') => {
    const list = type === 'notes' ? personRecords.filter((r)=>!!r.note) : personRecords.filter((r)=>r.type === type);
    if (!list.length) return <p className="health-empty">Brak wpisów w tej sekcji.</p>;
    return <div className="health-generic-list">{list.map((r)=><article key={r.id}><span className="health-icon-tile">{type === 'notes' ? '✎' : HEALTH_META[r.type].icon}</span><div><strong>{r.title}</strong><small>{[r.date ? formatShortDate(r.date) : '', r.doctor, r.location, r.note].filter(Boolean).join(' · ')}</small></div>{r.documentURL && <a href={r.documentURL} target="_blank" rel="noreferrer">Otwórz</a>}</article>)}</div>;
  };

  return (
    <div className="page-content compact-page health-versa-page">
      <section className="health-title-row">
        <div><small>Rodzinne centrum</small><h1><span>❤️</span> Zdrowie</h1><p>Wizyty, leki, wyniki, dokumenty i kontakty całej rodziny.</p></div>
        <div className="health-title-actions">
          {notificationPermission !== 'granted' && <button className="secondary-button" onClick={() => void requestNotifications()}>🔔 Włącz powiadomienia</button>}
          <button className="primary-button health-add-button" onClick={() => openAdd('visit')}>＋ Dodaj wizytę / wpis</button>
        </div>
      </section>

      {parent && activeAlerts.length > 0 && <section className="health-alert-strip">
        <div><strong>🚨 Brak potwierdzenia leku</strong><small>{activeAlerts.length} {activeAlerts.length === 1 ? 'powiadomienie wymaga' : 'powiadomienia wymagają'} uwagi rodzica.</small></div>
        <div className="health-alert-list">{activeAlerts.slice(0,3).map((a)=><button key={a.id} onClick={() => void acknowledgeAlert(a)}><span>{a.person}</span><strong>{a.title}</strong><em>{a.time}</em></button>)}</div>
      </section>}

      <section className="health-family-cards">
        {selectableMembers.map((m) => <button key={m.id} className={person === m.name ? 'active' : ''} onClick={() => { setPerson(m.name as PersonKey); setHealthTab('summary'); }}>
          <span className="health-family-photo">{m.photoURL ? <img src={m.photoURL} alt="" /> : memberEmoji(m.name)}</span>
          <div><strong>{m.name}</strong><small>{personRole(m.name,m.role)}</small></div><em>›</em>
        </button>)}
      </section>

      {parent && <div className="health-family-all-row"><button className={person === 'family' ? 'active' : ''} onClick={()=>{setPerson('family');setHealthTab('summary');}}>👨‍👩‍👧‍👦 Cała rodzina</button></div>}

      {person !== 'family' && <section className="health-profile-bar-versa">
        <span className="health-profile-avatar-versa">{selectedMember?.photoURL ? <img src={selectedMember.photoURL} alt="" /> : memberEmoji(person)}</span>
        <div><h2>{person}</h2><p>{personRole(person, selectedMember?.role)} · kartoteka zdrowia</p></div>
      </section>}

      <nav className="health-tabs-versa">
        {tabItems.map(([key,icon,label])=><button key={key} className={healthTab === key ? 'active' : ''} onClick={()=>setHealthTab(key)}><span>{icon}</span>{label}</button>)}
      </nav>

      {healthTab === 'summary' && <div className="health-summary-grid">
        <article className="health-card-versa">
          <header><div><strong>📅 Najbliższe wizyty</strong><small>{person === 'family' ? 'Cała rodzina' : person}</small></div><button onClick={()=>setHealthTab('visits')}>Zobacz wszystkie ›</button></header>
          {upcomingVisits.length === 0 ? <p className="health-empty">Brak zaplanowanych wizyt.</p> : upcomingVisits.slice(0,3).map((r)=><div className="health-visit-row" key={r.id}><span className="health-date-tile"><b>{new Date(`${r.date}T12:00`).getDate()}</b><small>{new Date(`${r.date}T12:00`).toLocaleDateString('pl-PL',{month:'short'}).toUpperCase()}</small></span><div><strong>{r.specialty || r.title}</strong><small>{[r.time,r.doctor,r.location].filter(Boolean).join(' · ')}</small></div><span>›</span></div>)}
        </article>

        <article className="health-card-versa reminders-card-versa">
          <header><div><strong>🔔 Przypomnienia</strong><small>Leki i kontrole</small></div><button onClick={()=>setHealthTab('meds')}>Zobacz wszystkie ›</button></header>
          {medicines.length === 0 && controlItems.length === 0 ? <p className="health-empty">Brak aktywnych przypomnień.</p> : null}
          {medicines.slice(0,3).flatMap((r)=>medicineTimes(r).map((time)=><div className="health-reminder-row" key={`${r.id}-${time}`}><span className="health-icon-tile medicine">💊</span><div><strong>{r.title}</strong><small>{r.person} · {time}{r.dose ? ` · ${r.dose}` : ''}</small></div><button className={isDoseConfirmed(r.id,time) ? 'confirmed' : ''} onClick={()=>void confirmMedicine(r,time)}>{isDoseConfirmed(r.id,time) ? '✓ Przyjęte' : 'Potwierdź'}</button></div>))}
          {controlItems.slice(0,2).map((r)=><div className="health-reminder-row" key={`control-${r.id}`}><span className="health-icon-tile">🩺</span><div><strong>{r.nextControl || 'Kontrola'}</strong><small>{r.callReminderDate ? `Przypomnienie ${formatShortDate(r.callReminderDate)}` : r.specialty}</small></div></div>)}
        </article>

        {person === 'Paweł' && parent && <article className="health-card-versa important-docs-versa">
          <header><div><strong>🔒 Ważne dokumenty</strong><small>Zawsze pod ręką</small></div><button onClick={()=>openAdd('document')}>Dodaj +</button></header>
          {importantDocs.length === 0 ? <p className="health-empty">Dodaj orzeczenia, decyzje lub inne ważne dokumenty.</p> : importantDocs.map((r)=><div className="health-document-row" key={r.id}><span>📄</span><div><strong>{r.title}</strong><small>{r.sharedWithPerson ? 'Udostępniony właścicielowi profilu' : 'Tylko rodzice'}</small></div><div>{r.documentURL && <a href={r.documentURL} target="_blank" rel="noreferrer">Otwórz</a>}<button onClick={()=>void toggleDocumentShare(r)}>{r.sharedWithPerson ? 'Cofnij dostęp' : 'Udostępnij'}</button></div></div>)}
        </article>}

        <article className="health-card-versa">
          <header><div><strong>🧪 Ostatnie wyniki</strong><small>Najświeższe wpisy</small></div><button onClick={()=>setHealthTab('results')}>Zobacz wszystkie ›</button></header>
          {results.length === 0 ? <p className="health-empty">Brak wyników.</p> : results.slice(0,4).map((r)=><div className="health-result-row" key={r.id}><span>📄</span><div><strong>{r.title}</strong><small>{r.date ? formatShortDate(r.date) : ''}</small></div><em>{r.note || 'Zapisano'}</em></div>)}
        </article>

        <article className="health-card-versa quick-health-actions">
          <header><div><strong>⭐ Szybkie akcje</strong><small>Dodaj nowy wpis</small></div></header>
          <div><button onClick={()=>openAdd('visit')}><span>＋</span><strong>Dodaj wizytę</strong></button><button onClick={()=>openAdd('medicine')}><span>💊</span><strong>Dodaj lek</strong></button><button onClick={()=>openAdd('result')}><span>📄</span><strong>Dodaj wynik</strong></button><button onClick={()=>openAdd('document')}><span>📁</span><strong>Dodaj dokument</strong></button></div>
        </article>
      </div>}

      {healthTab !== 'summary' && <section className="health-section-card">
        <header><div><h2>{tabItems.find(([k])=>k===healthTab)?.[2]}</h2><p>{person === 'family' ? 'Widok całej rodziny' : `Profil: ${person}`}</p></div>{healthTab === 'visits' && <button className="primary-button" onClick={()=>openAdd('visit')}>＋ Dodaj wizytę</button>}{healthTab === 'meds' && <button className="primary-button" onClick={()=>openAdd('medicine')}>＋ Dodaj lek</button>}{healthTab === 'results' && <button className="primary-button" onClick={()=>openAdd('result')}>＋ Dodaj wynik</button>}{healthTab === 'documents' && <button className="primary-button" onClick={()=>openAdd('document')}>＋ Dodaj dokument</button>}{healthTab === 'contacts' && <button className="primary-button" onClick={()=>{setContactForm({person:person==='family'?'family':person,specialty:'',name:'',doctor:'',phone:'',address:'',note:''});setShowContactForm(true);}}>＋ Dodaj kontakt</button>}</header>
        {healthTab === 'visits' && recordList('visit')}
        {healthTab === 'results' && recordList('result')}
        {healthTab === 'documents' && <div className="health-documents-full">{documents.length===0?<p className="health-empty">Brak dokumentów.</p>:documents.map((r)=><article key={r.id}><span>📄</span><div><strong>{r.title}</strong><small>{r.privateToParents ? (r.sharedWithPerson ? 'Rodzice + właściciel profilu' : 'Tylko rodzice') : 'Widoczny zgodnie z profilem'} · {r.date ? formatShortDate(r.date) : ''}</small></div>{r.documentURL&&<a href={r.documentURL} target="_blank" rel="noreferrer">Otwórz</a>}{parent&&r.privateToParents&&<button onClick={()=>void toggleDocumentShare(r)}>{r.sharedWithPerson?'Cofnij udostępnienie':'Udostępnij właścicielowi'}</button>}</article>)}</div>}
        {healthTab === 'contacts' && <div className="health-generic-list">{visibleContacts.length===0?<p className="health-empty">Brak kontaktów medycznych.</p>:visibleContacts.map((c)=><article key={c.id}><span className="health-icon-tile">🏥</span><div><strong>{c.name}</strong><small>{[c.specialty,c.doctor,c.address].filter(Boolean).join(' · ')}</small></div>{c.phone&&<a href={`tel:${c.phone.replace(/\s/g,'')}`}>{c.phone}</a>}</article>)}</div>}
        {healthTab === 'notes' && recordList('notes')}
        {healthTab === 'meds' && <div className="medicine-schedule-list">{medicines.length===0?<p className="health-empty">Brak leków stałych.</p>:medicines.map((r)=><article key={r.id}><header><span className="health-icon-tile medicine">💊</span><div><strong>{r.title}</strong><small>{r.person}{r.dose?` · ${r.dose}`:''}</small></div><em>eskalacja po {r.escalationMinutes} min</em></header><div className="medicine-times-grid">{medicineTimes(r).map((time)=><button key={time} className={isDoseConfirmed(r.id,time)?'confirmed':''} onClick={()=>void confirmMedicine(r,time)}><strong>{time}</strong><span>{isDoseConfirmed(r.id,time)?'✓ Przyjęte':'Potwierdź dawkę'}</span></button>)}</div></article>)}</div>}
      </section>}

      {showForm && <Modal title={`❤️ ${HEALTH_META[form.type].label}`} onClose={() => setShowForm(false)} wide>
        <form className="form-grid" onSubmit={save}>
          <label className="field"><span>Osoba</span><PersonSelect includeFamily={false} value={form.person} onChange={(value)=>setForm((f)=>({...f,person:value}))} /></label>
          <label className="field"><span>Rodzaj</span><select value={form.type} onChange={(e)=>setForm((f)=>({...f,type:e.target.value as HealthType}))}>{(Object.keys(HEALTH_META) as HealthType[]).map((t)=><option key={t} value={t}>{HEALTH_META[t].icon} {HEALTH_META[t].label}</option>)}</select></label>
          <label className="field field-wide"><span>Nazwa / opis</span><input value={form.title} onChange={(e)=>setForm((f)=>({...f,title:e.target.value}))} placeholder={form.type === 'medicine' ? 'Np. lek stały' : 'Np. neurolog — kontrola'} required /></label>
          <label className="field"><span>Specjalizacja</span><select value={form.specialty} onChange={(e)=>setForm((f)=>({...f,specialty:e.target.value}))}><option value="">—</option>{SPECIALTIES.map((s)=><option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Status</span><select value={form.status} onChange={(e)=>setForm((f)=>({...f,status:e.target.value as HealthStatus}))}><option value="planned">Zaplanowana</option><option value="toBook">Do umówienia</option><option value="booked">Umówiona</option><option value="done">Odbyta</option><option value="cancelled">Anulowana</option></select></label>
          <label className="field"><span>Data</span><input type="date" value={form.date} onChange={(e)=>setForm((f)=>({...f,date:e.target.value}))} /></label>
          <label className="field"><span>Godzina</span><input type="time" value={form.time} onChange={(e)=>setForm((f)=>({...f,time:e.target.value}))} /></label>
          <label className="field"><span>Lekarz</span><input value={form.doctor} onChange={(e)=>setForm((f)=>({...f,doctor:e.target.value}))} /></label>
          <label className="field"><span>Placówka / miejsce</span><input value={form.location} onChange={(e)=>setForm((f)=>({...f,location:e.target.value}))} /></label>
          <label className="field"><span>Kod skierowania</span><input value={form.referralCode} onChange={(e)=>setForm((f)=>({...f,referralCode:e.target.value}))} /></label>
          <label className="field"><span>Kontrola / orientacyjny termin</span><input value={form.nextControl} onChange={(e)=>setForm((f)=>({...f,nextControl:e.target.value}))} placeholder="Np. za 6 miesięcy" /></label>
          <label className="field"><span>Przypomnij, aby zadzwonić</span><input type="date" value={form.callReminderDate} onChange={(e)=>setForm((f)=>({...f,callReminderDate:e.target.value}))} /></label>
          {form.type === 'medicine' && <>
            <label className="field"><span>Dawka</span><input value={form.dose} onChange={(e)=>setForm((f)=>({...f,dose:e.target.value}))} placeholder="Np. 1 tabletka" /></label>
            <label className="field"><span>Eskalacja do rodzica po</span><select value={form.escalationMinutes} onChange={(e)=>setForm((f)=>({...f,escalationMinutes:Number(e.target.value)}))}><option value={5}>5 min</option><option value={10}>10 min</option><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>60 min</option></select></label>
            <div className="field field-wide medicine-times-editor"><span>Godziny przyjmowania</span><div>{form.medicineTimes.map((time,index)=><label key={index}><input type="time" value={time} onChange={(e)=>setForm((f)=>({...f,medicineTimes:f.medicineTimes.map((v,i)=>i===index?e.target.value:v)}))} /><button type="button" onClick={()=>setForm((f)=>({...f,medicineTimes:f.medicineTimes.filter((_,i)=>i!==index)}))}>✕</button></label>)}<button type="button" className="secondary-button" onClick={()=>setForm((f)=>({...f,medicineTimes:[...f.medicineTimes,'20:00']}))}>＋ Dodaj godzinę</button></div></div>
          </>}
          <label className="field field-wide"><span>Notatka / zalecenia</span><textarea rows={3} value={form.note} onChange={(e)=>setForm((f)=>({...f,note:e.target.value}))} /></label>
          <label className="field field-wide"><span>Plik (PDF / zdjęcie)</span><input type="file" accept="image/*,.pdf" onChange={(e)=>setForm((f)=>({...f,file:e.target.files?.[0] || null}))} /></label>
          {parent && form.type === 'document' && <><label className="checkbox-field field-wide"><input type="checkbox" checked={form.privateToParents} onChange={(e)=>setForm((f)=>({...f,privateToParents:e.target.checked}))} /><span>🔒 Widoczne tylko dla rodziców</span></label>{form.privateToParents&&<label className="checkbox-field field-wide"><input type="checkbox" checked={form.sharedWithPerson} onChange={(e)=>setForm((f)=>({...f,sharedWithPerson:e.target.checked}))} /><span>Udostępnij także właścicielowi profilu</span></label>}</>}
          {form.type === 'visit' && <>
            <label className="checkbox-field field-wide"><input type="checkbox" checked={form.blocksSchoolDay} onChange={(e)=>setForm((f)=>({...f,blocksSchoolDay:e.target.checked}))} /><span>🏥 Nieobecność w szkole tego dnia (np. wyjazd do lekarza)</span></label>
            <label className="checkbox-field field-wide"><input type="checkbox" checked={form.addToCalendar} onChange={(e)=>setForm((f)=>({...f,addToCalendar:e.target.checked}))} /><span>Dodaj również do rodzinnego Kalendarza</span></label>
          </>}
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={()=>setShowForm(false)}>Anuluj</button><button className="primary-button">✓ Zapisz</button></div>
        </form>
      </Modal>}

      {showContactForm && <Modal title="☎️ Nowy kontakt medyczny" onClose={()=>setShowContactForm(false)}>
        <form className="form-grid" onSubmit={saveContact}><label className="field"><span>Osoba / rodzina</span><PersonSelect value={contactForm.person} onChange={(value)=>setContactForm((f)=>({...f,person:value}))} /></label><label className="field"><span>Specjalizacja</span><input value={contactForm.specialty} onChange={(e)=>setContactForm((f)=>({...f,specialty:e.target.value}))} /></label><label className="field field-wide"><span>Nazwa placówki</span><input value={contactForm.name} onChange={(e)=>setContactForm((f)=>({...f,name:e.target.value}))} required /></label><label className="field"><span>Lekarz</span><input value={contactForm.doctor} onChange={(e)=>setContactForm((f)=>({...f,doctor:e.target.value}))} /></label><label className="field"><span>Telefon</span><input value={contactForm.phone} onChange={(e)=>setContactForm((f)=>({...f,phone:e.target.value}))} /></label><label className="field field-wide"><span>Adres</span><input value={contactForm.address} onChange={(e)=>setContactForm((f)=>({...f,address:e.target.value}))} /></label><label className="field field-wide"><span>Notatka</span><textarea value={contactForm.note} onChange={(e)=>setContactForm((f)=>({...f,note:e.target.value}))} /></label><div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={()=>setShowContactForm(false)}>Anuluj</button><button className="primary-button">✓ Zapisz</button></div></form>
      </Modal>}
    </div>
  );
}

/* =========================================================
   SCHOOL
   ========================================================= */

const SCHOOL_META: Record<SchoolType, { label: string; icon: string }> = {
  lesson: { label: 'Plan lekcji', icon: '📚' },
  homework: { label: 'Zadania domowe', icon: '📝' },
  test: { label: 'Sprawdziany / kartkówki', icon: '📅' },
  grade: { label: 'Oceny', icon: '⭐' },
  message: { label: 'Wiadomości', icon: '💬' },
  activity: { label: 'Zajęcia dodatkowe', icon: '🎯' },
  attendance: { label: 'Frekwencja', icon: '📊' },
};
function isSchoolType(value: unknown): value is SchoolType { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCHOOL_META, value); }

function schoolDaysUntil(value: string) {
  if (!value) return '';
  const today = startOfDay(new Date());
  const date = startOfDay(new Date(`${value}T12:00:00`));
  const days = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'po terminie';
  if (days === 0) return 'dzisiaj';
  if (days === 1) return 'jutro';
  return `za ${days} dni`;
}

function schoolGradeTone(value: string) {
  const number = Number(String(value).replace(',', '.').match(/[1-6]/)?.[0] || 0);
  if (number >= 5) return 'great';
  if (number >= 4) return 'good';
  if (number >= 3) return 'mid';
  return 'low';
}

function SchoolPage({ user, member }: { user: User; member: Member | null }) {
  const [records, setRecords] = useState<SchoolRecord[]>([]);
  const [members, setMembers] = useState<FamilyMemberDoc[]>([]);
  const parent = isParent(member);
  const schoolAccess = effectiveMemberPermissions(member);
  const ownStudent = member?.name === 'Paweł' || member?.name === 'Nikodem' ? member.name as 'Paweł' | 'Nikodem' : null;
  const [selectedStudent, setSelectedStudent] = useState<SchoolStudentFilter>(ownStudent || 'Paweł');
  const [tab, setTab] = useState<SchoolTab>('summary');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SchoolForm>({ title:'', person:ownStudent || 'Paweł', type:'lesson', subject:'', date:'', time:'08:00', endTime:'08:45', weekday:1, note:'', addToCalendar:false });
  const today = formatDateInput(new Date());
  const todayWeekday = new Date().getDay() === 0 ? 7 : new Date().getDay();

  useEffect(() => onSnapshot(collection(db, 'schoolItems'), (snap) => {
    const next = snap.docs.map((d): SchoolRecord => {
      const x=d.data();
      return {
        id:d.id,
        title:String(x.title || ''),
        person:isPersonKey(x.person) ? x.person : 'Nikodem',
        type:isSchoolType(x.type) ? x.type : 'homework',
        subject:typeof x.subject === 'string' ? x.subject : '',
        date:typeof x.date === 'string' ? x.date : '',
        time:typeof x.time === 'string' ? x.time : '',
        endTime:typeof x.endTime === 'string' ? x.endTime : '',
        weekday:Number(x.weekday || 0),
        note:typeof x.note === 'string' ? x.note : '',
        createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
      };
    });
    next.sort((a,b)=>(a.weekday || 9)-(b.weekday || 9) || (a.time || '99:99').localeCompare(b.time || '99:99') || (a.date || '9999').localeCompare(b.date || '9999'));
    setRecords(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'members'), (snap) => {
    const next = snap.docs.map((d): FamilyMemberDoc => {
      const x=d.data();
      return { id:d.id, name:String(x.name || ''), role:personRole(String(x.name || ''), typeof x.role === 'string' ? x.role : ''), photoURL:typeof x.photoURL === 'string' ? x.photoURL : undefined, active:x.active !== false, birthDate:typeof x.birthDate === 'string' ? x.birthDate : undefined };
    });
    setMembers(next.filter((x)=>x.name === 'Paweł' || x.name === 'Nikodem'));
  }), []);

  useEffect(() => {
    if (!parent && !schoolAccess.viewFamilySchool && ownStudent) setSelectedStudent(ownStudent);
  }, [parent, schoolAccess.viewFamilySchool, ownStudent]);

  const students: Array<'Paweł' | 'Nikodem'> = (parent || schoolAccess.viewFamilySchool) ? ['Paweł','Nikodem'] : ownStudent ? [ownStudent] : [];
  const selectedPeople: Array<'Paweł' | 'Nikodem'> = selectedStudent === 'all' ? students : (students.includes(selectedStudent as 'Paweł'|'Nikodem') ? [selectedStudent as 'Paweł'|'Nikodem'] : students.slice(0,1));
  const selectedRecords = records.filter((r)=>selectedPeople.includes(r.person as 'Paweł' | 'Nikodem'));

  function photoFor(person: 'Paweł' | 'Nikodem') {
    return members.find((m)=>m.name === person)?.photoURL;
  }

  function selectStudent(value: SchoolStudentFilter) {
    setSelectedStudent(value);
    setTab('summary');
  }

  function openAdd(person: PersonKey, type: SchoolType = 'lesson') {
    const target = person === 'family' ? (selectedStudent === 'all' ? 'Paweł' : selectedStudent) : person;
    setForm({
      title:type === 'attendance' ? 'Obecność' : '',
      person:target,
      type,
      subject:'',
      date: type === 'lesson' || type === 'activity' ? '' : today,
      time:type === 'activity' ? '17:00' : '08:00',
      endTime:type === 'activity' ? '18:00' : '08:45',
      weekday:todayWeekday <= 5 ? todayWeekday : 1,
      note:'',
      addToCalendar:type === 'activity',
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    const { addToCalendar, ...record }=form;
    await addDoc(collection(db,'schoolItems'), { ...record, title:form.title.trim(), createdBy:user.uid, createdAt:Timestamp.now() });
    if (addToCalendar && form.date) {
      const start=parseLocalDate(form.date,form.time || '08:00');
      const end=parseLocalDate(form.date,form.endTime || form.time || '09:00');
      await addDoc(collection(db,'calendarEvents'), { title:`🎒 ${form.title.trim()}`, person:form.person, date:Timestamp.fromDate(start), endDate:Timestamp.fromDate(end), allDay:false, description:[form.subject,form.note].filter(Boolean).join(' · '), repeat:'none', repeatUntil:null, createdBy:user.uid, createdAt:Timestamp.now() });
    }
    setShowForm(false);
  }

  const todayLessons = selectedRecords
    .filter((r)=>r.type === 'lesson' && (r.weekday === todayWeekday || (!r.weekday && r.date === today)))
    .sort((a,b)=>(a.time || '').localeCompare(b.time || ''));
  const upcomingTests = selectedRecords
    .filter((r)=>r.type === 'test' && (!r.date || r.date >= today))
    .sort((a,b)=>(a.date || '9999').localeCompare(b.date || '9999')).slice(0,6);
  const homework = selectedRecords
    .filter((r)=>r.type === 'homework' && (!r.date || r.date >= today))
    .sort((a,b)=>(a.date || '9999').localeCompare(b.date || '9999')).slice(0,6);
  const grades = selectedRecords.filter((r)=>r.type === 'grade').slice(-8).reverse();
  const messages = selectedRecords.filter((r)=>r.type === 'message').slice(-5).reverse();
  const attendance = selectedRecords.filter((r)=>r.type === 'attendance');
  const presentCount = attendance.filter((r)=>normalizeProduct(r.title).includes('obecn') && !normalizeProduct(r.title).includes('nieobecn')).length;
  const absentCount = attendance.filter((r)=>normalizeProduct(r.title).includes('nieobecn')).length;
  const lateCount = attendance.filter((r)=>normalizeProduct(r.title).includes('spozn') || normalizeProduct(r.title).includes('spóź')).length;
  const attendanceBase = presentCount + absentCount;
  const attendancePercent = attendanceBase ? Math.round((presentCount / attendanceBase) * 100) : 100;

  const tabs: Array<[SchoolTab,string,string]> = [
    ['summary','⌂','Podsumowanie'], ['plan','▣','Plan lekcji'], ['homework','☷','Zadania'],
    ['tests','📖','Sprawdziany'], ['grades','⭐','Oceny'], ['attendance','📊','Frekwencja'], ['messages','✉️','Wiadomości'],
  ];

  function personMark(person: PersonKey) {
    if (selectedStudent !== 'all') return null;
    return <span className="school-person-mark" style={{ color: personColor(person) }}>{person}</span>;
  }

  function sectionHeader(title: string, actionType?: SchoolType, actionText = 'Dodaj') {
    return <header className="school-card-header"><strong>{title}</strong>{parent && actionType ? <button type="button" onClick={()=>openAdd(selectedStudent === 'all' ? 'Paweł' : selectedStudent, actionType)}>{actionText}</button> : null}</header>;
  }

  function SummaryView() {
    return <div className="school-summary-grid">
      <section className="school-card school-today-card">
        {sectionHeader('🗓️ Dzisiejszy plan','lesson','Zobacz cały plan →')}
        <div className="school-list">
          {todayLessons.length === 0 ? <p className="school-empty">Brak lekcji na dziś. Plan możesz uzupełnić ręcznie.</p> : todayLessons.map((r)=><article className="school-lesson-line" key={r.id}>
            <time>{r.time || '—'}{r.endTime ? <small>– {r.endTime}</small> : null}</time>
            <span className="school-subject-icon">{subjectIcon(r.subject || r.title)}</span>
            <div><strong>{r.subject || r.title}</strong><small>{r.note || r.title}</small>{personMark(r.person)}</div>
            {parent && <button className="school-row-menu" type="button" onClick={()=>deleteDoc(doc(db,'schoolItems',r.id))}>⋯</button>}
          </article>)}
        </div>
      </section>

      <section className="school-card school-tests-card">
        {sectionHeader('🗓️ Najbliższe sprawdziany','test','Zobacz wszystkie →')}
        <div className="school-list">
          {upcomingTests.length === 0 ? <p className="school-empty">Brak zaplanowanych sprawdzianów.</p> : upcomingTests.slice(0,4).map((r)=><article className="school-test-line" key={r.id}>
            <span className="school-date-tile"><b>{r.date ? new Date(`${r.date}T12:00:00`).getDate() : '—'}</b><small>{r.date ? new Date(`${r.date}T12:00:00`).toLocaleDateString('pl-PL',{month:'short'}).replace('.','') : ''}</small></span>
            <span className="school-subject-icon">{subjectIcon(r.subject || r.title)}</span>
            <div><strong>{r.subject || r.title}</strong><small>{r.title}{r.note ? ` · ${r.note}` : ''}</small>{personMark(r.person)}</div>
            <em className="school-due-chip">{schoolDaysUntil(r.date)}</em>
          </article>)}
        </div>
      </section>

      <section className="school-card school-homework-card">
        {sectionHeader('✏️ Zadania domowe','homework','Zobacz wszystkie →')}
        <div className="school-list">
          {homework.length === 0 ? <p className="school-empty">Brak zadań domowych.</p> : homework.slice(0,4).map((r)=><article className="school-homework-line" key={r.id}>
            <span className="school-task-check" />
            <span className="school-subject-icon">{subjectIcon(r.subject || r.title)}</span>
            <div><strong>{r.subject || r.title}</strong><small>{r.title}{r.note ? ` · ${r.note}` : ''}</small>{personMark(r.person)}</div>
            <em className="school-due-chip">{schoolDaysUntil(r.date)}</em>
          </article>)}
        </div>
      </section>

      <section className="school-card school-grades-card">
        {sectionHeader('⭐ Ostatnie oceny','grade','Zobacz wszystkie →')}
        <div className="school-grade-list">
          {grades.length === 0 ? <p className="school-empty">Brak ocen.</p> : grades.slice(0,5).map((r)=><article key={r.id}>
            <span className="school-subject-icon">{subjectIcon(r.subject || r.title)}</span>
            <strong>{r.subject || 'Przedmiot'}</strong>
            <b className={`school-grade-badge ${schoolGradeTone(r.title)}`}>{r.title}</b>
            {personMark(r.person)}
          </article>)}
        </div>
      </section>

      <section className="school-card school-attendance-card">
        {sectionHeader('📊 Frekwencja','attendance','Ten miesiąc')}
        <div className="attendance-summary">
          <div className="attendance-ring" style={{ background: `conic-gradient(#38c976 ${attendancePercent * 3.6}deg, #e7eef5 0deg)` }}><span><strong>{attendancePercent}%</strong><small>obecności</small></span></div>
          <div className="attendance-legend"><span><i className="green" /> Obecności <b>{presentCount}</b></span><span><i className="red" /> Nieobecności <b>{absentCount}</b></span><span><i className="blue" /> Spóźnienia <b>{lateCount}</b></span></div>
        </div>
      </section>

      <section className="school-card school-messages-card">
        {sectionHeader('✉️ Wiadomości ze szkoły','message','Zobacz wszystkie →')}
        <div className="school-list compact">
          {messages.length === 0 ? <p className="school-empty">Brak wiadomości.</p> : messages.slice(0,3).map((r)=><article className="school-message-line" key={r.id}><span>✉️</span><div><strong>{r.title}</strong><small>{r.note || r.subject}</small>{personMark(r.person)}</div><time>{r.date ? formatShortDate(r.date) : ''}</time></article>)}
        </div>
      </section>
    </div>;
  }

  function PlanView() {
    const weekdays = [1,2,3,4,5];
    const names = ['Poniedziałek','Wtorek','Środa','Czwartek','Piątek'];
    return <section className="school-card school-full-card">
      {sectionHeader('▣ Plan lekcji','lesson','＋ Dodaj lekcję')}
      <div className="school-week-grid">
        {weekdays.map((day,index)=>{
          const rows=selectedRecords.filter((r)=>r.type === 'lesson' && r.weekday === day).sort((a,b)=>(a.time || '').localeCompare(b.time || ''));
          return <div className="school-week-day" key={day}><header><strong>{names[index]}</strong></header>{rows.length === 0 ? <p>Brak lekcji</p> : rows.map((r)=><article key={r.id}><time>{r.time}</time><span>{subjectIcon(r.subject || r.title)}</span><div><strong>{r.subject || r.title}</strong><small>{r.endTime ? `do ${r.endTime}` : ''}{r.note ? ` · ${r.note}` : ''}</small>{personMark(r.person)}</div></article>)}</div>;
        })}
      </div>
    </section>;
  }

  function ListView({ type, title, icon }: { type: SchoolType; title: string; icon: string }) {
    const list=selectedRecords.filter((r)=>r.type === type).sort((a,b)=>(a.date || '9999').localeCompare(b.date || '9999'));
    return <section className="school-card school-full-card">
      {sectionHeader(`${icon} ${title}`,type,`＋ Dodaj`)}
      <div className="school-detailed-list">
        {list.length === 0 ? <p className="school-empty">Brak wpisów w tej sekcji.</p> : list.map((r)=><article key={r.id}>
          <span className="school-subject-icon">{type === 'message' ? '✉️' : type === 'attendance' ? '📊' : subjectIcon(r.subject || r.title)}</span>
          <div><strong>{r.subject || r.title}</strong><small>{type === 'grade' ? `Ocena: ${r.title}` : r.title}{r.note ? ` · ${r.note}` : ''}</small>{personMark(r.person)}</div>
          <span>{r.date ? formatShortDate(r.date) : type === 'lesson' ? ['','Pon','Wt','Śr','Czw','Pt','Sob','Nd'][r.weekday] : ''}</span>
          {parent && <button className="icon-danger" type="button" onClick={()=>deleteDoc(doc(db,'schoolItems',r.id))}>🗑️</button>}
        </article>)}
      </div>
    </section>;
  }

  return (
    <div className="page-content compact-page school-versa-page">
      <section className="school-versa-header">
        <div><small>Rodzinne centrum</small><h1>🎒 Szkoła</h1><p>Ręczny plan lekcji, zajęcia dodatkowe, zadania, sprawdziany i oceny.</p></div>
        <div className="school-header-actions">
          <span className="school-source-chip manual">✏️ <b>Źródło danych: Ręcznie</b><i>ⓘ</i></span>
          <button className="school-source-chip vulcan" type="button" onClick={()=>alert('Miejsce przygotowane na przyszłą, bezpieczną integrację z VULCAN-em. Na tym etapie dane wpisujemy ręcznie.')}>🔗 <b>VULCAN</b><small>opcjonalna synchronizacja</small><i>ⓘ</i></button>
          {parent && <button className="primary-button school-add-button" type="button" onClick={()=>openAdd(selectedStudent === 'all' ? 'Paweł' : selectedStudent,'lesson')}>＋ Dodaj</button>}
        </div>
      </section>

      <section className="school-student-cards">
        {students.map((person)=>{
          const photo=photoFor(person);
          return <button type="button" key={person} className={`school-student-card ${selectedStudent === person ? 'active' : ''}`} onClick={()=>selectStudent(person)}>
            <span className="school-student-photo">{photo ? <img src={photo} alt="" /> : memberEmoji(person)}</span>
            <div><strong>{person}</strong><small>Szkoła / plan zajęć</small></div><em>›</em>
          </button>;
        })}
        {parent && <button type="button" className={`school-student-card all ${selectedStudent === 'all' ? 'active' : ''}`} onClick={()=>selectStudent('all')}><span className="school-student-photo">👥</span><div><strong>Wszyscy uczniowie</strong><small>Zobacz łączne informacje</small></div><em>›</em></button>}
      </section>

      <nav className="school-main-tabs" aria-label="Sekcje szkoły">
        {tabs.map(([key,icon,label])=><button type="button" key={key} className={tab === key ? 'active' : ''} onClick={()=>setTab(key)}><span>{icon}</span>{label}</button>)}
      </nav>

      {tab === 'summary' && <SummaryView />}
      {tab === 'plan' && <PlanView />}
      {tab === 'homework' && <ListView type="homework" title="Zadania domowe" icon="✏️" />}
      {tab === 'tests' && <ListView type="test" title="Sprawdziany i kartkówki" icon="🗓️" />}
      {tab === 'grades' && <ListView type="grade" title="Oceny" icon="⭐" />}
      {tab === 'attendance' && <ListView type="attendance" title="Frekwencja" icon="📊" />}
      {tab === 'messages' && <ListView type="message" title="Wiadomości" icon="✉️" />}

      {showForm && <Modal title={`🎒 ${SCHOOL_META[form.type].label} — ${form.person}`} onClose={()=>setShowForm(false)} wide>
        <form className="form-grid" onSubmit={save}>
          {parent && <label className="field"><span>Dziecko</span><PersonSelect schoolOnly value={form.person} onChange={(value)=>setForm((f)=>({...f,person:value}))} /></label>}
          <label className="field"><span>Rodzaj</span><select value={form.type} onChange={(e)=>{
            const type=e.target.value as SchoolType;
            setForm((f)=>({...f,type,title:type === 'attendance' ? 'Obecność' : f.title}));
          }}>{(Object.keys(SCHOOL_META) as SchoolType[]).map((type)=><option key={type} value={type}>{SCHOOL_META[type].icon} {SCHOOL_META[type].label}</option>)}</select></label>
          {form.type === 'attendance' ? <label className="field field-wide"><span>Status</span><select value={form.title} onChange={(e)=>setForm((f)=>({...f,title:e.target.value}))}><option>Obecność</option><option>Nieobecność</option><option>Spóźnienie</option></select></label> : <label className="field field-wide"><span>Nazwa</span><input value={form.title} onChange={(e)=>setForm((f)=>({...f,title:e.target.value}))} placeholder="Np. Matematyka / Kartkówka / Zadanie" required /></label>}
          <label className="field"><span>Przedmiot</span><input value={form.subject} onChange={(e)=>setForm((f)=>({...f,subject:e.target.value}))} placeholder="Matematyka" /></label>
          {(form.type === 'lesson' || form.type === 'activity') && <label className="field"><span>Dzień tygodnia</span><select value={form.weekday} onChange={(e)=>setForm((f)=>({...f,weekday:Number(e.target.value)}))}><option value={1}>Poniedziałek</option><option value={2}>Wtorek</option><option value={3}>Środa</option><option value={4}>Czwartek</option><option value={5}>Piątek</option><option value={6}>Sobota</option><option value={7}>Niedziela</option></select></label>}
          {(form.type !== 'lesson' && form.type !== 'activity') && <label className="field"><span>Data / termin</span><input type="date" value={form.date} onChange={(e)=>setForm((f)=>({...f,date:e.target.value}))} /></label>}
          <label className="field"><span>Od</span><input type="time" value={form.time} onChange={(e)=>setForm((f)=>({...f,time:e.target.value}))} /></label>
          {(form.type === 'lesson' || form.type === 'activity') && <label className="field"><span>Do</span><input type="time" value={form.endTime} onChange={(e)=>setForm((f)=>({...f,endTime:e.target.value}))} /></label>}
          <label className="field field-wide"><span>Notatka / sala / opis</span><textarea rows={3} value={form.note} onChange={(e)=>setForm((f)=>({...f,note:e.target.value}))} /></label>
          {form.type === 'activity' && <label className="checkbox-field field-wide"><input type="checkbox" checked={form.addToCalendar} onChange={(e)=>setForm((f)=>({...f,addToCalendar:e.target.checked}))} /><span>Dodaj również do rodzinnego Kalendarza (jeśli ustawisz konkretną datę)</span></label>}
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={()=>setShowForm(false)}>Anuluj</button><button className="primary-button">✓ Zapisz</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* =========================================================
   FAMILY
   ========================================================= */

function FamilyPage({ user, member, goTo }: { user: User; member: Member | null; goTo: (page: Page) => void }) {
  type FamilyTab = 'summary' | 'schedule' | 'tasks' | 'school' | 'health' | 'important';
  const [members, setMembers] = useState<FamilyMemberDoc[]>([]);
  const [selected, setSelected] = useState<PersonKey>(() => {
    try { const saved=sessionStorage.getItem('nr-family-focus'); return saved && isPersonKey(saved) ? saved : 'family'; }
    catch { return 'family'; }
  });
  useEffect(() => { try { sessionStorage.removeItem('nr-family-focus'); } catch { /* ignore */ } }, []);
  const [tab, setTab] = useState<FamilyTab>('summary');
  const [events, setEvents] = useState<CalendarEventData[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [school, setSchool] = useState<SchoolRecord[]>([]);
  const [photoBusy, setPhotoBusy] = useState<string>('');
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [photoTarget, setPhotoTarget] = useState<FamilyMemberDoc | null>(null);
  const parent = isParent(member);

  useEffect(() => onSnapshot(collection(db, 'members'), (snap) => {
    const next = snap.docs.map((d): FamilyMemberDoc => {
      const x = d.data();
      const name = String(x.name || 'Rodzina');
      return {
        id: d.id,
        name,
        role: personRole(name, typeof x.role === 'string' ? x.role : ''),
        photoURL: typeof x.photoURL === 'string' ? x.photoURL : undefined,
        active: x.active !== false,
        birthDate: typeof x.birthDate === 'string' ? x.birthDate : FAMILY_BIRTHDAYS[name as PersonKey],
      };
    }).sort((a,b)=>FAMILY_ORDER.indexOf(a.name)-FAMILY_ORDER.indexOf(b.name));
    setMembers(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'calendarEvents'), (snap) => {
    const next: CalendarEventData[] = [];
    snap.forEach((d) => {
      const x=d.data(); if (!(x.date instanceof Timestamp)) return;
      const start=x.date.toDate();
      next.push({ id:d.id, title:String(x.title || 'Wydarzenie'), person:isPersonKey(x.person) ? x.person : 'family', date:start, endDate:x.endDate instanceof Timestamp ? x.endDate.toDate() : new Date(start.getTime()+3600000), allDay:x.allDay === true, description:typeof x.description === 'string' ? x.description : '', createdBy:typeof x.createdBy === 'string' ? x.createdBy : '', repeat:isRepeatType(x.repeat) ? x.repeat : 'none', repeatUntil:x.repeatUntil instanceof Timestamp ? x.repeatUntil.toDate() : null });
    });
    setEvents(next);
  }), []);

  useEffect(() => onSnapshot(collection(db,'tasks'), (snap) => {
    setTasks(snap.docs.map((d): TaskItem => { const x=d.data(); return { id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'family', done:x.done === true, dueDate:typeof x.dueDate === 'string' ? x.dueDate : '', priority:x.priority === 'low' || x.priority === 'high' ? x.priority : 'normal', note:typeof x.note === 'string' ? x.note : '', points:Number(x.points || 0), requireApproval:x.requireApproval === true, approvalStatus:x.approvalStatus === 'pending' || x.approvalStatus === 'approved' ? x.approvalStatus : 'none', repeat:x.repeat === 'daily' || x.repeat === 'weekly' || x.repeat === 'monthly' ? x.repeat : 'none' }; }));
  }), []);

  useEffect(() => onSnapshot(collection(db,'schoolItems'), (snap) => {
    setSchool(snap.docs.map((d): SchoolRecord => { const x=d.data(); return { id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'Nikodem', type:isSchoolType(x.type) ? x.type : 'homework', subject:typeof x.subject === 'string' ? x.subject : '', date:typeof x.date === 'string' ? x.date : '', time:typeof x.time === 'string' ? x.time : '', endTime:typeof x.endTime === 'string' ? x.endTime : '', weekday:Number(x.weekday || 0), note:typeof x.note === 'string' ? x.note : '' }; }));
  }), []);

  const now = new Date();
  const today = formatDateInput(now);
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  const todayCalendar = useMemo(() => events.flatMap((e)=>generateOccurrences(e,startOfDay(now),endOfDay(now))).sort((a,b)=>a.date.getTime()-b.date.getTime()), [events, today]);
  const todaySchool = useMemo(() => school.filter((r)=>(r.type === 'lesson' || r.type === 'activity') && (r.weekday === weekday || r.date === today)).sort((a,b)=>(a.time || '99:99').localeCompare(b.time || '99:99')), [school, weekday, today]);

  function rowsFor(name: PersonKey) {
    const cal = todayCalendar.filter((o)=>o.source.person === name || o.source.person === 'family').map((o)=>({
      start:o.date,
      end:o.endDate,
      title:o.source.title,
      icon:eventActivityIcon(o.source.title),
      source:'calendar' as const,
    }));
    const schoolRows = todaySchool.filter((r)=>r.person === name).map((r)=>({
      start:parseLocalDate(today,r.time || '08:00'),
      end:parseLocalDate(today,r.endTime || r.time || '08:45'),
      title:r.type === 'activity' ? r.title : (r.subject || r.title),
      icon:subjectIcon(r.subject || r.title),
      source:'school' as const,
    }));
    return [...cal,...schoolRows].sort((a,b)=>a.start.getTime()-b.start.getTime());
  }

  function statusFor(name:string) {
    const key=name as PersonKey;
    const rows=rowsFor(key);
    const active=rows.find((r)=>r.start <= now && r.end > now);
    if (active) return `${active.icon} ${active.title} do ${formatTime(active.end)}`;
    const next=rows.find((r)=>r.start > now);
    if (next) return `${next.icon} ${next.title} ${formatTime(next.start)}`;
    return name === 'Layla' ? '🏠 W domu' : '🟢 Wolny';
  }

  function currentOrEndStatus(name: string) {
    const rows=rowsFor(name as PersonKey);
    const active=rows.find((r)=>r.start <= now && r.end > now);
    if (active) return `${active.title} do ${formatTime(active.end)}`;
    const last=rows[rows.length-1];
    if (last && last.source === 'school' && last.end > now) return `Szkoła do ${formatTime(last.end)}`;
    const next=rows.find((r)=>r.start > now);
    if (next) return `${next.title} ${formatTime(next.start)}`;
    return name === 'Layla' ? 'W domu' : 'Wolny';
  }

  const selectedMember = selected === 'family' ? null : members.find((m)=>m.name === selected) || null;
  const selectedTasks = tasks.filter((t)=>!t.done && (selected === 'family' ? true : t.person === selected || t.person === 'family')).slice(0,8);
  const selectedPlanRows = selected === 'family'
    ? members.flatMap((m)=>rowsFor(m.name as PersonKey).slice(0,3).map((r)=>({ ...r, person:m.name as PersonKey }))).sort((a,b)=>a.start.getTime()-b.start.getTime()).slice(0,10)
    : rowsFor(selected).map((r)=>({ ...r, person:selected })).slice(0,10);
  const selectedSchool = school.filter((r)=>selected !== 'family' && r.person === selected);
  const selectedTodaySchool = selectedSchool.filter((r)=>(r.type === 'lesson' || r.type === 'activity') && (r.weekday === weekday || r.date === today)).sort((a,b)=>(a.time || '99:99').localeCompare(b.time || '99:99'));
  const selectedHomework = school.filter((r)=>r.type === 'homework' && (selected === 'family' ? true : r.person === selected)).sort((a,b)=>(a.date || '9999').localeCompare(b.date || '9999')).slice(0,6);
  const selectedGrades = school.filter((r)=>r.type === 'grade' && (selected === 'family' ? true : r.person === selected)).sort((a,b)=>(b.date || '').localeCompare(a.date || '')).slice(0,6);
  const upcoming = events.flatMap((e)=>generateOccurrences(e,new Date(),endOfDay(addDays(new Date(),30))))
    .filter((o)=>o.date >= new Date() && (selected === 'family' || o.source.person === selected || o.source.person === 'family'))
    .sort((a,b)=>a.date.getTime()-b.date.getTime()).slice(0,6);
  const isStudent = selected === 'Paweł' || selected === 'Nikodem';
  const age = ageFromBirthDate(selectedMember?.birthDate);

  function canEditPhoto(target: FamilyMemberDoc) {
    return parent || target.id === user.uid || target.name === member?.name;
  }

  function startPhotoChange(target: FamilyMemberDoc, event?: React.MouseEvent) {
    event?.stopPropagation();
    if (!canEditPhoto(target)) return;
    setPhotoTarget(target);
    requestAnimationFrame(()=>photoInputRef.current?.click());
  }

  async function squarePhotoDataUrl(file: File) {
    if (!file.type.startsWith('image/')) throw new Error('Wybierz plik graficzny.');
    const source = await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result || ''));
      reader.onerror=()=>reject(new Error('Nie udało się odczytać zdjęcia.'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise<HTMLImageElement>((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Nie udało się otworzyć zdjęcia.'));
      img.src=source;
    });
    const size=360;
    const canvas=document.createElement('canvas');
    canvas.width=size; canvas.height=size;
    const ctx=canvas.getContext('2d');
    if (!ctx) throw new Error('Brak obsługi obrazu.');
    const sourceSize=Math.min(image.naturalWidth,image.naturalHeight);
    const sx=(image.naturalWidth-sourceSize)/2;
    const sy=(image.naturalHeight-sourceSize)/2;
    ctx.drawImage(image,sx,sy,sourceSize,sourceSize,0,0,size,size);
    return canvas.toDataURL('image/jpeg',0.78);
  }

  async function handlePhotoFile(file?: File) {
    if (!file || !photoTarget) return;
    try {
      setPhotoBusy(photoTarget.id);
      const photoURL=await squarePhotoDataUrl(file);
      await updateDoc(doc(db,'members',photoTarget.id), { photoURL, updatedAt:Timestamp.now() });
    } catch (error) {
      console.error('Błąd zdjęcia profilowego:',error);
      alert(error instanceof Error ? error.message : 'Nie udało się zapisać zdjęcia.');
    } finally {
      setPhotoBusy('');
      setPhotoTarget(null);
      if (photoInputRef.current) photoInputRef.current.value='';
    }
  }

  function selectPerson(name: PersonKey) {
    setSelected(name);
    setTab('summary');
  }

  const tabs: Array<[FamilyTab,string,string]> = [
    ['summary','⌂','Podsumowanie'],
    ['schedule','▣','Grafik'],
    ['tasks','☑','Zadania'],
    ['school','🎓','Szkoła'],
    ['health','♡','Zdrowie'],
    ['important','ⓘ','Ważne informacje'],
  ];

  function renderScheduleRows() {
    if (selectedPlanRows.length === 0) return <p className="family-versa-empty">Brak planu na dziś.</p>;
    return <div className="family-today-list">{selectedPlanRows.map((r,index)=><div className={`family-today-row family-tone-${index%5}`} key={`${r.person}-${r.start.getTime()}-${index}`}>
      <span className="family-mini-avatar">{members.find((m)=>m.name===r.person)?.photoURL ? <img src={members.find((m)=>m.name===r.person)?.photoURL} alt="" /> : memberEmoji(r.person)}</span>
      <strong>{r.person}</strong>
      <time>{formatTime(r.start)}–{formatTime(r.end)}</time>
      <span>{r.icon} {r.title}</span>
      <em>›</em>
    </div>)}</div>;
  }

  return (
    <div className="page-content compact-page family-versa-page">
      <input ref={photoInputRef} className="family-photo-input" type="file" accept="image/*" onChange={(e)=>void handlePhotoFile(e.target.files?.[0])} />
      <section className="family-versa-title">
        <div><small>Nasza Rodzina</small><h1>👥 Rodzina</h1><p>Profile, plany, zadania i szybki dostęp do informacji każdego z nas.</p></div>
      </section>

      <section className="family-member-cards">
        {members.map((m)=>{
          const active=selected === m.name;
          const editable=canEditPhoto(m);
          return <button type="button" key={m.id} className={`family-member-card ${active ? 'active' : ''}`} onClick={()=>selectPerson(m.name as PersonKey)}>
            <span className="family-member-photo">{m.photoURL ? <img src={m.photoURL} alt={m.name} /> : memberEmoji(m.name)}</span>
            {editable && <span role="button" tabIndex={0} className="family-photo-edit" title="Zmień zdjęcie" onClick={(e)=>startPhotoChange(m,e)} onKeyDown={(e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); setPhotoTarget(m); requestAnimationFrame(()=>photoInputRef.current?.click()); } }}>✎</span>}
            {m.name === member?.name && <span className="family-owner-badge">Ty</span>}
            <div><strong>{m.name}</strong><small>{personRole(m.name,m.role)}</small><p>{photoBusy===m.id ? 'Zapisywanie zdjęcia…' : currentOrEndStatus(m.name)}</p></div>
          </button>;
        })}
      </section>

      <div className="family-view-switch">
        <button className={selected==='family' ? 'active' : ''} onClick={()=>selectPerson('family')}>👨‍👩‍👧‍👦 Cała rodzina</button>
        {selected !== 'family' && selectedMember && <div className="family-selected-pill"><span>{selectedMember.photoURL ? <img src={selectedMember.photoURL} alt="" /> : memberEmoji(selected)}</span><strong>{selected}</strong><small>{personRole(selected,selectedMember.role)}{age !== null ? ` · ${age} lat` : ''}</small>{canEditPhoto(selectedMember) && <button type="button" onClick={()=>startPhotoChange(selectedMember)}>Zmień zdjęcie</button>}</div>}
      </div>

      <nav className="family-versa-tabs">
        {tabs.map(([key,icon,label])=><button key={key} className={tab===key ? 'active' : ''} onClick={()=>setTab(key)}><span>{icon}</span>{label}</button>)}
      </nav>

      {tab === 'summary' && <>
        <section className="family-versa-main-grid">
          <article className="family-versa-card family-today-card">
            <header><div><strong>📅 Dziś – {capitalize(now.toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long'}))}</strong><small>{selected==='family' ? 'Plan całej rodziny' : `Plan: ${selected}`}</small></div><button onClick={()=>goTo('Kalendarz')}>Zobacz cały dzień ›</button></header>
            {renderScheduleRows()}
          </article>
          <article className="family-versa-card family-upcoming-card">
            <header><div><strong>🗓️ Najbliższe wydarzenia</strong><small>To, o czym warto pamiętać</small></div><button onClick={()=>goTo('Kalendarz')}>Zobacz wszystko ›</button></header>
            {upcoming.length===0 ? <p className="family-versa-empty">Brak najbliższych wydarzeń.</p> : <div className="family-upcoming-list">{upcoming.map((o)=><div key={o.key}><span>{eventActivityIcon(o.source.title)}</span><div><strong>{o.source.title}</strong><small>{personLabel(o.source.person)} · {capitalize(o.date.toLocaleDateString('pl-PL',{weekday:'short',day:'numeric',month:'short'}))} · {o.source.allDay?'cały dzień':formatTime(o.date)}</small></div><em>›</em></div>)}</div>}
          </article>
        </section>

        <section className="family-bottom-grid">
          <article className="family-versa-card">
            <header><div><strong>☑ Zadania</strong><small>{selected==='family' ? 'Najbliższe zadania rodziny' : `Zadania: ${selected}`}</small></div><button onClick={()=>goTo('Zadania')}>Zobacz wszystkie ›</button></header>
            {selectedTasks.length===0 ? <p className="family-versa-empty">Brak otwartych zadań.</p> : <div className="family-simple-list">{selectedTasks.slice(0,5).map((t)=><div key={t.id}><span className="family-task-check">□</span><div><strong>{t.title}</strong><small>{personLabel(t.person)}{t.dueDate?` · ${formatShortDate(t.dueDate)}`:''}{t.points?` · +${t.points} pkt`:''}</small></div></div>)}</div>}
          </article>

          <article className="family-versa-card">
            <header><div><strong>⭐ Ostatnie oceny</strong><small>Paweł i Nikodem</small></div><button onClick={()=>goTo('Szkoła')}>Szkoła ›</button></header>
            {selectedGrades.length===0 ? <p className="family-versa-empty">Brak zapisanych ocen.</p> : <div className="family-grade-list">{selectedGrades.slice(0,5).map((r)=><div key={r.id}><span className="family-mini-avatar">{memberEmoji(r.person)}</span><strong>{r.person}</strong><b>{r.title || r.note || '—'}</b><span>{r.subject || 'Przedmiot'}</span><small>{r.date?formatShortDate(r.date):''}</small></div>)}</div>}
          </article>

          <article className="family-versa-card family-school-mini">
            <header><div><strong>🎓 Plan lekcji – dziś</strong><small>{isStudent ? selected : 'Uczniowie'}</small></div><button onClick={()=>goTo('Szkoła')}>Zobacz plan ›</button></header>
            {selected === 'family' ? <div className="family-school-switch"><span>Nikodem</span><span>Paweł</span></div> : null}
            {(selected === 'family' ? todaySchool : selectedTodaySchool).slice(0,7).length===0 ? <p className="family-versa-empty">Brak lekcji na dziś.</p> : <ol>{(selected === 'family' ? todaySchool : selectedTodaySchool).slice(0,7).map((r)=><li key={r.id}><time>{r.time}</time><strong>{r.subject || r.title}</strong><small>{r.endTime ? `do ${r.endTime}` : ''}</small></li>)}</ol>}
          </article>
        </section>
      </>}

      {tab === 'schedule' && <section className="family-versa-card family-full-section">
        <header><div><strong>▣ Grafik i plan dnia</strong><small>{selected==='family' ? 'Dzisiejszy plan wszystkich członków rodziny' : `Dzisiejszy plan: ${selected}`}</small></div><button onClick={()=>goTo('Kalendarz')}>Otwórz Kalendarz ›</button></header>
        {renderScheduleRows()}
      </section>}

      {tab === 'tasks' && <section className="family-versa-card family-full-section">
        <header><div><strong>☑ Zadania</strong><small>{selected==='family' ? 'Otwarte zadania rodziny' : `Otwarte zadania: ${selected}`}</small></div><button onClick={()=>goTo('Zadania')}>Otwórz Zadania ›</button></header>
        {selectedTasks.length===0 ? <p className="family-versa-empty">Brak otwartych zadań.</p> : <div className="family-simple-list large">{selectedTasks.map((t)=><div key={t.id}><span className="family-task-check">□</span><div><strong>{t.title}</strong><small>{personLabel(t.person)} · {t.dueDate?formatShortDate(t.dueDate):'bez terminu'}{t.points?` · +${t.points} pkt`:''}</small></div><em>{t.priority==='high'?'Wysoki':t.priority==='low'?'Niski':'Normalny'}</em></div>)}</div>}
      </section>}

      {tab === 'school' && <section className="family-versa-card family-full-section">
        <header><div><strong>🎓 Szkoła</strong><small>{selected==='family' ? 'Podgląd Pawła i Nikodema' : isStudent ? `Szkoła: ${selected}` : 'Ten profil nie ma planu szkolnego'}</small></div><button onClick={()=>goTo('Szkoła')}>Otwórz Szkołę ›</button></header>
        {!isStudent && selected!=='family' ? <p className="family-versa-empty">Dla tego profilu nie ma danych szkolnych.</p> : <div className="family-school-tab-grid"><div><h3>Dzisiejszy plan</h3>{(selected==='family'?todaySchool:selectedTodaySchool).slice(0,8).map((r)=><div className="family-school-row" key={r.id}><time>{r.time}</time><span>{subjectIcon(r.subject || r.title)}</span><strong>{r.subject || r.title}</strong><small>{r.endTime?`do ${r.endTime}`:''}</small></div>)}</div><div><h3>Zadania domowe</h3>{selectedHomework.length===0?<p className="family-versa-empty">Brak zadań.</p>:selectedHomework.map((r)=><div className="family-homework-row" key={r.id}><span>□</span><div><strong>{r.subject || r.title}</strong><small>{r.title}{r.date?` · ${formatShortDate(r.date)}`:''}</small></div></div>)}</div></div>}
      </section>}

      {tab === 'health' && <section className="family-versa-card family-full-section family-health-link">
        <span>♡</span><div><h2>Zdrowie</h2><p>Wizyty, leki, wyniki i dokumenty są przechowywane w osobnym module Zdrowie z odpowiednimi uprawnieniami.</p></div><button className="primary-button" onClick={()=>goTo('Zdrowie')}>Otwórz Zdrowie</button>
      </section>}

      {tab === 'important' && <section className="family-important-grid">
        {(selected==='family' ? members : selectedMember ? [selectedMember] : []).map((m)=>{
          const a=ageFromBirthDate(m.birthDate);
          const openTasks=tasks.filter((t)=>!t.done && (t.person===m.name || t.person==='family')).length;
          const schoolEndValues=todaySchool.filter((r)=>r.person===m.name).map((r)=>r.endTime).filter(Boolean).sort(); const schoolEnd=schoolEndValues.length ? schoolEndValues[schoolEndValues.length-1] : '';
          return <article className="family-versa-card" key={m.id}><div className="family-important-title"><span className="family-mini-avatar">{m.photoURL?<img src={m.photoURL} alt=""/>:memberEmoji(m.name)}</span><div><strong>{m.name}</strong><small>{personRole(m.name,m.role)}</small></div></div><dl><div><dt>Aktualnie</dt><dd>{currentOrEndStatus(m.name)}</dd></div>{a!==null&&<div><dt>Wiek</dt><dd>{a} lat</dd></div>}<div><dt>Otwarte zadania</dt><dd>{openTasks}</dd></div>{schoolEnd&&<div><dt>Koniec szkoły</dt><dd>{schoolEnd}</dd></div>}</dl></article>;
        })}
      </section>}
    </div>
  );
}

/* =========================================================
   SETTINGS
   ========================================================= */

function SettingsPage({ member, theme, setTheme, goTo }: { member: Member | null; theme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void; goTo: (page: Page) => void }) {
  const defaultPrefs = { app:true, email:false, push:true, medicines:true, school:true };
  const [prefs, setPrefs] = useState<Record<keyof typeof defaultPrefs, boolean>>(() => {
    try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem('nr-notifications-v138') || '{}') }; }
    catch { return defaultPrefs; }
  });
  const [members, setMembers] = useState<FamilyMemberDoc[]>([]);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionMemberId, setPermissionMemberId] = useState('');
  const [accent, setAccent] = useState<'blue'|'violet'|'pink'|'green'|'orange'>(() => {
    try {
      const saved = localStorage.getItem('nr-accent');
      return saved === 'violet' || saved === 'pink' || saved === 'green' || saved === 'orange' ? saved : 'blue';
    } catch { return 'blue'; }
  });
  const [textSize, setTextSize] = useState<'small'|'medium'|'large'>(() => {
    try {
      const saved = localStorage.getItem('nr-text-size');
      return saved === 'small' || saved === 'large' ? saved : 'medium';
    } catch { return 'medium'; }
  });
  const parent = isParent(member);
  useEffect(() => {
    try {
      const focus=sessionStorage.getItem('nr-settings-focus');
      if (focus==='notifications') requestAnimationFrame(()=>document.getElementById('settings-notifications')?.scrollIntoView({behavior:'smooth',block:'center'}));
      sessionStorage.removeItem('nr-settings-focus');
    } catch { /* ignore */ }
  }, []);

  useEffect(() => onSnapshot(collection(db, 'members'), (snapshot) => {
    const next = snapshot.docs.map((memberDoc): FamilyMemberDoc => {
      const data = memberDoc.data();
      return {
        id: memberDoc.id,
        name: String(data.name || 'Rodzina'),
        role: personRole(String(data.name || ''), typeof data.role === 'string' ? data.role : ''),
        photoURL: typeof data.photoURL === 'string' ? data.photoURL : undefined,
        active: data.active !== false,
        birthDate: typeof data.birthDate === 'string' ? data.birthDate : undefined,
        permissions: normalizeMemberPermissions(data.permissions),
      };
    });
    next.sort((a,b)=>FAMILY_ORDER.indexOf(a.name)-FAMILY_ORDER.indexOf(b.name));
    setMembers(next);
  }), []);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    try { localStorage.setItem('nr-accent', accent); } catch { /* ignore */ }
  }, [accent]);

  useEffect(() => {
    document.documentElement.dataset.textSize = textSize;
    try { localStorage.setItem('nr-text-size', textSize); } catch { /* ignore */ }
  }, [textSize]);

  async function togglePref(key:keyof typeof defaultPrefs) {
    const nextValue=!prefs[key];
    if (key === 'push' && nextValue && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* browser may block */ }
    }
    const next={...prefs,[key]:nextValue};
    setPrefs(next);
    try { localStorage.setItem('nr-notifications-v138',JSON.stringify(next)); } catch { /* ignore */ }
  }

  function openPermissions() {
    if (!parent) { alert('Uprawnieniami członków rodziny zarządza rodzic / administrator.'); return; }
    const firstEditable=members.find((person)=>!PARENT_NAMES.has(person.name)) || members[0];
    setPermissionMemberId(firstEditable?.id || '');
    setPermissionsOpen(true);
  }

  async function setMemberPermission(key:keyof MemberPermissions,value:boolean) {
    if (!parent || !permissionMemberId) return;
    await updateDoc(doc(db,'members',permissionMemberId), { [`permissions.${key}`]:value, updatedAt:Timestamp.now() });
  }

  function integrationInfo(name:string) {
    alert(`${name}: miejsce integracji jest przygotowane. Pełne połączenie zrobimy w etapie integracji po zakończeniu wszystkich zakładek.`);
  }

  const accountEmail = auth.currentUser?.email || 'E-mail konta';
  const roleLabel = personRole(member?.name || '', member?.role);
  const accentOptions: Array<['blue'|'violet'|'pink'|'green'|'orange', string]> = [
    ['blue','#3b9cff'],['violet','#8b67ff'],['pink','#ff5aa8'],['green','#4acb8a'],['orange','#ff9a46']
  ];

  return (
    <div className="page-content compact-page settings-versa-page">
      <section className="settings-versa-heading">
        <div className="settings-title-copy"><span className="settings-title-icon">⚙️</span><div><small>Nasza Rodzina</small><h1>Ustawienia</h1><p>Konto, wygląd, powiadomienia, synchronizacja i bezpieczeństwo.</p></div></div>
        <div className="settings-brand-mini"><img src="/nasza-rodzina-logo.svg" alt="Nasza Rodzina"/><span>Nasza Rodzina v{APP_VERSION}</span></div>
      </section>

      <section className="settings-versa-grid">
        <article className="settings-versa-card settings-account-card">
          <header><span className="settings-card-icon">👤</span><div><strong>Profil i konto</strong><small>Zalogowana osoba</small></div><button className="settings-chevron" onClick={()=>goTo('Rodzina')}>›</button></header>
          <div className="settings-account-profile">
            <span className="settings-main-avatar">{member?.photoURL ? <img src={member.photoURL} alt=""/> : memberEmoji(member?.name || '')}<i>📷</i></span>
            <div><strong>{member?.name || 'Użytkownik'}</strong><small>{roleLabel}{parent ? ' · Administrator' : ''}</small><em>● Aktywne</em></div>
            <button onClick={()=>goTo('Rodzina')}>Edytuj profil</button>
          </div>
          <div className="settings-menu-list">
            <button onClick={()=>goTo('Rodzina')}><span>📷</span><b>Zmień zdjęcie</b><em>›</em></button>
            <button onClick={()=>goTo('Rodzina')}><span>👥</span><b>Imię i rola</b><small>{member?.name || ''} · {roleLabel}</small><em>›</em></button>
            <button><span>✉️</span><b>E-mail</b><small>{accountEmail}</small></button>
            <button onClick={()=>alert('Zmianę hasła dodamy w etapie bezpieczeństwa konta.')}><span>🔗</span><b>Hasło</b><small>Zmień</small><em>›</em></button>
            <button className="danger" onClick={()=>void signOut(auth)}><span>↪️</span><b>Wyloguj z konta</b></button>
          </div>
        </article>

        <article className="settings-versa-card settings-family-card">
          <header><span className="settings-card-icon">👥</span><div><strong>Członkowie rodziny</strong><small>Profile i role</small></div><button className="settings-chevron" onClick={()=>goTo('Rodzina')}>›</button></header>
          <div className="settings-family-list">
            {members.map((person)=><button key={person.id} onClick={()=>goTo('Rodzina')}>
              <span className="settings-member-avatar">{person.photoURL?<img src={person.photoURL} alt=""/>:memberEmoji(person.name)}</span>
              <div><strong>{person.name}</strong><small>{personRole(person.name,person.role)}{person.name===member?.name ? ' · Ty' : ''}</small></div>
              <i className={person.active === false ? 'offline' : ''}>{person.active === false ? 'Nieaktywne' : 'Aktywne'}</i><em>›</em>
            </button>)}
          </div>
          <button className="settings-wide-action" onClick={()=>goTo('Rodzina')}>Otwórz profile rodziny</button>
        </article>

        <article className="settings-versa-card settings-appearance-card">
          <header><span className="settings-card-icon">🎨</span><div><strong>Wygląd aplikacji</strong><small>Motyw i czytelność</small></div></header>
          <div className="settings-theme-pair">
            <button className={theme==='light'?'active':''} onClick={()=>setTheme('light')}><span>☀️</span><strong>Jasny</strong></button>
            <button className={theme==='dark'?'active':''} onClick={()=>setTheme('dark')}><span>🌙</span><strong>Ciemny</strong></button>
          </div>
          <label>Motyw kolorystyczny</label>
          <div className="settings-accent-row">{accentOptions.map(([key,color])=><button key={key} aria-label={key} className={accent===key?'active':''} style={{background:color}} onClick={()=>setAccent(key)} />)}</div>
          <label>Rozmiar tekstu</label>
          <div className="settings-text-size"><button className={textSize==='small'?'active':''} onClick={()=>setTextSize('small')}>A <span>Mały</span></button><button className={textSize==='medium'?'active':''} onClick={()=>setTextSize('medium')}>A <span>Średni</span></button><button className={textSize==='large'?'active':''} onClick={()=>setTextSize('large')}>A <span>Duży</span></button></div>
          <div className="settings-logo-row"><img src="/nasza-rodzina-logo.svg" alt=""/><div><strong>Nasza Rodzina</strong><small>v{APP_VERSION}</small></div><span>Logo aplikacji</span></div>
        </article>

        <article id="settings-notifications" className="settings-versa-card settings-notifications-card">
          <header><span className="settings-card-icon">🔔</span><div><strong>Powiadomienia</strong><small>Wybierz, o czym przypominać</small></div><button className="settings-chevron">›</button></header>
          <div className="settings-toggle-list">
            {([['app','🔔','Powiadomienia w aplikacji','Ważne wydarzenia i zadania'],['email','✉️','Powiadomienia e-mail','Podsumowanie dnia'],['push','📱','Powiadomienia push (Web)','Wymaga zgody przeglądarki'],['medicines','❤️','Przypomnienia o lekach','Zdrowie · leki i wizyty'],['school','🎓','Przypomnienia szkolne','Sprawdziany, zadania, oceny']] as Array<[keyof typeof defaultPrefs,string,string,string]>).map(([key,icon,label,desc])=><button key={key} onClick={()=>void togglePref(key)}><span>{icon}</span><div><strong>{label}</strong><small>{desc}</small></div><i className={prefs[key]?'on':''}><b/></i></button>)}
          </div>
        </article>

        <article className="settings-versa-card settings-calendars-card">
          <header><span className="settings-card-icon">📅</span><div><strong>Synchronizacja kalendarzy</strong><small>Zewnętrzne źródła</small></div><button className="settings-chevron">›</button></header>
          <div className="settings-integrations-list">
            {[['Google Calendar','G','Połącz kalendarz rodzinny'],['Apple Calendar / iCloud','','Połącz kalendarz rodzinny'],['Outlook / Microsoft 365','O','Połącz kalendarz rodzinny'],['ICS (inny kalendarz)','ICS','Import / eksport']].map(([name,icon,desc])=><button key={name} onClick={()=>integrationInfo(name)}><span>{icon}</span><div><strong>{name}</strong><small>{desc}</small></div><em>Połącz</em></button>)}
          </div>
        </article>

        <div className="settings-right-stack">
          <article className="settings-versa-card settings-security-card">
            <header><span className="settings-card-icon">🛡️</span><div><strong>Prywatność i bezpieczeństwo</strong><small>Dostęp do danych</small></div></header>
            <div className="settings-menu-list compact">
              <button><span>👥</span><b>Dane rodzinne</b><small>Zarządzaj swoimi danymi</small><em>›</em></button>
              <button onClick={openPermissions}><span>👤</span><b>Uprawnienia i role</b><small>{parent?'Zarządzaj dostępem rodziny':'Dostęp ustala rodzic'}</small><em>›</em></button>
              <button><span>☁️</span><b>Kopie zapasowe</b><small>Etap integracji</small><em>›</em></button>
              <button className="danger" onClick={()=>alert('Usuwanie konta wymaga dodatkowego potwierdzenia i zostanie dodane w etapie bezpieczeństwa.')}><span>🗑️</span><b>Usuń swoje konto</b><small>Trwałe usunięcie danych</small><em>›</em></button>
            </div>
          </article>

          <article className="settings-versa-card settings-about-card">
            <header><span className="settings-card-icon">ℹ️</span><div><strong>Informacje o aplikacji</strong><small>Nasza Rodzina</small></div></header>
            <div className="settings-about-row"><img src="/nasza-rodzina-logo.svg" alt=""/><div><strong>Nasza Rodzina</strong><small>Wersja {APP_VERSION} · {APP_UPDATED}</small></div><em>›</em></div>
          </article>
        </div>
      </section>

      {permissionsOpen && <Modal title="🛡️ Uprawnienia i role" subtitle="Prywatność rodzinna" onClose={()=>setPermissionsOpen(false)} wide>
        <div className="permission-editor">
          <div className="permission-members">{members.map((person)=><button type="button" key={person.id} className={permissionMemberId===person.id?'active':''} onClick={()=>setPermissionMemberId(person.id)}><span className="settings-member-avatar">{person.photoURL?<img src={person.photoURL} alt=""/>:memberEmoji(person.name)}</span><strong>{person.name}</strong><small>{personRole(person.name,person.role)}</small></button>)}</div>
          {(()=>{
            const selected=members.find((person)=>person.id===permissionMemberId);
            if(!selected) return <p>Wybierz członka rodziny.</p>;
            if(PARENT_NAMES.has(selected.name)) return <div className="permission-parent-note"><strong>✓ {selected.name} ma pełny dostęp rodzica</strong><small>Rodzice mają dostęp do modułów rodzinnych i ustawień administracyjnych.</small></div>;
            const permissions=normalizeMemberPermissions(selected.permissions);
            const options:Array<[keyof MemberPermissions,string,string,string]>=[
              ['viewFamilySchedule','📅','Grafik całej rodziny','Statusy, godziny zakończenia i wspólny plan dnia'],
              ['viewFamilyTasks','✅','Zadania całej rodziny','Podgląd zadań innych członków rodziny'],
              ['viewFamilySchool','🎓','Szkoła rodzeństwa','Plan, zadania i sprawdziany drugiego dziecka'],
              ['viewFamilyHealth','❤️','Zdrowie rodziny','Niepoufne wizyty i informacje zdrowotne innych osób'],
            ];
            return <><div className="settings-toggle-list permission-toggle-list">{options.map(([key,icon,label,desc])=><button type="button" key={key} onClick={()=>void setMemberPermission(key,!permissions[key])}><span>{icon}</span><div><strong>{label}</strong><small>{desc}</small></div><i className={permissions[key]?'on':''}><b/></i></button>)}</div><div className="permission-sensitive-note"><strong>🔒 Prywatne dokumenty medyczne</strong><small>Orzeczenia i dokumenty oznaczone „tylko rodzice” pozostają niewidoczne niezależnie od ustawień powyżej. Udostępnia się je osobno przy konkretnym dokumencie.</small></div></>;
          })()}
        </div>
      </Modal>}
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
