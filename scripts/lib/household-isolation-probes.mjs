import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, setDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { assertRestoreTarget } from './household-restore-verifier.mjs';

/** Controlled fake profiles only; production rule text is loaded into emulators, never published. */
export async function probeHouseholdRules(target, { firestoreRules, storageRules }) {
  assertRestoreTarget(target);
  const split = host => ({ host: '127.0.0.1', port: Number(host.split(':')[1]) });
  const environment = await initializeTestEnvironment({ projectId: target.projectId,
    firestore: { ...split(target.firestoreHost), rules: firestoreRules }, storage: { ...split(target.storageHost), rules: storageRules } });
  const a = 'restore-probe-parent-a', b = 'restore-probe-parent-b', child = 'restore-probe-child-a';
  const familyA = 'household-probe-a', familyB = 'household-probe-b';
  const avatarPath = `avatars/members/${a}/${a}/10000000-0000-4000-8000-000000000001.png`;
  const legacyHealthPath = `health/parents/member-cccccccccccccccccccccccc/${a}/synthetic.pdf`;
  const healthPath = `healthDocuments/restore-probe-health/${a}/synthetic.pdf`;
  try {
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      for (const [uid, role, familyId, personKey] of [[a, 'parent', familyA, 'member-aaaaaaaaaaaaaaaaaaaaaaaa'],
        [b, 'parent', familyB, 'member-bbbbbbbbbbbbbbbbbbbbbbbb'], [child, 'child', familyA, 'member-cccccccccccccccccccccccc']]) {
        await setDoc(doc(db, 'members', uid), { name: 'Synthetic isolation probe', role, familyId, personKey, active: true, canLogin: true, archived: false });
      }
      await setDoc(doc(db, 'calendarEvents', 'restore-probe-calendar'), { title: 'Synthetic event', person: 'family', familyId: familyA,
        ownerUid: a, createdBy: a, private: false, visibility: 'family', source: 'manual', date: Timestamp.now() });
      await setDoc(doc(db, 'tasks', 'restore-probe-task'), { title: 'Synthetic task', createdBy: a, familyId: familyA,
        person: 'member-cccccccccccccccccccccccc', done: false });
      await setDoc(doc(db, 'schoolParentMessages', 'restore-probe-parent-message'), { person: 'member-cccccccccccccccccccccccc',
        familyId: familyA, sourceOwnerUid: a, title: 'Synthetic parent message' });
      await setDoc(doc(db, 'financeBills', 'restore-probe-bill'), { familyId: familyA, ownerUid: a, sharedWith: [child],
        status: 'unpaid', archived: false, title: 'Synthetic bill', amountGrosze: 100, dueDate: '2026-10-20' });
      await setDoc(doc(db, 'privateCalendarEvents', 'restore-probe-private'), { ownerUid: a, createdBy: a, person: 'member-aaaaaaaaaaaaaaaaaaaaaaaa', private: true, title: 'Synthetic private event' });
      await setDoc(doc(db, 'healthDocuments', 'restore-probe-health'), { state: 'ready', attachmentKind: 'health-record',
        familyId: familyA, createdBy: a, readers: [a], editors: [a], storagePath: healthPath });
      for (const [objectPath, contentType] of [[avatarPath, 'image/png'], [legacyHealthPath, 'application/pdf'], [healthPath, 'application/pdf']]) {
        await uploadBytes(ref(context.storage(), objectPath), new Uint8Array([1, 2, 3]), { contentType });
      }
    });
    const scenarios = [];
    for (const [id, uid, collection, key, expectedAllowed] of [
      ['own-family-calendar', a, 'calendarEvents', 'restore-probe-calendar', true],
      ['foreign-calendar', b, 'calendarEvents', 'restore-probe-calendar', false],
      ['foreign-task', b, 'tasks', 'restore-probe-task', false],
      ['foreign-parent-message', b, 'schoolParentMessages', 'restore-probe-parent-message', false],
      ['child-parent-message', child, 'schoolParentMessages', 'restore-probe-parent-message', false],
      ['own-parent-bill', a, 'financeBills', 'restore-probe-bill', true],
      ['shared-child-bill', child, 'financeBills', 'restore-probe-bill', true],
      ['foreign-bill', b, 'financeBills', 'restore-probe-bill', false],
      ['foreign-private-calendar', b, 'privateCalendarEvents', 'restore-probe-private', false],
    ]) {
      let allowed;
      try { const value = await getDocFromServer(doc(environment.authenticatedContext(uid).firestore(), collection, key)); allowed = value.exists(); }
      catch (error) { if (error.code !== 'permission-denied') throw new Error('ISOLATION_PROBE_REQUEST_FAILED'); allowed = false; }
      scenarios.push({ id, expectedAllowed, actualAllowed: allowed, passed: allowed === expectedAllowed });
    }
    for (const [id, uid, objectPath, expectedAllowed] of [
      ['own-avatar-storage', a, avatarPath, true], ['foreign-avatar-storage', b, avatarPath, false],
      ['foreign-legacy-health-storage', b, legacyHealthPath, false],
      ['own-health-document-storage', a, healthPath, true], ['foreign-health-document-storage', b, healthPath, false],
      ['child-unshared-health-storage', child, healthPath, false],
    ]) {
      let allowed;
      try { await getBytes(ref(environment.authenticatedContext(uid).storage(), objectPath), 1024); allowed = true; }
      catch (error) { if (!['storage/unauthorized', 'storage/unauthenticated'].includes(error.code)) throw new Error('ISOLATION_STORAGE_PROBE_REQUEST_FAILED'); allowed = false; }
      scenarios.push({ id, expectedAllowed, actualAllowed: allowed, passed: allowed === expectedAllowed });
    }
    return { rulesVerified: scenarios.every(row => row.passed), fullMultiHouseholdVerified: false,
      code: 'API_FUNCTIONS_AND_NOTIFICATION_ISOLATION_NOT_VERIFIED', scenarios, checkedAt: new Date().toISOString() };
  } finally { await environment.cleanup(); }
}
