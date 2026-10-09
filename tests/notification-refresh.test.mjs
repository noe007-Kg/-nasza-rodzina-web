import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshInAppNotifications, planRefreshSource, refreshSources, validateRefreshBody, MAX_REFRESH_RECORDS, MIN_REFRESH_INTERVAL_MS } from '../server/notification-refresh.mjs';
import { enqueueInAppEvents } from '../server/notification-inbox.mjs';

const parent = { role: 'parent', name: 'Sebastian', active: true, canLogin: true };
const child = { role: 'child', name: 'Nikodem', personKey: 'Nikodem', active: true, canLogin: true };
const task = { title: 'Rodzinne zadanie', person: 'family', done: false, createdBy: 'other' };
const message = { text: 'Prywatna treść nie może trafić do inbox', uid: 'other', name: 'Dominika', channel: 'family', participants: [], createdAt: 100 };
const row = (id, data) => ({ id, data });
function database(seed = {}, uid = 'own', profile = parent) {
  const values = new Map(Object.entries({ [`members/${uid}`]: profile, ...seed }));
  const reads = [];
  let queue = Promise.resolve();
  const snapshot = ref => ({ id: ref.id, exists: values.has(ref.path), data: () => values.get(ref.path) });
  const reference = path => ({ path, id: path.split('/').at(-1), async get() { return snapshot(this); }, collection(name) { return source(`${path}/${name}`); } });
  function source(path, clauses = [], count = Infinity, ordering) {
    return {
      doc(id) { return reference(`${path}/${id}`); },
      where(field, operator, expected) { return source(path, [...clauses, [field, operator, expected]], count, ordering); },
      limit(limit) { return source(path, clauses, limit, ordering); },
      orderBy(field, direction) { return source(path, clauses, count, [field, direction]); },
      async get() {
        reads.push({ path, clauses, count, ordering });
        let documents = [...values].filter(([key]) => key.startsWith(path + '/') && key.slice(path.length + 1).split('/').length === 1)
          .map(([key]) => snapshot(reference(key))).filter(document => clauses.every(([field, operator, expected]) => {
            const value = document.data()[field];
            return operator === '==' ? value === expected : operator === 'in' ? expected.includes(value) : operator === 'array-contains' ? Array.isArray(value) && value.includes(expected) : false;
          }));
        if (ordering) documents.sort((a, b) => (Number(a.data()[ordering[0]]) - Number(b.data()[ordering[0]])) * (ordering[1] === 'desc' ? -1 : 1));
        documents = documents.slice(0, count);
        return { docs: documents, size: documents.length };
      },
    };
  }
  const db = { collection: source, runTransaction(callback) {
    const operation = queue.then(() => callback({
      async get(ref) { return snapshot(ref); }, async getAll(...refs) { return refs.map(snapshot); },
      set(ref, value) { values.set(ref.path, value); },
      create(ref, value) { assert.equal(values.has(ref.path), false); values.set(ref.path, value); },
    }));
    queue = operation.catch(() => {});
    return operation;
  } };
  return { db, values, reads, context: { uid, profile, db }, inbox: () => [...values].filter(([path]) => path.startsWith(`notificationInbox/${uid}/items/`)).map(([, value]) => value) };
}
const refresh = (data, now, options = {}) => refreshInAppNotifications(data.context, { reason: 'changes' }, { now, ...options });

test('refresh accepts only a bounded activation reason, never UID/content/collection supplied by a client', () => {
  for (const body of [{}, { reason: 'launch' }, { reason: 'foreground' }, { reason: 'changes' }]) assert.doesNotThrow(() => validateRefreshBody(body));
  for (const body of [null, [], { uid: 'other' }, { reason: 'anything' }, { reason: 'launch', text: 'spoof' }, { collection: 'schoolParentMessages' }]) assert.throws(() => validateRefreshBody(body), { code: 'NOTIFICATION_INVALID_REQUEST' });
});
test('the first source snapshot records a quiet baseline with fingerprints, never old private content', () => {
  const plan = planRefreshSource('familyMessages', undefined, [row('old', message)], { ...parent, id: 'own' });
  assert.equal(plan.baseline, true); assert.deepEqual(plan.pending, []); assert.equal(plan.historyThroughMs, 100);
  assert.ok(!JSON.stringify(plan).includes(message.text)); assert.equal(plan.fingerprints.old.length, 64);
});
test('technical timestamps and author bookkeeping do not produce an event, a real task change does', () => {
  const first = planRefreshSource('tasks', null, [row('t', task)], { ...parent, id: 'own' });
  const before = { initialized: true, records: first.fingerprints, pending: [] };
  assert.equal(planRefreshSource('tasks', before, [row('t', { ...task, updatedAt: 200, syncedAt: 300 })], { ...parent, id: 'own' }).pending.length, 0);
  const changed = planRefreshSource('tasks', before, [row('t', { ...task, done: true })], { ...parent, id: 'own' });
  assert.equal(changed.pending.length, 1); assert.equal(changed.pending[0].title, 'Zadanie ukończone');
  assert.equal(changed.pending[0].id, planRefreshSource('tasks', before, [row('t', { ...task, done: true, updatedAt: 700 })], { ...parent, id: 'own' }).pending[0].id);
});
test('launch works without Firebase Functions, FCM, a VAPID key or existing notification preferences', async () => {
  const data = database({ 'tasks/old': task, 'familyMessages/old': message });
  const result = await refreshInAppNotifications(data.context, { reason: 'launch' }, { now: 10000 });
  assert.equal(result.mode, 'in-app'); assert.equal(result.created, 0); assert.equal(result.baselines, 6); assert.equal(data.inbox().length, 0);
  assert.ok(![...data.values.keys()].some(path => /_notificationOutbox|_notificationDevices|_notificationTokenOwners/.test(path)));
});
test('a new task produces exactly one inbox entry for the authenticated UID; next unchanged refresh produces none', async () => {
  const data = database({ 'members/other': { ...parent, name: 'Dominika' } });
  await refresh(data, 10000);
  data.values.set('tasks/new', task);
  assert.equal((await refresh(data, 12000)).created, 1);
  assert.equal((await refresh(data, 14000)).created, 0);
  assert.equal(data.inbox().length, 1); assert.equal(data.inbox()[0].eventId, 'tasks:new');
  assert.ok(![...data.values.keys()].some(path => path.startsWith('notificationInbox/other/')));
});
test('family/private chat alerts only the permitted recipient and use generic text', async () => {
  const data = database({}, 'own', child);
  await refresh(data, 10000);
  data.values.set('familyMessages/family', { ...message, createdAt: 11000 });
  data.values.set('familyMessages/own-private', { ...message, createdAt: 11001, channel: 'private:own:other', participants: ['own', 'other'] });
  data.values.set('familyMessages/parents-private', { ...message, createdAt: 11002, channel: 'private:a:b', participants: ['a', 'b'] });
  data.values.set('familyMessages/self-sent', { ...message, createdAt: 11003, uid: 'own' });
  assert.equal((await refresh(data, 12000)).created, 2);
  assert.deepEqual(data.inbox().map(value => value.category).sort(), ['familyChat', 'privateChat']);
  assert.ok(!JSON.stringify(data.inbox()).includes(message.text));
});
test('health and private calendar queries enforce existing child/owner visibility before notification generation', async () => {
  const data = database({}, 'own', child);
  await refresh(data, 10000);
  data.values.set('healthRecords/own', { title: 'Lek', person: 'Nikodem', privateToParents: false, createdBy: 'parent' });
  data.values.set('healthRecords/parents', { title: 'Wynik rodzica', person: 'Nikodem', privateToParents: true, createdBy: 'parent' });
  data.values.set('healthRecords/other', { title: 'Inne dziecko', person: 'Paweł', privateToParents: false, createdBy: 'parent' });
  data.values.set('privateCalendarEvents/other', { title: 'Sekret', ownerUid: 'other', createdBy: 'other', private: true });
  data.values.set('privateCalendarEvents/own', { title: 'Mój wpis', ownerUid: 'own', createdBy: 'parent', private: true });
  assert.equal((await refresh(data, 12000)).created, 2);
  assert.deepEqual(data.inbox().map(value => value.recordId).sort(), ['own', 'own']);
  const healthReads = data.reads.filter(value => value.path === 'healthRecords');
  assert.ok(healthReads.every(value => value.clauses.some(([field, operator, value]) => field === 'privateToParents' && operator === '==' && value === false)));
  assert.ok(data.reads.filter(value => value.path === 'privateCalendarEvents').every(value => value.clauses.some(([field, , value]) => field === 'ownerUid' && value === 'own')));
});
test('pending events survive a failed inbox write; a later request delivers once and clears pending', async () => {
  const data = database(); await refresh(data, 10000); data.values.set('tasks/new', task);
  await assert.rejects(refresh(data, 12000, { enqueue: async () => { throw new Error('network'); } }), /network/);
  assert.equal(data.inbox().length, 0); assert.ok([...data.values.values()].some(value => value.pending?.length === 1));
  assert.equal((await refresh(data, 14000)).created, 1); assert.equal((await refresh(data, 16000)).created, 0);
  assert.equal(data.inbox().length, 1); assert.ok(![...data.values.values()].some(value => value.pending?.length));
});
test('a failure after a successful inbox commit retries the stable ID without a duplicate or overwriting read/star state', async () => {
  const data = database(); await refresh(data, 10000); data.values.set('tasks/new', task);
  await assert.rejects(refresh(data, 12000, { enqueue: async (...args) => { await enqueueInAppEvents(...args); throw new Error('timeout after commit'); } }), /timeout/);
  assert.equal(data.inbox().length, 1);
  const inboxPath = [...data.values.keys()].find(path => path.startsWith('notificationInbox/own/'));
  data.values.set(inboxPath, { ...data.values.get(inboxPath), read: true, starred: true });
  assert.equal((await refresh(data, 14000)).created, 0); assert.equal(data.inbox().length, 1);
  assert.equal(data.inbox()[0].read, true); assert.equal(data.inbox()[0].starred, true);
});
test('retry rechecks real current privacy instead of trusting a previously public pending event', async () => {
  const data = database({}, 'own', child); await refresh(data, 10000);
  data.values.set('healthRecords/h', { title: 'Wynik', person: 'Nikodem', privateToParents: false, createdBy: 'parent' });
  await assert.rejects(refresh(data, 12000, { enqueue: async () => { throw new Error('network'); } }));
  data.values.set('healthRecords/h', { ...data.values.get('healthRecords/h'), privateToParents: true });
  assert.equal((await refresh(data, 14000)).created, 0); assert.equal(data.inbox().length, 0);
});
test('explicit notification OFF is preserved; switching ON does not replay suppressed history', async () => {
  const data = database({ 'userPreferences/own': { notifications: { enabled: false } } });
  await refresh(data, 10000); data.values.set('tasks/new', task);
  assert.equal((await refresh(data, 12000)).created, 0);
  data.values.set('userPreferences/own', { notifications: { enabled: true } });
  assert.equal((await refresh(data, 14000)).created, 0);
});
test('a fresh archived/non-login member is rejected even if the initial request context had a valid profile', async () => {
  const data = database(); data.values.set('members/own', { ...parent, active: false });
  await assert.rejects(refresh(data, 10000), { code: 'EDU_MEMBER_REQUIRED' }); assert.equal(data.inbox().length, 0);
});
test('rapid repeated activations hit a bounded server debounce before any source queries', async () => {
  const data = database(); await refresh(data, 10000); const reads = data.reads.length;
  const result = await refresh(data, 10100);
  assert.equal(result.rateLimited, true); assert.equal(result.retryAfterMs, MIN_REFRESH_INTERVAL_MS - 100); assert.equal(data.reads.length, reads);
});
test('recent chat window still creates a new alert with over 500 historical messages, and never imports evicted old history', async () => {
  const seed = Object.fromEntries(Array.from({ length: MAX_REFRESH_RECORDS + 100 }, (_, index) => [`familyMessages/old-${index}`, { ...message, createdAt: index + 1 }]));
  const data = database(seed); assert.equal((await refresh(data, 10000)).created, 0);
  data.values.set('familyMessages/new', { ...message, createdAt: 11000 });
  assert.equal((await refresh(data, 12000)).created, 1); assert.equal(data.inbox()[0].eventId, 'familyChat:new');
  data.values.delete('familyMessages/new'); data.values.delete(`familyMessages/old-${MAX_REFRESH_RECORDS + 99}`);
  assert.equal((await refresh(data, 14000)).created, 0); assert.equal(data.inbox().length, 1);
  assert.ok(data.reads.filter(value => value.path === 'familyMessages').every(value => value.count === MAX_REFRESH_RECORDS && value.ordering[0] === 'createdAt'));
});
test('an oversized non-chat collection is explicitly skipped, never used as an incomplete baseline', async () => {
  const seed = Object.fromEntries(Array.from({ length: MAX_REFRESH_RECORDS + 1 }, (_, index) => [`tasks/task-${index}`, task]));
  const data = database(seed); const result = await refresh(data, 10000);
  assert.deepEqual(result.skippedSources, ['tasks']); assert.equal(data.inbox().length, 0);
  assert.ok(![...data.values.values()].some(value => value.scope === 'tasks'));
});
test('the refresh source contract does not read school-parent messages or eduVULCAN sessions', () => {
  const data = database(); const queries = refreshSources(data.db, 'own', parent);
  assert.equal(queries.length, 6); assert.ok(queries.every(source => !source.collection.startsWith('school') && !source.collection.startsWith('_edu')));
});
test('repeated delivery failures retain the latest pending state per record instead of growing an unbounded baseline', () => {
  const member = { ...parent, id: 'own' };
  const baseline = planRefreshSource('tasks', null, [], member);
  const first = planRefreshSource('tasks', { initialized: true, records: baseline.fingerprints }, [row('t', task)], member);
  const second = planRefreshSource('tasks', { initialized: true, records: first.fingerprints, pending: first.pending }, [row('t', { ...task, title: 'Zmienione zadanie' })], member);
  assert.equal(second.pending.length, 1); assert.notEqual(second.pending[0].id, first.pending[0].id);
});
test('oversized baseline byte budgets are skipped atomically without losing the previous good baseline', async () => {
  const data = database(); await refresh(data, 10000);
  for (let index = 0; index < MAX_REFRESH_RECORDS; index++) data.values.set(`tasks/${'x'.repeat(1490)}${index}`, task);
  const result = await refresh(data, 12000);
  assert.ok(result.skippedSources.includes('tasks:size')); assert.equal(data.inbox().length, 0);
  const baseline = [...data.values.values()].find(value => value.scope === 'tasks');
  assert.deepEqual(baseline.records, {}); assert.deepEqual(baseline.pending, []);
});
test('health becoming parent-private between the source query and inbox transaction creates no child alert', async () => {
  const data = database({}, 'own', child); await refresh(data, 10000);
  data.values.set('healthRecords/h', { title: 'Wynik', person: 'Nikodem', privateToParents: false, createdBy: 'parent' });
  const result = await refresh(data, 12000, { enqueue: async (context, events, options) => {
    assert.deepEqual(options, { recipientUid: 'own', revalidateSource: true });
    assert.equal(events.length, 1);
    data.values.set('healthRecords/h', { ...data.values.get('healthRecords/h'), privateToParents: true });
    return enqueueInAppEvents(context, events, options);
  } });
  assert.equal(result.created, 0); assert.equal(data.inbox().length, 0);
});
test('a deleted source between query and inbox commit does not produce a stale existence alert', async () => {
  const data = database(); await refresh(data, 10000); data.values.set('tasks/new', task);
  const result = await refresh(data, 12000, { enqueue: async (context, events, options) => {
    assert.equal(options.revalidateSource, true);
    data.values.delete('tasks/new');
    return enqueueInAppEvents(context, events, options);
  } });
  assert.equal(result.created, 0); assert.equal(data.inbox().length, 0);
});
test('a private chat participant removed after the query gets no alert from the captured message', async () => {
  const data = database({}, 'own', child); await refresh(data, 10000);
  data.values.set('familyMessages/private', { ...message, createdAt: 11000, channel: 'private:own:other', participants: ['own', 'other'] });
  const result = await refresh(data, 12000, { enqueue: async (context, events, options) => {
    data.values.set('familyMessages/private', { ...data.values.get('familyMessages/private'), participants: ['parent-a', 'parent-b'] });
    return enqueueInAppEvents(context, events, options);
  } });
  assert.equal(result.created, 0); assert.equal(data.inbox().length, 0);
});

test('adult refresh retains own/private membership boundaries and creates general family notifications', async () => {
  const adult = { role: 'adult', name: 'Dorosły', personKey: 'member-0123456789abcdef01234567', active: true, canLogin: true };
  const data = database({}, 'own', adult);
  assert.equal((await refresh(data, 10000)).baselines, 6);
  data.values.set('tasks/new', task);
  data.values.set('familyMessages/family', { ...message, createdAt: 11000 });
  data.values.set('familyMessages/own-private', { ...message, createdAt: 11001, channel: 'private:own:other', participants: ['own', 'other'] });
  data.values.set('familyMessages/parent-private', { ...message, createdAt: 11002, channel: 'private:a:b', participants: ['a', 'b'] });
  data.values.set('healthRecords/own', { title: 'Własny lek', person: adult.personKey, privateToParents: false, createdBy: 'other' });
  data.values.set('healthRecords/parents', { title: 'Tylko rodzice', person: adult.personKey, privateToParents: true, createdBy: 'other' });
  data.values.set('healthRecords/child', { title: 'Zdrowie dziecka', person: 'Nikodem', privateToParents: false, createdBy: 'other' });
  data.values.set('privateCalendarEvents/own', { title: 'Własny wpis', ownerUid: 'own', createdBy: 'other', private: true });
  data.values.set('privateCalendarEvents/other', { title: 'Cudzy wpis', ownerUid: 'other', createdBy: 'other', private: true });
  data.values.set('schoolParentMessages/school', { title: 'Skrzynka rodziców', person: adult.personKey });
  data.values.set('schoolStudentMessages/school', { title: 'Skrzynka ucznia', sourceOwnerUid: 'own', person: adult.personKey });
  assert.equal((await refresh(data, 12000)).created, 5);
  assert.deepEqual(data.inbox().map(value => value.category).sort(), ['calendar', 'familyChat', 'health', 'privateChat', 'tasks']);
  assert.equal((await refresh(data, 14000)).created, 0);
  assert.ok(data.reads.filter(value => value.path === 'healthRecords').every(value => value.clauses.some(([field, , value]) => field === 'privateToParents' && value === false)));
  assert.ok(!data.reads.some(value => value.path.startsWith('school')));
});

test('fresh archived profiles cannot refresh or receive an already queued notification', async () => {
  const data = database();
  await refresh(data, 10000);
  data.values.set('tasks/new', task);
  const result = await refresh(data, 12000, { enqueue: async (context, events, options) => {
    data.values.set('members/own', { ...parent, active: true, canLogin: true, archived: true });
    return enqueueInAppEvents(context, events, options);
  } });
  assert.equal(result.created, 0);
  assert.equal(data.inbox().length, 0);
  await assert.rejects(refresh(data, 14000), { code: 'EDU_MEMBER_REQUIRED' });
});
