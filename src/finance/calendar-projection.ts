import type { CalendarEventData } from '../app-shared';
import { financeDateValid, financeHouseholdConfigured, type FinanceBill } from './model';

/** Authorized bills remain private to this viewer, even when a family profile is selected. */
export function projectFinanceCalendar(bills: readonly FinanceBill[], uid: string, ownPerson: string): CalendarEventData[] {
  if (!uid || !ownPerson || ownPerson === 'family') return [];
  const seen = new Set<string>();
  return bills.flatMap(bill => {
    if (!financeHouseholdConfigured(bill.familyId) || !bill.calendarEnabled || !financeDateValid(bill.dueDate) || seen.has(bill.id)) return [];
    seen.add(bill.id);
    const [year, month, day] = bill.dueDate.split('-').map(Number);
    // Calendar all-day rows carry civil dates in local fields (the same model as
    // imported Google DATE values). Reminders independently use Warsaw dates.
    const start = new Date(year, month - 1, day);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    return [{ id: `finance:${bill.id}`, title: bill.status === 'paid' ? `Opłacona opłata: ${bill.title}` : `Termin opłaty: ${bill.title}`,
      person: ownPerson, date: start, endDate: end, allDay: true, description: '',
      createdBy: bill.ownerUid, repeat: 'none' as const, repeatUntil: null, source: 'finance' as const,
      sourceRecordId: bill.id, readOnly: true, important: true, private: true, ownerUid: uid, ownerProfileId: uid,
      timeZone: 'Europe/Warsaw', sourceStartDate: bill.dueDate, sourceEndDateExclusive: nextDay }];
  });
}
