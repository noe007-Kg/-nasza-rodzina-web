import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { calendarStatus, changeGoogleEventVisibility, completeCalendarOAuth, configureGoogleCalendar, disconnectGoogleCalendar,
  finalizeCalendarOAuth, parseCalendarOAuthCookie, startCalendarOAuth, syncGoogleCalendar } from '../server/calendar-service.mjs';
import { decryptCalendarSecrets, encryptCalendarSecrets } from '../server/calendar-secrets.mjs';
import { acquireCalendarLease, assertCalendarLease, googleEventDocumentId, upsertGoogleEvents } from '../server/calendar-storage.mjs';
import { googleCalendarClient, normalizeGoogleEvent } from '../server/calendar-google.mjs';
import { calendarChild, calendarConnection, calendarId, calendarMemoryContext, calendarParent, calendarTestEnvironment, googleFixtureEvent, testNow } from './calendar-test-helpers.mjs';

const tokenFixture = { accessToken: 'test-access-placeholder', refreshToken: 'test-refresh-placeholder', expiresAt: testNow + 3600000 };
const refPath = `_calendarConnections/${calendarId}`;
const selection = { ownerProfileId: 'actor', visibility: 'private', mode: 'sync' };
const fixedClock = () => testNow;
const publicStateId = authorizationUrl => new URL(authorizationUrl).searchParams.get('state');
const cookieFrom = result => parseCalendarOAuthCookie(result.cookie);
function connectedContext(changes = {}) {
  return calendarMemoryContext({ [refPath]: calendarConnection({ envelope: encryptCalendarSecrets({ tokens: tokenFixture, syncToken: 'old-cursor' }, { uid: 'actor', id: calendarId, purpose: 'connection' }), ...changes }) });
}
function clientFactory(events, additions = {}) {
  return () => ({ tokens: () => tokenFixture, calendars: async () => [{ id: 'primary-id', name: 'Mój kalendarz', timeZone: 'Europe/Warsaw', primary: true }],
    changes: async () => ({ events, cancelledSeries: [], recurringIds: [], syncToken: 'new-cursor', timeZone: 'Europe/Warsaw', ...additions }) });
}
async function authorize(context, selectionBody = selection, options = {}) {
  const start = await startCalendarOAuth(context, selectionBody, { now: testNow }), cookie = cookieFrom(start), completionId = publicStateId(start.authorizationUrl);
  await completeCalendarOAuth(context, { state: completionId, code: 'test-code-placeholder' }, cookie, { clock: fixedClock, exchange: async () => tokenFixture, ...options });
  return { start, cookie, completionId };
}

test('OAuth requires explicit visibility and links only the initiating Firebase UID once', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = calendarMemoryContext();
    await assert.rejects(startCalendarOAuth(context, { ownerProfileId: 'actor', mode: 'sync' }), { code: 'CALENDAR_INVALID_REQUEST' });
    const { cookie, completionId, start } = await authorize(context);
    assert.match(start.cookie, /HttpOnly; Secure; SameSite=Lax/);
    assert.equal(JSON.stringify([...context.rows.values()]).includes('test-refresh-placeholder'), false);
    await assert.rejects(finalizeCalendarOAuth({ ...context, uid: 'child' }, { completionId }, cookie, { clock: fixedClock }), { code: 'CALENDAR_OAUTH_FORBIDDEN' });
    const result = await finalizeCalendarOAuth(context, { completionId }, cookie, { clock: fixedClock });
    const connection = context.rows.get(`_calendarConnections/${result.connectionId}`);
    assert.equal(connection.ownerUid, 'actor'); assert.equal(connection.selectionConfirmed, false);
    assert.equal(context.rows.has('members/family'), false);
    await assert.rejects(finalizeCalendarOAuth(context, { completionId }, cookie, { clock: fixedClock }), { code: 'CALENDAR_OAUTH_EXPIRED' });
  } finally { restore(); }
});
test('OAuth nonce mismatch, replay and late authorization are rejected before activating a connection', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = calendarMemoryContext(), start = await startCalendarOAuth(context, selection, { now: testNow }), cookie = cookieFrom(start), state = publicStateId(start.authorizationUrl);
    await assert.rejects(completeCalendarOAuth(context, { state, code: 'code' }, { ...cookie, nonce: 'b'.repeat(43) }, { clock: fixedClock, exchange: async () => tokenFixture }), { code: 'CALENDAR_OAUTH_EXPIRED' });
    let now = testNow;
    await assert.rejects(completeCalendarOAuth(context, { state, code: 'code' }, cookie, { clock: () => now, exchange: async () => { now += 600001; return tokenFixture; } }), { code: 'CALENDAR_OAUTH_EXPIRED' });
    assert.equal([...context.rows.keys()].some(path => path.startsWith('_calendarConnections/')), false);
  } finally { restore(); }
});
test('a newer OAuth start invalidates the old browser handshake and is rate-limited', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = calendarMemoryContext(), first = await startCalendarOAuth(context, selection, { now: testNow });
    await assert.rejects(startCalendarOAuth(context, selection, { now: testNow + 1 }), { code: 'CALENDAR_RATE_LIMITED' });
    await startCalendarOAuth(context, selection, { now: testNow + 10001 });
    await assert.rejects(completeCalendarOAuth(context, { state: publicStateId(first.authorizationUrl), code: 'code' }, cookieFrom(first), { clock: () => testNow + 10002, exchange: async () => tokenFixture }), { code: 'CALENDAR_OAUTH_EXPIRED' });
  } finally { restore(); }
});
test('old OAuth cannot reconnect a connection changed after start or after callback', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const changeAfterCallback of [false, true]) {
      const context = connectedContext(), start = await startCalendarOAuth(context, { ...selection, connectionId: calendarId }, { now: testNow }), cookie = cookieFrom(start), state = publicStateId(start.authorizationUrl);
      if (changeAfterCallback) await completeCalendarOAuth(context, { state, code: 'code' }, cookie, { clock: fixedClock, exchange: async () => tokenFixture });
      await disconnectGoogleCalendar(context, { connectionId: calendarId, removeEvents: false }, { clock: fixedClock });
      if (changeAfterCallback) await assert.rejects(finalizeCalendarOAuth(context, { completionId: state }, cookie, { clock: fixedClock }), { code: 'CALENDAR_SYNC_STALE' });
      else await assert.rejects(completeCalendarOAuth(context, { state, code: 'code' }, cookie, { clock: fixedClock, exchange: async () => tokenFixture }), { code: 'CALENDAR_SYNC_STALE' });
      assert.equal(context.rows.get(refPath).status, 'disconnected'); assert.equal(context.rows.get(refPath).envelope, null);
    }
  } finally { restore(); }
});
test('child cannot assign another profile, while parent can assign an active profile without login', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = calendarMemoryContext({ 'members/baby': { name: 'Nowy profil', personKey: `member-${'a'.repeat(24)}`, role: 'child', active: true, canLogin: false } });
    const childContext = { ...context, uid: 'child', profile: calendarChild };
    await assert.rejects(startCalendarOAuth(childContext, selection, { now: testNow }), { code: 'CALENDAR_PROFILE_FORBIDDEN' });
    await startCalendarOAuth(context, { ownerProfileId: 'baby', visibility: 'private', mode: 'sync' }, { now: testNow });
    await startCalendarOAuth(childContext, { ownerProfileId: 'family', visibility: 'family', mode: 'sync' }, { now: testNow });
    for (const bad of [{ active: false }, { archived: true }, { disabled: true }, { personKey: 'invalid' }]) {
      context.rows.set('members/baby', { name: 'Nikodem', personKey: `member-${'a'.repeat(24)}`, role: 'child', active: true, canLogin: false, ...bad });
      await assert.rejects(startCalendarOAuth(context, { ownerProfileId: 'baby', visibility: 'private', mode: 'sync' }, { now: testNow + 10001 }), error => ['CALENDAR_PROFILE_UNAVAILABLE'].includes(error.code));
    }
  } finally { restore(); }
});
test('status is UID scoped, strips encrypted tokens and works with no OAuth configuration', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext(); context.rows.set('_calendarConnections/other', calendarConnection({ ownerUid: 'child', envelope: { secret: true } }));
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID; delete process.env.CALENDAR_ENCRYPTION_KEY_BASE64;
    const result = await calendarStatus(context, {});
    assert.equal(result.configured, false); assert.equal(result.connections.length, 1);
    assert.equal(Object.hasOwn(result.connections[0], 'envelope'), false); assert.equal(Object.hasOwn(result.connections[0], 'leaseId'), false);
  } finally { restore(); }
});
test('new OAuth finalize atomically rejects 30 or more retained sources without changing their history', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const count of [30, 31]) {
      const initial = Object.fromEntries(Array.from({ length: count }, (_, index) => [
        `_calendarConnections/00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        calendarConnection({ status: 'disconnected', envelope: null, calendarId: `retained-${index}` }),
      ]));
      const context = calendarMemoryContext(initial), { cookie, completionId } = await authorize(context);
      const before = [...context.rows].filter(([path]) => path.startsWith('_calendarConnections/'));
      await assert.rejects(finalizeCalendarOAuth(context, { completionId }, cookie, { clock: fixedClock }), { code: 'CALENDAR_SOURCE_HISTORY_LIMIT' });
      assert.deepEqual([...context.rows].filter(([path]) => path.startsWith('_calendarConnections/')), before);
      assert.equal(context.calls.some(call => call.path.startsWith('_calendarConnections/')), false);
    }
  } finally { restore(); }
});
test('reconnect at 30 retained sources reuses its source ID and leaves status usable and secrets private', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext({ status: 'disconnected', envelope: null });
    for (let index = 0; index < 29; index++) context.rows.set(`_calendarConnections/00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      calendarConnection({ status: 'disconnected', envelope: null, calendarId: `retained-${index}` }));
    // Another user's sources never consume this UID's limit or enter its status.
    context.rows.set('_calendarConnections/other-user', calendarConnection({ ownerUid: 'child', status: 'connected', calendarId: 'foreign-calendar', envelope: { private: true } }));
    const { cookie, completionId } = await authorize(context, { ...selection, connectionId: calendarId });
    const result = await finalizeCalendarOAuth(context, { completionId }, cookie, { clock: fixedClock });
    assert.equal(result.connectionId, calendarId);
    const status = await calendarStatus(context, {});
    assert.equal(status.connections.length, 30);
    assert.equal(status.connections.find(row => row.id === calendarId)?.status, 'connected');
    assert.equal(status.connections.some(row => row.calendarId === 'foreign-calendar'), false);
    assert.equal(JSON.stringify(status).includes('test-refresh-placeholder'), false);
    assert.equal(status.connections.some(row => Object.hasOwn(row, 'envelope')), false);
  } finally { restore(); }
});
test('a new source at 29 retained records reaches the readable boundary of 30', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = calendarMemoryContext(Object.fromEntries(Array.from({ length: 29 }, (_, index) => [
      `_calendarConnections/00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      calendarConnection({ status: 'disconnected', envelope: null, calendarId: `retained-${index}` }),
    ])));
    const { cookie, completionId } = await authorize(context);
    const result = await finalizeCalendarOAuth(context, { completionId }, cookie, { clock: fixedClock });
    const status = await calendarStatus(context, {});
    assert.equal(status.connections.length, 30);
    assert.equal(status.connections.filter(row => row.id === result.connectionId).length, 1);
  } finally { restore(); }
});
test('the ten-active-source limit remains independent of the retained-history limit', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = calendarMemoryContext(Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
      `_calendarConnections/00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      calendarConnection({ status: index % 2 ? 'connected' : 'needs-reconnect', calendarId: `active-${index}` }),
    ])));
    const { cookie, completionId } = await authorize(context);
    await assert.rejects(finalizeCalendarOAuth(context, { completionId }, cookie, { clock: fixedClock }), { code: 'CALENDAR_CONNECTION_LIMIT' });
    assert.equal([...context.rows.keys()].filter(path => path.startsWith('_calendarConnections/')).length, 10);
  } finally { restore(); }
});
test('same connection admits one concurrent lease, requires selection, and rejects malformed or expired lease', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext();
    const results = await Promise.allSettled([acquireCalendarLease(context, calendarId, { now: testNow, syncing: true }), acquireCalendarLease(context, calendarId, { now: testNow, syncing: true })]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(results.find(row => row.status === 'rejected').reason.code, 'CALENDAR_BUSY');
    const success = results.find(row => row.status === 'fulfilled').value;
    for (const expiry of [null, undefined, Timestamp.fromMillis(testNow)]) assert.throws(() => assertCalendarLease({ ...success.data, leaseId: success.lease.id, leaseExpiresAt: expiry }, success.lease, testNow), { code: 'CALENDAR_SYNC_STALE' });
    const unselected = connectedContext({ selectionConfirmed: false });
    await assert.rejects(acquireCalendarLease(unselected, calendarId, { now: testNow, syncing: true }), { code: 'CALENDAR_SELECTION_REQUIRED' });
    const malformed = connectedContext({ leaseId: 'existing-lease', leaseExpiresAt: null });
    await assert.rejects(acquireCalendarLease(malformed, calendarId, { now: testNow, syncing: true }), { code: 'CALENDAR_BUSY' });
  } finally { restore(); }
});
test('idempotent imports preserve private ownership even when assigned to a different child profile', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext({ ownerProfileId: 'child', person: 'Nikodem' });
    const first = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory([googleFixtureEvent()]) });
    assert.equal(first.imported, 1); const id = googleEventDocumentId('actor', calendarId, 'primary-id', 'event-1'), event = context.rows.get(`privateCalendarEvents/${id}`);
    assert.equal(event.ownerUid, 'actor'); assert.equal(event.person, 'Nikodem'); assert.equal(event.private, true); assert.equal(context.rows.has(`calendarEvents/${id}`), false);
    const second = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001, clientFactory: clientFactory([googleFixtureEvent()]) });
    assert.equal(second.imported, 0); assert.equal(second.changed, 0); assert.equal(second.unchanged, 1);
  } finally { restore(); }
});
test('individual visibility override survives source refresh and is atomic across both collections', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext();
    await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory([googleFixtureEvent()]) });
    const id = googleEventDocumentId('actor', calendarId, 'primary-id', 'event-1');
    await changeGoogleEventVisibility(context, { connectionId: calendarId, eventId: id, visibility: 'family' }, { now: testNow });
    assert.equal(context.rows.has(`privateCalendarEvents/${id}`), false);
    await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001, clientFactory: clientFactory([googleFixtureEvent('event-1', { title: 'Nowy tytuł' })]) });
    const event = context.rows.get(`calendarEvents/${id}`); assert.equal(event.title, 'Nowy tytuł'); assert.equal(event.private, false); assert.equal(event.visibilityOverride, 'family');
    await assert.rejects(changeGoogleEventVisibility({ ...context, uid: 'child' }, { connectionId: calendarId, eventId: id, visibility: 'private' }), { code: 'CALENDAR_CONNECTION_FORBIDDEN' });
  } finally { restore(); }
});
test('all-day source DATEs survive import, individual privacy change and cancellation without changing real DST duration', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext();
    const incoming = normalizeGoogleEvent({ id: 'midnight-gap', summary: 'Cały dzień', start: { date: '2018-11-04', timeZone: null }, end: { date: '2018-11-05' } }, 'America/Sao_Paulo');
    await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory([incoming]) });
    const id = googleEventDocumentId('actor', calendarId, 'primary-id', incoming.externalEventId);
    const imported = context.rows.get(`privateCalendarEvents/${id}`);
    assert.equal(imported.sourceStartDate, '2018-11-04'); assert.equal(imported.sourceEndDateExclusive, '2018-11-05');
    assert.equal(imported.endDate.toMillis() - imported.date.toMillis() + 1, 23 * 3600000);
    await changeGoogleEventVisibility(context, { connectionId: calendarId, eventId: id, visibility: 'family' }, { clock: fixedClock });
    const repeated = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001, clientFactory: clientFactory([incoming]) });
    assert.equal(repeated.unchanged, 1);
    const cancelled = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 120002, clientFactory: clientFactory([{ externalEventId: incoming.externalEventId, cancelled: true }]) });
    assert.equal(cancelled.cancelled, 1);
    const saved = context.rows.get(`calendarEvents/${id}`);
    assert.equal(saved.sourceStartDate, '2018-11-04'); assert.equal(saved.sourceEndDateExclusive, '2018-11-05');
    assert.equal(saved.visibilityOverride, 'family'); assert.equal(saved.endDate.toMillis() - saved.date.toMillis() + 1, 23 * 3600000);
  } finally { restore(); }
});
test('deleted event stays ODWOŁANE with original details and is deduplicated on later sync', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext(); await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory([googleFixtureEvent()]) });
    const result = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001, clientFactory: clientFactory([{ externalEventId: 'event-1', cancelled: true }]) });
    assert.equal(result.cancelled, 1); const id = googleEventDocumentId('actor', calendarId, 'primary-id', 'event-1');
    assert.equal(context.rows.get(`privateCalendarEvents/${id}`).title, 'Wizyta'); assert.equal(context.rows.get(`privateCalendarEvents/${id}`).cancelled, true);
    const repeated = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 120002, clientFactory: clientFactory([{ externalEventId: 'event-1', cancelled: true }]) });
    assert.equal(repeated.cancelled, 0); assert.equal(repeated.unchanged, 1);
  } finally { restore(); }
});
test('shorter fully-read recurring window cancels only missing instances inside that window', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext(), events = [1, 2, 3].map(n => googleFixtureEvent(`instance-${n}`, { externalSeriesId: 'series', start: testNow + n * 86400000, end: testNow + n * 86400000 + 3600000 }));
    events.push(googleFixtureEvent('outside-window', { externalSeriesId: 'series', start: testNow + 500 * 86400000, end: testNow + 500 * 86400000 + 3600000 }));
    await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory(events) });
    const metadata = { authoritativeSeries: ['series'], windowStart: testNow, windowEnd: testNow + 366 * 86400000 };
    const second = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001, clientFactory: clientFactory(events.slice(0, 2), metadata) });
    assert.equal(second.cancelled, 1);
    const id = name => `privateCalendarEvents/${googleEventDocumentId('actor', calendarId, 'primary-id', name)}`;
    assert.equal(context.rows.get(id('instance-3')).cancelled, true); assert.equal(context.rows.get(id('outside-window')).cancelled, false);
    const third = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 120002, clientFactory: clientFactory(events.slice(0, 2), metadata) });
    assert.equal(third.cancelled, 0); assert.equal(third.changed, 0);
  } finally { restore(); }
});
test('partial import locks source identity without advancing cursor or last successful sync', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext(), events = Array.from({ length: 101 }, (_, n) => googleFixtureEvent(`event-${n}`));
    const lastId = googleEventDocumentId('actor', calendarId, 'primary-id', 'event-100');
    context.controls.beforeGet = async ref => { if (ref.path === `privateCalendarEvents/${lastId}`) throw new Error('Simulated chunk failure'); };
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory(events) }));
    assert.equal(context.rows.get(refPath).hasEvents, true);
    assert.equal([...context.rows.keys()].filter(path => path.startsWith('privateCalendarEvents/')).length, 100);
    assert.equal(context.rows.get(refPath).lastSuccessfulSyncAt, undefined);
    assert.equal(decryptCalendarSecrets(context.rows.get(refPath).envelope, { uid: 'actor', id: calendarId, purpose: 'connection' }).syncToken, 'old-cursor');
    context.controls.beforeGet = null;
    await assert.rejects(configureGoogleCalendar(context, { connectionId: calendarId, calendarId: 'primary-id', ownerProfileId: 'child', visibility: 'private', mode: 'sync' }, { clock: () => testNow + 60001, clientFactory: clientFactory([]) }), { code: 'CALENDAR_SOURCE_LOCKED' });
  } finally { restore(); }
});
test('complete full snapshot cancels a missing standalone once without altering kept records or visibility', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext(), records = [googleFixtureEvent('kept'), googleFixtureEvent('missing')];
    await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory(records) });
    const missingId = googleEventDocumentId('actor', calendarId, 'primary-id', 'missing');
    await changeGoogleEventVisibility(context, { connectionId: calendarId, eventId: missingId, visibility: 'family' }, { now: testNow });
    const metadata = { fullSnapshotComplete: true, authoritativeStandaloneIds: ['kept'] };
    const result = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001, clientFactory: clientFactory(records.slice(0, 1), metadata) });
    assert.equal(result.cancelled, 1);
    const row = context.rows.get(`calendarEvents/${missingId}`); assert.equal(row.title, 'Wizyta'); assert.equal(row.cancelled, true); assert.equal(row.private, false);
    assert.equal(context.rows.has(`privateCalendarEvents/${missingId}`), false);
    const again = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 120002, clientFactory: clientFactory(records.slice(0, 1), metadata) });
    assert.equal(again.cancelled, 0); assert.equal(again.changed, 0);
  } finally { restore(); }
});
test('standalone to recurring conversion cancels old standalone and preserves active instances', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext();
    await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory([googleFixtureEvent('series')]) });
    const result = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001,
      clientFactory: clientFactory([googleFixtureEvent('instance', { externalSeriesId: 'series' })], { recurringIds: ['series'], authoritativeSeries: ['series'], windowStart: testNow, windowEnd: testNow + 366 * 86400000 }) });
    assert.equal(result.imported, 1); assert.equal(result.cancelled, 1);
    const path = id => `privateCalendarEvents/${googleEventDocumentId('actor', calendarId, 'primary-id', id)}`;
    assert.equal(context.rows.get(path('series')).cancelled, true); assert.equal(context.rows.get(path('instance')).cancelled, false);
  } finally { restore(); }
});
test('full snapshot reconciles partial-import instances even when the old master IDs were not persisted', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext(), acquired = await acquireCalendarLease(context, calendarId, { now: testNow, syncing: true });
    const events = [googleFixtureEvent('partial-instance', { externalSeriesId: 'uncommitted-series' }),
      googleFixtureEvent('outside-instance', { externalSeriesId: 'uncommitted-series', start: testNow + 500 * 86400000, end: testNow + 500 * 86400000 + 3600000 })];
    await upsertGoogleEvents(context, acquired.data, acquired.lease, events, { now: testNow, clock: fixedClock });
    const partial = context.rows.get(refPath); context.rows.set(refPath, { ...partial, leaseId: null, leaseExpiresAt: null, recurringIds: [] });
    const result = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001,
      clientFactory: clientFactory([], { fullSnapshotComplete: true, authoritativeStandaloneIds: [], windowStart: testNow, windowEnd: testNow + 366 * 86400000 }) });
    assert.equal(result.cancelled, 1);
    const path = id => `privateCalendarEvents/${googleEventDocumentId('actor', calendarId, 'primary-id', id)}`;
    assert.equal(context.rows.get(path('partial-instance')).cancelled, true); assert.equal(context.rows.get(path('outside-instance')).cancelled, false);
  } finally { restore(); }
});
test('a refreshed token survives later provider failure while cursor and successful time stay unchanged', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext({ envelope: encryptCalendarSecrets({ tokens: { ...tokenFixture, expiresAt: testNow }, syncToken: 'old-cursor' }, { uid: 'actor', id: calendarId, purpose: 'connection' }) });
    let requests = 0;
    const fetchImpl = async url => {
      requests++;
      const body = url === 'https://oauth2.googleapis.com/token'
        ? { access_token: 'test-rotated-access', refresh_token: 'test-rotated-placeholder', token_type: 'Bearer', expires_in: 3600 }
        : new URL(url).searchParams.has('pageToken') ? {} : { items: [], nextPageToken: 'second-page' };
      return new Response(JSON.stringify(body), { status: new URL(url).searchParams.has('pageToken') ? 429 : 200 });
    };
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock,
      clientFactory: (config, tokens, options) => googleCalendarClient(config, tokens, { ...options, fetchImpl }) }), { code: 'CALENDAR_PROVIDER_RATE_LIMITED' });
    assert.equal(requests, 3);
    const data = context.rows.get(refPath), secrets = decryptCalendarSecrets(data.envelope, { uid: 'actor', id: calendarId, purpose: 'connection' });
    assert.equal(secrets.tokens.refreshToken, 'test-rotated-placeholder'); assert.equal(secrets.syncToken, 'old-cursor'); assert.equal(data.lastSuccessfulSyncAt, undefined);
    assert.equal([...context.rows.keys()].some(path => path.startsWith('privateCalendarEvents/')), false);
  } finally { restore(); }
});
test('disconnect during provider read prevents stale writes and token resurrection', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext();
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: () => ({ tokens: () => tokenFixture,
      changes: async () => { await disconnectGoogleCalendar(context, { connectionId: calendarId, removeEvents: false }, { clock: fixedClock }); return { events: [googleFixtureEvent()], cancelledSeries: [], recurringIds: [], syncToken: 'new' }; } }) }), { code: 'CALENDAR_SYNC_STALE' });
    assert.equal(context.rows.get(refPath).envelope, null); assert.equal(context.rows.get(refPath).status, 'disconnected');
    assert.equal([...context.rows.keys()].some(path => path.startsWith('privateCalendarEvents/')), false);
  } finally { restore(); }
});
test('expiry crossed during final event reads aborts the whole chunk before writes', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext(), acquired = await acquireCalendarLease(context, calendarId, { now: testNow, syncing: true });
    let now = testNow + 119999;
    context.controls.beforeGet = async ref => { if (ref.path?.startsWith('privateCalendarEvents/')) now = testNow + 120001; };
    await assert.rejects(upsertGoogleEvents(context, acquired.data, acquired.lease, [googleFixtureEvent()], { now: testNow, clock: () => now }), { code: 'CALENDAR_SYNC_STALE' });
    assert.equal([...context.rows.keys()].some(path => path.startsWith('privateCalendarEvents/')), false);
  } finally { restore(); }
});
test('disconnect leaves or removes only its source while preserving unrelated manual history', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const removeEvents of [false, true]) {
      const context = connectedContext(); await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory([googleFixtureEvent()]) });
      context.rows.set('calendarEvents/manual', { title: 'Rodzinne', createdBy: 'actor', source: 'manual' });
      const result = await disconnectGoogleCalendar(context, { connectionId: calendarId, removeEvents }, { clock: fixedClock });
      assert.equal(result.removed, removeEvents ? 1 : 0); assert.equal(context.rows.has('calendarEvents/manual'), true); assert.equal(context.rows.get(refPath).envelope, null);
      assert.equal([...context.rows.keys()].filter(path => path.startsWith('privateCalendarEvents/')).length, removeEvents ? 0 : 1);
    }
  } finally { restore(); }
});
test('disconnect deletion fences visibility and reconnect after source snapshot and clears the fence after success', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext(); await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory([googleFixtureEvent()]) });
    const id = googleEventDocumentId('actor', calendarId, 'primary-id', 'event-1');
    let attempts = 0; const pending = [];
    context.controls.beforeQuery = async name => {
      if (name !== 'calendarEvents') return;
      attempts++;
      pending.push(assert.rejects(changeGoogleEventVisibility(context, { connectionId: calendarId, eventId: id, visibility: 'family' }, { clock: fixedClock }), { code: 'CALENDAR_BUSY' }));
      pending.push(assert.rejects(startCalendarOAuth(context, { ...selection, connectionId: calendarId }, { now: testNow }), { code: 'CALENDAR_BUSY' }));
    };
    const result = await disconnectGoogleCalendar(context, { connectionId: calendarId, removeEvents: true }, { clock: fixedClock });
    await Promise.all(pending);
    assert.equal(attempts, 1); assert.equal(result.removed, 1);
    assert.equal(context.rows.has(`privateCalendarEvents/${id}`), false); assert.equal(context.rows.has(`calendarEvents/${id}`), false);
    assert.equal(context.rows.get(refPath).removingEvents, false); assert.equal(context.rows.get(refPath).hasEvents, false);
  } finally { restore(); }
});
test('expired deletion fence prevents stale deletion and unlocks retained history for retry or visibility', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext(); await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory([googleFixtureEvent()]) });
    const id = googleEventDocumentId('actor', calendarId, 'primary-id', 'event-1'); let now = testNow;
    context.controls.beforeGet = async ref => { if (ref.path === `privateCalendarEvents/${id}`) now = testNow + 120001; };
    await assert.rejects(disconnectGoogleCalendar(context, { connectionId: calendarId, removeEvents: true }, { clock: () => now }), { code: 'CALENDAR_SYNC_STALE' });
    assert.equal(context.rows.has(`privateCalendarEvents/${id}`), true); assert.equal(context.rows.get(refPath).removingEvents, false); assert.equal(context.rows.get(refPath).hasEvents, true);
    context.controls.beforeGet = null;
    await changeGoogleEventVisibility(context, { connectionId: calendarId, eventId: id, visibility: 'family' }, { clock: () => now });
    assert.equal(context.rows.has(`calendarEvents/${id}`), true); assert.equal(context.rows.has(`privateCalendarEvents/${id}`), false);
  } finally { restore(); }
});
test('one-time import discards tokens and cannot be synchronized again', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext({ mode: 'import' }); await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: clientFactory([googleFixtureEvent()]) });
    assert.equal(context.rows.get(refPath).status, 'imported'); assert.equal(context.rows.get(refPath).envelope, null);
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001, clientFactory: clientFactory([]) }), { code: 'CALENDAR_RECONNECT_REQUIRED' });
  } finally { restore(); }
});
test('revoked actor and target are rechecked inside every import transaction', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const archivedTarget of [false, true]) {
      const context = connectedContext({ ownerProfileId: 'child', person: 'Nikodem' });
      await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: () => ({ tokens: () => tokenFixture, changes: async () => {
        context.rows.set(archivedTarget ? 'members/child' : 'members/actor', archivedTarget ? { ...calendarChild, archived: true } : { ...calendarParent, active: false });
        return { events: [googleFixtureEvent()], cancelledSeries: [], recurringIds: [], syncToken: 'new' };
      } }) }), { code: archivedTarget ? 'CALENDAR_PROFILE_UNAVAILABLE' : 'CALENDAR_MEMBER_REQUIRED' });
      assert.equal([...context.rows.keys()].some(path => path.startsWith('privateCalendarEvents/')), false);
    }
  } finally { restore(); }
});

for (const target of [false, true]) test(`disabled ${target ? 'target profile' : 'actor'} blocks an import after a provider read`, async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext({ ownerProfileId: 'child', person: 'Nikodem', lastSuccessfulSyncAt: Timestamp.fromMillis(testNow - 3600000) });
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: () => ({ tokens: () => tokenFixture, changes: async () => {
      const path = target ? 'members/child' : 'members/actor';
      context.rows.set(path, { ...context.rows.get(path), disabled: true });
      return { events: [googleFixtureEvent()], cancelledSeries: [], recurringIds: [], syncToken: 'new-cursor' };
    } }) }), { code: target ? 'CALENDAR_PROFILE_UNAVAILABLE' : 'CALENDAR_MEMBER_REQUIRED' });
    assert.equal([...context.rows.keys()].some(path => path.startsWith('privateCalendarEvents/') || path.startsWith('calendarEvents/')), false);
    const connection = context.rows.get(refPath);
    assert.equal(connection.lastSuccessfulSyncAt.toMillis(), testNow - 3600000);
    assert.equal(decryptCalendarSecrets(connection.envelope, { uid: 'actor', id: calendarId, purpose: 'connection' }).syncToken, 'old-cursor');
    assert.equal(connection.leaseId, null);
  } finally { restore(); }
});

for (const problem of ['wrong-key', 'wrong-key-id', 'malformed-envelope']) test(`local ${problem} preserves the connection and never contacts Google`, async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext({ lastSuccessfulSyncAt: Timestamp.fromMillis(testNow - 3600000) });
    const configuration = { key: process.env.CALENDAR_ENCRYPTION_KEY_BASE64, id: process.env.CALENDAR_ENCRYPTION_KEY_ID };
    if (problem === 'wrong-key') process.env.CALENDAR_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 62).toString('base64');
    if (problem === 'wrong-key-id') process.env.CALENDAR_ENCRYPTION_KEY_ID = 'another-fixture';
    if (problem === 'malformed-envelope') context.rows.set(refPath, { ...context.rows.get(refPath), envelope: { ...context.rows.get(refPath).envelope, nonce: 'invalid' } });
    const before = context.rows.get(refPath);
    let providerCalls = 0;
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: () => { providerCalls++; throw new Error('Provider must not be contacted'); } }), { code: 'CALENDAR_DECRYPT_FAILED', status: 503 });
    const after = context.rows.get(refPath);
    assert.equal(providerCalls, 0);
    for (const field of ['envelope', 'status', 'version', 'lastSuccessfulSyncAt']) assert.deepEqual(after[field], before[field]);
    assert.equal(after.lastErrorCode, 'CALENDAR_DECRYPT_FAILED'); assert.equal(after.leaseId, null);
    assert.equal([...context.rows.keys()].some(path => path.startsWith('privateCalendarEvents/') || path.startsWith('calendarEvents/')), false);
    Object.assign(process.env, { CALENDAR_ENCRYPTION_KEY_BASE64: configuration.key, CALENDAR_ENCRYPTION_KEY_ID: configuration.id });
    if (problem !== 'malformed-envelope') {
      const result = await syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow + 60001, clientFactory: clientFactory([googleFixtureEvent()]) });
      assert.equal(result.imported, 1); assert.equal(context.rows.get(refPath).version, before.version);
      assert.equal(context.rows.get(refPath).lastErrorCode, null);
      assert.equal(decryptCalendarSecrets(context.rows.get(refPath).envelope, { uid: 'actor', id: calendarId, purpose: 'connection' }).syncToken, 'new-cursor');
    }
  } finally { restore(); }
});

test('provider-confirmed invalid_grant requires reconnect while keeping imported history', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext({ envelope: encryptCalendarSecrets({ tokens: { ...tokenFixture, expiresAt: testNow }, syncToken: 'old-cursor' }, { uid: 'actor', id: calendarId, purpose: 'connection' }) });
    const historyPath = 'privateCalendarEvents/prior-history'; context.rows.set(historyPath, { title: 'Existing history' });
    let providerCalls = 0;
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: (config, tokens) => googleCalendarClient(config, tokens, { now: testNow, fetchImpl: async () => {
      providerCalls++; return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    } }) }), { code: 'CALENDAR_RECONNECT_REQUIRED' });
    assert.equal(providerCalls, 1); assert.equal(context.rows.get(refPath).status, 'needs-reconnect');
    assert.equal(context.rows.get(refPath).envelope, null); assert.equal(context.rows.get(historyPath).title, 'Existing history');
  } finally { restore(); }
});

test('malformed successful token response preserves encrypted credentials and the old cursor', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = connectedContext({ envelope: encryptCalendarSecrets({ tokens: { ...tokenFixture, expiresAt: testNow }, syncToken: 'old-cursor' }, { uid: 'actor', id: calendarId, purpose: 'connection' }) });
    const before = context.rows.get(refPath);
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: fixedClock, clientFactory: (config, tokens) => googleCalendarClient(config, tokens, { now: testNow, fetchImpl: async () =>
      new Response(JSON.stringify({ token_type: 'Bearer', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }) }), { code: 'CALENDAR_PROVIDER_DATA' });
    const after = context.rows.get(refPath);
    assert.equal(after.version, before.version); assert.equal(after.status, 'connected'); assert.equal(after.leaseId, null);
    assert.deepEqual(decryptCalendarSecrets(after.envelope, { uid: 'actor', id: calendarId, purpose: 'connection' }), decryptCalendarSecrets(before.envelope, { uid: 'actor', id: calendarId, purpose: 'connection' }));
  } finally { restore(); }
});
