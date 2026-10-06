import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { processNotificationWrite, processSchoolNotificationBatch } from '../functions/notification-triggers.mjs';
import { schoolSyncBootstrap } from '../functions/notification-baseline.mjs';
import { deriveNotificationEvent, eventDocumentId } from '../server/notification-events.mjs';
import { enqueueInAppEvents } from '../server/notification-inbox.mjs';
import { flushSchoolNotifications, schoolNotificationBaselineRef } from '../server/school-notifications.mjs';

const parent = name => ({ name, personKey: name, role: 'parent', active: true, canLogin: true });
const child = name => ({ name, personKey: name, role: 'child', active: true, canLogin: true });
const message = { uid: 'dominika', name: 'Dominika', text: 'Treść pozostaje tylko w czacie.', channel: 'family', participants: [], createdAt: new Date(2000) };
const grade = { source: 'eduvulcan', sourceConnectionId: 'family', sourceConnectionScope: 'family', sourceOwnerUid: 'dominika',
  sourceProfileId: 'nikodem-school', sourceSyncId: 'protected-lease', sourceRecordId: 'grade-one', person: 'Nikodem',
  type: 'grade', title: 'Matematyka: 5', createdAt: new Date(2000) };
const dependencies = { derive: deriveNotificationEvent, enqueue: enqueueInAppEvents, baselineRef: schoolNotificationBaselineRef, bootstrap: schoolSyncBootstrap };

function fixture(seed = {}) {
  const values = new Map(Object.entries({ 'members/sebastian': parent('Sebastian'), 'members/dominika': parent('Dominika'),
    'members/nikodem': child('Nikodem'), 'members/pawel': child('Paweł'), ...seed }));
  let serialization = Promise.resolve();
  const snapshot = ref => ({ id: ref.id, ref, exists: values.has(ref.path), data: () => values.get(ref.path) });
  const apply = (ref, data, merging) => {
    const next = merging ? { ...values.get(ref.path) } : {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value?.isEqual === 'function' && value.isEqual(FieldValue.delete())) delete next[key];
      else next[key] = value;
    }
    values.set(ref.path, next);
  };
  const reference = path => ({ path, id: path.split('/').at(-1), collection(name) { return collection(`${path}/${name}`); },
    async get() { return snapshot(this); }, async update(data) { apply(this, data, true); }, async set(data) { apply(this, data, false); } });
  const collection = (path, filters = [], maximum = Infinity) => ({
    doc(id) { return reference(`${path}/${id}`); },
    where(field, operator, value) { assert.equal(operator, '=='); return collection(path, [...filters, [field, value]], maximum); },
    limit(count) { return collection(path, filters, count); },
    async get() {
      const docs = [...values].filter(([key, data]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')
        && filters.every(([field, value]) => data[field] === value)).slice(0, maximum).map(([key]) => snapshot(reference(key)));
      return { size: docs.length, docs };
    },
  });
  const db = { collection, runTransaction(callback) {
    const task = serialization.then(async () => {
      const writes = [];
      const read = ref => { assert.equal(writes.length, 0, 'transaction reads precede writes'); return snapshot(ref); };
      const result = await callback({ async get(ref) { return read(ref); }, async getAll(...refs) { return refs.map(read); },
        create(ref, data) { assert.equal(values.has(ref.path), false); writes.push([ref, data, false]); },
        set(ref, data) { writes.push([ref, data, false]); }, update(ref, data) { writes.push([ref, data, true]); } });
      writes.forEach(([ref, data, merging]) => apply(ref, data, merging));
      return result;
    });
    serialization = task.catch(() => {});
    return task;
  } };
  const inbox = uid => [...values].filter(([path]) => path.startsWith(`notificationInbox/${uid}/items/`)).map(([, value]) => value);
  return { db, values, inbox, context: { db } };
}

function write(f, collection, id, before, after, overrides = {}) {
  return processNotificationWrite(f.context, { collection, id, before, after }, { ...dependencies, ...overrides });
}

test('a new familyMessages creation immediately produces inbox notifications with no refresh or scheduled tick', async () => {
  const f = fixture({ 'familyMessages/new': message });
  const result = await write(f, 'familyMessages', 'new', null, message);
  assert.equal(result.created, 3); assert.equal(result.reason, 'event');
  for (const uid of ['sebastian', 'nikodem', 'pawel']) assert.equal(f.inbox(uid)[0].eventId, 'familyChat:new');
  assert.equal(f.inbox('dominika').length, 0);
  assert.equal(JSON.stringify(f.inbox('sebastian')).includes(message.text), false);
  assert.equal([...f.values.keys()].some(path => /_notificationOutbox|_notificationDevices|_notificationTokenOwners/.test(path)), false);
});

test('family message updates and technical bookkeeping create no further alerts', async () => {
  const f = fixture({ 'familyMessages/new': message });
  await write(f, 'familyMessages', 'new', null, message);
  assert.equal((await write(f, 'familyMessages', 'new', message, { ...message, updatedAt: 500, read: true })).created, 0);
  assert.equal((await write(f, 'familyMessages', 'new', message, { ...message, text: 'Zmieniona treść' })).created, 0);
  assert.equal(f.inbox('sebastian').length, 1);
});

test('concurrent trigger retries and Vercel refresh share one stable inbox ID without resetting read or starred', async () => {
  const f = fixture({ 'familyMessages/new': message });
  await Promise.all([write(f, 'familyMessages', 'new', null, message), write(f, 'familyMessages', 'new', null, message)]);
  const event = deriveNotificationEvent('familyMessages', 'new', null, message);
  const path = `notificationInbox/sebastian/items/${eventDocumentId(event)}`;
  f.values.set(path, { ...f.values.get(path), read: true, starred: true });
  assert.equal((await enqueueInAppEvents(f.context, [event], { recipientUid: 'sebastian', revalidateSource: true })).created, 0);
  assert.equal(f.inbox('sebastian').length, 1); assert.equal(f.inbox('sebastian')[0].read, true); assert.equal(f.inbox('sebastian')[0].starred, true);
});

test('private chat sends only to current participants and never exposes message content in inbox', async () => {
  const privateMessage = { ...message, channel: 'private:dominika:sebastian', participants: ['dominika', 'sebastian'] };
  const f = fixture({ 'familyMessages/private': privateMessage });
  assert.equal((await write(f, 'familyMessages', 'private', null, privateMessage)).created, 1);
  assert.equal(f.inbox('sebastian')[0].category, 'privateChat');
  assert.equal(f.inbox('nikodem').length, 0); assert.equal(f.inbox('pawel').length, 0);
});

test('fresh source revalidation prevents delivery when chat membership changes before inbox commit', async () => {
  const original = { ...message, channel: 'private:dominika:nikodem', participants: ['dominika', 'nikodem'] };
  const f = fixture({ 'familyMessages/private': original });
  await write(f, 'familyMessages', 'private', null, original, { enqueue: async (context, events, options) => {
    assert.deepEqual(options, { revalidateSource: true });
    f.values.set('familyMessages/private', { ...original, participants: ['dominika', 'sebastian'] });
    return enqueueInAppEvents(context, events, options);
  } });
  assert.equal(f.inbox('nikodem').length, 0); assert.equal(f.inbox('sebastian').length, 0);
});

test('a deleted source and an opted-out or archived recipient cannot receive a stale trigger notification', async () => {
  const f = fixture({ 'familyMessages/new': message, 'userPreferences/sebastian': { notifications: { enabled: false } },
    'members/nikodem': { ...child('Nikodem'), active: false } });
  assert.equal((await write(f, 'familyMessages', 'new', null, message)).created, 1);
  assert.equal(f.inbox('sebastian').length, 0); assert.equal(f.inbox('nikodem').length, 0);
  f.values.delete('familyMessages/new');
  assert.equal((await write(f, 'familyMessages', 'new', null, message)).created, 0);
});

test('managed school raw writes leave first-history and per-section baseline decisions to the canonical journal', async () => {
  const f = fixture();
  await schoolNotificationBaselineRef(f.db, 'family', grade.sourceProfileId, grade.person).set({ version: 'school-inapp-v1', initializedTypes: ['lesson'] });
  for (const collection of ['schoolItems', 'schoolParentMessages', 'schoolStudentMessages']) {
    const value = { ...grade, type: collection === 'schoolItems' ? 'grade' : 'message' };
    const result = await write(f, collection, 'historical', null, value, {
      derive() { assert.fail('raw managed history must not derive its own event'); },
      bootstrap() { assert.fail('canonical baseline must not use the legacy global baseline'); },
    });
    assert.equal(result.created, 0); assert.equal(result.reason, 'managed-school-journal');
  }
  assert.equal(f.inbox('sebastian').length, 0);
});

test('school journal trigger and successful sync flush deliver the same actual grade change exactly once', async () => {
  const f = fixture();
  const event = deriveNotificationEvent('schoolItems', 'grade-one', grade, { ...grade, title: 'Matematyka: 6' });
  const connectionHash = createHash('sha256').update(JSON.stringify('family')).digest('hex');
  const batch = { connectionId: 'family', status: 'pending', events: [event] };
  f.values.set(`_notificationEvents/${connectionHash}/schoolSyncs/batch`, batch);
  await Promise.all([
    processSchoolNotificationBatch(f.context, { connectionHash, batch }, { flush: flushSchoolNotifications }),
    flushSchoolNotifications({ ...f.context, connection: { id: 'family' } }),
  ]);
  for (const uid of ['sebastian', 'dominika', 'nikodem']) {
    assert.equal(f.inbox(uid).length, 1); assert.equal(f.inbox(uid)[0].title, 'Zmiana oceny — Nikodem');
  }
  assert.equal(f.inbox('pawel').length, 0);
  assert.equal((await processSchoolNotificationBatch(f.context, { connectionHash, batch }, { flush: flushSchoolNotifications })).created, 0);
});

test('school parent journal is delivered to parents only and never to either child', async () => {
  const f = fixture();
  const mail = { ...grade, type: 'message', title: 'Prywatny temat', note: 'Prywatna treść nauczyciela.' };
  const event = deriveNotificationEvent('schoolParentMessages', 'teacher', null, mail);
  const connectionHash = createHash('sha256').update(JSON.stringify('family')).digest('hex');
  const batch = { connectionId: 'family', status: 'pending', events: [event] };
  f.values.set(`_notificationEvents/${connectionHash}/schoolSyncs/mail`, batch);
  assert.equal((await processSchoolNotificationBatch(f.context, { connectionHash, batch }, { flush: flushSchoolNotifications })).created, 2);
  assert.equal(f.inbox('nikodem').length, 0); assert.equal(f.inbox('pawel').length, 0);
  assert.equal(JSON.stringify(f.inbox('dominika')).includes(mail.note), false);
});

test('own student mailbox journal cannot notify parents or another student', async () => {
  const f = fixture();
  const id = `student_${createHash('sha256').update('nikodem').digest('hex')}`;
  const connectionHash = createHash('sha256').update(JSON.stringify(id)).digest('hex');
  const event = deriveNotificationEvent('schoolStudentMessages', 'own-mail', null, { ...grade, type: 'message', sourceConnectionId: id,
    sourceConnectionScope: 'student', sourceOwnerUid: 'nikodem' });
  const batch = { connectionId: id, status: 'pending', events: [event] };
  f.values.set(`_notificationEvents/${connectionHash}/schoolSyncs/own-mail`, batch);
  assert.equal((await processSchoolNotificationBatch(f.context, { connectionHash, batch }, { flush: flushSchoolNotifications })).created, 1);
  assert.equal(f.inbox('nikodem').length, 1); assert.equal(f.inbox('sebastian').length, 0);
  assert.equal(f.inbox('dominika').length, 0); assert.equal(f.inbox('pawel').length, 0);
});

test('legacy first import retains quiet history baseline; subsequent genuine new grade alerts once', async () => {
  const legacy = { ...grade }; delete legacy.sourceConnectionId;
  const f = fixture({ 'schoolItems/old': legacy });
  assert.equal((await write(f, 'schoolItems', 'old', null, legacy)).reason, 'school-history-baseline');
  assert.equal(f.inbox('dominika').length, 0);
  const next = { ...legacy, sourceRecordId: 'new-grade', sourceSyncId: 'later-sync', createdAt: new Date(3000) };
  f.values.set('schoolItems/new', next);
  assert.equal((await write(f, 'schoolItems', 'new', null, next)).created, 3);
  assert.equal((await write(f, 'schoolItems', 'new', null, next)).created, 0);
});

test('school metadata, read receipts and syncedAt changes never derive an alert in legacy or manual paths', async () => {
  const legacy = { ...grade }; delete legacy.sourceConnectionId;
  const f = fixture({ 'schoolItems/grade': legacy });
  const result = await write(f, 'schoolItems', 'grade', legacy, { ...legacy, sourceSyncId: 'next', syncedAt: 1000, updatedAt: 2000, read: true });
  assert.equal(result.reason, 'no-semantic-change'); assert.equal(result.created, 0);
  assert.equal((await write(f, 'schoolParentMessages', 'mail', { ...legacy, type: 'message' }, { ...legacy, type: 'message', read: true })).created, 0);
});

test('manual school writes still notify actual changes without inventing a provider baseline', async () => {
  const f = fixture();
  const manual = { title: 'Sprawdzian', person: 'Nikodem', type: 'test', createdBy: 'dominika' };
  assert.equal((await write(f, 'schoolItems', 'manual', null, manual)).created, 3);
  assert.equal([...f.values.keys()].some(path => path.startsWith('_notificationBaselines/')), false);
});

test('journal scope, encoded path hash and status must be valid before any queue access', async () => {
  const f = fixture();
  let flushCalls = 0;
  const flush = async () => { flushCalls++; assert.fail('invalid journal must never be drained'); };
  const hash = createHash('sha256').update(JSON.stringify('family')).digest('hex');
  for (const input of [
    { connectionHash: hash, batch: null },
    { connectionHash: hash, batch: { connectionId: 'family', status: 'delivered' } },
    { connectionHash: hash, batch: { connectionId: 'family/../other', status: 'pending' } },
    { connectionHash: hash, batch: { connectionId: 'arbitrary-uid', status: 'pending' } },
    { connectionHash: hash, batch: { connectionId: 'student_short', status: 'pending' } },
    { connectionHash: 'wrong', batch: { connectionId: 'family', status: 'pending' } },
  ]) assert.equal((await processSchoolNotificationBatch(f.context, input, { flush })).reason, 'invalid-school-journal');
  assert.equal(flushCalls, 0);
});

test('invalid managed provenance and arbitrary trigger sources fail closed', async () => {
  const f = fixture();
  assert.equal((await write(f, 'schoolItems', 'bad', null, { ...grade, sourceConnectionId: 'unknown' })).reason, 'invalid-managed-school-source');
  assert.equal((await write(f, 'schoolItems', 'bad', null, { ...grade, sourceSyncId: '' })).reason, 'invalid-managed-school-source');
  await assert.rejects(write(f, 'members', 'any', null, parent('Sebastian')), /Invalid notification trigger source/);
  await assert.rejects(write(f, 'familyMessages', '../path', null, message), /Invalid notification trigger source/);
});
