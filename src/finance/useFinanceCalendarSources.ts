import { useMemo } from 'react';
import { ownPerson, type Member } from '../app-shared';
import { projectFinanceCalendar } from './calendar-projection';
import { useFinanceBills } from './useFinanceBills';
import { financeHouseholdConfigured } from './model';

export function useFinanceCalendarSources({ uid, member }: { uid: string; member: Member | null }) {
  // Finance is optional. Missing household configuration must not interrupt the
  // existing personal/family calendar or request unassigned financial records.
  const { data, error } = useFinanceBills(uid, JSON.stringify([member?.role, member?.active, member?.archived, member?.canLogin,
    member?.disabled, member?.familyId]), financeHouseholdConfigured(member?.familyId));
  const person = ownPerson(member);
  const events = useMemo(() => projectFinanceCalendar(data?.bills || [], uid, person), [data, uid, person]);
  return { events, error };
}
