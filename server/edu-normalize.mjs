import { createHash } from 'node:crypto';
import { EduServerError } from './edu-auth.mjs';

// Independently written from the documented public schemas in
// integration-research/schemas. These helpers never fetch or mutate the diary.
const BODY_LIMIT = 20000;
const INPUT_LIMIT = 200000;
const ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€' });
const PLAN_STATUSES = Object.freeze({ 1: 'Zastępstwo', 2: 'Lekcja przeniesiona', 3: 'Lekcja odwołana', 4: 'Nieobecność nauczyciela' });
const ASSIGNMENT_TYPES = Object.freeze({ 1: 'Sprawdzian', 2: 'Kartkówka', 3: 'Klasówka', 4: 'Zadanie domowe' });

function schemaError() {
  return new EduServerError('EDU_SCHEMA_CHANGED', 502, 'Dziennik zwrócił nierozpoznany format danych. Ostatnie pobrane dane pozostają zachowane.');
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function literal(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** Plain text only: the result must never be passed to an HTML renderer. */
export function plainText(value, limit = BODY_LIMIT) {
  const raw = literal(value).slice(0, INPUT_LIMIT);
  const text = raw
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|iframe|object|svg|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<(?:br|hr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|section|article|table)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi, (entity, name) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
      const hex = name[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    })
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\t\f\v \u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, Math.max(0, Math.min(limit, BODY_LIMIT)));
}

function compact(value, limit = 500) {
  return plainText(value, limit).replace(/\s+/g, ' ').trim();
}

function alreadyPlain(value, limit = 500) {
  return literal(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Keep the calendar date issued by the school; never shift it through UTC. */
export function parseEduDate(value) {
  const text = literal(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(text);
  const polish = /^(\d{2})\.(\d{2})\.(\d{4})(?:$|\s)/.exec(text);
  if (!iso && !polish) return '';
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(polish[3]), Number(polish[2]), Number(polish[1])];
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** API timetable timestamps encode the displayed local school clock. */
export function parseEduTime(value) {
  const text = literal(value).trim();
  const match = /(?:^|T|\s)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:$|Z|[+-]\d{2}:?\d{2})/.exec(text);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function asArray(raw) {
  // A documented transport envelope is accepted; an unknown object/HTML page
  // is a failed section, never a successful empty snapshot.
  const data = object(raw) && Array.isArray(raw.data) ? raw.data : raw;
  if (!Array.isArray(data) || data.some((entry) => !object(entry))) throw schemaError();
  return data;
}

function optionalArray(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((entry) => !object(entry))) throw schemaError();
  return value;
}

function stableId(prefix, supplied, identity) {
  const upstream = literal(supplied).trim();
  return upstream && upstream.length <= 300
    ? `${prefix}:${upstream}`
    : `${prefix}:sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

function joinNotes(lines) {
  return lines.filter((line) => typeof line === 'string' && line.trim()).join('\n').slice(0, BODY_LIMIT);
}

function invalidDateNote(value, parsed) {
  return !parsed && literal(value).trim() ? `Data w dzienniku: ${compact(value, 150)}` : '';
}

function averageNote(entry, settings) {
  if (settings?.isSrednia !== true && settings?.isSredniaAndPunkty !== true) return '';
  return typeof entry.srednia === 'number' && Number.isFinite(entry.srednia)
    ? `Średnia podana przez dziennik: ${entry.srednia}` : '';
}

function base(type, externalId, { title, subject = '', date = '', time = '', endTime = '', note = '' }) {
  // Callers have converted upstream fields once. Re-parsing already plain text
  // would destroy literal mathematical text such as decoded "<a>".
  return { type, externalId, sourceRecordId: externalId, title: alreadyPlain(title) || 'Wpis z dziennika',
    subject: alreadyPlain(subject, 300), date, time, endTime, weekday: 0, note: literal(note).slice(0, BODY_LIMIT) };
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type}:${item.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Detailed Oceny response; compatible flat StudentPlus grades are explicit fallback. */
export function normalizeGrades(raw, { profileId, periodId = '' } = {}) {
  const response = object(raw) && object(raw.data) && Array.isArray(raw.data.ocenyPrzedmioty) ? raw.data : raw;
  if (!object(response) || !Array.isArray(response.ocenyPrzedmioty) || response.ocenyPrzedmioty.some((entry) => !object(entry))) throw schemaError();
  if (typeof profileId !== 'string' || !profileId.trim()) throw schemaError();
  const items = [];
  for (const entry of response.ocenyPrzedmioty) {
    const subject = compact(entry.przedmiotNazwa, 300);
    if (!subject) throw schemaError();
    const columns = optionalArray(entry.kolumnyOcenyCzastkowe);
    const grouped = columns.length
      ? columns.map((column) => ({ column, grades: optionalArray(column.oceny) }))
      : [{ column: {}, grades: optionalArray(entry.ocenyCzastkowe) }];
    for (const { column, grades } of grouped) {
      for (const grade of grades) {
        if (typeof grade.wpis !== 'string' && typeof grade.wpis !== 'number') throw schemaError();
        const value = plainText(grade.wpis);
        if (!value) continue;
        const columnId = grade.idKolumny ?? column.idKolumny ?? '';
        const date = parseEduDate(grade.dataOceny);
        const category = compact(grade.kategoriaKolumny ?? column.kategoriaKolumny);
        const columnName = compact(grade.nazwaKolumny ?? column.nazwaKolumny);
        const teacher = compact(grade.nauczyciel, 300);
        const externalId = stableId('grade', '', [profileId, literal(periodId), subject,
          // Scope any supplied grade ID to pupil/period/subject to avoid legacy ID collisions.
          grade.idOcena ?? grade.id ?? null,
          (grade.idOcena ?? grade.id) == null ? [columnId, literal(grade.dataOceny), value, grade.idOcenaPoprawiona ?? null, category, columnName, teacher] : null]);
        items.push(base('grade', externalId, { title: value, subject, date,
          note: joinNotes([value.length > 500 ? value : '',
            [category, columnName].filter(Boolean).join(' · '),
            teacher ? `Nauczyciel: ${teacher}` : '',
            literal(grade.waga) ? `Waga w dzienniku: ${compact(grade.waga, 100)}` : '',
            averageNote(entry, response.ustawienia),
            response.ustawienia?.isOcenaOpisowa === true ? 'Ocena opisowa' : '',
            invalidDateNote(grade.dataOceny, date)]) }));
      }
    }
    // A subject such as behaviour can have no partial grades but still contain
    // period assessments. Their IDs remain stable when the value changes.
    for (const [field, label] of [['proponowanaOcenaOkresowa', 'Proponowana ocena okresowa'], ['ocenaOkresowa', 'Ocena okresowa'], ['podsumowanieOcen', 'Podsumowanie ocen']]) {
      const value = plainText(entry[field]);
      if (!value) continue;
      const externalId = stableId('grade-period', '', [profileId, literal(periodId), subject, field]);
      items.push(base('grade', externalId, { title: `${label}: ${value}`, subject,
        note: joinNotes([`${label}: ${value}`, averageNote(entry, response.ustawienia), response.ustawienia?.isOcenaOpisowa === true ? 'Ocena opisowa' : '']) }));
    }
  }
  return unique(items).map((item) => ({ ...item, providerScopeId: `grades:${literal(periodId)}` }));
}

function changeNote(change) {
  return [compact(change.zajecia, 300), parseEduDate(change.dzien),
    [parseEduTime(change.godzinaOd), parseEduTime(change.godzinaDo)].filter(Boolean).join('–'),
    compact(change.prowadzacy, 300), compact(change.sala, 100) ? `sala ${compact(change.sala, 100)}` : '',
    compact(change.informacjeNieobecnosc, 1000), PLAN_STATUSES[Number(change.zmiana)] || ''].filter(Boolean).join(' · ');
}

/** Dated lessons including cancellation/move notes; they are never weekly recurrences. */
export function normalizeTimetable(raw) {
  const items = asArray(raw).map((entry) => {
    const subject = compact(entry.przedmiot, 300) || 'Lekcja';
    const date = parseEduDate(entry.data);
    const time = parseEduTime(entry.godzinaOd);
    const endTime = parseEduTime(entry.godzinaDo);
    // A malformed row makes the dated snapshot incomplete. Reject the entire
    // section so its old successful cache cannot be pruned accidentally.
    if (!date || !time || !endTime) throw schemaError();
    const teacher = compact(entry.prowadzacy, 300);
    const changes = optionalArray(entry.zmiany);
    const externalId = stableId('lesson', '', [literal(entry.data), literal(entry.godzinaOd),
      literal(entry.godzinaDo), subject, teacher, entry.idJednostkaSkladowa ?? '', entry.dodatkowe === true]);
    return base('lesson', externalId, { title: subject, subject, date, time, endTime,
      note: joinNotes([PLAN_STATUSES[Number(entry.adnotacja)] || '',
        teacher ? `Nauczyciel: ${teacher}` : '', compact(entry.sala, 100) ? `Sala: ${compact(entry.sala, 100)}` : '',
        entry.dodatkowe === true ? 'Dodatkowe zajęcia' : '',
        ...changes.map(changeNote), invalidDateNote(entry.data, date),
        !time && literal(entry.godzinaOd) ? `Godzina w dzienniku: ${compact(entry.godzinaOd, 150)}` : '']) });
  });
  return unique(items).map((item) => ({ ...item, providerScopeId: 'timetable' }));
}

/** The provider merges each GET detail object onto its original list entry first. */
export function normalizeAssignments(raw) {
  const items = [];
  for (const entry of asArray(raw)) {
    const kind = Number(entry.typ);
    const label = ASSIGNMENT_TYPES[kind];
    // Only confirmed list codes are mapped. Unknown future codes are not called tests.
    if (!label) continue;
    if (!literal(entry.id).trim()) throw schemaError();
    const type = kind === 4 ? 'homework' : 'test';
    const subject = compact(entry.przedmiotNazwa, 300);
    const body = plainText(entry.opis || entry.temat || entry.tresc);
    const dateRaw = kind === 4 ? entry.terminOdpowiedzi || entry.data : entry.data;
    const date = parseEduDate(dateRaw);
    const title = body ? alreadyPlain(body.split('\n')[0]) : [label, subject].filter(Boolean).join(' · ');
    const externalId = stableId(`agenda-${kind}`, entry.id, [kind, literal(dateRaw), subject, body]);
    items.push(base(type, externalId, { title, subject, date,
      note: joinNotes([label, body, compact(entry.nauczycielImieNazwisko, 300) ? `Nauczyciel: ${compact(entry.nauczycielImieNazwisko, 300)}` : '',
        entry.hasAttachment === true ? 'Załączniki dostępne w oficjalnym dzienniku.' : '',
        invalidDateNote(dateRaw, date)]) }));
  }
  return unique(items);
}

function messageDetail(detailsMap, key) {
  const value = detailsMap instanceof Map ? detailsMap.get(key) : object(detailsMap) && Object.hasOwn(detailsMap, key) ? detailsMap[key] : undefined;
  if (value == null) return {};
  if (!object(value)) throw schemaError();
  return object(value.data) ? value.data : value;
}

/** Inbox must already be restricted to Context.globalKeySkrzynka of the chosen pupil. */
export function normalizeMessages(raw, detailsMap) {
  const items = asArray(raw).map((entry) => {
    const key = literal(entry.apiGlobalKey).trim();
    if (!key) throw schemaError();
    const detail = messageDetail(detailsMap, key);
    if (literal(detail.apiGlobalKey) && literal(detail.apiGlobalKey) !== key) throw schemaError();
    const body = plainText(detail.tresc ?? entry.tresc);
    const dateRaw = entry.data || detail.data;
    const date = parseEduDate(dateRaw);
    const externalId = stableId('message', key, [key]);
    const sender = compact(detail.nadawca || entry.korespondenci, 300);
    const attachments = optionalArray(detail.zalaczniki);
    return { ...base('message', externalId, { title: compact(entry.temat || detail.temat) || 'Wiadomość ze szkoły', date,
      time: parseEduTime(dateRaw),
      note: joinNotes([body, entry.hasZalaczniki === true || attachments.length ? 'Załączniki dostępne w oficjalnym dzienniku.' : '', invalidDateNote(dateRaw, date)]) }),
      sender, read: typeof entry.przeczytana === 'boolean' ? entry.przeczytana : detail.odczytana === true };
  });
  return unique(items);
}
