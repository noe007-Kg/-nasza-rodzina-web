import { collection, query, where, type Firestore } from 'firebase/firestore';
import type { Member } from './app-shared';
import { memberPersonKey, type FamilyMemberProfile } from './family-members';
import { financeHouseholdConfigured } from './finance/model';

export const HOUSEHOLD_NOT_PREPARED = 'Profil gospodarstwa wymaga bezpiecznego przypisania. Skontaktuj się z administratorem rodziny.';

/** UI guards never grant access; server authorization and Rules remain authoritative. */
export function householdFamilyId(member: Pick<Member, 'familyId'> | null | undefined): string | null {
  return financeHouseholdConfigured(member?.familyId) ? member.familyId : null;
}

export function requireHouseholdFamilyId(member: Pick<Member, 'familyId'> | null | undefined): string {
  const familyId = householdFamilyId(member);
  if (!familyId) throw new Error(HOUSEHOLD_NOT_PREPARED);
  return familyId;
}

export function householdReadScope(uid: string, member: Member | null): string {
  return JSON.stringify([uid, householdFamilyId(member), member?.role || '', memberPersonKey(member)]);
}

export function tasksHouseholdQuery(database: Firestore, member: Member | null) {
  const familyId = householdFamilyId(member);
  if (!familyId) return null;
  const household = where('familyId', '==', familyId);
  if (member?.role === 'parent') return query(collection(database, 'tasks'), household);
  const person = memberPersonKey(member);
  return person && person !== 'family' ? query(collection(database, 'tasks'), household, where('person', 'in', [person, 'family'])) : null;
}

export function calendarEventScopeStamp(uid: string, member: Member | null, profiles: readonly FamilyMemberProfile[], person: string, privateRecord = false) {
  const familyId = requireHouseholdFamilyId(member);
  let ownerProfileId: string;
  if (person === 'family') ownerProfileId = 'family';
  else if (person === memberPersonKey(member)) ownerProfileId = uid;
  else {
    const candidates = profiles.filter(profile => householdFamilyId(profile) === familyId && memberPersonKey(profile) === person);
    if (candidates.length !== 1 || !candidates[0].id || candidates[0].id.startsWith('legacy:')) throw new Error('Nie udało się jednoznacznie przypisać wydarzenia do profilu rodziny.');
    ownerProfileId = candidates[0].id;
  }
  return { familyId, ownerProfileId, private: privateRecord, visibility: privateRecord ? 'private' as const : 'family' as const };
}
