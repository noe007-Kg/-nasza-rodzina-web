/** Read-only projections of the values already returned by the school source. */
export interface SchoolGradeRecord {
  id: string;
  title: string;
  subject: string;
  note: string;
  date?: string;
  createdAt?: Date;
  sourceRecordId?: string;
  sourceProfileId?: string;
  providerScopeId?: string;
  source?: string;
  updatedAt?: Date;
  syncedAt?: Date;
}

export interface GradeMetadata {
  teacher?: string;
  /** The literal source value, including the meaningful weight "0". */
  weight?: string;
  /** A source-provided number as text; never a locally calculated mean. */
  portalAverage?: string;
  descriptive: boolean;
  detailLines: string[];
}

export interface GradeDistributionEntry { label: string; count: number }

const POLISH_CARDINAL = new Intl.PluralRules('pl');

/** Distribution size is the number of distinct literal marks, not grade rows. */
export function gradeDistributionCountLabel(count: number): string {
  const category = POLISH_CARDINAL.select(count);
  const label = category === 'one' ? 'rodzaj' : category === 'few' ? 'rodzaje' : 'rodzajów';
  return `${count} ${label} oznaczeń`;
}

export interface SchoolGradeContext<T extends SchoolGradeRecord = SchoolGradeRecord> {
  key: string;
  subject: string;
  sourceProfileId: string | null;
  providerScopeId: string | null;
  partial: T[];
  period: T[];
  portalAverage: string | null;
}

export interface SchoolGradeSubject<T extends SchoolGradeRecord = SchoolGradeRecord> {
  key: string;
  subject: string;
  partial: T[];
  period: T[];
  portalAverage: string | null;
  contexts: SchoolGradeContext<T>[];
  distribution: GradeDistributionEntry[];
}

const TEACHER_LABEL = 'Nauczyciel:';
const WEIGHT_LABEL = 'Waga w dzienniku:';
const AVERAGE_LABEL = 'Średnia podana przez dziennik:';

/** Titles and free-form notes cannot establish that a record is periodic. */
export function isPeriodGrade(record: SchoolGradeRecord): boolean {
  return record.source === 'eduvulcan' && /^grade-period:sha256:[a-f0-9]{64}$/.test(record.sourceRecordId ?? '');
}

function noteLines(note: string): string[] {
  return note.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function uniqueLiteral(lines: readonly string[], label: string): string | undefined {
  const values = [...new Set(lines.filter((line) => line.startsWith(label))
    .map((line) => line.slice(label.length).trim()).filter(Boolean))];
  return values.length === 1 ? values[0] : undefined;
}

type AverageEvidence = { value: number; raw: string };

function averageEvidence(lines: readonly string[]): { values: AverageEvidence[]; invalid: boolean } {
  const values: AverageEvidence[] = [];
  let invalid = false;
  for (const line of lines) {
    if (!line.startsWith(AVERAGE_LABEL)) continue;
    const raw = line.slice(AVERAGE_LABEL.length).trim();
    if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(raw)) {
      invalid = true;
      continue;
    }
    const value = Number(raw.replace(',', '.'));
    if (!Number.isFinite(value)) invalid = true;
    else values.push({ value, raw });
  }
  return { values, invalid };
}

function unambiguousAverage(lines: readonly string[]): string | null {
  const evidence = averageEvidence(lines);
  if (evidence.invalid || evidence.values.length === 0) return null;
  const first = evidence.values[0];
  return evidence.values.every((entry) => entry.value === first.value) ? first.raw : null;
}

export function parseGradeMetadata(note: string): GradeMetadata {
  const lines = noteLines(note);
  const portalAverage = unambiguousAverage(lines);
  return {
    teacher: uniqueLiteral(lines, TEACHER_LABEL),
    weight: uniqueLiteral(lines, WEIGHT_LABEL),
    portalAverage: portalAverage ?? undefined,
    descriptive: lines.includes('Ocena opisowa'),
    detailLines: lines.filter((line) => !line.startsWith(TEACHER_LABEL)
      && !line.startsWith(WEIGHT_LABEL) && !line.startsWith(AVERAGE_LABEL)
      && line !== 'Ocena opisowa'),
  };
}

/** Normalized school dates are calendar dates, not a synchronization timestamp. */
function schoolDateTime(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime();
}

function creationTime(record: SchoolGradeRecord): number {
  const created = record.createdAt?.getTime();
  return created !== undefined && Number.isFinite(created) ? created : Number.NEGATIVE_INFINITY;
}

/** Dated grades first; creation time only breaks same-day or undated ties. */
export function sortGradesNewest<T extends SchoolGradeRecord>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => {
    const leftDate = schoolDateTime(left.date);
    const rightDate = schoolDateTime(right.date);
    if (leftDate !== null && rightDate === null) return -1;
    if (leftDate === null && rightDate !== null) return 1;
    if (leftDate !== null && rightDate !== null && leftDate !== rightDate) return leftDate > rightDate ? -1 : 1;
    const leftCreated = creationTime(left);
    const rightCreated = creationTime(right);
    if (leftCreated !== rightCreated) return leftCreated > rightCreated ? -1 : 1;
    return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
  });
}

export function latestPartialGrades<T extends SchoolGradeRecord>(records: readonly T[], limit = 5): T[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
  return sortGradesNewest(records.filter((record) => !isPeriodGrade(record))).slice(0, safeLimit);
}

/** Textual values stay distinct: "4+", "4", points and descriptive grades. */
export function gradeDistribution(records: readonly SchoolGradeRecord[]): GradeDistributionEntry[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (isPeriodGrade(record)) continue;
    const label = record.title.trim();
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count }))
    .sort((left, right) => left.label.localeCompare(right.label, 'pl'));
}

function sourceIdentity(value: string | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Missing provenance is insufficient to display a subject-wide source average. */
function contextAverage(records: readonly SchoolGradeRecord[], subject: string, profile: string | null, scope: string | null): string | null {
  if (!subject.trim() || profile === null || !profile.trim() || scope === null
    || !/^grades:.+$/.test(scope) || !scope.slice('grades:'.length).trim()) return null;
  // Period summaries and long descriptions can contain literal user-authored
  // lines that resemble metadata. Only the normalized short partial-grade
  // representation reliably supplies a portal-average metadata line.
  const evidenceRecords = records.filter((record) => record.source === 'eduvulcan'
    && /^grade:sha256:[a-f0-9]{64}$/.test(record.sourceRecordId ?? '') && record.title.length < 500);
  return unambiguousAverage(evidenceRecords.flatMap((record) => noteLines(record.note)));
}

export function groupSchoolGrades<T extends SchoolGradeRecord>(records: readonly T[]): SchoolGradeSubject<T>[] {
  const subjects = new Map<string, T[]>();
  for (const record of records) {
    const current = subjects.get(record.subject) ?? [];
    current.push(record);
    subjects.set(record.subject, current);
  }
  return [...subjects].map(([subject, subjectRecords]) => {
    const sorted = sortGradesNewest(subjectRecords);
    const contextsByKey = new Map<string, SchoolGradeContext<T>>();
    for (const record of sorted) {
      const sourceProfileId = sourceIdentity(record.sourceProfileId);
      const providerScopeId = sourceIdentity(record.providerScopeId);
      const key = JSON.stringify([subject, sourceProfileId, providerScopeId]);
      let context = contextsByKey.get(key);
      if (!context) {
        context = { key, subject, sourceProfileId, providerScopeId, partial: [], period: [], portalAverage: null };
        contextsByKey.set(key, context);
      }
      (isPeriodGrade(record) ? context.period : context.partial).push(record);
    }
    const contexts = [...contextsByKey.values()].map((context) => ({
      ...context,
      portalAverage: contextAverage([...context.partial, ...context.period], subject, context.sourceProfileId, context.providerScopeId),
    }));
    return {
      key: JSON.stringify([subject]), subject,
      partial: sorted.filter((record) => !isPeriodGrade(record)),
      period: sorted.filter(isPeriodGrade),
      portalAverage: contexts.length === 1 ? contexts[0].portalAverage : null,
      contexts,
      distribution: gradeDistribution(sorted),
    };
  }).sort((left, right) => left.subject.localeCompare(right.subject, 'pl'));
}
