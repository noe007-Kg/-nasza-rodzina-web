// Synthetic, offline UI fixture. It does not sign in or load any family data.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { upcomingFamilyEvents } from '../../src/features/family-home-model';
import { FamilyHome } from '../../src/features/FamilyHome';
import { useAccountAccent } from '../../src/features/useAccountAccent';
import { FamilyDirectoryContext } from '../../src/family-directory';
import { buildFamilyTime } from '../../src/features/start-tile-projections';
import { START_CARD_IDS, type StartCardId } from '../../src/features/start-layout';
import { AppIcon, type CalendarOccurrence, type TaskItem, type Page } from '../../src/app-shared';
import '../../src/style.css';
import '../../src/responsive.css';
import '../../src/improvements.css';
import '../../src/navigation.css';
import '../../src/brand-theme.css';
import '../../src/family-shell.css';
import '../../src/account-accent.css';
import '../../src/dark-mode.css';
const now = new Date('2026-10-20T12:00:00Z');
const profiles = ['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'].map((name, i) => ({ id: `demo-profile-${i}`, name, personKey: name, active: true, emoji: ['👨', '👩', '👦', '👦', '👧'][i] }));
const occurrence = (id: string, title: string, person: string, start: string, end: string, extra = {}) => ({ key: id, date: new Date(start), endDate: new Date(end), source: { id, title, person, ownerProfileId: profiles.find(p => p.name === person)?.id, allDay: false, private: false, ...extra } }) as CalendarOccurrence;
const events = [occurrence('work', 'Praca', 'Sebastian', '2026-10-20T06:00:00Z', '2026-10-20T14:00:00Z'), occurrence('piano', 'Fortepian główny', 'Nikodem', '2026-10-20T13:00:00Z', '2026-10-20T13:30:00Z'), occurrence('class', 'PDP/kuchnia', 'Paweł', '2026-10-20T12:30:00Z', '2026-10-20T13:10:00Z', { timingConfidence: 'estimated' }), occurrence('cancelled', 'Podstawy rytmiki', 'Nikodem', '2026-10-21T13:50:00Z', '2026-10-21T14:35:00Z', { cancelled: true })];
const tasks = ['Przygotować plecak', 'Podlać kwiaty', 'Wynieść papier'].map((title, i) => ({ id: String(i), title, person: profiles[i + 1].name, dueDate: '2026-10-20', priority: 'normal', done: false })) as TaskItem[];
function Account({ name }: { name: string }) {
  const profile = profiles.find(p => p.name === name)!;
  const accent = useAccountAccent(profile.id, profile);
  const [order, setOrder] = useState<StartCardId[]>(() => { try { return JSON.parse(localStorage.getItem('fixture-order:' + profile.id) || 'null') || [...START_CARD_IDS]; } catch { return [...START_CARD_IDS]; } });
  const [destination, setDestination] = useState<Page>('Start');
  return <><div className="fixture-controls"><span>Test UI</span>{(['auto', 'blue', 'pink'] as const).map(value => <button key={value} onClick={() => accent.setPreference(value)} aria-label={`Kolor ${value}`}>{value}</button>)}<button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; }}>Jasny / ciemny</button><output data-testid="destination">{destination}</output></div>
    <div className="app-shell"><aside className="sidebar family-menu"><div className="sidebar-brand"><img src="/nasza-rodzina-logo.svg" alt="" width="62"/><strong>Nasza Rodzina</strong></div><div className="sidebar-nav">{(['Start', 'Kalendarz', 'Zadania', 'Zakupy', 'Finanse', 'Czat', 'Zdrowie', 'Szkoła'] as Page[]).map(page => <button key={page} className={`nav-button${page === 'Start' ? ' active' : ''}`} onClick={() => setDestination(page)}><AppIcon page={page}/>{page}</button>)}</div></aside>
      <main className="main-area"><FamilyDirectoryContext.Provider value={profiles}><FamilyHome name={name} now={now} weather={{ temp: 9, label: 'Częściowe zachmurzenie', icon: '⛅' }} profiles={profiles} familyTime={buildFamilyTime(profiles, events, [], now, { uid: profile.id, person: name })} upcoming={upcomingFamilyEvents(events, now)} tasks={tasks} shoppingCount={7} chatCount={3} order={order} loaded={true} saveOrder={next => { setOrder(next); localStorage.setItem('fixture-order:' + profile.id, JSON.stringify(next)); }} goTo={setDestination} onOpenEvent={() => setDestination('Kalendarz')}/></FamilyDirectoryContext.Provider></main>
      <nav className="mobile-navigation family-menu">{(['Start', 'Kalendarz', 'Zadania', 'Zakupy', 'Więcej'] as const).map(page => <button key={page} className={page === 'Start' ? 'active' : ''}><small>{page}</small></button>)}</nav>
    </div></>;
}
function Fixture() { const [name, setName] = useState('Sebastian'), [loggedIn, setLoggedIn] = useState(true); return <><div className="fixture-login"><button onClick={() => { setName(name === 'Sebastian' ? 'Dominika' : 'Sebastian'); setLoggedIn(true); }}>Zmień konto</button><button onClick={() => setLoggedIn(false)}>Wyloguj test</button></div>{loggedIn && <Account key={name} name={name}/>}</>; }
createRoot(document.getElementById('root')!).render(<Fixture/>);
