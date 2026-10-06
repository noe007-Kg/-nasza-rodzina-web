import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { useState, type FormEvent } from 'react';
import { GoogleLoginButton } from '../account/GoogleLoginButton';

import { APP_VERSION, AppIcon, type Page } from '../app-shared';
import { notify } from '../feedback';
import { auth } from '../firebase';
import '../account/account.css';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function resetPassword() {
    if (!email.trim()) { setError('Wpisz e-mail, aby otrzymać link do zmiany hasła.'); return; }
    setError(''); setResetting(true);
    try { await sendPasswordResetEmail(auth, email.trim()); notify('Jeśli konto istnieje, otrzymasz wiadomość z linkiem do zmiany hasła.'); }
    catch { setError('Nie udało się wysłać linku. Sprawdź e-mail i połączenie.'); }
    finally { setResetting(false); }
  }
  async function handleLogin(event: FormEvent) {
    event.preventDefault(); setError(''); setLoggingIn(true);
    try { await signInWithEmailAndPassword(auth, email.trim(), password); }
    catch { setError('Nie udało się zalogować. Sprawdź e-mail i hasło.'); }
    finally { setLoggingIn(false); }
  }
  const features: Page[] = ['Kalendarz', 'Zadania', 'Zakupy', 'Czat', 'Zdrowie', 'Szkoła', 'Rodzina'];
  return <div className="login-v11 family-ui account-login">
    <div className="login-v11-overlay" />
    <div className="login-v11-brand"><img className="login-v11-brand-logo" src="/nasza-rodzina-logo.svg" alt="" /><div><strong>Nasza Rodzina</strong><small>Razem zawsze lepiej ♡</small></div></div>
    <div className="login-v11-panel">
      <div className="login-v11-title"><img className="login-v11-title-logo" src="/nasza-rodzina-logo.svg" alt="" /><div><h1>Nasza Rodzina</h1><p>Wszystko, co ważne. Razem.</p></div></div>
      <form className="login-v11-form" onSubmit={handleLogin}>
        <label htmlFor="login-email"><span>E-mail</span></label>
        <input id="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Twój e-mail" required />
        <div className="login-password-label"><label htmlFor="login-password"><span>Hasło</span></label><button className="login-show-password" type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Ukryj hasło' : 'Pokaż hasło'}</button></div>
        <input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Hasło" required />
        <p className="login-password-reset"><span>Nie pamiętasz hasła?</span> <button type="button" disabled={resetting || loggingIn} onClick={() => void resetPassword()}>{resetting ? 'Wysyłanie…' : 'Przypomnij hasło'}</button></p>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="login-submit" type="submit" disabled={loggingIn}>{loggingIn ? 'Logowanie…' : 'Zaloguj się'}</button>
      </form>
      <div className="login-provider-divider"><span>lub</span></div>
      <GoogleLoginButton disabled={loggingIn} onError={setError} onBusy={setLoggingIn} />
      <div className="login-v11-divider"><span>Cała rodzina w jednym miejscu ♡</span></div>
      <div className="login-v11-features">{features.map((page) => <div key={page} data-module={page}><span><AppIcon page={page} size={24} /></span><small>{page}</small></div>)}</div>
    </div>
    <div className="login-v11-version">v{APP_VERSION}</div>
  </div>;
}
