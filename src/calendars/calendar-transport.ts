import { CalendarRequestError } from './model';
export type CalendarAction = 'start' | 'finalize' | 'status' | 'list' | 'configure' | 'sync' | 'disconnect' | 'visibility';
type CalendarUser = { uid: string; getIdToken(): Promise<string> };
type Dependencies = { currentUid(): string | null | undefined; fetch?: typeof fetch };
/** HTTP boundary: no provider tokens or server error text enter UI state. */
export async function calendarTransport<T>(action: CalendarAction, user: CalendarUser, body: Record<string, unknown>, signal: AbortSignal | undefined, dependencies: Dependencies): Promise<T> {
  const uid = user.uid;
  const current = () => !signal?.aborted && dependencies.currentUid() === uid;
  if (!current()) throw new CalendarRequestError('CALENDAR_ACCOUNT_CHANGED');
  const token = await user.getIdToken();
  if (!current()) throw new CalendarRequestError('CALENDAR_ACCOUNT_CHANGED');
  let response: Response;
  try { response = await (dependencies.fetch || fetch)(`/api/calendars/${action}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); }
  catch { throw new CalendarRequestError(current() ? 'CALENDAR_NETWORK_ERROR' : 'CALENDAR_ACCOUNT_CHANGED'); }
  if (!current()) throw new CalendarRequestError('CALENDAR_ACCOUNT_CHANGED');
  let result: { ok?: unknown; error?: { code?: unknown } };
  try { result = await response.json(); } catch { throw new CalendarRequestError('CALENDAR_INVALID_RESPONSE'); }
  if (!current()) throw new CalendarRequestError('CALENDAR_ACCOUNT_CHANGED');
  if (!response.ok || result?.ok !== true) throw new CalendarRequestError(typeof result?.error?.code === 'string' && /^[A-Z_]{1,80}$/.test(result.error.code) ? result.error.code : 'CALENDAR_INVALID_RESPONSE');
  return result as T;
}
