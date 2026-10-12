/** Dependency-free finance semantics. Amounts are whole PLN grosze, not floats. */
export const FINANCE_LEGACY_FAMILY = '__legacy__';
export const FINANCE_RECURRENCES = Object.freeze(['none', 'weekly', 'monthly', 'yearly']);
export const FINANCE_MAX_AMOUNT_GROSZE = 100_000_000;
export const financeActiveMember = value => value?.active === true && value.canLogin === true
  && value.archived !== true && ['parent', 'adult', 'child'].includes(value.role);
export const financeParent = value => financeActiveMember(value) && value.role === 'parent';
export const financeFamilyId = profile => typeof profile?.familyId === 'string' && profile.familyId.trim()
  ? profile.familyId : FINANCE_LEGACY_FAMILY;
export const financeFamilyKey = profile => financeFamilyId(profile) === FINANCE_LEGACY_FAMILY
  ? 'legacy:members' : `family:${financeFamilyId(profile)}`;

/** Legacy records only match legacy members, never every parent in the project. */
export function financeSameFamily(member, record) {
  return financeFamilyId(member) === financeFamilyId(record);
}
export function canReadFinanceBill(member, bill) {
  return financeActiveMember(member) && bill?.archived !== true && financeSameFamily(member, bill)
    && (financeParent(member) || member.role === 'child' && typeof member.id === 'string'
      && Array.isArray(bill.sharedWith) && bill.sharedWith.includes(member.id));
}
export function validFinanceId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
export function validFinanceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && Number(value.slice(0, 4)) >= 1970 && Number(value.slice(0, 4)) <= 2200;
}
export function financeWarsawDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = name => parts.find(value => value.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function financeDaysUntil(dueDate, now = new Date()) {
  if (!validFinanceDate(dueDate)) return null;
  return Math.round((Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${financeWarsawDate(now)}T12:00:00Z`)) / 86_400_000);
}
export function parseFinanceAmount(value) {
  if (typeof value !== 'string' || !/^\d{1,7}(?:[,.]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= FINANCE_MAX_AMOUNT_GROSZE ? amount : null;
}
export function safeFinancePaymentUrl(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.hostname === 'localhost'
      || !url.hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname.startsWith('[')) return null;
    return url.href;
  } catch { return null; }
}

/** Index is measured from the original date, preserving Jan 31 / Feb 29 anchors. */
export function financePeriodDate(anchorDueDate, recurrence, periodIndex) {
  if (!validFinanceDate(anchorDueDate) || !FINANCE_RECURRENCES.includes(recurrence)
    || !Number.isInteger(periodIndex) || periodIndex < 0 || periodIndex > 12_000) return null;
  if (recurrence === 'none') return periodIndex === 0 ? anchorDueDate : null;
  const date = new Date(`${anchorDueDate}T12:00:00Z`);
  if (recurrence === 'weekly') date.setUTCDate(date.getUTCDate() + periodIndex * 7);
  else {
    const anchorDay = date.getUTCDate();
    date.setUTCDate(1);
    if (recurrence === 'monthly') date.setUTCMonth(date.getUTCMonth() + periodIndex);
    else date.setUTCFullYear(date.getUTCFullYear() + periodIndex);
    date.setUTCDate(Math.min(anchorDay, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  const result = date.toISOString().slice(0, 10);
  return validFinanceDate(result) ? result : null;
}
export function financeCurrentPeriod(anchor, recurrence, today) {
  if (!validFinanceDate(anchor) || !validFinanceDate(today) || !FINANCE_RECURRENCES.includes(recurrence)) return null;
  if (today <= anchor || recurrence === 'none') return 0;
  const start = new Date(`${anchor}T12:00:00Z`);
  const end = new Date(`${today}T12:00:00Z`);
  let index = recurrence === 'weekly' ? Math.floor((end - start) / (7 * 86_400_000))
    : recurrence === 'monthly' ? (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth()
      : end.getUTCFullYear() - start.getUTCFullYear();
  if (financePeriodDate(anchor, recurrence, index) > today) index -= 1;
  return Math.max(0, index);
}
export function financeBillStatus(bill, now = new Date()) {
  return bill.status === 'paid' ? 'paid' : financeDaysUntil(bill.dueDate, now) < 0 ? 'overdue' : 'unpaid';
}
export function financeTotals(bills) {
  return bills.reduce((sum, bill) => {
    const amount = Number.isSafeInteger(bill.amountGrosze) ? bill.amountGrosze : 0;
    sum[bill.status === 'paid' ? 'paidGrosze' : 'unpaidGrosze'] += amount;
    sum.totalGrosze += amount;
    return sum;
  }, { paidGrosze: 0, unpaidGrosze: 0, totalGrosze: 0 });
}
