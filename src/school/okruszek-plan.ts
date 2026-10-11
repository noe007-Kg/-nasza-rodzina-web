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
  id?: string; person: string; weekday: number; time: string; endTime: string;
  lessons: string[]; periodStart: string; periodEnd: string; extraDaysOff: string[]; revision: number;
};

// User-supplied whole-day bounds. There are no inferred lesson start/end times.
const suppliedDays = [
  { time: '07:30', endTime: '15:10', lessons: ['Rewalidacja', 'Rewalidacja', 'f.os i społ', 'f.os i społ', 'PDP/kuchnia', 'Z.R.Z', 'PDP', 'PDP'] },
  { time: '08:50', endTime: '16:00', lessons: ['-', 'Zaj. k. kreat', 'Zaj. k. kreat', 'religia', 'PDP', 'PDP', 'PDP', 'Z.r.k', 'Z.r.k'] },
  { time: '08:50', endTime: '16:30', lessons: ['-', 'PDP/kuchnia', 'PDP/kuchnia', 'WF', 'WF', 'WF', 'PDP/kuchnia', 'rewalidacja', 'rewalidacja'] },
  { time: '08:00', endTime: '16:00', lessons: ['PDP', 'PDP', 'PDP/praktyki', 'PDP/praktyki', 'PDP/praktyki', 'PDP/praktyki', 'rewalidacja', 'PDP', 'logopedia'] },
  { time: '08:00', endTime: '16:00', lessons: ['Z.k.k', 'Z.k.k', 'PDP/praktyki', 'PDP/praktyki', 'PDP/praktyki', 'PDP/praktyki', 'f.os i społ', 'f.os i społ', 'f.os i społ'] },
];

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

export function createOkruszekDays(person: string): OkruszekDay[] {
  return suppliedDays.map((day, index) => ({ ...day, person, weekday: index + 1, lessons: [...day.lessons],
    periodStart: OKRUSZEK_START, periodEnd: OKRUSZEK_END, extraDaysOff: [], revision: 0 }));
}

export function validateOkruszekDays(days: readonly OkruszekDay[]): OkruszekDay[] {
  if (days.length !== 5 || days.some(day => !day) || new Set(days.map(day => day.weekday)).size !== 5) throw new Error('Plan wymaga pięciu różnych dni od poniedziałku do piątku.');
  const first = days[0];
  for (const day of days) {
    if (!day || typeof day.person !== 'string' || day.person !== first.person || !day.person
      || !Number.isInteger(day.weekday) || day.weekday < 1 || day.weekday > 5
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
  schoolPlanId: string; schoolName: string; schoolPlanRevision: number;
  manualDayPlan: { weekday: number; periodStart: string; periodEnd: string; lessons: string[]; extraDaysOff: string[];
    wholeDay: true; holidayCalendar: string; confirmedDaysOff: typeof OKRUSZEK_DAYS_OFF[number][] };
} {
  // A weekly plan is information, not five unconditional recurring lessons. Keeping
  // it out of lesson/activity feeds avoids confirming holidays or dates after June
  // without changing Start, the family calendar, or any provider integration.
  const entry = validateSchoolEntry({ person: day.person, type: 'message', title: `Okruszek — ${OKRUSZEK_WEEKDAYS[day.weekday - 1]}`,
    subject: 'Plan całego dnia', date: '', weekday: 0, time: day.time, endTime: day.endTime,
    note: day.lessons.join('; ') }, [day.person]);
  return { ...entry, schoolPlanId: OKRUSZEK_PLAN_ID, schoolName: 'Okruszek, Kołobrzeg', schoolPlanRevision: day.revision,
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
    lessons: details.lessons, periodStart: details.periodStart, periodEnd: details.periodEnd,
    extraDaysOff: details.extraDaysOff, revision: data.schoolPlanRevision ?? 0 } as OkruszekDay;
  try {
    const rows = createOkruszekDays(day.person).map(value => ({ ...value, periodStart: day.periodStart, periodEnd: day.periodEnd,
      ...(value.weekday === day.weekday ? day : {}) }));
    validateOkruszekDays(rows);
    return day;
  } catch { return null; }
}

/** Stable identity excludes editable lessons/times and creator UID. Both parents share one plan. */
export async function okruszekDayId(person: string, weekday: number): Promise<string> {
  if (!person || !Number.isInteger(weekday) || weekday < 1 || weekday > 5) throw new Error('Nieprawidłowa osoba lub dzień planu.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([OKRUSZEK_PLAN_ID, person, weekday])));
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
