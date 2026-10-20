// Isolated deployment entry: no Calendar, eduVULCAN or other secret parameters.
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { info } from 'firebase-functions/logger';
import { runMusicSchoolHourly } from './server/music-school-service.mjs';
import { MUSIC_SCHOOL_SCHEDULE, MUSIC_SCHOOL_TIME_ZONE } from './server/music-school-model.mjs';
const app = getApps()[0] || initializeApp();
const db = getFirestore(app);
const musicSchoolEnabled = defineString('MUSIC_SCHOOL_ENABLED', { default: 'false' });
export const musicSchoolPublicHourly = onSchedule({ schedule: MUSIC_SCHOOL_SCHEDULE,
  timeZone: MUSIC_SCHOOL_TIME_ZONE, region: 'europe-west1', retryCount: 0, minInstances: 0,
  maxInstances: 1, concurrency: 1, memory: '256MiB', timeoutSeconds: 110,
}, async event => {
  const result = await runMusicSchoolHourly({ db }, { scheduleTime: event.scheduleTime,
    env: { MUSIC_SCHOOL_ENABLED: musicSchoolEnabled.value() } });
  info('Music school public notice check', result);
});
