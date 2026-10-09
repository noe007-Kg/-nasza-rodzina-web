import { onSnapshot as observeDocument } from 'firebase/firestore';
import { APP_VERSION, AppIcon, auth, collection, createRoot, db, doc, ErrorBoundary, errorMessage, Feedback, onAuthStateChanged, onSnapshot, pageFromHash, React, registerPwa, SchoolModule, signOut, useEffect, useMemo, useRef, useState, type Member, type Page, type PersonKey, type User } from "./app-shared";

import { FamilyAggregateContext, FamilyDirectoryContext } from './family-directory';
import { memberPersonKey, type FamilyAggregateProfile, type FamilyMemberProfile } from './family-members';
import { useProfileAvatars } from './account/useProfileAvatars';
import { FamilyTopBar } from './FamilyTopBar';
import { useEduActivationSync } from './school/useEduActivationSync';
import { useCalendarActivationSync } from './calendars/useCalendarActivationSync';
import { CalendarCallbackCompletion } from './calendars/CalendarCallbackCompletion';
import type { CalendarNotice } from './calendars/model';
import { schoolReadAccess, schoolReadAccessKey } from './school/read-access';
import { CalendarPage } from "./features/CalendarPage";
import { ChatPage } from "./features/ChatPage";
import { FamilyPage } from "./features/FamilyPage";
import { HealthPage } from "./features/HealthPage";
import { Login } from "./features/LoginPage";
import { SettingsPage } from "./features/SettingsPage";
import { ShoppingPage } from "./features/ShoppingPage";
import { StartPage } from "./features/StartPage";
import { TasksPage } from "./features/TasksPage";


import { NotificationProvider, prepareNotificationLogout } from './notifications';
import { disableLegacySystemNotifications } from './notifications/legacy-push';
import './style.css';
import './responsive.css';
import './improvements.css';
import './navigation.css';
import './brand-theme.css';



function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (currentUser) => {
    if (!currentUser) void disableLegacySystemNotifications().catch(() => {});
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

function FamilyApp({ user }: { user: User }) {
  const [page, setPage] = useState<Page>(() => pageFromHash());
  const pageRef = useRef(page);
  pageRef.current = page;
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [member, setMember] = useState<Member | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberProfile[]>([]);
  const [aggregateProfile, setAggregateProfile] = useState<FamilyAggregateProfile>({ emoji: '👨‍👩‍👧‍👦' });
  const [calendarSelection, setCalendarSelection] = useState<{ person: PersonKey; requestId: number }>();
  const [calendarNotice, setCalendarNotice] = useState<CalendarNotice>();
  const [selectedFamilyPerson, setSelectedFamilyPerson] = useState<PersonKey>('family');
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
    setProfileLoading(true);
    return observeDocument(doc(db, 'members', user.uid), snapshot => {
      setMember(snapshot.exists() ? snapshot.data() as Member : null);
      setProfileError('');
      setProfileLoading(false);
    }, error => { setProfileError(errorMessage(error)); setProfileLoading(false); });
  }, [user.uid]);

  const authorized = member?.active === true && member?.canLogin === true && member?.archived !== true && ['parent', 'adult', 'child'].includes(member?.role || '');
  const avatarProfiles = useMemo(() => {
    const directory = new Map(familyMembers.map(profile => [profile.id, profile]));
    if (member) directory.set(user.uid, { ...member, id: user.uid });
    return [...directory.values()];
  }, [familyMembers, member, user.uid]);
  const displayedMembers = useProfileAvatars(user.uid, avatarProfiles);
  const displayedMember = member ? { ...member, photoURL: displayedMembers.find(profile => profile.id === user.uid)?.photoURL } : null;
  const aggregateAvatars = useMemo(() => [{ ...aggregateProfile, id: '__family_aggregate__', familyAggregate: true }], [aggregateProfile]);
  const displayedAggregate = useProfileAvatars(user.uid, aggregateAvatars)[0];
  // Connection management remains parent-only; children keep their existing
  // school read permissions and never request the private parent integration.
  useEduActivationSync(user, authorized && member?.role === 'parent');
  useCalendarActivationSync(user, authorized);
  useEffect(() => {
    if (!authorized) { setFamilyMembers([]); return; }
    return onSnapshot(collection(db, 'members'), snapshot => {
      setFamilyMembers(snapshot.docs.map(row => ({ ...row.data(), id: row.id }) as FamilyMemberProfile));
    }, () => setFamilyMembers(member ? [{ ...member, id: user.uid }] : []));
  }, [user.uid, authorized]);
  useEffect(() => {
    if (!authorized) { setAggregateProfile({ emoji: '👨‍👩‍👧‍👦' }); return; }
    return observeDocument(doc(db, 'familySettings', 'profile'), snapshot => setAggregateProfile(snapshot.exists() ? snapshot.data() as FamilyAggregateProfile : { emoji: '👨‍👩‍👧‍👦' }), () => setAggregateProfile({ emoji: '👨‍👩‍👧‍👦' }));
  }, [user.uid, authorized]);

  useEffect(() => {
    const changed = () => {
      const next = pageFromHash();
      // A delayed hashchange from goTo must not close a newly opened menu.
      if (next === pageRef.current) return;
      pageRef.current = next;
      setPage(next);
      setMobileMoreOpen(false);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  function goTo(next: Page) {
    pageRef.current = next;
    setPage(next);
    window.location.hash = encodeURIComponent(next);
    setMobileMoreOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function logout() {
    // Clearing the worker binding precedes Auth sign-out, even if network
    // revocation fails. The next account cannot inherit the old device token.
    await prepareNotificationLogout(user);
    await signOut(auth);
  }

  function renderPage() {
    switch (page) {
      case 'Start': return <StartPage user={user} member={displayedMember} goTo={goTo} />;
      case 'Kalendarz': return <CalendarPage user={user} member={displayedMember} requestedSelection={calendarSelection} goTo={goTo} />;
      case 'Zadania': return <TasksPage user={user} member={displayedMember} />;
      case 'Zakupy': return <ShoppingPage user={user} member={displayedMember} />;
      case 'Czat': return <ChatPage user={user} member={displayedMember} />;
      case 'Zdrowie': return <HealthPage user={user} member={displayedMember} />;
      case 'Szkoła': return <SchoolModule key={schoolReadAccessKey(user.uid, schoolReadAccess(member))} user={user} member={displayedMember} familyMembers={displayedMembers} />;
      case 'Rodzina': return <FamilyPage user={user} member={displayedMember} goTo={goTo} selected={selectedFamilyPerson} onSelect={setSelectedFamilyPerson} />;
      case 'Ustawienia': return <SettingsPage user={user} member={displayedMember} theme={theme} setTheme={setTheme} goTo={goTo} onLogout={logout} calendarNotice={calendarNotice} />;
      default: return <StartPage user={user} member={displayedMember} goTo={goTo} />;
    }
  }

  if (profileLoading) return <div className="loading-screen"><section className="loading-card"><h2>Nasza Rodzina</h2><p>Sprawdzam profil rodziny…</p></section></div>;
  if (!authorized) return <div className="loading-screen"><section className="loading-card access-card"><h2>Konto czeka na dostęp</h2><p>{profileError || 'Administrator rodziny musi przypisać temu kontu aktywny profil. Skontaktuj się z osobą, która konfiguruje aplikację dla rodziny.'}</p><button className="secondary-button" onClick={()=>void logout()}>Wyloguj</button></section></div>;

  return (
    <FamilyDirectoryContext.Provider value={displayedMembers}><FamilyAggregateContext.Provider value={displayedAggregate}><NotificationProvider user={user} member={member} goTo={goTo}><div className={`app-shell theme-${theme}`}>
      <Sidebar page={page} goTo={goTo} member={displayedMember} />
      <main className="main-area">
        <CalendarCallbackCompletion user={user} onComplete={notice => { setCalendarNotice(notice); goTo('Ustawienia'); }} />
        <FamilyTopBar user={user} parent={member?.role === 'parent'} onSelect={profile => { setSelectedFamilyPerson(memberPersonKey(profile)); goTo('Rodzina'); }} onFamilySelect={() => { setCalendarSelection(current => ({ person: 'family', requestId: (current?.requestId || 0) + 1 })); goTo('Kalendarz'); }} />
        {renderPage()}
      </main>
      <MobileNavigation page={page} goTo={goTo} moreOpen={mobileMoreOpen} onMore={() => setMobileMoreOpen(true)} />
      {mobileMoreOpen && (
        <MobileMoreMenu page={page} goTo={goTo} onClose={() => setMobileMoreOpen(false)} />
      )}
    </div></NotificationProvider></FamilyAggregateContext.Provider></FamilyDirectoryContext.Provider>
  );
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
        <div className="brand-copy"><strong>Nasza<br />Rodzina</strong><small>Razem zawsze lepiej</small><span className="brand-heart" aria-hidden="true">♡</span></div>
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
      <div className="menu-app-version"><span>Nasza Rodzina</span><span>v{APP_VERSION}</span></div>
    </aside>
  );
}

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

function MobileMoreMenu({ page, goTo, onClose }: { page: Page; goTo: (page: Page) => void; onClose: () => void }) {
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
      </section>
    </div>
  );
}

const root = document.getElementById('root');

if (!root) throw new Error('Nie znaleziono elementu #root.');

registerPwa();

createRoot(root).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
