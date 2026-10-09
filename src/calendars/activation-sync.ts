import type { CalendarConnection, CalendarStatusResponse } from './model';
export const CALENDAR_AUTO_SYNC_MS = 60 * 60_000;
export function shouldRefreshCalendar(connection: CalendarConnection, now: number) {
  if (connection.provider !== 'google' || connection.mode !== 'sync' || connection.status !== 'connected' || connection.selectionConfirmed !== true) return false;
  if (!connection.lastSuccessfulSyncAt) return true;
  const success = Date.parse(connection.lastSuccessfulSyncAt);
  return Number.isFinite(success) && now - success >= CALENDAR_AUTO_SYNC_MS;
}
type Dependencies = { status(): Promise<CalendarStatusResponse>; sync(id: string): Promise<unknown>; now?(): number; active?(): boolean };
export type CalendarActivationResult = 'current' | 'synchronized' | 'inactive' | 'coalesced' | 'failed';
/** Activation events are the only inputs; time passing never causes polling. */
export function createCalendarActivationSync(dependencies: Dependencies) {
  const now = dependencies.now || (() => Date.now()), active = dependencies.active || (() => true);
  let disposed = false, lastStarted: number | undefined, pending: Promise<CalendarActivationResult> | null = null;
  const live = () => !disposed && active();
  return {
    activate(): Promise<CalendarActivationResult> {
      if (!live()) return Promise.resolve('inactive');
      if (pending) return pending;
      if (lastStarted !== undefined && now() - lastStarted < 1000) return Promise.resolve('coalesced');
      lastStarted = now();
      pending = (async (): Promise<CalendarActivationResult> => {
        try {
          const status = await dependencies.status();
          if (!live()) return 'inactive';
          if (!status.configured) return 'current';
          let synchronized = false, failed = false;
          for (const connection of status.connections) {
            if (!live()) return 'inactive';
            if (!shouldRefreshCalendar(connection, now())) continue;
            try { await dependencies.sync(connection.id); synchronized = true; } catch { failed = true; }
          }
          return synchronized ? 'synchronized' : failed ? 'failed' : 'current';
        } catch { return live() ? 'failed' : 'inactive'; }
      })().finally(() => { pending = null; });
      return pending;
    },
    background() { lastStarted = undefined; },
    dispose() { disposed = true; },
  };
}
