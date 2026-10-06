import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { deleteApp } from 'firebase-admin/app';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError, getServerFirebase } from '../server/edu-auth.mjs';
import { resolveConnectionAccess } from '../server/edu-access.mjs';
import { syncAction } from '../server/edu-service.mjs';
import { saveConnection, selectConnectionStudent } from '../server/edu-storage.mjs';
import { runScheduledEduSync, eduSchedulePolicy } from '../server/edu-scheduler.mjs';

// No production identities, secrets or requests may be used by this suite.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Scheduled integration requires the local demo Firestore emulator.');
for (const key of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_BASE64', 'GOOGLE_APPLICATION_CREDENTIALS', 'VERCEL']) delete process.env[key];
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT = 'demo-nasza-rodzina';
process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString('base64');
const services = getServerFirebase();
const { db } = services;
const parent = 'schedule-parent', mother = 'schedule-mother', child = 'schedule-child';
const profile = { id: 'schedule-sp4', studentName: 'Synthetic pupil', schoolName: 'Synthetic school' };
const session = { v: 1, cookieJar: { cookies: [] }, profiles: [profile] };
let context;
const grade = id => ({ externalId: id, type: 'grade', title: 'Synthetic grade', subject: 'Math' });
const data = items => ({ session, items, counts: { grades: items.length }, warnings: [], notificationReadyTypes: ['grade'] });
const scheduled = syncFn => runScheduledEduSync({ db }, { scheduleTime: new Date().toISOString(), window: eduSchedulePolicy(Date.now()).window }, { syncFn });
async function resetClock() { await db.collection('_eduConnections').doc('family').update({ lastSuccessfulSyncAt: FieldValue.delete(), lastSyncAttemptAt: FieldValue.delete(), lastScheduledSchoolSlotAt: FieldValue.delete() }); }
async function connect() {
  await saveConnection('family', { session, profiles: [profile] }, context);
  await selectConnectionStudent('family', { profileId: profile.id, personKey: 'Nikodem' }, context);
}
async function inbox(uid) { return (await db.collection('notificationInbox').doc(uid).collection('items').get()).docs; }

async function withClock(instant, operation) {
  const original = Date.now; const now = Date.parse(instant);
  assert.ok(Number.isFinite(now)); Date.now = () => now;
  try { return await operation(now); } finally { Date.now = original; }
}

async function scheduledAt(instant, slot, execute) {
  return withClock(instant, () => runScheduledEduSync({ db }, {
    scheduleTime: slot, window: eduSchedulePolicy(slot).window,
  }, { syncFn: execute }));
}

async function connectAt(instant) { await withClock(instant, connect); await resetClock(); }

async function stampFixtureSyncClock(instant) {
  // The emulator resolves serverTimestamp with its own real clock, independent
  // of the Node clock above. Model the committed timestamps in this fixture so
  // that the test genuinely exercises 9m56s elapsed time rather than years.
  // Keep the slot marker written by the real lease transaction unchanged.
  const timestamp = Timestamp.fromMillis(Date.parse(instant));
  await db.collection('_eduConnections').doc('family').update({
    lastSyncAttemptAt: timestamp, lastSuccessfulSyncAt: timestamp,
  });
}

function countingProvider() {
  let reads = 0;
  const execute = (ctx, body) => syncAction(ctx, body, { readData: async stored => {
    reads += 1; assert.deepEqual(stored, session);
    return data([grade('old-grade'), grade('new-grade')]);
  } });
  return { execute, reads: () => reads };
}

function blockingProvider() {
  let entered, release, reads = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const readData = async stored => {
    reads += 1; assert.deepEqual(stored, session); entered(); await wait;
    return data([grade('old-grade'), grade('new-grade')]);
  };
  return { started, release: () => release(), readData, reads: () => reads,
    execute: (ctx, body) => syncAction(ctx, body, { readData }) };
}

before(async () => {
  for (const [uid, value] of [[parent, { role: 'parent', name: 'Synthetic parent' }], [mother, { role: 'parent', name: 'Synthetic mother' }], [child, { role: 'child', name: 'Nikodem', personKey: 'Nikodem' }]]) {
    await db.collection('members').doc(uid).set({ ...value, active: true, canLogin: true });
    await db.collection('userPreferences').doc(uid).set({ notifications: { enabled: true } });
  }
  context = await resolveConnectionAccess({ ...services, uid: parent, profile: (await db.collection('members').doc(parent).get()).data() });
  await connect();
});
after(async () => {
  for (const uid of [parent, mother, child]) {
    await db.collection('members').doc(uid).delete(); await db.collection('userPreferences').doc(uid).delete();
    await db.recursiveDelete(db.collection('notificationInbox').doc(uid));
  }
  await db.collection('_eduConnections').doc('family').delete();
  await db.collection('_eduStudentBindings').doc('Nikodem').delete();
  for (const name of ['schoolItems', 'schoolParentMessages', 'schoolStudentMessages']) {
    const rows = await db.collection(name).where('sourceProfileId', '==', profile.id).get();
    for (const row of rows.docs) await row.ref.delete();
  }
  await db.collection('familyMessages').doc('scheduled-immediate-chat').delete();
  await deleteApp(services.app);
});

test('two scheduled invocations share the actual Firestore lease and run the same service only once', async () => {
  let reads = 0, entered, release;
  const started = new Promise(resolve => { entered = resolve; }); const wait = new Promise(resolve => { release = resolve; });
  const execute = (ctx, body) => syncAction(ctx, body, { readData: async stored => {
    reads += 1; assert.deepEqual(stored, session); entered(); await wait; return data([grade('old-grade')]);
  } });
  const first = scheduled(execute); await started;
  const second = await scheduled(execute);
  assert.equal(second.synced, 0); assert.equal(second.codes.EDU_SYNC_BUSY, 1);
  release(); assert.equal((await first).synced, 1); assert.equal(reads, 1);
  assert.equal((await inbox(parent)).length, 0); assert.equal((await inbox(mother)).length, 0);
});

test('scheduled imports reuse baseline and deduplicate a new grade across repeats and raw Functions triggers', async () => {
  await resetClock();
  const execute = (ctx, body) => syncAction(ctx, body, { readData: async () => data([grade('old-grade'), grade('new-grade')]) });
  assert.equal((await scheduled(execute)).synced, 1);
  for (const uid of [parent, mother, child]) assert.equal((await inbox(uid)).length, 1);
  await resetClock(); assert.equal((await scheduled(execute)).synced, 1);
  const functions = await import('../functions/index.mjs');
  const rows = await db.collection('schoolItems').where('sourceProfileId', '==', profile.id).get();
  for (const row of rows.docs) await functions.notifySchool.run({ params: { id: row.id }, data: { before: { exists: false }, after: row } });
  for (const uid of [parent, mother, child]) assert.equal((await inbox(uid)).length, 1);
  assert.equal((await db.collection('_notificationOutbox').get()).size, 0);
});

test('metadata expiry records reconnect state and stops without calling a provider or a password login', async () => {
  await resetClock(); await db.collection('_eduConnections').doc('family').update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  let calls = 0;
  const result = await scheduled(async () => { calls += 1; });
  assert.equal(calls, 0); assert.equal(result.reconnectRequired, 1);
  const marker = (await db.collection('_eduConnections').doc('family').get()).data();
  assert.equal(marker.reconnectRequired, true); assert.equal(marker.envelope, undefined);
  assert.equal(marker.lastErrorCode, 'EDU_SESSION_EXPIRED');
});

test('a rejected live provider session is safely retired by the shared service and not retried on the next job', async () => {
  await connect(); let reads = 0;
  const execute = (ctx, body) => syncAction(ctx, body, { readData: async () => { reads += 1; throw new EduServerError('EDU_SESSION_EXPIRED', 401, 'Synthetic expiry'); } });
  assert.equal((await scheduled(execute)).reconnectRequired, 1);
  assert.equal((await scheduled(execute)).synced, 0); assert.equal(reads, 1);
  const marker = (await db.collection('_eduConnections').doc('family').get()).data();
  assert.equal(marker.envelope, undefined); assert.equal(marker.lease, undefined);
});

test('the actual exported familyMessages created trigger adds inbox immediately and repeated delivery keeps one entry', async () => {
  const functions = await import('../functions/index.mjs');
  const ref = db.collection('familyMessages').doc('scheduled-immediate-chat');
  await ref.set({ channel: 'family', uid: parent, text: 'Synthetic family message', createdAt: FieldValue.serverTimestamp() });
  const snapshot = await ref.get();
  const beforeMother = (await inbox(mother)).length, beforeChild = (await inbox(child)).length;
  await functions.notifyChat.run({ params: { id: ref.id }, data: snapshot });
  await functions.notifyChat.run({ params: { id: ref.id }, data: snapshot });
  assert.equal((await inbox(mother)).length, beforeMother + 1);
  assert.equal((await inbox(child)).length, beforeChild + 1);
  assert.equal((await inbox(parent)).filter(row => row.data().category === 'familyChat').length, 0);
  assert.equal((await db.collection('_notificationOutbox').get()).size, 0);
});

test('08:00:05 then 08:10:01 execute both school slots despite only 9m56s between actual starts', async () => {
  const first = '2026-10-05T08:00:05+02:00', second = '2026-10-05T08:10:01+02:00';
  await connectAt(first); const provider = countingProvider();
  assert.equal((await scheduledAt(first, '2026-10-05T08:00:00+02:00', provider.execute)).synced, 1);
  const firstMarker = (await db.collection('_eduConnections').doc('family').get()).data().lastScheduledSchoolSlotAt;
  assert.equal(firstMarker.toMillis(), Date.parse('2026-10-05T08:00:00+02:00'));
  await stampFixtureSyncClock(first);
  assert.equal((await scheduledAt(second, '2026-10-05T08:10:00+02:00', provider.execute)).synced, 1);
  assert.equal(provider.reads(), 2);
  const secondMarker = (await db.collection('_eduConnections').doc('family').get()).data().lastScheduledSchoolSlotAt;
  assert.equal(secondMarker.toMillis(), Date.parse('2026-10-05T08:10:00+02:00'));
});

test('the same school slot delivered again after ten minutes imports once and cannot replace a newer slot', async () => {
  const first = '2026-10-05T08:00:05+02:00', slot = '2026-10-05T08:00:00+02:00';
  await connectAt(first); const provider = countingProvider();
  assert.equal((await scheduledAt(first, slot, provider.execute)).synced, 1);
  await stampFixtureSyncClock(first);
  const duplicate = await scheduledAt('2026-10-05T08:10:15+02:00', slot, provider.execute);
  assert.equal(duplicate.synced, 0); assert.equal(duplicate.codes.EDU_SYNC_COOLDOWN, 1);
  // Bypass the runner's preliminary check: the real lease transaction must
  // independently reject a repeated slot after the elapsed-time limit passed.
  await withClock('2026-10-05T08:10:15+02:00', async () => {
    await assert.rejects(provider.execute({ ...context, scheduledSyncIntervalMs: 10 * 60000,
      scheduledSchoolSlotStartMs: Date.parse(slot) }, {}), { code: 'EDU_SYNC_COOLDOWN' });
  });
  assert.equal(provider.reads(), 1);
  assert.equal((await scheduledAt('2026-10-05T08:10:16+02:00', '2026-10-05T08:10:00+02:00', provider.execute)).synced, 1);
  await stampFixtureSyncClock('2026-10-05T08:10:16+02:00');
  assert.equal((await scheduledAt('2026-10-05T08:20:20+02:00', slot, provider.execute)).synced, 0);
  assert.equal(provider.reads(), 2);
  assert.equal((await db.collection('_eduConnections').doc('family').get()).data().lastScheduledSchoolSlotAt.toMillis(),
    Date.parse('2026-10-05T08:10:00+02:00'));
});

test('a manual sync holding the shared lease prevents Scheduler from importing the same connection', async () => {
  const instant = '2026-10-05T08:00:05+02:00'; await connectAt(instant);
  const provider = blockingProvider();
  await withClock(instant, async () => {
    const manual = syncAction(context, {}, { readData: provider.readData }); await provider.started;
    try {
      const result = await runScheduledEduSync({ db }, { scheduleTime: '2026-10-05T08:00:00+02:00', window: 'day' }, { syncFn: provider.execute });
      assert.equal(result.synced, 0); assert.equal(result.codes.EDU_SYNC_BUSY, 1);
    } finally { provider.release(); await manual; }
  });
  assert.equal(provider.reads(), 1); await stampFixtureSyncClock(instant);
  const completed = await scheduledAt('2026-10-05T08:00:06+02:00', '2026-10-05T08:00:00+02:00', provider.execute);
  assert.equal(completed.synced, 0); assert.equal(completed.codes.EDU_SYNC_COOLDOWN, 1);
  const delayed = await scheduledAt('2026-10-05T08:10:15+02:00', '2026-10-05T08:00:00+02:00', provider.execute);
  assert.equal(delayed.synced, 0); assert.equal(delayed.codes.EDU_SYNC_COOLDOWN, 1);
  assert.equal(provider.reads(), 1);
});

test('a Scheduler sync holding the shared lease prevents manual syncAction from importing in parallel', async () => {
  const instant = '2026-10-05T08:00:05+02:00'; await connectAt(instant);
  const provider = blockingProvider();
  await withClock(instant, async () => {
    const scheduledRun = runScheduledEduSync({ db }, { scheduleTime: '2026-10-05T08:00:00+02:00', window: 'day' }, { syncFn: provider.execute });
    await provider.started;
    try { await assert.rejects(syncAction(context, {}, { readData: provider.readData }), { code: 'EDU_SYNC_BUSY' }); }
    finally { provider.release(); assert.equal((await scheduledRun).synced, 1); }
  });
  assert.equal(provider.reads(), 1); await stampFixtureSyncClock(instant);
  await withClock('2026-10-05T08:00:06+02:00', async () => {
    await assert.rejects(syncAction(context, {}, { readData: provider.readData }), { code: 'EDU_SYNC_COOLDOWN' });
  });
  assert.equal(provider.reads(), 1);
});

test('14:50 school slot followed by 15:00 retains the strict hourly off-hours cooldown', async () => {
  const first = '2026-10-05T14:50:05+02:00'; await connectAt(first);
  const provider = countingProvider();
  assert.equal((await scheduledAt(first, '2026-10-05T14:50:00+02:00', provider.execute)).synced, 1);
  await stampFixtureSyncClock(first);
  const boundary = await scheduledAt('2026-10-05T15:00:01+02:00', '2026-10-05T15:00:00+02:00', provider.execute);
  assert.equal(boundary.synced, 0); assert.equal(boundary.codes.EDU_SYNC_COOLDOWN, 1);
  assert.equal(provider.reads(), 1);
  assert.equal((await scheduledAt('2026-10-05T16:00:01+02:00', '2026-10-05T16:00:00+02:00', provider.execute)).synced, 1);
  assert.equal(provider.reads(), 2);
});

test('an expired school-slot session requires reconnect without executing syncAction or a password login', async () => {
  const instant = '2026-10-05T08:00:05+02:00'; await connectAt(instant);
  await db.collection('_eduConnections').doc('family').update({ expiresAt: Timestamp.fromMillis(Date.parse(instant) - 1) });
  let calls = 0;
  const result = await scheduledAt(instant, '2026-10-05T08:00:00+02:00', async () => { calls += 1; });
  assert.equal(calls, 0); assert.equal(result.reconnectRequired, 1); assert.equal(result.codes.EDU_SESSION_EXPIRED, 1);
  const marker = (await db.collection('_eduConnections').doc('family').get()).data();
  assert.equal(marker.reconnectRequired, true); assert.equal(marker.envelope, undefined);
  assert.equal(marker.lastScheduledSchoolSlotAt, undefined);
});
