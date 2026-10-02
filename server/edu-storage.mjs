import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError, getServerFirebase } from './edu-auth.mjs';
import { decryptSession, encryptSession } from './edu-secrets.mjs';

const CONNECTIONS = '_eduConnections';
const SCHOOL_PEOPLE = new Set(['Paweł', 'Nikodem', 'Layla']);
const ITEM_TYPES = new Set(['lesson', 'homework', 'test', 'grade', 'message', 'activity']);
const COOLDOWN_MS = 5 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;
const MAX_ITEMS = 400;
const MAX_SYNC_WRITES = 450;

function identityKey(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl') : '';
}

function sameStudentIdentity(student, identity) {
  return Boolean(identityKey(identity?.studentName) && identityKey(identity?.schoolName)
    && identityKey(student?.studentName) === identityKey(identity.studentName)
    && identityKey(student?.schoolName) === identityKey(identity.schoolName)
    && (!identity.schoolSymbol || identityKey(student.schoolSymbol) === identityKey(identity.schoolSymbol)));
}

function scopeContext(connectionId, services) {
  const supplied = services.connection;
  if (!supplied) return { id: connectionId, scope: 'family', accountRole: 'parent', actorUid: services.uid || connectionId, allowedPersonKeys: [...SCHOOL_PEOPLE], legacy: true };
  if (supplied.id !== connectionId || !['family', 'student'].includes(supplied.scope)
    || supplied.accountRole !== (supplied.scope === 'family' ? 'parent' : 'student')
    || typeof supplied.actorUid !== 'string' || !supplied.actorUid || supplied.actorUid.length > 128
    || !Array.isArray(supplied.allowedPersonKeys) || !supplied.allowedPersonKeys.length
    || supplied.allowedPersonKeys.some((person) => !SCHOOL_PEOPLE.has(person))) {
    throw new EduServerError('EDU_CONNECTION_FORBIDDEN', 403, 'Nie masz dostępu do tego połączenia z dziennikiem.');
  }
  if (supplied.scope === 'family' && connectionId !== 'family') {
    throw new EduServerError('EDU_CONNECTION_FORBIDDEN', 403, 'Nieprawidłowe połączenie rodzinne.');
  }
  if (supplied.scope === 'student' && (supplied.allowedPersonKeys.length !== 1
    || connectionId !== `student_${createHash('sha256').update(supplied.actorUid).digest('hex')}`
    || !identityKey(supplied.allowedStudentIdentity?.studentName) || !identityKey(supplied.allowedStudentIdentity?.schoolName))) {
    throw new EduServerError('EDU_STUDENT_ACCESS_REQUIRED', 403, 'Rodzic musi najpierw przypisać dziennik do tego ucznia.');
  }
  return supplied;
}

function scopedStudents(students, scope) {
  const sanitized = sanitizeStudents(students);
  if (scope.scope !== 'student') return sanitized;
  const allowed = sanitized.filter((student) => sameStudentIdentity(student, scope.allowedStudentIdentity));
  if (!allowed.length) throw new EduServerError('EDU_INVALID_STUDENT', 403, 'Połączone konto nie udostępnia przypisanego dziennika ucznia.');
  return allowed;
}

function assertStoredScope(data, scope) {
  if (!scope.legacy && (data.scope !== scope.scope || data.accountRole !== scope.accountRole
    || (scope.scope === 'student' && data.connectedByUid !== scope.actorUid))) {
    throw new EduServerError('EDU_CONNECTION_FORBIDDEN', 403, 'Połączenie należy do innego konta lub zakresu danych.');
  }
}

async function assertStudentBinding(transaction, services, scope) {
  if (scope.scope !== 'student') return;
  const binding = await transaction.get(services.db.collection('_eduStudentBindings').doc(scope.allowedPersonKeys[0]));
  if (!binding.exists || !sameStudentIdentity(binding.data().identity, scope.allowedStudentIdentity)
    || !sameStudentIdentity(scope.allowedStudentIdentity, binding.data().identity)) {
    throw new EduServerError('EDU_STUDENT_ACCESS_REQUIRED', 403, 'Przypisanie ucznia zostało zmienione. Sprawdź ponownie połączenie.');
  }
}

function connectionRef(uid, services) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) throw new EduServerError('EDU_UNAUTHENTICATED', 401, 'Nieprawidłowe połączenie z dziennikiem.');
  scopeContext(uid, services);
  return services.db.collection(CONNECTIONS).doc(uid);
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
}

async function removeExpiredConnection(ref, observed, services) {
  await services.db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    // A reconnect in another tab must not be deleted by an older status request.
    if (current.exists && current.data().sessionVersion === observed.sessionVersion
      && timestampMillis(current.data().expiresAt) <= Date.now()) transaction.delete(ref);
  });
}

function text(value, limit, fallback = '') {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length > limit) throw new EduServerError('EDU_INVALID_DATA', 502, 'Dziennik zwrócił dane w nieprawidłowym formacie.');
  return value;
}

export function sanitizeStudents(students) {
  if (!Array.isArray(students) || students.length > 30) throw new EduServerError('EDU_INVALID_DATA', 502, 'Dziennik zwrócił nieprawidłową listę uczniów.');
  const ids = new Set();
  return students.map((student) => {
    const id = text(student?.id, 500);
    if (!id || ids.has(id)) throw new EduServerError('EDU_INVALID_DATA', 502, 'Dziennik zwrócił nieprawidłowy identyfikator ucznia.');
    ids.add(id);
    return {
      id, studentName: text(student.studentName ?? student.name, 300),
      schoolName: text(student.schoolName ?? student.school, 300),
      ...(student.schoolSymbol ? { schoolSymbol: text(student.schoolSymbol, 100) } : {}),
      ...(student.className ? { className: text(student.className, 100) } : {}),
      ...(student.academicYear ? { academicYear: text(String(student.academicYear), 30) } : {}),
    };
  });
}

function normalizeSelection(selection, students, scope = { allowedPersonKeys: [...SCHOOL_PEOPLE] }) {
  if (!selection) return null;
  const profileId = selection.profileId || selection.id;
  const personKey = selection.personKey || selection.person;
  if (!SCHOOL_PEOPLE.has(personKey) || !scope.allowedPersonKeys.includes(personKey) || !students.some((student) => student.id === profileId)) {
    throw new EduServerError('EDU_INVALID_STUDENT', 400, 'Wybierz ucznia z połączonego konta i dziecko z Naszej Rodziny.');
  }
  return { profileId, personKey };
}

function publicStatus(data, scope) {
  const expiresAt = timestampMillis(data.expiresAt);
  const lastSync = timestampMillis(data.lastSuccessfulSyncAt);
  return {
    connected: true, state: data.selectedStudent ? 'connected' : 'needs_profile',
    students: scope ? scopedStudents(data.students || [], scope) : sanitizeStudents(data.students || []),
    profiles: scope ? scopedStudents(data.students || [], scope) : sanitizeStudents(data.students || []),
    selectedStudent: scope ? normalizeSelection(data.selectedStudent, scopedStudents(data.students || [], scope), scope) : data.selectedStudent || null,
    ...(data.scope ? { scope: data.scope, accountRole: data.accountRole, connectedByUid: data.connectedByUid } : {}),
    expiresAt: new Date(expiresAt).toISOString(),
    lastSyncAt: Number.isFinite(lastSync) ? new Date(lastSync).toISOString() : null,
    lastSuccessAt: Number.isFinite(lastSync) ? new Date(lastSync).toISOString() : null,
    lastErrorCode: data.lastErrorCode || null,
    warnings: Array.isArray(data.warnings) ? data.warnings : [], counts: data.counts || null,
    nextSyncAt: Number.isFinite(lastSync) ? new Date(lastSync + COOLDOWN_MS).toISOString() : null,
    syncing: timestampMillis(data.lease?.expiresAt) > Date.now(),
  };
}

export async function saveConnection(uid, { session, students, profiles, selectedStudent, expiresAt, connectLeaseId }, services = getServerFirebase()) {
  const ref = connectionRef(uid, services);
  const scope = scopeContext(uid, services);
  const sanitized = scopedStudents(students || profiles || [], scope);
  const ttlHours = Number(process.env.EDUVULCAN_SESSION_TTL_HOURS || 24);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 24) throw new EduServerError('EDU_NOT_CONFIGURED', 503, 'Czas przechowywania sesji musi wynosić maksymalnie 24 godziny.');
  const expiry = Math.min(expiresAt ? timestampMillis(expiresAt) : Infinity, Date.now() + ttlHours * 3600000);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new EduServerError('EDU_SESSION_EXPIRED', 401, 'Sesja dziennika wygasła. Połącz konto ponownie.');
  const storedSession = scope.scope === 'student' && Array.isArray(session?.profiles)
    ? { ...session, profiles: session.profiles.filter((profile) => sanitized.some((student) => student.id === profile.id)) } : session;
  const envelope = encryptSession(storedSession, { uid });
  const result = await services.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    await assertStudentBinding(transaction, services, scope);
    if (connectLeaseId) {
      const connectLock = await transaction.get(services.db.collection('_eduConnectLocks').doc(uid));
      if (!connectLock.exists || connectLock.data().id !== connectLeaseId || timestampMillis(connectLock.data().expiresAt) <= Date.now()) {
        throw new EduServerError('EDU_CONNECTION_CHANGED', 409, 'Łączenie zostało anulowane. Konto nie zostało zapisane.');
      }
    }
    const previous = snapshot.exists ? snapshot.data() : {};
    if (snapshot.exists) assertStoredScope(previous, scope);
    const requestedSelection = selectedStudent === undefined ? previous.selectedStudent : selectedStudent;
    let selection = null;
    if (requestedSelection) {
      if (selectedStudent !== undefined) selection = normalizeSelection(requestedSelection, sanitized, scope);
      else if (sanitized.some((student) => student.id === requestedSelection.profileId)) selection = normalizeSelection(requestedSelection, sanitized, scope);
    }
    const data = {
      envelope, students: sanitized, selectedStudent: selection,
      expiresAt: Timestamp.fromMillis(expiry), sessionVersion: randomUUID(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(!scope.legacy ? { scope: scope.scope, accountRole: scope.accountRole, connectedByUid: scope.actorUid } : {}),
      ...(previous.createdAt ? { createdAt: previous.createdAt } : { createdAt: FieldValue.serverTimestamp() }),
      ...(previous.lastSuccessfulSyncAt && selection
        && previous.selectedStudent?.profileId === selection.profileId && previous.selectedStudent?.personKey === selection.personKey
        ? { lastSuccessfulSyncAt: previous.lastSuccessfulSyncAt } : {}),
    };
    transaction.set(ref, data);
    return data;
  });
  return publicStatus(result, scope);
}

export async function loadConnection(uid, services = getServerFirebase()) {
  const ref = connectionRef(uid, services);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new EduServerError('EDU_NOT_CONNECTED', 409, 'Najpierw połącz konto eduVULCAN.');
  const data = snapshot.data();
  const scope = scopeContext(uid, services);
  assertStoredScope(data, scope);
  if (!Number.isFinite(timestampMillis(data.expiresAt)) || timestampMillis(data.expiresAt) <= Date.now()) {
    await removeExpiredConnection(ref, data, services);
    throw new EduServerError('EDU_SESSION_EXPIRED', 401, 'Sesja dziennika wygasła. Połącz konto ponownie.');
  }
  return { ...publicStatus(data, scope), session: decryptSession(data.envelope, { uid }), sessionVersion: data.sessionVersion };
}

export async function getConnectionStatus(uid, services = getServerFirebase()) {
  const ref = connectionRef(uid, services);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { connected: false, state: 'disconnected', profiles: [], students: [], selectedStudent: null };
  const data = snapshot.data();
  const scope = scopeContext(uid, services);
  assertStoredScope(data, scope);
  if (!Number.isFinite(timestampMillis(data.expiresAt)) || timestampMillis(data.expiresAt) <= Date.now()) {
    await removeExpiredConnection(ref, data, services);
    return { connected: false, state: 'expired', expired: true, profiles: [], students: [], selectedStudent: null };
  }
  return publicStatus(data, scope);
}

export async function selectConnectionStudent(uid, selection, services = getServerFirebase()) {
  const ref = connectionRef(uid, services);
  const scope = scopeContext(uid, services);
  await services.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || timestampMillis(snapshot.data().expiresAt) <= Date.now()) throw new EduServerError('EDU_NOT_CONNECTED', 409, 'Najpierw połącz konto eduVULCAN.');
    const data = snapshot.data();
    assertStoredScope(data, scope);
    await assertStudentBinding(transaction, services, scope);
    if (timestampMillis(data.lease?.expiresAt) > Date.now()) throw new EduServerError('EDU_SYNC_BUSY', 409, 'Poczekaj na zakończenie synchronizacji.');
    const students = scopedStudents(data.students, scope);
    const selectedStudent = normalizeSelection(selection, students, scope);
    const changed = data.selectedStudent?.profileId !== selectedStudent.profileId || data.selectedStudent?.personKey !== selectedStudent.personKey;
    transaction.update(ref, {
      selectedStudent, updatedAt: FieldValue.serverTimestamp(),
      ...(changed ? { lastSuccessfulSyncAt: FieldValue.delete(), lastSyncAttemptAt: FieldValue.delete(), lastErrorCode: FieldValue.delete(), counts: FieldValue.delete(), warnings: FieldValue.delete() } : {}),
    });
    if (!scope.legacy && scope.scope === 'family') {
      const student = students.find((profile) => profile.id === selectedStudent.profileId);
      transaction.set(services.db.collection('_eduStudentBindings').doc(selectedStudent.personKey), {
        identity: { studentName: student.studentName, schoolName: student.schoolName, ...(student.schoolSymbol ? { schoolSymbol: student.schoolSymbol } : {}) },
        establishedByUid: scope.actorUid, establishedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return getConnectionStatus(uid, services);
}

export async function disconnectConnection(uid, services = getServerFirebase()) {
  const ref = connectionRef(uid, services);
  const scope = scopeContext(uid, services);
  const connectRef = services.db.collection('_eduConnectLocks').doc(uid);
  await services.db.runTransaction(async (transaction) => {
    const connection = await transaction.get(ref);
    if (connection.exists) assertStoredScope(connection.data(), scope);
    const lock = await transaction.get(connectRef);
    transaction.delete(ref);
    // Preserve login counters while invalidating a login still awaiting the provider.
    if (lock.exists) transaction.update(connectRef, { id: randomUUID(), expiresAt: Timestamp.fromMillis(0) });
  });
  // Imported school history is kept; disconnecting removes only credentials/session.
  return { connected: false, state: 'disconnected', profiles: [], students: [], selectedStudent: null };
}

/** Retire 1.5.0 sessions that were keyed by the individual parent's Firebase UID.
 * The active family connection and personal student connections are untouched.
 * Invalidate old login leases as well, so an older request cannot resurrect them.
 */
export async function retireLegacyParentConnections(services) {
  const scope = scopeContext(services?.connection?.id, services);
  if (scope.scope !== 'family' || scope.legacy || services.profile?.role !== 'parent') {
    throw new EduServerError('EDU_PARENT_REQUIRED', 403, 'Porządkowanie połączeń rodzinnych wymaga roli parent.');
  }
  const parents = await services.db.collection('members').where('role', '==', 'parent').limit(64).get();
  if (parents.size >= 64) throw new EduServerError('EDU_IMPORT_LIMIT', 409, 'Zbyt wiele kont do bezpiecznego porządkowania połączeń.');
  const parentIds = parents.docs.map((document) => document.id)
    .filter((id) => typeof id === 'string' && id && id.length <= 128 && !id.includes('/') && id !== 'family');
  if (!parentIds.length) return { retired: 0 };
  const members = parentIds.map((id) => services.db.collection('members').doc(id));
  const connections = parentIds.map((id) => services.db.collection(CONNECTIONS).doc(id));
  const locks = parentIds.map((id) => services.db.collection('_eduConnectLocks').doc(id));
  return services.db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(...members, ...connections, ...locks);
    let retired = 0;
    parentIds.forEach((_id, index) => {
      const member = snapshots[index];
      if (!member.exists || member.data().role !== 'parent') return;
      const connection = snapshots[parentIds.length + index];
      if (connection.exists && connection.data().scope !== 'student') {
        transaction.delete(connections[index]);
        retired += 1;
      }
      const lock = snapshots[parentIds.length * 2 + index];
      if (lock.exists) transaction.update(locks[index], { id: randomUUID(), expiresAt: Timestamp.fromMillis(0) });
    });
    return { retired };
  });
}

export async function updateConnectionSession(uid, session, { sessionVersion, leaseId } = {}, services = getServerFirebase()) {
  if (!sessionVersion || !leaseId) throw new EduServerError('EDU_CONNECTION_CHANGED', 409, 'Odświeżenie sesji wymaga bieżącej synchronizacji.');
  const ref = connectionRef(uid, services);
  const scope = scopeContext(uid, services);
  const storedSession = scope.scope === 'student' && Array.isArray(session?.profiles)
    ? { ...session, profiles: session.profiles.filter((profile) => sameStudentIdentity(profile, scope.allowedStudentIdentity)) } : session;
  const envelope = encryptSession(storedSession, { uid });
  await services.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() : null;
    if (!data || timestampMillis(data.expiresAt) <= Date.now() || (sessionVersion && data.sessionVersion !== sessionVersion)
      || (leaseId && (data.lease?.id !== leaseId || timestampMillis(data.lease?.expiresAt) <= Date.now()))) throw new EduServerError('EDU_CONNECTION_CHANGED', 409, 'Połączenie zostało zmienione. Uruchom synchronizację ponownie.');
    assertStoredScope(data, scope);
    await assertStudentBinding(transaction, services, scope);
    normalizeSelection(data.selectedStudent, scopedStudents(data.students, scope), scope);
    transaction.update(ref, { envelope, updatedAt: FieldValue.serverTimestamp() });
  });
}

export async function acquireSyncLease(uid, services = getServerFirebase()) {
  const ref = connectionRef(uid, services);
  const scope = scopeContext(uid, services);
  const leaseId = randomUUID();
  const expiresAt = Date.now() + LEASE_MS;
  await services.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() : null;
    if (!data || timestampMillis(data.expiresAt) <= Date.now()) throw new EduServerError('EDU_NOT_CONNECTED', 409, 'Najpierw połącz konto eduVULCAN.');
    assertStoredScope(data, scope);
    await assertStudentBinding(transaction, services, scope);
    if (!data.selectedStudent) throw new EduServerError('EDU_SELECT_STUDENT', 409, 'Najpierw wybierz ucznia.');
    normalizeSelection(data.selectedStudent, scopedStudents(data.students, scope), scope);
    if (timestampMillis(data.lease?.expiresAt) > Date.now()) throw new EduServerError('EDU_SYNC_BUSY', 409, 'Synchronizacja jest już uruchomiona.');
    const lastSuccessfulSync = timestampMillis(data.lastSuccessfulSyncAt);
    const lastAttempt = timestampMillis(data.lastSyncAttemptAt);
    if ((Number.isFinite(lastSuccessfulSync) && Date.now() - lastSuccessfulSync < COOLDOWN_MS)
      || (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < 30000)) {
      throw new EduServerError('EDU_SYNC_COOLDOWN', 429, 'Odczekaj przed kolejną synchronizacją. Dane odświeżamy najwyżej co 5 minut.');
    }
    transaction.update(ref, { lease: { id: leaseId, expiresAt: Timestamp.fromMillis(expiresAt) }, lastSyncAttemptAt: FieldValue.serverTimestamp() });
  });
  return { leaseId, expiresAt: new Date(expiresAt).toISOString() };
}

export async function releaseSyncLease(uid, leaseId, { success = false, errorCode, warnings, counts } = {}, services = getServerFirebase()) {
  const ref = connectionRef(uid, services);
  const scope = scopeContext(uid, services);
  await services.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data().lease?.id !== leaseId) return;
    assertStoredScope(snapshot.data(), scope);
    const safeWarnings = Array.isArray(warnings) ? warnings.slice(0, 10).map((warning) => text(warning, 500)) : [];
    const safeCounts = {};
    for (const key of ['lessons', 'grades', 'homework', 'tests', 'messages', 'activities', 'added', 'updated', 'total']) {
      if (Number.isInteger(counts?.[key]) && counts[key] >= 0 && counts[key] <= 10000) safeCounts[key] = counts[key];
    }
    transaction.update(ref, {
      lease: FieldValue.delete(),
      ...(warnings ? { warnings: safeWarnings } : {}), ...(counts ? { counts: safeCounts } : {}),
      ...(success ? { lastSuccessfulSyncAt: FieldValue.serverTimestamp(), lastErrorCode: FieldValue.delete() }
        : { lastErrorCode: typeof errorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(errorCode) ? errorCode : 'EDU_SYNC_FAILED' }),
    });
  });
}

/** Pure normalization, used by the adapter boundary and its security tests. */
export function prepareImportedSchoolItems(uid, { personKey, person, profileId, studentId, items, syncId = randomUUID() }, services = {}) {
  const scope = scopeContext(uid, services);
  const mappedPerson = personKey || person;
  const mappedProfile = profileId || studentId;
  if (!SCHOOL_PEOPLE.has(mappedPerson) || !scope.allowedPersonKeys.includes(mappedPerson) || typeof mappedProfile !== 'string' || !mappedProfile || mappedProfile.length > 500
    || !Array.isArray(items) || items.length > MAX_ITEMS) throw new EduServerError('EDU_INVALID_DATA', 502, 'Dziennik zwrócił nieprawidłowy zakres danych.');
  const seen = new Set();
  return items.map((item) => {
    const externalId = text(item.externalId ?? item.sourceRecordId, 500);
    if (!externalId || !ITEM_TYPES.has(item.type)) throw new EduServerError('EDU_INVALID_DATA', 502, 'Dziennik zwrócił nieprawidłowy wpis szkolny.');
    // A student could enter a parent's provider credentials. Until provider-side
    // student mailbox identity can be verified, never import that inbox as theirs.
    if (scope.scope === 'student' && item.type === 'message') {
      throw new EduServerError('EDU_STUDENT_MESSAGES_UNAVAILABLE', 403, 'Wiadomości wymagają potwierdzonego osobistego konta ucznia w dzienniku.');
    }
    const identity = [mappedPerson, mappedProfile, item.type, externalId];
    if (scope.scope === 'student') identity.unshift(uid);
    const id = `edu_${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
    if (seen.has(id)) throw new EduServerError('EDU_INVALID_DATA', 502, 'Dziennik zwrócił powtórzone identyfikatory wpisów.');
    seen.add(id);
    const title = text(item.title, 500);
    if (!title.trim()) throw new EduServerError('EDU_INVALID_DATA', 502, 'Wpis szkolny nie zawiera tytułu.');
    const weekday = item.weekday == null ? 0 : Number(item.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 7) throw new EduServerError('EDU_INVALID_DATA', 502, 'Nieprawidłowy dzień tygodnia w planie.');
    const data = {
      title, person: mappedPerson, type: item.type,
      subject: text(item.subject, 300), date: text(item.date, 10),
      time: text(item.time, 5), endTime: text(item.endTime, 5), weekday,
      note: text(item.note ?? item.body, 20000),
      source: 'eduvulcan', provider: 'eduvulcan', sourceRecordId: externalId,
      sourceProfileId: mappedProfile, sourceOwnerUid: scope.actorUid, sourceSyncId: syncId,
      ...(!scope.legacy ? { sourceConnectionId: uid, sourceConnectionScope: scope.scope } : {}),
    };
    const scopeId = item.providerScopeId ?? item.scopeId;
    if (scopeId != null) {
      if (typeof scopeId !== 'string' || scopeId.length > 200
        || (item.type === 'grade' ? !/^grades:[A-Za-z0-9_.-]{1,180}$/.test(scopeId) : item.type !== 'lesson' || scopeId !== 'timetable')) {
        throw new EduServerError('EDU_INVALID_DATA', 502, 'Nieprawidłowy zakres wpisu szkolnego.');
      }
      data.providerScopeId = scopeId;
    }
    if (item.type === 'message') {
      data.personKey = mappedPerson;
      data.sender = text(item.sender, 300);
      data.read = item.read === true;
    }
    return { id, collection: item.type === 'message' ? scope.scope === 'student' ? 'schoolStudentMessages' : 'schoolParentMessages' : 'schoolItems', data };
  });
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeReconcileScopes(scopes = []) {
  if (!Array.isArray(scopes) || scopes.length > 10) throw new EduServerError('EDU_INVALID_DATA', 502, 'Nieprawidłowy zakres synchronizacji.');
  return scopes.map((scope) => {
    if (!scope || Object.keys(scope).some((key) => !['type', 'scopeId', 'dateFrom', 'dateTo'].includes(key))) throw new EduServerError('EDU_INVALID_DATA', 502, 'Nieprawidłowy zakres synchronizacji.');
    if (scope.type === 'grade' && /^grades:[A-Za-z0-9_.-]{1,180}$/.test(scope.scopeId)
      && scope.dateFrom === undefined && scope.dateTo === undefined) return { type: 'grade', scopeId: scope.scopeId };
    if (scope.type === 'lesson' && scope.scopeId === 'timetable' && validDate(scope.dateFrom) && validDate(scope.dateTo)
      && scope.dateFrom <= scope.dateTo && Date.parse(scope.dateTo) - Date.parse(scope.dateFrom) <= 62 * 86400000) {
      return { type: 'lesson', scopeId: 'timetable', dateFrom: scope.dateFrom, dateTo: scope.dateTo };
    }
    throw new EduServerError('EDU_INVALID_DATA', 502, 'Nieprawidłowy lub zbyt szeroki zakres synchronizacji.');
  });
}

function matchesConnectionScope(data, scope) {
  if (scope.legacy) return true;
  return data.sourceConnectionId === scope.id || (scope.scope === 'family' && data.sourceConnectionId === undefined);
}

function matchesReconcileScope(data, input, scopes, connectionScope) {
  return data.source === 'eduvulcan' && data.sourceProfileId === (input.profileId || input.studentId)
    && data.person === (input.personKey || input.person)
    && matchesConnectionScope(data, connectionScope)
    && scopes.some((scope) => data.type === scope.type && data.providerScopeId === scope.scopeId
      && (scope.type !== 'lesson' || (validDate(data.date) && data.date >= scope.dateFrom && data.date <= scope.dateTo)));
}

export async function upsertSchoolItems(uid, input, services = getServerFirebase()) {
  const scope = scopeContext(uid, services);
  const entries = prepareImportedSchoolItems(uid, input, services);
  const scopes = normalizeReconcileScopes(input.reconcileScopes);
  const incomingIds = new Set(entries.map((entry) => entry.id));
  let deleteCandidates = [];
  if (scopes.length) {
    const existingScope = await services.db.collection('schoolItems').where('sourceProfileId', '==', input.profileId || input.studentId).limit(1500).get();
    if (existingScope.size >= 1500) throw new EduServerError('EDU_IMPORT_LIMIT', 409, 'Zbyt wiele wpisów do bezpiecznej synchronizacji. Nic nie zostało usunięte.');
    deleteCandidates = existingScope.docs.filter((document) => !incomingIds.has(document.id) && matchesReconcileScope(document.data(), input, scopes, scope)).map((document) => document.ref);
  }
  if (entries.length + deleteCandidates.length > MAX_SYNC_WRITES) throw new EduServerError('EDU_IMPORT_LIMIT', 409, 'Zbyt wiele zmian do bezpiecznej synchronizacji. Nic nie zostało usunięte.');
  const refs = entries.map((entry) => services.db.collection(entry.collection).doc(entry.id));
  let added = 0;
  let updated = 0;
  let deleted = 0;
  await services.db.runTransaction(async (transaction) => {
    const connection = await transaction.get(connectionRef(uid, services));
    const selected = connection.exists ? connection.data().selectedStudent : null;
    if (!selected || selected.profileId !== (input.profileId || input.studentId) || selected.personKey !== (input.personKey || input.person)
      || timestampMillis(connection.data().expiresAt) <= Date.now()
      || !input.leaseId || connection.data().lease?.id !== input.leaseId || timestampMillis(connection.data().lease?.expiresAt) <= Date.now()
      || !input.sessionVersion || connection.data().sessionVersion !== input.sessionVersion) {
      throw new EduServerError('EDU_CONNECTION_CHANGED', 409, 'Połączenie lub wybrany uczeń został zmieniony. Dane nie zostały zapisane.');
    }
    assertStoredScope(connection.data(), scope);
    await assertStudentBinding(transaction, services, scope);
    normalizeSelection(selected, scopedStudents(connection.data().students, scope), scope);
    const allRefs = [...refs, ...deleteCandidates];
    const existing = allRefs.length ? await transaction.getAll(...allRefs) : [];
    added = 0;
    updated = 0;
    deleted = 0;
    entries.forEach((entry, index) => {
      const prior = existing[index];
      const previous = prior.exists ? prior.data() : null;
      if (previous && (previous.source !== 'eduvulcan' || previous.sourceRecordId !== entry.data.sourceRecordId
        || previous.sourceProfileId !== entry.data.sourceProfileId || previous.person !== entry.data.person || !matchesConnectionScope(previous, scope))) {
        throw new EduServerError('EDU_IMPORT_CONFLICT', 409, 'Istniejący wpis lokalny blokuje import. Nie został nadpisany.');
      }
      if (previous) updated += 1; else added += 1;
      transaction.set(refs[index], {
        ...entry.data, createdBy: previous?.createdBy || scope.actorUid,
        createdAt: previous?.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(), syncedAt: FieldValue.serverTimestamp(),
      });
    });
    deleteCandidates.forEach((ref, index) => {
      const snapshot = existing[refs.length + index];
      // Re-read provenance and range inside the guarded transaction.
      if (snapshot.exists && matchesReconcileScope(snapshot.data(), input, scopes, scope)) {
        transaction.delete(ref);
        deleted += 1;
      }
    });
  });
  return { added, updated, deleted, total: entries.length, messages: entries.filter((entry) => ['schoolParentMessages', 'schoolStudentMessages'].includes(entry.collection)).length };
}
