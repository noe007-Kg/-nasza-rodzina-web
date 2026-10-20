import test from 'node:test';
import assert from 'node:assert/strict';
import { musicCalendarEvents, type MusicPlan } from '../src/school/music-school-model';
import { calendarEventInView } from '../src/calendar-v2';

const plan: MusicPlan = { id: 'stable-plan', ownerProfileId: 'student-uid', person: 'Student', revision: 1,
  validFrom: '2026-10-19', validUntil: '2027-06-30', lessons: [], excludedDates: [], check: null,
  occurrences: [{ id: '2026-10-20_piano', title: 'Fortepian główny', date: '2026-10-20', time: '15:00', endTime: '15:30',
    startAt: '2026-10-20T13:00:00.000Z', endAt: '2026-10-20T13:30:00.000Z', teacher: 'Nauczyciel', room: '13',
    cancelled: false, moved: false, manual: false, note: '', evidence: null }] };
test('same canonical occurrence serves personal and family calendars without copied documents', () => {
  const [event] = musicCalendarEvents([plan]);
  assert.equal(event.ownerProfileId, 'student-uid'); assert.equal(event.person, 'Student'); assert.equal(event.private, false);
  assert.equal(event.source, 'fryderyk'); assert.equal(event.readOnly, true);
  assert.equal(event.date.toISOString(), '2026-10-20T13:00:00.000Z');
  assert.equal(event.endDate.getTime() - event.date.getTime(), 30 * 60000);
  assert.match(event.description, /dziennik Fryderyk niepołączony/);
  assert.match(event.description, /nie jest to potwierdzenie/);
  assert.equal(calendarEventInView(event, 'family', 'Parent', 'parent-uid'), true);
  assert.equal(calendarEventInView(event, 'Student', 'Parent', 'parent-uid'), true);
  assert.equal(calendarEventInView(event, 'Other', 'Parent', 'parent-uid'), false);
});
test('cancellation updates the original stable calendar event and preserves source evidence', () => {
  const [before] = musicCalendarEvents([plan]);
  const changed = { ...plan, occurrences: plan.occurrences.map(x => ({ ...x, cancelled: true,
    evidence: { url: 'https://www.gov.pl/web/psmkolobrzeg/pani-agnieszka-sokolnicka', from: '2026-10-19', until: '2026-10-22' } })) };
  const [after] = musicCalendarEvents([changed]);
  assert.equal(before.id, after.id); assert.equal(after.cancelled, true);
  assert.match(after.title, /ODWOŁANE/); assert.match(after.description, /gov.pl/);
});
test('empty scoped API result exposes no school events', () => assert.deepEqual(musicCalendarEvents([]), []));

test('personal calendar uses current person key resolved by saved owner UID, not a stale plan name', () => {
  const stale = { ...plan, person: 'Nikodem Sebastian Połoński' };
  const profiles = [
    { id: 'student-uid', name: 'Nikodem Sebastian Połoński', personKey: 'Nikodem' },
    { id: 'other-uid', name: stale.person, personKey: 'Other' },
  ];
  const [event] = musicCalendarEvents([stale], profiles);
  assert.equal(event.ownerProfileId, 'student-uid');
  assert.equal(event.person, 'Nikodem');
  assert.equal(calendarEventInView(event, 'Nikodem', 'Parent', 'parent-uid'), true);
  assert.equal(calendarEventInView(event, 'family', 'Parent', 'parent-uid'), true);
  assert.equal(calendarEventInView(event, 'Other', 'Parent', 'parent-uid'), false);
  assert.equal(calendarEventInView(event, 'Nikodem', 'Nikodem', 'student-uid'), true);
  assert.equal(event.id, musicCalendarEvents([stale])[0].id);
  assert.equal(stale.person, 'Nikodem Sebastian Połoński');
});
test('directory name matches cannot reassign an occurrence owned by another UID', () => {
  const [event] = musicCalendarEvents([plan], [{ id: 'foreign-uid', name: plan.person, personKey: 'Nikodem' }]);
  assert.equal(event.person, plan.person);
  assert.equal(calendarEventInView(event, 'Nikodem', 'Parent', 'parent-uid'), false);
});
