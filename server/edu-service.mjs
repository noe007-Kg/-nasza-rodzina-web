import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';
import { resolveConnectionAccess } from './edu-access.mjs';
import { encryptionConfigured, encryptLoginCredentials, decryptLoginCredentials } from './edu-secrets.mjs';
import { readAutoLogin, recordAutoLoginFailure, forgetAutoLogin } from './edu-storage.mjs';
import { acquireSyncLease, disconnectConnection, getConnectionStatus, loadConnection, markConnectionNeedsReconnect, releaseSyncLease, retireLegacyParentConnections, saveConnection, selectConnectionStudent, updateConnectionSession, upsertSchoolItems, validateConnectionSessionRefresh } from './edu-storage.mjs';
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

export async function connectAction(context, body, { connect = connectProvider } = {}) {
  context = await accessContext(context);
  requireConfigured(); expectFields(body, ['login', 'password', 'rememberLogin']);
  if (body.rememberLogin !== undefined && !['true', 'false'].includes(body.rememberLogin)) throw new EduServerError('EDU_INVALID_REQUEST', 400, 'Nieprawidłowa zgoda na zapis danych.');
  if (typeof body.login !== 'string' || !body.login.trim() || body.login.length > 320 || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw new EduServerError('EDU_INVALID_CREDENTIALS', 400, 'Podaj login i hasło do eduVULCAN.');
  const release = await loginLease(context);
  try {
    const connection = await connect({ login: body.login.trim(), password: body.password });
    const autoLogin = body.rememberLogin === 'true' ? { envelope: encryptLoginCredentials(body.login, body.password, context.connection.id), paused: false, nextAttemptAt: 0 } : null;
    const status = await saveConnection(context.connection.id, { ...connection, selectedStudent: null, connectLeaseId: release.leaseId, autoLogin }, context);
    if (context.connection.scope === 'family') await retireLegacyParentConnections(context);
    return { status: { configured: true, ...status } };
  } finally { delete body.login; delete body.password; await release(); }
}

/** One bounded, consented retry; never loops or bypasses interactive challenges. */
export async function recoverConnection(context, { connect = connectProvider } = {}) {
  context = await accessContext(context);
  requireConfigured();
  const id = context.connection.id, saved = await readAutoLogin(id, context);
  if (!saved?.expired || !saved.autoLogin?.envelope || saved.autoLogin.paused || saved.autoLogin.nextAttemptAt > Date.now()) return false;
  const release = await loginLease(context);
  let credentials;
  try {
    // Re-read after claiming the shared login lock; forgetting/disconnecting wins.
    const current = await readAutoLogin(id, context);
    if (!current || current.sessionVersion !== saved.sessionVersion || !current.autoLogin?.envelope || current.autoLogin.paused || current.autoLogin.nextAttemptAt > Date.now()) return false;
    credentials = decryptLoginCredentials(current.autoLogin.envelope, id);
    const connection = await connect(credentials);
    const previous = current.students.find(profile => profile.id === current.selectedStudent?.profileId);
    const next = (connection.students || connection.profiles || []).find(profile => profile.id === current.selectedStudent?.profileId);
    const key = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl') : '';
    const sameProfile = previous && next && key(previous.studentName) && key(previous.schoolName)
      && ['studentName', 'schoolName', 'schoolSymbol'].every(field => key(previous[field]) === key(next[field]));
    await saveConnection(id, { ...connection, connectLeaseId: release.leaseId, expectedSessionVersion: saved.sessionVersion,
      selectedStudent: sameProfile ? current.selectedStudent : null,
      autoLogin: { ...current.autoLogin, paused: false, nextAttemptAt: 0 } }, context);
    return true;
  } catch (error) {
    const code = error instanceof EduServerError ? error.code : 'EDU_CONNECT_FAILED';
    await recordAutoLoginFailure(id, saved.sessionVersion, release.leaseId,
      ['EDU_LOGIN_FAILED', 'EDU_INTERACTIVE_LOGIN_REQUIRED', 'EDU_SESSION_INVALID', 'EDU_INVALID_STUDENT', 'EDU_NO_PROFILES'].includes(code), context);
    throw error;
  } finally { if (credentials) { delete credentials.login; delete credentials.password; } await release(); }
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
  if (await recoverConnection(context)) return { ...await statusAction(context), recoveryOnly: true };
  const id = context.connection.id;
  const lease = await acquireSyncLease(id, context);
  let success = false; let errorCode; let sessionVersion;
  try {
    const connection = await loadConnection(id, context);
    sessionVersion = connection.sessionVersion;
    const { profileId, personKey } = connection.selectedStudent;
    const readStartedAt = Date.now();
    const data = await readData(connection.session, profileId, { includeMessages: context.connection.scope === 'family' });
    validateConnectionSessionRefresh(data?.session, profileId, { confirmed: data?.sessionConfirmedAt !== undefined });
    const refresh = { sessionVersion: connection.sessionVersion, leaseId: lease.leaseId,
      ...(data.expiresAt === undefined ? {} : { providerExpiresAt: data.expiresAt }) };
    // Preserve a rotated, validated cookie jar even if the subsequent import
    // fails. This first phase does not extend the existing retention deadline.
    await updateConnectionSession(id, data.session, refresh, context);
    const saved = await upsertSchoolItems(id, { profileId, personKey, items: data.items,
      sessionVersion: connection.sessionVersion, leaseId: lease.leaseId, reconcileScopes: data.reconcileScopes || [],
      notificationReadyTypes: data.notificationReadyTypes || [] }, context);
    // Confirm rolling inactivity retention only after the guarded import. Jar,
    // deadline and confirmation time commit atomically under the SAME lease and
    // sessionVersion. A disconnected/reconnected/expired session cannot revive.
    if (data.sessionConfirmedAt !== undefined) {
      await updateConnectionSession(id, data.session, { ...refresh, sessionConfirmedAt: data.sessionConfirmedAt, readStartedAt }, context);
    }
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
  expectFields(body, ['forgetLogin']);
  if (body.forgetLogin !== undefined) {
    if (body.forgetLogin !== 'true') throw new EduServerError('EDU_INVALID_REQUEST', 400, 'Nieprawidłowe żądanie.');
    await forgetAutoLogin(context.connection.id, context);
    return statusAction(context);
  }
  await disconnectConnection(context.connection.id, context);
  if (context.connection.scope === 'family') await retireLegacyParentConnections(context);
  return { status: { configured: true, scope: context.connection.scope, accountRole: context.connection.accountRole, state: 'disconnected', profiles: [] } };
}
