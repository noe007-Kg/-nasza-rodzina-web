import { LEGACY_FAMILY_METADATA } from '../family-members';

type SchoolReadProfile = {
  role?: unknown;
  active?: unknown;
  canLogin?: unknown;
  personKey?: unknown;
  name?: unknown;
};

export type SchoolReadAccess = { scope: 'parent' } | { scope: 'student'; person: string };

/** Match Rules' map.get semantics: an explicitly empty key must not fall back to a name. */
export function schoolReadAccess(profile: SchoolReadProfile | null | undefined): SchoolReadAccess | null {
  if (profile?.active !== true || profile.canLogin !== true) return null;
  if (profile.role === 'parent') return { scope: 'parent' };
  if (profile.role !== 'child') return null;
  const person = Object.hasOwn(profile, 'personKey') ? profile.personKey : profile.name;
  if (typeof person !== 'string' || (!Object.hasOwn(LEGACY_FAMILY_METADATA, person)
    && !/^member-[a-f0-9]{24}$/.test(person))) return null;
  return { scope: 'student', person };
}

export function schoolReadAccessKey(uid: string, access: SchoolReadAccess | null): string {
  return access ? `${uid}:${access.scope === 'parent' ? 'parent' : `student:${access.person}`}` : `${uid}:unbound`;
}

export const SCHOOL_PROFILE_UNBOUND = 'Profil nie jest jeszcze powiązany z danymi szkolnymi. Rodzic musi uzupełnić profil.';
