import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSchoolEntry } from '../src/school-import.ts';
import {
  createOkruszekDays, OKRUSZEK_END, OKRUSZEK_PLAN_ID, OKRUSZEK_START,
  okruszekDateStatus, okruszekDayEntry, okruszekDayId, parseOkruszekDay, validateOkruszekDays,
} from '../src/school/okruszek-plan.ts';

test('Okruszek preserves all supplied abbreviations, blank positions, order and whole-day bounds', () => {
  const days = createOkruszekDays('Paweł');
  assert.deepEqual(days.map(day => [day.weekday, day.time, day.endTime, day.lessons]), [
    [1, '07:30', '15:10', ['Rewalidacja', 'Rewalidacja', 'f.os i społ', 'f.os i społ', 'PDP/kuchnia', 'Z.R.Z', 'PDP', 'PDP']],
    [2, '08:50', '16:00', ['-', 'Zaj. k. kreat', 'Zaj. k. kreat', 'religia', 'PDP', 'PDP', 'PDP', 'Z.r.k', 'Z.r.k']],
    [3, '08:50', '16:30', ['-', 'PDP/kuchnia', 'PDP/kuchnia', 'WF', 'WF', 'WF', 'PDP/kuchnia', 'rewalidacja', 'rewalidacja']],
    [4, '08:00', '16:00', ['PDP', 'PDP', 'PDP/praktyki', 'PDP/praktyki', 'PDP/praktyki', 'PDP/praktyki', 'rewalidacja', 'PDP', 'logopedia']],
    [5, '08:00', '16:00', ['Z.k.k', 'Z.k.k', 'PDP/praktyki', 'PDP/praktyki', 'PDP/praktyki', 'PDP/praktyki', 'f.os i społ', 'f.os i społ', 'f.os i społ']],
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

test('stable per-person weekday identities survive reimports and editable content changes', async () => {
  const initial = createOkruszekDays('Paweł');
  const ids = await Promise.all(initial.map(day => okruszekDayId(day.person, day.weekday)));
  initial[0].time = '07:40'; initial[0].lessons.push('Ręczna poprawka'); initial[0].revision++;
  assert.equal(await okruszekDayId(initial[0].person, initial[0].weekday), ids[0]);
  assert.equal(new Set(ids).size, 5);
  assert.notEqual(await okruszekDayId('Inny uczeń', 1), ids[0]);
  await assert.rejects(okruszekDayId('Paweł', 6));
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
