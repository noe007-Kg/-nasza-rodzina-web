export type RepeatType = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';
export type RecurrenceRule = { interval: number; unit: RecurrenceUnit; weekdays?: number[] };
export type OccurrenceOverride = { date: Date; endDate: Date; title?: string; person?: string; description?: string; location?: string; allDay?: boolean };

export type RecurringEvent = {
  id: string;
  date: Date;
  endDate: Date;
  allDay: boolean;
  repeat: RepeatType;
  repeatUntil: Date | null;
  recurrence?: RecurrenceRule;
  repeatCount?: number | null;
  repeatBefore?: Date | null;
  recurrenceExceptions?: string[];
  recurrenceOverrides?: Record<string, OccurrenceOverride>;
  timeZone?: string;
};

export type CalendarOccurrence<T extends RecurringEvent = RecurringEvent> = {
  key: string;
  source: T;
  date: Date;
  endDate: Date;
  originalDate?: Date;
  originalIndex?: number;
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
  return value === 'none' || value === 'daily' || value === 'weekdays' || value === 'weekly' || value === 'monthly' || value === 'yearly' || value === 'custom';
}

export function repeatLabel(value: RepeatType) {
  switch (value) {
    case 'daily': return 'Codziennie';
    case 'weekdays': return 'Poniedziałek–piątek';
    case 'weekly': return 'Co tydzień';
    case 'monthly': return 'Co miesiąc';
    case 'yearly': return 'Co rok';
    case 'custom': return 'Niestandardowo';
    default: return 'Nie powtarzaj';
  }
}

export function occurrenceAt(base: Date, repeat: RepeatType, index: number) {
  if (repeat === 'weekdays') {
    let cursor = new Date(base), count = -1;
    while (count < index) { if (cursor.getDay() !== 0 && cursor.getDay() !== 6) count++; if (count < index) cursor = addDays(cursor, 1); }
    return cursor;
  }
  if (repeat === 'daily') return addDays(base, index);
  if (repeat === 'weekly') return addDays(base, index * 7);
  if (repeat === 'monthly') return addMonths(base, index);
  if (repeat === 'yearly') return addYears(base, index);
  return new Date(base);
}

// Civil dates keep wall-clock hours across 23/25-hour daylight-saving days.
export function civilDate(date: Date, timeZone?: string): Date {
  if (!timeZone) return new Date(date);
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
    return new Date(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'), date.getMilliseconds());
  } catch { return new Date(date); }
}

export function dateInTimeZone(civil: Date, timeZone?: string): Date {
  if (!timeZone) return new Date(civil);
  const target = Date.UTC(civil.getFullYear(), civil.getMonth(), civil.getDate(), civil.getHours(), civil.getMinutes(), civil.getSeconds(), civil.getMilliseconds());
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const represented = civilDate(new Date(guess), timeZone);
    const actual = Date.UTC(represented.getFullYear(), represented.getMonth(), represented.getDate(), represented.getHours(), represented.getMinutes(), represented.getSeconds(), represented.getMilliseconds());
    const delta = target - actual;
    if (delta === 0) return new Date(guess);
    guess += delta;
  }
  return new Date(guess);
}

function calendarDayNumber(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function recurrenceRule(event: RecurringEvent): RecurrenceRule {
  if (event.repeat === 'weekdays') return { interval: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5] };
  const fallback = event.repeat === 'weekly' ? 'week' : event.repeat === 'monthly' ? 'month' : event.repeat === 'yearly' ? 'year' : 'day';
  const custom = event.repeat === 'custom' ? event.recurrence : undefined;
  const unit = custom && ['day', 'week', 'month', 'year'].includes(custom.unit) ? custom.unit : fallback;
  const interval = custom && Number.isInteger(custom.interval) && custom.interval > 0 ? Math.min(custom.interval, 1000) : 1;
  const weekdays = unit === 'week' && custom?.weekdays?.length ? [...new Set(custom.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : undefined;
  return { unit, interval, ...(weekdays?.length ? { weekdays } : {}) };
}

function civilOccurrenceAt(base: Date, rule: RecurrenceRule, index: number): Date {
  if (rule.unit === 'week' && rule.weekdays?.length) {
    const monday = startOfWeek(base), baseDay = (base.getDay() + 6) % 7;
    const offsets = rule.weekdays.map((day) => (day + 6) % 7);
    const firstWeek = offsets.filter((offset) => offset >= baseDay);
    const firstCount = firstWeek.length;
    const week = index < firstCount ? 0 : 1 + Math.floor((index - firstCount) / offsets.length);
    const offset = index < firstCount ? firstWeek[index] : offsets[(index - firstCount) % offsets.length];
    const day = addDays(monday, week * rule.interval * 7 + offset);
    day.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
    return day;
  }
  if (rule.unit === 'day') return addDays(base, index * rule.interval);
  if (rule.unit === 'week') return addDays(base, index * rule.interval * 7);
  if (rule.unit === 'month') return addMonths(base, index * rule.interval);
  return addYears(base, index * rule.interval);
}

export function occurrenceDateAt(event: RecurringEvent, index: number): Date {
  if (event.repeat === 'none') return new Date(event.date);
  return dateInTimeZone(civilOccurrenceAt(civilDate(event.date, event.timeZone), recurrenceRule(event), Math.max(0, index)), event.timeZone);
}

function approximateIndex(event: RecurringEvent, target: Date): number {
  const base = civilDate(event.date, event.timeZone), point = civilDate(target, event.timeZone), rule = recurrenceRule(event);
  const days = calendarDayNumber(point) - calendarDayNumber(base);
  if (rule.unit === 'day') return Math.floor(days / rule.interval);
  if (rule.unit === 'week' && rule.weekdays?.length) {
    const weeks = Math.floor((calendarDayNumber(point) - calendarDayNumber(startOfWeek(base))) / (7 * rule.interval));
    return Math.max(0, weeks * rule.weekdays.length - rule.weekdays.length);
  }
  if (rule.unit === 'week') return Math.floor(days / (7 * rule.interval));
  if (rule.unit === 'month') return Math.floor(((point.getFullYear() - base.getFullYear()) * 12 + point.getMonth() - base.getMonth()) / rule.interval);
  return Math.floor((point.getFullYear() - base.getFullYear()) / rule.interval);
}

export function occurrenceIndex(event: RecurringEvent, date: Date): number {
  if (event.repeat === 'none') return 0;
  let index = Math.max(0, approximateIndex(event, date) - 3);
  for (let tries = 0; tries < 32; tries++, index++) {
    const candidate = occurrenceDateAt(event, index);
    if (candidate.getTime() === date.getTime()) return index;
    if (candidate > date) break;
  }
  return -1;
}

function occurrenceEnd(event: RecurringEvent, date: Date) {
  const originalStart = civilDate(event.date, event.timeZone), originalEnd = civilDate(event.endDate, event.timeZone);
  const local = civilDate(date, event.timeZone);
  const result = addDays(local, calendarDayNumber(originalEnd) - calendarDayNumber(originalStart));
  if (event.allDay) result.setHours(23, 59, 59, 999);
  else result.setHours(originalEnd.getHours(), originalEnd.getMinutes(), originalEnd.getSeconds(), originalEnd.getMilliseconds());
  const resolved = dateInTimeZone(result, event.timeZone);
  return resolved > date ? resolved : new Date(date.getTime() + event.endDate.getTime() - event.date.getTime());
}

export function describeRecurrence(event: RecurringEvent): string {
  if (event.repeat !== 'custom') return repeatLabel(event.repeat);
  const rule = recurrenceRule(event), unit = { day: 'dni', week: 'tygodni', month: 'miesięcy', year: 'lat' }[rule.unit];
  const days = ['Nd', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
  return `Co ${rule.interval} ${unit}${rule.weekdays?.length ? ` · ${rule.weekdays.map((day) => days[day]).join(', ')}` : ''}`;
}

export function generateOccurrences<T extends RecurringEvent>(event: T, rangeStart: Date, rangeEnd: Date): CalendarOccurrence<T>[] {
  if ([event.date, event.endDate, rangeStart, rangeEnd].some((date) => !Number.isFinite(date.getTime())) || event.endDate < event.date || rangeEnd < rangeStart) return [];
  const until = event.repeatUntil && Number.isFinite(event.repeatUntil.getTime()) ? dateInTimeZone(endOfDay(civilDate(event.repeatUntil, event.timeZone)), event.timeZone) : rangeEnd;
  const hardEnd = until < rangeEnd ? until : rangeEnd;
  const daySpan = calendarDayNumber(civilDate(event.endDate, event.timeZone)) - calendarDayNumber(civilDate(event.date, event.timeZone));
  const first = event.repeat === 'none' ? 0 : Math.max(0, approximateIndex(event, addDays(rangeStart, -daySpan - 2)) - 3);
  const count = Number.isInteger(event.repeatCount) && Number(event.repeatCount) > 0 ? Number(event.repeatCount) : Infinity;
  const exceptions = new Set(event.recurrenceExceptions || []), overrides = event.recurrenceOverrides || {};
  const result: CalendarOccurrence<T>[] = [];
  const push = (original: Date, index: number, override?: OccurrenceOverride) => {
    const date = override?.date || original, endDate = override?.endDate || occurrenceEnd(event, date);
    if (date > rangeEnd || endDate < rangeStart || exceptions.has(original.toISOString())) return;
    const source = override ? { ...event, ...override } as T : event;
    result.push({ key: `${event.id}-${original.getTime()}`, source, date, endDate, originalDate: original, originalIndex: index });
  };
  for (let index = first, visited = 0; visited < 20000 && index < count; index++, visited++) {
    const date = occurrenceDateAt(event, index);
    if (!Number.isFinite(date.getTime()) || date > hardEnd || (event.repeatBefore && date >= event.repeatBefore)) break;
    const key = date.toISOString();
    if (!overrides[key]) push(date, index);
    if (event.repeat === 'none') break;
  }
  // A moved occurrence can enter this range even when its original date is outside it.
  for (const [key, override] of Object.entries(overrides)) {
    const original = new Date(key), index = occurrenceIndex(event, original);
    if (index < 0 || index >= count || !Number.isFinite(original.getTime()) || (event.repeatBefore && original >= event.repeatBefore) || original > until) continue;
    push(original, index, override);
  }
  return result.sort((a, b) => a.date.getTime() - b.date.getTime());
}
