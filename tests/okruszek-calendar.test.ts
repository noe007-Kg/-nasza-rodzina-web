import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectOkruszekCalendar, projectSchoolCalendar, type CalendarSchoolRecord } from '../src/calendar-source-projections';
import { calendarEventInView, calendarOwnerProfile } from '../src/calendar-v2';
import { createOkruszekDays, okruszekDayEntry, type OkruszekDay } from '../src/school/okruszek-plan';
import type { FamilyMemberProfile } from '../src/family-members';

const parent = { scope: 'parent' } as const;
const pawel = { id: 'profile-pawel', name: 'Paweł', personKey: 'Paweł', role: 'child', active: true, schoolEnabled: true } satisfies FamilyMemberProfile;
const nikodem = { id: 'profile-nikodem', name: 'Nikodem', personKey: 'Nikodem', role: 'child', active: true, schoolEnabled: true } satisfies FamilyMemberProfile;
const profiles = [pawel, nikodem];

function savedPlan(change?: (day: OkruszekDay) => OkruszekDay): CalendarSchoolRecord[] {
  return createOkruszekDays('Paweł').map(initial => {
    const day = { ...(change ? change(initial) : initial), ownerProfileId: pawel.id };
    return { id: `saved-day-${day.weekday}`, ...okruszekDayEntry(day), createdBy: 'parent-sebastian' };
  });
}

function warsawDate(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

test('saved Okruszek plan projects one whole stay per school day, with its actual pupil owner', () => {
  const events = projectOkruszekCalendar(savedPlan(), [], parent, profiles);
  const monday = events.find(event => warsawDate(event.date) === '2026-10-12')!;
  assert.ok(monday);
  assert.equal(monday.person, 'Paweł');
  assert.equal(monday.ownerProfileId, pawel.id);
  assert.equal(monday.title, 'Okruszek — Paweł');
  assert.equal(monday.date.toISOString(), '2026-10-12T05:30:00.000Z');
  assert.equal(monday.endDate.toISOString(), '2026-10-12T13:10:00.000Z');
  assert.equal(monday.source, 'okruszek');
  assert.equal(monday.timeZone, 'Europe/Warsaw');
  assert.equal(monday.repeat, 'none');
  assert.equal(monday.readOnly, true);
  assert.equal(monday.private, false);
  assert.equal(calendarOwnerProfile(monday, profiles)?.id, pawel.id);
  assert.match(monday.description, /1\. Rewalidacja\n2\. Rewalidacja\n3\. f\.os i społ/);
  assert.match(monday.description, /godziny poszczególnych zajęć nie są znane/);
  assert.equal(events.filter(event => warsawDate(event.date) === '2026-10-12').length, 1);
  assert.equal(new Set(events.map(event => warsawDate(event.date))).size, events.length);
});

test('the same projected event is visible in Pawel and family views, never in other personal calendars', () => {
  const event = projectOkruszekCalendar(savedPlan(), [], parent, profiles)[0];
  assert.equal(calendarEventInView(event, 'Paweł', 'Sebastian', 'parent-sebastian'), true);
  assert.equal(calendarEventInView(event, 'family', 'Sebastian', 'parent-sebastian'), true);
  for (const person of ['Nikodem', 'Sebastian', 'Dominika']) {
    assert.equal(calendarEventInView(event, person, 'Sebastian', 'parent-sebastian'), false, person);
  }
  const own = projectOkruszekCalendar(savedPlan(), [], { scope: 'student', person: 'Paweł' }, profiles);
  assert.deepEqual(own.map(row => row.id), projectOkruszekCalendar(savedPlan(), [], parent, profiles).map(row => row.id));
  assert.deepEqual(projectOkruszekCalendar(savedPlan(), [], { scope: 'student', person: 'Nikodem' }, profiles), []);
  assert.deepEqual(projectOkruszekCalendar(savedPlan(), [], null, profiles), []);
});

test('unsaved, legacy or mismatched profile ownership cannot become a calendar event', () => {
  const rows = savedPlan();
  assert.deepEqual(projectOkruszekCalendar([], [], parent, profiles), []);
  assert.deepEqual(projectOkruszekCalendar(rows.map(({ ownerProfileId: _, ...row }) => row), [], parent, profiles), []);
  assert.deepEqual(projectOkruszekCalendar(rows, [], parent, []), []);
  assert.deepEqual(projectOkruszekCalendar(rows.map(row => ({ ...row, ownerProfileId: 'parent-sebastian' })), [], parent,
    [...profiles, { id: 'parent-sebastian', name: 'Sebastian', personKey: 'Sebastian', role: 'parent', active: true }]), []);
  assert.deepEqual(projectOkruszekCalendar(rows.map(row => ({ ...row, person: 'Nikodem', ownerProfileId: nikodem.id })), [], parent, profiles), []);
  assert.deepEqual(projectOkruszekCalendar(rows, [], parent, [{ ...pawel, archived: true }, nikodem]), []);
  assert.deepEqual(projectOkruszekCalendar(rows.map(row => ({ ...row, ownerProfileId: 'legacy:Paweł' })), [], parent,
    [{ ...pawel, id: 'legacy:Paweł' }, nikodem]), []);
});

test('confirmed days off and the unconfirmed end-of-year day never become ordinary school stays', () => {
  const events = projectOkruszekCalendar(savedPlan(), [], parent, profiles);
  const dates = new Set(events.map(event => warsawDate(event.date)));
  for (const date of ['2026-10-14', '2026-11-11', '2026-12-23', '2027-01-04', '2027-01-05', '2027-01-06',
    '2027-02-15', '2027-02-26', '2027-03-25', '2027-03-30', '2027-05-03', '2027-05-04', '2027-05-27',
    '2027-05-28', '2027-06-25', '2027-06-28', '2027-06-30']) assert.equal(dates.has(date), false, date);
  assert.equal(dates.has('2026-10-12'), true);
  assert.equal(dates.has('2027-06-24'), true);
  assert.ok([...dates].every(date => date >= '2026-10-12' && date <= '2027-06-30'));
  assert.ok(events.every(event => ![0, 6].includes(new Date(`${warsawDate(event.date)}T12:00:00Z`).getUTCDay())));
  const extended = savedPlan(day => ({ ...day, periodStart: '2026-10-01', periodEnd: '2027-07-31' }));
  assert.ok(projectOkruszekCalendar(extended, [], parent, profiles).every(event =>
    warsawDate(event.date) >= '2026-10-12' && warsawDate(event.date) <= '2027-06-30'));
});

test('reimport, repeated snapshots and duplicated weekdays retain one identity per occurrence', () => {
  const rows = savedPlan();
  const first = projectOkruszekCalendar(rows, [], parent, profiles);
  const second = projectOkruszekCalendar([...rows, rows[0], { ...rows[0], id: 'duplicate-day' }], [], parent, profiles);
  // A duplicate record may be selected deterministically, but does not add stays.
  assert.deepEqual(second.map(event => warsawDate(event.date)), first.map(event => warsawDate(event.date)));
  assert.deepEqual(projectOkruszekCalendar(rows, [], parent, profiles), first);
  const actual = Object.freeze([{ id: first[0].id }, { id: 'unrelated-calendar-event' }]);
  const result = projectOkruszekCalendar(rows, actual, parent, profiles);
  assert.equal(result.length, first.length - 1);
  assert.deepEqual(actual, [{ id: first[0].id }, { id: 'unrelated-calendar-event' }]);
});

test('parent edits change the projected time and holidays without changing occurrence IDs', () => {
  const first = projectOkruszekCalendar(savedPlan(), [], parent, profiles);
  const changed = projectOkruszekCalendar(savedPlan(day => ({ ...day, revision: 1,
    ...(day.weekday === 1 ? { endTime: '16:00', extraDaysOff: ['2026-10-19'] } : {}) })), [], parent, profiles);
  const initialMonday = first.find(event => warsawDate(event.date) === '2026-10-12')!;
  const changedMonday = changed.find(event => warsawDate(event.date) === '2026-10-12')!;
  assert.equal(initialMonday.id, changedMonday.id);
  assert.equal(changedMonday.endDate.toISOString(), '2026-10-12T14:00:00.000Z');
  assert.equal(changed.some(event => warsawDate(event.date) === '2026-10-19'), false);
});

test('blank slots are retained as blank slots, not named lessons or invented lesson times', () => {
  const tuesday = projectOkruszekCalendar(savedPlan(), [], parent, profiles).find(event => warsawDate(event.date) === '2026-10-13')!;
  assert.match(tuesday.description, /1\. — \(pusta pozycja; nie jest zajęciem\)\n2\. Zaj\. k\. kreat\n3\. Zaj\. k\. kreat\n4\. religia/);
  assert.equal((tuesday.description.match(/\d\d:\d\d/g) || []).length, 2);
});

test('Okruszek dates keep Warsaw school hours across both clock changes and device time zones', () => {
  const previous = process.env.TZ;
  try {
    for (const timeZone of ['UTC', 'Europe/Warsaw', 'America/New_York']) {
      process.env.TZ = timeZone;
      const events = projectOkruszekCalendar(savedPlan(), [], parent, profiles);
      const monday = events.find(event => warsawDate(event.date) === '2026-10-26')!;
      assert.equal(monday.date.toISOString(), '2026-10-26T06:30:00.000Z', timeZone);
      const beforeSpring = events.find(event => warsawDate(event.date) === '2027-03-24')!;
      const afterSpring = events.find(event => warsawDate(event.date) === '2027-03-31')!;
      assert.equal(beforeSpring.date.toISOString(), '2027-03-24T07:50:00.000Z', timeZone);
      assert.equal(afterSpring.date.toISOString(), '2027-03-31T06:50:00.000Z', timeZone);
      assert.equal(afterSpring.endDate.toISOString(), '2027-03-31T14:30:00.000Z', timeZone);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('adding Okruszek projection does not change eduVULCAN projections or provider data', () => {
  const sp4: CalendarSchoolRecord = Object.freeze({ id: 'sp4-nikodem', person: 'Nikodem', type: 'lesson', source: 'eduvulcan',
    title: 'Matematyka', date: '2026-10-12', time: '08:00', endTime: '08:45', note: 'Oryginalny plan SP4' });
  const records = [...savedPlan(), sp4];
  assert.deepEqual(projectSchoolCalendar(records, [], parent), projectSchoolCalendar([sp4], [], parent));
  assert.ok(projectOkruszekCalendar(records, [], parent, profiles).every(event => event.person === 'Paweł'));
  assert.equal(sp4.note, 'Oryginalny plan SP4');
});
