import { useEffect } from 'react';
import type { User } from 'firebase/auth';
import { collection, onSnapshot, query, where, type Query, type QuerySnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';

export type InAppRefreshReason = 'launch' | 'foreground' | 'changes';
export type InAppRefreshResult = {
  mode: 'in-app'; created: number; checked: number; baselines?: number;
  rateLimited: boolean; retryAfterMs: number; skippedSources: string[];
};
type RefreshMember = { name?: string; personKey?: string; role?: string } | null;

/** Only the activation reason travels from the browser. Notification text,
 * recipients and permission decisions are reconstructed on the server. */
export async function refreshInAppNotifications(user: User, reason: InAppRefreshReason, signal?: AbortSignal): Promise<InAppRefreshResult> {
  const token = await user.getIdToken();
  if (signal?.aborted || auth.currentUser?.uid !== user.uid) throw new Error('Sesja powiadomień zmieniła się.');
  const response = await fetch('/api/notifications/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }), cache: 'no-store', signal,
  });
  const result = await response.json();
  if (signal?.aborted || auth.currentUser?.uid !== user.uid) throw new Error('Sesja powiadomień zmieniła się.');
  if (!response.ok || result.ok !== true) throw new Error('Nie udało się odświeżyć powiadomień w aplikacji.');
  return result as InAppRefreshResult;
}

const ignoredMetadata = new Set(['createdAt', 'updatedAt', 'syncedAt', 'sourceSyncId', 'read', 'readAt', 'completedAt', 'updatedBy', 'createdBy', 'uid', 'documentURL', 'documentPath']);
function stableRecord(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(stableRecord);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !ignoredMetadata.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableRecord(item)]));
  return value ?? null;
}
function fingerprint(snapshot: QuerySnapshot): string {
  return JSON.stringify(snapshot.docs.map(row => [row.id, stableRecord(row.data())]).sort(([a], [b]) => String(a).localeCompare(String(b))));
}

/** Mounted once in the authorized application shell, independent of the
 * selected module. Firestore's identical existing queries share its local
 * cache/listen targets. There is no interval and no background polling. */
export function useInAppNotificationRefresh(user: User, member: RefreshMember = null): void {
  useEffect(() => {
    if (!member || !['parent', 'child'].includes(member.role || '')) return;
    let alive = true;
    let active = false;
    let pending: InAppRefreshReason | null = null;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const ownPerson = member.personKey || member.name || '';
    const visible = () => document.visibilityState === 'visible';
    const sources: Query[] = [
      query(collection(db, 'calendarEvents')),
      query(collection(db, 'privateCalendarEvents'), where('ownerUid', '==', user.uid)),
      query(collection(db, 'tasks')),
      query(collection(db, 'shoppingItems')),
      query(collection(db, 'familyMessages'), where('channel', '==', 'family')),
      query(collection(db, 'familyMessages'), where('participants', 'array-contains', user.uid)),
      member.role === 'parent' ? query(collection(db, 'healthRecords'))
        : query(collection(db, 'healthRecords'), where('privateToParents', '==', false), where('person', 'in', ['family', ownPerson])),
    ];

    const run = async (reason: InAppRefreshReason, canRetry = true) => {
      if (!alive || auth.currentUser?.uid !== user.uid) return;
      if (!visible() || active) { pending = reason; return; }
      active = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const result = await refreshInAppNotifications(user, reason, controller.signal);
        if (alive && visible() && canRetry && result.rateLimited && result.retryAfterMs > 0 && result.retryAfterMs <= 5000) {
          // One bounded retry for an activation/mutation that met the server's
          // debounce. It does not repeatedly poll an open or hidden application.
          retry = setTimeout(() => { retry = undefined; void run(reason, false); }, result.retryAfterMs + 30);
        }
      } catch {
        // A temporarily unavailable Vercel endpoint must not block login, the
        // bell, manual school sync, or any existing family module.
      } finally {
        clearTimeout(timeout);
        active = false;
        if (alive && pending && visible()) {
          const next = pending; pending = null;
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => { debounce = undefined; void run(next); }, 650);
        }
      }
    };
    const schedule = () => {
      if (!alive) return;
      if (!visible()) { pending = 'changes'; return; }
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { debounce = undefined; void run('changes'); }, 650);
    };
    const stops = sources.map(source => {
      let previous: string | undefined;
      return onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
        const next = fingerprint(snapshot);
        if (previous !== undefined && previous !== next && !snapshot.metadata.hasPendingWrites) schedule();
        // Wait for committed writes; otherwise the subsequent ACK would look
        // unchanged and a failed optimistic write could make a false alert.
        if (!snapshot.metadata.hasPendingWrites) previous = next;
      }, () => { /* Existing read permissions stay authoritative. */ });
    });
    const activate = () => {
      if (!visible()) return;
      if (retry) { clearTimeout(retry); retry = undefined; }
      pending = null;
      void run('foreground');
    };
    document.addEventListener('visibilitychange', activate);
    window.addEventListener('pageshow', activate);
    void run('launch');
    return () => {
      alive = false;
      controller?.abort();
      if (debounce) clearTimeout(debounce);
      if (retry) clearTimeout(retry);
      stops.forEach(stop => stop());
      document.removeEventListener('visibilitychange', activate);
      window.removeEventListener('pageshow', activate);
    };
  }, [user.uid, member?.name, member?.personKey, member?.role]);
}
