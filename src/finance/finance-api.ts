import { familyAction } from '../family-v2-client';
import { parseFinanceBill, type FinanceState } from './model';

export const financeAction = <T = { ok: true }>(body: Record<string, unknown>): Promise<T> => familyAction<T>('finance', body);
export async function readFinanceState(): Promise<FinanceState> {
  const state = await financeAction<FinanceState>({ action: 'state' });
  return { ...state, writesEnabled: state.writesEnabled === true,
    bills: Array.isArray(state.bills) ? state.bills.map(parseFinanceBill).filter((bill): bill is NonNullable<typeof bill> => !!bill) : [],
    history: Array.isArray(state.history) ? state.history.map(parseFinanceBill).filter((bill): bill is NonNullable<typeof bill> => !!bill) : [] };
}
