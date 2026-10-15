import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { acquireCalendarLease, assertCalendarSelection, googleEventDocumentId, sourceCalendarDocuments, upsertGoogleEvents } from '../server/calendar-storage.mjs';
import { calendarStatus, changeGoogleEventVisibility, completeCalendarOAuth, disconnectGoogleCalendar, finalizeCalendarOAuth, parseCalendarOAuthCookie, startCalendarOAuth, syncGoogleCalendar } from '../server/calendar-service.mjs';
import { runScheduledGoogleCalendarSync } from '../server/calendar-scheduler.mjs';
import { encryptCalendarSecrets } from '../server/calendar-secrets.mjs';
import { calendarConnection, calendarId, calendarMemoryContext, calendarParent, calendarChild, calendarTestEnvironment, googleFixtureEvent, testNow } from './calendar-test-helpers.mjs';

const household = calendarParent.familyId, foreignHousehold = 'independent-household';
const refPath = `_calendarConnections/${calendarId}`;
const binding = { uid: 'actor', id: calendarId, purpose: 'connection' };
const tokens = { accessToken: 'synthetic-only-access', refreshToken: 'synthetic-only-refresh', expiresAt: testNow + 3600000 };
const clock = () => testNow;
const eventId = googleEventDocumentId('actor', calendarId, 'primary-id', 'event-1');
const privatePath = `privateCalendarEvents/${eventId}`, familyPath = `calendarEvents/${eventId}`;
const context = changes => calendarMemoryContext({ [refPath]: calendarConnection({ envelope: encryptCalendarSecrets({ tokens }, binding), ...changes }) });
const sourceEvent = changes => ({ familyId: household, source: 'google', sourceConnectionId: calendarId, sourceOwnerUid: 'actor', ownerUid: 'actor', createdBy: 'actor', ownerProfileId: 'actor', externalCalendarId: 'primary-id', externalEventId: 'event-1', private: true, title: 'Synthetic private event', ...changes });
const syncOptions = extra => ({ clock, clientFactory: () => ({ tokens: () => tokens, changes: async () => ({ events: [googleFixtureEvent()], cancelledSeries: [], recurringIds: [], syncToken: 'synthetic-cursor', timeZone: 'Europe/Warsaw', ...extra }) }) });
let restore;
beforeEach(() => { restore = calendarTestEnvironment(); });
afterEach(() => restore());

for (const familyId of [undefined, null, '__legacy__', ' invalid']) test(`unassigned actor ${String(familyId)} cannot list, acquire a lease or start OAuth`, async () => {
  const ctx = context(); ctx.rows.set('members/actor', { ...calendarParent, familyId }); ctx.profile = ctx.rows.get('members/actor');
  await assert.rejects(calendarStatus(ctx, {}), { code: 'CALENDAR_FAMILY_REQUIRED' });
  await assert.rejects(acquireCalendarLease(ctx, calendarId, { now: testNow }), { code: 'CALENDAR_FAMILY_REQUIRED' });
  await assert.rejects(startCalendarOAuth(ctx, { ownerProfileId: 'actor', visibility: 'private', mode: 'sync' }, { now: testNow }), { code: 'CALENDAR_FAMILY_REQUIRED' });
  assert.equal(ctx.calls.length, 0);
});

test('a parent cannot assign a source to an active child of another household', async () => {
  const ctx = context({ ownerProfileId: 'foreign-child', person: 'Nikodem' });
  ctx.rows.set('members/foreign-child', { ...calendarChild, familyId: foreignHousehold });
  await assert.rejects(acquireCalendarLease(ctx, calendarId, { now: testNow }), { code: 'CALENDAR_PROFILE_FORBIDDEN' });
  await assert.rejects(ctx.db.runTransaction(tx => assertCalendarSelection(tx, ctx, calendarParent, { ownerProfileId: 'foreign-child' })), { code: 'CALENDAR_PROFILE_FORBIDDEN' });
  assert.equal(ctx.calls.length, 0);
});

test('same-household passive profiles remain valid selections without requiring a login', async () => {
  const ctx = context({ ownerProfileId: 'child' });
  ctx.rows.set('members/child', { ...calendarChild, canLogin: false });
  const acquired = await acquireCalendarLease(ctx, calendarId, { now: testNow });
  assert.equal(acquired.data.familyId, household);
});

for (const familyId of [foreignHousehold, '__legacy__', null]) test(`explicit source family ${String(familyId)} cannot be listed, synchronized or disconnected`, async () => {
  const ctx = context({ familyId });
  await assert.rejects(calendarStatus(ctx, {}), { code: 'CALENDAR_CONNECTION_FORBIDDEN' });
  await assert.rejects(syncGoogleCalendar(ctx, { connectionId: calendarId }, { clock, clientFactory: () => assert.fail('No provider calls before household authorization') }), { code: 'CALENDAR_CONNECTION_FORBIDDEN' });
  await assert.rejects(disconnectGoogleCalendar(ctx, { connectionId: calendarId, removeEvents: true }, { clock }), { code: 'CALENDAR_CONNECTION_FORBIDDEN' });
  assert.equal(ctx.calls.length, 0);
});

test('an old UID-owned connection is retained and stamps the verified family only under its owner lease', async () => {
  const ctx = context(); const original = ctx.rows.get(refPath); delete original.familyId;
  const envelope = original.envelope;
  assert.equal((await calendarStatus(ctx, {})).connections.length, 1);
  const acquired = await acquireCalendarLease(ctx, calendarId, { now: testNow });
  assert.equal(acquired.data.familyId, household); assert.equal(ctx.rows.get(refPath).familyId, household);
  assert.deepEqual(ctx.rows.get(refPath).envelope, envelope);
  const other = { ...ctx, uid: 'child', profile: calendarChild };
  await assert.rejects(acquireCalendarLease(other, calendarId, { now: testNow }), { code: 'CALENDAR_CONNECTION_FORBIDDEN' });
});

test('another parent in the same household cannot read a private Google connection or change its private event', async () => {
  const ctx = context(); ctx.rows.set('members/mother', { ...calendarParent, personKey: 'Dominika', name: 'Dominika' });
  ctx.rows.set(privatePath, sourceEvent());
  const mother = { ...ctx, uid: 'mother', profile: ctx.rows.get('members/mother') };
  assert.equal((await calendarStatus(mother, {})).connections.length, 0);
  await assert.rejects(changeGoogleEventVisibility(mother, { connectionId: calendarId, eventId, visibility: 'family' }, { clock }), { code: 'CALENDAR_CONNECTION_FORBIDDEN' });
  assert.equal(ctx.calls.length, 0); assert.equal(ctx.rows.has(familyPath), false);
});

for (const familyId of [foreignHousehold, undefined, '__legacy__']) test(`an event with family ${String(familyId)} cannot be moved, overwritten or deleted through an owned source`, async () => {
  const ctx = context(); ctx.rows.set(privatePath, sourceEvent({ familyId }));
  const original = ctx.rows.get(privatePath);
  await assert.rejects(changeGoogleEventVisibility(ctx, { connectionId: calendarId, eventId, visibility: 'family' }, { clock }), { code: 'CALENDAR_EVENT_FORBIDDEN' });
  assert.equal(ctx.calls.length, 0); assert.equal(ctx.rows.has(familyPath), false);
  const { data, lease } = await acquireCalendarLease(ctx, calendarId, { now: testNow });
  await assert.rejects(upsertGoogleEvents(ctx, data, lease, [googleFixtureEvent()], { clock, now: testNow }), { code: 'CALENDAR_EVENT_CONFLICT' });
  await assert.rejects(sourceCalendarDocuments(ctx, calendarId), { code: 'CALENDAR_EVENT_CONFLICT' });
  await assert.rejects(disconnectGoogleCalendar(ctx, { connectionId: calendarId, removeEvents: true }, { clock }), { code: 'CALENDAR_EVENT_CONFLICT' });
  assert.deepEqual(ctx.rows.get(privatePath), original);
  assert.equal(ctx.calls.some(call => call.path === privatePath), false);
});

test('source identity cannot borrow an event from another calendar even when its owner/family match', async () => {
  const ctx = context(); ctx.rows.set(familyPath, sourceEvent({ private: false, externalCalendarId: 'different-calendar' }));
  await assert.rejects(sourceCalendarDocuments(ctx, calendarId), { code: 'CALENDAR_EVENT_CONFLICT' });
  assert.equal(ctx.calls.length, 0);
});

test('new Google records share a family stamp, remain private, and preserve an explicit family visibility move', async () => {
  const ctx = context(); const first = await syncGoogleCalendar(ctx, { connectionId: calendarId }, syncOptions());
  assert.equal(first.imported, 1); assert.equal(ctx.rows.get(privatePath).familyId, household); assert.equal(ctx.rows.get(privatePath).private, true);
  await changeGoogleEventVisibility(ctx, { connectionId: calendarId, eventId, visibility: 'family' }, { clock });
  assert.equal(ctx.rows.get(familyPath).familyId, household); assert.equal(ctx.rows.get(familyPath).ownerUid, 'actor');
  const second = await syncGoogleCalendar(ctx, { connectionId: calendarId }, { ...syncOptions(), clock: () => testNow + 60001 });
  assert.equal(second.unchanged, 1); assert.equal(ctx.rows.get(familyPath).visibilityOverride, 'family'); assert.equal(ctx.rows.has(privatePath), false);
});

test('fresh household changes during provider IO abort imports and leave foreign family data untouched', async () => {
  const ctx = context();
  const options = syncOptions();
  options.clientFactory = () => ({ tokens: () => tokens, changes: async () => {
    ctx.rows.set('members/actor', { ...calendarParent, familyId: foreignHousehold });
    return { events: [googleFixtureEvent()], cancelledSeries: [], recurringIds: [], syncToken: 'never-persist-this-cursor', timeZone: 'Europe/Warsaw' };
  } });
  const originalEnvelope = ctx.rows.get(refPath).envelope;
  await assert.rejects(syncGoogleCalendar(ctx, { connectionId: calendarId }, options), { code: 'CALENDAR_FAMILY_REQUIRED' });
  assert.equal(ctx.rows.has(privatePath), false); assert.equal(ctx.rows.has(familyPath), false);
  assert.deepEqual(ctx.rows.get(refPath).envelope, originalEnvelope);
  assert.equal(ctx.rows.get(refPath).lastSuccessfulSyncAt, undefined);
});

test('OAuth state pins its initiating household and rejects a moved actor before exchanging the code', async () => {
  const ctx = context(); const selection = { ownerProfileId: 'actor', visibility: 'private', mode: 'sync' };
  const started = await startCalendarOAuth(ctx, selection, { now: testNow });
  const state = new URL(started.authorizationUrl).searchParams.get('state'), cookie = parseCalendarOAuthCookie(started.cookie);
  const states = [...ctx.rows.entries()].filter(([path]) => path.startsWith('_calendarOAuthStates/'));
  assert.equal(states[0][1].familyId, household);
  ctx.rows.set('members/actor', { ...calendarParent, familyId: foreignHousehold });
  await assert.rejects(completeCalendarOAuth({ db: ctx.db }, { state, code: 'synthetic-code' }, cookie, { clock, exchange: async () => assert.fail('No exchange after household change') }), { code: 'CALENDAR_CONNECTION_FORBIDDEN' });
});

test('new OAuth connection records receive the same verified family as their state and initiating UID', async () => {
  const ctx = calendarMemoryContext();
  const started = await startCalendarOAuth(ctx, { ownerProfileId: 'actor', visibility: 'private', mode: 'sync' }, { now: testNow });
  const state = new URL(started.authorizationUrl).searchParams.get('state'), cookie = parseCalendarOAuthCookie(started.cookie);
  await completeCalendarOAuth({ db: ctx.db }, { state, code: 'synthetic-code' }, cookie, { clock, exchange: async () => tokens });
  const finished = await finalizeCalendarOAuth(ctx, { completionId: state }, cookie, { clock });
  const saved = ctx.rows.get(`_calendarConnections/${finished.connectionId}`);
  assert.equal(saved.familyId, household); assert.equal(saved.ownerUid, 'actor'); assert.equal(saved.visibility, 'private');
});

for (const change of ['foreign-source', 'foreign-target', 'unassigned-owner']) test(`scheduler skips ${change} before calling the sync service`, async () => {
  const ctx = context(change === 'foreign-source' ? { familyId: foreignHousehold } : change === 'foreign-target' ? { ownerProfileId: 'child' } : {});
  if (change === 'foreign-target') ctx.rows.set('members/child', { ...calendarChild, familyId: foreignHousehold });
  if (change === 'unassigned-owner') ctx.rows.set('members/actor', { ...calendarParent, familyId: '__legacy__' });
  ctx.auth = { getUser: async uid => ({ uid, disabled: false }) };
  const result = await runScheduledGoogleCalendarSync(ctx, { scheduleTime: new Date(testNow).toISOString() }, { clock, configured: () => true, sync: async () => assert.fail('Unauthorized source must not be synchronized') });
  assert.equal(result.synced, 0); assert.equal(result.skipped, 1); assert.equal(ctx.calls.length, 0);
});
