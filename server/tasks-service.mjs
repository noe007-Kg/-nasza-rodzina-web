import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';
import { TASK_PHOTO_TYPES, validTaskPhotoMetadata, taskPhotoBucket, verifyTaskPhoto, enqueueTaskPhotoCleanup, deleteQueuedTaskPhoto } from './tasks-photos.mjs';
export { runTaskPhotoCleanup } from './tasks-photos.mjs';

const fail = (code, status, message) => { throw new EduServerError(code, status, message); };
const active = profile => profile?.active === true && profile.canLogin === true && profile.archived !== true && ['parent', 'adult', 'child'].includes(profile.role);
const parent = profile => active(profile) && profile.role === 'parent';
const profilePerson = profile => String(profile?.personKey || profile?.name || '');
const usableProfile = profile => profile?.active === true && profile.archived !== true;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const stamp = () => FieldValue.serverTimestamp();
const personId = person => `person-${hash(person)}`;

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
function sameFamily(actor, record) { return !record?.familyId || typeof actor?.familyId === 'string' && actor.familyId === record.familyId; }

async function freshActor(transaction, context) {
  const snapshot = await transaction.get(context.db.collection('members').doc(context.uid));
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!active(profile) || !sameFamily(profile, context.profile)) fail('TASK_MEMBER_REQUIRED', 403, 'Profil nie ma aktywnego dostępu do zadań.');
  return profile;
}
async function roster(transaction, db) {
  const snapshot = await transaction.get(db.collection('members'));
  return new Map(snapshot.docs.map(item => [item.id, item.data()]));
}
function memberForPerson(profiles, person, actor) {
  return [...profiles.entries()].find(([, profile]) => usableProfile(profile) && profilePerson(profile) === person && sameFamily(actor, profile));
}
function mayComplete(actor, task) { return parent(actor) || task.person === profilePerson(actor) || task.person === 'family'; }
function requireTask(task, actor) {
  if (!task || task.archived === true || !sameFamily(actor, task)) fail('TASK_NOT_FOUND', 404, 'Nie znaleziono dostępnego zadania.');
}
function requireParent(actor) { if (!parent(actor)) fail('TASK_PARENT_REQUIRED', 403, 'Tę czynność zatwierdza aktywny rodzic.'); }

async function readTaskPhotoTickets(transaction, db, task) {
  const uploads = await transaction.get(db.collection('_taskPhotoUploads').where('taskId', '==', task));
  return uploads.docs.map(item => ({ id: item.id, ...item.data() })).filter(ticket => ['open', 'submitted'].includes(ticket.state));
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
  return data ? { balance: Number(data.balance || 0), earned: Number(data.earned || 0), spent: Number(data.spent || 0), completedCount: Number(data.completedCount || 0) }
    : { balance: legacyTaskPoints(legacy, person), earned: legacyTaskPoints(legacy, person), spent: 0, completedCount: legacy.filter(task => task.person === person && task.done && task.pointsBooked !== true).length };
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
    const profiles = await roster(transaction, context.db);
    if (draft.person !== 'family' && !memberForPerson(profiles, draft.person, actor)) fail('TASK_INVALID_PERSON', 400, 'Wybierz aktywnego członka rodziny.');
    const previous = await transaction.get(ref);
    if (previous.exists) {
      const task = previous.data(); requireTask(task, actor);
      if (task.done || task.approvalStatus === 'pending') fail('TASK_ALREADY_SUBMITTED', 409, 'Zatwierdzonego lub zgłoszonego zadania nie można zmienić.');
      if (!parent(actor) && (task.createdBy !== context.uid || task.points !== 0 || !mayComplete(actor, task))) requireParent(actor);
      const invalidatesProof = task.person !== draft.person || taskMode(task) !== draft.verificationMode;
      const tickets = invalidatesProof ? await readTaskPhotoTickets(transaction, context.db, ref.id) : [];
      transaction.update(ref, { ...draft, serverManaged: true, updatedAt: stamp() });
      revokeTaskPhotoTickets(transaction, context, tickets, 'assignment-changed', now);
    } else {
      transaction.create(ref, { ...draft, serverManaged: true, done: false, approvalStatus: 'none', archived: false,
        ...(actor.familyId ? { familyId: actor.familyId } : {}), createdBy: context.uid, createdAt: stamp(), updatedAt: stamp() });
    }
  });
  return { taskId: ref.id };
}

/** All reads precede writes, including legacy opening balances and recurrence. */
async function bookCompletion(transaction, context, ref, task, actor, profiles, now) {
  let person = task.person;
  if (person === 'family') {
    const performer = profiles.get(task.submittedBy || context.uid);
    person = profilePerson(performer);
  }
  if (!person || !memberForPerson(profiles, person, actor)) fail('TASK_INVALID_PERSON', 409, 'Osoba wykonująca zadanie wymaga aktywnego profilu.');
  const completionRef = context.db.collection('taskCompletions').doc(ref.id);
  const ledgerRef = context.db.collection('taskPointLedger').doc(hash(`task:${ref.id}`));
  const balanceRef = context.db.collection('taskPointBalances').doc(personId(person));
  const [completion, ledger, balance, oldTasks] = await Promise.all([
    transaction.get(completionRef), transaction.get(ledgerRef), transaction.get(balanceRef), transaction.get(context.db.collection('tasks').where('person', '==', person)),
  ]);
  if (task.done || completion.exists || ledger.exists) return false;
  if (balance.exists && !sameFamily(actor, balance.data())) fail('TASK_FORBIDDEN', 403, 'Saldo należy do innej rodziny.');
  const initial = currentBalance(balance, oldTasks.docs.map(item => item.data()).filter(item => sameFamily(actor, item)), person);
  const family = actor.familyId ? { familyId: actor.familyId } : {};
  const amount = integer(Number(task.points || 0), 10000);
  const nextId = task.repeat && task.repeat !== 'none' ? `repeat-${hash(ref.id).slice(0, 48)}` : null;
  const nextRef = nextId ? context.db.collection('tasks').doc(nextId) : null;
  const next = nextRef ? await transaction.get(nextRef) : null;
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
    const existing = await transaction.get(context.db.collection('_taskPhotoUploads').where('uid', '==', context.uid));
    if (existing.docs.filter(item => item.data().state === 'open' && item.data().expiresAt?.toMillis() > now.getTime()).length >= 8) fail('TASK_UPLOAD_LIMIT', 429, 'Dokończ rozpoczęte przesyłanie lub spróbuj ponownie za chwilę.');
    path = `taskProof/${target.id}/${context.uid}/${uploadId}.${TASK_PHOTO_TYPES[body.contentType]}`;
    transaction.create(context.db.collection('_taskPhotoUploads').doc(uploadId), { taskId: target.id, uid: context.uid, person: task.person,
      ...(actor.familyId ? { familyId: actor.familyId } : {}),
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
    ticket = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    if (!ticket || ticket.taskId !== ref.id || ticket.uid !== context.uid || !['open', 'submitted'].includes(ticket.state)) fail('TASK_PHOTO_FORBIDDEN', 403, 'To zdjęcie nie należy do Twojego zgłoszenia.');
    await verifyTaskPhoto(context, ticket);
  }
  let complete = false;
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context);
    const snapshot = await transaction.get(ref);
    const task = snapshot.exists ? snapshot.data() : null; requireTask(task, actor);
    if (!mayComplete(actor, task)) fail('TASK_FORBIDDEN', 403, 'Możesz zgłosić wykonanie własnego zadania.');
    if (task.done || task.approvalStatus === 'pending') return;
    const profiles = await roster(transaction, context.db);
    const tickets = await readTaskPhotoTickets(transaction, context.db, ref.id);
    if (taskMode(task) === 'photo') {
      if (!ticket) fail('TASK_PHOTO_REQUIRED', 400, 'To zadanie wymaga przesłania zdjęcia.');
      const latest = await transaction.get(context.db.collection('_taskPhotoUploads').doc(ticket.id));
      const data = latest.exists ? latest.data() : null;
      if (!data || data.state !== 'open' || data.expiresAt?.toMillis() <= now.getTime() || data.path !== ticket.path || data.uid !== context.uid || data.taskId !== ref.id || data.person !== task.person) fail('TASK_PHOTO_EXPIRED', 409, 'Upłynął czas przesyłania zdjęcia. Dodaj je ponownie.');
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
    const profiles = await roster(transaction, context.db);
    tickets = await readTaskPhotoTickets(transaction, context.db, ref.id);
    if (task.proofUploadId) {
      const upload = await transaction.get(context.db.collection('_taskPhotoUploads').doc(task.proofUploadId));
      ticket = upload.exists ? { id: upload.id, ...upload.data() } : null;
      if (!ticket || ticket.state !== 'submitted' || ticket.taskId !== ref.id || ticket.path !== task.proofPath) fail('TASK_PHOTO_INCOMPLETE', 409, 'Nie potwierdzono zdjęcia zgłoszenia.');
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
    if (!task || task.archived) return; requireTask(task, actor);
    tickets = await readTaskPhotoTickets(transaction, context.db, ref.id);
    transaction.update(ref, { archived: true, archivedAt: stamp(), proofPath: FieldValue.delete(), proofUploadId: FieldValue.delete(), updatedAt: stamp() });
    revokeTaskPhotoTickets(transaction, context, tickets, 'archived', now);
  });
  for (const upload of tickets) await deleteQueuedTaskPhoto(context, upload, now);
  return { taskId: ref.id, archived: true };
}

async function saveReward(context, body) {
  fields(body, ['id', 'title', 'note', 'cost', 'people', 'active']);
  const title = text(body.title, 200); const note = text(body.note ?? '', 1000, false); const cost = integer(body.cost, 100000);
  if (cost < 1 || !Array.isArray(body.people) || body.people.length > 100 || !body.people.every(person => typeof person === 'string') || typeof body.active !== 'boolean') fail('TASK_INVALID_REWARD', 400, 'Nagroda wymaga dodatniego kosztu i poprawnych osób.');
  const people = [...new Set(body.people)]; const ref = context.db.collection('taskRewards').doc(body.id ? taskId(body.id) : randomUUID());
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context); requireParent(actor);
    const profiles = await roster(transaction, context.db);
    if (people.some(person => !memberForPerson(profiles, person, actor))) fail('TASK_INVALID_PERSON', 400, 'Nagrodę można przypisać aktywnym członkom rodziny.');
    const previous = await transaction.get(ref);
    if (previous.exists && !sameFamily(actor, previous.data())) fail('TASK_FORBIDDEN', 403, 'Nagroda należy do innej rodziny.');
    transaction.set(ref, { title, note, cost, people, active: body.active, ...(actor.familyId ? { familyId: actor.familyId } : {}),
      ...(previous.exists ? {} : { createdBy: context.uid, createdAt: stamp() }), updatedAt: stamp() }, { merge: true });
  });
  return { rewardId: ref.id };
}

async function requestReward(context, body) {
  fields(body, ['rewardId', 'person']); const rewardId = taskId(body.rewardId); let requestId;
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context);
    const person = body.person ? text(body.person, 128) : profilePerson(actor);
    if (person !== profilePerson(actor) && !parent(actor)) fail('TASK_FORBIDDEN', 403, 'Możesz prosić o nagrodę wyłącznie dla siebie.');
    const profiles = await roster(transaction, context.db);
    if (!memberForPerson(profiles, person, actor)) fail('TASK_INVALID_PERSON', 400, 'Wybierz aktywnego członka rodziny.');
    const reward = await transaction.get(context.db.collection('taskRewards').doc(rewardId));
    const definition = reward.exists ? reward.data() : null;
    if (!definition?.active || !sameFamily(actor, definition) || definition.people.length && !definition.people.includes(person)) fail('TASK_REWARD_NOT_AVAILABLE', 404, 'Ta nagroda nie jest dostępna dla wybranej osoby.');
    const pendingRef = context.db.collection('_taskRewardPending').doc(hash(`${person}:${rewardId}`));
    const pending = await transaction.get(pendingRef);
    if (pending.exists) { requestId = pending.data().requestId; return; }
    requestId = randomUUID();
    transaction.create(context.db.collection('taskRewardRequests').doc(requestId), { rewardId, person, uid: context.uid, title: definition.title,
      cost: definition.cost, state: 'pending', ...(actor.familyId ? { familyId: actor.familyId } : {}), requestedAt: stamp() });
    transaction.create(pendingRef, { requestId, person, rewardId });
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
    const balanceRef = context.db.collection('taskPointBalances').doc(personId(request.person));
    const ledgerRef = context.db.collection('taskPointLedger').doc(hash(`reward:${ref.id}`));
    const [balance, ledger, oldTasks] = await Promise.all([transaction.get(balanceRef), transaction.get(ledgerRef), transaction.get(context.db.collection('tasks').where('person', '==', request.person))]);
    if (ledger.exists) return;
    if (balance.exists && !sameFamily(actor, balance.data())) fail('TASK_FORBIDDEN', 403, 'Saldo należy do innej rodziny.');
    const initial = currentBalance(balance, oldTasks.docs.map(item => item.data()).filter(item => sameFamily(actor, item)), request.person);
    const family = actor.familyId ? { familyId: actor.familyId } : {};
    if (body.approved && initial.balance < request.cost) fail('TASK_NOT_ENOUGH_POINTS', 409, 'Za mało punktów. Prośba pozostaje do decyzji, saldo nie zostało zmienione.');
    if (body.approved) {
      transaction.set(balanceRef, { person: request.person, ...family, ...initial, balance: initial.balance - request.cost, spent: initial.spent + request.cost, updatedAt: stamp() });
      transaction.create(ledgerRef, { person: request.person, ...family, delta: -request.cost, kind: 'redeemed', rewardRequestId: ref.id, title: request.title, actorUid: context.uid, createdAt: stamp() });
    }
    transaction.update(ref, { state: body.approved ? 'approved' : 'rejected', decidedBy: context.uid, decidedAt: stamp() });
    transaction.delete(context.db.collection('_taskRewardPending').doc(hash(`${request.person}:${request.rewardId}`)));
    accepted = body.approved;
  });
  return { requestId: ref.id, approved: accepted };
}

const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : 0;
async function state(context, body) {
  fields(body, []);
  const [members, tasks, balances, rewards, requests, ledger] = await Promise.all([
    context.db.collection('members').get(), context.db.collection('tasks').get(), context.db.collection('taskPointBalances').get(),
    context.db.collection('taskRewards').get(), context.db.collection('taskRewardRequests').get(), context.db.collection('taskPointLedger').get(),
  ]);
  const actorSnap = members.docs.find(item => item.id === context.uid); const actor = actorSnap?.data();
  if (!active(actor) || !sameFamily(actor, context.profile)) fail('TASK_MEMBER_REQUIRED', 403, 'Profil nie ma aktywnego dostępu do zadań.');
  const allTasks = tasks.docs.map(item => ({ id: item.id, ...item.data() })).filter(task => sameFamily(actor, task));
  const balanceRows = balances.docs.map(item => item.data()).filter(entry => sameFamily(actor, entry));
  const people = members.docs.map(item => ({ uid: item.id, ...item.data() })).filter(profile => usableProfile(profile) && sameFamily(actor, profile));
  const familyPeople = new Set(people.map(profilePerson));
  let storageConfigured = true; try { taskPhotoBucket(context); } catch { storageConfigured = false; }
  const own = profilePerson(actor);
  return { storageConfigured, balances: people.map(profile => {
    const person = profilePerson(profile); const stored = balanceRows.find(balance => balance.person === person);
    return { person, name: profile.name || person, ...(stored ? { balance: stored.balance, earned: stored.earned, spent: stored.spent, completedCount: stored.completedCount }
      : { balance: legacyTaskPoints(allTasks, person), earned: legacyTaskPoints(allTasks, person), spent: 0, completedCount: allTasks.filter(task => task.person === person && task.done).length }) };
  }), rewards: rewards.docs.map(item => ({ id: item.id, ...item.data() })).filter(reward => sameFamily(actor, reward) && (parent(actor) || reward.active && (!reward.people?.length || reward.people.includes(own))))
    .map(reward => ({ id: reward.id, title: reward.title, note: reward.note || '', cost: reward.cost, people: reward.people || [], active: reward.active === true })),
  requests: requests.docs.map(item => ({ id: item.id, ...item.data() })).filter(request => sameFamily(actor, request) && (parent(actor) || request.person === own))
    .sort((a, b) => millis(b.requestedAt) - millis(a.requestedAt)).slice(0, 100).map(request => ({ id: request.id, rewardId: request.rewardId, person: request.person,
      title: request.title, cost: request.cost, state: request.state, requestedAt: millis(request.requestedAt), decidedAt: millis(request.decidedAt) })),
  history: ledger.docs.map(item => ({ id: item.id, ...item.data() })).filter(entry => sameFamily(actor, entry) && familyPeople.has(entry.person) && (parent(actor) || entry.person === own))
    .sort((a, b) => millis(b.createdAt) - millis(a.createdAt)).slice(0, 100).map(entry => ({ id: entry.id, person: entry.person, delta: entry.delta, kind: entry.kind, title: entry.title, createdAt: millis(entry.createdAt) })) };
}

/** Called only after the shared family endpoint verifies the current Firebase UID. */
export async function manageTasksAction(context, body, { now = new Date() } = {}) {
  if (!active(context.profile)) fail('TASK_MEMBER_REQUIRED', 403, 'Profil nie ma aktywnego dostępu do zadań.');
  switch (body?.action) {
    case 'state': return state(context, body);
    case 'save-task': return saveTask(context, body, now);
    case 'archive-task': return archiveTask(context, body, now);
    case 'begin-photo': return beginPhoto(context, body, now);
    case 'submit': return submit(context, body, now);
    case 'approve': return decideTask(context, body, true, now);
    case 'rework': return decideTask(context, body, false, now);
    case 'save-reward': return saveReward(context, body);
    case 'request-reward': return requestReward(context, body);
    case 'decide-reward': return decideReward(context, body);
    default: fail('TASK_INVALID_REQUEST', 400, 'Wybierz poprawną operację zadań.');
  }
}
