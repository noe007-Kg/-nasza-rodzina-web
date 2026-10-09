import type { CSSProperties } from 'react';
import { START_CARD_IDS, type StartCardId } from './start-layout';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function contrast(first: string, second: string): number {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

/** Prefer the existing navy; otherwise black/white guarantees normal-text contrast. */
function readableText(background: string): string {
  if (contrast(background, '#171b4b') >= 4.5) return '#171b4b';
  return contrast(background, '#ffffff') >= contrast(background, '#000000') ? '#ffffff' : '#000000';
}

function innerSurface(background: string, text: string): string {
  const target = text === '#ffffff' ? 0 : 255;
  return `#${[1, 3, 5].map(offset => Math.round(Number.parseInt(background.slice(offset, offset + 2), 16) * .86 + target * .14).toString(16).padStart(2, '0')).join('')}`;
}

/** Only palette IDs or validated hex colors are persisted, never arbitrary CSS. */
export const START_TILE_COLOR_PALETTE = ([
  { id: 'pink', label: 'Różowy', background: '#ff2fa8' },
  { id: 'violet', label: 'Fioletowy', background: '#7d35ff' },
  { id: 'blue', label: 'Niebieski', background: '#087dff' },
  { id: 'turquoise', label: 'Turkusowy', background: '#00dac8' },
  { id: 'green', label: 'Zielony', background: '#59f52f' },
  { id: 'yellow', label: 'Żółty', background: '#ffdf00' },
  { id: 'orange', label: 'Pomarańczowy', background: '#ff8a16' },
  { id: 'red', label: 'Czerwony', background: '#ff3355' },
] as const).map(color => ({ ...color, accent: readableText(color.background), darkBackground: color.background, darkAccent: readableText(color.background) }));

const LEGACY_COLORS = { lavender: 'violet', mint: 'turquoise', peach: 'orange', neutral: '#f7f7fc' } as const;

export type StartTileColorId = typeof START_TILE_COLOR_PALETTE[number]['id'] | `#${string}`;
export type StartTileColors = Readonly<Partial<Record<StartCardId, StartTileColorId>>>;
export type StartTileColorChoice = StartTileColorId | 'original' | keyof typeof LEGACY_COLORS;
const EMPTY_COLORS: StartTileColors = Object.freeze({});
const PERSISTENCE_MESSAGE = 'Nie udało się zapisać kolorów na tym urządzeniu. Zmiany działają tylko do zamknięcia tej strony.';

export function normalizeStartTileColor(value: unknown): StartTileColorId | undefined {
  if (typeof value !== 'string') return undefined;
  const palette = START_TILE_COLOR_PALETTE.find(color => color.id === value);
  if (palette) return palette.id;
  if (Object.hasOwn(LEGACY_COLORS, value)) return LEGACY_COLORS[value as keyof typeof LEGACY_COLORS];
  return /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() as StartTileColorId : undefined;
}

export function normalizeStartTileColors(value: unknown): StartTileColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_COLORS;
  const result: Partial<Record<StartCardId, StartTileColorId>> = {};
  for (const cardId of START_CARD_IDS) {
    if (!Object.hasOwn(value, cardId)) continue;
    const color = normalizeStartTileColor((value as Record<string, unknown>)[cardId]);
    if (color) result[cardId] = color;
  }
  return Object.keys(result).length ? Object.freeze(result) : EMPTY_COLORS;
}

export function startTileColorsCacheKey(uid: string): string {
  if (!uid.trim()) throw new Error('Kolory kafelków wymagają identyfikatora zalogowanego użytkownika.');
  return `nr-start-tile-colors:v1:${encodeURIComponent(uid)}`;
}

export function parseStoredStartTileColors(serialized: string | null): StartTileColors {
  if (!serialized || serialized.length > 4096) return EMPTY_COLORS;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_COLORS;
    const envelope = value as Record<string, unknown>;
    return envelope.schemaVersion === 1 ? normalizeStartTileColors(envelope.colors) : EMPTY_COLORS;
  } catch { return EMPTY_COLORS; }
}

export function selectedStartTileColorId(colors: StartTileColors, cardId: StartCardId): StartTileColorId | undefined {
  return normalizeStartTileColor(colors[cardId]);
}

/** No style for an original tile: default appearance remains entirely unchanged. */
export function getStartTileColorStyle(colors: StartTileColors, cardId: StartCardId): CSSProperties | undefined {
  const color = selectedStartTileColorId(colors, cardId);
  if (!color) return undefined;
  const background = color.startsWith('#') ? color : START_TILE_COLOR_PALETTE.find(item => item.id === color)!.background;
  const text = readableText(background);
  return {
    '--start-user-background': background,
    '--start-user-accent': text,
    '--start-user-dark-background': background,
    '--start-user-dark-accent': text,
    '--start-user-text': text,
    '--start-user-muted': text,
    '--start-user-surface': innerSurface(background, text),
  } as CSSProperties;
}

export type StartTileColorStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type StartTileColorSnapshot = Readonly<{
  colors: StartTileColors;
  persistence: 'saved' | 'memory';
  storageMessage: string | null;
}>;

/** One store per UID. It only touches its own key, never theme/order or Firebase. */
export function createStartTileColorStore(uid: string, getStorage: () => StartTileColorStorage | null) {
  const key = startTileColorsCacheKey(uid);
  const listeners = new Set<() => void>();
  let snapshot: StartTileColorSnapshot;
  try {
    const storage = getStorage();
    if (!storage) throw new Error('storage-unavailable');
    snapshot = Object.freeze({ colors: parseStoredStartTileColors(storage.getItem(key)), persistence: 'saved', storageMessage: null });
  } catch {
    snapshot = Object.freeze({ colors: EMPTY_COLORS, persistence: 'memory', storageMessage: PERSISTENCE_MESSAGE });
  }

  function publish(next: StartTileColorSnapshot) {
    if (next.persistence === snapshot.persistence && next.storageMessage === snapshot.storageMessage
      && JSON.stringify(next.colors) === JSON.stringify(snapshot.colors)) return;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  function save(colors: StartTileColors) {
    try {
      const storage = getStorage();
      if (!storage) throw new Error('storage-unavailable');
      if (Object.keys(colors).length) storage.setItem(key, JSON.stringify({ schemaVersion: 1, colors }));
      else storage.removeItem(key);
      publish({ colors, persistence: 'saved', storageMessage: null });
    } catch {
      publish({ colors, persistence: 'memory', storageMessage: PERSISTENCE_MESSAGE });
    }
  }
  return {
    key,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setColor(cardId: StartCardId, colorId: StartTileColorChoice) {
      if (!START_CARD_IDS.includes(cardId)) return;
      const normalized = normalizeStartTileColor(colorId);
      if (colorId !== 'original' && !normalized) return;
      const next: Partial<Record<StartCardId, StartTileColorId>> = { ...snapshot.colors };
      if (colorId === 'original') delete next[cardId];
      else next[cardId] = normalized;
      save(normalizeStartTileColors(next));
    },
    resetColors() { save(EMPTY_COLORS); },
    /** Catch changes made while no Start/Settings consumer was mounted. */
    refreshFromStorage() {
      // Failed writes remain usable across navigation until the page closes.
      if (snapshot.persistence === 'memory') return;
      try {
        const storage = getStorage();
        if (!storage) throw new Error('storage-unavailable');
        publish({ colors: parseStoredStartTileColors(storage.getItem(key)), persistence: 'saved', storageMessage: null });
      } catch {
        publish({ colors: snapshot.colors, persistence: 'memory', storageMessage: PERSISTENCE_MESSAGE });
      }
    },
    /** Validated updates from other tabs. null key represents localStorage.clear(). */
    applyStorageEvent(changedKey: string | null, value: string | null) {
      if (changedKey !== key && changedKey !== null) return;
      publish({ colors: changedKey === null ? EMPTY_COLORS : parseStoredStartTileColors(value), persistence: 'saved', storageMessage: null });
    },
  };
}
