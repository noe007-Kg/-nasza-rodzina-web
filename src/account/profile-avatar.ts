import type { FamilyMemberProfile } from '../family-members';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const formats: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
export function avatarFileExtension(file: { type: string; size: number }): string {
  const extension = formats[file.type];
  if (!extension) throw new Error('Wybierz zdjęcie JPG, PNG, WebP lub GIF.');
  if (file.size <= 0 || file.size > AVATAR_MAX_BYTES) throw new Error('Zdjęcie musi mieć rozmiar od 1 bajta do 5 MB.');
  return extension;
}

/** Mirrors profile API ownership. It grants no access by itself. */
export function canEditFamilyProfile(actor: { id: string; role?: string }, target: FamilyMemberProfile) {
  if (target.archived || target.active !== true || target.disabled) return false;
  return actor.id === target.id || actor.role === 'parent' && (target.role === 'child' || target.canLogin === false);
}

/** Profiles without a login remain in the family, but cannot receive a new 1:1 chat. */
export function chatEligibleProfiles<T extends FamilyMemberProfile>(profiles: readonly T[]): T[] {
  return profiles.filter(profile => profile.active === true && !profile.archived && !profile.disabled && profile.canLogin === true && ['parent', 'adult', 'child'].includes(profile.role || ''));
}

const memberPath = /^avatars\/members\/([^/]+)\/([^/]+)\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(?:jpg|jpeg|png|webp|gif)$/i;
const familyPath = /^avatars\/family\/([^/]+)\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(?:jpg|jpeg|png|webp|gif)$/i;
export function validProfileAvatarPath(path: unknown, targetId?: string): boolean {
  if (typeof path !== 'string') return false;
  if (path.split('/').some(segment => segment === '.' || segment === '..')) return false;
  const match = targetId ? memberPath.exec(path) : familyPath.exec(path);
  return Boolean(match && (!targetId || match[1] === targetId));
}

export function profileAvatarPath(targetId: string | null, uploaderUid: string, extension: string, uuid: string) {
  if (!/^(?:jpg|png|webp|gif)$/.test(extension)) throw new Error('Nieobsługiwany format zdjęcia.');
  const path = targetId ? `avatars/members/${targetId}/${uploaderUid}/${uuid}.${extension}` : `avatars/family/${uploaderUid}/${uuid}.${extension}`;
  if (!validProfileAvatarPath(path, targetId ?? undefined)) throw new Error('Nieprawidłowe miejsce zapisu zdjęcia.');
  return path;
}
