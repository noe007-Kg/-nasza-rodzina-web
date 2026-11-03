import { cloneElement, isValidElement, type CSSProperties, type ReactNode } from 'react';
import { AppIcon, memberEmoji, type CalendarOccurrence, type Page, type TaskItem } from '../app-shared';
import { Icon } from '../ui';
import { CalendarOwnerBadge } from '../CalendarOwnerBadge';
import { calendarOwnerColor, calendarOwnerProfile } from '../calendar-v2';
import { memberPersonKey, type FamilyMemberProfile } from '../family-members';
import { formatWarsawTime, warsawDayKey } from '../calendar-timeline';
import { formatFamilyStatusTime, type FamilyTimeProjection } from './start-tile-projections';
import { agendaDayLabel, homeOccurrenceDayKey, homeSectionOrder, type HomeSection } from './family-home-model';
import type { StartCardId } from './start-layout';
import './family-home.css';
import type { SchoolHomeEntry } from './school-home';
import { FamilyDashboardLayout, type FamilyDashboardTile } from './FamilyDashboardLayout';
import { DEFAULT_HOME_LAYOUT, type HomeTileLayout } from './home-dashboard-layout';

export type FamilyHomeProps = {
  uid:string; parcelsTile?: ReactNode; name: string; now: Date; weather: { temp: number; label: string; icon: string } | null;
  familyTime: FamilyTimeProjection; profiles: readonly FamilyMemberProfile[]; upcoming: CalendarOccurrence[];
  tasks: TaskItem[]; shoppingCount: number; order: readonly StartCardId[];
  school?: readonly SchoolHomeEntry[]; schoolError?: boolean;
  goTo: (page: Page) => void; onOpenEvent: (key: string) => void;
};
const sectionTitles: Record<HomeSection, string> = { calendar: 'Najbliżej w rodzinie', tasks: 'Do zrobienia', school:'Szkoła — ostatnie wpisy', shortcuts: 'Szybki dostęp' };
function HomePanel({ id, children }: { id: HomeSection; children: ReactNode }) {
  return <section className={`home-panel home-panel--${id}`} data-section={id} data-testid={`home-section-${id}`} aria-labelledby={`home-heading-${id}`}>
    <header className="home-panel-heading"><h2 id={`home-heading-${id}`}>{sectionTitles[id]}</h2></header>{children}
  </section>;
}
export function FamilyHome(props: FamilyHomeProps) {
  const { now, familyTime, profiles, upcoming, goTo } = props;
  const sections = homeSectionOrder(props.order);
  const links: Page[] = ['Kalendarz', 'Zadania', 'Zakupy', 'Finanse', 'Zdrowie', 'Szkoła'];
  const defaults:HomeTileLayout[] = [DEFAULT_HOME_LAYOUT[0],DEFAULT_HOME_LAYOUT[1],...sections.map(id=>({id,size:'rectangle' as const}))];
  const tiles:FamilyDashboardTile[] = [
    {id:'family',label:'Nasza rodzina',content:(<section className="home-family" aria-labelledby="home-family-heading"><div className="home-family-heading"><h2 id="home-family-heading">Nasza rodzina</h2><span>Co teraz u Was?</span></div>
      <div className="home-people" role="list" tabIndex={0} aria-label="Aktualne statusy rodziny — przewiń, aby zobaczyć wszystkich">{familyTime.members.map(({ profile, currentStatus }) => <article role="listitem" className="home-person" key={profile.id} style={{ '--person-color': calendarOwnerColor(memberPersonKey(profile), profile) } as CSSProperties} data-profile-id={profile.id}>
        <span className="home-avatar" aria-hidden="true"><span>{profile.emoji || memberEmoji(memberPersonKey(profile))}</span>{profile.photoURL && <img src={profile.photoURL} alt="" onError={event => { event.currentTarget.hidden = true; }}/>}</span>
        <strong>{profile.name || memberPersonKey(profile) || 'Członek rodziny'}</strong><span className="home-person-status" data-status-kind={currentStatus.kind} aria-live="polite" aria-atomic="true"><i aria-hidden="true"/>{currentStatus.estimated ? 'Orientacyjnie: ' : ''}{currentStatus.title}{currentStatus.endAt ? ` — do ${formatFamilyStatusTime(currentStatus.endAt)}` : ''}</span>
      </article>)}{!familyTime.members.length && <p className="home-empty">Oczekiwanie na profile rodziny.</p>}</div>
    </section>)},
    {id:'parcels',label:'Paczki InPost',content:size=>isValidElement<{compact?:boolean}>(props.parcelsTile)?cloneElement(props.parcelsTile,{compact:size==='small'}):props.parcelsTile},
    ...sections.map(id=>({id,label:sectionTitles[id],content:<HomePanel id={id}>
        {id === 'calendar' && <><p className="home-section-note">Dzisiaj i najbliższe 6 dni</p><div className="home-agenda">{upcoming.map((item, index) => <div className="home-agenda-entry" key={item.key}>
          {(index === 0 || homeOccurrenceDayKey(upcoming[index - 1]) !== homeOccurrenceDayKey(item)) && <h3>{agendaDayLabel(item.date, now, item.source.allDay)}</h3>}
          <button type="button" className={`home-event${item.source.cancelled ? ' is-cancelled' : ''}`} style={{ '--calendar-owner-color': calendarOwnerColor(item.source.person, calendarOwnerProfile(item.source, profiles)) } as CSSProperties} onClick={() => props.onOpenEvent(item.key)}>
            <time>{item.source.allDay ? 'Cały dzień' : `${formatWarsawTime(item.date)}–${formatWarsawTime(item.endDate)}`}</time><span className="home-event-copy"><strong>{item.source.title}</strong><CalendarOwnerBadge event={item.source}/><span className="home-event-labels">{item.source.cancelled && <small>Odwołane</small>}{!item.source.cancelled && !item.source.allDay && item.date <= now && item.endDate > now && <small>Teraz</small>}{item.source.timingConfidence === 'estimated' && <small>Godziny orientacyjne</small>}{!item.source.allDay && warsawDayKey(item.endDate) !== warsawDayKey(item.date) && <small>Do {item.endDate.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long' })}</small>}</span></span><Icon name="arrow-right" size={15}/>
          </button></div>)}{!upcoming.length && <p className="home-empty">Brak wspólnych wydarzeń w najbliższych dniach.</p>}</div><button type="button" className="home-section-link" onClick={() => goTo('Kalendarz')}>Zobacz kalendarz <Icon name="arrow-right" size={16}/></button></>}
        {id === 'tasks' && <><p className="home-section-note">{props.tasks.length ? `${props.tasks.length} zadań do zrobienia` : 'Wszystko zrobione'}</p><div className="home-task-list">{props.tasks.slice(0, 4).map(task => <button type="button" className="home-task" key={task.id} onClick={() => goTo('Zadania')}><span className={`home-task-dot${task.priority === 'high' ? ' is-important' : ''}`} aria-hidden="true"/><span><strong>{task.title}</strong><small>{task.person === 'family' ? 'Cała rodzina' : task.person}{task.dueDate ? ` · ${task.dueDate.split('-').reverse().join('.')}` : ''}{task.approvalStatus === 'pending' ? ' · Do zatwierdzenia' : ''}</small></span></button>)}{!props.tasks.length && <p className="home-empty">Nie ma zadań do zrobienia.</p>}</div><button type="button" className="home-section-link" onClick={() => goTo('Zadania')}>Wszystkie zadania <Icon name="arrow-right" size={16}/></button></>}
        {id === 'school' && <><p className="home-section-note">Najnowsze oceny, zadania i informacje ze szkoły</p><div className="home-school-list">{props.schoolError ? <p className="home-empty" role="status">Nie udało się odczytać wpisów szkolnych. Spróbuj ponownie w zakładce Szkoła.</p> : props.school?.length ? props.school.map(entry=><article className="home-school-entry" key={entry.id}><div><small>{entry.kind} · {entry.person}</small>{entry.isNew && <span className="school-new-badge">NOWE</span>}</div><strong>{entry.title}</strong><small>{entry.dateLabel}</small></article>) : <p className="home-empty">Brak wpisów szkolnych do wyświetlenia.</p>}</div><button type="button" className="home-section-link" onClick={()=>goTo('Szkoła')}>Otwórz szkołę <Icon name="arrow-right" size={16}/></button></>}
        {id === 'shortcuts' && <div className="home-shortcuts">{links.map(page => <button type="button" key={page} data-shortcut={page} onClick={() => goTo(page)}><span className="home-shortcut-icon"><AppIcon page={page} size={23}/></span><strong>{page}</strong>{page === 'Zakupy' && <small>{props.shoppingCount} do kupienia</small>}</button>)}</div>}
    </HomePanel>})),
  ];
  return <div className="page-content family-home" data-testid="start-dashboard">
    <header className="home-welcome"><div><span className="home-eyebrow">Wasze wspólne miejsce</span><h1>Cześć, <span>{props.name}!</span></h1><time dateTime={warsawDayKey(now)}>{now.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'long', day: 'numeric', month: 'long' })}</time></div>
      <div className="home-weather" title={props.weather?.label || 'Pogoda chwilowo niedostępna'}><span aria-hidden="true">{props.weather?.icon || '🌤️'}</span><div><strong>{props.weather ? `${props.weather.temp}°C` : '—'}</strong><small>Kołobrzeg</small></div></div>
    </header>
    <FamilyDashboardLayout uid={props.uid} tiles={tiles} defaults={defaults}/>
  </div>;
}
