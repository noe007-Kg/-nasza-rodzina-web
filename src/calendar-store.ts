import { collection, doc, getDoc, getDocs, onSnapshot, query, Timestamp, where, writeBatch, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';
import { isPersonKey, type CalendarEventData, type Member } from './app-shared';
import { isRepeatType, type RecurrenceRule } from './calendar-utils';
import type { CalendarChangePlan } from './calendar-series';
import { readCalendarSourceMetadata } from './calendar-source-metadata';
import type { FamilyMemberProfile } from './family-members';
import { calendarEventScopeStamp, householdFamilyId, HOUSEHOLD_NOT_PREPARED, requireHouseholdFamilyId } from './household-scope';

function asDate(value: unknown): Date | null {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

/** Only household-scoped shared records and owner-only private records reach this parser. */
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
      overrides[key] = { date: start, endDate: end, ...(typeof item.title === 'string' ? { title: item.title } : {}), ...(isPersonKey(item.person) ? { person: item.person } : {}), ...(typeof item.description === 'string' ? { description: item.description } : {}), ...(typeof item.location === 'string' ? { location: item.location } : {}), ...(typeof item.allDay === 'boolean' ? { allDay: item.allDay } : {}), ...(typeof item.important === 'boolean' ? { important: item.important } : {}) };
    }
  }
  return {
    id, ...(typeof data.familyId === 'string' ? { familyId: data.familyId } : {}),
    ...(data.visibility === 'family' || data.visibility === 'private' ? { visibility: data.visibility } : {}),
    title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Wydarzenie',
    person: isPersonKey(data.person) ? data.person : 'family', date,
    endDate: asDate(data.endDate) || new Date(date.getTime() + 3600000), allDay: data.allDay === true,
    description: typeof data.description === 'string' ? data.description : '',
    important: data.important === true,
    location: typeof data.location === 'string' ? data.location : '', createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    repeat: isRepeatType(data.repeat) ? data.repeat : 'none', repeatUntil: asDate(data.repeatUntil),
    ...(recurrence ? { recurrence } : {}), repeatCount: Number.isInteger(data.repeatCount) && data.repeatCount > 0 ? data.repeatCount : null,
    repeatBefore: asDate(data.repeatBefore), recurrenceExceptions: Array.isArray(data.recurrenceExceptions) ? data.recurrenceExceptions.filter((key: unknown) => typeof key === 'string' && Number.isFinite(new Date(key).getTime())) : [], recurrenceOverrides: overrides,
    private: privateRecord, ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : data.createdBy,
    seriesId: typeof data.seriesId === 'string' ? data.seriesId : id,
    ...(typeof data.timeZone === 'string' ? { timeZone: data.timeZone } : {}),
    ...(data.eventKind === 'lesson' || data.eventKind === 'break' ? { eventKind: data.eventKind } : {}),
    ...(data.timingConfidence === 'confirmed' || data.timingConfidence === 'estimated' ? { timingConfidence: data.timingConfidence } : {}),
    ...readCalendarSourceMetadata(data),
  };
}

function mergeRows(publicRows: CalendarEventData[], privateRows: CalendarEventData[]): CalendarEventData[] {
  return [...new Map([...publicRows, ...privateRows].map((row) => [row.id, row])).values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

type CalendarReadSource = 'calendar.shared' | 'calendar.private';
export function subscribeCalendar(uid: string, member: Member | null, onChange: (events: CalendarEventData[], source: CalendarReadSource) => void, onError?: (error: Error, source: CalendarReadSource) => void): () => void {
  const familyId = householdFamilyId(member);
  if (!familyId) { onChange([], 'calendar.shared'); onError?.(new Error(HOUSEHOLD_NOT_PREPARED), 'calendar.shared'); return () => {}; }
  let publicRows: CalendarEventData[] = [], privateRows: CalendarEventData[] = [];
  const stopPublic = onSnapshot(query(collection(db, 'calendarEvents'), where('familyId', '==', familyId), where('private', '==', false), where('visibility', '==', 'family')), (snapshot) => {
    publicRows = snapshot.docs.map((item) => readCalendarEvent(item.id, item.data())).filter((item): item is CalendarEventData => !!item);
    onChange(mergeRows(publicRows, privateRows), 'calendar.shared');
  }, (error) => { publicRows = []; onChange(mergeRows(publicRows, privateRows), 'calendar.shared'); onError?.(error, 'calendar.shared'); });
  const stopPrivate = onSnapshot(query(collection(db, 'privateCalendarEvents'), where('ownerUid', '==', uid), where('familyId', '==', familyId)), (snapshot) => {
    privateRows = snapshot.docs.map((item) => readCalendarEvent(item.id, item.data(), true)).filter((item): item is CalendarEventData => !!item);
    onChange(mergeRows(publicRows, privateRows), 'calendar.private');
  }, (error) => { privateRows = []; onChange(mergeRows(publicRows, privateRows), 'calendar.private'); onError?.(error, 'calendar.private'); });
  return () => { stopPublic(); stopPrivate(); };
}

export async function fetchCalendarEvents(uid: string, member: Member | null): Promise<CalendarEventData[]> {
  const familyId = requireHouseholdFamilyId(member);
  const [publicSnapshot, privateSnapshot] = await Promise.all([getDocs(query(collection(db, 'calendarEvents'), where('familyId', '==', familyId), where('private', '==', false), where('visibility', '==', 'family'))), getDocs(query(collection(db, 'privateCalendarEvents'), where('ownerUid', '==', uid), where('familyId', '==', familyId)))]);
  return mergeRows(publicSnapshot.docs.map((item) => readCalendarEvent(item.id, item.data())).filter((item): item is CalendarEventData => !!item), privateSnapshot.docs.map((item) => readCalendarEvent(item.id, item.data(), true)).filter((item): item is CalendarEventData => !!item));
}

export function calendarDocument(event: CalendarEventData): DocumentData {
  const familyId = requireHouseholdFamilyId(event);
  if (!event.ownerProfileId) throw new Error('Wydarzenie wymaga przypisanego profilu rodziny.');
  const overrides = Object.fromEntries(Object.entries(event.recurrenceOverrides || {}).map(([key, item]) => [key, { ...item, date: Timestamp.fromDate(item.date), endDate: Timestamp.fromDate(item.endDate) }]));
  return { familyId, ownerProfileId: event.ownerProfileId, visibility: event.private ? 'private' : 'family', title: event.title, person: event.person, date: Timestamp.fromDate(event.date), endDate: Timestamp.fromDate(event.endDate), allDay: event.allDay, description: event.description, important: event.important === true, location: event.location || '', createdBy: event.createdBy, repeat: event.repeat, repeatUntil: event.repeatUntil ? Timestamp.fromDate(event.repeatUntil) : null, recurrence: event.recurrence || null, repeatCount: event.repeatCount || null, repeatBefore: event.repeatBefore ? Timestamp.fromDate(event.repeatBefore) : null, recurrenceExceptions: event.recurrenceExceptions || [], recurrenceOverrides: overrides, private: event.private === true, ownerUid: event.ownerUid || event.createdBy, seriesId: event.seriesId || event.id, timeZone: event.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/** One atomic batch preserves unknown legacy metadata and moves privacy boundaries safely. */
export async function commitCalendarPlan(plan: CalendarChangePlan, previous: CalendarEventData[], uid: string, member: Member | null, profiles: readonly FamilyMemberProfile[]): Promise<void> {
  const familyId = requireHouseholdFamilyId(member);
  if (plan.upserts.length * 2 + plan.deletes.length > 450) throw new Error('Ta seria ma zbyt wiele części. Zmień mniejszy zakres.');
  const originals = new Map(previous.map((item) => [item.id, item]));
  for (const item of [...plan.upserts, ...plan.deletes]) {
    const original = originals.get(item.id);
    if (original?.familyId && original.familyId !== familyId || item.familyId && item.familyId !== familyId) throw new Error('Wydarzenie należy do innego gospodarstwa.');
    if (original?.private && original.ownerUid !== uid) throw new Error('Prywatne wydarzenie należy do innej osoby.');
  }
  const snapshots = await Promise.all(plan.upserts.map(async (item) => {
    const old = originals.get(item.id);
    return old && !!old.private !== !!item.private ? getDoc(doc(db, old.private ? 'privateCalendarEvents' : 'calendarEvents', old.id)) : null;
  }));
  const batch = writeBatch(db);
  for (const [index, item] of plan.upserts.entries()) {
    const original = originals.get(item.id), collectionName = item.private ? 'privateCalendarEvents' : 'calendarEvents';
    const scoped = { ...item, ...calendarEventScopeStamp(uid, member, profiles, item.person, item.private === true) };
    batch.set(doc(db, collectionName, item.id), { ...(snapshots[index]?.data() || {}), ...calendarDocument(scoped), ...(original ? {} : { createdAt: Timestamp.now() }), updatedBy: uid, updatedAt: Timestamp.now() }, { merge: true });
    if (original && !!original.private !== !!item.private) batch.delete(doc(db, original.private ? 'privateCalendarEvents' : 'calendarEvents', item.id));
  }
  for (const item of plan.deletes) batch.delete(doc(db, item.private ? 'privateCalendarEvents' : 'calendarEvents', item.id));
  await batch.commit();
}
