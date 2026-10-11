import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEventData } from '../src/app-shared';
import { calendarEventInView, calendarOwnerColor, calendarOwnerProfile, familyCalendarEvents, importantCalendarOccurrences, projectFamilyBirthdays } from '../src/calendar-v2';

function event(patch: Partial<CalendarEventData> = {}): CalendarEventData {
  return { id: 'shared', title: 'Wydarzenie', person: 'profile-a', date: new Date('2026-10-11T11:00:00Z'), endDate: new Date('2026-10-11T12:00:00Z'), allDay: false, repeat: 'none', repeatUntil: null, description: '', createdBy: 'uid-a', ownerUid: 'uid-a', private: false, ...patch };
}

test('Cała rodzina and Start exclude every private event, including the signed-in owner', () => {
  const shared = event(), ownPrivate = event({ id: 'private', private: true }), foreignPrivate = event({ id: 'foreign', private: true, ownerUid: 'uid-b' });
  assert.deepEqual(familyCalendarEvents([shared, ownPrivate, foreignPrivate]), [shared]);
  assert.equal(calendarEventInView(ownPrivate, 'family', 'profile-a', 'uid-a'), false);
  assert.equal(calendarEventInView(foreignPrivate, 'family', 'profile-a', 'uid-a'), false);
});

test('personal view shows only authorized owner-private and own/family shared events', () => {
  assert.equal(calendarEventInView(event({ private: true }), 'profile-a', 'profile-a', 'uid-a'), true);
  assert.equal(calendarEventInView(event({ private: true, person: 'profile-b' }), 'profile-a', 'profile-a', 'uid-a'), true);
  assert.equal(calendarEventInView(event({ private: true, ownerUid: 'uid-b' }), 'profile-a', 'profile-a', 'uid-a'), false);
  assert.equal(calendarEventInView(event({ private: true }), 'profile-b', 'profile-a', 'uid-a'), false);
  assert.equal(calendarEventInView(event({ person: 'family' }), 'profile-a', 'profile-a', 'uid-a'), true);
  assert.equal(calendarEventInView(event({ person: 'profile-b' }), 'profile-a', 'profile-a', 'uid-a'), false);
  assert.equal(calendarEventInView(event({ private: true, ownerUid: 'uid-parent' }), 'profile-child', 'profile-child', 'uid-child'), false);
});

test('Start family selection preserves all actual shared sources and cancellation records', () => {
  const rows = [event(), event({ id: 'google', source: 'google' }), event({ id: 'sp4', source: 'sp4', cancelled: true }), event({ id: 'health', source: 'health' }), event({ id: 'fryderyk', source: 'fryderyk' }), event({ id: 'google-private', source: 'google', private: true })];
  assert.deepEqual(familyCalendarEvents(rows).map(item => item.id), ['shared', 'google', 'sp4', 'health', 'fryderyk']);
});

test('important list includes explicit and medical terms, never ordinary lessons/work or cancelled terms', () => {
  const now = new Date('2026-10-11T08:00:00Z');
  const rows = [event({ id: 'lesson', title: 'Lekcja', source: 'sp4' }), event({ id: 'work', title: 'Praca' }), event({ id: 'important', important: true }), event({ id: 'visit', source: 'health' }), event({ id: 'cancelled', important: true, cancelled: true })];
  assert.deepEqual(importantCalendarOccurrences(rows, now).map(item => item.source.id).sort(), ['important', 'visit']);
});

test('important lists preserve recurrence and single-occurrence importance without writing source data', () => {
  const base = event({ repeat: 'daily', repeatCount: 3, important: false, recurrenceOverrides: { '2026-10-12T11:00:00.000Z': { date: new Date('2026-10-12T11:00:00Z'), endDate: new Date('2026-10-12T12:00:00Z'), important: true } } });
  const result = importantCalendarOccurrences([base], new Date('2026-10-11T08:00:00Z'));
  assert.equal(result.length, 1);
  assert.equal(result[0].date.toISOString(), '2026-10-12T11:00:00.000Z');
  assert.equal(base.important, false);
});

test('birthdays project only saved valid dates and dynamic active profiles, without guessed family members', () => {
  const profiles = [{ id: 'profile-any', personKey: 'Nowa osoba', name: 'Nowa osoba', birthDate: '2000-10-12' }, { id: 'missing', name: 'Bez daty' }, { id: 'archived', name: 'Archiwum', birthDate: '2001-10-11', archived: true }, { id: 'invalid', name: 'Zła data', birthDate: '2001-02-31' }];
  const projected = projectFamilyBirthdays(profiles);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].title, 'Urodziny — Nowa osoba');
  assert.equal(projected[0].readOnly, true);
  assert.equal(importantCalendarOccurrences(projected, new Date('2026-10-11T08:00:00Z'))[0].date.getFullYear(), 2026);
  assert.equal(profiles[0].birthDate, '2000-10-12');
});

test('owner colour and avatar resolve dynamic identity and remain independent of tile colours', () => {
  const profile = { id: 'new-profile', personKey: 'dynamic-key', name: 'Dowolne imię', photoURL: 'https://example.invalid/photo.png' };
  assert.equal(calendarOwnerColor('dynamic-key'), calendarOwnerColor('dynamic-key'));
  assert.notEqual(calendarOwnerColor('dynamic-key'), calendarOwnerColor('another-key'));
  assert.equal(calendarOwnerProfile({ person: 'dynamic-key' }, [profile]), profile);
  assert.equal(calendarOwnerProfile({ person: 'renamed', ownerProfileId: 'new-profile' }, [profile]), profile);
});
