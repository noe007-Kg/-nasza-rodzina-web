import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveNotificationEvent, canReceiveNotification, wantsNotification, notificationPreferences, safePushData, inboxEvent, eventDocumentId } from '../server/notification-events.mjs';
const school = { source: 'eduvulcan', sourceProfileId: 'p-school', sourceRecordId: 'grade-8', person: 'Nikodem', type: 'grade', title: 'Matematyka: 5', note: 'Prywatne dane', date: '2026-10-02' };
const parent = { id: 'sebastian-uid', role: 'parent', name: 'Sebastian', active: true, canLogin: true };
const child = { id: 'nikodem-uid', role: 'child', name: 'Nikodem', active: true, canLogin: true };
test('same edu sync with different timestamps, syncId and read receipt does not produce duplicates', () => {
  const previous = { ...school, syncedAt: 100, sourceSyncId: 'a', read: false };
  const next = { ...school, syncedAt: 200, sourceSyncId: 'b', updatedAt: 200, read: true };
  assert.equal(deriveNotificationEvent('schoolItems', 'cacheid', previous, next), null);
});
test('new grade identity is stable by source record, not the time of synchronization', () => {
  const one = deriveNotificationEvent('schoolItems', 'cacheid', null, school);
  const two = deriveNotificationEvent('schoolItems', 'cacheid', null, { ...school, sourceSyncId: 'different' });
  assert.equal(one.id, 'school:grade:p-school:grade-8'); assert.equal(one.id, two.id); assert.equal(eventDocumentId(one), eventDocumentId(two));
  assert.equal(one.title, 'Nowa ocena — Nikodem'); assert.ok(!one.body.includes('5'));
});
test('grade edits create one stable semantic alert and children only receive their own non-parent records', () => {
  const change = deriveNotificationEvent('schoolItems', 'grade-8', school, { ...school, title: 'Matematyka: 6' });
  assert.equal(change.title, 'Zmiana oceny — Nikodem');
  assert.equal(change.id, deriveNotificationEvent('schoolItems', 'grade-8', school, { ...school, title: 'Matematyka: 6', syncedAt: 300 }).id);
  assert.equal(canReceiveNotification(child, change), true);
  assert.equal(canReceiveNotification({ ...child, name: 'Paweł' }, change), false);
  const personal = { ...change, record: { ...change.record, sourceConnectionScope: 'student', sourceOwnerUid: child.id } };
  assert.equal(canReceiveNotification(parent, personal), false);
  assert.equal(canReceiveNotification(child, personal), true);
  assert.equal(canReceiveNotification({ ...child, id: 'different-uid' }, personal), false);
});
test('real lesson change and cancellation have deterministic, distinct identifiers', () => {
  const lesson = { ...school, type: 'lesson', sourceRecordId: 'lesson-1', title: 'Lekcja', time: '08:00' };
  const changed = deriveNotificationEvent('schoolItems', 'lesson1', lesson, { ...lesson, time: '09:00' });
  assert.ok(changed.id.startsWith('school:lesson-change:')); assert.equal(changed.important, true);
  assert.equal(changed.id, deriveNotificationEvent('schoolItems', 'lesson1', lesson, { ...lesson, time: '09:00', syncedAt: 200 }).id);
  const cancelled = deriveNotificationEvent('schoolItems', 'lesson1', lesson, null);
  assert.ok(cancelled.id.startsWith('school:lesson-cancelled:')); assert.notEqual(changed.id, cancelled.id);
});
test('homework, test and teacher message alerts have distinct types', () => {
  assert.match(deriveNotificationEvent('schoolItems', 'a', null, { ...school, type: 'homework' }).id, /school:homework:/);
  assert.match(deriveNotificationEvent('schoolItems', 'a', null, { ...school, type: 'test' }).id, /school:test:/);
  assert.match(deriveNotificationEvent('schoolParentMessages', 'a', null, { ...school, type: 'message' }).id, /school:message:/);
});
test('school inbox notifications are only for parents; future student mailbox belongs to its UID', () => {
  const message = deriveNotificationEvent('schoolParentMessages', 'm1', null, { ...school, type: 'message' });
  assert.equal(canReceiveNotification(parent, message), true); assert.equal(canReceiveNotification(child, message), false);
  const personal = deriveNotificationEvent('schoolStudentMessages', 'm1', null, { ...school, sourceOwnerUid: child.id, type: 'message' });
  assert.equal(canReceiveNotification(parent, personal), false); assert.equal(canReceiveNotification(child, personal), true);
  assert.equal(canReceiveNotification({ ...child, id: 'another-child' }, personal), false);
});
test('private event never alerts a different parent or a child', () => {
  const event = deriveNotificationEvent('calendarEvents', 'c1', null, { title: 'Prywatne', private: true, ownerUid: parent.id, createdBy: 'someone', person: 'family' });
  assert.equal(canReceiveNotification(parent, event), true); assert.equal(canReceiveNotification({ ...parent, id: 'wife' }, event), false); assert.equal(canReceiveNotification(child, event), false);
});
test('private 1:1 messages only alert participant other than sender', () => {
  const event = deriveNotificationEvent('familyMessages', 'm1', null, { text: 'Secret', uid: parent.id, channel: 'private:a:b', participants: [parent.id, child.id] });
  assert.equal(canReceiveNotification(parent, event), false); assert.equal(canReceiveNotification(child, event), true); assert.equal(canReceiveNotification({ ...parent, id: 'third-person' }, event), false);
});
test('health recipient permissions match record privacy and own-person binding', () => {
  const privateHealth = deriveNotificationEvent('healthRecords', 'h1', null, { title: 'Secret PDF', person: 'Nikodem', privateToParents: true });
  assert.equal(canReceiveNotification(parent, privateHealth), true); assert.equal(canReceiveNotification(child, privateHealth), false);
  const shared = { ...privateHealth, record: { ...privateHealth.record, privateToParents: false } };
  assert.equal(canReceiveNotification(child, shared), true); assert.equal(canReceiveNotification({ ...child, name: 'Paweł' }, shared), false);
});
test('inactive, non-login and invalid roles cannot receive any notification', () => {
  const event = deriveNotificationEvent('schoolItems', 'g1', null, school);
  for (const invalid of [{ ...parent, active: false }, { ...parent, canLogin: false }, { ...parent, role: 'guest' }, null]) assert.equal(canReceiveNotification(invalid, event), false);
});
test('user opt-in and categories are checked before queuing and delivery', () => {
  const event = deriveNotificationEvent('schoolItems', 'g1', null, school);
  assert.equal(wantsNotification(undefined, event), true);
  assert.equal(wantsNotification({ enabled: false }, event), false);
  assert.equal(wantsNotification({ enabled: true, categories: { school: false } }, event), false);
  assert.equal(wantsNotification({ enabled: true, sound: false }, event), true);
  assert.equal(wantsNotification({ enabled: true, categories: { important: false } }, { ...event, important: true }), false);
  assert.equal(notificationPreferences({ enabled: true, sound: false }).sound, false);
});
test('push payload and inbox contain no grades, medicine names, message bodies or tokens', () => {
  const event = deriveNotificationEvent('schoolItems', 'g1', null, school);
  const push = safePushData(parent.id, event, false);
  assert.equal(push.recipientUid, parent.id); assert.equal(push.sound, '0'); assert.equal(push.title, 'Nasza Rodzina');
  assert.ok(!JSON.stringify(push).includes('Matematyka')); assert.ok(!JSON.stringify(push).includes('Prywatne dane'));
  assert.ok(!Object.hasOwn(inboxEvent(event, new Date()), 'record'));
});
test('notification deduplication ignores object key order', () => {
  assert.equal(deriveNotificationEvent('calendarEvents', 'c1', { title: 'A', date: new Date(100), description: 'x' }, { description: 'x', date: new Date(100), title: 'A', updatedAt: new Date(200) }), null);
});
test('custom recurrence, exceptions, series overrides and end rules are real calendar changes', () => {
  const original = { title: 'Rodzinne spotkanie', date: new Date(100), repeat: 'custom', recurrence: { interval: 1, unit: 'week', weekdays: [1] } };
  for (const change of [{ recurrence: { interval: 2, unit: 'week', weekdays: [1] } }, { recurrenceExceptions: ['2026-10-03T10:00:00.000Z'] }, { recurrenceOverrides: { '2026-10-03T10:00:00.000Z': { title: 'Inne miejsce' } } }, { repeatCount: 5 }, { repeatUntil: new Date(500) }, { repeatBefore: new Date(600) }, { repeat: 'none' }]) {
    assert.ok(deriveNotificationEvent('calendarEvents', 'series', original, { ...original, ...change }));
  }
});
test('cancellation of a restored lesson with changed details gets a distinct stable alert identity', () => {
  const original = { ...school, type: 'lesson', sourceRecordId: 'lesson-1', time: '08:00' };
  const one = deriveNotificationEvent('schoolItems', 'lesson-1', original, null);
  const retried = deriveNotificationEvent('schoolItems', 'lesson-1', { ...original, syncedAt: 500 }, null);
  const later = deriveNotificationEvent('schoolItems', 'lesson-1', { ...original, time: '09:00' }, null);
  assert.equal(one.id, retried.id); assert.notEqual(one.id, later.id);
});
