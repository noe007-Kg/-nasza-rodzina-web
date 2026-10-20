import { useCallback, useLayoutEffect, useState } from 'react';
import { accountAccentKey, parseAccountAccent, resolveAccountAccent, type AccountAccentPreference } from './account-accent';
function read(uid: string) { try { return parseAccountAccent(localStorage.getItem(accountAccentKey(uid))); } catch { return 'auto' as const; } }
export function useAccountAccent(uid: string, member: { personKey?: string; name?: string } | null) {
  const [state, setState] = useState(() => ({ uid, preference: read(uid), saved: true }));
  const preference = state.uid === uid ? state.preference : read(uid);
  const accent = resolveAccountAccent(preference, member);
  useLayoutEffect(() => {
    document.documentElement.dataset.accountAccent = accent;
    const meta = document.querySelector('meta[name="theme-color"]');
    const originalColor = meta?.getAttribute('content');
    meta?.setAttribute('content', accent === 'blue' ? '#2563c5' : '#c72796');
    return () => { delete document.documentElement.dataset.accountAccent; if (originalColor) meta?.setAttribute('content', originalColor); };
  }, [accent, uid]);
  useLayoutEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === accountAccentKey(uid) || event.key === null) setState({ uid, preference: read(uid), saved: true });
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [uid]);
  const setPreference = useCallback((value: AccountAccentPreference) => {
    const next = parseAccountAccent(value);
    let saved = true;
    try { localStorage.setItem(accountAccentKey(uid), next); } catch { saved = false; }
    setState({ uid, preference: next, saved });
  }, [uid]);
  return { preference, setPreference, saved: state.uid === uid ? state.saved : true };
}
