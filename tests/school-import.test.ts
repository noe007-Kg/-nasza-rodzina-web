import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MAX_SCHOOL_FILE_BYTES, parseSchoolFile, schoolImportId, validateSchoolEntry } from '../src/school-import.ts';

const lesson = { person: 'Nikodem', type: 'lesson', title: 'Matematyka', subject: 'Matematyka', date: '', time: '08:00', endTime: '08:45', weekday: 1, note: 'Sala 12' };
test('CSV and JSON templates produce identical valid entries and deterministic IDs', async () => {
  const csv = parseSchoolFile(await readFile(new URL('../public/szkola-szablon.csv', import.meta.url), 'utf8'), 'csv');
  const json = parseSchoolFile(await readFile(new URL('../public/szkola-szablon.json', import.meta.url), 'utf8'), 'json');
  assert.deepEqual(csv, json);
  assert.equal(await schoolImportId(csv[0]), await schoolImportId(json[0]));
  assert.notEqual(await schoolImportId(csv[0]), await schoolImportId({ ...json[0], note: 'Sala 13' }));
});
test('quoted CSV handles delimiters, quotes, multiline notes and UTF-8 BOM', () => {
  const text = '\uFEFFperson,type,title,subject,date,time,endTime,weekday,note\r\nNikodem,lesson,"Matematyka, test",Matematyka,,08:00,08:45,1,"Sala ""12""\nZeszyt"';
  const [row] = parseSchoolFile(text, 'csv');
  assert.equal(row.title, 'Matematyka, test');
  assert.equal(row.note, 'Sala "12"\nZeszyt');
  assert.equal(parseSchoolFile(text.replaceAll(',', ';').replace('Matematyka; test', 'Matematyka, test'), 'csv')[0].title, 'Matematyka, test');
});
test('a whole import is rejected if any row is invalid', () => {
  assert.throws(() => parseSchoolFile(JSON.stringify([lesson, { ...lesson, date: '2026-02-30', weekday: 0 }]), 'json'), /Wpis 2.*data/);
  assert.throws(() => parseSchoolFile(JSON.stringify([{ ...lesson, createdBy: 'attacker' }]), 'json'), /Nieznana kolumna/);
  assert.throws(() => parseSchoolFile(JSON.stringify([{ ...lesson, person: 'Obca osoba' }]), 'json'), /Nieznana osoba/);
  assert.throws(() => parseSchoolFile(JSON.stringify([{ ...lesson, person: 'Dominika' }]), 'json'), /Nieznana osoba/);
  assert.throws(() => parseSchoolFile(JSON.stringify([lesson]), 'json', ['Paweł']), /Nieznana osoba/);
});
test('file shape, row limit and byte limit are enforced', () => {
  assert.throws(() => parseSchoolFile('{}', 'json'), /tablicą/);
  assert.throws(() => parseSchoolFile('[]', 'json'), /żadnych/);
  assert.throws(() => parseSchoolFile(JSON.stringify(Array.from({ length: 201 }, () => lesson)), 'json'), /200/);
  assert.throws(() => parseSchoolFile('x'.repeat(MAX_SCHOOL_FILE_BYTES + 1), 'csv'), /1 MB/);
  assert.throws(() => parseSchoolFile('person,title\nNikodem,Test', 'csv'), /nagłówka/);
  assert.throws(() => parseSchoolFile('person,type,title,subject,date,time,endTime,weekday,note\nNikodem,lesson,"missing', 'csv'), /Niezamknięty/);
});
test('real dates, one-off activities, weekly activities and increasing times are required', () => {
  assert.equal(validateSchoolEntry({ ...lesson, type: 'activity', weekday: 0, date: '2028-02-29' }).date, '2028-02-29');
  assert.equal(validateSchoolEntry({ ...lesson, type: 'activity', weekday: 7 }).weekday, 7);
  assert.throws(() => validateSchoolEntry({ ...lesson, date: '2026-10-01' }), /oba/);
  assert.throws(() => validateSchoolEntry({ ...lesson, weekday: 0 }), /dnia tygodnia/);
  assert.throws(() => validateSchoolEntry({ ...lesson, endTime: '07:00' }), /późniejsza/);
  assert.throws(() => validateSchoolEntry({ ...lesson, time: '25:00' }), /GG:MM/);
  assert.throws(() => validateSchoolEntry({ ...lesson, weekday: 1.5 }), /od 0 do 7/);
  assert.throws(() => validateSchoolEntry({ ...lesson, type: 'homework', weekday: 0 }), /wymagają daty/);
  assert.throws(() => validateSchoolEntry({ ...lesson, title: 'x'.repeat(161) }), /160/);
});
