import type { User } from 'firebase/auth';

// Compatibility cleanup for people upgrading an older PWA installation. There
// is deliberately no firebase/messaging import, permission query or token API.
let clearing: Promise<void> | null = null;
let lastVersion = 0;
const VERSION_KEY = 'nr-notification-binding-version';
function nextVersion(): number {
  let previous = 0;
  try { const value = Number(localStorage.getItem(VERSION_KEY)); if (Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER - 1000) previous = value; } catch { /* Private browser mode. */ }
  lastVersion = Math.max(Date.now() * 1000, previous + 1, lastVersion + 1);
  try { localStorage.setItem(VERSION_KEY, String(lastVersion)); } catch { /* Optional compatibility storage. */ }
  return lastVersion;
}
async function bounded<T>(operation: Promise<T>, milliseconds = 1000): Promise<T | undefined> {
  let timer: number | undefined;
  try { return await Promise.race([operation, new Promise<undefined>(resolve => { timer = window.setTimeout(() => resolve(undefined), milliseconds); })]); }
  catch { return undefined; }
  finally { if (timer) window.clearTimeout(timer); }
}
async function clearOldPush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await bounded(navigator.serviceWorker.getRegistration('/'));
  if (!registration) return;
  const existing = await bounded(registration.pushManager?.getSubscription() || Promise.resolve(null));
  // A current IN-APP installation has no push transport: do no binding work.
  if (existing === null) {
    await bounded(registration.getNotifications().then(values => values.forEach(value => value.close())));
    return;
  }
  const version = nextVersion();
  // The old worker reads this independent fail-closed guard before delivery.
  // It stores only two version numbers, never a UID or notification content.
  let guarded = false;
  if (typeof caches !== 'undefined') {
    guarded = await bounded(caches.open('nr-notification-guard-v1').then(async cache => {
      await cache.put(new URL(`/__nr_notification_guard__/${version}_${version}`, location.origin).href, new Response('1'));
      return true;
    })) === true;
  }
  const worker = registration.active || navigator.serviceWorker.controller;
  const cleared = !worker || await bounded(new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 700);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.ok === true); };
    try { worker.postMessage({ type: 'NR_NOTIFICATION_BIND', uid: null, enabled: false, sound: false, categories: {}, bindingVersion: version, version }, [channel.port2]); }
    catch { clearTimeout(timer); channel.port1.close(); resolve(false); }
  }));
  // Only remove an existing transport. getSubscription never creates one and
  // does not prompt for a system permission. No FCM endpoints are called.
  const unsubscribed = existing ? await bounded(existing.unsubscribe()) : false;
  await bounded(registration.getNotifications().then(values => values.forEach(value => value.close())));
  // If every durable protection failed, retire the old worker rather than
  // permit its previous account to receive background notifications.
  if (!guarded && !cleared && !unsubscribed) await bounded(registration.unregister());
}
export function disableLegacySystemNotifications(): Promise<void> {
  if (!clearing) clearing = clearOldPush().catch(() => {}).finally(() => { clearing = null; });
  return clearing;
}
/** Await cleanup before signOut. IN-APP state itself is discarded with UID. */
export async function prepareNotificationLogout(_user: User): Promise<void> {
  await bounded(disableLegacySystemNotifications(), 3500);
}
