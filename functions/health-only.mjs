// Independent Health release: no task, finance, school or OAuth exports/secrets.
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { info } from 'firebase-functions/logger';
import { runHealthDocumentReminders } from './server/health-reminders.mjs';
import { retryHealthDocumentDeletes } from './server/health-service.mjs';
const app = getApps()[0] || initializeApp();
function context() {
  if (process.env.HEALTH_WRITES_ENABLED !== 'true' || !process.env.HEALTH_STORAGE_BUCKET) throw new Error('HEALTH_MAINTENANCE_NOT_CONFIGURED');
  return { app, db: getFirestore(app), bucket: getStorage(app).bucket(process.env.HEALTH_STORAGE_BUCKET) };
}
const options = { timeZone: 'Europe/Warsaw', region: 'europe-west1', retryCount: 2,
  minInstances: 0, maxInstances: 1, concurrency: 1, memory: '256MiB', timeoutSeconds: 300 };
export const healthDocumentReminders = onSchedule({ ...options, schedule: '0 8 * * *' }, async () => {
  info('Protected document reminders', await runHealthDocumentReminders(context()));
});
export const healthDocumentCleanup = onSchedule({ ...options, schedule: '15 * * * *' }, async () => {
  info('Protected document cleanup', await retryHealthDocumentDeletes(context()));
});
