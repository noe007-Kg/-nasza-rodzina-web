import { validSchoolDate, validateSchoolEntry, type SchoolEntry } from '../school-import';

export const OKRUSZEK_PLAN_ID = 'okruszek-2026-2027';
export const OKRUSZEK_START = '2026-10-12';
export const OKRUSZEK_END = '2027-06-30';
export const OKRUSZEK_WEEKDAYS = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek'] as const;
export const OKRUSZEK_HOLIDAY_SOURCES = [
  { title: 'Okruszek — dni wolne', url: 'https://soswokruszek.pl/dni-wolne.html' },
  { title: 'MEN — kalendarz 2026/2027', url: 'https://www.gov.pl/web/edukacja/ministerstwo-edukacji-narodowej-oglosilo-kalendarz-roku-szkolnego-20262027' },
] as const;

export type OkruszekDay = {
  id?: string; person: string; ownerProfileId?: string; weekday: number; time: string; endTime: string;
  lessons: string[]; periodStart: string; periodEnd: string; extraDaysOff: string[]; revision: number;
};

/** Published by Okruszek; these are bell slots, not inferred 45-minute lessons. */
export const OKRUSZEK_BELL_SOURCE = 'https://soswokruszek.pl/godziny-zaj---i-przerw-obiadowych.html';
export const OKRUSZEK_BELL_SCHEDULE = [
  { time: '08:00', endTime: '08:45' },
  { time: '08:50', endTime: '09:35' },
  { time: '09:40', endTime: '10:25' },
  { time: '10:30', endTime: '11:15' },
  { time: '11:20', endTime: '12:05' },
  { time: '12:10', endTime: '12:55' },
  { time: '13:35', endTime: '14:20' },
  { time: '14:25', endTime: '15:10' },
  { time: '15:15', endTime: '16:00' },
] as const;

export type OkruszekLessonRow = {
  position: number; lesson: string; empty: boolean; individual: boolean; time: string | null; endTime: string | null;
};

// User-supplied whole-day bounds. There are no inferred lesson start/end times.
const suppliedDays = [
  { time: '07:30', endTime: '15:10', lessons: ['Rewalidacja', 'Rewalidacja', 'f.os i społ', 'f.os i społ', 'PDP/ kuchnia', 'Z.R.Z', 'PDP', 'PDP'] },
  { time: '08:50', endTime: '16:00', lessons: ['—', 'Zaj. k. kreat', 'Zaj. k. kreat', 'religia', 'PDP', 'PDP', 'PDP', 'Z.r.k', 'Z.r.k'] },
  { time: '08:50', endTime: '16:30', lessons: ['—', 'PDP/ kuchnia', 'PDP/ kuchnia', 'WF', 'WF', 'WF', 'PDP/ kuchnia', 'rewalidacja', 'rewalidacja'] },
  { time: '08:00', endTime: '16:00', lessons: ['PDP', 'PDP', 'PDP/ praktyki', 'PDP/ praktyki', 'PDP/ praktyki', 'PDP/ praktyki', 'rewalidacja', 'PDP', 'logopedia'] },
  { time: '08:00', endTime: '16:00', lessons: ['Z.k.k.', 'Z.k.k.', 'PDP/ praktyki', 'PDP/ praktyki', 'PDP/ praktyki', 'PDP/ praktyki', 'f.os i społ', 'f.os i społ', 'f.os i społ'] },
];

/** Old saved plans get the published hours without a migration or another import.
 * Blank slots retain their number. Edited/shifted rows and out-of-stay hours are
 * explicitly unknown; neither the parent's edits nor whole-day bounds change.
 */
export function okruszekLessonRows(day: OkruszekDay): OkruszekLessonRow[] {
  const original = suppliedDays[day.weekday - 1]?.lessons;
  // Keep older saved abbreviations readable; do not rewrite the parent's text.
  const sameAbbreviation = (text: string) => text.trim().replace(/\s*\/\s*/g, '/').replace(/\.$/, '');
  return day.lessons.map((lesson, index) => {
    const empty = /^[-—]$/.test(lesson.trim());
    const originalLesson = original?.[index];
    const unchangedPosition = !!originalLesson && (sameAbbreviation(lesson) === sameAbbreviation(originalLesson) || empty && originalLesson === '—');
    const bell = OKRUSZEK_BELL_SCHEDULE[index];
    // The photo gives whole-stay bounds, not the individual revalidation times.
    // The parent confirmed additional classes outside the published bell table.
    const individual = !empty && unchangedPosition && /rewalidacja/i.test(lesson)
      && (day.weekday === 1 && index === 0 && day.time < '08:00'
        || day.weekday === 3 && index === 8 && day.endTime > '16:00');
    const known = !empty && !individual && unchangedPosition && bell && bell.time >= day.time && bell.endTime <= day.endTime;
    return { position: index + 1, lesson, empty, individual, time: known ? bell.time : null, endTime: known ? bell.endTime : null };
  });
}

export function okruszekBreakAfter(rows: readonly OkruszekLessonRow[], index: number): string | null {
  const row = rows[index], next = rows[index + 1];
  if (!row?.endTime || !next?.time) return null;
  return row.endTime === '12:55' && next.time === '13:35'
    ? 'Przerwa obiadowa 12:55–13:35 · tury: 12:55–13:15 i 13:15–13:35; tura Pawła niepotwierdzona'
    : `Przerwa ${row.endTime}–${next.time}`;
}

/** A school's bell table does not identify individual activities outside it. */
export function okruszekOutsideBellHours(day: OkruszekDay): string[] {
  const intervals: string[] = [];
  if (day.time < '08:00') intervals.push(`${day.time}–08:00`);
  if (day.endTime > '16:00') intervals.push(`16:00–${day.endTime}`);
  return intervals.map(interval => `${interval} — czas poza siatką dzwonków; pełne godziny zajęć indywidualnych do potwierdzenia`);
}

export function okruszekLessonDetails(day: OkruszekDay): string[] {
  const rows = okruszekLessonRows(day);
  return [...rows.flatMap((row, index) => {
    const lesson = row.empty ? `${row.position}. — (pusta pozycja; nie jest zajęciem)`
      : `${row.position}. ${row.time && row.endTime ? `${row.time}–${row.endTime}` : row.individual ? 'Godziny indywidualne — do potwierdzenia' : 'Godziny niepotwierdzone'} — ${row.lesson}`;
    const pause = okruszekBreakAfter(rows, index);
    return pause ? [lesson, pause] : [lesson];
  }), ...okruszekOutsideBellHours(day)];
}

export const OKRUSZEK_DAYS_OFF = [
  { start: '2026-10-14', end: '2026-10-14', reason: 'Dzień bez zajęć dydaktycznych; dostępność opieki według informacji szkoły.' },
  { start: '2026-11-11', end: '2026-11-11', reason: 'Narodowe Święto Niepodległości.' },
  { start: '2026-12-23', end: '2026-12-31', reason: 'Zimowa przerwa świąteczna.' },
  { start: '2027-01-01', end: '2027-01-01', reason: 'Nowy Rok.' },
  { start: '2027-01-04', end: '2027-01-05', reason: 'Dni dyrektorskie — zajęcia opiekuńczo-wychowawcze w świetlicy, bez zwykłego planu lekcji.' },
  { start: '2027-01-06', end: '2027-01-06', reason: 'Święto Trzech Króli.' },
  { start: '2027-02-15', end: '2027-02-28', reason: 'Ferie zimowe — województwo zachodniopomorskie.' },
  { start: '2027-03-25', end: '2027-03-30', reason: 'Wiosenna przerwa świąteczna.' },
  { start: '2027-05-03', end: '2027-05-03', reason: 'Święto Narodowe Trzeciego Maja.' },
  { start: '2027-05-04', end: '2027-05-04', reason: 'Dzień dyrektorski — świetlica, bez zwykłego planu lekcji.' },
  { start: '2027-05-27', end: '2027-05-27', reason: 'Boże Ciało.' },
  { start: '2027-05-28', end: '2027-05-28', reason: 'Dzień dyrektorski — świetlica, bez zwykłego planu lekcji.' },
  { start: '2027-06-26', end: '2027-06-30', reason: 'Wakacje — zwykły plan lekcji nie obowiązuje.' },
] as const;

export function createOkruszekDays(person: string, ownerProfileId?: string): OkruszekDay[] {
  return suppliedDays.map((day, index) => ({ ...day, person, ...(ownerProfileId ? { ownerProfileId } : {}), weekday: index + 1, lessons: [...day.lessons],
    periodStart: OKRUSZEK_START, periodEnd: OKRUSZEK_END, extraDaysOff: [], revision: 0 }));
}

export function validateOkruszekDays(days: readonly OkruszekDay[]): OkruszekDay[] {
  if (days.length !== 5 || days.some(day => !day) || new Set(days.map(day => day.weekday)).size !== 5) throw new Error('Plan wymaga pięciu różnych dni od poniedziałku do piątku.');
  const first = days[0];
  for (const day of days) {
    if (!day || typeof day.person !== 'string' || day.person !== first.person || !day.person
      || !Number.isInteger(day.weekday) || day.weekday < 1 || day.weekday > 5
      || (day.ownerProfileId !== undefined && (typeof day.ownerProfileId !== 'string' || !day.ownerProfileId || day.ownerProfileId.startsWith('legacy:')))
      || day.ownerProfileId !== first.ownerProfileId
      || typeof day.time !== 'string' || !day.time || typeof day.endTime !== 'string' || !day.endTime
      || !validSchoolDate(day.periodStart) || !validSchoolDate(day.periodEnd) || day.periodEnd < day.periodStart
      || day.periodStart !== first.periodStart || day.periodEnd !== first.periodEnd
      || !Array.isArray(day.lessons) || !day.lessons.length || day.lessons.length > 30
      || day.lessons.some(lesson => typeof lesson !== 'string' || !lesson.trim() || lesson.length > 120)
      || !Array.isArray(day.extraDaysOff) || day.extraDaysOff.length > 100 || day.extraDaysOff.some(date => !validSchoolDate(date))
      || !Number.isInteger(day.revision) || day.revision < 0) throw new Error('Sprawdź godziny, okres i listę zajęć planu Okruszka.');
    validateSchoolEntry({ person: day.person, type: 'message', title: 'Okruszek — plan całego dnia', subject: 'Plan dnia',
      date: '', weekday: 0, time: day.time, endTime: day.endTime, note: day.lessons.join('; ') }, [day.person]);
  }
  return days.map(day => ({ ...day, lessons: [...day.lessons], extraDaysOff: [...new Set(day.extraDaysOff)].sort() })).sort((a, b) => a.weekday - b.weekday);
}

export function okruszekDayEntry(day: OkruszekDay): SchoolEntry & {
  schoolPlanId: string; schoolName: string; schoolPlanRevision: number; ownerProfileId?: string;
  manualDayPlan: { weekday: number; periodStart: string; periodEnd: string; lessons: string[]; extraDaysOff: string[];
    wholeDay: true; holidayCalendar: string; confirmedDaysOff: typeof OKRUSZEK_DAYS_OFF[number][] };
} {
  // Keep one weekly source, not unconditional recurring lesson copies. The calendar
  // projects bounded dates from these records after checking profile and holidays.
  const entry = validateSchoolEntry({ person: day.person, type: 'message', title: `Okruszek — ${OKRUSZEK_WEEKDAYS[day.weekday - 1]}`,
    subject: 'Plan całego dnia', date: '', weekday: 0, time: day.time, endTime: day.endTime,
    note: day.lessons.join('; ') }, [day.person]);
  return { ...entry, schoolPlanId: OKRUSZEK_PLAN_ID, schoolName: 'Okruszek, Kołobrzeg', schoolPlanRevision: day.revision,
    ...(day.ownerProfileId !== undefined ? { ownerProfileId: day.ownerProfileId } : {}),
    manualDayPlan: { weekday: day.weekday, periodStart: day.periodStart, periodEnd: day.periodEnd, lessons: [...day.lessons],
      extraDaysOff: [...day.extraDaysOff], wholeDay: true, holidayCalendar: OKRUSZEK_PLAN_ID,
      confirmedDaysOff: OKRUSZEK_DAYS_OFF.map(range => ({ ...range })) } };
}

export function parseOkruszekDay(id: string, data: Record<string, unknown>): OkruszekDay | null {
  if (data.schoolPlanId !== OKRUSZEK_PLAN_ID || data.type !== 'message' || data.date !== '' || data.weekday !== 0
    || ['source', 'provider', 'sourceRecordId', 'sourceProfileId', 'providerScopeId'].some(key => Object.hasOwn(data, key))
    || typeof data.manualDayPlan !== 'object' || !data.manualDayPlan || Array.isArray(data.manualDayPlan)) return null;
  const details = data.manualDayPlan as Record<string, unknown>;
  if (details.wholeDay !== true || details.holidayCalendar !== OKRUSZEK_PLAN_ID
    || typeof details.weekday !== 'number' || !Number.isInteger(details.weekday) || details.weekday < 1 || details.weekday > 5) return null;
  const day = { id, person: data.person, weekday: details.weekday, time: data.time, endTime: data.endTime,
    ...(Object.hasOwn(data, 'ownerProfileId') ? { ownerProfileId: data.ownerProfileId } : {}),
    lessons: details.lessons, periodStart: details.periodStart, periodEnd: details.periodEnd,
    extraDaysOff: details.extraDaysOff, revision: data.schoolPlanRevision ?? 0 } as OkruszekDay;
  try {
    const rows = createOkruszekDays(day.person, day.ownerProfileId).map(value => ({ ...value, periodStart: day.periodStart, periodEnd: day.periodEnd,
      ...(value.weekday === day.weekday ? day : {}) }));
    validateOkruszekDays(rows);
    return day;
  } catch { return null; }
}

/** New identities use the real student profile ID, not the parent's UID or editable name. */
export async function okruszekDayId(ownerIdentity: string, weekday: number): Promise<string> {
  if (!ownerIdentity || !Number.isInteger(weekday) || weekday < 1 || weekday > 5) throw new Error('Nieprawidłowa osoba lub dzień planu.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([OKRUSZEK_PLAN_ID, ownerIdentity, weekday])));
  return `school_plan_${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function okruszekDateStatus(date: string, day?: OkruszekDay): { kind: 'planned' | 'day-off' | 'outside-period' | 'unconfirmed'; reason: string } {
  if (!validSchoolDate(date)) return { kind: 'unconfirmed', reason: 'Wybierz prawidłową datę.' };
  if (date < (day?.periodStart || OKRUSZEK_START) || date > (day?.periodEnd || OKRUSZEK_END)) return { kind: 'outside-period', reason: 'Ta data jest poza okresem obowiązywania planu.' };
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!weekday || weekday === 6) return { kind: 'day-off', reason: 'Weekend — plan obejmuje poniedziałek–piątek.' };
  const holiday = OKRUSZEK_DAYS_OFF.find(range => date >= range.start && date <= range.end);
  if (holiday) return { kind: 'day-off', reason: holiday.reason };
  if (day?.extraDaysOff.includes(date)) return { kind: 'day-off', reason: 'Dodatkowy dzień wolny zapisany przez rodzica.' };
  if (date === '2027-06-25') return { kind: 'unconfirmed', reason: 'Zakończenie roku szkolnego — godziny i przebieg tego dnia wymagają potwierdzenia przez szkołę.' };
  return { kind: 'planned', reason: 'Według planu tygodniowego. Nie jest to dodatkowe potwierdzenie, że zajęcia odbędą się tego dnia.' };
}
