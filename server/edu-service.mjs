import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';
import { resolveConnectionAccess } from './edu-access.mjs';
import { encryptionConfigured } from './edu-secrets.mjs';
import { acquireSyncLease, disconnectConnection, getConnectionStatus, loadConnection, markConnectionNeedsReconnect, releaseSyncLease, retireLegacyParentConnections, saveConnection, selectConnectionStudent, updateConnectionSession, upsertSchoolItems } from './edu-storage.mjs';
import { connectProvider, readProviderData } from './edu-provider.mjs';
import { expectFields } from './edu-http.mjs';
import { safelyFlushSchoolNotifications } from './school-notifications.mjs';

function requireConfigured() {
  if (!encryptionConfigured()) throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Administrator musi skonfigurować szyfrowanie integracji na serwerze.');
}

async function accessContext(context) {
  return context.connection ? context : resolveConnectionAccess(context);
}

async function loginLease({ uid, connection, db }) {
  // Both parents serialize login attempts against the same family connection.
  const ref = db.collection('_eduConnectLocks').doc(connection.id);
  const id = randomUUID(); const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref); const prior = snapshot.exists ? snapshot.data() : {};
    if (prior.expiresAt?.toMillis() > now) throw new EduServerError('EDU_CONNECT_BUSY', 409, 'Łączenie z dziennikiem już trwa.');
    const activeWindow = prior.windowStartedAt?.toMillis() > now - 15 * 60000;
    const attempts = activeWindow ? Number(prior.attempts || 0) : 0;
    if (attempts >= 5) throw new EduServerError('EDU_LOGIN_COOLDOWN', 429, 'Wykonano kilka prób logowania. Odczekaj 15 minut przed kolejną próbą.');
    transaction.set(ref, { id, actorUid: uid, expiresAt: Timestamp.fromMillis(now + 90000), attempts: attempts + 1,
      windowStartedAt: activeWindow ? prior.windowStartedAt : Timestamp.fromMillis(now), updatedAt: FieldValue.serverTimestamp() });
  });
  const release = async () => db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists && snapshot.data().id === id) transaction.update(ref, { expiresAt: Timestamp.fromMillis(0) });
  });
  release.leaseId = id;
  return release;
}

export async function statusAction(context) {
  context = await accessContext(context);
  requireConfigured();
  const status = { configured: true, scope: context.connection.scope, accountRole: context.connection.accountRole, ...await getConnectionStatus(context.connection.id, context) };
  // Foreground status checks also retry any already saved school notification
  // batch. This does not call the provider or change the successful sync time.
  const notifications = await safelyFlushSchoolNotifications(context);
  return { status, notifications };
}

export async function connectAction(context, body) {
  context = await accessContext(context);
  requireConfigured(); expectFields(body, ['login', 'password']);
  if (typeof body.login !== 'string' || !body.login.trim() || body.login.length > 320 || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw new EduServerError('EDU_INVALID_CREDENTIALS', 400, 'Podaj login i hasło do eduVULCAN.');
  const release = await loginLease(context);
  try {
    const connection = await connectProvider({ login: body.login.trim(), password: body.password });
    const status = await saveConnection(context.connection.id, { ...connection, selectedStudent: null, connectLeaseId: release.leaseId }, context);
    if (context.connection.scope === 'family') await retireLegacyParentConnections(context);
    return { status: { configured: true, ...status } };
  } finally { delete body.login; delete body.password; await release(); }
}

export async function selectAction(context, body) {
  context = await accessContext(context);
  requireConfigured(); expectFields(body, ['profileId', 'personKey']);
  const connection = await loadConnection(context.connection.id, context);
  if (!connection.profiles.some((profile) => profile.id === body.profileId)) throw new EduServerError('EDU_INVALID_STUDENT', 400, 'Wybierz profil z połączonego konta.');
  await selectConnectionStudent(context.connection.id, body, context);
  return statusAction(context);
}

export async function syncAction(context, body, { readData = readProviderData } = {}) {
  context = await accessContext(context);
  requireConfigured(); expectFields(body, []);
  const id = context.connection.id;
  const lease = await acquireSyncLease(id, context);
  let success = false; let errorCode; let sessionVersion;
  try {
    const connection = await loadConnection(id, context);
    sessionVersion = connection.sessionVersion;
    const { profileId, personKey } = connection.selectedStudent;
    const data = await readData(connection.session, profileId, { includeMessages: context.connection.scope === 'family' });
    await updateConnectionSession(id, data.session, { sessionVersion: connection.sessionVersion, leaseId: lease.leaseId }, context);
    const saved = await upsertSchoolItems(id, { profileId, personKey, items: data.items,
      sessionVersion: connection.sessionVersion, leaseId: lease.leaseId, reconcileScopes: data.reconcileScopes || [],
      notificationReadyTypes: data.notificationReadyTypes || [] }, context);
    success = true;
    await releaseSyncLease(id, lease.leaseId, { success, counts: data.counts, warnings: data.warnings }, context);
    const result = await statusAction(context);
    const warnings = [...(data.warnings || []), ...(result.notifications.warning ? [result.notifications.warning] : [])];
    return { ...result, sync: { ...saved, counts: data.counts, warnings, notifications: result.notifications } };
  } catch (error) {
    errorCode = error instanceof EduServerError ? error.code : 'EDU_SYNC_FAILED';
    if (sessionVersion && ['EDU_SESSION_EXPIRED', 'EDU_SESSION_INVALID'].includes(errorCode)) {
      await markConnectionNeedsReconnect(id, { sessionVersion, leaseId: lease.leaseId, errorCode }, context);
    }
    throw error;
  }
  finally { if (!success) await releaseSyncLease(id, lease.leaseId, { success, errorCode }, context); }
}

export async function disconnectAction(context, body) {
  context = await accessContext(context);
  expectFields(body, []);
  await disconnectConnection(context.connection.id, context);
  if (context.connection.scope === 'family') await retireLegacyParentConnections(context);
  return { status: { configured: true, scope: context.connection.scope, accountRole: context.connection.accountRole, state: 'disconnected', profiles: [] } };
}
