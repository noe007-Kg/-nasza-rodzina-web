import type { CalendarEventData, PersonKey } from './app-shared';
import { addDays, civilDate, dateInTimeZone, endOfDay, generateOccurrences, occurrenceIndex, recurrenceRule, type RecurrenceRule } from './calendar-utils';

export type CalendarExportOptions = { uid: string; person?: PersonKey; mine?: boolean; from?: Date; to?: Date };
export type CalendarImportOptions = { uid: string; person: PersonKey; private?: boolean };
const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const UNIT_FREQ = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' };

function escapeText(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
function unescapeText(value: string): string { return value.replace(/\\([nN,;\\])/g, (_, char: string) => char === 'n' || char === 'N' ? '\n' : char); }
function compact(date: Date, utc = false): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${utc ? date.getUTCFullYear() : date.getFullYear()}${part((utc ? date.getUTCMonth() : date.getMonth()) + 1)}${part(utc ? date.getUTCDate() : date.getDate())}T${part(utc ? date.getUTCHours() : date.getHours())}${part(utc ? date.getUTCMinutes() : date.getMinutes())}${part(utc ? date.getUTCSeconds() : date.getSeconds())}${utc ? 'Z' : ''}`;
}
function dateOnly(date: Date): string { return compact(date).slice(0, 8); }
function fold(line: string): string {
  let current = '', size = 0;
  const chunks: string[] = [];
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (size + length > 74) { chunks.push(current); current = ''; size = 0; }
    current += char; size += length;
  }
  chunks.push(current);
  return chunks.join('\r\n ');
}
function zoneOf(event: CalendarEventData): string | undefined {
  const zone = event.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(event.date); return zone; } catch { return undefined; }
}
function dateLine(name: string, date: Date, allDay: boolean, zone?: string): string {
  if (allDay) return `${name};VALUE=DATE:${dateOnly(civilDate(date, zone))}`;
  return zone ? `${name};TZID=${zone}:${compact(civilDate(date, zone))}` : `${name}:${compact(date, true)}`;
}
function ruleLine(event: CalendarEventData): string | null {
  if (event.repeat === 'none') return null;
  const rule = recurrenceRule(event), parts = [`FREQ=${UNIT_FREQ[rule.unit]}`, `INTERVAL=${rule.interval}`, 'WKST=MO'];
  const base = civilDate(event.date, zoneOf(event));
  if (rule.unit === 'month' && base.getDate() >= 29) parts.push(`BYMONTHDAY=${base.getDate()},-1`, 'BYSETPOS=1');
  if (rule.unit === 'year' && base.getMonth() === 1 && base.getDate() === 29) parts.push('BYMONTH=2', 'BYMONTHDAY=29,-1', 'BYSETPOS=1');
  if (rule.weekdays?.length) parts.push(`BYDAY=${rule.weekdays.map((day) => DAY_NAMES[day]).join(',')}`);
  let count = event.repeatCount;
  if (event.repeatBefore && count) { const beforeIndex = occurrenceIndex(event, event.repeatBefore); if (beforeIndex >= 0) count = Math.min(count, beforeIndex); }
  let until = event.repeatUntil;
  if (event.repeatBefore && (!until || event.repeatBefore < until)) until = new Date(event.repeatBefore.getTime() - 1);
  // RFC 5545 forbids COUNT and UNTIL in the same RRULE.
  if (count) parts.push(`COUNT=${count}`);
  else if (until) parts.push(`UNTIL=${event.allDay ? dateOnly(civilDate(until, zoneOf(event))) : compact(until, true)}`);
  return `RRULE:${parts.join(';')}`;
}
function eventLines(event: CalendarEventData, uid: string, recurrenceId?: Date, recurrenceAllDay = event.allDay): string[] {
  const zone = zoneOf(event), end = event.allDay ? dateInTimeZone(addDays(civilDate(event.endDate, zone), 1), zone) : event.endDate;
  const lines = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${compact(new Date(), true)}`, dateLine('DTSTART', event.date, event.allDay, zone), dateLine('DTEND', end, event.allDay, zone), `SUMMARY:${escapeText(event.title)}`, `DESCRIPTION:${escapeText(event.description || '')}`, `LOCATION:${escapeText(event.location || '')}`, `CLASS:${event.private ? 'PRIVATE' : 'PUBLIC'}`];
  if (recurrenceId) lines.push(dateLine('RECURRENCE-ID', recurrenceId, recurrenceAllDay, zone));
  else {
    const rule = ruleLine(event); if (rule) lines.push(rule);
    for (const key of event.recurrenceExceptions || []) lines.push(dateLine('EXDATE', new Date(key), event.allDay, zone));
  }
  lines.push('END:VEVENT');
  return lines;
}

/** All private records are filtered by UID again, even if a caller supplies an unsafe array. */
export function exportCalendarIcs(events: CalendarEventData[], options: CalendarExportOptions): string {
  const allowed = events.filter((event) => (!event.private || event.ownerUid === options.uid) && (!options.mine || event.createdBy === options.uid) && (!options.person || options.person === 'family' || event.person === options.person || event.person === 'family'));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nasza Rodzina//Kalendarz rodzinny//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const event of allowed) {
    if (event.repeatBefore && event.repeatBefore <= event.date) continue;
    if (options.from || options.to) {
      const from = options.from || event.date, to = options.to || endOfDay(addDays(from, 365));
      if (to < from || to.getTime() - from.getTime() > 3660 * 86400000) throw new Error('Eksportuj zakres nie dłuższy niż 10 lat.');
      for (const occurrence of generateOccurrences(event, from, to)) lines.push(...eventLines({ ...occurrence.source, date: occurrence.date, endDate: occurrence.endDate, repeat: 'none', recurrenceExceptions: [], recurrenceOverrides: {} }, `${event.id}-${occurrence.originalDate?.getTime() || occurrence.date.getTime()}@nasza-rodzina.local`));
    } else {
      const uid = `${event.id}@nasza-rodzina.local`;
      lines.push(...eventLines(event, uid));
      for (const [key, override] of Object.entries(event.recurrenceOverrides || {})) {
        if ((event.recurrenceExceptions || []).includes(key) || (event.repeatBefore && new Date(key) >= event.repeatBefore)) continue;
        lines.push(...eventLines({ ...event, ...override }, uid, new Date(key), event.allDay));
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

type Property = { name: string; parameters: Record<string, string>; value: string };
function property(line: string): Property | null {
  const colon = line.indexOf(':'); if (colon < 0) return null;
  const [name, ...parts] = line.slice(0, colon).split(';');
  return { name: name.toUpperCase(), parameters: Object.fromEntries(parts.map((part) => { const equal = part.indexOf('='); return [part.slice(0, equal).toUpperCase(), part.slice(equal + 1).replace(/^"|"$/g, '')]; })), value: line.slice(colon + 1) };
}
function parseDate(prop: Property): { date: Date; allDay: boolean; zone?: string } {
  const value = prop.value, allDay = prop.parameters.VALUE === 'DATE' || /^\d{8}$/.test(value);
  const matched = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!matched) throw new Error('Nieobsługiwany format daty w pliku ICS.');
  const [, year, month, day, hour = '00', minute = '00', second = '00', utc] = matched;
  const local = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (local.getFullYear() !== Number(year) || local.getMonth() !== Number(month) - 1 || local.getDate() !== Number(day)) throw new Error('Nieprawidłowa data w pliku ICS.');
  const zone = utc ? 'UTC' : prop.parameters.TZID;
  if (zone) { try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { throw new Error(`Nieobsługiwana strefa czasu: ${zone}`); } }
  const date = utc ? new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))) : dateInTimeZone(local, zone);
  return { date, allDay, zone };
}
function parseRule(prop: Property | undefined, start: Date): Pick<CalendarEventData, 'repeat' | 'recurrence' | 'repeatCount' | 'repeatUntil' | 'repeatBefore'> {
  if (!prop) return { repeat: 'none', repeatUntil: null, repeatCount: null };
  const values: Record<string, string> = Object.fromEntries(prop.value.toUpperCase().split(';').map((part) => part.split('=')));
  if (Object.keys(values).some((key) => !['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL', 'WKST', 'BYMONTHDAY', 'BYSETPOS', 'BYMONTH'].includes(key))) throw new Error('Ta reguła powtarzania ICS wymaga nieobsługiwanych parametrów.');
  const unit = ({ DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const)[values.FREQ as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'];
  if (!unit) throw new Error('Nieobsługiwana częstotliwość powtarzania ICS.');
  if (values.BYMONTHDAY || values.BYSETPOS || values.BYMONTH) {
    const monthlyClamp = unit === 'month' && start.getDate() >= 29 && !values.BYMONTH;
    const yearlyClamp = unit === 'year' && start.getMonth() === 1 && start.getDate() === 29 && values.BYMONTH === '2';
    if ((!monthlyClamp && !yearlyClamp) || values.BYMONTHDAY !== `${start.getDate()},-1` || values.BYSETPOS !== '1') throw new Error('Nieobsługiwana złożona reguła miesięczna lub roczna.');
  }
  const interval = Number(values.INTERVAL || 1), count = values.COUNT ? Number(values.COUNT) : null;
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000 || (count !== null && (!Number.isInteger(count) || count < 1 || count > 100000))) throw new Error('Nieprawidłowy interwał lub liczba wystąpień.');
  const weekdays = values.BYDAY?.split(',').map((day) => DAY_NAMES.indexOf(day));
  if (weekdays && (unit !== 'week' || weekdays.some((day) => day < 0))) throw new Error('Obsługiwany BYDAY dotyczy zwykłych dni w seriach tygodniowych.');
  if (values.WKST && values.WKST !== 'MO') throw new Error('Obsługiwany początek tygodnia ICS to poniedziałek.');
  const recurrence: RecurrenceRule = { unit, interval, ...(weekdays ? { weekdays } : {}) };
  const repeat = interval === 1 && !weekdays ? ({ day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' } as const)[unit] : 'custom';
  const until = values.UNTIL ? parseDate({ name: 'UNTIL', parameters: {}, value: values.UNTIL }) : null;
  return { repeat, recurrence, repeatCount: count, repeatUntil: until ? (until.allDay ? endOfDay(until.date) : until.date) : null, repeatBefore: until && !until.allDay ? new Date(until.date.getTime() + 1) : null };
}
function stableId(uid: string, value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${uid}__ics_${(hash >>> 0).toString(36)}`;
}

export function importCalendarIcs(text: string, options: CalendarImportOptions): { events: CalendarEventData[]; warnings: string[] } {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('Plik ICS może mieć maksymalnie 2 MB.');
  const unfolded = text.replace(/\r?\n[ \t]/g, ''), lines = unfolded.split(/\r?\n/);
  if (lines.length > 40000 || lines.some((line) => line.length > 20000)) throw new Error('Plik ICS jest zbyt złożony.');
  if (!lines.some((line) => line.toUpperCase() === 'BEGIN:VCALENDAR')) throw new Error('To nie jest plik kalendarza ICS.');
  const records: Property[][] = [], warnings: string[] = []; let current: Property[] | null = null;
  for (const line of lines) {
    if (line.toUpperCase() === 'BEGIN:VEVENT') { current = []; continue; }
    if (line.toUpperCase() === 'END:VEVENT') { if (current) records.push(current); current = null; continue; }
    const prop = property(line); if (current && prop) current.push(prop);
  }
  if (records.length > 2000) throw new Error('Importuj najwyżej 2000 wydarzeń naraz.');
  const events = new Map<string, CalendarEventData>(), pendingOverrides: { uid: string; original: Date; event: CalendarEventData }[] = [];
  for (const [index, props] of records.entries()) {
    const find = (name: string) => props.find((prop) => prop.name === name);
    try {
      const rawStart = find('DTSTART'); if (!rawStart) throw new Error('Brak DTSTART.');
      const start = parseDate(rawStart), rawEnd = find('DTEND'), end = rawEnd ? parseDate(rawEnd).date : start.allDay ? dateInTimeZone(addDays(civilDate(start.date, start.zone), 1), start.zone) : new Date(start.date.getTime() + 3600000);
      const endDate = start.allDay ? new Date(end.getTime() - 1) : end;
      if (endDate <= start.date) throw new Error('Nieprawidłowy czas zakończenia.');
      if (find('DURATION')) throw new Error('Import DURATION wymaga DTEND; wpis pominięto.');
      const uid = find('UID')?.value || `${index}-${start.date.toISOString()}-${find('SUMMARY')?.value || ''}`;
      const event: CalendarEventData = { id: stableId(options.uid, uid), title: unescapeText(find('SUMMARY')?.value || 'Wydarzenie').slice(0, 300), person: options.person, date: start.date, endDate, allDay: start.allDay, description: unescapeText(find('DESCRIPTION')?.value || '').slice(0, 20000), location: unescapeText(find('LOCATION')?.value || '').slice(0, 2000), createdBy: options.uid, ownerUid: options.uid, private: options.private === true || find('CLASS')?.value === 'PRIVATE', ...parseRule(find('RRULE'), civilDate(start.date,start.zone)), recurrenceExceptions: props.filter((prop) => prop.name === 'EXDATE').flatMap((prop) => prop.value.split(',').map((value) => parseDate({ ...prop, value }).date.toISOString())), recurrenceOverrides: {}, ...(start.zone ? { timeZone: start.zone } : {}) };
      event.seriesId = event.id;
      const original = find('RECURRENCE-ID');
      if (original) pendingOverrides.push({ uid: event.id, original: parseDate(original).date, event });
      else if (!events.has(event.id)) events.set(event.id, event);
      else warnings.push(`Wpis ${index + 1}: powtórzony UID, pominięto duplikat.`);
    } catch (error) { warnings.push(`Wpis ${index + 1}: ${error instanceof Error ? error.message : 'Nie udało się odczytać.'}`); }
  }
  for (const item of pendingOverrides) {
    const event = events.get(item.uid);
    if (!event) { warnings.push('Pominięto wyjątek bez głównej serii.'); continue; }
    event.recurrenceOverrides![item.original.toISOString()] = { date: item.event.date, endDate: item.event.endDate, title: item.event.title, description: item.event.description, location: item.event.location, person: item.event.person, allDay: item.event.allDay };
  }
  return { events: [...events.values()], warnings };
}
