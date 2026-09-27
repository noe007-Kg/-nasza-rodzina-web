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
  doc,
  getDoc,
  onSnapshot,
  Timestamp,
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

type CalendarEventData = {
  id: string;
  title: string;
  person: PersonKey;
  date: Date;
  createdBy: string;
};

type NewEventForm = {
  title: string;
  person: PersonKey;
  date: string;
  time: string;
};

/* =========================================================
   RODZINA
   ========================================================= */

const family = [
  {
    name: 'Sebastian',
    role: 'Tata',
    letter: 'S',
    avatarClass: 'avatar-blue',
  },
  {
    name: 'Dominika',
    role: 'Mama',
    letter: 'D',
    avatarClass: 'avatar-purple',
  },
  {
    name: 'Paweł',
    role: 'Syn',
    letter: 'P',
    avatarClass: 'avatar-green',
  },
  {
    name: 'Nikodem',
    role: 'Syn',
    letter: 'N',
    avatarClass: 'avatar-orange',
  },
  {
    name: 'Layla',
    role: 'Córka',
    letter: 'L',
    avatarClass: 'avatar-pink',
  },
];

/* =========================================================
   FUNKCJE DAT
   ========================================================= */

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();

  const difference = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + difference);
  result.setHours(0, 0, 0, 0);

  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function weekTitle(start: Date): string {
  const end = addDays(start, 6);

  const startDay = start.getDate();
  const endDay = end.getDate();

  const startMonth = start.toLocaleDateString('pl-PL', {
    month: 'long',
  });

  const endMonth = end.toLocaleDateString('pl-PL', {
    month: 'long',
  });

  if (start.getMonth() === end.getMonth()) {
    return `${startDay}–${endDay} ${endMonth}`;
  }

  return `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
}

function personEventClass(person: PersonKey): string {
  switch (person) {
    case 'Sebastian':
      return 'event-blue';

    case 'Dominika':
      return 'event-purple';

    case 'Paweł':
      return 'event-green';

    case 'Nikodem':
      return 'event-orange';

    case 'Layla':
      return 'event-pink';

    default:
      return 'event-family';
  }
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

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (firebaseUser) => {
        setUser(firebaseUser);
        setMember(null);

        if (!firebaseUser) {
          setLoading(false);
          return;
        }

        try {
          const memberRef = doc(
            db,
            'members',
            firebaseUser.uid
          );

          const memberSnap = await getDoc(memberRef);

          if (memberSnap.exists()) {
            setMember(memberSnap.data() as Member);
          }
        } catch (error) {
          console.error('Błąd pobierania profilu:', error);
        }

        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="loading">
        Ładowanie Naszej Rodziny...
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <FamilyApp user={user} member={member} />;
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
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error(error);
      setError('Nieprawidłowy e-mail lub hasło.');
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🏠</div>

        <h1>Nasza Rodzina</h1>

        <p>Zaloguj się do rodzinnego centrum</p>

        <form onSubmit={handleLogin}>
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
              placeholder="Twoje hasło"
              required
            />
          </label>

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

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

function FamilyApp({
  user,
  member,
}: {
  user: User;
  member: Member | null;
}) {
  const [activePage, setActivePage] = useState<Page>('Start');

  const name = member?.name || 'Użytkowniku';

  function changePage(page: Page) {
    setActivePage(page);

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        changePage={changePage}
      />

      <main className="main-area">
        <FamilyHeader />

        {activePage === 'Start' && (
          <StartPage name={name} />
        )}

        {activePage === 'Kalendarz' && (
          <CalendarPage user={user} />
        )}

        {activePage === 'Zadania' && (
          <TasksPage />
        )}

        {activePage !== 'Start' &&
          activePage !== 'Kalendarz' &&
          activePage !== 'Zadania' && (
            <ComingSoonPage page={activePage} />
          )}

        <button className="floating-add">
          ＋ Dodaj
        </button>

        <MobileNavigation
          activePage={activePage}
          changePage={changePage}
        />
      </main>
    </div>
  );
}

/* =========================================================
   SIDEBAR
   ========================================================= */

function Sidebar({
  activePage,
  changePage,
}: {
  activePage: Page;
  changePage: (page: Page) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-icon">🏠</span>

        <strong>
          Nasza
          <br />
          Rodzina
        </strong>
      </div>

      <nav className="sidebar-nav">
        <NavButton
          active={activePage === 'Start'}
          onClick={() => changePage('Start')}
          icon="⌂"
          label="Start"
        />

        <NavButton
          active={activePage === 'Kalendarz'}
          onClick={() => changePage('Kalendarz')}
          icon="▦"
          label="Kalendarz"
        />

        <NavButton
          active={activePage === 'Zadania'}
          onClick={() => changePage('Zadania')}
          icon="☑"
          label="Zadania"
        />

        <NavButton
          active={activePage === 'Zakupy'}
          onClick={() => changePage('Zakupy')}
          icon="🛒"
          label="Zakupy"
        />

        <NavButton
          active={activePage === 'Czat'}
          onClick={() => changePage('Czat')}
          icon="○"
          label="Czat"
        />

        <NavButton
          active={activePage === 'Zdrowie'}
          onClick={() => changePage('Zdrowie')}
          icon="♡"
          label="Zdrowie"
        />

        <NavButton
          active={activePage === 'Szkoła'}
          onClick={() => changePage('Szkoła')}
          icon="◇"
          label="Szkoła"
        />

        <NavButton
          active={activePage === 'Rodzina'}
          onClick={() => changePage('Rodzina')}
          icon="♧"
          label="Rodzina"
        />

        <NavButton
          active={activePage === 'Ustawienia'}
          onClick={() => changePage('Ustawienia')}
          icon="⚙"
          label="Ustawienia"
        />
      </nav>

      <button
        className="logout-button"
        onClick={() => signOut(auth)}
      >
        ↪ Wyloguj
      </button>
    </aside>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      className={active ? 'nav-active' : ''}
      onClick={onClick}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

/* =========================================================
   GÓRNY PASEK RODZINY
   ========================================================= */

function FamilyHeader() {
  return (
    <header className="family-header">
      {family.map((person) => (
        <div
          className="family-person"
          key={person.name}
        >
          <div
            className={`avatar ${person.avatarClass}`}
          >
            {person.letter}
          </div>

          <div>
            <strong>{person.name}</strong>
            <small>{person.role}</small>
          </div>
        </div>
      ))}
    </header>
  );
}

/* =========================================================
   START
   ========================================================= */

function StartPage({
  name,
}: {
  name: string;
}) {
  return (
    <div className="page-content">
      <section className="start-hero">
        <div>
          <small>Niedziela, 27 września</small>

          <h1>
            Dzień dobry,
            <br />
            {name}!
          </h1>

          <p>
            Oto co dzieje się dziś w Waszej rodzinie.
          </p>
        </div>

        <div className="weather-card">
          <span className="weather-icon">☀️</span>

          <div>
            <strong>Kołobrzeg</strong>
            <b>18°C</b>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <AppCard title="📅 Dzisiaj w rodzinie">
          <div className="rows">
            <p>08:00 • Paweł — szkoła</p>
            <p>08:00 • Nikodem — szkoła</p>
            <p>13:00 • Sebastian — dyżur</p>
          </div>
        </AppCard>

        <AppCard title="✅ Zadania na dziś">
          <div className="rows">
            <p>☑ Strój na WF — Paweł</p>
            <p>☐ Zeszyt do matematyki</p>
            <p>☐ Przygotować drugie śniadanie</p>
          </div>
        </AppCard>

        <AppCard title="🛒 Lista zakupów">
          <div className="rows">
            <p>☐ Mleko</p>
            <p>☑ Chleb</p>
            <p>☐ Banany</p>
          </div>
        </AppCard>

        <AppCard title="🎒 Szkoła — Paweł">
          <div className="vulcan-status">
            <strong>VULCAN ●</strong>
            <span>Połączono</span>
          </div>

          <div className="rows">
            <p>🔔 Zmiana planu lekcji</p>
            <p>✉️ Nowa wiadomość od wychowawcy</p>
          </div>
        </AppCard>

        <AppCard title="❤️ Zdrowie">
          <div className="rows">
            <p>Layla — szczepienie • za 2 dni</p>
            <p>Dominika — wizyta kontrolna • za 7 dni</p>
          </div>
        </AppCard>

        <AppCard title="👨‍👩‍👧‍👦 Rodzina">
          <div className="rows">
            <p>🎂 Roczek Layli — 10.10</p>
            <p>❤️ Rocznica ślubu — 06.09</p>
          </div>
        </AppCard>
      </section>
    </div>
  );
}

/* =========================================================
   KALENDARZ
   ========================================================= */

function CalendarPage({
  user,
}: {
  user: User;
}) {
  const [weekStart, setWeekStart] = useState<Date>(
    () => startOfWeek(new Date())
  );

  const [events, setEvents] = useState<CalendarEventData[]>([]);

  const [selectedPerson, setSelectedPerson] =
    useState<PersonKey>('family');

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<NewEventForm>({
    title: '',
    person: 'family',
    date: formatDateInput(new Date()),
    time: '12:00',
  });

  /* =======================================================
     FIRESTORE — ODCZYT WYDARZEŃ
     ======================================================= */

  useEffect(() => {
    const eventsRef = collection(db, 'calendarEvents');

    const unsubscribe = onSnapshot(
      eventsRef,

      (snapshot) => {
        const loadedEvents: CalendarEventData[] = [];

        snapshot.forEach((eventDocument) => {
          const data = eventDocument.data();

          if (!(data.date instanceof Timestamp)) {
            return;
          }

          const person: PersonKey =
            isPersonKey(data.person)
              ? data.person
              : 'family';

          const title =
            typeof data.title === 'string' &&
            data.title.trim().length > 0
              ? data.title
              : 'Wydarzenie';

          const createdBy =
            typeof data.createdBy === 'string'
              ? data.createdBy
              : '';

          loadedEvents.push({
            id: eventDocument.id,
            title,
            person,
            date: data.date.toDate(),
            createdBy,
          });
        });

        loadedEvents.sort(
          (a, b) => a.date.getTime() - b.date.getTime()
        );

        setEvents(loadedEvents);
      },

      (error) => {
        console.error(
          'Błąd pobierania wydarzeń:',
          error
        );
      }
    );

    return unsubscribe;
  }, []);

  /* =======================================================
     DNI TYGODNIA
     ======================================================= */

  const weekDays = useMemo(() => {
    return Array.from(
      { length: 7 },
      (_, index) => addDays(weekStart, index)
    );
  }, [weekStart]);

  /* =======================================================
     FILTROWANIE WYDARZEŃ
     ======================================================= */

  const visibleEvents = useMemo(() => {
    const weekEnd = addDays(weekStart, 7);

    return events.filter((event) => {
      const inWeek =
        event.date >= weekStart &&
        event.date < weekEnd;

      const personMatches =
        selectedPerson === 'family' ||
        event.person === selectedPerson ||
        event.person === 'family';

      return inWeek && personMatches;
    });
  }, [events, weekStart, selectedPerson]);

  const todayEvents = useMemo(() => {
    const today = new Date();

    return events.filter((event) =>
      sameDay(event.date, today)
    );
  }, [events]);

  const upcomingEvents = useMemo(() => {
    const now = new Date();

    return events
      .filter((event) => event.date > now)
      .slice(0, 3);
  }, [events]);

  /* =======================================================
     ZAPIS NOWEGO WYDARZENIA
     ======================================================= */

  async function saveEvent(e: React.FormEvent) {
    e.preventDefault();

    const cleanTitle = form.title.trim();

    if (!cleanTitle) {
      return;
    }

    if (!form.date || !form.time) {
      return;
    }

    const eventDate = new Date(
      `${form.date}T${form.time}:00`
    );

    if (Number.isNaN(eventDate.getTime())) {
      alert('Nieprawidłowa data lub godzina.');
      return;
    }

    setSaving(true);

    try {
      await addDoc(
        collection(db, 'calendarEvents'),
        {
          title: cleanTitle,
          person: form.person,
          date: Timestamp.fromDate(eventDate),
          createdBy: user.uid,
          createdAt: Timestamp.now(),
        }
      );

      setWeekStart(startOfWeek(eventDate));

      setForm({
        title: '',
        person: 'family',
        date: formatDateInput(eventDate),
        time: '12:00',
      });

      setShowForm(false);
    } catch (error) {
      console.error(
        'Błąd zapisywania wydarzenia:',
        error
      );

      alert(
        'Nie udało się zapisać wydarzenia. Jeśli aplikacja działa poprawnie, w następnym kroku ustawimy reguły Firestore dla kalendarza.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-content">
      <section className="page-header">
        <div>
          <small>Nasza Rodzina</small>

          <h1>📅 Kalendarz</h1>

          <p>
            Wszystkie rodzinne wydarzenia w jednym miejscu.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={() =>
            setShowForm((current) => !current)
          }
        >
          {showForm
            ? '✕ Zamknij'
            : '＋ Dodaj wydarzenie'}
        </button>
      </section>

      {showForm && (
        <section
          className="app-card"
          style={{ marginBottom: '20px' }}
        >
          <h2>➕ Nowe wydarzenie</h2>

          <form
            onSubmit={saveEvent}
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '14px',
              alignItems: 'end',
            }}
          >
            <label style={formLabelStyle}>
              <strong>Nazwa</strong>

              <input
                type="text"
                value={form.title}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    title: e.target.value,
                  }))
                }
                placeholder="Np. Dentysta"
                required
                style={inputStyle}
              />
            </label>

            <label style={formLabelStyle}>
              <strong>Dla kogo?</strong>

              <select
                value={form.person}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    person: e.target.value as PersonKey,
                  }))
                }
                style={inputStyle}
              >
                <option value="family">
                  Cała rodzina
                </option>

                <option value="Sebastian">
                  Sebastian
                </option>

                <option value="Dominika">
                  Dominika
                </option>

                <option value="Paweł">
                  Paweł
                </option>

                <option value="Nikodem">
                  Nikodem
                </option>

                <option value="Layla">
                  Layla
                </option>
              </select>
            </label>

            <label style={formLabelStyle}>
              <strong>Data</strong>

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
                style={inputStyle}
              />
            </label>

            <label style={formLabelStyle}>
              <strong>Godzina</strong>

              <input
                type="time"
                value={form.time}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    time: e.target.value,
                  }))
                }
                required
                style={inputStyle}
              />
            </label>

            <button
              type="submit"
              className="primary-button"
              disabled={saving}
              style={{ height: '48px' }}
            >
              {saving
                ? 'Zapisywanie...'
                : '✓ Zapisz'}
            </button>
          </form>
        </section>
      )}

      <section className="calendar-toolbar">
        <div className="calendar-navigation">
          <button
            type="button"
            onClick={() =>
              setWeekStart((current) =>
                addDays(current, -7)
              )
            }
          >
            ‹
          </button>

          <strong>
            {weekTitle(weekStart)}
          </strong>

          <button
            type="button"
            onClick={() =>
              setWeekStart((current) =>
                addDays(current, 7)
              )
            }
          >
            ›
          </button>
        </div>

        <div className="view-switch">
          <button type="button">
            Dzień
          </button>

          <button
            type="button"
            className="selected"
          >
            Tydzień
          </button>

          <button type="button">
            Miesiąc
          </button>
        </div>
      </section>

      <section className="family-filters">
        <FilterButton
          active={selectedPerson === 'family'}
          onClick={() =>
            setSelectedPerson('family')
          }
        >
          ● Cała rodzina
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Sebastian'}
          onClick={() =>
            setSelectedPerson('Sebastian')
          }
        >
          🔵 Sebastian
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Dominika'}
          onClick={() =>
            setSelectedPerson('Dominika')
          }
        >
          🟣 Dominika
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Paweł'}
          onClick={() =>
            setSelectedPerson('Paweł')
          }
        >
          🟢 Paweł
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Nikodem'}
          onClick={() =>
            setSelectedPerson('Nikodem')
          }
        >
          🟠 Nikodem
        </FilterButton>

        <FilterButton
          active={selectedPerson === 'Layla'}
          onClick={() =>
            setSelectedPerson('Layla')
          }
        >
          🩷 Layla
        </FilterButton>
      </section>

      <section className="calendar-layout">
        <div className="calendar-box">
          <div className="week-grid">
            {weekDays.map((day) => {
              const dayEvents = visibleEvents.filter(
                (event) =>
                  sameDay(event.date, day)
              );

              return (
                <div
                  className="calendar-day"
                  key={day.toISOString()}
                >
                  <div className="calendar-day-header">
                    <small>
                      {capitalize(
                        day.toLocaleDateString(
                          'pl-PL',
                          {
                            weekday: 'short',
                          }
                        )
                      )}
                    </small>

                    <strong>
                      {day.getDate()}
                    </strong>
                  </div>

                  {dayEvents.map((event) => (
                    <div
                      className={`calendar-event ${personEventClass(
                        event.person
                      )}`}
                      key={event.id}
                    >
                      <small>
                        {formatTime(event.date)}
                      </small>

                      <strong>
                        {event.title}
                      </strong>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="calendar-side">
          <h2>Dzisiaj</h2>

          {todayEvents.length === 0 && (
            <p className="muted">
              Brak wydarzeń na dziś.
            </p>
          )}

          {todayEvents.map((event) => (
            <div
              className="today-event"
              key={event.id}
            >
              <b>{formatTime(event.date)}</b>

              <span>{event.title}</span>
            </div>
          ))}

          <h2 className="side-heading">
            Nadchodzące
          </h2>

          {upcomingEvents.length === 0 && (
            <p className="muted">
              Brak nadchodzących wydarzeń.
            </p>
          )}

          {upcomingEvents.map((event) => (
            <div
              className="upcoming"
              key={event.id}
            >
              <span>📅</span>

              <div>
                <strong>
                  {event.title}
                </strong>

                <small>
                  {event.date.toLocaleDateString(
                    'pl-PL'
                  )}
                  {' • '}
                  {formatTime(event.date)}
                </small>
              </div>
            </div>
          ))}
        </aside>
      </section>
    </div>
  );
}

/* =========================================================
   FILTRY
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
      className={
        active ? 'filter-selected' : ''
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* =========================================================
   ZADANIA
   ========================================================= */

function TasksPage() {
  return (
    <div className="page-content">
      <section className="page-header">
        <div>
          <small>Nasza Rodzina</small>

          <h1>Zadania</h1>

          <p>
            Rodzinne obowiązki i rzeczy do zrobienia.
          </p>
        </div>
      </section>

      <section className="module-grid module-grid-wide">
        <AppCard title="✅ Zadania">
          <div className="task-list">
            <label className="task-row">
              <input
                type="checkbox"
                defaultChecked
              />

              <span className="completed">
                Strój na WF — Paweł
              </span>
            </label>

            <label className="task-row">
              <input type="checkbox" />

              <span>
                Zeszyt do matematyki
              </span>
            </label>

            <label className="task-row">
              <input type="checkbox" />

              <span>
                Przygotować drugie śniadanie
              </span>
            </label>
          </div>
        </AppCard>

        <AppCard title="📊 Dzisiaj">
          <div className="progress-number">
            1/3
          </div>

          <p className="muted">
            wykonanych zadań
          </p>

          <div className="progress-bar">
            <span style={{ width: '33%' }} />
          </div>
        </AppCard>
      </section>
    </div>
  );
}

/* =========================================================
   POZOSTAŁE MODUŁY
   ========================================================= */

function ComingSoonPage({
  page,
}: {
  page: Page;
}) {
  return (
    <div className="page-content">
      <section className="page-header">
        <div>
          <small>Nasza Rodzina</small>

          <h1>{page}</h1>

          <p>
            Ten moduł przygotujemy w kolejnym kroku.
          </p>
        </div>
      </section>

      <AppCard title={`🚧 ${page}`}>
        <div className="rows">
          <p>
            Moduł jest już podłączony do nawigacji.
          </p>

          <p>
            Za chwilę dodamy tutaj jego właściwą zawartość.
          </p>
        </div>
      </AppCard>
    </div>
  );
}

/* =========================================================
   KARTA
   ========================================================= */

function AppCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="app-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/* =========================================================
   NAWIGACJA MOBILNA
   ========================================================= */

function MobileNavigation({
  activePage,
  changePage,
}: {
  activePage: Page;
  changePage: (page: Page) => void;
}) {
  return (
    <nav className="mobile-nav">
      <button
        className={
          activePage === 'Start'
            ? 'mobile-active'
            : ''
        }
        onClick={() =>
          changePage('Start')
        }
      >
        <span>⌂</span>
        <small>Start</small>
      </button>

      <button
        className={
          activePage === 'Kalendarz'
            ? 'mobile-active'
            : ''
        }
        onClick={() =>
          changePage('Kalendarz')
        }
      >
        <span>▦</span>
        <small>Kalendarz</small>
      </button>

      <button
        className={
          activePage === 'Zakupy'
            ? 'mobile-active'
            : ''
        }
        onClick={() =>
          changePage('Zakupy')
        }
      >
        <span>🛒</span>
        <small>Zakupy</small>
      </button>

      <button
        className={
          activePage === 'Rodzina'
            ? 'mobile-active'
            : ''
        }
        onClick={() =>
          changePage('Rodzina')
        }
      >
        <span>♧</span>
        <small>Rodzina</small>
      </button>

      <button
        onClick={() =>
          changePage('Ustawienia')
        }
      >
        <span>•••</span>
        <small>Więcej</small>
      </button>
    </nav>
  );
}

/* =========================================================
   STYLE FORMULARZA
   ========================================================= */

const formLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  height: '48px',
  padding: '10px 12px',
  border: '1px solid #dce6f0',
  borderRadius: '10px',
  background: '#f8fbff',
  color: '#12345e',
  fontSize: '16px',
};

/* =========================================================
   START REACT
   ========================================================= */

createRoot(
  document.getElementById('root')!
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
