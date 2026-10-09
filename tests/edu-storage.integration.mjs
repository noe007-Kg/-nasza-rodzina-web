import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { deleteApp } from 'firebase-admin/app';
import { CookieJar } from 'tough-cookie';
import { getServerFirebase } from '../server/edu-auth.mjs';
import { FAMILY_CONNECTION_ID, requireEduConnection, studentConnectionId } from '../server/edu-access.mjs';
import { createEduHandler } from '../server/edu-http.mjs';
import { disconnectAction, selectAction, statusAction, syncAction } from '../server/edu-service.mjs';
import { decryptSession } from '../server/edu-secrets.mjs';
import { acquireSyncLease, disconnectConnection, getConnectionStatus, loadConnection, releaseSyncLease, saveConnection, selectConnectionStudent, updateConnectionSession, upsertSchoolItems } from '../server/edu-storage.mjs';
import { schoolNotificationBaselineRef } from '../server/school-notifications.mjs';

// This suite must never fall back to a production Firebase project or identity.
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('edu storage integration requires local Auth/Firestore emulators.');
for (const key of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_BASE64', 'GOOGLE_APPLICATION_CREDENTIALS', 'VERCEL']) delete process.env[key];
process.env.FIREBASE_PROJECT_ID = 'demo-nasza-rodzina';
process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString('base64');
delete process.env.EDUVULCAN_SITE_ORIGIN;
const parentUid = 'edu-integration-parent';
const motherUid = 'edu-integration-mother';
const childUid = 'edu-integration-child';
const siblingUid = 'edu-integration-sibling';
const services = getServerFirebase();
const db = services.db;
const tokens = {};
const rowsCreated = new Set();
const profile = { id: 'integration-sp4', studentName: 'Uczeń testowy', schoolName: 'Testowa szkoła', schoolSymbol: 'SP4' };
const foreignProfile = { ...profile, id: 'integration-sibling', studentName: 'Drugi uczeń testowy' };
const session = { v: 1, cookieJar: { cookies: [{ key: 'synthetic-session', value: 'opaque-test-value' }] }, profiles: [profile] };

function confirmedSession(selectedProfile, value) {
  const jar = new CookieJar();
  jar.setCookieSync(`synthetic-renewal=${value}; Domain=.eduvulcan.pl; Path=/; Secure; HttpOnly`, 'https://eduvulcan.pl/');
  return { v: 1, cookieJar: jar.toJSON(), profiles: [selectedProfile], currentProfileId: selectedProfile.id,
    journal: { profileId: selectedProfile.id, key: 'synthetic-renewal-journal', idDziennik: 4009 } };
}

function request(uid, scope, method = 'GET', body = {}) {
  return { method, headers: {
    authorization: `Bearer ${tokens[uid]}`, host: 'rodzina.example', origin: 'https://rodzina.example',
    ...(scope ? { 'x-edu-connection-scope': scope } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
  }, ...(method === 'POST' ? { body } : {}) };
}

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.json = JSON.parse(body); } };
}

async function rememberImportedRows(profileId) {
  for (const collection of ['schoolItems', 'schoolParentMessages', 'schoolStudentMessages']) {
    const snapshot = await db.collection(collection).where('sourceProfileId', '==', profileId).get();
    for (const document of snapshot.docs) rowsCreated.add(`${collection}/${document.id}`);
  }
}

async function syncFixture(context, items, reconcileScopes = []) {
  const id = context.connection.id;
  await db.collection('_eduConnections').doc(id).update({ lastSuccessfulSyncAt: FieldValue.delete(), lastSyncAttemptAt: FieldValue.delete() });
  const lease = await acquireSyncLease(id, context);
  const connection = await loadConnection(id, context);
  await updateConnectionSession(id, connection.session, { leaseId: lease.leaseId, sessionVersion: connection.sessionVersion }, context);
  const result = await upsertSchoolItems(id, { personKey: 'Nikodem', profileId: profile.id, items, reconcileScopes,
    leaseId: lease.leaseId, sessionVersion: connection.sessionVersion }, context);
  await rememberImportedRows(profile.id);
  await releaseSyncLease(id, lease.leaseId, { success: true, counts: { grades: items.filter((item) => item.type === 'grade').length } }, context);
  return result;
}

async function clientRead(uid, document) {
  return fetch(`http://127.0.0.1:8080/v1/projects/demo-nasza-rodzina/databases/(default)/documents/${document.path}`, {
    headers: { Authorization: `Bearer ${tokens[uid]}` },
  });
}

before(async () => {
  await db.collection('_eduConnections').doc(FAMILY_CONNECTION_ID).delete();
  await db.collection('_eduConnectLocks').doc(FAMILY_CONNECTION_ID).delete();
  await db.collection('_eduStudentBindings').doc('Nikodem').delete();
  for (const [uid, member] of [
    [parentUid, { name: 'Sebastian Rodzic', role: 'parent' }],
    [motherUid, { name: 'Dominika Rodzic', role: 'parent' }],
    [childUid, { name: 'Nikodem', personKey: 'Nikodem', role: 'child' }],
    [siblingUid, { name: 'Paweł', personKey: 'Paweł', role: 'child' }],
  ]) {
    await services.auth.deleteUser(uid).catch(() => {});
    const email = `${uid}@example.test`;
    await services.auth.createUser({ uid, email, password: 'StorageTest!2026' });
    await db.collection('members').doc(uid).set({ ...member, active: true, canLogin: true });
    const signedIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-test-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'StorageTest!2026', returnSecureToken: true }),
    });
    const payload = await signedIn.json();
    if (!signedIn.ok || !payload.idToken) throw new Error('Local emulator sign-in failed.');
    tokens[uid] = payload.idToken;
  }
});

after(async () => {
  for (const key of rowsCreated) await db.doc(key).delete();
  for (const uid of [parentUid, motherUid, childUid, siblingUid]) {
    await services.auth.deleteUser(uid).catch(() => {});
    await db.collection('members').doc(uid).delete();
    for (const id of [uid, studentConnectionId(uid)]) {
      await db.collection('_eduConnections').doc(id).delete();
      await db.collection('_eduConnectLocks').doc(id).delete();
    }
  }
  await db.collection('_eduConnections').doc(FAMILY_CONNECTION_ID).delete();
  await db.collection('_eduConnectLocks').doc(FAMILY_CONNECTION_ID).delete();
  await db.collection('_eduStudentBindings').doc('Nikodem').delete();
  await deleteApp(services.app);
});

test('real parent tokens with full names share a family scope; child tokens cannot reach it', async () => {
  const calls = [];
  const handler = createEduHandler('GET', async (context) => { calls.push({ uid: context.uid, id: context.connection.id }); return { safe: true }; });
  for (const uid of [parentUid, motherUid]) {
    const allowed = response();
    await handler(request(uid), allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json.ok, true);
  }
  assert.deepEqual(calls, [{ uid: parentUid, id: FAMILY_CONNECTION_ID }, { uid: motherUid, id: FAMILY_CONNECTION_ID }]);
  for (const uid of [childUid, siblingUid]) {
    const blocked = response();
    await handler(request(uid), blocked);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json.error.code, 'EDU_PARENT_REQUIRED');
    assert.equal(blocked.headers['Cache-Control'], 'no-store, private, max-age=0');
  }
  assert.equal(calls.length, 2);
  const unapproved = response();
  await handler(request(childUid, 'student'), unapproved);
  assert.equal(unapproved.statusCode, 403);
  assert.equal(unapproved.json.error.code, 'EDU_STUDENT_LINK_REQUIRED');
});

test('one encrypted family connection shares selection, sync lock, cooldown, cached data and disconnection between parents', async () => {
  const father = await requireEduConnection(request(parentUid), services);
  const mother = await requireEduConnection(request(motherUid), services);
  const id = FAMILY_CONNECTION_ID;
  await saveConnection(id, { session, profiles: [profile], selectedStudent: null }, father);
  const stored = (await db.collection('_eduConnections').doc(id).get()).data();
  assert.ok(stored.envelope.ciphertext);
  assert.doesNotMatch(JSON.stringify(stored), /opaque-test-value|cookieJar/);
  assert.throws(() => decryptSession(stored.envelope, { uid: parentUid }), { code: 'EDU_SESSION_INVALID' });
  assert.throws(() => decryptSession(stored.envelope, { uid: studentConnectionId(childUid) }), { code: 'EDU_SESSION_INVALID' });
  assert.equal((await db.collection('_eduConnections').doc(parentUid).get()).exists, false);
  assert.equal((await db.collection('_eduConnections').doc(motherUid).get()).exists, false);
  for (const context of [father, mother]) {
    const status = (await statusAction(context)).status;
    assert.equal(status.state, 'needs_profile');
    assert.equal(status.scope, 'family');
    assert.equal(status.accountRole, 'parent');
    assert.ok(!('session' in status));
  }
  await selectAction(mother, { profileId: profile.id, personKey: 'Nikodem' });
  assert.deepEqual((await statusAction(father)).status.selectedStudent, { profileId: profile.id, personKey: 'Nikodem' });
  assert.equal((await db.collection('_eduStudentBindings').doc('Nikodem').get()).data().identity.studentName, profile.studentName);
  const lease = await acquireSyncLease(id, father);
  await assert.rejects(acquireSyncLease(id, mother), { code: 'EDU_SYNC_BUSY', status: 409 });
  await releaseSyncLease(id, lease.leaseId, { success: false }, father);

  const manual = db.collection('schoolItems').doc('edu-integration-manual');
  rowsCreated.add(manual.path);
  await manual.set({ person: 'Nikodem', type: 'grade', title: 'Ręcznie wpisana ocena', createdBy: parentUid });
  const oldGrade = { externalId: 'old-grade', providerScopeId: 'grades:period-1', type: 'grade', title: 'Pierwsza ocena', date: '2026-10-01' };
  const message = { externalId: 'message-1', type: 'message', title: 'Wiadomość rodzica', note: 'Pełna treść testowa', date: '2026-10-01' };
  const initial = await syncFixture(mother, [oldGrade, message]);
  assert.equal(initial.added, 2);
  assert.equal((await db.collection('schoolParentMessages').where('sourceProfileId', '==', profile.id).get()).size, 1);
  assert.equal((await db.collection('schoolItems').where('sourceProfileId', '==', profile.id).get()).size, 1);
  const sharedStatus = (await statusAction(father)).status;
  assert.equal(sharedStatus.state, 'connected');
  assert.ok(sharedStatus.lastSuccessAt);
  assert.deepEqual(sharedStatus, (await statusAction(mother)).status);
  await assert.rejects(acquireSyncLease(id, father), { code: 'EDU_SYNC_COOLDOWN', status: 429 });
  await syncFixture(father, []); // An unavailable section cannot prune its last snapshot.
  assert.equal((await db.collection('schoolItems').where('sourceProfileId', '==', profile.id).get()).size, 1);
  const replaced = await syncFixture(mother, [{ ...oldGrade, externalId: 'corrected-grade', title: 'Poprawiona ocena' }], [{ type: 'grade', scopeId: 'grades:period-1' }]);
  assert.equal(replaced.deleted, 1);
  const grades = await db.collection('schoolItems').where('sourceProfileId', '==', profile.id).get();
  assert.equal(grades.size, 1);
  assert.equal(grades.docs[0].data().title, 'Poprawiona ocena');
  assert.equal((await manual.get()).data().title, 'Ręcznie wpisana ocena');
  for (const uid of [parentUid, motherUid, childUid]) assert.equal((await clientRead(uid, grades.docs[0].ref)).status, 200);
  assert.equal((await clientRead(siblingUid, grades.docs[0].ref)).status, 403);
  const parentMessages = await db.collection('schoolParentMessages').where('sourceProfileId', '==', profile.id).get();
  for (const uid of [parentUid, motherUid]) assert.equal((await clientRead(uid, parentMessages.docs[0].ref)).status, 200);
  for (const uid of [childUid, siblingUid]) assert.equal((await clientRead(uid, parentMessages.docs[0].ref)).status, 403);
  await disconnectAction(father, {});
  assert.equal((await db.collection('_eduConnections').doc(id).get()).exists, false);
  assert.equal((await statusAction(mother)).status.state, 'disconnected');
  assert.equal((await grades.docs[0].ref.get()).exists, true);
});

test('future student scope filters profiles and refuses parent mailbox imports; private student rules remain owner-only', async () => {
  const student = await requireEduConnection(request(childUid, 'student'), services);
  const id = student.connection.id;
  await saveConnection(id, {
    session: { ...session, profiles: [profile, foreignProfile] }, profiles: [profile, foreignProfile], selectedStudent: null,
  }, student);
  const own = await loadConnection(id, student);
  assert.deepEqual(own.profiles.map((entry) => entry.id), [profile.id]);
  assert.deepEqual(own.session.profiles.map((entry) => entry.id), [profile.id]);
  assert.equal(own.scope, 'student');
  assert.equal(own.accountRole, 'student');
  await assert.rejects(selectConnectionStudent(id, { profileId: foreignProfile.id, personKey: 'Nikodem' }, student), { code: 'EDU_INVALID_STUDENT' });
  await assert.rejects(selectConnectionStudent(id, { profileId: profile.id, personKey: 'Paweł' }, student), { code: 'EDU_INVALID_STUDENT' });
  await selectConnectionStudent(id, { profileId: profile.id, personKey: 'Nikodem' }, student);
  await assert.rejects(syncFixture(student, [{ externalId: 'forbidden-parent-message', type: 'message', title: 'Nie importuj wiadomości rodzica' }]), { code: 'EDU_STUDENT_MESSAGES_UNAVAILABLE' });
  const heldLease = (await db.collection('_eduConnections').doc(id).get()).data().lease;
  await releaseSyncLease(id, heldLease.id, { success: false }, student);
  const result = await syncFixture(student, [{ externalId: 'student-own-grade', type: 'grade', title: 'Własna ocena ucznia', date: '2026-10-01' }]);
  assert.equal(result.added, 1);
  const parentMessages = await db.collection('schoolParentMessages').where('sourceProfileId', '==', profile.id).get();
  assert.equal(parentMessages.size, 1);
  assert.equal(parentMessages.docs[0].data().title, 'Wiadomość rodzica');
  assert.equal((await db.collection('schoolStudentMessages').where('sourceProfileId', '==', profile.id).get()).size, 0);
  // Reserved future mailbox authorization is checked separately from provider
  // imports: no student provider account role has been assumed or bypassed.
  const futureMessage = db.collection('schoolStudentMessages').doc('edu-integration-future-own-message');
  rowsCreated.add(futureMessage.path);
  await futureMessage.set({ person: 'Nikodem', type: 'message', title: 'Własna wiadomość testowa',
    source: 'eduvulcan', sourceOwnerUid: childUid, sourceConnectionId: id, sourceProfileId: profile.id });
  assert.equal((await clientRead(childUid, futureMessage)).status, 200);
  for (const uid of [siblingUid, parentUid, motherUid]) assert.equal((await clientRead(uid, futureMessage)).status, 403);
  const sibling = response();
  await createEduHandler('GET', statusAction)(request(siblingUid, 'student'), sibling);
  assert.equal(sibling.statusCode, 403);
  const forbiddenParent = response();
  await createEduHandler('GET', statusAction)(request(parentUid, 'student'), forbiddenParent);
  assert.equal(forbiddenParent.statusCode, 403);
  assert.equal(forbiddenParent.json.error.code, 'EDU_STUDENT_REQUIRED');
  await disconnectConnection(id, student);
  assert.equal((await getConnectionStatus(id, student)).state, 'disconnected');
});

test('a confirmed successful import atomically renews a short local expiry in real Firestore without changing the session version', async () => {
  const context = await requireEduConnection(request(parentUid), services);
  const id = context.connection.id;
  const selectedProfile = { ...profile, id: 'integration-confirmed-renewal-success' };
  const beforeRead = confirmedSession(selectedProfile, 'synthetic-before-success');
  const afterRead = confirmedSession(selectedProfile, 'synthetic-after-success');
  const connectionRef = db.collection('_eduConnections').doc(id);
  const baselineRef = schoolNotificationBaselineRef(db, id, selectedProfile.id, 'Nikodem');
  rowsCreated.add(baselineRef.path);
  await baselineRef.delete();
  await saveConnection(id, { session: beforeRead, profiles: [selectedProfile], selectedStudent: null }, context);
  await selectConnectionStudent(id, { profileId: selectedProfile.id, personKey: 'Nikodem' }, context);
  // This is only a short LOCAL fixture deadline. Passing expiresAt to connect
  // would mean a real provider deadline, which must never be extended past it.
  const shortExpiry = Timestamp.fromMillis(Date.now() + 15 * 60000);
  await connectionRef.update({ expiresAt: shortExpiry, lastSuccessfulSyncAt: FieldValue.delete(),
    lastSyncAttemptAt: FieldValue.delete(), lastScheduledSchoolSlotAt: FieldValue.delete() });
  const before = (await connectionRef.get()).data();
  let confirmedAt; let reads = 0;
  const result = await syncAction(context, {}, { readData: async (storedSession, profileId, options) => {
    reads += 1;
    assert.deepEqual(storedSession, beforeRead);
    assert.equal(profileId, selectedProfile.id);
    assert.equal(options.includeMessages, true);
    confirmedAt = Date.now();
    return { session: afterRead, sessionConfirmedAt: confirmedAt,
      items: [{ externalId: 'integration-renewal-grade-success', type: 'grade', title: '5', subject: 'Matematyka' }],
      counts: { grades: 1 }, warnings: [], notificationReadyTypes: ['grade'] };
  } });
  await rememberImportedRows(selectedProfile.id);
  const after = (await connectionRef.get()).data();
  assert.equal(reads, 1);
  assert.equal(after.sessionVersion, before.sessionVersion);
  assert.equal(after.expiresAt.toMillis(), confirmedAt + 24 * 3600000);
  assert.ok(after.expiresAt.toMillis() > shortExpiry.toMillis());
  assert.equal(after.sessionConfirmedAt.toMillis(), confirmedAt);
  assert.equal(after.lease, undefined);
  assert.equal(after.lastErrorCode, undefined);
  assert.ok(Number.isFinite(after.lastSuccessfulSyncAt.toMillis()));
  assert.deepEqual(decryptSession(after.envelope, { uid: id }), afterRead);
  assert.doesNotMatch(JSON.stringify(after), /synthetic-after-success|cookieJar/);
  assert.equal(result.status.expiresAt, new Date(confirmedAt + 24 * 3600000).toISOString());
  assert.equal(result.status.lastSuccessAt, after.lastSuccessfulSyncAt.toDate().toISOString());
  assert.equal(result.sync.added, 1);
  const baseline = await baselineRef.get();
  assert.equal(baseline.exists, true);
  assert.deepEqual(baseline.data().initializedTypes, ['grade']);
  assert.equal(baseline.data().profileId, selectedProfile.id);
  assert.ok(Number.isFinite(baseline.data().lastSuccessfulImportAt.toMillis()));
  const imported = await db.collection('schoolItems').where('sourceProfileId', '==', selectedProfile.id).get();
  assert.equal(imported.size, 1);
  assert.equal(imported.docs[0].data().sourceConnectionId, id);
  assert.equal(imported.docs[0].data().sourceRecordId, 'integration-renewal-grade-success');
});

test('a failed guarded import retains rotated encrypted cookies in real Firestore while leaving expiry, success time and baseline unchanged', async () => {
  const context = await requireEduConnection(request(motherUid), services);
  const id = context.connection.id;
  const selectedProfile = { ...profile, id: 'integration-confirmed-renewal-import-failure' };
  const beforeRead = confirmedSession(selectedProfile, 'synthetic-before-failure');
  const afterRead = confirmedSession(selectedProfile, 'synthetic-rotated-before-failed-import');
  const connectionRef = db.collection('_eduConnections').doc(id);
  const baselineRef = schoolNotificationBaselineRef(db, id, selectedProfile.id, 'Nikodem');
  rowsCreated.add(baselineRef.path);
  await baselineRef.delete();
  await saveConnection(id, { session: beforeRead, profiles: [selectedProfile], selectedStudent: null }, context);
  await selectConnectionStudent(id, { profileId: selectedProfile.id, personKey: 'Nikodem' }, context);
  const shortExpiry = Timestamp.fromMillis(Date.now() + 15 * 60000);
  const previousSuccess = Timestamp.fromMillis(Date.now() - 3600000);
  await connectionRef.update({ expiresAt: shortExpiry, lastSuccessfulSyncAt: previousSuccess,
    lastSyncAttemptAt: FieldValue.delete(), lastScheduledSchoolSlotAt: FieldValue.delete() });
  const before = (await connectionRef.get()).data();
  let reads = 0;
  await assert.rejects(syncAction(context, {}, { readData: async storedSession => {
    reads += 1;
    assert.deepEqual(storedSession, beforeRead);
    return { session: afterRead, sessionConfirmedAt: Date.now(),
      items: [{ externalId: 'integration-renewal-invalid-grade', type: 'grade', title: '' }],
      counts: { grades: 1 }, warnings: [], notificationReadyTypes: ['grade'] };
  } }), { code: 'EDU_INVALID_DATA' });
  const after = (await connectionRef.get()).data();
  assert.equal(reads, 1);
  assert.equal(after.sessionVersion, before.sessionVersion);
  assert.notDeepEqual(after.envelope, before.envelope);
  assert.deepEqual(decryptSession(after.envelope, { uid: id }), afterRead);
  assert.doesNotMatch(JSON.stringify(after), /synthetic-rotated-before-failed-import|cookieJar/);
  assert.equal(after.expiresAt.toMillis(), shortExpiry.toMillis());
  assert.equal(after.lastSuccessfulSyncAt.toMillis(), previousSuccess.toMillis());
  assert.equal(after.sessionConfirmedAt, undefined);
  assert.equal(after.lease, undefined);
  assert.equal(after.lastErrorCode, 'EDU_INVALID_DATA');
  assert.equal((await baselineRef.get()).exists, false);
  assert.equal((await db.collection('schoolItems').where('sourceProfileId', '==', selectedProfile.id).get()).size, 0);
});

test('a real dynamic student login requires the exact parent binding and keeps school records and mailboxes scoped', async () => {
  const uid = `edu-integration-dynamic-${randomBytes(8).toString('hex')}`;
  const personKey = `member-${createHash('sha256').update(uid).digest('hex').slice(0, 24)}`;
  const studentId = studentConnectionId(uid);
  const dynamicProfile = { id: `${uid}-sp4`, studentName: 'Dynamiczny uczeń testowy', schoolName: 'Dynamiczna szkoła testowa', schoolSymbol: 'DYN' };
  // The provider session is synthetic and contains neither a password nor a
  // real provider cookie. Authentication below uses only the guarded emulator.
  const syntheticSession = { v: 1, cookieJar: { cookies: [] }, profiles: [dynamicProfile, foreignProfile] };
  const memberRef = db.collection('members').doc(uid);
  const familyRef = db.collection('_eduConnections').doc(FAMILY_CONNECTION_ID);
  const studentRef = db.collection('_eduConnections').doc(studentId);
  const bindingRef = db.collection('_eduStudentBindings').doc(personKey);
  const baselineRefs = [FAMILY_CONNECTION_ID, studentId].map(id => schoolNotificationBaselineRef(db, id, dynamicProfile.id, personKey));
  // Restore the exact pre-test connection, including its original encrypted
  // envelope/lease metadata; do not reconnect or rewrite another fixture.
  const snapshots = await Promise.all([familyRef, studentRef, memberRef, bindingRef, ...baselineRefs].map(ref => ref.get()));
  const touched = new Set();
  let createdAuth = false;

  async function importDynamic(context, items) {
    const id = context.connection.id;
    await db.collection('_eduConnections').doc(id).update({ lastSuccessfulSyncAt: FieldValue.delete(), lastSyncAttemptAt: FieldValue.delete() });
    const lease = await acquireSyncLease(id, context);
    let success = false;
    try {
      const connection = await loadConnection(id, context);
      await updateConnectionSession(id, connection.session, { leaseId: lease.leaseId, sessionVersion: connection.sessionVersion }, context);
      touched.add(schoolNotificationBaselineRef(db, id, dynamicProfile.id, personKey).path);
      const result = await upsertSchoolItems(id, { personKey, profileId: dynamicProfile.id, items,
        leaseId: lease.leaseId, sessionVersion: connection.sessionVersion }, context);
      success = true;
      return result;
    } finally {
      await releaseSyncLease(id, lease.leaseId, { success }, context);
    }
  }

  try {
    const email = `${uid}@example.test`;
    await services.auth.createUser({ uid, email, password: 'StorageTest!2026' });
    createdAuth = true;
    touched.add(memberRef.path);
    await memberRef.set({ name: 'Dynamiczny uczeń', personKey, role: 'child', active: true, canLogin: true,
      schoolEnabled: true, archived: false, disabled: false });
    const signedIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-test-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'StorageTest!2026', returnSecureToken: true }),
    });
    const payload = await signedIn.json();
    if (!signedIn.ok || !payload.idToken) throw new Error('Local dynamic student emulator sign-in failed.');
    tokens[uid] = payload.idToken;
    await assert.rejects(requireEduConnection(request(uid, 'student'), services), { code: 'EDU_STUDENT_LINK_REQUIRED', status: 403 });

    const parent = await requireEduConnection(request(parentUid), services);
    assert.ok(parent.connection.allowedPersonKeys.includes(personKey));
    assert.equal(parent.connection.personProfileIds[personKey], uid);
    touched.add(familyRef.path);
    await saveConnection(FAMILY_CONNECTION_ID, { session: syntheticSession, profiles: syntheticSession.profiles, selectedStudent: null }, parent);
    touched.add(bindingRef.path);
    await selectConnectionStudent(FAMILY_CONNECTION_ID, { profileId: dynamicProfile.id, personKey }, parent);
    const approvedBinding = (await bindingRef.get()).data();
    assert.deepEqual(approvedBinding.identity, { studentName: dynamicProfile.studentName, schoolName: dynamicProfile.schoolName, schoolSymbol: dynamicProfile.schoolSymbol });
    assert.equal(approvedBinding.establishedByUid, parentUid);
    const grade = { externalId: 'dynamic-grade', type: 'grade', title: 'Dynamiczna ocena', date: '2026-10-01' };
    const parentMessage = { externalId: 'dynamic-parent-message', type: 'message', title: 'Wiadomość wyłącznie rodzica', note: 'Syntetyczna prywatna treść', date: '2026-10-01' };
    assert.equal((await importDynamic(parent, [grade, parentMessage])).added, 2);

    const student = await requireEduConnection(request(uid, 'student'), services);
    assert.deepEqual(student.connection.allowedPersonKeys, [personKey]);
    assert.deepEqual({ ...student.connection.personProfileIds }, { [personKey]: uid });
    assert.deepEqual(student.connection.allowedStudentIdentity, approvedBinding.identity);
    touched.add(studentRef.path);
    await saveConnection(studentId, { session: syntheticSession, profiles: syntheticSession.profiles, selectedStudent: null }, student);
    const ownConnection = await loadConnection(studentId, student);
    assert.deepEqual(ownConnection.profiles.map(entry => entry.id), [dynamicProfile.id]);
    assert.deepEqual(ownConnection.session.profiles.map(entry => entry.id), [dynamicProfile.id]);
    await assert.rejects(selectConnectionStudent(studentId, { profileId: foreignProfile.id, personKey }, student), { code: 'EDU_INVALID_STUDENT' });
    await assert.rejects(selectConnectionStudent(studentId, { profileId: dynamicProfile.id, personKey: 'Paweł' }, student), { code: 'EDU_INVALID_STUDENT' });
    await selectConnectionStudent(studentId, { profileId: dynamicProfile.id, personKey }, student);
    // The same provider record is isolated by the personal connection namespace.
    assert.equal((await importDynamic(student, [grade])).added, 1);
    for (const ref of baselineRefs) assert.equal((await ref.get()).exists, true);
    const grades = await db.collection('schoolItems').where('sourceProfileId', '==', dynamicProfile.id).get();
    assert.equal(grades.size, 2);
    assert.deepEqual(grades.docs.map(doc => doc.data().sourceConnectionScope).sort(), ['family', 'student']);
    const ownGrade = grades.docs.find(doc => doc.data().sourceConnectionId === studentId);
    assert.equal(ownGrade.data().person, personKey);
    assert.equal(ownGrade.data().sourceOwnerUid, uid);
    for (const document of grades.docs) {
      for (const actor of [uid, parentUid, motherUid]) assert.equal((await clientRead(actor, document.ref)).status, 200);
      for (const actor of [childUid, siblingUid]) assert.equal((await clientRead(actor, document.ref)).status, 403);
    }
    const legacyGrades = await db.collection('schoolItems').where('sourceProfileId', '==', profile.id).get();
    assert.ok(legacyGrades.size > 0);
    for (const document of legacyGrades.docs) assert.equal((await clientRead(uid, document.ref)).status, 403);
    const messages = await db.collection('schoolParentMessages').where('sourceProfileId', '==', dynamicProfile.id).get();
    assert.equal(messages.size, 1);
    for (const actor of [parentUid, motherUid]) assert.equal((await clientRead(actor, messages.docs[0].ref)).status, 200);
    for (const actor of [uid, childUid, siblingUid]) assert.equal((await clientRead(actor, messages.docs[0].ref)).status, 403);
    await assert.rejects(importDynamic(student, [parentMessage]), { code: 'EDU_STUDENT_MESSAGES_UNAVAILABLE' });
    assert.equal((await messages.docs[0].ref.get()).data().note, parentMessage.note);
    assert.equal((await db.collection('schoolStudentMessages').where('sourceProfileId', '==', dynamicProfile.id).get()).size, 0);

    // A once-valid context cannot acquire a lease after its exact identity
    // binding changes; this checks a fresh transactional read, not UI filtering.
    await studentRef.update({ lastSuccessfulSyncAt: FieldValue.delete(), lastSyncAttemptAt: FieldValue.delete() });
    try {
      await bindingRef.update({ identity: { studentName: foreignProfile.studentName, schoolName: foreignProfile.schoolName, schoolSymbol: foreignProfile.schoolSymbol } });
      await assert.rejects(acquireSyncLease(studentId, student), { code: 'EDU_STUDENT_ACCESS_REQUIRED', status: 403 });
      assert.equal((await studentRef.get()).data().lease, undefined);
    } finally {
      await bindingRef.set(approvedBinding);
    }
  } finally {
    // Only this unique source is removed. Existing school fixtures, bindings,
    // family metadata and notification history are never globally deleted.
    const cleanup = ['schoolItems', 'schoolParentMessages', 'schoolStudentMessages'].map(async collection => {
      const snapshot = await db.collection(collection).where('sourceProfileId', '==', dynamicProfile.id).get();
      await Promise.all(snapshot.docs.map(document => document.ref.delete()));
    });
    for (const snapshot of snapshots) {
      if (touched.has(snapshot.ref.path)) cleanup.push(snapshot.exists ? snapshot.ref.set(snapshot.data()) : snapshot.ref.delete());
    }
    if (createdAuth) cleanup.push(services.auth.deleteUser(uid));
    const results = await Promise.allSettled(cleanup);
    delete tokens[uid];
    assert.equal(results.filter(result => result.status === 'rejected').length, 0, 'Dynamic student fixture cleanup must restore every owned local reference.');
    const restoredFamily = await familyRef.get();
    assert.equal(restoredFamily.exists, snapshots[0].exists);
    if (snapshots[0].exists) assert.deepEqual(restoredFamily.data(), snapshots[0].data());
  }
});
