import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { assertCalendarV2WritesAllowed, configureGoogleTwoWay, exportLocalEventToGoogle, googleHistoryStep,
  syncGoogleHistory, updateImportedGoogleEvent } from '../server/calendar-service.mjs';
import { decryptCalendarSecrets, encryptCalendarSecrets } from '../server/calendar-secrets.mjs';
import { acquireCalendarLease, calendarEventFingerprint, googleEventDocumentId, upsertGoogleEvents } from '../server/calendar-storage.mjs';
import { googleAuthorizationUrl, googleCalendarClient, GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE, normalizeGoogleHistoryEvent } from '../server/calendar-google.mjs';
import { calendarConnection, calendarId, calendarMemoryContext, calendarTestEnvironment, googleFixtureEvent, testNow } from './calendar-test-helpers.mjs';

const clock = () => testNow;
const refPath = `_calendarConnections/${calendarId}`;
const binding = { uid: 'actor', id: calendarId, purpose: 'connection' };
const tokens = { accessToken: 'test-only-access', refreshToken: 'test-only-refresh', expiresAt: testNow + 3600000, scopes: [GOOGLE_CALENDAR_SCOPE] };
let restore;
beforeEach(() => {
  const calendarRestore = calendarTestEnvironment();
  const names = ['VERCEL_ENV', 'VERCEL', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_PROJECT_ID', 'FAMILY_V2_WRITES_ENABLED'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.FAMILY_V2_WRITES_ENABLED = 'true';
  restore = () => { calendarRestore(); for (const name of names) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name]; };
});
afterEach(() => restore());

function context(changes = {}, secrets = {}) {
  return calendarMemoryContext({ [refPath]: calendarConnection({ historyImportVersion: 2, historyComplete: true,
    envelope: encryptCalendarSecrets({ tokens, syncToken: 'old-cursor', ...secrets }, binding), ...changes }) });
}
const page = (events, nextPageToken = null) => ({ events, nextPageToken, syncToken: nextPageToken ? null : 'new-cursor', timeZone: 'Europe/Warsaw' });
function clientFactory(pages, extras = {}) {
  return () => ({ tokens: () => tokens, historyPage: async (_calendarId, request) => typeof pages === 'function' ? pages(request) : pages, ...extras });
}
function localEvent(changes = {}) {
  return { ownerUid: 'actor', createdBy: 'actor', person: 'Sebastian', title: 'Prywatny termin', description: '', location: '',
    date: Timestamp.fromMillis(testNow + 3600000), endDate: Timestamp.fromMillis(testNow + 7200000), allDay: false, repeat: 'none',
    source: 'manual', private: true, timeZone: 'Europe/Warsaw', ...changes };
}

test('history reads all years and raw masters/exception pages without time window or 5000-record lifetime cap', async () => {
  const calls = [];
  const client = googleCalendarClient({}, tokens, { now: testNow, fetchImpl: async url => {
    calls.push(new URL(url));
    const index = Number(new URL(url).searchParams.get('pageToken') || 0);
    const items = Array.from({ length: 250 }, (_, offset) => ({ id: `old-${index}-${offset}`, summary: 'Historia',
      start: { dateTime: '2001-01-01T10:00:00+01:00' }, end: { dateTime: '2001-01-01T11:00:00+01:00' } }));
    if (index === 0) items[0] = { ...items[0], recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Europe/Warsaw:20010108T100000'] };
    return Response.json({ timeZone: 'Europe/Warsaw', items, ...(index < 20 ? { nextPageToken: String(index + 1) } : { nextSyncToken: 'complete-cursor' }) });
  } });
  let cursor, total = 0, first;
  do { const result = await client.historyPage('primary-id', { pageToken: cursor, timeZone: 'Europe/Warsaw' }); first ||= result.events[0]; total += result.events.length; cursor = result.nextPageToken; } while (cursor);
  assert.equal(total, 5250);
  assert.equal(first.start, Date.parse('2001-01-01T10:00:00+01:00'));
  assert.deepEqual(first.sourceRecurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Europe/Warsaw:20010108T100000']);
  for (const url of calls) { assert.equal(url.searchParams.get('singleEvents'), 'false'); assert.equal(url.searchParams.get('showDeleted'), 'true'); assert.equal(url.searchParams.has('timeMin'), false); assert.equal(url.searchParams.has('timeMax'), false); }
});

test('history normalization preserves explicit cancelled exceptions, source date boundaries and Warsaw DST', () => {
  const exception = normalizeGoogleHistoryEvent({ id: 'cancelled', status: 'cancelled', recurringEventId: 'master', originalStartTime: { dateTime: '2026-10-25T09:00:00+01:00' } }, 'Europe/Warsaw');
  assert.equal(exception.cancelled, true); assert.equal(exception.externalSeriesId, 'master'); assert.equal(exception.externalOriginalStart, '2026-10-25T09:00:00+01:00');
  const allDay = normalizeGoogleHistoryEvent({ id: 'all-day', start: { date: '2026-10-25' }, end: { date: '2026-10-26' } }, 'Europe/Warsaw');
  assert.equal(allDay.start, Date.parse('2026-10-24T22:00:00Z')); assert.equal(allDay.end + 1, Date.parse('2026-10-25T23:00:00Z'));
  assert.equal(allDay.sourceStartDate, '2026-10-25'); assert.equal(allDay.sourceEndDateExclusive, '2026-10-26');
});

test('preview count and resumed import preserve encrypted cursors and import every new event privately even for family source', async () => {
  const ctx = context({ historyComplete: false, ownerProfileId: 'family', person: 'family', visibility: 'family' });
  const event = googleFixtureEvent('history-1', { sourceRecurrence: ['RRULE:FREQ=WEEKLY'] });
  const requests = [], options = { clock, clientFactory: clientFactory(request => { requests.push(request); return request.pageToken ? page([googleFixtureEvent('history-2')]) : page([event], 'page-two'); }) };
  let result = await googleHistoryStep(ctx, { connectionId: calendarId, operation: 'preview' }, options);
  assert.equal(result.complete, false); assert.equal(result.historyProgress.processed, 1);
  assert.equal([...ctx.rows.keys()].some(key => key.startsWith('privateCalendarEvents/')), false);
  result = await googleHistoryStep(ctx, { connectionId: calendarId, operation: 'preview' }, options);
  assert.equal(result.complete, true); assert.equal(result.historyProgress.processed, 2);
  result = await googleHistoryStep(ctx, { connectionId: calendarId, operation: 'import' }, options);
  assert.equal(result.historyProgress.total, 2); assert.equal(result.complete, false);
  const secret = decryptCalendarSecrets(ctx.rows.get(refPath).envelope, binding);
  assert.equal(secret.historyJob.pageToken, 'page-two'); assert.equal(result.historyProgress.pageToken, undefined);
  result = await googleHistoryStep(ctx, { connectionId: calendarId, operation: 'import' }, options);
  assert.equal(result.complete, true); assert.equal(ctx.rows.get(refPath).historyComplete, true);
  const docs = [...ctx.rows].filter(([key]) => key.startsWith('privateCalendarEvents/')).map(([, value]) => value);
  assert.equal(docs.length, 2); assert.equal([...ctx.rows.keys()].some(key => key.startsWith('calendarEvents/')), false);
  for (const event of docs) { assert.equal(event.ownerUid, 'actor'); assert.equal(event.ownerProfileId, 'actor'); assert.equal(event.person, 'Sebastian'); assert.equal(event.private, true); }
  assert.deepEqual(docs[0].sourceRecurrence, ['RRULE:FREQ=WEEKLY']);
  assert.deepEqual(requests.map(request => request.pageToken), [null, 'page-two', null, 'page-two']);
});

test('reimport is idempotent and retains individual family visibility and important flag', async () => {
  const ctx = context({ visibility: 'family', ownerProfileId: 'family' });
  const lease = (await acquireCalendarLease(ctx, calendarId, { now: testNow })).lease;
  const connection = { ...ctx.rows.get(refPath), id: calendarId };
  const original = googleFixtureEvent('same');
  assert.equal((await upsertGoogleEvents(ctx, connection, lease, [original], { now: testNow, clock })).imported, 1);
  const id = googleEventDocumentId('actor', calendarId, connection.calendarId, 'same');
  const old = ctx.rows.get(`privateCalendarEvents/${id}`);
  ctx.rows.delete(`privateCalendarEvents/${id}`); ctx.rows.set(`calendarEvents/${id}`, { ...old, private: false, visibilityOverride: 'family', important: true });
  const result = await upsertGoogleEvents(ctx, connection, lease, [{ ...original, title: 'Zmieniony termin' }, googleFixtureEvent('new')], { now: testNow, clock });
  assert.equal(result.changed, 1); assert.equal(result.imported, 1);
  assert.equal(ctx.rows.get(`calendarEvents/${id}`).visibilityOverride, 'family'); assert.equal(ctx.rows.get(`calendarEvents/${id}`).important, true);
  assert.equal(ctx.rows.get(`calendarEvents/${id}`).private, false); assert.equal(ctx.rows.has(`privateCalendarEvents/${id}`), false);
  const again = await upsertGoogleEvents(ctx, connection, lease, [{ ...original, title: 'Zmieniony termin' }, googleFixtureEvent('new')], { now: testNow, clock });
  assert.deepEqual(again, { imported: 0, changed: 0, cancelled: 0, unchanged: 2 });
});

test('cancelled master occurrence is stored as private tombstone and can be reinstated without keeping a hidden marker', async () => {
  const ctx = context(), { lease } = await acquireCalendarLease(ctx, calendarId, { now: testNow }), connection = { ...ctx.rows.get(refPath), id: calendarId };
  const cancelled = normalizeGoogleHistoryEvent({ id: 'exception', status: 'cancelled', recurringEventId: 'master', originalStartTime: { dateTime: '2026-10-11T09:00:00+02:00' } }, 'Europe/Warsaw');
  await upsertGoogleEvents(ctx, connection, lease, [cancelled], { clock, now: testNow });
  const id = googleEventDocumentId('actor', calendarId, connection.calendarId, 'exception');
  assert.equal(ctx.rows.get(`privateCalendarEvents/${id}`).sourceExceptionTombstone, true);
  await upsertGoogleEvents(ctx, connection, lease, [googleFixtureEvent('exception', { externalSeriesId: 'master', externalOriginalStart: cancelled.externalOriginalStart, sourceRecurrence: [] })], { clock, now: testNow });
  assert.equal(ctx.rows.get(`privateCalendarEvents/${id}`).cancelled, false);
  assert.notEqual(ctx.rows.get(`privateCalendarEvents/${id}`).sourceExceptionTombstone, true);
});

test('a read-only connection never issues provider writes and write scope requires separate OAuth consent', async () => {
  const config = { clientId: 'fixture', redirectUri: 'https://family.example.test/api/calendars/callback' }, plain = new URL(googleAuthorizationUrl(config, 'state', 'challenge'));
  assert.equal(plain.searchParams.get('scope'), GOOGLE_CALENDAR_SCOPE);
  const writable = new URL(googleAuthorizationUrl(config, 'state', 'challenge', { write: true }));
  assert.deepEqual(writable.searchParams.get('scope').split(' '), [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE]);
  let calls = 0;
  const client = googleCalendarClient({}, tokens, { now: testNow, fetchImpl: async () => { calls++; throw new Error('Must not call provider'); } });
  await assert.rejects(client.writeEvent('primary-id', 'event-id', {}, { insert: true }), { code: 'CALENDAR_WRITE_PERMISSION_REQUIRED' });
  assert.equal(calls, 0);
  const ctx = context();
  await assert.rejects(configureGoogleTwoWay(ctx, { connectionId: calendarId, enabled: true }, { clock, clientFactory: clientFactory(page([])) }), { code: 'CALENDAR_WRITE_PERMISSION_REQUIRED' });
  assert.notEqual(ctx.rows.get(refPath).twoWayEnabled, true);
});

test('refresh that removes write permission prevents a provider write after token renewal', async () => {
  const calls = [];
  const client = googleCalendarClient({}, { ...tokens, expiresAt: testNow, scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE] }, { now: testNow, fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-only-renewed', token_type: 'Bearer', expires_in: 3600, scope: GOOGLE_CALENDAR_SCOPE });
    return Response.json({ id: 'event', etag: 'etag' });
  } });
  await assert.rejects(client.writeEvent('primary-id', 'event-id', {}, { insert: true }), { code: 'CALENDAR_WRITE_PERMISSION_REQUIRED' });
  assert.deepEqual(calls.map(value => value.url), ['https://oauth2.googleapis.com/token']);
});

test('provider conditional writes send If-Match and preserve the remote version on conflict', async () => {
  let request;
  const client = googleCalendarClient({}, { ...tokens, scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE] }, { now: testNow, fetchImpl: async (_url, init) => { request = init; return Response.json({}, { status: 412 }); } });
  await assert.rejects(client.writeEvent('primary-id', 'event-id', { summary: 'Nowa nazwa' }, { etag: 'old-etag' }), { code: 'CALENDAR_WRITE_CONFLICT' });
  assert.equal(request.method, 'PATCH'); assert.equal(request.headers['If-Match'], 'old-etag');
});

test('two-way mode requires a completed history, writable selected calendar and write grant', async () => {
  const writableTokens = { ...tokens, scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE] };
  for (const changes of [{ historyComplete: false }, { googleCalendarCanWrite: false }, { writeAuthorized: false }, { mode: 'import' }]) {
    const ctx = context({ writeAuthorized: true, googleCalendarCanWrite: true, ...changes }, { tokens: writableTokens });
    await assert.rejects(configureGoogleTwoWay(ctx, { connectionId: calendarId, enabled: true }, { clock, clientFactory: clientFactory(page([]), { tokens: () => writableTokens }) }), { code: 'CALENDAR_WRITE_PERMISSION_REQUIRED' });
  }
  const ctx = context({ writeAuthorized: true, googleCalendarCanWrite: true }, { tokens: writableTokens });
  await configureGoogleTwoWay(ctx, { connectionId: calendarId, enabled: true }, { clock, clientFactory: clientFactory(page([]), { tokens: () => writableTokens }) });
  assert.equal(ctx.rows.get(refPath).twoWayEnabled, true);
});

test('explicit local export uses stable mapping and retries do not create a second Google event', async () => {
  const writableTokens = { ...tokens, scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE] };
  const ctx = context({ writeAuthorized: true, googleCalendarCanWrite: true }, { tokens: writableTokens }); ctx.rows.set('privateCalendarEvents/local-event', localEvent());
  let writes = 0;
  const options = { clock, clientFactory: clientFactory(page([]), { tokens: () => writableTokens, writeEvent: async (_calendarId, id, body, options) => { writes++; assert.equal(options.insert, true); return { ...body, id, etag: 'created-etag' }; } }) };
  assert.equal((await exportLocalEventToGoogle(ctx, { connectionId: calendarId, eventId: 'local-event' }, options)).exported, true);
  assert.equal((await exportLocalEventToGoogle(ctx, { connectionId: calendarId, eventId: 'local-event' }, options)).alreadyExported, true);
  assert.equal(writes, 1); assert.equal([...ctx.rows.keys()].filter(path => path.startsWith('_calendarExports/')).length, 1);
  assert.equal(ctx.rows.get('privateCalendarEvents/local-event').private, true);
});

test('two-way conflicting modifications and remote cancellations preserve local events for explicit resolution', async () => {
  for (const cancelled of [false, true]) {
    const writableTokens = { ...tokens, scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE] };
    const ctx = context({ writeAuthorized: true, googleCalendarCanWrite: true, twoWayEnabled: true }, { tokens: writableTokens });
    const initial = localEvent(); ctx.rows.set('privateCalendarEvents/local-event', cancelled ? initial : { ...initial, title: 'Nowsza lokalna nazwa' });
    ctx.rows.set('_calendarExports/test-map', { ownerUid: 'actor', sourceConnectionId: calendarId, localEventId: 'local-event', externalEventId: 'remote-event', ready: true,
      providerEtag: 'old-etag', localFingerprint: calendarEventFingerprint(initial), conflict: false });
    let writes = 0;
    const options = { clock, clientFactory: clientFactory(page([]), { tokens: () => writableTokens, event: async () => ({ id: 'remote-event', etag: 'new-etag', status: cancelled ? 'cancelled' : 'confirmed' }), writeEvent: async () => { writes++; } }) };
    await syncGoogleHistory(ctx, { connectionId: calendarId }, options);
    assert.equal(writes, 0); assert.equal(ctx.rows.get('_calendarExports/test-map').conflict, true);
    assert.equal(ctx.rows.has('privateCalendarEvents/local-event'), true);
    assert.equal(ctx.rows.get('privateCalendarEvents/local-event').title, cancelled ? initial.title : 'Nowsza lokalna nazwa');
  }
});

test('a Google-side recurrence change is flagged for resolution rather than silently flattening a local series', async () => {
  const writableTokens = { ...tokens, scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE] };
  const ctx = context({ writeAuthorized: true, googleCalendarCanWrite: true, twoWayEnabled: true }, { tokens: writableTokens });
  const initial = localEvent({ repeat: 'weekly' }); ctx.rows.set('privateCalendarEvents/local-event', initial);
  ctx.rows.set('_calendarExports/test-map', { ownerUid: 'actor', sourceConnectionId: calendarId, localEventId: 'local-event', externalEventId: 'remote-event', ready: true,
    providerEtag: 'old-etag', localFingerprint: calendarEventFingerprint(initial), conflict: false });
  let writes = 0;
  await syncGoogleHistory(ctx, { connectionId: calendarId }, { clock, clientFactory: clientFactory(page([]), { tokens: () => writableTokens,
    event: async () => ({ id: 'remote-event', etag: 'new-etag', summary: 'Termin w Google', start: { dateTime: '2026-10-08T11:00:00+02:00' }, end: { dateTime: '2026-10-08T12:00:00+02:00' }, recurrence: ['RRULE:FREQ=MONTHLY'] }),
    writeEvent: async () => { writes++; } }) });
  assert.equal(writes, 0); assert.equal(ctx.rows.get('_calendarExports/test-map').conflict, true);
  assert.equal(ctx.rows.get('privateCalendarEvents/local-event').repeat, 'weekly'); assert.equal(ctx.rows.get('privateCalendarEvents/local-event').title, initial.title);
});

test('editing an imported event with a newer Google etag refuses the update before issuing PATCH', async () => {
  const writableTokens = { ...tokens, scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE] }, ctx = context({ writeAuthorized: true, googleCalendarCanWrite: true, twoWayEnabled: true }, { tokens: writableTokens });
  const { lease } = await acquireCalendarLease(ctx, calendarId, { now: testNow }), connection = { ...ctx.rows.get(refPath), id: calendarId };
  await upsertGoogleEvents(ctx, connection, lease, [googleFixtureEvent('imported', { providerEtag: 'old-etag' })], { clock, now: testNow });
  ctx.rows.set(refPath, { ...ctx.rows.get(refPath), leaseId: null, leaseExpiresAt: null });
  const eventId = googleEventDocumentId('actor', calendarId, connection.calendarId, 'imported'); let writes = 0;
  await assert.rejects(updateImportedGoogleEvent(ctx, { connectionId: calendarId, eventId, patch: { title: 'Zmiana', description: '', location: '', date: new Date(testNow).toISOString(), endDate: new Date(testNow + 3600000).toISOString(), allDay: false } },
    { clock, clientFactory: clientFactory(page([]), { tokens: () => writableTokens, event: async () => ({ etag: 'new-etag' }), writeEvent: async () => { writes++; } }) }), { code: 'CALENDAR_WRITE_CONFLICT' });
  assert.equal(writes, 0); assert.equal(ctx.rows.get(`privateCalendarEvents/${eventId}`).title, 'Wizyta');
});

test('manual history and scheduled history use one atomic lease and cannot run in parallel', async () => {
  const ctx = context(); let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), blocker = new Promise(resolve => { release = resolve; }); let providerReads = 0;
  const options = { clock, clientFactory: clientFactory(async () => { providerReads++; entered(); await blocker; return page([]); }) };
  const first = syncGoogleHistory(ctx, { connectionId: calendarId }, options); await started;
  const hour = Math.floor(testNow / 3600000) * 3600000;
  await assert.rejects(syncGoogleHistory({ ...ctx, scheduledCalendarSlotStartMs: hour }, { connectionId: calendarId }, options), error => ['CALENDAR_BUSY', 'CALENDAR_SCHEDULE_SLOT_CONSUMED'].includes(error.code));
  release(); await first; assert.equal(providerReads, 1); assert.equal(ctx.rows.get(refPath).leaseId, null);
});

test('archiving the OAuth owner during provider read prevents import writes and cursor advancement', async () => {
  const ctx = context(), before = decryptCalendarSecrets(ctx.rows.get(refPath).envelope, binding);
  await assert.rejects(syncGoogleHistory(ctx, { connectionId: calendarId }, { clock, clientFactory: clientFactory(() => {
    ctx.rows.set('members/actor', { ...ctx.rows.get('members/actor'), archived: true }); return page([googleFixtureEvent('must-not-import')]);
  }) }), { code: 'CALENDAR_MEMBER_REQUIRED' });
  assert.equal([...ctx.rows.keys()].some(path => path.startsWith('privateCalendarEvents/')), false);
  assert.equal(decryptCalendarSecrets(ctx.rows.get(refPath).envelope, binding).syncToken, before.syncToken);
});

test('expired incremental cursor resumes a full history read without deleting preserved local or imported events', async () => {
  const ctx = context(); ctx.rows.set('privateCalendarEvents/local-event', localEvent());
  const requests = [];
  const result = await syncGoogleHistory(ctx, { connectionId: calendarId }, { clock, clientFactory: clientFactory(request => {
    requests.push(request);
    if (request.syncToken) throw Object.assign(new Error('Test-only stale cursor'), { code: 'CALENDAR_CURSOR_EXPIRED' });
    return page([googleFixtureEvent('historical')]);
  }) });
  assert.equal(result.imported, 1); assert.equal(result.complete, true);
  assert.deepEqual(requests.map(value => value.syncToken), ['old-cursor', null]);
  assert.equal(ctx.rows.has('privateCalendarEvents/local-event'), true);
  assert.equal(decryptCalendarSecrets(ctx.rows.get(refPath).envelope, binding).syncToken, 'new-cursor');
});

test('local recurrence changes participate in the synchronization fingerprint while family sharing does not', () => {
  const original = localEvent({ repeat: 'weekly', recurrence: { unit: 'week', interval: 1 } });
  assert.notEqual(calendarEventFingerprint(original), calendarEventFingerprint({ ...original, repeat: 'monthly' }));
  assert.notEqual(calendarEventFingerprint(original), calendarEventFingerprint({ ...original, recurrence: { unit: 'week', interval: 2 } }));
  assert.notEqual(calendarEventFingerprint(original), calendarEventFingerprint({ ...original, recurrenceExceptions: ['2026-10-15T09:00:00Z'] }));
  assert.equal(calendarEventFingerprint(original), calendarEventFingerprint({ ...original, private: false, visibilityOverride: 'family' }));
});

test('Preview never enables v2 calendar writes, including demo-like project names; production needs the server flag', () => {
  for (const projectId of ['nasza-rodzina', 'demo-nasza-rodzina']) assert.throws(() => assertCalendarV2WritesAllowed({ app: { options: { projectId } } }, { VERCEL_ENV: 'preview', FAMILY_V2_WRITES_ENABLED: 'true' }), { code: 'CALENDAR_PREVIEW_READ_ONLY' });
  assert.throws(() => assertCalendarV2WritesAllowed({ app: { options: { projectId: 'nasza-rodzina' } } }, {}), { code: 'FAMILY_V2_READ_ONLY' });
});
