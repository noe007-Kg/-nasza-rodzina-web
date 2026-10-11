import type { CalendarEventData } from './app-shared';
import type { CalendarSchoolRecord } from './calendar-source-projections';
import type { SchoolReadAccess } from './school/read-access';
import { dateInTimeZone } from './calendar-utils';
import { validSchoolDate } from './school-import';

type ManualSchoolRecord = CalendarSchoolRecord & {
  eventKind?: 'lesson' | 'break';
  timingConfidence?: 'confirmed' | 'estimated';
};
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Existing manually saved school times, used identically by Calendar and Start.
 * Provider records and Okruszek's weekly source have their own projections.
 * Recurrence comes only from a saved weekday, never the title or a calendar gap.
 */
export function projectManualSchoolCalendar(
  records: readonly ManualSchoolRecord[],
  existingCalendar: readonly Pick<CalendarEventData, 'id'>[],
  access: SchoolReadAccess | null,
): { events: CalendarEventData[]; incomplete: number } {
  if (!access) return { events: [], incomplete: 0 };
  const calendarIds = new Set(existingCalendar.map(event => event.id));
  const seen = new Set<string>();
  const events: CalendarEventData[] = [];
  let incomplete = 0;
  for (const record of records) {
    if (!record.id || seen.has(record.id) || record.schoolPlanId
      || (record.source && record.source !== 'manual')
      || !['lesson', 'activity'].includes(record.type)
      || (access.scope === 'student' && record.person !== access.person)) continue;
    seen.add(record.id);
    const id = `school:manual:${record.id}`;
    if (calendarIds.has(id) || record.calendarEventId && calendarIds.has(record.calendarEventId)) continue;
    const dated = !!record.date;
    const weekly = !dated && Number.isInteger(record.weekday) && record.weekday! >= 1 && record.weekday! <= 7;
    const title = record.title.trim() || record.subject?.trim();
    if (!record.person || !title || dated && !validSchoolDate(record.date) || !dated && !weekly
      || !clock.test(record.time) || !clock.test(record.endTime) || record.endTime <= record.time) {
      incomplete++; continue;
    }
    // A fixed Monday is only the recurrence anchor, not a fabricated school date.
    const anchor = dated ? new Date(`${record.date}T12:00:00Z`) : new Date(Date.UTC(1970, 0, 4 + record.weekday!));
    const [hour, minute] = record.time.split(':').map(Number);
    const [endHour, endMinute] = record.endTime.split(':').map(Number);
    const civilStart = new Date(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), hour, minute);
    const civilEnd = new Date(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), endHour, endMinute);
    const date = dateInTimeZone(civilStart, 'Europe/Warsaw'), endDate = dateInTimeZone(civilEnd, 'Europe/Warsaw');
    if (!Number.isFinite(date.getTime()) || endDate <= date) { incomplete++; continue; }
    events.push({ id, title, person: record.person, date, endDate, allDay: false,
      description: record.note || '', location: '', createdBy: record.createdBy || '',
      repeat: weekly ? 'weekly' : 'none', repeatUntil: null, source: 'manual', sourceRecordId: record.id,
      timeZone: 'Europe/Warsaw', readOnly: true,
      ...(record.eventKind ? { eventKind: record.eventKind } : {}),
      ...(record.timingConfidence ? { timingConfidence: record.timingConfidence } : {}) });
  }
  return { events: events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id)), incomplete };
}
