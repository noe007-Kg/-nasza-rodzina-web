import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import type { Member } from './app-shared';
import type { CalendarSchoolRecord } from './calendar-source-projections';
import { schoolReadAccess, schoolReadAccessKey } from './school/read-access';

type ScopedSchoolRecords = { scope: string; rows: CalendarSchoolRecord[]; error: boolean };

/** One existing schoolItems listener. Parent mailboxes and personal messages are never queried. */
export function useCalendarSchoolSources(uid: string, member: Member | null) {
  const access = member?.archived === true ? null : schoolReadAccess(member);
  const scope = schoolReadAccessKey(uid, access);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [state, setState] = useState<ScopedSchoolRecords>({ scope, rows: [], error: false });
  useEffect(() => {
    setState({ scope, rows: [], error: false });
    if (!access) return;
    let active = true;
    const target = access.scope === 'parent' ? collection(db, 'schoolItems')
      : query(collection(db, 'schoolItems'), where('person', '==', access.person));
    const stop = onSnapshot(target, snapshot => {
      if (!active || currentScope.current !== scope) return;
      const rows = snapshot.docs.flatMap(document => {
        const data = document.data();
        if (data.source !== 'eduvulcan' || !['lesson', 'activity'].includes(data.type)
          || typeof data.person !== 'string'
          || (access.scope === 'student' && data.person !== access.person)) return [];
        const text = (value: unknown) => typeof value === 'string' ? value : '';
        return [{ id: document.id, person: data.person, type: data.type,
          source: 'eduvulcan', title: text(data.title), subject: text(data.subject),
          date: text(data.date), time: text(data.time), endTime: text(data.endTime),
          note: text(data.note), calendarEventId: text(data.calendarEventId), createdBy: text(data.createdBy) }];
      });
      setState({ scope, rows, error: false });
    }, () => {
      if (active && currentScope.current === scope) setState({ scope, rows: [], error: true });
    });
    return () => { active = false; stop(); };
  }, [scope]);
  const visible = state.scope === scope ? state : { scope, rows: [], error: false };
  return { ...visible, access };
}
