import { useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Card, Icon, PrimaryButton, SecondaryButton, StatusPill } from '../ui';
import {
  createOkruszekDays, OKRUSZEK_END, OKRUSZEK_PLAN_ID, OKRUSZEK_START, OKRUSZEK_WEEKDAYS,
  okruszekDateStatus, okruszekDayEntry, okruszekDayId, parseOkruszekDay, validateOkruszekDays,
} from './okruszek-plan';
import type { OkruszekDay } from './okruszek-plan';
import { memberPersonKey, type FamilyMemberProfile } from '../family-members';
import { schoolSourcesForProfile } from './profile-schools';
import './okruszek-plan.css';

function todayInWarsaw(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
}

function copyDays(days: readonly OkruszekDay[]): OkruszekDay[] {
  return days.map(day => ({ ...day, lessons: [...day.lessons], extraDaysOff: [...day.extraDaysOff] }));
}

function dayFingerprint(day: OkruszekDay): string {
  return JSON.stringify([day.person, day.ownerProfileId, day.weekday, day.time, day.endTime, day.lessons,
    day.periodStart, day.periodEnd, day.extraDaysOff, day.revision]);
}

function userMessage(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  if (code.includes('permission-denied')) return 'Nie masz uprawnień do zapisu tego planu. Zaloguj się kontem uprawnionego rodzica.';
  if (code.includes('unavailable') || code.includes('network')) return 'Nie udało się połączyć. Sprawdź internet i spróbuj ponownie.';
  if (error instanceof PlanIssue) return error.message;
  return 'Nie udało się zapisać planu. Dane pozostały bez zmian. Spróbuj ponownie.';
}

class PlanIssue extends Error {}

/** A manual weekly school plan; it never calls a provider or writes calendar events. */
export function OkruszekPlan({ user, parent, person, ownerProfileId }: { user: FirebaseUser; parent: boolean; person: string; ownerProfileId: string | null }) {
  const [saved, setSaved] = useState<OkruszekDay[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState<OkruszekDay[] | null>(null);
  const [extraDaysOff, setExtraDaysOff] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayInWarsaw);
  const baseline = useRef<OkruszekDay[]>([]);
  const identity = `${user.uid}:${person}:${ownerProfileId}:${parent ? 'parent' : 'student'}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  useEffect(() => {
    setSaved([]); setLoaded(false); setLoadError(''); setBusy(false);
    setEditing(null); setActionError(''); setNotice(''); baseline.current = [];
    const rows = query(collection(db, 'schoolItems'), where('person', '==', person), where('schoolPlanId', '==', OKRUSZEK_PLAN_ID));
    return onSnapshot(rows, { includeMetadataChanges: true }, snapshot => {
      if (currentIdentity.current !== identity) return;
      const days = snapshot.docs.map(item => parseOkruszekDay(item.id, item.data()));
      if (days.some(day => !day || day.ownerProfileId && day.ownerProfileId !== ownerProfileId)
        || new Set(days.map(day => day?.weekday)).size !== days.length) {
        setSaved([]); setLoadError('Zapisany plan wymaga sprawdzenia. Nie nadpiszemy istniejących wpisów.'); setLoaded(true); return;
      }
      setSaved((days as OkruszekDay[]).sort((a, b) => a.weekday - b.weekday));
      setLoadError(''); if (!snapshot.metadata.fromCache) setLoaded(true);
    }, error => {
      if (currentIdentity.current !== identity) return;
      setSaved([]); setLoadError(userMessage(error)); setLoaded(true);
    });
  }, [identity, person, ownerProfileId]);

  function assertIdentity() {
    if (!ownerProfileId || ownerProfileId.startsWith('legacy:')) throw new PlanIssue('Poczekaj na wczytanie rzeczywistego profilu ucznia. Plan nie zostanie przypisany do konta rodzica.');
    if (!parent || currentIdentity.current !== identity || auth.currentUser?.uid !== user.uid) {
      throw new PlanIssue('Konto zmieniło się w trakcie operacji. Zaloguj się ponownie i sprawdź plan.');
    }
  }

  async function writePlan(mode: 'import' | 'edit') {
    if (busy || !loaded || loadError || !parent || !ownerProfileId) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      assertIdentity();
      const source = mode === 'edit' && editing ? editing : createOkruszekDays(person, ownerProfileId);
      let checked: OkruszekDay[];
      try {
        checked = validateOkruszekDays(source.map(day => ({
          ...day, extraDaysOff: mode === 'edit'
            ? extraDaysOff.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
            : day.extraDaysOff,
        })));
      } catch (error) {
        throw new PlanIssue(error instanceof Error ? error.message : 'Sprawdź dane planu.');
      }
      const refs = await Promise.all(checked.map(async day => doc(db, 'schoolItems',
        saved.find(value => value.weekday === day.weekday)?.id || await okruszekDayId(ownerProfileId, day.weekday))));
      assertIdentity();
      if (saved.some(day => day.id !== refs.find((_ref, index) => checked[index].weekday === day.weekday)?.id)) {
        throw new PlanIssue('Zapisany plan ma inne identyfikatory. Nie utworzymy duplikatów ani nie nadpiszemy go automatycznie.');
      }
      const counts = await runTransaction(db, async transaction => {
        assertIdentity();
        const profileSnapshot = await transaction.get(doc(db, 'members', ownerProfileId));
        const profile: FamilyMemberProfile | null = profileSnapshot.exists() ? { ...profileSnapshot.data(), id: profileSnapshot.id } : null;
        if (!profile || memberPersonKey(profile) !== person || !schoolSourcesForProfile(profile).includes('okruszek')) {
          throw new PlanIssue('Nie udało się potwierdzić profilu ucznia i przypisania Okruszka. Nie zapisano planu.');
        }
        const previous = await Promise.all(refs.map(ref => transaction.get(ref)));
        assertIdentity();
        for (let index = 0; index < previous.length; index++) {
          const item = previous[index];
          if (!item.exists()) {
            if (mode === 'edit') throw new PlanIssue('Plan zmienił się podczas edycji. Zamknij edycję i wczytaj go ponownie.');
            continue;
          }
          const data = item.data();
          const parsed = parseOkruszekDay(item.id, data);
          if (!parsed || parsed.person !== person || parsed.weekday !== checked[index].weekday
            || parsed.ownerProfileId && parsed.ownerProfileId !== ownerProfileId
            || data.schoolPlanId !== OKRUSZEK_PLAN_ID || typeof data.createdBy !== 'string'
            || data.source !== undefined || data.provider !== undefined) {
            throw new PlanIssue('Istniejący wpis nie należy do tego ręcznego planu. Nie zostanie nadpisany.');
          }
          if (mode === 'edit') {
            const original = baseline.current.find(day => day.weekday === parsed.weekday);
            if (!original || original.id !== parsed.id || dayFingerprint(original) !== dayFingerprint(parsed)) {
              throw new PlanIssue('Inny rodzic zmienił plan. Zamknij edycję i wczytaj aktualne dane, aby zachować jego poprawki.');
            }
          }
        }
        let created = 0, bound = 0;
        for (let index = 0; index < previous.length; index++) {
          const item = previous[index];
          if (mode === 'import' && item.exists()) {
            if (!item.data().ownerProfileId) {
              transaction.update(refs[index], { ownerProfileId, updatedAt: serverTimestamp() });
              bound++;
            }
            continue;
          }
          const day = { ...checked[index], ownerProfileId, revision: mode === 'edit' ? baseline.current[index].revision + 1 : checked[index].revision };
          const entry = okruszekDayEntry(day);
          if (item.exists()) transaction.update(refs[index], { ...entry, updatedAt: serverTimestamp() });
          else { transaction.set(refs[index], { ...entry, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); created++; }
        }
        return { created, bound };
      });
      if (currentIdentity.current !== identity) return;
      setEditing(null);
      setNotice(mode === 'edit' ? 'Zapisano zmiany planu.' : counts.created ? `Zapisano plan: ${counts.created} nowych dni. Istniejące wpisy zachowano.`
        : counts.bound ? 'Przypisano istniejący plan do profilu ucznia. Nie dodano duplikatów i zachowano ręczne poprawki.'
        : 'Plan jest już zapisany. Nie dodano duplikatów i zachowano ręczne poprawki.');
    } catch (error) {
      if (currentIdentity.current === identity) {
        setActionError(userMessage(error));
      }
    } finally {
      if (currentIdentity.current === identity) setBusy(false);
    }
  }

  function openEditor() {
    if (busy || saved.length !== 5 || loadError || !ownerProfileId || saved.some(day => day.ownerProfileId !== ownerProfileId)) return;
    baseline.current = copyDays(saved);
    setEditing(copyDays(saved));
    setExtraDaysOff([...new Set(saved.flatMap(day => day.extraDaysOff))].sort().join('\n'));
    setActionError(''); setNotice('');
  }

  function changeDay(index: number, changes: Partial<OkruszekDay>) {
    setEditing(days => days?.map((day, current) => current === index ? { ...day, ...changes } : day) || null);
  }

  const supplied = createOkruszekDays(person, ownerProfileId || undefined);
  const days = supplied.map(day => saved.find(item => item.weekday === day.weekday) || day);
  const persisted = saved.length === 5 && !loadError && !!ownerProfileId && saved.every(day => day.ownerProfileId === ownerProfileId);
  const dateWeekday = new Date(`${selectedDate}T12:00:00Z`).getUTCDay() || 7;
  const dateDay = days.find(day => day.weekday === dateWeekday);
  const dateStatus = okruszekDateStatus(selectedDate, dateDay);
  const statusLabels = { planned: 'Zajęcia zaplanowane', 'day-off': 'Dzień wolny', 'outside-period': 'Poza okresem planu', unconfirmed: 'Status niepotwierdzony' };

  return <section className="okruszek-plan family-ui" aria-label={`Okruszek: ${person}`} data-testid="okruszek-plan" aria-busy={busy}>
    <Card as="section" tone="blue" className="okruszek-intro">
      <div><span className="school-eyebrow">Ręczny plan tygodniowy · {person}</span><h2>Okruszek</h2><p>Kołobrzeg · {OKRUSZEK_START.split('-').reverse().join('.')}–{OKRUSZEK_END.split('-').reverse().join('.')}</p></div>
      <StatusPill tone={persisted ? 'success' : 'neutral'}>{!loaded ? 'Sprawdzanie zapisu…' : persisted ? 'Plan zapisany' : saved.length === 5 ? 'Plan wymaga przypisania do profilu' : saved.length ? `Plan częściowo zapisany: ${saved.length}/5 dni` : 'Plan przygotowany — niezapisany'}</StatusPill>
      <p className="okruszek-explanation">Godziny dotyczą całego dnia w szkole. Kolejność i skróty zajęć są zachowane; godzin poszczególnych lekcji nie podano.</p>
      {parent && <div className="okruszek-actions">
        <PrimaryButton icon="check" disabled={busy || !loaded || !!loadError || !!editing || !ownerProfileId} onClick={() => void writePlan('import')}>{busy ? 'Zapisywanie…' : 'Zapisz plan Okruszka'}</PrimaryButton>
        {persisted && <SecondaryButton icon="settings" disabled={busy || !!editing} onClick={openEditor}>Edytuj plan</SecondaryButton>}
      </div>}
      {loadError && <p role="alert" className="okruszek-error">{loadError}</p>}
      {parent && !ownerProfileId && <p role="status">Czekamy na rzeczywisty profil ucznia. Zapis do konta rodzica jest wyłączony.</p>}
      {actionError && <p role="alert" className="okruszek-error">{actionError}</p>}
      {notice && <p role="status" className="okruszek-notice">{notice}</p>}
    </Card>
    <Card as="section" tone="neutral" className="okruszek-date-check" aria-label="Sprawdź dzień planu">
      <label>Sprawdź dzień<input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value || todayInWarsaw())}/></label>
      <div aria-live="polite" data-testid="okruszek-date-status"><strong>{statusLabels[dateStatus.kind]}</strong><p>{dateStatus.reason}</p>{dateStatus.kind === 'planned' && dateDay && <span><Icon name="clock" size={16}/> Cały dzień: {dateDay.time}–{dateDay.endTime}</span>}</div>
    </Card>
    <div className="okruszek-week" aria-label="Tygodniowy wzorzec zajęć">{days.map(day => <Card as="article" tone="violet" className="okruszek-day" key={day.weekday} data-testid={`okruszek-day-${day.weekday}`}>
      <h3>{OKRUSZEK_WEEKDAYS[day.weekday - 1]}</h3><p className="okruszek-day-time"><Icon name="clock" size={18}/><strong>{day.time}–{day.endTime}</strong><small>cały dzień</small></p>
      <ol>{day.lessons.map((lesson, index) => <li key={`${index}:${lesson}`}>{['-', '—'].includes(lesson.trim()) ? <span aria-label="Pusta pozycja — bez zajęć">—</span> : lesson}</li>)}</ol>
    </Card>)}</div>
    <p className="okruszek-holidays-note">To wzorzec tygodniowy, a nie potwierdzenie zajęć w każdy dzień roboczy. Uwzględniamy potwierdzone dni wolne; dodatkowe odwołania można dopisać przy edycji planu.</p>
    <div className="okruszek-holiday-sources"><span>Źródła dni wolnych:</span><a href="https://soswokruszek.pl/dni-wolne.html" target="_blank" rel="noopener noreferrer">Okruszek</a><a href="https://www.gov.pl/web/edukacja/ministerstwo-edukacji-narodowej-oglosilo-kalendarz-roku-szkolnego-20262027" target="_blank" rel="noopener noreferrer">Kalendarz MEN 2026/2027</a></div>
    {editing && <Card as="section" tone="neutral" className="okruszek-editor">
      <h3>Edytuj plan Okruszka</h3><p>Każde zajęcie wpisz w osobnym wierszu. „—” oznacza pustą pozycję, bez zajęć.</p>
      <form onSubmit={event => { event.preventDefault(); void writePlan('edit'); }}>
        <div className="okruszek-editor-days">{editing.map((day, index) => <fieldset key={day.weekday} disabled={busy}><legend>{OKRUSZEK_WEEKDAYS[day.weekday - 1]}</legend>
          <label>Początek całego dnia<input type="time" required value={day.time} onChange={event => changeDay(index, { time: event.target.value })}/></label>
          <label>Koniec całego dnia<input type="time" required value={day.endTime} onChange={event => changeDay(index, { endTime: event.target.value })}/></label>
          <label>Zajęcia — po jednym w wierszu<textarea required rows={9} value={day.lessons.join('\n')} onChange={event => changeDay(index, { lessons: event.target.value.split('\n') })}/></label>
        </fieldset>)}</div>
        <label className="okruszek-extra-days">Dodatkowe dni wolne — daty RRRR-MM-DD, po jednej w wierszu<textarea rows={3} disabled={busy} placeholder="RRRR-MM-DD" value={extraDaysOff} onChange={event => setExtraDaysOff(event.target.value)}/></label>
        <div className="okruszek-actions"><PrimaryButton type="submit" icon="check" disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz zmiany planu'}</PrimaryButton><SecondaryButton disabled={busy} onClick={() => { setEditing(null); setActionError(''); }}>Anuluj edycję</SecondaryButton></div>
      </form>
    </Card>}
  </section>;
}
