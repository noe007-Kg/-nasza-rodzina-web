import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';
import { canReadFinanceBill, financeActiveMember, financeCurrentPeriod, financeFamilyId,
  financeParent, financePeriodDate, financeSameFamily, financeTotals, financeWarsawDate,
  FINANCE_MAX_AMOUNT_GROSZE, FINANCE_RECURRENCES, safeFinancePaymentUrl, validFinanceDate, validFinanceId } from './finance-model.mjs';

const fail = (code, status, message) => { throw new EduServerError(code, status, message); };
const stamp = () => FieldValue.serverTimestamp();
const digest = value => createHash('sha256').update(value).digest('hex');
function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['action', 'operation', ...allowed].includes(key))) {
    fail('FINANCE_INVALID_REQUEST', 400, 'Sprawdź dane rachunku.');
  }
}
function text(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || required && !value.trim()) fail('FINANCE_INVALID_REQUEST', 400, 'Uzupełnij poprawnie pola rachunku.');
  return value.trim();
}
function billId(value) {
  if (!validFinanceId(value)) fail('FINANCE_INVALID_REQUEST', 400, 'Nieprawidłowy rachunek.');
  return value;
}
function requireParent(actor) { if (!financeParent(actor)) fail('FINANCE_PARENT_REQUIRED', 403, 'Rachunkami zarządza uprawniony rodzic.'); }
async function freshActor(transaction, context) {
  const member = await transaction.get(context.db.collection('members').doc(context.uid));
  const actor = member.exists ? { ...member.data(), id: context.uid } : null;
  if (!financeActiveMember(actor)) fail('FINANCE_MEMBER_REQUIRED', 403, 'Profil nie ma aktywnego dostępu do finansów.');
  if (!financeFamilyId(actor)) fail('FINANCE_FAMILY_NOT_CONFIGURED', 403,
    'Finanse wymagają zweryfikowanego przypisania konta do gospodarstwa. Administrator musi uzupełnić konfigurację rodziny. Dane nie zostały zmienione.');
  if (!financeSameFamily(actor, context.profile)) fail('FINANCE_MEMBER_REQUIRED', 403, 'Profil nie ma aktywnego dostępu do finansów.');
  return actor;
}
function requireBill(value, actor) {
  if (!canReadFinanceBill(actor, value)) fail('FINANCE_NOT_FOUND', 404, 'Nie znaleziono dostępnego rachunku.');
}
function serializeBill(snapshot) {
  const value = snapshot.data();
  const keys = ['title', 'category', 'amountGrosze', 'dueDate', 'recipient', 'bankAccount', 'transferTitle', 'note',
    'paymentUrl', 'recurrence', 'calendarEnabled', 'sharedWith', 'familyId', 'ownerUid', 'status', 'seriesId', 'periodIndex', 'anchorDueDate'];
  const row = { id: snapshot.id, ...Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) };
  for (const key of ['createdAt', 'updatedAt', 'paidAt']) row[key] = value[key]?.toDate?.().toISOString() || null;
  return row;
}
export function validateFinanceDraft(body) {
  fields(body, ['id', 'title', 'category', 'amountGrosze', 'dueDate', 'recipient', 'bankAccount', 'transferTitle',
    'note', 'paymentUrl', 'recurrence', 'calendarEnabled', 'sharedWith']);
  const paymentUrl = safeFinancePaymentUrl(body.paymentUrl ?? '');
  if (!Number.isSafeInteger(body.amountGrosze) || body.amountGrosze <= 0 || body.amountGrosze > FINANCE_MAX_AMOUNT_GROSZE
    || !validFinanceDate(body.dueDate) || !FINANCE_RECURRENCES.includes(body.recurrence)
    || typeof body.calendarEnabled !== 'boolean' || !Array.isArray(body.sharedWith) || body.sharedWith.length > 30
    || body.sharedWith.some(uid => !validFinanceId(uid)) || paymentUrl === null) {
    fail('FINANCE_INVALID_REQUEST', 400, 'Sprawdź kwotę, termin i ustawienia rachunku. Link płatności musi używać HTTPS.');
  }
  const bankAccount = text(body.bankAccount ?? '', 80, false);
  if (bankAccount && !/^[A-Za-z0-9 -]+$/.test(bankAccount)) fail('FINANCE_INVALID_REQUEST', 400, 'Sprawdź numer rachunku bankowego.');
  return { title: text(body.title, 300), category: text(body.category ?? 'Inne', 80), amountGrosze: body.amountGrosze,
    dueDate: body.dueDate, recipient: text(body.recipient ?? '', 300, false), bankAccount,
    transferTitle: text(body.transferTitle ?? '', 300, false), note: text(body.note ?? '', 4000, false), paymentUrl,
    recurrence: body.recurrence, calendarEnabled: body.calendarEnabled, sharedWith: [...new Set(body.sharedWith)] };
}

async function state(context, body) {
  fields(body, []);
  return context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context);
    const snapshot = await transaction.get(context.db.collection('financeBills').where('familyId', '==', financeFamilyId(actor)).limit(5001));
    if (snapshot.size > 5000) fail('FINANCE_LIMIT', 503, 'Lista rachunków wymaga podziału na mniejsze zakresy.');
    const bills = snapshot.docs.filter(item => canReadFinanceBill(actor, item.data())).map(serializeBill)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
    return { bills, history: bills.filter(bill => bill.status === 'paid'), totals: financeTotals(bills) };
  });
}
function audit(transaction, context, id, actor, kind, value) {
  transaction.create(context.db.collection('financeBillAudit').doc(id), { billId: value.billId,
    familyId: financeFamilyId(actor), actorUid: actor.id, kind, ...value, createdAt: stamp() });
}
async function save(context, body) {
  const draft = validateFinanceDraft(body);
  const ref = context.db.collection('financeBills').doc(body.id ? billId(body.id) : randomUUID());
  await context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context); requireParent(actor);
    const [previous, ...members] = await transaction.getAll(ref, ...draft.sharedWith.map(uid => context.db.collection('members').doc(uid)));
    if (members.some(member => !member.exists || !financeActiveMember(member.data()) || member.data().role !== 'child'
      || !financeSameFamily(actor, member.data()))) fail('FINANCE_INVALID_RECIPIENT', 400, 'Udostępnienie dotyczy wyłącznie wybranego dziecka w Twojej rodzinie.');
    if (previous.exists) {
      const old = previous.data(); requireBill(old, actor);
      if (old.status === 'paid') fail('FINANCE_ALREADY_PAID', 409, 'Opłacony rachunek pozostaje w historii bez zmiany kwoty i terminu.');
      if (old.recurrence !== draft.recurrence) fail('FINANCE_SERIES_CHANGED', 409, 'Częstotliwość istniejącej serii pozostaje bez zmian. Utwórz osobną serię.');
      if (Object.keys(draft).every(key => JSON.stringify(draft[key]) === JSON.stringify(old[key]))) return;
      transaction.update(ref, { ...draft, updatedAt: stamp() });
      audit(transaction, context, randomUUID(), actor, 'edited', { billId: ref.id, amountGrosze: draft.amountGrosze, dueDate: draft.dueDate });
    } else {
      transaction.create(ref, { ...draft, familyId: financeFamilyId(actor), ownerUid: context.uid, status: 'unpaid',
        seriesId: ref.id, periodIndex: 0, anchorDueDate: draft.dueDate, archived: false,
        createdAt: stamp(), updatedAt: stamp(), paidAt: null });
      audit(transaction, context, `created-${digest(ref.id)}`, actor, 'created', { billId: ref.id, amountGrosze: draft.amountGrosze, dueDate: draft.dueDate });
    }
  });
  return { billId: ref.id };
}
async function markPaid(context, body) {
  fields(body, ['billId']);
  const ref = context.db.collection('financeBills').doc(billId(body.billId));
  let changed = false;
  await context.db.runTransaction(async transaction => {
    changed = false;
    const actor = await freshActor(transaction, context); requireParent(actor);
    const record = await transaction.get(ref);
    const bill = record.exists ? record.data() : null; requireBill(bill, actor);
    if (bill.status === 'paid') return;
    transaction.update(ref, { status: 'paid', paidAt: stamp(), paidBy: context.uid, updatedAt: stamp() });
    audit(transaction, context, `paid-${digest(ref.id)}`, actor, 'paid', { billId: ref.id, amountGrosze: bill.amountGrosze, dueDate: bill.dueDate });
    changed = true;
  });
  return { billId: ref.id, paid: true, changed };
}

export function financePeriodId(seriesId, periodIndex) { return periodIndex === 0 ? seriesId : `period-${digest(`${seriesId}:${periodIndex}`)}`; }
function recurrenceDraft(bill, periodIndex) {
  const keys = ['title', 'category', 'amountGrosze', 'recipient', 'bankAccount', 'transferTitle', 'note', 'paymentUrl',
    'recurrence', 'calendarEnabled', 'familyId', 'ownerUid', 'seriesId', 'anchorDueDate'];
  const dueDate = financePeriodDate(bill.anchorDueDate, bill.recurrence, periodIndex);
  if (!dueDate) fail('FINANCE_INVALID_SERIES', 409, 'Nie można utworzyć kolejnego okresu rachunku.');
  // Sharing is consent for this individual bill, never an inherited series ACL.
  return { ...Object.fromEntries(keys.map(key => [key, bill[key]])), sharedWith: [], dueDate, periodIndex, status: 'unpaid', archived: false,
    paidAt: null, createdAt: stamp(), updatedAt: stamp() };
}
/** All period IDs are anchored to the original series, not execution time. */
async function createPeriods(transaction, context, bill, indices) {
  const refs = indices.map(index => context.db.collection('financeBills').doc(financePeriodId(bill.seriesId, index)));
  const existing = await transaction.getAll(...refs);
  const drafts = indices.map(index => recurrenceDraft(bill, index));
  let created = 0;
  for (let i = 0; i < refs.length; i += 1) {
    if (existing[i].exists) {
      const current = existing[i].data();
      if (current.seriesId !== bill.seriesId || current.familyId !== bill.familyId || current.periodIndex !== indices[i]) {
        fail('FINANCE_INVALID_SERIES', 409, 'Kolejny okres wymaga sprawdzenia przypisania.');
      }
      continue;
    }
    transaction.create(refs[i], drafts[i]);
    transaction.create(context.db.collection('financeBillAudit').doc(`created-${digest(refs[i].id)}`), {
      billId: refs[i].id, familyId: bill.familyId, actorUid: context.uid || bill.ownerUid,
      kind: 'period-created', amountGrosze: drafts[i].amountGrosze, dueDate: drafts[i].dueDate, createdAt: stamp() });
    created += 1;
  }
  return { created, billIds: refs.map(ref => ref.id) };
}
async function generatePeriods(context, body) {
  fields(body, ['billId', 'count']);
  const id = billId(body.billId);
  if (![1, 2].includes(body.count)) fail('FINANCE_INVALID_REQUEST', 400, 'Można przygotować jeden lub dwa kolejne okresy.');
  return context.db.runTransaction(async transaction => {
    const actor = await freshActor(transaction, context); requireParent(actor);
    const record = await transaction.get(context.db.collection('financeBills').doc(id));
    const bill = record.exists ? record.data() : null; requireBill(bill, actor);
    if (bill.recurrence === 'none') fail('FINANCE_NOT_RECURRING', 409, 'Ten rachunek nie ma kolejnych okresów.');
    return createPeriods(transaction, context, bill, Array.from({ length: body.count }, (_, index) => bill.periodIndex + index + 1));
  });
}

/** Daily maintenance creates the current and two future periods, not old missed history.
 * Existing edited instances are never overwritten. A revoked owner stops the series. */
export async function ensureFinancePeriods(context, now = new Date()) {
  const roots = await context.db.collection('financeBills').where('periodIndex', '==', 0).limit(501).get();
  if (roots.size > 500) throw new Error('Finance series limit exceeded.');
  let created = 0;
  for (const snapshot of roots.docs) {
    const count = await context.db.runTransaction(async transaction => {
      const root = await transaction.get(snapshot.ref);
      const bill = root.data();
      if (!bill || bill.archived === true || bill.recurrence === 'none' || !validFinanceId(bill.ownerUid)) return 0;
      const member = await transaction.get(context.db.collection('members').doc(bill.ownerUid));
      const actor = { ...member.data(), id: bill.ownerUid };
      if (!financeParent(actor) || !financeSameFamily(actor, bill)) return 0;
      const current = financeCurrentPeriod(bill.anchorDueDate, bill.recurrence, financeWarsawDate(now));
      if (current === null) return 0;
      return (await createPeriods(transaction, { ...context, uid: bill.ownerUid }, bill,
        [...new Set([Math.max(1, current), current + 1, current + 2])])).created;
    });
    created += count;
  }
  return { created };
}
export async function manageFinanceAction(context, body) {
  const action = body?.operation || body?.action;
  if (action === 'state' || action === 'status') return state(context, body);
  if (action === 'save') return save(context, body);
  if (action === 'markPaid') return markPaid(context, body);
  if (action === 'generatePeriods') return generatePeriods(context, body);
  fail('FINANCE_INVALID_REQUEST', 400, 'Nieobsługiwana operacja rachunku.');
}
