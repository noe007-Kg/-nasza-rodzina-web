import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { NOTIFICATION_WORKER_SOURCE } from '../server/notification-worker.mjs';
function worker(binding, windows = [], delivered = new Set(), guards = new Map()) {
  const listeners = new Map(); const displayed = []; const messages = []; const navigations = [];
  const clients = windows.map(value => ({ url: 'https://family.test/', visibilityState: value, postMessage(message) { messages.push(message); }, async navigate(url) { navigations.push(url); }, async focus() {} }));
  const context = vm.createContext({ URL, Response, indexedDB: {}, binding, delivered, caches: { async open() { return { async put(key, value) { guards.set(key, value); }, async delete(key) { return guards.delete(typeof key === 'string' ? key : key.url); }, async keys() { return [...guards.keys()].map(url => ({ url })); } }; } }, self: { location: new URL('https://family.test/sw.js'), addEventListener(type, callback) { listeners.set(type, callback); }, registration: { async showNotification(title, options) { displayed.push({ title, options }); } }, clients: { async matchAll() { return clients; }, async openWindow(url) { navigations.push(url); } } } });
  vm.runInContext(NOTIFICATION_WORKER_SOURCE, context);
  vm.runInContext(`nrSession = async (mode, value) => { if (mode === 'readwrite') binding = value; return binding; };
    nrClaimEvent = async (uid, id) => { const key = JSON.stringify([uid, id]); if (delivered.has(key)) return false; delivered.add(key); return true; };
    nrReleaseEvent = async (uid, id) => { delivered.delete(JSON.stringify([uid, id])); };`, context);
  const push = async payload => { let pending; listeners.get('push')({ data: { json() { return { data: payload }; } }, waitUntil(promise) { pending = promise; } }); await pending; };
  const click = async data => { let pending; listeners.get('notificationclick')({ notification: { data, close() {} }, waitUntil(promise) { pending = promise; } }); await pending; };
  const bind = async message => { let pending; const acknowledgements = []; listeners.get('message')({ data: { type: 'NR_NOTIFICATION_BIND', ...message }, source: { url: 'https://family.test/' }, ports: [{ postMessage(value) { acknowledgements.push(value); } }], waitUntil(promise) { pending = promise; } }); await pending; return acknowledgements; };
  return { push, click, bind, displayed, messages, navigations, context };
}
const binding = { uid: 'sebastian', enabled: true, sound: true, categories: { school: true } };
const payload = { recipientUid: 'sebastian', eventId: 'school:grade:1:1', category: 'school', module: 'Szkoła', sound: '1', title: 'SECRET GRADE', body: 'SECRET TEXT' };
test('background push is sanitized and uses the system bell when sound is on', async () => {
  const instance = worker(binding); await instance.push(payload);
  assert.equal(instance.displayed.length, 1); assert.equal(instance.displayed[0].title, 'Nasza Rodzina');
  assert.equal(instance.displayed[0].options.silent, false); assert.equal(instance.displayed[0].options.renotify, false);
  assert.ok(!JSON.stringify(instance.displayed).includes('SECRET'));
});
test('sound OFF produces silent system notification without blocking delivery', async () => {
  const instance = worker({ ...binding, sound: false }); await instance.push(payload);
  assert.equal(instance.displayed.length, 1); assert.equal(instance.displayed[0].options.silent, true);
});
test('foreground notification is forwarded to the open app and does not duplicate system alert', async () => {
  const instance = worker(binding, ['visible']); await instance.push(payload);
  assert.equal(instance.displayed.length, 0); assert.equal(instance.messages.length, 1); assert.equal(instance.messages[0].type, 'NR_PUSH_EVENT');
});
test('UID guard rejects old user messages after Sebastian logout and Dominika login', async () => {
  const instance = worker(binding); await instance.push(payload); assert.equal(instance.displayed.length, 1);
  instance.context.binding = { ...binding, uid: null, enabled: false }; await instance.push(payload); assert.equal(instance.displayed.length, 1);
  instance.context.binding = { ...binding, uid: 'dominika' }; await instance.push(payload); assert.equal(instance.displayed.length, 1);
  await instance.push({ ...payload, recipientUid: 'dominika' }); assert.equal(instance.displayed.length, 2);
});
test('category, important and master switches prevent background alerts', async () => {
  for (const value of [{ ...binding, enabled: false }, { ...binding, categories: { school: false } }, { ...binding, categories: { school: true, important: false } }]) {
    const instance = worker(value); await instance.push({ ...payload, important: '1' }); assert.equal(instance.displayed.length, 0);
  }
});
test('click opens correct module only for currently bound UID', async () => {
  const instance = worker(binding, ['hidden']); await instance.click({ recipientUid: 'sebastian', module: 'Szkoła' });
  assert.equal(instance.navigations[0], 'https://family.test/#Szko%C5%82a');
  await instance.click({ recipientUid: 'dominika', module: 'Zdrowie' }); assert.equal(instance.navigations.length, 1);
});
test('worker extends the existing application worker and ships no Firebase/session secrets', () => {
  assert.ok(!NOTIFICATION_WORKER_SOURCE.includes('importScripts'));
  assert.ok(!NOTIFICATION_WORKER_SOURCE.includes('firebase-messaging-sw.js'));
  assert.ok(!NOTIFICATION_WORKER_SOURCE.includes('EDUVULCAN'));
  assert.ok(!NOTIFICATION_WORKER_SOURCE.includes('token:'));
});
test('duplicate push is deduplicated by UID/event and stays suppressed after worker restart', async () => {
  const delivered = new Set();
  const first = worker(binding, [], delivered);
  await Promise.all([first.push(payload), first.push(payload)]);
  assert.equal(first.displayed.length, 1);
  const restarted = worker(binding, [], delivered); await restarted.push(payload);
  assert.equal(restarted.displayed.length, 0);
  await restarted.push({ ...payload, eventId: 'school:grade:1:2' }); assert.equal(restarted.displayed.length, 1);
});
test('failed system delivery releases the identity so a later retry can deliver', async () => {
  const instance = worker(binding);
  const show = instance.context.self.registration.showNotification;
  instance.context.self.registration.showNotification = async () => { throw new Error('OS unavailable'); };
  await assert.rejects(instance.push(payload), /OS unavailable/);
  instance.context.self.registration.showNotification = show;
  await instance.push(payload); assert.equal(instance.displayed.length, 1);
});
test('worker binding ACK reports a failed durable write and closes the UID latch immediately', async () => {
  const instance = worker(binding);
  vm.runInContext('nrSession = async () => { throw new Error("IDB denied"); };', instance.context);
  const ack = await instance.bind({ uid: null, enabled: false, version: 100 });
  assert.equal(ack[0].ok, false);
  await instance.push(payload); assert.equal(instance.displayed.length, 0);
});
test('late worker binding cannot replace the newer logged-in UID', async () => {
  const instance = worker(binding);
  assert.equal((await instance.bind({ uid: 'dominika', enabled: true, version: 200 }))[0].ok, true);
  assert.equal((await instance.bind({ uid: 'sebastian', enabled: true, version: 100 }))[0].ok, false);
  await instance.push(payload); assert.equal(instance.displayed.length, 0);
  await instance.push({ ...payload, recipientUid: 'dominika' }); assert.equal(instance.displayed.length, 1);
});
test('old tab cannot restore its UID with a newer preferences command after another account logged in', async () => {
  const instance = worker(binding);
  assert.equal((await instance.bind({ uid: 'dominika', enabled: true, bindingVersion: 200, version: 200 }))[0].ok, true);
  assert.equal((await instance.bind({ uid: 'sebastian', enabled: true, bindingVersion: 100, version: 500 }))[0].ok, false);
  await instance.push(payload); assert.equal(instance.displayed.length, 0);
  await instance.push({ ...payload, recipientUid: 'dominika' }); assert.equal(instance.displayed.length, 1);
});
test('failed durable null write remains blocked after worker restart through the independent version-only guard', async () => {
  const guards = new Map();
  const original = { ...binding, bindingVersion: 100, version: 100 };
  const first = worker(original, [], new Set(), guards);
  vm.runInContext('nrSession = async () => { throw new Error("IDB temporarily denied"); };', first.context);
  assert.equal((await first.bind({ uid: null, enabled: false, bindingVersion: 200, version: 200 }))[0].ok, false);
  assert.equal(guards.size, 1);
  assert.ok(![...guards.keys()][0].includes('sebastian'));
  const restarted = worker(original, [], new Set(), guards);
  await restarted.push(payload); assert.equal(restarted.displayed.length, 0);
  assert.equal((await restarted.bind({ uid: 'dominika', enabled: true, bindingVersion: 300, version: 300 }))[0].ok, true);
  await restarted.push({ ...payload, recipientUid: 'dominika' }); assert.equal(restarted.displayed.length, 1);
  assert.equal(guards.size, 0);
});
