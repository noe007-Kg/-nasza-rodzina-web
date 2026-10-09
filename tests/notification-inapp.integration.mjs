import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { deleteApp } from 'firebase-admin/app';
import { getServerFirebase } from '../server/edu-auth.mjs';
import { acquireSyncLease, loadConnection, releaseSyncLease, saveConnection, selectConnectionStudent, upsertSchoolItems } from '../server/edu-storage.mjs';
import { flushSchoolNotifications, schoolNotificationBaselineRef } from '../server/school-notifications.mjs';

// Refuse every remote project/credential. All identities and provider records
// below are synthetic and exist only inside the explicitly selected emulators.
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
  || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('IN-APP integration requires local Auth and Firestore emulators.');
}
for (const key of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_BASE64', 'GOOGLE_APPLICATION_CREDENTIALS', 'VERCEL']) delete process.env[key];
process.env.FIREBASE_PROJECT_ID = 'demo-nasza-rodzina';
process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString('base64');
const services = getServerFirebase();
const { db } = services;
const parentUid = 'inapp-integration-parent';
const motherUid = 'inapp-integration-mother';
const childUid = 'inapp-integration-child';
const archivedUid = 'inapp-integration-archived';
const profile = { id: 'inapp-integration-sp4', studentName: 'Testowy uczeń', schoolName: 'Szkoła testowa', schoolSymbol: 'SP4' };
const context = {
  ...services, uid: parentUid, profile: { role: 'parent', active: true, canLogin: true },
  connection: { id: 'family', scope: 'family', accountRole: 'parent', actorUid: parentUid, allowedPersonKeys: ['Nikodem'], personProfileIds: { Nikodem: childUid } },
};
const session = { v: 1, cookieJar: { cookies: [] }, profiles: [profile] };
const row = (type, externalId, title) => ({ type, externalId, title, date: '2026-10-03', subject: 'Przedmiot testowy' });
const history = Array.from({ length: 20 }, (_, index) => row('grade', `history-${index}`, `Ocena historyczna ${index}`));
const inbox = uid => db.collection('notificationInbox').doc(uid).collection('items');
const tokens = new Map();

async function clientRead(uid, path) {
  const response = await fetch(`http://127.0.0.1:8080/v1/projects/demo-nasza-rodzina/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${tokens.get(uid)}` },
  });
  return response.status;
}
async function importAndNotify(items, notificationReadyTypes, reconcileScopes = []) {
  // The production cooldown is unchanged; reset only synthetic fixture clocks
  // so this suite can exercise successive imports without waiting five minutes.
  await db.doc('_eduConnections/family').update({ lastSuccessfulSyncAt: FieldValue.delete(), lastSyncAttemptAt: FieldValue.delete() });
  const lease = await acquireSyncLease('family', context);
  const connection = await loadConnection('family', context);
  const saved = await upsertSchoolItems('family', {
    profileId: profile.id, personKey: 'Nikodem', items, reconcileScopes,
    leaseId: lease.leaseId, sessionVersion: connection.sessionVersion,
    ...(notificationReadyTypes ? { notificationReadyTypes } : {}),
  }, context);
  await releaseSyncLease('family', lease.leaseId, { success: true }, context);
  return { saved, notifications: await flushSchoolNotifications(context) };
}
before(async () => {
  for (const [uid, role, active] of [[parentUid, 'parent', true], [motherUid, 'parent', true], [childUid, 'child', true], [archivedUid, 'parent', false]]) {
    const email = `${uid}@example.test`;
    await services.auth.deleteUser(uid).catch(() => {});
    await services.auth.createUser({ uid, email, password: 'InAppEmulator!2026' });
    await db.doc(`members/${uid}`).set({ name: role === 'child' ? 'Nikodem' : uid, personKey: role === 'child' ? 'Nikodem' : uid, role, active, canLogin: active });
    const signed = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-inapp-test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'InAppEmulator!2026', returnSecureToken: true }),
    });
    assert.equal(signed.status, 200);
    tokens.set(uid, (await signed.json()).idToken);
  }
  await saveConnection('family', { session, profiles: [profile], selectedStudent: null }, context);
  await selectConnectionStudent('family', { profileId: profile.id, personKey: 'Nikodem' }, context);
});
after(async () => {
  for (const name of ['schoolItems', 'schoolParentMessages']) {
    const rows = await db.collection(name).where('sourceProfileId', '==', profile.id).get();
    for (const document of rows.docs) await document.ref.delete();
  }
  for (const uid of [parentUid, motherUid, childUid, archivedUid]) {
    await db.recursiveDelete(db.doc(`notificationInbox/${uid}`));
    await db.doc(`members/${uid}`).delete();
    await db.doc(`userPreferences/${uid}`).delete();
    await services.auth.deleteUser(uid).catch(() => {});
  }
  await schoolNotificationBaselineRef(db, 'family', profile.id, 'Nikodem').delete();
  await db.doc('_eduConnections/family').delete();
  await db.doc('_eduStudentBindings/Nikodem').delete();
  await deleteApp(services.app);
});

test('real guarded school import creates baseline, semantic parent inbox alerts and no Functions/outbox', async () => {
  const first = await importAndNotify(history);
  assert.equal(first.saved.total, 20);
  assert.equal(first.notifications.created, 0);
  assert.equal((await inbox(parentUid).get()).size, 0);
  assert.equal((await inbox(motherUid).get()).size, 0);
  assert.equal((await schoolNotificationBaselineRef(db, 'family', profile.id, 'Nikodem').get()).exists, true);

  const newGrade = row('grade', 'new-grade', 'Nowa ocena testowa');
  const second = await importAndNotify([...history, newGrade]);
  assert.equal(second.notifications.created, 3); // Two parents and the pupil's own grade.
  for (const uid of [parentUid, motherUid]) {
    const values = await inbox(uid).get();
    assert.equal(values.size, 1);
    assert.match(values.docs[0].data().eventId, /^school:grade:/);
    assert.equal(values.docs[0].data().read, false);
    assert.equal(await clientRead(uid, values.docs[0].ref.path), 200);
  }
  assert.equal((await inbox(childUid).get()).size, 1);
  assert.equal((await inbox(archivedUid).get()).size, 0);

  const identical = await importAndNotify([...history, newGrade]);
  assert.equal(identical.notifications.created, 0);
  assert.equal((await inbox(parentUid).get()).size, 1);

  const changedGrade = { ...newGrade, title: 'Poprawiona ocena testowa' };
  assert.equal((await importAndNotify([...history, changedGrade])).notifications.created, 3);
  assert.equal((await importAndNotify([...history, changedGrade])).notifications.created, 0);

  const message = { ...row('message', 'new-message', 'Wiadomość nauczyciela'), sender: 'Nauczyciel testowy', note: 'Poufna treść rodzic-nauczyciel', read: false };
  assert.equal((await importAndNotify([...history, changedGrade, message])).notifications.created, 2);
  const parentValues = await inbox(parentUid).get();
  const teacherAlert = parentValues.docs.find(document => document.data().eventId.startsWith('school:message:'));
  assert.ok(teacherAlert);
  assert.equal(parentValues.size, 3);
  assert.ok(!JSON.stringify(teacherAlert.data()).includes('Poufna treść'));
  assert.equal(await clientRead(childUid, teacherAlert.ref.path), 403);
  const childValues = await inbox(childUid).get();
  assert.equal(childValues.size, 2);
  assert.ok(childValues.docs.every(document => !document.data().eventId.startsWith('school:message:')));
  // A provider read receipt and refreshed sync metadata are not new messages.
  assert.equal((await importAndNotify([...history, changedGrade, { ...message, read: true }])).notifications.created, 0);
  assert.equal((await db.collection('_notificationOutbox').get()).size, 0);
  assert.equal((await db.collection('_notificationDevices').get()).size, 0);
});

test('partial successful import does not turn a later recovered grade history into old alerts', async () => {
  await schoolNotificationBaselineRef(db, 'family', profile.id, 'Nikodem').delete();
  const lesson = { ...row('lesson', 'partial-lesson', 'Lekcja testowa'), time: '08:00', endTime: '08:45' };
  assert.equal((await importAndNotify([lesson], ['lesson'])).notifications.created, 0);
  const recovered = Array.from({ length: 10 }, (_, index) => row('grade', `recovered-grade-${index}`, `Historia po odzyskaniu sekcji ${index}`));
  assert.equal((await importAndNotify([lesson, ...recovered], ['lesson', 'grade'])).notifications.created, 0);
  const baseline = (await schoolNotificationBaselineRef(db, 'family', profile.id, 'Nikodem').get()).data();
  assert.ok(baseline.initializedTypes.includes('grade'));
  const next = row('grade', 'after-recovered-grade', 'Nowa ocena po odzyskaniu sekcji');
  assert.equal((await importAndNotify([lesson, ...recovered, next], ['lesson', 'grade'])).notifications.created, 3);
  assert.equal((await importAndNotify([lesson, ...recovered, next], ['lesson', 'grade'])).notifications.created, 0);
});

test('a verified empty grade section establishes its baseline and preserves the next genuinely new alert', async () => {
  await schoolNotificationBaselineRef(db, 'family', profile.id, 'Nikodem').delete();
  assert.equal((await importAndNotify([], ['grade'])).notifications.created, 0);
  const baseline = (await schoolNotificationBaselineRef(db, 'family', profile.id, 'Nikodem').get()).data();
  assert.ok(baseline.initializedTypes.includes('grade'));
  const grade = row('grade', 'first-after-empty-section', 'Pierwsza nowa ocena po pustej sekcji');
  assert.equal((await importAndNotify([grade], ['grade'])).notifications.created, 3);
  assert.equal((await importAndNotify([grade], ['grade'])).notifications.created, 0);
});

test('moving the fetched timetable window is quiet; an actual new lesson inside the known window alerts once', async () => {
  await schoolNotificationBaselineRef(db, 'family', profile.id, 'Nikodem').delete();
  const lesson = (externalId, date) => ({ ...row('lesson', externalId, 'Lekcja w sprawdzanym oknie'), date,
    time: '08:00', endTime: '08:45', providerScopeId: 'timetable' });
  const first = lesson('window-first', '2026-10-05');
  const original = [{ type: 'lesson', scopeId: 'timetable', dateFrom: '2026-10-01', dateTo: '2026-10-21' }];
  assert.equal((await importAndNotify([first], ['lesson'], original)).notifications.created, 0);
  const extended = lesson('window-extended', '2026-10-22');
  const moved = [{ type: 'lesson', scopeId: 'timetable', dateFrom: '2026-10-02', dateTo: '2026-10-22' }];
  assert.equal((await importAndNotify([first, extended], ['lesson'], moved)).notifications.created, 0);
  const inserted = lesson('window-actually-added', '2026-10-12');
  assert.equal((await importAndNotify([first, extended, inserted], ['lesson'], moved)).notifications.created, 3);
  assert.equal((await importAndNotify([first, extended, inserted], ['lesson'], moved)).notifications.created, 0);
});
