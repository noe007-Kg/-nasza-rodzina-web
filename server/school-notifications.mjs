import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { deriveNotificationEvent } from './notification-events.mjs';
import { enqueueInAppEvents } from './notification-inbox.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const BASELINE_VERSION = 'school-inapp-v1';
const NOTIFICATION_TYPES = Object.freeze(['grade', 'lesson', 'homework', 'test', 'message']);

export function schoolNotificationBaselineRef(db, connectionId, profileId, personKey) {
  return db.collection('_notificationBaselines').doc(digest([BASELINE_VERSION, connectionId, profileId, personKey]));
}

function batches(db, connectionId) {
  return db.collection('_notificationEvents').doc(digest(connectionId)).collection('schoolSyncs');
}

/** Compare the exact before/after images from the protected school transaction.
 * Read receipts and provider bookkeeping are ignored by the canonical semantic
 * helper. The first successful import establishes history without old alerts.
 */
export function schoolNotificationChanges(changes, initializedTypes, previousTimetableRange) {
  const types = initializedTypes === true ? NOTIFICATION_TYPES : Array.isArray(initializedTypes) ? initializedTypes : [];
  return changes.filter(change => types.includes((change.after || change.before)?.type))
    .filter(change => {
      if (change.after?.type !== 'lesson' || change.before) return true;
      // The provider reads a dated rolling window. A routine newly visible
      // future day is not a timetable change; only insertion into a previously
      // confirmed range proves that this dated lesson was actually added.
      const date = change.after.date;
      return typeof date === 'string' && !!previousTimetableRange
        && date >= previousTimetableRange.dateFrom && date <= previousTimetableRange.dateTo;
    })
    .map(change => deriveNotificationEvent(change.collection, change.id, change.before, change.after)).filter(Boolean).map(event => ({
    ...event,
    // The durable retry queue only needs authorization/routing data. Keeping
    // full teacher messages/grades here would duplicate sensitive school data.
    record: { person: event.record.person, sourceConnectionScope: event.record.sourceConnectionScope || 'family',
      sourceOwnerUid: event.record.sourceOwnerUid || '' },
  }));
}

/** Called inside the same guarded transaction as schoolItems. Two extra writes
 * keep the existing 450-item import safely below Firestore's 500-write limit.
 * A later inbox failure cannot lose the diff on the next unchanged sync.
 */
export function persistSchoolNotificationChanges(transaction, db, { connectionId, profileId, personKey, leaseId, baseline, changes,
  notificationReadyTypes = NOTIFICATION_TYPES, timetableRange }) {
  if (!Array.isArray(notificationReadyTypes) || notificationReadyTypes.some(type => !NOTIFICATION_TYPES.includes(type))) throw new Error('Invalid notification section availability.');
  const previous = baseline.data();
  // A previous global baseline without section flags is intentionally upgraded
  // quietly. One successful lesson import never proves that the grade/mailbox
  // histories have also been read, including a genuinely empty valid section.
  const initializedTypes = baseline.exists && previous?.version === BASELINE_VERSION && Array.isArray(previous.initializedTypes)
    ? previous.initializedTypes.filter(type => NOTIFICATION_TYPES.includes(type)) : [];
  const events = schoolNotificationChanges(changes, initializedTypes, previous?.timetableRange);
  const confirmedTimetableRange = timetableRange && notificationReadyTypes.includes('lesson')
    ? { dateFrom: timetableRange.dateFrom, dateTo: timetableRange.dateTo } : previous?.timetableRange;
  transaction.set(schoolNotificationBaselineRef(db, connectionId, profileId, personKey), {
    version: BASELINE_VERSION, connectionId, profileId, personKey,
    initializedTypes: [...new Set([...initializedTypes, ...notificationReadyTypes])],
    ...(confirmedTimetableRange ? { timetableRange: confirmedTimetableRange } : {}),
    establishedAt: baseline.data()?.establishedAt || FieldValue.serverTimestamp(),
    lastSuccessfulImportAt: FieldValue.serverTimestamp(),
  });
  if (events.length) transaction.set(batches(db, connectionId).doc(digest(leaseId)), {
    connectionId, profileId, personKey, status: 'pending', events,
    createdAt: FieldValue.serverTimestamp(),
  });
  return events.length;
}

/** Invoked by the shared sync/status service and the Functions journal trigger.
 * The server-only journal plus deterministic inbox IDs allow safe retries
 * after interruption; callers may run in the foreground or scheduled Functions.
 */
export async function flushSchoolNotifications(context) {
  const queue = batches(context.db, context.connection.id);
  const pending = await queue.where('status', '==', 'pending').limit(10).get();
  let created = 0;
  for (const document of pending.docs) {
    const result = await enqueueInAppEvents(context, document.data().events || []);
    await document.ref.update({ status: 'delivered', deliveredAt: FieldValue.serverTimestamp(), events: FieldValue.delete() });
    created += result.created;
  }
  return { created, pending: pending.size >= 10 };
}

export async function safelyFlushSchoolNotifications(context) {
  try { return await flushSchoolNotifications(context); }
  catch {
    // A school import is still successful. Its durable pending journal is kept
    // for the next status/sync request, and no upstream/private error is exposed.
    return { created: 0, pending: true, warning: 'Dane szkolne zostały zapisane. Powiadomienia uzupełnimy przy następnym sprawdzeniu połączenia.' };
  }
}
