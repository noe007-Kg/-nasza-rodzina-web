import { useMemo, useSyncExternalStore } from 'react';
import { createStartTileSizeStore } from './start-tile-sizes';

type SizeStore = ReturnType<typeof createStartTileSizeStore>;
const stores = new Map<string, SizeStore>();
function browserStorage() {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}
function storeForUid(uid: string) {
  const existing = stores.get(uid);
  if (existing) return existing;
  const store = createStartTileSizeStore(uid, browserStorage);
  stores.set(uid, store);
  return store;
}

export function useStartTileSizes(uid: string) {
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
  const snapshot = useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, setSize: store.setSize, resetSizes: store.resetSizes };
}
