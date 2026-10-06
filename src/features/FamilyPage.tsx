import { addDays, ageFromBirthDate, type CalendarEventData, collection, db, endOfDay, errorMessage, eventActivityIcon, FAMILY_BIRTHDAYS, formatDateInput, formatShortDate, formatTime, generateOccurrences, isPersonKey, isSchoolType, type Member, ModuleHeader, notify, onSnapshot, type Page, parseLocalDate, type PersonKey, personLabel, personRole, schoolQuery, type SchoolRecord, startOfDay, subjectIcon, type TaskItem, useEffect, useMemo, type User, useState } from "../app-shared";

import { subscribeCalendar } from '../calendar-store';
import { useFamilyDirectory } from '../family-directory';
import { memberPersonKey, memberSchoolEnabled } from '../family-members';

export function FamilyPage({ user, member, goTo, selected, onSelect }: { user: User; member: Member | null; goTo: (page: Page) => void; selected: PersonKey; onSelect: (person: PersonKey) => void }) {
  const members = useFamilyDirectory().filter(profile => profile.active !== false && !profile.archived && !profile.disabled);
  const [events, setEvents] = useState<CalendarEventData[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [school, setSchool] = useState<SchoolRecord[]>([]);

  useEffect(() => subscribeCalendar(user.uid, setEvents, error => notify(errorMessage(error), 'error')), [user.uid]);

  useEffect(() => onSnapshot(collection(db,'tasks'), (snap) => {
    setTasks(snap.docs.map((d): TaskItem => { const x=d.data(); return { id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'family', done:x.done === true, dueDate:typeof x.dueDate === 'string' ? x.dueDate : '', priority:x.priority === 'low' || x.priority === 'high' ? x.priority : 'normal', note:typeof x.note === 'string' ? x.note : '', points:Number(x.points || 0), requireApproval:x.requireApproval === true, approvalStatus:x.approvalStatus === 'pending' || x.approvalStatus === 'approved' ? x.approvalStatus : 'none', repeat:x.repeat === 'daily' || x.repeat === 'weekly' || x.repeat === 'monthly' ? x.repeat : 'none' }; }));
  }), []);

  useEffect(() => onSnapshot(schoolQuery(member), (snap) => {
    setSchool(snap.docs.map((d): SchoolRecord => { const x=d.data(); return { id:d.id, title:String(x.title || ''), person:isPersonKey(x.person) ? x.person : 'Nikodem', type:isSchoolType(x.type) ? x.type : 'homework', subject:typeof x.subject === 'string' ? x.subject : '', date:typeof x.date === 'string' ? x.date : '', time:typeof x.time === 'string' ? x.time : '', endTime:typeof x.endTime === 'string' ? x.endTime : '', weekday:Number(x.weekday || 0), note:typeof x.note === 'string' ? x.note : '' }; }));
  }), []);

  const now=new Date(); const today=formatDateInput(now); const weekday=now.getDay() === 0 ? 7 : now.getDay();
  const todayCalendar=useMemo(()=>events.flatMap((e)=>generateOccurrences(e,startOfDay(now),endOfDay(now))).sort((a,b)=>a.date.getTime()-b.date.getTime()), [events, today]);
  const todaySchool=useMemo(()=>school.filter((r)=>(r.type === 'lesson' || r.type === 'activity') && (r.weekday === weekday || r.date === today)).sort((a,b)=>(a.time || '99:99').localeCompare(b.time || '99:99')), [school, weekday, today]);

  function statusFor(name:string) {
    const key=name as PersonKey;
    const cal=todayCalendar.filter((o)=>o.source.person === key);
    const schoolRows=todaySchool.filter((r)=>r.person === key).map((r)=>({ start:parseLocalDate(today,r.time || '08:00'), end:parseLocalDate(today,r.endTime || r.time || '08:45'), title:r.type === 'activity' ? r.title : (r.subject || r.title), icon:subjectIcon(r.subject || r.title) }));
    const rows=[...cal.map((o)=>({start:o.date,end:o.endDate,title:o.source.title,icon:eventActivityIcon(o.source.title)})),...schoolRows].sort((a,b)=>a.start.getTime()-b.start.getTime());
    const active=rows.find((r)=>r.start <= now && r.end > now); if (active) return `${active.icon} ${active.title} do ${formatTime(active.end)}`;
    const next=rows.find((r)=>r.start > now); if (next) return `${next.icon} ${next.title} ${formatTime(next.start)}`;
    return '🟢 Wolny';
  }

  const selectedMember=members.find((m)=>memberPersonKey(m) === selected);
  const selectedTasks=tasks.filter((t)=>!t.done && (selected === 'family' ? true : t.person === selected || t.person === 'family')).slice(0,5);
  const selectedPlan=selected === 'family' ? todayCalendar.slice(0,8) : todayCalendar.filter((o)=>o.source.person === selected || o.source.person === 'family').slice(0,6);
  const selectedSchool=todaySchool.filter((r)=>selected !== 'family' && r.person === selected).slice(0,7);
  const upcoming=events.flatMap((e)=>generateOccurrences(e,new Date(),endOfDay(addDays(new Date(),30)))).filter((o)=>o.date >= new Date() && (selected === 'family' || o.source.person === selected || o.source.person === 'family')).sort((a,b)=>a.date.getTime()-b.date.getTime()).slice(0,4);
  const isStudent=memberSchoolEnabled(selectedMember);
  const age=ageFromBirthDate((selectedMember as { birthDate?: string } | undefined)?.birthDate || FAMILY_BIRTHDAYS[selected]);

  return (
    <div className="page-content compact-page family-v130">
      <ModuleHeader icon="👨‍👩‍👧‍👦" title="Rodzina" text="Profile, plany i szybki dostęp do informacji każdej osoby." />
      <p className="family-selection-note">Wybierz osobę w górnym pasku, aby zobaczyć jej plan dnia. {selected !== 'family' && <button className="secondary-button" onClick={() => onSelect('family')}>Plan całej rodziny</button>}</p>

      {selected === 'family' ? <>
        <section className="family-hub-columns">
          <article className="family-hub-card"><header><strong>📅 Najbliższe rodzinne wydarzenia</strong><button onClick={()=>goTo('Kalendarz')}>Kalendarz ›</button></header>{upcoming.length === 0 ? <p className="family-empty">Brak wydarzeń.</p> : upcoming.map((o)=><div className="family-hub-row" key={o.key}><span className="date-badge"><b>{o.date.getDate()}</b><small>{o.date.toLocaleDateString('pl-PL',{month:'short'}).replace('.','')}</small></span><div><strong>{o.source.title}</strong><small>{personLabel(o.source.person)} · {o.source.allDay ? 'cały dzień' : formatTime(o.date)}</small></div></div>)}</article>
          <article className="family-hub-card"><header><strong>✅ Zadania rodziny</strong><button onClick={()=>goTo('Zadania')}>Zadania ›</button></header>{selectedTasks.length === 0 ? <p className="family-empty">Brak otwartych zadań.</p> : selectedTasks.map((t)=><div className="family-hub-row" key={t.id}><span>○</span><div><strong>{t.title}</strong><small>{personLabel(t.person)}{t.dueDate ? ` · ${formatShortDate(t.dueDate)}` : ''}</small></div></div>)}</article>
        </section>
      </> : <>
        <section className="family-profile-hero">
          <div className="family-profile-copy"><h2>{selectedMember?.name || personLabel(selected)}</h2><p>{personRole(selected,selectedMember?.role)}{age !== null ? ` · ${age} lat` : ''}</p><span>{statusFor(selected)}</span></div>
          <div className="family-profile-actions"><button onClick={()=>goTo('Kalendarz')}>📅 Plan dnia</button>{isStudent ? <button onClick={()=>goTo('Szkoła')}>🎒 Szkoła</button> : <button onClick={()=>goTo('Kalendarz')}>💼 Praca / aktywności</button>}<button onClick={()=>goTo('Zadania')}>✅ Zadania</button><button onClick={()=>goTo('Zdrowie')}>❤️ Zdrowie</button></div>
        </section>
        <section className="family-hub-columns three">
          <article className="family-hub-card"><header><strong>🕒 Dzisiejszy plan</strong><button onClick={()=>goTo('Kalendarz')}>Pełny plan ›</button></header>{selectedPlan.length === 0 && selectedSchool.length === 0 ? <p className="family-empty">Brak planu na dziś.</p> : <>{selectedPlan.map((o)=><div className="family-hub-row" key={o.key}><time>{o.source.allDay ? 'Cały dzień' : `${formatTime(o.date)}–${formatTime(o.endDate)}`}</time><div><strong>{eventActivityIcon(o.source.title)} {o.source.title}</strong><small>{o.source.description}</small></div></div>)}{selectedSchool.map((r)=><div className="family-hub-row" key={`school-${r.id}`}><time>{r.time}{r.endTime ? `–${r.endTime}` : ''}</time><div><strong>{subjectIcon(r.subject || r.title)} {r.subject || r.title}</strong><small>{r.type === 'activity' ? r.title : r.note}</small></div></div>)}</>}</article>
          <article className="family-hub-card"><header><strong>✅ Zadania</strong><button onClick={()=>goTo('Zadania')}>Wszystkie ›</button></header>{selectedTasks.length === 0 ? <p className="family-empty">Brak otwartych zadań.</p> : selectedTasks.map((t)=><div className="family-hub-row" key={t.id}><span>○</span><div><strong>{t.title}</strong><small>{t.dueDate ? formatShortDate(t.dueDate) : 'Bez terminu'}{t.points ? ` · +${t.points} pkt` : ''}</small></div></div>)}</article>
          <article className="family-hub-card"><header><strong>{isStudent ? '🎒 Szkoła i zajęcia' : '📅 Najbliższe aktywności'}</strong><button onClick={()=>goTo(isStudent ? 'Szkoła' : 'Kalendarz')}>Otwórz ›</button></header>{isStudent ? (selectedSchool.length ? selectedSchool.map((r)=><div className="family-hub-row" key={`mini-${r.id}`}><span>{subjectIcon(r.subject || r.title)}</span><div><strong>{r.subject || r.title}</strong><small>{r.time}{r.endTime ? `–${r.endTime}` : ''}</small></div></div>) : <p className="family-empty">Brak szkolnych wpisów na dziś.</p>) : (upcoming.length ? upcoming.map((o)=><div className="family-hub-row" key={`up-${o.key}`}><span>{eventActivityIcon(o.source.title)}</span><div><strong>{o.source.title}</strong><small>{formatShortDate(formatDateInput(o.date))} · {formatTime(o.date)}</small></div></div>) : <p className="family-empty">Brak najbliższych aktywności.</p>)}</article>
        </section>
      </>}
    </div>
  );
}
