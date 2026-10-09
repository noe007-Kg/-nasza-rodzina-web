import assert from 'node:assert/strict';
import test from 'node:test';
import { CALENDAR_AUTO_SYNC_MS, createCalendarActivationSync, shouldRefreshCalendar } from '../src/calendars/activation-sync.ts';
import type { CalendarConnection, CalendarStatusResponse } from '../src/calendars/model.ts';
const instant = Date.parse('2026-10-07T10:00:00Z');
function connection(age = 61 * 60_000): CalendarConnection { return { id: 'one', provider: 'google', calendarId: 'primary', calendarName: 'Kalendarz', ownerProfileId: 'me', person: 'Osoba', visibility: 'private', mode: 'sync', status: 'connected', selectionConfirmed: true, lastSuccessfulSyncAt: new Date(instant - age).toISOString(), lastAttemptAt: null, lastErrorCode: null }; }
function status(row = connection()): CalendarStatusResponse { return { ok: true, configured: true, connections: [row] }; }

test('automatic calendar sync starts at one hour since successful sync, never a failed attempt', () => {
  assert.equal(shouldRefreshCalendar(connection(59 * 60_000), instant), false); assert.equal(shouldRefreshCalendar(connection(CALENDAR_AUTO_SYNC_MS), instant), true);
  assert.equal(shouldRefreshCalendar({ ...connection(), lastAttemptAt: new Date(instant).toISOString() }, instant), true);
  assert.equal(shouldRefreshCalendar({ ...connection(), lastSuccessfulSyncAt: new Date(instant + 60_000).toISOString() }, instant), false);
});
test('first import is allowed only for an explicitly confirmed sync source', () => {
  assert.equal(shouldRefreshCalendar({ ...connection(), lastSuccessfulSyncAt: null }, instant), true);
  assert.equal(shouldRefreshCalendar({ ...connection(), selectionConfirmed: false, lastSuccessfulSyncAt: null }, instant), false);
});
test('one-shot imports, disconnected and expired connections never autosync', () => {
  for (const row of [{ ...connection(), mode: 'import' as const }, { ...connection(), status: 'imported' as const }, { ...connection(), status: 'disconnected' as const }, { ...connection(), status: 'needs-reconnect' as const }]) assert.equal(shouldRefreshCalendar(row, instant), false);
});
test('missing configuration remains quiet and does not require Google Auth or VAPID', async () => {
  let syncs = 0;
  const coordinator = createCalendarActivationSync({ status: async () => ({ ...status(), configured: false }), sync: async () => { syncs++; } });
  assert.equal(await coordinator.activate(), 'current'); assert.equal(syncs, 0);
});
test('foreground after more than an hour uses fresh status; time passing alone never polls', async () => {
  let clock = instant, checks = 0, syncs = 0;
  const coordinator = createCalendarActivationSync({ now: () => clock, status: async () => { checks++; return status(connection(10 * 60_000)); }, sync: async () => { syncs++; } });
  assert.equal(await coordinator.activate(), 'current'); clock += 51 * 60_000;
  assert.equal(checks, 1); assert.equal(syncs, 0); coordinator.background();
  assert.equal(await coordinator.activate(), 'synchronized'); assert.equal(checks, 2); assert.equal(syncs, 1);
});
test('an activation event burst shares one status and sync; no module-navigation input exists', async () => {
  let resolve!: (value: CalendarStatusResponse) => void, checks = 0, syncs = 0;
  const coordinator = createCalendarActivationSync({ now: () => instant, status: () => { checks++; return new Promise(done => { resolve = done; }); }, sync: async () => { syncs++; } });
  const first = coordinator.activate(), second = coordinator.activate(); resolve(status());
  assert.deepEqual(await Promise.all([first, second]), ['synchronized', 'synchronized']); assert.equal(checks, 1); assert.equal(syncs, 1); assert.equal(await coordinator.activate(), 'coalesced');
});
test('inactive, disposed and changed-account scopes cannot schedule a request', async () => {
  let active = false, calls = 0;
  const coordinator = createCalendarActivationSync({ active: () => active, status: async () => { calls++; return status(); }, sync: async () => { calls++; } });
  assert.equal(await coordinator.activate(), 'inactive'); active = true; coordinator.dispose(); assert.equal(await coordinator.activate(), 'inactive'); assert.equal(calls, 0);
});
test('account/background change during pending metadata prevents synchronization', async () => {
  let active = true, resolve!: (value: CalendarStatusResponse) => void, syncs = 0;
  const coordinator = createCalendarActivationSync({ active: () => active, status: () => new Promise(done => { resolve = done; }), sync: async () => { syncs++; } });
  const pending = coordinator.activate(); active = false; resolve(status()); assert.equal(await pending, 'inactive'); assert.equal(syncs, 0);
});
test('one failing source does not block another due source and no raw error is surfaced', async () => {
  const ids: string[] = [];
  const coordinator = createCalendarActivationSync({ status: async () => ({ ...status(), connections: [connection(), { ...connection(), id: 'two' }] }), sync: async id => { ids.push(id); if (id === 'one') throw new Error('private-provider-token'); } });
  assert.equal(await coordinator.activate(), 'synchronized'); assert.deepEqual(ids, ['one', 'two']);
});
test('offline activation may retry on a later foreground event without background timers', async () => {
  let count = 0, clock = instant;
  const coordinator = createCalendarActivationSync({ now: () => clock, status: async () => { if (++count === 1) throw new Error('offline'); return status(connection(1_000)); }, sync: async () => { throw new Error('must not sync'); } });
  assert.equal(await coordinator.activate(), 'failed'); clock += 5_000; assert.equal(await coordinator.activate(), 'current'); assert.equal(count, 2);
});
