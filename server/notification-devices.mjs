import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export function validateDeviceBody(body, registering = false) {
  if (!body || Object.keys(body).some(key => !['deviceId', 'token', 'platform', 'bindingVersion'].includes(key)) || typeof body.deviceId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.deviceId)) throw new EduServerError('NOTIFICATION_INVALID_REQUEST', 400, 'Nieprawidłowe urządzenie.');
  if (body.bindingVersion !== undefined && (!Number.isSafeInteger(body.bindingVersion) || body.bindingVersion < 1)) throw new EduServerError('NOTIFICATION_INVALID_REQUEST', 400, 'Nieprawidłowy stan urządzenia.');
  if (registering && (typeof body.token !== 'string' || body.token.length < 20 || body.token.length > 4096 || !/^[A-Za-z0-9_:.-]+$/.test(body.token))) throw new EduServerError('NOTIFICATION_INVALID_REQUEST', 400, 'Nieprawidłowy token powiadomień.');
}
export async function registerNotificationDevice(context, body) {
  validateDeviceBody(body, true);
  const deviceRef = context.db.collection('_notificationDevices').doc(body.deviceId);
  const tokenRef = context.db.collection('_notificationTokenOwners').doc(digest(body.token));
  const active = await context.db.runTransaction(async transaction => {
    const [device, token] = await transaction.getAll(deviceRef, tokenRef);
    // A late request from the previous login must not overwrite the current owner.
    // Legacy clients without a version work until a versioned binding is established.
    const bindingVersion = body.bindingVersion || 0;
    const currentVersion = device.data()?.bindingVersion || 0;
    if (bindingVersion < currentVersion || bindingVersion > 0 && bindingVersion === currentVersion && device.exists && (device.data().uid !== context.uid || device.data().enabled !== true)) return false;
    const tokenVersion = token.data()?.bindingVersion || 0;
    if (bindingVersion < tokenVersion || bindingVersion > 0 && bindingVersion === tokenVersion && token.exists && (token.data().uid !== context.uid || token.data().deviceId !== body.deviceId)) return false;
    const previousToken = device.exists ? device.data().tokenHash : null;
    const previousDevice = token.exists ? token.data().deviceId : null;
    const otherDeviceRef = previousDevice && previousDevice !== body.deviceId ? context.db.collection('_notificationDevices').doc(previousDevice) : null;
    const otherDevice = otherDeviceRef ? await transaction.get(otherDeviceRef) : null;
    if (previousToken && previousToken !== tokenRef.id) transaction.delete(context.db.collection('_notificationTokenOwners').doc(previousToken));
    if (otherDevice?.exists && otherDevice.data().tokenHash === tokenRef.id) transaction.delete(otherDeviceRef);
    transaction.set(deviceRef, { uid: context.uid, token: body.token, tokenHash: tokenRef.id, bindingVersion, enabled: true, platform: typeof body.platform === 'string' ? body.platform.slice(0, 80) : 'web', updatedAt: FieldValue.serverTimestamp() });
    transaction.set(tokenRef, { uid: context.uid, deviceId: body.deviceId, bindingVersion, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  return { active, deviceId: body.deviceId };
}
export async function unregisterNotificationDevice(context, body) {
  validateDeviceBody(body);
  const ref = context.db.collection('_notificationDevices').doc(body.deviceId);
  await context.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const bindingVersion = body.bindingVersion || 0;
    if (!snapshot.exists) {
      if (bindingVersion) transaction.set(ref, { uid: context.uid, enabled: false, bindingVersion, updatedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (snapshot.data().uid !== context.uid || bindingVersion < (snapshot.data().bindingVersion || 0)) return;
    const tokenRef = typeof snapshot.data().tokenHash === 'string' ? context.db.collection('_notificationTokenOwners').doc(snapshot.data().tokenHash) : null;
    const tokenOwner = tokenRef ? await transaction.get(tokenRef) : null;
    if (tokenOwner?.exists && tokenOwner.data().uid === context.uid && tokenOwner.data().deviceId === body.deviceId) transaction.delete(tokenRef);
    // Preserve only a token-free tombstone for versioned clients. Otherwise an
    // already in-flight register could recreate the previous login after logout.
    if (bindingVersion) transaction.set(ref, { uid: context.uid, enabled: false, bindingVersion, updatedAt: FieldValue.serverTimestamp() });
    else transaction.delete(ref);
  });
  return { active: false };
}
export async function notificationDeviceStatus(context, body) {
  validateDeviceBody(body);
  const device = await context.db.collection('_notificationDevices').doc(body.deviceId).get();
  return { active: device.exists && device.data().uid === context.uid && device.data().enabled === true };
}
