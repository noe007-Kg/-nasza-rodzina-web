export type RepeatType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurringEvent = {
  id: string;
  date: Date;
  endDate: Date;
  allDay: boolean;
  repeat: RepeatType;
  repeatUntil: Date | null;
};

export type CalendarOccurrence<T extends RecurringEvent = RecurringEvent> = {
  key: string;
  source: T;
  date: Date;
  endDate: Date;
};

export function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function startOfWeek(date: Date) {
  const result = startOfDay(date);
  const day = result.getDay();
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day));
  return result;
}

export function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addMonths(date: Date, months: number) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

export function addYears(date: Date, years: number) {
  const result = new Date(date);
  const month = result.getMonth();
  result.setFullYear(result.getFullYear() + years);
  if (result.getMonth() !== month) result.setDate(0);
  return result;
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function parseLocalDate(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

export function isRepeatType(value: unknown): value is RepeatType {
  return value === 'none' || value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly';
}

export function repeatLabel(value: RepeatType) {
  switch (value) {
    case 'daily': return 'Codziennie';
    case 'weekly': return 'Co tydzień';
    case 'monthly': return 'Co miesiąc';
    case 'yearly': return 'Co rok';
    default: return 'Nie powtarzaj';
  }
}

export function occurrenceAt(base: Date, repeat: RepeatType, index: number) {
  if (repeat === 'daily') return addDays(base, index);
  if (repeat === 'weekly') return addDays(base, index * 7);
  if (repeat === 'monthly') return addMonths(base, index);
  if (repeat === 'yearly') return addYears(base, index);
  return new Date(base);
}

// Calendar days must be counted independently of 23/25-hour daylight-saving days.
function calendarDayNumber(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function occurrenceEnd(event: RecurringEvent, date: Date) {
  const daySpan = calendarDayNumber(event.endDate) - calendarDayNumber(event.date);
  const result = addDays(date, daySpan);
  if (event.allDay) return endOfDay(result);
  result.setHours(event.endDate.getHours(), event.endDate.getMinutes(), event.endDate.getSeconds(), event.endDate.getMilliseconds());
  // A nonexistent spring-transition time can normalize past the original end time.
  // Keep the event's positive duration in that exceptional case.
  return result > date ? result : new Date(date.getTime() + event.endDate.getTime() - event.date.getTime());
}

export function generateOccurrences<T extends RecurringEvent>(event: T, rangeStart: Date, rangeEnd: Date): CalendarOccurrence<T>[] {
  if ([event.date, event.endDate, rangeStart, rangeEnd].some((date) => !Number.isFinite(date.getTime()))
    || event.endDate < event.date || rangeEnd < rangeStart) return [];

  if (event.repeat === 'none') {
    return event.date <= rangeEnd && event.endDate >= rangeStart
      ? [{ key: `${event.id}-${event.date.getTime()}`, source: event, date: event.date, endDate: event.endDate }]
      : [];
  }

  const until = event.repeatUntil && Number.isFinite(event.repeatUntil.getTime()) ? endOfDay(event.repeatUntil) : rangeEnd;
  const hardEnd = until < rangeEnd ? until : rangeEnd;
  const daySpan = calendarDayNumber(event.endDate) - calendarDayNumber(event.date);
  const earliest = addDays(rangeStart, -daySpan - 2);
  const elapsedDays = calendarDayNumber(earliest) - calendarDayNumber(event.date);
  const elapsedMonths = (earliest.getFullYear() - event.date.getFullYear()) * 12 + earliest.getMonth() - event.date.getMonth();
  const approximateIndex = event.repeat === 'daily' ? elapsedDays
    : event.repeat === 'weekly' ? Math.floor(elapsedDays / 7)
    : event.repeat === 'monthly' ? elapsedMonths
    : earliest.getFullYear() - event.date.getFullYear();
  const first = Math.max(0, approximateIndex - 2);
  const result: CalendarOccurrence<T>[] = [];

  for (let index = first; ; index += 1) {
    const date = occurrenceAt(event.date, event.repeat, index);
    if (!Number.isFinite(date.getTime()) || date > hardEnd) break;
    const endDate = occurrenceEnd(event, date);
    if (endDate >= rangeStart) result.push({ key: `${event.id}-${date.getTime()}`, source: event, date, endDate });
  }
  return result;
}
