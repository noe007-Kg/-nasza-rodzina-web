import { EduServerError } from './edu-auth.mjs';

export const HEALTH_DOCUMENT_TYPES = Object.freeze(['general', 'disability_certificate', 'court_document', 'disability_card']);
export const HEALTH_DOCUMENT_MIME_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export const HEALTH_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const activeHealthMember = profile => profile?.active === true && profile.canLogin === true
  && profile.archived !== true && ['parent', 'adult', 'child'].includes(profile.role);
export const activeHealthProfile = profile => profile?.active === true && profile.archived !== true && profile.disabled !== true;
function warsawDate(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = name => parts.find(value => value.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validHealthFileHeader(mimeType, bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes || []);
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return mimeType === 'image/webp' && bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

/** A legacy child role does not establish minority, consent or legal authority. */
export function isProvenMinor(profile, now = new Date()) {
  if (profile?.adult === true || !/^\d{4}-\d{2}-\d{2}$/.test(profile?.birthDate || '')) return false;
  const birth = new Date(`${profile.birthDate}T12:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== profile.birthDate) return false;
  const today = warsawDate(now);
  const eighteen = `${birth.getUTCFullYear() + 18}${profile.birthDate.slice(4)}`;
  return profile.birthDate <= today && eighteen > today;
}

export function authorizedHealthGrant(grant, uid, ownerProfileId, ownerUid) {
  if (!grant || grant.ownerProfileId !== ownerProfileId || grant.ownerUid !== ownerUid || grant.revoked === true) return false;
  return Array.isArray(grant.grants) && grant.grants.some(value => value?.uid === uid && value.canEdit === true
    && (value.basis === 'consent' && value.authorizedBy === ownerUid
      || value.basis === 'verified_legal' && value.verified === true && typeof value.verifiedBy === 'string' && value.verifiedBy.length > 0));
}

export function canManageHealthOwner(actor, owner, grant, now = new Date()) {
  if (!activeHealthMember(actor) || !activeHealthProfile(owner)) return false;
  if (owner.canLogin === true && actor.id === owner.id) return true;
  if (actor.role === 'parent' && isProvenMinor(owner, now)) return true;
  return authorizedHealthGrant(grant, actor.id, owner.id, owner.canLogin === true ? owner.id : null);
}

export function validHealthDate(value, optional = false) {
  if (optional && value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function text(value, max, optional = false) {
  if (typeof value !== 'string' || value.length > max || !optional && !value.trim()) throw new EduServerError('HEALTH_INVALID_DOCUMENT', 400, 'Sprawdź dane dokumentu.');
  return value.trim();
}

export function normalizeHealthDocumentMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !HEALTH_DOCUMENT_TYPES.includes(value.documentType) || typeof value.indefinite !== 'boolean'
    || typeof value.pinned !== 'boolean' || typeof value.shareOwner !== 'boolean'
    || !validHealthDate(value.issuedOn, true) || !validHealthDate(value.expiresOn, true)
    || value.indefinite && value.expiresOn !== '' || value.issuedOn && value.expiresOn && value.expiresOn < value.issuedOn) {
    throw new EduServerError('HEALTH_INVALID_DOCUMENT', 400, 'Sprawdź daty i rodzaj dokumentu.');
  }
  return { title: text(value.title, 300), documentType: value.documentType, issuedOn: value.issuedOn,
    expiresOn: value.indefinite ? '' : value.expiresOn, indefinite: value.indefinite,
    number: text(value.number, 200, true), note: text(value.note, 4000, true), pinned: value.pinned, shareOwner: value.shareOwner };
}

export function healthExpiryDays(expiresOn, now = new Date()) {
  if (!validHealthDate(expiresOn)) return null;
  const today = warsawDate(now);
  return Math.round((Date.parse(`${expiresOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}
