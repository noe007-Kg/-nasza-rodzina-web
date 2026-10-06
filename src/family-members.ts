/** Existing member documents remain keyed by their Firebase UID (or profile ID). */
export type FamilyMemberProfile = {
  id: string;
  uid?: string;
  name?: string;
  personKey?: string;
  role?: string;
  photoURL?: string;
  emoji?: string;
  active?: boolean;
  archived?: boolean;
  disabled?: boolean;
  canLogin?: boolean;
  schoolEnabled?: boolean;
};

type MemberMetadata = Omit<FamilyMemberProfile, 'id'>;

/**
 * Compatibility defaults for pre-existing 1.5.1 documents without these fields.
 * An explicit member document value always wins. These are data defaults, not
 * permission checks, and do not create users or write/migrate any documents.
 */
export const LEGACY_FAMILY_METADATA: Readonly<Record<string, Readonly<MemberMetadata>>> = {
  Sebastian: { name: 'Sebastian', personKey: 'Sebastian', role: 'parent', emoji: '👨', canLogin: true, schoolEnabled: false },
  Dominika: { name: 'Dominika', personKey: 'Dominika', role: 'parent', emoji: '👩', canLogin: true, schoolEnabled: false },
  Paweł: { name: 'Paweł', personKey: 'Paweł', role: 'child', emoji: '👦', canLogin: true, schoolEnabled: true },
  Nikodem: { name: 'Nikodem', personKey: 'Nikodem', role: 'child', emoji: '👦', canLogin: true, schoolEnabled: true },
  Layla: { name: 'Layla', personKey: 'Layla', role: 'child', emoji: '👶', canLogin: false, schoolEnabled: false },
};

export function memberPersonKey(member: MemberMetadata | null | undefined): string {
  return member?.personKey || member?.name || '';
}

export function memberCanLogin(member: MemberMetadata | null | undefined): boolean {
  if (!member || member.active === false || member.archived === true || member.disabled === true) return false;
  if (typeof member.canLogin === 'boolean') return member.canLogin;
  return LEGACY_FAMILY_METADATA[memberPersonKey(member)]?.canLogin ?? false;
}

export function memberSchoolEnabled(member: MemberMetadata | null | undefined): boolean {
  if (!member || member.active === false || member.archived === true || member.disabled === true || member.role === 'parent') return false;
  if (typeof member.schoolEnabled === 'boolean') return member.schoolEnabled;
  return LEGACY_FAMILY_METADATA[memberPersonKey(member)]?.schoolEnabled ?? false;
}

export function schoolMemberProfiles<T extends FamilyMemberProfile>(members: readonly T[]): T[] {
  const seen = new Set<string>();
  return members.filter((member) => {
    const person = memberPersonKey(member);
    if (!person || !memberSchoolEnabled(member) || seen.has(person)) return false;
    seen.add(person);
    return true;
  });
}

export function legacyFamilyProfiles(): FamilyMemberProfile[] {
  return Object.entries(LEGACY_FAMILY_METADATA).map(([key, profile]) => ({ ...profile, id: `legacy:${key}` }));
}
