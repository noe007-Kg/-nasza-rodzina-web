import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { calendarStatus, configureGoogleTwoWay, exportLocalEventToGoogle, googleHistoryStep, startCalendarOAuth, syncGoogleHistory, updateImportedGoogleEvent } from '../server/calendar-service.mjs';
import { googleHistoryEventInRange, googleHistoryRange } from '../server/calendar-history-range.mjs';
import { googleAuthorizationUrl, googleCalendarClient, GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE } from '../server/calendar-google.mjs';
import { decryptCalendarSecrets, encryptCalendarSecrets } from '../server/calendar-secrets.mjs';
import { googleEventDocumentId } from '../server/calendar-storage.mjs';
import { calendarConnection, calendarId, calendarMemoryContext, calendarTestEnvironment, googleFixtureEvent, testNow } from './calendar-test-helpers.mjs';

const binding = { uid: 'actor', id: calendarId, purpose: 'connection' }, path = `_calendarConnections/${calendarId}`;
const tokens = { accessToken: 'test-only-read-token', refreshToken: 'test-only-read-refresh', scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE], expiresAt: testNow + 3600000 };
const period = { from: '2026-10-01', to: '2026-10-07' };
const eventPath = id => `privateCalendarEvents/${googleEventDocumentId('actor', calendarId, 'primary-id', id)}`;
const page = (events, nextPageToken = null) => ({ events, nextPageToken, syncToken: nextPageToken ? null : 'accepted-cursor', timeZone: 'Europe/Warsaw' });
let restore;
beforeEach(() => { restore = calendarTestEnvironment(); });
afterEach(() => { restore(); });
const context = changes => calendarMemoryContext({ [path]: calendarConnection({ historyImportVersion: 2, historyComplete: false, historyImportWindow: null,
  envelope: encryptCalendarSecrets({ tokens, syncToken: null }, binding), ...changes }) });

test('historical date selection is explicit, validated and respects complete Warsaw DST days', () => {
  for (const value of [{}, { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-10-08', to: '2026-10-07' }]) assert.throws(() => googleHistoryRange(value), { code: 'CALENDAR_HISTORY_RANGE_REQUIRED' });
  const autumn = googleHistoryRange({ from: '2026-10-25', to: '2026-10-25' }), spring = googleHistoryRange({ from: '2026-03-29', to: '2026-03-29' });
  assert.equal(Date.parse(autumn.to) - Date.parse(autumn.from), 25 * 3600000);
  assert.equal(Date.parse(spring.to) - Date.parse(spring.from), 23 * 3600000);
  const master = googleFixtureEvent('weekly', { start: Date.parse('2026-10-18T07:00:00Z'), end: Date.parse('2026-10-18T08:00:00Z'), sourceRecurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'] });
  assert.equal(googleHistoryEventInRange(master, autumn), true);
  assert.equal(googleHistoryEventInRange(master, googleHistoryRange({ from: '2026-10-26', to: '2026-10-27' })), false);
});

test('missing configured import owner fails closed without exposing a UID or writing setup state', async () => {
  const ctx = context(); delete process.env.CALENDAR_GOOGLE_OWNER_UID;
  const status = await calendarStatus(ctx, {});
  assert.equal(status.importOwnerConfigured, false); assert.equal(status.importAllowed, false);
  await assert.rejects(startCalendarOAuth(ctx, { ownerProfileId: 'actor', visibility: 'private', mode: 'sync' }), { code: 'CALENDAR_HISTORY_OWNER_NOT_CONFIGURED' });
  assert.equal(ctx.calls.length, 0);
  process.env.CALENDAR_GOOGLE_OWNER_UID = 'actor';
  await assert.rejects(googleHistoryStep({ ...ctx, uid: 'child' }, { connectionId: calendarId, operation: 'preview', ...period }), { code: 'CALENDAR_HISTORY_OWNER_FORBIDDEN' });
  assert.equal((await calendarStatus({ ...ctx, uid: 'child' }, {})).importAllowed, false);
});

test('Preview cannot write OAuth setup or import state even with configured credentials and enabled flag', async () => {
  const previous = process.env.VERCEL_ENV; process.env.VERCEL_ENV = 'preview';
  try {
    const ctx = context();
    await assert.rejects(startCalendarOAuth(ctx, { ownerProfileId: 'actor', visibility: 'private', mode: 'sync' }), { code: 'CALENDAR_PREVIEW_READ_ONLY' });
    await assert.rejects(googleHistoryStep(ctx, { connectionId: calendarId, operation: 'preview', ...period }), { code: 'CALENDAR_PREVIEW_READ_ONLY' });
    assert.equal(ctx.calls.length, 0);
  } finally { previous === undefined ? delete process.env.VERCEL_ENV : process.env.VERCEL_ENV = previous; }
});

test('READ-ONLY blocks OAuth write consent and all provider writes despite old write scopes/flags', async () => {
  const ctx = context({ historyComplete: true, twoWayEnabled: true, writeAuthorized: true, historyImportWindow: googleHistoryRange(period) });
  assert.throws(() => googleAuthorizationUrl({}, 'state', 'challenge', { write: true }), { code: 'CALENDAR_READ_ONLY_STAGE' });
  await assert.rejects(startCalendarOAuth(ctx, { ownerProfileId: 'actor', visibility: 'private', mode: 'sync', write: true }), { code: 'CALENDAR_READ_ONLY_STAGE' });
  for (const action of [configureGoogleTwoWay, exportLocalEventToGoogle, updateImportedGoogleEvent]) await assert.rejects(action(ctx, { connectionId: calendarId }), { code: 'CALENDAR_READ_ONLY_STAGE' });
  let calls = 0;
  const provider = googleCalendarClient({}, tokens, { now: testNow, fetchImpl: async () => { calls++; assert.fail('No provider write/refresh'); } });
  await assert.rejects(provider.writeEvent('primary-id', 'event', {}, { insert: true }), { code: 'CALENDAR_READ_ONLY_STAGE' });
  await syncGoogleHistory(ctx, { connectionId: calendarId }, { clock: () => testNow, clientFactory: () => ({ tokens: () => tokens, historyPage: async () => page([]), event: async () => assert.fail('Do not poll outbound mappings'), writeEvent: async () => assert.fail('Never write Google') }) });
  assert.equal(calls, 0); assert.equal((await calendarStatus(ctx, {})).connections[0].twoWayEnabled, false);
});

test('approved history copies two private records, then incremental changes/cancellation/future updates are idempotent', async () => {
  const ctx = context(), first = googleFixtureEvent('one', { start: Date.parse('2026-10-02T07:00:00Z'), end: Date.parse('2026-10-02T08:00:00Z') });
  const second = googleFixtureEvent('two', { start: Date.parse('2026-10-06T07:00:00Z'), end: Date.parse('2026-10-06T08:00:00Z') });
  const tooOld = googleFixtureEvent('old', { start: Date.parse('2020-01-01T07:00:00Z'), end: Date.parse('2020-01-01T08:00:00Z') });
  const future = googleFixtureEvent('future', { start: testNow + 86400000, end: testNow + 86400000 + 3600000 });
  const initial = { clock: () => testNow, clientFactory: () => ({ tokens: () => tokens, historyPage: async (_id, request) => request.pageToken ? page([second, future]) : page([tooOld, first], 'second-page') }) };
  await assert.rejects(googleHistoryStep(ctx, { connectionId: calendarId, operation: 'import', ...period }, initial), { code: 'CALENDAR_HISTORY_CONFIRM_REQUIRED' });
  let preview = await googleHistoryStep(ctx, { connectionId: calendarId, operation: 'preview', ...period }, initial);
  assert.equal(preview.complete, false); preview = await googleHistoryStep(ctx, { connectionId: calendarId, operation: 'preview', ...period }, initial);
  assert.equal(preview.historyProgress.processed, 2); assert.equal(preview.complete, true);
  assert.equal([...ctx.rows.keys()].some(key => key.startsWith('privateCalendarEvents/')), false);
  await assert.rejects(googleHistoryStep(ctx, { connectionId: calendarId, operation: 'import', from: '2020-01-01', to: '2026-10-07' }, initial), { code: 'CALENDAR_HISTORY_CONFIRM_REQUIRED' });
  await googleHistoryStep(ctx, { connectionId: calendarId, operation: 'import', ...period }, initial);
  await googleHistoryStep(ctx, { connectionId: calendarId, operation: 'import', ...period }, initial);
  assert.equal(ctx.rows.has(eventPath('one')), true); assert.equal(ctx.rows.has(eventPath('two')), true);
  assert.equal(ctx.rows.has(eventPath('old')), false); assert.equal(ctx.rows.has(eventPath('future')), false);
  for (const id of ['one', 'two']) { const record = ctx.rows.get(eventPath(id)); assert.equal(record.private, true); assert.equal(record.person, 'Sebastian'); assert.equal(record.ownerUid, 'actor'); }
  assert.equal([...ctx.rows.keys()].some(key => key.startsWith('calendarEvents/')), false);
  const betweenRangeAndConsent = googleFixtureEvent('unapproved-gap', { start: Date.parse('2026-10-08T06:00:00Z'), end: Date.parse('2026-10-08T07:00:00Z') });
  const changes = [{ ...first, title: 'Poprawiony termin' }, { externalEventId: 'two', cancelled: true }, future, tooOld, betweenRangeAndConsent];
  let reads = 0;
  const incremental = now => ({ clock: () => now, clientFactory: () => ({ tokens: () => tokens, historyPage: async (_id, request) => { reads++; assert.equal(request.syncToken, 'accepted-cursor'); assert.equal(Object.hasOwn(request, 'timeMin'), false); return page(changes); } }) });
  const result = await syncGoogleHistory(ctx, { connectionId: calendarId }, incremental(testNow + 60001));
  assert.equal(result.imported, 1); assert.equal(result.changed, 1); assert.equal(result.cancelled, 1);
  assert.equal(ctx.rows.get(eventPath('one')).title, 'Poprawiony termin'); assert.equal(ctx.rows.get(eventPath('two')).cancelled, true);
  assert.equal(ctx.rows.has(eventPath('unapproved-gap')), false); assert.equal(ctx.rows.has(eventPath('old')), false);
  const repeated = await syncGoogleHistory(ctx, { connectionId: calendarId }, incremental(testNow + 120002));
  assert.equal(repeated.imported, 0); assert.equal(repeated.changed, 0); assert.equal(repeated.cancelled, 0); assert.equal(reads, 2);
  assert.equal(decryptCalendarSecrets(ctx.rows.get(path).envelope, binding).syncToken, 'accepted-cursor');
});
