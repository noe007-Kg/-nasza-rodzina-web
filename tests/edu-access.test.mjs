import test from 'node:test';
import assert from 'node:assert/strict';
import { requireMember, requireParent } from '../server/edu-auth.mjs';
import { FAMILY_CONNECTION_ID, requireEduConnection, resolveConnectionAccess, studentConnectionId } from '../server/edu-access.mjs';

const active = { active: true, canLogin: true };
const parent = { ...active, role: 'parent', name: 'Rodzic z pełnym nazwiskiem' };
const student = { ...active, role: 'child', name: 'Nikodem', personKey: 'Nikodem' };
const identity = { studentName: 'Uczeń testowy', schoolName: 'Testowa szkoła podstawowa', schoolSymbol: 'SP4' };

function services(uid, profile, bindings = {}) {
  const reads = [];
  const checks = [];
  return {
    reads, checks,
    auth: { verifyIdToken: async (token, checkRevoked) => {
      assert.equal(token, 'header.payload.signature');
      checks.push(checkRevoked);
      return { uid };
    } },
    db: { collection: (collection) => ({ doc: (id) => ({ get: async () => {
      reads.push(`${collection}/${id}`);
      const data = collection === 'members' && id === uid ? profile : collection === '_eduStudentBindings' ? bindings[id] : null;
      return { exists: Boolean(data), data: () => data };
    } }) }) },
  };
}

function request(scope, extra = {}) {
  return {
    headers: { authorization: 'Bearer header.payload.signature', host: 'rodzina.example', origin: 'https://rodzina.example',
      ...(scope === undefined ? {} : { 'x-edu-connection-scope': scope }) }, ...extra,
  };
}

test('parent authorization uses the verified role and active flags, independently of display name or personKey', async () => {
  for (const profile of [parent, { ...parent, personKey: 'Dominika', name: 'Pełne nazwisko rodzica' }, { ...parent, name: undefined }]) {
    const context = services('verified-parent', profile);
    assert.equal((await requireParent(request(), context)).uid, 'verified-parent');
    assert.deepEqual(context.checks, [true]);
  }
});

test('two parents manage one family connection without selecting a Firebase owner UID', async () => {
  const first = await requireEduConnection(request(), services('parent-a', { ...parent, name: 'Dominika Rodzic' }));
  const second = await requireEduConnection(request('family', { body: { uid: 'parent-a', connectionId: 'someone-else' } }), services('parent-b', { ...parent, name: 'Sebastian Rodzic' }));
  assert.equal(first.connection.id, FAMILY_CONNECTION_ID);
  assert.equal(second.connection.id, FAMILY_CONNECTION_ID);
  assert.equal(first.connection.actorUid, 'parent-a');
  assert.equal(second.connection.actorUid, 'parent-b');
  assert.equal(first.connection.accountRole, 'parent');
  assert.deepEqual(first.connection.allowedPersonKeys, ['Paweł', 'Nikodem', 'Layla']);
});

test('an eduVULCAN activation identity or parent display name never grants the application parent role', async () => {
  for (const profile of [null, { ...parent, role: 'child' }, { ...parent, role: 'admin' }, { ...parent, active: false }, { ...parent, canLogin: false }]) {
    await assert.rejects(requireEduConnection(request(), services('blocked-user', profile)), { code: 'EDU_PARENT_REQUIRED', status: 403 });
  }
  await assert.rejects(requireMember(request(), services('inactive', { ...student, active: false })), { code: 'EDU_MEMBER_REQUIRED', status: 403 });
});

test('default family scope refuses a child before reading any parent connection or student binding', async () => {
  const context = services('nikodem-user', student, { Nikodem: { identity } });
  await assert.rejects(requireEduConnection(request(), context), { code: 'EDU_PARENT_REQUIRED', status: 403 });
  assert.deepEqual(context.reads, ['members/nikodem-user']);
});

test('a future student scope is bound to its verified UID and parent-approved school identity', async () => {
  const context = services('nikodem-user', student, { Nikodem: { identity: { ...identity, accessToken: 'synthetic-private-binding-value' } } });
  const authorized = await requireEduConnection(request('student', { body: { uid: 'sibling-user', personKey: 'Paweł' } }), context);
  assert.deepEqual(authorized.connection, {
    id: studentConnectionId('nikodem-user'), scope: 'student', accountRole: 'student', actorUid: 'nikodem-user',
    allowedPersonKeys: ['Nikodem'], allowedStudentIdentity: identity,
  });
  assert.deepEqual(context.reads, ['members/nikodem-user', '_eduStudentBindings/Nikodem']);
  assert.doesNotMatch(JSON.stringify(authorized.connection), /synthetic-private-binding-value|sibling-user/);
  assert.notEqual(authorized.connection.id, FAMILY_CONNECTION_ID);
  assert.notEqual(authorized.connection.id, studentConnectionId('sibling-user'));
});

test('siblings get separate own scopes even if a request supplies another child name', async () => {
  const context = services('pawel-user', { ...student, name: 'Paweł', personKey: 'Paweł' }, {
    Nikodem: { identity }, Paweł: { identity: { ...identity, studentName: 'Drugi uczeń testowy' } },
  });
  const authorized = await requireEduConnection(request('student', { body: { personKey: 'Nikodem', connectionId: FAMILY_CONNECTION_ID } }), context);
  assert.deepEqual(authorized.connection.allowedPersonKeys, ['Paweł']);
  assert.equal(authorized.connection.allowedStudentIdentity.studentName, 'Drugi uczeń testowy');
  assert.deepEqual(context.reads, ['members/pawel-user', '_eduStudentBindings/Paweł']);
});

test('future student access requires a canonical family child and a complete approved identity', async () => {
  for (const binding of [undefined, {}, { identity: {} }, { identity: { studentName: '', schoolName: identity.schoolName } }, { identity: { studentName: identity.studentName, schoolName: 123 } }]) {
    await assert.rejects(requireEduConnection(request('student'), services('nikodem-user', student, { Nikodem: binding })), { code: 'EDU_STUDENT_LINK_REQUIRED', status: 403 });
  }
  for (const profile of [{ ...student, personKey: 'Sebastian' }, { ...student, personKey: 'sibling/uid' }, { ...student, personKey: undefined }, { ...student, personKey: null }, { ...student, personKey: '' }]) {
    await assert.rejects(requireEduConnection(request('student'), services('nikodem-user', profile, { Nikodem: { identity } })), { code: 'EDU_STUDENT_LINK_REQUIRED', status: 403 });
  }
  const legacyStudent = { ...student };
  delete legacyStudent.personKey;
  const nameFallback = await requireEduConnection(request('student'), services('nikodem-user', legacyStudent, { Nikodem: { identity } }));
  assert.deepEqual(nameFallback.connection.allowedPersonKeys, ['Nikodem']);
});

test('parents cannot take ownership of a student session and arbitrary scope names are rejected', async () => {
  await assert.rejects(requireEduConnection(request('student'), services('parent-user', parent, { Nikodem: { identity } })), { code: 'EDU_STUDENT_REQUIRED', status: 403 });
  for (const scope of ['personal', 'student_other-user', '../../family']) {
    const context = services('parent-user', parent);
    await assert.rejects(requireEduConnection(request(scope), context), { code: 'EDU_INVALID_REQUEST', status: 400 });
    assert.deepEqual(context.reads, []);
  }
  await assert.rejects(resolveConnectionAccess({ uid: 'parent-user', profile: { ...parent, active: false } }), { code: 'EDU_MEMBER_REQUIRED', status: 403 });
});

test('student document IDs cannot be used for path traversal or connection scope collisions', () => {
  for (const uid of ['', null, 'nested/uid', 'x'.repeat(129)]) assert.throws(() => studentConnectionId(uid), { code: 'EDU_UNAUTHENTICATED' });
  assert.equal(studentConnectionId('family'), studentConnectionId('family'));
  assert.notEqual(studentConnectionId('family'), FAMILY_CONNECTION_ID);
  assert.match(studentConnectionId('student-uid'), /^student_[a-f0-9]{64}$/);
});
