import test from 'node:test';
import assert from 'node:assert/strict';
import { requireMember, requireParent } from '../server/edu-auth.mjs';
import { FAMILY_CONNECTION_ID, requireEduConnection, resolveConnectionAccess, studentConnectionId } from '../server/edu-access.mjs';

const active = { active: true, canLogin: true };
const parent = { ...active, role: 'parent', name: 'Rodzic z pełnym nazwiskiem' };
const student = { ...active, role: 'child', name: 'Nikodem', personKey: 'Nikodem', schoolEnabled: true };
const identity = { studentName: 'Uczeń testowy', schoolName: 'Testowa szkoła podstawowa', schoolSymbol: 'SP4' };
const dynamicPerson = 'member-0123456789abcdef01234567';
const defaultChildren = {
  'school-nikodem': student,
  'school-pawel': { ...student, name: 'Paweł', personKey: 'Paweł' },
  'school-layla': { ...student, name: 'Layla', personKey: 'Layla', canLogin: false, schoolEnabled: false },
};

function services(uid, profile, bindings = {}, roster) {
  const reads = [];
  const checks = [];
  const members = { ...(roster ?? (profile?.role === 'child' ? {} : defaultChildren)), [uid]: profile };
  return {
    reads, checks, members,
    auth: { verifyIdToken: async (token, checkRevoked) => {
      assert.equal(token, 'header.payload.signature');
      checks.push(checkRevoked);
      return { uid };
    } },
    db: { collection: (collection) => ({
      doc: (id) => ({ get: async () => {
        reads.push(`${collection}/${id}`);
        const data = collection === 'members' ? members[id] : collection === '_eduStudentBindings' ? bindings[id] : null;
        return { id, exists: Boolean(data), data: () => data };
      } }),
      where: (field, operator, value) => {
        assert.equal(collection, 'members'); assert.equal(field, 'role'); assert.equal(operator, '=='); assert.equal(value, 'child');
        return { limit: limit => {
          assert.equal(limit, 65);
          return { get: async () => {
            reads.push('members?role=child&limit=65');
            const docs = Object.entries(members).filter(([, member]) => member?.role === value)
              .sort(([first], [second]) => first.localeCompare(second)).slice(0, limit)
              .map(([id, data]) => ({ id, exists: true, data: () => data }));
            return { docs, size: docs.length };
          } };
        } };
      },
    }) },
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
  assert.deepEqual([...first.connection.allowedPersonKeys].sort(), ['Nikodem', 'Paweł']);
  assert.deepEqual({ ...first.connection.personProfileIds }, { Nikodem: 'school-nikodem', Paweł: 'school-pawel' });
  assert.deepEqual(second.connection.personProfileIds, first.connection.personProfileIds);
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
    allowedPersonKeys: ['Nikodem'], personProfileIds: { Nikodem: 'nikodem-user' }, allowedStudentIdentity: identity,
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
  delete legacyStudent.schoolEnabled;
  const nameFallback = await requireEduConnection(request('student'), services('nikodem-user', legacyStudent, { Nikodem: { identity } }));
  assert.deepEqual(nameFallback.connection.allowedPersonKeys, ['Nikodem']);
});

test('family access uses the actual dynamic school roster, including children without a login', async () => {
  const passive = { ...student, name: 'Nowe dziecko bez konta', personKey: dynamicPerson, canLogin: false };
  const disabledAlias = { ...student, schoolEnabled: false };
  const roster = {
    'profile-new-child': passive,
    'old-alias-disabled': disabledAlias,
    'archived-child': { ...student, personKey: 'member-111111111111111111111111', archived: true },
    'inactive-child': { ...student, personKey: 'member-222222222222222222222222', active: false },
    'disabled-child': { ...student, personKey: 'member-333333333333333333333333', disabled: true },
    'non-school-child': { ...student, personKey: 'member-444444444444444444444444', schoolEnabled: false },
    'school-adult': { ...student, role: 'adult', personKey: 'member-555555555555555555555555' },
  };
  const context = services('parent-user', parent, {}, roster);
  const result = await requireEduConnection(request('family', { body: { personKey: 'Nikodem', uid: 'someone-else' } }), context);
  assert.deepEqual(result.connection.allowedPersonKeys, [dynamicPerson]);
  assert.deepEqual({ ...result.connection.personProfileIds }, { [dynamicPerson]: 'profile-new-child' });
  assert.deepEqual(context.reads, ['members/parent-user', 'members?role=child&limit=65']);
});

test('a family without eligible school profiles has an empty scope instead of implicit legacy grants', async () => {
  const context = services('parent-user', { ...parent, name: 'Nikodem', personKey: 'Nikodem' }, {}, {});
  const result = await requireEduConnection(request(), context);
  assert.deepEqual(result.connection.allowedPersonKeys, []);
  assert.deepEqual({ ...result.connection.personProfileIds }, {});
  assert.equal(result.connection.id, FAMILY_CONNECTION_ID);
});

test('legacy school defaults require existing child documents and explicit flags override them', async () => {
  const legacyNikodem = { ...student }; delete legacyNikodem.personKey; delete legacyNikodem.schoolEnabled;
  const legacyLayla = { ...student, name: 'Layla', personKey: 'Layla', canLogin: false }; delete legacyLayla.schoolEnabled;
  const roster = { 'legacy-nikodem': legacyNikodem, 'legacy-layla': legacyLayla,
    'explicit-pawel-off': { ...student, name: 'Paweł', personKey: 'Paweł', schoolEnabled: false } };
  const first = await requireEduConnection(request(), services('parent-user', parent, {}, roster));
  assert.deepEqual(first.connection.allowedPersonKeys, ['Nikodem']);
  assert.deepEqual({ ...first.connection.personProfileIds }, { Nikodem: 'legacy-nikodem' });
  const enabledLayla = await requireEduConnection(request(), services('parent-user', parent, {}, {
    'legacy-layla': { ...legacyLayla, schoolEnabled: true },
  }));
  assert.deepEqual(enabledLayla.connection.allowedPersonKeys, ['Layla']);
});

test('an explicitly malformed legacy school flag cannot authorize family or personal access', async () => {
  for (const schoolEnabled of [undefined, null, 'true', 'false', 0, 1, {}, []]) {
    const malformed = { ...student, schoolEnabled };
    const family = await requireEduConnection(request(), services('parent-user', parent, {}, {
      'legacy-nikodem': malformed,
    }));
    assert.deepEqual(family.connection.allowedPersonKeys, []);
    assert.deepEqual({ ...family.connection.personProfileIds }, {});
    const own = services('student-user', malformed, { Nikodem: { identity } });
    await assert.rejects(requireEduConnection(request('student'), own), { code: 'EDU_STUDENT_LINK_REQUIRED', status: 403 });
    assert.deepEqual(own.reads, ['members/student-user']);
  }
});

test('a malformed eligible child or duplicate person identity fails closed before granting a family target', async () => {
  for (const personKey of ['', null, undefined, 'family', 'profile-new-child', 'member-not-a-valid-key', 'member-ABCDEF0123456789ABCDEF01', 'Sebastian', 'nested/uid']) {
    const context = services('parent-user', parent, {}, { 'bad-child': { ...student, personKey } });
    await assert.rejects(requireEduConnection(request(), context), { code: 'EDU_STUDENT_LINK_REQUIRED', status: 403 });
  }
  const duplicate = services('parent-user', parent, {}, {
    'first-child': { ...student, personKey: dynamicPerson },
    'profile-second-child': { ...student, personKey: dynamicPerson, canLogin: false },
  });
  await assert.rejects(requireEduConnection(request(), duplicate), { code: 'EDU_STUDENT_LINK_REQUIRED', status: 403 });
  const ignored = await requireEduConnection(request(), services('parent-user', parent, {}, {
    'valid-child': { ...student, personKey: dynamicPerson },
    'archived-duplicate': { ...student, personKey: dynamicPerson, archived: true },
    'disabled-malformed': { ...student, personKey: 'bad-format', schoolEnabled: false },
  }));
  assert.deepEqual({ ...ignored.connection.personProfileIds }, { [dynamicPerson]: 'valid-child' });
});

test('the bounded family roster refuses truncation beyond 64 actual children', async () => {
  const roster = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`profile-child-${index}`, {
    ...student, personKey: `member-${index.toString(16).padStart(24, '0')}`,
  }]));
  await assert.rejects(requireEduConnection(request(), services('parent-user', parent, {}, roster)), { code: 'EDU_MEMBER_LIMIT', status: 409 });
  delete roster['profile-child-64'];
  const allowed = await requireEduConnection(request(), services('parent-user', parent, {}, roster));
  assert.equal(allowed.connection.allowedPersonKeys.length, 64);
  assert.equal(Object.keys(allowed.connection.personProfileIds).length, 64);
});

test('a dynamic student scope remains tied to its own UID and approved identity, not client-supplied aliases', async () => {
  const dynamicStudent = { ...student, name: 'Nowy uczeń', personKey: dynamicPerson };
  const context = services('profile-new-child', dynamicStudent, { [dynamicPerson]: { identity } });
  const result = await requireEduConnection(request('student', { body: { uid: 'sibling-user', personKey: 'Nikodem' } }), context);
  assert.deepEqual(result.connection.allowedPersonKeys, [dynamicPerson]);
  assert.deepEqual(result.connection.personProfileIds, { [dynamicPerson]: 'profile-new-child' });
  assert.deepEqual(result.connection.allowedStudentIdentity, identity);
  assert.equal(result.connection.id, studentConnectionId('profile-new-child'));
  assert.deepEqual(context.reads, ['members/profile-new-child', `_eduStudentBindings/${dynamicPerson}`]);
  await assert.rejects(requireEduConnection(request('student'), services('profile-new-child', dynamicStudent, { Nikodem: { identity } })), { code: 'EDU_STUDENT_LINK_REQUIRED', status: 403 });
});

test('personal student access requires login and school eligibility even when an approved binding exists', async () => {
  for (const changes of [{ canLogin: false }, { active: false }, { archived: true }, { disabled: true }]) {
    await assert.rejects(requireEduConnection(request('student'), services('student-user', { ...student, ...changes }, { Nikodem: { identity } })), error => {
      assert.equal(error.status, 403);
      assert.match(error.code, /^EDU_(?:MEMBER_REQUIRED|STUDENT_LINK_REQUIRED)$/);
      return true;
    });
  }
  for (const changes of [{ schoolEnabled: false }, { name: 'Layla', personKey: 'Layla', schoolEnabled: undefined }]) {
    await assert.rejects(requireEduConnection(request('student'), services('student-user', { ...student, ...changes }, { Nikodem: { identity }, Layla: { identity } })), { code: 'EDU_STUDENT_LINK_REQUIRED', status: 403 });
  }
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
