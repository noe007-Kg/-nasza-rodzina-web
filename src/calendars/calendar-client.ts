import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { calendarTransport, type CalendarAction } from './calendar-transport';
import { parseCalendarStatus, parseExternalCalendars } from './model';
export function calendarRequest<T>(action: CalendarAction, user: User, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  return calendarTransport<T>(action, user, body, signal, { currentUid: () => auth.currentUser?.uid });
}
export async function readCalendarStatus(user: User, signal?: AbortSignal) { return parseCalendarStatus(await calendarRequest<unknown>('status', user, {}, signal)); }
export async function listExternalCalendars(user: User, connectionId: string, signal?: AbortSignal) { return parseExternalCalendars(await calendarRequest<unknown>('list', user, { connectionId }, signal)); }
export function calendarsChanged() { window.dispatchEvent(new Event('calendar-connections-changed')); }
