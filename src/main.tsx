import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';

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

/* =========================================================
   TYPY
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

type CalendarEventData = {
  id: string;
  title: string;
  person: PersonKey;
  date: Date;
  endDate: Date;
  allDay: boolean;
  description: string;
  createdBy: string;
};

type EventForm = {
  title: string;
  person: PersonKey;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  description: string;
};

/* =========================================================
   POMOCNICZE
   ========================================================= */

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);

  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getDate();

  result.setDate(1);
  result.setMonth(result.getMonth() + months);

  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();

  result.setDate(Math.min(originalDay, lastDay));

  return result;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function weekTitle(weekStart: Date): string {
  const end = addDays(weekStart, 6);

  const startMonth = weekStart.toLocaleDateString('pl-PL', {
    month: 'short',
  });

  const endMonth = end.toLocaleDateString('pl-PL', {
    month: 'short',
  });

  if (weekStart.getMonth() === end.getMonth()) {
    return `${weekStart.getDate()}–${end.getDate()} ${endMonth} ${end.getFullYear()}`;
  }

  return `${weekStart.getDate()} ${startMonth} – ${end.getDate()} ${endMonth} ${end.getFullYear()}`;
}

function personEventClass(person: PersonKey): string {
  switch (person) {
    case 'Sebastian':
      return 'event-sebastian';
    case 'Dominika':
      return 'event-dominika';
    case 'Paweł':
      return 'event-pawel';
    case 'Nikodem':
      return 'event-nikodem';
    case 'Layla':
      return 'event-layla';
    default:
      return 'event-family';
  }
}

function personColor(person: PersonKey): string {
  switch (person) {
    case 'Sebastian':
      return '#3182f6';
    case 'Dominika':
      return '#8b5cf6';
    case 'Paweł':
      return '#22c55e';
    case 'Nikodem':
      return '#f59e0b';
    case 'Layla':
      return '#ec4899';
    default:
      return '#64748b';
  }
}

function personLabel(person: PersonKey): string {
  return person === 'family' ? 'Cała rodzina' : person;
}

function isPersonKey(value: unknown): value is PersonKey {
  return (
    value === 'family' ||
    value === 'Sebastian' ||
    value === 'Dominika' ||
    value === 'Paweł' ||
    value === 'Nikodem' ||
    value === 'Layla'
  );
}

function parseLocalDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="family-logo">👨‍👩‍👧‍👦</div>
          <h2>Nasza Rodzina</h2>
          <p>Ładowanie...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <FamilyApp user={user} />;
}

/* =========================================================
   LOGOWANIE
   ========================================================= */

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

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="family-logo">👨‍👩‍👧‍👦</div>

        <h1>Nasza Rodzina</h1>
        <p>Rodzinne centrum w jednym miejscu ❤️</p>

        <form onSubmit={handleLogin} className="login-form">
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Twój e-mail"
              required
            />
          </label>

          <label>
            Hasło
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Hasło"
              required
            />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" disabled={loggingIn}>
            {loggingIn ? 'Logowanie...' : 'Zaloguj się'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* =========================================================
   GŁÓWNA APLIKACJA
   ========================================================= */

function FamilyApp({ user }: { user: User }) {
  const [page, setPage] = useState<Page>('Start');
  const [member, setMember] = useState<Member | null>(null);

  useEffect(() => {
    async function loadMember() {
      try {
        const memberRef = doc(db, 'members', user.uid);
        const snapshot = await getDoc(memberRef);

        if (snapshot.exists()) {
          setMember(snapshot.data() as Member);
        }
      } catch (error) {
        console.error('Błąd profilu:', error);
      }
    }

    void loadMember();
  }, [user.uid]);

  function renderPage() {
    switch (page) {
      case 'Start':
        return <StartPage member={member} />;

      case 'Kalendarz':
        return <CalendarPage user={user} />;

      case 'Zadania':
        return <TasksPage user={user} />;

      case 'Zakupy':
        return <ShoppingPage user={user} />;

      case 'Czat':
        return <ChatPage user={user} member={member} />;

      case 'Zdrowie':
        return <HealthPage user={user} />;

      case 'Szkoła':
        return <SchoolPage user={user} />;

      case 'Rodzina':
        return <FamilyPage />;

      case 'Ustawienia':
        return <SettingsPage member={member} />;

      default:
        return <StartPage member={member} />;
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
        member={member}
      />

      <main className="main-area">
        <FamilyHeader
          member={member}
          onLogout={() => signOut(auth)}
        />

        {renderPage()}
      </main>

      <MobileNavigation page={page} setPage={setPage} />
    </div>
  );
}

/* =========================================================
   SIDEBAR
   ========================================================= */

function Sidebar({
  page,
  setPage,
  member,
}: {
  page: Page;
  setPage: React.Dispatch<React.SetStateAction<Page>>;
  member: Member | null;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">👨‍👩‍👧‍👦</div>

        <div>
          <strong>Nasza Rodzina</strong>
          <small>Rodzinne centrum</small>
        </div>
      </div>

      <nav className="sidebar-nav">
        <NavButton
          icon="🏠"
          label="Start"
          active={page === 'Start'}
          onClick={() => setPage('Start')}
        />

        <NavButton
          icon="📅"
          label="Kalendarz"
          active={page === 'Kalendarz'}
          onClick={() => setPage('Kalendarz')}
        />

        <NavButton
          icon="✅"
          label="Zadania"
          active={page === 'Zadania'}
          onClick={() => setPage('Zadania')}
        />

        <NavButton
          icon="🛒"
          label="Zakupy"
          active={page === 'Zakupy'}
          onClick={() => setPage('Zakupy')}
        />

        <NavButton
          icon="💬"
          label="Czat"
          active={page === 'Czat'}
          onClick={() => setPage('Czat')}
        />

        <NavButton
          icon="❤️"
          label="Zdrowie"
          active={page === 'Zdrowie'}
          onClick={() => setPage('Zdrowie')}
        />

        <NavButton
          icon="🎒"
          label="Szkoła"
          active={page === 'Szkoła'}
          onClick={() => setPage('Szkoła')}
        />

        <NavButton
          icon="👨‍👩‍👧‍👦"
          label="Rodzina"
          active={page === 'Rodzina'}
          onClick={() => setPage('Rodzina')}
        />

        <NavButton
          icon="⚙️"
          label="Ustawienia"
          active={page === 'Ustawienia'}
          onClick={() => setPage('Ustawienia')}
        />
      </nav>

      <div className="sidebar-profile">
        <div className="profile-avatar">
          {member?.photoURL ? (
            <img src={member.photoURL} alt="" />
          ) : (
            '🙂'
          )}
        </div>

        <div>
          <strong>{member?.name || 'Rodzina'}</strong>
          <small>{member?.role || 'Użytkownik'}</small>
        </div>
      </div>
    </aside>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nav-button ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

/* =========================================================
   HEADER
   ========================================================= */

function FamilyHeader({
  member,
  onLogout,
}: {
  member: Member | null;
  onLogout: () => void;
}) {
  return (
    <header className="top-header">
      <div>
        <small>Rodzinne centrum</small>
        <strong>Nasza Rodzina</strong>
      </div>

      <div className="header-user">
        <div className="header-user-text">
          <strong>{member?.name || 'Użytkownik'}</strong>
          <small>{member?.role || 'Rodzina'}</small>
        </div>

        <button type="button" onClick={onLogout}>
          Wyloguj
        </button>
      </div>
    </header>
  );
}

/* =========================================================
   START
   ========================================================= */

function StartPage({ member }: { member: Member | null }) {
  const name = member?.name || 'Sebastian';

  return (
    <div className="page-content">
      <section className="welcome-card">
        <div>
          <small>{capitalize(new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }))}</small>
          <h1>Cześć, {name}! 👋</h1>
          <p>Miło Cię widzieć w Waszym rodzinnym centrum.</p>
        </div>

        <div className="welcome-illustration">🏡</div>
      </section>

      <section className="dashboard-grid">
        <AppCard
          icon="📅"
          title="Dzisiaj"
          text="Sprawdź rodzinny kalendarz i najbliższe wydarzenia."
        />

        <AppCard
          icon="✅"
          title="Zadania"
          text="Zobacz, co jest dziś do zrobienia."
        />

        <AppCard
          icon="🛒"
          title="Zakupy"
          text="Wspólna lista zakupów zawsze pod ręką."
        />

        <AppCard
          icon="💬"
          title="Rodzinny czat"
          text="Wiadomości całej rodziny w jednym miejscu."
        />

        <AppCard
          icon="❤️"
          title="Zdrowie"
          text="Wizyty, lekarze i ważne informacje."
        />

        <AppCard
          icon="🎒"
          title="Szkoła"
          text="Plan lekcji i zajęcia dzieci."
        />
      </section>
    </div>
  );
}

/* =========================================================
   KALENDARZ
   ========================================================= */

function CalendarPage({ user }: { user: User }) {
  const [view, setView] = useState<CalendarView>('week');
  const [focusDate, setFocusDate] = useState(() => new Date());

  const [events, setEvents] = useState<CalendarEventData[]>([]);
  const [selectedPerson, setSelectedPerson] =
    useState<PersonKey>('family');

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedEvent, setSelectedEvent] =
    useState<CalendarEventData | null>(null);

  const [editingEvent, setEditingEvent] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState<EventForm>(() =>
    createDefaultForm(new Date())
  );

  const [editForm, setEditForm] = useState<EventForm>(() =>
    createDefaultForm(new Date())
  );

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'calendarEvents'),
      (snapshot) => {
        const loaded: CalendarEventData[] = [];

        snapshot.forEach((eventDocument) => {
          const data = eventDocument.data();

          if (!(data.date instanceof Timestamp)) {
            return;
          }

          const start = data.date.toDate();

          const end =
            data.endDate instanceof Timestamp
              ? data.endDate.toDate()
              : new Date(start.getTime() + 60 * 60 * 1000);

          loaded.push({
            id: eventDocument.id,
            title:
              typeof data.title === 'string' && data.title.trim()
                ? data.title
                : 'Wydarzenie',
            person: isPersonKey(data.person)
              ? data.person
              : 'family',
            date: start,
            endDate: end,
            allDay: data.allDay === true,
            description:
              typeof data.description === 'string'
                ? data.description
                : '',
            createdBy:
              typeof data.createdBy === 'string'
                ? data.createdBy
                : '',
          });
        });

        loaded.sort((a, b) => a.date.getTime() - b.date.getTime());

        setEvents(loaded);

        setSelectedEvent((current) => {
          if (!current) return null;

          return (
            loaded.find((event) => event.id === current.id) || null
          );
        });
      },
      (error) => {
        console.error('Błąd pobierania kalendarza:', error);
      }
    );

    return unsubscribe;
  }, []);

  const weekStart = useMemo(() => startOfWeek(focusDate), [focusDate]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart]
  );

  const monthDays = useMemo(() => {
    const first = new Date(
      focusDate.getFullYear(),
      focusDate.getMonth(),
      1
    );

    const gridStart = startOfWeek(first);

    return Array.from({ length: 42 }, (_, index) =>
      addDays(gridStart, index)
    );
  }, [focusDate]);

  const visibleEvents = useMemo(() => {
    return events.filter(
      (event) =>
        selectedPerson === 'family' ||
        event.person === selectedPerson ||
        event.person === 'family'
    );
  }, [events, selectedPerson]);

  const todayEvents = useMemo(() => {
    const today = new Date();

    return visibleEvents.filter((event) => sameDay(event.date, today));
  }, [visibleEvents]);

  const upcomingEvents = useMemo(() => {
    const now = new Date();

    return visibleEvents
      .filter((event) => event.date.getTime() > now.getTime())
      .slice(0, 4);
  }, [visibleEvents]);

  function titleForView(): string {
    if (view === 'day') {
      return capitalize(
        focusDate.toLocaleDateString('pl-PL', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      );
    }

    if (view === 'week') {
      return weekTitle(weekStart);
    }

    return capitalize(
      focusDate.toLocaleDateString('pl-PL', {
        month: 'long',
        year: 'numeric',
      })
    );
  }

  function navigate(direction: number) {
    if (view === 'day') {
      setFocusDate((current) => addDays(current, direction));
      return;
    }

    if (view === 'week') {
      setFocusDate((current) => addDays(current, direction * 7));
      return;
    }

    setFocusDate((current) => addMonths(current, direction));
  }

  function openNewEvent(date = focusDate, time = '12:00') {
    const nextForm = createDefaultForm(date, time);

    setForm(nextForm);
    setShowForm(true);
  }

  function openEvent(event: CalendarEventData) {
    setSelectedEvent(event);
    setEditingEvent(false);

    setEditForm({
      title: event.title,
      person: event.person,
      date: formatDateInput(event.date),
      allDay: event.allDay,
      startTime: formatTimeInput(event.date),
      endTime: formatTimeInput(event.endDate),
      description: event.description,
    });
  }

  function closeEvent() {
    setSelectedEvent(null);
    setEditingEvent(false);
  }

  async function saveEvent(e: React.FormEvent) {
    e.preventDefault();

    const dates = buildEventDates(form);

    if (!form.title.trim() || !dates) {
      return;
    }

    setSaving(true);

    try {
      await addDoc(collection(db, 'calendarEvents'), {
        title: form.title.trim(),
        person: form.person,
        date: Timestamp.fromDate(dates.start),
        endDate: Timestamp.fromDate(dates.end),
        allDay: form.allDay,
        description: form.description.trim(),
        createdBy: user.uid,
        createdAt: Timestamp.now(),
      });

      setFocusDate(dates.start);
      setShowForm(false);
      setForm(createDefaultForm(dates.start));
    } catch (error) {
      console.error('Błąd zapisu:', error);
      alert('Nie udało się zapisać wydarzenia.');
    } finally {
      setSaving(false);
    }
  }

  async function updateEvent(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedEvent) return;

    const dates = buildEventDates(editForm);

    if (!editForm.title.trim() || !dates) {
      return;
    }

    setUpdating(true);

    try {
      await updateDoc(doc(db, 'calendarEvents', selectedEvent.id), {
        title: editForm.title.trim(),
        person: editForm.person,
        date: Timestamp.fromDate(dates.start),
        endDate: Timestamp.fromDate(dates.end),
        allDay: editForm.allDay,
        description: editForm.description.trim(),
        updatedBy: user.uid,
        updatedAt: Timestamp.now(),
      });

      setFocusDate(dates.start);
      setEditingEvent(false);
    } catch (error) {
      console.error('Błąd aktualizacji:', error);
      alert('Nie udało się zapisać zmian.');
    } finally {
      setUpdating(false);
    }
  }

  async function removeEvent() {
    if (!selectedEvent) return;

    const confirmed = window.confirm(
      `Czy na pewno chcesz usunąć „${selectedEvent.title}”?`
    );

    if (!confirmed) return;

    setDeleting(true);

    try {
      await deleteDoc(doc(db, 'calendarEvents', selectedEvent.id));
      closeEvent();
    } catch (error) {
      console.error('Błąd usuwania:', error);
      alert('Nie udało się usunąć wydarzenia.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page-content">
      <style>{calendarStageStyles}</style>

      <section className="page-header">
        <div>
          <small>Nasza Rodzina</small>
          <h1>📅 Kalendarz</h1>
          <p>Wszystkie rodzinne wydarzenia w jednym miejscu.</p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() => {
            if (showForm) {
              setShowForm(false);
            } else {
              openNewEvent();
            }
          }}
        >
          {showForm ? '✕ Zamknij' : '＋ Dodaj wydarzenie'}
        </button>
      </section>

      {showForm && (
        <section
          className="app-card"
          style={{ marginBottom: 20 }}
        >
          <h2 style={{ marginTop: 0 }}>➕ Nowe wydarzenie</h2>

          <EventFormFields
            form={form}
            setForm={setForm}
            onSubmit={saveEvent}
            buttonText={saving ? 'Zapisywanie...' : '✓ Zapisz wydarzenie'}
            disabled={saving}
          />
        </section>
      )}

      <section className="calendar2-toolbar">
        <div className="calendar2-navigation">
          <button type="button" onClick={() => navigate(-1)}>
            ‹
          </button>

          <strong>{titleForView()}</strong>

          <button type="button" onClick={() => navigate(1)}>
            ›
          </button>
        </div>

        <button
          type="button"
          className="calendar2-today"
          onClick={() => setFocusDate(new Date())}
        >
          Dzisiaj
        </button>

        <div className="calendar2-view-switch">
          <button
            type="button"
            className={view === 'day' ? 'active' : ''}
            onClick={() => setView('day')}
          >
            Dzień
          </button>

          <button
            type="button"
            className={view === 'week' ? 'active' : ''}
            onClick={() => setView('week')}
          >
            Tydzień
          </button>

          <button
            type="button"
            className={view === 'month' ? 'active' : ''}
            onClick={() => setView('month')}
          >
            Miesiąc
          </button>
        </div>
      </section>

      <section className="calendar2-filters">
        <FilterButton
          active={selectedPerson === 'family'}
          onClick={() => setSelectedPerson('family')}
        >
          👨‍👩‍👧‍👦 Cała rodzina
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Sebastian'}
          onClick={() => setSelectedPerson('Sebastian')}
        >
          🔵 Sebastian
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Dominika'}
          onClick={() => setSelectedPerson('Dominika')}
        >
          🟣 Dominika
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Paweł'}
          onClick={() => setSelectedPerson('Paweł')}
        >
          🟢 Paweł
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Nikodem'}
          onClick={() => setSelectedPerson('Nikodem')}
        >
          🟠 Nikodem
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Layla'}
          onClick={() => setSelectedPerson('Layla')}
        >
          🩷 Layla
        </FilterButton>
      </section>

      {view === 'day' && (
        <DayView
          date={focusDate}
          events={visibleEvents}
          onEvent={openEvent}
          onAdd={openNewEvent}
        />
      )}

      {view === 'week' && (
        <div className="calendar2-week-layout">
          <section className="calendar2-week-card">
            <div className="calendar2-week-grid">
              {weekDays.map((day) => {
                const dayEvents = visibleEvents.filter((event) =>
                  sameDay(event.date, day)
                );

                const isToday = sameDay(day, new Date());

                return (
                  <div
                    key={formatDateInput(day)}
                    className={`calendar2-week-day ${
                      isToday ? 'today' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="calendar2-day-heading"
                      onClick={() => {
                        setFocusDate(day);
                        setView('day');
                      }}
                    >
                      <span>
                        {capitalize(
                          day.toLocaleDateString('pl-PL', {
                            weekday: 'short',
                          })
                        )}
                      </span>

                      <strong>{day.getDate()}</strong>
                    </button>

                    <button
                      type="button"
                      className="calendar2-empty-add"
                      onClick={() => openNewEvent(day)}
                    >
                      ＋
                    </button>

                    <div className="calendar2-day-events">
                      {dayEvents.length === 0 && (
                        <small className="calendar2-no-events">
                          Brak wydarzeń
                        </small>
                      )}

                      {dayEvents.map((event) => (
                        <CalendarEventButton
                          key={event.id}
                          event={event}
                          onClick={() => openEvent(event)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <CalendarSidePanel
            todayEvents={todayEvents}
            upcomingEvents={upcomingEvents}
            onEvent={openEvent}
          />
        </div>
      )}

      {view === 'month' && (
        <MonthView
          focusDate={focusDate}
          days={monthDays}
          events={visibleEvents}
          onEvent={openEvent}
          onAdd={openNewEvent}
          onOpenDay={(day) => {
            setFocusDate(day);
            setView('day');
          }}
        />
      )}

      {selectedEvent && (
        <div
          className="calendar2-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeEvent();
            }
          }}
        >
          <div className="calendar2-modal">
            <div className="calendar2-modal-header">
              <div>
                <small>Wydarzenie</small>
                <h2>{selectedEvent.title}</h2>
              </div>

              <button
                type="button"
                className="calendar2-close"
                onClick={closeEvent}
              >
                ✕
              </button>
            </div>

            {!editingEvent ? (
              <>
                <div className="calendar2-event-details">
                  <DetailRow
                    label="Osoba"
                    value={personLabel(selectedEvent.person)}
                  />

                  <DetailRow
                    label="Data"
                    value={capitalize(
                      selectedEvent.date.toLocaleDateString('pl-PL', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })
                    )}
                  />

                  <DetailRow
                    label="Godzina"
                    value={
                      selectedEvent.allDay
                        ? 'Cały dzień'
                        : `${formatTime(selectedEvent.date)} – ${formatTime(
                            selectedEvent.endDate
                          )}`
                    }
                  />

                  {selectedEvent.description && (
                    <DetailRow
                      label="Opis"
                      value={selectedEvent.description}
                    />
                  )}
                </div>

                <div className="calendar2-modal-actions">
                  <button
                    type="button"
                    className="calendar2-secondary"
                    onClick={() => setEditingEvent(true)}
                  >
                    ✏️ Edytuj
                  </button>

                  <button
                    type="button"
                    className="calendar2-danger"
                    onClick={removeEvent}
                    disabled={deleting}
                  >
                    {deleting ? 'Usuwanie...' : '🗑️ Usuń'}
                  </button>
                </div>
              </>
            ) : (
              <EventFormFields
                form={editForm}
                setForm={setEditForm}
                onSubmit={updateEvent}
                buttonText={
                  updating ? 'Zapisywanie...' : '✓ Zapisz zmiany'
                }
                disabled={updating}
                cancelText="Anuluj"
                onCancel={() => setEditingEvent(false)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   FORMULARZ KALENDARZA
   ========================================================= */

function createDefaultForm(date: Date, time = '12:00'): EventForm {
  const start = new Date(date);

  const [hours, minutes] = time.split(':').map(Number);

  start.setHours(
    Number.isFinite(hours) ? hours : 12,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );

  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    title: '',
    person: 'family',
    date: formatDateInput(date),
    allDay: false,
    startTime: formatTimeInput(start),
    endTime: formatTimeInput(end),
    description: '',
  };
}

function buildEventDates(
  form: EventForm
): { start: Date; end: Date } | null {
  if (!form.date) return null;

  if (form.allDay) {
    const start = parseLocalDate(form.date, '00:00');
    const end = parseLocalDate(form.date, '23:59');

    return { start, end };
  }

  if (!form.startTime || !form.endTime) {
    return null;
  }

  const start = parseLocalDate(form.date, form.startTime);
  const end = parseLocalDate(form.date, form.endTime);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    alert('Nieprawidłowa data lub godzina.');
    return null;
  }

  if (end.getTime() <= start.getTime()) {
    alert('Godzina zakończenia musi być późniejsza od rozpoczęcia.');
    return null;
  }

  return { start, end };
}

function EventFormFields({
  form,
  setForm,
  onSubmit,
  buttonText,
  disabled,
  cancelText,
  onCancel,
}: {
  form: EventForm;
  setForm: React.Dispatch<React.SetStateAction<EventForm>>;
  onSubmit: (e: React.FormEvent) => void;
  buttonText: string;
  disabled: boolean;
  cancelText?: string;
  onCancel?: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="calendar2-form">
      <label className="calendar2-field calendar2-field-wide">
        <span>Nazwa wydarzenia</span>

        <input
          type="text"
          value={form.title}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              title: e.target.value,
            }))
          }
          placeholder="Np. dentysta, urodziny, trening..."
          required
        />
      </label>

      <label className="calendar2-field">
        <span>Dla kogo?</span>

        <select
          value={form.person}
          onChange={(e) => {
            const value = e.target.value;

            if (!isPersonKey(value)) return;

            setForm((current) => ({
              ...current,
              person: value,
            }));
          }}
        >
          <option value="family">Cała rodzina</option>
          <option value="Sebastian">Sebastian</option>
          <option value="Dominika">Dominika</option>
          <option value="Paweł">Paweł</option>
          <option value="Nikodem">Nikodem</option>
          <option value="Layla">Layla</option>
        </select>
      </label>

      <label className="calendar2-field">
        <span>Data</span>

        <input
          type="date"
          value={form.date}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              date: e.target.value,
            }))
          }
          required
        />
      </label>

      <label className="calendar2-all-day">
        <input
          type="checkbox"
          checked={form.allDay}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              allDay: e.target.checked,
            }))
          }
        />

        <span>Cały dzień</span>
      </label>

      {!form.allDay && (
        <>
          <label className="calendar2-field">
            <span>Od</span>

            <input
              type="time"
              value={form.startTime}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  startTime: e.target.value,
                }))
              }
              required
            />
          </label>

          <label className="calendar2-field">
            <span>Do</span>

            <input
              type="time"
              value={form.endTime}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  endTime: e.target.value,
                }))
              }
              required
            />
          </label>
        </>
      )}

      <label className="calendar2-field calendar2-field-wide">
        <span>Opis / notatka</span>

        <textarea
          value={form.description}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              description: e.target.value,
            }))
          }
          placeholder="Opcjonalna notatka..."
          rows={3}
        />
      </label>

      <div className="calendar2-form-actions calendar2-field-wide">
        {onCancel && (
          <button
            type="button"
            className="calendar2-secondary"
            onClick={onCancel}
            disabled={disabled}
          >
            {cancelText || 'Anuluj'}
          </button>
        )}

        <button
          type="submit"
          className="primary-button"
          disabled={disabled}
        >
          {buttonText}
        </button>
      </div>
    </form>
  );
}

/* =========================================================
   WIDOK DNIA
   ========================================================= */

function DayView({
  date,
  events,
  onEvent,
  onAdd,
}: {
  date: Date;
  events: CalendarEventData[];
  onEvent: (event: CalendarEventData) => void;
  onAdd: (date: Date, time?: string) => void;
}) {
  const dayEvents = events.filter((event) => sameDay(event.date, date));

  const allDayEvents = dayEvents.filter((event) => event.allDay);
  const timedEvents = dayEvents.filter((event) => !event.allDay);

  const hours = Array.from({ length: 24 }, (_, index) => index);

  return (
    <section className="calendar2-day-view">
      <div className="calendar2-day-title">
        <div
          className={`calendar2-big-date ${
            sameDay(date, new Date()) ? 'today' : ''
          }`}
        >
          <strong>{date.getDate()}</strong>

          <span>
            {capitalize(
              date.toLocaleDateString('pl-PL', {
                weekday: 'long',
                month: 'long',
              })
            )}
          </span>
        </div>

        <button
          type="button"
          className="calendar2-add-day"
          onClick={() => onAdd(date)}
        >
          ＋ Dodaj
        </button>
      </div>

      <div className="calendar2-all-day-row">
        <div className="calendar2-time-label">Cały dzień</div>

        <div className="calendar2-all-day-content">
          {allDayEvents.length === 0 ? (
            <button
              type="button"
              className="calendar2-empty-slot"
              onClick={() => {
                const formDate = new Date(date);
                onAdd(formDate);
              }}
            >
              ＋ Dodaj wydarzenie całodniowe
            </button>
          ) : (
            allDayEvents.map((event) => (
              <CalendarEventButton
                key={event.id}
                event={event}
                onClick={() => onEvent(event)}
              />
            ))
          )}
        </div>
      </div>

      <div className="calendar2-timeline">
        {hours.map((hour) => {
          const hourEvents = timedEvents.filter(
            (event) => event.date.getHours() === hour
          );

          const time = `${String(hour).padStart(2, '0')}:00`;

          return (
            <div className="calendar2-hour-row" key={hour}>
              <div className="calendar2-time-label">{time}</div>

              <div
                className="calendar2-hour-content"
                onClick={() => onAdd(date, time)}
              >
                {hourEvents.map((event) => (
                  <CalendarEventButton
                    key={event.id}
                    event={event}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEvent(event);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* =========================================================
   WIDOK MIESIĄCA
   ========================================================= */

function MonthView({
  focusDate,
  days,
  events,
  onEvent,
  onAdd,
  onOpenDay,
}: {
  focusDate: Date;
  days: Date[];
  events: CalendarEventData[];
  onEvent: (event: CalendarEventData) => void;
  onAdd: (date: Date, time?: string) => void;
  onOpenDay: (date: Date) => void;
}) {
  const weekNames = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Niedz'];

  return (
    <section className="calendar2-month-card">
      <div className="calendar2-month-scroll">
        <div className="calendar2-month-grid calendar2-month-head">
          {weekNames.map((name) => (
            <div key={name}>{name}</div>
          ))}
        </div>

        <div className="calendar2-month-grid">
          {days.map((day) => {
            const dayEvents = events.filter((event) =>
              sameDay(event.date, day)
            );

            const currentMonth =
              day.getMonth() === focusDate.getMonth();

            const today = sameDay(day, new Date());

            return (
              <div
                key={formatDateInput(day)}
                className={`calendar2-month-day ${
                  !currentMonth ? 'outside' : ''
                } ${today ? 'today' : ''}`}
              >
                <div className="calendar2-month-day-top">
                  <button
                    type="button"
                    className="calendar2-month-number"
                    onClick={() => onOpenDay(day)}
                  >
                    {day.getDate()}
                  </button>

                  <button
                    type="button"
                    className="calendar2-month-plus"
                    onClick={() => onAdd(day)}
                    title="Dodaj wydarzenie"
                  >
                    ＋
                  </button>
                </div>

                <div
                  className="calendar2-month-events"
                  onClick={() => onAdd(day)}
                >
                  {dayEvents.slice(0, 3).map((event) => (
                    <CalendarEventButton
                      key={event.id}
                      event={event}
                      compact
                      onClick={(e) => {
                        e.stopPropagation();
                        onEvent(event);
                      }}
                    />
                  ))}

                  {dayEvents.length > 3 && (
                    <button
                      type="button"
                      className="calendar2-more"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDay(day);
                      }}
                    >
                      +{dayEvents.length - 3} więcej
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   EVENT
   ========================================================= */

function CalendarEventButton({
  event,
  onClick,
  compact = false,
}: {
  event: CalendarEventData;
  onClick:
    | (() => void)
    | ((e: React.MouseEvent<HTMLButtonElement>) => void);
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`calendar2-event ${personEventClass(event.person)} ${
        compact ? 'compact' : ''
      }`}
      style={{
        borderLeftColor: personColor(event.person),
      }}
      onClick={onClick}
    >
      <strong>{event.title}</strong>

      {!compact && (
        <span>
          {event.allDay
            ? 'Cały dzień'
            : `${formatTime(event.date)}–${formatTime(event.endDate)}`}
          {' · '}
          {personLabel(event.person)}
        </span>
      )}
    </button>
  );
}

/* =========================================================
   PANEL BOCZNY
   ========================================================= */

function CalendarSidePanel({
  todayEvents,
  upcomingEvents,
  onEvent,
}: {
  todayEvents: CalendarEventData[];
  upcomingEvents: CalendarEventData[];
  onEvent: (event: CalendarEventData) => void;
}) {
  return (
    <aside className="calendar2-side">
      <div className="app-card">
        <h3>☀️ Dzisiaj</h3>

        {todayEvents.length === 0 ? (
          <p className="calendar2-muted">Brak wydarzeń na dziś.</p>
        ) : (
          todayEvents.map((event) => (
            <CalendarEventButton
              key={event.id}
              event={event}
              onClick={() => onEvent(event)}
            />
          ))
        )}
      </div>

      <div className="app-card">
        <h3>🗓️ Nadchodzące</h3>

        {upcomingEvents.length === 0 ? (
          <p className="calendar2-muted">Brak nadchodzących wydarzeń.</p>
        ) : (
          upcomingEvents.map((event) => (
            <CalendarEventButton
              key={event.id}
              event={event}
              onClick={() => onEvent(event)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

/* =========================================================
   FILTR
   ========================================================= */

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`calendar2-filter ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* =========================================================
   DETAIL
   ========================================================= */

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="calendar2-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/* =========================================================
   ZADANIA
   ========================================================= */

type SimpleItem = {
  id: string;
  title: string;
  person?: PersonKey;
  done?: boolean;
  note?: string;
  createdAt?: Date;
};

function useSimpleCollection(name: string) {
  const [items, setItems] = useState<SimpleItem[]>([]);
  useEffect(() => onSnapshot(collection(db, name), snap => {
    const next: SimpleItem[] = snap.docs.map(d => {
      const x = d.data();
      return { id: d.id, title: String(x.title || ''), person: isPersonKey(x.person) ? x.person : 'family', done: x.done === true, note: typeof x.note === 'string' ? x.note : '', createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    });
    next.sort((a,b)=>(b.createdAt?.getTime()||0)-(a.createdAt?.getTime()||0));
    setItems(next);
  }), [name]);
  return items;
}

function ModuleHeader({icon,title,text,action}:{icon:string;title:string;text:string;action?:React.ReactNode}) {
  return <section className="page-header"><div><small>Nasza Rodzina</small><h1>{icon} {title}</h1><p>{text}</p></div>{action}</section>;
}

function PersonSelect({value,onChange}:{value:PersonKey;onChange:(v:PersonKey)=>void}) {
  return <select value={value} onChange={e=>isPersonKey(e.target.value)&&onChange(e.target.value)}>
    <option value="family">Cała rodzina</option><option value="Sebastian">Sebastian</option><option value="Dominika">Dominika</option><option value="Paweł">Paweł</option><option value="Nikodem">Nikodem</option><option value="Layla">Layla</option>
  </select>;
}

function TasksPage({user}:{user:User}) {
  const items=useSimpleCollection('tasks'); const [title,setTitle]=useState(''); const [person,setPerson]=useState<PersonKey>('family');
  async function add(e:React.FormEvent){e.preventDefault();if(!title.trim())return;await addDoc(collection(db,'tasks'),{title:title.trim(),person,done:false,createdBy:user.uid,createdAt:Timestamp.now()});setTitle('');}
  return <div className="page-content"><ModuleHeader icon="✅" title="Zadania" text="Rodzinne obowiązki i rzeczy do zrobienia." />
    <form className="quick-add" onSubmit={add}><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Dodaj nowe zadanie…"/><PersonSelect value={person} onChange={setPerson}/><button className="primary-button">＋ Dodaj</button></form>
    <section className="module-list">{items.length===0?<EmptyState icon="✨" text="Nie ma jeszcze zadań."/>:items.map(i=><article className={`module-row ${i.done?'done':''}`} key={i.id}><button className="check-button" onClick={()=>updateDoc(doc(db,'tasks',i.id),{done:!i.done})}>{i.done?'✓':'○'}</button><div><strong>{i.title}</strong><small>{personLabel(i.person||'family')}</small></div><button className="icon-danger" onClick={()=>deleteDoc(doc(db,'tasks',i.id))}>🗑️</button></article>)}</section>
  </div>;
}

function ShoppingPage({user}:{user:User}) {
  const items=useSimpleCollection('shoppingItems'); const [title,setTitle]=useState('');
  async function add(e:React.FormEvent){e.preventDefault();if(!title.trim())return;await addDoc(collection(db,'shoppingItems'),{title:title.trim(),done:false,createdBy:user.uid,createdAt:Timestamp.now()});setTitle('');}
  return <div className="page-content"><ModuleHeader icon="🛒" title="Zakupy" text="Jedna wspólna lista zakupów dla całej rodziny." />
    <form className="quick-add shopping" onSubmit={add}><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Np. mleko, pieczywo, pieluchy…"/><button className="primary-button">＋ Dodaj</button></form>
    <section className="module-list">{items.length===0?<EmptyState icon="🛍️" text="Lista zakupów jest pusta."/>:items.map(i=><article className={`module-row ${i.done?'done':''}`} key={i.id}><button className="check-button" onClick={()=>updateDoc(doc(db,'shoppingItems',i.id),{done:!i.done})}>{i.done?'✓':'○'}</button><div><strong>{i.title}</strong><small>{i.done?'Kupione':'Do kupienia'}</small></div><button className="icon-danger" onClick={()=>deleteDoc(doc(db,'shoppingItems',i.id))}>🗑️</button></article>)}</section>
  </div>;
}

type ChatMessage={id:string;text:string;name:string;uid:string;createdAt?:Date};
function ChatPage({user,member}:{user:User;member:Member|null}) {
  const [messages,setMessages]=useState<ChatMessage[]>([]);const [text,setText]=useState('');
  useEffect(()=>onSnapshot(collection(db,'familyMessages'),snap=>{const m=snap.docs.map(d=>{const x=d.data();return{id:d.id,text:String(x.text||''),name:String(x.name||'Rodzina'),uid:String(x.uid||''),createdAt:x.createdAt instanceof Timestamp?x.createdAt.toDate():undefined}});m.sort((a,b)=>(a.createdAt?.getTime()||0)-(b.createdAt?.getTime()||0));setMessages(m.slice(-100));}),[]);
  async function send(e:React.FormEvent){e.preventDefault();if(!text.trim())return;await addDoc(collection(db,'familyMessages'),{text:text.trim(),name:member?.name||'Rodzina',uid:user.uid,createdAt:Timestamp.now()});setText('');}
  return <div className="page-content"><ModuleHeader icon="💬" title="Czat" text="Prywatne wiadomości Waszej rodziny."/><section className="chat-card"><div className="chat-messages">{messages.length===0?<EmptyState icon="💬" text="Napisz pierwszą wiadomość."/>:messages.map(m=><div key={m.id} className={`chat-bubble ${m.uid===user.uid?'mine':''}`}><strong>{m.name}</strong><p>{m.text}</p><small>{m.createdAt?formatTime(m.createdAt):''}</small></div>)}</div><form className="chat-compose" onSubmit={send}><input value={text} onChange={e=>setText(e.target.value)} placeholder="Napisz wiadomość…"/><button className="primary-button">Wyślij</button></form></section></div>;
}

function HealthPage({user}:{user:User}) { return <RecordPage user={user} collectionName="healthRecords" icon="❤️" title="Zdrowie" text="Wizyty, lekarze, wyniki i ważne rodzinne informacje." placeholder="Np. kontrola u dentysty…"/>; }
function SchoolPage({user}:{user:User}) { return <RecordPage user={user} collectionName="schoolItems" icon="🎒" title="Szkoła" text="Plan lekcji, sprawdziany, zadania i zajęcia dzieci." placeholder="Np. sprawdzian z matematyki…"/>; }
function RecordPage({user,collectionName,icon,title,text,placeholder}:{user:User;collectionName:string;icon:string;title:string;text:string;placeholder:string}) {
  const items=useSimpleCollection(collectionName);const [value,setValue]=useState('');const [person,setPerson]=useState<PersonKey>(title==='Szkoła'?'Nikodem':'family');
  async function add(e:React.FormEvent){e.preventDefault();if(!value.trim())return;await addDoc(collection(db,collectionName),{title:value.trim(),person,note:'',createdBy:user.uid,createdAt:Timestamp.now()});setValue('');}
  return <div className="page-content"><ModuleHeader icon={icon} title={title} text={text}/><form className="quick-add" onSubmit={add}><input value={value} onChange={e=>setValue(e.target.value)} placeholder={placeholder}/><PersonSelect value={person} onChange={setPerson}/><button className="primary-button">＋ Dodaj</button></form><section className="module-list">{items.length===0?<EmptyState icon={icon} text={`Brak wpisów w module ${title}.`}/>:items.map(i=><article className="module-row" key={i.id}><div className="record-dot" style={{background:personColor(i.person||'family')}}/><div><strong>{i.title}</strong><small>{personLabel(i.person||'family')}</small></div><button className="icon-danger" onClick={()=>deleteDoc(doc(db,collectionName,i.id))}>🗑️</button></article>)}</section></div>;
}

type FamilyMemberDoc={id:string;name:string;role:string;photoURL?:string;active?:boolean};
function FamilyPage(){const [members,setMembers]=useState<FamilyMemberDoc[]>([]);useEffect(()=>onSnapshot(collection(db,'members'),snap=>setMembers(snap.docs.map(d=>{const x=d.data();return{id:d.id,name:String(x.name||'Rodzina'),role:String(x.role||'Członek rodziny'),photoURL:typeof x.photoURL==='string'?x.photoURL:undefined,active:x.active!==false}}))),[]);return <div className="page-content"><ModuleHeader icon="👨‍👩‍👧‍👦" title="Rodzina" text="Wasze profile w rodzinnym centrum."/><section className="family-grid">{members.map((m,index)=><article className="family-profile-card" key={m.id}><div className="family-profile-avatar">{m.photoURL?<img src={m.photoURL} alt=""/>:['👨','👩','🧑','👦','👶'][index%5]}</div><h3>{m.name}</h3><p>{m.role}</p><span className={m.active?'status-active':'status-muted'}>{m.active?'● Aktywny':'○ Nieaktywny'}</span></article>)}</section></div>}

function SettingsPage({member}:{member:Member|null}){return <div className="page-content"><ModuleHeader icon="⚙️" title="Ustawienia" text="Konto, wygląd i przyszłe połączenia aplikacji."/><section className="settings-grid"><div className="app-card"><h3>👤 Twoje konto</h3><p><strong>{member?.name||'Użytkownik'}</strong><br/>{member?.role||'Rodzina'}</p></div><div className="app-card"><h3>📅 Połączone kalendarze</h3><p>Google Calendar, Outlook i eksport Apple Calendar przygotujemy jako osobną integrację wymagającą autoryzacji.</p><span className="setting-badge">Do podłączenia</span></div><div className="app-card"><h3>🔔 Powiadomienia</h3><p>Interfejs jest gotowy do dalszego etapu z powiadomieniami push.</p><span className="setting-badge">Etap 2</span></div><div className="app-card"><h3>🔐 Prywatność</h3><p>Dane aplikacji są dostępne wyłącznie po zalogowaniu zgodnie z regułami Firestore.</p></div></section></div>}

function EmptyState({icon,text}:{icon:string;text:string}){return <div className="empty-state"><span>{icon}</span><p>{text}</p></div>}

/* =========================================================
   POZOSTAŁE STRONY
   ========================================================= */

function ComingSoon({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="page-content">
      <section className="coming-soon">
        <div className="coming-icon">{icon}</div>
        <h1>{title}</h1>
        <p>{text}</p>
        <span>Ten moduł przygotujemy w kolejnym etapie.</span>
      </section>
    </div>
  );
}

function AppCard({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <article className="app-card">
      <div className="card-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

/* =========================================================
   NAWIGACJA MOBILNA
   ========================================================= */

function MobileNavigation({
  page,
  setPage,
}: {
  page: Page;
  setPage: React.Dispatch<React.SetStateAction<Page>>;
}) {
  const items: Array<{
    page: Page;
    icon: string;
    label: string;
  }> = [
    { page: 'Start', icon: '🏠', label: 'Start' },
    { page: 'Kalendarz', icon: '📅', label: 'Kalendarz' },
    { page: 'Zadania', icon: '✅', label: 'Zadania' },
    { page: 'Zakupy', icon: '🛒', label: 'Zakupy' },
    { page: 'Ustawienia', icon: '⚙️', label: 'Więcej' },
  ];

  return (
    <nav className="mobile-navigation">
      {items.map((item) => (
        <button
          type="button"
          key={item.page}
          className={page === item.page ? 'active' : ''}
          onClick={() => setPage(item.page)}
        >
          <span>{item.icon}</span>
          <small>{item.label}</small>
        </button>
      ))}
    </nav>
  );
}

/* =========================================================
   STYLE NOWEGO KALENDARZA
   Są tutaj, więc NIE musisz zmieniać style.css.
   ========================================================= */

const calendarStageStyles = `
  .calendar2-toolbar {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    background: #ffffff;
    border-radius: 18px;
    padding: 14px;
    margin-bottom: 14px;
    box-shadow: 0 8px 28px rgba(15, 42, 70, 0.06);
  }

  .calendar2-navigation {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1 1 300px;
  }

  .calendar2-navigation strong {
    min-width: 210px;
    text-align: center;
    color: #173b63;
    font-size: 16px;
  }

  .calendar2-navigation button,
  .calendar2-today {
    border: 1px solid #dce6ef;
    background: #fff;
    color: #173b63;
    border-radius: 11px;
    min-height: 42px;
    padding: 0 15px;
    font-weight: 800;
    cursor: pointer;
  }

  .calendar2-navigation button {
    font-size: 25px;
    min-width: 44px;
  }

  .calendar2-view-switch {
    display: flex;
    padding: 4px;
    background: #eef4f8;
    border-radius: 12px;
  }

  .calendar2-view-switch button {
    border: 0;
    background: transparent;
    color: #557086;
    padding: 9px 14px;
    border-radius: 9px;
    font-weight: 700;
    cursor: pointer;
  }

  .calendar2-view-switch button.active {
    background: #fff;
    color: #153a63;
    box-shadow: 0 2px 8px rgba(20, 52, 83, 0.09);
  }

  .calendar2-filters {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 3px 1px 14px;
    scrollbar-width: thin;
  }

  .calendar2-filter {
    white-space: nowrap;
    border: 1px solid #dfe8ef;
    background: #fff;
    color: #486176;
    padding: 9px 13px;
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
  }

  .calendar2-filter.active {
    color: #153a63;
    border-color: #9fc5e8;
    background: #edf7ff;
  }

  .calendar2-week-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 18px;
    align-items: start;
  }

  .calendar2-week-card,
  .calendar2-month-card,
  .calendar2-day-view {
    background: #fff;
    border-radius: 20px;
    box-shadow: 0 8px 28px rgba(15, 42, 70, 0.06);
    overflow: hidden;
  }

  .calendar2-week-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    min-height: 480px;
  }

  .calendar2-week-day {
    position: relative;
    min-width: 0;
    border-right: 1px solid #e8eef3;
    padding: 10px 8px 14px;
  }

  .calendar2-week-day:last-child {
    border-right: 0;
  }

  .calendar2-week-day.today {
    background: #f3f9ff;
  }

  .calendar2-day-heading {
    width: 100%;
    border: 0;
    background: transparent;
    color: #607589;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 5px;
  }

  .calendar2-day-heading strong {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #173b63;
    font-size: 17px;
  }

  .calendar2-week-day.today .calendar2-day-heading strong {
    background: #2583dc;
    color: #fff;
  }

  .calendar2-empty-add {
    display: block;
    margin: 4px auto 8px;
    width: 30px;
    height: 30px;
    border: 1px dashed #c6d6e3;
    background: transparent;
    color: #7890a3;
    border-radius: 9px;
    cursor: pointer;
  }

  .calendar2-day-events {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .calendar2-no-events,
  .calendar2-muted {
    color: #8ca0af;
  }

  .calendar2-event {
    width: 100%;
    text-align: left;
    border: 0;
    border-left: 4px solid;
    background: #f5f8fb;
    border-radius: 8px;
    padding: 8px;
    cursor: pointer;
    overflow: hidden;
  }

  .calendar2-event strong {
    display: block;
    color: #173b63;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .calendar2-event span {
    display: block;
    margin-top: 3px;
    color: #64798a;
    font-size: 11px;
  }

  .calendar2-event.compact {
    padding: 5px 6px;
  }

  .calendar2-event.compact strong {
    font-size: 11px;
    white-space: nowrap;
  }

  .calendar2-side {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .calendar2-side .app-card {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .calendar2-side h3 {
    margin-top: 0;
  }

  .calendar2-day-title {
    padding: 20px;
    border-bottom: 1px solid #e7eef4;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .calendar2-big-date {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #173b63;
  }

  .calendar2-big-date strong {
    font-size: 32px;
    width: 52px;
    height: 52px;
    display: grid;
    place-items: center;
    border-radius: 50%;
  }

  .calendar2-big-date.today strong {
    background: #2583dc;
    color: #fff;
  }

  .calendar2-big-date span {
    font-weight: 800;
  }

  .calendar2-add-day {
    border: 0;
    background: #edf7ff;
    color: #1974c6;
    padding: 10px 14px;
    border-radius: 10px;
    font-weight: 800;
    cursor: pointer;
  }

  .calendar2-all-day-row,
  .calendar2-hour-row {
    display: grid;
    grid-template-columns: 85px minmax(0, 1fr);
  }

  .calendar2-all-day-row {
    border-bottom: 2px solid #dfe8ef;
  }

  .calendar2-hour-row {
    min-height: 64px;
    border-bottom: 1px solid #edf1f4;
  }

  .calendar2-time-label {
    padding: 12px 10px;
    text-align: right;
    color: #7c8e9d;
    font-size: 12px;
    border-right: 1px solid #e7edf2;
  }

  .calendar2-all-day-content,
  .calendar2-hour-content {
    padding: 7px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .calendar2-hour-content {
    cursor: pointer;
  }

  .calendar2-hour-content:hover {
    background: #f8fbfd;
  }

  .calendar2-empty-slot {
    border: 1px dashed #ccd9e3;
    background: #fbfdfe;
    color: #71879a;
    border-radius: 8px;
    padding: 8px;
    cursor: pointer;
    text-align: left;
  }

  .calendar2-month-card {
    width: 100%;
  }

  .calendar2-month-scroll {
    overflow-x: auto;
  }

  .calendar2-month-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    min-width: 720px;
  }

  .calendar2-month-head {
    background: #f5f8fb;
    border-bottom: 1px solid #e2eaf0;
  }

  .calendar2-month-head > div {
    padding: 12px;
    text-align: center;
    color: #61788b;
    font-size: 12px;
    font-weight: 800;
  }

  .calendar2-month-day {
    min-height: 125px;
    padding: 7px;
    border-right: 1px solid #e8eef3;
    border-bottom: 1px solid #e8eef3;
    background: #fff;
  }

  .calendar2-month-day.outside {
    background: #fafcfd;
    opacity: 0.55;
  }

  .calendar2-month-day.today {
    background: #f1f8ff;
  }

  .calendar2-month-day-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 5px;
  }

  .calendar2-month-number,
  .calendar2-month-plus {
    border: 0;
    background: transparent;
    cursor: pointer;
    color: #173b63;
    font-weight: 800;
  }

  .calendar2-month-number {
    width: 30px;
    height: 30px;
    border-radius: 50%;
  }

  .calendar2-month-day.today .calendar2-month-number {
    background: #2583dc;
    color: #fff;
  }

  .calendar2-month-plus {
    color: #8ba0b0;
    font-size: 17px;
  }

  .calendar2-month-events {
    min-height: 75px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: pointer;
  }

  .calendar2-more {
    border: 0;
    background: transparent;
    color: #47749a;
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .calendar2-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-top: 15px;
  }

  .calendar2-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .calendar2-field span {
    color: #526a7e;
    font-size: 13px;
    font-weight: 800;
  }

  .calendar2-field input,
  .calendar2-field select,
  .calendar2-field textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #dce5ec;
    border-radius: 11px;
    padding: 11px 12px;
    background: #fff;
    color: #173b63;
    font: inherit;
  }

  .calendar2-field textarea {
    resize: vertical;
  }

  .calendar2-field-wide {
    grid-column: 1 / -1;
  }

  .calendar2-all-day {
    display: flex;
    align-items: center;
    gap: 9px;
    color: #173b63;
    font-weight: 800;
    min-height: 44px;
  }

  .calendar2-all-day input {
    width: 18px;
    height: 18px;
  }

  .calendar2-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .calendar2-secondary,
  .calendar2-danger {
    border: 0;
    border-radius: 11px;
    padding: 10px 15px;
    font-weight: 800;
    cursor: pointer;
  }

  .calendar2-secondary {
    background: #edf3f7;
    color: #36566f;
  }

  .calendar2-danger {
    background: #fff0f0;
    color: #c33b3b;
  }

  .calendar2-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(11, 28, 44, 0.52);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
  }

  .calendar2-modal {
    width: min(560px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    background: #fff;
    border-radius: 20px;
    padding: 20px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
  }

  .calendar2-modal-header {
    display: flex;
    justify-content: space-between;
    gap: 15px;
    align-items: flex-start;
  }

  .calendar2-modal-header h2 {
    margin: 4px 0 0;
    color: #173b63;
  }

  .calendar2-modal-header small {
    color: #8193a2;
  }

  .calendar2-close {
    border: 0;
    background: #f0f4f7;
    color: #52687a;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
  }

  .calendar2-event-details {
    margin-top: 20px;
    border-top: 1px solid #e8eef3;
  }

  .calendar2-detail-row {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 12px;
    padding: 13px 0;
    border-bottom: 1px solid #edf1f4;
  }

  .calendar2-detail-row span {
    color: #8092a1;
  }

  .calendar2-detail-row strong {
    color: #173b63;
    white-space: pre-wrap;
  }

  .calendar2-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 18px;
  }

  @media (max-width: 1100px) {
    .calendar2-week-layout {
      grid-template-columns: 1fr;
    }

    .calendar2-side {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .calendar2-week-card {
      overflow-x: auto;
    }

    .calendar2-week-grid {
      min-width: 760px;
    }
  }

  @media (max-width: 700px) {
    .calendar2-toolbar {
      align-items: stretch;
    }

    .calendar2-navigation {
      flex-basis: 100%;
      justify-content: space-between;
    }

    .calendar2-navigation strong {
      min-width: 0;
      flex: 1;
    }

    .calendar2-today {
      flex: 1;
    }

    .calendar2-view-switch {
      flex: 2;
    }

    .calendar2-view-switch button {
      flex: 1;
      padding-left: 8px;
      padding-right: 8px;
    }

    .calendar2-side {
      grid-template-columns: 1fr;
    }

    .calendar2-form {
      grid-template-columns: 1fr;
    }

    .calendar2-field-wide {
      grid-column: auto;
    }

    .calendar2-all-day-row,
    .calendar2-hour-row {
      grid-template-columns: 62px minmax(0, 1fr);
    }

    .calendar2-time-label {
      padding-left: 4px;
      padding-right: 7px;
      font-size: 11px;
    }

    .calendar2-day-title {
      padding: 14px;
    }

    .calendar2-big-date strong {
      width: 44px;
      height: 44px;
      font-size: 26px;
    }

    .calendar2-big-date span {
      font-size: 13px;
    }

    .calendar2-modal {
      padding: 16px;
    }

    .calendar2-detail-row {
      grid-template-columns: 80px 1fr;
    }
  }
`;

/* =========================================================
   START REACT
   ========================================================= */

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
