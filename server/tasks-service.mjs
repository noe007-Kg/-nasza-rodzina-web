import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';
import { explicitFamilyId } from './family-identity.mjs';
import { TASK_PHOTO_TYPES, validTaskPhotoMetadata, taskPhotoBucket, verifyTaskPhoto, enqueueTaskPhotoCleanup, deleteQueuedTaskPhoto } from './tasks-photos.mjs';
import { verifyRewardImage, revokeRewardImage, deleteQueuedRewardImage } from './tasks-reward-images.mjs';
export { runTaskPhotoCleanup } from './tasks-photos.mjs';

const fail = (code, status, message) => { throw new EduServerError(code, status, message); };
const active = profile => profile?.active === true && profile.canLogin === true && profile.archived !== true && profile.disabled !== true && ['parent', 'adult', 'child'].includes(profile.role);
const parent = profile => active(profile) && profile.role === 'parent';
const profilePerson = profile => String(profile?.personKey || profile?.name || '');
const usableProfile = profile => profile?.active === true && profile.archived !== true && profile.disabled !== true;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const stamp = () => FieldValue.serverTimestamp();
const personId = person => `person-${hash(person)}`;
const familyPersonId = (familyId, person) => `family-${hash(`${familyId}:${person}`)}`;
const familyQuery = (db, name, actor) => db.collection(name).where('familyId', '==', explicitFamilyId(actor));

function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action', ...allowed].includes(key))) {
    fail('TASK_INVALID_REQUEST', 400, 'Żądanie zadania zawiera nieobsługiwane dane.');
  }
}
function text(value, maximum, required = true) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || required && !value.trim()) fail('TASK_INVALID_REQUEST', 400, 'Uzupełnij poprawnie pola formularza.');
  return value.trim();
}
function taskId(value) { if (!id(value)) fail('TASK_INVALID_REQUEST', 400, 'Nieprawidłowe zadanie.'); return value; }
function integer(value, maximum) { if (!Number.isInteger(value) || value < 0 || value > maximum) fail('TASK_INVALID_REQUEST', 400, 'Nieprawidłowa liczba punktów.'); return value; }
function taskMode(data) { return ['trust', 'parent', 'photo'].includes(data.verificationMode) ? data.verificationMode : data.requireApproval === true ? 'parent' : 'trust'; }
function sameFamily(actor, record) { const family = explicitFamilyId(actor); return family !== null && family === explicitFamilyId(record); }
function requireLinked(record, actor, matches = true) {
  if (!record || !sameFamily(actor, record) || !matches) fail('TASK_FORBIDDEN', 403, 'Powiązane dane zadania nie należą do tego gospodarstwa lub osoby.');
}
function requireTicket(ticket, actor, task, taskId) {
  requireLinked(ticket, actor, ticket.taskId === taskId && ticket.person === task.person
    && typeof ticket.uid === 'string' && ticket.path?.startsWith(`taskProof/${taskId}/${ticket.uid}/${ticket.id}.`));
}

async function freshActor(transaction, context) {
  const snapshot = await transaction.get(context.db.collection('members').doc(context.uid));
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!active(profile) || !sameFamily(profile, context.profile)) fail('TASK_MEMBER_REQUIRED', 403, 'Profil nie ma aktywnego dostępu do zadań.');
  return profile;
}
async function roster(transaction, db, actor) {
  const snapshot = await transaction.get(familyQuery(db, 'members', actor));
  return new Map(snapshot.docs.map(item => [item.id, item.data()]));
}
function memberForPerson(profiles, person, actor) {
  const matches = [...profiles.entries()].filter(([, profile]) => usableProfile(profile) && profilePerson(profile) === person && sameFamily(actor, profile));
  if (matches.length > 1) fail('TASK_INVALID_PERSON', 409, 'Identyfikator osoby musi jednoznacznie wskazywać profil.');
  return matches[0];
}
function mayComplete(actor, task) { return parent(actor) || task.person === profilePerson(actor) || task.person === 'family'; }
function requireTask(task, actor) {
  if (!task || task.archived === true || !sameFamily(actor, task)) fail('TASK_NOT_FOUND', 404, 'Nie znaleziono dostępnego zadania.');
}
function requireParent(actor) { if (!parent(actor)) fail('TASK_PARENT_REQUIRED', 403, 'Tę czynność zatwierdza aktywny rodzic.'); }

async function readTaskPhotoTickets(transaction, db, task, actor, record) {
  const uploads = await transaction.get(db.collection('_taskPhotoUploads').where('taskId', '==', task));
  const tickets = uploads.docs.map(item => ({ ...item.data(), id: item.id })).filter(ticket => ['open', 'submitted'].includes(ticket.state));
  for (const ticket of tickets) requireTicket(ticket, actor, record, task);
  return tickets;
}

/** Storage authorization relies on members + ticket, so every invalidated ticket is
 * revoked in the same transaction that changes assignment or finishes the task. */
function revokeTaskPhotoTickets(transaction, context, tickets, reason, now, keepId = null) {
  for (const ticket of tickets) {
    if (ticket.id === keepId) continue;
    transaction.update(context.db.collection('_taskPhotoUploads').doc(ticket.id), { state: 'revoked', revokedAt: stamp() });
    enqueueTaskPhotoCleanup(transaction, context.db, ticket, reason, now);
  }
}

export function validateTaskDraft(body, actor) {
  fields(body, ['id', 'title', 'person', 'dueDate', 'priority', 'note', 'points', 'verificationMode', 'repeat']);
  const result = { title: text(body.title, 500), person: text(body.person, 128), dueDate: text(body.dueDate ?? '', 10, false),
    priority: body.priority, note: text(body.note ?? '', 5000, false), points: integer(body.points, 500), verificationMode: body.verificationMode, repeat: body.repeat };
  if (result.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(result.dueDate) || new Date(`${result.dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== result.dueDate)
    || !['low', 'normal', 'high'].includes(result.priority) || !['trust', 'parent', 'photo'].includes(result.verificationMode)
    || !['none', 'daily', 'weekly', 'monthly'].includes(result.repeat)) fail('TASK_INVALID_REQUEST', 400, 'Wybierz poprawny termin, priorytet i sposób potwierdzenia.');
  if (!parent(actor) && (result.points !== 0 || result.verificationMode !== 'parent' || ![profilePerson(actor), 'family'].includes(result.person))) {
    fail('TASK_PARENT_REQUIRED', 403, 'Punkty i sposób zatwierdzania ustala rodzic. Możesz dodać bezpunktowe zadanie dla siebie lub rodziny.');
  }
  return { ...result, requireApproval: result.verificationMode !== 'trust' };
}

/** Original completed records remain an opening balance; no production migration. */
export function legacyTaskPoints(tasks, person) {
  return tasks.filter(task => task.person === person && task.done === true && task.pointsBooked !== true
    && (!task.requireApproval || task.approvalStatus === 'approved'))
    .reduce((sum, task) => sum + (Number.isInteger(task.points) && task.points >= 0 && task.points <= 10000 ? task.points : 0), 0);
}
function currentBalance(snapshot, legacy, person) {
  const data = snapshot.exists ? snapshot.data() : null;
  if (data && ['balance', 'earned', 'spent', 'completedCount'].some(key => !Number.isSafeInteger(data[key] ?? 0) || (data[key] ?? 0) < 0)) fail('TASK_BALANCE_INVALID', 409, 'Saldo wymaga sprawdzenia przed operacją punktową.');
  return data ? { balance: data.balance ?? 0, earned: data.earned ?? 0, spent: data.spent ?? 0, completedCount: data.completedCount ?? 0 }
    : { balance: legacyTaskPoints(legacy, person), earned: legacyTaskPoints(legacy, person), spent: 0, completedCount: legacy.filter(task => task.person === person && task.done && task.pointsBooked !== true).length };
}

/** Preserve a migrated legacy balance ID, but never reuse another household's ID. */
async function ownedBalance(transaction, db, actor, person) {
  const scopedRef = db.collection('taskPointBalances').doc(familyPersonId(explicitFamilyId(actor), person));
  const legacyRef = db.collection('taskPointBalances').doc(personId(person));
  const [scoped, legacy] = await Promise.all([transaction.get(scopedRef), transaction.get(legacyRef)]);
  if (scoped.exists) requireLinked(scoped.data(), actor, scoped.data().person === person);
  if (legacy.exists && !explicitFamilyId(legacy.data())) fail('TASK_MIGRATION_REQUIRED', 409, 'Historyczne saldo wymaga zweryfikowanego przypisania do gospodarstwa.');
  const ownedLegacy = legacy.exists && sameFamily(actor, legacy.data());
  if (ownedLegacy) requireLinked(legacy.data(), actor, legacy.data().person === person);
  if (scoped.exists && ownedLegacy) fail('TASK_BALANCE_CONFLICT', 409, 'Istnieją dwa salda tej samej osoby. Wymagana jest weryfikacja bez automatycznego nadpisania.');
  return scoped.exists || !ownedLegacy ? { ref: scopedRef, snapshot: scoped } : { ref: legacyRef, snapshot: legacy };
}

async function ownedPending(transaction, db, actor, person, rewardId) {
  const scopedRef = db.collection('_taskRewardPending').doc(hash(`${explicitFamilyId(actor)}:${person}:${rewardId}`));
  const legacyRef = db.collection('_taskRewardPending').doc(hash(`${person}:${rewardId}`));
  const [scoped, legacy] = await Promise.all([transaction.get(scopedRef), transaction.get(legacyRef)]);
  const valid = snapshot => {
    const data = snapshot.data(); requireLinked(data, actor, data.person === person && data.rewardId === rewardId && id(data.requestId));
  };
  if (scoped.exists) valid(scoped);
  if (legacy.exists && !explicitFamilyId(legacy.data())) fail('TASK_MIGRATION_REQUIRED', 409, 'Historyczna prośba o nagrodę wymaga przypisania do gospodarstwa.');
  const ownedLegacy = legacy.exists && sameFamily(actor, legacy.data());
  if (ownedLegacy) valid(legacy);
  if (scoped.exists && ownedLegacy) fail('TASK_REWARD_PENDING_CONFLICT', 409, 'Istnieją dwie prośby tej samej osoby. Wymagana jest weryfikacja.');
  return scoped.exists || !ownedLegacy ? { ref: scopedRef, snapshot: scoped } : { ref: legacyRef, snapshot: legacy };
}

export function nextTaskDueDate(task, fallback = new Date().toISOString().slice(0, 10)) {
  const base = new Date(`${task.dueDate || fallback}T12:00:00Z`);
  if (!Number.isFinite(base.getTime())) return fallback;
  if (task.repeat === 'daily') base.setUTCDate(base.getUTCDate() + 1);
  else if (task.repeat === 'weekly') base.setUTCDate(base.getUTCDate() + 7);
  else if (task.repeat === 'monthly') {
    const day = Number(task.repeatAnchorDay || base.getUTCDate());
    base.setUTCDate(1); base.setUTCMonth(base.getUTCMonth() + 1);
    base.setUTCDate(Math.min(day, new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return base.toISOString().slice(0, 10);
}

async function saveTask(context, body, now) {
  const ref = context.db.collection('tasks').doc(body.id ? taskId(body.id) : randomUUID());
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context);
    const draft = validateTaskDraft(body, actor);
    const profiles = await roster(transaction, context.db, actor);
    if (draft.person !== 'family' && !memberForPerson(profiles, draft.person, actor)) fail('TASK_INVALID_PERSON', 400, 'Wybierz aktywnego członka rodziny.');
    const previous = await transaction.get(ref);
    if (previous.exists) {
      const task = previous.data(); requireTask(task, actor);
      if (task.done || task.approvalStatus === 'pending') fail('TASK_ALREADY_SUBMITTED', 409, 'Zatwierdzonego lub zgłoszonego zadania nie można zmienić.');
      if (!parent(actor) && (task.createdBy !== context.uid || task.points !== 0 || !mayComplete(actor, task))) requireParent(actor);
      const invalidatesProof = task.person !== draft.person || taskMode(task) !== draft.verificationMode;
      const tickets = invalidatesProof ? await readTaskPhotoTickets(transaction, context.db, ref.id, actor, task) : [];
      transaction.update(ref, { ...draft, familyId: explicitFamilyId(actor), serverManaged: true, updatedAt: stamp() });
      revokeTaskPhotoTickets(transaction, context, tickets, 'assignment-changed', now);
    } else {
      transaction.create(ref, { ...draft, serverManaged: true, done: false, approvalStatus: 'none', archived: false,
        familyId: explicitFamilyId(actor), createdBy: context.uid, createdAt: stamp(), updatedAt: stamp() });
    }
  });
  return { taskId: ref.id };
}

/** All reads precede writes, including legacy opening balances and recurrence. */
async function bookCompletion(transaction, context, ref, task, actor, profiles, now) {
  let person = task.person;
  if (person === 'family') {
    const performer = profiles.get(task.submittedBy || context.uid);
    if (!usableProfile(performer) || !sameFamily(actor, performer)) fail('TASK_INVALID_PERSON', 409, 'Osoba zgłaszająca zadanie nie należy do tego gospodarstwa.');
    person = profilePerson(performer);
  }
  if (!person || !memberForPerson(profiles, person, actor)) fail('TASK_INVALID_PERSON', 409, 'Osoba wykonująca zadanie wymaga aktywnego profilu.');
  const completionRef = context.db.collection('taskCompletions').doc(ref.id);
  const ledgerRef = context.db.collection('taskPointLedger').doc(hash(`task:${ref.id}`));
  const [{ ref: balanceRef, snapshot: balance }, completion, ledger, oldTasks] = await Promise.all([
    ownedBalance(transaction, context.db, actor, person), transaction.get(completionRef), transaction.get(ledgerRef), transaction.get(familyQuery(context.db, 'tasks', actor).where('person', '==', person)),
  ]);
  if (completion.exists) requireLinked(completion.data(), actor, completion.data().taskId === ref.id && completion.data().person === person);
  if (ledger.exists) requireLinked(ledger.data(), actor, ledger.data().taskId === ref.id && ledger.data().person === person);
  if (task.done || completion.exists || ledger.exists) return false;
  const initial = currentBalance(balance, oldTasks.docs.map(item => item.data()).filter(item => sameFamily(actor, item)), person);
  const family = { familyId: explicitFamilyId(actor) };
  const amount = integer(Number(task.points || 0), 10000);
  const nextId = task.repeat && task.repeat !== 'none' ? `repeat-${hash(ref.id).slice(0, 48)}` : null;
  const nextRef = nextId ? context.db.collection('tasks').doc(nextId) : null;
  const next = nextRef ? await transaction.get(nextRef) : null;
  if (next?.exists) requireLinked(next.data(), actor, next.data().previousTaskId === ref.id && next.data().person === task.person);
  transaction.set(balanceRef, { person, ...family, balance: initial.balance + amount, earned: initial.earned + amount,
    spent: initial.spent, completedCount: initial.completedCount + 1, updatedAt: stamp() });
  transaction.create(ledgerRef, { person, ...family, delta: amount, kind: 'earned', taskId: ref.id, title: task.title, actorUid: context.uid, createdAt: stamp() });
  transaction.create(completionRef, { taskId: ref.id, title: task.title, person, ...family, points: amount, submittedBy: task.submittedBy || context.uid,
    approvedBy: parent(actor) ? context.uid : null, verificationMode: taskMode(task), completedAt: stamp() });
  if (nextRef && !next.exists && !task.nextTaskId) {
    const draft = Object.fromEntries(['title', 'person', 'priority', 'note', 'points', 'requireApproval', 'verificationMode', 'repeat', 'familyId'].filter(key => task[key] !== undefined).map(key => [key, task[key]]));
    transaction.create(nextRef, { ...draft, dueDate: nextTaskDueDate(task), repeatAnchorDay: task.repeatAnchorDay || Number((task.dueDate || now.toISOString().slice(0, 10)).slice(-2)),
      serverManaged: true, done: false, approvalStatus: 'none', createdBy: task.createdBy, createdAt: stamp(), updatedAt: stamp(), previousTaskId: ref.id });
  }
  transaction.update(ref, { done: true, approvalStatus: 'approved', completedAt: stamp(), completedBy: context.uid,
    completedPerson: person, pointsBooked: true, proofPath: FieldValue.delete(), proofUploadId: FieldValue.delete(),
    updatedAt: stamp(), ...(nextId ? { nextTaskId: nextId } : {}) });
  return true;
}

async function beginPhoto(context, body, now) {
  fields(body, ['taskId', 'contentType', 'size']);
  if (!validTaskPhotoMetadata(body.contentType, body.size)) fail('TASK_PHOTO_INVALID', 400, 'Wybierz JPG, PNG lub WebP do 8 MB.');
  taskPhotoBucket(context); // Fail before reserving a ticket when Storage is not configured.
  const uploadId = randomUUID();
  let path;
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context);
    const target = await transaction.get(context.db.collection('tasks').doc(taskId(body.taskId)));
    const task = target.exists ? target.data() : null; requireTask(task, actor);
    if (!mayComplete(actor, task) || task.done || task.approvalStatus === 'pending' || taskMode(task) !== 'photo') fail('TASK_PHOTO_FORBIDDEN', 403, 'Zdjęcie można dodać tylko do własnego zadania wymagającego zdjęcia.');
    const existing = await transaction.get(familyQuery(context.db, '_taskPhotoUploads', actor).where('uid', '==', context.uid));
    if (existing.docs.filter(item => item.data().state === 'open' && item.data().expiresAt?.toMillis() > now.getTime()).length >= 8) fail('TASK_UPLOAD_LIMIT', 429, 'Dokończ rozpoczęte przesyłanie lub spróbuj ponownie za chwilę.');
    path = `taskProof/${target.id}/${context.uid}/${uploadId}.${TASK_PHOTO_TYPES[body.contentType]}`;
    transaction.create(context.db.collection('_taskPhotoUploads').doc(uploadId), { taskId: target.id, uid: context.uid, person: task.person,
      familyId: explicitFamilyId(actor),
      path, state: 'open', contentType: body.contentType, size: body.size, expiresAt: Timestamp.fromMillis(now.getTime() + 30 * 60_000),
      orphanAfter: Timestamp.fromMillis(now.getTime() + 24 * 60 * 60_000), createdAt: stamp() });
  });
  return { uploadId, path };
}

async function submit(context, body, now) {
  fields(body, ['taskId', 'uploadId']);
  const ref = context.db.collection('tasks').doc(taskId(body.taskId));
  let ticket;
  if (body.uploadId !== undefined) {
    if (!id(body.uploadId)) fail('TASK_PHOTO_INVALID', 400, 'Nieprawidłowe zgłoszenie zdjęcia.');
    const snapshot = await context.db.collection('_taskPhotoUploads').doc(body.uploadId).get();
    ticket = snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
    if (!ticket || !sameFamily(context.profile, ticket) || ticket.taskId !== ref.id || ticket.uid !== context.uid || !['open', 'submitted'].includes(ticket.state)) fail('TASK_PHOTO_FORBIDDEN', 403, 'To zdjęcie nie należy do Twojego zgłoszenia.');
    const taskSnapshot = await ref.get();
    const task = taskSnapshot.exists ? taskSnapshot.data() : null; requireTask(task, context.profile);
    requireTicket(ticket, context.profile, task, ref.id);
    if (!mayComplete(context.profile, task)) fail('TASK_FORBIDDEN', 403, 'Możesz zgłosić wykonanie własnego zadania.');
    await verifyTaskPhoto(context, ticket);
  }
  let complete = false;
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context);
    const snapshot = await transaction.get(ref);
    const task = snapshot.exists ? snapshot.data() : null; requireTask(task, actor);
    if (!mayComplete(actor, task)) fail('TASK_FORBIDDEN', 403, 'Możesz zgłosić wykonanie własnego zadania.');
    if (task.done || task.approvalStatus === 'pending') return;
    const profiles = await roster(transaction, context.db, actor);
    const tickets = await readTaskPhotoTickets(transaction, context.db, ref.id, actor, task);
    if (taskMode(task) === 'photo') {
      if (!ticket) fail('TASK_PHOTO_REQUIRED', 400, 'To zadanie wymaga przesłania zdjęcia.');
      const latest = await transaction.get(context.db.collection('_taskPhotoUploads').doc(ticket.id));
      const data = latest.exists ? latest.data() : null;
      if (!data || !sameFamily(actor, data) || data.state !== 'open' || data.expiresAt?.toMillis() <= now.getTime() || data.path !== ticket.path || data.uid !== context.uid || data.taskId !== ref.id || data.person !== task.person) fail('TASK_PHOTO_EXPIRED', 409, 'Upłynął czas przesyłania zdjęcia. Dodaj je ponownie.');
      transaction.update(ref, { approvalStatus: 'pending', submittedBy: context.uid, submittedAt: stamp(), proofPath: ticket.path,
        proofUploadId: ticket.id, reworkComment: FieldValue.delete(), updatedAt: stamp() });
      transaction.update(latest.ref, { state: 'submitted', submittedAt: stamp() });
      revokeTaskPhotoTickets(transaction, context, tickets, 'superseded', now, ticket.id);
    } else if (taskMode(task) === 'trust' || parent(actor)) {
      complete = await bookCompletion(transaction, context, ref, { ...task, submittedBy: context.uid }, actor, profiles, now);
      revokeTaskPhotoTickets(transaction, context, tickets, 'approved', now);
    } else {
      transaction.update(ref, { approvalStatus: 'pending', submittedBy: context.uid, submittedAt: stamp(), reworkComment: FieldValue.delete(), updatedAt: stamp() });
      revokeTaskPhotoTickets(transaction, context, tickets, 'verification-changed', now);
    }
  });
  return { taskId: ref.id, completed: complete };
}

async function decideTask(context, body, approve, now) {
  fields(body, approve ? ['taskId'] : ['taskId', 'comment']);
  const ref = context.db.collection('tasks').doc(taskId(body.taskId));
  const comment = approve ? '' : text(body.comment ?? '', 1000, false);
  let ticket; let tickets = []; let completed = false;
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context); requireParent(actor);
    const snapshot = await transaction.get(ref);
    const task = snapshot.exists ? snapshot.data() : null; requireTask(task, actor);
    if (task.done) return;
    if (task.approvalStatus !== 'pending') fail('TASK_NOT_PENDING', 409, 'To zadanie nie oczekuje na zatwierdzenie.');
    const profiles = await roster(transaction, context.db, actor);
    tickets = await readTaskPhotoTickets(transaction, context.db, ref.id, actor, task);
    if (task.proofUploadId) {
      const upload = await transaction.get(context.db.collection('_taskPhotoUploads').doc(task.proofUploadId));
      ticket = upload.exists ? { ...upload.data(), id: upload.id } : null;
      if (!ticket || !sameFamily(actor, ticket) || ticket.state !== 'submitted' || ticket.taskId !== ref.id || ticket.path !== task.proofPath || ticket.uid !== task.submittedBy || ticket.person !== task.person) fail('TASK_PHOTO_INCOMPLETE', 409, 'Nie potwierdzono zdjęcia zgłoszenia.');
    }
    if (approve) {
      if (taskMode(task) === 'photo' && !ticket) fail('TASK_PHOTO_REQUIRED', 409, 'Brakuje wymaganego zdjęcia. Punkty nie zostały przyznane.');
      completed = await bookCompletion(transaction, context, ref, task, actor, profiles, now);
      revokeTaskPhotoTickets(transaction, context, tickets, 'approved', now);
    } else {
      transaction.update(ref, { approvalStatus: 'none', done: false, reworkComment: comment || 'Zadanie wymaga poprawy.',
        proofPath: FieldValue.delete(), proofUploadId: FieldValue.delete(), submittedBy: FieldValue.delete(), submittedAt: FieldValue.delete(), updatedAt: stamp() });
      revokeTaskPhotoTickets(transaction, context, tickets, 'rework', now);
    }
  });
  for (const upload of tickets) await deleteQueuedTaskPhoto(context, upload, now);
  return { taskId: ref.id, completed };
}

async function archiveTask(context, body, now) {
  fields(body, ['taskId', 'confirmed']); if (body.confirmed !== true) fail('TASK_CONFIRMATION_REQUIRED', 400, 'Potwierdź usunięcie zadania z aktywnej listy.');
  const ref = context.db.collection('tasks').doc(taskId(body.taskId)); let tickets = [];
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context); requireParent(actor);
    const snapshot = await transaction.get(ref); const task = snapshot.exists ? snapshot.data() : null;
    if (!task) return; requireTask({ ...task, archived: false }, actor); if (task.archived) return;
    tickets = await readTaskPhotoTickets(transaction, context.db, ref.id, actor, task);
    transaction.update(ref, { archived: true, archivedAt: stamp(), proofPath: FieldValue.delete(), proofUploadId: FieldValue.delete(), updatedAt: stamp() });
    revokeTaskPhotoTickets(transaction, context, tickets, 'archived', now);
  });
  for (const upload of tickets) await deleteQueuedTaskPhoto(context, upload, now);
  return { taskId: ref.id, archived: true };
}

async function beginRewardImage(context, body, now) {
  fields(body, ['rewardId', 'contentType', 'size']);
  if (!validTaskPhotoMetadata(body.contentType, body.size)) fail('TASK_REWARD_IMAGE_INVALID', 400, 'Wybierz zdjęcie nagrody JPG, PNG lub WebP do 8 MB.');
  taskPhotoBucket(context);
  const rewardId = taskId(body.rewardId); const uploadId = randomUUID(); let path;
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context); requireParent(actor);
    const reward = await transaction.get(context.db.collection('taskRewards').doc(rewardId));
    if (reward.exists && !sameFamily(actor, reward.data())) fail('TASK_FORBIDDEN', 403, 'Nagroda należy do innej rodziny.');
    const uploads = await transaction.get(familyQuery(context.db, '_taskRewardImageUploads', actor).where('uid', '==', context.uid));
    if (uploads.docs.filter(item => item.data().state === 'open' && item.data().expiresAt?.toMillis() > now.getTime()).length >= 8) fail('TASK_UPLOAD_LIMIT', 429, 'Dokończ rozpoczęte przesyłanie lub spróbuj ponownie za chwilę.');
    path = `taskRewardImages/${rewardId}/${context.uid}/${uploadId}.${TASK_PHOTO_TYPES[body.contentType]}`;
    transaction.create(context.db.collection('_taskRewardImageUploads').doc(uploadId), {
      rewardId, uid: context.uid, path, state: 'open', people: [], active: false,
      familyId: explicitFamilyId(actor), contentType: body.contentType, size: body.size,
      expiresAt: Timestamp.fromMillis(now.getTime() + 30 * 60_000), orphanAfter: Timestamp.fromMillis(now.getTime() + 86_400_000), createdAt: stamp(),
    });
  });
  return { rewardId, uploadId, path };
}

async function saveReward(context, body, now) {
  fields(body, ['id', 'title', 'note', 'cost', 'people', 'active', 'imageUploadId', 'removeImage']);
  const title = text(body.title, 200); const note = text(body.note, 1000); const cost = integer(body.cost, 100000);
  if (cost < 1 || !Array.isArray(body.people) || body.people.length > 100 || !body.people.every(person => typeof person === 'string') || typeof body.active !== 'boolean') fail('TASK_INVALID_REWARD', 400, 'Nagroda wymaga dodatniego kosztu i poprawnych osób.');
  if (body.removeImage !== undefined && typeof body.removeImage !== 'boolean' || body.imageUploadId && body.removeImage) fail('TASK_INVALID_REWARD', 400, 'Wybierz dodanie albo usunięcie zdjęcia nagrody.');
  const people = [...new Set(body.people)]; const ref = context.db.collection('taskRewards').doc(body.id ? taskId(body.id) : randomUUID());
  let uploaded = null; let replaced = null;
  if (body.imageUploadId !== undefined) {
    requireParent(context.profile);
    const upload = await context.db.collection('_taskRewardImageUploads').doc(taskId(body.imageUploadId)).get();
    uploaded = upload.exists ? { ...upload.data(), id: upload.id } : null;
    if (!uploaded || uploaded.uid !== context.uid || uploaded.rewardId !== ref.id || !sameFamily(context.profile, uploaded)
      || !['open', 'attached'].includes(uploaded.state)) fail('TASK_REWARD_IMAGE_FORBIDDEN', 403, 'To zdjęcie nie należy do tej nagrody.');
    await verifyRewardImage(context, uploaded);
  }
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context); requireParent(actor);
    const profiles = await roster(transaction, context.db, actor);
    if (people.some(person => !memberForPerson(profiles, person, actor))) fail('TASK_INVALID_PERSON', 400, 'Nagrodę można przypisać aktywnym członkom rodziny.');
    const previous = await transaction.get(ref);
    if (previous.exists && !sameFamily(actor, previous.data())) fail('TASK_FORBIDDEN', 403, 'Nagroda należy do innej rodziny.');
    const old = previous.exists ? previous.data() : null;
    const oldTicket = old?.imageUploadId ? await transaction.get(context.db.collection('_taskRewardImageUploads').doc(old.imageUploadId)) : null;
    if (oldTicket?.exists) requireLinked(oldTicket.data(), actor, oldTicket.data().rewardId === ref.id
      && oldTicket.data().path === old.imagePath && oldTicket.data().path?.startsWith(`taskRewardImages/${ref.id}/${oldTicket.data().uid}/${oldTicket.id}.`));
    const newTicket = uploaded ? await transaction.get(context.db.collection('_taskRewardImageUploads').doc(uploaded.id)) : null;
    const image = newTicket?.exists ? { ...newTicket.data(), id: newTicket.id } : null;
    if (uploaded && (!image || image.uid !== context.uid || image.rewardId !== ref.id || image.path !== uploaded.path || !image.path?.startsWith(`taskRewardImages/${ref.id}/${image.uid}/${image.id}.`) || !sameFamily(actor, image)
      || !['open', 'attached'].includes(image.state) || image.state === 'open' && image.expiresAt?.toMillis() <= now.getTime()
      || image.state === 'attached' && old?.imageUploadId !== image.id)) fail('TASK_REWARD_IMAGE_FORBIDDEN', 403, 'Przesłanie zdjęcia wygasło albo zdjęcie nie należy do tej nagrody. Spróbuj ponownie.');
    if (oldTicket?.exists && oldTicket.data().state === 'attached' && (body.removeImage || image && image.id !== oldTicket.id)) {
      replaced = { ...oldTicket.data(), id: oldTicket.id };
      revokeRewardImage(transaction, context.db, replaced, body.removeImage ? 'removed' : 'replaced', now);
    }
    if (image) transaction.update(newTicket.ref, { state: 'attached', people, active: body.active, attachedAt: stamp() });
    else if (!body.removeImage && oldTicket?.exists && oldTicket.data().state === 'attached') {
      transaction.update(oldTicket.ref, { people, active: body.active, updatedAt: stamp() });
    }
    transaction.set(ref, { title, note, cost, people, active: body.active, familyId: explicitFamilyId(actor),
      ...(image ? { imagePath: image.path, imageUploadId: image.id } : body.removeImage ? { imagePath: FieldValue.delete(), imageUploadId: FieldValue.delete() } : {}),
      ...(previous.exists ? {} : { createdBy: context.uid, createdAt: stamp() }), updatedAt: stamp() }, { merge: true });
  });
  if (replaced) await deleteQueuedRewardImage(context, { ...replaced, uploadId: replaced.id }, now);
  return { rewardId: ref.id };
}

async function requestReward(context, body) {
  fields(body, ['rewardId', 'person']); const rewardId = taskId(body.rewardId); let requestId;
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context);
    const person = body.person ? text(body.person, 128) : profilePerson(actor);
    if (person !== profilePerson(actor) && !parent(actor)) fail('TASK_FORBIDDEN', 403, 'Możesz prosić o nagrodę wyłącznie dla siebie.');
    const profiles = await roster(transaction, context.db, actor);
    if (!memberForPerson(profiles, person, actor)) fail('TASK_INVALID_PERSON', 400, 'Wybierz aktywnego członka rodziny.');
    const reward = await transaction.get(context.db.collection('taskRewards').doc(rewardId));
    const definition = reward.exists ? reward.data() : null;
    if (!definition?.active || !sameFamily(actor, definition) || !Array.isArray(definition.people) || definition.people.length && !definition.people.includes(person)) fail('TASK_REWARD_NOT_AVAILABLE', 404, 'Ta nagroda nie jest dostępna dla wybranej osoby.');
    const { ref: pendingRef, snapshot: pending } = await ownedPending(transaction, context.db, actor, person, rewardId);
    if (pending.exists) {
      const linked = await transaction.get(context.db.collection('taskRewardRequests').doc(pending.data().requestId));
      requireLinked(linked.exists ? linked.data() : null, actor, linked.data()?.person === person && linked.data()?.rewardId === rewardId && linked.data()?.state === 'pending');
      requestId = pending.data().requestId; return;
    }
    requestId = randomUUID();
    transaction.create(context.db.collection('taskRewardRequests').doc(requestId), { rewardId, person, uid: context.uid, title: definition.title,
      cost: definition.cost, state: 'pending', familyId: explicitFamilyId(actor), requestedAt: stamp() });
    transaction.create(pendingRef, { requestId, person, rewardId, familyId: explicitFamilyId(actor) });
  });
  return { requestId };
}

async function decideReward(context, body) {
  fields(body, ['requestId', 'approved']); if (typeof body.approved !== 'boolean') fail('TASK_INVALID_REQUEST', 400, 'Wybierz zatwierdzenie lub odmowę.');
  const ref = context.db.collection('taskRewardRequests').doc(taskId(body.requestId)); let accepted = false;
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context); requireParent(actor);
    const snapshot = await transaction.get(ref); const request = snapshot.exists ? snapshot.data() : null;
    if (!request || !sameFamily(actor, request)) fail('TASK_REWARD_REQUEST_NOT_FOUND', 404, 'Nie znaleziono prośby o nagrodę.');
    if (request.state !== 'pending') { accepted = request.state === 'approved'; return; }
    const profiles = await roster(transaction, context.db, actor);
    if (!memberForPerson(profiles, request.person, actor)) fail('TASK_INVALID_PERSON', 409, 'Osoba nie należy do aktywnego gospodarstwa.');
    const ledgerRef = context.db.collection('taskPointLedger').doc(hash(`reward:${ref.id}`));
    const [{ ref: balanceRef, snapshot: balance }, ledger, oldTasks, pending, reward] = await Promise.all([
      ownedBalance(transaction, context.db, actor, request.person), transaction.get(ledgerRef),
      transaction.get(familyQuery(context.db, 'tasks', actor).where('person', '==', request.person)),
      ownedPending(transaction, context.db, actor, request.person, request.rewardId),
      transaction.get(context.db.collection('taskRewards').doc(taskId(request.rewardId))),
    ]);
    requireLinked(reward.exists ? reward.data() : null, actor);
    if (ledger.exists) { requireLinked(ledger.data(), actor, ledger.data().rewardRequestId === ref.id && ledger.data().person === request.person); return; }
    if (pending.snapshot.exists) requireLinked(pending.snapshot.data(), actor, pending.snapshot.data().requestId === ref.id);
    integer(request.cost, 100000);
    if (request.cost < 1) fail('TASK_INVALID_REWARD', 409, 'Nieprawidłowy koszt nagrody.');
    const initial = currentBalance(balance, oldTasks.docs.map(item => item.data()).filter(item => sameFamily(actor, item)), request.person);
    const family = { familyId: explicitFamilyId(actor) };
    if (body.approved && initial.balance < request.cost) fail('TASK_NOT_ENOUGH_POINTS', 409, 'Za mało punktów. Prośba pozostaje do decyzji, saldo nie zostało zmienione.');
    if (body.approved) {
      transaction.set(balanceRef, { person: request.person, ...family, ...initial, balance: initial.balance - request.cost, spent: initial.spent + request.cost, updatedAt: stamp() });
      transaction.create(ledgerRef, { person: request.person, ...family, delta: -request.cost, kind: 'redeemed', rewardRequestId: ref.id, title: request.title, actorUid: context.uid, createdAt: stamp() });
    }
    transaction.update(ref, { state: body.approved ? 'approved' : 'rejected', decidedBy: context.uid, decidedAt: stamp() });
    if (pending.snapshot.exists) transaction.delete(pending.ref);
    accepted = body.approved;
  });
  return { requestId: ref.id, approved: accepted };
}

const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : 0;
async function state(context, body) {
  fields(body, []);
  const actorSnap = await context.db.collection('members').doc(context.uid).get();
  const actor = actorSnap.exists ? actorSnap.data() : null;
  if (!active(actor) || !sameFamily(actor, context.profile)) fail('TASK_MEMBER_REQUIRED', 403, 'Profil nie ma aktywnego dostępu do zadań.');
  const [members, tasks, balances, rewards, requests, ledger, imageUploads] = await Promise.all(
    ['members', 'tasks', 'taskPointBalances', 'taskRewards', 'taskRewardRequests', 'taskPointLedger', '_taskRewardImageUploads'].map(name => familyQuery(context.db, name, actor).get()),
  );
  const images = new Map(imageUploads.docs.map(item => [item.id, { ...item.data(), id: item.id }]));
  const visibleImage = reward => {
    const image = images.get(reward.imageUploadId);
    return typeof reward.imagePath === 'string' && image && sameFamily(actor, image)
      && image.state === 'attached' && image.rewardId === reward.id && image.path === reward.imagePath
      && image.path.startsWith(`taskRewardImages/${reward.id}/${image.uid}/${image.id}.`)
      && (parent(actor) || image.active === true && (!image.people?.length || image.people.includes(profilePerson(actor))));
  };
  const allTasks = tasks.docs.map(item => ({ ...item.data(), id: item.id })).filter(task => sameFamily(actor, task));
  const balanceRows = balances.docs.map(item => item.data()).filter(entry => sameFamily(actor, entry));
  const people = members.docs.map(item => ({ ...item.data(), uid: item.id })).filter(profile => usableProfile(profile) && sameFamily(actor, profile));
  const familyPeople = new Set(people.map(profilePerson));
  let storageConfigured = true; try { taskPhotoBucket(context); } catch { storageConfigured = false; }
  const own = profilePerson(actor);
  return { storageConfigured, balances: people.map(profile => {
    const person = profilePerson(profile); const stored = balanceRows.find(balance => balance.person === person);
    return { person, name: profile.name || person, ...(stored ? { balance: stored.balance, earned: stored.earned, spent: stored.spent, completedCount: stored.completedCount }
      : { balance: legacyTaskPoints(allTasks, person), earned: legacyTaskPoints(allTasks, person), spent: 0, completedCount: allTasks.filter(task => task.person === person && task.done).length }) };
  }), rewards: rewards.docs.map(item => ({ ...item.data(), id: item.id })).filter(reward => sameFamily(actor, reward) && (parent(actor) || reward.active && (!reward.people?.length || reward.people.includes(own))))
    .map(reward => ({ id: reward.id, title: reward.title, note: reward.note || '', cost: reward.cost, people: reward.people || [], active: reward.active === true,
      ...(visibleImage(reward) ? { imagePath: reward.imagePath } : {}) })),
  requests: requests.docs.map(item => ({ ...item.data(), id: item.id })).filter(request => sameFamily(actor, request) && (parent(actor) || request.person === own))
    .sort((a, b) => millis(b.requestedAt) - millis(a.requestedAt)).slice(0, 100).map(request => ({ id: request.id, rewardId: request.rewardId, person: request.person,
      title: request.title, cost: request.cost, state: request.state, requestedAt: millis(request.requestedAt), decidedAt: millis(request.decidedAt) })),
  history: ledger.docs.map(item => ({ ...item.data(), id: item.id })).filter(entry => sameFamily(actor, entry) && familyPeople.has(entry.person) && (parent(actor) || entry.person === own))
    .sort((a, b) => millis(b.createdAt) - millis(a.createdAt)).slice(0, 100).map(entry => ({ id: entry.id, person: entry.person, delta: entry.delta, kind: entry.kind, title: entry.title, createdAt: millis(entry.createdAt) })) };
}

/** Called only after the shared family endpoint verifies the current Firebase UID. */
export async function manageTasksAction(context, body, { now = new Date() } = {}) {
  if (!active(context.profile) || !explicitFamilyId(context.profile)) fail('TASK_MEMBER_REQUIRED', 403, 'Profil nie ma aktywnego dostępu do zadań.');
  switch (body?.action) {
    case 'state': return state(context, body);
    case 'save-task': return saveTask(context, body, now);
    case 'archive-task': return archiveTask(context, body, now);
    case 'begin-photo': return beginPhoto(context, body, now);
    case 'submit': return submit(context, body, now);
    case 'approve': return decideTask(context, body, true, now);
    case 'rework': return decideTask(context, body, false, now);
    case 'begin-reward-image': return beginRewardImage(context, body, now);
    case 'save-reward': return saveReward(context, body, now);
    case 'request-reward': return requestReward(context, body);
    case 'decide-reward': return decideReward(context, body);
    default: fail('TASK_INVALID_REQUEST', 400, 'Wybierz poprawną operację zadań.');
  }
}
