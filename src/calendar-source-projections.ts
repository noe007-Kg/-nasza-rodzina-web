import type { CalendarEventData } from './app-shared';
import type { SchoolReadAccess } from './school/read-access';
import { memberPersonKey, type FamilyMemberProfile } from './family-members';
import { OKRUSZEK_PLAN_ID, OKRUSZEK_START, OKRUSZEK_END, okruszekDateStatus, parseOkruszekDay, okruszekLessonDetails, OKRUSZEK_BELL_SOURCE } from './school/okruszek-plan';
import { schoolOwnerProfileId, schoolSourcesForProfile } from './school/profile-schools';

export type CalendarSchoolRecord = {
  id: string;
  person: string;
  type: string;
  source?: string;
  title: string;
  subject?: string;
  date: string;
  time: string;
  endTime: string;
  note?: string;
  calendarEventId?: string;
  createdBy?: string;
  weekday?: number;
  schoolPlanId?: string;
  schoolPlanRevision?: number;
  ownerProfileId?: string;
  manualDayPlan?: unknown;
};

const SCHOOL_TIME_ZONE = 'Europe/Warsaw';
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCHOOL_CLOCK = new Intl.DateTimeFormat('sv-SE', {
  timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** The current portal uses this exact first status line. Later prose is not a cancellation. */
export function schoolLessonCancelled(note: string | undefined): boolean {
  return (note || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) === 'Lekcja odwołana';
}

function validSchoolCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const represented = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2200 && represented.getUTCFullYear() === year
    && represented.getUTCMonth() === month - 1 && represented.getUTCDate() === day;
}

function schoolDate(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  // UTC fields carry the provider's Warsaw wall clock without passing through
  // the device's local Date constructor. A device DST gap must not normalize
  // an otherwise valid school time before Warsaw is consulted.
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(SCHOOL_CLOCK.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute));
    const delta = target - represented;
    if (delta === 0) return new Date(guess);
    guess += delta;
  }
  // Warsaw's missing spring clock oscillates instead of converging. The
  // round-trip validation below rejects it rather than shifting the lesson.
  // An ambiguous autumn clock retains the previous choice: the later instant.
  return new Date(guess);
}

function matchesSchoolClock(instant: Date, date: string, time: string): boolean {
  if (!Number.isFinite(instant.getTime())) return false;
  const parts = Object.fromEntries(SCHOOL_CLOCK.formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time;
}

/** An authorized view of existing school records, with no calendar writes or inferred recurrence. */
export function projectSchoolCalendar(
  records: readonly CalendarSchoolRecord[],
  existingCalendar: readonly Pick<CalendarEventData, 'id'>[],
  access: SchoolReadAccess | null,
): { events: CalendarEventData[]; incomplete: number } {
  if (!access) return { events: [], incomplete: 0 };
  const actualCalendarIds = new Set(existingCalendar.map(event => event.id));
  const seen = new Set<string>();
  const events: CalendarEventData[] = [];
  let incomplete = 0;
  for (const record of records) {
    if (record.source !== 'eduvulcan' || !['lesson', 'activity'].includes(record.type)
      || !record.id || seen.has(record.id) || !record.person
      || (access.scope === 'student' && record.person !== access.person)) continue;
    seen.add(record.id);
    // A stale link alone does not prove there is a calendar copy to display.
    if (record.calendarEventId && actualCalendarIds.has(record.calendarEventId)) continue;
    const title = record.title.trim() || record.subject?.trim() || '';
    if (!title || !validSchoolCalendarDate(record.date) || !CLOCK.test(record.time)
      || !CLOCK.test(record.endTime) || record.endTime <= record.time) {
      incomplete += 1;
      continue;
    }
    const date = schoolDate(record.date, record.time);
    const endDate = schoolDate(record.date, record.endTime);
    if (!matchesSchoolClock(date, record.date, record.time)
      || !matchesSchoolClock(endDate, record.date, record.endTime) || endDate <= date) {
      incomplete += 1;
      continue;
    }
    const id = `school:sp4:${record.id}`;
    events.push({
      id, title, person: record.person, date, endDate, allDay: false,
      description: record.note || '', location: '', createdBy: record.createdBy || '',
      repeat: 'none', repeatUntil: null, timeZone: SCHOOL_TIME_ZONE,
      source: 'sp4', sourceRecordId: record.id, readOnly: true,
      cancelled: schoolLessonCancelled(record.note),
    });
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  return { events, incomplete };
}

/** One dated calendar view of the saved weekly Okruszek plan; no copies or writes. */
export function projectOkruszekCalendar(
  records: readonly CalendarSchoolRecord[],
  existingCalendar: readonly Pick<CalendarEventData, 'id'>[],
  access: SchoolReadAccess | null,
  profiles: readonly FamilyMemberProfile[],
): CalendarEventData[] {
  if (!access) return [];
  const actualCalendarIds = new Set(existingCalendar.map(event => event.id));
  const seenDays = new Set<string>();
  const events: CalendarEventData[] = [];
  // A malformed duplicate weekday cannot create a second school-day occurrence.
  // Prefer the most recent revision without mutating the Firestore snapshot.
  const ordered = [...records].sort((a, b) => (b.schoolPlanRevision || 0) - (a.schoolPlanRevision || 0) || a.id.localeCompare(b.id));
  for (const record of ordered) {
    if (!record.id || record.schoolPlanId !== OKRUSZEK_PLAN_ID || !record.ownerProfileId
      || (access.scope === 'student' && record.person !== access.person)) continue;
    const profile = profiles.find(candidate => schoolOwnerProfileId(candidate) === record.ownerProfileId
      && schoolSourcesForProfile(candidate).includes('okruszek') && memberPersonKey(candidate) === record.person);
    if (!profile) continue;
    const day = parseOkruszekDay(record.id, { ...record });
    if (!day || day.ownerProfileId !== profile.id) continue;
    const weekdayKey = `${profile.id}:${day.weekday}`;
    if (seenDays.has(weekdayKey)) continue;
    seenDays.add(weekdayKey);
    const start = day.periodStart < OKRUSZEK_START ? OKRUSZEK_START : day.periodStart;
    const end = day.periodEnd > OKRUSZEK_END ? OKRUSZEK_END : day.periodEnd;
    const cursor = new Date(`${start}T12:00:00Z`);
    while (cursor.toISOString().slice(0, 10) <= end) {
      const dateKey = cursor.toISOString().slice(0, 10);
      if (cursor.getUTCDay() === day.weekday && okruszekDateStatus(dateKey, day).kind === 'planned') {
        const id = `school:okruszek:${record.id}:${dateKey}`;
        const date = schoolDate(dateKey, day.time), endDate = schoolDate(dateKey, day.endTime);
        if (!actualCalendarIds.has(id) && matchesSchoolClock(date, dateKey, day.time)
          && matchesSchoolClock(endDate, dateKey, day.endTime) && endDate > date) {
          const name = profile.name || record.person;
          events.push({
            id, title: `Okruszek — ${name}`, person: memberPersonKey(profile), ownerProfileId: profile.id,
            date, endDate, allDay: false, createdBy: record.createdBy || '',
            description: [`Uczeń: ${name}`, `Pobyt w szkole: ${day.time}–${day.endTime}`,
              'Zajęcia według numerów pozycji i tabeli godzin Okruszka:',
              ...okruszekLessonDetails(day), `Źródło godzin: ${OKRUSZEK_BELL_SOURCE}`].join('\n'),
            location: 'Okruszek, Kołobrzeg', repeat: 'none', repeatUntil: null, private: false,
            timeZone: SCHOOL_TIME_ZONE, source: 'okruszek', sourceRecordId: record.id, readOnly: true,
          });
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
}
