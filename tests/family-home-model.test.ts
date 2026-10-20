import test from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarOccurrence } from '../src/app-shared';
import { agendaDayLabel, familyAgendaRange, homeSectionOrder, reorderHomeSections, upcomingFamilyEvents } from '../src/features/family-home-model';
import { START_CARD_IDS } from '../src/features/start-layout';
import { accountAccentKey, parseAccountAccent, resolveAccountAccent } from '../src/features/account-accent';
const occurrence = (key: string, from: string, until: string, extra = {}) => ({ key, date: new Date(from), endDate: new Date(until), source: { title: key, person: 'Nikodem', ...extra } }) as CalendarOccurrence;
test('three-section layout preserves legacy seven-ID schema and shortcut internal order on explicit drop', () => {
  assert.deepEqual(homeSectionOrder(START_CARD_IDS), ['calendar', 'tasks', 'shortcuts']);
  const previous = ['health', 'school', 'family-time', 'calendar', 'shopping', 'tasks', 'chat'] as const;
  assert.deepEqual(homeSectionOrder(previous), ['shortcuts', 'calendar', 'tasks']);
  const next = reorderHomeSections(previous, 'tasks', 'shortcuts');
  assert.deepEqual(next, ['family-time', 'tasks', 'health', 'school', 'shopping', 'chat', 'calendar']);
  assert.equal(new Set(next).size, 7);
  assert.deepEqual(reorderHomeSections(previous, 'tasks', 'tasks'), [...previous]);
  assert.deepEqual(previous, ['health', 'school', 'family-time', 'calendar', 'shopping', 'tasks', 'chat']);
});
test('agenda keeps concurrent/ongoing events and cancellation, hides private and ended events', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const events = [occurrence('work', '2026-10-20T06:00:00Z', '2026-10-20T14:00:00Z'), occurrence('piano', '2026-10-20T13:00:00Z', '2026-10-20T13:30:00Z'), occurrence('cancelled', '2026-10-20T13:00:00Z', '2026-10-20T13:45:00Z', { cancelled: true }), occurrence('private', '2026-10-20T14:00:00Z', '2026-10-20T15:00:00Z', { private: true }), occurrence('ended', '2026-10-20T11:00:00Z', '2026-10-20T12:00:00Z'), occurrence('too-late', '2026-10-27T10:00:00Z', '2026-10-27T11:00:00Z')];
  assert.deepEqual(upcomingFamilyEvents(events, now).map(e => e.key), ['work', 'cancelled', 'piano']);
  assert.equal(events[2].source.cancelled, true);
});
test('Warsaw seven-day horizon follows DST and day labels across device zones', () => {
  const range = familyAgendaRange(new Date('2026-10-24T22:30:00Z'));
  assert.equal(range.start.toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-10-31T22:59:59.999Z');
  assert.equal(agendaDayLabel(new Date('2026-10-25T12:00:00Z'), new Date('2026-10-24T22:30:00Z')), 'Dzisiaj');
  assert.equal(agendaDayLabel(new Date('2026-10-26T12:00:00Z'), new Date('2026-10-24T22:30:00Z')), 'Jutro');
});
test('agenda limits to six entries and preserves an all-day event and cross-midnight active event', () => {
  const now = new Date('2026-10-20T22:30:00Z');
  const events = [occurrence('overnight', '2026-10-20T21:00:00Z', '2026-10-21T02:00:00Z'), occurrence('all-day', new Date(2026, 9, 21).toISOString(), new Date(2026, 9, 21, 23, 59, 59).toISOString(), { allDay: true }), ...Array.from({ length: 9 }, (_, i) => occurrence(`later-${i}`, '2026-10-21T09:00:00Z', '2026-10-21T10:00:00Z'))];
  const upcoming = upcomingFamilyEvents(events, now);
  assert.equal(upcoming.length, 6); assert.equal(upcoming[0].key, 'overnight'); assert.equal(upcoming[1].source.allDay, true);
  assert.deepEqual(upcomingFamilyEvents([], now), []);
});
test('account accent uses explicit household keys, manual preference wins, and unknown profiles keep original pink', () => {
  for (const name of ['Sebastian', 'Paweł', 'Nikodem']) assert.equal(resolveAccountAccent('auto', { personKey: name }), 'blue');
  for (const name of ['Dominika', 'Layla', 'Unknown']) assert.equal(resolveAccountAccent('auto', { personKey: name }), 'pink');
  assert.equal(resolveAccountAccent('pink', { name: 'Sebastian' }), 'pink');
  assert.equal(resolveAccountAccent('blue', { name: 'Dominika' }), 'blue');
  assert.notEqual(accountAccentKey('uid-one'), accountAccentKey('uid-two'));
  assert.equal(parseAccountAccent('invalid-css'), 'auto');
});

test('all-day civil dates remain in the right Warsaw day on a device in UTC+14', () => {
  const previous = process.env.TZ; process.env.TZ = 'Pacific/Kiritimati';
  try {
    const allDay = { ...occurrence('civil', '2026-10-20T10:00:00Z', '2026-10-21T09:59:59Z', { allDay: true }), date: new Date(2026, 9, 21), endDate: new Date(2026, 9, 21, 23, 59, 59) };
    const now = new Date('2026-10-20T12:00:00Z');
    assert.equal(upcomingFamilyEvents([allDay], now).length, 1);
    assert.equal(agendaDayLabel(allDay.date, now, true), 'Jutro');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
