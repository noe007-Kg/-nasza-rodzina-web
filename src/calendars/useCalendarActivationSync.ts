import { useEffect } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { calendarRequest, calendarsChanged, readCalendarStatus } from './calendar-client';
import { createCalendarActivationSync } from './activation-sync';

/** Lives above module navigation, separately from school synchronization. */
export function useCalendarActivationSync(user: User, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const active = () => document.visibilityState !== 'hidden' && auth.currentUser?.uid === user.uid && !controller.signal.aborted;
    const coordinator = createCalendarActivationSync({
      active,
      status: () => readCalendarStatus(user, controller.signal),
      sync: async connectionId => {
        const result = await calendarRequest('sync', user, { connectionId }, controller.signal);
        if (active()) calendarsChanged();
        return result;
      },
    });
    const activate = () => { if (active()) void coordinator.activate(); else if (document.visibilityState === 'hidden') coordinator.background(); };
    document.addEventListener('visibilitychange', activate); window.addEventListener('pageshow', activate); window.addEventListener('focus', activate);
    // Defer the first request so React's effect replay can abort before dispatch.
    const startup = window.setTimeout(activate, 0);
    return () => {
      window.clearTimeout(startup); coordinator.dispose(); controller.abort();
      document.removeEventListener('visibilitychange', activate); window.removeEventListener('pageshow', activate); window.removeEventListener('focus', activate);
    };
  }, [user.uid, enabled]);
}
