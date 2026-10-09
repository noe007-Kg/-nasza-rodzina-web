import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { calendarError } from '../server/calendar-errors.mjs';
import { encryptCalendarSecrets } from '../server/calendar-secrets.mjs';
import { acquireCalendarLease, googleEventDocumentId } from '../server/calendar-storage.mjs';
import { syncGoogleCalendar } from '../server/calendar-service.mjs';
import { GOOGLE_CALENDAR_CONNECTION_LIMIT, GOOGLE_CALENDAR_SCHEDULE, GOOGLE_CALENDAR_TIME_ZONE,
  googleCalendarScheduleSlot, runScheduledGoogleCalendarSync } from '../server/calendar-scheduler.mjs';
import { calendarConnection, calendarId, calendarMemoryContext, calendarTestEnvironment, googleFixtureEvent, testNow } from './calendar-test-helpers.mjs';

const tokens = { accessToken: 'scheduler-access-test-placeholder', refreshToken: 'scheduler-refresh-test-placeholder', expiresAt: testNow + 86400000 };
const sourcePath = id => `_calendarConnections/${id}`;
const secondId = '00000000-0000-4000-8000-000000000002';
const thirdId = '00000000-0000-4000-8000-000000000003';
const envelope = id => encryptCalendarSecrets({ tokens, syncToken: 'fixture-cursor' }, { uid: 'actor', id, purpose: 'connection' });
function managedContext(initial = {}) {
  const context = calendarMemoryContext({ [sourcePath(calendarId)]: calendarConnection({ envelope: envelope(calendarId) }), ...initial });
  context.authReads = [];
  context.auth = { getUser: async uid => { context.authReads.push(uid); return { uid, disabled: false }; } };
  return context;
}
const event = now => ({ scheduleTime: new Date(now).toISOString() });
const factory = changes => () => ({ tokens: () => tokens, changes: async () => ({ events: [googleFixtureEvent()], cancelledSeries: [],
  recurringIds: [], syncToken: 'fixture-next-cursor', timeZone: 'Europe/Warsaw', ...changes }) });
const actualSync = clientFactory => (context, body, options) => syncGoogleCalendar(context, body, { ...options, clientFactory: clientFactory || factory() });
const run = (context, now = testNow, options = {}) => runScheduledGoogleCalendarSync(context, event(now), { clock: () => now, sync: actualSync(), ...options });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('hourly Warsaw cron spans all day while UTC slots retain distinct jittered runs', () => {
  assert.equal(GOOGLE_CALENDAR_SCHEDULE, '0 * * * *'); assert.equal(GOOGLE_CALENDAR_TIME_ZONE, 'Europe/Warsaw');
  const first = Date.parse('2026-10-08T08:00:00+02:00'), second = first + 3600000;
  assert.equal(googleCalendarScheduleSlot(new Date(first).toISOString(), first + 5000), first);
  assert.equal(googleCalendarScheduleSlot(new Date(second).toISOString(), second + 1000), second);
  assert.equal(googleCalendarScheduleSlot('invalid', second + 1000), second);
  assert.equal(googleCalendarScheduleSlot(new Date(second + 3600000).toISOString(), second + 1000), second);
  assert.throws(() => googleCalendarScheduleSlot('invalid', NaN), TypeError);
});
test('both autumn Warsaw 02:00 hours have different slots and spring missing hour stays chronological', () => {
  const localHour = time => new Intl.DateTimeFormat('en-GB', { timeZone: GOOGLE_CALENDAR_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date(time));
  const autumn = ['2026-10-25T00:00:00Z', '2026-10-25T01:00:00Z'].map(Date.parse);
  assert.equal(localHour(autumn[0]), '02'); assert.equal(localHour(autumn[1]), '02');
  assert.equal(googleCalendarScheduleSlot(autumn[1], autumn[1]) - googleCalendarScheduleSlot(autumn[0], autumn[0]), 3600000);
  const spring = ['2026-03-29T00:00:00Z', '2026-03-29T01:00:00Z'].map(Date.parse);
  assert.equal(localHour(spring[0]), '01'); assert.equal(localHour(spring[1]), '03');
  assert.equal(googleCalendarScheduleSlot(spring[1], spring[1]) - googleCalendarScheduleSlot(spring[0], spring[0]), 3600000);
});
test('missing calendar configuration is a quiet no-op with no database/provider request', async () => {
  let queried = false;
  const context = { auth: { getUser: async () => assert.fail('No Auth call') }, db: { collection: () => { queried = true; assert.fail('No database request'); } } };
  const result = await runScheduledGoogleCalendarSync(context, event(testNow), { configured: () => false, clock: () => testNow, sync: async () => assert.fail('No provider call') });
  assert.equal(result.skipped, 1); assert.equal(result.codes.CALENDAR_NOT_CONFIGURED, 1); assert.equal(queried, false);
});
test('scheduler reuses real sync and stable history IDs; two jittered distinct slots both execute without duplicate events', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext(), firstSlot = testNow, secondSlot = testNow + 3600000;
    const first = await runScheduledGoogleCalendarSync(context, event(firstSlot), { clock: () => firstSlot + 5000, sync: actualSync() });
    const second = await runScheduledGoogleCalendarSync(context, event(secondSlot), { clock: () => secondSlot + 1000, sync: actualSync() });
    assert.equal(first.synced, 1); assert.equal(first.imported, 1); assert.equal(second.synced, 1); assert.equal(second.imported, 0); assert.equal(second.unchanged, 1);
    const records = [...context.rows.keys()].filter(path => path.startsWith('privateCalendarEvents/'));
    assert.deepEqual(records, [`privateCalendarEvents/${googleEventDocumentId('actor', calendarId, 'primary-id', 'event-1')}`]);
    assert.equal(context.rows.get(sourcePath(calendarId)).lastScheduledSyncSlotAt.toMillis(), secondSlot);
    assert.equal(context.rows.get(sourcePath(calendarId)).lastSuccessfulSyncAt.toMillis(), secondSlot + 1000);
  } finally { restore(); }
});
test('duplicate or older schedule deliveries consume only one slot even after the manual cooldown expires', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext(); assert.equal((await run(context)).synced, 1);
    for (const slot of [testNow, testNow - 3600000]) {
      const repeated = await runScheduledGoogleCalendarSync(context, event(slot), { clock: () => testNow + 120000, sync: async () => assert.fail('No duplicate read') });
      assert.equal(repeated.synced, 0); assert.equal(repeated.codes.CALENDAR_SCHEDULE_SLOT_CONSUMED, 1);
    }
  } finally { restore(); }
});
test('scheduler in-flight and manual Vercel synchronization share one atomic lease', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext(), entered = deferred(), finish = deferred();
    let providerReads = 0;
    const blockingFactory = () => ({ tokens: () => tokens, changes: async () => { providerReads++; entered.resolve(); await finish.promise;
      return { events: [googleFixtureEvent()], cancelledSeries: [], recurringIds: [], syncToken: 'cursor', timeZone: 'Europe/Warsaw' }; } });
    const scheduled = run(context, testNow, { sync: actualSync(blockingFactory) });
    await entered.promise;
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId }, { clock: () => testNow, clientFactory: factory() }), { code: 'CALENDAR_BUSY' });
    finish.resolve(); assert.equal((await scheduled).synced, 1); assert.equal(providerReads, 1);
  } finally { restore(); }
});
test('an existing manual sync attempt or success in the current slot suppresses scheduled provider requests', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const field of ['lastAttemptAt', 'lastSuccessfulSyncAt']) {
      const context = managedContext({ [sourcePath(calendarId)]: calendarConnection({ envelope: envelope(calendarId), [field]: Timestamp.fromMillis(testNow + 1000) }) });
      const summary = await run(context, testNow + 5000, { sync: async () => assert.fail('Manual run already consumed slot') });
      assert.equal(summary.synced, 0); assert.equal(summary.codes.CALENDAR_SCHEDULE_SLOT_CONSUMED, 1);
    }
  } finally { restore(); }
});
test('recent manual read in previous hour still respects the shared 60-second backend rate limit', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext({ [sourcePath(calendarId)]: calendarConnection({ envelope: envelope(calendarId), lastAttemptAt: Timestamp.fromMillis(testNow - 2000) }) });
    const summary = await run(context, testNow + 1000);
    assert.equal(summary.skipped, 1); assert.equal(summary.codes.CALENDAR_RATE_LIMITED, 1);
    assert.equal(context.rows.get(sourcePath(calendarId)).lastScheduledSyncSlotAt, undefined);
  } finally { restore(); }
});
test('same-slot failed provider read is not replayed; next slot retries without a false success', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext(); let attempts = 0;
    const failing = () => ({ tokens: () => tokens, changes: async () => { attempts++; throw calendarError('CALENDAR_PROVIDER_UNAVAILABLE', 503, 'Bezpieczny błąd testowy'); } });
    const first = await run(context, testNow, { sync: actualSync(failing) });
    assert.equal(first.failed, 1); assert.equal(context.rows.get(sourcePath(calendarId)).lastSuccessfulSyncAt, undefined);
    const repeat = await runScheduledGoogleCalendarSync(context, event(testNow), { clock: () => testNow + 120000, sync: actualSync(failing) });
    assert.equal(repeat.skipped, 1); assert.equal(attempts, 1);
    const next = await run(context, testNow + 3600000); assert.equal(next.synced, 1); assert.equal(next.imported, 1);
  } finally { restore(); }
});
test('provider authorization expiry clears only its calendar envelope and safely requires reconnection, never password login', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext();
    const revoked = () => ({ tokens: () => tokens, changes: async () => { throw calendarError('CALENDAR_RECONNECT_REQUIRED', 401, 'Połącz ponownie.'); } });
    const summary = await run(context, testNow, { sync: actualSync(revoked) });
    assert.equal(summary.reconnectRequired, 1); assert.equal(context.rows.get(sourcePath(calendarId)).status, 'needs-reconnect');
    assert.equal(context.rows.get(sourcePath(calendarId)).envelope, null);
    assert.equal(Object.hasOwn(context.rows.get(sourcePath(calendarId)), 'password'), false);
    assert.equal((await run(context, testNow + 3600000, { sync: async () => assert.fail('No login retry') })).examined, 0);
  } finally { restore(); }
});
test('inactive, archived, disabled or login-less OAuth owners never reach the provider', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const change of [{ active: false }, { archived: true }, { disabled: true }, { canLogin: false }]) {
      const context = managedContext({ 'members/actor': { name: 'Sebastian', personKey: 'Sebastian', role: 'parent', active: true, canLogin: true, ...change } });
      const summary = await run(context, testNow, { sync: async () => assert.fail('Inactive actor must not synchronize') });
      assert.equal(summary.synced, 0); assert.equal(summary.codes.CALENDAR_SCHEDULE_MEMBER_UNAVAILABLE, 1);
    }
  } finally { restore(); }
});
test('Auth disabled/deleted accounts are rejected, and transient Auth errors fail closed without secret logs', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const kind of ['disabled', 'deleted', 'transient']) {
      const context = managedContext(); context.auth.getUser = async uid => {
        if (kind === 'disabled') return { uid, disabled: true };
        throw Object.assign(new Error('must-not-log-this-private-value'), { code: kind === 'deleted' ? 'auth/user-not-found' : 'auth/internal-error' });
      };
      const summary = await run(context, testNow, { sync: async () => assert.fail('No provider call after failed Auth authorization') });
      assert.equal(summary.synced, 0); assert.equal(summary.failed, kind === 'transient' ? 1 : 0);
      assert.equal(JSON.stringify(summary).includes('must-not-log'), false);
    }
  } finally { restore(); }
});
test('fresh target guards allow passive child profiles but reject unavailable profiles and other-child assignment by an adult', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const change of [{ active: false }, { archived: true }, { disabled: true }]) {
      const context = managedContext({ [sourcePath(calendarId)]: calendarConnection({ envelope: envelope(calendarId), ownerProfileId: 'child', person: 'Nikodem' }),
        'members/child': { role: 'child', active: true, canLogin: false, personKey: 'Nikodem', ...change } });
      const summary = await run(context, testNow, { sync: async () => assert.fail('Unavailable target must not synchronize') });
      assert.equal(summary.skipped, 1);
    }
    const passive = managedContext({ [sourcePath(calendarId)]: calendarConnection({ envelope: envelope(calendarId), ownerProfileId: 'child', person: 'Nikodem' }),
      'members/child': { role: 'child', active: true, canLogin: false, personKey: 'Nikodem' } });
    assert.equal((await run(passive)).synced, 1);
    passive.rows.set('members/actor', { role: 'adult', active: true, canLogin: true, personKey: 'Sebastian' });
    const forbidden = await run(passive, testNow + 3600000, { sync: async () => assert.fail('Adult cannot impersonate another child') });
    assert.equal(forbidden.codes.CALENDAR_PROFILE_FORBIDDEN, 1);
  } finally { restore(); }
});
test('one-time imports, unconfirmed selections and disconnected sources are never auto-synchronized', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const change of [{ mode: 'import' }, { selectionConfirmed: false }, { envelope: null }, { provider: 'future-provider' }, { status: 'disconnected' }]) {
      const context = managedContext({ [sourcePath(calendarId)]: calendarConnection({ envelope: envelope(calendarId), ...change }) });
      assert.equal((await run(context, testNow, { sync: async () => assert.fail('No auto-import') })).synced, 0);
    }
  } finally { restore(); }
});
test('Auth verification is cached per owner only for this invocation, not between scheduled runs', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext({ [sourcePath(secondId)]: calendarConnection({ envelope: envelope(secondId), calendarId: 'second-calendar' }) });
    assert.equal((await run(context)).synced, 2); assert.deepEqual(context.authReads, ['actor']);
    assert.equal((await run(context, testNow + 3600000)).synced, 2); assert.deepEqual(context.authReads, ['actor', 'actor']);
  } finally { restore(); }
});
test('overflow refuses a truncated source list before authorization or writes', async () => {
  const restore = calendarTestEnvironment();
  try {
    const initial = Object.fromEntries(Array.from({ length: GOOGLE_CALENDAR_CONNECTION_LIMIT + 1 }, (_, index) => [sourcePath(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`), calendarConnection({ envelope: {} })]));
    const context = managedContext(initial), summary = await run(context, testNow, { sync: async () => assert.fail('Never sync truncated list') });
    assert.equal(summary.failed, 1); assert.equal(summary.codes.CALENDAR_SCHEDULE_SOURCE_LIMIT, 1); assert.equal(context.authReads.length, 0); assert.equal(context.calls.length, 0);
  } finally { restore(); }
});
test('run budget defers remaining sources and their older attempts lead the next hour', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext({ [sourcePath(secondId)]: calendarConnection({ envelope: envelope(secondId) }), [sourcePath(thirdId)]: calendarConnection({ envelope: envelope(thirdId) }) });
    let now = testNow; const visited = [];
    const budgetSync = async (authorised, body) => {
      visited.push(body.connectionId); context.rows.get(sourcePath(body.connectionId)).lastScheduledSyncSlotAt = Timestamp.fromMillis(authorised.scheduledCalendarSlotStartMs);
      now += 450000; return { imported: 0, changed: 0, cancelled: 0, unchanged: 0 };
    };
    const first = await runScheduledGoogleCalendarSync(context, event(testNow), { clock: () => now, sync: budgetSync });
    assert.equal(first.synced, 1); assert.equal(first.deferred, 2); const firstSource = visited[0];
    now = testNow + 3600000;
    const second = await runScheduledGoogleCalendarSync(context, event(now), { clock: () => now, sync: budgetSync });
    assert.equal(second.synced, 1); assert.notEqual(visited[1], firstSource);
  } finally { restore(); }
});
test('a reconnect during provider read invalidates old worker writes and preserves replacement credentials', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext();
    const replaceFactory = () => ({ tokens: () => tokens, changes: async () => {
      const current = context.rows.get(sourcePath(calendarId)); context.rows.set(sourcePath(calendarId), { ...current, version: 'replacement-version', leaseId: null, leaseExpiresAt: null, envelope: { replacement: true } });
      return { events: [googleFixtureEvent()], cancelledSeries: [], recurringIds: [], syncToken: 'cursor', timeZone: 'Europe/Warsaw' };
    } });
    const summary = await run(context, testNow, { sync: actualSync(replaceFactory) });
    assert.equal(summary.synced, 0); assert.equal(summary.codes.CALENDAR_SYNC_STALE, 1);
    assert.deepEqual(context.rows.get(sourcePath(calendarId)).envelope, { replacement: true });
    assert.equal([...context.rows.keys()].some(path => path.startsWith('calendarEvents/') || path.startsWith('privateCalendarEvents/')), false);
  } finally { restore(); }
});
test('scheduler-only slot values are validated and absent from accepted client sync bodies', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext();
    for (const slot of [testNow + 1, testNow + 7200000, -1, NaN]) {
      await assert.rejects(acquireCalendarLease({ ...context, scheduledCalendarSlotStartMs: slot }, calendarId, { now: testNow, syncing: true }), { code: 'CALENDAR_INVALID_REQUEST' });
    }
    await assert.rejects(syncGoogleCalendar(context, { connectionId: calendarId, scheduledCalendarSlotStartMs: testNow }), { code: 'CALENDAR_INVALID_REQUEST' });
    assert.equal(context.calls.length, 0);
  } finally { restore(); }
});
test('unexpected errors become fixed safe status codes without leaking provider content', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext();
    const summary = await run(context, testNow, { sync: async () => { throw Object.assign(new Error('private-provider-text'), { code: 'CALENDAR_private-provider-text' }); } });
    assert.equal(summary.codes.CALENDAR_PROVIDER_UNAVAILABLE, 1); assert.equal(summary.failed, 1);
    assert.doesNotMatch(JSON.stringify(summary), /actor|private-provider-text|fixture-cursor|scheduler-refresh|ciphertext/);
  } finally { restore(); }
});


test('a safe decryption configuration failure is reported distinctly without marking provider reconnection', async () => {
  const restore = calendarTestEnvironment();
  try {
    const context = managedContext(), before = context.rows.get(sourcePath(calendarId));
    const summary = await run(context, testNow, { sync: async () => { throw calendarError('CALENDAR_DECRYPT_FAILED', 503, 'Administrator musi sprawdzić konfigurację.'); } });
    assert.equal(summary.failed, 1); assert.equal(summary.reconnectRequired, 0); assert.equal(summary.codes.CALENDAR_DECRYPT_FAILED, 1);
    assert.deepEqual(context.rows.get(sourcePath(calendarId)), before);
    assert.doesNotMatch(JSON.stringify(summary), /ciphertext|fixture-cursor|scheduler-refresh/);
  } finally { restore(); }
});
