import { FieldValue } from 'firebase-admin/firestore';
import { EduServerError } from './edu-auth.mjs';

const legacyPeople = new Set(['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla']);
const activeMember = profile => profile?.active === true && profile?.canLogin === true
  && profile.archived !== true && ['parent', 'adult', 'child'].includes(profile.role);
const failure = (code, status, message) => { throw new EduServerError(code, status, message); };
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f/\\]/.test(value);
const validPerson = value => typeof value === 'string' && (legacyPeople.has(value) || /^member-[a-f0-9]{24}$/.test(value));
const imageFilename = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|gif)$/i;

function text(value, limit, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || /[\x00-\x1f/\\]/.test(value)) {
    failure('ACCOUNT_INVALID_REQUEST', 400, `Pole ${label} jest nieprawidłowe.`);
  }
  return value.trim().normalize('NFC');
}

/** These are protected Storage paths, not arbitrary URLs or download tokens. */
export function validProfileAvatarPath(path, { uid, targetUid, family = false }) {
  if (!validUid(uid) || !family && !validUid(targetUid) || typeof path !== 'string' || path.length > 400) return false;
  const parts = path.split('/');
  return family
    ? parts.length === 4 && parts[0] === 'avatars' && parts[1] === 'family' && parts[2] === uid && imageFilename.test(parts[3])
    : parts.length === 5 && parts[0] === 'avatars' && parts[1] === 'members' && parts[2] === targetUid && parts[3] === uid && imageFilename.test(parts[4]);
}

export function validateProfileUpdate(body, uid) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['update', 'family'].includes(body.action)) {
    failure('ACCOUNT_INVALID_REQUEST', 400, 'Wybierz poprawną operację edycji profilu.');
  }
  const family = body.action === 'family';
  const allowed = family ? ['action', 'emoji', 'avatarAction', 'avatarPath'] : ['action', 'uid', 'name', 'emoji', 'avatarAction', 'avatarPath'];
  if (Object.keys(body).some(key => !allowed.includes(key)) || !validUid(uid) || !family && !validUid(body.uid)) {
    failure('ACCOUNT_INVALID_REQUEST', 400, 'Żądanie zawiera nieobsługiwane pola.');
  }
  const changes = {};
  if (Object.hasOwn(body, 'name')) changes.name = text(body.name, 80, 'imię');
  if (Object.hasOwn(body, 'emoji')) changes.emoji = text(body.emoji, 32, 'ikona');
  if (Object.hasOwn(body, 'avatarAction')) {
    if (!['set', 'reset'].includes(body.avatarAction)) failure('ACCOUNT_INVALID_REQUEST', 400, 'Nieprawidłowa operacja zdjęcia.');
    if (body.avatarAction === 'set') {
      if (!validProfileAvatarPath(body.avatarPath, { uid, targetUid: body.uid, family })) {
        failure('ACCOUNT_INVALID_AVATAR', 400, 'Nieprawidłowa ścieżka zdjęcia profilu.');
      }
      changes.avatarPath = body.avatarPath;
      changes.avatarSource = 'custom';
      changes.photoURL = FieldValue.delete();
    } else {
      if (Object.hasOwn(body, 'avatarPath')) failure('ACCOUNT_INVALID_REQUEST', 400, 'Usunięcie zdjęcia nie wymaga ścieżki.');
      changes.avatarPath = FieldValue.delete();
      changes.photoURL = FieldValue.delete();
      changes.avatarSource = 'default';
    }
  } else if (Object.hasOwn(body, 'avatarPath')) {
    failure('ACCOUNT_INVALID_REQUEST', 400, 'Wybierz operację zmiany zdjęcia.');
  }
  if (!Object.keys(changes).length) failure('ACCOUNT_INVALID_REQUEST', 400, 'Nie wybrano żadnej zmiany profilu.');
  return { family, targetUid: family ? null : body.uid, changes };
}

export function assertProfileEditAllowed(actorUid, actor, targetUid, target) {
  if (!activeMember(actor)) failure('ACCOUNT_MEMBER_REQUIRED', 403, 'Konto nie ma aktywnego dostępu do Naszej Rodziny.');
  if (!target) failure('ACCOUNT_MEMBER_NOT_FOUND', 404, 'Nie znaleziono profilu.');
  if (target.active !== true || target.archived === true) failure('ACCOUNT_PROFILE_ARCHIVED', 409, 'Przywróć profil przed jego edycją.');
  if (actorUid === targetUid) return;
  if (actor.role === 'parent' && (target.role === 'child' || target.canLogin === false)) return;
  failure('ACCOUNT_PROFILE_EDIT_DENIED', 403, 'Możesz edytować własny profil. Rodzic może także edytować profil dziecka lub osoby bez konta.');
}

/** Profile presentation only. Role, UID, login and school bindings are never client-editable here. */
export async function manageProfileAction(context, body) {
  const definition = validateProfileUpdate(body, context.uid);
  if (definition.family) {
    await context.db.runTransaction(async transaction => {
      const actor = (await transaction.get(context.db.collection('members').doc(context.uid))).data();
      if (!activeMember(actor) || actor.role !== 'parent') {
        failure('ACCOUNT_PARENT_REQUIRED', 403, 'Profil całej rodziny edytuje aktywny rodzic.');
      }
      transaction.set(context.db.collection('familySettings').doc('profile'), {
        ...definition.changes, updatedBy: context.uid, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return { family: true };
  }
  await context.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(context.db.collection('members'));
    const profiles = new Map(snapshot.docs.map(row => [row.id, row.data()]));
    const target = profiles.get(definition.targetUid);
    assertProfileEditAllowed(context.uid, profiles.get(context.uid), definition.targetUid, target);
    const changes = { ...definition.changes };
    if (changes.name !== undefined && changes.name !== target.name) {
      // Legacy ownPerson() uses name only if personKey is absent. Freeze the
      // OLD identity before renaming; never let a child's display name grant
      // access to a sibling's records. A present but invalid key is not a fallback.
      const previousIdentity = Object.hasOwn(target, 'personKey') ? target.personKey : target.name;
      if (!validPerson(previousIdentity)) {
        failure('ACCOUNT_PROFILE_IDENTITY_INVALID', 409, 'Profil wymaga weryfikacji tożsamości przez administratora przed zmianą imienia.');
      }
      if (!Object.hasOwn(target, 'personKey')) changes.personKey = previousIdentity;
      const normalizedName = changes.name.toLocaleLowerCase('pl-PL');
      const duplicate = [...profiles].some(([id, profile]) => id !== definition.targetUid
        && (String(profile.name || '').normalize('NFC').toLocaleLowerCase('pl-PL') === normalizedName
          || legacyPeople.has(changes.name) && profile.personKey === changes.name));
      if (duplicate) failure('ACCOUNT_DUPLICATE_MEMBER', 409, 'Ta osoba ma już profil. Wybierz inne imię profilu.');
    }
    transaction.update(context.db.collection('members').doc(definition.targetUid), {
      ...changes, updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { memberUid: definition.targetUid };
}
