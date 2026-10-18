import assert from 'node:assert/strict';
import test from 'node:test';
import { canReadFinanceBill, financeBillStatus, financeCurrentPeriod, financeDaysUntil, financeFamilyId,
  financePeriodDate, financeSameFamily, financeTotals, financeWarsawDate, parseFinanceAmount,
  safeFinancePaymentUrl, validFinanceDate } from '../server/finance-model.mjs';

const parent = { id: 'parent', role: 'parent', active: true, canLogin: true, familyId: 'fixture-family' };
const child = { ...parent, id: 'child', role: 'child' };
const bill = { familyId: 'fixture-family', sharedWith: [], dueDate: '2026-10-20', amountGrosze: 12345, status: 'unpaid' };

test('PLN input retains cents exactly and rejects floating coercions or unsupported precision', () => {
  assert.equal(parseFinanceAmount('123,45'), 12345);
  assert.equal(parseFinanceAmount('0.01'), 1);
  assert.equal(parseFinanceAmount('12,5'), 1250);
  assert.equal(parseFinanceAmount('1000000'), 100000000);
  for (const invalid of ['0', '-2', '1.234', '2e3', '', 'NaN', '1000000.01', 12.5]) assert.equal(parseFinanceAmount(invalid), null);
});
test('payment links require safe HTTPS, no embedded credentials, scripts or private hosts', () => {
  assert.equal(safeFinancePaymentUrl('https://payments.example.com/invoice?id=1'), 'https://payments.example.com/invoice?id=1');
  assert.equal(safeFinancePaymentUrl(''), '');
  for (const invalid of ['http://example.com', 'javascript:alert(1)', 'https://a:b@example.com', 'https://localhost',
    'https://127.0.0.1', 'https://[::1]', 'https://example.com/\nscript', 'file:///etc/passwd']) assert.equal(safeFinancePaymentUrl(invalid), null);
});
test('date validation rejects overflow and calendar day arithmetic is DST-independent in Warsaw', () => {
  assert.equal(validFinanceDate('2027-02-29'), false);
  assert.equal(validFinanceDate('2028-02-29'), true);
  assert.equal(financeWarsawDate(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
  assert.equal(financeDaysUntil('2026-10-26', new Date('2026-10-25T22:30:00Z')), 1);
  assert.equal(financeDaysUntil('2026-03-30', new Date('2026-03-29T21:00:00Z')), 1);
});
test('monthly and yearly periods retain the original day across short months and leap years', () => {
  assert.equal(financePeriodDate('2027-01-31', 'monthly', 1), '2027-02-28');
  assert.equal(financePeriodDate('2027-01-31', 'monthly', 2), '2027-03-31');
  assert.equal(financePeriodDate('2028-02-29', 'yearly', 1), '2029-02-28');
  assert.equal(financePeriodDate('2028-02-29', 'yearly', 4), '2032-02-29');
  assert.equal(financePeriodDate('2026-10-12', 'weekly', 2), '2026-10-26');
  assert.equal(financePeriodDate('2026-10-12', 'none', 1), null);
});
test('current period selects the anchored occurrence without manufacturing historic backfill', () => {
  assert.equal(financeCurrentPeriod('2026-01-31', 'monthly', '2026-10-12'), 8);
  assert.equal(financeCurrentPeriod('2026-01-31', 'monthly', '2026-10-31'), 9);
  assert.equal(financeCurrentPeriod('2027-01-31', 'monthly', '2026-10-12'), 0);
});
test('private bill default, explicit child sharing, active member and household boundaries', () => {
  assert.equal(canReadFinanceBill(parent, bill), true);
  assert.equal(canReadFinanceBill(child, bill), false);
  assert.equal(canReadFinanceBill(child, { ...bill, sharedWith: ['child'] }), true);
  assert.equal(canReadFinanceBill({ ...child, id: 'sibling' }, { ...bill, sharedWith: ['child'] }), false);
  assert.equal(canReadFinanceBill({ ...child, familyId: 'foreign-family' }, { ...bill, sharedWith: ['child'] }), false);
  assert.equal(canReadFinanceBill({ ...parent, archived: true }, bill), false);
  assert.equal(canReadFinanceBill({ ...parent, role: 'adult' }, bill), false);
});
test('unassigned or reserved households never match each other or an explicit household', () => {
  for (const value of [undefined, null, '', ' ', '\t', '__legacy__', ' family-a', 'family-a ', 'a/b', '_private', 1, 'a'.repeat(129)]) {
    const member = { ...parent, familyId: value };
    assert.equal(financeFamilyId(member), null);
    assert.equal(financeSameFamily(member, { familyId: value }), false);
    assert.equal(canReadFinanceBill(member, { ...bill, familyId: value, sharedWith: ['parent'] }), false);
  }
  assert.equal(financeFamilyId({}), null);
  assert.equal(financeSameFamily({}, {}), false);
  assert.equal(financeSameFamily({}, { familyId: '__legacy__' }), false);
  assert.equal(financeSameFamily({}, bill), false);
  assert.equal(financeSameFamily(parent, {}), false);
});
test('both named parents retain access inside one explicit household while an unrelated parent is denied', () => {
  assert.equal(canReadFinanceBill({ ...parent, id: 'sebastian-test' }, bill), true);
  assert.equal(canReadFinanceBill({ ...parent, id: 'dominika-test' }, bill), true);
  assert.equal(canReadFinanceBill({ ...parent, id: 'foreign-parent', familyId: 'another-household' }, bill), false);
  assert.equal(canReadFinanceBill({ ...parent, disabled: true }, bill), false);
});
test('historic totals and status are computed without changing bill data', () => {
  const entries = [bill, { ...bill, amountGrosze: 1001, status: 'paid' }];
  const before = JSON.stringify(entries);
  assert.deepEqual(financeTotals(entries), { paidGrosze: 1001, unpaidGrosze: 12345, totalGrosze: 13346 });
  assert.equal(financeBillStatus(bill, new Date('2026-10-21T08:00:00Z')), 'overdue');
  assert.equal(financeBillStatus(entries[1], new Date('2026-10-21T08:00:00Z')), 'paid');
  assert.equal(JSON.stringify(entries), before);
});
