import {useCallback, useEffect, useState} from 'react';
import {collection, doc, onSnapshot, runTransaction, serverTimestamp, setDoc, Timestamp} from 'firebase/firestore';
import {db} from '../firebase';
import {familyV2WritesAllowed} from '../family-v2-client';
import {schoolRecordIsNew, type SchoolNewnessRecord} from './newness';
export function useSchoolNewness(uid: string) {
  const [state, setState] = useState<{uid: string; baseline: number | null; seen: Set<string>}>({uid, baseline: null, seen: new Set()});
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setState({uid, baseline: null, seen: new Set()}); setError('');
    const baseline = doc(db, 'userPreferences', uid, 'schoolState', 'baseline');
    if (familyV2WritesAllowed()) void runTransaction(db, async transaction => {
      const current = await transaction.get(baseline);
      if (!current.exists()) transaction.set(baseline, {startedAt: serverTimestamp()});
    }).catch(() => {if (active) setError('Nie udało się uruchomić oznaczeń nowych wpisów. Sprawdź reguły Firebase.');});
    const stopBaseline = onSnapshot(baseline, row => {
      const timestamp = row.data()?.startedAt;
      if (active) setState(previous => ({...previous, baseline: timestamp instanceof Timestamp ? timestamp.toMillis() : null}));
    }, () => {if (active) setError('Nie udało się odczytać oznaczeń nowych wpisów.');});
    const stopSeen = onSnapshot(collection(db, 'userPreferences', uid, 'schoolSeen'), rows => {
      if (active) setState(previous => ({...previous, seen: new Set(rows.docs.map(row => row.id))}));
    }, () => {if (active) setError('Nie udało się odczytać przeczytanych wpisów.');});
    return () => {active = false; stopBaseline(); stopSeen();};
  }, [uid]);
  const isNew = (row: SchoolNewnessRecord) => state.uid === uid && schoolRecordIsNew(row, state.baseline, state.seen);
  const markSeen = useCallback(async (id: string) => {
    if (!familyV2WritesAllowed()) return;
    try {await setDoc(doc(db, 'userPreferences', uid, 'schoolSeen', id), {seen: true, updatedAt: serverTimestamp()}); setError('');}
    catch {setError('Nie udało się zapisać odczytania wpisu. Spróbuj ponownie.');}
  }, [uid]);
  return {isNew, markSeen, error};
}
