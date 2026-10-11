import test from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEventData } from '../src/app-shared';
import { generateCalendarOccurrencesFromSources, generateGoogleOccurrences } from '../src/calendars/google-occurrences';
import { calendarSourceDisplayEvent } from '../src/calendar-source-metadata';

function event(changes: Partial<CalendarEventData> = {}): CalendarEventData {
  return { id: 'master', title: 'Historia', description: '', person: 'owner', createdBy: 'uid-owner', ownerUid: 'uid-owner', private: true,
    date: new Date('2026-10-18T07:00:00Z'), endDate: new Date('2026-10-18T08:00:00Z'), allDay: false, repeat: 'none', repeatUntil: null,
    source: 'google', sourceOwnerUid: 'uid-owner', sourceConnectionId: 'connection', externalCalendarId: 'calendar', externalEventId: 'master', timeZone: 'Europe/Warsaw',
    sourceRecurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'], ...changes };
}
const from = new Date('2026-10-17T00:00:00Z'), to = new Date('2026-11-02T23:59:59Z');

test('Google raw weekly masters preserve Warsaw wall-clock time across autumn DST', () => {
  const occurrences = generateGoogleOccurrences(event(), from, to);
  assert.deepEqual(occurrences.map(value => value.date.toISOString()), ['2026-10-18T07:00:00.000Z', '2026-10-25T08:00:00.000Z', '2026-11-01T08:00:00.000Z']);
  assert.deepEqual(occurrences.map(value => value.endDate.getTime() - value.date.getTime()), [3600000, 3600000, 3600000]);
});

test('raw rules can show historical occurrences years outside the old finite expansion window', () => {
  const historical = event({ date: new Date('2001-01-01T08:00:00Z'), endDate: new Date('2001-01-01T09:00:00Z'), sourceRecurrence: ['RRULE:FREQ=YEARLY'] });
  const values = generateGoogleOccurrences(historical, new Date('2003-01-01T00:00:00Z'), new Date('2003-01-02T00:00:00Z'));
  assert.equal(values.length, 1); assert.equal(values[0].date.toISOString(), '2003-01-01T08:00:00.000Z');
});

test('moved and cancelled exceptions suppress their original master date exactly once and never another source', () => {
  const master = event(), moved = event({ id: 'moved', externalEventId: 'moved', externalSeriesId: 'master', sourceRecurrence: [], externalOriginalStart: '2026-10-25T09:00:00+01:00', date: new Date('2026-10-26T11:00:00Z'), endDate: new Date('2026-10-26T12:00:00Z') });
  const cancelled = event({ id: 'cancelled', externalEventId: 'cancelled', externalSeriesId: 'master', sourceRecurrence: [], externalOriginalStart: '2026-11-01T09:00:00+01:00', cancelled: true, sourceExceptionTombstone: true });
  const secondSource = event({ id: 'other-master', sourceConnectionId: 'other-connection' });
  const values = generateCalendarOccurrencesFromSources([master, moved, cancelled, secondSource], from, to);
  assert.deepEqual(values.filter(value => value.source.id === 'master').map(value => value.date.toISOString()), ['2026-10-18T07:00:00.000Z']);
  assert.equal(values.filter(value => value.source.id === 'moved').length, 1); assert.equal(values.filter(value => value.source.id === 'other-master').length, 3);
  assert.equal(values.some(value => value.source.id === 'cancelled'), false);
});

test('provider EXDATE and RDATE retain their meaning rather than inventing an extra daily recurrence', () => {
  const values = generateGoogleOccurrences(event({ sourceRecurrence: ['RRULE:FREQ=WEEKLY;COUNT=3', 'EXDATE;TZID=Europe/Warsaw:20261025T090000', 'RDATE;TZID=Europe/Warsaw:20261027T090000'] }), from, to);
  assert.deepEqual(values.map(value => value.date.toISOString()), ['2026-10-18T07:00:00.000Z', '2026-10-27T08:00:00.000Z', '2026-11-01T08:00:00.000Z']);
});

test('recurring all-day DATE covers full civil days and preserves a cancelled date at DST', () => {
  const master = event({ date: new Date('2026-10-17T22:00:00Z'), endDate: new Date('2026-10-18T21:59:59.999Z'), allDay: true, sourceRecurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'], sourceStartDate: '2026-10-18', sourceEndDateExclusive: '2026-10-19' });
  const cancelled = event({ id: 'all-day-cancelled', allDay: true, externalEventId: 'all-day-cancelled', externalSeriesId: 'master', externalOriginalStart: '2026-10-25', sourceRecurrence: [], cancelled: true, sourceExceptionTombstone: true });
  const values = generateCalendarOccurrencesFromSources([master, cancelled], from, to);
  assert.equal(values.length, 2);
  for (const value of values) { assert.equal(value.date.getHours(), 0); assert.equal(value.endDate.getHours(), 23); assert.equal(value.endDate.getMinutes(), 59); }
  assert.deepEqual(values.map(value => value.date.getDate()), [18, 1]);
});

test('old flattened series rows are superseded only by the master from the same Google source', () => {
  const old = event({ id: 'old-flat', externalEventId: 'flat', externalSeriesId: 'master', sourceRecurrence: [] });
  const other = event({ ...old, id: 'other-flat', sourceConnectionId: 'other' });
  const values = generateCalendarOccurrencesFromSources([event(), old, other], from, to);
  assert.equal(values.filter(value => value.source.id === 'old-flat').length, 0); assert.equal(values.filter(value => value.source.id === 'other-flat').length, 1);
});

test('display preparation does not convert an all-day recurring master twice on a device in another timezone', () => {
  const master = event({ date: new Date('2026-10-18T04:00:00Z'), endDate: new Date('2026-10-19T03:59:59.999Z'), allDay: true, timeZone: 'America/New_York', sourceStartDate: '2026-10-18', sourceEndDateExclusive: '2026-10-19' });
  const prepared = calendarSourceDisplayEvent(master);
  const values = generateGoogleOccurrences(prepared, from, to);
  assert.deepEqual(values.map(value => value.date.getDate()), [18, 25, 1]);
  assert.equal(prepared.date.getTime(), master.date.getTime());
});

test('UTC UNTIL and UTC EXDATE are converted into the source wall clock without shifting the cutoff', () => {
  const master = event({ sourceRecurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20261101T080000Z', 'EXDATE:20261025T080000Z'] });
  assert.deepEqual(generateGoogleOccurrences(master, from, to).map(value => value.date.toISOString()), ['2026-10-18T07:00:00.000Z', '2026-11-01T08:00:00.000Z']);
});

test('Warsaw spring DST preserves the source hour while changing its real UTC offset', () => {
  const master = event({ date: new Date('2026-03-22T08:00:00Z'), endDate: new Date('2026-03-22T09:00:00Z') });
  const values = generateGoogleOccurrences(master, new Date('2026-03-21T00:00:00Z'), new Date('2026-04-06T00:00:00Z'));
  assert.deepEqual(values.map(value => value.date.toISOString()), ['2026-03-22T08:00:00.000Z', '2026-03-29T07:00:00.000Z', '2026-04-05T07:00:00.000Z']);
});
