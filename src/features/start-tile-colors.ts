import type { CSSProperties } from 'react';
import { START_CARD_IDS, type StartCardId } from './start-layout';

/** Only palette identifiers are persisted; arbitrary CSS never comes from storage. */
export const START_TILE_COLOR_PALETTE = [
  { id: 'pink', label: 'Pastelowy róż', background: '#fff1f7', accent: '#a32368', darkBackground: '#352332', darkAccent: '#ffc8e4' },
  { id: 'lavender', label: 'Lawendowy', background: '#f4eeff', accent: '#6642a6', darkBackground: '#2e2640', darkAccent: '#d8c3ff' },
  { id: 'violet', label: 'Fioletowy', background: '#f0edff', accent: '#5941b0', darkBackground: '#2a2545', darkAccent: '#d1c4ff' },
  { id: 'blue', label: 'Błękitny', background: '#edf7ff', accent: '#226392', darkBackground: '#203143', darkAccent: '#bddfff' },
  { id: 'mint', label: 'Miętowy', background: '#ecfbf3', accent: '#246b51', darkBackground: '#20352d', darkAccent: '#b5efd4' },
  { id: 'green', label: 'Jasnozielony', background: '#f2fae9', accent: '#416629', darkBackground: '#2a3524', darkAccent: '#d0ecb5' },
  { id: 'yellow', label: 'Żółty', background: '#fff8df', accent: '#795b16', darkBackground: '#393223', darkAccent: '#f5df98' },
  { id: 'peach', label: 'Brzoskwiniowy', background: '#fff0e6', accent: '#98542c', darkBackground: '#3a2b23', darkAccent: '#f6c8aa' },
  { id: 'neutral', label: 'Neutralny jasny', background: '#f7f7fc', accent: '#565776', darkBackground: '#2c2c39', darkAccent: '#d7d7ed' },
] as const;

export type StartTileColorId = typeof START_TILE_COLOR_PALETTE[number]['id'];
export type StartTileColors = Readonly<Partial<Record<StartCardId, StartTileColorId>>>;
export type StartTileColorChoice = StartTileColorId | 'original';
export const START_TILE_COLOR_TEXT = { light: '#171b4b', lightMuted: '#5f576f', dark: '#f5f2ff', darkMuted: '#cfccdf' } as const;
const EMPTY_COLORS: StartTileColors = Object.freeze({});
const PERSISTENCE_MESSAGE = 'Nie udało się zapisać kolorów na tym urządzeniu. Zmiany działają tylko do zamknięcia tej strony.';

export function normalizeStartTileColors(value: unknown): StartTileColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_COLORS;
  const result: Partial<Record<StartCardId, StartTileColorId>> = {};
  for (const cardId of START_CARD_IDS) {
    if (!Object.hasOwn(value, cardId)) continue;
    const color = (value as Record<string, unknown>)[cardId];
    if (START_TILE_COLOR_PALETTE.some(item => item.id === color)) result[cardId] = color as StartTileColorId;
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
  const colorId = colors[cardId];
  return START_TILE_COLOR_PALETTE.find(item => item.id === colorId)?.id;
}

/** No style for an original tile: default appearance remains entirely unchanged. */
export function getStartTileColorStyle(colors: StartTileColors, cardId: StartCardId): CSSProperties | undefined {
  const palette = START_TILE_COLOR_PALETTE.find(item => item.id === colors[cardId]);
  if (!palette) return undefined;
  return {
    '--start-user-background': palette.background,
    '--start-user-accent': palette.accent,
    '--start-user-dark-background': palette.darkBackground,
    '--start-user-dark-accent': palette.darkAccent,
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
      if (colorId !== 'original' && !START_TILE_COLOR_PALETTE.some(item => item.id === colorId)) return;
      const next: Partial<Record<StartCardId, StartTileColorId>> = { ...snapshot.colors };
      if (colorId === 'original') delete next[cardId];
      else next[cardId] = colorId;
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
