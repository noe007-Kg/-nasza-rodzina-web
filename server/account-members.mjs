import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';

const legacyPeople = new Set(['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla']);
const parentActive = (profile) => profile?.role === 'parent' && profile.active === true
  && profile.canLogin === true && profile.archived !== true;
const failure = (code, status, message) => { throw new EduServerError(code, status, message); };
const idValid = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f/]/.test(value);

function expect(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !fields.includes(key))) {
    failure('ACCOUNT_INVALID_REQUEST', 400, 'Żądanie zawiera nieobsługiwane pola.');
  }
}
function text(value, label, limit = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || /[\x00-\x1f/]/.test(value)) {
    failure('ACCOUNT_INVALID_REQUEST', 400, `Pole ${label} jest nieprawidłowe.`);
  }
  return value.trim();
}
function boolean(value, label) {
  if (typeof value !== 'boolean') failure('ACCOUNT_INVALID_REQUEST', 400, `Pole ${label} wymaga wartości tak lub nie.`);
  return value;
}
function role(value) {
  if (!['parent', 'child'].includes(value)) failure('ACCOUNT_INVALID_REQUEST', 400, 'Wybierz rolę rodzic lub dziecko.');
  return value;
}

export function validateMemberCreation(body) {
  expect(body, ['action', 'name', 'role', 'canLogin', 'schoolEnabled', 'email']);
  const name = text(body.name, 'imię');
  const canLogin = boolean(body.canLogin, 'dostęp do logowania');
  const result = { name, role: role(body.role), canLogin, schoolEnabled: boolean(body.schoolEnabled, 'szkoła') };
  if (canLogin) {
    const email = text(body.email, 'e-mail', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) failure('ACCOUNT_INVALID_REQUEST', 400, 'Wpisz poprawny adres e-mail.');
    return { ...result, email };
  }
  if (body.email !== undefined && body.email !== '') failure('ACCOUNT_INVALID_REQUEST', 400, 'Profil bez logowania nie potrzebuje adresu e-mail.');
  return result;
}

export function assertMemberChangeAllowed(actorUid, profiles, targetUid, next) {
  if (!parentActive(profiles.get(actorUid))) failure('ACCOUNT_PARENT_REQUIRED', 403, 'Członkami rodziny zarządza aktywny rodzic.');
  const previous = profiles.get(targetUid);
  if (!previous) failure('ACCOUNT_MEMBER_NOT_FOUND', 404, 'Nie znaleziono członka rodziny.');
  if (actorUid === targetUid && !parentActive(next)) {
    failure('ACCOUNT_SELF_LOCKOUT', 409, 'Nie możesz odebrać dostępu własnemu kontu rodzica.');
  }
  if (parentActive(previous) && !parentActive(next)
    && [...profiles.entries()].filter(([uid, profile]) => uid !== targetUid && parentActive(profile)).length === 0) {
    failure('ACCOUNT_LAST_PARENT', 409, 'W rodzinie musi pozostać przynajmniej jeden aktywny rodzic.');
  }
}

async function activeProfiles(transaction, db) {
  const snapshot = await transaction.get(db.collection('members'));
  return new Map(snapshot.docs.map((item) => [item.id, item.data()]));
}
function duplicatePerson(profiles, name, uid) {
  return [...profiles.entries()].some(([id, profile]) => id !== uid
    && (String(profile.name || '').toLocaleLowerCase('pl-PL') === name.toLocaleLowerCase('pl-PL')
      || (legacyPeople.has(name) && profile.personKey === name)));
}

async function createMember(context, body) {
  const definition = validateMemberCreation(body);
  const { db, auth, uid: actorUid } = context;
  // Check the roster before touching Authentication. Existing people are never duplicated.
  const roster = await db.collection('members').get();
  const profiles = new Map(roster.docs.map((item) => [item.id, item.data()]));
  if (duplicatePerson(profiles, definition.name)) failure('ACCOUNT_DUPLICATE_MEMBER', 409, 'Ta osoba ma już profil. Edytuj istniejący profil zamiast tworzyć drugi.');
  let account;
  let createdAccount = false;
  if (definition.canLogin) {
    try { account = await auth.getUserByEmail(definition.email); }
    catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
    if (account && profiles.has(account.uid)) {
      failure('ACCOUNT_DUPLICATE_MEMBER', 409, 'Ten e-mail należy już do członka rodziny. Jego UID i dane pozostają bez zmian.');
    }
    if (account?.disabled) failure('ACCOUNT_EXISTING_DISABLED', 409, 'Istniejące konto jest wyłączone. Administrator musi je najpierw zweryfikować.');
    if (!account) {
      // No password is generated, stored or returned. The usual password-reset email sets the first password.
      account = await auth.createUser({ email: definition.email, displayName: definition.name, disabled: true });
      createdAccount = true;
    }
  }
  const uid = account?.uid || `profile-${randomUUID()}`;
  const personKey = legacyPeople.has(definition.name) ? definition.name
    : `member-${createHash('sha256').update(uid).digest('hex').slice(0, 24)}`;
  try {
    await db.runTransaction(async (transaction) => {
      const latest = await activeProfiles(transaction, db);
      if (!parentActive(latest.get(actorUid))) failure('ACCOUNT_PARENT_REQUIRED', 403, 'Członkami rodziny zarządza aktywny rodzic.');
      if (latest.has(uid) || duplicatePerson(latest, definition.name, uid)) {
        failure('ACCOUNT_DUPLICATE_MEMBER', 409, 'Ta osoba ma już profil. Nie utworzono duplikatu.');
      }
      transaction.create(db.collection('members').doc(uid), {
        name: definition.name, personKey, role: definition.role,
        active: true, canLogin: createdAccount ? false : definition.canLogin,
        schoolEnabled: definition.schoolEnabled, adult: definition.role === 'parent',
        createdBy: actorUid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
    });
    if (createdAccount) {
      await auth.updateUser(uid, { disabled: false });
      await db.collection('members').doc(uid).update({ canLogin: true, updatedAt: FieldValue.serverTimestamp() });
    }
    return { memberUid: uid, personKey, ...(definition.canLogin ? { resetEmail: definition.email } : {}) };
  } catch (error) {
    // Failed provisioning leaves a disabled/inaccessible account, never an unauthorized active profile.
    // No existing Auth user, member, history, session or eduVULCAN connection is deleted.
    if (createdAccount) {
      try { await auth.updateUser(uid, { disabled: true }); } catch { /* retryable administrative repair */ }
    }
    throw error;
  }
}

async function changeMember(context, body, archive) {
  expect(body, archive ? ['action', 'uid', 'confirmed'] : ['action', 'uid', 'role', 'canLogin', 'schoolEnabled', 'active', 'email']);
  if (!idValid(body.uid)) failure('ACCOUNT_INVALID_REQUEST', 400, 'Nieprawidłowy identyfikator członka rodziny.');
  if (archive && body.confirmed !== true) failure('ACCOUNT_CONFIRMATION_REQUIRED', 400, 'Potwierdź usunięcie członka z aktywnej rodziny.');
  const targetUid = body.uid;
  const changes = archive ? { active: false, canLogin: false, archived: true } : {
    role: role(body.role), canLogin: boolean(body.canLogin, 'dostęp do logowania'),
    schoolEnabled: boolean(body.schoolEnabled, 'szkoła'), active: boolean(body.active, 'aktywność'),
    archived: false,
  };
  let createdAccount = false;
  let resetEmail;
  if (!archive && changes.canLogin) {
    let user;
    try { user = await context.auth.getUser(targetUid); }
    catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    if (user?.disabled) failure('ACCOUNT_EXISTING_DISABLED', 409, 'Konto Firebase jest wyłączone. Administrator musi je zweryfikować.');
    if (!user) {
      const email = text(body.email, 'e-mail nowego konta', 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) failure('ACCOUNT_INVALID_REQUEST', 400, 'Wpisz poprawny adres e-mail.');
      const roster = await context.db.collection('members').get();
      const profiles = new Map(roster.docs.map((item) => [item.id, item.data()]));
      const previous = profiles.get(targetUid);
      assertMemberChangeAllowed(context.uid, profiles, targetUid, { ...previous, ...changes });
      let accountByEmail;
      try { accountByEmail = await context.auth.getUserByEmail(email); }
      catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
      if (accountByEmail) failure('ACCOUNT_EMAIL_UID_CONFLICT', 409, 'Ten e-mail należy już do innego UID. Nie przeniesiono profilu ani historii i nie utworzono duplikatu.');
      // Explicit parent action provisions Auth under the profile's EXISTING UID.
      await context.auth.createUser({ uid: targetUid, email, displayName: String(previous.name || ''), disabled: true });
      createdAccount = true;
      resetEmail = email;
    }
  }
  try {
    await context.db.runTransaction(async (transaction) => {
      const profiles = await activeProfiles(transaction, context.db);
      const previous = profiles.get(targetUid);
      const next = { ...previous, ...changes };
      assertMemberChangeAllowed(context.uid, profiles, targetUid, next);
      transaction.update(context.db.collection('members').doc(targetUid), {
        ...changes, ...(createdAccount ? { canLogin: false } : {}), updatedAt: FieldValue.serverTimestamp(),
        ...(archive ? { archivedBy: context.uid, archivedAt: FieldValue.serverTimestamp() } : {}),
      });
    });
    if (createdAccount) {
      await context.auth.updateUser(targetUid, { disabled: false });
      await context.db.collection('members').doc(targetUid).update({ canLogin: true, updatedAt: FieldValue.serverTimestamp() });
    }
  } catch (error) {
    if (createdAccount) {
      try { await context.auth.updateUser(targetUid, { disabled: true }); } catch { /* no destructive cleanup */ }
    }
    throw error;
  }
  if (archive || !changes.canLogin || !changes.active) {
    try { await context.auth.revokeRefreshTokens(targetUid); }
    catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
  }
  return { memberUid: targetUid, archived: archive, ...(resetEmail ? { resetEmail } : {}) };
}

export async function manageMemberAction(context, body) {
  if (!parentActive(context.profile)) failure('ACCOUNT_PARENT_REQUIRED', 403, 'Członkami rodziny zarządza aktywny rodzic.');
  if (body?.action === 'create') return createMember(context, body);
  if (body?.action === 'update') return changeMember(context, body, false);
  if (body?.action === 'archive') return changeMember(context, body, true);
  failure('ACCOUNT_INVALID_REQUEST', 400, 'Wybierz poprawną operację zarządzania rodziną.');
}
