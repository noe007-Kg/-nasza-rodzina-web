import { FieldValue } from 'firebase-admin/firestore';
import { canReceiveNotification, eventDocumentId, inboxEvent, wantsNotification } from './notification-events.mjs';

const REVALIDATED_SOURCES = new Set(['calendarEvents', 'privateCalendarEvents', 'tasks', 'shoppingItems', 'familyMessages', 'healthRecords']);

/** Admin-only delivery shared by Vercel and Firebase Functions producers.
 * No client payload, FCM token or push queue is involved.
 * Fresh membership/preferences are read in each transaction: a queued event
 * cannot resurrect access after archiving or notify an opted-out account.
 */
export async function enqueueInAppEvents(context, events, { recipientUid, revalidateSource = false } = {}) {
  const { db } = context;
  const unique = [...new Map(events.map(event => [eventDocumentId(event), event])).values()];
  if (!unique.length) return { created: 0, checked: 0 };
  if (typeof revalidateSource !== 'boolean') throw new Error('Invalid notification source validation.');
  if (revalidateSource && unique.some(event => !REVALIDATED_SOURCES.has(event.collection)
    || typeof event.recordId !== 'string' || !event.recordId || event.recordId.includes('/')
    || ['.', '..'].includes(event.recordId) || Buffer.byteLength(event.recordId) > 1500)) throw new Error('Invalid notification source.');
  if (recipientUid !== undefined && (typeof recipientUid !== 'string' || !recipientUid || recipientUid.includes('/') || recipientUid.length > 128)) throw new Error('Invalid notification recipient.');
  const ownMember = recipientUid ? await db.collection('members').doc(recipientUid).get() : null;
  const members = recipientUid ? { size: ownMember.exists ? 1 : 0, docs: ownMember.exists ? [ownMember] : [] }
    : await db.collection('members').limit(201).get();
  if (members.size > 200) throw new Error('Notification recipient limit exceeded.');
  let created = 0;
  let checked = 0;
  // A family normally has only a few accounts. Sequential bounded transactions
  // also make retries safe when the server request times out part-way through.
  for (const memberSnapshot of members.docs) {
    const uid = memberSnapshot.id;
    if (!unique.some(event => canReceiveNotification({ ...memberSnapshot.data(), id: uid }, event))) continue;
    for (let offset = 0; offset < unique.length; offset += 350) {
      const batch = unique.slice(offset, offset + 350);
      const delivered = await db.runTransaction(async transaction => {
        const memberRef = db.collection('members').doc(uid);
        const preferenceRef = db.collection('userPreferences').doc(uid);
        const inboxRefs = batch.map(event => db.collection('notificationInbox').doc(uid).collection('items').doc(eventDocumentId(event)));
        const sourceRefs = revalidateSource ? batch.map(event => db.collection(event.collection).doc(event.recordId)) : [];
        const [member, preference, ...snapshots] = await transaction.getAll(memberRef, preferenceRef, ...inboxRefs, ...sourceRefs);
        const prior = snapshots.slice(0, batch.length);
        const sources = snapshots.slice(batch.length);
        let count = 0;
        batch.forEach((event, index) => {
          // A source can become private after the producer's query. Reading it
          // in the inbox transaction gives Firestore a conflict/retry boundary
          // and prevents delivery using stale visibility/participant metadata.
          if (revalidateSource && !sources[index].exists) return;
          const currentEvent = revalidateSource ? { ...event, record: sources[index].data() } : event;
          if (prior[index].exists || !canReceiveNotification({ ...member.data(), id: uid }, currentEvent)
            || !wantsNotification(preference.data()?.notifications, event)) return;
          transaction.create(inboxRefs[index], inboxEvent(event, FieldValue.serverTimestamp()));
          count += 1;
        });
        return count;
      });
      created += delivered;
      checked += batch.length;
    }
  }
  return { created, checked };
}
