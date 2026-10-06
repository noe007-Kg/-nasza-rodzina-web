import { useEffect, useState, type FormEvent } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { sendPasswordResetEmail, type User } from 'firebase/auth';
import { auth, db } from '../firebase';
import { isParent, memberEmoji, Modal, type Member } from '../app-shared';
import { memberCanLogin, memberSchoolEnabled, type FamilyMemberProfile } from '../family-members';
import { Card, Icon, PrimaryButton, SecondaryButton, StatusPill } from '../ui';
import { accountActionMessage, accountRequest } from './account-client';
import './account.css';

type RosterMember = FamilyMemberProfile & { active?: boolean; archived?: boolean };
type Draft = { name: string; role: 'parent' | 'child'; canLogin: boolean; schoolEnabled: boolean; email: string; active: boolean };
const emptyDraft = (): Draft => ({ name: '', role: 'child', canLogin: false, schoolEnabled: false, email: '', active: true });

export function FamilyMembersSettings({ user, member }: { user: User; member: Member | null }) {
  const parent = isParent(member);
  const [profiles, setProfiles] = useState<RosterMember[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<RosterMember | 'new' | null>(null);
  const [removing, setRemoving] = useState<RosterMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    if (!parent) { setProfiles([]); return; }
    return onSnapshot(collection(db, 'members'), (snapshot) => {
      setProfiles(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as RosterMember))
        .sort((a, b) => Number(a.archived === true) - Number(b.archived === true) || String(a.name || '').localeCompare(String(b.name || ''), 'pl-PL')));
    }, () => setError('Nie udało się odczytać członków rodziny. Sprawdź połączenie.'));
  }, [parent, user.uid]);

  function open(profile: RosterMember | 'new') {
    setEditing(profile); setError(''); setSuccess('');
    setDraft(profile === 'new' ? emptyDraft() : { name: profile.name || '', role: profile.role === 'parent' ? 'parent' : 'child', canLogin: memberCanLogin(profile), schoolEnabled: memberSchoolEnabled(profile), email: '', active: profile.active !== false && profile.archived !== true });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const data: Record<string, unknown> = editing === 'new'
        ? { action: 'create', name: draft.name.trim(), role: draft.role, canLogin: draft.canLogin, schoolEnabled: draft.schoolEnabled, ...(draft.canLogin ? { email: draft.email.trim() } : {}) }
        : { action: 'update', uid: editing.id, role: draft.role, canLogin: draft.canLogin, schoolEnabled: draft.schoolEnabled, active: draft.active, ...(draft.canLogin && draft.email.trim() ? { email: draft.email.trim() } : {}) };
      const result = await accountRequest<{ resetEmail?: string }>('members', data, user);
      setEditing(null); setDraft(emptyDraft());
      if (result.resetEmail) {
        try { await sendPasswordResetEmail(auth, result.resetEmail); setSuccess('Profil gotowy. Wysłano e-mail pozwalający ustawić hasło.'); }
        catch { setSuccess('Profil gotowy. Wiadomość nie została wysłana — użyj „Przypomnij hasło” na ekranie logowania.'); }
      } else setSuccess('Zapisano członka rodziny. Dotychczasowe dane i historia pozostały bez zmian.');
    } catch (reason) { setError(accountActionMessage(reason)); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!removing || busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      await accountRequest('members', { action: 'archive', uid: removing.id, confirmed: true }, user);
      setRemoving(null); setSuccess('Usunięto osobę z aktywnej rodziny. Konto, UID i historia zostały zachowane.');
    } catch (reason) { setError(accountActionMessage(reason)); }
    finally { setBusy(false); }
  }
  if (!parent) return null;
  return <Card as="section" tone="mint" className="family-members-settings settings-section" id="family-members-settings" aria-labelledby="family-members-settings-title" aria-busy={busy}>
    <header className="account-section-heading"><span className="account-section-icon"><Icon name="users" /></span><div><h2 id="family-members-settings-title">Członkowie rodziny</h2><p>Profile, role oraz dostęp do logowania i szkoły.</p></div></header>
    <div className="family-admin-list">{profiles.map((profile) => <article key={profile.id} className={profile.archived ? 'family-admin-person is-archived' : 'family-admin-person'}>
      <span className="family-admin-avatar">{profile.photoURL ? <img src={profile.photoURL} alt="" /> : memberEmoji(profile.name || '')}</span>
      <div className="family-admin-details"><strong>{profile.name || 'Członek rodziny'}</strong><small>{profile.role === 'parent' ? 'Rodzic' : 'Dziecko'}</small><div className="family-admin-flags"><span>canLogin: {memberCanLogin(profile) ? 'tak' : 'nie'}</span><span>schoolEnabled: {memberSchoolEnabled(profile) ? 'tak' : 'nie'}</span>{profile.archived && <StatusPill tone="neutral">Archiwum</StatusPill>}</div></div>
      <div className="family-admin-actions"><button type="button" disabled={busy} onClick={() => open(profile)} aria-label={`Edytuj ${profile.name}`}>{profile.archived ? 'Przywróć' : 'Edytuj'}</button>{!profile.archived && <button type="button" className="account-danger-link" disabled={busy || profile.id === user.uid} title={profile.id === user.uid ? 'Nie można odebrać dostępu własnemu kontu.' : undefined} onClick={() => { setRemoving(profile); setError(''); setSuccess(''); }} aria-label={`Usuń członka ${profile.name}`}>Usuń</button>}</div>
    </article>)}</div>
    <PrimaryButton icon="plus" disabled={busy} onClick={() => open('new')}>Dodaj członka</PrimaryButton>
    {editing && <form className="account-change-form family-admin-form" onSubmit={submit}>
      <h3>{editing === 'new' ? 'Dodaj członka' : `Edytuj profil: ${editing.name}`}</h3>
      {editing === 'new' && <label>Imię<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} required /></label>}
      <label>Rola<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value === 'parent' ? 'parent' : 'child' })}><option value="parent">Rodzic</option><option value="child">Dziecko</option></select></label>
      <label className="account-checkbox"><input type="checkbox" checked={draft.canLogin} onChange={(event) => setDraft({ ...draft, canLogin: event.target.checked })} />Dostęp do logowania</label>
      {draft.canLogin && (editing === 'new' || !memberCanLogin(editing)) && <label>{editing === 'new' ? 'E-mail nowego członka' : 'E-mail do logowania'}<input type="email" autoComplete="off" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} required={editing === 'new'} /><small>{editing === 'new' ? 'Istniejącego konta Firebase nie duplikujemy. Nowe konto ustawi hasło przez e-mail.' : 'Dla profilu bez konta wpisz adres e-mail. Utworzymy dostęp z tym samym UID. Przy istniejącym koncie pozostaw puste.'}</small></label>}
      <label className="account-checkbox"><input type="checkbox" checked={draft.schoolEnabled} onChange={(event) => setDraft({ ...draft, schoolEnabled: event.target.checked })} />Uczęszcza do szkoły</label>
      {editing !== 'new' && <label className="account-checkbox"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Aktywny członek</label>}
      <div className="account-actions"><PrimaryButton type="submit" disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz członka'}</PrimaryButton><SecondaryButton disabled={busy} onClick={() => { setEditing(null); setDraft(emptyDraft()); }}>Anuluj</SecondaryButton></div>
    </form>}
    {success && <p className="account-success" role="status"><Icon name="check" />{success}</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
    {removing && <Modal title={`Usunąć ${removing.name} z aktywnej rodziny?`} onClose={() => { if (!busy) setRemoving(null); }}>
      <p>Ta osoba utraci dostęp do aplikacji. Jej konto, UID, wiadomości i pozostała historia nie zostaną usunięte.</p>
      <div className="account-actions"><button type="button" className="account-danger-button" disabled={busy} onClick={() => void archive()}>{busy ? 'Usuwanie…' : 'Usuń członka'}</button><SecondaryButton disabled={busy} onClick={() => setRemoving(null)}>Anuluj</SecondaryButton></div>
      {error && <p className="account-error" role="alert">{error}</p>}
    </Modal>}
  </Card>;
}
