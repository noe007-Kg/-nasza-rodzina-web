import { START_CARD_IDS, type StartCardId } from './start-layout';

export const START_TILE_SIZE_OPTIONS = [
  { id: 'auto', label: 'Automatyczny' },
  { id: 'small', label: 'Mały' },
  { id: 'medium', label: 'Średni' },
  { id: 'wide', label: 'Szeroki' },
  { id: 'large', label: 'Duży' },
] as const;
export type StartTileSize = typeof START_TILE_SIZE_OPTIONS[number]['id'];
export type StartTileSizes = Readonly<Partial<Record<StartCardId, Exclude<StartTileSize, 'auto'>>>>;
export type StartTileSizeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const EMPTY_SIZES: StartTileSizes = Object.freeze({});
const STORAGE_MESSAGE = 'Nie udało się zapisać rozmiarów na tym urządzeniu. Zmiany działają tylko do zamknięcia tej strony.';

export function normalizeStartTileSizes(value: unknown): StartTileSizes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_SIZES;
  const sizes: Partial<Record<StartCardId, Exclude<StartTileSize, 'auto'>>> = {};
  for (const id of START_CARD_IDS) {
    if (!Object.hasOwn(value, id)) continue;
    const size = (value as Record<string, unknown>)[id];
    if (size === 'small' || size === 'medium' || size === 'wide' || size === 'large') sizes[id] = size;
  }
  return Object.keys(sizes).length ? Object.freeze(sizes) : EMPTY_SIZES;
}

export function startTileSizesCacheKey(uid: string) {
  if (!uid.trim()) throw new Error('Rozmiary kafelków wymagają identyfikatora zalogowanego użytkownika.');
  return `nr-start-tile-sizes:v1:${encodeURIComponent(uid)}`;
}

export function parseStoredStartTileSizes(serialized: string | null): StartTileSizes {
  if (!serialized || serialized.length > 4096) return EMPTY_SIZES;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_SIZES;
    const envelope = value as Record<string, unknown>;
    return envelope.schemaVersion === 1 ? normalizeStartTileSizes(envelope.sizes) : EMPTY_SIZES;
  } catch { return EMPTY_SIZES; }
}

export function selectedStartTileSize(sizes: StartTileSizes, id: StartCardId): StartTileSize {
  const size = sizes[id];
  return size && START_TILE_SIZE_OPTIONS.some(option => option.id === size) ? size : 'auto';
}

type Snapshot = Readonly<{ sizes: StartTileSizes; persistence: 'saved' | 'memory'; storageMessage: string | null }>;

/** The same UID-scoped local preference pattern as tile colors; order and Firebase are untouched. */
export function createStartTileSizeStore(uid: string, getStorage: () => StartTileSizeStorage | null) {
  const key = startTileSizesCacheKey(uid);
  const listeners = new Set<() => void>();
  let snapshot: Snapshot;
  try {
    const storage = getStorage();
    if (!storage) throw new Error('storage-unavailable');
    snapshot = Object.freeze({ sizes: parseStoredStartTileSizes(storage.getItem(key)), persistence: 'saved', storageMessage: null });
  } catch {
    snapshot = Object.freeze({ sizes: EMPTY_SIZES, persistence: 'memory', storageMessage: STORAGE_MESSAGE });
  }
  function publish(next: Snapshot) {
    if (next.persistence === snapshot.persistence && next.storageMessage === snapshot.storageMessage
      && JSON.stringify(next.sizes) === JSON.stringify(snapshot.sizes)) return;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  function save(sizes: StartTileSizes) {
    try {
      const storage = getStorage();
      if (!storage) throw new Error('storage-unavailable');
      if (Object.keys(sizes).length) storage.setItem(key, JSON.stringify({ schemaVersion: 1, sizes }));
      else storage.removeItem(key);
      publish({ sizes, persistence: 'saved', storageMessage: null });
    } catch { publish({ sizes, persistence: 'memory', storageMessage: STORAGE_MESSAGE }); }
  }
  return {
    key,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setSize(id: StartCardId, size: StartTileSize) {
      if (!START_CARD_IDS.includes(id) || !START_TILE_SIZE_OPTIONS.some(option => option.id === size)) return;
      const next = { ...snapshot.sizes };
      if (size === 'auto') delete next[id];
      else next[id] = size;
      save(normalizeStartTileSizes(next));
    },
    resetSizes() { save(EMPTY_SIZES); },
    refreshFromStorage() {
      if (snapshot.persistence === 'memory') return;
      try {
        const storage = getStorage();
        if (!storage) throw new Error('storage-unavailable');
        publish({ sizes: parseStoredStartTileSizes(storage.getItem(key)), persistence: 'saved', storageMessage: null });
      } catch { publish({ sizes: snapshot.sizes, persistence: 'memory', storageMessage: STORAGE_MESSAGE }); }
    },
    applyStorageEvent(changedKey: string | null, serialized: string | null) {
      if (changedKey !== key && changedKey !== null) return;
      publish({ sizes: changedKey === null ? EMPTY_SIZES : parseStoredStartTileSizes(serialized), persistence: 'saved', storageMessage: null });
    },
  };
}
