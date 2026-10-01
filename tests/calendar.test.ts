import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addMonths, addYears, endOfDay, formatDateInput, formatTimeInput,
  generateOccurrences, occurrenceAt, parseLocalDate, sameDay, startOfDay, startOfWeek,
  type RecurringEvent,
} from '../src/calendar-utils';

process.env.TZ = 'Europe/Warsaw';

function event(overrides: Partial<RecurringEvent> = {}): RecurringEvent {
  return {
    id: 'calendar-test', date: parseLocalDate('2026-01-01', '09:00'),
    endDate: parseLocalDate('2026-01-01', '10:00'), allDay: false,
    repeat: 'daily', repeatUntil: null, ...overrides,
  };
}

function range(start: string, end = start) {
  return [startOfDay(parseLocalDate(start, '12:00')), endOfDay(parseLocalDate(end, '12:00'))] as const;
}

test('miesięczna seria z 31 stycznia wraca do 31 marca i uwzględnia luty przestępny', () => {
  const base = parseLocalDate('2024-01-31', '09:00');
  assert.equal(formatDateInput(addMonths(base, 1)), '2024-02-29');
  assert.equal(formatDateInput(occurrenceAt(base, 'monthly', 2)), '2024-03-31');
  assert.equal(formatDateInput(addMonths(parseLocalDate('2026-03-31', '09:00'), -1)), '2026-02-28');
  assert.equal(formatDateInput(base), '2024-01-31');
});

test('coroczne wydarzenie 29 lutego działa również w nieprzestępnym roku', () => {
  const base = parseLocalDate('2024-02-29', '09:00');
  assert.equal(formatDateInput(addYears(base, 1)), '2025-02-28');
  assert.equal(formatDateInput(occurrenceAt(base, 'yearly', 4)), '2028-02-29');
});

test('tydzień zaczyna się w poniedziałek również dla niedzieli i na granicy roku', () => {
  assert.equal(formatDateInput(startOfWeek(parseLocalDate('2026-01-04', '18:30'))), '2025-12-29');
  assert.equal(formatTimeInput(startOfWeek(parseLocalDate('2026-01-04', '18:30'))), '00:00');
});

test('dodawanie dni zachowuje lokalną godzinę podczas obu zmian czasu', () => {
  const beforeSpring = parseLocalDate('2026-03-28', '09:00');
  const afterSpring = addDays(beforeSpring, 1);
  assert.equal(formatTimeInput(afterSpring), '09:00');
  assert.equal(afterSpring.getTime() - beforeSpring.getTime(), 23 * 3_600_000);
  const beforeAutumn = parseLocalDate('2026-10-24', '09:00');
  const afterAutumn = addDays(beforeAutumn, 1);
  assert.equal(formatTimeInput(afterAutumn), '09:00');
  assert.equal(afterAutumn.getTime() - beforeAutumn.getTime(), 25 * 3_600_000);
});

test('codzienna seria sprzed 16 lat pozostaje widoczna i generuje tylko żądany zakres', () => {
  const recurring = event({ date: parseLocalDate('2010-01-01', '01:00'), endDate: parseLocalDate('2010-01-01', '02:00') });
  const occurrences = generateOccurrences(recurring, ...range('2026-09-30', '2026-10-02'));
  assert.deepEqual(occurrences.map((row) => formatDateInput(row.date)), ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.ok(occurrences.every((row) => formatTimeInput(row.date) === '01:00'));
});

test('data końca powtarzania jest włączona, ale kolejne dni nie są generowane', () => {
  const occurrences = generateOccurrences(event({ repeatUntil: parseLocalDate('2026-01-03', '00:00') }), ...range('2026-01-01', '2026-01-06'));
  assert.deepEqual(occurrences.map((row) => formatDateInput(row.date)), ['2026-01-01', '2026-01-02', '2026-01-03']);
  assert.deepEqual(generateOccurrences(event({ repeatUntil: parseLocalDate('2025-12-31', '12:00') }), ...range('2026-01-01')), []);
});

for (const transition of ['2026-03-29', '2026-10-25']) {
  test(`całodzienne wystąpienie ${transition} kończy się tego samego lokalnego dnia`, () => {
    const recurring = event({
      date: startOfDay(parseLocalDate('2026-01-01', '12:00')),
      endDate: endOfDay(parseLocalDate('2026-01-01', '12:00')), allDay: true,
    });
    const rows = generateOccurrences(recurring, ...range(transition));
    assert.equal(rows.length, 1);
    assert.equal(formatDateInput(rows[0].date), transition);
    assert.ok(sameDay(rows[0].date, rows[0].endDate));
    assert.equal(rows[0].endDate.getHours(), 23);
    assert.equal(rows[0].endDate.getMilliseconds(), 999);
  });
}

test('wielodniowa cotygodniowa seria zachowuje godzinę końca po zmianie czasu', () => {
  const rows = generateOccurrences(event({
    date: parseLocalDate('2026-03-28', '22:00'),
    endDate: parseLocalDate('2026-03-29', '08:00'), repeat: 'weekly',
  }), ...range('2026-04-04', '2026-04-05'));
  assert.equal(rows.length, 1);
  assert.equal(formatDateInput(rows[0].endDate), '2026-04-05');
  assert.equal(formatTimeInput(rows[0].endDate), '08:00');
});

test('jednorazowe wydarzenie przecinające granicę widoku jest widoczne bez duplikatu', () => {
  const single = event({ date: parseLocalDate('2026-01-01', '23:00'), endDate: parseLocalDate('2026-01-02', '02:00'), repeat: 'none' });
  assert.equal(generateOccurrences(single, ...range('2026-01-02')).length, 1);
  assert.equal(generateOccurrences(single, ...range('2026-01-03')).length, 0);
});

test('seria nie generuje terminów przed początkiem, błędne zakresy nie zawieszają pętli', () => {
  assert.deepEqual(generateOccurrences(event(), ...range('2025-12-28', '2025-12-31')), []);
  assert.deepEqual(generateOccurrences(event({ date: new Date('invalid') }), ...range('2026-01-01')), []);
  assert.deepEqual(generateOccurrences(event({ endDate: parseLocalDate('2025-12-31', '12:00') }), ...range('2026-01-01')), []);
  assert.deepEqual(generateOccurrences(event(), new Date('2026-01-03'), new Date('2026-01-01')), []);
});

test('miesięczne i roczne serie wyszukują stare początki bez limitu 2000 wystąpień', () => {
  const monthly = event({ date: parseLocalDate('1900-01-31', '09:00'), endDate: parseLocalDate('1900-01-31', '10:00'), repeat: 'monthly' });
  assert.deepEqual(generateOccurrences(monthly, ...range('2100-02-01', '2100-03-31')).map((row) => formatDateInput(row.date)), ['2100-02-28', '2100-03-31']);
  const yearly = event({ date: parseLocalDate('2000-02-29', '09:00'), endDate: parseLocalDate('2000-02-29', '10:00'), repeat: 'yearly' });
  assert.deepEqual(generateOccurrences(yearly, ...range('2027-01-01', '2027-12-31')).map((row) => formatDateInput(row.date)), ['2027-02-28']);
});
