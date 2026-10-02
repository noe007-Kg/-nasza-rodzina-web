import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { deleteApp } from 'firebase-admin/app';
import { getServerFirebase } from '../server/edu-auth.mjs';
import { FAMILY_CONNECTION_ID, requireEduConnection, studentConnectionId } from '../server/edu-access.mjs';
import { createEduHandler } from '../server/edu-http.mjs';
import { disconnectAction, selectAction, statusAction } from '../server/edu-service.mjs';
import { decryptSession } from '../server/edu-secrets.mjs';
import { acquireSyncLease, disconnectConnection, getConnectionStatus, loadConnection, releaseSyncLease, saveConnection, selectConnectionStudent, updateConnectionSession, upsertSchoolItems } from '../server/edu-storage.mjs';

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
