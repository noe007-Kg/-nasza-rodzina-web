import { APP_UPDATED, APP_VERSION, collection, dateKey, db, downloadFile, errorMessage, getDocs, isParent, type Member, ModuleHeader, notify, type Page, type User, useState } from "../app-shared";

import { AccountSettings } from '../account/AccountSettings';
import { FamilyMembersSettings } from '../account/FamilyMembersSettings';
import { OwnProfileSettings } from '../account/ProfileSettings';
import { exportCalendarIcs } from '../calendar-ics';
import { fetchCalendarEvents } from '../calendar-store';
import { NotificationSettings } from '../notifications';
import { ConnectedCalendarsSettings } from '../calendars/ConnectedCalendarsSettings';
import type { CalendarNotice } from '../calendars/model';
import { StartTileColorsSettings } from './StartTileColorsSettings';
import { StartTileSizesSettings } from './StartTileSizesSettings';
import { SchoolConnectionsPreparation } from '../school/SchoolSources';
import './settings-appearance.css';

export function SettingsPage({ user, member, theme, setTheme, goTo, onLogout, calendarNotice }: { user: User; member: Member | null; theme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void; goTo: (page: Page) => void; onLogout: () => Promise<void>; calendarNotice?: CalendarNotice }) {
  const parent=isParent(member);
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true);
    try { await onLogout(); } catch (error) { notify(errorMessage(error), 'error'); setLoggingOut(false); }
  }

  const [exporting, setExporting] = useState(false);
  async function downloadBackup() {
    if (!parent || exporting) return;
    setExporting(true);
    try {
      const names = ['members','calendarEvents','tasks','shoppingItems','quickProducts','healthRecords','medicalContacts','schoolItems'];
      const snapshots = await Promise.all(names.map(name=>getDocs(collection(db,name))));
      const data = Object.fromEntries(names.map((name,i)=>[name,snapshots[i].docs.map(row=>({ id:row.id, data:row.data() }))]));
      downloadFile(JSON.stringify({ schemaVersion:1, appVersion:APP_VERSION, exportedAt:new Date().toISOString(), data }, null, 2), `nasza-rodzina-kopia-${dateKey()}.json`, 'application/json');
      notify('Pobrano kopię danych. Przechowuj ten plik prywatnie; pliki dokumentów i wiadomości nie są częścią kopii.');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setExporting(false); }
  }
  async function downloadCalendar() {
    if (exporting) return;
    setExporting(true);
    try {
      const events = await fetchCalendarEvents(user.uid);
      downloadFile(exportCalendarIcs(events, { uid: user.uid }), `nasza-rodzina-kalendarz-${dateKey()}.ics`, 'text/calendar;charset=utf-8');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setExporting(false); }
  }

  return (
    <div className="page-content compact-page settings-v130">
      <ModuleHeader icon="⚙️" title="Ustawienia" text="Konto, wygląd, powiadomienia, synchronizacja i bezpieczeństwo." />
      <section className="settings-dashboard">
        <AccountSettings user={user} />
        <OwnProfileSettings user={user} member={member} />

        <article className="settings-section settings-appearance" data-testid="settings-appearance"><header><span>🎨</span><div><strong>Wygląd</strong><small>Motyw aplikacji, kolory i rozmiary kafelków</small></div></header><div className="appearance-theme-buttons" role="group" aria-label="Motyw aplikacji"><button type="button" aria-pressed={theme === 'light'} onClick={()=>setTheme('light')}><span aria-hidden="true">☀️</span> Jasny</button><button type="button" aria-pressed={theme === 'dark'} onClick={()=>setTheme('dark')}><span aria-hidden="true">🌙</span> Ciemny</button></div><p className="settings-footnote">Motyw zapisuje się na tym urządzeniu.</p><StartTileColorsSettings uid={user.uid}/><StartTileSizesSettings uid={user.uid}/></article>

        <NotificationSettings />

        {parent && <FamilyMembersSettings user={user} member={member} />}
        {parent && <SchoolConnectionsPreparation onOpenSchool={() => goTo('Szkoła')} />}

        <ConnectedCalendarsSettings user={user} member={member} notice={calendarNotice}><div className="data-tools"><button className="secondary-button" disabled={exporting} onClick={()=>void downloadCalendar()}>Pobierz kalendarz .ics</button><button className="secondary-button" onClick={() => goTo('Kalendarz')}>Import, osoby i zakres dat</button></div><p className="settings-footnote">Plik jest kopią bieżącego kalendarza. Zmiany po imporcie nie synchronizują się automatycznie. Godziny przyjmują strefę Twojego kalendarza.</p></ConnectedCalendarsSettings>

        <article className="settings-section"><header><span>👨‍👩‍👧‍👦</span><div><strong>Uprawnienia rodzinne</strong><small>Role i dostęp do danych</small></div></header><div className="permission-summary"><span className={parent ? 'parent-role' : 'child-role'}>{parent ? '👑 Rodzic — zarządzanie rodziną' : '👤 Członek rodziny — dostęp ograniczony'}</span><p>Rodzice zarządzają punktami, profilami dzieci oraz dokumentami. Prywatne wydarzenia i rozmowy są dostępne wyłącznie uprawnionym osobom.</p></div></article>

        <article className="settings-section"><header><span>🔐</span><div><strong>Prywatność i bezpieczeństwo</strong><small>Dane rodzinne są dostępne po zalogowaniu</small></div></header><div className="settings-info-list"><span>🔒 Ważne dokumenty Pawła: tylko rodzice</span><span>🗂️ Dokumenty zdrowotne: zgodnie z rolą</span><span>🔑 Dane połączenia eduVULCAN są szyfrowane wyłącznie na serwerze</span></div></article>

        <article className="settings-section"><header><span>📁</span><div><strong>Dane i pliki</strong><small>Zdjęcia, dokumenty i własne ikonki</small></div></header><div className="settings-info-list"><span>🖼️ Zdjęcia i dokumenty — magazyn rodziny</span><span>☁️ Dane są wspólne na wszystkich urządzeniach</span></div></article>

        {parent && <article className="settings-section"><header><span>💾</span><div><strong>Kopia danych rodziny</strong><small>Pobierz dane jako prywatny plik JSON</small></div></header><button className="secondary-button" disabled={exporting} onClick={()=>void downloadBackup()}>{exporting ? "Przygotowuję…" : "Pobierz kopię danych"}</button><p className="settings-footnote">Kopia zawiera dane zdrowotne. Dokumenty i wiadomości czatu wymagają oddzielnej kopii. Konta i hasła nie są eksportowane.</p></article>}

        <article className="settings-section whats-new-v130"><header><span>✨</span><div><strong>Co nowego?</strong><small>Ta sekcja będzie przy każdej wersji</small></div><b className="version-pill">v{APP_VERSION}</b></header><ul><li>Czytelne układy na telefonie, tablecie i komputerze</li><li>Ochrona prywatnych rozmów i dokumentów przez uprawnienia</li><li>Edycja szkolnych i zdrowotnych wpisów</li><li>Import szkoły z pliku i eksport kalendarza</li><li>Zadania powtarzające się z zatwierdzaniem rodzica</li></ul></article>

        <article className="settings-section app-about"><header><span>ℹ️</span><div><strong>O aplikacji</strong><small>Nasza Rodzina</small></div></header><div className="about-version"><img src="/nasza-rodzina-logo.svg" alt="" /><div><strong>Nasza Rodzina v{APP_VERSION}</strong><small>Aktualizacja: {APP_UPDATED}</small></div></div></article>
      </section>
      <button className="settings-logout" type="button" disabled={loggingOut} onClick={() => void logout()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h12"/></svg>{loggingOut ? 'Wylogowuję…' : 'Wyloguj'}</button>
    </div>
  );
}
