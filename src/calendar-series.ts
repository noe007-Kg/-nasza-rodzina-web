import type { CalendarEventData } from './app-shared';
import { addDays, formatDateInput, occurrenceIndex, type RecurringEvent } from './calendar-utils';

export type SeriesScope = 'one' | 'future' | 'all';
export type CalendarChangePlan = { upserts: CalendarEventData[]; deletes: CalendarEventData[] };
export type EventPatch = Omit<CalendarEventData, 'id' | 'createdBy' | 'seriesId'>;

function dayDifference(a: Date, b: Date): number {
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
}
function shiftDate(date: Date, original: Date, updated: Date): Date {
  const result = addDays(date, dayDifference(updated, original));
  result.setHours(updated.getHours(), updated.getMinutes(), updated.getSeconds(), updated.getMilliseconds());
  return result;
}
function group(events: CalendarEventData[], event: CalendarEventData): CalendarEventData[] {
  const id = event.seriesId || event.id;
  return events.filter((item) => (item.seriesId || item.id) === id);
}
function before<T>(map: Record<string, T> | undefined, date: Date): Record<string, T> {
  return Object.fromEntries(Object.entries(map || {}).filter(([key]) => new Date(key) < date));
}

/** Returns a plan committed in one Firestore batch; it never mutates the loaded records. */
export function planSeriesUpdate(events: CalendarEventData[], event: CalendarEventData, original: Date, scope: SeriesScope, patch: EventPatch): CalendarChangePlan {
  if (event.repeat === 'none') return { upserts: [{ ...event, ...patch }], deletes: [] };
  const index = occurrenceIndex(event as RecurringEvent, original);
  if (index < 0) throw new Error('Nie znaleziono wystąpienia w tej serii. Odśwież kalendarz.');
  if (scope === 'one') {
    if (!!patch.private !== !!event.private) {
      // A private override must not be stored inside a public series document.
      const detached: CalendarEventData = { ...event, ...patch, id: `${event.id}__single_${original.getTime()}`, repeat: 'none', repeatUntil: null, repeatCount: null, recurrenceExceptions: [], recurrenceOverrides: {}, repeatBefore: null };
      detached.seriesId = detached.id;
      return { upserts: [{ ...event, recurrenceExceptions: [...new Set([...(event.recurrenceExceptions || []), original.toISOString()])], recurrenceOverrides: Object.fromEntries(Object.entries(event.recurrenceOverrides || {}).filter(([key]) => key !== original.toISOString())) }, detached], deletes: [] };
    }
    return { upserts: [{ ...event, recurrenceOverrides: { ...event.recurrenceOverrides, [original.toISOString()]: { title: patch.title, person: patch.person, date: patch.date, endDate: patch.endDate, allDay: patch.allDay, description: patch.description, location: patch.location || '' } } }], deletes: [] };
  }
  const related = group(events, event).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (scope === 'future') {
    const originalOverride = event.recurrenceOverrides?.[original.toISOString()];
    const remaining = event.repeatCount && patch.repeatCount === event.repeatCount ? Math.max(1, event.repeatCount - index) : patch.repeatCount;
    const future: CalendarEventData = { ...event, ...patch, id: `${event.seriesId || event.id}__from_${original.getTime()}`, seriesId: event.seriesId || event.id, repeatCount: remaining, recurrenceExceptions: [], recurrenceOverrides: {}, repeatBefore: null };
    const past: CalendarEventData = { ...event, repeatBefore: original, recurrenceExceptions: (event.recurrenceExceptions || []).filter((key) => new Date(key) < original), recurrenceOverrides: before(event.recurrenceOverrides, original) };
    if (originalOverride) delete past.recurrenceOverrides?.[original.toISOString()];
    return { upserts: [past, future], deletes: related.filter((item) => item.id !== event.id && item.date >= original && item.id !== future.id) };
  }
  const first = related[0] || event;
  const globalCount = first.repeatCount || null;
  const recurrenceChanged = patch.repeat !== event.repeat || JSON.stringify(patch.recurrence || null) !== JSON.stringify(event.recurrence || null)
    || (patch.repeatCount || null) !== globalCount || (patch.repeatUntil?.getTime() || null) !== (event.repeatUntil?.getTime() || null);
  if (recurrenceChanged && related.length > 1) {
    const date = shiftDate(first.date, original, patch.date), endDate = addDays(date, dayDifference(patch.endDate, patch.date));
    endDate.setHours(patch.endDate.getHours(), patch.endDate.getMinutes(), patch.endDate.getSeconds(), patch.endDate.getMilliseconds());
    return { upserts: [{ ...first, ...patch, date, endDate, repeatBefore: null, seriesId: first.seriesId || first.id,
      recurrenceExceptions: [...new Set(related.flatMap((item) => item.recurrenceExceptions || []).map((key) => shiftDate(new Date(key), original, patch.date).toISOString()))],
      recurrenceOverrides: Object.fromEntries(related.flatMap((item) => Object.entries(item.recurrenceOverrides || {})).map(([key, override]) => [shiftDate(new Date(key), original, patch.date).toISOString(), override])) }], deletes: related.filter((item) => item.id !== first.id) };
  }
  // Apply to every segment of a previously split series. Existing single-occurrence
  // exceptions remain exceptions, and segment boundaries preserve earlier history.
  return { upserts: related.map((item) => {
    const date = shiftDate(item.date, original, patch.date);
    const daySpan = dayDifference(patch.endDate, patch.date);
    const endDate = addDays(date, daySpan);
    endDate.setHours(patch.endDate.getHours(), patch.endDate.getMinutes(), patch.endDate.getSeconds(), patch.endDate.getMilliseconds());
    const shiftedExceptions = (item.recurrenceExceptions || []).map((key) => shiftDate(new Date(key), original, patch.date).toISOString());
    const shiftedOverrides = Object.fromEntries(Object.entries(item.recurrenceOverrides || {}).map(([key, override]) => [shiftDate(new Date(key), original, patch.date).toISOString(), override]));
    return { ...item, ...patch, date, endDate, repeatBefore: item.repeatBefore ? shiftDate(item.repeatBefore, original, patch.date) : null, repeatCount: related.length === 1 ? patch.repeatCount : item.repeatCount, recurrenceExceptions: shiftedExceptions, recurrenceOverrides: shiftedOverrides, seriesId: item.seriesId || item.id };
  }), deletes: [] };
}

export function planSeriesDelete(events: CalendarEventData[], event: CalendarEventData, original: Date, scope: SeriesScope): CalendarChangePlan {
  if (event.repeat === 'none' || scope === 'all') return { upserts: [], deletes: event.repeat === 'none' ? [event] : group(events, event) };
  if (occurrenceIndex(event as RecurringEvent, original) < 0) throw new Error('Nie znaleziono wystąpienia w tej serii.');
  if (scope === 'one') return { upserts: [{ ...event, recurrenceExceptions: [...new Set([...(event.recurrenceExceptions || []), original.toISOString()])], recurrenceOverrides: Object.fromEntries(Object.entries(event.recurrenceOverrides || {}).filter(([key]) => key !== original.toISOString())) }], deletes: [] };
  return { upserts: [{ ...event, repeatBefore: original, recurrenceExceptions: (event.recurrenceExceptions || []).filter((key) => new Date(key) < original), recurrenceOverrides: before(event.recurrenceOverrides, original) }], deletes: group(events, event).filter((item) => item.id !== event.id && item.date >= original) };
}

export function seriesScopeLabel(scope: SeriesScope, deleting = false): string {
  if (scope === 'one') return deleting ? 'Tylko to wydarzenie' : 'Tylko tego wydarzenia';
  if (scope === 'future') return deleting ? 'To i kolejne' : 'Tego i kolejnych';
  return deleting ? 'Cała seria' : 'Wszystkich wydarzeń';
}

export function occurrenceOriginalKey(date: Date): string { return formatDateInput(date); }
