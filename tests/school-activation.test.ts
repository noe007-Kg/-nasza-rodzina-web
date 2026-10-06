import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTO_SYNC_INTERVAL_MS, createActivationSync, manualSyncAvailableAt, shouldAutoSync, type ActivationConnection } from '../src/school/activation-sync.ts';

const instant = Date.parse('2026-10-03T10:00:00.000Z');
function connection(age = 61 * 60_000): ActivationConnection {
  return { configured: true, state: 'connected', selectedStudent: { profileId: 'sp4-test', personKey: 'Nikodem' }, lastSuccessAt: new Date(instant - age).toISOString() };
}

test('launch synchronizes only at or beyond one hour since the LAST SUCCESS', () => {
  assert.equal(shouldAutoSync(connection(59 * 60_000), instant), false);
  assert.equal(shouldAutoSync(connection(AUTO_SYNC_INTERVAL_MS), instant), true);
  assert.equal(shouldAutoSync(connection(61 * 60_000), instant), true);
  assert.equal(shouldAutoSync({ ...connection(), lastSyncAt: new Date(instant).toISOString() }, instant), true, 'a recent failed attempt is not a successful sync');
});

test('unavailable, disconnected, unselected, expired and already syncing journals stay quiet', () => {
  for (const status of [null, { ...connection(), configured: false }, { ...connection(), state: 'disconnected' },
    { ...connection(), selectedStudent: undefined }, { ...connection(), state: 'expired' },
    { ...connection(), expiresAt: new Date(instant).toISOString() }, { ...connection(), syncing: true }]) {
    assert.equal(shouldAutoSync(status, instant), false);
  }
  assert.equal(shouldAutoSync({ ...connection(), nextSyncAt: new Date(instant + 30_000).toISOString() }, instant), false);
});

test('a connected journal without successful history can establish its baseline', () => {
  assert.equal(shouldAutoSync({ ...connection(), lastSuccessAt: undefined }, instant), true);
  assert.equal(shouldAutoSync({ ...connection(), lastSuccessAt: undefined, lastSyncAt: new Date(instant).toISOString() }, instant), true);
});

test('manual action bypasses the hour but preserves the five-minute server cooldown', () => {
  const tenMinutes = connection(10 * 60_000);
  assert.equal(shouldAutoSync(tenMinutes, instant), false);
  assert.ok(manualSyncAvailableAt(tenMinutes)! < instant);
  assert.ok(manualSyncAvailableAt(connection(60_000))! > instant);
  const serverBoundary = new Date(instant + 30_000).toISOString();
  assert.equal(manualSyncAvailableAt({ ...tenMinutes, nextSyncAt: serverBoundary }), Date.parse(serverBoundary));
});

test('foreground refresh uses fresh metadata and synchronizes after one hour without any polling', async () => {
  let clock = instant;
  let checks = 0, syncs = 0;
  let status = connection(10 * 60_000);
  const activation = createActivationSync({ now: () => clock, status: async () => { checks++; return status; }, sync: async () => { syncs++; } });
  assert.equal(await activation.activate(), 'current');
  clock += 51 * 60_000;
  assert.equal(syncs, 0, 'time passing alone must never synchronize');
  assert.equal(checks, 1);
  assert.equal(await activation.activate(), 'synchronized');
  assert.equal(checks, 2);
  assert.equal(syncs, 1);
  status = { ...status, lastSuccessAt: new Date(clock).toISOString() };
  clock += 10 * 60_000;
  assert.equal(await activation.activate(), 'current');
  assert.equal(syncs, 1);
});

test('multiple foreground events share one pending status and one sync request', async () => {
  let resolveStatus!: (status: ActivationConnection) => void;
  let checks = 0, syncs = 0;
  const activation = createActivationSync({ now: () => instant, status: () => { checks++; return new Promise(resolve => { resolveStatus = resolve; }); }, sync: async () => { syncs++; } });
  const first = activation.activate(), second = activation.activate(), third = activation.activate();
  resolveStatus(connection());
  assert.deepEqual(await Promise.all([first, second, third]), ['synchronized', 'synchronized', 'synchronized']);
  assert.equal(checks, 1);
  assert.equal(syncs, 1);
  assert.equal(await activation.activate(), 'coalesced');
});

test('a real background transition refreshes status instead of being treated as a duplicate focus event', async () => {
  let clock = instant, status = connection(10 * 60_000), checks = 0, syncs = 0;
  const activation = createActivationSync({ now: () => clock, status: async () => { checks++; return status; }, sync: async () => { syncs++; } });
  assert.equal(await activation.activate(), 'current');
  activation.background();
  // Another parent can select a different, stale journal while this app is
  // hidden. It must use fresh server metadata even after a brief absence.
  status = connection(61 * 60_000);
  clock += 100;
  assert.equal(await activation.activate(), 'synchronized');
  assert.equal(checks, 2);
  assert.equal(syncs, 1);
  assert.equal(await activation.activate(), 'coalesced');
});

test('closed/background application and disposed user session cannot start a sync', async () => {
  let visible = false, checks = 0, syncs = 0;
  const activation = createActivationSync({ now: () => instant, visible: () => visible, status: async () => { checks++; return connection(); }, sync: async () => { syncs++; } });
  assert.equal(await activation.activate(), 'inactive');
  assert.equal(checks, 0);
  visible = true;
  activation.dispose();
  assert.equal(await activation.activate(), 'inactive');
  assert.equal(syncs, 0);
});

test('going to the background while the status request completes cancels its automatic sync', async () => {
  let visible = true, syncs = 0;
  let resolveStatus!: (status: ActivationConnection) => void;
  const activation = createActivationSync({ now: () => instant, visible: () => visible, status: () => new Promise(resolve => { resolveStatus = resolve; }), sync: async () => { syncs++; } });
  const pending = activation.activate();
  visible = false;
  resolveStatus(connection());
  assert.equal(await pending, 'inactive');
  assert.equal(syncs, 0);
});

test('network failure remains quiet and a later foreground activation may retry', async () => {
  let clock = instant, checks = 0;
  const activation = createActivationSync({ now: () => clock, status: async () => { if (++checks === 1) throw new Error('offline'); return connection(10 * 60_000); }, sync: async () => { throw new Error('must not sync'); } });
  assert.equal(await activation.activate(), 'failed');
  clock += 5_000;
  assert.equal(await activation.activate(), 'current');
  assert.equal(checks, 2);
});
