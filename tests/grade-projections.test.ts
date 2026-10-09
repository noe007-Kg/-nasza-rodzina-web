import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeDistribution, groupSchoolGrades, isPeriodGrade, latestPartialGrades,
  parseGradeMetadata, sortGradesNewest, type SchoolGradeRecord } from '../src/school/grade-projections.ts';

const hash = 'a'.repeat(64);
function grade(id: string, patch: Partial<SchoolGradeRecord> = {}): SchoolGradeRecord {
  return { id, title: '4+', subject: 'Matematyka', note: '', date: '2026-10-01',
    sourceRecordId: `grade:sha256:${hash}`, sourceProfileId: 'school-profile',
    providerScopeId: 'grades:period-1', source: 'eduvulcan', ...patch };
}
const average = (value: string) => `Średnia podana przez dziennik: ${value}`;

test('only the explicit normalized period identity establishes a period assessment', () => {
  assert.equal(isPeriodGrade(grade('period', { sourceRecordId: `grade-period:sha256:${hash}` })), true);
  assert.equal(isPeriodGrade(grade('partial')), false);
  assert.equal(isPeriodGrade(grade('legacy', { sourceRecordId: undefined, title: 'Ocena okresowa: 5' })), false);
  assert.equal(isPeriodGrade(grade('summary-note', { note: 'Ocena okresowa: 5' })), false);
  assert.equal(isPeriodGrade(grade('wrong-prefix', { sourceRecordId: `grade-period:${hash}` })), false);
  assert.equal(isPeriodGrade(grade('wrong-case', { sourceRecordId: `GRADE-PERIOD:sha256:${hash}` })), false);
  assert.equal(isPeriodGrade(grade('incomplete', { sourceRecordId: 'grade-period:sha256:' })), false);
});

test('a period-shaped identifier without the eduVULCAN source is not a trusted period assessment', () => {
  for (const source of [undefined, 'manual', 'fryderyk']) {
    assert.equal(isPeriodGrade(grade('untrusted-period', { source, sourceRecordId: `grade-period:sha256:${hash}` })), false);
  }
});

test('the school date wins over a later import or technical synchronization timestamp', () => {
  const older = grade('older', { date: '2026-10-01', createdAt: new Date('2026-10-07'),
    updatedAt: new Date('2027-01-01'), syncedAt: new Date('2027-02-01') });
  const newer = grade('newer', { date: '2026-10-02', createdAt: new Date('2026-10-03') });
  assert.deepEqual(sortGradesNewest([older, newer]).map((entry) => entry.id), ['newer', 'older']);
});

test('same-day grades use creation time then the stable ID as tie-breakers', () => {
  const rows = [grade('c', { createdAt: new Date('2030-01-01'), updatedAt: new Date('2035-01-01') }),
    grade('a', { createdAt: new Date('2020-01-01'), syncedAt: new Date('2040-01-01') }),
    grade('b', { createdAt: new Date('2030-01-01') })];
  assert.deepEqual(sortGradesNewest(rows).map((entry) => entry.id), ['b', 'c', 'a']);
  assert.deepEqual(rows.map((entry) => entry.id), ['c', 'a', 'b']);
});

test('only missing or genuinely invalid school dates sort by creation time within the undated section', () => {
  const rows = [grade('dated', { date: '2026-02-28' }),
    grade('invalid', { date: '2026-02-30', createdAt: new Date('2026-03-01') }),
    grade('missing', { date: '', createdAt: new Date('2026-03-02') }),
    grade('unknown', { date: 'not-a-date', createdAt: new Date('invalid') })];
  assert.deepEqual(sortGradesNewest(rows).map((entry) => entry.id), ['dated', 'missing', 'invalid', 'unknown']);
});

test('an old dated grade precedes a recent import without a real grade date', () => {
  const rows = [grade('imported-undated', { date: '', createdAt: new Date('2027-01-01') }),
    grade('old-dated', { date: '2020-01-01', createdAt: new Date('2020-01-02') }),
    grade('imported-invalid', { date: '2027-02-30', createdAt: new Date('2027-03-01') })];
  assert.deepEqual(sortGradesNewest(rows).map((entry) => entry.id), ['old-dated', 'imported-invalid', 'imported-undated']);
});

test('technical updates never alter same-day or undated creation-time ordering', () => {
  const rows = [grade('dated-earlier', { date: '2020-01-01', createdAt: new Date('2020-01-02') }),
    grade('dated-later', { date: '2020-01-01', createdAt: new Date('2020-01-03') }),
    grade('undated-earlier', { date: '', createdAt: new Date('2027-01-01') }),
    grade('undated-later', { date: 'invalid', createdAt: new Date('2027-01-02') })];
  const expected = ['dated-later', 'dated-earlier', 'undated-later', 'undated-earlier'];
  assert.deepEqual(sortGradesNewest(rows).map((entry) => entry.id), expected);
  const technicalUpdates = rows.map((row, index) => ({ ...row,
    updatedAt: new Date(`2040-01-0${4 - index}`), syncedAt: new Date(`2050-01-0${4 - index}`) }));
  assert.deepEqual(sortGradesNewest(technicalUpdates).map((entry) => entry.id), expected);
});

test('literal metadata preserves zero weight and does not infer values from prose', () => {
  const metadata = parseGradeMetadata('Sprawdzian · Ułamki\nNauczyciel: Anna\nWaga w dzienniku: 0\n'
    + 'Średnia podana przez dziennik: 4,50\nOcena opisowa\nKomentarz: Duży postęp');
  assert.equal(metadata.teacher, 'Anna');
  assert.equal(metadata.weight, '0');
  assert.equal(metadata.portalAverage, '4,50');
  assert.equal(metadata.descriptive, true);
  assert.deepEqual(metadata.detailLines, ['Sprawdzian · Ułamki', 'Komentarz: Duży postęp']);
  const prose = parseGradeMetadata('Komentarz: Nauczyciel: Anna\nwaga w dzienniku: 3\nŚrednia klasy: 4.5');
  assert.equal(prose.teacher, undefined);
  assert.equal(prose.weight, undefined);
  assert.equal(prose.portalAverage, undefined);
});

test('identical source averages with different decimal notation remain unambiguous', () => {
  assert.equal(parseGradeMetadata(`${average('4.50')}\n${average('4,5')}`).portalAverage, '4.50');
});

test('contradictory or malformed source averages are not presented as a mean', () => {
  assert.equal(parseGradeMetadata(`${average('4.5')}\n${average('4.7')}`).portalAverage, undefined);
  assert.equal(parseGradeMetadata(`${average('4.5')}\n${average('brak')}`).portalAverage, undefined);
  assert.equal(parseGradeMetadata(average('4.5 punktów')).portalAverage, undefined);
  assert.equal(parseGradeMetadata(average('')).portalAverage, undefined);
});

test('a single exact context can expose its repeated source-provided average', () => {
  const [subject] = groupSchoolGrades([grade('one', { note: average('4.5') }),
    grade('two', { note: average('4.50') }),
    grade('period', { sourceRecordId: `grade-period:sha256:${hash}`, title: 'Ocena okresowa: 5', note: average('4.5') })]);
  assert.equal(subject.portalAverage, '4.5');
  assert.equal(subject.contexts.length, 1);
  assert.equal(subject.contexts[0].portalAverage, '4.5');
  assert.equal(subject.partial.length, 2);
  assert.equal(subject.period.length, 1);
});

test('conflicting averages across records suppress the entire context average', () => {
  const [subject] = groupSchoolGrades([grade('one', { note: average('4.5') }), grade('two', { note: average('4.8') })]);
  assert.equal(subject.portalAverage, null);
  assert.equal(subject.contexts[0].portalAverage, null);
});

test('a literal average prefix in a period-only note is not portal-average evidence', () => {
  const [subject] = groupSchoolGrades([grade('period-only', {
    sourceRecordId: `grade-period:sha256:${hash}`, title: 'Podsumowanie ocen: 5',
    note: `Podsumowanie ocen: 5\n${average('8')}`,
  })]);
  assert.equal(subject.period.length, 1);
  assert.equal(subject.partial.length, 0);
  assert.equal(subject.portalAverage, null);
  assert.equal(subject.contexts[0].portalAverage, null);
});

test('long raw grade descriptions cannot supply a portal average even with a metadata-shaped note', () => {
  for (const length of [500, 700]) {
    const [subject] = groupSchoolGrades([grade('long-description', {
      title: 'A'.repeat(length), note: `Treść oceny opisowej\n${average('8')}`,
    })]);
    assert.equal(subject.partial.length, 1);
    assert.equal(subject.portalAverage, null);
    assert.equal(subject.contexts[0].portalAverage, null);
  }
  assert.equal(groupSchoolGrades([grade('short-source-value', { title: 'A'.repeat(499), note: average('4.5') })])[0].portalAverage, '4.5');
});

test('a valid short partial average is not contradicted by arbitrary text in a period summary', () => {
  const [subject] = groupSchoolGrades([grade('official-partial', { note: average('4.5') }),
    grade('raw-period', { sourceRecordId: `grade-period:sha256:${hash}`, title: 'Podsumowanie ocen: 5',
      note: `Podsumowanie ocen: 5\n${average('8')}` })]);
  assert.equal(subject.portalAverage, '4.5');
  assert.equal(subject.contexts[0].portalAverage, '4.5');
  assert.equal(subject.period.length, 1);
});

test('manual, missing-source and noncanonical partial identities cannot establish a portal average', () => {
  for (const patch of [{ source: undefined }, { source: 'manual' }, { source: 'fryderyk' },
    { sourceRecordId: undefined }, { sourceRecordId: `grade:${hash}` }, { sourceRecordId: 'grade:sha256:invalid' }]) {
    const [subject] = groupSchoolGrades([grade('untrusted-average', { ...patch, note: average('4.5') })]);
    assert.equal(subject.portalAverage, null);
    assert.equal(subject.contexts[0].portalAverage, null);
  }
});

test('distinct periods are exposed separately and never aggregated even with matching averages', () => {
  const [subject] = groupSchoolGrades([grade('period-one', { note: average('4.5') }),
    grade('period-two', { providerScopeId: 'grades:period-2', note: average('4.5') })]);
  assert.equal(subject.portalAverage, null);
  assert.equal(subject.contexts.length, 2);
  assert.deepEqual(subject.contexts.map((context) => context.portalAverage), ['4.5', '4.5']);
});

test('different school profiles with the same subject cannot share a displayed average', () => {
  const [subject] = groupSchoolGrades([grade('school-one', { note: average('4.5') }),
    grade('school-two', { sourceProfileId: 'second-school-profile', note: average('5.0') })]);
  assert.equal(subject.portalAverage, null);
  assert.equal(subject.contexts.length, 2);
  assert.deepEqual(subject.contexts.map((context) => context.portalAverage), ['4.5', '5.0']);
});

test('missing provenance does not qualify for a subject-wide portal average', () => {
  for (const patch of [{ sourceProfileId: undefined }, { providerScopeId: undefined }, { sourceProfileId: '' }]) {
    const [subject] = groupSchoolGrades([grade('legacy', { ...patch, note: average('4.5') })]);
    assert.equal(subject.portalAverage, null);
    assert.equal(subject.contexts[0].portalAverage, null);
  }
});

test('a blank subject cannot qualify for a source-provided subject average', () => {
  for (const subjectName of ['', ' \t ']) {
    const [subject] = groupSchoolGrades([grade('blank-subject', { subject: subjectName, note: average('4.5') })]);
    assert.equal(subject.subject, subjectName);
    assert.equal(subject.portalAverage, null);
    assert.equal(subject.contexts[0].portalAverage, null);
  }
});

test('only an explicit grades period scope can qualify for a source-provided average', () => {
  for (const providerScopeId of ['lessons:period-1', 'grades', 'grades:', 'grades:   ', 'prefixgrades:period-1']) {
    const [subject] = groupSchoolGrades([grade('wrong-scope', { providerScopeId, note: average('4.5') })]);
    assert.equal(subject.portalAverage, null);
    assert.equal(subject.contexts[0].portalAverage, null);
    assert.equal(subject.contexts[0].providerScopeId, providerScopeId);
  }
  assert.equal(groupSchoolGrades([grade('valid-scope', { providerScopeId: 'grades:period-1', note: average('4.5') })])[0].portalAverage, '4.5');
});

test('period titles and partial values cannot manufacture an average', () => {
  const [subject] = groupSchoolGrades([grade('one', { title: '6', note: 'Waga w dzienniku: 3' }),
    grade('two', { title: '2', note: 'Waga w dzienniku: 1' }),
    grade('period', { sourceRecordId: `grade-period:sha256:${hash}`, title: 'Podsumowanie ocen: 4.5', note: '' })]);
  assert.equal(subject.portalAverage, null);
  assert.equal(subject.contexts[0].portalAverage, null);
});

test('distribution counts original textual grades without plus/minus, points or descriptive conversions', () => {
  const distribution = gradeDistribution([grade('a', { title: '4+' }), grade('b', { title: '4+' }),
    grade('c', { title: '4' }), grade('d', { title: '5-' }), grade('e', { title: '8/10 pkt' }),
    grade('f', { title: 'Samodzielnie wykonuje zadania' }), grade('empty', { title: '' }),
    grade('period', { sourceRecordId: `grade-period:sha256:${hash}`, title: 'Ocena okresowa: 5' })]);
  assert.deepEqual(Object.fromEntries(distribution.map(({ label, count }) => [label, count])),
    { '4+': 2, '4': 1, '5-': 1, '8/10 pkt': 1, 'Samodzielnie wykonuje zadania': 1 });
});

test('statistics count the complete list beyond one hundred records without fabricating a mean', () => {
  const rawLabels = ['4+', '4', '5-', '8/10 pkt', 'Samodzielnie wykonuje zadania'];
  const rows = Array.from({ length: 125 }, (_, index) => grade(`partial-${index}`, {
    title: rawLabels[index % rawLabels.length], note: `Waga w dzienniku: ${index % 4}`,
  }));
  rows.push(grade('period-summary', { sourceRecordId: `grade-period:sha256:${hash}`, title: 'Podsumowanie ocen: 4.5' }));
  const [subject] = groupSchoolGrades(rows);
  assert.equal(subject.partial.length, 125);
  assert.equal(subject.period.length, 1);
  assert.equal(subject.distribution.reduce((total, entry) => total + entry.count, 0), 125);
  assert.deepEqual(Object.fromEntries(subject.distribution.map(({ label, count }) => [label, count])),
    Object.fromEntries(rawLabels.map((label) => [label, 25])));
  assert.equal(subject.portalAverage, null);
  assert.equal(subject.contexts[0].portalAverage, null);
  assert.equal(latestPartialGrades(rows).length, 5);
});

test('latest partial grades default to five and exclude explicit period summaries', () => {
  const rows = Array.from({ length: 7 }, (_, index) => grade(`grade-${index + 1}`, { date: `2026-10-0${index + 1}` }));
  rows.push(grade('period', { date: '2026-10-09', sourceRecordId: `grade-period:sha256:${hash}` }));
  assert.deepEqual(latestPartialGrades(rows).map((entry) => entry.id), ['grade-7', 'grade-6', 'grade-5', 'grade-4', 'grade-3']);
  assert.equal(latestPartialGrades(rows, 2).length, 2);
  assert.equal(latestPartialGrades(rows, 0).length, 0);
  assert.equal(rows.length, 8);
});

test('subject identity stays exact and technical metadata cannot change any projection', () => {
  const rows = [grade('a', { title: '4+', note: average('4.5'), date: '2026-10-01' }),
    grade('b', { title: '5', note: average('4.5'), date: '2026-10-02' }),
    grade('c', { subject: 'Język polski', note: '' })];
  const first = groupSchoolGrades(rows);
  const second = groupSchoolGrades(rows.map((row) => ({ ...row, syncedAt: new Date('2030-01-01'), updatedAt: new Date('2031-01-01') })));
  assert.deepEqual(second.map(({ key, subject, partial, period, portalAverage, distribution }) =>
    ({ key, subject, partial: partial.map((row) => row.id), period: period.map((row) => row.id), portalAverage, distribution })),
  first.map(({ key, subject, partial, period, portalAverage, distribution }) =>
    ({ key, subject, partial: partial.map((row) => row.id), period: period.map((row) => row.id), portalAverage, distribution })));
  assert.equal(groupSchoolGrades([grade('one'), grade('two', { subject: 'matematyka' })]).length, 2);
});

test('empty inputs have no fabricated grades, groups, statistics or latest records', () => {
  assert.deepEqual(groupSchoolGrades([]), []);
  assert.deepEqual(gradeDistribution([]), []);
  assert.deepEqual(latestPartialGrades([]), []);
  assert.deepEqual(sortGradesNewest([]), []);
});
