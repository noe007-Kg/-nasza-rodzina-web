import { failCalendar } from './calendar-config.mjs';
import { googleRealDate, googleRecurrenceRule, googleWallDate } from './google-recurrence.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dateStamp(value) {
  if (typeof value !== 'string' || !DATE.test(value)) failCalendar('CALENDAR_HISTORY_RANGE_REQUIRED', 400, 'Wybierz datę początku i końca importowanej historii.');
  const [year, month, day] = value.split('-').map(Number), stamp = Date.UTC(year, month - 1, day);
  if (year < 1900 || year > 2200 || new Date(stamp).toISOString().slice(0, 10) !== value) failCalendar('CALENDAR_HISTORY_RANGE_REQUIRED', 400, 'Wybierz poprawne daty importowanej historii.');
  return stamp;
}
/** User DATE values mean complete civil days in Europe/Warsaw, including DST. */
export function googleHistoryRange(body) {
  const start = dateStamp(body?.from), lastDay = dateStamp(body?.to);
  if (start > lastDay) failCalendar('CALENDAR_HISTORY_RANGE_REQUIRED', 400, 'Koniec importu nie może poprzedzać jego początku.');
  const from = googleRealDate(new Date(start), 'Europe/Warsaw'), to = googleRealDate(new Date(lastDay + 86400000), 'Europe/Warsaw');
  if (!from || !to) failCalendar('CALENDAR_HISTORY_RANGE_REQUIRED', 400, 'Nie udało się ustalić wybranego zakresu czasu.');
  return { from: from.toISOString(), to: to.toISOString() };
}
export const sameGoogleHistoryRange = (left, right) => !!left && !!right && left.from === right.from && left.to === right.to;

/** Filtering happens after a complete unbounded provider scan: its syncToken
 * is valid for incremental reads, without Google's forbidden timeMin/timeMax.
 * Only approved history and, subsequently, new future events are copied. */
export function googleHistoryEventInRange(event, window, { includeFuture = false } = {}) {
  if (!window) return false;
  const periods = [[Date.parse(window.from), Date.parse(window.to)]];
  if (includeFuture && window.futureFrom) periods.push([Date.parse(window.futureFrom), Infinity]);
  if (periods.some(([from, to]) => !Number.isFinite(from) || !(to === Infinity || Number.isFinite(to)) || to <= from)) failCalendar('CALENDAR_HISTORY_RANGE_REQUIRED', 409, 'Zatwierdź ponownie poprawny zakres importu.');
  if (event.cancelled) {
    const original = Date.parse(event.externalOriginalStart || '');
    return Number.isFinite(original) && periods.some(([from, to]) => original >= from && original < to);
  }
  if (!event.sourceRecurrence?.length) return periods.some(([from, to]) => event.start < to && event.end + (event.allDay ? 1 : 0) > from);
  try {
    const zone = event.timeZone || 'UTC', rule = googleRecurrenceRule(new Date(event.start), event.sourceRecurrence, zone);
    const duration = googleWallDate(new Date(event.end + (event.allDay ? 1 : 0)), zone).getTime() - googleWallDate(new Date(event.start), zone).getTime();
    for (const [from, to] of periods) {
      let next = rule.after(new Date(googleWallDate(new Date(from), zone).getTime() - Math.max(duration, 0)), true);
      // At most a few candidates are needed to skip a nonexistent DST hour.
      for (let attempts = 0; next && attempts < 4; attempts++) {
        const real = googleRealDate(next, zone), end = googleRealDate(new Date(next.getTime() + duration), zone);
        if (real && end && real.getTime() < to && end.getTime() > from) return true;
        if (real && real.getTime() >= to) break;
        next = rule.after(next, false);
      }
    }
    return false;
  } catch { failCalendar('CALENDAR_PROVIDER_DATA', 502, 'Nie udało się bezpiecznie odczytać powtarzalności wydarzenia Google.'); }
}
