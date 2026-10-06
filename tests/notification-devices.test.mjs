import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDeviceBody, registerNotificationDevice, unregisterNotificationDevice, notificationDeviceStatus } from '../server/notification-devices.mjs';
import { createNotificationHandler } from '../server/notification-http.mjs';

function services(uid = 'sebastian-uid') {
  const values = new Map();
  const reference = path => ({ id: path.split('/').at(-1), path, async get() { return snapshot(this); } });
  const snapshot = ref => ({ exists: values.has(ref.path), id: ref.id, ref, data: () => values.get(ref.path) });
  const db = { collection(name) { return { doc(id) { return reference(`${name}/${id}`); } }; }, async runTransaction(callback) { const writes = []; const result = await callback({ async get(ref) { return snapshot(ref); }, async getAll(...refs) { return refs.map(snapshot); }, set(ref, value) { writes.push(() => values.set(ref.path, value)); }, delete(ref) { writes.push(() => values.delete(ref.path)); } }); writes.forEach(write => write()); return result; } };
  return { uid, db, values };
}
const deviceId = 'device_1234567890abcdef';
const token = 'tokenABC_0123456789_0123456789';
const hash = value => createHash('sha256').update(value).digest('hex');
test('token registration belongs to verified context UID and never accepts requested UID', () => {
  assert.throws(() => validateDeviceBody({ deviceId, token, uid: 'victim' }, true), /Nieprawidłowe/);
  for (const value of ['', '../victim', 'short']) assert.throws(() => validateDeviceBody({ deviceId: value, token }, true));
  assert.throws(() => validateDeviceBody({ deviceId, token: 'x' }, true));
});
test('device token is server-private and status response never returns the token', async () => {
  const context = services(); await registerNotificationDevice(context, { deviceId, token });
  assert.equal(context.values.get(`_notificationDevices/${deviceId}`).uid, context.uid);
  assert.equal(context.values.get(`_notificationTokenOwners/${hash(token)}`).uid, context.uid);
  const status = await notificationDeviceStatus(context, { deviceId }); assert.deepEqual(status, { active: true }); assert.ok(!JSON.stringify(status).includes(token));
});
test('Sebastian logout then Dominika login unregisters old owner and assigns exactly one UID', async () => {
  const context = services(); await registerNotificationDevice(context, { deviceId, token });
  await unregisterNotificationDevice(context, { deviceId }); assert.equal(context.values.size, 0);
  await registerNotificationDevice({ ...context, uid: 'dominika-uid' }, { deviceId, token });
  assert.equal(context.values.get(`_notificationDevices/${deviceId}`).uid, 'dominika-uid'); assert.equal(context.values.get(`_notificationTokenOwners/${hash(token)}`).uid, 'dominika-uid');
  assert.deepEqual(await notificationDeviceStatus(context, { deviceId }), { active: false });
});
test('new account registration atomically reassigns device without keeping previous UID', async () => {
  const context = services(); await registerNotificationDevice(context, { deviceId, token });
  await registerNotificationDevice({ ...context, uid: 'dominika-uid' }, { deviceId, token });
  assert.equal(context.values.size, 2); assert.equal(context.values.get(`_notificationDevices/${deviceId}`).uid, 'dominika-uid');
});
test('old account cannot unregister a device after another UID takes ownership', async () => {
  const context = services(); await registerNotificationDevice({ ...context, uid: 'dominika-uid' }, { deviceId, token });
  await unregisterNotificationDevice(context, { deviceId }); assert.equal(context.values.size, 2); assert.equal(context.values.get(`_notificationDevices/${deviceId}`).uid, 'dominika-uid');
});
test('same token cannot be registered on two devices and token rotation removes stale owner', async () => {
  const context = services(); await registerNotificationDevice(context, { deviceId, token });
  const nextDevice = deviceId + 'next'; await registerNotificationDevice(context, { deviceId: nextDevice, token });
  assert.equal(context.values.has(`_notificationDevices/${deviceId}`), false);
  const nextToken = token + 'rotated'; await registerNotificationDevice(context, { deviceId: nextDevice, token: nextToken });
  assert.equal(context.values.has(`_notificationTokenOwners/${hash(token)}`), false); assert.equal(context.values.size, 2);
});
test('late registration from the previous UID cannot overwrite a newer versioned login', async () => {
  const context = services();
  await registerNotificationDevice(context, { deviceId, token, bindingVersion: 100 });
  await registerNotificationDevice({ ...context, uid: 'dominika-uid' }, { deviceId, token, bindingVersion: 300 });
  const stale = await registerNotificationDevice(context, { deviceId, token, bindingVersion: 100 });
  assert.equal(stale.active, false);
  assert.equal(context.values.get(`_notificationDevices/${deviceId}`).uid, 'dominika-uid');
  assert.equal(context.values.get(`_notificationTokenOwners/${hash(token)}`).uid, 'dominika-uid');
});
test('logout keeps a token-free tombstone that rejects an in-flight register from that login', async () => {
  const context = services();
  await registerNotificationDevice(context, { deviceId, token, bindingVersion: 100 });
  await unregisterNotificationDevice(context, { deviceId, bindingVersion: 200 });
  assert.equal(context.values.has(`_notificationTokenOwners/${hash(token)}`), false);
  const tombstone = context.values.get(`_notificationDevices/${deviceId}`);
  assert.equal(tombstone.enabled, false); assert.equal(tombstone.bindingVersion, 200); assert.equal(tombstone.token, undefined);
  assert.equal((await registerNotificationDevice(context, { deviceId, token, bindingVersion: 100 })).active, false);
  await unregisterNotificationDevice(context, { deviceId, bindingVersion: 201 });
  assert.equal((await notificationDeviceStatus(context, { deviceId })).active, false);
  assert.equal((await registerNotificationDevice({ ...context, uid: 'dominika-uid' }, { deviceId, token, bindingVersion: 300 })).active, true);
});
test('unregister before a late first registration records a versioned tombstone', async () => {
  const context = services();
  await unregisterNotificationDevice(context, { deviceId, bindingVersion: 200 });
  assert.equal((await registerNotificationDevice(context, { deviceId, token, bindingVersion: 100 })).active, false);
});
test('late registration on an old device ID cannot reclaim a newer token owner', async () => {
  const context = services();
  await registerNotificationDevice(context, { deviceId, token, bindingVersion: 100 });
  const newDevice = deviceId + 'new';
  await registerNotificationDevice({ ...context, uid: 'dominika-uid' }, { deviceId: newDevice, token, bindingVersion: 300 });
  assert.equal(context.values.has(`_notificationDevices/${deviceId}`), false);
  assert.equal((await registerNotificationDevice(context, { deviceId, token, bindingVersion: 100 })).active, false);
  assert.equal(context.values.get(`_notificationTokenOwners/${hash(token)}`).uid, 'dominika-uid');
});
test('notifications handler authenticates before parsing or mutating and disables response caching', async () => {
  let actionCalled = false; const headers = {}; let body;
  const response = { setHeader(name, value) { headers[name] = value; }, end(value) { body = JSON.parse(value); }, statusCode: 0 };
  const handler = createNotificationHandler(async () => { actionCalled = true; }, async () => { throw new Error('Unverified token'); });
  await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { deviceId, token } }, response);
  assert.equal(response.statusCode, 500); assert.equal(actionCalled, false); assert.equal(body.ok, false); assert.equal(headers['Cache-Control'], 'no-store, private');
  assert.ok(!JSON.stringify(body).includes('Unverified'));
});
test('notifications handler rejects GET and clears retained parsed token body', async () => {
  const context = services(); let body;
  const response = { setHeader() {}, end(value) { body = JSON.parse(value); }, statusCode: 0 };
  const handler = createNotificationHandler(registerNotificationDevice, async () => context);
  const request = { method: 'GET', headers: {}, body: { token } };
  await handler(request, response); assert.equal(response.statusCode, 405); assert.equal(body.ok, false); assert.equal(request.body, undefined);
});
