import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEventData, CalendarOccurrence } from '../src/app-shared';
import { calendarOccurrencesOnDay, calendarRangeDisplaySources, calendarTimelineRange, formatWarsawTime, layoutCalendarTimeline, warsawCalendarDayRange, warsawDayKey } from '../src/calendar-timeline';
import { generateCalendarOccurrencesFromSources } from '../src/calendars/google-occurrences';

function item(id: string, start: string, end: string, patch: Partial<CalendarEventData> = {}): CalendarOccurrence {
  const date = new Date(start), endDate = new Date(end);
  return { key: id, date, endDate, source: { id, title: id, date, endDate, person: id, allDay: false, repeat: 'none', repeatUntil: null, description: '', createdBy: '', ...patch } };
}
const monday = new Date('2026-10-12T10:00:00Z');

test('one 08–16 work occurrence remains exactly an eight-hour block without splitting', () => {
  const work = item('Sebastian', '2026-10-12T06:00:00Z', '2026-10-12T14:00:00Z');
  const blocks = layoutCalendarTimeline([work], monday, 7 * 60, 2);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].startMinute, 480);
  assert.equal(blocks[0].endMinute, 960);
  assert.equal(blocks[0].top, 120);
  assert.equal(blocks[0].height, 960);
  assert.equal(work.date.toISOString(), '2026-10-12T06:00:00.000Z');
});

test('simultaneous people stay at the same actual start and receive horizontal lanes only', () => {
  const rows = ['Sebastian', 'Dominika', 'Paweł', 'Nikodem'].map(name => item(name, '2026-10-12T07:00:00Z', '2026-10-12T07:45:00Z'));
  const blocks = layoutCalendarTimeline(rows, monday, 8 * 60);
  assert.deepEqual(blocks.map(block => block.top), [120, 120, 120, 120]);
  assert.deepEqual(blocks.map(block => block.height), [90, 90, 90, 90]);
  assert.equal(new Set(blocks.map(block => block.column)).size, 4);
  assert.ok(blocks.every(block => block.columns === 4));
});

test('adjacent lessons and explicit five-minute breaks keep exact starts and durations', () => {
  const rows = [item('lesson-1', '2026-10-12T06:00:00Z', '2026-10-12T06:45:00Z'), item('break', '2026-10-12T06:45:00Z', '2026-10-12T06:50:00Z', { eventKind: 'break' }), item('lesson-2', '2026-10-12T06:50:00Z', '2026-10-12T07:35:00Z')];
  const blocks = layoutCalendarTimeline(rows, monday, 480);
  assert.deepEqual(blocks.map(block => [block.top, block.height, block.columns]), [[0, 90, 1], [90, 10, 1], [100, 90, 1]]);
});

test('a long work event overlapping several short lessons never vertically shifts the lessons', () => {
  const blocks = layoutCalendarTimeline([item('work', '2026-10-12T06:00:00Z', '2026-10-12T14:00:00Z'), item('first', '2026-10-12T06:00:00Z', '2026-10-12T06:45:00Z'), item('second', '2026-10-12T06:50:00Z', '2026-10-12T07:35:00Z')], monday, 480);
  assert.equal(blocks.find(block => block.occurrence.key === 'work')?.height, 960);
  assert.equal(blocks.find(block => block.occurrence.key === 'first')?.top, 0);
  assert.equal(blocks.find(block => block.occurrence.key === 'second')?.top, 100);
  assert.equal(blocks.find(block => block.occurrence.key === 'first')?.column, blocks.find(block => block.occurrence.key === 'second')?.column);
});

test('overnight intervals are clipped to the day, while endpoints and all-day events do not add timed blocks', () => {
  const allDay = item('all-day', '2026-10-12T00:00:00Z', '2026-10-12T23:59:59Z', { allDay: true });
  allDay.date = new Date(2026, 9, 12); allDay.endDate = new Date(2026, 9, 12, 23, 59, 59);
  const rows = [item('previous', '2026-10-11T21:30:00Z', '2026-10-11T23:00:00Z'), item('next', '2026-10-12T21:00:00Z', '2026-10-12T23:00:00Z'), item('ends-before', '2026-10-11T21:00:00Z', '2026-10-11T22:00:00Z'), allDay];
  assert.deepEqual(layoutCalendarTimeline(rows, monday).map(block => [block.occurrence.key, block.startMinute, block.endMinute]), [['previous', 0, 60], ['next', 1380, 1440]]);
  assert.deepEqual(calendarOccurrencesOnDay(rows, monday).map(row => row.key), ['previous', 'next', 'all-day']);
});

test('all-day civil display dates keep their date on devices outside Warsaw without duplicating the next day', () => {
  const priorTZ = process.env.TZ;
  try {
    for (const deviceTZ of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      process.env.TZ = deviceTZ;
      const occurrence = item('google-date', '2026-10-12T00:00:00Z', '2026-10-12T23:59:59Z', { allDay: true, source: 'google' });
      occurrence.date = new Date(2026, 9, 12); occurrence.endDate = new Date(2026, 9, 12, 23, 59, 59);
      assert.equal(calendarOccurrencesOnDay([occurrence], monday).length, 1);
      assert.equal(calendarOccurrencesOnDay([occurrence], new Date('2026-10-13T10:00:00Z')).length, 0);
      assert.equal(calendarOccurrencesOnDay([occurrence], new Date('2026-10-11T10:00:00Z')).length, 0);
    }
  } finally { if (priorTZ === undefined) delete process.env.TZ; else process.env.TZ = priorTZ; }
});

test('recurrence geometry uses occurrence dates, retaining estimated and cancellation metadata', () => {
  const occurrence = item('lesson', '2026-10-12T06:00:00Z', '2026-10-12T06:45:00Z', { date: new Date('2026-10-01T06:00:00Z'), endDate: new Date('2026-10-01T06:45:00Z'), timingConfidence: 'estimated', cancelled: true });
  const [block] = layoutCalendarTimeline([occurrence], monday, 480);
  assert.equal(block.top, 0);
  assert.equal(block.height, 90);
  assert.equal(block.occurrence.source.timingConfidence, 'estimated');
  assert.equal(block.occurrence.source.cancelled, true);
});

test('Warsaw positions are independent of device timezone and unchanged across daylight-saving transitions', () => {
  const priorTZ = process.env.TZ;
  try {
    for (const deviceTZ of ['UTC', 'Europe/Warsaw', 'America/New_York']) {
      process.env.TZ = deviceTZ;
      for (const [date, offset] of [['2026-10-24', 2], ['2026-10-25', 1], ['2027-03-27', 1], ['2027-03-28', 2]] as const) {
        const occurrence = item('work', `${date}T${String(8 - offset).padStart(2, '0')}:00:00Z`, `${date}T${String(16 - offset).padStart(2, '0')}:00:00Z`);
        const [block] = layoutCalendarTimeline([occurrence], occurrence.date);
        assert.deepEqual([block.startMinute, block.endMinute, block.height], [480, 960, 960]);
        assert.equal(formatWarsawTime(occurrence.date), '08:00');
        assert.equal(warsawDayKey(occurrence.date), date);
      }
    }
  } finally { if (priorTZ === undefined) delete process.env.TZ; else process.env.TZ = priorTZ; }
});

test('Warsaw day bounds include the true 23/25-hour day without shifting daytime labels', () => {
  const spring = warsawCalendarDayRange(new Date('2027-03-28T10:00:00Z'));
  const autumn = warsawCalendarDayRange(new Date('2026-10-25T10:00:00Z'));
  assert.equal((spring.endExclusive.getTime() - spring.start.getTime()) / 3600000, 23);
  assert.equal((autumn.endExclusive.getTime() - autumn.start.getTime()) / 3600000, 25);
});

test('day and week range encompasses early revalidation and late work without changing source rows', () => {
  const rows = [item('early', '2026-10-12T05:30:00Z', '2026-10-12T05:55:00Z'), item('late', '2026-10-12T17:00:00Z', '2026-10-12T18:10:00Z')];
  assert.deepEqual(calendarTimelineRange(rows, [monday]), { startMinute: 420, endMinute: 1260 });
  assert.deepEqual(calendarTimelineRange(rows, [monday, new Date('2026-10-13T10:00:00Z')]), { startMinute: 420, endMinute: 1260 });
  assert.equal(rows.length, 2);
});

test('display range filtering excludes only distant non-repeating Okruszek rows and preserves all other source identities', () => {
  const range = warsawCalendarDayRange(monday);
  const current = item('current', '2026-10-12T06:00:00Z', '2026-10-12T06:45:00Z', { source: 'okruszek', timingConfidence: 'estimated' }).source;
  const before = item('before', '2026-10-11T06:00:00Z', '2026-10-11T06:45:00Z', { source: 'okruszek' }).source;
  const after = item('after', '2026-10-13T06:00:00Z', '2026-10-13T06:45:00Z', { source: 'okruszek' }).source;
  const google = { ...before, id: 'google-old', source: 'google' as const };
  const sp4 = { ...after, id: 'sp4-future', source: 'sp4' as const };
  const manual = { ...before, id: 'manual-old', source: 'manual' as const };
  const rows = [before, current, after, google, sp4, manual];
  assert.deepEqual(calendarRangeDisplaySources(rows, range.start, range.end), [current, google, sp4, manual]);
  const expanded = generateCalendarOccurrencesFromSources(rows, range.start, range.end);
  const optimized = generateCalendarOccurrencesFromSources(calendarRangeDisplaySources(rows, range.start, range.end), range.start, range.end);
  assert.deepEqual(optimized.map(row => [row.key, row.source.id]), expanded.map(row => [row.key, row.source.id]));
  assert.equal(optimized[0].source, current);
  assert.equal(current.timingConfidence, 'estimated');
  assert.equal(rows.length, 6);
});

test('Okruszek boundary filtering matches existing inclusive generator bounds and retains explicit importance/overrides', () => {
  const range = warsawCalendarDayRange(monday);
  const atStart = item('boundary', '2026-10-11T21:30:00Z', '2026-10-11T22:00:00Z', { source: 'okruszek' }).source;
  const ordinary = item('lesson', '2026-10-12T06:00:00Z', '2026-10-12T06:45:00Z', { source: 'okruszek' }).source;
  const important = { ...ordinary, id: 'important', important: true };
  const recurrence = { ...ordinary, id: 'recurrence', date: new Date('2026-10-01T06:00:00Z'), repeat: 'weekly' as const };
  const override = { ...ordinary, id: 'override', date: new Date('2026-10-01T06:00:00Z'), recurrenceOverrides: { '2026-10-01T06:00:00.000Z': { date: ordinary.date, endDate: ordinary.endDate, important: true } } };
  assert.deepEqual(calendarRangeDisplaySources([atStart, ordinary], range.start, range.end), [atStart, ordinary]);
  assert.deepEqual(calendarRangeDisplaySources([ordinary, important, recurrence, override], range.start, range.end, true), [important, override]);
  assert.deepEqual(calendarRangeDisplaySources([recurrence, override], range.start, range.end), [recurrence, override]);
  const allDay = { ...ordinary, id: 'civil-day', date: new Date('2026-10-01T00:00:00Z'), allDay: true };
  const invalid = { ...ordinary, id: 'invalid', date: new Date(NaN) };
  assert.deepEqual(calendarRangeDisplaySources([allDay, invalid], range.start, range.end), [allDay, invalid]);
});
