import type { CalendarEventData } from './app-shared';

type SourceMetadata = Pick<CalendarEventData, 'source' | 'sourceRecordId' | 'sourceConnectionId' | 'sourceOwnerUid' | 'externalCalendarId' | 'externalEventId' | 'externalSeriesId' | 'sourceStartDate' | 'sourceEndDateExclusive' | 'ownerProfileId' | 'readOnly' | 'cancelled'>;
const fields = ['sourceRecordId', 'sourceConnectionId', 'sourceOwnerUid', 'externalCalendarId', 'externalEventId', 'externalSeriesId', 'ownerProfileId'] as const;

/** Provenance is read from existing documents; this never creates provider records. */
export function readCalendarSourceMetadata(data: Record<string, unknown>): SourceMetadata {
  const source = data.source === 'google' || data.source === 'sp4' || data.source === 'manual' ? data.source : undefined;
  const result: SourceMetadata = {};
  if (source) result.source = source;
  // Google content belongs to its source even if an old record omitted this flag.
  if (source === 'google' || data.readOnly === true) result.readOnly = true;
  if (data.cancelled === true) result.cancelled = true;
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value.trim() && value.length <= 2048) result[field] = value;
  }
  if (source === 'google') {
    if (validCivilDay(data.sourceStartDate)) result.sourceStartDate = data.sourceStartDate as string;
    if (validCivilDay(data.sourceEndDateExclusive)) result.sourceEndDateExclusive = data.sourceEndDateExclusive as string;
  }
  return result;
}

/** This UI gate mirrors the backend; only its authenticated transaction authorizes a move. */
export function canChangeGoogleVisibility(event: CalendarEventData | null, uid: string): boolean {
  return !!uid && !!event && event.source === 'google' && /^google-[a-f0-9]{64}$/.test(event.id)
    && !!event.sourceConnectionId && !!event.externalEventId
    && event.sourceOwnerUid === uid && event.ownerUid === uid && event.createdBy === uid;
}

function validCivilDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2200) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function localCivilDay(value: string, end = false): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
}

/** A Google all-day DATE is a civil day, not the device-local date of its UTC instant.
 * Display-only copies leave storage and ICS export on the original source timestamps. */
export function calendarSourceDisplayEvent(event: CalendarEventData): CalendarEventData {
  if (event.source !== 'google' || !event.allDay || event.repeat !== 'none') return event;
  let start: string, end: string;
  if (validCivilDay(event.sourceStartDate) && validCivilDay(event.sourceEndDateExclusive)
    && event.sourceEndDateExclusive > event.sourceStartDate) {
    start = event.sourceStartDate;
    end = new Date(Date.parse(`${event.sourceEndDateExclusive}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  } else {
    if (!event.timeZone || !Number.isFinite(event.date.getTime()) || !Number.isFinite(event.endDate.getTime())) return event;
    try {
      const formatter = new Intl.DateTimeFormat('en', { timeZone: event.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
      const civil = (date: Date) => { const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
      start = civil(event.date); end = civil(event.endDate);
    } catch { return event; }
    if (!validCivilDay(start) || !validCivilDay(end) || end < start) return event;
  }
  return { ...event, date: localCivilDay(start), endDate: localCivilDay(end, true) };
}
