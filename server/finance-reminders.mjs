import { enqueueInAppEvents } from './notification-inbox.mjs';
import { financeDaysUntil } from './finance-model.mjs';
import { ensureFinancePeriods } from './finance-service.mjs';

/** Deliberately generic notification text: no amount, account number or payee. */
export function financeReminderEvent(id, bill, now = new Date()) {
  if (!bill || bill.archived === true || bill.status !== 'unpaid') return null;
  const days = financeDaysUntil(bill.dueDate, now);
  if (![7, 3, 0, -1].includes(days)) return null;
  const stage = days === -1 ? 'overdue' : String(days);
  // Existing "Ważne informacje" preferences stay compatible with production rules.
  return { id: `finance:due:${id}:${bill.dueDate}:${stage}`, category: 'important', module: 'Finanse',
    title: days < 0 ? 'Termin płatności minął' : 'Przypomnienie o płatności',
    body: days < 0 ? 'Sprawdź nieopłacony rachunek w Finansach.' : days === 0
      ? 'Dzisiaj przypada termin płatności. Szczegóły znajdziesz w Finansach.'
      : `Termin płatności za ${days} dni. Szczegóły znajdziesz w Finansach.`,
    important: true, collection: 'financeBills', recordId: id, record: bill, excludeUid: '' };
}

/** Root scheduler binds 09:00 Europe/Warsaw; retry delivery uses existing inbox IDs.
 * Inbox source revalidation checks fresh unpaid status, dueDate, family and ACL. */
export async function runFinanceReminders(context, now = new Date()) {
  const periods = await ensureFinancePeriods(context, now);
  const records = await context.db.collection('financeBills').where('status', '==', 'unpaid').limit(5001).get();
  if (records.size > 5000) throw new Error('Finance reminder limit exceeded.');
  const events = records.docs.map(row => financeReminderEvent(row.id, row.data(), now)).filter(Boolean);
  const notifications = await enqueueInAppEvents(context, events, { revalidateSource: true });
  return { periodsCreated: periods.created, events: events.length, delivered: notifications.created };
}
