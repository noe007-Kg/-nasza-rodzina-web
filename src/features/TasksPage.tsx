import { addDays, addDoc, addMonths, collection, db, deleteDoc, doc, EmptyState, errorMessage, formatDateInput, formatShortDate, isParent, isPersonKey, type Member, memberEmoji, Modal, ModuleHeader, notify, onSnapshot, ownPerson, type PersonKey, personLabel, PersonSelect, React, runTransaction, type TaskForm, type TaskItem, type TaskPriority, type TaskRepeat, Timestamp, updateDoc, useEffect, useMemo, type User, useRef, useState } from "../app-shared";

export const TASK_TEMPLATES = [
  ['🗑️', 'Wynieść śmieci'], ['🛏️', 'Posprzątać pokój'], ['🛁', 'Umyć łazienkę'], ['🪟', 'Umyć okna'],
  ['🧹', 'Odkurzyć'], ['🧺', 'Pranie'], ['🍽️', 'Zmywarka'], ['🐶', 'Nakarmić psa'],
] as const;

export function TasksPage({ user, member }: { user: User; member: Member | null }) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [form, setForm] = useState<TaskForm>({ title: '', person: 'family', dueDate: '', priority: 'normal', note: '', points: 5, requireApproval: true, repeat: 'none' });
  const [filter, setFilter] = useState<'all' | 'today' | 'upcoming' | 'pending' | 'done'>('all');
  const parent = isParent(member);
  const [savingTask, setSavingTask] = useState(false);
  const taskSavingRef = useRef(false);
  const today = formatDateInput(new Date());

  useEffect(() => onSnapshot(collection(db, 'tasks'), (snap) => {
    const next = snap.docs.map((d): TaskItem => {
      const x = d.data();
      return {
        id: d.id,
        title: String(x.title || ''),
        person: isPersonKey(x.person) ? x.person : 'family',
        done: x.done === true,
        dueDate: typeof x.dueDate === 'string' ? x.dueDate : '',
        priority: x.priority === 'low' || x.priority === 'high' ? x.priority : 'normal',
        note: typeof x.note === 'string' ? x.note : '',
        points: Number(x.points || 0),
        requireApproval: x.requireApproval === true,
        approvalStatus: x.approvalStatus === 'pending' || x.approvalStatus === 'approved' ? x.approvalStatus : 'none',
        repeat: x.repeat === 'daily' || x.repeat === 'weekly' || x.repeat === 'monthly' ? x.repeat : 'none',
        createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined,
        completedAt: x.completedAt instanceof Timestamp ? x.completedAt.toDate() : undefined,
      };
    });
    next.sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    setItems(next);
  }), []);

  const visible = items.filter((item) => {
    if (filter === 'today') return !item.done && item.dueDate === today;
    if (filter === 'upcoming') return !item.done && !!item.dueDate && item.dueDate > today;
    if (filter === 'pending') return item.approvalStatus === 'pending';
    if (filter === 'done') return item.done;
    return true;
  });

  const pointsByPerson = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of items) {
      if (item.done && (item.approvalStatus === 'approved' || !item.requireApproval)) result[item.person] = (result[item.person] || 0) + item.points;
    }
    return result;
  }, [items]);

  function openAdd(template?: string) {
    setEditing(null);
    setForm({ title: template || '', person: parent ? 'family' : ownPerson(member), dueDate: today, priority: 'normal', note: '', points: 5, requireApproval: true, repeat: 'none' });
    setShowForm(true);
  }
  function openEdit(item: TaskItem) {
    setEditing(item);
    setForm({ title: item.title, person: item.person, dueDate: item.dueDate, priority: item.priority, note: item.note, points: item.points, requireApproval: item.requireApproval, repeat: item.repeat });
    setShowForm(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim() || taskSavingRef.current) return;
    if (!parent && form.person !== ownPerson(member) && form.person !== 'family') { notify('Możesz przypisać zadanie sobie lub całej rodzinie.', 'error'); return; }
    taskSavingRef.current = true; setSavingTask(true);
    try {
      const payload = { ...form, title:form.title.trim(), points:parent ? Math.min(500, Math.max(0, Number(form.points || 0))) : 0, requireApproval:parent ? form.requireApproval : true, updatedAt:Timestamp.now() };
      if (editing) await updateDoc(doc(db, 'tasks', editing.id), payload);
      else await addDoc(collection(db,'tasks'), { ...payload, done:false, approvalStatus:'none', createdBy:user.uid, createdAt:Timestamp.now() });
      setShowForm(false);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { taskSavingRef.current = false; setSavingTask(false); }
  }

  async function completeTask(item: TaskItem) {
    const target = doc(db, 'tasks', item.id);
    const nextTarget = doc(collection(db, 'tasks'));
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(target);
      if (!snapshot.exists() || snapshot.data().done === true) return;
      const raw = snapshot.data();
      const changes: Record<string, unknown> = { done:true, approvalStatus:raw.requireApproval ? 'approved' : 'none', completedAt:Timestamp.now(), updatedAt:Timestamp.now() };
      if (parent && raw.repeat !== 'none' && !raw.nextTaskId) {
        const base = new Date(`${raw.dueDate || today}T12:00:00`);
        let nextDate = raw.repeat === 'daily' ? addDays(base, 1) : raw.repeat === 'weekly' ? addDays(base, 7) : addMonths(base, 1);
        const anchorDay = Number(raw.repeatAnchorDay || base.getDate());
        if (raw.repeat === 'monthly') { nextDate.setDate(1); nextDate.setDate(Math.min(anchorDay, new Date(nextDate.getFullYear(),nextDate.getMonth()+1,0).getDate())); }
        const { nextTaskId, ...original } = raw;
        transaction.set(nextTarget, { ...original, repeatAnchorDay:anchorDay, dueDate:formatDateInput(nextDate), done:false, approvalStatus:'none', completedAt:null, createdBy:user.uid, createdAt:Timestamp.now(), updatedAt:Timestamp.now() });
        changes.nextTaskId = nextTarget.id;
      }
      transaction.update(target, changes);
    });
  }

  async function toggleDone(item: TaskItem) {
    if (!parent && item.person !== 'family' && item.person !== ownPerson(member)) return;
    if (item.done) {
      if (!parent) return;
      await updateDoc(doc(db, 'tasks', item.id), { done:false, approvalStatus:'none', completedAt:null, updatedAt:Timestamp.now() });
    } else if (item.requireApproval && !parent) {
      await updateDoc(doc(db, 'tasks', item.id), { approvalStatus:'pending', updatedAt:Timestamp.now() });
    } else await completeTask(item);
  }

  async function approve(item: TaskItem) { if (parent) await completeTask(item); }
  async function reject(item: TaskItem) {
    await updateDoc(doc(db, 'tasks', item.id), { done: false, approvalStatus: 'none', updatedAt: Timestamp.now() });
  }

  return (
    <div className="page-content compact-page tasks-v130">
      <ModuleHeader icon="✅" title="Zadania" text="Obowiązki, szybkie zadania, punkty i nagrody." action={<button className="primary-button" onClick={() => openAdd()}>＋ Dodaj zadanie</button>} />

      <section className="task-summary-v130">
        <button onClick={() => setFilter('today')}><strong>{items.filter((i) => !i.done && i.dueDate === today).length}</strong><span>Dzisiaj</span></button>
        <button onClick={() => setFilter('pending')}><strong>{items.filter((i) => i.approvalStatus === 'pending').length}</strong><span>Do zatwierdzenia</span></button>
        <button onClick={() => setFilter('done')}><strong>{items.filter((i) => i.done).length}</strong><span>Wykonane</span></button>
        <button className="points-card"><strong>⭐ {Object.values(pointsByPerson).reduce((a, b) => a + b, 0)}</strong><span>Punkty razem</span></button>
      </section>

      <section className="quick-task-section">
        <header><div><strong>⚡ Szybkie zadania</strong><small>Kliknij gotowiec i wybierz osobę, termin oraz punkty.</small></div></header>
        <div className="quick-task-grid">{TASK_TEMPLATES.map(([icon, title]) => <button key={title} onClick={() => openAdd(title)}><span>{icon}</span><strong>{title}</strong></button>)}</div>
      </section>

      <div className="tasks-main-grid">
        <section>
          <div className="task-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Wszystkie</button><button className={filter === 'today' ? 'active' : ''} onClick={() => setFilter('today')}>Dzisiaj</button><button className={filter === 'upcoming' ? 'active' : ''} onClick={() => setFilter('upcoming')}>Nadchodzące</button><button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Do zatwierdzenia</button><button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>Wykonane</button></div>
          <section className="module-list compact-list">
            {visible.length === 0 ? <EmptyState icon="✨" text="Brak zadań w tym widoku." /> : visible.map((item) => (
              <article className={`module-row task-row task-row-v130 ${item.done ? 'done' : ''} ${item.approvalStatus === 'pending' ? 'pending' : ''}`} key={item.id}>
                <button className="check-button" aria-label={`Oznacz wykonanie: ${item.title}`} disabled={!parent && (item.done || (item.person !== 'family' && item.person !== ownPerson(member)))} onClick={() => void toggleDone(item)}>{item.done ? '✓' : item.approvalStatus === 'pending' ? '⌛' : '○'}</button>
                <div className="row-main"><strong>{item.title}</strong><small>{personLabel(item.person)} · {item.dueDate ? formatShortDate(item.dueDate) : 'bez terminu'}{item.repeat !== 'none' ? ` · ${item.repeat === 'daily' ? 'codziennie' : item.repeat === 'weekly' ? 'co tydzień' : 'co miesiąc'}` : ''}</small></div>
                <span className={`priority-badge ${item.priority}`}>{item.priority === 'high' ? 'Ważne' : item.priority === 'low' ? 'Niski' : 'Normalny'}</span>
                {item.points > 0 && <span className="task-points">+{item.points} pkt</span>}
                {parent && item.approvalStatus === 'pending' ? <div className="approval-actions"><button onClick={() => void approve(item)}>✓ Zatwierdź</button><button onClick={() => void reject(item)}>✕ Odrzuć</button></div> : null}
                {parent && <button className="icon-button" onClick={() => openEdit(item)}>✏️</button>}
                {parent && <button className="icon-danger" aria-label={`Usuń zadanie: ${item.title}`} onClick={() => { if (confirm(`Usunąć zadanie „${item.title}”?`)) void deleteDoc(doc(db, 'tasks', item.id)); }}>🗑️</button>}
              </article>
            ))}
          </section>
        </section>

        <aside className="points-panel">
          <header><strong>🏆 Punkty i nagrody</strong><small>100 pkt = nagroda</small></header>
          {(['Nikodem', 'Paweł'] as PersonKey[]).map((person) => {
            const points = pointsByPerson[person] || 0;
            const progress = points % 100;
            return <article key={person}><div><span className="points-avatar">{memberEmoji(person)}</span><div><strong>{person}</strong><small>{points} pkt</small></div></div><div className="reward-progress"><span style={{ width: `${progress}%` }} /><em>{progress}/100</em></div></article>;
          })}
          <div className="reward-box"><span>🎁</span><div><strong>Nagroda przy 100 pkt</strong><small>Rodzice ustalają nagrodę razem z dzieckiem.</small></div></div>
          <small className="points-note">Punkty za zadanie może ustawić tylko rodzic. Przy zadaniach z zatwierdzeniem punkty wpadają dopiero po akceptacji.</small>
        </aside>
      </div>

      {showForm && <Modal title={editing ? '✏️ Edytuj zadanie' : '➕ Nowe zadanie'} onClose={() => setShowForm(false)} wide>
        <form className="form-grid" onSubmit={save}>
          <label className="field field-wide"><span>Zadanie</span><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Np. wyrzucić śmieci…" required /></label>
          <label className="field"><span>Osoba</span><PersonSelect allowed={parent ? undefined : ['family', ownPerson(member)]} value={form.person} onChange={(person) => setForm((f) => ({ ...f, person }))} /></label>
          <label className="field"><span>Termin</span><input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} /></label>
          <label className="field"><span>Priorytet</span><select aria-label="Priorytet" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}><option value="low">Niski</option><option value="normal">Normalny</option><option value="high">Ważne</option></select></label>
          <label className="field"><span>Powtarzanie</span><select aria-label="Powtarzanie" value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as TaskRepeat }))}><option value="none">Nie powtarzaj</option><option value="daily">Codziennie</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option></select></label>
          {parent && <label className="field"><span>Punkty za zadanie</span><div className="point-picker">{[5,10,15,20].map((p) => <button type="button" key={p} className={form.points === p ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, points: p }))}>{p}</button>)}<input type="number" min="0" max="500" value={form.points} onChange={(e) => setForm((f) => ({ ...f, points: Number(e.target.value) }))} /></div></label>}
          {parent && <label className="checkbox-field field-wide"><input type="checkbox" checked={form.requireApproval} onChange={(e) => setForm((f) => ({ ...f, requireApproval: e.target.checked }))} /><span>Wymaga zatwierdzenia rodzica po wykonaniu</span></label>}
          <label className="field field-wide"><span>Notatka</span><textarea rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Opcjonalnie…" /></label>
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Anuluj</button><button className="primary-button" disabled={savingTask}>{savingTask ? "Zapisuję…" : "✓ Zapisz"}</button></div>
        </form>
      </Modal>}
    </div>
  );
}
