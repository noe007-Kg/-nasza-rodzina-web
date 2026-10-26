import type { AccountAccentPreference } from './account-accent';
import { APP_UPDATED, APP_VERSION, collection, dateKey, db, downloadFile, errorMessage, getDocs, isParent, type Member, ModuleHeader, notify, type Page, type User, useState } from "../app-shared";

import { AccountSettings } from '../account/AccountSettings';
import { FamilyMembersSettings } from '../account/FamilyMembersSettings';
import { OwnProfileSettings } from '../account/ProfileSettings';
import { exportCalendarIcs } from '../calendar-ics';
import { fetchCalendarEvents } from '../calendar-store';
import { NotificationSettings } from '../notifications';
import { ConnectedCalendarsSettings } from '../calendars/ConnectedCalendarsSettings';
import type { CalendarNotice } from '../calendars/model';

import './settings-appearance.css';

export function SettingsPage({ user, member, theme, setTheme, goTo, onLogout, calendarNotice, accountAccent }: { accountAccent: { preference: AccountAccentPreference; setPreference: (value: AccountAccentPreference) => void; saved: boolean }; user: User; member: Member | null; theme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void; goTo: (page: Page) => void; onLogout: () => Promise<void>; calendarNotice?: CalendarNotice }) {
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
    <div className="page-content compact-page settings-v130 family-ui">
      <ModuleHeader icon="⚙️" title="Ustawienia" text="Twój profil, wygląd, powiadomienia i połączenia." />
      <section className="settings-dashboard">
        <AccountSettings user={user} />
        <OwnProfileSettings user={user} member={member} />

        <article className="settings-section settings-appearance" data-testid="settings-appearance"><header><span>🎨</span><div><strong>Wygląd</strong><small>Motyw i kolor aplikacji</small></div></header><div className="appearance-theme-buttons" role="group" aria-label="Motyw aplikacji"><button type="button" aria-pressed={theme === 'light'} onClick={()=>setTheme('light')}><span aria-hidden="true">☀️</span> Jasny</button><button type="button" aria-pressed={theme === 'dark'} onClick={()=>setTheme('dark')}><span aria-hidden="true">🌙</span> Ciemny</button></div><p className="settings-footnote">Motyw zapisuje się na tym urządzeniu.</p><div className="appearance-theme-buttons" role="group" aria-label="Kolor aplikacji">{([['auto', 'Automatyczny'], ['blue', 'Niebieski'], ['pink', 'Różowy']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={accountAccent.preference === value} onClick={() => accountAccent.setPreference(value)}>{label}</button>)}</div><p className="settings-footnote">Kolor dotyczy zalogowanego konta na tym urządzeniu. Wybranie kalendarza innej osoby nie zmienia motywu. Automatyczny kolor wynika z Twojego profilu.</p>{!accountAccent.saved && <p role="status">Nie udało się zapisać koloru na tym urządzeniu. Zmiana działa do zamknięcia strony.</p>}</article>

        <NotificationSettings />

        {parent && <FamilyMembersSettings user={user} member={member} />}


        <ConnectedCalendarsSettings user={user} member={member} notice={calendarNotice}><div className="data-tools"><button className="secondary-button" disabled={exporting} onClick={()=>void downloadCalendar()}>Pobierz kalendarz .ics</button><button className="secondary-button" onClick={() => goTo('Kalendarz')}>Import, osoby i zakres dat</button></div><p className="settings-footnote">Plik jest kopią bieżącego kalendarza. Zmiany po imporcie nie synchronizują się automatycznie. Godziny przyjmują strefę Twojego kalendarza.</p></ConnectedCalendarsSettings>

        {parent && <article className="settings-section"><header><span>💾</span><div><strong>Kopia danych rodziny</strong><small>Pobierz dane jako prywatny plik JSON</small></div></header><button className="secondary-button" disabled={exporting} onClick={()=>void downloadBackup()}>{exporting ? "Przygotowuję…" : "Pobierz kopię danych"}</button><p className="settings-footnote">Kopia zawiera dane zdrowotne. Dokumenty i wiadomości czatu wymagają oddzielnej kopii. Konta i hasła nie są eksportowane.</p></article>}


        <article className="settings-section app-about"><header><span>ℹ️</span><div><strong>O aplikacji</strong><small>Nasza Rodzina</small></div></header><div className="about-version"><img src="/nasza-rodzina-logo.svg" alt="" /><div><strong>Nasza Rodzina v{APP_VERSION}</strong><small>Aktualizacja: {APP_UPDATED}</small></div></div></article>
      </section>
      <button className="settings-logout" type="button" disabled={loggingOut} onClick={() => void logout()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h12"/></svg>{loggingOut ? 'Wylogowuję…' : 'Wyloguj'}</button>
    </div>
  );
}
