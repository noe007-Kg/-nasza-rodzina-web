export const SCHOOL_TYPES = ['lesson', 'homework', 'test', 'grade', 'message', 'activity'] as const;
export type SchoolType = typeof SCHOOL_TYPES[number];
export const SCHOOL_COLUMNS = ['person', 'type', 'title', 'subject', 'date', 'time', 'endTime', 'weekday', 'note'] as const;
export const SCHOOL_PEOPLE = ['Paweł', 'Nikodem', 'Layla'] as const;
export const MAX_SCHOOL_ROWS = 200;
export const MAX_SCHOOL_FILE_BYTES = 1024 * 1024;

export type SchoolEntry = {
  person: string;
  type: SchoolType;
  title: string;
  subject: string;
  date: string;
  time: string;
  endTime: string;
  weekday: number;
  note: string;
};

export function isSchoolType(value: unknown): value is SchoolType {
  return typeof value === 'string' && (SCHOOL_TYPES as readonly string[]).includes(value);
}

export function validSchoolDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return year >= 1900 && year <= 2200 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function normalizedString(value: unknown, name: string, limit: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new Error(`Pole „${name}” jest wymagane.`);
    return '';
  }
  if (typeof value !== 'string') throw new Error(`Pole „${name}” musi zawierać tekst.`);
  const result = value.trim().normalize('NFC');
  if (required && !result) throw new Error(`Pole „${name}” jest wymagane.`);
  if (result.length > limit) throw new Error(`Pole „${name}” może mieć najwyżej ${limit} znaków.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) throw new Error(`Pole „${name}” zawiera niedozwolone znaki.`);
  return result;
}

/** One validator serves the form and both import formats. No unknown document fields are accepted. */
export function validateSchoolEntry(value: unknown, allowedPeople: readonly string[] = SCHOOL_PEOPLE): SchoolEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Wpis musi być obiektem.');
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!(SCHOOL_COLUMNS as readonly string[]).includes(key)) throw new Error(`Nieznana kolumna „${key}”.`);
  }
  const person = normalizedString(row.person, 'person', 80, true);
  if (!allowedPeople.includes(person)) throw new Error(`Nieznana osoba „${person}”.`);
  if (!isSchoolType(row.type)) throw new Error('Nieprawidłowy type: użyj lesson, homework, test, grade, message lub activity.');
  const title = normalizedString(row.title, 'title', 160, true);
  const subject = normalizedString(row.subject, 'subject', 100);
  const date = normalizedString(row.date, 'date', 10);
  if (date && !validSchoolDate(date)) throw new Error('Nieprawidłowa data; użyj rzeczywistej daty RRRR-MM-DD.');
  const time = normalizedString(row.time, 'time', 5);
  const endTime = normalizedString(row.endTime, 'endTime', 5);
  for (const [name, text] of [['time', time], ['endTime', endTime]]) {
    if (text && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error(`Nieprawidłowe ${name}; użyj GG:MM.`);
  }
  const rawWeekday = row.weekday === '' || row.weekday === undefined || row.weekday === null ? 0 : row.weekday;
  if (typeof rawWeekday !== 'number' && !(typeof rawWeekday === 'string' && /^[0-7]$/.test(rawWeekday))) throw new Error('weekday musi być liczbą od 0 do 7.');
  const weekday = Number(rawWeekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 7) throw new Error('weekday musi być liczbą od 0 do 7.');
  const note = normalizedString(row.note, 'note', 2000);
  const scheduled = row.type === 'lesson' || row.type === 'activity';
  if (scheduled) {
    if (!date && !weekday) throw new Error('Lekcja lub zajęcia wymagają daty albo dnia tygodnia (1–7).');
    if (date && weekday) throw new Error('Wybierz konkretną datę albo dzień tygodnia, nie oba jednocześnie.');
    if (!time || !endTime) throw new Error('Lekcja lub zajęcia wymagają godziny rozpoczęcia i zakończenia.');
  } else {
    if (weekday) throw new Error('Dzień tygodnia jest dostępny tylko dla lekcji i zajęć dodatkowych.');
    if ((row.type === 'homework' || row.type === 'test') && !date) throw new Error('Zadanie lub sprawdzian wymagają daty.');
  }
  if (endTime && !time) throw new Error('Godzina zakończenia wymaga godziny rozpoczęcia.');
  if (time && endTime && endTime <= time) throw new Error('Godzina zakończenia musi być późniejsza niż rozpoczęcia.');
  return { person, type: row.type, title, subject, date, time, endTime, weekday, note };
}

/** RFC 4180 style CSV, with comma or semicolon separators and quoted multiline notes. */
function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const separator = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  const pushField = () => { row.push(field); field = ''; afterQuote = false; };
  const pushRow = () => { pushField(); if (row.some((cell) => cell.trim())) rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
    } else if (char === '"') {
      if (field || afterQuote) throw new Error('Nieprawidłowy cudzysłów w pliku CSV.');
      quoted = true;
    } else if (char === separator) pushField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      pushRow();
      if (rows.length > MAX_SCHOOL_ROWS + 1) throw new Error(`Plik może zawierać najwyżej ${MAX_SCHOOL_ROWS} wpisów.`);
    } else {
      if (afterQuote) throw new Error('Za zamkniętym cudzysłowem CSV powinien być separator lub koniec wiersza.');
      field += char;
    }
  }
  if (quoted) throw new Error('Niezamknięty cudzysłów w pliku CSV.');
  if (field || row.length || afterQuote) pushRow();
  return rows;
}

export function parseSchoolFile(text: string, extension: string, allowedPeople: readonly string[] = SCHOOL_PEOPLE): SchoolEntry[] {
  if (new TextEncoder().encode(text).byteLength > MAX_SCHOOL_FILE_BYTES) throw new Error('Plik jest za duży. Maksymalny rozmiar to 1 MB.');
  const source = text.replace(/^\uFEFF/, '');
  let values: unknown[];
  if (extension.toLowerCase().replace(/^\./, '') === 'json') {
    let json: unknown;
    try { json = JSON.parse(source); } catch { throw new Error('Nieprawidłowy JSON. Pobierz i uzupełnij szablon.'); }
    if (!Array.isArray(json)) throw new Error('JSON powinien być tablicą wpisów, tak jak w szablonie.');
    values = json;
  } else if (extension.toLowerCase().replace(/^\./, '') === 'csv') {
    const [header, ...rows] = parseCsv(source);
    if (!header || header.length !== SCHOOL_COLUMNS.length || header.some((column, index) => column.trim() !== SCHOOL_COLUMNS[index])) {
      throw new Error(`CSV wymaga nagłówka w kolejności: ${SCHOOL_COLUMNS.join(',')}.`);
    }
    values = rows.map((row, index) => {
      if (row.length !== header.length) throw new Error(`Wiersz ${index + 2}: oczekiwano ${header.length} kolumn, otrzymano ${row.length}.`);
      return Object.fromEntries(SCHOOL_COLUMNS.map((key, i) => [key, row[i]]));
    });
  } else throw new Error('Wybierz plik .csv albo .json.');
  if (!values.length) throw new Error('Plik nie zawiera żadnych wpisów.');
  if (values.length > MAX_SCHOOL_ROWS) throw new Error(`Plik może zawierać najwyżej ${MAX_SCHOOL_ROWS} wpisów.`);
  return values.map((row, index) => {
    try { return validateSchoolEntry(row, allowedPeople); }
    catch (error) { throw new Error(`Wpis ${index + 1}: ${error instanceof Error ? error.message : 'Nieprawidłowe dane.'}`); }
  });
}

/** Canonical object order makes IDs stable across row order, JSON key order and CSV/JSON formats. */
export async function schoolImportId(entry: SchoolEntry): Promise<string> {
  const canonical = SCHOOL_COLUMNS.map((key) => entry[key]);
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `import_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
