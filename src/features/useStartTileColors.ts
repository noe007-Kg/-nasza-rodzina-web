import { useMemo, useSyncExternalStore } from 'react';
import { createStartTileColorStore } from './start-tile-colors';
import './start-tile-colors.css';

type ColorStore = ReturnType<typeof createStartTileColorStore>;
const stores = new Map<string, ColorStore>();

function browserStorage() {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

function storeForUid(uid: string) {
  const existing = stores.get(uid);
  if (existing) return existing;
  const store = createStartTileColorStore(uid, browserStorage);
  stores.set(uid, store);
  return store;
}

/** Shared snapshots immediately update mounted consumers, including drag overlays. */
export function useStartTileColors(uid: string) {
  const store = useMemo(() => storeForUid(uid), [uid]);
  const subscribe = useMemo(() => (listener: () => void) => {
    const stop = store.subscribe(listener);
    const storageChanged = (event: StorageEvent) => {
      const storage = browserStorage();
      if (storage && event.storageArea === storage) store.applyStorageEvent(event.key, event.newValue);
    };
    window.addEventListener('storage', storageChanged);
    store.refreshFromStorage();
    return () => { stop(); window.removeEventListener('storage', storageChanged); };
  }, [store]);
  // A UID change selects its store during render; old preferences are never shown for a frame.
  const snapshot = useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, setColor: store.setColor, resetColors: store.resetColors };
}
