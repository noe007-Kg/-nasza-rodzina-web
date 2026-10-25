import assert from 'node:assert/strict';
import test from 'node:test';
import { manageFinanceAction, ensureFinancePeriods, financePeriodId } from '../server/finance-service.mjs';
import { familyMemoryContext, fixtureParent, fixtureChild } from './family-v2-test-helpers.mjs';

const draft = changes => ({ action: 'save', id: 'bill-first', title: 'Rachunek testowy', category: 'Internet',
  amountGrosze: 12345, dueDate: '2026-10-20', recipient: 'Odbiorca testowy', bankAccount: 'PL12 3456 7890',
  transferTitle: 'Opłata testowa', note: '', paymentUrl: '', recurrence: 'none', calendarEnabled: false, sharedWith: [], ...changes });
const bill = (context, id = 'bill-first') => context.rows.get(`financeBills/${id}`);
const count = (context, collection) => [...context.rows.keys()].filter(path => path.startsWith(`${collection}/`)).length;
const rejects = code => error => error?.code === code;

test('disabled members lose read and mutation access even with a stale authenticated parent profile', async () => {
  const context = familyMemoryContext();
  await manageFinanceAction(context, draft());
  context.rows.set('members/parent', { ...fixtureParent, disabled: true });
  for (const action of [{ action: 'state' }, draft(), { action: 'markPaid', billId: 'bill-first' }]) {
    await assert.rejects(manageFinanceAction(context, action), rejects('FINANCE_MEMBER_REQUIRED'));
  }
  assert.equal(bill(context).status, 'unpaid');
});

test('parent creates a stable bill once on retried save and receives complete transfer data', async () => {
  const context = familyMemoryContext();
  await Promise.all([manageFinanceAction(context, draft()), manageFinanceAction(context, draft())]);
  const state = await manageFinanceAction(context, { action: 'state' });
  assert.equal(count(context, 'financeBills'), 1);
  assert.equal(count(context, 'financeBillAudit'), 1);
  assert.equal(state.bills[0].bankAccount, 'PL12 3456 7890');
  assert.equal(state.bills[0].transferTitle, 'Opłata testowa');
  assert.equal(state.bills[0].familyId, 'fixture-family');
  assert.equal(state.bills[0].ownerUid, 'parent');
  assert.equal(state.bills[0].createdAt, '2026-10-11T08:00:00.000Z');
});
test('child receives only individually shared bill and cannot create, edit, pay or share', async () => {
  const context = familyMemoryContext();
  await manageFinanceAction(context, draft());
  await manageFinanceAction(context, draft({ id: 'bill-shared', sharedWith: ['child'] }));
  const child = context.as('child');
  const state = await manageFinanceAction(child, { action: 'state' });
  assert.deepEqual(state.bills.map(row => row.id), ['bill-shared']);
  await assert.rejects(manageFinanceAction(child, draft({ id: 'bill-shared', sharedWith: ['adult'] })), rejects('FINANCE_PARENT_REQUIRED'));
  await assert.rejects(manageFinanceAction(child, { action: 'markPaid', billId: 'bill-shared' }), rejects('FINANCE_PARENT_REQUIRED'));
  await assert.rejects(manageFinanceAction(child, draft({ id: 'new-child-bill' })), rejects('FINANCE_PARENT_REQUIRED'));
  assert.equal(bill(context).status, 'unpaid');
});
test('foreign household and siblings never receive a shared bill and cannot target it directly', async () => {
  const context = familyMemoryContext({ 'members/foreign-parent': { ...fixtureParent, familyId: 'foreign-family' },
    'members/foreign-child': { ...fixtureChild, familyId: 'foreign-family' } });
  await manageFinanceAction(context, draft({ sharedWith: ['child'] }));
  assert.equal((await manageFinanceAction(context.as('adult'), { action: 'state' })).bills.length, 0);
  assert.equal((await manageFinanceAction(context.as('foreign-parent'), { action: 'state' })).bills.length, 0);
  await assert.rejects(manageFinanceAction(context.as('foreign-parent'), { action: 'markPaid', billId: 'bill-first' }), rejects('FINANCE_NOT_FOUND'));
  await assert.rejects(manageFinanceAction(context, draft({ id: 'bad-share', sharedWith: ['foreign-child'] })), rejects('FINANCE_INVALID_RECIPIENT'));
});
test('fresh membership invalidates a cached parent context after archive or household change', async () => {
  const context = familyMemoryContext();
  context.rows.get('members/parent').archived = true;
  await assert.rejects(manageFinanceAction(context, draft()), rejects('FINANCE_MEMBER_REQUIRED'));
  context.rows.get('members/parent').archived = false;
  context.rows.get('members/parent').familyId = 'foreign-family';
  await assert.rejects(manageFinanceAction(context, draft()), rejects('FINANCE_MEMBER_REQUIRED'));
  assert.equal(count(context, 'financeBills'), 0);
});
test('mark paid retries atomically preserve one audit and history date with exact totals', async () => {
  const context = familyMemoryContext();
  await manageFinanceAction(context, draft());
  const results = await Promise.all([manageFinanceAction(context, { action: 'markPaid', billId: 'bill-first' }),
    manageFinanceAction(context, { action: 'markPaid', billId: 'bill-first' })]);
  assert.equal(results.filter(result => result.changed).length, 1);
  assert.equal(count(context, 'financeBillAudit'), 2);
  const state = await manageFinanceAction(context, { action: 'state' });
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].paidAt, '2026-10-11T08:00:00.000Z');
  assert.deepEqual(state.totals, { paidGrosze: 12345, unpaidGrosze: 0, totalGrosze: 12345 });
  await assert.rejects(manageFinanceAction(context, draft({ amountGrosze: 1 })), rejects('FINANCE_ALREADY_PAID'));
  assert.equal(bill(context).amountGrosze, 12345);
});
test('recurring monthly periods are stable, independent and preserve a future amount edit', async () => {
  const context = familyMemoryContext();
  await manageFinanceAction(context, draft({ recurrence: 'monthly', dueDate: '2027-01-31' }));
  const periods = await manageFinanceAction(context, { action: 'generatePeriods', billId: 'bill-first', count: 2 });
  assert.equal(periods.created, 2);
  assert.equal((await manageFinanceAction(context, { action: 'generatePeriods', billId: 'bill-first', count: 2 })).created, 0);
  assert.equal(bill(context, periods.billIds[0]).dueDate, '2027-02-28');
  assert.equal(bill(context, periods.billIds[1]).dueDate, '2027-03-31');
  await manageFinanceAction(context, { action: 'markPaid', billId: 'bill-first' });
  await manageFinanceAction(context, draft({ id: periods.billIds[0], recurrence: 'monthly', dueDate: '2027-02-28', amountGrosze: 13001 }));
  await ensureFinancePeriods(context, new Date('2027-02-20T08:00:00Z'));
  assert.equal(bill(context, periods.billIds[0]).amountGrosze, 13001);
  assert.equal(bill(context, periods.billIds[0]).status, 'unpaid');
  assert.equal(bill(context, periods.billIds[1]).status, 'unpaid');
  assert.equal(bill(context).status, 'paid');
});
test('concurrent recurrence retries create one copy per period and child cannot trigger generation', async () => {
  const context = familyMemoryContext();
  await manageFinanceAction(context, draft({ recurrence: 'weekly' }));
  const results = await Promise.all([manageFinanceAction(context, { action: 'generatePeriods', billId: 'bill-first', count: 2 }),
    manageFinanceAction(context, { action: 'generatePeriods', billId: 'bill-first', count: 2 })]);
  assert.equal(results.reduce((sum, result) => sum + result.created, 0), 2);
  assert.equal(count(context, 'financeBills'), 3);
  await assert.rejects(manageFinanceAction(context.as('child'), { action: 'generatePeriods', billId: 'bill-first', count: 2 }), rejects('FINANCE_PARENT_REQUIRED'));
});
test('sharing one recurring bill never automatically shares its future periods with that child', async () => {
  const context = familyMemoryContext();
  await manageFinanceAction(context, draft({ recurrence: 'monthly', sharedWith: ['child'] }));
  await manageFinanceAction(context, { action: 'generatePeriods', billId: 'bill-first', count: 2 });
  assert.deepEqual((await manageFinanceAction(context.as('child'), { action: 'state' })).bills.map(row => row.id), ['bill-first']);
  assert.deepEqual(bill(context, financePeriodId('bill-first', 1)).sharedWith, []);
});
test('automatic generation fills current and next two periods, does not backfill old years', async () => {
  const context = familyMemoryContext();
  await manageFinanceAction(context, draft({ recurrence: 'monthly', dueDate: '2020-01-15' }));
  const first = await ensureFinancePeriods(context, new Date('2026-10-20T08:00:00Z'));
  assert.equal(first.created, 3);
  assert.equal((await ensureFinancePeriods(context, new Date('2026-10-20T08:00:00Z'))).created, 0);
  assert.equal(count(context, 'financeBills'), 4);
  assert.equal(bill(context, financePeriodId('bill-first', 81)).dueDate, '2026-10-15');
  assert.equal(bill(context, financePeriodId('bill-first', 82)).dueDate, '2026-11-15');
  assert.equal(bill(context, financePeriodId('bill-first', 83)).dueDate, '2026-12-15');
});
test('scheduler stops creating periods when the original parent is archived', async () => {
  const context = familyMemoryContext();
  await manageFinanceAction(context, draft({ recurrence: 'weekly' }));
  context.rows.get('members/parent').archived = true;
  assert.equal((await ensureFinancePeriods(context, new Date('2026-10-20T08:00:00Z'))).created, 0);
});
test('validation rejects float amounts, invalid dates, unsafe links and injected privileged fields', async () => {
  const context = familyMemoryContext();
  for (const invalid of [{ amountGrosze: 12.345 }, { dueDate: '2027-02-29' }, { paymentUrl: 'javascript:alert(1)' },
    { status: 'paid' }, { ownerUid: 'child' }, { familyId: 'foreign-family' }, { calendarEnabled: 'true' }]) {
    await assert.rejects(manageFinanceAction(context, draft(invalid)), rejects('FINANCE_INVALID_REQUEST'));
  }
  assert.equal(count(context, 'financeBills'), 0);
});
test('a legacy member can see only normalized legacy bills, not explicit-family records', async () => {
  const context = familyMemoryContext({ 'members/legacy-parent': { ...fixtureParent, familyId: undefined } });
  await manageFinanceAction(context, draft());
  await manageFinanceAction(context.as('legacy-parent'), draft({ id: 'legacy-bill' }));
  assert.equal(bill(context, 'legacy-bill').familyId, '__legacy__');
  assert.deepEqual((await manageFinanceAction(context.as('legacy-parent'), { action: 'state' })).bills.map(row => row.id), ['legacy-bill']);
  assert.deepEqual((await manageFinanceAction(context, { action: 'state' })).bills.map(row => row.id), ['bill-first']);
});
