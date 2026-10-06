import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { studentConnectionId } from '../server/edu-access.mjs';
import { decryptSession } from '../server/edu-secrets.mjs';
import {
  acquireSyncLease, disconnectConnection, getConnectionStatus, loadConnection,
  prepareImportedSchoolItems, releaseSyncLease, retireLegacyParentConnections,
  saveConnection, selectConnectionStudent, updateConnectionSession, upsertSchoolItems, markConnectionNeedsReconnect,
} from '../server/edu-storage.mjs';
import { syncAction } from '../server/edu-service.mjs';
import { EduServerError } from '../server/edu-auth.mjs';

const pupil = { id: 'nikodem-school', studentName: 'Nikodem Testowy', schoolName: 'Szkoła Podstawowa 4', schoolSymbol: 'SP4' };
const sibling = { id: 'pawel-school', studentName: 'Paweł Testowy', schoolName: 'Szkoła Podstawowa 4', schoolSymbol: 'SP4' };
const preschool = { ...pupil, id: 'nikodem-preschool', schoolName: 'Przedszkole Testowe', schoolSymbol: 'P1' };
const identity = { studentName: pupil.studentName, schoolName: pupil.schoolName, schoolSymbol: pupil.schoolSymbol };

async function withEncryption(action) {
  const previous = process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64;
  process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString('base64');
  try { return await action(); }
  finally {
    if (previous === undefined) delete process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64;
    else process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = previous;
  }
}

function databaseFixture(initial = {}) {
  const records = new Map(Object.entries(initial));
  let writes = 0;
  const snapshot = (ref) => ({ exists: records.has(ref.path), id: ref.path.split('/').at(-1), ref, data: () => records.get(ref.path) });
  const reference = (path) => ({ path, get: async () => snapshot(reference(path)) });
  const resolveField = (value) => {
    if (typeof value?.isEqual === 'function') {
      try {
        if (value.isEqual(FieldValue.delete())) return { deleted: true };
        if (value.isEqual(FieldValue.serverTimestamp())) return { value: Timestamp.now() };
      } catch { /* Timestamps are values, not transforms. */ }
    }
    return { value };
  };
  const db = {
    collection: (name) => ({
      doc: (id) => reference(`${name}/${id}`),
      where: (field, operator, value) => ({ limit: (limit) => ({ get: async () => {
        assert.equal(operator, '==');
        const rows = [...records.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).slice(0, limit);
        return { size: rows.length, docs: rows.map(([path]) => snapshot(reference(path))) };
      } }) }),
    }),
    runTransaction: async (action) => {
      const pending = [];
      const result = await action({
        get: async (ref) => snapshot(ref),
        getAll: async (...refs) => refs.map(snapshot),
        set: (ref, data) => pending.push({ method: 'set', ref, data }),
        update: (ref, data) => pending.push({ method: 'update', ref, data }),
        delete: (ref) => pending.push({ method: 'delete', ref }),
      });
      for (const change of pending) {
        writes += 1;
        if (change.method === 'delete') { records.delete(change.ref.path); continue; }
        const next = change.method === 'set' ? {} : { ...records.get(change.ref.path) };
        for (const [key, value] of Object.entries(change.data)) {
          const field = resolveField(value);
          if (field.deleted) delete next[key]; else next[key] = field.value;
        }
        records.set(change.ref.path, next);
      }
      return result;
    },
  };
  return { db, records, get writes() { return writes; } };
}

function family(fixture, uid = 'parent-dominika') {
  return { db: fixture.db, uid, profile: { role: 'parent' }, connection: {
    id: 'family', scope: 'family', accountRole: 'parent', actorUid: uid, allowedPersonKeys: ['Paweł', 'Nikodem', 'Layla'],
  } };
}

function student(fixture, uid = 'student-nikodem') {
  return { db: fixture.db, uid, profile: { role: 'child', personKey: 'Nikodem' }, connection: {
    id: studentConnectionId(uid), scope: 'student', accountRole: 'student', actorUid: uid,
    allowedPersonKeys: ['Nikodem'], allowedStudentIdentity: identity,
  } };
}

function bindingFixture() {
  return databaseFixture({ '_eduStudentBindings/Nikodem': { identity, establishedByUid: 'parent-dominika' } });
}

async function connectAndSelect(context, profiles = [pupil]) {
  const id = context.connection.id;
  await saveConnection(id, { session: { cookieJar: 'private-session-cookie', profiles }, profiles }, context);
  await selectConnectionStudent(id, { profileId: pupil.id, personKey: 'Nikodem' }, context);
  return getConnectionStatus(id, context);
}

async function guardedInput(context, items, reconcileScopes = []) {
  const lease = await acquireSyncLease(context.connection.id, context);
  const connection = await loadConnection(context.connection.id, context);
  return { personKey: 'Nikodem', profileId: pupil.id, leaseId: lease.leaseId, sessionVersion: connection.sessionVersion, items, reconcileScopes };
}

test('both parent actors share one encrypted family connection, student and status', async () => withEncryption(async () => {
  const fixture = databaseFixture();
  const dominika = family(fixture);
  const sebastian = family(fixture, 'parent-sebastian');
  await connectAndSelect(dominika, [preschool, pupil]);
  const status = await getConnectionStatus('family', sebastian);
  assert.equal(status.state, 'connected');
  assert.deepEqual(status.selectedStudent, { profileId: pupil.id, personKey: 'Nikodem' });
  assert.equal(status.scope, 'family');
  assert.equal(status.accountRole, 'parent');
  assert.equal(status.connectedByUid, dominika.uid);
  assert.equal(status.profiles.find((profile) => profile.id === pupil.id).studentName, pupil.studentName);
  assert.deepEqual(fixture.records.get('_eduStudentBindings/Nikodem').identity, identity);
  assert.equal(JSON.stringify(status).includes('private-session-cookie'), false);
  const stored = fixture.records.get('_eduConnections/family');
  assert.equal(JSON.stringify(stored).includes('private-session-cookie'), false);
  assert.equal(decryptSession(stored.envelope, { uid: 'family' }).cookieJar, 'private-session-cookie');
  assert.throws(() => decryptSession(stored.envelope, { uid: dominika.uid }), { code: 'EDU_SESSION_INVALID' });
  assert.equal([...fixture.records.keys()].filter((key) => key.startsWith('_eduConnections/')).length, 1);
  await disconnectConnection('family', sebastian);
  assert.equal((await getConnectionStatus('family', dominika)).state, 'disconnected');
}));

test('family lease, successful timestamp and cooldown are shared across parents', async () => withEncryption(async () => {
  const fixture = databaseFixture();
  const dominika = family(fixture);
  const sebastian = family(fixture, 'parent-sebastian');
  await connectAndSelect(dominika);
  const lease = await acquireSyncLease('family', dominika);
  await assert.rejects(acquireSyncLease('family', sebastian), { code: 'EDU_SYNC_BUSY' });
  await releaseSyncLease('family', lease.leaseId, { success: true, counts: { grades: 1 } }, sebastian);
  const first = await getConnectionStatus('family', dominika);
  const second = await getConnectionStatus('family', sebastian);
  assert.equal(first.lastSyncAt, second.lastSyncAt);
  assert.ok(first.lastSyncAt);
  await assert.rejects(acquireSyncLease('family', sebastian), { code: 'EDU_SYNC_COOLDOWN' });
}));

test('student connection retains and returns only the approved student and school', async () => withEncryption(async () => {
  const fixture = bindingFixture();
  const context = student(fixture);
  const profiles = [sibling, preschool, { ...pupil, studentName: '  NIKODEM   TESTOWY  ', schoolName: 'SZKOŁA PODSTAWOWA 4' }];
  const status = await saveConnection(context.connection.id, { session: { cookieJar: 'student-cookie', profiles }, profiles }, context);
  assert.deepEqual(status.profiles.map((profile) => profile.id), [pupil.id]);
  const privateSession = await loadConnection(context.connection.id, context);
  assert.deepEqual(privateSession.session.profiles.map((profile) => profile.id), [pupil.id]);
  const selected = await selectConnectionStudent(context.connection.id, { profileId: pupil.id, personKey: 'Nikodem' }, context);
  assert.equal(selected.accountRole, 'student');
  assert.equal(selected.selectedStudent.personKey, 'Nikodem');
  assert.equal(fixture.records.get('_eduStudentBindings/Nikodem').establishedByUid, 'parent-dominika');
  for (const selection of [{ profileId: pupil.id, personKey: 'Paweł' }, { profileId: sibling.id, personKey: 'Nikodem' }, { profileId: preschool.id, personKey: 'Nikodem' }]) {
    await assert.rejects(selectConnectionStudent(context.connection.id, selection, context), { code: 'EDU_INVALID_STUDENT' });
  }
}));

test('student identity mismatch or missing parent approval fails before persistence', async () => withEncryption(async () => {
  for (const profiles of [[sibling], [preschool], [{ ...pupil, schoolSymbol: 'OTHER' }]]) {
    const fixture = bindingFixture();
    const context = student(fixture);
    await assert.rejects(saveConnection(context.connection.id, { session: {}, profiles }, context), { code: 'EDU_INVALID_STUDENT', status: 403 });
    assert.equal(fixture.writes, 0);
  }
  const fixture = databaseFixture();
  const context = student(fixture);
  await assert.rejects(saveConnection(context.connection.id, { session: {}, profiles: [pupil] }, context), { code: 'EDU_STUDENT_ACCESS_REQUIRED' });
  assert.equal(fixture.writes, 0);
}));

test('connection keys cannot be substituted across the family or other student UIDs', async () => {
  const fixture = bindingFixture();
  const context = student(fixture);
  await assert.rejects(getConnectionStatus('family', context), { code: 'EDU_CONNECTION_FORBIDDEN' });
  await assert.rejects(getConnectionStatus(studentConnectionId('other-student'), context), { code: 'EDU_CONNECTION_FORBIDDEN' });
  await assert.rejects(getConnectionStatus('parent-dominika', family(fixture)), { code: 'EDU_CONNECTION_FORBIDDEN' });
});

test('changed student approval blocks all session and school mutations transactionally', async () => withEncryption(async () => {
  const fixture = bindingFixture();
  const context = student(fixture);
  await connectAndSelect(context);
  const input = await guardedInput(context, [{ externalId: 'grade-one', type: 'grade', title: '5' }]);
  fixture.records.set('_eduStudentBindings/Nikodem', { identity: { ...identity, schoolName: 'Inna szkoła' } });
  const writesBefore = fixture.writes;
  await assert.rejects(upsertSchoolItems(context.connection.id, input, context), { code: 'EDU_STUDENT_ACCESS_REQUIRED' });
  await assert.rejects(updateConnectionSession(context.connection.id, { cookieJar: 'new-cookie', profiles: [pupil] }, input, context), { code: 'EDU_STUDENT_ACCESS_REQUIRED' });
  await assert.rejects(selectConnectionStudent(context.connection.id, { profileId: pupil.id, personKey: 'Nikodem' }, context), { code: 'EDU_STUDENT_ACCESS_REQUIRED' });
  await assert.rejects(saveConnection(context.connection.id, { session: {}, profiles: [pupil] }, context), { code: 'EDU_STUDENT_ACCESS_REQUIRED' });
  assert.equal(fixture.writes, writesBefore);
  assert.equal([...fixture.records.keys()].some((key) => key.startsWith('school')), false);
}));

test('personal identities are isolated while provenance records actual actors', async () => withEncryption(async () => {
  const fixture = bindingFixture();
  const parentContext = family(fixture);
  const studentContext = student(fixture);
  const items = [{ externalId: 'grade-one', type: 'grade', title: '5' }, { externalId: 'message-one', type: 'message', title: 'Wiadomość', body: 'Tekst testowy' }];
  await connectAndSelect(parentContext);
  await connectAndSelect(studentContext);
  const parentInput = await guardedInput(parentContext, items);
  const studentInput = await guardedInput(studentContext, items.filter((item) => item.type !== 'message'));
  assert.equal((await upsertSchoolItems('family', parentInput, parentContext)).messages, 1);
  assert.equal((await upsertSchoolItems(studentContext.connection.id, studentInput, studentContext)).messages, 0);
  const parentRows = prepareImportedSchoolItems('family', parentInput, parentContext);
  const studentRows = prepareImportedSchoolItems(studentContext.connection.id, studentInput, studentContext);
  assert.notEqual(parentRows[0].id, studentRows[0].id);
  assert.equal(parentRows[1].collection, 'schoolParentMessages');
  for (const [context, rows] of [[parentContext, parentRows], [studentContext, studentRows]]) {
    for (const row of rows) {
      const imported = fixture.records.get(`${row.collection}/${row.id}`);
      assert.equal(imported.sourceOwnerUid, context.uid);
      assert.equal(imported.createdBy, context.uid);
      assert.equal(imported.sourceConnectionId, context.connection.id);
      assert.equal(imported.sourceConnectionScope, context.connection.scope);
    }
  }
  assert.throws(() => prepareImportedSchoolItems(studentContext.connection.id, { ...studentInput, personKey: 'Paweł' }, studentContext), { code: 'EDU_INVALID_DATA' });
}));

test('student credential use cannot import a parent mailbox or partially save a mixed batch', async () => withEncryption(async () => {
  const fixture = bindingFixture();
  const context = student(fixture);
  await connectAndSelect(context);
  const input = await guardedInput(context, [
    { externalId: 'grade-one', type: 'grade', title: '5' },
    { externalId: 'parent-message', type: 'message', title: 'Prywatna wiadomość rodzica' },
  ]);
  const writesBefore = fixture.writes;
  await assert.rejects(upsertSchoolItems(context.connection.id, input, context), { code: 'EDU_STUDENT_MESSAGES_UNAVAILABLE', status: 403 });
  assert.equal(fixture.writes, writesBefore);
  assert.equal([...fixture.records.keys()].some((key) => key.startsWith('school')), false);
  assert.throws(() => prepareImportedSchoolItems(context.connection.id, input, context), { code: 'EDU_STUDENT_MESSAGES_UNAVAILABLE' });
}));

test('reconnecting without a selected student clears the previous successful sync timestamp', async () => withEncryption(async () => {
  const fixture = databaseFixture();
  const context = family(fixture);
  await connectAndSelect(context);
  const lease = await acquireSyncLease('family', context);
  await releaseSyncLease('family', lease.leaseId, { success: true }, context);
  assert.ok((await getConnectionStatus('family', context)).lastSyncAt);
  const reconnected = await saveConnection('family', { session: { cookieJar: 'new-session' }, profiles: [pupil], selectedStudent: null }, context);
  assert.equal(reconnected.selectedStudent, null);
  assert.equal(reconnected.lastSyncAt, null);
}));

test('reconciliation never prunes another connection; family can reconcile its legacy rows', async () => withEncryption(async () => {
  const fixture = bindingFixture();
  const parentContext = family(fixture);
  const studentContext = student(fixture);
  await connectAndSelect(parentContext);
  await connectAndSelect(studentContext);
  const item = { externalId: 'withdrawn-grade', type: 'grade', title: '4', providerScopeId: 'grades:current' };
  const parentRow = prepareImportedSchoolItems('family', { personKey: 'Nikodem', profileId: pupil.id, items: [item] }, parentContext)[0];
  const studentRow = prepareImportedSchoolItems(studentContext.connection.id, { personKey: 'Nikodem', profileId: pupil.id, items: [item] }, studentContext)[0];
  fixture.records.set(`schoolItems/${parentRow.id}`, parentRow.data);
  fixture.records.set(`schoolItems/${studentRow.id}`, studentRow.data);
  fixture.records.set('schoolItems/legacy-parent-grade', { ...parentRow.data, sourceConnectionId: undefined });
  const scopes = [{ type: 'grade', scopeId: 'grades:current' }];
  const studentInput = await guardedInput(studentContext, [], scopes);
  assert.equal((await upsertSchoolItems(studentContext.connection.id, studentInput, studentContext)).deleted, 1);
  assert.ok(fixture.records.has(`schoolItems/${parentRow.id}`));
  assert.ok(fixture.records.has('schoolItems/legacy-parent-grade'));
  fixture.records.set(`schoolItems/${studentRow.id}`, studentRow.data);
  const parentInput = await guardedInput(parentContext, [], scopes);
  assert.equal((await upsertSchoolItems('family', parentInput, parentContext)).deleted, 2);
  assert.ok(fixture.records.has(`schoolItems/${studentRow.id}`));
}));

test('legacy retirement removes parent UID sessions and invalidates leases only', async () => {
  const childId = studentConnectionId('student-nikodem');
  const fixture = databaseFixture({
    'members/parent-dominika': { role: 'parent' },
    'members/parent-sebastian': { role: 'parent' },
    'members/student-nikodem': { role: 'child' },
    '_eduConnections/family': { scope: 'family' },
    '_eduConnections/parent-dominika': { envelope: 'old-dominika' },
    '_eduConnections/parent-sebastian': { envelope: 'old-sebastian' },
    [`_eduConnections/${childId}`]: { scope: 'student' },
    '_eduConnections/student-nikodem': { envelope: 'not-a-parent-session' },
    '_eduConnectLocks/parent-dominika': { id: 'old-in-flight', attempts: 3, windowStarted: 123, expiresAt: Timestamp.fromMillis(Date.now() + 60000) },
    '_eduConnectLocks/family': { id: 'shared-lock', attempts: 1 },
  });
  assert.deepEqual(await retireLegacyParentConnections(family(fixture)), { retired: 2 });
  assert.ok(fixture.records.has('_eduConnections/family'));
  assert.ok(fixture.records.has(`_eduConnections/${childId}`));
  assert.ok(fixture.records.has('_eduConnections/student-nikodem'));
  assert.equal(fixture.records.has('_eduConnections/parent-dominika'), false);
  assert.equal(fixture.records.has('_eduConnections/parent-sebastian'), false);
  const lock = fixture.records.get('_eduConnectLocks/parent-dominika');
  assert.notEqual(lock.id, 'old-in-flight');
  assert.equal(lock.expiresAt.toMillis(), 0);
  assert.equal(lock.attempts, 3);
  assert.equal(lock.windowStarted, 123);
  assert.equal(fixture.records.get('_eduConnectLocks/family').id, 'shared-lock');
  await assert.rejects(retireLegacyParentConnections(student(fixture)), { code: 'EDU_PARENT_REQUIRED' });
});

test('scheduled interval is enforced atomically without changing the manual five-minute limit', async () => withEncryption(async () => {
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context);
  fixture.records.get('_eduConnections/family').lastSuccessfulSyncAt = Timestamp.fromMillis(Date.now() - 7 * 60000);
  await assert.rejects(acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: 10 * 60000 }), { code: 'EDU_SYNC_COOLDOWN' });
  await assert.rejects(acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: 60 * 60000 }), { code: 'EDU_SYNC_COOLDOWN' });
  const manual = await acquireSyncLease('family', context);
  assert.ok(manual.leaseId);
  await releaseSyncLease('family', manual.leaseId, { success: false }, context);
}));

test('failed scheduled attempts also enforce the hourly gate and cannot relax it with an invalid interval', async () => withEncryption(async () => {
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context);
  fixture.records.get('_eduConnections/family').lastSyncAttemptAt = Timestamp.fromMillis(Date.now() - 59 * 60000);
  await assert.rejects(acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: 60 * 60000 }), { code: 'EDU_SYNC_COOLDOWN' });
  await assert.rejects(acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: 1 }), { code: 'EDU_INVALID_REQUEST' });
  fixture.records.get('_eduConnections/family').lastSyncAttemptAt = Timestamp.fromMillis(Date.now() - 60 * 60000 - 100);
  assert.ok((await acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: 60 * 60000 })).leaseId);
}));

test('expired sessions keep only a safe reconnect marker and retain school history and successful sync metadata', async () => withEncryption(async () => {
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context);
  const stored = fixture.records.get('_eduConnections/family');
  stored.expiresAt = Timestamp.fromMillis(Date.now() - 1000);
  stored.lastSuccessfulSyncAt = Timestamp.fromMillis(Date.now() - 2 * 3600000);
  fixture.records.set('schoolItems/history', { title: 'Unchanged school history' });
  const status = await getConnectionStatus('family', context);
  assert.equal(status.state, 'expired'); assert.equal(status.lastErrorCode, 'EDU_SESSION_EXPIRED');
  const marker = fixture.records.get('_eduConnections/family');
  assert.equal(marker.reconnectRequired, true); assert.equal(marker.envelope, undefined);
  assert.ok(marker.lastSuccessfulSyncAt); assert.ok(marker.selectedStudent);
  assert.ok(fixture.records.has('schoolItems/history'));
  assert.equal((await getConnectionStatus('family', context)).state, 'expired');
}));

test('an expired observation cannot invalidate a newer reconnect or a still-valid session without its lease', async () => withEncryption(async () => {
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context);
  const oldVersion = fixture.records.get('_eduConnections/family').sessionVersion;
  await connectAndSelect(context);
  const current = fixture.records.get('_eduConnections/family');
  assert.equal(await markConnectionNeedsReconnect('family', { sessionVersion: oldVersion }, context), false);
  assert.equal(await markConnectionNeedsReconnect('family', { sessionVersion: current.sessionVersion, errorCode: 'EDU_SESSION_INVALID' }, context), false);
  assert.ok(fixture.records.get('_eduConnections/family').envelope);
  assert.equal((await getConnectionStatus('family', context)).state, 'connected');
}));

test('the shared sync service retires a provider-rejected session while holding its existing lease', async () => withEncryption(async () => {
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context);
  let reads = 0;
  await assert.rejects(syncAction(context, {}, { readData: async session => {
    reads += 1; assert.equal(session.cookieJar, 'private-session-cookie');
    throw new EduServerError('EDU_SESSION_EXPIRED', 401, 'Safe provider expiry');
  } }), { code: 'EDU_SESSION_EXPIRED' });
  const marker = fixture.records.get('_eduConnections/family');
  assert.equal(reads, 1); assert.equal(marker.reconnectRequired, true);
  assert.equal(marker.lastErrorCode, 'EDU_SESSION_EXPIRED');
  assert.equal(marker.envelope, undefined); assert.equal(marker.lease, undefined);
  await assert.rejects(syncAction(context, {}, { readData: async () => { reads += 1; } }), { code: 'EDU_NOT_CONNECTED' });
  assert.equal(reads, 1);
}));

test('a wrong Functions key fails decryption without destroying a valid encrypted Vercel session', async () => withEncryption(async () => {
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context);
  const original = process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64;
  const envelope = fixture.records.get('_eduConnections/family').envelope;
  process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString('base64');
  let reads = 0;
  try {
    await assert.rejects(syncAction(context, {}, { readData: async () => { reads += 1; } }), { code: 'EDU_SESSION_INVALID' });
  } finally { process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = original; }
  assert.equal(reads, 0);
  const current = fixture.records.get('_eduConnections/family');
  assert.deepEqual(current.envelope, envelope); assert.equal(current.reconnectRequired, undefined);
  assert.equal(decryptSession(current.envelope, { uid: 'family' }).cookieJar, 'private-session-cookie');
}));

test('scheduled cadence counts prior starts so provider duration does not skip every second cron slot', async () => withEncryption(async () => {
  for (const interval of [10 * 60000, 60 * 60000]) {
    const fixture = databaseFixture(); const context = family(fixture);
    await connectAndSelect(context);
    const connection = fixture.records.get('_eduConnections/family');
    connection.lastSyncAttemptAt = Timestamp.fromMillis(Date.now() - interval - 100);
    connection.lastSuccessfulSyncAt = Timestamp.fromMillis(Date.now() - interval + 30000);
    assert.ok((await acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: interval })).leaseId);
  }
}));

test('the shared lease atomically claims both jittered school slots and rejects repeated or older slots', async t => withEncryption(async () => {
  let now = Date.parse('2026-10-05T08:00:05+02:00');
  t.mock.method(Date, 'now', () => now);
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context);
  const slot = time => ({ ...context, scheduledSyncIntervalMs: 10 * 60000,
    scheduledSchoolSlotStartMs: Date.parse(time) });
  const firstContext = slot('2026-10-05T08:00:00+02:00');
  const first = await acquireSyncLease('family', firstContext);
  const stored = fixture.records.get('_eduConnections/family');
  assert.equal(stored.lease.id, first.leaseId);
  assert.equal(stored.lastScheduledSchoolSlotAt.toMillis(), firstContext.scheduledSchoolSlotStartMs);
  assert.equal(stored.lastSyncAttemptAt.toMillis(), now);
  await releaseSyncLease('family', first.leaseId, { success: true }, context);
  now = Date.parse('2026-10-05T08:10:01+02:00');
  const secondContext = slot('2026-10-05T08:10:00+02:00');
  const second = await acquireSyncLease('family', secondContext);
  assert.equal(stored.lastSyncAttemptAt.toMillis(), Date.parse('2026-10-05T08:00:05+02:00'));
  assert.equal(fixture.records.get('_eduConnections/family').lastScheduledSchoolSlotAt.toMillis(), secondContext.scheduledSchoolSlotStartMs);
  await releaseSyncLease('family', second.leaseId, { success: false }, context);
  now = Date.parse('2026-10-05T08:20:15+02:00');
  const writes = fixture.writes;
  for (const retryContext of [firstContext, secondContext]) {
    await assert.rejects(acquireSyncLease('family', retryContext), { code: 'EDU_SYNC_COOLDOWN' });
  }
  assert.equal(fixture.writes, writes);
}));

test('a completed manual attempt consumes its school slot even after the usual cooldown has elapsed', async t => withEncryption(async () => {
  let now = Date.parse('2026-10-05T08:00:05+02:00');
  t.mock.method(Date, 'now', () => now);
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context);
  const manual = await acquireSyncLease('family', context);
  await releaseSyncLease('family', manual.leaseId, { success: true }, context);
  assert.equal(fixture.records.get('_eduConnections/family').lastScheduledSchoolSlotAt, undefined);
  now = Date.parse('2026-10-05T08:10:01+02:00');
  await assert.rejects(acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: 10 * 60000,
    scheduledSchoolSlotStartMs: Date.parse('2026-10-05T08:00:00+02:00') }), { code: 'EDU_SYNC_COOLDOWN' });
  assert.ok((await acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: 10 * 60000,
    scheduledSchoolSlotStartMs: Date.parse('2026-10-05T08:10:00+02:00') })).leaseId);
}));

test('invalid, future and off-hours school slots cannot bypass the shared synchronization gate', async t => withEncryption(async () => {
  let now = Date.parse('2026-10-05T08:00:05+02:00');
  t.mock.method(Date, 'now', () => now);
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context);
  const currentSlot = Date.parse('2026-10-05T08:00:00+02:00');
  for (const value of [null, NaN, Infinity, String(currentSlot), currentSlot + 1,
    Date.parse('2026-10-05T08:10:00+02:00'), Date.parse('2026-10-05T07:50:00+02:00')]) {
    await assert.rejects(acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: 10 * 60000,
      scheduledSchoolSlotStartMs: value }), { code: 'EDU_INVALID_REQUEST' });
  }
  for (const interval of [undefined, 60 * 60000]) {
    await assert.rejects(acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: interval,
      scheduledSchoolSlotStartMs: currentSlot }), { code: 'EDU_INVALID_REQUEST' });
  }
  now = Date.parse('2026-10-05T15:00:01+02:00');
  await assert.rejects(acquireSyncLease('family', { ...context, scheduledSyncIntervalMs: 10 * 60000,
    scheduledSchoolSlotStartMs: currentSlot }), { code: 'EDU_INVALID_REQUEST' });
  assert.equal(fixture.records.get('_eduConnections/family').lease, undefined);
  assert.equal(fixture.records.get('_eduConnections/family').lastScheduledSchoolSlotAt, undefined);
}));

test('changing the selected pupil clears only the previous pupil school-slot marker together with sync timestamps', async t => withEncryption(async () => {
  const now = Date.parse('2026-10-05T08:00:05+02:00');
  t.mock.method(Date, 'now', () => now);
  const fixture = databaseFixture(); const context = family(fixture);
  await connectAndSelect(context, [pupil, sibling]);
  const scheduledContext = { ...context, scheduledSyncIntervalMs: 10 * 60000,
    scheduledSchoolSlotStartMs: Date.parse('2026-10-05T08:00:00+02:00') };
  const lease = await acquireSyncLease('family', scheduledContext);
  await releaseSyncLease('family', lease.leaseId, { success: true }, context);
  await selectConnectionStudent('family', { profileId: pupil.id, personKey: 'Nikodem' }, context);
  assert.ok(fixture.records.get('_eduConnections/family').lastScheduledSchoolSlotAt);
  await selectConnectionStudent('family', { profileId: sibling.id, personKey: 'Paweł' }, context);
  const stored = fixture.records.get('_eduConnections/family');
  assert.equal(stored.lastScheduledSchoolSlotAt, undefined);
  assert.equal(stored.lastSyncAttemptAt, undefined);
  assert.equal(stored.lastSuccessfulSyncAt, undefined);
  assert.ok(stored.envelope);
  assert.ok((await acquireSyncLease('family', scheduledContext)).leaseId);
}));
