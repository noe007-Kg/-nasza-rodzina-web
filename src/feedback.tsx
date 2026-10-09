import React, { useEffect, useState } from 'react';
import { onSnapshot as subscribe, type DocumentData, type Query, type QuerySnapshot } from 'firebase/firestore';

export function notify(message: string, kind: 'error' | 'info' = 'info', source?: string) {
  window.dispatchEvent(new CustomEvent('family-notice', { detail: { message, kind, source } }));
}

/** Clear only the recovered/unmounted subscription, never an unrelated action's notice. */
export function clearNotice(source: string) {
  window.dispatchEvent(new CustomEvent('family-notice-clear', { detail: { source } }));
}

export function errorMessage(error: unknown) {
  const code = String((error as { code?: string })?.code || '');
  if (code.includes('permission-denied') || code.includes('unauthorized')) return 'Brak uprawnień do tych danych. Sprawdź profil rodziny i reguły Firebase.';
  if (code.includes('unavailable') || code.includes('network')) return 'Nie udało się połączyć. Sprawdź internet i spróbuj ponownie.';
  if (code.includes('quota')) return 'Usługa osiągnęła limit. Sprawdź limity projektu Firebase.';
  return 'Nie udało się wykonać operacji. Twoje zmiany nie zostały potwierdzone. Spróbuj ponownie.';
}

export function onSnapshot(target: Query<DocumentData>, next: (snapshot: QuerySnapshot<DocumentData>) => void, failed?: (error: import('firebase/firestore').FirestoreError) => void) {
  return subscribe(target, next, error => { notify(errorMessage(error), 'error'); failed?.(error); });
}

export function Feedback() {
  const [notice, setNotice] = useState<{ message: string; kind: string; source?: string } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const receive = (e: Event) => setNotice((e as CustomEvent).detail);
    const clear = (e: Event) => {
      const source = (e as CustomEvent).detail?.source;
      if (typeof source === 'string') setNotice(current => current?.source === source ? null : current);
    };
    const rejected = (e: PromiseRejectionEvent) => { e.preventDefault(); notify(errorMessage(e.reason), 'error'); };
    const connected = () => setOnline(navigator.onLine);
    window.addEventListener('family-notice', receive);
    window.addEventListener('family-notice-clear', clear);
    window.addEventListener('unhandledrejection', rejected);
    window.addEventListener('online', connected);
    window.addEventListener('offline', connected);
    return () => {
      window.removeEventListener('family-notice', receive);
      window.removeEventListener('family-notice-clear', clear);
      window.removeEventListener('unhandledrejection', rejected);
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', connected);
    };
  }, []);
  return <>
    {!online && <div className="connection-banner" role="status">Brak internetu. Zapis zmian wymaga połączenia.</div>}
    {notice && <div className={`family-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Zamknij komunikat">✕</button></div>}
  </>;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="loading-screen"><section className="loading-card"><h2>Nie udało się wyświetlić aplikacji</h2><p>Odśwież stronę, aby spróbować ponownie.</p><button className="primary-button" onClick={() => location.reload()}>Odśwież</button></section></div> : this.props.children;
  }
}
