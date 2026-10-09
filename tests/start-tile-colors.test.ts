import test from 'node:test';
import assert from 'node:assert/strict';
import {
  START_TILE_COLOR_PALETTE, START_TILE_COLOR_TEXT, createStartTileColorStore,
  getStartTileColorStyle, normalizeStartTileColors, parseStoredStartTileColors,
  selectedStartTileColorId, startTileColorsCacheKey, type StartTileColorStorage,
} from '../src/features/start-tile-colors';
import { START_CARD_IDS, dashboardCacheKey } from '../src/features/start-layout';

function memoryStorage(): StartTileColorStorage & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); }, removeItem: key => { rows.delete(key); } };
}

test('tile colors accept only supported tile IDs and palette identifiers, never arbitrary CSS', () => {
  const parsed = JSON.parse('{"shopping":"mint","chat":"violet","health":"url(https://example.invalid)","school":"#ffffff","unknown":"pink","__proto__":"yellow"}');
  assert.deepEqual(normalizeStartTileColors(parsed), { shopping: 'mint', chat: 'violet' });
  assert.deepEqual(normalizeStartTileColors(['pink']), {});
  assert.deepEqual(normalizeStartTileColors(null), {});
  assert.deepEqual(normalizeStartTileColors(Object.create({ calendar: 'blue' })), {});
  assert.deepEqual(normalizeStartTileColors({ calendar: 'original' }), {});
});

test('cache envelopes reject unsupported schemas, broken JSON and oversized input', () => {
  assert.deepEqual(parseStoredStartTileColors('{"schemaVersion":1,"colors":{"shopping":"mint"}}'), { shopping: 'mint' });
  assert.deepEqual(parseStoredStartTileColors('{"schemaVersion":2,"colors":{"shopping":"mint"}}'), {});
  assert.deepEqual(parseStoredStartTileColors('{"shopping":"mint"}'), {});
  assert.deepEqual(parseStoredStartTileColors('{'), {});
  assert.deepEqual(parseStoredStartTileColors(' '.repeat(4097)), {});
});

test('all seven tiles have independent choices; original removes only the selected customization', () => {
  const storage = memoryStorage();
  const store = createStartTileColorStore('user-a', () => storage);
  for (const cardId of START_CARD_IDS) store.setColor(cardId, 'pink');
  store.setColor('shopping', 'mint');
  store.setColor('chat', 'violet');
  store.setColor('shopping', 'original');
  assert.equal(store.getSnapshot().colors.shopping, undefined);
  assert.equal(store.getSnapshot().colors.chat, 'violet');
  assert.equal(store.getSnapshot().colors.calendar, 'pink');
  assert.equal(Object.keys(store.getSnapshot().colors).length, 6);
  assert.equal(store.getSnapshot().persistence, 'saved');
});

test('UID-scoped storage separates members and restores each saved arrangement after restart', () => {
  const storage = memoryStorage();
  const first = createStartTileColorStore('uid-a', () => storage);
  const second = createStartTileColorStore('uid-b', () => storage);
  first.setColor('calendar', 'blue');
  second.setColor('calendar', 'yellow');
  assert.notEqual(first.key, second.key);
  assert.deepEqual(first.getSnapshot().colors, { calendar: 'blue' });
  assert.deepEqual(second.getSnapshot().colors, { calendar: 'yellow' });
  assert.deepEqual(createStartTileColorStore('uid-a', () => storage).getSnapshot().colors, { calendar: 'blue' });
  assert.deepEqual(createStartTileColorStore('uid-c', () => storage).getSnapshot().colors, {});
  assert.notEqual(startTileColorsCacheKey('a:b'), startTileColorsCacheKey('a%3Ab'));
  assert.throws(() => startTileColorsCacheKey(''), /identyfikatora/);
});

test('reset removes only color preferences and preserves theme, order and another UID', () => {
  const storage = memoryStorage();
  storage.rows.set('nr-theme', 'dark');
  storage.rows.set(dashboardCacheKey('uid-a'), '["chat","calendar"]');
  const first = createStartTileColorStore('uid-a', () => storage);
  const second = createStartTileColorStore('uid-b', () => storage);
  first.setColor('chat', 'violet');
  second.setColor('chat', 'mint');
  first.resetColors();
  assert.deepEqual(first.getSnapshot().colors, {});
  assert.equal(storage.rows.has(first.key), false);
  assert.equal(storage.rows.get('nr-theme'), 'dark');
  assert.equal(storage.rows.get(dashboardCacheKey('uid-a')), '["chat","calendar"]');
  assert.deepEqual(parseStoredStartTileColors(storage.rows.get(second.key) ?? null), { chat: 'mint' });
});

test('mounted consumers receive immediate snapshots, including a reset and validated other-tab changes', () => {
  const storage = memoryStorage();
  const store = createStartTileColorStore('uid-a', () => storage);
  const delivered: unknown[] = [];
  const stop = store.subscribe(() => delivered.push(store.getSnapshot().colors));
  store.setColor('shopping', 'mint');
  store.applyStorageEvent(startTileColorsCacheKey('uid-b'), '{"schemaVersion":1,"colors":{"shopping":"pink"}}');
  assert.deepEqual(store.getSnapshot().colors, { shopping: 'mint' });
  store.applyStorageEvent(store.key, '{"schemaVersion":1,"colors":{"chat":"yellow","shopping":"invalid"}}');
  store.resetColors();
  assert.deepEqual(delivered, [{ shopping: 'mint' }, { chat: 'yellow' }, {}]);
  stop();
  store.setColor('health', 'peach');
  assert.equal(delivered.length, 3);
});

test('a cache deletion restores original colors and cache clear does not import any other UID', () => {
  const storage = memoryStorage();
  const store = createStartTileColorStore('uid-a', () => storage);
  store.setColor('tasks', 'yellow');
  store.applyStorageEvent(store.key, null);
  assert.deepEqual(store.getSnapshot().colors, {});
  store.setColor('calendar', 'green');
  store.applyStorageEvent(null, '{"schemaVersion":1,"colors":{"calendar":"pink"}}');
  assert.deepEqual(store.getSnapshot().colors, {});
});

test('returning to a mounted view refreshes same-UID changes made in another tab while it was closed', () => {
  const storage = memoryStorage();
  const store = createStartTileColorStore('uid-a', () => storage);
  store.setColor('shopping', 'mint');
  storage.rows.set(store.key, '{"schemaVersion":1,"colors":{"shopping":"blue"}}');
  storage.rows.set(startTileColorsCacheKey('uid-b'), '{"schemaVersion":1,"colors":{"shopping":"pink"}}');
  store.refreshFromStorage();
  assert.deepEqual(store.getSnapshot().colors, { shopping: 'blue' });
  const snapshot = store.getSnapshot();
  store.refreshFromStorage();
  assert.equal(store.getSnapshot(), snapshot, 'identical reads do not replace shared snapshots');
});

test('navigation does not discard unsaved in-memory colors when browser storage refused a write', () => {
  const storage: StartTileColorStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const store = createStartTileColorStore('uid-a', () => storage);
  store.setColor('shopping', 'mint');
  store.refreshFromStorage();
  assert.deepEqual(store.getSnapshot().colors, { shopping: 'mint' });
  assert.equal(store.getSnapshot().persistence, 'memory');
});

test('unavailable or full storage keeps changes in memory and clearly reports that they were not saved', () => {
  const unavailable = createStartTileColorStore('uid-a', () => null);
  assert.equal(unavailable.getSnapshot().persistence, 'memory');
  unavailable.setColor('tasks', 'yellow');
  assert.deepEqual(unavailable.getSnapshot().colors, { tasks: 'yellow' });
  assert.match(unavailable.getSnapshot().storageMessage || '', /do zamknięcia/);
  const full: StartTileColorStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('SecurityError'); } };
  const store = createStartTileColorStore('uid-b', () => full);
  store.setColor('chat', 'violet');
  assert.equal(store.getSnapshot().persistence, 'memory');
  assert.match(store.getSnapshot().storageMessage || '', /Nie udało się zapisać/);
  store.resetColors();
  assert.deepEqual(store.getSnapshot().colors, {});
  assert.equal(store.getSnapshot().persistence, 'memory');
});

test('when storage becomes available a new choice saves the current user colors without dropping them', () => {
  let storage: StartTileColorStorage | null = null;
  const store = createStartTileColorStore('uid-a', () => storage);
  store.setColor('chat', 'violet');
  storage = memoryStorage();
  store.setColor('shopping', 'mint');
  assert.equal(store.getSnapshot().persistence, 'saved');
  assert.equal(store.getSnapshot().storageMessage, null);
  assert.deepEqual(parseStoredStartTileColors(storage.getItem(store.key)), { chat: 'violet', shopping: 'mint' });
});

test('original tiles get no inline style or custom attribute; custom values come only from the palette', () => {
  assert.equal(getStartTileColorStyle({}, 'chat'), undefined);
  assert.equal(selectedStartTileColorId({}, 'chat'), undefined);
  const colors = normalizeStartTileColors({ chat: 'blue' });
  assert.equal(selectedStartTileColorId(colors, 'chat'), 'blue');
  assert.deepEqual(getStartTileColorStyle(colors, 'chat'), {
    '--start-user-background': '#edf7ff', '--start-user-accent': '#226392',
    '--start-user-dark-background': '#203143', '--start-user-dark-accent': '#bddfff',
  });
});

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(channel => Number.parseInt(channel, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a: string, b: string) {
  const first = luminance(a); const second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

test('all nine palettes have readable normal text, subtitles and action accents in light and dark themes', () => {
  assert.equal(START_TILE_COLOR_PALETTE.length, 9);
  assert.equal(new Set(START_TILE_COLOR_PALETTE.map(color => color.id)).size, 9);
  for (const palette of START_TILE_COLOR_PALETTE) {
    for (const text of [START_TILE_COLOR_TEXT.light, START_TILE_COLOR_TEXT.lightMuted, palette.accent]) {
      assert.ok(contrast(palette.background, text) >= 4.5, `${palette.id}: light text ${text}`);
    }
    for (const text of [START_TILE_COLOR_TEXT.dark, START_TILE_COLOR_TEXT.darkMuted, palette.darkAccent]) {
      assert.ok(contrast(palette.darkBackground, text) >= 4.5, `${palette.id}: dark text ${text}`);
    }
  }
});
