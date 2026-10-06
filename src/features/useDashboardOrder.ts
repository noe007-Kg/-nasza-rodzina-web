import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { errorMessage, notify } from '../feedback';
import { dashboardCacheKey, normalizeDashboardOrder, type StartCardId } from './start-layout';

function cachedOrder(uid: string) {
  try { return normalizeDashboardOrder(JSON.parse(localStorage.getItem(dashboardCacheKey(uid)) || 'null')); }
  catch { return normalizeDashboardOrder(null); }
}

/** Extends the user's preference document without touching their member or Auth account. */
export function useDashboardOrder(uid: string) {
  const [order, setOrder] = useState<StartCardId[]>(() => cachedOrder(uid));
  const [loaded, setLoaded] = useState(false);
  const owner = useRef(uid);
  const edited = useRef(false);
  const lastSave = useRef(Promise.resolve());
  useEffect(() => {
    let alive = true;
    owner.current = uid; edited.current = false; setLoaded(false); setOrder(cachedOrder(uid));
    void getDoc(doc(db, 'userPreferences', uid)).then(snapshot => {
      if (!alive || owner.current !== uid || edited.current) return;
      if (snapshot.exists() && Array.isArray(snapshot.data().dashboardOrder)) {
        const next = normalizeDashboardOrder(snapshot.data().dashboardOrder);
        setOrder(next);
        try { localStorage.setItem(dashboardCacheKey(uid), JSON.stringify(next)); } catch { /* Firestore remains the preference store. */ }
      }
    }).catch(() => { /* Keep the UID-specific cached arrangement when offline. */ })
      .finally(() => { if (alive && owner.current === uid) setLoaded(true); });
    return () => { alive = false; };
  }, [uid]);

  function saveOrder(nextOrder: readonly StartCardId[]) {
    const next = normalizeDashboardOrder(nextOrder);
    edited.current = true; setOrder(next);
    try { localStorage.setItem(dashboardCacheKey(uid), JSON.stringify(next)); } catch { /* A full browser cache must not prevent dragging. */ }
    // Sequential writes preserve the order of consecutive drops on a slow connection.
    lastSave.current = lastSave.current.catch(() => {}).then(() => setDoc(doc(db, 'userPreferences', uid), {
      dashboardOrder: next, updatedAt: Timestamp.now(),
    }, { merge: true })).catch(error => {
      if (owner.current === uid) notify(`Układ zachowano na tym urządzeniu. ${errorMessage(error)}`, 'error');
    });
  }
  return { order, saveOrder, loaded };
}
