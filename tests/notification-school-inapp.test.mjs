import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { upsertSchoolItems, prepareImportedSchoolItems } from '../server/edu-storage.mjs';
import { enqueueInAppEvents } from '../server/notification-inbox.mjs';
import { deriveNotificationEvent } from '../server/notification-events.mjs';
import { flushSchoolNotifications, safelyFlushSchoolNotifications, schoolNotificationChanges } from '../server/school-notifications.mjs';

function fixture() {
  const records = new Map();
  const writesPerTransaction = [];
  let failWhen = null;
  let beforeTransaction = null;
  const snapshot = ref => ({ id: ref.id, ref, exists: records.has(ref.path), data: () => records.get(ref.path) });
  const transform = value => {
    if (typeof value?.isEqual === 'function') {
      if (value.isEqual(FieldValue.delete())) return { deleted: true };
      if (value.isEqual(FieldValue.serverTimestamp())) return { value: Timestamp.now() };
    }
    return { value };
  };
  const apply = (ref, fields, merging) => {
    const next = merging ? { ...records.get(ref.path) } : {};
    for (const [key, value] of Object.entries(fields)) {
      const resolved = transform(value);
      if (resolved.deleted) delete next[key]; else next[key] = resolved.value;
    }
    records.set(ref.path, next);
  };
  const reference = path => ({ path, id: path.split('/').at(-1),
    collection(name) { return collection(`${path}/${name}`); },
    async get() { return snapshot(this); },
    async update(fields) { if (failWhen?.(this.path)) throw new Error('Synthetic storage failure'); apply(this, fields, true); },
  });
  const collection = path => {
    const query = (filters = [], maximum = Infinity) => ({
      doc(id) { return reference(`${path}/${id}`); },
      where(field, operator, value) { assert.equal(operator, '=='); return query([...filters, [field, value]], maximum); },
      limit(count) { return query(filters, count); },
      async get() {
        const rows = [...records].filter(([key, data]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).indexOf('/') === -1
          && filters.every(([field, value]) => data[field] === value)).slice(0, maximum);
        return { size: rows.length, docs: rows.map(([key]) => snapshot(reference(key))) };
      },
    });
    return query();
  };
  const db = { collection,
    async runTransaction(callback) {
      if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = null; hook(); }
      const pending = [];
      const read = ref => { assert.equal(pending.length, 0, 'all transaction reads precede writes'); return snapshot(ref); };
      const result = await callback({
        async get(ref) { return read(ref); }, async getAll(...refs) { return refs.map(read); },
        set(ref, data) { pending.push([ref, data, false]); },
        create(ref, data) { assert.equal(records.has(ref.path), false); pending.push([ref, data, false]); },
        update(ref, data) { pending.push([ref, data, true]); },
        delete(ref) { pending.push([ref, null]); },
      });
      if (pending.some(([ref]) => failWhen?.(ref.path))) throw new Error('Synthetic storage failure');
      assert.ok(pending.length <= 500, 'Firestore transaction write limit');
      writesPerTransaction.push(pending.length);
      pending.forEach(([ref, data, merging]) => data ? apply(ref, data, merging) : records.delete(ref.path));
      return result;
    },
  };
  for (const [id, name, role] of [['sebastian', 'Sebastian', 'parent'], ['dominika', 'Dominika', 'parent'], ['nikodem', 'Nikodem', 'child'], ['pawel', 'Paweł', 'child']]) {
    records.set(`members/${id}`, { name, personKey: name, role, active: true, canLogin: true });
  }
  records.set('_eduConnections/family', { scope: 'family', accountRole: 'parent',
    expiresAt: Timestamp.fromMillis(Date.now() + 3600000), sessionVersion: 'same-protected-session',
    students: [{ id: 'nikodem-school', studentName: 'Nikodem', schoolName: 'SP4' }],
    selectedStudent: { profileId: 'nikodem-school', personKey: 'Nikodem' },
    lease: { id: 'initial', expiresAt: Timestamp.fromMillis(Date.now() + 120000) },
  });
  const context = { db, uid: 'dominika', profile: records.get('members/dominika'), connection: {
    id: 'family', scope: 'family', accountRole: 'parent', actorUid: 'dominika', allowedPersonKeys: ['Paweł', 'Nikodem', 'Layla'],
  } };
  let syncNumber = 0;
  async function sync(items, reconcileScopes = [], notificationReadyTypes) {
    const leaseId = `protected-lease-${++syncNumber}`;
    records.get('_eduConnections/family').lease.id = leaseId;
    return upsertSchoolItems('family', { personKey: 'Nikodem', profileId: 'nikodem-school', sessionVersion: 'same-protected-session',
      leaseId, items, reconcileScopes, notificationReadyTypes }, context);
  }
  const inbox = uid => [...records].filter(([path]) => path.startsWith(`notificationInbox/${uid}/items/`)).map(([, value]) => value);
  const pending = () => [...records].filter(([path, value]) => path.startsWith('_notificationEvents/') && value.status === 'pending');
  return { records, context, sync, inbox, pending, writesPerTransaction,
    setFailure(callback) { failWhen = callback; }, beforeNextTransaction(callback) { beforeTransaction = callback; } };
}

const grade = { externalId: 'grade-one', type: 'grade', title: 'Matematyka: 5', subject: 'Matematyka', date: '2026-10-02' };
const message = { externalId: 'teacher-one', type: 'message', title: 'Prywatny temat', body: 'Prywatna treść dla rodziców', sender: 'Nauczyciel' };

test('first successful synchronization establishes a silent baseline, including an existing production history', async () => {
  const f = fixture();
  const history = Array.from({ length: 50 }, (_, index) => ({ ...grade, externalId: `old-${index}` }));
  const old = prepareImportedSchoolItems('family', { personKey: 'Nikodem', profileId: 'nikodem-school', items: [grade] }, f.context)[0];
  f.records.set(`schoolItems/${old.id}`, old.data);
  await f.sync([...history, grade, message]);
  assert.deepEqual(await flushSchoolNotifications(f.context), { created: 0, pending: false });
  assert.equal([...f.records.keys()].filter(path => path.startsWith('_notificationBaselines/')).length, 1);
  assert.equal(f.inbox('dominika').length, 0); assert.equal(f.inbox('sebastian').length, 0); assert.equal(f.inbox('nikodem').length, 0);
});

test('a successful lessons-only sync cannot turn recovered historical grades into new notifications', async () => {
  const f = fixture();
  const lesson = { externalId: 'lesson-old', type: 'lesson', title: 'Polski' };
  await f.sync([lesson], [], ['lesson']);
  const history = Array.from({ length: 20 }, (_, index) => ({ ...grade, externalId: `historical-grade-${index}` }));
  await f.sync([lesson, ...history], [], ['lesson', 'grade']);
  assert.equal((await flushSchoolNotifications(f.context)).created, 0);
  assert.equal(f.inbox('dominika').length, 0);
  await f.sync([lesson, ...history, grade], [], ['lesson', 'grade']); await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('dominika').length, 1); assert.equal(f.inbox('dominika')[0].eventId, 'school:grade:nikodem-school:grade-one');
});

test('an explicitly successful empty grade section initializes history and a subsequent new grade alerts once', async () => {
  const f = fixture(); await f.sync([], [], ['grade']);
  await f.sync([grade], [], ['grade']); await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('dominika').length, 1);
  await f.sync([grade], [], ['grade']);
  assert.equal((await flushSchoolNotifications(f.context)).created, 0);
  assert.equal(f.inbox('dominika').length, 1);
});

test('failed first teacher-message details keep recovery history quiet, then a subsequent new message alerts parents', async () => {
  const f = fixture();
  // One cached message was imported, another body failed. Mailbox history is
  // not ready yet, even though the rest of this synchronization succeeded.
  await f.sync([{ ...message, externalId: 'historical-first' }], [], ['grade']);
  const history = [{ ...message, externalId: 'historical-first' }, { ...message, externalId: 'historical-recovered' }];
  await f.sync(history, [], ['grade', 'message']);
  assert.equal((await flushSchoolNotifications(f.context)).created, 0);
  await f.sync([...history, message], [], ['grade', 'message']); await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('dominika').length, 1); assert.equal(f.inbox('sebastian').length, 1);
  assert.equal(f.inbox('nikodem').length, 0);
  assert.equal(f.inbox('dominika')[0].eventId, 'school:message:nikodem-school:teacher-one');
});

test('a new grade after baseline creates exactly one notification per authorized recipient and no FCM/outbox', async () => {
  const f = fixture(); await f.sync([]); await f.sync([grade]);
  assert.equal(JSON.stringify(f.pending()).includes('Matematyka'), false);
  assert.equal((await flushSchoolNotifications(f.context)).created, 3);
  for (const uid of ['sebastian', 'dominika', 'nikodem']) {
    assert.equal(f.inbox(uid).length, 1); assert.equal(f.inbox(uid)[0].eventId, 'school:grade:nikodem-school:grade-one');
  }
  assert.equal(f.inbox('pawel').length, 0);
  assert.equal([...f.records.keys()].some(path => /_notification(Outbox|Devices|TokenOwners)/.test(path)), false);
  assert.equal(JSON.stringify([...f.records]).includes('messaging/'), false);
});

test('the next unchanged sync and metadata/read-receipt-only changes produce zero alerts', async () => {
  const f = fixture(); await f.sync([]); await f.sync([grade, message]); await flushSchoolNotifications(f.context);
  const initial = f.inbox('dominika').length;
  await f.sync([grade, { ...message, read: true }]);
  assert.deepEqual(await flushSchoolNotifications(f.context), { created: 0, pending: false });
  assert.equal(f.inbox('dominika').length, initial);
  const before = { type: 'grade', person: 'Nikodem', title: '5', sourceRecordId: 'a', sourceProfileId: 'p', syncedAt: 1, updatedAt: 2 };
  assert.equal(schoolNotificationChanges([{ collection: 'schoolItems', id: 'a', before, after: { ...before, syncedAt: 500, updatedAt: 600, sourceSyncId: 'other' } }], true).length, 0);
});

test('changing an existing grade creates one distinct stable alert and never repeats it', async () => {
  const f = fixture(); await f.sync([grade]); await f.sync([{ ...grade, title: 'Matematyka: 6' }]);
  await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('dominika').length, 1); assert.equal(f.inbox('dominika')[0].title, 'Zmiana oceny — Nikodem');
  const id = f.inbox('dominika')[0].eventId;
  await f.sync([{ ...grade, title: 'Matematyka: 6' }]); await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('dominika').length, 1); assert.equal(f.inbox('dominika')[0].eventId, id);
});

test('a new teacher message reaches both parent bells and never a child inbox', async () => {
  const f = fixture(); await f.sync([]); await f.sync([message]);
  const journal = JSON.stringify(f.pending());
  assert.equal(journal.includes('Prywatna treść'), false); assert.equal(journal.includes('Prywatny temat'), false);
  await flushSchoolNotifications(f.context);
  for (const uid of ['dominika', 'sebastian']) {
    assert.equal(f.inbox(uid).length, 1); assert.equal(f.inbox(uid)[0].eventId, 'school:message:nikodem-school:teacher-one');
    assert.equal(f.inbox(uid)[0].module, 'Szkoła'); assert.equal(f.inbox(uid)[0].read, false);
    assert.ok(f.inbox(uid)[0].importantKey.startsWith('school:message:Nikodem:'));
  }
  assert.equal(f.inbox('nikodem').length, 0); assert.equal(f.inbox('pawel').length, 0);
});

test('new tests and homework are distinct stable school events', async () => {
  const f = fixture(); await f.sync([]); await f.sync([{ ...grade, type: 'test' }, { ...grade, type: 'homework' }]);
  await flushSchoolNotifications(f.context);
  assert.deepEqual(f.inbox('dominika').map(item => item.eventId).sort(), ['school:homework:nikodem-school:grade-one', 'school:test:nikodem-school:grade-one']);
});

test('real timetable change and confirmed cancellation generate alerts; changing metadata does not', async () => {
  const f = fixture();
  const lesson = { externalId: 'lesson-one', type: 'lesson', title: 'Polski', date: '2026-10-03', time: '08:00', providerScopeId: 'timetable' };
  const range = [{ type: 'lesson', scopeId: 'timetable', dateFrom: '2026-10-03', dateTo: '2026-10-03' }];
  await f.sync([lesson], range); await f.sync([{ ...lesson, time: '09:00' }], range); await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('dominika').length, 1); assert.match(f.inbox('dominika')[0].eventId, /^school:lesson-change:/);
  await f.sync([{ ...lesson, time: '09:00' }], range); assert.equal((await flushSchoolNotifications(f.context)).created, 0);
  await f.sync([], range); await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('dominika').length, 2); assert.match(f.inbox('dominika')[1].eventId, /^school:lesson-cancelled:/);
});

test('normal advancement of the dated timetable window is quiet, but an insertion inside the prior window alerts once', async () => {
  const f = fixture();
  const lesson = (externalId, date) => ({ externalId, type: 'lesson', title: 'Polski', date, time: '08:00', providerScopeId: 'timetable' });
  const range = (dateFrom, dateTo) => [{ type: 'lesson', scopeId: 'timetable', dateFrom, dateTo }];
  const known = lesson('known-october-10', '2026-10-10');
  await f.sync([known], range('2026-09-26', '2026-10-24'), ['lesson']);
  const nextDay = lesson('newly-visible-october-25', '2026-10-25');
  await f.sync([known, nextDay], range('2026-09-27', '2026-10-25'), ['lesson']);
  assert.equal((await flushSchoolNotifications(f.context)).created, 0);
  const inserted = lesson('actually-added-october-15', '2026-10-15');
  await f.sync([known, nextDay, inserted], range('2026-09-27', '2026-10-25'), ['lesson']);
  await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('dominika').length, 1); assert.equal(f.inbox('sebastian').length, 1); assert.equal(f.inbox('nikodem').length, 1);
  assert.equal(f.inbox('dominika')[0].eventId, 'school:lesson:nikodem-school:actually-added-october-15');
  await f.sync([known, nextDay, inserted], range('2026-09-27', '2026-10-25'), ['lesson']);
  assert.equal((await flushSchoolNotifications(f.context)).created, 0);
});

test('a missing old timetable window seeds quietly, while known lesson content changes and cancellations remain real alerts', () => {
  const lesson = { type: 'lesson', title: 'Polski', date: '2026-10-30', time: '08:00', person: 'Nikodem', sourceRecordId: 'known-lesson', sourceProfileId: 'nikodem-school' };
  assert.equal(schoolNotificationChanges([{ collection: 'schoolItems', id: 'known', before: null, after: lesson }], ['lesson']).length, 0);
  const previousWindow = { dateFrom: '2026-10-01', dateTo: '2026-10-21' };
  const changes = schoolNotificationChanges([
    { collection: 'schoolItems', id: 'known', before: lesson, after: { ...lesson, time: '09:00' } },
    { collection: 'schoolItems', id: 'known-cancelled', before: lesson, after: null },
  ], ['lesson'], previousWindow);
  assert.equal(changes.length, 2); assert.match(changes[0].id, /^school:lesson-change:/); assert.match(changes[1].id, /^school:lesson-cancelled:/);
});

test('explicit notification/category opt-outs are respected while absent preferences enable IN-APP', async () => {
  const f = fixture(); await f.sync([]);
  f.records.set('userPreferences/nikodem', { notifications: { enabled: false } });
  f.records.set('userPreferences/dominika', { notifications: { enabled: true, categories: { school: false } } });
  await f.sync([grade]); await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('sebastian').length, 1); assert.equal(f.inbox('dominika').length, 0); assert.equal(f.inbox('nikodem').length, 0);
});

test('inbox failure leaves a durable pending diff and retries safely even after an unchanged sync', async () => {
  const f = fixture(); await f.sync([]); await f.sync([grade]);
  f.setFailure(path => path.startsWith('notificationInbox/'));
  const result = await safelyFlushSchoolNotifications(f.context);
  assert.equal(result.pending, true); assert.ok(result.warning.includes('Dane szkolne zostały zapisane'));
  assert.equal(f.pending().length, 1);
  f.setFailure(null); await f.sync([grade]); await flushSchoolNotifications(f.context);
  assert.equal(f.pending().length, 0); assert.equal(f.inbox('dominika').length, 1);
});

test('partial recipient delivery retries without duplicating the already delivered parent event', async () => {
  const f = fixture(); await f.sync([]); await f.sync([message]);
  f.setFailure(path => path.startsWith('notificationInbox/dominika/'));
  assert.equal((await safelyFlushSchoolNotifications(f.context)).pending, true);
  assert.equal(f.inbox('sebastian').length, 1); assert.equal(f.inbox('dominika').length, 0);
  f.setFailure(null); await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('sebastian').length, 1); assert.equal(f.inbox('dominika').length, 1);
});

test('fresh transaction membership prevents delivery after an account was archived', async () => {
  const f = fixture(); await f.sync([]); await f.sync([grade]);
  // The first recipient was active during the collection query. Archive it
  // before the transaction rechecks membership, as another parent can do.
  f.beforeNextTransaction(() => { f.records.get('members/sebastian').active = false; });
  await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('sebastian').length, 0);
  assert.equal(f.inbox('dominika').length, 1);
});

test('generic IN-APP sender supports an authenticated single-UID refresh without writing other inboxes', async () => {
  const f = fixture();
  const event = deriveNotificationEvent('tasks', 'task-one', null, { title: 'Zadanie', person: 'family' });
  assert.deepEqual(await enqueueInAppEvents(f.context, [event], { recipientUid: 'dominika' }), { created: 1, checked: 1 });
  assert.equal(f.inbox('dominika').length, 1); assert.equal(f.inbox('sebastian').length, 0); assert.equal(f.inbox('nikodem').length, 0);
  assert.equal((await enqueueInAppEvents(f.context, [event], { recipientUid: 'dominika' })).created, 0);
});

test('source privacy is reread atomically before a pending health alert reaches a child inbox', async () => {
  const f = fixture();
  const shared = { title: 'Wynik testowy', person: 'Nikodem', privateToParents: false, createdBy: 'dominika' };
  f.records.set('healthRecords/result', shared);
  const staleEvent = deriveNotificationEvent('healthRecords', 'result', null, shared);
  // The producer saw a shared record; a parent changes privacy immediately
  // before inbox delivery. A cached event must not preserve the former access.
  f.beforeNextTransaction(() => f.records.set('healthRecords/result', { ...shared, privateToParents: true }));
  assert.equal((await enqueueInAppEvents(f.context, [staleEvent], { recipientUid: 'nikodem', revalidateSource: true })).created, 0);
  assert.equal(f.inbox('nikodem').length, 0);
});

test('fresh chat participants and deleted records cannot be bypassed by a previously queued generic event', async () => {
  const f = fixture();
  const message = { text: 'Poufna wiadomość', uid: 'dominika', channel: 'private:dominika:nikodem', participants: ['dominika', 'nikodem'] };
  const chatEvent = deriveNotificationEvent('familyMessages', 'private', null, message);
  f.records.set('familyMessages/private', { ...message, channel: 'private:dominika:sebastian', participants: ['dominika', 'sebastian'] });
  assert.equal((await enqueueInAppEvents(f.context, [chatEvent], { recipientUid: 'nikodem', revalidateSource: true })).created, 0);
  const taskEvent = deriveNotificationEvent('tasks', 'removed', null, { title: 'Usunięte zadanie', person: 'family' });
  assert.equal((await enqueueInAppEvents(f.context, [taskEvent], { recipientUid: 'nikodem', revalidateSource: true })).created, 0);
  assert.equal(f.inbox('nikodem').length, 0);
});

test('source validation uses the existing static collection allowlist and rejects record path injection', async () => {
  const f = fixture();
  const event = deriveNotificationEvent('tasks', 'valid', null, { title: 'Zadanie', person: 'family' });
  for (const invalid of [{ ...event, collection: '_eduConnections' }, { ...event, recordId: '../victim' }, { ...event, recordId: '.' }]) {
    await assert.rejects(enqueueInAppEvents(f.context, [invalid], { recipientUid: 'nikodem', revalidateSource: true }), /Invalid notification source/);
  }
  assert.equal(f.inbox('nikodem').length, 0);
});

test('failed school transaction creates neither baseline nor notifications and retains protected session', async () => {
  const f = fixture();
  const generated = prepareImportedSchoolItems('family', { personKey: 'Nikodem', profileId: 'nikodem-school', items: [grade] }, f.context)[0];
  f.records.set(`schoolItems/${generated.id}`, { type: 'grade', title: 'Lokalny wpis', person: 'Nikodem' });
  await assert.rejects(f.sync([grade]), { code: 'EDU_IMPORT_CONFLICT' });
  assert.equal([...f.records.keys()].some(path => path.startsWith('_notificationBaselines/') || path.startsWith('_notificationEvents/')), false);
  assert.equal(f.records.get('_eduConnections/family').sessionVersion, 'same-protected-session');
});

test('maximum bounded school import journals notifications within Firestore transaction limits', async () => {
  const f = fixture(); await f.sync([]);
  await f.sync(Array.from({ length: 400 }, (_, index) => ({ ...grade, externalId: `new-${index}` })));
  assert.ok(f.writesPerTransaction.at(-1) <= 402);
  const queue = f.pending()[0][1]; assert.equal(queue.events.length, 400);
  assert.ok(Buffer.byteLength(JSON.stringify(queue)) < 1024 * 1024);
  await flushSchoolNotifications(f.context);
  assert.equal(f.inbox('dominika').length, 400);
  assert.ok(Math.max(...f.writesPerTransaction) <= 402);
});
