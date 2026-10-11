import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFamilyTime, currentFamilyStatus, familyStatusRefreshDelay, formatFamilyStatusTime,
  warsawCalendarDay, type StartCalendarOccurrence } from '../src/features/start-tile-projections';

const time = (clock: string) => new Date(`2026-10-12T${clock}:00+02:00`);
const event = (id: string, person: string, start: string, end: string,
  source: Partial<StartCalendarOccurrence['source']> = {}): StartCalendarOccurrence => ({
  key: id, source: { id, person, title: id, ...source }, date: time(start), endDate: time(end),
});

test('a real work block stays active for its entire eight hours, then stops exactly at its end', () => {
  const work = [event('Praca', 'Sebastian', '08:00', '16:00')];
  assert.equal(currentFamilyStatus('Sebastian', work, time('07:59')).kind, 'idle');
  for (const clock of ['08:00', '09:00', '15:59']) {
    const status = currentFamilyStatus('Sebastian', work, time(clock));
    assert.equal(status.kind, 'active'); assert.equal(status.title, 'Praca');
    assert.equal(status.endAt?.getTime(), time('16:00').getTime());
  }
  assert.equal(currentFamilyStatus('Sebastian', work, time('16:00')).kind, 'idle');
  assert.equal(currentFamilyStatus('Dominika', work, time('10:00')).kind, 'idle');
});

test('a declared five-minute break is yellow only in its exact interval; an ordinary gap stays gray', () => {
  const rows = [event('Język polski', 'Nikodem', '08:00', '08:45', { eventKind: 'lesson' }),
    event('Przerwa', 'Nikodem', '08:45', '08:50', { eventKind: 'break' }),
    event('Matematyka', 'Nikodem', '08:55', '09:40', { eventKind: 'lesson' })];
  assert.equal(currentFamilyStatus('Nikodem', rows, time('08:44')).title, 'Język polski');
  assert.equal(currentFamilyStatus('Nikodem', rows, time('08:45')).kind, 'break');
  assert.equal(currentFamilyStatus('Nikodem', rows, time('08:49')).kind, 'break');
  assert.equal(currentFamilyStatus('Nikodem', rows, time('08:50')).kind, 'idle');
  assert.equal(currentFamilyStatus('Nikodem', rows, time('08:55')).title, 'Matematyka');
});

test('estimated lessons and estimated breaks retain an explicit uncertainty flag', () => {
  const lesson = event('PDP/kuchnia', 'Paweł', '09:40', '10:25', { eventKind: 'lesson', timingConfidence: 'estimated' });
  const confirmed = event('Rewalidacja', 'Paweł', '07:30', '07:55', { eventKind: 'lesson', timingConfidence: 'confirmed' });
  const breakRow = event('Przerwa', 'Paweł', '10:25', '10:30', { eventKind: 'break', timingConfidence: 'estimated' });
  assert.equal(currentFamilyStatus('Paweł', [lesson], time('10:00')).estimated, true);
  assert.equal(currentFamilyStatus('Paweł', [confirmed], time('07:45')).estimated, false);
  const status = currentFamilyStatus('Paweł', [breakRow], time('10:26'));
  assert.equal(status.kind, 'break'); assert.equal(status.estimated, true);
});

test('private status is visible only to its real owner and never treated as a family obligation', () => {
  const privateRows = [event('Prywatne', 'Sebastian', '08:00', '16:00', { private: true, ownerUid: 's' }),
    event('Prywatne Dominiki', 'Dominika', '08:00', '16:00', { private: true, ownerUid: 'd' })];
  assert.equal(currentFamilyStatus('Sebastian', privateRows, time('09:00')).kind, 'idle');
  assert.equal(currentFamilyStatus('Sebastian', privateRows, time('09:00'), { uid: 's', person: 'Sebastian' }).title, 'Prywatne');
  assert.equal(currentFamilyStatus('Dominika', privateRows, time('09:00'), { uid: 's', person: 'Sebastian' }).kind, 'idle');
  assert.equal(currentFamilyStatus('Sebastian', privateRows, time('09:00'), { uid: 'd', person: 'Sebastian' }).kind, 'idle');
  const summary = buildFamilyTime([{ id: 's', personKey: 'Sebastian' }, { id: 'd', personKey: 'Dominika' }], privateRows, [], time('09:00'), { uid: 's', person: 'Sebastian' });
  assert.equal(summary.members[0].currentStatus.title, 'Prywatne');
  assert.equal(summary.members[1].endAt, null);
  assert.equal(summary.members[1].currentStatus.kind, 'idle');
});

test('an owner-private legacy family event applies only to its owner profile, never the household', () => {
  const rows = [event('Prywatna praca', 'family', '08:00', '16:00', { private: true, ownerUid: 's' })];
  const profiles = [{ id: 's', personKey: 'Sebastian' }, { id: 'd', personKey: 'Dominika' }];
  const ownViewer = { uid: 's', person: 'Sebastian' };
  const summary = buildFamilyTime(profiles, rows, [], time('09:00'), ownViewer);
  assert.equal(summary.members[0].currentStatus.kind, 'active');
  assert.equal(summary.members[0].currentStatus.title, 'Prywatna praca');
  assert.equal(summary.members[0].endAt?.getTime(), time('16:00').getTime());
  assert.equal(summary.members[1].currentStatus.kind, 'idle');
  assert.equal(summary.members[1].endAt, null);
  const otherViewer = { uid: 'd', person: 'Dominika' };
  for (const person of ['Sebastian', 'Dominika']) {
    assert.equal(currentFamilyStatus(person, rows, time('09:00'), otherViewer).kind, 'idle');
    assert.equal(currentFamilyStatus(person, rows, time('09:00')).kind, 'idle');
  }
});

test('cancelled, incomplete, all-day and unconfirmed Fryderyk rows never claim an active lesson', () => {
  const rows = [event('Odwołane', 'Nikodem', '08:00', '10:00', { cancelled: true }),
    event('Cały dzień', 'Nikodem', '08:00', '10:00', { allDay: true }),
    event('Fryderyk', 'Nikodem', '08:00', '10:00', { source: 'fryderyk' }),
    event('Fryderyk orientacyjny', 'Nikodem', '08:00', '10:00', { source: 'fryderyk', timingConfidence: 'estimated' }),
    { ...event('Brak godzin', 'Nikodem', '08:00', '10:00'), endDate: undefined },
    { ...event('Nieprawidłowe godziny', 'Nikodem', '08:00', '10:00'), date: new Date(Number.NaN) }];
  assert.equal(currentFamilyStatus('Nikodem', rows, time('09:00')).kind, 'idle');
  const summary = buildFamilyTime([{ id: 'n', personKey: 'Nikodem' }], rows, [], time('09:00'));
  assert.equal(summary.endAt, null); assert.equal(summary.incomplete, true);
  const confirmed = event('Fortepian', 'Nikodem', '08:00', '10:00', { source: 'fryderyk', timingConfidence: 'confirmed' });
  assert.equal(currentFamilyStatus('Nikodem', [...rows, confirmed], time('09:00')).title, 'Fortepian');
});

test('overlapping obligations retain all real labels; an active event takes precedence over a simultaneous break', () => {
  const rows = [event('Praca', 'Sebastian', '08:00', '16:00'),
    event('Spotkanie', 'Sebastian', '09:00', '10:00'),
    event('Przerwa', 'Sebastian', '09:00', '09:05', { eventKind: 'break' }),
    event('Lekcja', 'Nikodem', '09:00', '09:45')];
  const status = currentFamilyStatus('Sebastian', rows, time('09:00'));
  assert.equal(status.kind, 'active'); assert.equal(status.title, 'Spotkanie (do 10:00) · Praca (do 16:00)');
  assert.equal(status.endAt, null);
  const afterMeeting = currentFamilyStatus('Sebastian', rows, time('10:00'));
  assert.equal(afterMeeting.kind, 'active'); assert.equal(afterMeeting.title, 'Praca');
  assert.equal(afterMeeting.endAt?.getTime(), time('16:00').getTime());
  assert.equal(currentFamilyStatus('Nikodem', rows, time('09:00')).title, 'Lekcja');
});

test('local refresh targets exact start and end boundaries, including sub-minute transitions', () => {
  const row = event('Rewalidacja', 'Paweł', '07:30', '07:55');
  assert.equal(familyStatusRefreshDelay([row], new Date(time('07:30').getTime() - 450)), 450);
  assert.equal(familyStatusRefreshDelay([row], new Date(time('07:55').getTime() - 1250)), 1250);
  assert.equal(familyStatusRefreshDelay([], new Date(time('08:00').getTime() + 12_000)), 48_000);
  assert.equal(familyStatusRefreshDelay([row], new Date(Number.NaN)), 60_000);
});

test('Warsaw day and clocks are independent of the device timezone and daylight-saving day length', () => {
  const midnight = warsawCalendarDay(new Date('2026-10-11T22:15:00Z'));
  assert.equal(midnight.key, '2026-10-12'); assert.equal(midnight.weekday, 1);
  assert.equal(midnight.start.toISOString(), '2026-10-11T22:00:00.000Z');
  assert.equal(formatFamilyStatusTime(time('16:00')), '16:00');
  for (const [date, hours] of [['2027-03-28T12:00:00Z', 23], ['2026-10-25T12:00:00Z', 25]] as const) {
    const day = warsawCalendarDay(new Date(date));
    assert.equal(day.end.getTime() + 1 - day.start.getTime(), hours * 3_600_000);
  }
});

test('current statuses use the same occurrences and immediately reflect real calendar edits', () => {
  const profile = { id: 's', personKey: 'Sebastian' };
  const first = event('Praca', 'Sebastian', '08:00', '16:00');
  const updated = event('Praca', 'Sebastian', '09:00', '17:00');
  assert.equal(buildFamilyTime([profile], [first], [], time('08:30')).members[0].currentStatus.kind, 'active');
  assert.equal(buildFamilyTime([profile], [updated], [], time('08:30')).members[0].currentStatus.kind, 'idle');
  assert.equal(buildFamilyTime([profile], [updated], [], time('09:30')).members[0].currentStatus.endAt?.getTime(), time('17:00').getTime());
});
