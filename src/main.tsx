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
  { name: 'Sebastian', role: 'Tata', letter: 'S', color: 'blue' },
  { name: 'Dominika', role: 'Mama', letter: 'D', color: 'purple' },
  { name: 'Paweł', role: 'Syn', letter: 'P', color: 'green' },
  { name: 'Nikodem', role: 'Syn', letter: 'N', color: 'orange' },
  { name: 'Layla', role: 'Córka', letter: 'L', color: 'pink' },
];

const navigation: { page: Page; icon: string }[] = [
  { page: 'Start', icon: '⌂' },
  { page: 'Kalendarz', icon: '▦' },
  { page: 'Zadania', icon: '☑' },
  { page: 'Zakupy', icon: '🛒' },
  { page: 'Czat', icon: '○' },
  { page: 'Zdrowie', icon: '♡' },
  { page: 'Szkoła', icon: '◇' },
  { page: 'Rodzina', icon: '♧' },
  { page: 'Ustawienia', icon: '⚙' },
];

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setMember(null);

      if (firebaseUser) {
        try {
          const memberSnap = await getDoc(
            doc(db, 'members', firebaseUser.uid)
          );

          if (memberSnap.exists()) {
            setMember(memberSnap.data() as Member);
          }
        } catch (error) {
          console.error('Błąd pobierania profilu:', error);
        }
      }

      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="loading">Ładowanie Naszej Rodziny…</div>;
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
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setError('Nieprawidłowy e-mail lub hasło.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🏠</div>

        <h1>Nasza Rodzina</h1>
        <p>Wasze rodzinne centrum w jednym miejscu.</p>

        <form onSubmit={handleSubmit}>
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

          <button type="submit" disabled={busy}>
            {busy ? 'Logowanie…' : 'Zaloguj się'}
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
  const [page, setPage] = useState<Page>('Start');

  function changePage(nextPage: Page) {
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="app-shell">
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
          {navigation.map((item) => (
            <button
              key={item.page}
              className={page === item.page ? 'nav-active' : ''}
              onClick={() => changePage(item.page)}
            >
              <span>{item.icon}</span>
              {item.page}
            </button>
          ))}
        </nav>

        <button className="logout-button" onClick={() => signOut(auth)}>
          ↪ Wyloguj
        </button>
      </aside>

      <main className="main-area">
        <FamilyHeader />

        {page === 'Start' && (
          <StartPage name={member?.name || 'Użytkowniku'} />
        )}

        {page === 'Kalendarz' && <CalendarPage />}
        {page === 'Zadania' && <TasksPage />}
        {page === 'Zakupy' && <ShoppingPage />}
        {page === 'Czat' && <ChatPage />}
        {page === 'Zdrowie' && <HealthPage />}
        {page === 'Szkoła' && <SchoolPage />}
        {page === 'Rodzina' && <FamilyPage />}
        {page === 'Ustawienia' && (
          <SettingsPage user={user} member={member} />
        )}

        <button className="floating-add">＋ Dodaj</button>

        <div className="mobile-nav">
          <MobileButton
            icon="⌂"
            label="Start"
            active={page === 'Start'}
            onClick={() => changePage('Start')}
          />
          <MobileButton
            icon="▦"
            label="Kalendarz"
            active={page === 'Kalendarz'}
            onClick={() => changePage('Kalendarz')}
          />
          <MobileButton
            icon="🛒"
            label="Zakupy"
            active={page === 'Zakupy'}
            onClick={() => changePage('Zakupy')}
          />
          <MobileButton
            icon="♧"
            label="Rodzina"
            active={page === 'Rodzina'}
            onClick={() => changePage('Rodzina')}
          />
          <MobileButton
            icon="•••"
            label="Więcej"
            active={page === 'Ustawienia'}
            onClick={() => changePage('Ustawienia')}
          />
        </div>
      </main>
    </div>
  );
}

function MobileButton({
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
    <button className={active ? 'mobile-active' : ''} onClick={onClick}>
      <span>{icon}</span>
      <small>{label}</small>
    </button>
  );
}

function FamilyHeader() {
  return (
    <header className="family-header">
      {family.map((person) => (
        <div className="family-person" key={person.name}>
          <div className={`avatar avatar-${person.color}`}>
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

function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: string;
}) {
  return (
    <section className="page-header">
      <div>
        <small>Nasza Rodzina</small>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>

      {action && <button className="primary-button">＋ {action}</button>}
    </section>
  );
}

function Card({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`app-card ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: string[] }) {
  return (
    <div className="rows">
      {rows.map((row, index) => (
        <p key={index}>{row}</p>
      ))}
    </div>
  );
}

/* START */

function StartPage({ name }: { name: string }) {
  return (
    <div className="page-content">
      <section className="start-hero">
        <div>
          <small>Niedziela, 27 września</small>
          <h1>Dzień dobry, {name}! 👋</h1>
          <p>Oto co dzieje się dziś w Waszej rodzinie.</p>
        </div>

        <div className="weather-card">
          <span className="weather-icon">☀️</span>
          <div>
            <strong>Kołobrzeg</strong>
            <b>18°C</b>
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        <Card title="📅 Dzisiaj w rodzinie">
          <Rows
            rows={[
              '08:00 • Paweł — szkoła',
              '08:00 • Nikodem — szkoła',
              '13:00 • Sebastian — dyżur',
            ]}
          />
        </Card>

        <Card title="✅ Zadania na dziś">
          <Rows
            rows={[
              '☑ Strój na WF — Paweł',
              '☐ Zeszyt do matematyki',
              '☐ Przygotować drugie śniadanie',
            ]}
          />
        </Card>

        <Card title="🛒 Lista zakupów">
          <Rows rows={['☐ Mleko', '☑ Chleb', '☐ Banany']} />
        </Card>

        <Card title="🎒 Szkoła — Paweł">
          <div className="vulcan-status">
            <strong>VULCAN ●</strong>
            <span>Połączono</span>
          </div>

          <Rows
            rows={[
              '🔔 Zmiana planu lekcji',
              '✉️ Nowa wiadomość od wychowawcy',
            ]}
          />
        </Card>

        <Card title="❤️ Zdrowie">
          <Rows
            rows={[
              'Layla — szczepienie • za 2 dni',
              'Paweł — kontrola • 3 października',
            ]}
          />
        </Card>

        <Card title="👨‍👩‍👧‍👦 Rodzina">
          <Rows
            rows={[
              '🎂 Roczek Layli — 10.10',
              '📌 Rodzinny wyjazd — sobota',
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

/* KALENDARZ */

const calendarDays = [
  { day: 'Pon', date: '28' },
  { day: 'Wt', date: '29' },
  { day: 'Śr', date: '30' },
  { day: 'Czw', date: '1' },
  { day: 'Pt', date: '2' },
  { day: 'Sob', date: '3' },
  { day: 'Niedz', date: '4' },
];

function CalendarPage() {
  return (
    <div className="page-content">
      <PageHeader
        title="📅 Kalendarz"
        description="Wszystkie rodzinne wydarzenia w jednym miejscu."
        action="Dodaj wydarzenie"
      />

      <section className="calendar-toolbar">
        <div className="calendar-navigation">
          <button>‹</button>
          <strong>28 września – 4 października</strong>
          <button>›</button>
        </div>

        <div className="view-switch">
          <button>Dzień</button>
          <button className="selected">Tydzień</button>
          <button>Miesiąc</button>
        </div>
      </section>

      <section className="family-filters">
        <button className="filter-selected">● Cała rodzina</button>
        <button>🔵 Sebastian</button>
        <button>🟣 Dominika</button>
        <button>🟢 Paweł</button>
        <button>🟠 Nikodem</button>
        <button>🩷 Layla</button>
      </section>

      <div className="calendar-layout">
        <section className="calendar-box">
          <div className="week-grid">
            {calendarDays.map((item, index) => (
              <div className="calendar-day" key={item.day}>
                <div className="calendar-day-header">
                  <small>{item.day}</small>
                  <strong>{item.date}</strong>
                </div>

                {index === 0 && (
                  <>
                    <CalendarEvent
                      time="08:00"
                      title="Paweł — szkoła"
                      color="green"
                    />
                    <CalendarEvent
                      time="08:00"
                      title="Nikodem — szkoła"
                      color="orange"
                    />
                  </>
                )}

                {index === 1 && (
                  <CalendarEvent
                    time="10:30"
                    title="Layla — szczepienie"
                    color="pink"
                  />
                )}

                {index === 2 && (
                  <CalendarEvent
                    time="13:00"
                    title="Sebastian — dyżur"
                    color="blue"
                  />
                )}

                {index === 3 && (
                  <CalendarEvent
                    time="16:30"
                    title="Nikodem — zajęcia"
                    color="orange"
                  />
                )}

                {index === 4 && (
                  <CalendarEvent
                    time="14:00"
                    title="Dominika — wizyta"
                    color="purple"
                  />
                )}

                {index === 5 && (
                  <CalendarEvent
                    time="11:00"
                    title="Rodzinny wyjazd"
                    color="family"
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        <aside className="calendar-side">
          <h2>Dzisiaj</h2>

          <div className="today-event">
            <b>08:00</b>
            <span>Paweł — szkoła</span>
          </div>

          <div className="today-event">
            <b>08:00</b>
            <span>Nikodem — szkoła</span>
          </div>

          <div className="today-event">
            <b>13:00</b>
            <span>Sebastian — dyżur</span>
          </div>

          <h2 className="side-heading">Nadchodzące</h2>

          <div className="upcoming">
            <span>❤️</span>
            <div>
              <strong>Szczepienie Layli</strong>
              <small>Za 2 dni • 10:30</small>
            </div>
          </div>

          <div className="upcoming">
            <span>🎂</span>
            <div>
              <strong>Roczek Layli</strong>
              <small>10 października</small>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CalendarEvent({
  time,
  title,
  color,
}: {
  time: string;
  title: string;
  color: string;
}) {
  return (
    <div className={`calendar-event event-${color}`}>
      <small>{time}</small>
      <strong>{title}</strong>
    </div>
  );
}

/* ZADANIA */

function TasksPage() {
  const [tasks, setTasks] = useState([
    { text: 'Strój na WF — Paweł', done: true },
    { text: 'Zeszyt do matematyki', done: false },
    { text: 'Przygotować drugie śniadanie', done: false },
    { text: 'Umówić wizytę kontrolną', done: false },
    { text: 'Spakować rzeczy na wyjazd', done: false },
  ]);

  function toggleTask(index: number) {
    setTasks((current) =>
      current.map((task, i) =>
        i === index ? { ...task, done: !task.done } : task
      )
    );
  }

  const completed = tasks.filter((task) => task.done).length;

  return (
    <div className="page-content">
      <PageHeader
        title="✅ Zadania"
        description="Rodzinne obowiązki i rzeczy do zrobienia."
        action="Dodaj zadanie"
      />

      <div className="module-grid module-grid-wide">
        <Card title="Na dziś">
          <div className="task-list">
            {tasks.map((task, index) => (
              <label className="task-row" key={task.text}>
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => toggleTask(index)}
                />

                <span className={task.done ? 'completed' : ''}>
                  {task.text}
                </span>
              </label>
            ))}
          </div>
        </Card>

        <Card title="Postęp">
          <div className="progress-number">
            {completed}/{tasks.length}
          </div>

          <p className="muted">wykonanych zadań</p>

          <div className="progress-bar">
            <span
              style={{
                width: `${(completed / tasks.length) * 100}%`,
              }}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ZAKUPY */

function ShoppingPage() {
  const [products, setProducts] = useState([
    { text: 'Mleko', done: false },
    { text: 'Chleb', done: true },
    { text: 'Banany', done: false },
    { text: 'Pieluchy', done: false },
    { text: 'Woda', done: false },
  ]);

  function toggleProduct(index: number) {
    setProducts((current) =>
      current.map((product, i) =>
        i === index
          ? { ...product, done: !product.done }
          : product
      )
    );
  }

  return (
    <div className="page-content">
      <PageHeader
        title="🛒 Zakupy"
        description="Wspólne listy zakupów dostępne dla całej rodziny."
        action="Dodaj produkt"
      />

      <div className="module-grid module-grid-wide">
        <Card title="🛒 Bieżące zakupy">
          <div className="task-list">
            {products.map((product, index) => (
              <label className="task-row" key={product.text}>
                <input
                  type="checkbox"
                  checked={product.done}
                  onChange={() => toggleProduct(index)}
                />

                <span className={product.done ? 'completed' : ''}>
                  {product.text}
                </span>
              </label>
            ))}
          </div>
        </Card>

        <Card title="Moje listy">
          <Rows
            rows={[
              '🛒 Bieżące zakupy',
              '🎂 Roczek Layli',
              '🚗 Rodzinny wyjazd',
              '🎄 Święta',
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

/* CZAT */

function ChatPage() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([
    { author: 'Dominika', text: 'Kto kupi dzisiaj mleko?' },
    { author: 'Sebastian', text: 'Ja wezmę po pracy 👍' },
    { author: 'Paweł', text: 'Potrzebuję też zeszyt do matematyki.' },
  ]);

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();

    if (!message.trim()) return;

    setMessages((current) => [
      ...current,
      { author: 'Ja', text: message.trim() },
    ]);

    setMessage('');
  }

  return (
    <div className="page-content">
      <PageHeader
        title="💬 Czat rodzinny"
        description="Jedno miejsce do rozmów całej rodziny."
      />

      <section className="chat-card">
        <div className="chat-title">
          <div>
            <strong>Nasza Rodzina</strong>
            <small>5 członków</small>
          </div>
        </div>

        <div className="messages">
          {messages.map((item, index) => (
            <div
              className={`message ${
                item.author === 'Ja' ? 'message-me' : ''
              }`}
              key={index}
            >
              <small>{item.author}</small>
              <p>{item.text}</p>
            </div>
          ))}
        </div>

        <form className="message-form" onSubmit={sendMessage}>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Napisz wiadomość…"
          />
          <button>Wyślij</button>
        </form>
      </section>
    </div>
  );
}

/* ZDROWIE */

function HealthPage() {
  return (
    <div className="page-content">
      <PageHeader
        title="❤️ Zdrowie"
        description="Wizyty, historia leczenia, wyniki i dokumenty całej rodziny."
        action="Dodaj wizytę"
      />

      <section className="family-filters">
        {family.map((person) => (
          <button key={person.name}>{person.name}</button>
        ))}
      </section>

      <div className="dashboard-grid">
        <Card title="🩺 Nadchodzące wizyty">
          <Rows
            rows={[
              'Layla • szczepienie • 29.09 • 10:30',
              'Paweł • kontrola • 03.10 • 12:00',
              'Dominika • wizyta • 04.10 • 14:00',
            ]}
          />
        </Card>

        <Card title="📋 Historia wizyt">
          <Rows
            rows={[
              'Paweł • Neurolog • 12.09',
              'Paweł • Ortopeda • 18.08',
              'Layla • Pediatra • 05.08',
            ]}
          />
        </Card>

        <Card title="📄 Wyniki i dokumenty">
          <Rows
            rows={[
              '📄 Wyniki badań',
              '🖼️ Zdjęcia z wizyt',
              '📎 Zalecenia lekarzy',
              '💊 Leki i dawkowanie',
            ]}
          />
        </Card>

        <Card title="💉 Szczepienia">
          <Rows
            rows={[
              'Layla • następne za 2 dni',
              'Nikodem • aktualne',
              'Paweł • aktualne',
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

/* SZKOŁA */

function SchoolPage() {
  return (
    <div className="page-content">
      <PageHeader
        title="🎒 Szkoła"
        description="Plan lekcji, zadania, oceny i informacje szkolne."
      />

      <div className="module-grid module-grid-wide">
        <Card title="Paweł — VULCAN">
          <div className="vulcan-status">
            <strong>VULCAN ●</strong>
            <span>Połączono</span>
          </div>

          <Rows
            rows={[
              '🔔 Zmiana planu lekcji',
              '✉️ Nowa wiadomość od wychowawcy',
              '📝 Zadanie — matematyka',
              '⭐ Ostatnia ocena — 5',
            ]}
          />

          <button className="secondary-button">
            Otwórz VULCAN
          </button>
        </Card>

        <Card title="📚 Dzisiejszy plan">
          <Rows
            rows={[
              '08:00 • Matematyka',
              '08:55 • Język polski',
              '09:50 • Fizyka',
              '10:45 • WF',
              '11:40 • Język angielski',
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

/* RODZINA */

function FamilyPage() {
  return (
    <div className="page-content">
      <PageHeader
        title="👨‍👩‍👧‍👦 Rodzina"
        description="Profile wszystkich członków Waszej rodziny."
      />

      <div className="family-profile-grid">
        {family.map((person) => (
          <section className="family-profile" key={person.name}>
            <div className={`profile-avatar avatar-${person.color}`}>
              {person.letter}
            </div>

            <h2>{person.name}</h2>
            <p>{person.role}</p>

            <button className="secondary-button">
              Otwórz profil
            </button>
          </section>
        ))}
      </div>
    </div>
  );
}

/* USTAWIENIA */

function SettingsPage({
  user,
  member,
}: {
  user: User;
  member: Member | null;
}) {
  return (
    <div className="page-content">
      <PageHeader
        title="⚙️ Ustawienia"
        description="Konto i ustawienia Naszej Rodziny."
      />

      <div className="module-grid module-grid-wide">
        <Card title="👤 Moje konto">
          <Rows
            rows={[
              `Imię: ${member?.name || '—'}`,
              `Rola: ${member?.role || '—'}`,
              `E-mail: ${user.email || '—'}`,
            ]}
          />
        </Card>

        <Card title="⚙️ Aplikacja">
          <Rows
            rows={[
              '🔔 Powiadomienia',
              '🎨 Wygląd aplikacji',
              '🔒 Prywatność',
              '📱 Instalacja na urządzeniu',
            ]}
          />

          <button
            className="danger-button"
            onClick={() => signOut(auth)}
          >
            Wyloguj się
          </button>
        </Card>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
