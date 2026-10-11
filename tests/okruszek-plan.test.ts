import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSchoolEntry } from '../src/school-import.ts';
import {
  createOkruszekDays, OKRUSZEK_END, OKRUSZEK_PLAN_ID, OKRUSZEK_START,
  okruszekDateStatus, okruszekDayEntry, okruszekDayId, okruszekLessonRows, okruszekScheduleBreaks, parseOkruszekDay, validateOkruszekDays,
} from '../src/school/okruszek-plan.ts';
import { schoolOwnerProfileId, schoolSourcesForProfile } from '../src/school/profile-schools.ts';

test('Okruszek preserves all supplied abbreviations, blank positions, order and whole-day bounds', () => {
  const days = createOkruszekDays('Paweł');
  assert.deepEqual(days.map(day => [day.weekday, day.time, day.endTime, day.lessons]), [
    [1, '07:30', '15:10', ['Rewalidacja', 'Rewalidacja', 'f.os i społ', 'f.os i społ', 'PDP/ kuchnia', 'Z.R.Z', 'PDP', 'PDP']],
    [2, '08:50', '16:00', ['—', 'Zaj. k. kreat', 'Zaj. k. kreat', 'religia', 'PDP', 'PDP', 'PDP', 'Z.r.k', 'Z.r.k']],
    [3, '08:50', '16:30', ['—', 'PDP/ kuchnia', 'PDP/ kuchnia', 'WF', 'WF', 'WF', 'PDP/ kuchnia', 'rewalidacja', 'rewalidacja']],
    [4, '08:00', '16:00', ['PDP', 'PDP', 'PDP/ praktyki', 'PDP/ praktyki', 'PDP/ praktyki', 'PDP/ praktyki', 'rewalidacja', 'PDP', 'logopedia']],
    [5, '08:00', '16:00', ['Z.k.k.', 'Z.k.k.', 'PDP/ praktyki', 'PDP/ praktyki', 'PDP/ praktyki', 'PDP/ praktyki', 'f.os i społ', 'f.os i społ', 'f.os i społ']],
  ]);
  assert.ok(days.every(day => day.periodStart === OKRUSZEK_START && day.periodEnd === OKRUSZEK_END));
  days[0].lessons[0] = 'Edycja rodzica';
  assert.equal(createOkruszekDays('Paweł')[0].lessons[0], 'Rewalidacja');
});

test('confirmed holidays, school director days, holidays and weekends do not confirm classes', () => {
  for (const date of ['2026-10-14', '2026-11-11', '2026-12-23', '2026-12-31', '2027-01-01',
    '2027-01-04', '2027-01-05', '2027-01-06', '2027-02-15', '2027-02-26', '2027-02-28',
    '2027-03-25', '2027-03-30', '2027-05-03', '2027-05-04', '2027-05-27', '2027-05-28',
    '2027-06-26', '2027-06-28', '2027-06-30', '2026-10-17']) {
    assert.equal(okruszekDateStatus(date).kind, 'day-off', date);
  }
  for (const date of ['2026-10-12', '2026-11-02', '2027-02-12', '2027-03-01', '2027-03-31', '2027-06-24']) {
    assert.equal(okruszekDateStatus(date).kind, 'planned', date);
  }
  assert.match(okruszekDateStatus('2027-01-04').reason, /świetlicy/);
});

test('the requested period is bounded; school-year closing hours are explicitly unconfirmed', () => {
  assert.equal(okruszekDateStatus('2026-10-09').kind, 'outside-period');
  assert.equal(okruszekDateStatus('2027-07-01').kind, 'outside-period');
  assert.equal(okruszekDateStatus('2027-06-25').kind, 'unconfirmed');
  assert.equal(okruszekDateStatus('2027-02-30').kind, 'unconfirmed');
  const thursday = createOkruszekDays('Paweł')[3];
  assert.equal(okruszekDateStatus('2026-10-15', thursday).kind, 'planned');
  thursday.extraDaysOff = ['2026-10-15'];
  assert.equal(okruszekDateStatus('2026-10-15', thursday).kind, 'day-off');
});

test('stable student profile identities survive reimports and editable content changes', async () => {
  const initial = createOkruszekDays('Paweł', 'actual-pawel-profile');
  const ids = await Promise.all(initial.map(day => okruszekDayId(day.ownerProfileId!, day.weekday)));
  initial[0].time = '07:40'; initial[0].lessons.push('Ręczna poprawka'); initial[0].revision++;
  assert.equal(await okruszekDayId(initial[0].ownerProfileId!, initial[0].weekday), ids[0]);
  assert.equal(new Set(ids).size, 5);
  assert.notEqual(await okruszekDayId('actual-nikodem-profile', 1), ids[0]);
  assert.notEqual(await okruszekDayId('actual-parent-profile', 1), ids[0]);
  await assert.rejects(okruszekDayId('Paweł', 6));
});

test('school assignments belong to the selected real profile; placeholders never become account ownership', () => {
  const pawel = { id: 'actual-pawel-profile', personKey: 'Paweł', name: 'Paweł', role: 'child', active: true };
  const nikodem = { id: 'actual-nikodem-profile', personKey: 'Nikodem', name: 'Nikodem', role: 'child', active: true };
  assert.deepEqual(schoolSourcesForProfile(pawel), ['okruszek']);
  assert.deepEqual(schoolSourcesForProfile(nikodem), ['sp4', 'fryderyk']);
  assert.equal(schoolOwnerProfileId(pawel), pawel.id);
  assert.equal(schoolOwnerProfileId({ ...pawel, id: 'legacy:Paweł' }), null);
  assert.equal(schoolOwnerProfileId({ ...pawel, role: 'parent' }), null);
  assert.deepEqual(schoolSourcesForProfile({ ...pawel, archived: true }), []);
  assert.deepEqual(schoolSourcesForProfile({ ...nikodem, schoolEnabled: false }), []);
});

test('plan ownership persists with the student while old unbound records remain readable for explicit parent binding', () => {
  const day = createOkruszekDays('Paweł', 'actual-pawel-profile')[0];
  const record = okruszekDayEntry(day);
  assert.equal(record.ownerProfileId, 'actual-pawel-profile');
  assert.deepEqual(parseOkruszekDay('stable-id', record), { ...day, id: 'stable-id' });
  const legacy = okruszekDayEntry(createOkruszekDays('Paweł')[0]);
  assert.equal(parseOkruszekDay('old-id', legacy)?.ownerProfileId, undefined);
  assert.equal(parseOkruszekDay('bad-id', { ...record, ownerProfileId: 'legacy:Paweł' }), null);
  const mixed = createOkruszekDays('Paweł', 'actual-pawel-profile');
  mixed[1].ownerProfileId = 'another-profile';
  assert.throws(() => validateOkruszekDays(mixed));
});

test('whole-day plan uses existing manual school information without unconditional lesson events', () => {
  for (const day of createOkruszekDays('Paweł')) {
    const entry = okruszekDayEntry(day);
    const { schoolPlanId, schoolName, schoolPlanRevision, manualDayPlan, ...base } = entry;
    assert.deepEqual(validateSchoolEntry(base, ['Paweł']), base);
    assert.equal(base.type, 'message'); assert.equal(base.weekday, 0); assert.equal(base.date, '');
    assert.equal(schoolPlanId, OKRUSZEK_PLAN_ID); assert.equal(schoolName, 'Okruszek, Kołobrzeg');
    assert.equal(schoolPlanRevision, 0); assert.equal(manualDayPlan.weekday, day.weekday);
    assert.deepEqual(manualDayPlan.lessons, day.lessons);
    assert.ok(manualDayPlan.confirmedDaysOff.length > 0);
    assert.deepEqual(parseOkruszekDay('stable-id', entry), { ...day, id: 'stable-id' });
    assert.equal(Object.hasOwn(entry, 'source'), false);
    assert.equal(Object.hasOwn(entry, 'sourceProfileId'), false);
  }
});

test('malformed plans, provider records and invalid weekdays cannot silently become editable days', () => {
  const day = createOkruszekDays('Paweł')[0];
  const entry = okruszekDayEntry(day);
  assert.equal(parseOkruszekDay('x', { ...entry, schoolPlanId: 'different' }), null);
  assert.equal(parseOkruszekDay('x', { ...entry, source: 'eduvulcan' }), null);
  assert.equal(parseOkruszekDay('x', { ...entry, provider: 'eduvulcan' }), null);
  assert.equal(parseOkruszekDay('x', { ...entry, sourceProfileId: 'sp4' }), null);
  for (const weekday of [0, 6, 1.5, '1']) {
    assert.equal(parseOkruszekDay('x', { ...entry, manualDayPlan: { ...entry.manualDayPlan, weekday } }), null);
  }
  assert.equal(parseOkruszekDay('x', { ...entry, endTime: '06:00' }), null);
  assert.equal(parseOkruszekDay('x', { ...entry, time: '' }), null);
  assert.equal(parseOkruszekDay('x', { ...entry, manualDayPlan: { ...entry.manualDayPlan, extraDaysOff: ['2026-02-30'] } }), null);
});

test('parent edits validate five unique days, increasing bounds, original strings and extra exclusions', () => {
  const days = createOkruszekDays('Paweł');
  days[0].lessons.push('Nowy wpis rodzica'); days[0].extraDaysOff = ['2026-10-15', '2026-10-15'];
  const checked = validateOkruszekDays(days);
  assert.deepEqual(checked[0].extraDaysOff, ['2026-10-15']);
  assert.equal(checked[0].lessons.at(-1), 'Nowy wpis rodzica');
  assert.throws(() => validateOkruszekDays(days.slice(1)));
  assert.throws(() => validateOkruszekDays(days.map(day => ({ ...day, weekday: 1 }))));
  assert.throws(() => validateOkruszekDays(days.map(day => ({ ...day, time: '17:00' }))));
  assert.throws(() => validateOkruszekDays(days.map(day => ({ ...day, endTime: '' }))));
});

test('the school bell template remains available but all unsaved assignments are clearly estimates', () => {
  const rows = okruszekLessonRows(createOkruszekDays('Paweł')[3]);
  assert.deepEqual(rows.map(row => [row.time, row.endTime]), [
    ['08:00', '08:45'], ['08:50', '09:35'], ['09:40', '10:25'], ['10:30', '11:15'],
    ['11:20', '12:05'], ['12:10', '12:55'], ['13:35', '14:20'], ['14:25', '15:10'], ['15:15', '16:00'],
  ]);
  assert.ok(rows.every(row => row.confidence === 'estimated'));
});

test('Monday uses the parent-confirmed first lesson and five-minute break, with next lesson at 08:00', () => {
  const day = createOkruszekDays('Paweł')[0];
  const rows = okruszekLessonRows(day);
  assert.deepEqual([rows[0].time, rows[0].endTime, rows[0].confidence], ['07:30', '07:55', 'confirmed']);
  assert.deepEqual([rows[1].time, rows[1].endTime, rows[1].confidence], ['08:00', '08:45', 'estimated']);
  assert.deepEqual(okruszekScheduleBreaks(rows)[0], { afterPosition: 1, time: '07:55', endTime: '08:00', lunch: false, confidence: 'confirmed' });
  assert.equal(rows.length, 8);
  assert.ok(rows.every((row, index) => !index || row.time! >= rows[index - 1].endTime!));
  assert.equal(day.endTime, '15:10');
  assert.equal(rows.at(-1)?.endTime, '14:20'); // No invented class fills unspecified attendance.
});

test('Wednesday has all three distinct WF lessons and a five-minute break before the final additional draft lesson', () => {
  const day = createOkruszekDays('Paweł')[2];
  const rows = okruszekLessonRows(day);
  assert.equal(rows.filter(row => !row.empty && row.lesson === 'WF').length, 3);
  assert.deepEqual([rows[7].time, rows[7].endTime], ['15:15', '16:00']);
  assert.deepEqual([rows[8].time, rows[8].endTime, rows[8].confidence], ['16:05', '16:30', 'estimated']);
  assert.ok(okruszekScheduleBreaks(rows).some(pause => pause.time === '16:00' && pause.endTime === '16:05' && pause.confidence === 'estimated'));
  assert.ok(rows.filter(row => !row.empty).every(row => row.time! >= day.time && row.endTime! <= day.endTime));
});

test('blank positions never acquire a time or become a break or lesson', () => {
  for (const weekdayIndex of [1, 2]) {
    const day = createOkruszekDays('Paweł')[weekdayIndex];
    for (const blank of ['—', '-']) {
      day.lessons[0] = blank;
      const rows = okruszekLessonRows(day);
      assert.deepEqual([rows[0].position, rows[0].empty, rows[0].time, rows[0].endTime], [1, true, null, null]);
      assert.equal(rows[1].time, '08:50');
      assert.equal(okruszekScheduleBreaks(rows).some(pause => pause.afterPosition === 1), false);
    }
  }
});

test('only planned five-minute and lunch breaks are inferred, never every empty calendar gap', () => {
  const day = createOkruszekDays('Paweł')[3];
  let rows = okruszekLessonRows(day);
  assert.ok(okruszekScheduleBreaks(rows).some(pause => pause.time === '12:55' && pause.endTime === '13:35' && pause.lunch));
  day.lessonTimings = [{ position: 1, time: '08:00', endTime: '08:20', confidence: 'confirmed' }];
  rows = okruszekLessonRows(day);
  assert.equal(okruszekScheduleBreaks(rows).some(pause => pause.afterPosition === 1), false);
  day.lessonTimings[0].breakAfter = true;
  assert.ok(okruszekScheduleBreaks(okruszekLessonRows(day)).some(pause => pause.time === '08:20' && pause.endTime === '08:50'));
  day.lessonTimings[0].breakAfter = false;
  assert.equal(okruszekScheduleBreaks(okruszekLessonRows(day)).some(pause => pause.afterPosition === 1), false);
});

test('saved exact lesson times and confidence override the legacy draft without changing the source text', () => {
  const days = createOkruszekDays('Paweł', 'actual-pawel-profile');
  days[3].lessonTimings = [{ position: 1, time: '08:05', endTime: '08:40', confidence: 'confirmed', breakAfter: false }];
  const checked = validateOkruszekDays(days);
  const entry = okruszekDayEntry(checked[3]);
  assert.deepEqual(entry.manualDayPlan.lessonTimings, days[3].lessonTimings);
  const restored = parseOkruszekDay('stored', entry)!;
  assert.deepEqual(restored, { ...days[3], id: 'stored' });
  assert.deepEqual([okruszekLessonRows(restored)[0].time, okruszekLessonRows(restored)[0].endTime, okruszekLessonRows(restored)[0].confidence], ['08:05', '08:40', 'confirmed']);
  checked[3].lessonTimings![0].time = '08:10';
  assert.equal(days[3].lessonTimings[0].time, '08:05');
  assert.equal(entry.manualDayPlan.lessonTimings![0].time, '08:05');
});

test('overlapping, out-of-bounds, duplicate and blank-slot individual times are rejected', () => {
  for (const timings of [
    [{ position: 1, time: '08:00', endTime: '09:00', confidence: 'confirmed' }],
    [{ position: 1, time: '07:55', endTime: '08:45', confidence: 'confirmed' }],
    [{ position: 1, time: '08:00', endTime: '08:45', confidence: 'invented' }],
    [{ position: 1, time: '08:00', endTime: '08:45', confidence: 'confirmed' }, { position: 1, time: '08:00', endTime: '08:45', confidence: 'confirmed' }],
    [{ position: 10, time: '08:00', endTime: '08:45', confidence: 'confirmed' }],
  ]) {
    const days = createOkruszekDays('Paweł');
    days[3].lessonTimings = timings as typeof days[3]['lessonTimings'];
    assert.throws(() => validateOkruszekDays(days));
    const entry = okruszekDayEntry(days[3]);
    assert.equal(parseOkruszekDay('malformed', entry), null);
  }
  const days = createOkruszekDays('Paweł');
  days[1].lessonTimings = [{ position: 1, time: '08:50', endTime: '09:35', confidence: 'confirmed' }];
  assert.throws(() => validateOkruszekDays(days));
});

test('parent edits and appended subjects retain their text and are never labelled officially confirmed', () => {
  const day = createOkruszekDays('Paweł')[3];
  day.lessons[0] = 'Ręczna poprawka rodzica'; day.lessons.push('Dodatkowy wpis rodzica');
  const rows = okruszekLessonRows(day);
  assert.equal(rows[0].confidence, 'estimated');
  assert.equal(rows[0].lesson, 'Ręczna poprawka rodzica');
  assert.deepEqual([rows.at(-1)?.time, rows.at(-1)?.endTime], [null, null]);
  assert.equal(rows.at(-1)?.lesson, 'Dodatkowy wpis rodzica');
});

test('projection leaves saved legacy documents unchanged and never silently persists draft timings', () => {
  const day = createOkruszekDays('Paweł', 'actual-pawel-profile')[0];
  day.revision = 2; day.extraDaysOff = ['2026-10-15'];
  const original = structuredClone(day); const entry = okruszekDayEntry(day);
  Object.freeze(day.lessons); Object.freeze(day.extraDaysOff); Object.freeze(day);
  okruszekLessonRows(day);
  assert.deepEqual(day, original);
  assert.deepEqual(okruszekDayEntry(day), entry);
  assert.equal(Object.hasOwn(entry.manualDayPlan, 'lessonTimings'), false);
  assert.deepEqual(parseOkruszekDay('saved-day', entry), { ...original, id: 'saved-day' });
});
