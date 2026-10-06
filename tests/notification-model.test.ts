import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreferences, notificationAllowed, sortNotifications, type FamilyNotification } from '../src/notifications/model';
import { playNotificationBell, unlockNotificationSound } from '../src/notifications/sound';
import { readFileSync } from 'node:fs';
import { IN_APP_NOTIFICATION_WORKER_SOURCE } from '../server/notification-inapp-worker.mjs';
import { disableLegacySystemNotifications } from '../src/notifications/legacy-push';

test('new user has IN-APP alerts enabled without a system permission; explicit OFF stays OFF', () => {
  const prefs = normalizePreferences(undefined);
  assert.equal(prefs.enabled, true); assert.equal(prefs.sound, true); assert.equal(prefs.categories.school, true);
  assert.equal(notificationAllowed(prefs, 'school'), true);
  assert.equal(normalizePreferences({ enabled: false }).enabled, false);
});
test('sound, category and important preferences are independent and normalized', () => {
  const prefs = normalizePreferences({ enabled: true, sound: false, categories: { school: false, important: false } });
  assert.equal(notificationAllowed(prefs, 'school'), false);
  assert.equal(notificationAllowed(prefs, 'familyChat'), true);
  assert.equal(notificationAllowed(prefs, 'familyChat', true), false);
  assert.equal(prefs.sound, false);
});
test('important and personally starred notifications sort first, then newest', () => {
  const item = (id: string, time: number, starred = false, important = false) => ({ id, eventId: id, title: id, body: '', category: 'school', module: 'Szkoła', createdAt: new Date(time), starred, important, read: false }) satisfies FamilyNotification;
  const input = [item('new', 500), item('starred-old', 100, true), item('important-new', 200, false, true)];
  assert.deepEqual(sortNotifications(input).map(row => row.id), ['important-new', 'starred-old', 'new']);
  assert.equal(input[0].id, 'new');
});
test('gentle notification sound requires gesture/unlocked audio and respects OFF and hidden app', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const oscillators: Array<{ start: number; stop: number }> = [];
  let visibilityState = 'visible';
  const fakeContext = { state: 'suspended', currentTime: 1, destination: {}, async resume() { this.state = 'running'; }, createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }, createOscillator() { const value = { start: 0, stop: 0 }; oscillators.push(value); return { type: '', frequency: { value: 0 }, connect() {}, start(time: number) { value.start = time; }, stop(time: number) { value.stop = time; } }; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: function () { return fakeContext; } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { get visibilityState() { return visibilityState; } } });
  try {
    assert.equal(playNotificationBell(true), false);
    await unlockNotificationSound();
    assert.equal(playNotificationBell(false), false); assert.equal(oscillators.length, 0);
    assert.equal(playNotificationBell(true), true); assert.equal(oscillators.length, 3);
    assert.ok(Math.max(...oscillators.map(value => value.stop)) - Math.min(...oscillators.map(value => value.start)) >= .5);
    assert.ok(Math.max(...oscillators.map(value => value.stop)) - Math.min(...oscillators.map(value => value.start)) <= 1.5);
    visibilityState = 'hidden'; assert.equal(playNotificationBell(true), false); assert.equal(oscillators.length, 3);
    fakeContext.state = 'suspended'; visibilityState = 'visible'; assert.equal(playNotificationBell(true), false);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument });
  }
});

test('IN-APP runtime does not import Messaging, query permission, require VAPID or depend on Functions', () => {
  const provider = readFileSync(new URL('../src/notifications/index.tsx', import.meta.url), 'utf8');
  const cleanup = readFileSync(new URL('../src/notifications/legacy-push.ts', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(provider, /from ['"]\.\/push['"]|Notification\.permission|requestPermission|requestPush|enableDevicePush|pushSupport|VAPID|showNotification/);
  assert.doesNotMatch(cleanup, /from ['"]firebase\/messaging|Notification\.permission|requestPermission|\bgetToken\s*\(/);
  assert.match(build, /notification-inapp-worker/);
  assert.doesNotMatch(IN_APP_NOTIFICATION_WORKER_SOURCE, /showNotification|addEventListener\(['"]push['"]|getToken|importScripts|firebase/);
  assert.match(IN_APP_NOTIFICATION_WORKER_SOURCE, /unsubscribe/);
});

test('upgrade cleanup retires only an existing legacy transport; current IN-APP session never binds push', async () => {
  const originals = new Map(['window', 'navigator', 'localStorage', 'caches', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const bindings: Array<{ uid: unknown; enabled: unknown }> = [];
  let transportExists = false, unsubscribed = 0, closed = 0;
  const subscription = { async unsubscribe() { unsubscribed++; return true; } };
  const worker = { postMessage(message: { uid: unknown; enabled: unknown }, ports: MessagePort[]) { bindings.push(message); ports[0].postMessage({ ok: true }); } };
  const registration = { active: worker, pushManager: { async getSubscription() { return transportExists ? subscription : null; } }, async getNotifications() { return [{ close() { closed++; } }]; }, async unregister() { throw new Error('Safe acknowledged cleanup should preserve the shell'); } };
  const set = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, value });
  set('window', { setTimeout, clearTimeout });
  set('navigator', { serviceWorker: { async getRegistration() { return registration; } } });
  set('localStorage', { getItem() { return null; }, setItem() {} });
  set('caches', undefined);
  set('location', { origin: 'https://family.example.test' });
  try {
    await disableLegacySystemNotifications();
    assert.equal(bindings.length, 0); assert.equal(unsubscribed, 0);
    transportExists = true;
    await disableLegacySystemNotifications();
    assert.equal(bindings.length, 1); assert.equal(bindings[0].uid, null); assert.equal(bindings[0].enabled, false);
    assert.equal(unsubscribed, 1); assert.equal(closed, 2);
  } finally {
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
  }
});
