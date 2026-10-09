import { EduServerError } from './edu-auth.mjs';

const legacySchoolKeys = new Set(['Paweł', 'Nikodem', 'Layla']);
const legacyEnabledKeys = new Set(['Paweł', 'Nikodem']);
export const SCHOOL_ROSTER_LIMIT = 64;
export const validSchoolPersonKey = value => typeof value === 'string'
  && (legacySchoolKeys.has(value) || /^member-[a-f0-9]{24}$/.test(value));
export const validMemberDocumentId = value => typeof value === 'string' && value.length > 0
  && value.length <= 128 && !/[\x00-\x1f/]/.test(value);
export const schoolPersonKey = profile => profile && Object.hasOwn(profile, 'personKey') ? profile.personKey : profile?.name;
export const activeEduActor = profile => profile?.active === true && profile.canLogin === true
  && profile.archived !== true && profile.disabled !== true;

/** Passive child profiles are valid family targets. Legacy defaults are data
 * compatibility, never a list of all authorized children. */
export function schoolProfileEnabled(profile) {
  if (profile?.role !== 'child' || profile.active !== true || profile.archived === true || profile.disabled === true) return false;
  return Object.hasOwn(profile, 'schoolEnabled') ? profile.schoolEnabled === true : legacyEnabledKeys.has(schoolPersonKey(profile));
}

export async function schoolProfileRoster(db) {
  const snapshot = await db.collection('members').where('role', '==', 'child').limit(SCHOOL_ROSTER_LIMIT + 1).get();
  if (snapshot.size > SCHOOL_ROSTER_LIMIT) throw new EduServerError('EDU_MEMBER_LIMIT', 409, 'Zbyt wiele profili do bezpiecznego odczytu.');
  const personProfileIds = Object.create(null);
  for (const document of snapshot.docs) {
    const profile = document.data();
    if (!schoolProfileEnabled(profile)) continue;
    const key = schoolPersonKey(profile);
    if (!validMemberDocumentId(document.id) || !validSchoolPersonKey(key) || Object.hasOwn(personProfileIds, key)) {
      throw new EduServerError('EDU_STUDENT_LINK_REQUIRED', 403, 'Rodzic musi poprawić powiązanie szkolnego profilu.');
    }
    personProfileIds[key] = document.id;
  }
  return { allowedPersonKeys: Object.keys(personProfileIds).sort(), personProfileIds };
}

/** Recheck the approved target under the same transaction as the lease/import.
 * Changing roster eligibility cannot invalidate the provider session itself. */
export async function assertCurrentSchoolTarget(transaction, services, scope, personKey) {
  const id = scope.personProfileIds?.[personKey];
  if (!scope.allowedPersonKeys.includes(personKey) || !validSchoolPersonKey(personKey) || !validMemberDocumentId(id)) {
    throw new EduServerError('EDU_STUDENT_LINK_REQUIRED', 403, 'Rodzic musi wybrać aktywny profil ucznia.');
  }
  const document = await transaction.get(services.db.collection('members').doc(id));
  if (!document.exists || !schoolProfileEnabled(document.data()) || schoolPersonKey(document.data()) !== personKey
    || scope.scope === 'student' && (id !== scope.actorUid || !activeEduActor(document.data()))) {
    throw new EduServerError('EDU_STUDENT_LINK_REQUIRED', 403, 'Profil ucznia został zmieniony. Rodzic musi sprawdzić jego przypisanie.');
  }
}
