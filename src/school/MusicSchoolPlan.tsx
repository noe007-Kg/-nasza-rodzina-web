import { useState } from 'react';
import { familyAction } from '../family-v2-client';
import { useMusicSchoolPlans, type MusicLesson, type MusicOccurrence, type MusicPlan } from './music-school-client';
import { Card, SecondaryButton, StatusPill } from '../ui';
import './music-school.css';

const days = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
export function MusicSchoolPlan({ uid, ownerProfileId, student, parent, scope }: { uid: string; ownerProfileId: string | null; student: string; parent: boolean; scope: string }) {
  const { data, error, reload } = useMusicSchoolPlans(uid, scope);
  const plan = data?.plans.find(x => x.ownerProfileId === ownerProfileId);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<MusicOccurrence | null>(null);
  const act = async (body: Record<string, unknown>) => {
    if (!ownerProfileId) return;
    setBusy(true); setMessage('');
    let saved = false;
    try {
      let result = await familyAction<{ checkResult?: string }>('music-school', { ...body, ownerProfileId });
      if (body.operation === 'save') {
        saved = true;
        result = await familyAction<{ checkResult?: string }>('music-school', { operation: 'check', ownerProfileId });
      }
      setMessage(result.checkResult === 'skipped' ? 'Sprawdzanie już trwa albo było wykonane w ostatnich 5 minutach.'
        : result.checkResult === 'unavailable' ? 'Nie udało się odświeżyć. Poprzednie dane zachowano.'
        : result.checkResult === 'review' ? 'Komunikat wymaga ręcznej weryfikacji. Sprawdź stronę szkoły.' : 'Zapisano. Kalendarz korzysta z tego samego planu.');
      setEditing(false); setSelected(null); reload();
    } catch (e) { setMessage(saved ? 'Plan zapisano, ale sprawdzenie komunikatów się nie powiodło. Użyj przycisku sprawdzania.' : e instanceof Error ? e.message : 'Nie udało się zapisać.'); if (saved) { setEditing(false); reload(); } }
    finally { setBusy(false); }
  };
  const canEdit = parent && Boolean(ownerProfileId) && data?.writesEnabled === true && !busy;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
  const upcoming = plan?.occurrences.filter(x => x.date >= today).sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, 12) || [];
  return <section className="music-school-plan" data-testid="fryderyk-preparation" aria-label={`Fryderyk: ${student}`}>
    <Card tone="violet"><h2>🎵 Szkoła muzyczna · {student}</h2><StatusPill tone="neutral">Dziennik Fryderyk — niepołączono</StatusPill>
      <p>Plan rodzica i publiczne komunikaty PSM w Kołobrzegu. Bez logowania do Fryderyka.</p>
      <p>W dni zajęć: sprawdzanie komunikatów co godzinę, 08:00–18:00, Europe/Warsaw. Brak komunikatu nie potwierdza odbycia lekcji.</p>
      <small>Ostatnie pełne sprawdzenie: {plan?.check?.successAt ? new Date(plan.check.successAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'jeszcze nie wykonano'}.</small>
      {plan?.check?.status === 'unavailable' || plan?.check?.status === 'review' ? <p role="status">Aktualność komunikatów niepotwierdzona. Zachowano wcześniejsze informacje.</p> : null}
      <p><a href="https://www.gov.pl/web/psmkolobrzeg/nieobecnosci-nauczycieli" target="_blank" rel="noopener noreferrer">Komunikaty szkoły ↗</a> · <a href="https://psmkolobrzeg.fryderyk.edu.pl" target="_blank" rel="noopener noreferrer">Portal Fryderyk ↗</a></p>
    </Card>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {data && !data.writesEnabled && parent && <p>Moduł przygotowany. Zapisy i automatyczne sprawdzanie wymagają konfiguracji serwera; w Preview są wyłączone.</p>}
    {!plan && <Card><p>Nie zapisano planu tego ucznia. Zapis wymaga potwierdzenia profilu, godzin i okresu przez rodzica.</p>
      {parent && <SecondaryButton disabled={!canEdit} onClick={() => setEditing(true)}>Potwierdź i zapisz plan</SecondaryButton>}</Card>}
    {plan && <Card><h3>Plan tygodniowy</h3><ul>{plan.lessons.map(x => <li key={x.id}>{days[x.weekday]} · {x.time}–{x.endTime} · {x.title} · sala {x.room}</li>)}</ul>
      <small>Okres: {plan.validFrom}–{plan.validUntil}. Wyłączonych dni: {plan.excludedDates.length}.</small>
      {parent && <div className="music-actions"><SecondaryButton disabled={!canEdit} onClick={() => setEditing(true)}>Edytuj plan i dni wolne</SecondaryButton><SecondaryButton disabled={!canEdit} onClick={() => void act({ operation: 'check' })}>Sprawdź komunikaty teraz</SecondaryButton></div>}
    </Card>}
    {editing && data && <PlanEditor key={plan?.revision || 0} plan={plan} template={data.template} student={student} disabled={!canEdit} onSave={body => void act(body)} onCancel={() => setEditing(false)}/>}
    {plan && <Card><h3>Najbliższe zajęcia</h3>{upcoming.length ? upcoming.map(x => <div className="music-occurrence" key={x.id}><strong>{x.date} · {x.time}–{x.endTime} · {x.title}</strong>
      <span>{x.cancelled ? '🔴 ODWOŁANE' : x.moved ? '🟠 Zmiana terminu' : '🟢 Zaplanowane — brak informacji o odwołaniu'}</span>
      {x.evidence && <a href={x.evidence.url} target="_blank" rel="noopener noreferrer">Źródło odwołania ↗</a>}
      {x.manual && <small>Ustawienie rodzica · {x.note}</small>}
      {parent && <SecondaryButton disabled={!canEdit} onClick={() => setSelected(x)}>Zmień te zajęcia</SecondaryButton>}</div>) : <p>Brak zajęć w podanym okresie.</p>}</Card>}
    {selected && plan && <form className="music-editor" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      void act({ operation: 'override', revision: plan.revision, occurrenceId: selected.id, override: { date: f.get('date'), time: f.get('time'), endTime: f.get('endTime'), cancelled: f.has('cancelled'), note: f.get('note') } });
    }}><h3>Zmień wybrane zajęcia: {selected.title}</h3><p>Zmiana rodzica ma pierwszeństwo przed kolejnym sprawdzeniem publicznych komunikatów.</p>
      <label>Data<input required type="date" name="date" defaultValue={selected.date} min={plan.validFrom} max={plan.validUntil}/></label>
      <label>Od<input required type="time" name="time" defaultValue={selected.time}/></label><label>Do<input required type="time" name="endTime" defaultValue={selected.endTime}/></label>
      <label><input type="checkbox" name="cancelled" defaultChecked={selected.cancelled}/>Odwołane</label><label>Źródło decyzji / uwagi<input name="note" maxLength={500} defaultValue={selected.note}/></label>
      <button disabled={!canEdit}>Zapisz zmianę</button><button type="button" onClick={() => setSelected(null)}>Anuluj</button></form>}
  </section>;
}
function PlanEditor({ plan, template, student, disabled, onSave, onCancel }: { plan?: MusicPlan; template: MusicLesson[]; student: string; disabled: boolean; onSave: (body: Record<string, unknown>) => void; onCancel: () => void }) {
  const [lessons, setLessons] = useState(plan?.lessons || template);
  const [confirmed, setConfirmed] = useState(false);
  return <form className="music-editor" onSubmit={e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    if (!confirmed) return;
    onSave({ operation: 'save', revision: plan?.revision || 0, lessons, validFrom: f.get('from'), validUntil: f.get('until'), excludedDates: String(f.get('excluded') || '').split(/[,\s]+/).filter(Boolean) });
  }}><h3>Potwierdzenie planu: {student}</h3><p>Godziny z przekazanego planu. Okres i dni wolne muszą zostać potwierdzone przez rodzica — nie pochodzą z dziennika.</p>
    <label>Od<input required name="from" type="date" defaultValue={plan?.validFrom || '2026-10-19'}/></label><label>Do<input required name="until" type="date" defaultValue={plan?.validUntil || '2027-06-30'}/></label>
    {lessons.map((x, index) => <fieldset key={x.id}><legend>{days[x.weekday]} · {x.title}</legend><label>Od<input type="time" required value={x.time} onChange={e => setLessons(lessons.map((l, i) => i === index ? { ...l, time: e.target.value } : l))}/></label><label>Do<input type="time" required value={x.endTime} onChange={e => setLessons(lessons.map((l, i) => i === index ? { ...l, endTime: e.target.value } : l))}/></label><small>{x.teacher} · sala {x.room}</small></fieldset>)}
    <label>Potwierdzone dni bez zajęć (RRRR-MM-DD, oddziel spacjami)<textarea name="excluded" defaultValue={plan?.excludedDates.join(' ') || ''}/></label>
    <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>Potwierdzam właściwego ucznia ({student}), godziny, okres i dni wolne. Plan będzie widoczny w kalendarzu rodzinnym.</label>
    <button disabled={disabled || !confirmed}>Zapisz plan</button><button type="button" onClick={onCancel}>Anuluj</button>
  </form>;
}
