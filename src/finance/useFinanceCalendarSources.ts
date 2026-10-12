import { useMemo } from 'react';
import { ownPerson, type Member } from '../app-shared';
import { projectFinanceCalendar } from './calendar-projection';
import { useFinanceBills } from './useFinanceBills';

export function useFinanceCalendarSources({ uid, member }: { uid: string; member: Member | null }) {
  const { data, error } = useFinanceBills(uid, JSON.stringify([member?.role, member?.active, member?.archived, member?.canLogin,
    (member as Member & { familyId?: string } | null)?.familyId]));
  const person = ownPerson(member);
  const events = useMemo(() => projectFinanceCalendar(data?.bills || [], uid, person), [data, uid, person]);
  return { events, error };
}
