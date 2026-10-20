import { useCallback, useEffect, useState } from 'react';
import { familyAction } from '../family-v2-client';

import type { MusicState } from './music-school-model';
export { musicCalendarEvents } from './music-school-model';
export type { MusicLesson, MusicOccurrence, MusicPlan, MusicState } from './music-school-model';

/** Read-only polling only while visible. Closed-app checks belong to the server job. */
export function useMusicSchoolPlans(uid: string, scope = uid) {
  const identity = `${uid}|${scope}`;
  const [state, setState] = useState<{ identity: string; data: MusicState | null; error: string }>({ identity, data: null, error: '' });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => { setVersion(v => v + 1); window.dispatchEvent(new Event('music-school-changed')); }, []);
  useEffect(() => {
    let alive = true, pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const data = await familyAction<MusicState>('music-school', { operation: 'state' });
        if (alive) setState({ identity, data, error: '' });
      } catch (e) { if (alive) setState({ identity, data: null, error: e instanceof Error ? e.message : 'Nie udało się pobrać planu.' }); }
      finally { pending = false; }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 300_000);
    const onRefresh = () => void refresh();
    document.addEventListener('visibilitychange', onRefresh);
    window.addEventListener('music-school-changed', onRefresh);
    return () => { alive = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', onRefresh); window.removeEventListener('music-school-changed', onRefresh); };
  }, [identity, version]);
  return { data: state.identity === identity ? state.data : null, error: state.identity === identity ? state.error : '', reload };
}
