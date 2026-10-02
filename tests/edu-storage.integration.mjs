import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { deleteApp } from 'firebase-admin/app';
import { getServerFirebase, requireParent } from '../server/edu-auth.mjs';
import { createEduHandler } from '../server/edu-http.mjs';
import { acquireSyncLease, disconnectConnection, getConnectionStatus, loadConnection, releaseSyncLease, saveConnection, selectConnectionStudent, updateConnectionSession, upsertSchoolItems } from '../server/edu-storage.mjs';

// This suite must never fall back to a production Firebase project or identity.
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('edu storage integration requires local Auth/Firestore emulators.');
for (const key of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_BASE64', 'GOOGLE_APPLICATION_CREDENTIALS', 'VERCEL']) delete process.env[key];
process.env.FIREBASE_PROJECT_ID = 'demo-nasza-rodzina';
process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString('base64');
delete process.env.EDUVULCAN_SITE_ORIGIN;
const parentUid = 'edu-integration-parent'; const childUid = 'edu-integration-child';
const services = getServerFirebase();
const db = services.db; const tokens = {};
const rowsCreated = new Set();
const profile = { id: 'integration-sp4', studentName: 'Uczeń testowy', schoolName: 'Testowa szkoła', schoolSymbol: 'SP4' };
const session = { v: 1, cookieJar: { cookies: [{ key: 'synthetic-session', value: 'opaque-test-value' }] } };

before(async () => {
  for (const [uid, personKey, role] of [[parentUid, 'Sebastian', 'parent'], [childUid, 'Nikodem', 'child']]) {
    await services.auth.deleteUser(uid).catch(() => {});
    const email = `${uid}@example.test`;
    await services.auth.createUser({ uid, email, password: 'StorageTest!2026' });
    await db.collection('members').doc(uid).set({ name: personKey, personKey, role, active: true, canLogin: true });
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-test-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'StorageTest!2026', returnSecureToken: true }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.idToken) throw new Error('Local emulator sign-in failed.');
    tokens[uid] = payload.idToken;
  }
});

after(async () => {
  for (const key of rowsCreated) { const [collection, id] = key.split('/'); await db.collection(collection).doc(id).delete(); }
  for (const uid of [parentUid, childUid]) {
    await services.auth.deleteUser(uid).catch(() => {});
    await db.collection('members').doc(uid).delete();
    await db.collection('_eduConnections').doc(uid).delete();
    await db.collection('_eduConnectLocks').doc(uid).delete();
  }
  await deleteApp(services.app);
});

test('real Firebase parent token can use handler; real child token cannot reach action', async () => {
  let calls = 0;
  const handler = createEduHandler('GET', async () => { calls += 1; return { safe: true }; });
  function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.json = JSON.parse(body); } }; }
  const allowed = response();
  await handler({ method: 'GET', headers: { authorization: `Bearer ${tokens[parentUid]}`, host: 'rodzina.example', origin: 'https://rodzina.example' } }, allowed);
  assert.equal(allowed.statusCode, 200); assert.equal(calls, 1); assert.equal(allowed.json.ok, true);
  const blocked = response();
  await handler({ method: 'GET', headers: { authorization: `Bearer ${tokens[childUid]}`, host: 'rodzina.example', origin: 'https://rodzina.example' } }, blocked);
  assert.equal(blocked.statusCode, 403); assert.equal(calls, 1); assert.equal(blocked.json.error.code, 'EDU_PARENT_REQUIRED');
  assert.equal(blocked.headers['Cache-Control'], 'no-store, private, max-age=0');
});

test('encrypted connection and actual Firestore transactions reconcile only a successful full school scope', async () => {
  await saveConnection(parentUid, { session, profiles: [profile], selectedStudent: null }, services);
  const stored = (await db.collection('_eduConnections').doc(parentUid).get()).data();
  assert.ok(stored.envelope.ciphertext); assert.doesNotMatch(JSON.stringify(stored), /opaque-test-value|cookieJar/);
  const status = await getConnectionStatus(parentUid, services);
  assert.equal(status.state, 'needs_profile'); assert.ok(!('session' in status));
  await selectConnectionStudent(parentUid, { profileId: profile.id, personKey: 'Nikodem' }, services);
  const manual = db.collection('schoolItems').doc('edu-integration-manual'); rowsCreated.add(`schoolItems/${manual.id}`);
  await manual.set({ person: 'Nikodem', type: 'grade', title: 'Ręcznie wpisana ocena', createdBy: parentUid });

  async function sync(items, reconcileScopes = []) {
    await db.collection('_eduConnections').doc(parentUid).update({ lastSuccessfulSyncAt: FieldValue.delete(), lastSyncAttemptAt: FieldValue.delete() });
    const lease = await acquireSyncLease(parentUid, services);
    const connection = await loadConnection(parentUid, services);
    await updateConnectionSession(parentUid, connection.session, { leaseId: lease.leaseId, sessionVersion: connection.sessionVersion }, services);
    const result = await upsertSchoolItems(parentUid, { personKey: 'Nikodem', profileId: profile.id, items, reconcileScopes,
      leaseId: lease.leaseId, sessionVersion: connection.sessionVersion }, services);
    for (const collection of ['schoolItems', 'schoolParentMessages']) {
      const snapshot = await db.collection(collection).where('sourceProfileId', '==', profile.id).get();
      for (const document of snapshot.docs) rowsCreated.add(`${collection}/${document.id}`);
    }
    await releaseSyncLease(parentUid, lease.leaseId, { success: true, counts: { grades: items.filter((item) => item.type === 'grade').length } }, services);
    return result;
  }
  const oldGrade = { externalId: 'old-grade', providerScopeId: 'grades:period-1', type: 'grade', title: 'Pierwsza ocena', date: '2026-10-01' };
  const message = { externalId: 'message-1', type: 'message', title: 'Wiadomość rodzica', note: 'Pełna treść testowa', date: '2026-10-01' };
  const initial = await sync([oldGrade, message]); assert.equal(initial.added, 2);
  assert.equal((await db.collection('schoolParentMessages').where('sourceProfileId', '==', profile.id).get()).size, 1);
  assert.equal((await db.collection('schoolItems').where('sourceProfileId', '==', profile.id).get()).size, 1);
  await sync([]); // A failed or unavailable section cannot prune its last snapshot.
  assert.equal((await db.collection('schoolItems').where('sourceProfileId', '==', profile.id).get()).size, 1);
  const replaced = await sync([{ ...oldGrade, externalId: 'corrected-grade', title: 'Poprawiona ocena' }], [{ type: 'grade', scopeId: 'grades:period-1' }]);
  assert.equal(replaced.deleted, 1);
  const grades = await db.collection('schoolItems').where('sourceProfileId', '==', profile.id).get();
  assert.equal(grades.size, 1); assert.equal(grades.docs[0].data().title, 'Poprawiona ocena');
  assert.equal((await manual.get()).data().title, 'Ręcznie wpisana ocena');
  await disconnectConnection(parentUid, services);
  assert.equal((await db.collection('_eduConnections').doc(parentUid).get()).exists, false);
  assert.equal((await grades.docs[0].ref.get()).exists, true);
});
