export const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000;
export const MANUAL_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

/** Public connection metadata only. Failed attempts never restart the hourly clock. */
export type ActivationConnection = {
  configured: boolean;
  state: string;
  selectedStudent?: { profileId: string; personKey: string };
  lastSuccessAt?: string;
  lastSyncAt?: string;
  nextSyncAt?: string;
  expiresAt?: string;
  syncing?: boolean;
};

function milliseconds(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function manualSyncAvailableAt(status: ActivationConnection | null): number | undefined {
  if (!status) return undefined;
  const serverLimit = milliseconds(status.nextSyncAt);
  if (serverLimit !== undefined) return serverLimit;
  const success = milliseconds(status.lastSuccessAt);
  // Older responses may not include nextSyncAt. The successful sync clock
  // preserves the existing five-minute server cooldown in that case too.
  return success === undefined ? undefined : success + MANUAL_SYNC_COOLDOWN_MS;
}

export function shouldAutoSync(status: ActivationConnection | null, now: number): boolean {
  if (!status?.configured || status.state !== 'connected' || !status.selectedStudent || status.syncing) return false;
  const expiry = milliseconds(status.expiresAt);
  if (expiry !== undefined && expiry <= now) return false;
  const cooldown = manualSyncAvailableAt(status);
  if (cooldown !== undefined && cooldown > now) return false;
  const success = milliseconds(status.lastSuccessAt);
  // A connected journal with no successful import establishes its baseline.
  return success === undefined || now - success >= AUTO_SYNC_INTERVAL_MS;
}

type Dependencies = {
  status: () => Promise<ActivationConnection>;
  sync: () => Promise<unknown>;
  now?: () => number;
  visible?: () => boolean;
};
export type ActivationResult = 'synchronized' | 'current' | 'coalesced' | 'inactive' | 'failed';

/** Event-driven coordinator: no timer, no background polling and no page input. */
export function createActivationSync(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => Date.now());
  const visible = dependencies.visible ?? (() => true);
  let disposed = false;
  let inFlight: Promise<ActivationResult> | null = null;
  let lastStartedAt: number | undefined;

  return {
    activate(): Promise<ActivationResult> {
      if (disposed || !visible()) return Promise.resolve('inactive');
      if (inFlight) return inFlight;
      // visibilitychange + pageshow + focus can describe the same activation.
      // This also absorbs React StrictMode's development effect replay.
      if (lastStartedAt !== undefined && now() - lastStartedAt < 1000) return Promise.resolve('coalesced');
      lastStartedAt = now();
      inFlight = (async (): Promise<ActivationResult> => {
        try {
          const status = await dependencies.status();
          if (disposed || !visible()) return 'inactive';
          if (!shouldAutoSync(status, now())) return 'current';
          await dependencies.sync();
          return 'synchronized';
        } catch {
          // Automatic refresh is quiet when offline/expired/unconfigured;
          // existing school data and the explicit manual action remain usable.
          return 'failed';
        }
      })().finally(() => { inFlight = null; });
      return inFlight;
    },
    background() {
      // A genuine hidden→visible transition starts a new activation, even if
      // it occurs within the event-burst window of the preceding activation.
      lastStartedAt = undefined;
    },
    dispose() { disposed = true; },
  };
}
