import type { CalendarEventData, CalendarOccurrence } from '../app-shared';
import { generateOccurrences } from '../calendar-utils';
import { googleWallDate as wallDate, googleRealDate as realDate, googleRecurrenceRule } from '../../server/google-recurrence.mjs';

const sourceKey = (event: CalendarEventData, id = event.externalEventId) => JSON.stringify([event.sourceOwnerUid, event.sourceConnectionId, event.externalCalendarId, id]);
const civilDay = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
function withinApprovedWindow(start: number, end: number, window: CalendarEventData['sourceImportWindow']): boolean {
  if (!window) return true; // Existing imports preserve their accepted history.
  const from = Date.parse(window.from), to = Date.parse(window.to), future = window.futureFrom ? Date.parse(window.futureFrom) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || window.futureFrom && !Number.isFinite(future)) return false;
  return start < to && end > from || Number.isFinite(future) && end > future;
}

/** Google masters keep their exact RFC5545 rules. Infinite series are expanded
 * only for the requested view, never flattened into an arbitrary history window. */
export function generateGoogleOccurrences(event: CalendarEventData, from: Date, to: Date): CalendarOccurrence[] {
  if (!event.sourceRecurrence?.length || event.source !== 'google') return generateOccurrences(event, from, to);
  if (event.cancelled || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) return [];
  const zone = event.timeZone || 'UTC', civil = wallDate(event.date, zone);
  const rule = googleRecurrenceRule(event.date, event.sourceRecurrence, zone);
  const margin = Math.max(event.endDate.getTime() - event.date.getTime(), 86400000);
  const dates = rule.between(new Date(wallDate(from, zone).getTime() - margin), new Date(wallDate(to, zone).getTime() + 86400000), true, (_date, index) => index < 5000);
  const wallDuration = wallDate(new Date(event.endDate.getTime() + (event.allDay ? 1 : 0)), zone).getTime() - civil.getTime();
  const occurrences: CalendarOccurrence[] = [];
  for (const [index, occurrenceCivil] of dates.entries()) {
    const originalDate = realDate(occurrenceCivil, zone), endFloating = new Date(occurrenceCivil.getTime() + wallDuration), realEnd = realDate(endFloating, zone);
    if (!originalDate || !realEnd) continue;
    if (!withinApprovedWindow(originalDate.getTime(), realEnd.getTime(), event.sourceImportWindow)) continue;
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
    const master = event.externalSeriesId ? masters.get(sourceKey(event, event.externalSeriesId)) : null;
    const occurrences = generateGoogleOccurrences(event, from, to).filter(occurrence => !master?.sourceImportWindow || withinApprovedWindow(event.date.getTime(), event.endDate.getTime() + (event.allDay ? 1 : 0), master.sourceImportWindow));
    if (!event.sourceRecurrence?.length) return occurrences;
    const excluded = exceptions.get(sourceKey(event));
    return excluded ? occurrences.filter(occurrence => !excluded.has(event.allDay ? civilDay(wallDate(occurrence.originalDate!, event.timeZone || 'UTC')) : occurrence.originalDate!.toISOString())) : occurrences;
  }).sort((a, b) => a.date.getTime() - b.date.getTime());
}
