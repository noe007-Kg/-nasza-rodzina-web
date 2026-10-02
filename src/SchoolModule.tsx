import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from 'firebase/auth';
import { collection, deleteField, doc, getDoc, onSnapshot, query, Timestamp, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { EduVulcanConnection } from './EduVulcanConnection';
import { isSchoolType, MAX_SCHOOL_FILE_BYTES, MAX_SCHOOL_ROWS, parseSchoolFile, SCHOOL_PEOPLE, SCHOOL_TYPES, schoolImportId, validateSchoolEntry } from './school-import';
import type { SchoolEntry, SchoolType } from './school-import';
import './school.css';

type SchoolMember = { name?: string; role?: string; personKey?: string };
type SchoolRecord = SchoolEntry & {
  id: string; calendarEventId?: string; calendarCreatedBy?: string; createdBy?: string; createdAt?: Date;
  source?: string; syncedAt?: Date; parentOnly?: boolean;
};
type SchoolForm = SchoolEntry & { scheduleMode: 'weekly' | 'date'; addToCalendar: boolean; calendarDate: string };
const META: Record<SchoolType, { title: string; singular: string; icon: string }> = {
  lesson: { title: 'Plan lekcji', singular: 'Lekcja', icon: '📚' },
  homework: { title: 'Zadania domowe', singular: 'Zadanie domowe', icon: '📝' },
  test: { title: 'Sprawdziany', singular: 'Sprawdzian', icon: '📅' },
  grade: { title: 'Oceny', singular: 'Ocena', icon: '⭐' },
  message: { title: 'Wiadomości', singular: 'Wiadomość', icon: '💬' },
  activity: { title: 'Zajęcia dodatkowe', singular: 'Zajęcia dodatkowe', icon: '🎯' },
};
const WEEKDAYS = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
const CHILD_TYPES: SchoolType[] = ['lesson', 'homework', 'test', 'activity'];
const DEFAULT_STUDENTS = ['Paweł', 'Nikodem', 'Layla'];

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function localDate(key: string, time = '00:00'): Date {
  const [year, month, day] = key.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}
function weekdayOf(key: string): number { return localDate(key).getDay() || 7; }
function moveDate(key: string, days: number): string {
  const value = localDate(key); value.setDate(value.getDate() + days); return dateKey(value);
}
function shortDate(key: string): string {
  return key ? localDate(key).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) : 'Bez daty';
}
function nextWeekday(day: number): string {
  const today = dateKey(new Date()); return moveDate(today, (day - weekdayOf(today) + 7) % 7);
}
function errorText(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  if (code.includes('permission-denied')) return 'Brak uprawnień do danych szkolnych. Sprawdź przypisanie konta i reguły Firebase.';
  if (code.includes('unavailable') || code.includes('network')) return 'Nie udało się połączyć. Sprawdź internet i spróbuj ponownie.';
  return error instanceof Error ? error.message : 'Nie udało się wykonać operacji. Spróbuj ponownie.';
}
function matchesDay(record: SchoolEntry, key: string): boolean {
  return record.date ? record.date === key : record.weekday === weekdayOf(key);
}
function recordDate(value: unknown): Date | undefined {
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}
function readSchoolRecord(id: string, data: Record<string, unknown>, parentOnly = false): SchoolRecord | null {
  if ((!parentOnly && !isSchoolType(data.type)) || typeof data.person !== 'string') return null;
  return {
    id, person: data.person, type: parentOnly ? 'message' : data.type as SchoolType, title: String(data.title || ''),
    subject: String(data.subject || ''), date: String(data.date || ''), time: String(data.time || ''),
    endTime: String(data.endTime || ''), weekday: Number(data.weekday || 0), note: String(data.note || ''),
    calendarEventId: typeof data.calendarEventId === 'string' ? data.calendarEventId : undefined,
    calendarCreatedBy: typeof data.calendarCreatedBy === 'string' ? data.calendarCreatedBy : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    createdAt: recordDate(data.createdAt), syncedAt: recordDate(data.syncedAt),
    source: parentOnly ? 'eduvulcan' : typeof data.source === 'string' ? data.source : undefined, parentOnly,
  };
}
function entryFromForm(form: SchoolForm): SchoolEntry {
  const { scheduleMode: _mode, addToCalendar: _calendar, calendarDate: _calendarDate, ...entry } = form;
  return validateSchoolEntry(entry);
}
function blankForm(person: string, type: SchoolType, day: string): SchoolForm {
  const scheduled = type === 'lesson' || type === 'activity';
  return {
    person, type, title: '', subject: '', date: scheduled ? '' : day,
    time: scheduled ? (type === 'activity' ? '17:00' : '08:00') : '',
    endTime: scheduled ? (type === 'activity' ? '18:00' : '08:45') : '',
    weekday: scheduled ? weekdayOf(day) : 0, note: '', scheduleMode: 'weekly',
    addToCalendar: false, calendarDate: day,
  };
}

/** Native dialogs supply modal focus isolation, Escape handling and return focus to the opener. */
function SchoolDialog({ title, children, onClose, busy = false }: { title: string; children: React.ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { dialog?.close(); };
  }, []);
  return createPortal(<dialog ref={ref} className="school-dialog" aria-labelledby={titleId} aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) closeRef.current(); }} onClick={(event) => {
    if (event.target !== event.currentTarget || busy) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeRef.current();
  }}>
    <header><div><small>Nasza Rodzina · Szkoła</small><h2 id={titleId}>{title}</h2></div><button type="button" className="school-close" onClick={onClose} disabled={busy} aria-label="Zamknij okno">✕</button></header>
    <div className="school-dialog-body">{children}</div>
  </dialog>, document.body);
}

export function SchoolModule({ user, member }: { user: User; member: SchoolMember | null }) {
  const parent = member?.role === 'parent';
  const ownStudent = member?.personKey || member?.name || '';
  const [records, setRecords] = useState<SchoolRecord[]>([]);
  const [parentMessages, setParentMessages] = useState<SchoolRecord[]>([]);
  const [messageError, setMessageError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedPerson, setSelectedPerson] = useState(parent ? 'Paweł' : ownStudent);
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [filter, setFilter] = useState<'all' | SchoolType>('all');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<SchoolForm | null>(null);
  const [editing, setEditing] = useState<SchoolRecord | null>(null);
  const [detail, setDetail] = useState<SchoolRecord | null>(null);
  const [deleting, setDeleting] = useState<SchoolRecord | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<SchoolEntry[]>([]);
  const [importName, setImportName] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const fileVersion = useRef(0);
  const identity = `${user.uid}:${parent ? 'parent' : ownStudent}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  useEffect(() => {
    setRecords([]); setLoading(true); setLoadError('');
    if (!parent && !ownStudent) { setLoading(false); return; }
    const source = parent ? collection(db, 'schoolItems') : query(collection(db, 'schoolItems'), where('person', '==', ownStudent));
    return onSnapshot(source, (snapshot) => {
      const next: SchoolRecord[] = [];
      for (const item of snapshot.docs) {
        const data = item.data();
        if (!isSchoolType(data.type) || typeof data.person !== 'string') continue;
        if (!parent && data.person !== ownStudent) continue;
        const record = readSchoolRecord(item.id, data);
        if (record) next.push(record);
      }
      setRecords(next); setLoading(false); setLoadError('');
    }, (error) => { setLoadError(errorText(error)); setLoading(false); });
  }, [parent, ownStudent, user.uid, retry]);

  useEffect(() => {
    setParentMessages([]); setMessageError('');
    if (!parent) return;
    return onSnapshot(collection(db, 'schoolParentMessages'), (snapshot) => {
      const messages = snapshot.docs.map((item) => readSchoolRecord(`parent-message:${item.id}`, item.data(), true)).filter((item): item is SchoolRecord => item !== null);
      setParentMessages(messages); setMessageError('');
    }, () => setMessageError('Nie udało się odczytać wiadomości rodzica z dziennika. Sprawdź połączenie i konfigurację uprawnień Firebase.'));
  }, [parent, user.uid, retry]);

  useEffect(() => {
    if (!parent) setSelectedPerson(ownStudent);
    setForm(null); setDetail(null); setDeleting(null); setImportOpen(false); setImportRows([]); setImportBusy(false); setBusy(false); setNotice('');
    setActionError(''); setImportError('');
    fileVersion.current += 1;
  }, [parent, ownStudent, user.uid]);

  const allRecords = useMemo(() => parent ? [...records, ...parentMessages] : records, [parent, records, parentMessages]);
  const students = useMemo(() => parent ? [...new Set([...DEFAULT_STUDENTS, ...allRecords.map((row) => row.person)])] : ownStudent ? [ownStudent] : [], [parent, ownStudent, allRecords]);
  const person = parent ? (students.includes(selectedPerson) ? selectedPerson : students[0]) : ownStudent;
  const ownRecords = useMemo(() => allRecords.filter((row) => row.person === person), [allRecords, person]);
  const monday = moveDate(selectedDate, 1 - weekdayOf(selectedDate));
  const week = Array.from({ length: 7 }, (_, index) => moveDate(monday, index));
  const dayRecords = ownRecords.filter((row) => (row.type === 'lesson' || row.type === 'activity') && matchesDay(row, selectedDate)).sort((a, b) => a.time.localeCompare(b.time));
  const filteredRecords = ownRecords.filter((row) => filter === 'all' || row.type === filter).sort((a, b) => {
    const order: SchoolType[] = ['lesson', 'activity', 'test', 'homework', 'grade', 'message'];
    if (a.type !== b.type) return order.indexOf(a.type) - order.indexOf(b.type);
    if (a.type === 'lesson' && b.type === 'lesson') return a.weekday - b.weekday || a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
    if (a.type === 'grade' || a.type === 'message') return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0);
    return (a.date || '9999').localeCompare(b.date || '9999') || a.weekday - b.weekday || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'pl');
  });
  const canEdit = (row: SchoolEntry) => {
    const linked = row as SchoolRecord;
    if (linked.source === 'eduvulcan' || linked.parentOnly) return false;
    if (parent) return true;
    if (row.person !== ownStudent || !CHILD_TYPES.includes(row.type)) return false;
    return !linked.calendarEventId || (linked.calendarCreatedBy || linked.createdBy) === user.uid;
  };

  function closeForm() { if (!busy) { setForm(null); setEditing(null); setActionError(''); } }
  function openAdd(type: SchoolType = 'lesson') {
    if (!person || (!parent && !CHILD_TYPES.includes(type))) return;
    setEditing(null); setActionError(''); setForm(blankForm(person, type, selectedDate));
  }
  function openEdit(row: SchoolRecord) {
    if (!canEdit(row)) return;
    setDetail(null); setActionError(''); setEditing(row);
    setForm({ person: row.person, type: row.type, title: row.title, subject: row.subject, date: row.date, time: row.time,
      endTime: row.endTime, weekday: row.date ? 0 : row.weekday, note: row.note,
      scheduleMode: row.date ? 'date' : 'weekly', addToCalendar: !!row.calendarEventId,
      calendarDate: row.date || nextWeekday(row.weekday || 1),
    });
  }
  function changeType(type: SchoolType) {
    setForm((current) => {
      if (!current) return current;
      const scheduled = type === 'lesson' || type === 'activity';
      const next = blankForm(current.person, type, selectedDate);
      return { ...next, title: current.title, subject: current.subject, note: current.note,
        ...(scheduled && (current.type === 'lesson' || current.type === 'activity') ? {
          date: current.date, weekday: current.weekday, time: current.time, endTime: current.endTime, scheduleMode: current.scheduleMode,
        } : {}),
      };
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || busy) return;
    setActionError('');
    try {
      const entry = entryFromForm(form);
      if (!canEdit(entry) || (editing && !canEdit(editing))) throw new Error('Nie masz uprawnień do edycji tego wpisu.');
      if (form.addToCalendar && entry.type !== 'activity') throw new Error('Do kalendarza można dodać zajęcia dodatkowe.');
      const firstCalendarDate = entry.date || form.calendarDate;
      if (form.addToCalendar) {
        validateSchoolEntry({ ...entry, date: firstCalendarDate, weekday: 0 });
        if (entry.weekday && weekdayOf(firstCalendarDate) !== entry.weekday) throw new Error('Data pierwszych zajęć w kalendarzu musi odpowiadać wybranemu dniu tygodnia.');
      }
      setBusy(true);
      const linkedRef = editing?.calendarEventId ? doc(db, 'calendarEvents', editing.calendarEventId) : null;
      const linkedEvent = linkedRef ? await getDoc(linkedRef) : null;
      const batch = writeBatch(db);
      const schoolRef = editing ? doc(db, 'schoolItems', editing.id) : doc(collection(db, 'schoolItems'));
      let calendarId = '';
      let calendarOwner = '';
      if (form.addToCalendar) {
        const calendarRef = editing?.calendarEventId ? doc(db, 'calendarEvents', editing.calendarEventId) : doc(collection(db, 'calendarEvents'));
        calendarId = calendarRef.id;
        calendarOwner = linkedEvent?.exists() && typeof linkedEvent.data().createdBy === 'string' ? linkedEvent.data().createdBy : user.uid;
        // Only the public event label and timing are shared. School notes and messages stay in schoolItems.
        const calendarData = { title: `🎒 ${entry.title}`, person: entry.person,
          date: Timestamp.fromDate(localDate(firstCalendarDate, entry.time)), endDate: Timestamp.fromDate(localDate(firstCalendarDate, entry.endTime)),
          allDay: false, description: '', repeat: entry.weekday ? 'weekly' : 'none', repeatUntil: null,
        };
        if (linkedEvent?.exists()) batch.update(calendarRef, calendarData);
        else batch.set(calendarRef, { ...calendarData, createdBy: user.uid, createdAt: Timestamp.now() });
      } else if (linkedRef && linkedEvent?.exists()) batch.delete(linkedRef);
      if (editing) batch.update(schoolRef, { ...entry, updatedAt: Timestamp.now(), calendarEventId: calendarId || deleteField(), calendarCreatedBy: calendarOwner || deleteField() });
      else batch.set(schoolRef, { ...entry, createdBy: user.uid, createdAt: Timestamp.now(), ...(calendarId ? { calendarEventId: calendarId, calendarCreatedBy: calendarOwner } : {}) });
      await batch.commit();
      setForm(null); setEditing(null); setNotice(editing ? 'Wpis został zapisany.' : 'Dodano wpis szkolny.');
    } catch (error) { setActionError(errorText(error)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!deleting || busy) return;
    setActionError('');
    try {
      if (!canEdit(deleting)) throw new Error('Nie masz uprawnień do usunięcia tego wpisu.');
      setBusy(true);
      const linkedRef = deleting.calendarEventId ? doc(db, 'calendarEvents', deleting.calendarEventId) : null;
      const linkedEvent = linkedRef ? await getDoc(linkedRef) : null;
      const batch = writeBatch(db);
      batch.delete(doc(db, 'schoolItems', deleting.id));
      if (linkedRef && linkedEvent?.exists()) batch.delete(linkedRef);
      await batch.commit(); setDeleting(null); setDetail(null); setNotice('Wpis został usunięty.');
    } catch (error) { setActionError(errorText(error)); }
    finally { setBusy(false); }
  }

  async function readImport(file?: File) {
    const version = ++fileVersion.current;
    setImportError(''); setImportRows([]); setImportName('');
    if (!file) return;
    if (file.size > MAX_SCHOOL_FILE_BYTES) { setImportError('Plik jest za duży. Maksymalny rozmiar to 1 MB.'); return; }
    setImportBusy(true);
    try {
      const rows = parseSchoolFile(await file.text(), file.name.split('.').pop() || '');
      if (version !== fileVersion.current) return;
      setImportRows(rows); setImportName(file.name);
    } catch (error) { if (version === fileVersion.current) setImportError(errorText(error)); }
    finally { if (version === fileVersion.current) setImportBusy(false); }
  }

  async function commitImport() {
    if (!parent || !importRows.length || importBusy) return;
    setImportError(''); setImportBusy(true);
    const startingIdentity = identity;
    try {
      // Validate the entire file again before any write, then collapse identical rows.
      const valid = importRows.map((entry) => validateSchoolEntry(entry));
      const keyed = await Promise.all(valid.map(async (entry) => ({ entry, id: await schoolImportId(entry) })));
      const unique = [...new Map(keyed.map((row) => [row.id, row])).values()];
      const existing = await Promise.all(unique.map(async (row) => ({ ...row, exists: (await getDoc(doc(db, 'schoolItems', row.id))).exists() })));
      if (currentIdentity.current !== startingIdentity) throw new Error('Konto zmieniło się podczas importu. Otwórz import ponownie.');
      const newRows = existing.filter((row) => !row.exists);
      if (newRows.length > MAX_SCHOOL_ROWS) throw new Error('Przekroczono limit importu.');
      if (newRows.length) {
        const batch = writeBatch(db);
        for (const row of newRows) batch.set(doc(db, 'schoolItems', row.id), { ...row.entry, createdBy: user.uid, createdAt: Timestamp.now() });
        await batch.commit();
      }
      const skipped = importRows.length - newRows.length;
      setNotice(`Import zakończony: dodano ${newRows.length} wpisów${skipped ? `, pominięto ${skipped} powtórzeń` : ''}.`);
      setImportOpen(false); setImportRows([]); setImportName('');
    } catch (error) { setImportError(errorText(error)); }
    finally { setImportBusy(false); }
  }

  function rowButton(row: SchoolRecord, inPlan = false) {
    return <button type="button" className={`school-entry ${inPlan ? 'school-plan-entry' : ''}`} key={row.id} onClick={() => setDetail(row)}>
      <span className={`school-entry-icon school-type-${row.type}`} aria-hidden="true">{META[row.type].icon}</span>
      {inPlan && <time>{row.time}<small>{row.endTime}</small></time>}
      <span className="school-entry-copy"><strong>{row.title}</strong><span>{[row.subject, inPlan ? row.note : row.date ? shortDate(row.date) : row.weekday ? WEEKDAYS[row.weekday - 1] : '', !inPlan && row.time ? `${row.time}${row.endTime ? `–${row.endTime}` : ''}` : ''].filter(Boolean).join(' · ') || META[row.type].singular}</span>{row.source === 'eduvulcan' && <small className="school-source-badge">eduVULCAN · {row.parentOnly ? 'dla rodzica' : 'tylko odczyt'}</small>}</span>
      {!inPlan && <span className="school-entry-type">{META[row.type].singular}</span>}
      <span className="school-entry-arrow" aria-hidden="true">›</span>
    </button>;
  }

  return <div className="page-content school-module">
    <header className="school-heading"><div><span className="school-eyebrow">Codzienność dzieci</span><h1>🎒 Szkoła</h1><p>Plan tygodnia, zadania i ważne szkolne sprawy w jednym miejscu.</p></div><div className="school-heading-actions">
      {parent && <button className="secondary-button" type="button" onClick={() => { setImportError(''); setImportRows([]); setImportName(''); setImportOpen(true); }}>Importuj plik</button>}
      {person && <button className="primary-button" type="button" onClick={() => openAdd()}>＋ Dodaj wpis</button>}
    </div></header>
    <p className="school-access-note">{parent ? 'Widok rodzica · możesz zarządzać danymi wszystkich dzieci.' : ownStudent ? `Twój szkolny widok · ${ownStudent}. Oceny i wiadomości uzupełnia rodzic.` : 'Konto nie ma przypisanej osoby. Rodzic może uzupełnić profil w ustawieniach.'}</p>
    {notice && <div className="school-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Zamknij komunikat">✕</button></div>}
    {loadError && <div className="school-error" role="alert"><span>{loadError}</span><button type="button" className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Spróbuj ponownie</button></div>}
    {parent && messageError && <div className="school-error" role="alert"><span>{messageError}</span><button type="button" className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Ponów odczyt wiadomości</button></div>}
    {students.length > 0 && <nav className="school-students" aria-label="Wybierz dziecko">{students.map((student) => <button type="button" key={student} className={person === student ? 'active' : ''} aria-pressed={person === student} onClick={() => setSelectedPerson(student)}><span aria-hidden="true">{student === 'Layla' ? '🌸' : student === 'Nikodem' ? '🚀' : '🎓'}</span>{student}</button>)}</nav>}
    {loading ? <div className="school-loading" role="status">Ładowanie danych szkolnych…</div> : person && <>
      <section className="school-panel school-week-panel" aria-labelledby="school-week-title">
        <div className="school-panel-heading"><div><h2 id="school-week-title">Tydzień {person === 'Layla' ? 'Layli' : person === 'Nikodem' ? 'Nikodema' : person === 'Paweł' ? 'Pawła' : person}</h2><p>{shortDate(week[0])} – {shortDate(week[6])}</p></div><div className="school-week-controls"><button type="button" className="school-arrow-button" onClick={() => setSelectedDate(moveDate(selectedDate, -7))} aria-label="Poprzedni tydzień">‹</button><button type="button" className="secondary-button" onClick={() => setSelectedDate(dateKey(new Date()))}>Dzisiaj</button><button type="button" className="school-arrow-button" onClick={() => setSelectedDate(moveDate(selectedDate, 7))} aria-label="Następny tydzień">›</button></div></div>
        <div className="school-week-days">{week.map((key, index) => {
          const count = ownRecords.filter((row) => (row.type === 'lesson' || row.type === 'activity') && matchesDay(row, key)).length;
          return <button type="button" key={key} className={`${selectedDate === key ? 'active' : ''} ${dateKey(new Date()) === key ? 'today' : ''}`} aria-pressed={selectedDate === key} onClick={() => setSelectedDate(key)}><span>{WEEKDAYS[index].slice(0, 3)}</span><strong>{localDate(key).getDate()}</strong><small>{count ? `${count} zajęć` : 'Wolne'}</small></button>;
        })}</div>
        <div className="school-plan-heading"><h3>{WEEKDAYS[weekdayOf(selectedDate) - 1]}, {shortDate(selectedDate)}</h3><label className="school-date-select"><span>Wybierz datę</span><input type="date" value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); }} /></label></div>
        <div className="school-plan-list">{dayRecords.length ? dayRecords.map((row) => rowButton(row, true)) : <div className="school-empty-state"><span aria-hidden="true">☀️</span><strong>Na ten dzień nie ma zajęć.</strong><p>Dodaj plan lekcji lub zajęcia dodatkowe.</p><button type="button" className="secondary-button" onClick={() => openAdd('lesson')}>Dodaj lekcję</button></div>}</div>
      </section>
      <section className="school-panel school-records-panel" aria-labelledby="school-records-title"><div className="school-panel-heading"><div><h2 id="school-records-title">Wpisy szkolne</h2><p>Wszystkie zapisane informacje · {ownRecords.length} wpisów</p></div></div>
        <div className="school-filters" role="group" aria-label="Rodzaj wpisów"><button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Wszystkie <span>{ownRecords.length}</span></button>{SCHOOL_TYPES.map((type) => <button type="button" key={type} className={filter === type ? 'active' : ''} aria-pressed={filter === type} onClick={() => setFilter(type)}>{META[type].icon} {META[type].title} <span>{ownRecords.filter((row) => row.type === type).length}</span></button>)}</div>
        <div className="school-record-list">{filteredRecords.length ? filteredRecords.map((row) => rowButton(row)) : <div className="school-empty-state"><strong>Brak wpisów w tej kategorii.</strong>{(filter === 'all' || parent || CHILD_TYPES.includes(filter)) && <button type="button" className="secondary-button" onClick={() => openAdd(filter === 'all' ? 'homework' : filter)}>Dodaj pierwszy wpis</button>}</div>}</div>
      </section>
    </>}
    {parent ? <EduVulcanConnection user={user} member={member} onSelectedStudent={setSelectedPerson} /> : <aside className="school-vulcan-card"><span className="school-vulcan-icon" aria-hidden="true">🔗</span><div><h2>eduVULCAN</h2><p>Połączeniem z dziennikiem zarządza rodzic. Dane oznaczone „eduVULCAN” są tylko do odczytu.</p></div><a className="secondary-button" href="https://uczen.eduvulcan.pl/" target="_blank" rel="noopener noreferrer">Otwórz eduVULCAN ↗</a></aside>}

    {form && <SchoolDialog title={`${editing ? 'Edytuj' : 'Dodaj'} · ${META[form.type].singular}`} onClose={closeForm} busy={busy}>
      <form onSubmit={save}><fieldset className="school-form" disabled={busy}>
        {actionError && <p className="school-error school-span-all" role="alert">{actionError}</p>}
        {parent && <label className="field"><span>Dziecko</span><select aria-label="Dziecko" value={form.person} onChange={(event) => setForm({ ...form, person: event.target.value })}>{[...new Set([...students, ...SCHOOL_PEOPLE])].map((student) => <option key={student}>{student}</option>)}</select></label>}
        <label className="field"><span>Rodzaj wpisu</span><select aria-label="Rodzaj wpisu" value={form.type} onChange={(event) => changeType(event.target.value as SchoolType)}>{(parent ? SCHOOL_TYPES : CHILD_TYPES).map((type) => <option value={type} key={type}>{META[type].icon} {META[type].singular}</option>)}</select></label>
        <label className="field school-span-all"><span>{form.type === 'grade' ? 'Ocena / wynik' : 'Nazwa wpisu'} *</span><input autoFocus maxLength={160} required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={form.type === 'grade' ? 'Np. 5 · odpowiedź ustna' : 'Np. Matematyka / kartkówka / fortepian'} /></label>
        <label className="field"><span>Przedmiot</span><input maxLength={100} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Np. Matematyka" /></label>
        {(form.type === 'lesson' || form.type === 'activity') ? <>
          <label className="field"><span>Termin zajęć</span><select aria-label="Termin zajęć" value={form.scheduleMode} onChange={(event) => {
            const mode = event.target.value as 'weekly' | 'date';
            setForm({ ...form, scheduleMode: mode, weekday: mode === 'weekly' ? weekdayOf(selectedDate) : 0, date: mode === 'date' ? selectedDate : '', calendarDate: selectedDate });
          }}><option value="weekly">Co tydzień</option><option value="date">Jedna konkretna data</option></select></label>
          {form.scheduleMode === 'weekly' ? <label className="field"><span>Dzień tygodnia *</span><select aria-label="Dzień tygodnia" value={form.weekday} onChange={(event) => setForm({ ...form, weekday: Number(event.target.value), calendarDate: nextWeekday(Number(event.target.value)) })}>{WEEKDAYS.map((day, index) => <option value={index + 1} key={day}>{day}</option>)}</select></label> : <label className="field"><span>Data *</span><input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>}
        </> : <label className="field"><span>{form.type === 'homework' ? 'Termin oddania *' : form.type === 'test' ? 'Data sprawdzianu *' : 'Data'}</span><input type="date" required={form.type === 'homework' || form.type === 'test'} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>}
        <label className="field"><span>Od{form.type === 'lesson' || form.type === 'activity' ? ' *' : ''}</span><input type="time" required={form.type === 'lesson' || form.type === 'activity'} value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></label>
        <label className="field"><span>Do{form.type === 'lesson' || form.type === 'activity' ? ' *' : ''}</span><input type="time" required={form.type === 'lesson' || form.type === 'activity'} value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></label>
        <label className="field school-span-all"><span>Notatka / sala / treść wiadomości</span><textarea rows={4} maxLength={2000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        {form.type === 'activity' && <div className="school-calendar-option school-span-all"><label><input type="checkbox" checked={form.addToCalendar} onChange={(event) => setForm({ ...form, addToCalendar: event.target.checked })} /><span>Pokaż zajęcia także w rodzinnym kalendarzu</span></label><p>Rodzina zobaczy nazwę i termin zajęć. Notatka pozostaje w module Szkoła.</p>{form.addToCalendar && form.scheduleMode === 'weekly' && <label className="field"><span>Data pierwszych zajęć w kalendarzu *</span><input type="date" required value={form.calendarDate} onChange={(event) => setForm({ ...form, calendarDate: event.target.value })} /></label>}</div>}
        {editing?.calendarEventId && !form.addToCalendar && <p className="school-form-hint school-span-all">Zapis usunie także połączony wpis z rodzinnego kalendarza.</p>}
        <div className="school-form-actions school-span-all"><button type="button" className="secondary-button" disabled={busy} onClick={closeForm}>Anuluj</button><button className="primary-button" disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz wpis'}</button></div>
      </fieldset></form>
    </SchoolDialog>}

    {detail && <SchoolDialog title={detail.title} onClose={() => setDetail(null)}>
      <dl className="school-detail"><div><dt>Osoba</dt><dd>{detail.person}</dd></div><div><dt>Rodzaj</dt><dd>{META[detail.type].singular}</dd></div>{detail.subject && <div><dt>Przedmiot</dt><dd>{detail.subject}</dd></div>}{detail.date && <div><dt>Data</dt><dd>{localDate(detail.date).toLocaleDateString('pl-PL')}</dd></div>}{detail.weekday > 0 && !detail.date && <div><dt>Co tydzień</dt><dd>{WEEKDAYS[detail.weekday - 1]}</dd></div>}{detail.time && <div><dt>Godzina</dt><dd>{detail.time}{detail.endTime ? `–${detail.endTime}` : ''}</dd></div>}{detail.note && <div className="school-detail-note"><dt>Notatka</dt><dd>{detail.note}</dd></div>}</dl>
      {detail.source === 'eduvulcan' && <div className="school-provider-detail"><strong>Źródło: eduVULCAN · tylko do odczytu</strong>{detail.syncedAt && <p>Odczytano: {detail.syncedAt.toLocaleString('pl-PL')}</p>}{detail.parentOnly && <p>Wiadomość z dziennika jest dostępna wyłącznie rodzicom.</p>}<p>Zmiany w dzienniku pojawią się po kolejnym odświeżeniu. Własne wpisy możesz dodawać osobno.</p></div>}
      {!parent && detail.calendarEventId && !canEdit(detail) && <p className="school-form-hint">Te zajęcia są połączone z kalendarzem rodzica. Zmiany wprowadza rodzic.</p>}
      {canEdit(detail) && <div className="school-form-actions"><button type="button" className="danger-button" onClick={() => { setActionError(''); setDeleting(detail); setDetail(null); }}>Usuń</button><button type="button" className="primary-button" onClick={() => openEdit(detail)}>Edytuj wpis</button></div>}
    </SchoolDialog>}
    {deleting && <SchoolDialog title="Usunąć wpis szkolny?" onClose={() => { if (!busy) { setDeleting(null); setActionError(''); } }} busy={busy}><p>Wpis „{deleting.title}” zostanie usunięty.</p>{deleting.calendarEventId && <p>Usuniemy również połączony wpis w rodzinnym kalendarzu.</p>}{actionError && <p className="school-error" role="alert">{actionError}</p>}<div className="school-form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setDeleting(null)}>Anuluj</button><button type="button" className="danger-button" disabled={busy} onClick={() => void remove()}>{busy ? 'Usuwanie…' : 'Usuń wpis'}</button></div></SchoolDialog>}

    {importOpen && parent && <SchoolDialog title="Ręczny import szkolnych wpisów" onClose={() => { if (!importBusy) { fileVersion.current += 1; setImportOpen(false); setImportRows([]); } }} busy={importBusy}>
      <p className="school-import-intro">Przygotuj plik według naszego szablonu CSV lub JSON. To format aplikacji Nasza Rodzina; nie jest to import eksportu z eduVULCAN.</p>
      <div className="school-template-links"><a href="/szkola-szablon.csv" download>Pobierz szablon CSV ↓</a><a href="/szkola-szablon.json" download>Pobierz szablon JSON ↓</a></div>
      <p className="school-form-hint">Maksymalnie 200 wpisów i 1 MB. Dozwolone osoby: {SCHOOL_PEOPLE.join(', ')}. Dni tygodnia: 1 = poniedziałek, 7 = niedziela, 0 = brak. Lekcje i zajęcia wymagają dnia tygodnia albo daty; zadania i sprawdziany wymagają daty. Import nie dodaje wydarzeń do rodzinnego kalendarza.</p>
      <label className="field"><span>Wybierz przygotowany plik</span><input type="file" accept=".csv,.json,text/csv,application/json" disabled={importBusy} onChange={(event) => void readImport(event.target.files?.[0])} /></label>
      {importError && <p className="school-error" role="alert">{importError}</p>}
      {importBusy && <p role="status">Sprawdzanie lub zapisywanie pliku…</p>}
      {importRows.length > 0 && <><h3 className="school-preview-title">Podgląd: {importName} · {importRows.length} wpisów</h3><p className="school-form-hint">Powtórzenia tego samego wpisu są pomijane. Istniejące wpisy i późniejsze ręczne zmiany pozostają zachowane.</p><div className="school-import-preview"><table><thead><tr><th>Osoba</th><th>Rodzaj</th><th>Nazwa / przedmiot</th><th>Termin</th><th>Notatka</th></tr></thead><tbody>{importRows.map((row, index) => <tr key={index}><td>{row.person}</td><td>{META[row.type].singular}</td><td>{row.title}<small>{row.subject}</small></td><td>{row.date || (row.weekday ? WEEKDAYS[row.weekday - 1] : '—')}{row.time && <small>{row.time}{row.endTime ? `–${row.endTime}` : ''}</small>}</td><td className="school-preview-note">{row.note || '—'}</td></tr>)}</tbody></table></div></>}
      <div className="school-form-actions"><button type="button" className="secondary-button" disabled={importBusy} onClick={() => { fileVersion.current += 1; setImportOpen(false); setImportRows([]); }}>Anuluj</button><button type="button" className="primary-button" disabled={importBusy || !importRows.length} onClick={() => void commitImport()}>{importBusy ? 'Proszę czekać…' : `Importuj${importRows.length ? ` (${importRows.length})` : ''}`}</button></div>
    </SchoolDialog>}
  </div>;
}

export default SchoolModule;
