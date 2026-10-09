import { createContext, useContext } from 'react';
import type { FamilyAggregateProfile, FamilyMemberProfile } from './family-members';

export const FamilyDirectoryContext = createContext<readonly FamilyMemberProfile[]>([]);
export function useFamilyDirectory() { return useContext(FamilyDirectoryContext); }
export const FamilyAggregateContext = createContext<FamilyAggregateProfile>({ emoji: '👨‍👩‍👧‍👦' });
export function useFamilyAggregate() { return useContext(FamilyAggregateContext); }

/** Account order is calculated from the authenticated UID on every roster change. */
export function orderedFamilyProfiles(profiles: readonly FamilyMemberProfile[], uid: string) {
  const legacyOrder = ['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'];
  return profiles.filter(profile => profile.active !== false && !profile.archived && !profile.disabled)
    .map((profile, index) => ({ profile, index }))
    .sort((a, b) => {
      if (a.profile.id === uid) return -1;
      if (b.profile.id === uid) return 1;
      const first = legacyOrder.indexOf(a.profile.personKey || a.profile.name || '');
      const second = legacyOrder.indexOf(b.profile.personKey || b.profile.name || '');
      return (first < 0 ? 100 : first) - (second < 0 ? 100 : second) || a.index - b.index;
    }).map(item => item.profile);
}
