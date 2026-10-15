import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { isSchoolType, type Member } from './app-shared';
import type { CalendarSchoolRecord } from './calendar-source-projections';
import { schoolReadAccess, schoolReadAccessKey } from './school/read-access';
import { parseOkruszekDay } from './school/okruszek-plan';
import { householdFamilyId } from './household-scope';

export type CalendarSchoolDisplayRecord = CalendarSchoolRecord & {
  createdAt?: Date;
  eventKind?: 'lesson' | 'break';
  timingConfidence?: 'confirmed' | 'estimated';
};
type ScopedSchoolRecords = { scope: string; rows: CalendarSchoolDisplayRecord[]; error: boolean };

/** One existing schoolItems listener. Parent mailboxes and personal messages are never queried. */
export function useCalendarSchoolSources(uid: string, member: Member | null) {
  const access = member?.archived === true ? null : schoolReadAccess(member);
  const familyId = householdFamilyId(member);
  const scope = `${schoolReadAccessKey(uid, access)}:${familyId || 'unbound'}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [state, setState] = useState<ScopedSchoolRecords>({ scope, rows: [], error: false });
  useEffect(() => {
    setState({ scope, rows: [], error: false });
    if (!access || !familyId) return;
    let active = true;
    const target = access.scope === 'parent' ? query(collection(db, 'schoolItems'), where('familyId', '==', familyId))
      : query(collection(db, 'schoolItems'), where('familyId', '==', familyId), where('person', '==', access.person));
    const stop = onSnapshot(target, snapshot => {
      if (!active || currentScope.current !== scope) return;
      const rows = snapshot.docs.flatMap<CalendarSchoolDisplayRecord>(document => {
        const data = document.data();
        if (typeof data.person !== 'string'
          || (access.scope === 'student' && data.person !== access.person)) return [];
        const text = (value: unknown) => typeof value === 'string' ? value : '';
        const manualDay = parseOkruszekDay(document.id, data);
        if (manualDay) return [{ id: document.id, person: data.person, type: 'message',
          title: text(data.title), date: '', weekday: 0, time: manualDay.time, endTime: manualDay.endTime,
          note: text(data.note), createdBy: text(data.createdBy), schoolPlanId: text(data.schoolPlanId),
          schoolPlanRevision: manualDay.revision, ownerProfileId: text(data.ownerProfileId), manualDayPlan: data.manualDayPlan }];
        if (!isSchoolType(data.type)) return [];
        return [{ id: document.id, person: data.person, type: data.type,
          ...(typeof data.source === 'string' ? { source: data.source } : {}), title: text(data.title), subject: text(data.subject),
          date: text(data.date), time: text(data.time), endTime: text(data.endTime),
          weekday: Number.isInteger(data.weekday) ? data.weekday : undefined,
          note: text(data.note), calendarEventId: text(data.calendarEventId), createdBy: text(data.createdBy),
          createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : undefined,
          ...(data.eventKind === 'lesson' || data.eventKind === 'break' ? { eventKind: data.eventKind } : {}),
          ...(data.timingConfidence === 'confirmed' || data.timingConfidence === 'estimated' ? { timingConfidence: data.timingConfidence } : {}) }];
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
