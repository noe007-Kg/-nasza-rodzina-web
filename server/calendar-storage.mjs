import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { activeCalendarMember, failCalendar } from './calendar-config.mjs';
import { encryptCalendarSecrets } from './calendar-secrets.mjs';

export const CALENDAR_LEASE_MS = 120000;
export const CALENDAR_SYNC_COOLDOWN_MS = 60000;
export const timestampMillis = value => typeof value?.toMillis === 'function' ? value.toMillis() : value instanceof Date ? value.getTime() : typeof value === 'number' ? value : NaN;
export const connectionRef = (context, id) => {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Nieprawidłowe połączenie kalendarza.');
  return context.db.collection('_calendarConnections').doc(id);
};
export function assertCalendarActor(context, actor) {
  if (!activeCalendarMember(actor)) failCalendar('CALENDAR_MEMBER_REQUIRED', 403, 'Konto wymaga aktywnego dostępu do Naszej Rodziny.');
}
export async function assertCalendarSelection(transaction, context, actor, selection) {
  assertCalendarActor(context, actor);
  if (selection.ownerProfileId === 'family') return 'family';
  const target = await transaction.get(context.db.collection('members').doc(selection.ownerProfileId));
  if (!target.exists || target.data().active !== true || target.data().archived === true || target.data().disabled === true) failCalendar('CALENDAR_PROFILE_UNAVAILABLE', 403, 'Wybrany profil nie jest aktywnym członkiem rodziny.');
  if (actor.role !== 'parent' && selection.ownerProfileId !== context.uid) failCalendar('CALENDAR_PROFILE_FORBIDDEN', 403, 'Możesz przypisać kalendarz do siebie albo całej rodziny.');
  const member = target.data();
  const person = Object.hasOwn(member, 'personKey') ? member.personKey : member.name;
  if (typeof person !== 'string' || !(/^[a-zA-Z\p{L}][a-zA-Z\p{L} ]{0,79}$/u.test(person) || /^member-[a-f0-9]{24}$/.test(person))) {
    failCalendar('CALENDAR_PROFILE_UNAVAILABLE', 409, 'Profil wymaga weryfikacji tożsamości przed przypisaniem kalendarza.');
  }
  // A legacy identity is accepted only from an existing member, never a client name.
  // Existing Rules accept precisely these legacy identities plus dynamic hashes.
  if (!['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'].includes(person) && !/^member-[a-f0-9]{24}$/.test(person)) failCalendar('CALENDAR_PROFILE_UNAVAILABLE', 409, 'Profil wymaga weryfikacji tożsamości przed przypisaniem kalendarza.');
  return person;
}
export function assertOwnedConnection(context, data) {
  if (!data || data.ownerUid !== context.uid || data.provider !== 'google') failCalendar('CALENDAR_CONNECTION_FORBIDDEN', 403, 'Nie masz dostępu do tego połączenia kalendarza.');
}
export function assertCalendarNotRemoving(data, now) {
  if (data?.removingEvents === true && (!Number.isFinite(timestampMillis(data.removalExpiresAt)) || timestampMillis(data.removalExpiresAt) > now)) {
    failCalendar('CALENDAR_BUSY', 409, 'Wydarzenia tego źródła są teraz usuwane. Spróbuj za chwilę.');
  }
}
export function assertCalendarLease(data, lease, now) {
  if (data.version !== lease.version || data.leaseId !== lease.id || !Number.isFinite(timestampMillis(data.leaseExpiresAt)) || timestampMillis(data.leaseExpiresAt) <= now || data.status !== 'connected') {
    failCalendar('CALENDAR_SYNC_STALE', 409, 'Połączenie zmieniło się podczas odświeżania. Sprawdź jego aktualny stan.');
  }
}
export async function acquireCalendarLease(context, id, { now = Date.now(), syncing = false } = {}) {
  const ref = connectionRef(context, id);
  return context.db.runTransaction(async transaction => {
    const [snapshot, actorSnapshot] = await Promise.all([transaction.get(ref), transaction.get(context.db.collection('members').doc(context.uid))]);
    const actor = actorSnapshot.data(), data = snapshot.data();
    assertCalendarActor(context, actor); assertOwnedConnection(context, data);
    assertCalendarNotRemoving(data, now);
    await assertCalendarSelection(transaction, context, actor, data);
    if (data.status !== 'connected' || !data.envelope) failCalendar('CALENDAR_RECONNECT_REQUIRED', 401, 'Połącz kalendarz ponownie.');
    if (syncing && data.selectionConfirmed !== true) failCalendar('CALENDAR_SELECTION_REQUIRED', 409, 'Wybierz i potwierdź kalendarz przed pobraniem wydarzeń.');
    // Only the trusted scheduler adds this context value. It is not accepted
    // from an HTTP body. Claim the logical UTC hour under the SAME manual lease.
    const scheduledSlot = context.scheduledCalendarSlotStartMs;
    const scheduled = syncing && scheduledSlot !== undefined;
    if (scheduled && (!Number.isSafeInteger(scheduledSlot) || scheduledSlot < 0 || scheduledSlot % 3600000 !== 0 || scheduledSlot > now + 60000)) {
      failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Nieprawidłowy termin odświeżania kalendarza.');
    }
    if (scheduled && ['lastScheduledSyncSlotAt', 'lastSuccessfulSyncAt', 'lastAttemptAt'].some(field =>
      Number.isFinite(timestampMillis(data[field])) && timestampMillis(data[field]) >= scheduledSlot)) {
      failCalendar('CALENDAR_SCHEDULE_SLOT_CONSUMED', 409, 'Kalendarz został już odświeżony w tym terminie.');
    }
    if (data.leaseId && (!Number.isFinite(timestampMillis(data.leaseExpiresAt)) || timestampMillis(data.leaseExpiresAt) > now)) failCalendar('CALENDAR_BUSY', 409, 'To połączenie jest już odświeżane. Spróbuj za chwilę.');
    if (syncing && Number.isFinite(timestampMillis(data.lastAttemptAt)) && now - timestampMillis(data.lastAttemptAt) < CALENDAR_SYNC_COOLDOWN_MS) {
      failCalendar('CALENDAR_RATE_LIMITED', 429, 'Kalendarz został odświeżony przed chwilą. Spróbuj ponownie za minutę.');
    }
    const lease = { id: randomUUID(), version: data.version };
    transaction.update(ref, { leaseId: lease.id, leaseExpiresAt: Timestamp.fromMillis(now + CALENDAR_LEASE_MS),
      ...(syncing ? { lastAttemptAt: Timestamp.fromMillis(now) } : {}), ...(scheduled ? { lastScheduledSyncSlotAt: Timestamp.fromMillis(scheduledSlot) } : {}) });
    return { lease, data: { ...data, id }, ref };
  });
}
export async function updateCalendarLease(context, ref, lease, updates, now = Date.now(), clock = Date.now) {
  return context.db.runTransaction(async transaction => {
    const [snapshot, actorSnapshot] = await Promise.all([transaction.get(ref), transaction.get(context.db.collection('members').doc(context.uid))]);
    const actor = actorSnapshot.data(), data = snapshot.data(); assertCalendarActor(context, actor); assertOwnedConnection(context, data);
    await assertCalendarSelection(transaction, context, actor, data);
    assertCalendarLease(data, lease, Math.max(now, clock()));
    transaction.update(ref, updates);
  });
}
export async function releaseCalendarLease(context, ref, lease, { now = Date.now(), errorCode } = {}) {
  return context.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), data = snapshot.data();
    if (!data || data.ownerUid !== context.uid || data.version !== lease.version || data.leaseId !== lease.id) return false;
    const updates = { leaseId: null, leaseExpiresAt: null };
    if (errorCode) updates.lastErrorCode = errorCode;
    if (errorCode === 'CALENDAR_RECONNECT_REQUIRED') { updates.envelope = null; updates.status = 'needs-reconnect'; updates.version = randomUUID(); }
    transaction.update(ref, updates); return true;
  });
}
export const googleEventDocumentId = (uid, connectionId, calendarId, externalEventId) => `google-${createHash('sha256').update(JSON.stringify([uid, connectionId, calendarId, externalEventId])).digest('hex')}`;
const sameSource = (event, connection, externalEventId) => event.source === 'google' && event.sourceConnectionId === connection.id
  && event.sourceOwnerUid === connection.ownerUid && event.ownerUid === connection.ownerUid && event.createdBy === connection.ownerUid
  && event.externalCalendarId === connection.calendarId && event.externalEventId === externalEventId;
const fingerprint = event => createHash('sha256').update(JSON.stringify({ title: event.title, description: event.description || '', location: event.location || '',
  start: timestampMillis(event.date), end: timestampMillis(event.endDate), allDay: event.allDay === true, timeZone: event.timeZone || '',
  sourceStartDate: event.sourceStartDate || null, sourceEndDateExclusive: event.sourceEndDateExclusive || null, cancelled: event.cancelled === true })).digest('hex');

/** Each event boundary is atomic across both collections. Cursor advances only after all chunks. */
export async function upsertGoogleEvents(context, connection, lease, events, { now = Date.now(), clock = Date.now } = {}) {
  const unique = new Map(events.map(event => [event.externalEventId, event]));
  const result = { imported: 0, changed: 0, cancelled: 0, unchanged: 0 };
  const rows = [...unique.values()];
  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100);
    const counts = await context.db.runTransaction(async transaction => {
      const ref = connectionRef(context, connection.id), snapshot = await transaction.get(ref), actorSnapshot = await transaction.get(context.db.collection('members').doc(context.uid));
      const data = snapshot.data(), actor = actorSnapshot.data(); assertCalendarActor(context, actor); assertOwnedConnection(context, data);
      await assertCalendarSelection(transaction, context, actor, data); assertCalendarLease(data, lease, clock());
      const pairs = await Promise.all(chunk.map(async incoming => {
        const id = googleEventDocumentId(context.uid, connection.id, connection.calendarId, incoming.externalEventId);
        const sharedRef = context.db.collection('calendarEvents').doc(id), privateRef = context.db.collection('privateCalendarEvents').doc(id);
        const [shared, privateSnapshot] = await Promise.all([transaction.get(sharedRef), transaction.get(privateRef)]);
        if (shared.exists && privateSnapshot.exists) failCalendar('CALENDAR_EVENT_CONFLICT', 409, 'Wydarzenie wymaga sprawdzenia ustawień prywatności.');
        const existing = shared.exists ? shared.data() : privateSnapshot.exists ? privateSnapshot.data() : null;
        if (existing && !sameSource(existing, connection, incoming.externalEventId)) failCalendar('CALENDAR_EVENT_CONFLICT', 409, 'Identyfikator wydarzenia jest już używany przez inne źródło.');
        return { incoming, id, existing, target: existing ? privateSnapshot.exists ? privateRef : sharedRef : connection.visibility === 'private' ? privateRef : sharedRef, isPrivate: existing ? privateSnapshot.exists : connection.visibility === 'private' };
      }));
      const counts = { imported: 0, changed: 0, cancelled: 0, unchanged: 0 };
      assertCalendarLease(data, lease, clock());
      for (const { incoming, id, existing, target, isPrivate } of pairs) {
        if (incoming.cancelled && !existing) { counts.unchanged++; continue; } // A titleless tombstone is not an invented event.
        const event = incoming.cancelled ? { ...existing, cancelled: true } : {
          ...(existing || {}), title: incoming.title, description: incoming.description, location: incoming.location,
          date: Timestamp.fromMillis(incoming.start), endDate: Timestamp.fromMillis(incoming.end), allDay: incoming.allDay, timeZone: incoming.timeZone, cancelled: false,
          sourceStartDate: incoming.allDay ? incoming.sourceStartDate || null : null,
          sourceEndDateExclusive: incoming.allDay ? incoming.sourceEndDateExclusive || null : null,
          person: existing?.person || connection.person, createdBy: context.uid, ownerUid: context.uid, private: isPrivate,
          repeat: 'none', repeatUntil: null, recurrence: null, repeatCount: null, recurrenceExceptions: [], recurrenceOverrides: {}, seriesId: id,
          source: 'google', readOnly: true, sourceConnectionId: connection.id, sourceOwnerUid: context.uid,
          externalCalendarId: connection.calendarId, externalEventId: incoming.externalEventId, externalSeriesId: incoming.externalSeriesId || null,
          ownerProfileId: connection.ownerProfileId, ...(existing ? {} : { createdAt: Timestamp.fromMillis(now) }),
        };
        if (existing && fingerprint(existing) === fingerprint(event)) { counts.unchanged++; continue; }
        transaction.set(target, { ...event, updatedAt: Timestamp.fromMillis(now), updatedBy: context.uid });
        if (!existing) counts.imported++;
        else if (incoming.cancelled && existing.cancelled !== true) counts.cancelled++;
        else counts.changed++;
      }
      if (counts.imported > 0 && data.hasEvents !== true) transaction.update(ref, { hasEvents: true });
      return counts;
    });
    for (const name of Object.keys(result)) result[name] += counts[name];
  }
  return result;
}

export async function sourceCalendarDocuments(context, id) {
  // One snapshot prevents a concurrent private↔family move from disappearing between two independent reads.
  return context.db.runTransaction(async transaction => {
    const [shared, privateSnapshot] = await Promise.all(['calendarEvents', 'privateCalendarEvents'].map(name =>
      transaction.get(context.db.collection(name).where('sourceConnectionId', '==', id).limit(5001))));
    const rows = [...shared.docs, ...privateSnapshot.docs];
    if (rows.length > 5000) failCalendar('CALENDAR_PROVIDER_LIMIT', 409, 'Źródło ma zbyt wiele wydarzeń, aby zmienić je w jednym kroku.');
    if (rows.some(row => row.data().source !== 'google' || row.data().sourceOwnerUid !== context.uid || row.data().ownerUid !== context.uid || row.data().createdBy !== context.uid)) failCalendar('CALENDAR_EVENT_CONFLICT', 409, 'Źródło kalendarza wymaga sprawdzenia właściciela.');
    return rows;
  }, { readOnly: true });
}

export async function persistCalendarCredentials(context, ref, lease, connection, tokens, syncToken, now, clock = Date.now) {
  const envelope = encryptCalendarSecrets({ tokens, syncToken: syncToken || null }, { uid: context.uid, id: connection.id, purpose: 'connection' });
  await updateCalendarLease(context, ref, lease, { envelope }, now, clock);
}
