import type { CalendarOccurrence } from '../app-shared';
import { warsawCalendarDayRange, warsawDayKey } from '../calendar-timeline';
import { normalizeDashboardOrder, type StartCardId } from './start-layout';

export const HOME_SECTIONS = ['calendar', 'tasks', 'shortcuts'] as const;
export type HomeSection = typeof HOME_SECTIONS[number];
const shortcutCards: StartCardId[] = ['shopping', 'chat', 'health', 'school'];
export function homeSectionOrder(order: readonly StartCardId[]): HomeSection[] {
  return [...new Set(normalizeDashboardOrder(order).filter(id => id !== 'family-time').map(id => shortcutCards.includes(id) ? 'shortcuts' : id))] as HomeSection[];
}
/** Preserve the old seven-ID schema and the shortcut group's internal order. Never save on render. */
export function reorderHomeSections(order: readonly StartCardId[], active: HomeSection, over: HomeSection): StartCardId[] {
  const sections = homeSectionOrder(order), from = sections.indexOf(active), to = sections.indexOf(over);
  if (from < 0 || to < 0 || from === to) return [...order];
  sections.splice(to, 0, sections.splice(from, 1)[0]);
  const shortcuts = normalizeDashboardOrder(order).filter(id => shortcutCards.includes(id));
  return ['family-time', ...sections.flatMap(id => id === 'shortcuts' ? shortcuts : [id])];
}
export function familyAgendaRange(now: Date) {
  const start = warsawCalendarDayRange(now).start;
  const lastDay = new Date(`${warsawDayKey(now)}T12:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() + 6);
  return { start, end: warsawCalendarDayRange(lastDay).end };
}
/** All-day occurrences carry civil dates, matching the existing calendar convention. */
function civilDay(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function homeOccurrenceDayKey(item: CalendarOccurrence): string { return item.source.allDay ? civilDay(item.date) : warsawDayKey(item.date); }
export function upcomingFamilyEvents(occurrences: readonly CalendarOccurrence[], now: Date): CalendarOccurrence[] {
  const range = familyAgendaRange(now), today = warsawDayKey(now), until = warsawDayKey(range.end);
  return occurrences.filter(item => !item.source.private && (item.source.allDay
    ? civilDay(item.endDate) >= today && civilDay(item.date) <= until
    : item.endDate > now && item.date <= range.end))
    .sort((a, b) => homeOccurrenceDayKey(a).localeCompare(homeOccurrenceDayKey(b))
      || (a.source.allDay ? 0 : a.date.getTime()) - (b.source.allDay ? 0 : b.date.getTime()) || a.key.localeCompare(b.key)).slice(0, 6);
}
export function agendaDayLabel(date: Date, now: Date, allDay = false): string {
  const key = allDay ? civilDay(date) : warsawDayKey(date);
  if (key === warsawDayKey(now)) return 'Dzisiaj';
  const tomorrow = new Date(`${warsawDayKey(now)}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (key === warsawDayKey(tomorrow)) return 'Jutro';
  return (allDay ? new Date(`${key}T12:00:00Z`) : date).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'long', day: 'numeric', month: 'long' });
}
