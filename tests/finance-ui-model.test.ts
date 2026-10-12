import { test } from 'node:test';
import assert from 'node:assert/strict';
import { financeAmountGrosze, financeAmountInput, financeBillStatus, financeCategoryTotals, financeDateValid, financeToday, financeTotals,
  parseFinanceBill, safeFinancePaymentUrl, type FinanceBill } from '../src/finance/model';
import { projectFinanceCalendar } from '../src/finance/calendar-projection';
import { calendarEventInView } from '../src/calendar-v2';
import { calendarOccurrencesOnDay } from '../src/calendar-timeline';

const bill = (fields: Partial<FinanceBill> = {}): FinanceBill => ({ id: 'test-bill', title: 'Test opłaty', category: 'Internet', amountGrosze: 12345,
  dueDate: '2026-10-25', recipient: 'Testowy odbiorca', bankAccount: 'TEST ACCOUNT', transferTitle: 'TEST TRANSFER', note: 'TEST NOTE', paymentUrl: '',
  recurrence: 'monthly', calendarEnabled: true, sharedWith: [], familyId: 'test-family', ownerUid: 'test-parent', status: 'unpaid',
  seriesId: 'test-series', periodIndex: 0, paidAt: null, createdAt: '', updatedAt: '', ...fields });

test('decimal amount conversion preserves each grosz and rejects rounding, zero and overflow', () => {
  assert.equal(financeAmountGrosze('0,29'), 29);
  assert.equal(financeAmountGrosze('123.4'), 12340);
  assert.equal(financeAmountGrosze(' 12,30 '), 1230);
  assert.equal(financeAmountInput(29), '0,29');
  for (const value of ['0', '-1', '1,239', '1e4', '1 000', 'Infinity', '1000001']) assert.equal(financeAmountGrosze(value), null);
});
test('financial dates use Warsaw civil date across UTC midnight and daylight saving', () => {
  assert.equal(financeToday(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
  assert.equal(financeToday(new Date('2026-10-25T23:30:00Z')), '2026-10-26');
  assert.equal(financeDateValid('2027-02-29'), false);
  assert.equal(financeDateValid('2028-02-29'), true);
});
test('paid and unpaid monthly sums do not mutate records or statuses', () => {
  const rows = [bill(), bill({ id: 'second', amountGrosze: 29, status: 'paid', paidAt: '2026-10-12T10:00:00Z' })];
  const original = JSON.stringify(rows);
  assert.deepEqual(financeTotals(rows), { unpaidGrosze: 12345, paidGrosze: 29, totalGrosze: 12374 });
  assert.equal(financeBillStatus(rows[0], '2026-10-26').key, 'overdue');
  assert.equal(financeBillStatus(rows[1], '2026-10-26').key, 'paid');
  assert.equal(JSON.stringify(rows), original);
});
test('payment links permit safe HTTPS only and empty links never become actions', () => {
  assert.equal(safeFinancePaymentUrl('https://payments.example.org/path?a=1'), 'https://payments.example.org/path?a=1');
  for (const value of ['', 'http://example.org', 'javascript:alert(1)', 'https://u:p@example.org', 'https://localhost', 'https://127.0.0.1', 'https://[::1]']) assert.equal(safeFinancePaymentUrl(value), null);
});
test('history groups authorized records by category with independent paid and unpaid sums', () => {
  assert.deepEqual(financeCategoryTotals([bill(), bill({ id: 'paid', amountGrosze: 55, status: 'paid' }), bill({ id: 'rent', category: 'Mieszkanie', amountGrosze: 100 })]), [
    { category: 'Internet', paidGrosze: 55, unpaidGrosze: 12345, totalGrosze: 12400 },
    { category: 'Mieszkanie', paidGrosze: 0, unpaidGrosze: 100, totalGrosze: 100 },
  ]);
});
test('malformed financial amounts and dates cannot produce rendered bills', () => {
  assert.ok(parseFinanceBill(bill()));
  assert.equal(parseFinanceBill(bill({ amountGrosze: 1.25 })), null);
  assert.equal(parseFinanceBill(bill({ dueDate: '2026-02-31' })), null);
});
test('finance calendar projection is opted-in, stable, private and contains no transfer data', () => {
  const rows = [bill(), bill(), bill({ id: 'hidden', calendarEnabled: false })];
  const events = projectFinanceCalendar(rows, 'viewer-parent', 'Sebastian');
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'finance:test-bill');
  assert.equal(events[0].private, true);
  assert.equal(events[0].readOnly, true);
  assert.equal(events[0].ownerUid, 'viewer-parent');
  assert.equal(events[0].sourceStartDate, '2026-10-25');
  assert.equal(events[0].sourceEndDateExclusive, '2026-10-26');
  const occurrence = { key: events[0].id, source: events[0], date: events[0].date, endDate: events[0].endDate };
  assert.equal(calendarOccurrencesOnDay([occurrence], new Date('2026-10-25T12:00:00Z')).length, 1);
  assert.equal(calendarOccurrencesOnDay([occurrence], new Date('2026-10-24T12:00:00Z')).length, 0);
  assert.equal(calendarEventInView(events[0], 'family', 'Sebastian', 'viewer-parent'), false);
  assert.equal(calendarEventInView(events[0], 'Sebastian', 'Sebastian', 'viewer-parent'), true);
  assert.equal(calendarEventInView(events[0], 'Sebastian', 'Dominika', 'other-user'), false);
  assert.ok(!JSON.stringify(events).includes('TEST ACCOUNT'));
  assert.ok(!JSON.stringify(events).includes('TEST TRANSFER'));
  assert.ok(!JSON.stringify(events).includes('TEST NOTE'));
});
test('shared child receives own private projection only, never a family entry or another profile', () => {
  const events = projectFinanceCalendar([bill({ sharedWith: ['test-child'] })], 'test-child', 'Nikodem');
  assert.equal(events[0].person, 'Nikodem');
  assert.equal(events[0].ownerUid, 'test-child');
  assert.equal(calendarEventInView(events[0], 'family', 'Nikodem', 'test-child'), false);
  assert.deepEqual(projectFinanceCalendar([bill()], '', 'Nikodem'), []);
  assert.deepEqual(projectFinanceCalendar([bill()], 'test-child', 'family'), []);
});
