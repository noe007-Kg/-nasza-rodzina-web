import { addDoc, collection, db, deleteDoc, deleteObject, doc, EmptyState, errorMessage, formatDateInput, formatShortDate, getBlob, isParent, isPersonKey, Modal, ModuleHeader, notify, onSnapshot, ownPerson, parseLocalDate, personColor, PersonSelect, query, React, storage, storageRef, Timestamp, updateDoc, useEffect, useRef, useState, where, writeBatch, type HealthForm, type HealthRecord, type HealthStatus, type HealthType, type MedicalContact, type Member, type PersonKey, type User } from "../app-shared";

import { uploadBytesResumable } from 'firebase/storage';
import { useNotifications } from '../notifications';

import { observeHealthUpload, validateHealthFile, type HealthUploadProgress } from './health-upload';
import { HealthUploadStatus } from './HealthUploadStatus';
import './chat-health.css';

export const HEALTH_META: Record<HealthType, { label: string; icon: string }> = {
  visit: { label: 'Wizyta', icon: '🩺' }, doctor: { label: 'Lekarz / placówka', icon: '👨‍⚕️' }, medicine: { label: 'Lek', icon: '💊' }, result: { label: 'Wynik', icon: '📄' }, history: { label: 'Historia', icon: '🕘' }, document: { label: 'Dokument', icon: '📁' },
};

export const SPECIALTIES = ['Neurologia', 'Okulistyka', 'Urologia', 'Immunologia', 'Logopedia', 'Stomatologia', 'Pediatria', 'Inne'];

export function isHealthType(value: unknown): value is HealthType { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HEALTH_META, value); }

export function isHealthStatus(value: unknown): value is HealthStatus { return value === 'planned' || value === 'toBook' || value === 'booked' || value === 'done' || value === 'cancelled'; }

export function HealthPage({ user, member }: { user: User; member: Member | null }) {
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [contacts, setContacts] = useState<MedicalContact[]>([]);
  const [person, setPerson] = useState<PersonKey>('family');
  const [specialtyFilter, setSpecialtyFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const parent = isParent(member);
  const [recordType, setRecordType] = useState<HealthType | 'all'>('all');
  const [editingHealth, setEditingHealth] = useState<HealthRecord | null>(null);
  const [savingHealth, setSavingHealth] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<HealthUploadProgress>({ phase: 'idle', percent: 0 });
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const uploadedFile = useRef<{ file: File; path: string; person: PersonKey; privateToParents: boolean } | null>(null);
  const healthSavingRef = useRef(false);
  const { announceLocal } = useNotifications();
  const [savingContact, setSavingContact] = useState(false);
  const [editingContact, setEditingContact] = useState<MedicalContact | null>(null);
  const contactSavingRef = useRef(false);
  const emptyForm = (): HealthForm => ({ title: '', person: !parent ? ownPerson(member) : person === 'family' ? 'Paweł' : person, type: 'visit', date: formatDateInput(new Date()), time: '12:00', doctor: '', location: '', note: '', specialty: '', status: 'planned', referralCode: '', nextControl: '', callReminderDate: '', privateToParents: false, dose: '', medicineTime: '20:00', addToCalendar: true, file: null });
  const [form, setForm] = useState<HealthForm>(emptyForm);
  const [contactForm, setContactForm] = useState({ person:'family' as PersonKey, specialty:'', name:'', doctor:'', phone:'', address:'', note:'' });

  useEffect(() => onSnapshot(parent ? collection(db, 'healthRecords') : query(collection(db, 'healthRecords'), where('privateToParents', '==', false), where('person', 'in', ['family', ownPerson(member)])), (snap) => {
    const next = snap.docs.map((d): HealthRecord => {
      const x = d.data();
      return {
        id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'family', type:isHealthType(x.type) ? x.type : 'history', date:typeof x.date === 'string' ? x.date : '', time:typeof x.time === 'string' ? x.time : '', doctor:typeof x.doctor === 'string' ? x.doctor : '', location:typeof x.location === 'string' ? x.location : '', note:typeof x.note === 'string' ? x.note : '', specialty:typeof x.specialty === 'string' ? x.specialty : '', status:isHealthStatus(x.status) ? x.status : (x.type === 'visit' ? 'planned' : 'done'), referralCode:typeof x.referralCode === 'string' ? x.referralCode : '', nextControl:typeof x.nextControl === 'string' ? x.nextControl : '', callReminderDate:typeof x.callReminderDate === 'string' ? x.callReminderDate : '', documentURL:typeof x.documentURL === 'string' ? x.documentURL : '', documentPath:typeof x.documentPath === 'string' ? x.documentPath : '', privateToParents:x.privateToParents === true, dose:typeof x.dose === 'string' ? x.dose : '', medicineTime:typeof x.medicineTime === 'string' ? x.medicineTime : (typeof x.time === 'string' ? x.time : ''), confirmedDate:typeof x.confirmedDate === 'string' ? x.confirmedDate : '', createdAt:x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
      };
    });
    next.sort((a,b)=>(b.date || '').localeCompare(a.date || '') || (b.createdAt?.getTime() || 0)-(a.createdAt?.getTime() || 0));
    setRecords(next);
  }), []);

  useEffect(() => onSnapshot(parent ? collection(db, 'medicalContacts') : query(collection(db, 'medicalContacts'), where('person', 'in', ['family', ownPerson(member)])), (snap) => {
    setContacts(snap.docs.map((d) => { const x=d.data(); return { id:d.id, person:isPersonKey(x.person) ? x.person : 'family', specialty:String(x.specialty || ''), name:String(x.name || ''), doctor:String(x.doctor || ''), phone:String(x.phone || ''), address:String(x.address || ''), note:String(x.note || '') }; }));
  }), []);

  useEffect(() => {
    const check = () => {
      const now = new Date();
      const today = formatDateInput(now);
      records.filter((r) => r.type === 'medicine' && r.medicineTime && r.confirmedDate !== today).forEach((r) => {
        if (!(parent || r.person === member?.name)) return;
        const due = parseLocalDate(today, r.medicineTime);
        const minutes = (now.getTime()-due.getTime())/60000;
        const key = `medicine:${r.id}:${today}`;
        if (minutes >= 0 && minutes < 5) {
          announceLocal({ id: `${key}:due`, category: 'health', module: 'Zdrowie', title: 'Przypomnienie o leku', body: 'Sprawdź przypomnienie w aplikacji.', important: false });
        }
        if (parent && minutes >= 15) {
          announceLocal({ id: `${key}:late`, category: 'health', module: 'Zdrowie', title: 'Sprawdź potwierdzenie leku', body: 'Otwórz przypomnienia w aplikacji.', important: false });
        }
      });
    };
    check(); const timer=window.setInterval(check,60000); return()=>window.clearInterval(timer);
  }, [records, parent, member?.name, user.uid, announceLocal]);

  const allowedRecords = records.filter((r) => !r.privateToParents || parent);
  const personRecords = allowedRecords.filter((r) => person === 'family' || r.person === person);
  const visibleRecords = personRecords.filter((r) => (specialtyFilter === 'all' || r.specialty === specialtyFilter) && (recordType === 'all' || r.type === recordType));
  const upcomingVisits = personRecords.filter((r) => r.type === 'visit' && r.date && r.date >= formatDateInput(new Date()) && r.status !== 'cancelled' && r.status !== 'done').sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4);
  const medicines = personRecords.filter((r) => r.type === 'medicine');
  const history = visibleRecords.filter((r) => r.type === 'visit' || r.type === 'history' || r.type === 'result').sort((a,b)=>(b.date || '').localeCompare(a.date || '')).slice(0,8);
  const documents = personRecords.filter((r) => r.type === 'document' || r.type === 'result').slice(0,8);
  const controlItems = personRecords.filter((r) => r.nextControl || r.callReminderDate).slice(0,6);
  const visibleContacts = contacts.filter((c) => c.person === 'family' || person === 'family' || c.person === person);
  const importantPawelDocs = allowedRecords.filter((r) => r.person === 'Paweł' && r.type === 'document' && r.privateToParents).slice(0,4);

  function resetUpload() {
    setUploadProgress({ phase: 'idle', percent: 0 }); setUploadFileName(''); setUploadError(''); uploadedFile.current = null;
  }

  function openAdd(type: HealthType = 'visit') { resetUpload(); setEditingHealth(null); setForm({ ...emptyForm(), type, person: !parent ? ownPerson(member) : person === 'family' ? 'Paweł' : person, privateToParents:parent && type === 'document' }); setShowForm(true); }

  function editHealth(record: HealthRecord) {
    resetUpload();
    setEditingHealth(record);
    const { id, createdAt, confirmedDate, documentURL, documentPath, ...fields } = record;
    setForm({ ...fields, addToCalendar:false, file:null }); setShowForm(true);
  }

  async function openDocument(record: HealthRecord) {
    if (!record.documentPath) { notify('Ten plik wymaga migracji do chronionego magazynu. Instrukcja znajduje się w paczce projektu.', 'error'); return; }
    const preview = window.open('', '_blank');
    try {
      const blob = await getBlob(storageRef(storage, record.documentPath), 10 * 1024 * 1024);
      const url = URL.createObjectURL(blob);
      if (preview) { preview.opener = null; preview.location.replace(url); }
      else { const a = document.createElement('a'); a.href = url; a.download = record.title; a.click(); }
      window.setTimeout(()=>URL.revokeObjectURL(url), 60000);
    } catch (error) { preview?.close(); notify(errorMessage(error), 'error'); }
  }

  async function uploadHealthFile(file: File, recordPerson: PersonKey) {
    validateHealthFile(file);
    const completed = uploadedFile.current;
    if (completed?.file === file && completed.person === recordPerson && completed.privateToParents === form.privateToParents) return completed.path;
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g,'-');
    const path = `health/${form.privateToParents ? 'parents' : 'shared'}/${recordPerson}/${user.uid}/${Date.now()}-${safe}`;
    setUploadFileName(file.name); setUploadError('');
    const task = uploadBytesResumable(storageRef(storage, path), file, { contentType: file.type });
    await observeHealthUpload(task, setUploadProgress);
    uploadedFile.current = { file, path, person: recordPerson, privateToParents: form.privateToParents };
    return path;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim() || healthSavingRef.current) return;
    if (editingHealth?.documentPath && (editingHealth.privateToParents !== form.privateToParents || editingHealth.person !== form.person) && !form.file) { notify('Przy zmianie osoby lub prywatności załącz plik ponownie, aby nadać mu właściwe uprawnienia.', 'error'); return; }
    healthSavingRef.current = true; setSavingHealth(true);
    try {
      const documentPath = form.file ? await uploadHealthFile(form.file, form.person) : editingHealth?.documentPath || '';
      const { addToCalendar, file, ...record } = form;
      const batch = writeBatch(db);
      const target = editingHealth ? doc(db, 'healthRecords', editingHealth.id) : doc(collection(db, 'healthRecords'));
      const payload = { ...record, title:form.title.trim(), documentPath, documentURL:'', updatedAt:Timestamp.now() };
      if (editingHealth) batch.update(target, payload);
      else batch.set(target, { ...payload, confirmedDate:'', createdBy:user.uid, createdAt:Timestamp.now() });
      if (!editingHealth && addToCalendar && !form.privateToParents && form.type === 'visit' && form.date) {
        const start = parseLocalDate(form.date, form.time || '12:00');
        batch.set(doc(collection(db,'calendarEvents')), { title:`❤️ ${form.title.trim()}`, person:form.person, date:Timestamp.fromDate(start), endDate:Timestamp.fromDate(new Date(start.getTime()+3600000)), allDay:false, description:[form.specialty,form.doctor,form.location].filter(Boolean).join(' · '), repeat:'none', repeatUntil:null, createdBy:user.uid, createdAt:Timestamp.now() });
      }
      await batch.commit(); setShowForm(false);
      if (editingHealth?.documentPath && editingHealth.documentPath !== documentPath) {
        try { await deleteObject(storageRef(storage, editingHealth.documentPath)); } catch { notify('Zapisano wpis. Nie udało się usunąć poprzedniego pliku — administrator powinien usunąć go z magazynu.', 'error'); }
      }
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith('Wybierz') ? error.message : errorMessage(error);
      setUploadError(message);
      notify(message, 'error');
    }
    finally { healthSavingRef.current = false; setSavingHealth(false); }
  }

  async function removeHealth(record: HealthRecord) {
    if (!parent || !confirm(`Usunąć wpis „${record.title}”?`)) return;
    await deleteDoc(doc(db, 'healthRecords', record.id));
    if (record.documentPath) { try { await deleteObject(storageRef(storage, record.documentPath)); } catch { notify('Usunięto wpis, lecz plik pozostał w magazynie. Administrator powinien usunąć plik.', 'error'); } }
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault(); if (!parent || !contactForm.name.trim() || contactSavingRef.current) return;
    contactSavingRef.current = true; setSavingContact(true);
    try {
      if (editingContact) await updateDoc(doc(db,'medicalContacts',editingContact.id), { ...contactForm, updatedAt:Timestamp.now() });
      else await addDoc(collection(db,'medicalContacts'), { ...contactForm, createdBy:user.uid, createdAt:Timestamp.now() });
      setShowContactForm(false);
    }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { contactSavingRef.current = false; setSavingContact(false); }
  }

  async function confirmMedicine(record: HealthRecord) { await updateDoc(doc(db,'healthRecords',record.id), { confirmedDate:formatDateInput(new Date()), updatedAt:Timestamp.now() }); }

  return (
    <div className="page-content compact-page health-v130">
      <ModuleHeader icon="❤️" title="Zdrowie" text="Kartoteka, wizyty, leki, dokumenty i kontakty całej rodziny." action={<button className="primary-button" onClick={() => openAdd('visit')}>＋ Dodaj wizytę / wpis</button>} />
      {!showForm && uploadProgress.phase === 'uploaded' && <HealthUploadStatus progress={uploadProgress} fileName={uploadFileName} />}

      <section className="health-person-filter" aria-label="Wybór kartoteki zdrowia">
        <label><span>Kartoteka</span><PersonSelect value={person} onChange={setPerson} allowed={parent ? undefined : ['family', ownPerson(member)]} /></label>
      </section>

      <section className="specialty-chips"><button className={specialtyFilter === 'all' ? 'active' : ''} onClick={() => setSpecialtyFilter('all')}>Chronologia</button>{SPECIALTIES.map((s)=><button key={s} className={specialtyFilter === s ? 'active' : ''} onClick={() => setSpecialtyFilter(s)}>{s}</button>)}</section>

      <div className="health-dashboard-grid">
        <article className="health-card upcoming-health"><header><strong>📅 Najbliższe wizyty{person !== 'family' ? ` — ${person}` : ''}</strong><button onClick={() => openAdd('visit')}>Dodaj +</button></header>{upcomingVisits.length === 0 ? <p className="health-empty">Brak zaplanowanych wizyt.</p> : upcomingVisits.map((r)=><div className="health-list-row" key={r.id}><span className="health-date-tile"><b>{new Date(`${r.date}T12:00`).getDate()}</b><small>{new Date(`${r.date}T12:00`).toLocaleDateString('pl-PL',{month:'short'}).toUpperCase()}</small></span><div><strong>{r.person} — {r.specialty || r.title}</strong><small>{r.doctor || r.location || r.title}</small><p>{r.time}{r.referralCode ? ` · skierowanie: ${r.referralCode}` : ''}</p></div><span className="health-status">{r.status === 'toBook' ? 'Do umówienia' : r.status === 'booked' ? 'Umówiona' : 'Zaplanowana'}</span></div>)}</article>

        <article className="health-card"><header><strong>🔔 Przypomnienia</strong></header>{medicines.slice(0,3).map((r)=><div className="health-list-row" key={r.id}><span className="health-icon-tile">💊</span><div><strong>{r.title} — {r.person}</strong><small>{r.medicineTime || r.time}{r.dose ? ` · ${r.dose}` : ''}</small></div><button className={r.confirmedDate === formatDateInput(new Date()) ? 'confirmed-button' : 'medicine-confirm'} onClick={() => void confirmMedicine(r)}>{r.confirmedDate === formatDateInput(new Date()) ? '✓ Przyjęte' : 'Potwierdź'}</button></div>)}{controlItems.map((r)=><div className="health-list-row" key={`control-${r.id}`}><span className="health-icon-tile">☎️</span><div><strong>{r.nextControl ? `Kontrola: ${r.nextControl}` : 'Zadzwoń do rejestracji'}</strong><small>{r.callReminderDate ? `Przypomnienie: ${formatShortDate(r.callReminderDate)}` : r.specialty}</small></div></div>)}</article>

        {person === 'Paweł' && parent && <article className="health-card important-docs"><header><strong>🔒 Ważne dokumenty Pawła</strong><button onClick={() => openAdd('document')}>Dodaj +</button></header>{importantPawelDocs.length === 0 ? <p className="health-empty">Dodaj orzeczenie lub ważny dokument, aby mieć go zawsze pod ręką.</p> : importantPawelDocs.map((r)=><div className="document-row" key={r.id}><span>📁</span><div><strong>{r.title}</strong><small>Tylko rodzice</small></div>{(r.documentPath || r.documentURL) && <button onClick={()=>void openDocument(r)}>Pokaż lekarzowi</button>}</div>)}</article>}

        <article className="health-card"><header><strong>🕘 Historia wizyt</strong><small>Od najnowszych do najstarszych</small></header>{history.length === 0 ? <p className="health-empty">Brak historii.</p> : history.map((r)=><div className="timeline-health-row" key={r.id}><time>{r.date ? formatShortDate(r.date) : '—'}</time><span style={{ background:personColor(r.person) }} /><div><strong>{r.specialty || r.title}</strong><small>{r.person}{r.doctor ? ` · ${r.doctor}` : ''}</small><p>{r.note || r.location}</p></div></div>)}</article>

        <article className="health-card"><header><strong>📄 Dokumenty i wyniki</strong><button onClick={() => openAdd('result')}>Dodaj plik +</button></header>{documents.length === 0 ? <p className="health-empty">Brak dokumentów.</p> : documents.map((r)=><div className="document-row" key={r.id}><span>📄</span><div><strong>{r.title}</strong><small>{r.date ? formatShortDate(r.date) : ''} · {r.person}</small></div>{r.documentPath || r.documentURL ? <button onClick={()=>void openDocument(r)}>Otwórz</button> : <span>Bez pliku</span>}</div>)}</article>

        <article className="health-card medical-contacts"><header><strong>👥 Kontakty medyczne</strong>{parent && <button onClick={() => { setEditingContact(null); setContactForm({ person:person === 'family' ? 'family' : person, specialty:'', name:'', doctor:'', phone:'', address:'', note:'' }); setShowContactForm(true); }}>Dodaj +</button>}</header>{visibleContacts.length === 0 ? <p className="health-empty">Dodaj szpital, poradnię lub lekarza.</p> : visibleContacts.map((c)=><div className="contact-row" key={c.id}><span>🏥</span><div><strong>{c.name}</strong><small>{[c.specialty,c.doctor,c.address].filter(Boolean).join(' · ')}</small></div>{c.phone && <a href={`tel:${c.phone.replace(/\s/g,'')}`}>☎ {c.phone}</a>}{parent && <div className="health-record-actions"><button aria-label={`Edytuj kontakt: ${c.name}`} onClick={()=>{ const { id, ...fields } = c; setContactForm(fields); setEditingContact(c); setShowContactForm(true); }}>Edytuj</button><button aria-label={`Usuń kontakt: ${c.name}`} onClick={()=>{ if(confirm(`Usunąć kontakt „${c.name}”?`)) void deleteDoc(doc(db,'medicalContacts',c.id)); }}>Usuń</button></div>}</div>)}</article>
      </div>

      <section className="health-manager"><header><strong>Wszystkie wpisy</strong><span>{visibleRecords.length} wpisów</span></header>
        <div className="health-type-filter">{(['all', ...Object.keys(HEALTH_META)] as Array<HealthType | 'all'>).map(type=><button key={type} className={recordType === type ? 'active' : ''} onClick={()=>setRecordType(type)}>{type === 'all' ? 'Wszystkie' : HEALTH_META[type].label}</button>)}</div>
        {visibleRecords.length === 0 ? <EmptyState icon="❤️" text="Brak wpisów w tym widoku." /> : visibleRecords.map(record=><article className="module-row" key={record.id}><div className="row-main"><strong>{record.title}</strong><small>{record.person} · {HEALTH_META[record.type].label} · {record.date ? formatShortDate(record.date) : 'bez daty'}{record.privateToParents ? ' · tylko rodzice' : ''}</small><p>{record.note}</p></div><div className="health-record-actions">{(record.documentPath || record.documentURL) && <button onClick={()=>void openDocument(record)}>Plik</button>}{parent && <><button onClick={()=>editHealth(record)}>Edytuj</button><button onClick={()=>void removeHealth(record)}>Usuń</button></>}</div></article>)}
      </section>

      {showForm && <Modal title={`❤️ ${HEALTH_META[form.type].label}`} onClose={() => { if (!savingHealth) setShowForm(false); }} wide>
        <form className="form-grid" onSubmit={save}>
          <label className="field"><span>Osoba</span>{!parent ? <input value={ownPerson(member)} readOnly /> : <PersonSelect includeFamily={false} value={form.person} onChange={(value)=>setForm((f)=>({...f,person:value}))} />}</label>
          <label className="field"><span>Rodzaj</span><select aria-label="Rodzaj" value={form.type} onChange={(e)=>setForm((f)=>({...f,type:e.target.value as HealthType}))}>{(Object.keys(HEALTH_META) as HealthType[]).map((t)=><option key={t} value={t}>{HEALTH_META[t].icon} {HEALTH_META[t].label}</option>)}</select></label>
          <label className="field field-wide"><span>Nazwa / opis</span><input value={form.title} onChange={(e)=>setForm((f)=>({...f,title:e.target.value}))} placeholder="Np. neurolog — kontrola" required /></label>
          <label className="field"><span>Specjalizacja</span><select aria-label="Specjalizacja" value={form.specialty} onChange={(e)=>setForm((f)=>({...f,specialty:e.target.value}))}><option value="">—</option>{SPECIALTIES.map((s)=><option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Status</span><select aria-label="Status" value={form.status} onChange={(e)=>setForm((f)=>({...f,status:e.target.value as HealthStatus}))}><option value="planned">Zaplanowana</option><option value="toBook">Do umówienia</option><option value="booked">Umówiona</option><option value="done">Odbyta</option><option value="cancelled">Anulowana</option></select></label>
          <label className="field"><span>Data</span><input type="date" value={form.date} onChange={(e)=>setForm((f)=>({...f,date:e.target.value}))} /></label>
          <label className="field"><span>Godzina</span><input type="time" value={form.time} onChange={(e)=>setForm((f)=>({...f,time:e.target.value}))} /></label>
          <label className="field"><span>Lekarz</span><input value={form.doctor} onChange={(e)=>setForm((f)=>({...f,doctor:e.target.value}))} /></label>
          <label className="field"><span>Placówka / miejsce</span><input value={form.location} onChange={(e)=>setForm((f)=>({...f,location:e.target.value}))} /></label>
          <label className="field"><span>Kod skierowania</span><input value={form.referralCode} onChange={(e)=>setForm((f)=>({...f,referralCode:e.target.value}))} /></label>
          <label className="field"><span>Kontrola / orientacyjny termin</span><input value={form.nextControl} onChange={(e)=>setForm((f)=>({...f,nextControl:e.target.value}))} placeholder="Np. za 6 miesięcy" /></label>
          <label className="field"><span>Przypomnij, aby zadzwonić</span><input type="date" value={form.callReminderDate} onChange={(e)=>setForm((f)=>({...f,callReminderDate:e.target.value}))} /></label>
          {form.type === 'medicine' && <><label className="field"><span>Dawka</span><input value={form.dose} onChange={(e)=>setForm((f)=>({...f,dose:e.target.value}))} /></label><label className="field"><span>Godzina leku</span><input type="time" value={form.medicineTime} onChange={(e)=>setForm((f)=>({...f,medicineTime:e.target.value}))} /></label></>}
          <label className="field field-wide"><span>Notatka / zalecenia</span><textarea rows={3} value={form.note} onChange={(e)=>setForm((f)=>({...f,note:e.target.value}))} /></label>
          <label className="field field-wide"><span>Plik (PDF / zdjęcie)</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={savingHealth} onChange={(e)=>{ resetUpload(); setForm((f)=>({...f,file:e.target.files?.[0] || null})); }} /></label>
          <HealthUploadStatus progress={uploadProgress} fileName={uploadFileName} error={uploadProgress.phase === 'error' ? uploadError : undefined} />
          {uploadError && uploadProgress.phase !== 'error' && <p className="field-wide health-save-error" role="alert">{uploadProgress.phase === 'uploaded' ? 'Plik został przesłany, ale zapis wpisu wymaga ponowienia. ' : ''}{uploadError}</p>}
          {parent && <label className="checkbox-field field-wide"><input type="checkbox" checked={form.privateToParents} onChange={(e)=>setForm((f)=>({...f,privateToParents:e.target.checked}))} /><span>🔒 Widoczne tylko dla rodziców</span></label>}
          {form.type === 'visit' && !form.privateToParents && !editingHealth && <label className="checkbox-field field-wide"><input type="checkbox" checked={form.addToCalendar} onChange={(e)=>setForm((f)=>({...f,addToCalendar:e.target.checked}))} /><span>Dodaj również do rodzinnego Kalendarza</span></label>}
          <div className="form-actions field-wide"><button type="button" className="secondary-button" disabled={savingHealth} onClick={()=>setShowForm(false)}>Anuluj</button><button className="primary-button" disabled={savingHealth}>{savingHealth ? "Zapisuję…" : "✓ Zapisz"}</button></div>
        </form>
      </Modal>}

      {showContactForm && <Modal title={editingContact ? "☎️ Edytuj kontakt medyczny" : "☎️ Nowy kontakt medyczny"} onClose={()=>setShowContactForm(false)}>
        <form className="form-grid" onSubmit={saveContact}><label className="field"><span>Osoba / rodzina</span><PersonSelect value={contactForm.person} onChange={(value)=>setContactForm((f)=>({...f,person:value}))} /></label><label className="field"><span>Specjalizacja</span><input value={contactForm.specialty} onChange={(e)=>setContactForm((f)=>({...f,specialty:e.target.value}))} /></label><label className="field field-wide"><span>Nazwa placówki</span><input value={contactForm.name} onChange={(e)=>setContactForm((f)=>({...f,name:e.target.value}))} required /></label><label className="field"><span>Lekarz</span><input value={contactForm.doctor} onChange={(e)=>setContactForm((f)=>({...f,doctor:e.target.value}))} /></label><label className="field"><span>Telefon</span><input value={contactForm.phone} onChange={(e)=>setContactForm((f)=>({...f,phone:e.target.value}))} /></label><label className="field field-wide"><span>Adres</span><input value={contactForm.address} onChange={(e)=>setContactForm((f)=>({...f,address:e.target.value}))} /></label><label className="field field-wide"><span>Notatka</span><textarea value={contactForm.note} onChange={(e)=>setContactForm((f)=>({...f,note:e.target.value}))} /></label><div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={()=>setShowContactForm(false)}>Anuluj</button><button className="primary-button" disabled={savingContact}>{savingContact ? "Zapisuję…" : "✓ Zapisz"}</button></div></form>
      </Modal>}
    </div>
  );
}
