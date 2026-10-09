import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { calendarRequest, calendarsChanged } from './calendar-client';
import { calendarCompletion, calendarErrorMessage, calendarMessage, withoutCalendarCompletion, type CalendarNotice } from './model';

/** OAuth completion is bound by the server to this Firebase UID and HttpOnly cookie. */
export function CalendarCallbackCompletion({ user, onComplete }: { user: User; onComplete(notice: CalendarNotice): void }) {
  const [completion] = useState(() => calendarCompletion(new URL(window.location.href)));
  const callback = useRef(onComplete); callback.current = onComplete;
  useEffect(() => {
    if (!completion) return;
    const controller = new AbortController();
    const live = () => !controller.signal.aborted && auth.currentUser?.uid === user.uid;
    const timer = window.setTimeout(() => {
      if (!live()) return;
      history.replaceState(history.state, '', withoutCalendarCompletion(new URL(window.location.href)));
      if (completion.errorCode) { callback.current({ tone: 'error', message: calendarMessage(completion.errorCode) }); return; }
      void calendarRequest<{ ok: true; connectionId: string }>('finalize', user, { completionId: completion.completionId }, controller.signal).then(() => {
        if (!live()) return;
        calendarsChanged(); callback.current({ tone: 'success', message: 'Google Calendar połączono. Wybierz kalendarz i potwierdź pobranie wydarzeń.' });
      }, error => { if (live()) callback.current({ tone: 'error', message: calendarErrorMessage(error) }); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [user.uid, completion]);
  return null;
}
