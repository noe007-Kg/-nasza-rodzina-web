import { collection, db, EmptyState, errorMessage, formatDateInput, formatShortDate, getBlob, isParent, isPersonKey, type Member, memberEmoji, Modal, ModuleHeader, notify, onSnapshot, ownPerson, type PersonKey, personLabel, PersonSelect, React, storage, storageRef, type TaskItem, type TaskPriority, type TaskRepeat, Timestamp, useEffect, useMemo, type User, useRef, useState } from '../app-shared';
import { uploadBytesResumable } from 'firebase/storage';
import { familyAction, familyV2WritesAllowed } from '../family-v2-client';
import { useFamilyDirectory } from '../family-directory';
import { memberPersonKey } from '../family-members';
import { TASK_PHOTO_LIMIT, uploadTaskPhoto, validateTaskPhoto, type TaskUploadProgress } from './tasks-upload';
import './tasks-v2.css';

export const TASK_TEMPLATES = [
  ['🗑️', 'Wynieść śmieci'], ['🛏️', 'Posprzątać pokój'], ['🛁', 'Umyć łazienkę'], ['🪟', 'Umyć okna'],
  ['🧹', 'Odkurzyć'], ['🧺', 'Pranie'], ['🍽️', 'Zmywarka'], ['🐶', 'Nakarmić psa'],
] as const;
type VerificationMode = 'trust' | 'parent' | 'photo';
type ManagedTask = TaskItem & { verificationMode: VerificationMode; proofPath?: string; reworkComment?: string; archived?: boolean };
type Draft = { id: string; title: string; person: PersonKey; dueDate: string; priority: TaskPriority; note: string; points: number; verificationMode: VerificationMode; repeat: TaskRepeat };
type Balance = { person: string; name: string; balance: number; earned: number; spent: number; completedCount: number };
type Reward = { id: string; title: string; note: string; cost: number; people: string[]; active: boolean };
type RewardRequest = { id: string; rewardId: string; person: string; title: string; cost: number; state: 'pending' | 'approved' | 'rejected'; requestedAt: number };
type Ledger = { id: string; person: string; delta: number; title: string; createdAt: number };
type PointsState = { writesEnabled?: boolean; storageConfigured: boolean; balances: Balance[]; rewards: Reward[]; requests: RewardRequest[]; history: Ledger[] };
const emptyPoints: PointsState = { storageConfigured: false, balances: [], rewards: [], requests: [], history: [] };
const modeLabel: Record<VerificationMode, string> = { trust: 'Na zaufanie', parent: 'Zatwierdzenie rodzica', photo: 'Zdjęcie + zatwierdzenie' };
const uploadLabels: Record<TaskUploadProgress['phase'], string> = { idle: '', preparing: 'Przygotowywanie zdjęcia', uploading: 'Przesyłanie zdjęcia', saving: 'Zapisywanie zgłoszenia', submitted: 'Wysłano do zatwierdzenia', error: 'Nie udało się przesłać — spróbuj ponownie' };

export function TasksPage({ user, member }: { user: User; member: Member | null }) {
  const directory = useFamilyDirectory();
  const profiles = directory.filter(profile => profile.active !== false && !profile.archived && !profile.disabled);
  const [items, setItems] = useState<ManagedTask[]>([]);
  const [pointsState, setPointsState] = useState<PointsState>(emptyPoints);
  const [pointsOwner, setPointsOwner] = useState('');
  const [backendMessage, setBackendMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ManagedTask | null>(null);
  const [form, setForm] = useState<Draft>({ id: '', title: '', person: 'family', dueDate: '', priority: 'normal', note: '', points: 5, verificationMode: 'parent', repeat: 'none' });
  const [filter, setFilter] = useState<'all' | 'today' | 'upcoming' | 'pending' | 'done'>('all');
  const [tab, setTab] = useState<'tasks' | 'rewards'>('tasks');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const alive = useRef(true);
  const [photoTask, setPhotoTask] = useState<ManagedTask | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoProgress, setPhotoProgress] = useState<TaskUploadProgress>({ phase: 'idle', percent: 0 });
  const [photoError, setPhotoError] = useState('');
  const uploadedProof = useRef<{ file: File; taskId: string; path: string; uploadId: string } | null>(null);
  const [proofPreview, setProofPreview] = useState<{ title: string; url: string } | null>(null);
  const [rewardForm, setRewardForm] = useState<Reward | null>(null);
  const [reworkTask, setReworkTask] = useState<ManagedTask | null>(null);
  const [reworkComment, setReworkComment] = useState('');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const parent = isParent(member);
  const own = ownPerson(member);
  const today = formatDateInput(new Date());
  const backend = pointsOwner === user.uid ? pointsState : emptyPoints;
  const writesAllowed = familyV2WritesAllowed() && backend.writesEnabled === true;
  const profileName = (person: string) => profiles.find(profile => memberPersonKey(profile) === person)?.name || personLabel(person);

  async function reloadPoints() {
    try {
      const state = await familyAction<PointsState>('tasks', { action: 'state' });
      if (alive.current) { setPointsState(state); setPointsOwner(user.uid); setBackendMessage(''); }
    } catch (error) {
      if (alive.current) { setPointsState(emptyPoints); setPointsOwner(user.uid); setBackendMessage(error instanceof Error ? error.message : 'Punkty i nagrody wymagają konfiguracji backendu.'); }
    }
  }
  useEffect(() => {
    alive.current = true; void reloadPoints();
    const stop = onSnapshot(collection(db, 'tasks'), snap => {
      const next = snap.docs.map((record): ManagedTask => {
        const raw = record.data();
        return { id: record.id, title: String(raw.title || ''), person: isPersonKey(raw.person) ? raw.person : 'family', done: raw.done === true,
          dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : '', priority: raw.priority === 'low' || raw.priority === 'high' ? raw.priority : 'normal',
          note: typeof raw.note === 'string' ? raw.note : '', points: Number(raw.points || 0), requireApproval: raw.requireApproval === true,
          approvalStatus: raw.approvalStatus === 'pending' || raw.approvalStatus === 'approved' ? raw.approvalStatus : 'none',
          verificationMode: ['trust', 'parent', 'photo'].includes(raw.verificationMode) ? raw.verificationMode : raw.requireApproval === true ? 'parent' : 'trust',
          repeat: raw.repeat === 'daily' || raw.repeat === 'weekly' || raw.repeat === 'monthly' ? raw.repeat : 'none',
          createdAt: raw.createdAt instanceof Timestamp ? raw.createdAt.toDate() : undefined,
          completedAt: raw.completedAt instanceof Timestamp ? raw.completedAt.toDate() : undefined,
          proofPath: typeof raw.proofPath === 'string' ? raw.proofPath : undefined, reworkComment: typeof raw.reworkComment === 'string' ? raw.reworkComment : undefined, archived: raw.archived === true };
      }).filter(item => !item.archived);
      next.sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
      setItems(next);
    });
    return () => { alive.current = false; stop(); };
  }, [user.uid]);
  useEffect(() => () => { if (proofPreview) URL.revokeObjectURL(proofPreview.url); }, [proofPreview]);

  const visible = items.filter(item => filter === 'today' ? !item.done && item.dueDate === today
    : filter === 'upcoming' ? !item.done && !!item.dueDate && item.dueDate > today
      : filter === 'pending' ? item.approvalStatus === 'pending' : filter === 'done' ? item.done : true);
  const balances = useMemo(() => [...backend.balances].sort((a, b) => b.earned - a.earned || a.name.localeCompare(b.name, 'pl')), [backend.balances]);
  const ownBalance = balances.find(balance => balance.person === own)?.balance || 0;

  async function action(body: Record<string, unknown>, message?: string) {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(String(body.taskId || body.requestId || body.action));
    try { await familyAction('tasks', body); if (message) notify(message); await reloadPoints(); return true; }
    catch (error) { notify(error instanceof Error ? error.message : errorMessage(error), 'error'); return false; }
    finally { busyRef.current = false; if (alive.current) setBusy(''); }
  }
  function openAdd(template = '') {
    setEditing(null); setForm({ id: crypto.randomUUID(), title: template, person: parent ? 'family' : own, dueDate: today,
      priority: 'normal', note: '', points: parent ? 5 : 0, verificationMode: 'parent', repeat: 'none' }); setShowForm(true);
  }
  function openEdit(item: ManagedTask) {
    setEditing(item); setForm({ id: item.id, title: item.title, person: item.person, dueDate: item.dueDate, priority: item.priority,
      note: item.note, points: item.points, verificationMode: item.verificationMode, repeat: item.repeat }); setShowForm(true);
  }
  async function save(event: React.FormEvent) { event.preventDefault(); if (await action({ action: 'save-task', ...form }, 'Zapisano zadanie.')) setShowForm(false); }
  async function complete(item: ManagedTask) {
    if (item.verificationMode === 'photo') { setPhotoTask(item); setPhotoFile(null); uploadedProof.current = null; setPhotoError(''); setPhotoProgress({ phase: 'idle', percent: 0 }); }
    else await action({ action: 'submit', taskId: item.id }, item.verificationMode === 'trust' || parent ? 'Zadanie wykonane, punkty zapisane.' : 'Wysłano do zatwierdzenia rodzica.');
  }
  async function sendPhoto(event: React.FormEvent) {
    event.preventDefault(); if (!photoTask || !photoFile || busyRef.current) return;
    busyRef.current = true; setBusy(photoTask.id); setPhotoError('');
    try {
      validateTaskPhoto(photoFile); setPhotoProgress({ phase: 'preparing', percent: 0 });
      let proof = uploadedProof.current;
      if (!proof || proof.file !== photoFile || proof.taskId !== photoTask.id) {
        const ticket = await familyAction<{ uploadId: string; path: string }>('tasks', { action: 'begin-photo', taskId: photoTask.id, contentType: photoFile.type, size: photoFile.size });
        await uploadTaskPhoto(uploadBytesResumable(storageRef(storage, ticket.path), photoFile, { contentType: photoFile.type,
          customMetadata: { taskId: photoTask.id, uploadId: ticket.uploadId, uploaderUid: user.uid } }), setPhotoProgress);
        proof = { file: photoFile, taskId: photoTask.id, ...ticket }; uploadedProof.current = proof;
      }
      setPhotoProgress({ phase: 'saving', percent: 100 });
      await familyAction('tasks', { action: 'submit', taskId: photoTask.id, uploadId: proof.uploadId });
      setPhotoProgress({ phase: 'submitted', percent: 100 }); await reloadPoints();
    } catch (error) { setPhotoError(error instanceof Error ? error.message : errorMessage(error)); setPhotoProgress(progress => ({ ...progress, phase: 'error' })); uploadedProof.current = null; }
    finally { busyRef.current = false; if (alive.current) setBusy(''); }
  }
  async function openProof(item: ManagedTask) {
    if (!item.proofPath) return;
    try { const blob = await getBlob(storageRef(storage, item.proofPath), TASK_PHOTO_LIMIT); setProofPreview({ title: item.title, url: URL.createObjectURL(blob) }); }
    catch (error) { notify(errorMessage(error), 'error'); }
  }

  return <div className="page-content compact-page tasks-v130 tasks-v2" data-testid="tasks-v2">
    <ModuleHeader icon="✅" title="Zadania" text="Rodzinne obowiązki, postępy i wspólnie ustalone nagrody." action={<button className="primary-button" disabled={!writesAllowed || !!busy} onClick={() => openAdd()}>＋ Dodaj zadanie</button>} />
    {(backendMessage || !writesAllowed) && <p className="tasks-setup-note" role="status">{backendMessage || 'Nowe operacje zapisu wymagają konfiguracji backendu i reguł Firebase. W Preview z produkcyjną bazą pozostają wyłączone.'} Istniejące zadania pozostają dostępne.</p>}
    <nav className="tasks-v2-tabs" aria-label="Widok zadań"><button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>Zadania rodzinne</button><button className={tab === 'rewards' ? 'active' : ''} onClick={() => setTab('rewards')}>Punkty i nagrody</button></nav>
    <section className="task-summary-v130">
      <button onClick={() => { setTab('tasks'); setFilter('today'); }}><strong>{items.filter(item => !item.done && item.dueDate === today).length}</strong><span>Dzisiaj</span></button>
      <button onClick={() => { setTab('tasks'); setFilter('pending'); }}><strong>{items.filter(item => item.approvalStatus === 'pending').length}</strong><span>Do zatwierdzenia</span></button>
      <button onClick={() => { setTab('tasks'); setFilter('done'); }}><strong>{items.filter(item => item.done).length}</strong><span>Wykonane</span></button>
      <button onClick={() => setTab('rewards')}><strong>⭐ {parent ? balances.reduce((sum, balance) => sum + balance.balance, 0) : ownBalance}</strong><span>{parent ? 'Punkty do wykorzystania' : 'Moje punkty'}</span></button>
    </section>
    {tab === 'tasks' ? <>
      <section className="tasks-person-progress" aria-label="Postępy rodziny">{profiles.map(profile => {
        const person = memberPersonKey(profile); const assigned = items.filter(item => item.person === person); const finished = assigned.filter(item => item.done).length;
        const balance = balances.find(value => value.person === person);
        return <article key={profile.id}><span className="tasks-profile-avatar">{profile.photoURL ? <img src={profile.photoURL} alt="" /> : profile.emoji || memberEmoji(profile.name || '')}</span><div><strong>{profile.name || person}</strong><small>{finished} z {assigned.length} obowiązków · {balance?.balance || 0} pkt</small><progress max={Math.max(1, assigned.length)} value={finished} aria-label={`Postęp ${profile.name || person}`} /></div></article>;
      })}</section>
      <details className="quick-task-section"><summary>⚡ Szybkie zadania</summary><div className="quick-task-grid">{TASK_TEMPLATES.map(([icon, title]) => <button key={title} disabled={!writesAllowed || !!busy} onClick={() => openAdd(title)}><span>{icon}</span><strong>{title}</strong></button>)}</div></details>
      <div className="tasks-main-grid"><section>
        <div className="task-filters">{([['all', 'Wszystkie'], ['today', 'Dzisiaj'], ['upcoming', 'Nadchodzące'], ['pending', 'Do zatwierdzenia'], ['done', 'Wykonane']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <section className="module-list compact-list">{visible.length === 0 ? <EmptyState icon="✨" text="Brak zadań w tym widoku." /> : visible.map(item => <article className={`module-row task-row task-row-v130 ${item.done ? 'done' : ''} ${item.approvalStatus === 'pending' ? 'pending' : ''}`} key={item.id}>
          <button className="check-button" aria-label={`Oznacz wykonanie: ${item.title}`} disabled={!writesAllowed || !!busy || item.done || item.approvalStatus === 'pending' || !parent && !['family', own].includes(item.person)} onClick={() => void complete(item)}>{item.done ? '✓' : item.approvalStatus === 'pending' ? '⌛' : '○'}</button>
          <div className="row-main"><strong>{item.title}</strong><small>{profileName(item.person)} · {item.dueDate ? formatShortDate(item.dueDate) : 'bez terminu'}{item.repeat !== 'none' ? ` · ${item.repeat === 'daily' ? 'codziennie' : item.repeat === 'weekly' ? 'co tydzień' : 'co miesiąc'}` : ''}</small><small>{item.approvalStatus === 'pending' ? 'Oczekuje na zatwierdzenie' : modeLabel[item.verificationMode]}</small>{item.note && <p>{item.note}</p>}{item.reworkComment && <p className="tasks-rework">Do poprawy: {item.reworkComment}</p>}</div>
          <span className={`priority-badge ${item.priority}`}>{item.priority === 'high' ? 'Ważne' : item.priority === 'low' ? 'Niski' : 'Normalny'}</span>{item.points > 0 && <span className="task-points">+{item.points} pkt</span>}
          {parent && item.approvalStatus === 'pending' && <div className="approval-actions">{item.proofPath && <button onClick={() => void openProof(item)}>Zobacz zdjęcie</button>}<button disabled={!writesAllowed || !!busy} onClick={() => void action({ action: 'approve', taskId: item.id }, 'Zatwierdzono zadanie. Punkty zapisano; zdjęcie usuwane jest z magazynu.')}>✓ Zatwierdź</button><button disabled={!writesAllowed || !!busy} onClick={() => { setReworkTask(item); setReworkComment(''); }}>Do poprawy</button></div>}
          {parent && !item.done && item.approvalStatus !== 'pending' && <button className="icon-button" aria-label={`Edytuj zadanie: ${item.title}`} disabled={!writesAllowed || !!busy} onClick={() => openEdit(item)}>✏️</button>}
          {parent && <button className="icon-danger" aria-label={`Archiwizuj zadanie: ${item.title}`} disabled={!writesAllowed || !!busy} onClick={() => { if (confirm(`Usunąć zadanie „${item.title}” z aktywnej listy? Historia i punkty pozostaną.`)) void action({ action: 'archive-task', taskId: item.id, confirmed: true }); }}>🗑️</button>}
        </article>)}</section>
      </section><aside className="points-panel"><header><strong>🏆 Ranking rodzinny</strong><small>Według wszystkich zdobytych punktów</small></header>{balances.length === 0 ? <p className="tasks-muted">Saldo jest dostępne po konfiguracji backendu.</p> : balances.map((balance, index) => <article key={balance.person}><div><span className="points-avatar">{index + 1}</span><div><strong>{balance.name}</strong><small>{balance.earned} zdobytych · {balance.balance} do wykorzystania</small></div></div><div className="tasks-badges">{balance.completedCount >= 1 && <span>🌟 Pierwszy krok</span>}{balance.completedCount >= 10 && <span>🏅 10 obowiązków</span>}{balance.earned >= 100 && <span>🏆 100 punktów</span>}</div></article>)}<button className="secondary-button" onClick={() => setTab('rewards')}>Punkty i nagrody →</button><small className="points-note">Saldo i wymiany zatwierdza serwer. Odznaki wynikają z historii wykonania.</small></aside></div>
    </> : <section className="tasks-rewards-view">
      <header><div><h2>Punkty i nagrody</h2><p>{parent ? 'Ustal nagrody i zatwierdzaj prośby dzieci.' : `Masz ${ownBalance} pkt do wykorzystania.`}</p></div>{parent && <button className="primary-button" disabled={!writesAllowed || !!busy} onClick={() => setRewardForm({ id: crypto.randomUUID(), title: '', note: '', cost: 100, people: [], active: true })}>＋ Dodaj nagrodę</button>}</header>
      <div className="tasks-reward-grid">{backend.rewards.length === 0 ? <EmptyState icon="🎁" text="Nie dodano jeszcze nagród." /> : backend.rewards.map(reward => <article key={reward.id}><span aria-hidden="true">🎁</span><h3>{reward.title}</h3><p>{reward.note}</p><strong>{reward.cost} pkt</strong>{!reward.active && <small>Nieaktywna</small>}{parent ? <button className="secondary-button" disabled={!writesAllowed || !!busy} onClick={() => setRewardForm({ ...reward })}>Edytuj nagrodę</button> : <><progress value={Math.min(ownBalance, reward.cost)} max={reward.cost} aria-label={`Postęp do nagrody ${reward.title}`} /><small>{ownBalance} / {reward.cost} pkt</small><button className="primary-button" disabled={!writesAllowed || !!busy || backend.requests.some(request => request.rewardId === reward.id && request.state === 'pending')} onClick={() => void action({ action: 'request-reward', rewardId: reward.id }, 'Prośba wysłana. Punkty zostaną odjęte dopiero po zatwierdzeniu.')}>Poproś o nagrodę</button></>}</article>)}</div>
      <section className="tasks-request-list"><h3>{parent ? 'Prośby o nagrody' : 'Moje prośby'}</h3>{backend.requests.length === 0 ? <p className="tasks-muted">Brak próśb o nagrody.</p> : backend.requests.map(request => <article key={request.id}><div><strong>{request.title}</strong><small>{profileName(request.person)} · {request.cost} pkt · {request.requestedAt ? new Date(request.requestedAt).toLocaleDateString('pl-PL') : ''}</small></div><span className={`tasks-request-status ${request.state}`}>{request.state === 'pending' ? 'Do zatwierdzenia' : request.state === 'approved' ? 'Zatwierdzono' : 'Odmowa'}</span>{parent && request.state === 'pending' && <div className="approval-actions"><button disabled={!writesAllowed || !!busy} onClick={() => void action({ action: 'decide-reward', requestId: request.id, approved: true }, 'Zatwierdzono wymianę punktów.')}>Zatwierdź</button><button disabled={!writesAllowed || !!busy} onClick={() => void action({ action: 'decide-reward', requestId: request.id, approved: false }, 'Odmowa zapisana. Saldo bez zmian.')}>Odmów</button></div>}</article>)}</section>
      <section className="tasks-ledger"><h3>Historia punktów</h3>{backend.history.length === 0 ? <p className="tasks-muted">Nowe operacje pojawią się tutaj. Punkty ze starych wykonanych zadań zachowano jako saldo początkowe.</p> : <><ul>{(historyExpanded ? backend.history : backend.history.slice(0, 5)).map(entry => <li key={entry.id}><div><strong>{entry.title}</strong><small>{profileName(entry.person)} · {entry.createdAt ? new Date(entry.createdAt).toLocaleString('pl-PL') : ''}</small></div><b className={entry.delta < 0 ? 'spent' : ''}>{entry.delta > 0 ? '+' : ''}{entry.delta} pkt</b></li>)}</ul>{backend.history.length > 5 && <button className="secondary-button" onClick={() => setHistoryExpanded(!historyExpanded)}>{historyExpanded ? 'Zwiń listę' : `Pokaż wszystkie (${backend.history.length})`}</button>}</>}</section>
    </section>}
    {showForm && <Modal title={editing ? 'Edytuj zadanie' : 'Nowe zadanie'} onClose={() => !busy && setShowForm(false)} wide><form className="form-grid" onSubmit={save}>
      <label className="field field-wide"><span>Zadanie</span><input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={500} /></label>
      <label className="field"><span>Osoba</span><PersonSelect allowed={parent ? undefined : ['family', own]} value={form.person} onChange={person => setForm({ ...form, person })} /></label>
      <label className="field"><span>Termin</span><input type="date" value={form.dueDate} onChange={event => setForm({ ...form, dueDate: event.target.value })} /></label>
      <label className="field"><span>Priorytet</span><select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value as TaskPriority })}><option value="low">Niski</option><option value="normal">Normalny</option><option value="high">Ważne</option></select></label>
      <label className="field"><span>Powtarzanie</span><select value={form.repeat} onChange={event => setForm({ ...form, repeat: event.target.value as TaskRepeat })}><option value="none">Nie powtarzaj</option><option value="daily">Codziennie</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option></select></label>
      {parent && <><label className="field"><span>Punkty</span><input type="number" min={0} max={500} step={1} value={form.points} onChange={event => setForm({ ...form, points: Number(event.target.value) })} /></label><label className="field"><span>Potwierdzenie wykonania</span><select value={form.verificationMode} onChange={event => setForm({ ...form, verificationMode: event.target.value as VerificationMode })}><option value="trust">Na zaufanie</option><option value="parent">Zatwierdzenie rodzica</option><option value="photo">Potwierdzenie zdjęciem</option></select></label></>}
      <label className="field field-wide"><span>Opis / notatka</span><textarea rows={3} maxLength={5000} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /></label>
      {form.verificationMode === 'photo' && <p className="field-wide tasks-muted">Zdjęcie jest wymagane przy zgłoszeniu. Po zatwierdzeniu zostanie usunięte z magazynu, a historia wykonania pozostanie.</p>}
      <div className="form-actions field-wide"><button className="secondary-button" type="button" disabled={!!busy} onClick={() => setShowForm(false)}>Anuluj</button><button className="primary-button" disabled={!writesAllowed || !!busy}>{busy ? 'Zapisuję…' : 'Zapisz zadanie'}</button></div>
    </form></Modal>}
    {photoTask && <Modal title={`Potwierdź zdjęciem: ${photoTask.title}`} onClose={() => !busy && setPhotoTask(null)}><form className="tasks-photo-form" onSubmit={sendPhoto}>
      <p>Zdjęcie zobaczy osoba zgłaszająca i uprawniony rodzic. Punkty zostaną przyznane po zatwierdzeniu.</p>
      <label className="field"><span>Zdjęcie wykonania</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!!busy || photoProgress.phase === 'submitted'} onChange={event => { setPhotoFile(event.target.files?.[0] || null); uploadedProof.current = null; setPhotoProgress({ phase: 'idle', percent: 0 }); setPhotoError(''); }} /></label>
      {!backend.storageConfigured && <p role="status">Przesyłanie zdjęć wymaga konfiguracji chronionego Storage.</p>}
      {photoProgress.phase !== 'idle' && <div className="tasks-photo-progress" role="status"><strong>{uploadLabels[photoProgress.phase]}</strong><progress max={100} value={photoProgress.percent} aria-label="Postęp przesyłania zdjęcia" /><span>{photoProgress.percent}%</span></div>}
      {photoError && <p className="tasks-rework" role="alert">{photoError}</p>}
      <div className="form-actions">{photoProgress.phase === 'submitted' ? <button type="button" className="primary-button" onClick={() => setPhotoTask(null)}>Gotowe</button> : <><button type="button" className="secondary-button" disabled={!!busy} onClick={() => setPhotoTask(null)}>Anuluj</button><button className="primary-button" disabled={!writesAllowed || !backend.storageConfigured || !photoFile || !!busy}>{busy ? 'Wysyłam…' : photoError ? 'Spróbuj ponownie' : 'Wyślij do zatwierdzenia'}</button></>}</div>
    </form></Modal>}
    {proofPreview && <Modal title={`Zdjęcie wykonania: ${proofPreview.title}`} onClose={() => setProofPreview(null)}><img className="tasks-proof-preview" src={proofPreview.url} alt={`Potwierdzenie zadania ${proofPreview.title}`} /></Modal>}
    {reworkTask && <Modal title="Zadanie do poprawy" onClose={() => !busy && setReworkTask(null)}><form onSubmit={async event => { event.preventDefault(); if (await action({ action: 'rework', taskId: reworkTask.id, comment: reworkComment }, 'Wysłano zadanie do poprawy.')) setReworkTask(null); }}><label className="field"><span>Wskazówka dla wykonującego</span><textarea maxLength={1000} value={reworkComment} onChange={event => setReworkComment(event.target.value)} /></label><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setReworkTask(null)} disabled={!!busy}>Anuluj</button><button className="primary-button" disabled={!writesAllowed || !!busy}>Do poprawy</button></div></form></Modal>}
    {rewardForm && <Modal title="Nagroda" onClose={() => !busy && setRewardForm(null)}><form className="form-grid" onSubmit={async event => { event.preventDefault(); if (await action({ action: 'save-reward', ...rewardForm }, 'Zapisano nagrodę.')) setRewardForm(null); }}>
      <label className="field field-wide"><span>Nazwa nagrody</span><input value={rewardForm.title} required maxLength={200} onChange={event => setRewardForm({ ...rewardForm, title: event.target.value })} /></label><label className="field"><span>Koszt punktowy</span><input type="number" min={1} max={100000} step={1} value={rewardForm.cost} onChange={event => setRewardForm({ ...rewardForm, cost: Number(event.target.value) })} /></label><label className="checkbox-field"><input type="checkbox" checked={rewardForm.active} onChange={event => setRewardForm({ ...rewardForm, active: event.target.checked })} /><span>Nagroda aktywna</span></label><label className="field field-wide"><span>Opis</span><textarea maxLength={1000} value={rewardForm.note} onChange={event => setRewardForm({ ...rewardForm, note: event.target.value })} /></label>
      <fieldset className="field-wide tasks-reward-people"><legend>Dostępna dla (brak zaznaczeń = wszyscy)</legend>{profiles.filter(profile => profile.role !== 'parent').map(profile => { const person = memberPersonKey(profile); return <label className="checkbox-field" key={profile.id}><input type="checkbox" checked={rewardForm.people.includes(person)} onChange={event => setRewardForm({ ...rewardForm, people: event.target.checked ? [...rewardForm.people, person] : rewardForm.people.filter(value => value !== person) })} /><span>{profile.name || person}</span></label>; })}</fieldset>
      <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={() => setRewardForm(null)} disabled={!!busy}>Anuluj</button><button className="primary-button" disabled={!writesAllowed || !!busy}>Zapisz nagrodę</button></div>
    </form></Modal>}
  </div>;
}
