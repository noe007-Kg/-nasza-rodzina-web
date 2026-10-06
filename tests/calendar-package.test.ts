import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEventData } from '../src/app-shared';
import { generateOccurrences, parseLocalDate, startOfDay, endOfDay, formatDateInput, formatTimeInput, occurrenceDateAt, occurrenceIndex, dateInTimeZone } from '../src/calendar-utils';
import { planSeriesUpdate, planSeriesDelete } from '../src/calendar-series';
import { importCalendarIcs, exportCalendarIcs } from '../src/calendar-ics';

process.env.TZ = 'Europe/Warsaw';
function event(patch: Partial<CalendarEventData> = {}): CalendarEventData {
  return { id: 'recurring', title: 'Spotkanie', person: 'Sebastian', createdBy: 'parent-a', ownerUid: 'parent-a', private: false, date: parseLocalDate('2026-01-01', '09:00'), endDate: parseLocalDate('2026-01-01', '10:00'), allDay: false, repeat: 'daily', repeatUntil: null, description: 'Opis', location: 'Dom', ...patch };
}
function range(start: string, end = start): [Date, Date] { return [startOfDay(parseLocalDate(start, '12:00')), endOfDay(parseLocalDate(end, '12:00'))]; }
function dates(rows: ReturnType<typeof generateOccurrences>): string[] { return rows.map((item) => formatDateInput(item.date)); }

test('poniedziałek–piątek pomija weekendy i liczy tylko wystąpienia', () => {
  assert.deepEqual(dates(generateOccurrences(event({ repeat: 'weekdays', repeatCount: 5 }), ...range('2026-01-01', '2026-01-15'))), ['2026-01-01','2026-01-02','2026-01-05','2026-01-06','2026-01-07']);
});
for (const [unit, interval, expected] of [
  ['day', 2, ['2026-01-01','2026-01-03','2026-01-05']],
  ['week', 2, ['2026-01-01','2026-01-15','2026-01-29']],
  ['month', 3, ['2026-01-01','2026-04-01','2026-07-01']],
  ['year', 2, ['2026-01-01','2028-01-01','2030-01-01']],
] as const) test(`custom co ${interval} ${unit} i koniec po trzech wystąpieniach`, () => {
  const series = event({ repeat: 'custom', recurrence: { unit, interval }, repeatCount: 3 });
  assert.deepEqual(dates(generateOccurrences(series, ...range('2026-01-01','2031-01-01'))), expected);
});
test('co dwa tygodnie w poniedziałki i środy, również gdy start jest czwartkiem', () => {
  const series = event({ repeat: 'custom', recurrence: { interval: 2, unit: 'week', weekdays: [1,3] }, repeatCount: 4 });
  assert.deepEqual(dates(generateOccurrences(series, ...range('2026-01-01','2026-02-01'))), ['2026-01-12','2026-01-14','2026-01-26','2026-01-28']);
  assert.equal(occurrenceIndex(series, parseLocalDate('2026-01-26','09:00')), 2);
});
test('stara wielodniowa seria z wybranymi dniami wyszukuje zakres bez odliczania wszystkich lat', () => {
  const series = event({ date: parseLocalDate('1900-01-01','09:00'), endDate: parseLocalDate('1900-01-01','10:00'), repeat: 'custom', recurrence: { interval: 2, unit: 'week', weekdays: [1,3,5] } });
  const rows = generateOccurrences(series, ...range('2026-01-01','2026-01-31'));
  assert.ok(rows.length > 4); assert.ok(rows.every((row) => row.date.getFullYear() === 2026));
  assert.equal(occurrenceIndex(series, rows[0].date), rows[0].originalIndex);
});
test('jawna strefa Europe/Warsaw zachowuje 09:00 przez zmianę czasu', () => {
  const series = event({ date: new Date('2026-03-28T08:00:00Z'), endDate: new Date('2026-03-28T09:00:00Z'), timeZone: 'Europe/Warsaw' });
  const next = occurrenceDateAt(series, 1);
  assert.equal(next.toISOString(), '2026-03-29T07:00:00.000Z');
  assert.equal(formatTimeInput(next), '09:00');
});
test('pojedyncza edycja przenosi jeden termin, nie zmienia serii i stabilizuje klucz oryginalny', () => {
  const source = event({ repeatCount: 5 }), original = parseLocalDate('2026-01-03','09:00');
  const patch = { ...source, title: 'Zmienione', date: parseLocalDate('2026-01-10','11:00'), endDate: parseLocalDate('2026-01-10','12:00') };
  const plan = planSeriesUpdate([source], source, original, 'one', patch);
  assert.equal(source.recurrenceOverrides, undefined);
  const rows = generateOccurrences(plan.upserts[0], ...range('2026-01-01','2026-01-12'));
  assert.deepEqual(dates(rows), ['2026-01-01','2026-01-02','2026-01-04','2026-01-05','2026-01-10']);
  assert.equal(rows[4].source.title, 'Zmienione'); assert.equal(rows[4].originalDate?.getTime(), original.getTime());
});
test('tego i kolejnych dzieli serię atomowo, zachowuje przeszłość i pozostały count', () => {
  const source = event({ repeatCount: 5 }), original = parseLocalDate('2026-01-03','09:00');
  const plan = planSeriesUpdate([source], source, original, 'future', { ...source, title: 'Od teraz', date: original, endDate: parseLocalDate('2026-01-03','10:00') });
  assert.equal(plan.upserts[0].repeatBefore?.getTime(), original.getTime()); assert.equal(plan.upserts[1].repeatCount, 3);
  const rows = plan.upserts.flatMap((item) => generateOccurrences(item, ...range('2026-01-01','2026-01-09')));
  assert.deepEqual(dates(rows), ['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05']);
  const repeated = planSeriesUpdate(plan.upserts, plan.upserts[0], original, 'future', { ...source, title: 'Od teraz', date: original, endDate: parseLocalDate('2026-01-03','10:00') });
  assert.equal(repeated.upserts[1].id, plan.upserts[1].id);
});
test('wszystkie segmenty zachowują własne UID dokumentów i wcześniejsze wyjątki', () => {
  const one = event({ seriesId: 'series', repeatBefore: parseLocalDate('2026-01-03','09:00'), recurrenceExceptions: [parseLocalDate('2026-01-02','09:00').toISOString()] });
  const two = event({ id: 'part-2', seriesId: 'series', date: parseLocalDate('2026-01-03','09:00'), endDate: parseLocalDate('2026-01-03','10:00') });
  const { id: _id, createdBy: _created, seriesId: _series, ...patch } = { ...two, title: 'Wszystkie', date: parseLocalDate('2026-01-03','11:00'), endDate: parseLocalDate('2026-01-03','12:00') };
  const plan = planSeriesUpdate([one,two], two, two.date, 'all', patch);
  assert.deepEqual(plan.upserts.map((item) => item.id), ['recurring','part-2']);
  assert.ok(plan.upserts.every((item) => item.title === 'Wszystkie'));
  assert.equal(formatTimeInput(plan.upserts[0].date), '11:00');
  assert.deepEqual(dates(plan.upserts.flatMap((item) => generateOccurrences(item,...range('2026-01-01','2026-01-05')))), ['2026-01-01','2026-01-03','2026-01-04','2026-01-05']);
});
test('usunięcie jednego, kolejnych i całej serii ma odrębny zakres', () => {
  const source = event({ repeatCount: 5 }), original = parseLocalDate('2026-01-03','09:00');
  assert.deepEqual(dates(generateOccurrences(planSeriesDelete([source], source, original, 'one').upserts[0], ...range('2026-01-01','2026-01-08'))), ['2026-01-01','2026-01-02','2026-01-04','2026-01-05']);
  assert.deepEqual(dates(generateOccurrences(planSeriesDelete([source], source, original, 'future').upserts[0], ...range('2026-01-01','2026-01-08'))), ['2026-01-01','2026-01-02']);
  assert.deepEqual(planSeriesDelete([source], source, original, 'all').deletes, [source]);
});
test('prywatny pojedynczy wyjątek jest osobnym dokumentem, nie ujawnia się w publicznym rodzicu', () => {
  const source = event(), original = parseLocalDate('2026-01-03','09:00');
  const plan = planSeriesUpdate([source], source, original, 'one', { ...source, title: 'Prywatny lekarz', private: true, date: original, endDate: parseLocalDate('2026-01-03','10:00') });
  assert.equal(plan.upserts[0].private, false); assert.equal(JSON.stringify(plan.upserts[0]).includes('Prywatny lekarz'), false);
  assert.equal(plan.upserts[1].private, true); assert.equal(plan.upserts[1].repeat, 'none');
});
test('ICS roundtrip zachowuje custom, notatkę, unicode, lokalizację i pojedyncze wyjątki', () => {
  const source = event({ title: 'Łódź, spotkanie; rodziny', description: 'Pierwsza linia\nDruga: \\tekst', repeat: 'custom', recurrence: { unit: 'week', interval: 2, weekdays: [1,3] }, timeZone: 'Europe/Warsaw', recurrenceExceptions: [parseLocalDate('2026-01-14','09:00').toISOString()], recurrenceOverrides: { [parseLocalDate('2026-01-12','09:00').toISOString()]: { title: 'Przeniesione', date: parseLocalDate('2026-01-13','13:00'), endDate: parseLocalDate('2026-01-13','14:00') } } });
  const content = exportCalendarIcs([source], { uid: 'parent-a' }), result = importCalendarIcs(content, { uid: 'parent-a', person: 'Sebastian' });
  assert.deepEqual(result.warnings, []); assert.equal(result.events.length, 1); const imported = result.events[0];
  assert.equal(imported.title, source.title); assert.equal(imported.description, source.description); assert.equal(imported.location, 'Dom');
  assert.deepEqual(imported.recurrence, source.recurrence); assert.deepEqual(imported.recurrenceExceptions, source.recurrenceExceptions);
  assert.deepEqual(dates(generateOccurrences(imported,...range('2026-01-01','2026-01-31'))), ['2026-01-13','2026-01-26','2026-01-28']);
});
test('eksport nigdy nie ujawnia prywatnych danych innych osób oraz respektuje zakres/osobę', () => {
  const events = [event(), event({ id:'own-private', private:true, title:'Mój prywatny' }), event({ id:'other-private', private:true, title:'Sekret Dominiki', ownerUid:'parent-b', createdBy:'parent-b' }), event({ id:'nikodem', person:'Nikodem', title:'Nikodem' })];
  const content = exportCalendarIcs(events, { uid:'parent-a', person:'Sebastian', from:range('2026-01-02')[0], to:range('2026-01-03')[1] });
  assert.equal(content.includes('Sekret Dominiki'), false); assert.equal(content.includes('SUMMARY:Nikodem'), false); assert.equal(content.includes('SUMMARY:Mój prywatny'), true);
  assert.equal(content.includes('RRULE:'), false); assert.equal((content.match(/BEGIN:VEVENT/g)||[]).length, 4);
});
test('import CLASS:PRIVATE jest prywatny, idempotentny UID i UTC/TZID poprawnie uwzględniają DST', () => {
  const source='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test\r\nDTSTART;TZID=Europe/Warsaw:20260328T090000\r\nDTEND;TZID=Europe/Warsaw:20260328T100000\r\nSUMMARY:Test\r\nCLASS:PRIVATE\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const first=importCalendarIcs(source,{uid:'u1',person:'Sebastian'}), second=importCalendarIcs(source,{uid:'u1',person:'Sebastian'});
  assert.equal(first.events[0].id,second.events[0].id); assert.equal(first.events[0].private,true);
  assert.deepEqual(generateOccurrences(first.events[0],...range('2026-03-28','2026-03-30')).map((item)=>item.date.toISOString()), ['2026-03-28T08:00:00.000Z','2026-03-29T07:00:00.000Z','2026-03-30T07:00:00.000Z']);
});
test('całodzienne ICS ma DTEND wyłączne oraz zachowuje dni po imporcie', () => {
  const source=event({repeat:'none',allDay:true,date:range('2026-03-29')[0],endDate:range('2026-03-29')[1]});
  const content=exportCalendarIcs([source],{uid:'parent-a'}); assert.match(content,/DTEND;VALUE=DATE:20260330/);
  const imported=importCalendarIcs(content,{uid:'parent-a',person:'Sebastian'}).events[0];
  assert.equal(formatDateInput(imported.date),'2026-03-29'); assert.equal(formatDateInput(imported.endDate),'2026-03-29'); assert.equal(imported.allDay,true);
});
test('import informuje o nieobsługiwanych RRULE zamiast tworzyć błędną serię', () => {
  const result=importCalendarIcs('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART:20260101T090000Z\nDTEND:20260101T100000Z\nRRULE:FREQ=MONTHLY;BYDAY=1MO\nEND:VEVENT\nEND:VCALENDAR',{uid:'u',person:'family'});
  assert.equal(result.events.length,0); assert.equal(result.warnings.length,1);
  assert.throws(()=>importCalendarIcs('not calendar',{uid:'u',person:'family'}));
});
test('pełna edycja liczby wystąpień po podziale składa serię i zachowuje wcześniejsze wyjątki', () => {
  const original=event({repeatCount:8,recurrenceExceptions:[parseLocalDate('2026-01-02','09:00').toISOString()]}), start=parseLocalDate('2026-01-03','09:00');
  const split=planSeriesUpdate([original],original,start,'future',{...original,date:start,endDate:parseLocalDate('2026-01-03','10:00')}).upserts;
  const {id:_id,createdBy:_creator,seriesId:_series,...patch}={...split[1],repeatCount:10};
  const changed=planSeriesUpdate(split,split[1],start,'all',patch);
  assert.equal(changed.upserts.length,1); assert.equal(changed.deletes.length,1); assert.equal(changed.upserts[0].id,original.id);
  assert.equal(changed.upserts[0].repeatCount,10); assert.equal(generateOccurrences(changed.upserts[0],...range('2026-01-01','2026-01-20')).length,9);
});
test('ICS z datą końca i count po podziale nie generuje dodatkowych terminów', () => {
  const source=event({repeatCount:5}), original=parseLocalDate('2026-01-03','09:00');
  const split=planSeriesUpdate([source],source,original,'future',{...source,date:original,endDate:parseLocalDate('2026-01-03','10:00')}).upserts;
  const content=exportCalendarIcs(split,{uid:'parent-a'}), imported=importCalendarIcs(content,{uid:'parent-a',person:'Sebastian'});
  assert.deepEqual(imported.warnings,[]); assert.deepEqual(dates(imported.events.flatMap((item)=>generateOccurrences(item,...range('2026-01-01','2026-01-10')))),['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05']);
  const until=importCalendarIcs('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20260101T080000Z\nDTEND:20260101T090000Z\nRRULE:FREQ=DAILY;UNTIL=20260103T070000Z\nEND:VEVENT\nEND:VCALENDAR',{uid:'parent-a',person:'Sebastian'}).events[0];
  assert.deepEqual(dates(generateOccurrences(until,...range('2026-01-01','2026-01-05'))),['2026-01-01','2026-01-02']);
});
test('miesięczne końce miesiąca i 29 lutego są zgodne także w eksporcie i ponownym imporcie', () => {
  for(const source of [event({repeat:'monthly',date:parseLocalDate('2026-01-31','09:00'),endDate:parseLocalDate('2026-01-31','10:00')}),event({repeat:'yearly',date:parseLocalDate('2024-02-29','09:00'),endDate:parseLocalDate('2024-02-29','10:00')})]) {
    const content=exportCalendarIcs([source],{uid:'parent-a'}), parsed=importCalendarIcs(content,{uid:'parent-a',person:'Sebastian'});
    assert.deepEqual(parsed.warnings,[]); assert.match(content,/BYMONTHDAY=\d+,-1;BYSETPOS=1/);
    assert.deepEqual(dates(generateOccurrences(parsed.events[0],...range('2026-01-01','2028-12-31'))),dates(generateOccurrences(source,...range('2026-01-01','2028-12-31'))));
  }
});
test('strefa wydarzenia działa niezależnie od strefy urządzenia', () => {
  const previous=process.env.TZ;
  try {
    process.env.TZ='America/New_York';
    const source=event({date:new Date('2026-03-28T08:00:00Z'),endDate:new Date('2026-03-28T09:00:00Z'),timeZone:'Europe/Warsaw'});
    assert.equal(occurrenceDateAt(source,1).toISOString(),'2026-03-29T07:00:00.000Z');
  } finally { process.env.TZ=previous; }
});
