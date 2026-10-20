import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { AppIcon, memberEmoji, type CalendarOccurrence, type Page, type TaskItem } from '../app-shared';
import { Icon } from '../ui';
import { CalendarOwnerBadge } from '../CalendarOwnerBadge';
import { calendarOwnerColor, calendarOwnerProfile } from '../calendar-v2';
import { memberPersonKey, type FamilyMemberProfile } from '../family-members';
import { formatWarsawTime, warsawDayKey } from '../calendar-timeline';
import { formatFamilyStatusTime, type FamilyTimeProjection } from './start-tile-projections';
import { agendaDayLabel, homeOccurrenceDayKey, homeSectionOrder, reorderHomeSections, type HomeSection } from './family-home-model';
import type { StartCardId } from './start-layout';
import './family-home.css';

export type FamilyHomeProps = {
  name: string; now: Date; weather: { temp: number; label: string; icon: string } | null;
  familyTime: FamilyTimeProjection; profiles: readonly FamilyMemberProfile[]; upcoming: CalendarOccurrence[];
  tasks: TaskItem[]; shoppingCount: number; chatCount: number; order: readonly StartCardId[]; loaded: boolean;
  saveOrder: (order: StartCardId[]) => void; goTo: (page: Page) => void; onOpenEvent: (key: string) => void;
};
const sectionTitles: Record<HomeSection, string> = { calendar: 'Najbliżej w rodzinie', tasks: 'Do zrobienia', shortcuts: 'Szybki dostęp' };
function HomePanel({ id, active, loaded, children }: { id: HomeSection; active: boolean; loaded: boolean; children: ReactNode }) {
  const drag = useDraggable({ id, disabled: !loaded }), drop = useDroppable({ id });
  const panel = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const measure = () => {
      const span = Math.ceil(node.getBoundingClientRect().height + 18);
      if (node.style.gridRowEnd !== `span ${span}`) node.style.gridRowEnd = `span ${span}`;
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <section ref={node => { panel.current = node; drag.setNodeRef(node); drop.setNodeRef(node); }} className={`home-panel home-panel--${id}${active ? ' is-dragging' : ''}`} data-section={id} data-testid={`home-section-${id}`} aria-labelledby={`home-heading-${id}`}>
    <header className="home-panel-heading"><h2 id={`home-heading-${id}`}>{sectionTitles[id]}</h2>
      <button type="button" {...drag.attributes} {...drag.listeners} className="home-drag-handle" aria-label={`Przenieś sekcję: ${sectionTitles[id]}`} title="Przytrzymaj, aby przenieść" disabled={!loaded}><span aria-hidden="true">⠿</span></button>
    </header>{children}
  </section>;
}
export function FamilyHome(props: FamilyHomeProps) {
  const { now, familyTime, profiles, upcoming, goTo } = props;
  const [active, setActive] = useState<HomeSection | null>(null);
  const sections = homeSectionOrder(props.order);
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { active: dragging, currentCoordinates, context }) => {
    const direction = ['ArrowDown', 'ArrowRight'].includes(event.code) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.code) ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const index = sections.indexOf((context.over?.id || dragging) as HomeSection);
    const target = sections[index + direction];
    const next = target && context.droppableRects.get(target), current = context.collisionRect || context.draggingNodeRect;
    if (next && current) return { x: currentCoordinates.x + next.left + next.width / 2 - current.left - current.width / 2, y: currentCoordinates.y + next.top + next.height / 2 - current.top - current.height / 2 };
    return currentCoordinates;
  };
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 450, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }));
  const latestOrder = useRef(props.order); latestOrder.current = props.order;
  const finishDrag = ({ active: dragged, over }: DragEndEvent) => {
    setActive(null);
    if (over && dragged.id !== over.id && sections.includes(dragged.id as HomeSection) && sections.includes(over.id as HomeSection)) props.saveOrder(reorderHomeSections(latestOrder.current, dragged.id as HomeSection, over.id as HomeSection));
  };
  const links: Page[] = ['Kalendarz', 'Zadania', 'Zakupy', 'Finanse', 'Czat', 'Zdrowie', 'Szkoła'];
  return <div className="page-content family-home" data-testid="start-dashboard">
    <header className="home-welcome"><div><span className="home-eyebrow">Wasze wspólne miejsce</span><h1>Cześć, <span>{props.name}!</span></h1><time dateTime={warsawDayKey(now)}>{now.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'long', day: 'numeric', month: 'long' })}</time></div>
      <div className="home-weather" title={props.weather?.label || 'Pogoda chwilowo niedostępna'}><span aria-hidden="true">{props.weather?.icon || '🌤️'}</span><div><strong>{props.weather ? `${props.weather.temp}°C` : '—'}</strong><small>Kołobrzeg</small></div></div>
    </header>
    <section className="home-family" aria-labelledby="home-family-heading"><div className="home-family-heading"><h2 id="home-family-heading">Nasza rodzina</h2><span>Co teraz u Was?</span></div>
      <div className="home-people" role="list" tabIndex={0} aria-label="Aktualne statusy rodziny — przewiń, aby zobaczyć wszystkich">{familyTime.members.map(({ profile, currentStatus }) => <article role="listitem" className="home-person" key={profile.id} style={{ '--person-color': calendarOwnerColor(memberPersonKey(profile), profile) } as CSSProperties} data-profile-id={profile.id}>
        <span className="home-avatar" aria-hidden="true"><span>{profile.emoji || memberEmoji(memberPersonKey(profile))}</span>{profile.photoURL && <img src={profile.photoURL} alt="" onError={event => { event.currentTarget.hidden = true; }}/>}</span>
        <strong>{profile.name || memberPersonKey(profile) || 'Członek rodziny'}</strong><span className="home-person-status" data-status-kind={currentStatus.kind} aria-live="polite" aria-atomic="true"><i aria-hidden="true"/>{currentStatus.estimated ? 'Orientacyjnie: ' : ''}{currentStatus.title}{currentStatus.endAt ? ` — do ${formatFamilyStatusTime(currentStatus.endAt)}` : ''}</span>
      </article>)}{!familyTime.members.length && <p className="home-empty">Oczekiwanie na profile rodziny.</p>}</div>
    </section>
    <p className="home-layout-hint" id="home-layout-hint">Przestaw sekcje uchwytem ⠿. Kolejność zapisuje się na Twoim koncie.</p>
    <DndContext sensors={sensors} collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)} onDragStart={event => setActive(event.active.id as HomeSection)} onDragEnd={finishDrag} onDragCancel={() => setActive(null)} accessibility={{ screenReaderInstructions: { draggable: 'Naciśnij spację na uchwycie, strzałkami wybierz miejsce, spacją upuść. Escape anuluje.' }, announcements: { onDragStart: ({ active }) => `Przenosisz ${sectionTitles[active.id as HomeSection]}.`, onDragOver: ({ over }) => over ? `Nad sekcją: ${sectionTitles[over.id as HomeSection]}.` : 'Poza sekcjami.', onDragEnd: ({ over }) => over ? 'Zakończono przenoszenie sekcji.' : 'Anulowano przenoszenie.', onDragCancel: () => 'Anulowano przenoszenie.' } }}>
      <div className="home-sections" data-layout-ready={props.loaded} data-order={sections.join(',')} aria-describedby="home-layout-hint">{sections.map(id => <HomePanel key={id} id={id} active={active === id} loaded={props.loaded}>
        {id === 'calendar' && <><p className="home-section-note">Dzisiaj i najbliższe 6 dni</p><div className="home-agenda">{upcoming.map((item, index) => <div className="home-agenda-entry" key={item.key}>
          {(index === 0 || homeOccurrenceDayKey(upcoming[index - 1]) !== homeOccurrenceDayKey(item)) && <h3>{agendaDayLabel(item.date, now, item.source.allDay)}</h3>}
          <button type="button" className={`home-event${item.source.cancelled ? ' is-cancelled' : ''}`} style={{ '--calendar-owner-color': calendarOwnerColor(item.source.person, calendarOwnerProfile(item.source, profiles)) } as CSSProperties} onClick={() => props.onOpenEvent(item.key)}>
            <time>{item.source.allDay ? 'Cały dzień' : `${formatWarsawTime(item.date)}–${formatWarsawTime(item.endDate)}`}</time><span className="home-event-copy"><strong>{item.source.title}</strong><CalendarOwnerBadge event={item.source}/><span className="home-event-labels">{item.source.cancelled && <small>Odwołane</small>}{!item.source.cancelled && !item.source.allDay && item.date <= now && item.endDate > now && <small>Teraz</small>}{item.source.timingConfidence === 'estimated' && <small>Godziny orientacyjne</small>}{!item.source.allDay && warsawDayKey(item.endDate) !== warsawDayKey(item.date) && <small>Do {item.endDate.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long' })}</small>}</span></span><Icon name="arrow-right" size={15}/>
          </button></div>)}{!upcoming.length && <p className="home-empty">Brak wspólnych wydarzeń w najbliższych dniach.</p>}</div><button type="button" className="home-section-link" onClick={() => goTo('Kalendarz')}>Zobacz kalendarz <Icon name="arrow-right" size={16}/></button></>}
        {id === 'tasks' && <><p className="home-section-note">{props.tasks.length ? `${props.tasks.length} zadań do zrobienia` : 'Wszystko zrobione'}</p><div className="home-task-list">{props.tasks.slice(0, 4).map(task => <button type="button" className="home-task" key={task.id} onClick={() => goTo('Zadania')}><span className={`home-task-dot${task.priority === 'high' ? ' is-important' : ''}`} aria-hidden="true"/><span><strong>{task.title}</strong><small>{task.person === 'family' ? 'Cała rodzina' : task.person}{task.dueDate ? ` · ${task.dueDate.split('-').reverse().join('.')}` : ''}{task.approvalStatus === 'pending' ? ' · Do zatwierdzenia' : ''}</small></span></button>)}{!props.tasks.length && <p className="home-empty">Nie ma zadań do zrobienia.</p>}</div><button type="button" className="home-section-link" onClick={() => goTo('Zadania')}>Wszystkie zadania <Icon name="arrow-right" size={16}/></button></>}
        {id === 'shortcuts' && <div className="home-shortcuts">{links.map(page => <button type="button" key={page} data-shortcut={page} onClick={() => goTo(page)}><span className="home-shortcut-icon"><AppIcon page={page} size={23}/></span><strong>{page}</strong>{page === 'Zakupy' && <small>{props.shoppingCount} do kupienia</small>}{page === 'Czat' && <small>{props.chatCount} {props.chatCount === 1 ? 'rozmowa' : 'rozmów'}</small>}</button>)}</div>}
      </HomePanel>)}</div>
    </DndContext>
  </div>;
}
