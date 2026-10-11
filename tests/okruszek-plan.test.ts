import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSchoolEntry } from '../src/school-import.ts';
import {
  createOkruszekDays, OKRUSZEK_END, OKRUSZEK_PLAN_ID, OKRUSZEK_START,
  okruszekDateStatus, okruszekDayEntry, okruszekDayId, okruszekLessonRows, parseOkruszekDay, validateOkruszekDays,
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

test('individual Okruszek lesson rows use all nine official school bell slots', () => {
  const day = createOkruszekDays('Paweł')[3];
  const rows = okruszekLessonRows(day);
  assert.deepEqual(rows.map(row => [row.position, row.lesson, row.empty, row.time, row.endTime]), [
    [1, 'PDP', false, '08:00', '08:45'],
    [2, 'PDP', false, '08:50', '09:35'],
    [3, 'PDP/ praktyki', false, '09:40', '10:25'],
    [4, 'PDP/ praktyki', false, '10:30', '11:15'],
    [5, 'PDP/ praktyki', false, '11:20', '12:05'],
    [6, 'PDP/ praktyki', false, '12:10', '12:55'],
    [7, 'rewalidacja', false, '13:35', '14:20'],
    [8, 'PDP', false, '14:25', '15:10'],
    [9, 'logopedia', false, '15:15', '16:00'],
  ]);
});

test('the official lunch break stays a gap between sixth and seventh lessons', () => {
  const rows = okruszekLessonRows(createOkruszekDays('Paweł')[4]);
  assert.equal(rows.length, 9);
  assert.equal(rows[5].endTime, '12:55');
  assert.equal(rows[6].time, '13:35');
  assert.equal(rows.some(row => ['12:55', '13:15'].includes(row.time || '')), false);
  assert.ok(rows.every(row => !/obiad|przerwa/i.test(row.lesson)));
});

test('blank first positions retain their slot number without becoming a lesson or acquiring a time', () => {
  for (const weekdayIndex of [1, 2]) {
    const day = createOkruszekDays('Paweł')[weekdayIndex];
    for (const blank of ['—', '-']) {
      day.lessons[0] = blank;
      const rows = okruszekLessonRows(day);
      assert.equal(rows[0].position, 1);
      assert.equal(rows[0].empty, true);
      assert.equal(rows[0].time, null);
      assert.equal(rows[0].endTime, null);
      assert.equal(rows[1].position, 2);
      assert.equal(rows[1].time, '08:50');
      assert.equal(rows[1].endTime, '09:35');
      assert.deepEqual(rows.map(row => row.lesson), day.lessons);
    }
  }
});

test('additional revalidation outside regular bells retains whole-stay bounds without a false lesson time', () => {
  const monday = createOkruszekDays('Paweł')[0];
  const wednesday = createOkruszekDays('Paweł')[2];
  const mondayRows = okruszekLessonRows(monday);
  const wednesdayRows = okruszekLessonRows(wednesday);
  assert.equal(monday.time, '07:30');
  assert.equal(monday.endTime, '15:10');
  assert.equal(mondayRows[0].individual, true);
  assert.deepEqual([mondayRows[0].time, mondayRows[0].endTime], [null, null]);
  assert.equal(mondayRows[1].individual, false);
  assert.deepEqual([mondayRows[1].time, mondayRows[1].endTime], ['08:50', '09:35']);
  assert.equal(mondayRows.at(-1)?.endTime, '15:10');
  assert.equal(wednesday.time, '08:50');
  assert.equal(wednesday.endTime, '16:30');
  assert.equal(wednesdayRows.at(-1)?.individual, true);
  assert.deepEqual([wednesdayRows.at(-1)?.time, wednesdayRows.at(-1)?.endTime], [null, null]);
  assert.equal(wednesdayRows[7].individual, false);
  assert.deepEqual([wednesdayRows[7].time, wednesdayRows[7].endTime], ['14:25', '15:10']);
  assert.equal(mondayRows.some(row => row.time === '07:30'), false);
  assert.equal(wednesdayRows.some(row => row.endTime === '16:30'), false);
});

test('renamed or newly added parent entries do not silently inherit a confirmed bell time', () => {
  const day = createOkruszekDays('Paweł')[3];
  day.lessons[0] = 'Ręczna poprawka rodzica';
  day.lessons.push('Dodatkowe zajęcie rodzica');
  const rows = okruszekLessonRows(day);
  assert.deepEqual(rows.map(row => row.lesson), day.lessons);
  assert.deepEqual([rows[0].time, rows[0].endTime], [null, null]);
  assert.equal(rows.at(-1)?.position, 10);
  assert.deepEqual([rows.at(-1)?.time, rows.at(-1)?.endTime], [null, null]);
  assert.deepEqual([rows[1].time, rows[1].endTime], ['08:50', '09:35']);
});

test('moving distinct lessons to different positions leaves their times unconfirmed', () => {
  const day = createOkruszekDays('Paweł')[3];
  [day.lessons[0], day.lessons[2]] = [day.lessons[2], day.lessons[0]];
  const rows = okruszekLessonRows(day);
  assert.equal(rows[0].lesson, 'PDP/ praktyki');
  assert.equal(rows[2].lesson, 'PDP');
  for (const index of [0, 2]) assert.deepEqual([rows[index].time, rows[index].endTime], [null, null]);
  assert.deepEqual([rows[1].time, rows[1].endTime], ['08:50', '09:35']);
});

test('a bell slot outside the saved whole-day stay is not confirmed or truncated', () => {
  const day = createOkruszekDays('Paweł')[3];
  day.time = '08:10'; day.endTime = '15:50';
  const rows = okruszekLessonRows(day);
  assert.deepEqual([rows[0].time, rows[0].endTime], [null, null]);
  assert.deepEqual([rows[8].time, rows[8].endTime], [null, null]);
  assert.deepEqual([rows[1].time, rows[1].endTime], ['08:50', '09:35']);
  assert.deepEqual([rows[7].time, rows[7].endTime], ['14:25', '15:10']);
  assert.equal(day.time, '08:10'); assert.equal(day.endTime, '15:50');
});

test('lesson-time projection does not mutate saved legacy data or introduce Firestore fields', () => {
  const day = createOkruszekDays('Paweł', 'actual-pawel-profile')[0];
  day.revision = 2; day.extraDaysOff = ['2026-10-15'];
  const original = structuredClone(day);
  const originalRecord = okruszekDayEntry(day);
  Object.freeze(day.lessons); Object.freeze(day.extraDaysOff); Object.freeze(day);
  const rows = okruszekLessonRows(day);
  assert.ok(rows.length);
  assert.deepEqual(day, original);
  assert.deepEqual(okruszekDayEntry(day), originalRecord);
  assert.deepEqual(parseOkruszekDay('saved-day', originalRecord), { ...original, id: 'saved-day' });
});

test('legacy spellings still match the published bell positions without rewriting saved abbreviations', () => {
  const days = createOkruszekDays('Paweł', 'actual-pawel-profile').map(day => ({ ...day,
    lessons: day.lessons.map(lesson => lesson.replace('PDP/ kuchnia', 'PDP/kuchnia')
      .replace('PDP/ praktyki', 'PDP/praktyki').replace(/^Z\.k\.k\.$/, 'Z.k.k')) }));
  const original = structuredClone(days);
  const records = days.map(okruszekDayEntry);
  const rows = days.map(okruszekLessonRows);
  assert.deepEqual([rows[0][4].lesson, rows[0][4].time, rows[0][4].endTime], ['PDP/kuchnia', '11:20', '12:05']);
  assert.deepEqual([rows[2][1].lesson, rows[2][1].time, rows[2][1].endTime], ['PDP/kuchnia', '08:50', '09:35']);
  assert.deepEqual([rows[3][2].lesson, rows[3][2].time, rows[3][2].endTime], ['PDP/praktyki', '09:40', '10:25']);
  assert.deepEqual([rows[4][0].lesson, rows[4][0].time, rows[4][0].endTime], ['Z.k.k', '08:00', '08:45']);
  assert.deepEqual([rows[4][1].lesson, rows[4][1].time, rows[4][1].endTime], ['Z.k.k', '08:50', '09:35']);
  assert.equal(rows[0][0].individual, true);
  assert.equal(rows[2][8].individual, true);
  assert.deepEqual(days, original);
  assert.deepEqual(days.map(okruszekDayEntry), records);
});
