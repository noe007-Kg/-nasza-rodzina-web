import type { CalendarEventData, CalendarOccurrence } from './app-shared';

export const CALENDAR_TIME_ZONE = 'Europe/Warsaw';
const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: CALENDAR_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function clockParts(date: Date) {
  return Object.fromEntries(clock.formatToParts(date).map(part => [part.type, part.value]));
}

export function warsawDayKey(date: Date): string {
  const parts = clockParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatWarsawTime(date: Date): string {
  const parts = clockParts(date);
  return `${parts.hour}:${parts.minute}`;
}

function warsawMidnight(year: number, month: number, day: number): Date {
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = clockParts(new Date(guess));
    const delta = target - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess);
}

/** Calendar day boundaries are independent of the device timezone and DST length. */
export function warsawCalendarDayRange(date: Date): { start: Date; end: Date; endExclusive: Date } {
  const parts = clockParts(date);
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const endExclusive = warsawMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return { start: warsawMidnight(year, month, day), end: new Date(endExclusive.getTime() - 1), endExclusive };
}

export function calendarOccurrencesOnDay(occurrences: readonly CalendarOccurrence[], date: Date): CalendarOccurrence[] {
  const range = warsawCalendarDayRange(date);
  const dayKey = warsawDayKey(date);
  const civilDay = (instant: Date) => `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
  return occurrences.filter(item => item.source.allDay
    // Existing all-day display occurrences (including Google DATE values) carry
    // civil dates in local fields, rather than clock instants to shift to Warsaw.
    ? civilDay(item.date) <= dayKey && civilDay(item.endDate) >= dayKey
    : item.date < range.endExclusive && item.endDate > range.start);
}

function minuteOfDay(date: Date) {
  const parts = clockParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute) + date.getSeconds() / 60;
}

export type CalendarTimelineBlock = {
  occurrence: CalendarOccurrence;
  startMinute: number;
  endMinute: number;
  top: number;
  height: number;
  column: number;
  columns: number;
};

/** Vertical placement uses civil Warsaw time. Overlaps change only horizontal columns. */
export function layoutCalendarTimeline(occurrences: readonly CalendarOccurrence[], date: Date, startMinute = 0, pixelsPerMinute = 2): CalendarTimelineBlock[] {
  const range = warsawCalendarDayRange(date);
  const rows = calendarOccurrencesOnDay(occurrences, date).filter(item => !item.source.allDay && item.endDate > item.date)
    .map(occurrence => {
      const start = occurrence.date <= range.start ? 0 : minuteOfDay(occurrence.date);
      const end = occurrence.endDate >= range.endExclusive ? 1440 : minuteOfDay(occurrence.endDate);
      return { occurrence, startMinute: start, endMinute: end, top: (start - startMinute) * pixelsPerMinute,
        height: (end - start) * pixelsPerMinute, column: 0, columns: 1 };
    }).filter(item => item.height > 0)
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.occurrence.key.localeCompare(b.occurrence.key));
  let group: CalendarTimelineBlock[] = [], laneEnds: number[] = [], groupEnd = -1;
  function finishGroup() { for (const item of group) item.columns = laneEnds.length; group = []; laneEnds = []; }
  for (const item of rows) {
    if (item.startMinute >= groupEnd) finishGroup();
    let lane = laneEnds.findIndex(end => end <= item.startMinute);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = item.endMinute;
    item.column = lane;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.endMinute);
  }
  finishGroup();
  return rows;
}

/** Day and week share one scale and range; short events never push later ones down. */
export function calendarTimelineRange(occurrences: readonly CalendarOccurrence[], days: readonly Date[]) {
  const rows = days.flatMap(day => layoutCalendarTimeline(occurrences, day));
  return {
    startMinute: Math.floor(Math.min(8 * 60, ...rows.map(item => item.startMinute)) / 60) * 60,
    endMinute: Math.ceil(Math.max(18 * 60, ...rows.map(item => item.endMinute)) / 60) * 60,
  };
}

export function timelineMinuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** Okruszek projections are already individual non-repeating occurrences.
 * Avoid re-expanding a whole school year for each view/modal render. All other
 * sources stay untouched, including Google masters and recurrence exceptions.
 */
export function calendarRangeDisplaySources(events: readonly CalendarEventData[], from: Date, to: Date, importantPanel = false): CalendarEventData[] {
  return events.filter(event => {
    if (event.source !== 'okruszek') return true;
    if (importantPanel && event.important !== true && !Object.values(event.recurrenceOverrides || {}).some(override => override.important === true)) return false;
    if (event.repeat !== 'none' || event.allDay || Object.keys(event.recurrenceOverrides || {}).length
      || !Number.isFinite(event.date.getTime()) || !Number.isFinite(event.endDate.getTime())) return true;
    return event.date <= to && event.endDate >= from;
  });
}
