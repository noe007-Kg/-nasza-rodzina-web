import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { info } from 'firebase-functions/logger';
import { deriveNotificationEvent } from './notification-events.mjs';
import { schoolSyncBootstrap } from './notification-baseline.mjs';
import { enqueueInAppEvents } from './server/notification-inbox.mjs';
import { flushSchoolNotifications, schoolNotificationBaselineRef } from './server/school-notifications.mjs';
import { EDU_DAY_SCHEDULE, EDU_NIGHT_SCHEDULE, EDU_SCHEDULE_TIME_ZONE, runScheduledEduSync } from './server/edu-scheduler.mjs';
import { processNotificationWrite, processSchoolNotificationBatch } from './notification-triggers.mjs';
import { GOOGLE_CALENDAR_SCHEDULE, GOOGLE_CALENDAR_TIME_ZONE, runScheduledGoogleCalendarSync } from './server/calendar-scheduler.mjs';

// Functions use the project's managed identity, never a shipped Admin key.
const app = getApps()[0] || initializeApp();
const db = getFirestore(app);
const region = 'europe-west1';
// Bind the SAME existing encryption key. Declaring this parameter does not
// create, read, rotate or change a secret during build/function discovery.
const eduEncryptionKey = defineSecret('EDUVULCAN_ENCRYPTION_KEY_BASE64');
// Calendar credentials use their own key and OAuth secret. These declarations
// do not read, generate or rotate any secret during build/function discovery.
const calendarEncryptionKey = defineSecret('CALENDAR_ENCRYPTION_KEY_BASE64');
const googleCalendarClientSecret = defineSecret('GOOGLE_CALENDAR_CLIENT_SECRET');
const googleCalendarClientId = defineString('GOOGLE_CALENDAR_CLIENT_ID', { default: '' });
const calendarSiteOrigin = defineString('CALENDAR_SITE_ORIGIN', { default: '' });
const calendarEncryptionKeyId = defineString('CALENDAR_ENCRYPTION_KEY_ID', { default: 'v1' });

const notificationDependencies = {
  derive: deriveNotificationEvent, enqueue: enqueueInAppEvents,
  baselineRef: schoolNotificationBaselineRef, bootstrap: schoolSyncBootstrap,
};

export async function enqueueNotification(event) {
  const school = ['schoolItems', 'schoolParentMessages', 'schoolStudentMessages'].includes(event.collection);
  return enqueueInAppEvents({ db }, [event], { revalidateSource: !school });
}

function sourceTrigger(collectionName) {
  return onDocumentWritten({ document: `${collectionName}/{id}`, region, retry: true }, async trigger => {
    await processNotificationWrite({ db }, {
      collection: collectionName, id: trigger.params.id,
      before: trigger.data?.before.exists ? trigger.data.before.data() : null,
      after: trigger.data?.after.exists ? trigger.data.after.data() : null,
    }, notificationDependencies);
  });
}
export const notifyCalendar = sourceTrigger('calendarEvents');
export const notifyPrivateCalendar = sourceTrigger('privateCalendarEvents');
export const notifyTasks = sourceTrigger('tasks');
export const notifyShopping = sourceTrigger('shoppingItems');
export const notifyHealth = sourceTrigger('healthRecords');
export const notifySchool = sourceTrigger('schoolItems');
export const notifySchoolParents = sourceTrigger('schoolParentMessages');
export const notifySchoolStudent = sourceTrigger('schoolStudentMessages');

// New chat messages reach the existing inbox immediately, independently of
// a foreground refresh or the school's scheduled synchronization.
export const notifyChat = onDocumentCreated({ document: 'familyMessages/{id}', region, retry: true }, async trigger => {
  await processNotificationWrite({ db }, {
    collection: 'familyMessages', id: trigger.params.id,
    before: null, after: trigger.data?.data() || null,
  }, notificationDependencies);
});

// Guarded school imports atomically create this journal after their per-section
// baseline. Reuse its semantic diff instead of alerting for every raw school write.
// Both the shared sync service and this trigger use identical inbox IDs.
export const notifySchoolSync = onDocumentCreated({ document: '_notificationEvents/{connectionHash}/schoolSyncs/{batchId}', region, retry: true }, async trigger => {
  await processSchoolNotificationBatch({ db }, {
    connectionHash: trigger.params.connectionHash, batch: trigger.data?.data(),
  }, { flush: flushSchoolNotifications });
});

const eduScheduleOptions = {
  timeZone: EDU_SCHEDULE_TIME_ZONE, region,
  secrets: [eduEncryptionKey], retryCount: 0,
  minInstances: 0, maxInstances: 1, concurrency: 1, memory: '256MiB',
  // Existing shared lease is 120 s; a worker must stop before it can expire.
  timeoutSeconds: 110,
};
function scheduledEdu(window) {
  return async event => {
    const result = await runScheduledEduSync({ db }, { scheduleTime: event.scheduleTime, window });
    // Aggregate counters and allowlisted codes only: no UID, student, session,
    // provider payload, cookie, teacher-message content or error stack.
    info('eduVULCAN scheduled synchronization', result);
  };
}
export const eduVulcanSchoolHours = onSchedule({ ...eduScheduleOptions, schedule: EDU_DAY_SCHEDULE }, scheduledEdu('day'));
export const eduVulcanOffHours = onSchedule({ ...eduScheduleOptions, schedule: EDU_NIGHT_SCHEDULE }, scheduledEdu('night'));

// One economical hourly job also works while the browser/PWA is closed.
// Sequential sources share each source's 120 s lease with Vercel manual sync.
export const googleCalendarHourly = onSchedule({ schedule: GOOGLE_CALENDAR_SCHEDULE, timeZone: GOOGLE_CALENDAR_TIME_ZONE, region,
  secrets: [calendarEncryptionKey, googleCalendarClientSecret], retryCount: 0,
  minInstances: 0, maxInstances: 1, concurrency: 1, memory: '256MiB', timeoutSeconds: 540,
}, async event => {
  // Non-secret params are injected as runtime environment variables by Firebase.
  // Access values only at runtime; deployment discovery must never read secrets.
  if (!googleCalendarClientId.value() || !calendarSiteOrigin.value() || !calendarEncryptionKeyId.value()) {
    info('Google Calendar scheduled synchronization', { skipped: 1, codes: { CALENDAR_NOT_CONFIGURED: 1 } });
    return;
  }
  const result = await runScheduledGoogleCalendarSync({ db, auth: getAuth(app) }, { scheduleTime: event.scheduleTime });
  // Counts and allowlisted status codes only. Never source IDs, UIDs, calendars,
  // private titles, provider errors, OAuth tokens or encrypted envelopes.
  info('Google Calendar scheduled synchronization', result);
});

export const medicineReminders = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Europe/Warsaw', region, retryCount: 3 }, async () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const records = await db.collection('healthRecords').where('type', '==', 'medicine').get();
  for (const snapshot of records.docs) {
    const record = snapshot.data();
    if (record.confirmedDate === today || !/^\d{2}:\d{2}$/.test(record.medicineTime || '') || record.status === 'cancelled') continue;
    const [hour, minute] = record.medicineTime.split(':').map(Number);
    const delta = minutes - hour * 60 - minute;
    const phase = delta >= 0 && delta < 5 ? 'due' : delta >= 15 && delta < 20 ? 'late' : '';
    if (!phase) continue;
    await enqueueNotification({ id: `medicine:${snapshot.id}:${today}:${phase}`, category: 'health', module: 'Zdrowie', title: phase === 'due' ? 'Przypomnienie o leku' : 'Sprawdź potwierdzenie leku', body: 'Otwórz Zdrowie, aby zobaczyć szczegóły.', important: phase === 'late', collection: 'healthRecords', recordId: snapshot.id, record, excludeUid: '' });
  }
});
