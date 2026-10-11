import * as rrule from 'rrule';
import type { CalendarEventData, CalendarOccurrence } from '../app-shared';
import { generateOccurrences } from '../calendar-utils';

// Node loads rrule's CommonJS entry while Vite uses its ESM entry.
const parseRRule = rrule.rrulestr || (rrule as unknown as { default: typeof rrule }).default.rrulestr;

const sourceKey = (event: CalendarEventData, id = event.externalEventId) => JSON.stringify([event.sourceOwnerUid, event.sourceConnectionId, event.externalCalendarId, id]);
const stamp = (date: Date) => `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}`;
const civilDay = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

/** All rule arithmetic uses UTC fields as a floating wall clock. rrule's TZID
 * conversion otherwise depends on the device zone and can shift Warsaw times
 * by two hours on a Warsaw phone even though it works on a UTC server. */
function wallDate(date: Date, zone: string): Date {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second), date.getUTCMilliseconds()));
}
function realDate(wall: Date, zone: string): Date | null {
  const target = wall.getTime(); let guess = target;
  for (let attempt = 0; attempt < 5; attempt++) {
    const delta = target - wallDate(new Date(guess), zone).getTime();
    if (!delta) return new Date(guess);
    guess += delta;
  }
  // A skipped local time is not a real occurrence; never invent a new hour.
  return null;
}
function floatingRule(line: string, zone: string): string {
  if (line.startsWith('RRULE:')) return line.replace(/UNTIL=(\d{8}T\d{6})Z(?=;|$)/, (_match, value: string) => `UNTIL=${stamp(wallDate(parseRuleDate(value), zone))}`);
  const separator = line.indexOf(':'), head = line.slice(0, separator), values = line.slice(separator + 1).split(',');
  const sourceZone = /(?:^|;)TZID=([^;]+)/.exec(head)?.[1] || zone;
  const next = values.map(value => {
    if (/^\d{8}$/.test(value)) return value;
    const utc = value.endsWith('Z'), floating = parseRuleDate(utc ? value.slice(0, -1) : value);
    if (!utc && sourceZone === zone) return stamp(floating);
    const real = utc ? floating : realDate(floating, sourceZone);
    if (!real) throw new RangeError('Nieprawidłowy termin wyjątku serii.');
    return stamp(wallDate(real, zone));
  });
  return `${head.replace(/;TZID=[^;]+/, '')}:${next.join(',')}`;
}
function parseRuleDate(value: string): Date {
  if (!/^\d{8}T\d{6}$/.test(value)) throw new RangeError('Nieprawidłowy termin serii.');
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), Number(value.slice(9, 11)), Number(value.slice(11, 13)), Number(value.slice(13, 15))));
}

/** Google masters keep their exact RFC5545 rules. Infinite series are expanded
 * only for the requested view, never flattened into an arbitrary history window. */
export function generateGoogleOccurrences(event: CalendarEventData, from: Date, to: Date): CalendarOccurrence[] {
  if (!event.sourceRecurrence?.length || event.source !== 'google') return generateOccurrences(event, from, to);
  if (event.cancelled || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) return [];
  const zone = event.timeZone || 'UTC', civil = wallDate(event.date, zone);
  const rule = parseRRule(`DTSTART:${stamp(civil)}\n${event.sourceRecurrence.map(line => floatingRule(line, zone)).join('\n')}`, { forceset: true });
  const margin = Math.max(event.endDate.getTime() - event.date.getTime(), 86400000);
  const dates = rule.between(new Date(wallDate(from, zone).getTime() - margin), new Date(wallDate(to, zone).getTime() + 86400000), true, (_date, index) => index < 5000);
  const wallDuration = wallDate(new Date(event.endDate.getTime() + (event.allDay ? 1 : 0)), zone).getTime() - civil.getTime();
  const occurrences: CalendarOccurrence[] = [];
  for (const [index, occurrenceCivil] of dates.entries()) {
    const originalDate = realDate(occurrenceCivil, zone), endFloating = new Date(occurrenceCivil.getTime() + wallDuration), realEnd = realDate(endFloating, zone);
    if (!originalDate || !realEnd) continue;
    const date = event.allDay ? new Date(occurrenceCivil.getUTCFullYear(), occurrenceCivil.getUTCMonth(), occurrenceCivil.getUTCDate()) : originalDate;
    const displayEnd = event.allDay ? new Date(endFloating.getUTCFullYear(), endFloating.getUTCMonth(), endFloating.getUTCDate(), 0, 0, 0, -1) : realEnd;
    if (date <= to && displayEnd >= from) occurrences.push({ key: `${event.id}__google_${originalDate.toISOString()}`, source: event, date, endDate: displayEnd, originalDate, originalIndex: index });
  }
  return occurrences;
}

/** Exceptions suppress their original master occurrence; moved occurrences
 * appear once at their real new time. Old flattened series rows remain stored,
 * but are superseded only when that same source's master has been imported. */
export function generateCalendarOccurrencesFromSources(events: readonly CalendarEventData[], from: Date, to: Date): CalendarOccurrence[] {
  const masters = new Map(events.filter(event => event.source === 'google' && event.sourceRecurrence?.length).map(event => [sourceKey(event), event]));
  const exceptions = new Map<string, Set<string>>();
  for (const event of events) if (event.source === 'google' && event.externalSeriesId && event.externalOriginalStart) {
    const key = sourceKey(event, event.externalSeriesId), master = masters.get(key);
    if (!master) continue;
    const value = master.allDay ? event.externalOriginalStart.slice(0, 10) : new Date(event.externalOriginalStart).toISOString();
    const values = exceptions.get(key) || new Set<string>(); values.add(value); exceptions.set(key, values);
  }
  return events.flatMap(event => {
    if (event.sourceExceptionTombstone) return [];
    if (event.source === 'google' && event.externalSeriesId && masters.has(sourceKey(event, event.externalSeriesId)) && !event.externalOriginalStart) return [];
    const occurrences = generateGoogleOccurrences(event, from, to);
    if (!event.sourceRecurrence?.length) return occurrences;
    const excluded = exceptions.get(sourceKey(event));
    return excluded ? occurrences.filter(occurrence => !excluded.has(event.allDay ? civilDay(wallDate(occurrence.originalDate!, event.timeZone || 'UTC')) : occurrence.originalDate!.toISOString())) : occurrences;
  }).sort((a, b) => a.date.getTime() - b.date.getTime());
}
