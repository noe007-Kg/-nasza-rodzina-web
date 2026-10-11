import type { CalendarEventData, CalendarOccurrence } from './app-shared';
import type { FamilyMemberProfile } from './family-members';
import { memberPersonKey } from './family-members';
import { addDays, endOfDay, generateOccurrences, startOfDay } from './calendar-utils';

/** Family is a shared view, not a shortcut around the private owner boundary. */
export function calendarEventInView(event: CalendarEventData, selected: string, own: string, uid: string): boolean {
  if (event.private) {
    return selected !== 'family' && selected === own && !!uid && (event.ownerUid || event.createdBy) === uid;
  }
  return selected === 'family' || event.person === selected || event.person === 'family';
}

export function familyCalendarEvents(events: readonly CalendarEventData[]): CalendarEventData[] {
  return events.filter(event => event.private !== true);
}

/** Owner colours are stable identifiers, independent of Start tile preferences. */
export function calendarOwnerColor(person: string): string {
  if (!person || person === 'family') return '#7c5cfc';
  let hash = 2166136261;
  for (const character of person.normalize('NFC')) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return `hsl(${((hash >>> 16) ^ (hash & 0xffff)) % 360} 68% 43%)`;
}

export function calendarOwnerProfile(event: Pick<CalendarEventData, 'person' | 'ownerProfileId'>, profiles: readonly FamilyMemberProfile[]): FamilyMemberProfile | undefined {
  return profiles.find(profile => profile.id === event.ownerProfileId) || profiles.find(profile => memberPersonKey(profile) === event.person);
}

/** Birthdays come only from real saved profile dates; this projection writes nothing. */
export function projectFamilyBirthdays(profiles: readonly FamilyMemberProfile[]): CalendarEventData[] {
  return profiles.flatMap(profile => {
    if (profile.active === false || profile.archived || profile.disabled || !profile.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate)) return [];
    const [year, month, day] = profile.birthDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (year < 1900 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date > new Date()) return [];
    const person = memberPersonKey(profile);
    if (!person) return [];
    return [{ id: `profile:birthday:${profile.id}`, title: `Urodziny — ${profile.name || person}`, person, date,
      endDate: endOfDay(date), allDay: true, description: '', createdBy: '', repeat: 'yearly', repeatUntil: null,
      ownerProfileId: profile.id, readOnly: true, important: true, private: false } satisfies CalendarEventData];
  });
}

/** Explicit importance and medical terms; ordinary work and lessons do not qualify. */
export function isImportantCalendarEvent(event: CalendarEventData): boolean {
  return !event.cancelled && (event.important === true || event.source === 'health');
}

export function importantCalendarOccurrences(events: readonly CalendarEventData[], now: Date, expand: (event: CalendarEventData, start: Date, end: Date) => CalendarOccurrence[] = generateOccurrences): CalendarOccurrence[] {
  const start = startOfDay(now), end = endOfDay(addDays(now, 366));
  return events.flatMap(event => expand(event, start, end))
    .filter(item => isImportantCalendarEvent(item.source) && item.endDate >= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.key.localeCompare(b.key));
}
