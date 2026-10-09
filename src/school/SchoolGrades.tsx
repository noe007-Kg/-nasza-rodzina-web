import { useMemo, useState } from 'react';
import { Icon, SecondaryButton, StatusPill } from '../ui';
import { SchoolExpandableList } from './SchoolExpandableList';
import { gradeDistribution, groupSchoolGrades, isPeriodGrade, latestPartialGrades, parseGradeMetadata, sortGradesNewest, type SchoolGradeRecord } from './grade-projections';
import { validSchoolDate } from '../school-import';
import './grades.css';

function displayDate(record: SchoolGradeRecord) {
  if (record.date && validSchoolDate(record.date)) {
    const date = new Date(`${record.date}T12:00:00`);
    if (Number.isFinite(date.getTime())) return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return 'Bez daty wystawienia';
}

function GradeRow<T extends SchoolGradeRecord>({ record, onOpen }: { record: T; onOpen: (record: T) => void }) {
  const metadata = parseGradeMetadata(record.note);
  return <button type="button" className="school-entry school-grade-entry" onClick={() => onOpen(record)} data-testid="school-grade-entry" data-grade-id={record.id}>
    <span className="school-grade-value">{record.title || 'Bez oznaczenia'}</span>
    <span className="school-entry-copy"><strong>{record.subject || 'Bez przedmiotu'}</strong><span>{displayDate(record)}{metadata.teacher ? ` · ${metadata.teacher}` : ''}</span>{metadata.weight !== undefined && <small>Waga w dzienniku: {metadata.weight}</small>}{record.source === 'eduvulcan' && <small className="school-source-badge">eduVULCAN · tylko odczyt</small>}</span>
    <span className="school-entry-arrow" aria-hidden="true"><Icon name="chevron-right" /></span>
  </button>;
}

export function SchoolGrades<T extends SchoolGradeRecord>({ records, resetKey, onOpen }: { records: readonly T[]; resetKey: string; onOpen: (record: T) => void }) {
  const subjects = useMemo(() => groupSchoolGrades(records), [records]);
  const partials = useMemo(() => records.filter(record => !isPeriodGrade(record)), [records]);
  const periods = useMemo(() => sortGradesNewest(records.filter(isPeriodGrade)), [records]);
  const distribution = useMemo(() => gradeDistribution(partials), [partials]);
  const [selection, setSelection] = useState<{ key: string; subject: string | null }>({ key: resetKey, subject: null });
  const selected = selection.key === resetKey ? subjects.find(subject => subject.key === selection.subject) : undefined;
  const renderGrade = (record: T) => <GradeRow key={record.id} record={record} onOpen={onOpen} />;

  if (!records.length) return <div className="school-empty-state"><Icon name="grade" /><strong>Nie ma jeszcze ocen.</strong><p>Oceny pojawią się po dodaniu lub synchronizacji.</p></div>;
  if (selected) return <div className="school-grades school-subject-detail" data-testid="school-grade-subject">
    <SecondaryButton icon="chevron-left" onClick={() => setSelection({ key: resetKey, subject: null })}>Wszystkie przedmioty</SecondaryButton>
    <header className="school-grades-heading"><div><span className="school-eyebrow">Przedmiot</span><h3>{selected.subject || 'Bez przedmiotu'}</h3><p>{selected.partial.length} ocen / wyników · {selected.period.length} wpisów okresowych</p></div>{selected.portalAverage !== null && <StatusPill tone="neutral">Średnia z dziennika: {selected.portalAverage}</StatusPill>}</header>
    <SchoolExpandableList key={`${resetKey}:${selected.key}:partial`} items={selected.partial} title="Oceny i wyniki" resetKey={`${resetKey}:${selected.key}:partial`} renderItem={renderGrade} testId="school-subject-grades" />
    <SchoolExpandableList key={`${resetKey}:${selected.key}:period`} items={selected.period} title="Oceny okresowe" resetKey={`${resetKey}:${selected.key}:period`} renderItem={renderGrade} testId="school-subject-periods" />
    {!selected.partial.length && <p className="school-grades-footnote">Dla tego przedmiotu zapisano wyłącznie podsumowania okresowe.</p>}
  </div>;
  return <div className="school-grades" data-testid="school-grades-dashboard">
    <header className="school-grades-heading"><div><span className="school-eyebrow">Postępy w szkole</span><h3>Oceny</h3><p>Prawdziwe wpisy z dziennika i dodane przez rodzinę.</p></div><span className="school-grades-total"><strong>{records.length}</strong><small>{records.length === 1 ? 'wpis' : 'wpisów'}</small></span></header>
    <div className="school-grade-summary"><span><b>{partials.length}</b> Oceny i wyniki</span><span><b>{subjects.filter(subject => subject.subject.trim()).length}</b> Przedmioty</span><span><b>{periods.length}</b> Wpisy okresowe</span></div>
    <section className="school-grade-subjects" aria-labelledby="school-grade-subjects-title"><div className="school-list-section-heading"><h3 id="school-grade-subjects-title">Przedmioty</h3></div><div className="school-grade-subject-grid">{subjects.map((subject, index) => <button key={subject.key} type="button" data-testid="school-grade-subject-card" className={`school-grade-subject-card grade-tone-${index % 4}`} onClick={() => setSelection({ key: resetKey, subject: subject.key })}>
      <span className="school-grade-subject-title"><strong>{subject.subject || 'Bez przedmiotu'}</strong><Icon name="chevron-right" /></span><span className="school-grade-subject-values">{subject.partial.slice(0, 5).map(record => <span key={record.id}>{record.title || 'Bez oznaczenia'}</span>)}</span>
      <span className="school-grade-subject-caption">{subject.partial.length} ocen / wyników{subject.period.length ? ` · ${subject.period.length} okresowych` : ''}</span>{subject.portalAverage !== null && <small>Średnia z dziennika: {subject.portalAverage}</small>}
    </button>)}</div></section>
    {partials.length > 0 && <section className="school-latest-grades" aria-labelledby="school-latest-grades-title"><div className="school-list-section-heading"><h3 id="school-latest-grades-title">Ostatnie oceny</h3><span>5 najnowszych</span></div><div className="school-expandable-items">{latestPartialGrades(partials).map(renderGrade)}</div></section>}
    <SchoolExpandableList key={`${resetKey}:period`} items={periods} title="Oceny okresowe" resetKey={`${resetKey}:period`} renderItem={renderGrade} testId="school-grade-periods" />
    <section className="school-grade-statistics" aria-labelledby="school-grade-statistics-title"><div className="school-list-section-heading"><h3 id="school-grade-statistics-title">Statystyki</h3><span>{partials.length} ocen / wyników</span></div><p>Rozkład zapisanych oznaczeń, bez przeliczania plusów, minusów i wyników opisowych.</p><SchoolExpandableList key={`${resetKey}:distribution`} asList items={distribution} title="Rozkład oznaczeń" resetKey={`${resetKey}:distribution`} className="school-statistics-distribution" testId="school-grade-distribution" renderItem={item => <li key={item.label}><span>{item.label || 'Bez oznaczenia'}</span><strong>{item.count}</strong></li>} /><p className="school-grades-footnote">Średnią pokazujemy tylko wtedy, gdy dziennik podał ją jednoznacznie dla jednego przedmiotu i okresu.</p></section>
  </div>;
}
