import type { User } from 'firebase/auth';
import { getAuth } from 'firebase/auth';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { getApp } from 'firebase/app';
import { usingEmulators } from '../firebase';
import type { NotificationPreferences } from './model';

const DEVICE_KEY = 'nr-notification-device';
export function notificationDeviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && /^[A-Za-z0-9_-]{16,100}$/.test(saved)) return saved;
    const id = crypto.randomUUID().replace(/-/g, ''); localStorage.setItem(DEVICE_KEY, id); return id;
  } catch { return sessionDeviceId ||= crypto.randomUUID().replace(/-/g, ''); }
}
let sessionDeviceId = '';
const VERSION_KEY = 'nr-notification-binding-version';
let lastVersion = 0;
function nextVersion(): number {
  let stored = 0;
  try { const value = Number(localStorage.getItem(VERSION_KEY)); stored = Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER - 1000 ? value : 0; } catch { /* Private mode. */ }
  lastVersion = Math.max(Date.now() * 1000, lastVersion + 1, stored + 1);
  try { localStorage.setItem(VERSION_KEY, String(lastVersion)); } catch { /* Session fallback. */ }
  return lastVersion;
}
let bindingUid: string | null = null;
let bindingVersion = 0;
let workerCommandVersion = 0;
let workerNeedsRefresh = false;
const requests = new Set<AbortController>();
function changeBinding(uid: string | null): void {
  if (uid === null || uid !== bindingUid) {
    bindingUid = uid; bindingVersion = nextVersion();
    // Server versions also protect requests that reached Firestore before abort.
    requests.forEach(controller => controller.abort()); requests.clear();
  }
}
function currentSession(user: User, version: number): boolean {
  return bindingUid === user.uid && bindingVersion === version && getAuth(getApp()).currentUser?.uid === user.uid;
}
function staleSession(): Error { return new Error('Konto na tym urządzeniu zmieniło się. Włącz powiadomienia ponownie.'); }
async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Nie udało się potwierdzić stanu powiadomień. Spróbuj ponownie.')), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function deviceRequest(user: User, action: 'register' | 'unregister' | 'status', data: Record<string, string | number>, version = bindingVersion): Promise<{ active: boolean }> {
  const controller = new AbortController(); requests.add(controller);
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const idToken = await bounded(user.getIdToken(), 4500);
    if (action === 'register' && !currentSession(user, version)) throw staleSession();
    const response = await fetch(`/api/notifications/${action}`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ deviceId: notificationDeviceId(), bindingVersion: version, ...data }), cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error(result.error?.message || 'Nie udało się zapisać powiadomień na urządzeniu.');
    return result;
  } finally { clearTimeout(timer); requests.delete(controller); }
}
export async function pushSupport(): Promise<{ supported: boolean; reason: string }> {
  if (usingEmulators) return { supported: false, reason: 'Testy lokalne: dostarczanie FCM jest wyłączone.' };
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return { supported: false, reason: 'Ta przeglądarka nie obsługuje powiadomień Web Push.' };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (ios && !standalone) return { supported: false, reason: 'Na iPhonie dodaj aplikację do ekranu początkowego i otwórz ją stamtąd (iOS 16.4 lub nowszy).' };
  if (!import.meta.env.VITE_FIREBASE_VAPID_KEY) return { supported: false, reason: 'Administrator musi skonfigurować klucz Web Push.' };
  try { if (!await isSupported()) return { supported: false, reason: 'Powiadomienia Web Push są niedostępne w tej przeglądarce.' }; }
  catch { return { supported: false, reason: 'Powiadomienia Web Push są niedostępne w tej przeglądarce.' }; }
  return { supported: true, reason: '' };
}
export async function bindNotificationWorker(uid: string | null, prefs?: NotificationPreferences): Promise<void> {
  // A preference save can finish after the old Provider has unmounted. Never
  // assign that callback a fresh epoch belonging to the next logged-in user.
  if (uid !== null && getAuth(getApp()).currentUser?.uid !== uid) throw staleSession();
  changeBinding(uid);
  const commandVersion = nextVersion(); workerCommandVersion = commandVersion;
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (workerCommandVersion !== commandVersion) return;
  const worker = registration?.active || navigator.serviceWorker.controller;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error?: Error) => { window.clearTimeout(timer); channel.port1.close(); error ? reject(error) : resolve(); };
    const timer = window.setTimeout(() => finish(new Error('Nie udało się potwierdzić ustawień powiadomień na urządzeniu.')), 1500);
    channel.port1.onmessage = event => finish(event.data?.ok === true ? undefined : new Error('Nie udało się zapisać ustawień powiadomień na urządzeniu.'));
    try { worker.postMessage({ type: 'NR_NOTIFICATION_BIND', uid, bindingVersion, version: commandVersion, enabled: !!prefs?.enabled, sound: prefs?.sound !== false, categories: prefs?.categories || {} }, [channel.port2]); }
    catch { finish(new Error('Nie udało się połączyć z powiadomieniami urządzenia.')); }
  });
  if (!uid) { const notifications = await registration?.getNotifications(); notifications?.forEach(notification => notification.close()); }
}
export async function enableDevicePush(user: User, prefs: NotificationPreferences): Promise<boolean> {
  if (workerNeedsRefresh) throw new Error('Odśwież aplikację, aby ponownie przygotować bezpieczne powiadomienia.');
  const support = await pushSupport();
  if (!support.supported) return false;
  if (getAuth(getApp()).currentUser?.uid !== user.uid) throw staleSession();
  await bounded(navigator.serviceWorker.ready, 5000);
  await bindNotificationWorker(user.uid, prefs);
  const version = bindingVersion;
  if (!currentSession(user, version)) throw staleSession();
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration?.active) throw new Error('Odśwież aplikację, aby przygotować powiadomienia.');
  // Same service worker as the application's existing PWA shell.
  const token = await bounded(getToken(getMessaging(getApp()), { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration }), 10000);
  if (!currentSession(user, version)) throw staleSession();
  if (!token) throw new Error('Nie udało się utworzyć subskrypcji powiadomień.');
  const result = await deviceRequest(user, 'register', { token, platform: navigator.userAgent.slice(0, 80) }, version);
  if (!currentSession(user, version)) throw staleSession();
  return result.active;
}
export async function disableDevicePush(user: User): Promise<void> {
  // A delayed action from an unmounted account must not clear the new account's
  // worker binding on this browser.
  if (getAuth(getApp()).currentUser?.uid !== user.uid) return;
  // Clear the UID latch first, even if server/network is unavailable.
  let workerError: unknown;
  const clearing = bindNotificationWorker(null).catch(error => { workerError = error; });
  const version = bindingVersion;
  if (usingEmulators) { await clearing; if (workerError) throw workerError; return; }
  let serverError: unknown;
  await Promise.all([
    clearing,
    deviceRequest(user, 'unregister', {}, version).catch(error => { serverError = error; }),
  ]);
  if (workerError && bindingUid === null && bindingVersion === version && getAuth(getApp()).currentUser?.uid === user.uid) {
    // IDB and its independent durable guard might both be unavailable. Stop
    // this registration instead of silently leaving the old background binding.
    workerNeedsRefresh = true;
    await bounded(navigator.serviceWorker.getRegistration('/').then(registration => bindingUid === null && bindingVersion === version && getAuth(getApp()).currentUser?.uid === user.uid ? registration?.unregister() : undefined), 1500).catch(() => {});
  }
  // FCM's deleteToken cannot be aborted: a delayed SDK unsubscribe could remove
  // the next account's subscription. We detach the verified server owner and
  // worker UID instead. The browser transport is safely reusable at next login.
  if (workerError || serverError) throw workerError || serverError;
}
export async function devicePushStatus(user: User): Promise<boolean> {
  if (usingEmulators) return false;
  return (await deviceRequest(user, 'status', {})).active;
}
/** Call and await immediately before Firebase signOut. Network waits are bounded. */
export async function prepareNotificationLogout(user: User): Promise<void> {
  await bounded(disableDevicePush(user), 6000).catch(() => {});
}
