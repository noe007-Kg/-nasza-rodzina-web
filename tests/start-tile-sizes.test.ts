import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartTileSizeStore, normalizeStartTileSizes, parseStoredStartTileSizes, selectedStartTileSize, startTileSizesCacheKey, type StartTileSizeStorage } from '../src/features/start-tile-sizes';
import { dashboardCacheKey } from '../src/features/start-layout';

function memoryStorage(): StartTileSizeStorage & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); }, removeItem: key => { rows.delete(key); } };
}

test('missing, automatic or invalid sizes retain content-driven defaults', () => {
  assert.equal(selectedStartTileSize({}, 'family-time'), 'auto');
  assert.deepEqual(normalizeStartTileSizes({ calendar: 'wide', chat: 'auto', shopping: '999px', unknown: 'large' }), { calendar: 'wide' });
  assert.deepEqual(normalizeStartTileSizes(Object.create({ calendar: 'large' })), {});
  assert.deepEqual(parseStoredStartTileSizes('{'), {});
  assert.deepEqual(parseStoredStartTileSizes('{"schemaVersion":2,"sizes":{"chat":"large"}}'), {});
  assert.deepEqual(parseStoredStartTileSizes(' '.repeat(4097)), {});
});

test('individual choices persist by UID and returning to auto leaves other tile sizes unchanged', () => {
  const storage = memoryStorage();
  const first = createStartTileSizeStore('uid-a', () => storage);
  const second = createStartTileSizeStore('uid-b', () => storage);
  first.setSize('family-time', 'wide');
  first.setSize('chat', 'small');
  second.setSize('family-time', 'large');
  first.setSize('chat', 'auto');
  assert.deepEqual(first.getSnapshot().sizes, { 'family-time': 'wide' });
  assert.deepEqual(second.getSnapshot().sizes, { 'family-time': 'large' });
  assert.deepEqual(createStartTileSizeStore('uid-a', () => storage).getSnapshot().sizes, { 'family-time': 'wide' });
  assert.deepEqual(createStartTileSizeStore('uid-c', () => storage).getSnapshot().sizes, {});
  assert.notEqual(startTileSizesCacheKey('a:b'), startTileSizesCacheKey('a%3Ab'));
  assert.throws(() => startTileSizesCacheKey(''), /identyfikatora/);
});

test('size reset preserves saved order, colors, theme and another user', () => {
  const storage = memoryStorage();
  storage.rows.set(dashboardCacheKey('uid-a'), '["chat","calendar"]');
  storage.rows.set('nr-start-tile-colors:v1:uid-a', '{"schemaVersion":1,"colors":{"chat":"pink"}}');
  storage.rows.set('nr-theme', 'dark');
  const first = createStartTileSizeStore('uid-a', () => storage);
  const second = createStartTileSizeStore('uid-b', () => storage);
  first.setSize('chat', 'medium');
  second.setSize('chat', 'large');
  first.resetSizes();
  assert.equal(storage.rows.has(first.key), false);
  assert.equal(storage.rows.get(dashboardCacheKey('uid-a')), '["chat","calendar"]');
  assert.ok(storage.rows.has('nr-start-tile-colors:v1:uid-a'));
  assert.equal(storage.rows.get('nr-theme'), 'dark');
  assert.deepEqual(second.getSnapshot().sizes, { chat: 'large' });
});

test('mounted views update immediately and other-tab updates stay UID scoped', () => {
  const storage = memoryStorage();
  const store = createStartTileSizeStore('uid-a', () => storage);
  const updates: unknown[] = [];
  const stop = store.subscribe(() => updates.push(store.getSnapshot().sizes));
  store.setSize('school', 'large');
  store.applyStorageEvent(startTileSizesCacheKey('uid-b'), '{"schemaVersion":1,"sizes":{"school":"small"}}');
  store.applyStorageEvent(store.key, '{"schemaVersion":1,"sizes":{"school":"medium"}}');
  store.applyStorageEvent(null, null);
  assert.deepEqual(updates, [{ school: 'large' }, { school: 'medium' }, {}]);
  stop();
});

test('storage failure keeps sizes across navigation while warning that saving failed', () => {
  const storage: StartTileSizeStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const store = createStartTileSizeStore('uid-a', () => storage);
  store.setSize('shopping', 'wide');
  store.refreshFromStorage();
  assert.deepEqual(store.getSnapshot().sizes, { shopping: 'wide' });
  assert.equal(store.getSnapshot().persistence, 'memory');
  assert.match(store.getSnapshot().storageMessage || '', /do zamknięcia/);
});

test('returning to Start reads validated changes made while it was unmounted', () => {
  const storage = memoryStorage();
  const store = createStartTileSizeStore('uid-a', () => storage);
  storage.rows.set(store.key, '{"schemaVersion":1,"sizes":{"health":"small"}}');
  store.refreshFromStorage();
  assert.deepEqual(store.getSnapshot().sizes, { health: 'small' });
  const snapshot = store.getSnapshot();
  store.refreshFromStorage();
  assert.equal(store.getSnapshot(), snapshot);
});
