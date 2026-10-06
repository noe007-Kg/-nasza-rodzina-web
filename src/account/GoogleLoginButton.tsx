import { useEffect, useRef, useState } from 'react';
import { loginWithLinkedGoogle, accountActionMessage } from './account-client';

type GoogleIdentity = {
  initialize(options: { client_id: string; callback: (result: { credential: string }) => void; auto_select: boolean; cancel_on_tap_outside: boolean }): void;
  renderButton(element: HTMLElement, options: { type: 'standard'; theme: 'outline'; size: 'large'; text: 'continue_with'; shape: 'pill'; width: number; locale: string }): void;
  cancel(): void;
};
type GoogleWindow = Window & { google?: { accounts: { id: GoogleIdentity } } };
let scriptPromise: Promise<GoogleIdentity> | null = null;
function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const current = (window as GoogleWindow).google?.accounts.id;
  if (current) return Promise.resolve(current);
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      const identity = (window as GoogleWindow).google?.accounts.id;
      if (identity) resolve(identity); else reject(new Error('Google unavailable'));
    };
    script.onerror = () => { scriptPromise = null; script.remove(); reject(new Error('Google unavailable')); };
    document.head.append(script);
  });
  return scriptPromise;
}

export function GoogleLoginButton({ disabled, onError, onBusy }: { disabled: boolean; onError: (message: string) => void; onBusy: (busy: boolean) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const callbacks = useRef({ onError, onBusy }); callbacks.current = { onError, onBusy };
  const configured = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  useEffect(() => {
    if (!configured) return;
    let disposed = false;
    let identity: GoogleIdentity | undefined;
    void loadGoogleIdentity().then((provider) => {
      if (disposed || !element.current) return;
      identity = provider;
      provider.initialize({ client_id: configured, auto_select: false, cancel_on_tap_outside: true, callback: (result) => {
        if (disposed) return;
        callbacks.current.onBusy(true);
        void loginWithLinkedGoogle(result.credential)
          .catch((error: unknown) => callbacks.current.onError(accountActionMessage(error)))
          .finally(() => { if (!disposed) callbacks.current.onBusy(false); });
      } });
      provider.renderButton(element.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: Math.floor(Math.min(400, Math.max(200, element.current.clientWidth))), locale: 'pl' });
      setReady(true);
    }).catch(() => { if (!disposed) setUnavailable(true); });
    return () => { disposed = true; identity?.cancel(); };
  }, [configured]);
  return <div className="google-login-block">
    <div className={disabled ? 'google-login-host is-busy' : 'google-login-host'} ref={element} aria-label="Kontynuuj z Google" aria-busy={disabled} />
    {!ready && <button className="google-login-fallback" type="button" disabled onClick={() => undefined}><span aria-hidden="true">G</span> Kontynuuj z Google</button>}
    {(!configured || unavailable) && <small>{unavailable ? 'Google jest chwilowo niedostępne. Użyj e-maila i hasła.' : 'Google będzie dostępne po konfiguracji administratora.'}</small>}
    <p>Najpierw połącz Google ze swoim kontem w Ustawieniach.</p>
  </div>;
}
