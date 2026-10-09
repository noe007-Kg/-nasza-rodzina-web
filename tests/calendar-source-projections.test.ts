import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSchoolCalendar, schoolLessonCancelled, type CalendarSchoolRecord } from '../src/calendar-source-projections';
import { generateOccurrences } from '../src/calendar-utils';

const parent = { scope: 'parent' } as const;
const child = { scope: 'student', person: 'Nikodem' } as const;

function lesson(overrides: Partial<CalendarSchoolRecord> = {}): CalendarSchoolRecord {
  return { id: 'lesson-101', person: 'Nikodem', type: 'lesson', source: 'eduvulcan',
    title: 'Matematyka', date: '2026-10-07', time: '08:00', endTime: '08:45',
    note: 'Sala 106\nNauczyciel: dostępny w danych szkolnych', ...overrides };
}

test('SP4 creates a dated read-only view of actual times and note, without invented recurrence', () => {
  const input = Object.freeze(lesson());
  const { events, incomplete } = projectSchoolCalendar([input], [], parent);
  assert.equal(incomplete, 0);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.id, 'school:sp4:lesson-101');
  assert.equal(event.source, 'sp4');
  assert.equal(event.sourceRecordId, input.id);
  assert.equal(event.readOnly, true);
  assert.equal(event.timeZone, 'Europe/Warsaw');
  assert.equal(event.title, input.title);
  assert.equal(event.description, input.note);
  assert.equal(event.location, '');
  assert.equal(event.date.toISOString(), '2026-10-07T06:00:00.000Z');
  assert.equal(event.endDate.toISOString(), '2026-10-07T06:45:00.000Z');
  assert.equal(event.repeat, 'none');
  assert.equal(event.repeatUntil, null);
  assert.deepEqual(generateOccurrences(event, new Date('2026-10-14T00:00:00Z'), new Date('2026-10-14T23:59:59Z')), []);
  assert.deepEqual(input, lesson());
});

test('each school snapshot projects the same namespace IDs without duplicating repeated records', () => {
  const row = lesson();
  const first = projectSchoolCalendar([row, row], [], parent);
  const second = projectSchoolCalendar([row], [], parent);
  assert.equal(first.events.length, 1);
  assert.deepEqual(first, second);
  assert.notEqual(first.events[0].id, row.id);
});

test('child projection only includes their authorized person, including the incomplete count', () => {
  const result = projectSchoolCalendar([
    lesson(), lesson({ id: 'sibling', person: 'Paweł', title: 'Prywatna lekcja rodzeństwa' }),
    lesson({ id: 'incomplete-sibling', person: 'Paweł', endTime: '' }),
  ], [], child);
  assert.deepEqual(result.events.map(event => event.person), ['Nikodem']);
  assert.equal(result.incomplete, 0);
  assert.deepEqual(projectSchoolCalendar([lesson()], [], null), { events: [], incomplete: 0 });
});

test('parent can project multiple actual students without hardcoding family size', () => {
  const result = projectSchoolCalendar([
    lesson(), lesson({ id: 'second', person: 'Paweł' }),
    lesson({ id: 'future', person: 'member-0123456789abcdef01234567' }),
  ], [], parent);
  assert.equal(result.events.length, 3);
});

test('only eduVULCAN lessons and activities are projected; messages and grades are not calendar inputs', () => {
  const result = projectSchoolCalendar([
    lesson({ id: 'activity', type: 'activity' }),
    lesson({ id: 'manual', source: 'manual' }), lesson({ id: 'missing-source', source: undefined }),
    lesson({ id: 'parent-message', type: 'message' }), lesson({ id: 'grade', type: 'grade' }),
    lesson({ id: 'homework', type: 'homework' }), lesson({ id: 'test', type: 'test' }),
  ], [], parent);
  assert.deepEqual(result.events.map(event => event.sourceRecordId), ['activity']);
  assert.equal(result.incomplete, 0);
});

test('real existing linked calendar document suppresses its projection, not a stale link', () => {
  assert.equal(projectSchoolCalendar([lesson({ calendarEventId: 'saved-manual' })], [{ id: 'saved-manual' }], parent).events.length, 0);
  assert.equal(projectSchoolCalendar([lesson({ calendarEventId: 'deleted-or-inaccessible' })], [{ id: 'different' }], parent).events.length, 1);
  assert.equal(projectSchoolCalendar([lesson({ calendarEventId: 'saved-manual', endTime: '' })], [{ id: 'saved-manual' }], parent).incomplete, 0);
});

test('same title or time as a manual calendar event is not a deduplication criterion', () => {
  const manual = { id: 'manual-same-title', title: 'Matematyka', date: new Date('2026-10-07T06:00:00Z') };
  const result = projectSchoolCalendar([lesson()], [manual], parent);
  assert.equal(result.events.length, 1);
});

test('only the provider exact first status line marks cancellation, preserving the original event', () => {
  const cancelled = lesson({ note: '\nLekcja odwołana\r\nSala 106' });
  const result = projectSchoolCalendar([cancelled], [], parent);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].cancelled, true);
  assert.equal(result.events[0].description, cancelled.note);
  for (const note of ['Lekcja odwołana jutro', 'Informacja: Lekcja odwołana', 'Sala 106\nLekcja odwołana', 'Nie odwołano lekcji', '']) {
    assert.equal(schoolLessonCancelled(note), false, note);
  }
});

test('disappearance of a school record is not turned into a fabricated cancelled lesson', () => {
  assert.equal(projectSchoolCalendar([lesson()], [], parent).events[0].cancelled, false);
  assert.deepEqual(projectSchoolCalendar([], [], parent), { events: [], incomplete: 0 });
});

test('missing or invalid dates and clocks are counted and omitted without fabricated 45 minutes', () => {
  const rows = [
    lesson({ id: 'missing-date', date: '' }), lesson({ id: 'invalid-date', date: '2026-02-30' }),
    lesson({ id: 'missing-start', time: '' }), lesson({ id: 'missing-end', endTime: '' }),
    lesson({ id: 'invalid-clock', time: '25:00' }), lesson({ id: 'equal-end', endTime: '08:00' }),
    lesson({ id: 'earlier-end', endTime: '07:45' }), lesson({ id: 'weekly', date: '', note: 'Co środę' }),
  ];
  assert.deepEqual(projectSchoolCalendar(rows, [], parent), { events: [], incomplete: rows.length });
});

test('title comes from an actual title or subject; empty data does not invent a lesson', () => {
  assert.equal(projectSchoolCalendar([lesson({ title: '', subject: 'Fortepian' })], [], parent).events[0].title, 'Fortepian');
  assert.deepEqual(projectSchoolCalendar([lesson({ title: '', subject: '' })], [], parent), { events: [], incomplete: 1 });
});

test('school date instants follow Europe/Warsaw across spring and autumn changes independently of device zone', () => {
  const previous = process.env.TZ;
  try {
    for (const timeZone of ['UTC', 'Europe/Warsaw', 'America/New_York']) {
      process.env.TZ = timeZone;
      const dates = [
        ['2026-03-28', '2026-03-28T07:00:00.000Z'], ['2026-03-29', '2026-03-29T06:00:00.000Z'],
        ['2026-10-24', '2026-10-24T06:00:00.000Z'], ['2026-10-25', '2026-10-25T07:00:00.000Z'],
      ];
      for (const [date, expected] of dates) {
        const result = projectSchoolCalendar([lesson({ date })], [], parent);
        assert.equal(result.events[0].date.toISOString(), expected, `${timeZone}: ${date}`);
      }
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('non-existent Warsaw DST clock is skipped instead of shifting a school lesson silently', () => {
  assert.deepEqual(projectSchoolCalendar([lesson({ date: '2026-03-29', time: '02:15', endTime: '02:45' })], [], parent), { events: [], incomplete: 1 });
});

test('a device DST gap cannot shift or reject a valid Warsaw school time', () => {
  const previous = process.env.TZ;
  try {
    const scenarios = [
      { zone: 'America/New_York', date: '2026-03-08', start: '2026-03-08T01:15:00.000Z', end: '2026-03-08T01:45:00.000Z' },
      { zone: 'Australia/Sydney', date: '2026-10-04', start: '2026-10-04T00:15:00.000Z', end: '2026-10-04T00:45:00.000Z' },
    ];
    for (const scenario of scenarios) {
      process.env.TZ = scenario.zone;
      const result = projectSchoolCalendar([lesson({ date: scenario.date, time: '02:15', endTime: '02:45' })], [], parent);
      assert.equal(result.incomplete, 0, scenario.zone);
      assert.equal(result.events.length, 1, scenario.zone);
      assert.equal(result.events[0].date.toISOString(), scenario.start, scenario.zone);
      assert.equal(result.events[0].endDate.toISOString(), scenario.end, scenario.zone);
      assert.equal(result.events[0].endDate.getTime() - result.events[0].date.getTime(), 30 * 60000, scenario.zone);
      assert.deepEqual(projectSchoolCalendar([lesson({ date: '2026-03-29', time: '02:15', endTime: '02:45' })], [], parent),
        { events: [], incomplete: 1 }, `${scenario.zone}: Warsaw's own missing clock is still rejected`);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('the ambiguous autumn Warsaw clock retains the later instant in every device zone', () => {
  const previous = process.env.TZ;
  try {
    for (const timeZone of ['UTC', 'Europe/Warsaw', 'America/New_York', 'Australia/Sydney']) {
      process.env.TZ = timeZone;
      const result = projectSchoolCalendar([lesson({ date: '2026-10-25', time: '02:15', endTime: '02:45' })], [], parent);
      assert.equal(result.incomplete, 0, timeZone);
      assert.equal(result.events[0].date.toISOString(), '2026-10-25T01:15:00.000Z', timeZone);
      assert.equal(result.events[0].endDate.toISOString(), '2026-10-25T01:45:00.000Z', timeZone);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('a one-time calendar occurrence preserves exact school end instants at device DST gaps and regular school hours', () => {
  const previous = process.env.TZ;
  try {
    const scenarios = [
      { zone: 'America/New_York', date: '2026-03-08', time: '02:15', endTime: '02:45', start: '2026-03-08T01:15:00.000Z', end: '2026-03-08T01:45:00.000Z' },
      { zone: 'Australia/Sydney', date: '2026-10-04', time: '02:15', endTime: '02:45', start: '2026-10-04T00:15:00.000Z', end: '2026-10-04T00:45:00.000Z' },
      { zone: 'America/New_York', date: '2026-10-07', time: '08:00', endTime: '08:45', start: '2026-10-07T06:00:00.000Z', end: '2026-10-07T06:45:00.000Z' },
      { zone: 'Europe/Warsaw', date: '2026-03-29', time: '08:00', endTime: '08:45', start: '2026-03-29T06:00:00.000Z', end: '2026-03-29T06:45:00.000Z' },
    ];
    for (const scenario of scenarios) {
      process.env.TZ = scenario.zone;
      const projected = projectSchoolCalendar([lesson({ date: scenario.date, time: scenario.time, endTime: scenario.endTime })], [], parent);
      assert.equal(projected.events.length, 1, scenario.zone);
      const occurrences = generateOccurrences(projected.events[0], new Date(`${scenario.date}T00:00:00Z`), new Date(`${scenario.date}T23:59:59Z`));
      assert.equal(occurrences.length, 1, scenario.zone);
      assert.equal(occurrences[0].date.toISOString(), scenario.start, scenario.zone);
      assert.equal(occurrences[0].endDate.toISOString(), scenario.end, scenario.zone);
      assert.equal(occurrences[0].endDate.getTime() - occurrences[0].date.getTime(),
        new Date(scenario.end).getTime() - new Date(scenario.start).getTime(), scenario.zone);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('projection orders actual lesson dates and never changes caller arrays or linked calendar IDs', () => {
  const rows = Object.freeze([Object.freeze(lesson({ id: 'late', time: '10:00', endTime: '10:45' })), Object.freeze(lesson({ id: 'early' }))]);
  const manual = Object.freeze([Object.freeze({ id: 'saved-event' })]);
  assert.deepEqual(projectSchoolCalendar(rows, manual, parent).events.map(event => event.sourceRecordId), ['early', 'late']);
  assert.deepEqual(rows.map(row => row.id), ['late', 'early']);
  assert.deepEqual(manual, [{ id: 'saved-event' }]);
});
