import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from './firebase';
import './style.css';

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

const family = [
  { name: 'Sebastian', role: 'Tata', letter: 'S' },
  { name: 'Dominika', role: 'Mama', letter: 'D' },
  { name: 'Paweł', role: 'Syn', letter: 'P' },
  { name: 'Nikodem', role: 'Syn', letter: 'N' },
  { name: 'Layla', role: 'Córka', letter: 'L' },
];

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setMember(null);

      if (!firebaseUser) {
        setLoading(false);
        return;
      }

      try {
        const memberRef = doc(db, 'members', firebaseUser.uid);
        const memberSnap = await getDoc(memberRef);

        if (memberSnap.exists()) {
          setMember(memberSnap.data() as Member);
        }
      } catch (error) {
        console.error('Błąd pobierania profilu:', error);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  if (loading) {
    return <div className="loading">Ładowanie...</div>;
  }

  if (!user) {
    return <Login />;
  }

  return <FamilyApp user={user} member={member} />;
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

          {error && <div className="login-error">{error}</div>}

          <button type="submit" disabled={loggingIn}>
            {loggingIn ? 'Logowanie...' : 'Zaloguj się'}
          </button>
        </form>
      </div>
    </div>
  );
}

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>🏠</span>

          <div>
            Nasza
            <br />
            Rodzina
          </div>
        </div>

        <nav>
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

      <main className="main-area">
        <FamilyHeader />

        {activePage === 'Start' && (
          <StartPage name={name} />
        )}

        {activePage === 'Kalendarz' && (
          <CalendarPage />
        )}

        {activePage !== 'Start' &&
          activePage !== 'Kalendarz' && (
            <ComingSoonPage page={activePage} />
          )}

        <button className="add-button">
          <span>＋</span> Dodaj
        </button>

        <div className="mobile-nav">
          <button
            onClick={() => changePage('Start')}
            className={activePage === 'Start' ? 'mobile-active' : ''}
          >
            ⌂
            <small>Start</small>
          </button>

          <button
            onClick={() => changePage('Kalendarz')}
            className={
              activePage === 'Kalendarz' ? 'mobile-active' : ''
            }
          >
            ▦
            <small>Kalendarz</small>
          </button>

          <button
            onClick={() => changePage('Zakupy')}
            className={activePage === 'Zakupy' ? 'mobile-active' : ''}
          >
            🛒
            <small>Zakupy</small>
          </button>

          <button
            onClick={() => changePage('Rodzina')}
            className={activePage === 'Rodzina' ? 'mobile-active' : ''}
          >
            ♧
            <small>Rodzina</small>
          </button>

          <button>
            •••
            <small>Więcej</small>
          </button>
        </div>
      </main>
    </div>
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
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FamilyHeader() {
  return (
    <header className="family-header">
      {family.map((person) => (
        <div className="family-person" key={person.name}>
          <div className="avatar">
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

function StartPage({ name }: { name: string }) {
  return (
    <div className="dashboard">
      <section className="welcome">
        <div>
          <small>Niedziela, 27 września</small>

          <h1>Dzień dobry, {name}!</h1>

          <p>
            Oto co dzieje się dziś w Waszej rodzinie.
          </p>
        </div>

        <div className="weather">
          <span>☀️</span>

          <div>
            <strong>Kołobrzeg</strong>
            <b>18°C</b>
          </div>
        </div>
      </section>

      <section className="cards-grid">
        <DashboardCard title="📅 Dzisiaj w rodzinie">
          <p>08:00 • Paweł — szkoła</p>
          <p>08:00 • Nikodem — szkoła</p>
          <p>13:00 • Sebastian — dyżur</p>
        </DashboardCard>

        <DashboardCard title="✅ Zadania na dziś">
          <p>☑ Strój na WF — Paweł</p>
          <p>☐ Zeszyt do matematyki</p>
          <p>☐ Przygotować drugie śniadanie</p>
        </DashboardCard>

        <DashboardCard title="🛒 Lista zakupów">
          <p>☐ Mleko</p>
          <p>☑ Chleb</p>
          <p>☐ Banany</p>
        </DashboardCard>

        <DashboardCard title="🎒 Szkoła — Paweł">
          <div className="vulcan">
            <strong>VULCAN ●</strong>
            <span>Połączono</span>
          </div>

          <p>🔔 Zmiana planu lekcji</p>
          <p>✉️ Nowa wiadomość od wychowawcy</p>
        </DashboardCard>

        <DashboardCard title="❤️ Zdrowie">
          <p>Layla — szczepienie • za 2 dni</p>
          <p>Dominika — wizyta kontrolna • za 7 dni</p>
        </DashboardCard>

        <DashboardCard title="👨‍👩‍👧‍👦 Rodzina">
          <p>🎂 Roczek Layli — 10.10</p>
          <p>❤️ Rocznica ślubu — 06.09</p>
        </DashboardCard>
      </section>
    </div>
  );
}

function CalendarPage() {
  const days = [
    { day: 'Pon', date: '28' },
    { day: 'Wt', date: '29' },
    { day: 'Śr', date: '30' },
    { day: 'Czw', date: '1' },
    { day: 'Pt', date: '2' },
    { day: 'Sob', date: '3' },
    { day: 'Niedz', date: '4' },
  ];

  return (
    <div className="dashboard calendar-dashboard">
      <section className="calendar-heading">
        <div>
          <small>Nasza Rodzina</small>
          <h1>📅 Kalendarz</h1>
          <p>
            Wszystkie rodzinne wydarzenia w jednym miejscu.
          </p>
        </div>

        <button className="calendar-add">
          ＋ Dodaj wydarzenie
        </button>
      </section>

      <section className="calendar-toolbar">
        <div className="calendar-navigation">
          <button>‹</button>

          <strong>
            28 września – 4 października
          </strong>

          <button>›</button>
        </div>

        <div className="calendar-views">
          <button>Dzień</button>
          <button className="calendar-view-active">
            Tydzień
          </button>
          <button>Miesiąc</button>
        </div>
      </section>

      <section className="calendar-filters">
        <button className="filter-all">
          ● Cała rodzina
        </button>

        <button>🔵 Sebastian</button>
        <button>🟣 Dominika</button>
        <button>🟢 Paweł</button>
        <button>🟠 Nikodem</button>
        <button>🩷 Layla</button>
      </section>

      <section className="calendar-layout">
        <div className="calendar-main">
          <div className="week-grid">
            {days.map((item) => (
              <div className="day-column" key={item.day}>
                <div className="day-header">
                  <small>{item.day}</small>
                  <strong>{item.date}</strong>
                </div>

                {item.day === 'Pon' && (
                  <>
                    <CalendarEvent
                      time="08:00"
                      title="Paweł — szkoła"
                      className="event-pawel"
                    />

                    <CalendarEvent
                      time="08:00"
                      title="Nikodem — szkoła"
                      className="event-nikodem"
                    />
                  </>
                )}

                {item.day === 'Wt' && (
                  <CalendarEvent
                    time="10:30"
                    title="Layla — szczepienie"
                    className="event-layla"
                  />
                )}

                {item.day === 'Śr' && (
                  <CalendarEvent
                    time="13:00"
                    title="Sebastian — dyżur"
                    className="event-sebastian"
                  />
                )}

                {item.day === 'Czw' && (
                  <CalendarEvent
                    time="16:30"
                    title="Nikodem — zajęcia"
                    className="event-nikodem"
                  />
                )}

                {item.day === 'Pt' && (
                  <CalendarEvent
                    time="14:00"
                    title="Dominika — wizyta"
                    className="event-dominika"
                  />
                )}

                {item.day === 'Sob' && (
                  <CalendarEvent
                    time="11:00"
                    title="Rodzinny wyjazd"
                    className="event-family"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <aside className="calendar-side">
          <h2>Dzisiaj</h2>

          <div className="side-event">
            <b>08:00</b>
            <span>Paweł — szkoła</span>
          </div>

          <div className="side-event">
            <b>08:00</b>
            <span>Nikodem — szkoła</span>
          </div>

          <div className="side-event">
            <b>13:00</b>
            <span>Sebastian — dyżur</span>
          </div>

          <h2 className="upcoming-title">
            Nadchodzące
          </h2>

          <div className="upcoming-event">
            <span>❤️</span>
            <div>
              <strong>Szczepienie Layli</strong>
              <small>Za 2 dni • 10:30</small>
            </div>
          </div>

          <div className="upcoming-event">
            <span>🎂</span>
            <div>
              <strong>Roczek Layli</strong>
              <small>10 października</small>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function CalendarEvent({
  time,
  title,
  className,
}: {
  time: string;
  title: string;
  className: string;
}) {
  return (
    <div className={`calendar-event ${className}`}>
      <small>{time}</small>
      <strong>{title}</strong>
    </div>
  );
}

function ComingSoonPage({
  page,
}: {
  page: Page;
}) {
  return (
    <div className="dashboard">
      <section className="welcome">
        <div>
          <small>Nasza Rodzina</small>
          <h1>{page}</h1>
          <p>
            Ten moduł przygotujemy w kolejnym kroku.
          </p>
        </div>
      </section>

      <DashboardCard title={`🚧 ${page}`}>
        <p>
          Moduł jest już podłączony do nawigacji.
        </p>
        <p>
          Za chwilę dodamy tutaj jego właściwą zawartość.
        </p>
      </DashboardCard>
    </div>
  );
}

function DashboardCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="dashboard-card">
      <h2>{title}</h2>

      <div className="card-content">
        {children}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
