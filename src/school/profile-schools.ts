import { memberPersonKey, memberSchoolEnabled, type FamilyMemberProfile } from '../family-members';

export type SchoolSourceView = 'sp4' | 'fryderyk' | 'okruszek';

/** Compatibility assignments use the selected child's profile, never the viewer's UID. */
export function schoolSourcesForProfile(profile: FamilyMemberProfile | null | undefined): SchoolSourceView[] {
  if (!profile || !memberSchoolEnabled(profile)) return [];
  if (memberPersonKey(profile) === 'Paweł' || profile.name === 'Paweł') return ['okruszek'];
  // Preserve the existing SP4/Fryderyk view for Nikodem and other school profiles.
  return ['sp4', 'fryderyk'];
}

export function schoolOwnerProfileId(profile: FamilyMemberProfile | null | undefined): string | null {
  if (!profile || !memberSchoolEnabled(profile) || !profile.id || profile.id.startsWith('legacy:')) return null;
  return profile.id;
}
