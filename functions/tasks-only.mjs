// Isolated release: no exports, flags or secrets for other modules.
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { info } from 'firebase-functions/logger';
import { runTaskPhotoCleanup } from './server/tasks-photos.mjs';

const app = getApps()[0] || initializeApp();
export const taskPhotoCleanup = onSchedule({ schedule: '0 * * * *', timeZone: 'Europe/Warsaw',
  region: 'europe-west1', retryCount: 2, minInstances: 0, maxInstances: 1,
  concurrency: 1, memory: '256MiB', timeoutSeconds: 300,
}, async () => {
  if (process.env.TASKS_WRITES_ENABLED !== 'true' || !process.env.TASK_PROOF_BUCKET || !process.env.TASK_REWARD_BUCKET) {
    throw new Error('TASK_CLEANUP_NOT_CONFIGURED');
  }
  const context = { app, db: getFirestore(app), bucket: getStorage(app).bucket(process.env.TASK_REWARD_BUCKET),
    proofBucket: getStorage(app).bucket(process.env.TASK_PROOF_BUCKET) };
  info('Task photograph cleanup', await runTaskPhotoCleanup(context));
});
