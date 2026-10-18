import { useCallback, useEffect, useRef, useState } from 'react';
import { readFinanceState } from './finance-api';
import type { FinanceState } from './model';

/** Activation reads are authenticated; there is no browser write path to financial collections. */
export function useFinanceBills(uid: string, accessContext = '', enabled = true) {
  const scope = JSON.stringify([uid, accessContext, enabled]);
  const [state, setState] = useState<{ scope: string; data: FinanceState | null; error: string; loading: boolean }>({ scope: '', data: null, error: '', loading: true });
  const current = useRef(scope); current.current = scope;
  const requestNumber = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled) return null;
    const request = ++requestNumber.current;
    setState(previous => ({ scope, data: previous.scope === scope ? previous.data : null, error: '', loading: true }));
    try {
      const data = await readFinanceState();
      if (current.current === scope && requestNumber.current === request) setState({ scope, data, error: '', loading: false });
      return data;
    } catch (value) {
      if (current.current === scope && requestNumber.current === request) setState({ scope, data: null,
        error: value instanceof Error ? value.message : 'Nie udało się odczytać opłat.', loading: false });
      throw value;
    }
  }, [scope, enabled]);
  useEffect(() => {
    if (!enabled) {
      requestNumber.current++;
      setState({ scope, data: null, error: '', loading: false });
      return;
    }
    void refresh().catch(() => {});
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh().catch(() => {}); };
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { requestNumber.current++; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh, enabled, scope]);
  return { data: state.scope === scope ? state.data : null, error: state.scope === scope ? state.error : '', loading: state.scope !== scope || state.loading, refresh };
}
