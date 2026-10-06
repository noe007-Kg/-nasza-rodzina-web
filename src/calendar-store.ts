import { collection, doc, getDoc, getDocs, onSnapshot, query, Timestamp, where, writeBatch, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';
import { isPersonKey, type CalendarEventData } from './app-shared';
import { isRepeatType, type RecurrenceRule } from './calendar-utils';
import type { CalendarChangePlan } from './calendar-series';

function asDate(value: unknown): Date | null {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

/** Old public records are read unchanged. Private records have a separate owner-only collection. */
export function readCalendarEvent(id: string, data: DocumentData, privateRecord = false): CalendarEventData | null {
  const date = asDate(data.date);
  if (!date) return null;
  const rawRule = data.recurrence;
  const recurrence: RecurrenceRule | undefined = rawRule && ['day', 'week', 'month', 'year'].includes(rawRule.unit) && Number.isInteger(rawRule.interval) && rawRule.interval > 0
    ? { unit: rawRule.unit, interval: Math.min(rawRule.interval, 1000), ...(Array.isArray(rawRule.weekdays) ? { weekdays: rawRule.weekdays.filter((day: unknown) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6) } : {}) } : undefined;
  const overrides: NonNullable<CalendarEventData['recurrenceOverrides']> = {};
  if (data.recurrenceOverrides && typeof data.recurrenceOverrides === 'object') {
    for (const [key, raw] of Object.entries(data.recurrenceOverrides)) {
      if (!raw || typeof raw !== 'object' || !Number.isFinite(new Date(key).getTime())) continue;
      const item = raw as Record<string, unknown>, start = asDate(item.date), end = asDate(item.endDate);
      if (!start || !end || end < start) continue;
      overrides[key] = { date: start, endDate: end, ...(typeof item.title === 'string' ? { title: item.title } : {}), ...(isPersonKey(item.person) ? { person: item.person } : {}), ...(typeof item.description === 'string' ? { description: item.description } : {}), ...(typeof item.location === 'string' ? { location: item.location } : {}), ...(typeof item.allDay === 'boolean' ? { allDay: item.allDay } : {}) };
    }
  }
  return {
    id, title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Wydarzenie',
    person: isPersonKey(data.person) ? data.person : 'family', date,
    endDate: asDate(data.endDate) || new Date(date.getTime() + 3600000), allDay: data.allDay === true,
    description: typeof data.description === 'string' ? data.description : '',
    location: typeof data.location === 'string' ? data.location : '', createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    repeat: isRepeatType(data.repeat) ? data.repeat : 'none', repeatUntil: asDate(data.repeatUntil),
    ...(recurrence ? { recurrence } : {}), repeatCount: Number.isInteger(data.repeatCount) && data.repeatCount > 0 ? data.repeatCount : null,
    repeatBefore: asDate(data.repeatBefore), recurrenceExceptions: Array.isArray(data.recurrenceExceptions) ? data.recurrenceExceptions.filter((key: unknown) => typeof key === 'string' && Number.isFinite(new Date(key).getTime())) : [], recurrenceOverrides: overrides,
    private: privateRecord, ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : data.createdBy,
    seriesId: typeof data.seriesId === 'string' ? data.seriesId : id,
    ...(typeof data.timeZone === 'string' ? { timeZone: data.timeZone } : {}),
  };
}

function mergeRows(publicRows: CalendarEventData[], privateRows: CalendarEventData[]): CalendarEventData[] {
  return [...new Map([...publicRows, ...privateRows].map((row) => [row.id, row])).values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function subscribeCalendar(uid: string, onChange: (events: CalendarEventData[]) => void, onError?: (error: Error) => void): () => void {
  let publicRows: CalendarEventData[] = [], privateRows: CalendarEventData[] = [];
  const stopPublic = onSnapshot(collection(db, 'calendarEvents'), (snapshot) => {
    publicRows = snapshot.docs.map((item) => readCalendarEvent(item.id, item.data())).filter((item): item is CalendarEventData => !!item);
    onChange(mergeRows(publicRows, privateRows));
  }, (error) => onError?.(error));
  const stopPrivate = onSnapshot(query(collection(db, 'privateCalendarEvents'), where('ownerUid', '==', uid)), (snapshot) => {
    privateRows = snapshot.docs.map((item) => readCalendarEvent(item.id, item.data(), true)).filter((item): item is CalendarEventData => !!item);
    onChange(mergeRows(publicRows, privateRows));
  }, (error) => onError?.(error));
  return () => { stopPublic(); stopPrivate(); };
}

export async function fetchCalendarEvents(uid: string): Promise<CalendarEventData[]> {
  const [publicSnapshot, privateSnapshot] = await Promise.all([getDocs(collection(db, 'calendarEvents')), getDocs(query(collection(db, 'privateCalendarEvents'), where('ownerUid', '==', uid)))]);
  return mergeRows(publicSnapshot.docs.map((item) => readCalendarEvent(item.id, item.data())).filter((item): item is CalendarEventData => !!item), privateSnapshot.docs.map((item) => readCalendarEvent(item.id, item.data(), true)).filter((item): item is CalendarEventData => !!item));
}

export function calendarDocument(event: CalendarEventData): DocumentData {
  const overrides = Object.fromEntries(Object.entries(event.recurrenceOverrides || {}).map(([key, item]) => [key, { ...item, date: Timestamp.fromDate(item.date), endDate: Timestamp.fromDate(item.endDate) }]));
  return { title: event.title, person: event.person, date: Timestamp.fromDate(event.date), endDate: Timestamp.fromDate(event.endDate), allDay: event.allDay, description: event.description, location: event.location || '', createdBy: event.createdBy, repeat: event.repeat, repeatUntil: event.repeatUntil ? Timestamp.fromDate(event.repeatUntil) : null, recurrence: event.recurrence || null, repeatCount: event.repeatCount || null, repeatBefore: event.repeatBefore ? Timestamp.fromDate(event.repeatBefore) : null, recurrenceExceptions: event.recurrenceExceptions || [], recurrenceOverrides: overrides, private: event.private === true, ownerUid: event.ownerUid || event.createdBy, seriesId: event.seriesId || event.id, timeZone: event.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/** One atomic batch preserves unknown legacy metadata and moves privacy boundaries safely. */
export async function commitCalendarPlan(plan: CalendarChangePlan, previous: CalendarEventData[], uid: string): Promise<void> {
  if (plan.upserts.length * 2 + plan.deletes.length > 450) throw new Error('Ta seria ma zbyt wiele części. Zmień mniejszy zakres.');
  const originals = new Map(previous.map((item) => [item.id, item]));
  const snapshots = await Promise.all(plan.upserts.map(async (item) => {
    const old = originals.get(item.id);
    return old && !!old.private !== !!item.private ? getDoc(doc(db, old.private ? 'privateCalendarEvents' : 'calendarEvents', old.id)) : null;
  }));
  const batch = writeBatch(db);
  for (const [index, item] of plan.upserts.entries()) {
    const original = originals.get(item.id), collectionName = item.private ? 'privateCalendarEvents' : 'calendarEvents';
    batch.set(doc(db, collectionName, item.id), { ...(snapshots[index]?.data() || {}), ...calendarDocument(item), ...(original ? {} : { createdAt: Timestamp.now() }), updatedBy: uid, updatedAt: Timestamp.now() }, { merge: true });
    if (original && !!original.private !== !!item.private) batch.delete(doc(db, original.private ? 'privateCalendarEvents' : 'calendarEvents', item.id));
  }
  for (const item of plan.deletes) batch.delete(doc(db, item.private ? 'privateCalendarEvents' : 'calendarEvents', item.id));
  await batch.commit();
}
