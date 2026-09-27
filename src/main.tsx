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

  return <Start user={user} member={member} />;
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

const family = [
  { name: 'Sebastian', role: 'Tata', letter: 'S' },
  { name: 'Dominika', role: 'Mama', letter: 'D' },
  { name: 'Paweł', role: 'Syn', letter: 'P' },
  { name: 'Nikodem', role: 'Syn', letter: 'N' },
  { name: 'Layla', role: 'Córka', letter: 'L' },
];

function Start({
  user,
  member,
}: {
  user: User;
  member: Member | null;
}) {
  const name = member?.name || 'Użytkowniku';

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
          <button className="nav-active">⌂ <span>Start</span></button>
          <button>▦ <span>Kalendarz</span></button>
          <button>☑ <span>Zadania</span></button>
          <button>🛒 <span>Zakupy</span></button>
          <button>◯ <span>Czat</span></button>
          <button>♡ <span>Zdrowie</span></button>
          <button>♢ <span>Szkoła</span></button>
          <button>♧ <span>Rodzina</span></button>
          <button>⚙ <span>Ustawienia</span></button>
        </nav>

        <button
          className="logout-button"
          onClick={() => signOut(auth)}
        >
          ↪ Wyloguj
        </button>
      </aside>

      <main className="main-area">

        <header className="family-header">
          {family.map((person) => (
            <div className="family-person" key={person.name}>
              <div className="avatar">{person.letter}</div>

              <div>
                <strong>{person.name}</strong>
                <small>{person.role}</small>
              </div>
            </div>
          ))}
        </header>

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

        <button className="add-button">
          <span>＋</span> Dodaj
        </button>

        <div className="mobile-nav">
          <button>⌂<small>Start</small></button>
          <button>▦<small>Kalendarz</small></button>
          <button>🛒<small>Zakupy</small></button>
          <button>♧<small>Rodzina</small></button>
          <button>•••<small>Więcej</small></button>
        </div>

      </main>
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
      <div className="card-content">{children}</div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
