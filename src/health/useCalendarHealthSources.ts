import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { endOfDay, isParent, ownPerson, parseLocalDate, type CalendarEventData, type Member } from '../app-shared';
import { useFamilyDirectory } from '../family-directory';
import { memberPersonKey } from '../family-members';
import { validDocumentDate } from './document-model';
import { useProtectedHealthDocuments } from './useProtectedHealthDocuments';

/** A document expiry is always personal to this authorized viewer; it never enters family projections. */
export function useCalendarHealthSources({ uid, member }: { uid: string; member: Member | null }) {
  const profiles = useFamilyDirectory();
  const [visitState, setVisits] = useState<{ scope: string; rows: CalendarEventData[] }>({ scope: '', rows: [] });
  const [expiryState, setExpiries] = useState<{ uid: string; rows: CalendarEventData[] }>({ uid: '', rows: [] });
  const [error, setError] = useState('');
  const parent = isParent(member);
  const own = ownPerson(member);
  const scope = JSON.stringify([uid, parent, own]);
  const protectedDocuments = useProtectedHealthDocuments(uid);
  useEffect(() => {
    let active = true;
    setVisits({ scope, rows: [] });
    const source = parent ? query(collection(db, 'healthRecords'), where('type', '==', 'visit'))
      : query(collection(db, 'healthRecords'), where('privateToParents', '==', false), where('person', 'in', ['family', own]));
    const unsubscribe = onSnapshot(source, snapshot => {
      if (!active) return;
      const projected: CalendarEventData[] = [];
      for (const document of snapshot.docs) {
        const record = document.data();
        // New attachment saves create this one stable calendar record atomically.
        // A readonly health projection must not create a second visual copy.
        if (typeof record.calendarEventId === 'string' && record.calendarEventId) continue;
        if (record.type !== 'visit' || record.status === 'cancelled' || !validDocumentDate(record.date)) continue;
        const privateVisit = record.privateToParents === true;
        if (privateVisit && !parent) continue;
        const start = parseLocalDate(record.date, typeof record.time === 'string' && /^\d{2}:\d{2}$/.test(record.time) ? record.time : '12:00');
        if (!Number.isFinite(start.getTime())) continue;
        projected.push({ id: `health-visit:${document.id}`, title: String(record.title || 'Wizyta lekarska'), person: String(record.person || 'family'),
          date: start, endDate: new Date(start.getTime() + 3600000), allDay: false, description: '', location: String(record.location || ''),
          createdBy: String(record.createdBy || ''), repeat: 'none', repeatUntil: null, source: 'health', sourceRecordId: document.id,
          readOnly: true, important: true, private: privateVisit, ...(privateVisit ? { ownerUid: uid } : {}),
          ownerProfileId: profiles.find(profile => memberPersonKey(profile) === record.person)?.id });
      }
      setVisits({ scope, rows: projected });
    }, () => setError('Nie udało się odczytać terminów zdrowia.'));
    return () => { active = false; unsubscribe(); };
  }, [uid, parent, own, profiles, scope]);
  useEffect(() => {
    setExpiries({ uid, rows: protectedDocuments.rows.flatMap(document => {
        if (document.indefinite || !validDocumentDate(document.expiresOn)) return [];
        const start = parseLocalDate(document.expiresOn, '00:00');
        return [{ id: `health-document-expiry:${document.id}:${document.expiresOn}`, title: 'Termin ważności dokumentu',
          person: document.ownerPersonKey, date: start, endDate: endOfDay(start),
          allDay: true, description: '', createdBy: document.createdBy, repeat: 'none' as const, repeatUntil: null, source: 'health' as const,
          sourceRecordId: document.id, readOnly: true, important: true, private: true, ownerUid: uid, ownerProfileId: document.ownerProfileId }];
      }) });
  }, [uid, protectedDocuments.rows]);
  return { events: [...(visitState.scope === scope ? visitState.rows : []), ...(expiryState.uid === uid ? expiryState.rows : [])], error };
}
