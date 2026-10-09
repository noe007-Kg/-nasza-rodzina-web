import { createHash } from 'node:crypto';
import { EduServerError, eduRequestHeader, getServerFirebase, requireMember, requireParent } from './edu-auth.mjs';
import { activeEduActor, schoolPersonKey, schoolProfileEnabled, schoolProfileRoster, validSchoolPersonKey, validMemberDocumentId } from './edu-people.mjs';

export const FAMILY_CONNECTION_ID = 'family';

export function studentConnectionId(uid) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) {
    throw new EduServerError('EDU_UNAUTHENTICATED', 401, 'Nieprawidłowe konto Naszej Rodziny.');
  }
  return `student_${createHash('sha256').update(uid).digest('hex')}`;
}

/** The requester manages a connection; they need not own the provider account.
 * One Firebase project represents one family. Personal student scopes are bound
 * to the verified Firebase UID and a school identity approved by a parent.
 */
export async function resolveConnectionAccess(context, scope = 'family') {
  const { uid, profile } = context;
  if (!validMemberDocumentId(uid) || !activeEduActor(profile)) {
    throw new EduServerError('EDU_MEMBER_REQUIRED', 403, 'Konto Naszej Rodziny nie ma aktywnego dostępu.');
  }
  if (scope === 'family') {
    if (profile.role !== 'parent') throw new EduServerError('EDU_PARENT_REQUIRED', 403, 'Wspólnym połączeniem rodziny zarządza konto z rolą parent w Naszej Rodzinie.');
    const roster = await schoolProfileRoster(context.db);
    return { ...context, connection: { id: FAMILY_CONNECTION_ID, scope, accountRole: 'parent', actorUid: uid, ...roster } };
  }
  if (scope !== 'student') throw new EduServerError('EDU_INVALID_REQUEST', 400, 'Nieprawidłowy zakres połączenia z dziennikiem.');
  if (profile.role !== 'child') throw new EduServerError('EDU_STUDENT_REQUIRED', 403, 'Osobiste połączenie ucznia jest przypisane wyłącznie do jego konta Naszej Rodziny.');
  const personKey = schoolPersonKey(profile);
  if (!schoolProfileEnabled(profile) || !validSchoolPersonKey(personKey)) throw new EduServerError('EDU_STUDENT_LINK_REQUIRED', 403, 'Rodzic musi przypisać konto ucznia do jego szkolnego profilu.');
  const binding = await context.db.collection('_eduStudentBindings').doc(personKey).get();
  const identity = binding.exists ? binding.data().identity : null;
  if (!identity || typeof identity.studentName !== 'string' || !identity.studentName.trim() || identity.studentName.length > 300
    || typeof identity.schoolName !== 'string' || !identity.schoolName.trim() || identity.schoolName.length > 300) {
    throw new EduServerError('EDU_STUDENT_LINK_REQUIRED', 403, 'Rodzic musi najpierw potwierdzić właściwy dziennik tego ucznia.');
  }
  return { ...context, connection: {
    id: studentConnectionId(uid), scope, accountRole: 'student', actorUid: uid,
    allowedPersonKeys: [personKey], personProfileIds: { [personKey]: uid }, allowedStudentIdentity: { studentName: identity.studentName, schoolName: identity.schoolName,
      ...(typeof identity.schoolSymbol === 'string' && identity.schoolSymbol.length <= 100 ? { schoolSymbol: identity.schoolSymbol } : {}) },
  } };
}

/** Current UI uses family; a future student UI can explicitly request student.
 * No client-provided UID, connection ID or child name is used for authorization.
 */
export async function requireEduConnection(request, services = getServerFirebase()) {
  const scope = eduRequestHeader(request, 'x-edu-connection-scope') || 'family';
  if (!['family', 'student'].includes(scope)) throw new EduServerError('EDU_INVALID_REQUEST', 400, 'Nieprawidłowy zakres połączenia z dziennikiem.');
  const context = await (scope === 'family' ? requireParent(request, services) : requireMember(request, services));
  return resolveConnectionAccess(context, scope);
}
