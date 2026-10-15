import { FieldValue } from 'firebase-admin/firestore';
import { activeHealthMember, healthExpiryDays } from './health-access.mjs';
import { eventDocumentId, inboxEvent, wantsNotification } from './notification-events.mjs';
import { explicitFamilyId } from './family-identity.mjs';

/** Sensitive document reminders are delivered to the document ACL, never to all parents. */
export async function runHealthDocumentReminders(context, now = new Date()) {
  const documents = await context.db.collection('healthDocuments').where('state', '==', 'ready').where('indefinite', '==', false).limit(1001).get();
  if (documents.size > 1000) throw new Error('Health document reminder limit exceeded.');
  let delivered = 0;
  for (const snapshot of documents.docs) {
    const value = snapshot.data();
    const days = healthExpiryDays(value.expiresOn, now);
    if (![90, 30, 7].includes(days)) continue;
    const event = { id: `health-document:expiry:${snapshot.id}:${value.expiresOn}:${days}`,
      category: 'health', module: 'Zdrowie', title: 'Termin ważności dokumentu',
      body: `Dokument wymaga sprawdzenia za ${days} dni. Szczegóły znajdziesz w aplikacji.`,
      important: true, collection: 'healthDocuments', recordId: snapshot.id };
    for (const uid of [...new Set(Array.isArray(value.readers) ? value.readers : [])]) {
      if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) continue;
      const inbox = context.db.collection('notificationInbox').doc(uid).collection('items').doc(eventDocumentId(event));
      const count = await context.db.runTransaction(async transaction => {
        const [current, member, preferences, prior] = await transaction.getAll(snapshot.ref,
          context.db.collection('members').doc(uid), context.db.collection('userPreferences').doc(uid), inbox);
        const record = current.data();
        if (prior.exists || !activeHealthMember(member.data()) || record?.state !== 'ready'
          || explicitFamilyId(record) === null || explicitFamilyId(member.data()) !== explicitFamilyId(record)
          || record.indefinite === true || record.expiresOn !== value.expiresOn || !record.readers?.includes(uid)
          || !wantsNotification(preferences.data()?.notifications, event)) return 0;
        transaction.create(inbox, inboxEvent(event, FieldValue.serverTimestamp()));
        return 1;
      });
      delivered += count;
    }
  }
  return { delivered };
}
