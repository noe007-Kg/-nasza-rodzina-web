import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { EduServerError, requireParent } from '../server/edu-auth.mjs';
import { decryptSession, encryptSession } from '../server/edu-secrets.mjs';
import { disconnectConnection, getConnectionStatus, normalizeReconcileScopes, prepareImportedSchoolItems, sanitizeStudents, saveConnection, selectConnectionStudent, updateConnectionSession, upsertSchoolItems } from '../server/edu-storage.mjs';

const previousKey = process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64;
const previousKeyId = process.env.EDUVULCAN_ENCRYPTION_KEY_ID;
const previousOrigin = process.env.EDUVULCAN_SITE_ORIGIN;
process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString('base64');
process.env.EDUVULCAN_ENCRYPTION_KEY_ID = 'tests';
delete process.env.EDUVULCAN_SITE_ORIGIN;
after(() => {
  for (const [key, value] of Object.entries({ EDUVULCAN_ENCRYPTION_KEY_BASE64: previousKey, EDUVULCAN_ENCRYPTION_KEY_ID: previousKeyId, EDUVULCAN_SITE_ORIGIN: previousOrigin })) {
    if (value == null) delete process.env[key]; else process.env[key] = value;
  }
});

function services(profile, verify = async () => ({ uid: 'parent' })) {
  return {
    auth: { verifyIdToken: verify },
    db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: Boolean(profile), data: () => profile }) }) }) },
  };
}
const parentProfile = { name: 'Sebastian', personKey: 'Sebastian', role: 'parent', active: true, canLogin: true };
const schoolContext = (uid = 'parent', db) => ({ uid, profile: parentProfile, db, connection: {
  id: 'family', scope: 'family', accountRole: 'parent', actorUid: uid,
  allowedPersonKeys: ['Nikodem', 'Paweł'], personProfileIds: { Nikodem: 'profile-nikodem', Paweł: 'profile-pawel' },
} });
const request = { headers: { authorization: 'Bearer header.payload.signature', host: 'rodzina.example' } };

test('backend requires a verified parent token with revocation checks', async () => {
  let checkedRevocation = false;
  const verified = await requireParent(request, services(parentProfile, async (token, revoked) => {
    assert.equal(token, 'header.payload.signature'); checkedRevocation = revoked; return { uid: 'parent' };
  }));
  assert.equal(verified.uid, 'parent');
  assert.equal(checkedRevocation, true);
  await assert.rejects(requireParent({ headers: {} }, services(parentProfile)), { code: 'EDU_UNAUTHENTICATED', status: 401 });
  await assert.rejects(requireParent(request, services(parentProfile, async () => { throw new Error('private Firebase rejection'); })), (error) => error.code === 'EDU_UNAUTHENTICATED' && !error.message.includes('private Firebase'));
});

const authEnvironmentKeys = ['FIREBASE_PROJECT_ID', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'VERCEL'];
async function withAuthEnvironment(values, action) {
  const previous = Object.fromEntries(authEnvironmentKeys.map((key) => [key, process.env[key]]));
  for (const key of authEnvironmentKeys) {
    if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key];
  }
  try { return await action(); }
  finally {
    for (const key of authEnvironmentKeys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
}

test('unsigned tokens are rejected in production and whenever any local emulator binding is absent', async () => {
  const bound = { FIREBASE_PROJECT_ID: 'demo-edu-security', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
  for (const { environment, appProjectId } of [
    { environment: { FIREBASE_PROJECT_ID: 'nasza-rodzina', VERCEL: '1' }, appProjectId: 'nasza-rodzina' },
    { environment: { ...bound, VERCEL: '1' }, appProjectId: 'demo-edu-security' },
    { environment: { ...bound, FIREBASE_PROJECT_ID: 'nasza-rodzina' }, appProjectId: 'demo-edu-security' },
    { environment: bound, appProjectId: 'demo-another-project' },
    { environment: { ...bound, FIREBASE_AUTH_EMULATOR_HOST: 'remote.example:9099' }, appProjectId: 'demo-edu-security' },
    { environment: { ...bound, FIRESTORE_EMULATOR_HOST: undefined }, appProjectId: 'demo-edu-security' },
  ]) {
    await withAuthEnvironment(environment, async () => {
      let verified = false;
      const context = { ...services(parentProfile, async () => { verified = true; return { uid: 'parent' }; }), app: { options: { projectId: appProjectId } } };
      await assert.rejects(requireParent({ headers: { authorization: 'Bearer header.payload.' } }, context), { code: 'EDU_UNAUTHENTICATED', status: 401 });
      assert.equal(verified, false);
    });
  }
});

test('explicitly bound local demo unsigned tokens still require Admin SDK verification and revocation checks', async () => {
  await withAuthEnvironment({ FIREBASE_PROJECT_ID: 'demo-edu-security', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, async () => {
    let verified = false;
    const context = {
      ...services(parentProfile, async (token, checkRevoked) => { assert.equal(token, 'header.payload.'); assert.equal(checkRevoked, true); verified = true; return { uid: 'parent' }; }),
      app: { options: { projectId: 'demo-edu-security' } },
    };
    const authenticated = await requireParent({ headers: { authorization: 'Bearer header.payload.' } }, context);
    assert.equal(authenticated.uid, 'parent');
    assert.equal(verified, true);
    context.auth.verifyIdToken = async () => { throw new Error('Invalid emulator claims'); };
    await assert.rejects(requireParent({ headers: { authorization: 'Bearer header.payload.' } }, context), { code: 'EDU_UNAUTHENTICATED', status: 401 });
  });
});

test('disabled, child and unregistered accounts cannot manage a school connection', async () => {
  for (const profile of [null, { ...parentProfile, role: 'child' }, { ...parentProfile, active: false }, { ...parentProfile, canLogin: false }]) {
    await assert.rejects(requireParent(request, services(profile)), { code: 'EDU_PARENT_REQUIRED', status: 403 });
  }
});

test('cross-site browser requests are rejected before token verification', async () => {
  let verified = false;
  await assert.rejects(requireParent({ headers: { ...request.headers, origin: 'https://foreign.example' } }, services(parentProfile, async () => { verified = true; return { uid: 'parent' }; })), { code: 'EDU_FORBIDDEN_ORIGIN' });
  assert.equal(verified, false);
});

test('session encryption uses random nonces and binds data to the owning parent', () => {
  const payload = { cookies: [{ name: 'session', value: 'private-cookie-value' }], profileKeys: { student1: 'private-provider-key' } };
  const first = encryptSession(payload, { uid: 'parent1' });
  const second = encryptSession(payload, { uid: 'parent1' });
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(JSON.stringify(first).includes('private-cookie-value'), false);
  assert.equal(JSON.stringify(first).includes('private-provider-key'), false);
  assert.deepEqual(decryptSession(first, { uid: 'parent1' }), payload);
  assert.throws(() => decryptSession(first, { uid: 'parent2' }), { code: 'EDU_SESSION_INVALID' });
  assert.throws(() => decryptSession(first, { uid: 'parent1', purpose: 'another-purpose' }), { code: 'EDU_SESSION_INVALID' });
});

test('corrupt ciphertext, authentication tags and changed keys cannot be decrypted', () => {
  const encrypted = encryptSession({ session: 'private-cookie' }, { uid: 'parent' });
  const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext[0] === 'A' ? 'B' : 'A'}${encrypted.ciphertext.slice(1)}` };
  assert.throws(() => decryptSession(tampered, { uid: 'parent' }), { code: 'EDU_SESSION_INVALID' });
  assert.throws(() => decryptSession({ ...encrypted, keyId: 'other-key' }, { uid: 'parent' }), { code: 'EDU_SESSION_INVALID' });
  assert.throws(() => decryptSession({ ...encrypted, tag: 'invalid' }, { uid: 'parent' }), { code: 'EDU_SESSION_INVALID' });
});

test('session persistence rejects passwords including nested credential fields', () => {
  for (const payload of [{ password: 'do-not-store' }, { state: { passwd: 'do-not-store' } }, { account: { credentials: { secret: 'do-not-store' } } }]) {
    assert.throws(() => encryptSession(payload, { uid: 'parent' }), { code: 'EDU_PASSWORD_RETENTION' });
  }
});

test('student metadata strips every upstream token and unknown property', () => {
  const students = sanitizeStudents([{ id: 'safe-profile-id', studentName: 'Nikodem', schoolName: 'SP4', className: '1a', key: 'private-key', cookies: ['private-cookie'], accessToken: 'secret' }]);
  assert.deepEqual(students, [{ id: 'safe-profile-id', studentName: 'Nikodem', schoolName: 'SP4', className: '1a' }]);
  assert.throws(() => sanitizeStudents([{ id: 'same', studentName: 'a' }, { id: 'same', studentName: 'b' }]), { code: 'EDU_INVALID_DATA' });
});

test('imported identities are stable across parents and distinct across people', () => {
  const input = { personKey: 'Nikodem', profileId: 'safe-id', items: [{ externalId: 'grade-123', type: 'grade', title: '5', subject: 'Polski', person: 'Paweł', provider: 'spoof' }] };
  const first = prepareImportedSchoolItems('family', input, schoolContext('parent1'));
  const second = prepareImportedSchoolItems('family', input, schoolContext('parent2'));
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].data.person, 'Nikodem');
  assert.equal(first[0].data.source, 'eduvulcan');
  assert.equal(first[0].data.provider, 'eduvulcan');
  assert.equal(first[0].data.sourceOwnerUid, 'parent1');
  assert.notEqual(first[0].id, prepareImportedSchoolItems('family', { ...input, personKey: 'Paweł' }, schoolContext('parent1'))[0].id);
});

test('imported messages are isolated from children school collection', () => {
  const result = prepareImportedSchoolItems('family', { personKey: 'Nikodem', profileId: 'safe-id', items: [{ sourceRecordId: 'message-1', type: 'message', title: 'Od wychowawcy', body: 'Prywatna wiadomość', sender: 'Wychowawca', read: true }] }, schoolContext());
  assert.equal(result[0].collection, 'schoolParentMessages');
  assert.equal(result[0].data.note, 'Prywatna wiadomość');
  assert.equal(result[0].data.personKey, 'Nikodem');
  assert.equal(result[0].data.read, true);
});

test('malformed, repeated and oversized import batches fail before any database write', () => {
  const item = { externalId: 'same', type: 'lesson', title: 'Polski' };
  const base = { personKey: 'Nikodem', profileId: 'safe-id' };
  for (const items of [[item, item], [{ ...item, externalId: '' }], [{ ...item, type: 'other' }], Array.from({ length: 401 }, (_, i) => ({ ...item, externalId: String(i) }))]) {
    assert.throws(() => prepareImportedSchoolItems('family', { ...base, items }, schoolContext()), EduServerError);
  }
});

// Transactional in-memory boundary: successful writes commit together, failures commit none.
function databaseFixture(initial) {
  const records = new Map(Object.entries({
    'members/parent': parentProfile,
    'members/profile-nikodem': { role: 'child', active: true, canLogin: false, personKey: 'Nikodem', schoolEnabled: true },
    'members/profile-pawel': { role: 'child', active: true, canLogin: false, personKey: 'Paweł', schoolEnabled: true },
    ...initial,
  }));
  let writes = 0;
  let schoolReads = 0;
  const snapshot = (reference) => ({ exists: records.has(reference.path), data: () => records.get(reference.path) });
  const reference = (path) => ({ path, get: async () => snapshot({ path }), delete: async () => records.delete(path) });
  const resolveField = (value) => {
    if (typeof value?.isEqual === 'function') {
      try {
        if (value.isEqual(FieldValue.delete())) return { deleted: true };
        if (value.isEqual(FieldValue.serverTimestamp())) return { value: Timestamp.now() };
      } catch { /* Timestamp is not a FieldValue. */ }
    }
    return { value };
  };
  const db = {
    collection: (name) => ({
      doc: (id) => reference(`${name}/${id}`),
      where: (field, operator, value) => ({ limit: (limit) => ({ get: async () => {
        assert.equal(operator, '==');
        const rows = [...records.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).slice(0, limit);
        return { size: rows.length, docs: rows.map(([path, data]) => ({ id: path.split('/').at(-1), ref: reference(path), data: () => data })) };
      } }) }),
    }),
    runTransaction: async (callback) => {
      const pending = [];
      const result = await callback({
        get: async (ref) => snapshot(ref),
        getAll: async (...refs) => { schoolReads += refs.length; return refs.map(snapshot); },
        set: (ref, data) => pending.push({ method: 'set', ref, data }),
        update: (ref, data) => pending.push({ method: 'update', ref, data }),
        delete: (ref) => pending.push({ method: 'delete', ref }),
      });
      for (const change of pending) {
        writes += 1;
        if (change.method === 'delete') { records.delete(change.ref.path); continue; }
        const next = change.method === 'set' ? {} : { ...records.get(change.ref.path) };
        for (const [key, field] of Object.entries(change.data)) {
          const resolved = resolveField(field);
          if (resolved.deleted) delete next[key]; else next[key] = resolved.value;
        }
        records.set(change.ref.path, next);
      }
      return result;
    },
  };
  return { records, services: schoolContext('parent', db), get writes() { return writes; }, get schoolReads() { return schoolReads; } };
}

function connectedFixture() {
  return {
    scope: 'family', accountRole: 'parent', connectedByUid: 'parent',
    students: [{ id: 'safe-id', studentName: 'Nikodem', schoolName: 'SP4' }],
    selectedStudent: { profileId: 'safe-id', personKey: 'Nikodem' },
    expiresAt: Timestamp.fromMillis(Date.now() + 3600000), sessionVersion: 'version-new',
    lease: { id: 'lease-new', expiresAt: Timestamp.fromMillis(Date.now() + 120000) },
    envelope: { ciphertext: 'never-return-this' },
  };
}
const guardedImport = { personKey: 'Nikodem', profileId: 'safe-id', sessionVersion: 'version-new', leaseId: 'lease-new', items: [{ externalId: 'lesson-1', type: 'lesson', title: 'Polski' }] };

test('disconnect, reconnect, changed pupil and stale leases block sync before any school read or write', async () => {
  for (const connection of [null, { ...connectedFixture(), sessionVersion: 'changed' }, { ...connectedFixture(), lease: { id: 'changed', expiresAt: Timestamp.fromMillis(Date.now() + 100000) } }, { ...connectedFixture(), selectedStudent: { profileId: 'another-profile', personKey: 'Nikodem' } }]) {
    const fixture = databaseFixture(connection ? { '_eduConnections/family': connection } : {});
    await assert.rejects(upsertSchoolItems('family', guardedImport, fixture.services), { code: 'EDU_CONNECTION_CHANGED' });
    assert.equal(fixture.writes, 0);
    assert.equal(fixture.schoolReads, 0);
  }
});

test('a manual row collision fails the whole import without altering existing data', async () => {
  const generated = prepareImportedSchoolItems('family', guardedImport, schoolContext())[0];
  const manual = { person: 'Nikodem', title: 'Ręczny wpis rodziny', type: 'lesson', createdBy: 'parent' };
  const fixture = databaseFixture({ '_eduConnections/family': connectedFixture(), [`schoolItems/${generated.id}`]: manual });
  await assert.rejects(upsertSchoolItems('family', guardedImport, fixture.services), { code: 'EDU_IMPORT_CONFLICT' });
  assert.equal(fixture.writes, 0);
  assert.deepEqual(fixture.records.get(`schoolItems/${generated.id}`), manual);
});

test('valid synchronization upserts provider rows with stable identities and preserves original creation', async () => {
  const connection = connectedFixture();
  const generated = prepareImportedSchoolItems('family', guardedImport, schoolContext())[0];
  const createdAt = Timestamp.fromMillis(1000);
  const existing = { ...generated.data, title: 'Poprzedni tytuł', createdBy: 'another-parent', createdAt };
  const fixture = databaseFixture({ '_eduConnections/family': connection, [`schoolItems/${generated.id}`]: existing });
  const counts = await upsertSchoolItems('family', guardedImport, fixture.services);
  assert.deepEqual(counts, { added: 0, updated: 1, deleted: 0, total: 1, messages: 0 });
  const updated = fixture.records.get(`schoolItems/${generated.id}`);
  assert.equal(updated.title, 'Polski');
  assert.equal(updated.createdBy, 'another-parent');
  assert.equal(updated.createdAt.toMillis(), 1000);
});

test('status excludes encrypted sessions and selection cannot refer to an unlisted pupil', async () => {
  const connection = connectedFixture();
  delete connection.lease;
  const fixture = databaseFixture({ '_eduConnections/family': connection });
  const status = await getConnectionStatus('family', fixture.services);
  assert.equal(status.state, 'connected');
  assert.equal(JSON.stringify(status).includes('never-return-this'), false);
  assert.equal('sessionVersion' in status, false);
  await assert.rejects(selectConnectionStudent('family', { profileId: 'foreign-profile', personKey: 'Nikodem' }, fixture.services), { code: 'EDU_INVALID_STUDENT' });
  assert.equal(fixture.writes, 0);
});

test('refreshed cookie jars cannot overwrite a newly reconnected session', async () => {
  const fixture = databaseFixture({ '_eduConnections/family': connectedFixture() });
  await assert.rejects(updateConnectionSession('family', { cookies: [] }, { sessionVersion: 'old-version', leaseId: 'lease-new' }, fixture.services), { code: 'EDU_CONNECTION_CHANGED' });
  assert.equal(fixture.writes, 0);
});

test('disconnect cancels an in-flight login without resetting brute-force attempt counters', async () => {
  const fixture = databaseFixture({
    '_eduConnections/family': connectedFixture(),
    '_eduConnectLocks/family': { id: 'login-in-flight', attempts: 4, expiresAt: Timestamp.fromMillis(Date.now() + 90000), windowStartedAt: Timestamp.now() },
  });
  await disconnectConnection('family', fixture.services);
  assert.equal(fixture.records.has('_eduConnections/family'), false);
  assert.equal(fixture.records.get('_eduConnectLocks/family').attempts, 4);
  await assert.rejects(saveConnection('family', { session: { cookies: [] }, profiles: [{ id: 'safe-id', studentName: 'Nikodem' }], connectLeaseId: 'login-in-flight' }, fixture.services), { code: 'EDU_CONNECTION_CHANGED' });
  assert.equal(fixture.records.has('_eduConnections/family'), false);
});

function providerRow({ type = 'grade', person = 'Nikodem', scope = 'grades:period1', date = '', externalId = 'old-1' } = {}) {
  return { source: 'eduvulcan', sourceRecordId: externalId, sourceProfileId: 'safe-id', providerScopeId: scope, person, type, date, title: 'Stary wpis' };
}

test('complete grade scope prunes withdrawn provider grades while retaining other periods, people and manual rows', async () => {
  const fixture = databaseFixture({
    '_eduConnections/family': connectedFixture(),
    'schoolItems/old-grade': providerRow(),
    'schoolItems/another-period': providerRow({ scope: 'grades:period2' }),
    'schoolItems/another-person': providerRow({ person: 'Paweł' }),
    'schoolItems/manual': { person: 'Nikodem', sourceProfileId: 'safe-id', providerScopeId: 'grades:period1', title: 'Ręczny wpis' },
  });
  const result = await upsertSchoolItems('family', { ...guardedImport, items: [], reconcileScopes: [{ type: 'grade', scopeId: 'grades:period1' }] }, fixture.services);
  assert.equal(result.deleted, 1);
  assert.equal(fixture.records.has('schoolItems/old-grade'), false);
  for (const id of ['another-period', 'another-person', 'manual']) assert.equal(fixture.records.has(`schoolItems/${id}`), true);
});

test('timetable reconciliation is bounded by date and preserves rows outside its confirmed range', async () => {
  const fixture = databaseFixture({
    '_eduConnections/family': connectedFixture(),
    'schoolItems/withdrawn': providerRow({ type: 'lesson', scope: 'timetable', date: '2026-10-04' }),
    'schoolItems/history': providerRow({ type: 'lesson', scope: 'timetable', date: '2026-09-24' }),
    'schoolItems/future': providerRow({ type: 'lesson', scope: 'timetable', date: '2026-10-21' }),
    'schoolItems/undated': providerRow({ type: 'lesson', scope: 'timetable', date: '' }),
  });
  const result = await upsertSchoolItems('family', { ...guardedImport, items: [], reconcileScopes: [{ type: 'lesson', scopeId: 'timetable', dateFrom: '2026-10-01', dateTo: '2026-10-07' }] }, fixture.services);
  assert.equal(result.deleted, 1);
  assert.equal(fixture.records.has('schoolItems/withdrawn'), false);
  for (const id of ['history', 'future', 'undated']) assert.equal(fixture.records.has(`schoolItems/${id}`), true);
});

test('failed, partial or unscoped provider fetches cannot trigger pruning', async () => {
  const fixture = databaseFixture({ '_eduConnections/family': connectedFixture(), 'schoolItems/old-grade': providerRow() });
  const result = await upsertSchoolItems('family', { ...guardedImport, items: [] }, fixture.services);
  assert.equal(result.deleted, 0);
  assert.equal(fixture.records.has('schoolItems/old-grade'), true);
  for (const scope of [{ type: 'message', scopeId: 'all' }, { type: 'grade', scopeId: 'grades:period1', dateFrom: '2026-10-01' }, { type: 'lesson', scopeId: 'timetable', dateFrom: '2026-02-31', dateTo: '2026-03-03' }]) {
    assert.throws(() => normalizeReconcileScopes([scope]), { code: 'EDU_INVALID_DATA' });
  }
});

test('excessive reconciliation changes fail before writing or deleting any data', async () => {
  const initial = { '_eduConnections/family': connectedFixture() };
  for (let index = 0; index < 451; index += 1) initial[`schoolItems/old-${index}`] = providerRow({ externalId: `old-${index}` });
  const fixture = databaseFixture(initial);
  await assert.rejects(upsertSchoolItems('family', { ...guardedImport, items: [], reconcileScopes: [{ type: 'grade', scopeId: 'grades:period1' }] }, fixture.services), { code: 'EDU_IMPORT_LIMIT' });
  assert.equal(fixture.writes, 0);
  assert.equal(fixture.records.size, 455);
});
