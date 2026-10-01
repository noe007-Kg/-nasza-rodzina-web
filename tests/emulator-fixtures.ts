import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

export const projectId = 'demo-nasza-rodzina';
export const accounts = {
  parent: { uid: 'test-sebastian', email: 'sebastian@example.test', name: 'Sebastian', role: 'parent', adult: true },
  mother: { uid: 'test-dominika', email: 'dominika@example.test', name: 'Dominika', role: 'parent', adult: true },
  child: { uid: 'test-nikodem', email: 'nikodem@example.test', name: 'Nikodem', role: 'child', adult: false },
  sibling: { uid: 'test-pawel', email: 'pawel@example.test', name: 'Paweł', role: 'child', adult: true },
  inactive: { uid: 'test-inactive', email: 'inactive@example.test', name: 'Layla', role: 'child', adult: false },
} as const;
export const password = 'FamilyTest!2026';

function requireLocalEmulators() {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
    || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
    throw new Error('Browser tests require LOCAL Firebase emulators: Auth 127.0.0.1:9099, Firestore 127.0.0.1:8080. Production access is forbidden.');
  }
}

export function fixtureDatabase() {
  requireLocalEmulators();
  const app = getApps().find((candidate) => candidate.name === 'browser-tests')
    || initializeApp({ projectId }, 'browser-tests');
  return getFirestore(app);
}

export function todayKey() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
}

export async function seedEmulators() {
  const db = fixtureDatabase();
  const response = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Unable to clear local Firestore: ${response.status}`);

  const app = getApps().find((candidate) => candidate.name === 'browser-tests')!;
  const auth = getAuth(app);
  for (const account of Object.values(accounts)) {
    try { await auth.getUser(account.uid); }
    catch { await auth.createUser({ uid: account.uid, email: account.email, password, displayName: account.name }); }
    await auth.updateUser(account.uid, { password, disabled: false });
    const active = account.uid !== accounts.inactive.uid;
    await db.doc(`members/${account.uid}`).set({
      name: account.name, personKey: account.name, role: account.role,
      active, canLogin: active, adult: account.adult,
    });
  }

  const createdAt = Timestamp.now();
  const day = todayKey();
  const weekday = new Date(`${day}T12:00:00`).getDay() || 7;
  const batch = db.batch();
  batch.set(db.doc('tasks/child-approval'), {
    title: 'Wynieść śmieci — test zatwierdzania', person: 'Nikodem', dueDate: day,
    done: false, priority: 'normal', note: '', points: 10, requireApproval: true,
    approvalStatus: 'none', repeat: 'none', createdBy: accounts.parent.uid, createdAt,
  });
  batch.set(db.doc('tasks/sibling-approval'), {
    title: 'Zadanie Pawła', person: 'Paweł', dueDate: day, done: false,
    priority: 'normal', note: '', points: 5, requireApproval: true,
    approvalStatus: 'none', repeat: 'none', createdBy: accounts.parent.uid, createdAt,
  });
  for (const [id, person, title] of [
    ['nikodem-lesson', 'Nikodem', 'Przyroda Nikodema'],
    ['pawel-lesson', 'Paweł', 'Fizyka Pawła'],
  ]) {
    batch.set(db.doc(`schoolItems/${id}`), {
      title, person, type: 'lesson', subject: title, date: '', time: '08:00',
      endTime: '08:45', weekday, note: 'Sala testowa', createdBy: accounts.parent.uid, createdAt,
    });
  }
  for (const [id, person, title, privateToParents] of [
    ['nikodem-health', 'Nikodem', 'Kontrola Nikodema', false],
    ['pawel-private', 'Paweł', 'Poufny dokument Pawła', true],
    ['pawel-public', 'Paweł', 'Kontrola Pawła', false],
  ] as const) {
    batch.set(db.doc(`healthRecords/${id}`), {
      title, person, type: privateToParents ? 'document' : 'visit', date: day, time: '12:00',
      doctor: '', location: '', note: '', specialty: '', status: 'booked', referralCode: '',
      nextControl: '', callReminderDate: '', documentURL: '', privateToParents, dose: '',
      medicineTime: '', confirmedDate: '', createdBy: accounts.parent.uid, createdAt,
    });
  }
  batch.set(db.doc('familyMessages/family-message'), {
    text: 'Wspólna wiadomość testowa', uid: accounts.mother.uid, name: accounts.mother.name,
    channel: 'family', participants: [], createdAt,
  });
  const parentParticipants = [accounts.parent.uid, accounts.mother.uid].sort();
  batch.set(db.doc('familyMessages/parents-private'), {
    text: 'Poufna rozmowa rodziców', uid: accounts.mother.uid, name: accounts.mother.name,
    channel: `private:${parentParticipants.join(':')}`, participants: parentParticipants, createdAt,
  });
  const childParticipants = [accounts.parent.uid, accounts.child.uid].sort();
  batch.set(db.doc('familyMessages/child-private'), {
    text: 'Rozmowa z Nikodemem', uid: accounts.parent.uid, name: accounts.parent.name,
    channel: `private:${childParticipants.join(':')}`, participants: childParticipants, createdAt,
  });
  await batch.commit();
}
