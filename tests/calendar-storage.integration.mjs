import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { deleteApp } from 'firebase-admin/app';
import { getServerFirebase } from '../server/edu-auth.mjs';
import { encryptCalendarSecrets, decryptCalendarSecrets } from '../server/calendar-secrets.mjs';
import { changeGoogleEventVisibility, disconnectGoogleCalendar, syncGoogleCalendar } from '../server/calendar-service.mjs';
import { googleEventDocumentId } from '../server/calendar-storage.mjs';

// Never fall back to remote credentials, a real project, Google, or production.
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
  || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
  || process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== 'demo-nasza-rodzina') {
  throw new Error('Calendar storage integration requires local Auth/Firestore emulators and the demo project.');
}
for (const name of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_BASE64', 'GOOGLE_APPLICATION_CREDENTIALS', 'VERCEL']) delete process.env[name];
process.env.FIREBASE_PROJECT_ID = 'demo-nasza-rodzina';
const testKey = randomBytes(32).toString('base64');
Object.assign(process.env, { CALENDAR_ENCRYPTION_KEY_BASE64: testKey, CALENDAR_ENCRYPTION_KEY_ID: 'integration-test',
  GOOGLE_CALENDAR_CLIENT_ID: '123-integration-fixture.apps.googleusercontent.com', GOOGLE_CALENDAR_CLIENT_SECRET: 'local-test-only-placeholder',
  CALENDAR_SITE_ORIGIN: 'https://calendar-integration.example.test' });
const services = getServerFirebase();
const { db } = services;
assert.equal(services.app.options.projectId, 'demo-nasza-rodzina');
const parentUid = 'calendar-integration-parent';
const motherUid = 'calendar-integration-mother';
const childUid = 'calendar-integration-child';
const parent = { role: 'parent', active: true, canLogin: true, name: 'Sebastian', personKey: 'Sebastian' };
const context = { ...services, uid: parentUid, profile: parent };
const identities = [[parentUid, parent], [motherUid, { ...parent, name: 'Dominika', personKey: 'Dominika' }],
  [childUid, { role: 'child', active: true, canLogin: true, name: 'Nikodem', personKey: 'Nikodem' }]];
const idTokens = new Map();
const connectionsCreated = new Set();
const tokenFixture = { accessToken: 'local-test-access-placeholder', refreshToken: 'local-test-refresh-placeholder', expiresAt: Date.now() + 86400000 };

const eventFixture = (externalEventId = 'event-test', changes = {}) => ({ externalEventId, title: 'Testowe wydarzenie', description: 'Opis syntetyczny', location: 'Miejsce testowe',
  start: Date.parse('2026-10-08T10:00:00Z'), end: Date.parse('2026-10-08T11:00:00Z'), allDay: false, timeZone: 'Europe/Warsaw', cancelled: false, ...changes });
const clientFactory = (events, changes = {}) => () => ({ tokens: () => tokenFixture,
  changes: async () => ({ events, cancelledSeries: [], recurringIds: [], syncToken: 'local-next-cursor', timeZone: 'Europe/Warsaw', ...changes }) });
const sourceRef = id => db.collection('_calendarConnections').doc(id);
const sourceEventRef = (id, collection = 'privateCalendarEvents', externalEventId = 'event-test') => db.collection(collection).doc(googleEventDocumentId(parentUid, id, 'integration-calendar', externalEventId));
const fixed = now => () => now;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function connectionFixture(changes = {}) {
  const id = randomUUID(), now = Date.now(); connectionsCreated.add(id);
  const envelope = encryptCalendarSecrets({ tokens: tokenFixture, syncToken: 'local-old-cursor' }, { uid: parentUid, id, purpose: 'connection' });
  await sourceRef(id).set({ ownerUid: parentUid, provider: 'google', ownerProfileId: childUid, person: 'Nikodem', visibility: 'private', mode: 'sync',
    calendarId: 'integration-calendar', calendarName: 'Kalendarz testowy', timeZone: 'Europe/Warsaw', selectionConfirmed: true,
    status: 'connected', version: randomUUID(), leaseId: null, leaseExpiresAt: null, envelope, createdAt: Timestamp.fromMillis(now), ...changes });
  return { id, now };
}
async function syncFixture(id, now, events = [eventFixture()], extras = {}) {
  return syncGoogleCalendar(context, { connectionId: id }, { clock: fixed(now), clientFactory: clientFactory(events), ...extras });
}
async function clientRead(uid, reference) {
  const response = await fetch(`http://127.0.0.1:8080/v1/projects/demo-nasza-rodzina/databases/(default)/documents/${reference.path}`, {
    headers: { Authorization: `Bearer ${idTokens.get(uid)}` },
  });
  return response.status;
}
async function clientPrivateQuery(uid, ownerUid) {
  const response = await fetch('http://127.0.0.1:8080/v1/projects/demo-nasza-rodzina/databases/(default)/documents:runQuery', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idTokens.get(uid)}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'privateCalendarEvents' }],
      where: { fieldFilter: { field: { fieldPath: 'ownerUid' }, op: 'EQUAL', value: { stringValue: ownerUid } } }, limit: 100 } }),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  for (const [uid, profile] of identities) {
    await services.auth.deleteUser(uid).catch(() => {});
    const email = `${uid}@example.test`;
    await services.auth.createUser({ uid, email, password: 'CalendarEmulatorOnly!2026' });
    await db.collection('members').doc(uid).set(profile);
    const signed = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-calendar-integration', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'CalendarEmulatorOnly!2026', returnSecureToken: true }),
    });
    const payload = await signed.json();
    if (!signed.ok || !payload.idToken) throw new Error('Local calendar integration sign-in failed.');
    idTokens.set(uid, payload.idToken);
  }
});
after(async () => {
  for (const id of connectionsCreated) {
    for (const name of ['calendarEvents', 'privateCalendarEvents']) {
      const rows = await db.collection(name).where('sourceConnectionId', '==', id).get();
      for (const document of rows.docs) await document.ref.delete();
    }
    await sourceRef(id).delete();
  }
  for (const [uid] of identities) {
    await db.collection('members').doc(uid).delete();
    await services.auth.deleteUser(uid).catch(() => {});
  }
  await deleteApp(services.app);
});

test('real imports retain one stable event ID and private ownership even when assigned to a child profile', async () => {
  const { id, now } = await connectionFixture();
  const first = await syncFixture(id, now);
  assert.equal(first.imported, 1);
  const repeated = await syncFixture(id, now + 60001);
  assert.equal(repeated.imported, 0); assert.equal(repeated.changed, 0); assert.equal(repeated.unchanged, 1);
  const rows = await db.collection('privateCalendarEvents').where('sourceConnectionId', '==', id).get();
  assert.equal(rows.size, 1); assert.equal(rows.docs[0].id, sourceEventRef(id).id);
  const stored = rows.docs[0].data();
  assert.equal(stored.person, 'Nikodem'); assert.equal(stored.ownerProfileId, childUid); assert.equal(stored.ownerUid, parentUid); assert.equal(stored.private, true);
  assert.equal((await sourceEventRef(id, 'calendarEvents').get()).exists, false);
  assert.equal(await clientRead(parentUid, sourceEventRef(id)), 200);
  assert.equal(await clientRead(motherUid, sourceEventRef(id)), 403); assert.equal(await clientRead(childUid, sourceEventRef(id)), 403);
  const ownerQuery = await clientPrivateQuery(parentUid, parentUid);
  assert.equal(ownerQuery.status, 200); assert.ok(ownerQuery.body.some(row => row.document?.name.endsWith(sourceEventRef(id).path)));
  assert.equal((await clientPrivateQuery(motherUid, parentUid)).status, 403);
  assert.equal((await clientPrivateQuery(childUid, parentUid)).status, 403);
  const snapshot = (await sourceRef(id).get()).data();
  assert.equal(snapshot.lastSuccessfulSyncAt.toMillis(), now + 60001);
  assert.doesNotMatch(JSON.stringify(snapshot), /local-test-access-placeholder|local-test-refresh-placeholder|local-next-cursor/);
});

test('real private↔family transactions preserve an individual visibility override across source refreshes', async () => {
  const { id, now } = await connectionFixture();
  await syncFixture(id, now);
  await changeGoogleEventVisibility(context, { connectionId: id, eventId: sourceEventRef(id).id, visibility: 'family' }, { clock: fixed(now + 1) });
  assert.equal((await sourceEventRef(id).get()).exists, false);
  assert.equal(await clientRead(childUid, sourceEventRef(id, 'calendarEvents')), 200);
  const changed = await syncFixture(id, now + 60001, [eventFixture('event-test', { title: 'Zmieniony tytuł' })]);
  assert.equal(changed.changed, 1);
  const family = (await sourceEventRef(id, 'calendarEvents').get()).data();
  assert.equal(family.visibilityOverride, 'family'); assert.equal(family.private, false); assert.equal(family.title, 'Zmieniony tytuł');
  assert.equal((await sourceEventRef(id).get()).exists, false);
  await assert.rejects(changeGoogleEventVisibility({ ...context, uid: motherUid }, { connectionId: id, eventId: sourceEventRef(id).id, visibility: 'private' }, { clock: fixed(now + 60002) }), { code: 'CALENDAR_CONNECTION_FORBIDDEN' });
  await changeGoogleEventVisibility(context, { connectionId: id, eventId: sourceEventRef(id).id, visibility: 'private' }, { clock: fixed(now + 60003) });
  await syncFixture(id, now + 120002, [eventFixture('event-test', { title: 'Jeszcze inny tytuł' })]);
  assert.equal((await sourceEventRef(id, 'calendarEvents').get()).exists, false);
  const privateEvent = (await sourceEventRef(id).get()).data();
  assert.equal(privateEvent.visibilityOverride, 'private'); assert.equal(privateEvent.title, 'Jeszcze inny tytuł');
  assert.equal(await clientRead(motherUid, sourceEventRef(id)), 403);
});

test('real simultaneous scheduled/manual calls admit one shared lease and one provider read', async () => {
  const { id, now } = await connectionFixture(), entered = deferred(), finish = deferred();
  let providerReads = 0;
  const blockingClient = () => ({ tokens: () => tokenFixture, changes: async () => {
    providerReads++; entered.resolve(); await finish.promise;
    return { events: [eventFixture()], cancelledSeries: [], recurringIds: [], syncToken: 'local-next-cursor', timeZone: 'Europe/Warsaw' };
  } });
  const options = { clock: fixed(now), clientFactory: blockingClient };
  const scheduled = { ...context, scheduledCalendarSlotStartMs: Math.floor(now / 3600000) * 3600000 };
  const outcomes = Promise.allSettled([syncGoogleCalendar(context, { connectionId: id }, options), syncGoogleCalendar(scheduled, { connectionId: id }, options)]);
  await entered.promise;
  try {
    assert.ok((await sourceRef(id).get()).data().leaseId);
    await assert.rejects(syncFixture(id, now), error => ['CALENDAR_BUSY', 'CALENDAR_RATE_LIMITED'].includes(error.code));
  } finally { finish.resolve(); }
  const results = await outcomes;
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  const rejected = results.find(row => row.status === 'rejected');
  assert.ok(['CALENDAR_BUSY', 'CALENDAR_SCHEDULE_SLOT_CONSUMED', 'CALENDAR_RATE_LIMITED'].includes(rejected.reason.code));
  assert.equal(providerReads, 1);
  assert.equal((await db.collection('privateCalendarEvents').where('sourceConnectionId', '==', id).get()).size, 1);
  assert.equal((await sourceRef(id).get()).data().leaseId, null);
});

test('real wrong-key failure preserves ciphertext/version/cursor and a corrected key can retry safely', async () => {
  const { id, now } = await connectionFixture();
  const before = (await sourceRef(id).get()).data(); let providerReads = 0;
  const neverClient = () => { providerReads++; assert.fail('A wrong key must never reach Google'); };
  process.env.CALENDAR_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString('base64');
  try {
    await assert.rejects(syncFixture(id, now, [], { clientFactory: neverClient }), { code: 'CALENDAR_DECRYPT_FAILED', status: 503 });
  } finally { process.env.CALENDAR_ENCRYPTION_KEY_BASE64 = testKey; }
  const failed = (await sourceRef(id).get()).data();
  assert.equal(providerReads, 0); assert.deepEqual(failed.envelope, before.envelope); assert.equal(failed.version, before.version); assert.equal(failed.status, 'connected');
  assert.equal(failed.lastSuccessfulSyncAt, undefined); assert.equal(failed.leaseId, null); assert.equal(failed.lastErrorCode, 'CALENDAR_DECRYPT_FAILED');
  assert.equal(decryptCalendarSecrets(failed.envelope, { uid: parentUid, id, purpose: 'connection' }).syncToken, 'local-old-cursor');
  assert.equal((await syncFixture(id, now + 60001)).imported, 1);
  assert.equal((await db.collection('privateCalendarEvents').where('sourceConnectionId', '==', id).get()).size, 1);
});

test('real disconnect during provider read invalidates its version and prevents stale writes', async () => {
  const { id, now } = await connectionFixture();
  const before = (await sourceRef(id).get()).data();
  const disconnectingClient = () => ({ tokens: () => tokenFixture, changes: async () => {
    await disconnectGoogleCalendar(context, { connectionId: id, removeEvents: false }, { clock: fixed(now + 1) });
    return { events: [eventFixture()], cancelledSeries: [], recurringIds: [], syncToken: 'local-next-cursor', timeZone: 'Europe/Warsaw' };
  } });
  await assert.rejects(syncFixture(id, now, [], { clientFactory: disconnectingClient }), { code: 'CALENDAR_SYNC_STALE' });
  const disconnected = (await sourceRef(id).get()).data();
  assert.equal(disconnected.status, 'disconnected'); assert.equal(disconnected.envelope, null); assert.notEqual(disconnected.version, before.version);
  assert.equal(disconnected.lastSuccessfulSyncAt, undefined);
  assert.equal((await sourceEventRef(id).get()).exists, false); assert.equal((await sourceEventRef(id, 'calendarEvents').get()).exists, false);
});

test('real selected-profile archival during provider read blocks event writes and does not advance the cursor', async () => {
  const { id, now } = await connectionFixture();
  const before = (await sourceRef(id).get()).data();
  const archiveClient = () => ({ tokens: () => tokenFixture, changes: async () => {
    await db.collection('members').doc(childUid).update({ archived: true });
    return { events: [eventFixture()], cancelledSeries: [], recurringIds: [], syncToken: 'local-next-cursor', timeZone: 'Europe/Warsaw' };
  } });
  try {
    await assert.rejects(syncFixture(id, now, [], { clientFactory: archiveClient }), { code: 'CALENDAR_PROFILE_UNAVAILABLE' });
    const failed = (await sourceRef(id).get()).data();
    assert.deepEqual(failed.envelope, before.envelope); assert.equal(failed.lastSuccessfulSyncAt, undefined); assert.equal(failed.leaseId, null);
    assert.equal(decryptCalendarSecrets(failed.envelope, { uid: parentUid, id, purpose: 'connection' }).syncToken, 'local-old-cursor');
    assert.equal((await sourceEventRef(id).get()).exists, false); assert.equal((await sourceEventRef(id, 'calendarEvents').get()).exists, false);
  } finally { await db.collection('members').doc(childUid).update({ archived: false }); }
});
