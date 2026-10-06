/** Appended to the existing public-shell worker. No tokens or credentials are cached. */
export const NOTIFICATION_WORKER_SOURCE = `
const NR_SESSION_DB = 'nr-notification-session';
let nrVolatileBinding;
let nrBindingVersion = 0;
let nrBindingEpoch = 0;
const NR_GUARD_CACHE = 'nr-notification-guard-v1';
const NR_GUARD_PREFIX = new URL('/__nr_notification_guard__/', self.location.origin).href;
function nrIsNewer(binding, previous) {
  return (binding?.bindingVersion || 0) > (previous?.bindingVersion || 0)
    || (binding?.bindingVersion || 0) === (previous?.bindingVersion || 0) && (binding?.version || 0) >= (previous?.version || 0);
}
const nrGuardKey = binding => NR_GUARD_PREFIX + (binding.bindingVersion || 0) + '_' + (binding.version || 0);
async function nrSetGuard(binding) {
  // This independent durable latch contains only version numbers and a flag.
  // If IDB rejects a logout write, a restarted worker must still reject old UID.
  const cache = await caches.open(NR_GUARD_CACHE);
  await cache.put(nrGuardKey(binding), new Response('1'));
}
async function nrClearGuard(binding) {
  const cache = await caches.open(NR_GUARD_CACHE);
  await cache.delete(nrGuardKey(binding));
  const entries = await cache.keys();
  await Promise.all(entries.map(entry => {
    const match = entry.url.startsWith(NR_GUARD_PREFIX) && /^(\\d+)_(\\d+)$/.exec(entry.url.slice(NR_GUARD_PREFIX.length));
    return match && nrIsNewer(binding, { bindingVersion: Number(match[1]), version: Number(match[2]) }) ? cache.delete(entry) : undefined;
  }));
}
async function nrGuarded(binding) {
  const cache = await caches.open(NR_GUARD_CACHE);
  const entries = await cache.keys();
  return entries.some(entry => {
    const match = entry.url.startsWith(NR_GUARD_PREFIX) && /^(\\d+)_(\\d+)$/.exec(entry.url.slice(NR_GUARD_PREFIX.length));
    return match && nrIsNewer({ bindingVersion: Number(match[1]), version: Number(match[2]) }, binding);
  });
}
function nrDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NR_SESSION_DB, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('session')) database.createObjectStore('session');
      if (!database.objectStoreNames.contains('delivered')) {
        const delivered = database.createObjectStore('delivered', { keyPath: 'key' });
        delivered.createIndex('createdAt', 'createdAt');
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function nrSession(mode, value) {
  const database = await nrDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('session', mode);
    const store = transaction.objectStore('session');
    let result;
    const read = store.get('active');
    read.onsuccess = () => {
      result = read.result;
      if (mode === 'readwrite' && nrIsNewer(value, result)) {
        store.put(value, 'active'); result = value;
      }
    };
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}
async function nrReadBinding() {
  const saved = await nrSession('readonly');
  // Binding changes disable delivery immediately, before the IDB write completes.
  const binding = nrVolatileBinding !== undefined && nrIsNewer(nrVolatileBinding, saved) ? nrVolatileBinding : saved;
  if (await nrGuarded(binding).catch(() => true)) return null;
  return binding;
}
async function nrClaimEvent(uid, eventId) {
  const database = await nrDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('delivered', 'readwrite');
    const store = transaction.objectStore('delivered');
    let claimed = true;
    const request = store.add({ key: JSON.stringify([uid, eventId]), createdAt: Date.now() });
    request.onerror = event => {
      if (request.error?.name === 'ConstraintError') { claimed = false; event.preventDefault(); event.stopPropagation(); }
    };
    // Keep recent event identities across worker restarts and partial FCM retries.
    const expired = store.index('createdAt').openCursor(IDBKeyRange.upperBound(Date.now() - 7 * 86400000));
    expired.onsuccess = () => { const cursor = expired.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    transaction.oncomplete = () => { database.close(); resolve(claimed); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}
async function nrReleaseEvent(uid, eventId) {
  const database = await nrDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('delivered', 'readwrite');
    transaction.objectStore('delivered').delete(JSON.stringify([uid, eventId]));
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}
function nrCategoryAllowed(binding, payload) {
  return !!binding && binding.uid === payload.recipientUid && binding.enabled === true
    && binding.categories?.[payload.category] !== false
    && (payload.important !== '1' || binding.categories?.important !== false);
}
async function nrDeliver(payload) {
  if (!payload || typeof payload.recipientUid !== 'string' || typeof payload.eventId !== 'string' || payload.eventId.length > 4096) return;
  const binding = await nrReadBinding().catch(() => null);
  if (!nrCategoryAllowed(binding, payload)) return;
  if (!await nrClaimEvent(payload.recipientUid, payload.eventId).catch(() => false)) return;
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const latest = await nrReadBinding().catch(() => null);
    if (!nrCategoryAllowed(latest, payload)) { await nrReleaseEvent(payload.recipientUid, payload.eventId); return; }
    const open = clients.filter(client => client.visibilityState === 'visible');
    if (open.length) { open.forEach(client => client.postMessage({ type: 'NR_PUSH_EVENT', payload })); return; }
    const module = ['Kalendarz','Zadania','Zakupy','Czat','Zdrowie','Szkoła','Start'].includes(payload.module) ? payload.module : 'Start';
    await self.registration.showNotification('Nasza Rodzina', {
      body: 'Masz nowe powiadomienie. Otwórz aplikację.',
      icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      tag: typeof payload.tag === 'string' ? payload.tag : payload.eventId,
      renotify: false, silent: latest.sound === false || payload.sound === '0',
      data: { recipientUid: payload.recipientUid, module, eventId: payload.eventId },
    });
  } catch (error) {
    await nrReleaseEvent(payload.recipientUid, payload.eventId).catch(() => {});
    throw error;
  }
}
self.addEventListener('message', event => {
  const message = event.data;
  if (!event.source || !event.source.url || new URL(event.source.url).origin !== self.location.origin) return;
  if (message?.type === 'NR_NOTIFICATION_BIND') {
    const version = Number.isSafeInteger(message.version) ? message.version : 0;
    const bindingVersion = Number.isSafeInteger(message.bindingVersion) ? message.bindingVersion : version;
    if (bindingVersion < nrBindingEpoch || bindingVersion === nrBindingEpoch && version < nrBindingVersion) { event.ports?.[0]?.postMessage({ ok: false }); return; }
    nrBindingVersion = version; nrBindingEpoch = bindingVersion;
    const binding = { uid: typeof message.uid === 'string' ? message.uid : null, bindingVersion, version, enabled: message.enabled === true, sound: message.sound !== false, categories: message.categories || {} };
    nrVolatileBinding = binding;
    event.waitUntil((async () => {
      // Try both independent stores. A successful IDB write still establishes a
      // safe binding when CacheStorage is temporarily unavailable.
      await nrSetGuard(binding).catch(() => {});
      const saved = await nrSession('readwrite', binding);
      const ok = saved?.version === version && saved?.bindingVersion === bindingVersion && saved?.uid === binding.uid;
      if (ok) await nrClearGuard(binding);
      event.ports?.[0]?.postMessage({ ok });
    })()
      .catch(() => { event.ports?.[0]?.postMessage({ ok: false }); }));
  }
  if (message?.type === 'NR_LOCAL_NOTIFICATION') event.waitUntil(nrDeliver(message.payload));
});
self.addEventListener('push', event => {
  let payload;
  try { const value = event.data?.json(); payload = value?.data || value; } catch { return; }
  event.waitUntil(nrDeliver(payload));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil((async () => {
    const binding = await nrReadBinding().catch(() => null);
    if (!binding || binding.uid !== data?.recipientUid || !binding.enabled) return;
    const module = ['Kalendarz','Zadania','Zakupy','Czat','Zdrowie','Szkoła','Start'].includes(data.module) ? data.module : 'Start';
    const url = new URL('/#' + encodeURIComponent(module), self.location.origin).href;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); await existing.focus(); }
    else await self.clients.openWindow(url);
  })());
});
`;
