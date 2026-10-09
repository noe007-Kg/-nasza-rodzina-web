import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CalendarEventData } from '../src/app-shared';
import { calendarSourceDisplayEvent, canChangeGoogleVisibility, readCalendarSourceMetadata } from '../src/calendar-source-metadata';
import { endOfDay, formatDateInput, generateOccurrences, startOfDay } from '../src/calendar-utils';
import { exportCalendarIcs } from '../src/calendar-ics';

const googleId = `google-${'a'.repeat(64)}`;
function event(patch: Partial<CalendarEventData> = {}): CalendarEventData {
  return { id: googleId, title: 'Zajęcia źródłowe', person: 'family', date: new Date('2026-04-30T15:00:00Z'), endDate: new Date('2026-05-01T14:59:59.999Z'),
    allDay: true, description: '', createdBy: 'importer', ownerUid: 'importer', repeat: 'none', repeatUntil: null, source: 'google', readOnly: true,
    sourceOwnerUid: 'importer', sourceConnectionId: 'calendar-connection', externalCalendarId: 'source-calendar', externalEventId: 'source-event', timeZone: 'Asia/Tokyo', ...patch };
}
test('Google provenance maps only explicit metadata and remains read-only if a legacy flag is absent or false', () => {
  const input = { source: 'google', sourceConnectionId: 'connection', sourceOwnerUid: 'owner', externalCalendarId: 'calendar', externalEventId: 'event', externalSeriesId: 'series',
    sourceStartDate: '2026-05-01', sourceEndDateExclusive: '2026-05-02', ownerProfileId: 'profile', readOnly: false, cancelled: true, token: 'must-not-map', extra: 'ignored' };
  assert.deepEqual(readCalendarSourceMetadata(input), { source: 'google', sourceConnectionId: 'connection', sourceOwnerUid: 'owner', externalCalendarId: 'calendar', externalEventId: 'event',
    externalSeriesId: 'series', sourceStartDate: '2026-05-01', sourceEndDateExclusive: '2026-05-02', ownerProfileId: 'profile', readOnly: true, cancelled: true });
  assert.equal(readCalendarSourceMetadata({ source: 'google' }).readOnly, true);
});
test('old manual records do not gain reserved false/provider fields', () => {
  assert.deepEqual(readCalendarSourceMetadata({ title: 'Stare wydarzenie' }), {});
  assert.deepEqual(readCalendarSourceMetadata({ source: 'manual', readOnly: false, cancelled: false }), { source: 'manual' });
  assert.deepEqual(readCalendarSourceMetadata({ source: 'outlook', readOnly: 'true', cancelled: 'true', sourceStartDate: '2026-05-01' }), {});
});
test('invalid metadata and non-existent civil days are not mapped', () => {
  assert.deepEqual(readCalendarSourceMetadata({ source: 'google', sourceConnectionId: '', externalEventId: 1, externalSeriesId: null, sourceOwnerUid: 'x'.repeat(2049), sourceStartDate: '2026-02-30', sourceEndDateExclusive: 'tomorrow' }), { source: 'google', readOnly: true });
});
test('only the importing UID with complete source ownership can request a visibility change', () => {
  assert.equal(canChangeGoogleVisibility(event(), 'importer'), true);
  assert.equal(canChangeGoogleVisibility(event({ private: true }), 'importer'), true);
  for (const patch of [{ source: 'manual' as const }, { id: 'manual-id' }, { sourceOwnerUid: 'other' }, { ownerUid: 'other' }, { createdBy: 'other' }, { sourceConnectionId: undefined }, { externalEventId: undefined }]) {
    assert.equal(canChangeGoogleVisibility(event(patch), 'importer'), false, JSON.stringify(patch));
  }
  assert.equal(canChangeGoogleVisibility(event(), 'other'), false);
  assert.equal(canChangeGoogleVisibility(event(), ''), false);
  assert.equal(canChangeGoogleVisibility(null, 'importer'), false);
});
for (const zone of ['Europe/Warsaw', 'America/New_York']) test(`Tokyo all-day DATE stays 1 May on a ${zone} device; storage and ICS remain source-faithful`, () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = zone;
    for (const explicit of [false, true]) {
      const original = event(explicit ? { sourceStartDate: '2026-05-01', sourceEndDateExclusive: '2026-05-02' } : {});
      const display = calendarSourceDisplayEvent(original);
      assert.equal(formatDateInput(display.date), '2026-05-01');
      assert.equal(formatDateInput(display.endDate), '2026-05-01');
      assert.equal(display.endDate.getHours(), 23);
      const row = generateOccurrences(display, startOfDay(new Date(2026, 4, 1)), endOfDay(new Date(2026, 4, 1)));
      assert.equal(row.length, 1);
      assert.equal(generateOccurrences(display, startOfDay(new Date(2026, 3, 30)), endOfDay(new Date(2026, 3, 30))).length, 0);
      assert.equal(original.date.toISOString(), '2026-04-30T15:00:00.000Z');
      assert.equal(original.endDate.toISOString(), '2026-05-01T14:59:59.999Z');
      const ics = exportCalendarIcs([original], { uid: 'importer' });
      assert.match(ics, /DTSTART;VALUE=DATE:20260501/); assert.match(ics, /DTEND;VALUE=DATE:20260502/);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('Google all-day inclusive last civil date stays stable across both Warsaw DST transitions and multiple days', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    for (const [start, end, last] of [['2026-03-28', '2026-03-31', '2026-03-30'], ['2026-10-24', '2026-10-27', '2026-10-26']]) {
      const original = event({ sourceStartDate: start, sourceEndDateExclusive: end, timeZone: 'Europe/Warsaw' });
      const display = calendarSourceDisplayEvent(original);
      assert.equal(formatDateInput(display.date), start); assert.equal(formatDateInput(display.endDate), last);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('manual and timed events are not projected into new dates', () => {
  for (const original of [event({ source: 'manual' }), event({ allDay: false }), event({ repeat: 'daily' })]) assert.equal(calendarSourceDisplayEvent(original), original);
});

test('a valid São Paulo DATE beginning after a midnight DST gap keeps the source day in display and raw ICS export', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Warsaw';
    const original = event({ date: new Date('2018-11-04T03:00:00Z'), endDate: new Date('2018-11-05T01:59:59.999Z'), timeZone: 'America/Sao_Paulo', sourceStartDate: '2018-11-04', sourceEndDateExclusive: '2018-11-05' });
    const display = calendarSourceDisplayEvent(original);
    assert.equal(formatDateInput(display.date), '2018-11-04'); assert.equal(formatDateInput(display.endDate), '2018-11-04');
    const ics = exportCalendarIcs([original], { uid: 'importer' });
    assert.match(ics, /DTSTART;VALUE=DATE:20181104/); assert.match(ics, /DTEND;VALUE=DATE:20181105/);
    assert.equal(original.date.toISOString(), '2018-11-04T03:00:00.000Z');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
