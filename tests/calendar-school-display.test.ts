import test from 'node:test';
import assert from 'node:assert/strict';
import { projectManualSchoolCalendar } from '../src/calendar-school-display';
import { generateOccurrences } from '../src/calendar-utils';
import type { CalendarSchoolRecord } from '../src/calendar-source-projections';

const parent = { scope: 'parent' } as const;
const row = (extra: Partial<CalendarSchoolRecord> = {}): CalendarSchoolRecord => ({ id: 'manual-1', person: 'dynamic-person',
  type: 'lesson', title: 'Zapisane zajęcia', date: '2026-10-12', time: '08:00', endTime: '08:45', ...extra });

test('shared manual projection preserves real saved dates and times without writes or guessed durations', () => {
  const original = Object.freeze(row());
  const result = projectManualSchoolCalendar([original], [], parent);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].date.toISOString(), '2026-10-12T06:00:00.000Z');
  assert.equal(result.events[0].endDate.toISOString(), '2026-10-12T06:45:00.000Z');
  assert.equal(result.events[0].repeat, 'none');
  assert.deepEqual(original, row());
});

test('only an explicitly saved weekday creates weekly manual occurrences', () => {
  const result = projectManualSchoolCalendar([row({ date: '', weekday: 1 })], [], parent);
  const occurrences = generateOccurrences(result.events[0], new Date('2026-10-12T00:00:00Z'), new Date('2026-10-12T23:59:59Z'));
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].date.toISOString(), '2026-10-12T06:00:00.000Z');
  assert.deepEqual(projectManualSchoolCalendar([row({ date: '', weekday: 0 })], [], parent), { events: [], incomplete: 1 });
});

test('repeated snapshots and real linked calendar documents never create duplicate manual views', () => {
  const record = row();
  assert.equal(projectManualSchoolCalendar([record, record], [], parent).events.length, 1);
  assert.equal(projectManualSchoolCalendar([row({ calendarEventId: 'saved' })], [{ id: 'saved' }], parent).events.length, 0);
  assert.equal(projectManualSchoolCalendar([record], [{ id: 'school:manual:manual-1' }], parent).events.length, 0);
});

test('manual school projection respects student scope and does not mix provider sources or school mailboxes', () => {
  const rows = [row(), row({ id: 'sibling', person: 'another' }), row({ id: 'sp4', source: 'eduvulcan' }),
    row({ id: 'fryderyk', source: 'fryderyk' }), row({ id: 'mail', type: 'message' }), row({ id: 'okruszek', schoolPlanId: 'okruszek-2026-2027' })];
  assert.deepEqual(projectManualSchoolCalendar(rows, [], { scope: 'student', person: 'dynamic-person' }).events.map(event => event.id), ['school:manual:manual-1']);
  assert.deepEqual(projectManualSchoolCalendar(rows, [], null), { events: [], incomplete: 0 });
});

test('an explicitly stored break is distinguishable; a normal empty calendar gap creates no event', () => {
  const result = projectManualSchoolCalendar([{ ...row(), eventKind: 'break' }], [], parent);
  assert.equal(result.events[0].eventKind, 'break');
  assert.equal(projectManualSchoolCalendar([row()], [], parent).events[0].eventKind, undefined);
  assert.equal(projectManualSchoolCalendar([row({ endTime: '' })], [], parent).events.length, 0);
});
