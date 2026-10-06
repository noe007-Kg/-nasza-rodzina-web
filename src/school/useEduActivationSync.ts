import { useEffect } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { createActivationSync } from './activation-sync';
import { callApi, readEduStatus } from './edu-client';

/** Mount once per authenticated application, independently of the current module. */
export function useEduActivationSync(user: User, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const visible = () => document.visibilityState !== 'hidden' && auth.currentUser?.uid === user.uid && !controller.signal.aborted;
    const coordinator = createActivationSync({
      visible,
      status: async () => {
        // Share the startup request with an already open School panel. A later
        // foreground activation reads fresh metadata, including the other
        // parent's successful sync on another device.
        const reply = await readEduStatus(user, controller.signal, true);
        return reply.status;
      },
      sync: () => callApi('sync', user, controller.signal),
    });
    const activate = () => {
      if (visible()) void coordinator.activate();
      else if (document.visibilityState === 'hidden') coordinator.background();
    };
    document.addEventListener('visibilitychange', activate);
    window.addEventListener('pageshow', activate);
    window.addEventListener('focus', activate);
    activate();
    return () => {
      coordinator.dispose();
      controller.abort();
      document.removeEventListener('visibilitychange', activate);
      window.removeEventListener('pageshow', activate);
      window.removeEventListener('focus', activate);
    };
  }, [user.uid, enabled]);
}
