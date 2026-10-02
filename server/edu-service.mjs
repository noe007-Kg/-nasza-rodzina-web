import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';
import { encryptionConfigured } from './edu-secrets.mjs';
import { acquireSyncLease, disconnectConnection, getConnectionStatus, loadConnection, releaseSyncLease, saveConnection, selectConnectionStudent, updateConnectionSession, upsertSchoolItems } from './edu-storage.mjs';
import { connectProvider, readProviderData } from './edu-provider.mjs';
import { expectFields } from './edu-http.mjs';

function requireConfigured() {
  if (!encryptionConfigured()) throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Administrator musi skonfigurować szyfrowanie integracji na serwerze.');
}

async function loginLease({ uid, db }) {
  const ref = db.collection('_eduConnectLocks').doc(uid);
  const id = randomUUID(); const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref); const prior = snapshot.exists ? snapshot.data() : {};
    if (prior.expiresAt?.toMillis() > now) throw new EduServerError('EDU_CONNECT_BUSY', 409, 'Łączenie z dziennikiem już trwa.');
    const activeWindow = prior.windowStartedAt?.toMillis() > now - 15 * 60000;
    const attempts = activeWindow ? Number(prior.attempts || 0) : 0;
    if (attempts >= 5) throw new EduServerError('EDU_LOGIN_COOLDOWN', 429, 'Wykonano kilka prób logowania. Odczekaj 15 minut przed kolejną próbą.');
    transaction.set(ref, { id, expiresAt: Timestamp.fromMillis(now + 90000), attempts: attempts + 1,
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
  requireConfigured();
  return { status: { configured: true, ...await getConnectionStatus(context.uid, context) } };
}

export async function connectAction(context, body) {
  requireConfigured(); expectFields(body, ['login', 'password']);
  if (typeof body.login !== 'string' || !body.login.trim() || body.login.length > 320 || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw new EduServerError('EDU_INVALID_CREDENTIALS', 400, 'Podaj login i hasło do eduVULCAN.');
  const release = await loginLease(context);
  try {
    const connection = await connectProvider({ login: body.login.trim(), password: body.password });
    return { status: { configured: true, ...await saveConnection(context.uid, { ...connection, selectedStudent: null, connectLeaseId: release.leaseId }, context) } };
  } finally { delete body.login; delete body.password; await release(); }
}

export async function selectAction(context, body) {
  requireConfigured(); expectFields(body, ['profileId', 'personKey']);
  const connection = await loadConnection(context.uid, context);
  if (!connection.profiles.some((profile) => profile.id === body.profileId)) throw new EduServerError('EDU_INVALID_STUDENT', 400, 'Wybierz profil z połączonego konta.');
  await selectConnectionStudent(context.uid, body, context);
  return statusAction(context);
}

export async function syncAction(context, body) {
  requireConfigured(); expectFields(body, []);
  const lease = await acquireSyncLease(context.uid, context);
  let success = false; let errorCode;
  try {
    const connection = await loadConnection(context.uid, context);
    const { profileId, personKey } = connection.selectedStudent;
    const data = await readProviderData(connection.session, profileId);
    await updateConnectionSession(context.uid, data.session, { sessionVersion: connection.sessionVersion, leaseId: lease.leaseId }, context);
    const saved = await upsertSchoolItems(context.uid, { profileId, personKey, items: data.items,
      sessionVersion: connection.sessionVersion, leaseId: lease.leaseId, reconcileScopes: data.reconcileScopes || [] }, context);
    success = true;
    await releaseSyncLease(context.uid, lease.leaseId, { success, counts: data.counts, warnings: data.warnings }, context);
    return { ...await statusAction(context), sync: { ...saved, counts: data.counts, warnings: data.warnings } };
  } catch (error) { errorCode = error instanceof EduServerError ? error.code : 'EDU_SYNC_FAILED'; throw error; }
  finally { if (!success) await releaseSyncLease(context.uid, lease.leaseId, { success, errorCode }, context); }
}

export async function disconnectAction(context, body) {
  expectFields(body, []);
  await disconnectConnection(context.uid, context);
  return { status: { configured: true, state: 'disconnected', profiles: [] } };
}
