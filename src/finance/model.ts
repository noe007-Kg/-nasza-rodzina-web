export type FinanceRecurrence = 'none' | 'weekly' | 'monthly' | 'yearly';
export type FinanceBillFields = {
  title: string; category: string; amountGrosze: number; dueDate: string; recipient: string;
  bankAccount: string; transferTitle: string; note: string; paymentUrl: string;
  recurrence: FinanceRecurrence; calendarEnabled: boolean; sharedWith: string[];
};
export type FinanceBill = FinanceBillFields & {
  id: string; familyId: string; ownerUid: string; status: 'unpaid' | 'paid';
  seriesId: string; periodIndex: number; paidAt: string | null; createdAt: string; updatedAt: string;
};
export type FinanceState = { ok: true; bills: FinanceBill[]; history: FinanceBill[]; writesEnabled: boolean;
  totals: { paidGrosze: number; unpaidGrosze: number; totalGrosze: number } };
export const FINANCE_RECURRENCES: Record<FinanceRecurrence, string> = {
  none: 'Jednorazowo', weekly: 'Co tydzień', monthly: 'Co miesiąc', yearly: 'Co rok',
};
export const FINANCE_CATEGORIES = ['Mieszkanie', 'Prąd', 'Woda', 'Internet', 'Telefon', 'Transport', 'Edukacja', 'Inne'];

/** Decimal text is converted without a floating-point multiplication or rounding. */
export function financeAmountGrosze(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}
export function financeAmountInput(value: number): string {
  return `${Math.floor(value / 100)},${String(value % 100).padStart(2, '0')}`;
}
export function formatFinanceMoney(value: number): string {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value / 100);
}
export function financeDateValid(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && Number(value.slice(0, 4)) >= 1970 && Number(value.slice(0, 4)) <= 2200;
}
export function financeToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function formatFinanceDate(value: string, short = false): string {
  if (!financeDateValid(value)) return 'Brak terminu';
  return new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: short ? 'short' : 'long', ...(short ? {} : { year: 'numeric' }) }).format(new Date(`${value}T12:00:00Z`));
}
export function financeBillStatus(bill: Pick<FinanceBill, 'status' | 'dueDate'>, today = financeToday()) {
  if (bill.status === 'paid') return { key: 'paid' as const, label: 'Opłacone', tone: 'success' as const };
  if (bill.dueDate < today) return { key: 'overdue' as const, label: 'Po terminie', tone: 'error' as const };
  return { key: 'unpaid' as const, label: 'Do zapłaty', tone: 'warning' as const };
}
export function financeMonthLabel(value: string): string {
  if (value === 'all') return 'Cała historia';
  if (!/^\d{4}-\d{2}$/.test(value) || !financeDateValid(`${value}-01`)) return '';
  return new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', year: 'numeric', month: 'long' }).format(new Date(`${value}-01T12:00:00Z`));
}
export function financeTotals(bills: readonly FinanceBill[]) {
  return bills.reduce((result, bill) => {
    if (bill.status === 'paid') result.paidGrosze += bill.amountGrosze;
    else result.unpaidGrosze += bill.amountGrosze;
    result.totalGrosze += bill.amountGrosze;
    return result;
  }, { paidGrosze: 0, unpaidGrosze: 0, totalGrosze: 0 });
}
export function financeCategoryTotals(bills: readonly FinanceBill[]) {
  const categories = new Map<string, FinanceBill[]>();
  for (const bill of bills) categories.set(bill.category || 'Inne', [...(categories.get(bill.category || 'Inne') || []), bill]);
  return [...categories].sort(([a], [b]) => a.localeCompare(b, 'pl')).map(([category, rows]) => ({ category, ...financeTotals(rows) }));
}
export function safeFinancePaymentUrl(value: string): string | null {
  if (!value || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password
    && url.hostname !== 'localhost' && url.hostname.includes('.') && !/^\d+(?:\.\d+){3}$/.test(url.hostname)
    && !url.hostname.startsWith('[') ? url.href : null; }
  catch { return null; }
}
/** Malformed or inaccessible rows never become displayed bills or calendar entries. */
export function parseFinanceBill(value: unknown): FinanceBill | null {
  if (!value || typeof value !== 'object') return null;
  const bill = value as Record<string, unknown>;
  if (typeof bill.id !== 'string' || !bill.id || typeof bill.title !== 'string' || !bill.title
    || !financeDateValid(bill.dueDate) || !Number.isSafeInteger(bill.amountGrosze) || Number(bill.amountGrosze) <= 0 || Number(bill.amountGrosze) > 100_000_000
    || !['unpaid', 'paid'].includes(String(bill.status)) || !Array.isArray(bill.sharedWith)) return null;
  const text = (name: string) => typeof bill[name] === 'string' ? bill[name] as string : '';
  return { id: bill.id, title: bill.title, category: text('category'), amountGrosze: Number(bill.amountGrosze), dueDate: bill.dueDate,
    recipient: text('recipient'), bankAccount: text('bankAccount'), transferTitle: text('transferTitle'), note: text('note'), paymentUrl: text('paymentUrl'),
    recurrence: Object.hasOwn(FINANCE_RECURRENCES, String(bill.recurrence)) ? bill.recurrence as FinanceRecurrence : 'none',
    calendarEnabled: bill.calendarEnabled === true, sharedWith: bill.sharedWith.filter((uid): uid is string => typeof uid === 'string'),
    familyId: text('familyId'), ownerUid: text('ownerUid'), status: bill.status as 'unpaid' | 'paid', seriesId: text('seriesId'),
    periodIndex: Number.isSafeInteger(bill.periodIndex) ? Number(bill.periodIndex) : 0,
    paidAt: typeof bill.paidAt === 'string' ? bill.paidAt : null, createdAt: text('createdAt'), updatedAt: text('updatedAt') };
}
