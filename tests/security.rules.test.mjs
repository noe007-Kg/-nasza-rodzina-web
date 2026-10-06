import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { getMetadata, ref, uploadBytes } from 'firebase/storage';

let environment;
let parentDb;
let childDb;
let siblingDb;
// Run sequentially after browser tests: Storage's cross-service lookup uses the CLI project.
const projectId = 'demo-nasza-rodzina';
const profiles = {
  parent: { name: 'Sebastian', personKey: 'Sebastian', role: 'parent', active: true, canLogin: true },
  child: { name: 'Paweł', personKey: 'Paweł', role: 'child', active: true, canLogin: true },
  sibling: { name: 'Nikodem', personKey: 'Nikodem', role: 'child', active: true, canLogin: true },
  disabled: { name: 'Dominika', personKey: 'Dominika', role: 'parent', active: false, canLogin: true },
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
  parentDb = environment.authenticatedContext('parent').firestore();
  childDb = environment.authenticatedContext('child').firestore();
  siblingDb = environment.authenticatedContext('sibling').firestore();
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(Object.entries(profiles).map(([uid, profile]) => setDoc(doc(db, 'members', uid), profile)));
    await Promise.all([
      setDoc(doc(db, 'schoolItems', 'pawel'), { person: 'Paweł', type: 'grade', title: '5', createdBy: 'parent' }),
      setDoc(doc(db, 'schoolItems', 'nikodem'), { person: 'Nikodem', type: 'lesson', title: 'Polski', createdBy: 'parent' }),
      setDoc(doc(db, 'healthRecords', 'private'), { person: 'Paweł', title: 'Wynik prywatny', type: 'result', privateToParents: true, createdBy: 'parent' }),
      setDoc(doc(db, 'healthRecords', 'own'), { person: 'Paweł', title: 'Lek', type: 'medicine', privateToParents: false, createdBy: 'parent' }),
      setDoc(doc(db, 'healthRecords', 'sibling'), { person: 'Nikodem', title: 'Wizyta', type: 'visit', privateToParents: false, createdBy: 'parent' }),
      setDoc(doc(db, 'healthRecords', 'family'), { person: 'family', title: 'Apteczka', type: 'history', privateToParents: false, createdBy: 'parent' }),
      setDoc(doc(db, 'familyMessages', 'family'), { channel: 'family', participants: [], uid: 'parent', text: 'Cześć', name: 'Sebastian', createdAt: Timestamp.now() }),
      setDoc(doc(db, 'familyMessages', 'private'), { channel: 'private:child:parent', participants: ['child', 'parent'], uid: 'child', text: 'Prywatne', name: 'Paweł', createdAt: Timestamp.now() }),
      setDoc(doc(db, 'tasks', 'reward'), { person: 'Paweł', title: 'Pokój', done: false, points: 10, requireApproval: true, approvalStatus: 'none', createdBy: 'parent' }),
      setDoc(doc(db, 'tasks', 'sibling'), { person: 'Nikodem', title: 'Zabawki', done: false, points: 2, requireApproval: true, approvalStatus: 'none', createdBy: 'parent' }),
    ]);
  });
});

after(async () => { await environment?.cleanup(); });

test('anonymous, unknown and disabled accounts cannot access family collections', async () => {
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('outsider'), environment.authenticatedContext('disabled')]) {
    await assertFails(getDocs(collection(context.firestore(), 'members')));
    await assertFails(getDocs(collection(context.firestore(), 'tasks')));
  }
  await assertSucceeds(getDoc(doc(environment.authenticatedContext('disabled').firestore(), 'members', 'disabled')));
});

test('child cannot grant their own account a parent role or rename it', async () => {
  await assertFails(updateDoc(doc(childDb, 'members', 'child'), { role: 'parent' }));
  await assertFails(updateDoc(doc(childDb, 'members', 'child'), { personKey: 'Nikodem', name: 'Nikodem' }));
  await assertFails(setDoc(doc(parentDb, 'members', 'stranger'), profiles.child));
});

test('school data is enforced by the backend and supports only the own-person child query', async () => {
  await assertSucceeds(getDocs(query(collection(childDb, 'schoolItems'), where('person', '==', 'Paweł'))));
  await assertFails(getDocs(collection(childDb, 'schoolItems')));
  await assertFails(getDoc(doc(childDb, 'schoolItems', 'nikodem')));
  await assertSucceeds(getDocs(collection(parentDb, 'schoolItems')));
});

test('child may manage homework, but cannot fabricate grades or school messages', async () => {
  const homework = { person: 'Paweł', type: 'homework', title: 'Ćwiczenia', createdBy: 'child' };
  await assertSucceeds(setDoc(doc(childDb, 'schoolItems', 'new'), homework));
  await assertFails(setDoc(doc(childDb, 'schoolItems', 'grade'), { ...homework, type: 'grade' }));
  await assertFails(setDoc(doc(childDb, 'schoolItems', 'message'), { ...homework, type: 'message' }));
  await assertFails(setDoc(doc(childDb, 'schoolItems', 'other'), { ...homework, person: 'Nikodem' }));
  await assertFails(updateDoc(doc(childDb, 'schoolItems', 'pawel'), { title: '6' }));
});

test('health query exposes only shared records for the own person or family', async () => {
  await assertSucceeds(getDocs(query(collection(childDb, 'healthRecords'), where('privateToParents', '==', false), where('person', 'in', ['family', 'Paweł']))));
  await assertFails(getDocs(collection(childDb, 'healthRecords')));
  await assertFails(getDoc(doc(childDb, 'healthRecords', 'private')));
  await assertFails(getDoc(doc(childDb, 'healthRecords', 'sibling')));
  await assertSucceeds(getDocs(collection(parentDb, 'healthRecords')));
});

test('a child confirms own medicine but cannot expose a private record', async () => {
  await assertSucceeds(updateDoc(doc(childDb, 'healthRecords', 'own'), { confirmedDate: '2026-09-30', updatedAt: Timestamp.now() }));
  await assertFails(updateDoc(doc(childDb, 'healthRecords', 'own'), { person: 'Nikodem' }));
  await assertFails(updateDoc(doc(childDb, 'healthRecords', 'private'), { privateToParents: false }));
});

test('private chat has participant queries and is invisible to another child or parent', async () => {
  await assertSucceeds(getDocs(query(collection(childDb, 'familyMessages'), where('channel', '==', 'family'))));
  await assertSucceeds(getDocs(query(collection(childDb, 'familyMessages'), where('participants', 'array-contains', 'child'))));
  await assertFails(getDocs(collection(childDb, 'familyMessages')));
  await assertFails(getDoc(doc(siblingDb, 'familyMessages', 'private')));
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'familyMessages', 'children'), { channel: 'private:child:sibling', participants: ['child', 'sibling'], uid: 'child', text: 'Sekret', name: 'Paweł', createdAt: Timestamp.now() }));
  await assertFails(getDoc(doc(parentDb, 'familyMessages', 'children')));
});

test('chat send cannot impersonate another account or invent a mismatched channel', async () => {
  const message = { channel: 'private:child:parent', participants: ['child', 'parent'], uid: 'child', text: 'Wiadomość', name: 'Paweł', createdAt: Timestamp.now() };
  await assertSucceeds(setDoc(doc(childDb, 'familyMessages', 'sent'), message));
  await assertFails(setDoc(doc(childDb, 'familyMessages', 'spoof'), { ...message, uid: 'parent', name: 'Sebastian' }));
  await assertFails(setDoc(doc(childDb, 'familyMessages', 'channel'), { ...message, channel: 'private:parent:sibling' }));
  await assertFails(setDoc(doc(childDb, 'familyMessages', 'unknown'), { ...message, participants: ['child', 'unknown'], channel: 'private:child:unknown' }));
});

test('children submit their assigned tasks without granting themselves rewards', async () => {
  await assertSucceeds(updateDoc(doc(childDb, 'tasks', 'reward'), { approvalStatus: 'pending', updatedAt: Timestamp.now() }));
  await assertFails(updateDoc(doc(childDb, 'tasks', 'reward'), { done: true, approvalStatus: 'approved' }));
  await assertFails(updateDoc(doc(childDb, 'tasks', 'reward'), { points: 100 }));
  await assertFails(updateDoc(doc(childDb, 'tasks', 'sibling'), { approvalStatus: 'pending' }));
  await assertSucceeds(updateDoc(doc(parentDb, 'tasks', 'reward'), { done: true, approvalStatus: 'approved' }));
});

test('new health entries cannot contain publicly tokenized document URLs', async () => {
  const record = { person: 'Paweł', title: 'Dokument', type: 'document', privateToParents: true, createdBy: 'parent', documentPath: 'health/parents/Paweł/parent/result.pdf', documentURL: '' };
  await assertSucceeds(setDoc(doc(parentDb, 'healthRecords', 'new'), record));
  await assertFails(setDoc(doc(parentDb, 'healthRecords', 'public-url'), { ...record, documentURL: 'https://example.com/file?token=secret' }));
  await assertFails(setDoc(doc(parentDb, 'healthRecords', 'shared-path'), { ...record, documentPath: 'health/shared/Paweł/parent/result.pdf' }));
});

test('eduVULCAN session secrets are server-only, including for parents', async () => {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), '_eduConnections', 'parent'), { envelope: { ciphertext: 'encrypted' }, students: [] }));
  await assertFails(getDoc(doc(parentDb, '_eduConnections', 'parent')));
  await assertFails(getDocs(collection(parentDb, '_eduConnections')));
  await assertFails(setDoc(doc(parentDb, '_eduConnections', 'parent'), { session: 'forged' }));
});

test('browser users cannot forge eduVULCAN provenance or change imported school entries', async () => {
  const manual = { person: 'Paweł', type: 'lesson', title: 'Polski', createdBy: 'parent' };
  await assertSucceeds(setDoc(doc(parentDb, 'schoolItems', 'manual'), manual));
  await assertFails(setDoc(doc(parentDb, 'schoolItems', 'forged'), { ...manual, source: 'eduvulcan', sourceRecordId: 'provider-1' }));
  await assertFails(updateDoc(doc(parentDb, 'schoolItems', 'manual'), { provider: 'eduvulcan' }));
  await assertFails(updateDoc(doc(parentDb, 'schoolItems', 'manual'), { sourceConnectionId: 'family' }));
  await assertFails(updateDoc(doc(parentDb, 'schoolItems', 'manual'), { sourceConnectionScope: 'family' }));
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'schoolItems', 'synced'), { ...manual, source: 'eduvulcan', provider: 'eduvulcan', sourceRecordId: 'provider-2' }));
  await assertSucceeds(getDoc(doc(parentDb, 'schoolItems', 'synced')));
  await assertSucceeds(getDoc(doc(childDb, 'schoolItems', 'synced')));
  await assertFails(updateDoc(doc(parentDb, 'schoolItems', 'synced'), { title: 'Sfałszowany wpis' }));
  await assertFails(updateDoc(doc(childDb, 'schoolItems', 'synced'), { title: 'Inny wpis' }));
  await assertFails(deleteDoc(doc(parentDb, 'schoolItems', 'synced')));
});

test('synchronized parent messages are readable only by parents and cannot be forged by the browser', async () => {
  const message = { person: 'Paweł', personKey: 'Paweł', type: 'message', title: 'Wiadomość wychowawcy', note: 'Tylko rodzice', source: 'eduvulcan' };
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'schoolParentMessages', 'synced'), message));
  await assertSucceeds(getDocs(collection(parentDb, 'schoolParentMessages')));
  await assertFails(getDocs(collection(childDb, 'schoolParentMessages')));
  await assertFails(getDoc(doc(childDb, 'schoolParentMessages', 'synced')));
  await assertFails(setDoc(doc(parentDb, 'schoolParentMessages', 'forged'), message));
});

test('personal student messages are limited to their owner, with server-only identity bindings', async () => {
  const message = { person: 'Paweł', type: 'message', title: 'Własna wiadomość ucznia', source: 'eduvulcan', sourceOwnerUid: 'child', sourceConnectionId: 'student_test' };
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'schoolStudentMessages', 'own'), message);
    await setDoc(doc(db, 'schoolStudentMessages', 'same-person-other-uid'), { ...message, sourceOwnerUid: 'another-uid' });
    await setDoc(doc(db, '_eduStudentBindings', 'Paweł'), { identity: { studentName: 'Uczeń testowy', schoolName: 'Szkoła testowa' } });
    await setDoc(doc(db, '_eduConnections', 'family'), { envelope: { ciphertext: 'encrypted' } });
  });
  await assertSucceeds(getDoc(doc(childDb, 'schoolStudentMessages', 'own')));
  await assertSucceeds(getDocs(query(collection(childDb, 'schoolStudentMessages'), where('sourceOwnerUid', '==', 'child'), where('person', '==', 'Paweł'))));
  await assertFails(getDocs(collection(parentDb, 'schoolStudentMessages')));
  await assertFails(getDoc(doc(parentDb, 'schoolStudentMessages', 'own')));
  await assertFails(getDocs(collection(childDb, 'schoolStudentMessages')));
  await assertFails(getDoc(doc(siblingDb, 'schoolStudentMessages', 'own')));
  await assertFails(getDoc(doc(childDb, 'schoolStudentMessages', 'same-person-other-uid')));
  for (const db of [parentDb, childDb, siblingDb]) {
    await assertFails(setDoc(doc(db, 'schoolStudentMessages', 'forged'), message));
    await assertFails(getDoc(doc(db, '_eduStudentBindings', 'Paweł')));
    await assertFails(setDoc(doc(db, '_eduStudentBindings', 'Paweł'), { identity: { studentName: 'Inny uczeń', schoolName: 'Inna szkoła' } }));
    await assertFails(getDoc(doc(db, '_eduConnections', 'family')));
  }
});

test('storage protects private health documents, own shared documents, file types and old paths', async () => {
  const parentStorage = environment.authenticatedContext('parent').storage(`gs://${projectId}.appspot.com`);
  const childStorage = environment.authenticatedContext('child').storage(`gs://${projectId}.appspot.com`);
  const siblingStorage = environment.authenticatedContext('sibling').storage(`gs://${projectId}.appspot.com`);
  const file = new Uint8Array([37, 80, 68, 70, 45]);
  const privatePath = 'health/parents/Paweł/parent/private.pdf';
  const ownPath = 'health/shared/Paweł/child/own.pdf';
  await assertSucceeds(uploadBytes(ref(parentStorage, privatePath), file, { contentType: 'application/pdf' }));
  await assertSucceeds(getMetadata(ref(parentStorage, privatePath)));
  await assertFails(getMetadata(ref(childStorage, privatePath)));
  await assertSucceeds(uploadBytes(ref(childStorage, ownPath), file, { contentType: 'application/pdf' }));
  await assertSucceeds(getMetadata(ref(childStorage, ownPath)));
  await assertFails(getMetadata(ref(siblingStorage, ownPath)));
  await assertFails(uploadBytes(ref(childStorage, 'health/parents/Paweł/child/new.pdf'), file, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(parentStorage, 'health/Paweł/legacy.pdf'), file, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(childStorage, 'quick-products/child/script.js'), file, { contentType: 'application/javascript' }));
  await assertFails(uploadBytes(ref(childStorage, 'quick-products/parent/image.png'), file, { contentType: 'image/png' }));
});

const calendarEntry = (uid, extra = {}) => ({
  title: 'Prywatna konsultacja', person: 'family',
  date: Timestamp.fromDate(new Date('2026-10-05T10:00:00Z')),
  endDate: Timestamp.fromDate(new Date('2026-10-05T11:00:00Z')),
  allDay: false, description: 'Szczegóły dostępne tylko właścicielowi',
  repeat: 'none', repeatUntil: null, createdBy: uid, ownerUid: uid, private: true,
  ...extra,
});

test('private calendar read, query, create, edit and delete belong to the exact owner UID', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'members', 'another-parent'), { ...profiles.parent, name: 'Dominika', personKey: 'Dominika' });
    await setDoc(doc(db, 'privateCalendarEvents', 'parent-private'), calendarEntry('parent'));
    await setDoc(doc(db, 'privateCalendarEvents', 'child-private'), calendarEntry('child', { person: 'Paweł' }));
  });
  const otherParent = environment.authenticatedContext('another-parent').firestore();
  for (const [db, uid] of [[parentDb, 'parent'], [childDb, 'child']]) {
    await assertSucceeds(getDocs(query(collection(db, 'privateCalendarEvents'), where('ownerUid', '==', uid))));
    await assertFails(getDocs(collection(db, 'privateCalendarEvents')));
    await assertSucceeds(setDoc(doc(db, 'privateCalendarEvents', `${uid}-new`), calendarEntry(uid, { person: uid === 'child' ? 'Paweł' : 'family' })));
    await assertSucceeds(updateDoc(doc(db, 'privateCalendarEvents', `${uid}-new`), { title: 'Zmieniona własna konsultacja' }));
    await assertFails(updateDoc(doc(db, 'privateCalendarEvents', `${uid}-new`), { ownerUid: 'sibling' }));
    await assertFails(updateDoc(doc(db, 'privateCalendarEvents', `${uid}-new`), { createdBy: 'sibling' }));
    await assertFails(updateDoc(doc(db, 'privateCalendarEvents', `${uid}-new`), { private: false }));
    await assertSucceeds(deleteDoc(doc(db, 'privateCalendarEvents', `${uid}-new`)));
  }
  for (const db of [otherParent, childDb, siblingDb]) {
    await assertFails(getDoc(doc(db, 'privateCalendarEvents', 'parent-private')));
    await assertFails(updateDoc(doc(db, 'privateCalendarEvents', 'parent-private'), { title: 'Nieuprawniona zmiana' }));
    await assertFails(deleteDoc(doc(db, 'privateCalendarEvents', 'parent-private')));
  }
  await assertFails(getDoc(doc(parentDb, 'privateCalendarEvents', 'child-private')));
  await assertFails(getDocs(query(collection(parentDb, 'privateCalendarEvents'), where('ownerUid', '==', 'child'))));
  await assertFails(setDoc(doc(childDb, 'privateCalendarEvents', 'sibling-new'), calendarEntry('child', { person: 'Nikodem' })));
  await assertFails(setDoc(doc(parentDb, 'privateCalendarEvents', 'spoofed-owner'), calendarEntry('parent', { ownerUid: 'child' })));
});

test('private calendar data cannot be mislabeled as private in the public calendar collection', async () => {
  const event = calendarEntry('parent');
  await assertFails(setDoc(doc(parentDb, 'calendarEvents', 'private-leak'), event));
  await assertSucceeds(setDoc(doc(parentDb, 'calendarEvents', 'public'), { ...event, private: false }));
  await assertFails(updateDoc(doc(parentDb, 'calendarEvents', 'public'), { private: true, description: 'Nie może udawać prywatności' }));
  await assertSucceeds(getDoc(doc(childDb, 'calendarEvents', 'public')));
});

function notificationSettings(extra = {}) {
  return { enabled: true, sound: false, categories: {
    calendar: true, tasks: true, shopping: true, familyChat: true,
    privateChat: true, health: true, school: true, important: true,
  }, ...extra };
}

test('user preferences and important flags are private to the UID including against parents', async () => {
  const preferences = {
    dashboardOrder: ['calendar', 'family-time', 'tasks', 'shopping', 'chat', 'health', 'school'],
    notifications: notificationSettings(), importantItems: ['school:message:nikodem:1', 'chat:family:1'],
    updatedAt: Timestamp.now(),
  };
  await assertSucceeds(setDoc(doc(childDb, 'userPreferences', 'child'), preferences));
  await assertSucceeds(getDoc(doc(childDb, 'userPreferences', 'child')));
  await assertSucceeds(updateDoc(doc(childDb, 'userPreferences', 'child'), { importantItems: ['school:message:nikodem:1'] }));
  await assertSucceeds(updateDoc(doc(childDb, 'userPreferences', 'child'), { notifications: notificationSettings({ sound: true }) }));
  await assertSucceeds(setDoc(doc(parentDb, 'userPreferences', 'parent'), { dashboardOrder: ['school'] }));
  await assertSucceeds(getDocs(query(collection(childDb, 'userPreferences'), where('__name__', '==', 'child'))));
  for (const db of [parentDb, siblingDb]) {
    await assertFails(getDoc(doc(db, 'userPreferences', 'child')));
    await assertFails(updateDoc(doc(db, 'userPreferences', 'child'), { importantItems: [] }));
    await assertFails(deleteDoc(doc(db, 'userPreferences', 'child')));
  }
  await assertFails(getDocs(collection(childDb, 'userPreferences')));
  await assertFails(getDocs(collection(parentDb, 'userPreferences')));
  await assertFails(setDoc(doc(childDb, 'userPreferences', 'parent'), preferences));
});

test('preferences reject secret/token injection, unknown fields and malformed dashboard or category data', async () => {
  const target = doc(childDb, 'userPreferences', 'child');
  const valid = { notifications: notificationSettings(), dashboardOrder: ['family-time', 'calendar'], importantItems: [], updatedAt: Timestamp.now() };
  await assertSucceeds(setDoc(target, valid));
  for (const payload of [
    { ...valid, fcmToken: 'client-token-must-never-go-here' },
    { ...valid, eduVulcanPassword: 'secret-placeholder' },
    { ...valid, notifications: notificationSettings({ token: 'nested-token' }) },
    { ...valid, notifications: notificationSettings({ categories: { ...notificationSettings().categories, unsafe: true } }) },
    { ...valid, notifications: notificationSettings({ categories: { ...notificationSettings().categories, school: 'yes' } }) },
    { ...valid, notifications: notificationSettings({ enabled: 'true' }) },
    { ...valid, notifications: notificationSettings({ sound: 1 }) },
    { ...valid, notifications: { enabled: true, sound: true, categories: { calendar: true } } },
    { ...valid, dashboardOrder: ['calendar', 'calendar'] },
    { ...valid, dashboardOrder: ['unknown-module'] },
    { ...valid, dashboardOrder: 'calendar' },
    { ...valid, importantItems: '★' },
    { ...valid, importantItems: Array.from({ length: 501 }, (_, index) => `entry-${index}`) },
    { ...valid, updatedAt: '2026-10-02' },
  ]) await assertFails(setDoc(target, payload));
  await assertFails(updateDoc(target, { password: 'secret-placeholder' }));
});

test('notification inbox owners can only mark read and starred; message content and delivery are server-only', async () => {
  const notification = { title: 'Nowa wiadomość', body: 'Otwórz aplikację', category: 'school', module: 'Szkoła', read: false, starred: false, createdAt: Timestamp.now() };
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'notificationInbox', 'child', 'items', 'school-1'), notification);
    await setDoc(doc(context.firestore(), 'notificationInbox', 'parent', 'items', 'school-parent'), notification);
  });
  const own = doc(childDb, 'notificationInbox', 'child', 'items', 'school-1');
  await assertSucceeds(getDoc(own));
  await assertSucceeds(getDocs(collection(childDb, 'notificationInbox', 'child', 'items')));
  await assertSucceeds(updateDoc(own, { read: true, readAt: Timestamp.now() }));
  await assertSucceeds(updateDoc(own, { starred: true }));
  await assertSucceeds(updateDoc(own, { starred: false }));
  for (const payload of [ { title: 'Fałszywy tytuł' }, { body: 'Fałszywe dane' }, { module: 'Czat' }, { category: 'privateChat' }, { read: 'yes' }, { starred: 1 }, { readAt: 'yesterday' }, { fcmToken: 'injected' } ]) await assertFails(updateDoc(own, payload));
  await assertFails(setDoc(doc(childDb, 'notificationInbox', 'child', 'items', 'forged'), notification));
  await assertFails(deleteDoc(own));
  await assertFails(getDoc(doc(childDb, 'notificationInbox', 'parent', 'items', 'school-parent')));
  for (const db of [parentDb, siblingDb]) {
    await assertFails(getDoc(doc(db, 'notificationInbox', 'child', 'items', 'school-1')));
    await assertFails(getDocs(collection(db, 'notificationInbox', 'child', 'items')));
    await assertFails(updateDoc(doc(db, 'notificationInbox', 'child', 'items', 'school-1'), { read: true }));
  }
});

test('push tokens, device owners, deduplication and outbox are inaccessible to browser accounts', async () => {
  const collections = ['_notificationDevices', '_notificationTokenOwners', '_notificationEvents', '_notificationOutbox', '_notificationBaselines'];
  await environment.withSecurityRulesDisabled(async context => {
    await Promise.all(collections.map(name => setDoc(doc(context.firestore(), name, 'test-device'), { uid: 'parent', token: 'test-token-placeholder', sent: false })));
  });
  for (const db of [parentDb, childDb, siblingDb]) for (const name of collections) {
    const target = doc(db, name, 'test-device');
    await assertFails(getDoc(target));
    await assertFails(getDocs(collection(db, name)));
    await assertFails(setDoc(doc(db, name, 'forged'), { uid: 'child', token: 'test-token-placeholder' }));
    await assertFails(updateDoc(target, { uid: 'child' }));
    await assertFails(deleteDoc(target));
  }
});

test('new dynamic member identities retain own-person health restrictions in Firestore and Storage', async () => {
  const key = 'member-0123456789abcdef01234567';
  const dynamicUid = 'dynamic-child';
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'members', dynamicUid), { name: 'Nowy członek', personKey: key, role: 'child', active: true, canLogin: true });
    await setDoc(doc(context.firestore(), 'healthRecords', 'dynamic-private'), { person: key, title: 'Prywatny wynik', type: 'result', privateToParents: true, createdBy: 'parent' });
  });
  const dynamic = environment.authenticatedContext(dynamicUid);
  const db = dynamic.firestore();
  const record = { person: key, title: 'Własny lek', type: 'medicine', privateToParents: false, createdBy: dynamicUid, documentURL: '' };
  await assertSucceeds(setDoc(doc(db, 'healthRecords', 'dynamic-own'), record));
  await assertSucceeds(getDoc(doc(db, 'healthRecords', 'dynamic-own')));
  await assertSucceeds(getDocs(query(collection(db, 'healthRecords'), where('privateToParents', '==', false), where('person', 'in', ['family', key]))));
  await assertSucceeds(updateDoc(doc(db, 'healthRecords', 'dynamic-own'), { confirmedDate: '2026-10-02', updatedAt: Timestamp.now() }));
  await assertFails(getDoc(doc(db, 'healthRecords', 'dynamic-private')));
  await assertFails(getDoc(doc(db, 'healthRecords', 'own')));
  await assertFails(getDoc(doc(childDb, 'healthRecords', 'dynamic-own')));
  await assertFails(getDoc(doc(siblingDb, 'healthRecords', 'dynamic-own')));
  await assertFails(setDoc(doc(db, 'healthRecords', 'dynamic-spoof'), { ...record, person: 'Paweł' }));
  await assertFails(setDoc(doc(db, 'healthRecords', 'dynamic-invalid'), { ...record, person: 'member-not-a-valid-id' }));
  await assertFails(updateDoc(doc(db, 'healthRecords', 'dynamic-own'), { privateToParents: true }));
  const file = new Uint8Array([37, 80, 68, 70, 45]);
  const ownPath = `health/shared/${key}/${dynamicUid}/own.pdf`;
  const dynamicStorage = dynamic.storage(`gs://${projectId}.appspot.com`);
  await assertSucceeds(uploadBytes(ref(dynamicStorage, ownPath), file, { contentType: 'application/pdf' }));
  await assertSucceeds(getMetadata(ref(dynamicStorage, ownPath)));
  await assertFails(getMetadata(ref(environment.authenticatedContext('child').storage(`gs://${projectId}.appspot.com`), ownPath)));
  await assertFails(uploadBytes(ref(dynamicStorage, `health/shared/Paweł/${dynamicUid}/other.pdf`), file, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(dynamicStorage, `health/parents/${key}/${dynamicUid}/private.pdf`), file, { contentType: 'application/pdf' }));
  await assertSucceeds(getMetadata(ref(environment.authenticatedContext('parent').storage(`gs://${projectId}.appspot.com`), ownPath)));
});
