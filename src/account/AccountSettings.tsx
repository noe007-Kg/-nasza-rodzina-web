import { useState, type FormEvent } from 'react';
import { reload, sendPasswordResetEmail, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { Card, Icon, PrimaryButton, SecondaryButton, StatusPill } from '../ui';
import { accountActionMessage, activeLoginProviders, changeAccountEmail, changeAccountPassword, linkGoogleToExistingAccount, unlinkGoogleFromAccount } from './account-client';
import './account.css';

export function AccountSettings({ user }: { user: User }) {
  const [providers, setProviders] = useState(() => activeLoginProviders(user));
  const [email, setEmail] = useState(user.email || '');
  const [action, setAction] = useState<'email' | 'password' | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const googleLinked = providers.includes('google.com');
  const hasPassword = providers.includes('password');

  async function perform(operation: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      await operation(); await reload(user);
      setProviders(activeLoginProviders(user)); setEmail(user.email || ''); setSuccess(message);
      setAction(null); setNewPassword(''); setNewEmail('');
    } catch (reason) { setError(accountActionMessage(reason)); }
    finally { setBusy(false); setCurrentPassword(''); }
  }
  function open(next: 'email' | 'password') { setAction(next); setError(''); setSuccess(''); setCurrentPassword(''); setNewPassword(''); setNewEmail(''); }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (action === 'email') void perform(() => changeAccountEmail(user, newEmail, currentPassword), 'Wysłano link na nowy e-mail. Otwórz go, aby potwierdzić zmianę. Konto i wszystkie dane zachowują ten sam UID.');
    else if (action === 'password') void perform(() => changeAccountPassword(user, newPassword, currentPassword), 'Hasło zmienione. Twoje konto i dane pozostają te same.');
  }

  return <Card as="section" tone="violet" className="account-settings-panel settings-section" id="account-login" aria-labelledby="account-login-title" aria-busy={busy}>
    <header className="account-section-heading"><span className="account-section-icon"><Icon name="shield" /></span><div><h2 id="account-login-title">Konto i logowanie</h2><p>Twoje konto, jeden profil i te same dane.</p></div></header>
    <div className="account-email-row"><div><span>E-mail</span><strong>{email || 'Nie dodano adresu'}</strong></div><StatusPill tone="success">Aktywne</StatusPill></div>
    <div className="account-actions"><SecondaryButton disabled={busy} onClick={() => open('email')}>Zmień e-mail</SecondaryButton><SecondaryButton disabled={busy} onClick={() => open('password')}>{hasPassword ? 'Zmień hasło' : 'Dodaj hasło'}</SecondaryButton></div>
    {action && <form className="account-change-form" onSubmit={submit}>
      <h3>{action === 'email' ? 'Zmień e-mail' : hasPassword ? 'Zmień hasło' : 'Dodaj hasło'}</h3>
      {hasPassword ? <label>Aktualne hasło<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label> : <p>Potwierdzisz tę zmianę w oknie Google.</p>}
      {action === 'email' ? <label>Nowy e-mail<input type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} required /></label> : <label>Nowe hasło<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} required /></label>}
      <div className="account-actions"><PrimaryButton type="submit" disabled={busy}>{busy ? 'Zapisywanie…' : action === 'email' ? 'Wyślij link potwierdzający' : 'Zapisz hasło'}</PrimaryButton><SecondaryButton disabled={busy} onClick={() => { setAction(null); setCurrentPassword(''); setNewPassword(''); }}>Anuluj</SecondaryButton></div>
    </form>}
    <div className="account-google-row"><div><h3>Konto Google</h3><p>{googleLinked ? 'Połączone z tym samym kontem rodziny.' : 'Dodatkowy sposób logowania do istniejącego konta.'}</p></div><StatusPill tone={googleLinked ? 'success' : 'neutral'}>{googleLinked ? 'Połączono' : 'Niepołączone'}</StatusPill></div>
    <div className="account-actions">{googleLinked ? <SecondaryButton disabled={busy || providers.length < 2} onClick={() => void perform(() => unlinkGoogleFromAccount(user), 'Google odłączone. Nadal możesz logować się e-mailem i hasłem.')}>Odłącz Google</SecondaryButton> : <SecondaryButton disabled={busy} onClick={() => void perform(() => linkGoogleToExistingAccount(user), 'Google połączone z Twoim obecnym kontem. UID i profil rodziny pozostały bez zmian.')}>Połącz Google</SecondaryButton>}</div>
    {googleLinked && providers.length < 2 && <p className="account-footnote">Dodaj hasło, zanim odłączysz ostatnią metodę logowania.</p>}
    <div className="account-providers"><span>Aktywne metody logowania</span><div>{providers.map((provider) => <StatusPill key={provider} tone="neutral">{provider === 'password' ? 'E-mail i hasło' : 'Google'}</StatusPill>)}{providers.length === 0 && <span>Sprawdź konfigurację konta.</span>}</div></div>
    {hasPassword && <p className="account-reset-row">Nie pamiętasz hasła? <button type="button" disabled={busy || !email} onClick={() => void perform(() => sendPasswordResetEmail(auth, email), 'Wysłano wiadomość z linkiem do zmiany hasła.')}>Przypomnij hasło</button></p>}
    {success && <p role="status" className="account-success"><Icon name="check" />{success}</p>}
    {error && <p role="alert" className="account-error">{error}</p>}
  </Card>;
}
