import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { info } from 'firebase-functions/logger';
import { runFinanceReminders } from './server/finance-reminders.mjs';
const app = getApps()[0] || initializeApp();
export const financeReminders = onSchedule({ schedule: '0 9 * * *', timeZone: 'Europe/Warsaw', region: 'europe-west1', retryCount: 2,
  minInstances: 0, maxInstances: 1, concurrency: 1, memory: '256MiB', timeoutSeconds: 300 }, async () => {
  if (process.env.FINANCE_WRITES_ENABLED !== 'true') return;
  info('Finance reminder maintenance', await runFinanceReminders({ app, db: getFirestore(app) }));
});
