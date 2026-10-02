import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAssignments, normalizeGrades, normalizeMessages, normalizeTimetable,
  parseEduDate, parseEduTime, plainText } from '../server/edu-normalize.mjs';
import { prepareImportedSchoolItems } from '../server/edu-storage.mjs';

// Synthetic fixtures following the independently documented modern schema;
// these are not this family's authenticated data or a live API smoke test.
const gradeOptions = { profileId: 'profile-nikodem-school4', periodId: 'period-1' };
const gradeFixture = () => ({
  ustawienia: { isOcenaOpisowa: false, isSrednia: true },
  ocenyPrzedmioty: [{ przedmiotNazwa: 'Matematyka', srednia: 4.5,
    kolumnyOcenyCzastkowe: [{ idKolumny: 17, kategoriaKolumny: 'Sprawdzian', nazwaKolumny: 'Ułamki',
      oceny: [{ wpis: '3', dataOceny: '19.03.2026', nauczyciel: 'Anna', waga: 3 },
        { wpis: '5', dataOceny: '19.03.2026', nauczyciel: 'Anna', idOcenaPoprawiona: 77, waga: 3 }] }],
    proponowanaOcenaOkresowa: '5', ocenaOkresowa: '4', podsumowanieOcen: 'Bardzo dobre postępy.' }],
});

test('calendar dates and timetable clocks retain local day across DST', () => {
  assert.equal(parseEduDate('29.03.2026'), '2026-03-29');
  assert.equal(parseEduDate('2026-10-25T00:00:00+02:00'), '2026-10-25');
  assert.equal(parseEduTime('2026-10-25T08:10:00+01:00'), '08:10');
  assert.equal(parseEduTime('8:05'), '08:05');
  assert.equal(parseEduDate('29.02.2024'), '2024-02-29');
  for (const raw of ['31.02.2026', '2026-13-02', '29.02.2025', '19.03', '<html>login</html>']) assert.equal(parseEduDate(raw), '');
  for (const raw of ['24:00', '12:60', 'tomorrow', '2026-10-25']) assert.equal(parseEduTime(raw), '');
});

test('original grade and its correction coexist with stable IDs', () => {
  const result = normalizeGrades(gradeFixture(), gradeOptions);
  const partial = result.filter((item) => !item.externalId.startsWith('grade-period:'));
  assert.deepEqual(partial.map((item) => item.title), ['3', '5']);
  assert.equal(new Set(result.map((item) => item.externalId)).size, 5);
  assert.equal(partial[0].date, '2026-03-19');
  assert.match(partial[0].note, /Sprawdzian · Ułamki/);
  assert.match(partial[0].note, /Średnia podana przez dziennik: 4.5/);
  assert.ok(result.every((item) => item.providerScopeId === 'grades:period-1'));
  const reordered = gradeFixture();
  reordered.ocenyPrzedmioty[0].kolumnyOcenyCzastkowe[0].oceny.reverse();
  reordered.ocenyPrzedmioty[0].kolumnyOcenyCzastkowe[0].oceny[0].zmienionaOdOstatniegoLogowania = true;
  assert.deepEqual(normalizeGrades(reordered, gradeOptions).map((item) => item.externalId).sort(), result.map((item) => item.externalId).sort());
  assert.notEqual(normalizeGrades(gradeFixture(), { ...gradeOptions, periodId: 'period-2' })[0].externalId, result[0].externalId);
});

test('upstream grade ID and period summaries remain stable after editing', () => {
  const fixture = gradeFixture();
  fixture.ocenyPrzedmioty[0].kolumnyOcenyCzastkowe[0].oceny[0].idOcena = 912;
  const before = normalizeGrades(fixture, gradeOptions);
  fixture.ocenyPrzedmioty[0].kolumnyOcenyCzastkowe[0].oceny[0].wpis = '4+';
  fixture.ocenyPrzedmioty[0].ocenaOkresowa = '5';
  const after = normalizeGrades(fixture, gradeOptions);
  assert.equal(before[0].externalId, after[0].externalId);
  assert.equal(before[3].externalId, after[3].externalId);
});

test('descriptive and historical compatible flat grades stay textual', () => {
  const description = 'Uczeń potrafi samodzielnie dodawać. '.repeat(30);
  const result = normalizeGrades({ data: { ustawienia: { isOcenaOpisowa: true, isSrednia: false },
    ocenyPrzedmioty: [{ przedmiotNazwa: 'Edukacja wczesnoszkolna', srednia: 0,
      ocenyCzastkowe: [{ wpis: description, dataOceny: '19.03.2026', kategoriaKolumny: 'Opis', waga: 0 }],
      podsumowanieOcen: '<p>Samodzielnie pracuje &amp; pomaga.</p>' }] } }, gradeOptions);
  assert.equal(result.length, 2);
  assert.equal(result[0].title.length, 500);
  assert.ok(result[0].note.includes(description.trim()));
  assert.match(result[0].note, /Ocena opisowa/);
  assert.doesNotMatch(result[0].note, /Średnia/);
  assert.equal(result[1].title, 'Podsumowanie ocen: Samodzielnie pracuje & pomaga.');
});

test('plan preserves simultaneous lessons, cancellations and amendments', () => {
  const lesson = { data: '2026-10-25T00:00:00', godzinaOd: '2026-10-25T08:00:00', godzinaDo: '2026-10-25T08:45:00',
    przedmiot: 'Matematyka', prowadzacy: 'Anna', sala: '4', adnotacja: 3,
    zmiany: [{ dzien: '2026-10-26T00:00:00', godzinaOd: '2026-10-26T09:00:00', godzinaDo: '2026-10-26T09:45:00',
      zajecia: 'Matematyka', informacjeNieobecnosc: 'Przeniesiona na poniedziałek', zmiana: 2 }] };
  const result = normalizeTimetable([lesson, { ...lesson, przedmiot: 'Język polski', prowadzacy: 'Jan', adnotacja: 1 }, lesson]);
  assert.equal(result.length, 2);
  assert.notEqual(result[0].externalId, result[1].externalId);
  assert.deepEqual([result[0].date, result[0].time, result[0].endTime, result[0].weekday], ['2026-10-25', '08:00', '08:45', 0]);
  assert.match(result[0].note, /Lekcja odwołana/);
  assert.match(result[0].note, /2026-10-26 · 09:00–09:45/);
  assert.ok(result.every((item) => item.providerScopeId === 'timetable'));
  assert.equal(normalizeTimetable([{ ...lesson, zrealizowane: true, adnotacja: 0 }])[0].externalId, result[0].externalId);
});

test('homework uses due date and tests retain confirmed separate types', () => {
  const result = normalizeAssignments({ data: [
    { id: 24, typ: 4, przedmiotNazwa: 'Przyroda', data: '2026-10-01', terminOdpowiedzi: '2026-10-05T00:00:00',
      opis: '<p>Przeczytaj rozdział.</p><p>Zapisz odpowiedzi.</p>', nauczycielImieNazwisko: 'Anna', hasAttachment: true },
    { id: 24, typ: 2, przedmiotNazwa: 'Przyroda', data: '2026-10-06', opis: 'Fotosynteza' },
    { id: 99, typ: 77, przedmiotNazwa: 'Nieznany typ', data: '2026-10-02' },
  ] });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => [item.type, item.date]), [['homework', '2026-10-05'], ['test', '2026-10-06']]);
  assert.notEqual(result[0].externalId, result[1].externalId);
  assert.match(result[0].note, /Przeczytaj rozdział.\nZapisz odpowiedzi./);
  assert.match(result[0].note, /Załączniki/);
});

test('message detail keeps the full bounded body as plain text without loading images', () => {
  const raw = [{ apiGlobalKey: 'mail-1', data: '2026-10-01T12:25:00', temat: '<b>Zebranie</b>',
    korespondenci: 'Anna &amp; Jan', przeczytana: false, hasZalaczniki: true }];
  const body = '<p>Dzień dobry &amp; witam.</p><script>fetch("https://tracker.invalid")</script><img src="https://tracker.invalid/pixel">'
    + '<p>' + 'Pełna treść. '.repeat(300) + '</p><p>Porównanie &lt;a&gt; i &#x62;.</p>';
  const details = new Map([['mail-1', { tresc: body }]]);
  const before = JSON.stringify(raw);
  const result = normalizeMessages(raw, details);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(result[0].title, 'Zebranie');
  assert.equal(result[0].sender, 'Anna & Jan');
  assert.equal(result[0].time, '12:25');
  assert.equal(result[0].read, false);
  assert.ok(result[0].note.length > 3000);
  assert.match(result[0].note, /Porównanie <a> i b./);
  assert.doesNotMatch(result[0].note, /fetch|tracker\.invalid|<script|<img/);
  assert.equal(normalizeMessages([{ ...raw[0], przeczytana: true }], details)[0].externalId, result[0].externalId);
  const detailFallback = normalizeMessages([{ apiGlobalKey: 'mail-2', temat: '' }], { 'mail-2': {
    apiGlobalKey: 'mail-2', nadawca: 'Dyrektor', data: '2026-10-02T10:00:00', temat: 'Ogłoszenie', odczytana: true,
    tresc: 'Treść', zalaczniki: [{ nazwaPliku: 'Program.pdf', url: 'https://external.invalid' }] } });
  assert.deepEqual([detailFallback[0].sender, detailFallback[0].date, detailFallback[0].title, detailFallback[0].read], ['Dyrektor', '2026-10-02', 'Ogłoszenie', true]);
  assert.match(detailFallback[0].note, /Załączniki/);
  assert.doesNotMatch(detailFallback[0].note, /external\.invalid/);
  assert.throws(() => normalizeMessages(raw, { 'mail-1': { apiGlobalKey: 'mail-other' } }));
});

test('malformed upstream responses fail instead of masquerading as empty snapshots', () => {
  for (const normalizer of [normalizeTimetable, normalizeAssignments, normalizeMessages]) {
    for (const raw of ['<html>login</html>', null, {}, { data: '<html>session expired</html>' }, [null]]) {
      assert.throws(() => normalizer(raw), (error) => error.code === 'EDU_SCHEMA_CHANGED' && error.status === 502);
    }
    assert.deepEqual(normalizer([]), []);
  }
  assert.throws(() => normalizeGrades({ error: 'denied' }, gradeOptions), /nierozpoznany format/);
  assert.throws(() => normalizeGrades({ ocenyPrzedmioty: [{}] }, gradeOptions));
  assert.throws(() => normalizeGrades({ ocenyPrzedmioty: [{ kolumnyOcenyCzastkowe: '<html>' }] }, gradeOptions));
  assert.throws(() => normalizeTimetable([{ data: '2026-10-01', godzinaOd: 'not a clock', godzinaDo: '08:45' }]));
  assert.throws(() => normalizeAssignments([{ typ: 4, data: '2026-10-01' }]));
  assert.deepEqual(normalizeGrades({ ocenyPrzedmioty: [] }, gradeOptions), []);
  assert.throws(() => normalizeMessages([{ temat: 'No key' }]));
});

test('normalizer output is compatible with storage and keeps messages parent-only', () => {
  const items = [...normalizeGrades(gradeFixture(), gradeOptions),
    ...normalizeMessages([{ apiGlobalKey: 'mail-1', data: '2026-10-01', temat: 'Ważne', korespondenci: 'Nauczyciel' }], { 'mail-1': { tresc: 'Treść' } })];
  const prepared = prepareImportedSchoolItems('parent-uid', { personKey: 'Nikodem', profileId: gradeOptions.profileId, items, syncId: 'sync-fixture' });
  assert.equal(prepared.length, 6);
  assert.equal(prepared.filter((item) => item.collection === 'schoolParentMessages').length, 1);
  assert.equal(prepared.at(-1).data.note, 'Treść');
  assert.ok(prepared.every((item) => !item.data.title.includes('<script')));
});

test('plain text conversion is bounded and strips executable embedded blocks', () => {
  assert.equal(plainText('<div>Hello<br>world</div><style>body{}</style><iframe src="x">hidden</iframe> &copy; &#322;'), 'Hello\nworld\n© ł');
  assert.equal(plainText('<script>unclosed secret'), '');
  assert.equal(plainText('x'.repeat(30000)).length, 20000);
  assert.equal(plainText('<p>A</p><p>B</p>'), 'A\nB');
});
