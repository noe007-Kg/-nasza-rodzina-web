import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';

import { auth } from './firebase';
import './style.css';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
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

  return <Start user={user} />;
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
    } catch (err) {
      console.error(err);
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

function Start({ user }: { user: User }) {
  return (
    <div className="logged-page">
      <div className="logged-card">
        <div className="logged-logo">🏠</div>

        <h1>Nasza Rodzina</h1>

        <h2>Dzień dobry! 👋</h2>

        <p>
          Jesteś zalogowany jako:
          <br />
          <strong>{user.email}</strong>
        </p>

        <button onClick={() => signOut(auth)}>
          Wyloguj się
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
