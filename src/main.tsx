import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  writeBatch,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, getBlob, deleteObject } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import './style.css';
import './responsive.css';
import './improvements.css';
import './navigation.css';
import './brand-theme.css';
import { Feedback, ErrorBoundary, notify, errorMessage, onSnapshot } from './feedback';
import SchoolModule from './SchoolModule';
import { registerPwa } from './pwa';
import { startOfDay, endOfDay, startOfWeek, addDays, addMonths, addYears, sameDay, formatDateInput, formatTimeInput, parseLocalDate, isRepeatType, repeatLabel, occurrenceAt, generateOccurrences } from './calendar-utils';

const APP_VERSION = '1.4.2';
const APP_UPDATED = '01.10.2026';

/* =========================================================
   TYPES
   ========================================================= */

type Member = {
  personKey?: string;
  birthDate?: string;
  adult?: boolean;
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
  documentPath: string;
  privateToParents: boolean;
  dose: string;
  medicineTime: string;
  confirmedDate: string;
  createdAt?: Date;
};

type HealthForm = Omit<HealthRecord, 'id' | 'createdAt' | 'confirmedDate' | 'documentURL' | 'documentPath'> & {
  addToCalendar: boolean;
  file: File | null;
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

type SchoolType = 'lesson' | 'homework' | 'test' | 'grade' | 'message' | 'activity';
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

type FamilyMemberDoc = {
  id: string;
  name: string;
  role: string;
  photoURL?: string;
  active?: boolean;
  birthDate?: string;
};

/* =========================================================
   HELPERS
   ========================================================= */

const PEOPLE: PersonKey[] = ['family', 'Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'];
const FAMILY_ORDER = ['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'];
const FAMILY_BIRTHDAYS: Partial<Record<PersonKey, string>> = {};
function isParent(member: Member | null | undefined) {
  return member?.role === 'parent';
}

function ownPerson(member: Member | null | undefined) {
  const value = member?.personKey || member?.name;
  return isPersonKey(value) ? value : 'family';
}

function schoolQuery(member: Member | null) {
  return isParent(member) ? collection(db, 'schoolItems') : query(collection(db, 'schoolItems'), where('person', '==', ownPerson(member)));
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
  if (isParent(member) || member?.adult === true) return true;
  const age = ageFromBirthDate(member?.birthDate);
  return age !== null && age >= 18;
}

function personRole(name: string, role?: string) {
  if (role && role !== 'parent' && role !== 'child') return role;
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

const PAGES: Page[] = ['Start', 'Kalendarz', 'Zadania', 'Zakupy', 'Czat', 'Zdrowie', 'Szkoła', 'Rodzina', 'Ustawienia'];
function pageFromHash(): Page {
  try { const value = decodeURIComponent(location.hash.slice(1)) as Page; return PAGES.includes(value) ? value : 'Start'; } catch { return 'Start'; }
}

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

  return <><Feedback />{user ? <FamilyApp key={user.uid} user={user} /> : <Login />}</>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function resetPassword() {
    if (!email.trim()) { setError('Wpisz e-mail, aby otrzymać link do zmiany hasła.'); return; }
    setResetting(true);
    try { await sendPasswordResetEmail(auth, email.trim()); notify('Jeśli konto istnieje, otrzymasz wiadomość z linkiem do zmiany hasła.'); }
    catch { setError('Nie udało się wysłać linku. Sprawdź e-mail i połączenie.'); }
    finally { setResetting(false); }
  }

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
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Twój e-mail" required />
          </label>
          <label>
            <span>Hasło</span>
            <input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Hasło" required />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" disabled={loggingIn}>{loggingIn ? 'Logowanie…' : 'Zaloguj się'}</button>
        </form>

        <div className="login-options"><button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword ? "Ukryj hasło" : "Pokaż hasło"}</button><button type="button" disabled={resetting} onClick={()=>void resetPassword()}>{resetting ? "Wysyłanie…" : "Nie pamiętam hasła"}</button></div>
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
  const [page, setPage] = useState<Page>(() => pageFromHash());
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
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


  useEffect(() => {
    let active = true;
    setProfileLoading(true);
    getDoc(doc(db, 'members', user.uid)).then(snapshot => {
      if (!active) return;
      setMember(snapshot.exists() ? snapshot.data() as Member : null);
    }).catch(error => { if (active) setProfileError(errorMessage(error)); }).finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [user.uid]);

  useEffect(() => {
    const changed = () => { setPage(pageFromHash()); setMobileMoreOpen(false); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  function goTo(next: Page) {
    setPage(next);
    window.location.hash = encodeURIComponent(next);
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
      case 'Szkoła': return <SchoolModule user={user} member={member} />;
      case 'Rodzina': return <FamilyPage member={member} goTo={goTo} />;
      case 'Ustawienia': return <SettingsPage user={user} member={member} theme={theme} setTheme={setTheme} />;
      default: return <StartPage member={member} goTo={goTo} />;
    }
  }

  if (profileLoading) return <div className="loading-screen"><section className="loading-card"><h2>Nasza Rodzina</h2><p>Sprawdzam profil rodziny…</p></section></div>;
  if (!member || member.active !== true || member.canLogin !== true || !['parent','child'].includes(member.role || '')) return <div className="loading-screen"><section className="loading-card access-card"><h2>Konto czeka na dostęp</h2><p>{profileError || 'Administrator rodziny musi przypisać temu kontu aktywny profil. Skontaktuj się z osobą, która konfiguruje aplikację dla rodziny.'}</p><button className="secondary-button" onClick={()=>void signOut(auth)}>Wyloguj</button></section></div>;

  return (
    <div className={`app-shell theme-${theme}`}>
      <Sidebar page={page} goTo={goTo} member={member} />
      <main className="main-area">
        <FamilyHeader member={member} onLogout={() => signOut(auth)} />
        {renderPage()}
      </main>
      <MobileNavigation page={page} goTo={goTo} moreOpen={mobileMoreOpen} onMore={() => setMobileMoreOpen(true)} />
      {mobileMoreOpen && (
        <MobileMoreMenu page={page} goTo={goTo} onClose={() => setMobileMoreOpen(false)} onLogout={() => signOut(auth)} />
      )}
    </div>
  );
}

function AppIcon({ page, size = 20 }: { page: Page; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (page) {
    case 'Start': return <svg {...common}><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-6h5v6"/></svg>;
    case 'Kalendarz': return <svg {...common}><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M7 3.5v4M17 3.5v4M3.5 10h17"/><path d="M7.5 13.5h2M12 13.5h2M16.5 13.5h.1M7.5 17h2M12 17h2"/></svg>;
    case 'Zadania': return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.2 2.2L16.5 8"/></svg>;
    case 'Zakupy': return <svg {...common}><path d="M3 4h2l2.1 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20.5 8H6"/><circle cx="9.5" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></svg>;
    case 'Czat': return <svg {...common}><path d="M4 5.5h16v11H9l-5 4v-15Z"/><path d="M8 10h8M8 13h5"/></svg>;
    case 'Zdrowie': return <svg {...common}><path d="M12 20s-7.5-4.7-7.5-10.2A4.3 4.3 0 0 1 12 6.9a4.3 4.3 0 0 1 7.5 2.9C19.5 15.3 12 20 12 20Z"/></svg>;
    case 'Szkoła': return <svg {...common}><path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 12.2V16c3 2 7 2 10 0v-3.8M21 9v6"/></svg>;
    case 'Rodzina': return <svg {...common}><circle cx="8" cy="8" r="2.5"/><circle cx="16.2" cy="8.8" r="2.1"/><path d="M3.8 19v-1.8A4.2 4.2 0 0 1 8 13h0a4.2 4.2 0 0 1 4.2 4.2V19M13.2 14.2a3.5 3.5 0 0 1 6.3 2.1V19"/></svg>;
    case 'Ustawienia': return <svg {...common}><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5 17 7M7 17l-1.5 1.5M18.5 18.5 17 17M7 7 5.5 5.5"/><circle cx="12" cy="12" r="7.1"/></svg>;
  }
}

function Sidebar({ page, goTo, member }: { page: Page; goTo: (page: Page) => void; member: Member | null }) {
  const groups: Array<{ label: string; items: Page[] }> = [
    { label: 'Na co dzień', items: ['Start', 'Kalendarz', 'Zadania', 'Zakupy'] },
    { label: 'Dom i bliscy', items: ['Czat', 'Zdrowie', 'Szkoła', 'Rodzina'] },
    { label: 'Twoja aplikacja', items: ['Ustawienia'] },
  ];

  return (
    <aside className="sidebar family-menu">
      <div className="sidebar-brand">
        <img className="menu-brand-logo" src="/nasza-rodzina-logo.svg" alt="" />
        <div className="brand-copy"><strong>Nasza<br />Rodzina</strong><small>Razem zawsze lepiej ♡</small></div>
      </div>
      <nav className="sidebar-nav" aria-label="Menu główne">
        {groups.map((group) => (
          <div className="menu-group" key={group.label}>
            <p className="menu-group-label">{group.label}</p>
            {group.items.map((label) => (
              <button key={label} type="button" aria-current={page === label ? 'page' : undefined} data-menu-page={label} className={`nav-button ${page === label ? 'active' : ''}`} onClick={() => goTo(label)}>
                <span className="nav-icon"><AppIcon page={label} size={20} /></span><span className="nav-label">{label}</span>
                <span className="menu-active-mark" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="menu-profile">
        <span className="menu-profile-avatar">{member?.photoURL ? <img src={member.photoURL} alt="" /> : memberEmoji(member?.name || '')}</span>
        <div><strong>{member?.name || 'Nasza Rodzina'}</strong><small>{personRole(member?.name || '', member?.role)}</small></div>
        <span className="menu-version">v{APP_VERSION}</span>
      </div>
    </aside>
  );
}

function FamilyHeader({ member, onLogout }: { member: Member | null; onLogout: () => void }) {
  return (
    <header className="top-header">
      <div className="header-brand"><img src="/nasza-rodzina-logo.svg" alt="" /><div><small>Rodzinne centrum</small><strong>Nasza Rodzina</strong></div></div>
      <div className="header-user">
        <div className="header-user-text"><strong>{member?.name || 'Użytkownik'}</strong><small>{personRole(member?.name || '', member?.role)}</small></div>
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
  const [weather, setWeather] = useState<{ temp: number; max: number; min: number; wind: number; label: string; icon: string } | null>(null);

  useEffect(() => onSnapshot(collection(db, 'members'), (snap) => {
    const next = snap.docs.map((d): FamilyMemberDoc => {
      const x = d.data();
      return {
        id: d.id,
        name: String(x.name || 'Rodzina'),
        role: personRole(String(x.name || ''), typeof x.role === 'string' ? x.role : ''),
        photoURL: typeof x.photoURL === 'string' ? x.photoURL : undefined,
        active: x.active !== false,
        birthDate: typeof x.birthDate === 'string' ? x.birthDate : FAMILY_BIRTHDAYS[String(x.name || '') as PersonKey],
      };
    });
    next.sort((a, b) => FAMILY_ORDER.indexOf(a.name) - FAMILY_ORDER.indexOf(b.name));
    setMembers(next);
  }), []);

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
    setTasks(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'shoppingItems'), (snap) => {
    const next = snap.docs.map((d): ShoppingItem => {
      const x = d.data();
      const productTitle = String(x.title || '');
      return {
        id: d.id,
        title: productTitle,
        done: x.done === true,
        category: isShoppingCategory(x.category) ? x.category : categorizeProduct(productTitle),
        quantity: typeof x.quantity === 'string' ? x.quantity : '',
        unit: typeof x.unit === 'string' ? x.unit : '',
        createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
      };
    });
    setShopping(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'calendarEvents'), (snapshot) => {
    const loaded: CalendarEventData[] = [];
    snapshot.forEach((eventDoc) => {
      const data = eventDoc.data();
      if (!(data.date instanceof Timestamp)) return;
      const start = data.date.toDate();
      loaded.push({
        id: eventDoc.id,
        title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Wydarzenie',
        person: isPersonKey(data.person) ? data.person : 'family',
        date: start,
        endDate: data.endDate instanceof Timestamp ? data.endDate.toDate() : new Date(start.getTime() + 3600000),
        allDay: data.allDay === true,
        description: typeof data.description === 'string' ? data.description : '',
        createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
        repeat: isRepeatType(data.repeat) ? data.repeat : 'none',
        repeatUntil: data.repeatUntil instanceof Timestamp ? data.repeatUntil.toDate() : null,
      });
    });
    setEvents(loaded);
  }), []);

  useEffect(() => onSnapshot(schoolQuery(member), (snap) => {
    const next = snap.docs.map((d): SchoolRecord => {
      const x = d.data();
      return {
        id: d.id,
        title: String(x.title || ''),
        person: isPersonKey(x.person) ? x.person : 'Nikodem',
        type: isSchoolType(x.type) ? x.type : 'homework',
        subject: typeof x.subject === 'string' ? x.subject : '',
        date: typeof x.date === 'string' ? x.date : '',
        time: typeof x.time === 'string' ? x.time : '',
        endTime: typeof x.endTime === 'string' ? x.endTime : '',
        weekday: Number(x.weekday || 0),
        note: typeof x.note === 'string' ? x.note : '',
        createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
      };
    });
    setSchoolRecords(next);
  }), []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadWeather() {
      try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=54.176&longitude=15.576&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FWarsaw&forecast_days=1';
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('weather');
        const data = await response.json();
        const code = Number(data.current?.weather_code ?? 0);
        const weatherMeta = code <= 1 ? ['Słonecznie', '☀️'] : code <= 3 ? ['Częściowe zachmurzenie', '⛅'] : code <= 48 ? ['Mgła / chmury', '🌫️'] : code <= 67 ? ['Deszcz', '🌧️'] : code <= 77 ? ['Śnieg', '🌨️'] : code <= 82 ? ['Przelotny deszcz', '🌦️'] : ['Burze', '⛈️'];
        setWeather({ temp: Math.round(data.current?.temperature_2m ?? 0), max: Math.round(data.daily?.temperature_2m_max?.[0] ?? 0), min: Math.round(data.daily?.temperature_2m_min?.[0] ?? 0), wind: Math.round(data.current?.wind_speed_10m ?? 0), label: weatherMeta[0], icon: weatherMeta[1] });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.warn('Pogoda chwilowo niedostępna');
      }
    }
    void loadWeather();
    const timer = window.setInterval(() => void loadWeather(), 30 * 60 * 1000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const todayOccurrences = useMemo(() => events
    .flatMap((event) => generateOccurrences(event, todayStart, todayEnd))
    .sort((a, b) => a.date.getTime() - b.date.getTime()), [events, todayStart.getTime(), todayEnd.getTime()]);

  const priorityTasks = useMemo(() => tasks
    .filter((item) => !item.done)
    .sort((a, b) => (
      { high: 0, normal: 1, low: 2 }[a.priority]
      - { high: 0, normal: 1, low: 2 }[b.priority]
      || (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99')
    ))
    .slice(0, 4), [tasks]);

  const upcomingEvents = useMemo(() => {
    const rangeStart = startOfDay(new Date());
    const end = endOfDay(addDays(rangeStart, 45));
    return events.flatMap((event) => generateOccurrences(event, rangeStart, end))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 5);
  }, [events]);

  const openShopping = shopping.filter((item) => !item.done).slice(0, 5);

  const todayKey = formatDateInput(now);
  const todayWeekday = now.getDay() === 0 ? 7 : now.getDay();
  const todaySchoolItems = useMemo(() => schoolRecords
    .filter((r) => (r.type === 'lesson' || r.type === 'activity') && (r.weekday === todayWeekday || (!!r.date && r.date === todayKey)))
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')), [schoolRecords, todayWeekday, todayKey]);

  function schoolStart(record: SchoolRecord) {
    return parseLocalDate(todayKey, record.time || '08:00');
  }
  function schoolEnd(record: SchoolRecord) {
    const start = schoolStart(record);
    const end = parseLocalDate(todayKey, record.endTime || record.time || '08:45');
    return end > start ? end : new Date(start.getTime() + 45 * 60000);
  }

  const allFreeAt = useMemo(() => {
    const ends: Date[] = todayOccurrences
      .filter((o) => o.source.person !== 'family' && !o.source.allDay)
      .map((o) => o.endDate);
    for (const item of todaySchoolItems) ends.push(schoolEnd(item));
    if (!ends.length) return 'Teraz';
    return formatTime(ends.reduce((max, value) => value > max ? value : max, ends[0]));
  }, [todayOccurrences, todaySchoolItems, todayKey]);

  function planForPerson(personName: string) {
    const key = personName as PersonKey;
    const calendarRows = todayOccurrences
      .filter((o) => o.source.person === key)
      .map((o) => ({ key:o.key, start:o.date, end:o.endDate, title:o.source.title, icon:eventActivityIcon(o.source.title), allDay:o.source.allDay }));
    const schoolRows = todaySchoolItems
      .filter((r) => r.person === key)
      .map((r) => ({ key:`school-${r.id}`, start:schoolStart(r), end:schoolEnd(r), title:r.type === 'activity' ? r.title : (r.subject || r.title), icon:subjectIcon(r.subject || r.title), allDay:false }));
    return [...calendarRows, ...schoolRows].sort((a,b)=>a.start.getTime()-b.start.getTime());
  }

  function personStatus(personName: string) {
    const rows = planForPerson(personName);
    const active = rows.find((o) => !o.allDay && o.start <= now && o.end > now);
    if (active) return `${active.icon} ${active.title} do ${formatTime(active.end)}`;
    const next = rows.find((o) => o.start > now);
    if (next) return `${next.icon} ${next.title} ${formatTime(next.start)}`;
    return '🟢 Wolny';
  }

  return (
    <div className="page-content start-dashboard-page start-v130">
      <section className="start-top-row">
        <div className="family-quick-strip" aria-label="Profile rodziny">
          {members.slice(0, 5).map((person) => (
            <button key={person.id} className="quick-person" type="button" onClick={() => goTo('Rodzina')} title={`Profil: ${person.name}`}>
              <span className="quick-avatar">{person.photoURL ? <img src={person.photoURL} alt="" /> : memberEmoji(person.name)}</span>
              <span title="Aktywne konto" aria-label="Aktywne konto" className={`online-dot ${person.active ? 'on' : ''}`} />
              <strong>{person.name}</strong><small>{personRole(person.name, person.role)}</small>
            </button>
          ))}
        </div>
        <div className="start-weather" title="Pogoda: Open-Meteo">
          <span className="weather-icon">{weather?.icon || '🌤️'}</span>
          <div className="weather-main"><strong>Kołobrzeg</strong><b>{weather ? `${weather.temp}°C` : '—°C'}</b><small>{weather?.label || 'Pobieranie pogody…'}</small></div>
          <div className="weather-side">
            <div className="weather-date"><strong>{capitalize(new Date().toLocaleDateString('pl-PL', { weekday: 'long' }))}</strong><small>{new Date().toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}</small></div>
            {weather && <div className="weather-details"><span>↑ {weather.max}°C</span><span>↓ {weather.min}°C</span><span>≋ {weather.wind} km/h</span></div>}
          </div>
        </div>
      </section>

      <section className="start-welcome-banner">
        <div className="start-welcome-copy"><h1>Cześć, <span>{name}!</span> 👋</h1><p>Miło Cię znowu widzieć.<br />Dobrego dnia dla całej rodziny!</p></div>
      </section>

      <section className="family-free-banner">
        <div><span className="free-family-icon">👨‍👩‍👧‍👦</span><div><small>Rodzinny czas</small><strong>Wszyscy wolni od {allFreeAt}</strong><p>Liczymy sztywne godziny zakończenia pracy, szkoły i zajęć.</p></div></div>
        <button onClick={() => goTo('Kalendarz')}>Pełny plan dnia ›</button>
      </section>

      <section className="today-people-grid">
        {members.slice(0, 5).map((person) => {
          const personEvents = planForPerson(person.name).slice(0, 5);
          return <article className="today-person-card" key={person.id} style={{ borderTopColor: personColor(person.name as PersonKey) }}>
            <header><span className="mini-avatar">{person.photoURL ? <img src={person.photoURL} alt="" /> : memberEmoji(person.name)}</span><div><strong>{person.name}</strong><small>{personStatus(person.name)}</small></div></header>
            <div className="mini-timeline">
              {personEvents.length === 0 ? <p>Brak zaplanowanych zajęć</p> : personEvents.map((o) => <div key={o.key}><time>{o.allDay ? 'Cały dzień' : `${formatTime(o.start)}–${formatTime(o.end)}`}</time><span>{o.icon} {o.title}</span></div>)}
            </div>
          </article>;
        })}
      </section>

      <section className="home-focus-grid home-focus-grid-v130">
        <article className="focus-card">
          <header><div><span className="focus-title-icon purple">✓</span><strong>Najważniejsze zadania</strong></div><button onClick={() => goTo('Zadania')}>Zobacz wszystkie ›</button></header>
          <div className="focus-list">
            {priorityTasks.length === 0 ? <p className="focus-empty">Brak pilnych zadań — super! ✨</p> : priorityTasks.map((item) => (
              <button className="focus-row" key={item.id} onClick={() => goTo('Zadania')}>
                <span className="focus-check" />
                <span className="focus-main"><strong>{item.title}</strong><small>{personLabel(item.person)}{item.points ? ` · +${item.points} pkt` : ''}</small></span>
                <span className="focus-meta">{item.dueDate ? formatShortDate(item.dueDate) : item.priority === 'high' ? 'Pilne' : 'Bez terminu'}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="focus-card">
          <header><div><span className="focus-title-icon pink">📅</span><strong>Nadchodzące wydarzenia</strong></div><button onClick={() => goTo('Kalendarz')}>Zobacz wszystkie ›</button></header>
          <div className="focus-list">
            {upcomingEvents.length === 0 ? <p className="focus-empty">Brak nadchodzących wydarzeń.</p> : upcomingEvents.map((occurrence) => {
              const completed = sameDay(occurrence.date, now) && occurrence.endDate < now;
              return <button className={`focus-row event-focus-row ${completed ? 'completed-today' : ''}`} key={occurrence.key} onClick={() => goTo('Kalendarz')}>
                <span className="date-badge"><b>{occurrence.date.getDate()}</b><small>{occurrence.date.toLocaleDateString('pl-PL', { month: 'short' }).replace('.', '').toUpperCase()}</small></span>
                <span className="focus-main"><strong>{occurrence.source.title}</strong><small>{occurrence.source.allDay ? 'Cały dzień' : `${formatTime(occurrence.date)}–${formatTime(occurrence.endDate)}`} · {personLabel(occurrence.source.person)}</small></span>
                <span className="focus-meta">{completed ? '✓ Zakończone' : '›'}</span>
              </button>;
            })}
          </div>
        </article>

        <article className="focus-card shopping-preview-card">
          <header><div><span className="focus-title-icon orange">🛒</span><strong>Lista zakupów</strong></div><button onClick={() => goTo('Zakupy')}>Pokaż więcej ›</button></header>
          <div className="focus-list">
            {openShopping.length === 0 ? <p className="focus-empty">Lista zakupów jest pusta.</p> : openShopping.map((item) => <button className="focus-row" key={item.id} onClick={() => goTo('Zakupy')}><span>{SHOPPING_META[item.category].icon}</span><span className="focus-main"><strong>{item.title}</strong><small>{SHOPPING_META[item.category].label}</small></span><span className="focus-meta">{item.quantity} {item.unit}</span></button>)}
          </div>
        </article>
      </section>
    </div>
  );
}

/* =========================================================
   SHARED UI
   ========================================================= */

function ModuleHeader({ icon: _icon, title, text, action }: { icon: string; title: string; text: string; action?: React.ReactNode }) {
  const pageIcon = (['Kalendarz','Zadania','Zakupy','Czat','Zdrowie','Szkoła','Rodzina','Ustawienia'] as Page[]).includes(title as Page) ? title as Page : 'Start';
  return (
    <section className="page-header compact-header">
      <div className="module-heading"><span className="module-title-icon"><AppIcon page={pageIcon} size={20} /></span><div><small>Nasza Rodzina</small><h1>{title}</h1><p>{text}</p></div></div>
      {action}
    </section>
  );
}

function PersonSelect({ value, onChange, includeFamily = true, schoolOnly = false, allowed }: { value: PersonKey; onChange: (v: PersonKey) => void; includeFamily?: boolean; schoolOnly?: boolean; allowed?: PersonKey[] }) {
  const options: PersonKey[] = allowed || (schoolOnly ? ['Paweł', 'Nikodem'] : (includeFamily ? PEOPLE : PEOPLE.filter((p) => p !== 'family')));
  return (
    <select aria-label="Osoba" value={value} onChange={(e) => isPersonKey(e.target.value) && onChange(e.target.value)}>
      {options.map((person) => <option key={person} value={person}>{personLabel(person)}</option>)}
    </select>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return <div className="empty-state"><span>{icon}</span><p>{text}</p></div>;
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const element = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const titleId = React.useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.current?.focus();
    function keyboard(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key !== 'Tab') return;
      const options = Array.from(element.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter(node=>node.getClientRects().length);
      if (!options.length) { e.preventDefault(); return; }
      const first = options[0], last = options[options.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === element.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === element.current)) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={element} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`modal-card ${wide ? 'wide' : ''}`}>
        <header className="modal-header"><div><small>{subtitle || 'Nasza Rodzina'}</small><h2 id={titleId}>{title}</h2></div><button type="button" onClick={onClose} aria-label="Zamknij">✕</button></header>
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

function CalendarPage({ user, member, goTo }: { user: User; member: Member | null; goTo: (page:Page)=>void }) {
  const [view, setView] = useState<CalendarView>('week');
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEventData[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonKey>('family');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EventForm>(() => createDefaultEventForm(new Date()));
  const [saving, setSaving] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventData | null>(null);
  const [selectedOccurrenceDate, setSelectedOccurrenceDate] = useState<Date | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EventForm>(() => createDefaultEventForm(new Date()));
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingEventId = useRef<string | null>(null);

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
    setSelectedEvent((current) => current ? loaded.find((item) => item.id === current.id) || (snapshot.metadata.hasPendingWrites || deletingEventId.current === current.id ? current : null) : null);
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
    const todayStart = startOfDay(now);
    const futureEnd = endOfDay(addDays(now, 30));
    return events
      .filter((event) => selectedPerson === 'family' || event.person === selectedPerson || event.person === 'family')
      .flatMap((event) => generateOccurrences(event, todayStart, futureEnd))
      .filter((item) => item.date >= todayStart)
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

  function openEvent(event: CalendarEventData, occurrenceDate = event.date) {
    setSelectedOccurrenceDate(occurrenceDate);
    setSelectedEvent(event);
    setEditing(false);
    setEditForm(eventToForm(event));
  }

  async function saveEvent(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const dates = buildEventDates(form);
    if (!form.title.trim() || !dates) return;
    if (form.repeatUntil && form.repeatUntil < form.date) { notify('Koniec powtarzania nie może być przed wydarzeniem.', 'error'); return; }
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
    if (updating) return;
    const dates = buildEventDates(editForm);
    if (!editForm.title.trim() || !dates) return;
    if (editForm.repeatUntil && editForm.repeatUntil < editForm.date) { notify('Koniec powtarzania nie może być przed wydarzeniem.', 'error'); return; }
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
    deletingEventId.current = selectedEvent.id;
    try {
      await deleteDoc(doc(db, 'calendarEvents', selectedEvent.id));
      setSelectedEvent(null);
    } catch (error) {
      console.error(error); alert('Nie udało się usunąć wydarzenia.');
    } finally { deletingEventId.current = null; setDeleting(false); }
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
                const dayItems = occurrences.filter((item) => item.date <= endOfDay(day) && item.endDate >= startOfDay(day));
                return (
                  <div className={`calendar-week-day ${sameDay(day, new Date()) ? 'today' : ''}`} key={formatDateInput(day)}>
                    <button className="calendar-day-heading" type="button" onClick={() => { setFocusDate(day); setView('day'); }}><span>{capitalize(day.toLocaleDateString('pl-PL', { weekday: 'short' }))}</span><strong>{day.getDate()}</strong></button>
                    <button className="calendar-plus" type="button" onClick={() => openNewEvent(day)}>＋</button>
                    <div className="calendar-day-events">
                      {dayItems.length === 0 && <small className="muted">Brak wydarzeń</small>}
                      {dayItems.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => openEvent(item.source, item.date)} />)}
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

      <section className="calendar-lower-grid">
        <article className="calendar-lower-card"><header><strong>⏭️ Nadchodzące wydarzenia</strong></header>{upcomingOccurrences.slice(0,4).map((item) => { const done=sameDay(item.date,new Date())&&item.endDate<new Date(); return <button key={item.key} className={done?'completed-today':''} onClick={()=>openEvent(item.source, item.date)}><span>{eventActivityIcon(item.source.title)}</span><div><strong>{item.source.title}</strong><small>{item.date.toLocaleDateString('pl-PL')} · {item.source.allDay?'Cały dzień':`${formatTime(item.date)}–${formatTime(item.endDate)}`}</small></div><em>{done?'✓ Zakończone':'›'}</em></button>; })}</article>
        <article className="calendar-lower-card"><header><strong>🔔 Twoje przypomnienia</strong></header><p>Sprawdź nadchodzące wydarzenia tutaj, a przypomnienia o lekach w zakładce Zdrowie.</p><button className="secondary-button" onClick={()=>goTo('Ustawienia')}>Ustawienia przypomnień</button></article>
        <article className="calendar-lower-card"><header><strong>⚡ Szybkie akcje</strong></header><div className="calendar-actions"><button onClick={()=>openNewEvent(new Date())}>＋ Wydarzenie</button><button onClick={()=>openNewEvent(new Date(),'12:00',true)}>☀️ Cały dzień</button><button onClick={()=>setFocusDate(new Date())}>📍 Dzisiaj</button></div></article>
      </section>
      <section className="connected-calendars-footer"><header><div><strong>🔗 Połączone kalendarze</strong><small>Nasza Rodzina jest kalendarzem domyślnym.</small></div></header><div><span className="connected active">● Nasza Rodzina</span><span>Google Calendar — do połączenia</span><span>Apple / iCloud — ICS</span><span>Outlook — do połączenia</span></div></section>

      {showForm && (
        <Modal title="➕ Nowe wydarzenie" subtitle="Kalendarz" onClose={() => setShowForm(false)} wide>
          <EventFormFields allowed={isParent(member) ? undefined : ['family', ownPerson(member)]} form={form} setForm={setForm} onSubmit={saveEvent} buttonText={saving ? 'Zapisywanie…' : '✓ Zapisz wydarzenie'} disabled={saving} onCancel={() => setShowForm(false)} />
        </Modal>
      )}

      {selectedEvent && (
        <Modal title={selectedEvent.title} subtitle={selectedEvent.repeat !== 'none' ? 'Wydarzenie cykliczne — edytujesz całą serię' : 'Wydarzenie'} onClose={() => setSelectedEvent(null)} wide>
          {!editing ? (
            <>
              <div className="details-grid">
                <DetailRow label="Osoba" value={personLabel(selectedEvent.person)} />
                <DetailRow label="Termin wydarzenia" value={capitalize((selectedOccurrenceDate || selectedEvent.date).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} />
                <DetailRow label="Godzina" value={selectedEvent.allDay ? 'Cały dzień' : `${formatTime(selectedEvent.date)} – ${formatTime(selectedEvent.endDate)}`} />
                <DetailRow label="Powtarzanie" value={repeatLabel(selectedEvent.repeat)} />
                {selectedEvent.repeatUntil && <DetailRow label="Powtarzaj do" value={selectedEvent.repeatUntil.toLocaleDateString('pl-PL')} />}
                {selectedEvent.description && <DetailRow label="Notatka" value={selectedEvent.description} />}
              </div>
              <div className="modal-actions">{(isParent(member) || selectedEvent.createdBy === user.uid) && <><button className="secondary-button" onClick={() => setEditing(true)}>✏️ Edytuj</button><button className="danger-button" onClick={removeEvent} disabled={deleting}>{deleting ? 'Usuwanie…' : '🗑️ Usuń'}</button></>}</div>
            </>
          ) : (
            <EventFormFields allowed={isParent(member) ? undefined : ['family', ownPerson(member)]} form={editForm} setForm={setEditForm} onSubmit={updateEvent} buttonText={updating ? 'Zapisywanie…' : '✓ Zapisz zmiany'} disabled={updating} onCancel={() => setEditing(false)} />
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

function EventFormFields({ form, setForm, onSubmit, buttonText, disabled, onCancel, allowed }: { form: EventForm; setForm: React.Dispatch<React.SetStateAction<EventForm>>; onSubmit: (e: React.FormEvent) => void; buttonText: string; disabled: boolean; onCancel?: () => void; allowed?: PersonKey[] }) {
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
      <label className="field"><span>Powtarzanie</span><select aria-label="Powtarzanie" value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as RepeatType, repeatUntil: e.target.value === 'none' ? '' : f.repeatUntil }))}><option value="none">Nie powtarzaj</option><option value="daily">Codziennie</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option><option value="yearly">Co rok</option></select></label>
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

function CalendarDay({ date, occurrences, onOpen, onAdd }: { date: Date; occurrences: CalendarOccurrence[]; onOpen: (event: CalendarEventData, occurrenceDate?: Date) => void; onAdd: (date?: Date, time?: string, allDay?: boolean) => void }) {
  const dayItems = occurrences.filter((item) => item.date <= endOfDay(date) && item.endDate >= startOfDay(date));
  const allDay = dayItems.filter((item) => item.source.allDay);
  const timed = dayItems.filter((item) => !item.source.allDay);
  return (
    <section className="calendar-day-view">
      <div className="calendar-day-title"><div className="big-date">{date.getDate()}</div><div><strong>{capitalize(date.toLocaleDateString('pl-PL', { weekday: 'long' }))}</strong><span>{capitalize(date.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }))}</span></div><button className="secondary-button" onClick={() => onAdd(date, '12:00', true)}>＋ Cały dzień</button></div>
      <div className="all-day-row"><span>Cały dzień</span><div>{allDay.length === 0 ? <small className="muted">Brak wydarzeń</small> : allDay.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date)} />)}</div></div>
      <div className="hours-list">
        {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
          const items = timed.filter((item) => (sameDay(item.date, date) ? item.date.getHours() : 0) === hour);
          return <div className="hour-row" key={hour}><span>{String(hour).padStart(2, '0')}:00</span><div><button type="button" className="hour-add" onClick={() => onAdd(date, `${String(hour).padStart(2, '0')}:00`)}>＋</button>{items.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date)} />)}</div></div>;
        })}
      </div>
    </section>
  );
}

function CalendarMonth({ focusDate, days, occurrences, onOpen, onAdd, onDay }: { focusDate: Date; days: Date[]; occurrences: CalendarOccurrence[]; onOpen: (event: CalendarEventData, occurrenceDate?: Date) => void; onAdd: (date?: Date) => void; onDay: (date: Date) => void }) {
  return (
    <section className="calendar-month-card">
      <div className="month-grid month-head">{['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'].map((name) => <div key={name}>{name}</div>)}</div>
      <div className="month-grid">
        {days.map((day) => {
          const items = occurrences.filter((item) => item.date <= endOfDay(day) && item.endDate >= startOfDay(day));
          return (
            <div key={formatDateInput(day)} className={`month-day ${day.getMonth() !== focusDate.getMonth() ? 'dim' : ''} ${sameDay(day, new Date()) ? 'today' : ''}`}>
              <div className="month-day-top"><button type="button" onClick={() => onDay(day)}>{day.getDate()}</button><button type="button" onClick={() => onAdd(day)}>＋</button></div>
              <div className="month-events">{items.slice(0, 3).map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date)} />)}{items.length > 3 && <button className="more-link" type="button" onClick={() => onDay(day)}>+{items.length - 3} więcej</button>}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CalendarSide({ today, upcoming, onOpen }: { today: CalendarOccurrence[]; upcoming: CalendarOccurrence[]; onOpen: (event: CalendarEventData, occurrenceDate?: Date) => void }) {
  return (
    <aside className="calendar-side">
      <section><h3>📍 Dzisiaj</h3>{today.length === 0 ? <p className="muted">Brak wydarzeń.</p> : today.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date)} />)}</section>
      <section><h3>⏭️ Nadchodzące</h3>{upcoming.length === 0 ? <p className="muted">Nic w najbliższych 30 dniach.</p> : upcoming.map((item) => <CalendarEventButton key={item.key} occurrence={item} onClick={() => onOpen(item.source, item.date)} />)}</section>
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

function TasksPage({ user, member }: { user: User; member: Member | null }) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [form, setForm] = useState<TaskForm>({ title: '', person: 'family', dueDate: '', priority: 'normal', note: '', points: 5, requireApproval: true, repeat: 'none' });
  const [filter, setFilter] = useState<'all' | 'today' | 'upcoming' | 'pending' | 'done'>('all');
  const parent = isParent(member);
  const [savingTask, setSavingTask] = useState(false);
  const taskSavingRef = useRef(false);
  const today = formatDateInput(new Date());

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

  const visible = items.filter((item) => {
    if (filter === 'today') return !item.done && item.dueDate === today;
    if (filter === 'upcoming') return !item.done && !!item.dueDate && item.dueDate > today;
    if (filter === 'pending') return item.approvalStatus === 'pending';
    if (filter === 'done') return item.done;
    return true;
  });

  const pointsByPerson = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of items) {
      if (item.done && (item.approvalStatus === 'approved' || !item.requireApproval)) result[item.person] = (result[item.person] || 0) + item.points;
    }
    return result;
  }, [items]);

  function openAdd(template?: string) {
    setEditing(null);
    setForm({ title: template || '', person: parent ? 'family' : ownPerson(member), dueDate: today, priority: 'normal', note: '', points: 5, requireApproval: true, repeat: 'none' });
    setShowForm(true);
  }
  function openEdit(item: TaskItem) {
    setEditing(item);
    setForm({ title: item.title, person: item.person, dueDate: item.dueDate, priority: item.priority, note: item.note, points: item.points, requireApproval: item.requireApproval, repeat: item.repeat });
    setShowForm(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim() || taskSavingRef.current) return;
    if (!parent && form.person !== ownPerson(member) && form.person !== 'family') { notify('Możesz przypisać zadanie sobie lub całej rodzinie.', 'error'); return; }
    taskSavingRef.current = true; setSavingTask(true);
    try {
      const payload = { ...form, title:form.title.trim(), points:parent ? Math.min(500, Math.max(0, Number(form.points || 0))) : 0, requireApproval:parent ? form.requireApproval : true, updatedAt:Timestamp.now() };
      if (editing) await updateDoc(doc(db, 'tasks', editing.id), payload);
      else await addDoc(collection(db,'tasks'), { ...payload, done:false, approvalStatus:'none', createdBy:user.uid, createdAt:Timestamp.now() });
      setShowForm(false);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { taskSavingRef.current = false; setSavingTask(false); }
  }

  async function completeTask(item: TaskItem) {
    const target = doc(db, 'tasks', item.id);
    const nextTarget = doc(collection(db, 'tasks'));
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(target);
      if (!snapshot.exists() || snapshot.data().done === true) return;
      const raw = snapshot.data();
      const changes: Record<string, unknown> = { done:true, approvalStatus:raw.requireApproval ? 'approved' : 'none', completedAt:Timestamp.now(), updatedAt:Timestamp.now() };
      if (parent && raw.repeat !== 'none' && !raw.nextTaskId) {
        const base = new Date(`${raw.dueDate || today}T12:00:00`);
        let nextDate = raw.repeat === 'daily' ? addDays(base, 1) : raw.repeat === 'weekly' ? addDays(base, 7) : addMonths(base, 1);
        const anchorDay = Number(raw.repeatAnchorDay || base.getDate());
        if (raw.repeat === 'monthly') { nextDate.setDate(1); nextDate.setDate(Math.min(anchorDay, new Date(nextDate.getFullYear(),nextDate.getMonth()+1,0).getDate())); }
        const { nextTaskId, ...original } = raw;
        transaction.set(nextTarget, { ...original, repeatAnchorDay:anchorDay, dueDate:formatDateInput(nextDate), done:false, approvalStatus:'none', completedAt:null, createdBy:user.uid, createdAt:Timestamp.now(), updatedAt:Timestamp.now() });
        changes.nextTaskId = nextTarget.id;
      }
      transaction.update(target, changes);
    });
  }

  async function toggleDone(item: TaskItem) {
    if (!parent && item.person !== 'family' && item.person !== ownPerson(member)) return;
    if (item.done) {
      if (!parent) return;
      await updateDoc(doc(db, 'tasks', item.id), { done:false, approvalStatus:'none', completedAt:null, updatedAt:Timestamp.now() });
    } else if (item.requireApproval && !parent) {
      await updateDoc(doc(db, 'tasks', item.id), { approvalStatus:'pending', updatedAt:Timestamp.now() });
    } else await completeTask(item);
  }

  async function approve(item: TaskItem) { if (parent) await completeTask(item); }
  async function reject(item: TaskItem) {
    await updateDoc(doc(db, 'tasks', item.id), { done: false, approvalStatus: 'none', updatedAt: Timestamp.now() });
  }

  return (
    <div className="page-content compact-page tasks-v130">
      <ModuleHeader icon="✅" title="Zadania" text="Obowiązki, szybkie zadania, punkty i nagrody." action={<button className="primary-button" onClick={() => openAdd()}>＋ Dodaj zadanie</button>} />

      <section className="task-summary-v130">
        <button onClick={() => setFilter('today')}><strong>{items.filter((i) => !i.done && i.dueDate === today).length}</strong><span>Dzisiaj</span></button>
        <button onClick={() => setFilter('pending')}><strong>{items.filter((i) => i.approvalStatus === 'pending').length}</strong><span>Do zatwierdzenia</span></button>
        <button onClick={() => setFilter('done')}><strong>{items.filter((i) => i.done).length}</strong><span>Wykonane</span></button>
        <button className="points-card"><strong>⭐ {Object.values(pointsByPerson).reduce((a, b) => a + b, 0)}</strong><span>Punkty razem</span></button>
      </section>

      <section className="quick-task-section">
        <header><div><strong>⚡ Szybkie zadania</strong><small>Kliknij gotowiec i wybierz osobę, termin oraz punkty.</small></div></header>
        <div className="quick-task-grid">{TASK_TEMPLATES.map(([icon, title]) => <button key={title} onClick={() => openAdd(title)}><span>{icon}</span><strong>{title}</strong></button>)}</div>
      </section>

      <div className="tasks-main-grid">
        <section>
          <div className="task-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Wszystkie</button><button className={filter === 'today' ? 'active' : ''} onClick={() => setFilter('today')}>Dzisiaj</button><button className={filter === 'upcoming' ? 'active' : ''} onClick={() => setFilter('upcoming')}>Nadchodzące</button><button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Do zatwierdzenia</button><button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>Wykonane</button></div>
          <section className="module-list compact-list">
            {visible.length === 0 ? <EmptyState icon="✨" text="Brak zadań w tym widoku." /> : visible.map((item) => (
              <article className={`module-row task-row task-row-v130 ${item.done ? 'done' : ''} ${item.approvalStatus === 'pending' ? 'pending' : ''}`} key={item.id}>
                <button className="check-button" aria-label={`Oznacz wykonanie: ${item.title}`} disabled={!parent && (item.done || (item.person !== 'family' && item.person !== ownPerson(member)))} onClick={() => void toggleDone(item)}>{item.done ? '✓' : item.approvalStatus === 'pending' ? '⌛' : '○'}</button>
                <div className="row-main"><strong>{item.title}</strong><small>{personLabel(item.person)} · {item.dueDate ? formatShortDate(item.dueDate) : 'bez terminu'}{item.repeat !== 'none' ? ` · ${item.repeat === 'daily' ? 'codziennie' : item.repeat === 'weekly' ? 'co tydzień' : 'co miesiąc'}` : ''}</small></div>
                <span className={`priority-badge ${item.priority}`}>{item.priority === 'high' ? 'Ważne' : item.priority === 'low' ? 'Niski' : 'Normalny'}</span>
                {item.points > 0 && <span className="task-points">+{item.points} pkt</span>}
                {parent && item.approvalStatus === 'pending' ? <div className="approval-actions"><button onClick={() => void approve(item)}>✓ Zatwierdź</button><button onClick={() => void reject(item)}>✕ Odrzuć</button></div> : null}
                {parent && <button className="icon-button" onClick={() => openEdit(item)}>✏️</button>}
                {parent && <button className="icon-danger" aria-label={`Usuń zadanie: ${item.title}`} onClick={() => { if (confirm(`Usunąć zadanie „${item.title}”?`)) void deleteDoc(doc(db, 'tasks', item.id)); }}>🗑️</button>}
              </article>
            ))}
          </section>
        </section>

        <aside className="points-panel">
          <header><strong>🏆 Punkty i nagrody</strong><small>100 pkt = nagroda</small></header>
          {(['Nikodem', 'Paweł'] as PersonKey[]).map((person) => {
            const points = pointsByPerson[person] || 0;
            const progress = points % 100;
            return <article key={person}><div><span className="points-avatar">{memberEmoji(person)}</span><div><strong>{person}</strong><small>{points} pkt</small></div></div><div className="reward-progress"><span style={{ width: `${progress}%` }} /><em>{progress}/100</em></div></article>;
          })}
          <div className="reward-box"><span>🎁</span><div><strong>Nagroda przy 100 pkt</strong><small>Rodzice ustalają nagrodę razem z dzieckiem.</small></div></div>
          <small className="points-note">Punkty za zadanie może ustawić tylko rodzic. Przy zadaniach z zatwierdzeniem punkty wpadają dopiero po akceptacji.</small>
        </aside>
      </div>

      {showForm && <Modal title={editing ? '✏️ Edytuj zadanie' : '➕ Nowe zadanie'} onClose={() => setShowForm(false)} wide>
        <form className="form-grid" onSubmit={save}>
          <label className="field field-wide"><span>Zadanie</span><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Np. wyrzucić śmieci…" required /></label>
          <label className="field"><span>Osoba</span><PersonSelect allowed={parent ? undefined : ['family', ownPerson(member)]} value={form.person} onChange={(person) => setForm((f) => ({ ...f, person }))} /></label>
          <label className="field"><span>Termin</span><input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} /></label>
          <label className="field"><span>Priorytet</span><select aria-label="Priorytet" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}><option value="low">Niski</option><option value="normal">Normalny</option><option value="high">Ważne</option></select></label>
          <label className="field"><span>Powtarzanie</span><select aria-label="Powtarzanie" value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as TaskRepeat }))}><option value="none">Nie powtarzaj</option><option value="daily">Codziennie</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option></select></label>
          {parent && <label className="field"><span>Punkty za zadanie</span><div className="point-picker">{[5,10,15,20].map((p) => <button type="button" key={p} className={form.points === p ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, points: p }))}>{p}</button>)}<input type="number" min="0" max="500" value={form.points} onChange={(e) => setForm((f) => ({ ...f, points: Number(e.target.value) }))} /></div></label>}
          {parent && <label className="checkbox-field field-wide"><input type="checkbox" checked={form.requireApproval} onChange={(e) => setForm((f) => ({ ...f, requireApproval: e.target.checked }))} /><span>Wymaga zatwierdzenia rodzica po wykonaniu</span></label>}
          <label className="field field-wide"><span>Notatka</span><textarea rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Opcjonalnie…" /></label>
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Anuluj</button><button className="primary-button" disabled={savingTask}>{savingTask ? "Zapisuję…" : "✓ Zapisz"}</button></div>
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
  const [editingQuick, setEditingQuick] = useState<QuickProduct | null>(null);
  const [quickMenu, setQuickMenu] = useState<QuickProduct | null>(null);
  const [quickForm, setQuickForm] = useState({ title:'', category:'inne' as ShoppingCategory, quantity:'1', unit:'szt.', imageURL:'', icon:'📦' });
  const holdTimer = useRef<number | null>(null);
  const adult = isAdultMember(member);
  const [addingShopping, setAddingShopping] = useState(false);
  const shoppingSavingRef = useRef(false);
  const quickSavingRef = useRef(false);
  const [savingQuick, setSavingQuick] = useState(false);
  const quickInflight = useRef(new Set<string>());

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
    return merged.filter((p) => !p.hidden && (!p.adultOnly || adult) && (quickCategory === 'all' || p.category === quickCategory));
  }, [customQuick, adult, quickCategory]);

  async function addItem(productTitle: string, qty = '1', productUnit = 'szt.', category?: ShoppingCategory) {
    const clean = productTitle.trim(); if (!clean) return;
    await addDoc(collection(db, 'shoppingItems'), { title: clean, done: false, category: category || categorizeProduct(clean), quantity: qty, unit: productUnit, createdBy: user.uid, createdAt: Timestamp.now() });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim() || shoppingSavingRef.current) return;
    shoppingSavingRef.current = true; setAddingShopping(true);
    try { await addItem(title, quantity.trim(), unit, categoryChoice === 'auto' ? categorizeProduct(title) : categoryChoice); setTitle(''); setQuantity('1'); setUnit('szt.'); setCategoryChoice('auto'); }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { shoppingSavingRef.current = false; setAddingShopping(false); }
  }

  async function addQuick(product: QuickProduct) {
    if (quickInflight.current.has(product.id)) return;
    quickInflight.current.add(product.id);
    try { await addItem(product.title, product.defaultQuantity, product.defaultUnit, product.category); notify(`Dodano: ${product.title}`); }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { quickInflight.current.delete(product.id); }
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
    if (!products.length || shoppingSavingRef.current) return;
    if (products.length > 200) { notify('Dodaj maksymalnie 200 produktów naraz.', 'error'); return; }
    shoppingSavingRef.current = true; setAddingShopping(true);
    try {
      const batch = writeBatch(db);
      for (const product of products) batch.set(doc(collection(db,'shoppingItems')), { title:product, done:false, category:categorizeProduct(product), quantity:'1', unit:'szt.', createdBy:user.uid, createdAt:Timestamp.now() });
      await batch.commit(); setQuickNote('');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { shoppingSavingRef.current = false; setAddingShopping(false); }
  }

  const grouped = useMemo(() => {
    const order = Object.keys(SHOPPING_META) as ShoppingCategory[];
    return order.map((category) => ({ category, items: items.filter((item) => item.category === category) })).filter((group) => group.items.length > 0);
  }, [items]);

  async function clearDone() {
    const done = items.filter((item) => item.done);
    if (done.length === 0) return;
    if (!window.confirm(`Usunąć kupione produkty (${done.length})?`)) return;
    for (let i=0; i<done.length; i+=400) { const batch = writeBatch(db); done.slice(i,i+400).forEach(item=>batch.delete(doc(db,'shoppingItems',item.id))); await batch.commit(); }
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

  async function uploadQuickImage(file: File) {
    if (file.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { notify('Wybierz zdjęcie JPG, PNG, WebP lub GIF do 5 MB.', 'error'); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const target = storageRef(storage, `quick-products/${user.uid}/${Date.now()}-${safeName}`);
    await uploadBytes(target, file);
    const url = await getDownloadURL(target);
    setQuickForm((f) => ({ ...f, imageURL:url }));
  }

  async function saveQuick(e: React.FormEvent) {
    e.preventDefault(); if (!editingQuick || !quickForm.title.trim() || quickSavingRef.current) return;
    quickSavingRef.current = true; setSavingQuick(true);
    try {
    await setDoc(doc(db, 'quickProducts', editingQuick.id), { title:quickForm.title.trim(), category:quickForm.category, defaultQuantity:quickForm.quantity || '1', defaultUnit:quickForm.unit || 'szt.', imageURL:quickForm.imageURL, icon:quickForm.icon || '📦', adultOnly:editingQuick.adultOnly === true, custom:editingQuick.custom === true || !DEFAULT_QUICK_PRODUCTS.some((p) => p.id === editingQuick.id), hidden:false, updatedAt:Timestamp.now() }, { merge:true });
    setEditingQuick(null);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { quickSavingRef.current = false; setSavingQuick(false); }
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
      <ModuleHeader icon="🛒" title="Zakupy" text="Szybkie kafelki, notatka wielu produktów i jedna wspólna lista." action={items.some((i) => i.done) ? <button className="secondary-button" onClick={clearDone}>🧹 Usuń kupione</button> : undefined} />

      <form className="shopping-bar" onSubmit={add}>
        <input className="shopping-product" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Np. jabłka, mleko, bułki…" />
        <input className="shopping-quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Ilość" />
        <select aria-label="Jednostka" value={unit} onChange={(e) => setUnit(e.target.value)}><option>szt.</option><option>kg</option><option>g</option><option>l</option><option>ml</option><option>opak.</option><option>pęczek</option></select>
        <select aria-label="Kategoria produktu" value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value as 'auto' | ShoppingCategory)}><option value="auto">✨ Kategoria auto</option>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((category) => <option key={category} value={category}>{SHOPPING_META[category].icon} {SHOPPING_META[category].label}</option>)}</select>
        <button className="primary-button" disabled={addingShopping}>{addingShopping ? "Zapisuję…" : "＋ Dodaj"}</button>
      </form>

      <section className="quick-note-card"><header><strong>📝 Szybka notatka zakupowa</strong><small>Wpisz kilka rzeczy naraz — rozdzielimy je i dodamy do jednej listy.</small></header><div><textarea rows={2} value={quickNote} onChange={(e) => setQuickNote(e.target.value)} placeholder="Np. długopis, gumka, zeszyt, lampka, zegarek…" /><button className="primary-button" disabled={addingShopping} onClick={() => void addQuickNote()}>✨ Dodaj wszystkie</button></div></section>

      <section className="quick-products-card">
        <header><div><strong>⭐ Szybkie zakupy</strong><small>Długie przytrzymanie: zmień ikonkę lub edytuj produkt.</small></div><button onClick={() => openQuickEditor()}>＋ Własny produkt</button></header>
        <div className="shopping-category-chips"><button className={quickCategory === 'all' ? 'active' : ''} onClick={() => setQuickCategory('all')}>Wszystkie</button>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((cat) => <button key={cat} className={quickCategory === cat ? 'active' : ''} onClick={() => setQuickCategory(cat)}>{SHOPPING_META[cat].icon} {SHOPPING_META[cat].label}</button>)}</div>
        <div className="quick-products-grid">{quickProducts.map((product) => <button key={product.id} className="quick-product-tile" onClick={() => void addQuick(product)} onPointerDown={() => startHold(product)} onPointerUp={cancelHold} onPointerCancel={cancelHold} onContextMenu={(e) => { e.preventDefault(); setQuickMenu(product); }}><span className="quick-product-visual">{product.imageURL ? <img src={product.imageURL} alt="" /> : product.icon}</span><strong>{product.title}</strong>{product.adultOnly && <em>18+</em>}<i onClick={(e) => { e.stopPropagation(); setQuickMenu(product); }}>⋯</i></button>)}</div>
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
          <label className="field"><span>Kategoria</span><select aria-label="Kategoria" value={quickForm.category} onChange={(e) => setQuickForm((f) => ({ ...f, category:e.target.value as ShoppingCategory }))}>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((cat) => <option key={cat} value={cat}>{SHOPPING_META[cat].label}</option>)}</select></label>
          <label className="field"><span>Emoji awaryjne</span><input value={quickForm.icon} onChange={(e) => setQuickForm((f) => ({ ...f, icon:e.target.value }))} /></label>
          <label className="field"><span>Domyślna ilość</span><input value={quickForm.quantity} onChange={(e) => setQuickForm((f) => ({ ...f, quantity:e.target.value }))} /></label>
          <label className="field"><span>Jednostka</span><select aria-label="Jednostka" value={quickForm.unit} onChange={(e) => setQuickForm((f) => ({ ...f, unit:e.target.value }))}><option>szt.</option><option>kg</option><option>g</option><option>l</option><option>ml</option><option>opak.</option><option>pęczek</option></select></label>
          <label className="field field-wide"><span>Własne zdjęcie / ikonka</span><input type="file" accept="image/*" onChange={(e) => { const file=e.target.files?.[0]; if (file) void uploadQuickImage(file).catch(() => alert('Nie udało się wysłać zdjęcia. Sprawdź Firebase Storage.')); }} />{quickForm.imageURL && <img className="quick-image-preview" src={quickForm.imageURL} alt="Podgląd" />}</label>
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
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => onSnapshot(collection(db, 'members'), (snap) => {
    const next = snap.docs.map((d) => {
      const x = d.data();
      return { id:d.id, name:String(x.name || 'Rodzina'), role:personRole(String(x.name || ''), typeof x.role === 'string' ? x.role : ''), photoURL:typeof x.photoURL === 'string' ? x.photoURL : undefined, active:x.active !== false };
    }).sort((a,b) => FAMILY_ORDER.indexOf(a.name)-FAMILY_ORDER.indexOf(b.name));
    setMembers(next);
  }), []);

  useEffect(() => {
    const groups: Record<string, ChatMessage[]> = { family: [], private: [] };
    function load(group: string, snap: import('firebase/firestore').QuerySnapshot) {
      groups[group] = snap.docs.map((d): ChatMessage => {
        const x = d.data();
        return { id:d.id, text:String(x.text || ''), name:String(x.name || 'Rodzina'), uid:String(x.uid || ''), channel:String(x.channel || 'family'), createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
      });
      setMessages([...groups.family, ...groups.private].sort((a,b)=>(a.createdAt?.getTime() || 0)-(b.createdAt?.getTime() || 0)).slice(-300));
    }
    const stopFamily = onSnapshot(query(collection(db, 'familyMessages'), where('channel', '==', 'family')), snap=>load('family', snap));
    const stopPrivate = onSnapshot(query(collection(db, 'familyMessages'), where('participants', 'array-contains', user.uid)), snap=>load('private', snap));
    return () => { stopFamily(); stopPrivate(); };
  }, [user.uid]);

  const channel = mode === 'family' ? 'family' : selectedUid ? privateChannel(user.uid, selectedUid) : '';
  const visible = messages.filter((m) => m.channel === channel);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [visible.length, channel]);

  const selectedMember = members.find((m) => m.id === selectedUid);

  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim() || !channel || sendingRef.current || !navigator.onLine) return;
    sendingRef.current = true; setSending(true);
    try {
      const body = replyTo ? `↩ ${replyTo.name}: ${replyTo.text.slice(0, 60)}\n${text.trim()}` : text.trim();
      await addDoc(collection(db, 'familyMessages'), { text:body, name:member?.name || 'Rodzina', uid:user.uid, channel, participants:mode === 'private' ? [user.uid, selectedUid].sort() : [], createdAt:Timestamp.now() });
      setText(''); setReplyTo(null);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { sendingRef.current = false; setSending(false); }
  }

  async function removeMessage(message: ChatMessage) {
    if (message.uid !== user.uid && !(isParent(member) && message.channel === 'family')) return;
    await deleteDoc(doc(db, 'familyMessages', message.id));
    setMessageMenu(null);
  }

  const lastForChannel = (uid: string) => {
    const ch = privateChannel(user.uid, uid);
    return [...messages].reverse().find((m) => m.channel === ch);
  };

  return (
    <div className="page-content compact-page chat-page chat-v130">
      <ModuleHeader icon="💬" title="Czat" text="Czat rodzinny i prywatne rozmowy 1:1." />
      <section className="chat-layout-v130">
        <aside className="chat-conversations">
          <div className="chat-mode-tabs"><button className={mode === 'family' ? 'active' : ''} onClick={() => { setMode('family'); setSelectedUid(''); }}>Rodzina</button><button className={mode === 'private' ? 'active' : ''} onClick={() => setMode('private')}>Prywatne</button></div>
          {mode === 'family' ? <button className="conversation-row active"><span className="conversation-group-avatar">👨‍👩‍👧‍👦</span><div><strong>Czat rodzinny</strong><small>{[...messages].reverse().find((m) => m.channel === 'family')?.text || 'Wspólna rozmowa całej rodziny'}</small></div></button> : <div className="private-list">{members.filter((m) => m.id !== user.uid).map((person) => { const last=lastForChannel(person.id); return <button key={person.id} className={`conversation-row ${selectedUid === person.id ? 'active' : ''}`} onClick={() => setSelectedUid(person.id)}><span className="chat-avatar">{person.photoURL ? <img src={person.photoURL} alt="" /> : memberEmoji(person.name)}</span><div><strong>{person.name}</strong><small>{last ? last.text : 'Rozpocznij rozmowę'}</small></div><time>{last?.createdAt ? formatTime(last.createdAt) : ''}</time></button>; })}</div>}
        </aside>

        <section className="chat-shell">
          <header className="chat-room-header"><span className="chat-avatar large">{mode === 'family' ? '👨‍👩‍👧‍👦' : selectedMember?.photoURL ? <img src={selectedMember.photoURL} alt="" /> : selectedMember ? memberEmoji(selectedMember.name) : '💬'}</span><div><strong>{mode === 'family' ? 'Czat rodzinny' : selectedMember?.name || 'Wybierz osobę'}</strong><small>{mode === 'family' ? members.map((m) => m.name).join(', ') : selectedMember ? `${selectedMember.role}` : 'Prywatna rozmowa 1:1'}</small></div></header>
          <div className="chat-messages">
            {!channel ? <EmptyState icon="👤" text="Wybierz osobę z listy prywatnych rozmów." /> : visible.length === 0 ? <EmptyState icon="💬" text="Napisz pierwszą wiadomość." /> : visible.map((message, index) => {
              const previous = visible[index - 1];
              const showIdentity = !previous || previous.uid !== message.uid;
              const person = members.find((m) => m.id === message.uid);
              return <div key={message.id} className={`chat-message-line ${message.uid === user.uid ? 'mine' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMessageMenu(message); }}>
                {message.uid !== user.uid && <span className={`chat-avatar ${showIdentity ? '' : 'ghost'}`}>{showIdentity ? (person?.photoURL ? <img src={person.photoURL} alt="" /> : memberEmoji(message.name)) : ''}</span>}
                <div className={`chat-bubble ${message.uid === user.uid ? 'mine' : ''}`}>{showIdentity && message.uid !== user.uid && <strong>{message.name}</strong>}<p>{message.text}</p><small>{message.createdAt ? formatTime(message.createdAt) : ''}</small><button className="message-more" onClick={() => setMessageMenu(message)}>⋯</button></div>
              </div>;
            })}
            <div ref={endRef} />
          </div>
          {replyTo && <div className="reply-banner"><span>Odpowiadasz: <strong>{replyTo.name}</strong> — {replyTo.text.slice(0,80)}</span><button onClick={() => setReplyTo(null)}>✕</button></div>}
          <form className="chat-compose" onSubmit={send}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={channel ? 'Napisz wiadomość…' : 'Najpierw wybierz rozmowę'} maxLength={4000} disabled={!channel || sending} /><button type="button" onClick={() => setText((v) => `${v} 😊`)}>😊</button><button className="primary-button" disabled={!channel || sending || !text.trim() || !navigator.onLine}>{sending ? "Wysyłanie…" : "Wyślij"}</button></form>
        </section>
      </section>

      {messageMenu && <div className="quick-product-menu-backdrop" onClick={() => setMessageMenu(null)}><div className="message-menu" onClick={(e) => e.stopPropagation()}><div className="reaction-row"><button onClick={() => setText((v) => `${v} ❤️`)}>❤️</button><button onClick={() => setText((v) => `${v} 👍`)}>👍</button><button onClick={() => setText((v) => `${v} 😂`)}>😂</button></div><button onClick={() => { setReplyTo(messageMenu); setMessageMenu(null); }}>↩ Odpowiedz</button><button onClick={() => { void navigator.clipboard?.writeText(messageMenu.text); setMessageMenu(null); }}>📋 Kopiuj</button>{(messageMenu.uid === user.uid || (isParent(member) && messageMenu.channel === 'family')) && <button className="danger" onClick={() => void removeMessage(messageMenu)}>🗑️ Usuń</button>}</div></div>}
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
  const [person, setPerson] = useState<PersonKey>('family');
  const [specialtyFilter, setSpecialtyFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const parent = isParent(member);
  const [recordType, setRecordType] = useState<HealthType | 'all'>('all');
  const [editingHealth, setEditingHealth] = useState<HealthRecord | null>(null);
  const [savingHealth, setSavingHealth] = useState(false);
  const healthSavingRef = useRef(false);
  const [savingContact, setSavingContact] = useState(false);
  const [editingContact, setEditingContact] = useState<MedicalContact | null>(null);
  const contactSavingRef = useRef(false);
  const emptyForm = (): HealthForm => ({ title: '', person: !parent ? ownPerson(member) : person === 'family' ? 'Paweł' : person, type: 'visit', date: formatDateInput(new Date()), time: '12:00', doctor: '', location: '', note: '', specialty: '', status: 'planned', referralCode: '', nextControl: '', callReminderDate: '', privateToParents: false, dose: '', medicineTime: '20:00', addToCalendar: true, file: null });
  const [form, setForm] = useState<HealthForm>(emptyForm);
  const [contactForm, setContactForm] = useState({ person:'family' as PersonKey, specialty:'', name:'', doctor:'', phone:'', address:'', note:'' });

  useEffect(() => onSnapshot(collection(db, 'members'), (snap) => {
    const next = snap.docs.map((d) => { const x=d.data(); return { id:d.id, name:String(x.name || 'Rodzina'), role:personRole(String(x.name || ''), typeof x.role === 'string' ? x.role : ''), photoURL:typeof x.photoURL === 'string' ? x.photoURL : undefined, active:x.active !== false, birthDate:typeof x.birthDate === 'string' ? x.birthDate : FAMILY_BIRTHDAYS[String(x.name || '') as PersonKey] }; }).sort((a,b)=>FAMILY_ORDER.indexOf(a.name)-FAMILY_ORDER.indexOf(b.name));
    setMembers(next);
  }), []);

  useEffect(() => onSnapshot(parent ? collection(db, 'healthRecords') : query(collection(db, 'healthRecords'), where('privateToParents', '==', false), where('person', 'in', ['family', ownPerson(member)])), (snap) => {
    const next = snap.docs.map((d): HealthRecord => {
      const x = d.data();
      return {
        id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'family', type:isHealthType(x.type) ? x.type : 'history', date:typeof x.date === 'string' ? x.date : '', time:typeof x.time === 'string' ? x.time : '', doctor:typeof x.doctor === 'string' ? x.doctor : '', location:typeof x.location === 'string' ? x.location : '', note:typeof x.note === 'string' ? x.note : '', specialty:typeof x.specialty === 'string' ? x.specialty : '', status:isHealthStatus(x.status) ? x.status : (x.type === 'visit' ? 'planned' : 'done'), referralCode:typeof x.referralCode === 'string' ? x.referralCode : '', nextControl:typeof x.nextControl === 'string' ? x.nextControl : '', callReminderDate:typeof x.callReminderDate === 'string' ? x.callReminderDate : '', documentURL:typeof x.documentURL === 'string' ? x.documentURL : '', documentPath:typeof x.documentPath === 'string' ? x.documentPath : '', privateToParents:x.privateToParents === true, dose:typeof x.dose === 'string' ? x.dose : '', medicineTime:typeof x.medicineTime === 'string' ? x.medicineTime : (typeof x.time === 'string' ? x.time : ''), confirmedDate:typeof x.confirmedDate === 'string' ? x.confirmedDate : '', createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
      };
    });
    next.sort((a,b)=>(b.date || '').localeCompare(a.date || '') || (b.createdAt?.getTime() || 0)-(a.createdAt?.getTime() || 0));
    setRecords(next);
  }), []);

  useEffect(() => onSnapshot(parent ? collection(db, 'medicalContacts') : query(collection(db, 'medicalContacts'), where('person', 'in', ['family', ownPerson(member)])), (snap) => {
    setContacts(snap.docs.map((d) => { const x=d.data(); return { id:d.id, person:isPersonKey(x.person) ? x.person : 'family', specialty:String(x.specialty || ''), name:String(x.name || ''), doctor:String(x.doctor || ''), phone:String(x.phone || ''), address:String(x.address || ''), note:String(x.note || '') }; }));
  }), []);

  useEffect(() => {
    const check = () => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      let preferences;
      try { preferences = JSON.parse(localStorage.getItem('nr-notifications') || '{}'); } catch { preferences = {}; }
      if (preferences.medicines === false) return;
      const now = new Date();
      const today = formatDateInput(now);
      records.filter((r) => r.type === 'medicine' && r.medicineTime && r.confirmedDate !== today).forEach((r) => {
        if (!(parent || r.person === member?.name)) return;
        const due = parseLocalDate(today, r.medicineTime);
        const minutes = (now.getTime()-due.getTime())/60000;
        const key = `nr-med-${r.id}-${today}-${parent ? 'parent' : 'person'}`;
        if (minutes >= 0 && minutes < 5 && !localStorage.getItem(key)) {
          new Notification(`${r.person} — czas na lek`, { body: `${r.title}${r.dose ? ` · ${r.dose}` : ''}` }); localStorage.setItem(key, '1');
        }
        if (parent && minutes >= 15 && !localStorage.getItem(`${key}-late`)) {
          new Notification(`Brak potwierdzenia leku — ${r.person}`, { body: `Sprawdź, czy ${r.title} został przyjęty.` }); localStorage.setItem(`${key}-late`, '1');
        }
      });
    };
    check(); const timer=window.setInterval(check,60000); return()=>window.clearInterval(timer);
  }, [records, parent, member?.name]);

  const allowedRecords = records.filter((r) => !r.privateToParents || parent);
  const personRecords = allowedRecords.filter((r) => person === 'family' || r.person === person);
  const visibleRecords = personRecords.filter((r) => (specialtyFilter === 'all' || r.specialty === specialtyFilter) && (recordType === 'all' || r.type === recordType));
  const upcomingVisits = personRecords.filter((r) => r.type === 'visit' && r.date && r.date >= formatDateInput(new Date()) && r.status !== 'cancelled' && r.status !== 'done').sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4);
  const medicines = personRecords.filter((r) => r.type === 'medicine');
  const history = visibleRecords.filter((r) => r.type === 'visit' || r.type === 'history' || r.type === 'result').sort((a,b)=>(b.date || '').localeCompare(a.date || '')).slice(0,8);
  const documents = personRecords.filter((r) => r.type === 'document' || r.type === 'result').slice(0,8);
  const controlItems = personRecords.filter((r) => r.nextControl || r.callReminderDate).slice(0,6);
  const visibleContacts = contacts.filter((c) => c.person === 'family' || person === 'family' || c.person === person);
  const importantPawelDocs = allowedRecords.filter((r) => r.person === 'Paweł' && r.type === 'document' && r.privateToParents).slice(0,4);

  function openAdd(type: HealthType = 'visit') { setEditingHealth(null); setForm({ ...emptyForm(), type, person: !parent ? ownPerson(member) : person === 'family' ? 'Paweł' : person, privateToParents:parent && type === 'document' }); setShowForm(true); }

  function editHealth(record: HealthRecord) {
    setEditingHealth(record);
    const { id, createdAt, confirmedDate, documentURL, documentPath, ...fields } = record;
    setForm({ ...fields, addToCalendar:false, file:null }); setShowForm(true);
  }

  async function openDocument(record: HealthRecord) {
    if (!record.documentPath) { notify('Ten plik wymaga migracji do chronionego magazynu. Instrukcja znajduje się w paczce projektu.', 'error'); return; }
    const preview = window.open('', '_blank');
    try {
      const blob = await getBlob(storageRef(storage, record.documentPath), 10 * 1024 * 1024);
      const url = URL.createObjectURL(blob);
      if (preview) { preview.opener = null; preview.location.replace(url); }
      else { const a = document.createElement('a'); a.href = url; a.download = record.title; a.click(); }
      window.setTimeout(()=>URL.revokeObjectURL(url), 60000);
    } catch (error) { preview?.close(); notify(errorMessage(error), 'error'); }
  }

  async function uploadHealthFile(file: File, recordPerson: PersonKey) {
    if (file.size > 10 * 1024 * 1024 || !['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Wybierz PDF lub zdjęcie do 10 MB.');
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g,'-');
    const path = `health/${form.privateToParents ? 'parents' : 'shared'}/${recordPerson}/${user.uid}/${Date.now()}-${safe}`;
    await uploadBytes(storageRef(storage, path), file); return path;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim() || healthSavingRef.current) return;
    if (editingHealth?.documentPath && (editingHealth.privateToParents !== form.privateToParents || editingHealth.person !== form.person) && !form.file) { notify('Przy zmianie osoby lub prywatności załącz plik ponownie, aby nadać mu właściwe uprawnienia.', 'error'); return; }
    healthSavingRef.current = true; setSavingHealth(true);
    try {
      const documentPath = form.file ? await uploadHealthFile(form.file, form.person) : editingHealth?.documentPath || '';
      const { addToCalendar, file, ...record } = form;
      const batch = writeBatch(db);
      const target = editingHealth ? doc(db, 'healthRecords', editingHealth.id) : doc(collection(db, 'healthRecords'));
      const payload = { ...record, title:form.title.trim(), documentPath, documentURL:'', updatedAt:Timestamp.now() };
      if (editingHealth) batch.update(target, payload);
      else batch.set(target, { ...payload, confirmedDate:'', createdBy:user.uid, createdAt:Timestamp.now() });
      if (!editingHealth && addToCalendar && !form.privateToParents && form.type === 'visit' && form.date) {
        const start = parseLocalDate(form.date, form.time || '12:00');
        batch.set(doc(collection(db,'calendarEvents')), { title:`❤️ ${form.title.trim()}`, person:form.person, date:Timestamp.fromDate(start), endDate:Timestamp.fromDate(new Date(start.getTime()+3600000)), allDay:false, description:[form.specialty,form.doctor,form.location].filter(Boolean).join(' · '), repeat:'none', repeatUntil:null, createdBy:user.uid, createdAt:Timestamp.now() });
      }
      await batch.commit(); setShowForm(false);
      if (editingHealth?.documentPath && editingHealth.documentPath !== documentPath) {
        try { await deleteObject(storageRef(storage, editingHealth.documentPath)); } catch { notify('Zapisano wpis. Nie udało się usunąć poprzedniego pliku — administrator powinien usunąć go z magazynu.', 'error'); }
      }
    } catch (error) { notify(error instanceof Error && error.message.startsWith('Wybierz') ? error.message : errorMessage(error), 'error'); }
    finally { healthSavingRef.current = false; setSavingHealth(false); }
  }

  async function removeHealth(record: HealthRecord) {
    if (!parent || !confirm(`Usunąć wpis „${record.title}”?`)) return;
    await deleteDoc(doc(db, 'healthRecords', record.id));
    if (record.documentPath) { try { await deleteObject(storageRef(storage, record.documentPath)); } catch { notify('Usunięto wpis, lecz plik pozostał w magazynie. Administrator powinien usunąć plik.', 'error'); } }
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault(); if (!parent || !contactForm.name.trim() || contactSavingRef.current) return;
    contactSavingRef.current = true; setSavingContact(true);
    try {
      if (editingContact) await updateDoc(doc(db,'medicalContacts',editingContact.id), { ...contactForm, updatedAt:Timestamp.now() });
      else await addDoc(collection(db,'medicalContacts'), { ...contactForm, createdBy:user.uid, createdAt:Timestamp.now() });
      setShowContactForm(false);
    }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { contactSavingRef.current = false; setSavingContact(false); }
  }

  async function confirmMedicine(record: HealthRecord) { await updateDoc(doc(db,'healthRecords',record.id), { confirmedDate:formatDateInput(new Date()), updatedAt:Timestamp.now() }); }

  const selectedMember = members.find((m) => m.name === person);

  return (
    <div className="page-content compact-page health-v130">
      <ModuleHeader icon="❤️" title="Zdrowie" text="Kartoteka, wizyty, leki, dokumenty i kontakty całej rodziny." action={<button className="primary-button" onClick={() => openAdd('visit')}>＋ Dodaj wizytę / wpis</button>} />

      <section className="health-person-switch">
        <button className={person === 'family' ? 'active' : ''} onClick={() => setPerson('family')}><span className="health-avatar">👨‍👩‍👧‍👦</span><strong>Cała rodzina</strong><small>Wspólnie</small></button>
        {members.filter(m=>parent || m.name === ownPerson(member)).map((m) => <button key={m.id} className={person === m.name ? 'active' : ''} onClick={() => setPerson(m.name as PersonKey)}><span className="health-avatar">{m.photoURL ? <img src={m.photoURL} alt="" /> : memberEmoji(m.name)}</span><strong>{m.name}</strong><small>{personRole(m.name,m.role)}</small></button>)}
      </section>

      {person !== 'family' && <section className="health-profile-bar"><span className="health-profile-avatar">{selectedMember?.photoURL ? <img src={selectedMember.photoURL} alt="" /> : memberEmoji(person)}</span><div><h2>{person}</h2><p>{personRole(person, selectedMember?.role)} · pełna kartoteka zdrowia</p></div></section>}

      <section className="specialty-chips"><button className={specialtyFilter === 'all' ? 'active' : ''} onClick={() => setSpecialtyFilter('all')}>Chronologia</button>{SPECIALTIES.map((s)=><button key={s} className={specialtyFilter === s ? 'active' : ''} onClick={() => setSpecialtyFilter(s)}>{s}</button>)}</section>

      <div className="health-dashboard-grid">
        <article className="health-card upcoming-health"><header><strong>📅 Najbliższe wizyty{person !== 'family' ? ` — ${person}` : ''}</strong><button onClick={() => openAdd('visit')}>Dodaj +</button></header>{upcomingVisits.length === 0 ? <p className="health-empty">Brak zaplanowanych wizyt.</p> : upcomingVisits.map((r)=><div className="health-list-row" key={r.id}><span className="health-date-tile"><b>{new Date(`${r.date}T12:00`).getDate()}</b><small>{new Date(`${r.date}T12:00`).toLocaleDateString('pl-PL',{month:'short'}).toUpperCase()}</small></span><div><strong>{r.person} — {r.specialty || r.title}</strong><small>{r.doctor || r.location || r.title}</small><p>{r.time}{r.referralCode ? ` · skierowanie: ${r.referralCode}` : ''}</p></div><span className="health-status">{r.status === 'toBook' ? 'Do umówienia' : r.status === 'booked' ? 'Umówiona' : 'Zaplanowana'}</span></div>)}</article>

        <article className="health-card"><header><strong>🔔 Przypomnienia</strong></header>{medicines.slice(0,3).map((r)=><div className="health-list-row" key={r.id}><span className="health-icon-tile">💊</span><div><strong>{r.title} — {r.person}</strong><small>{r.medicineTime || r.time}{r.dose ? ` · ${r.dose}` : ''}</small></div><button className={r.confirmedDate === formatDateInput(new Date()) ? 'confirmed-button' : 'medicine-confirm'} onClick={() => void confirmMedicine(r)}>{r.confirmedDate === formatDateInput(new Date()) ? '✓ Przyjęte' : 'Potwierdź'}</button></div>)}{controlItems.map((r)=><div className="health-list-row" key={`control-${r.id}`}><span className="health-icon-tile">☎️</span><div><strong>{r.nextControl ? `Kontrola: ${r.nextControl}` : 'Zadzwoń do rejestracji'}</strong><small>{r.callReminderDate ? `Przypomnienie: ${formatShortDate(r.callReminderDate)}` : r.specialty}</small></div></div>)}</article>

        {person === 'Paweł' && parent && <article className="health-card important-docs"><header><strong>🔒 Ważne dokumenty Pawła</strong><button onClick={() => openAdd('document')}>Dodaj +</button></header>{importantPawelDocs.length === 0 ? <p className="health-empty">Dodaj orzeczenie lub ważny dokument, aby mieć go zawsze pod ręką.</p> : importantPawelDocs.map((r)=><div className="document-row" key={r.id}><span>📁</span><div><strong>{r.title}</strong><small>Tylko rodzice</small></div>{(r.documentPath || r.documentURL) && <button onClick={()=>void openDocument(r)}>Pokaż lekarzowi</button>}</div>)}</article>}

        <article className="health-card"><header><strong>🕘 Historia wizyt</strong><small>Od najnowszych do najstarszych</small></header>{history.length === 0 ? <p className="health-empty">Brak historii.</p> : history.map((r)=><div className="timeline-health-row" key={r.id}><time>{r.date ? formatShortDate(r.date) : '—'}</time><span style={{ background:personColor(r.person) }} /><div><strong>{r.specialty || r.title}</strong><small>{r.person}{r.doctor ? ` · ${r.doctor}` : ''}</small><p>{r.note || r.location}</p></div></div>)}</article>

        <article className="health-card"><header><strong>📄 Dokumenty i wyniki</strong><button onClick={() => openAdd('result')}>Dodaj plik +</button></header>{documents.length === 0 ? <p className="health-empty">Brak dokumentów.</p> : documents.map((r)=><div className="document-row" key={r.id}><span>📄</span><div><strong>{r.title}</strong><small>{r.date ? formatShortDate(r.date) : ''} · {r.person}</small></div>{r.documentPath || r.documentURL ? <button onClick={()=>void openDocument(r)}>Otwórz</button> : <span>Bez pliku</span>}</div>)}</article>

        <article className="health-card medical-contacts"><header><strong>👥 Kontakty medyczne</strong>{parent && <button onClick={() => { setEditingContact(null); setContactForm({ person:person === 'family' ? 'family' : person, specialty:'', name:'', doctor:'', phone:'', address:'', note:'' }); setShowContactForm(true); }}>Dodaj +</button>}</header>{visibleContacts.length === 0 ? <p className="health-empty">Dodaj szpital, poradnię lub lekarza.</p> : visibleContacts.map((c)=><div className="contact-row" key={c.id}><span>🏥</span><div><strong>{c.name}</strong><small>{[c.specialty,c.doctor,c.address].filter(Boolean).join(' · ')}</small></div>{c.phone && <a href={`tel:${c.phone.replace(/\s/g,'')}`}>☎ {c.phone}</a>}{parent && <div className="health-record-actions"><button aria-label={`Edytuj kontakt: ${c.name}`} onClick={()=>{ const { id, ...fields } = c; setContactForm(fields); setEditingContact(c); setShowContactForm(true); }}>Edytuj</button><button aria-label={`Usuń kontakt: ${c.name}`} onClick={()=>{ if(confirm(`Usunąć kontakt „${c.name}”?`)) void deleteDoc(doc(db,'medicalContacts',c.id)); }}>Usuń</button></div>}</div>)}</article>
      </div>

      <section className="health-manager"><header><strong>Wszystkie wpisy</strong><span>{visibleRecords.length} wpisów</span></header>
        <div className="health-type-filter">{(['all', ...Object.keys(HEALTH_META)] as Array<HealthType | 'all'>).map(type=><button key={type} className={recordType === type ? 'active' : ''} onClick={()=>setRecordType(type)}>{type === 'all' ? 'Wszystkie' : HEALTH_META[type].label}</button>)}</div>
        {visibleRecords.length === 0 ? <EmptyState icon="❤️" text="Brak wpisów w tym widoku." /> : visibleRecords.map(record=><article className="module-row" key={record.id}><div className="row-main"><strong>{record.title}</strong><small>{record.person} · {HEALTH_META[record.type].label} · {record.date ? formatShortDate(record.date) : 'bez daty'}{record.privateToParents ? ' · tylko rodzice' : ''}</small><p>{record.note}</p></div><div className="health-record-actions">{(record.documentPath || record.documentURL) && <button onClick={()=>void openDocument(record)}>Plik</button>}{parent && <><button onClick={()=>editHealth(record)}>Edytuj</button><button onClick={()=>void removeHealth(record)}>Usuń</button></>}</div></article>)}
      </section>

      {showForm && <Modal title={`❤️ ${HEALTH_META[form.type].label}`} onClose={() => setShowForm(false)} wide>
        <form className="form-grid" onSubmit={save}>
          <label className="field"><span>Osoba</span>{!parent ? <input value={ownPerson(member)} readOnly /> : <PersonSelect includeFamily={false} value={form.person} onChange={(value)=>setForm((f)=>({...f,person:value}))} />}</label>
          <label className="field"><span>Rodzaj</span><select aria-label="Rodzaj" value={form.type} onChange={(e)=>setForm((f)=>({...f,type:e.target.value as HealthType}))}>{(Object.keys(HEALTH_META) as HealthType[]).map((t)=><option key={t} value={t}>{HEALTH_META[t].icon} {HEALTH_META[t].label}</option>)}</select></label>
          <label className="field field-wide"><span>Nazwa / opis</span><input value={form.title} onChange={(e)=>setForm((f)=>({...f,title:e.target.value}))} placeholder="Np. neurolog — kontrola" required /></label>
          <label className="field"><span>Specjalizacja</span><select aria-label="Specjalizacja" value={form.specialty} onChange={(e)=>setForm((f)=>({...f,specialty:e.target.value}))}><option value="">—</option>{SPECIALTIES.map((s)=><option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Status</span><select aria-label="Status" value={form.status} onChange={(e)=>setForm((f)=>({...f,status:e.target.value as HealthStatus}))}><option value="planned">Zaplanowana</option><option value="toBook">Do umówienia</option><option value="booked">Umówiona</option><option value="done">Odbyta</option><option value="cancelled">Anulowana</option></select></label>
          <label className="field"><span>Data</span><input type="date" value={form.date} onChange={(e)=>setForm((f)=>({...f,date:e.target.value}))} /></label>
          <label className="field"><span>Godzina</span><input type="time" value={form.time} onChange={(e)=>setForm((f)=>({...f,time:e.target.value}))} /></label>
          <label className="field"><span>Lekarz</span><input value={form.doctor} onChange={(e)=>setForm((f)=>({...f,doctor:e.target.value}))} /></label>
          <label className="field"><span>Placówka / miejsce</span><input value={form.location} onChange={(e)=>setForm((f)=>({...f,location:e.target.value}))} /></label>
          <label className="field"><span>Kod skierowania</span><input value={form.referralCode} onChange={(e)=>setForm((f)=>({...f,referralCode:e.target.value}))} /></label>
          <label className="field"><span>Kontrola / orientacyjny termin</span><input value={form.nextControl} onChange={(e)=>setForm((f)=>({...f,nextControl:e.target.value}))} placeholder="Np. za 6 miesięcy" /></label>
          <label className="field"><span>Przypomnij, aby zadzwonić</span><input type="date" value={form.callReminderDate} onChange={(e)=>setForm((f)=>({...f,callReminderDate:e.target.value}))} /></label>
          {form.type === 'medicine' && <><label className="field"><span>Dawka</span><input value={form.dose} onChange={(e)=>setForm((f)=>({...f,dose:e.target.value}))} /></label><label className="field"><span>Godzina leku</span><input type="time" value={form.medicineTime} onChange={(e)=>setForm((f)=>({...f,medicineTime:e.target.value}))} /></label></>}
          <label className="field field-wide"><span>Notatka / zalecenia</span><textarea rows={3} value={form.note} onChange={(e)=>setForm((f)=>({...f,note:e.target.value}))} /></label>
          <label className="field field-wide"><span>Plik (PDF / zdjęcie)</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e)=>setForm((f)=>({...f,file:e.target.files?.[0] || null}))} /></label>
          {parent && <label className="checkbox-field field-wide"><input type="checkbox" checked={form.privateToParents} onChange={(e)=>setForm((f)=>({...f,privateToParents:e.target.checked}))} /><span>🔒 Widoczne tylko dla rodziców</span></label>}
          {form.type === 'visit' && !form.privateToParents && !editingHealth && <label className="checkbox-field field-wide"><input type="checkbox" checked={form.addToCalendar} onChange={(e)=>setForm((f)=>({...f,addToCalendar:e.target.checked}))} /><span>Dodaj również do rodzinnego Kalendarza</span></label>}
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={()=>setShowForm(false)}>Anuluj</button><button className="primary-button" disabled={savingHealth}>{savingHealth ? "Zapisuję…" : "✓ Zapisz"}</button></div>
        </form>
      </Modal>}

      {showContactForm && <Modal title={editingContact ? "☎️ Edytuj kontakt medyczny" : "☎️ Nowy kontakt medyczny"} onClose={()=>setShowContactForm(false)}>
        <form className="form-grid" onSubmit={saveContact}><label className="field"><span>Osoba / rodzina</span><PersonSelect value={contactForm.person} onChange={(value)=>setContactForm((f)=>({...f,person:value}))} /></label><label className="field"><span>Specjalizacja</span><input value={contactForm.specialty} onChange={(e)=>setContactForm((f)=>({...f,specialty:e.target.value}))} /></label><label className="field field-wide"><span>Nazwa placówki</span><input value={contactForm.name} onChange={(e)=>setContactForm((f)=>({...f,name:e.target.value}))} required /></label><label className="field"><span>Lekarz</span><input value={contactForm.doctor} onChange={(e)=>setContactForm((f)=>({...f,doctor:e.target.value}))} /></label><label className="field"><span>Telefon</span><input value={contactForm.phone} onChange={(e)=>setContactForm((f)=>({...f,phone:e.target.value}))} /></label><label className="field field-wide"><span>Adres</span><input value={contactForm.address} onChange={(e)=>setContactForm((f)=>({...f,address:e.target.value}))} /></label><label className="field field-wide"><span>Notatka</span><textarea value={contactForm.note} onChange={(e)=>setContactForm((f)=>({...f,note:e.target.value}))} /></label><div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={()=>setShowContactForm(false)}>Anuluj</button><button className="primary-button" disabled={savingContact}>{savingContact ? "Zapisuję…" : "✓ Zapisz"}</button></div></form>
      </Modal>}
    </div>
  );
}

/* =========================================================
   SCHOOL
   ========================================================= */

const SCHOOL_META: Record<SchoolType, { label: string; icon: string }> = {
  lesson: { label: 'Plan lekcji', icon: '📚' }, homework: { label: 'Zadania domowe', icon: '📝' }, test: { label: 'Sprawdziany / kartkówki', icon: '📅' }, grade: { label: 'Oceny', icon: '⭐' }, message: { label: 'Wiadomości', icon: '💬' }, activity: { label: 'Zajęcia dodatkowe', icon: '🎯' },
};
function isSchoolType(value: unknown): value is SchoolType { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCHOOL_META, value); }

/* =========================================================
   FAMILY
   ========================================================= */

function FamilyPage({ member, goTo }: { member: Member | null; goTo: (page: Page) => void }) {
  const [members, setMembers] = useState<FamilyMemberDoc[]>([]);
  const [selected, setSelected] = useState<PersonKey>('family');
  const [events, setEvents] = useState<CalendarEventData[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [school, setSchool] = useState<SchoolRecord[]>([]);

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

  useEffect(() => onSnapshot(schoolQuery(member), (snap) => {
    setSchool(snap.docs.map((d): SchoolRecord => { const x=d.data(); return { id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'Nikodem', type:isSchoolType(x.type) ? x.type : 'homework', subject:typeof x.subject === 'string' ? x.subject : '', date:typeof x.date === 'string' ? x.date : '', time:typeof x.time === 'string' ? x.time : '', endTime:typeof x.endTime === 'string' ? x.endTime : '', weekday:Number(x.weekday || 0), note:typeof x.note === 'string' ? x.note : '' }; }));
  }), []);

  const now=new Date(); const today=formatDateInput(now); const weekday=now.getDay() === 0 ? 7 : now.getDay();
  const todayCalendar=useMemo(()=>events.flatMap((e)=>generateOccurrences(e,startOfDay(now),endOfDay(now))).sort((a,b)=>a.date.getTime()-b.date.getTime()), [events, today]);
  const todaySchool=useMemo(()=>school.filter((r)=>(r.type === 'lesson' || r.type === 'activity') && (r.weekday === weekday || r.date === today)).sort((a,b)=>(a.time || '99:99').localeCompare(b.time || '99:99')), [school, weekday, today]);

  function statusFor(name:string) {
    const key=name as PersonKey;
    const cal=todayCalendar.filter((o)=>o.source.person === key);
    const schoolRows=todaySchool.filter((r)=>r.person === key).map((r)=>({ start:parseLocalDate(today,r.time || '08:00'), end:parseLocalDate(today,r.endTime || r.time || '08:45'), title:r.type === 'activity' ? r.title : (r.subject || r.title), icon:subjectIcon(r.subject || r.title) }));
    const rows=[...cal.map((o)=>({start:o.date,end:o.endDate,title:o.source.title,icon:eventActivityIcon(o.source.title)})),...schoolRows].sort((a,b)=>a.start.getTime()-b.start.getTime());
    const active=rows.find((r)=>r.start <= now && r.end > now); if (active) return `${active.icon} ${active.title} do ${formatTime(active.end)}`;
    const next=rows.find((r)=>r.start > now); if (next) return `${next.icon} ${next.title} ${formatTime(next.start)}`;
    return '🟢 Wolny';
  }

  const selectedMember=members.find((m)=>m.name === selected);
  const selectedTasks=tasks.filter((t)=>!t.done && (selected === 'family' ? true : t.person === selected || t.person === 'family')).slice(0,5);
  const selectedPlan=selected === 'family' ? todayCalendar.slice(0,8) : todayCalendar.filter((o)=>o.source.person === selected || o.source.person === 'family').slice(0,6);
  const selectedSchool=todaySchool.filter((r)=>selected !== 'family' && r.person === selected).slice(0,7);
  const upcoming=events.flatMap((e)=>generateOccurrences(e,new Date(),endOfDay(addDays(new Date(),30)))).filter((o)=>o.date >= new Date() && (selected === 'family' || o.source.person === selected || o.source.person === 'family')).sort((a,b)=>a.date.getTime()-b.date.getTime()).slice(0,4);
  const isStudent=selected === 'Paweł' || selected === 'Nikodem';
  const age=ageFromBirthDate(selectedMember?.birthDate);

  return (
    <div className="page-content compact-page family-v130">
      <ModuleHeader icon="👨‍👩‍👧‍👦" title="Rodzina" text="Profile, plany i szybki dostęp do informacji każdej osoby." />
      <section className="family-hub-strip">
        <button className={selected === 'family' ? 'active' : ''} onClick={()=>setSelected('family')}><span className="family-hub-avatar group">👨‍👩‍👧‍👦</span><strong>Cała rodzina</strong><small>Wspólnie</small></button>
        {members.map((m)=><button key={m.id} className={selected === m.name ? 'active' : ''} onClick={()=>setSelected(m.name as PersonKey)}><span className="family-hub-avatar">{m.photoURL ? <img src={m.photoURL} alt="" /> : memberEmoji(m.name)}</span><strong>{m.name}</strong><small>{statusFor(m.name)}</small></button>)}
      </section>

      {selected === 'family' ? <>
        <section className="family-overview-grid">
          {members.map((m)=><article key={m.id} className="family-status-card"><div className="family-hub-avatar">{m.photoURL ? <img src={m.photoURL} alt="" /> : memberEmoji(m.name)}</div><div><strong>{m.name}</strong><small>{personRole(m.name,m.role)}</small><p>{statusFor(m.name)}</p></div><button onClick={()=>setSelected(m.name as PersonKey)}>Profil ›</button></article>)}
        </section>
        <section className="family-hub-columns">
          <article className="family-hub-card"><header><strong>📅 Najbliższe rodzinne wydarzenia</strong><button onClick={()=>goTo('Kalendarz')}>Kalendarz ›</button></header>{upcoming.length === 0 ? <p className="family-empty">Brak wydarzeń.</p> : upcoming.map((o)=><div className="family-hub-row" key={o.key}><span className="date-badge"><b>{o.date.getDate()}</b><small>{o.date.toLocaleDateString('pl-PL',{month:'short'}).replace('.','')}</small></span><div><strong>{o.source.title}</strong><small>{personLabel(o.source.person)} · {o.source.allDay ? 'cały dzień' : formatTime(o.date)}</small></div></div>)}</article>
          <article className="family-hub-card"><header><strong>✅ Zadania rodziny</strong><button onClick={()=>goTo('Zadania')}>Zadania ›</button></header>{selectedTasks.length === 0 ? <p className="family-empty">Brak otwartych zadań.</p> : selectedTasks.map((t)=><div className="family-hub-row" key={t.id}><span>○</span><div><strong>{t.title}</strong><small>{personLabel(t.person)}{t.dueDate ? ` · ${formatShortDate(t.dueDate)}` : ''}</small></div></div>)}</article>
        </section>
      </> : <>
        <section className="family-profile-hero">
          <div className="family-profile-avatar large">{selectedMember?.photoURL ? <img src={selectedMember.photoURL} alt="" /> : memberEmoji(selected)}</div>
          <div className="family-profile-copy"><h2>{selected}</h2><p>{personRole(selected,selectedMember?.role)}{age !== null ? ` · ${age} lat` : ''}</p><span>{statusFor(selected)}</span></div>
          <div className="family-profile-actions"><button onClick={()=>goTo('Kalendarz')}>📅 Plan dnia</button>{isStudent ? <button onClick={()=>goTo('Szkoła')}>🎒 Szkoła</button> : <button onClick={()=>goTo('Kalendarz')}>💼 Praca / aktywności</button>}<button onClick={()=>goTo('Zadania')}>✅ Zadania</button><button onClick={()=>goTo('Zdrowie')}>❤️ Zdrowie</button></div>
        </section>
        <section className="family-hub-columns three">
          <article className="family-hub-card"><header><strong>🕒 Dzisiejszy plan</strong><button onClick={()=>goTo('Kalendarz')}>Pełny plan ›</button></header>{selectedPlan.length === 0 && selectedSchool.length === 0 ? <p className="family-empty">Brak planu na dziś.</p> : <>{selectedPlan.map((o)=><div className="family-hub-row" key={o.key}><time>{o.source.allDay ? 'Cały dzień' : `${formatTime(o.date)}–${formatTime(o.endDate)}`}</time><div><strong>{eventActivityIcon(o.source.title)} {o.source.title}</strong><small>{o.source.description}</small></div></div>)}{selectedSchool.map((r)=><div className="family-hub-row" key={`school-${r.id}`}><time>{r.time}{r.endTime ? `–${r.endTime}` : ''}</time><div><strong>{subjectIcon(r.subject || r.title)} {r.subject || r.title}</strong><small>{r.type === 'activity' ? r.title : r.note}</small></div></div>)}</>}</article>
          <article className="family-hub-card"><header><strong>✅ Zadania</strong><button onClick={()=>goTo('Zadania')}>Wszystkie ›</button></header>{selectedTasks.length === 0 ? <p className="family-empty">Brak otwartych zadań.</p> : selectedTasks.map((t)=><div className="family-hub-row" key={t.id}><span>○</span><div><strong>{t.title}</strong><small>{t.dueDate ? formatShortDate(t.dueDate) : 'Bez terminu'}{t.points ? ` · +${t.points} pkt` : ''}</small></div></div>)}</article>
          <article className="family-hub-card"><header><strong>{isStudent ? '🎒 Szkoła i zajęcia' : '📅 Najbliższe aktywności'}</strong><button onClick={()=>goTo(isStudent ? 'Szkoła' : 'Kalendarz')}>Otwórz ›</button></header>{isStudent ? (selectedSchool.length ? selectedSchool.map((r)=><div className="family-hub-row" key={`mini-${r.id}`}><span>{subjectIcon(r.subject || r.title)}</span><div><strong>{r.subject || r.title}</strong><small>{r.time}{r.endTime ? `–${r.endTime}` : ''}</small></div></div>) : <p className="family-empty">Brak szkolnych wpisów na dziś.</p>) : (upcoming.length ? upcoming.map((o)=><div className="family-hub-row" key={`up-${o.key}`}><span>{eventActivityIcon(o.source.title)}</span><div><strong>{o.source.title}</strong><small>{formatShortDate(formatDateInput(o.date))} · {formatTime(o.date)}</small></div></div>) : <p className="family-empty">Brak najbliższych aktywności.</p>)}</article>
        </section>
      </>}
    </div>
  );
}

/* =========================================================
   SETTINGS
   ========================================================= */

function downloadFile(contents:string, name:string, type:string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function SettingsPage({ user, member, theme, setTheme }: { user: User; member: Member | null; theme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void }) {
  const defaultPrefs = { medicines:true, visits:true, tasks:true, school:true, chat:true };
  const [prefs, setPrefs] = useState<Record<keyof typeof defaultPrefs, boolean>>(() => {
    try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem('nr-notifications') || '{}') }; }
    catch { return defaultPrefs; }
  });
  const parent=isParent(member);

  async function togglePref(key:keyof typeof defaultPrefs) {
    const nextValue=!prefs[key];
    if (nextValue && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* browser may block */ }
    }
    const next={...prefs,[key]:nextValue}; setPrefs(next);
    try { localStorage.setItem('nr-notifications',JSON.stringify(next)); } catch { /* ignore */ }
  }

  const [exporting, setExporting] = useState(false);
  async function downloadBackup() {
    if (!parent || exporting) return;
    setExporting(true);
    try {
      const names = ['members','calendarEvents','tasks','shoppingItems','quickProducts','healthRecords','medicalContacts','schoolItems'];
      const snapshots = await Promise.all(names.map(name=>getDocs(collection(db,name))));
      const data = Object.fromEntries(names.map((name,i)=>[name,snapshots[i].docs.map(row=>({ id:row.id, data:row.data() }))]));
      downloadFile(JSON.stringify({ schemaVersion:1, appVersion:APP_VERSION, exportedAt:new Date().toISOString(), data }, null, 2), `nasza-rodzina-kopia-${dateKey()}.json`, 'application/json');
      notify('Pobrano kopię danych. Przechowuj ten plik prywatnie; pliki dokumentów i wiadomości nie są częścią kopii.');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setExporting(false); }
  }
  async function downloadCalendar() {
    if (exporting) return;
    setExporting(true);
    try {
      const snapshot = await getDocs(collection(db, 'calendarEvents'));
      const escape = (value:string)=>value.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
      const date = (value:Date)=>`${formatDateInput(value).replace(/-/g,'')}T${formatTimeInput(value).replace(':','')}00`;
      const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Nasza Rodzina//PL','CALSCALE:GREGORIAN'];
      for (const row of snapshot.docs) {
        const x = row.data(); if (!(x.date instanceof Timestamp)) continue;
        const start = x.date.toDate(); const end = x.endDate instanceof Timestamp ? x.endDate.toDate() : addDays(start,1);
        lines.push('BEGIN:VEVENT', `UID:${row.id}@nasza-rodzina`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`, `SUMMARY:${escape(String(x.title || 'Wydarzenie'))}`, `DESCRIPTION:${escape(String(x.description || ''))}`);
        if (x.allDay) lines.push(`DTSTART;VALUE=DATE:${formatDateInput(start).replace(/-/g,'')}`, `DTEND;VALUE=DATE:${formatDateInput(addDays(startOfDay(end),1)).replace(/-/g,'')}`);
        else lines.push(`DTSTART:${date(start)}`, `DTEND:${date(end)}`);
        const freq:Record<string,string> = { daily:'DAILY', weekly:'WEEKLY', monthly:'MONTHLY', yearly:'YEARLY' };
        if (freq[x.repeat]) lines.push(`RRULE:FREQ=${freq[x.repeat]}${x.repeatUntil instanceof Timestamp ? ';UNTIL=' + date(x.repeatUntil.toDate()) : ''}`);
        lines.push('END:VEVENT');
      }
      lines.push('END:VCALENDAR');
      downloadFile(lines.join('\r\n')+'\r\n', `nasza-rodzina-kalendarz-${dateKey()}.ics`, 'text/calendar;charset=utf-8');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setExporting(false); }
  }

  return (
    <div className="page-content compact-page settings-v130">
      <ModuleHeader icon="⚙️" title="Ustawienia" text="Konto, wygląd, powiadomienia, synchronizacja i bezpieczeństwo." />
      <section className="settings-dashboard">
        <article className="settings-section account-settings"><header><span>👤</span><div><strong>Twoje konto</strong><small>Profil zalogowanej osoby</small></div></header><div className="settings-profile"><span className="family-profile-avatar">{member?.photoURL ? <img src={member.photoURL} alt="" /> : memberEmoji(member?.name || '')}</span><div><strong>{member?.name || 'Użytkownik'}</strong><small>{personRole(member?.name || '',member?.role)}</small></div><span className="setting-badge green">Aktywne</span></div></article>

        <article className="settings-section"><header><span>🎨</span><div><strong>Motyw aplikacji</strong><small>Wygląd zapisuje się na tym urządzeniu</small></div></header><div className="theme-choice big"><button className={theme === 'light' ? 'active' : ''} onClick={()=>setTheme('light')}>☀️ <span><b>Jasny</b><small>Kolorowy i czytelny</small></span></button><button className={theme === 'dark' ? 'active' : ''} onClick={()=>setTheme('dark')}>🌙 <span><b>Ciemny</b><small>Delikatny dla oczu</small></span></button></div></article>

        <article className="settings-section notifications-settings"><header><span>🔔</span><div><strong>Powiadomienia</strong><small>Przypomnienia o lekach przy otwartej zakładce Zdrowie</small></div></header>{([['medicines','💊','Leki']] as Array<[keyof typeof defaultPrefs,string,string]>).map(([key,icon,label])=><button className="settings-toggle-row" key={key} onClick={()=>void togglePref(key)}><span>{icon}</span><strong>{label}</strong><i className={prefs[key] ? 'toggle-on' : 'toggle-off'}>{prefs[key] ? 'Wł.' : 'Wył.'}</i></button>)}<p className="settings-footnote">Przypomnienia działają tylko przy otwartej zakładce Zdrowie i zgodzie przeglądarki. Na iPhonie system może ograniczać powiadomienia; aplikacja nie zastępuje alarmu na lek.</p></article>

        <article className="settings-section calendars-settings"><header><span>📅</span><div><strong>Kalendarz poza aplikacją</strong><small>Plik do otwarcia w Apple Calendar, Google Calendar lub Outlook</small></div></header><div className="data-tools"><button className="secondary-button" disabled={exporting} onClick={()=>void downloadCalendar()}>Pobierz kalendarz .ics</button></div><p className="settings-footnote">Plik jest kopią bieżącego kalendarza. Zmiany po imporcie nie synchronizują się automatycznie. Godziny przyjmują strefę Twojego kalendarza.</p></article>

        <article className="settings-section"><header><span>👨‍👩‍👧‍👦</span><div><strong>Uprawnienia rodzinne</strong><small>Role i dostęp do danych</small></div></header><div className="permission-summary"><span className={parent ? 'parent-role' : 'child-role'}>{parent ? '👑 Rodzic — pełny dostęp' : '👤 Członek rodziny — dostęp ograniczony'}</span><p>Rodzice zarządzają punktami, profilami dzieci oraz szczególnie wrażliwymi dokumentami.</p></div></article>

        <article className="settings-section"><header><span>🔐</span><div><strong>Prywatność i bezpieczeństwo</strong><small>Dane rodzinne są dostępne po zalogowaniu</small></div></header><div className="settings-info-list"><span>🔒 Ważne dokumenty Pawła: tylko rodzice</span><span>🗂️ Dokumenty zdrowotne: zgodnie z rolą</span><span>🔑 Hasła do zewnętrznych usług nie są zapisywane w aplikacji</span></div></article>

        <article className="settings-section"><header><span>📁</span><div><strong>Dane i pliki</strong><small>Zdjęcia, dokumenty i własne ikonki</small></div></header><div className="settings-info-list"><span>🖼️ Zdjęcia i dokumenty — magazyn rodziny</span><span>☁️ Dane są wspólne na wszystkich urządzeniach</span></div></article>

        {parent && <article className="settings-section"><header><span>💾</span><div><strong>Kopia danych rodziny</strong><small>Pobierz dane jako prywatny plik JSON</small></div></header><button className="secondary-button" disabled={exporting} onClick={()=>void downloadBackup()}>{exporting ? "Przygotowuję…" : "Pobierz kopię danych"}</button><p className="settings-footnote">Kopia zawiera dane zdrowotne. Dokumenty i wiadomości czatu wymagają oddzielnej kopii. Konta i hasła nie są eksportowane.</p></article>}

        <article className="settings-section whats-new-v130"><header><span>✨</span><div><strong>Co nowego?</strong><small>Ta sekcja będzie przy każdej wersji</small></div><b className="version-pill">v{APP_VERSION}</b></header><ul><li>Czytelne układy na telefonie, tablecie i komputerze</li><li>Ochrona prywatnych rozmów i dokumentów przez uprawnienia</li><li>Edycja szkolnych i zdrowotnych wpisów</li><li>Import szkoły z pliku i eksport kalendarza</li><li>Zadania powtarzające się z zatwierdzaniem rodzica</li></ul></article>

        <article className="settings-section app-about"><header><span>ℹ️</span><div><strong>O aplikacji</strong><small>Nasza Rodzina</small></div></header><div className="about-version"><img src="/nasza-rodzina-logo.svg" alt="" /><div><strong>Nasza Rodzina v{APP_VERSION}</strong><small>Aktualizacja: {APP_UPDATED}</small></div></div></article>
      </section>
    </div>
  );
}

/* =========================================================
   MOBILE NAV
   ========================================================= */

function MobileNavigation({ page, goTo, moreOpen, onMore }: { page: Page; goTo: (page: Page) => void; moreOpen: boolean; onMore: () => void }) {
  const items: Page[] = ['Start', 'Kalendarz', 'Zadania', 'Zakupy'];
  const moreActive = !items.includes(page) || moreOpen;
  return (
    <nav className="mobile-navigation family-menu" aria-label="Nawigacja">
      {items.map((target) => <button type="button" aria-label={target} aria-current={page === target ? 'page' : undefined} key={target} className={page === target && !moreOpen ? 'active' : ''} onClick={() => goTo(target)}><span className="mobile-nav-icon"><AppIcon page={target} size={22} /></span><small>{target}</small></button>)}
      <button type="button" aria-label="Więcej" aria-haspopup="dialog" aria-expanded={moreOpen} aria-controls="family-more-menu" className={moreActive ? 'active' : ''} onClick={onMore}><span className="mobile-nav-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.8"/><rect x="14" y="4" width="6" height="6" rx="1.8"/><rect x="4" y="14" width="6" height="6" rx="1.8"/><rect x="14" y="14" width="6" height="6" rx="1.8"/></svg></span><small>Więcej</small></button>
    </nav>
  );
}

function MobileMoreMenu({ page, goTo, onClose, onLogout }: { page: Page; goTo: (page: Page) => void; onClose: () => void; onLogout: () => void }) {
  const items: Array<[Page, string]> = [['Czat', 'Rodzinne rozmowy'], ['Zdrowie', 'Wizyty i dokumenty'], ['Szkoła', 'Lekcje i oceny'], ['Rodzina', 'Nasi najbliżsi'], ['Ustawienia', 'Dopasuj aplikację']];
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [onClose]);
  return (
    <div className="mobile-more-backdrop" onClick={onClose}>
      <section ref={panel} id="family-more-menu" role="dialog" aria-modal="true" aria-labelledby="family-more-title" className="mobile-more family-menu" onClick={(e) => e.stopPropagation()}>
        <div className="more-menu-handle" aria-hidden="true" />
        <header><div className="more-brand-heading"><img src="/nasza-rodzina-logo.svg" alt="" /><div><strong id="family-more-title">Dom i bliscy</strong><p>Wszystko dla Twojej rodziny</p></div></div><button type="button" aria-label="Zamknij menu" onClick={onClose}><svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <div className="more-menu-grid">{items.map(([target, description]) => <button type="button" aria-label={target} aria-current={page === target ? 'page' : undefined} data-menu-page={target} key={target} className={`more-menu-tile ${page === target ? 'active' : ''}`} onClick={() => goTo(target)}><span className="nav-icon"><AppIcon page={target} size={24} /></span><span className="more-tile-copy"><strong>{target}</strong><small>{description}</small></span></button>)}</div>
        <button type="button" className="logout-mobile" onClick={onLogout}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h12"/></svg>Wyloguj</button>
      </section>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Nie znaleziono elementu #root.');
registerPwa();
createRoot(root).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
