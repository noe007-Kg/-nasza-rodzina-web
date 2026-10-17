import test from 'node:test';
import assert from 'node:assert/strict';
import { canReceiveNotification, deriveNotificationEvent } from '../server/notification-events.mjs';
import { refreshSources, planRefreshSource, refreshInAppNotifications } from '../server/notification-refresh.mjs';
import { enqueueInAppEvents } from '../server/notification-inbox.mjs';

const parent = { id: 'parent-a', role: 'parent', name: 'Parent', familyId: 'household-a', active: true, canLogin: true };
const child = { ...parent, id: 'child-a', role: 'child', name: 'Child', personKey: 'profile-child-a' };
const task = { title: 'Synthetic task', note: 'Do not copy task contents to routing metadata', person: child.personKey, familyId: parent.familyId, createdBy: 'other', done: false };
const event = record => deriveNotificationEvent('tasks', 'task-a', null, record);
const row = data => ({ id: 'task-a', data });

function database(seed = {}, profile = parent) {
  const values = new Map(Object.entries({ [`members/${profile.id}`]: profile, ...seed }));
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
        reads.push({ path, clauses });
        let docs = [...values.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
          .map(key => snapshot(reference(key))).filter(doc => clauses.every(([field, operator, expected]) => operator === '=='
            ? doc.data()[field] === expected : operator === 'in' && expected.includes(doc.data()[field])));
        if (ordering) docs.sort((a, b) => (Number(a.data()[ordering[0]]) - Number(b.data()[ordering[0]])) * (ordering[1] === 'desc' ? -1 : 1));
        docs = docs.slice(0, count);
        return { docs, size: docs.length };
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
  return { db, values, reads, context: { db, uid: profile.id, profile }, inbox: uid => [...values].filter(([path]) => path.startsWith(`notificationInbox/${uid}/items/`)).map(([, value]) => value) };
}
const refresh = (data, now, options = {}) => refreshInAppNotifications(data.context, { reason: 'changes' }, { now, ...options });

test('task alerts reject missing, legacy, malformed and foreign households even for the same person', () => {
  for (const familyId of [undefined, null, '', '__legacy__', ' household-a', 'household-a/', 1, true, 'household-b']) {
    assert.equal(canReceiveNotification({ ...child, familyId }, event(task)), false);
    assert.equal(canReceiveNotification(child, event({ ...task, familyId })), false);
    assert.equal(canReceiveNotification({ ...parent, familyId }, event(task)), false);
  }
});

test('parents see their household tasks; children and adults receive only own or family tasks', () => {
  for (const role of ['parent', 'child', 'adult']) {
    const member = { ...child, role };
    assert.equal(canReceiveNotification(member, event(task)), true);
    assert.equal(canReceiveNotification(member, event({ ...task, person: 'family' })), true);
    assert.equal(canReceiveNotification(member, event({ ...task, person: 'profile-sibling' })), role === 'parent');
    for (const state of [{ active: false }, { archived: true }, { disabled: true }, { canLogin: false }]) {
      assert.equal(canReceiveNotification({ ...member, ...state }, event(task)), false);
    }
  }
});

test('task refresh reads require a valid household and constrain non-parent assignees', async () => {
  for (const profile of [parent, child, { ...child, role: 'adult' }]) {
    const data = database({}, profile);
    await refreshSources(data.db, profile.id, profile).find(source => source.collection === 'tasks').query.get();
    assert.deepEqual(data.reads[0].clauses, profile.role === 'parent'
      ? [['familyId', '==', parent.familyId]]
      : [['familyId', '==', parent.familyId], ['person', 'in', ['family', child.personKey]]]);
  }
  for (const profile of [{ ...parent, familyId: undefined }, { ...parent, familyId: '__legacy__' }, { ...parent, disabled: true }]) {
    const data = database({}, profile);
    assert.equal(refreshSources(data.db, profile.id, profile).some(source => source.collection === 'tasks'), false);
  }
});

test('task baseline is quiet; semantic changes retain the exact string household routing and stable IDs', () => {
  const initial = planRefreshSource('tasks', null, [row(task)], child);
  assert.equal(initial.baseline, true); assert.deepEqual(initial.pending, []);
  const previous = { initialized: true, records: initial.fingerprints, pending: [] };
  assert.equal(planRefreshSource('tasks', previous, [row({ ...task, updatedAt: 100 })], child).pending.length, 0);
  const changed = planRefreshSource('tasks', previous, [row({ ...task, done: true })], child);
  assert.equal(changed.pending.length, 1);
  assert.equal(changed.pending[0].record.familyId, parent.familyId);
  assert.equal(typeof changed.pending[0].record.familyId, 'string');
  assert.ok(!JSON.stringify(changed.pending[0].record).includes(task.note));
  const retry = planRefreshSource('tasks', { initialized: true, records: changed.fingerprints, pending: changed.pending }, [row({ ...task, done: true, updatedAt: 200 })], child);
  assert.equal(retry.pending[0].id, changed.pending[0].id);
});

test('pending task alerts are discarded after a household or assignee change, deletion or member revocation', () => {
  const pending = planRefreshSource('tasks', { initialized: true, records: {} }, [row(task)], child);
  const previous = { initialized: true, records: pending.fingerprints, pending: pending.pending };
  for (const record of [{ ...task, familyId: 'household-b' }, { ...task, familyId: undefined }, { ...task, person: 'profile-sibling' }]) {
    assert.deepEqual(planRefreshSource('tasks', previous, [row(record)], child).pending, []);
  }
  assert.deepEqual(planRefreshSource('tasks', previous, [], child).pending, []);
  assert.deepEqual(planRefreshSource('tasks', previous, [row(task)], { ...child, disabled: true }).pending, []);
});

test('refresh imports no historical task alerts and only delivers own/family changes once', async () => {
  const data = database({ 'tasks/history': task }, child);
  assert.equal((await refresh(data, 10000)).created, 0);
  data.values.set('tasks/own', task);
  data.values.set('tasks/family', { ...task, person: 'family' });
  data.values.set('tasks/sibling', { ...task, person: 'profile-sibling' });
  data.values.set('tasks/foreign', { ...task, familyId: 'household-b' });
  data.values.set('tasks/legacy', { ...task, familyId: '__legacy__' });
  assert.equal((await refresh(data, 12000)).created, 2);
  assert.equal((await refresh(data, 14000)).created, 0);
  assert.deepEqual(data.inbox(child.id).map(value => value.recordId).sort(), ['family', 'own']);
});

test('failed delivery preserves family routing and retry never leaks a task moved to another household', async () => {
  const data = database({}, child); await refresh(data, 10000);
  data.values.set('tasks/new', task);
  await assert.rejects(refresh(data, 12000, { enqueue: async () => { throw new Error('synthetic delivery failure'); } }));
  const baseline = [...data.values.values()].find(value => value.scope === 'tasks');
  assert.equal(baseline.pending[0].record.familyId, parent.familyId);
  data.values.set('tasks/new', { ...task, familyId: 'household-b' });
  assert.equal((await refresh(data, 14000)).created, 0);
  assert.equal(data.inbox(child.id).length, 0);
  assert.deepEqual([...data.values.values()].find(value => value.scope === 'tasks').pending, []);
});

test('inbox source transaction rechecks household after the refresh query and deduplicates permitted delivery', async () => {
  const data = database({}, child); await refresh(data, 10000);
  data.values.set('tasks/new', task);
  const rejected = await refresh(data, 12000, { enqueue: async (context, events, options) => {
    data.values.set('tasks/new', { ...task, familyId: 'household-b' });
    return enqueueInAppEvents(context, events, options);
  } });
  assert.equal(rejected.created, 0); assert.equal(data.inbox(child.id).length, 0);
  data.values.set('tasks/permitted', task);
  const permitted = event(task); permitted.recordId = 'permitted';
  assert.equal((await enqueueInAppEvents(data.context, [permitted], { recipientUid: child.id, revalidateSource: true })).created, 1);
  assert.equal((await enqueueInAppEvents(data.context, [permitted], { recipientUid: child.id, revalidateSource: true })).created, 0);
});

test('trigger recipients in other households and sibling children receive no task notification', async () => {
  const data = database({
    'members/child-a': child,
    'members/sibling-a': { ...child, id: 'sibling-a', personKey: 'profile-sibling' },
    'members/foreign-parent': { ...parent, id: 'foreign-parent', familyId: 'household-b' },
    'members/foreign-child': { ...child, id: 'foreign-child', familyId: 'household-b' },
    'members/unassigned': { ...parent, id: 'unassigned', familyId: undefined },
    'members/disabled': { ...parent, id: 'disabled', disabled: true },
    'tasks/task-a': task,
  });
  const result = await enqueueInAppEvents(data.context, [event(task)], { revalidateSource: true });
  assert.equal(result.created, 2);
  assert.equal(data.inbox(parent.id).length, 1); assert.equal(data.inbox(child.id).length, 1);
  for (const uid of ['sibling-a', 'foreign-parent', 'foreign-child', 'unassigned', 'disabled']) assert.equal(data.inbox(uid).length, 0);
});
