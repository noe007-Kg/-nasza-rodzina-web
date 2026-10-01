/** Install the public-only worker and offer a deliberate update without losing a form. */
export function registerPwa(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator) || !window.isSecureContext) return;

  let updateRequested = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) window.location.reload();
  });

  function offerUpdate(registration: ServiceWorkerRegistration): void {
    if (!registration.waiting || !navigator.serviceWorker.controller || document.getElementById('nr-app-update')) return;
    const notice = document.createElement('aside');
    notice.id = 'nr-app-update';
    notice.setAttribute('aria-label', 'Aktualizacja aplikacji');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;z-index:10000;left:16px;right:16px;bottom:calc(82px + env(safe-area-inset-bottom,0px));margin:auto;max-width:420px;padding:14px 16px;border:1px solid var(--brand-line,#e9dff0);border-radius:18px;background:var(--brand-card,#fff);color:var(--brand-ink,#242650);box-shadow:0 8px 36px #0004;display:flex;align-items:center;gap:12px;font:14px/1.4 system-ui,sans-serif;';
    const label = document.createElement('span');
    label.textContent = 'Dostępna nowa wersja. Zapisz otwarte formularze, a potem odśwież.';
    label.style.flex = '1';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Odśwież';
    apply.style.cssText = 'flex-shrink:0;min-height:44px;padding:8px 12px;border:0;border-radius:10px;background:var(--brand-primary-gradient,#c72796);color:#fff;font:600 14px system-ui;cursor:pointer;';
    apply.addEventListener('click', () => {
      if (!registration.waiting) return;
      updateRequested = true;
      apply.disabled = true;
      apply.textContent = 'Aktualizuję…';
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
    notice.append(label, apply);
    document.body.append(notice);
  }

  async function install(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      offerUpdate(registration);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') offerUpdate(registration);
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => {});
      });
    } catch (error) {
      console.warn('Nie udało się zarejestrować powłoki PWA.', error);
    }
  }

  if (document.readyState === 'complete') void install();
  else window.addEventListener('load', () => void install(), { once: true });
}
