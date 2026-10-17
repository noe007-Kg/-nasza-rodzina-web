import { collection, query, where, type Firestore } from 'firebase/firestore';
import type { Member } from './app-shared';

type TaskMember = Pick<Member, 'familyId' | 'personKey' | 'name' | 'role' | 'active' | 'canLogin' | 'archived' | 'disabled'>;

/** Missing IDs never identify a shared legacy household. Rules recheck access. */
export function taskFamilyId(member: Pick<Member, 'familyId'> | null | undefined): string | null {
  const value = member?.familyId;
  return typeof value === 'string' && value !== '__legacy__' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null;
}

export function tasksReadScope(uid: string, member: TaskMember | null): string {
  return JSON.stringify([uid, taskFamilyId(member), member?.role, member?.personKey || member?.name,
    member?.active, member?.canLogin, member?.archived, member?.disabled]);
}

export function tasksHouseholdQuery(database: Firestore, member: TaskMember | null) {
  const familyId = taskFamilyId(member);
  if (!familyId || member?.active !== true || member.canLogin !== true || member.archived === true || member.disabled === true) return null;
  const scope = where('familyId', '==', familyId);
  if (member.role === 'parent') return query(collection(database, 'tasks'), scope);
  const person = member.personKey || member.name;
  return ['adult', 'child'].includes(member.role || '') && person && person !== 'family'
    ? query(collection(database, 'tasks'), scope, where('person', 'in', [person, 'family'])) : null;
}
