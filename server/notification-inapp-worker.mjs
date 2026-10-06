/** Compatibility cleanup appended to the existing PWA shell, never Web Push. */
export const IN_APP_NOTIFICATION_WORKER_SOURCE = `
async function nrRetireSystemNotifications() {
  await self.registration.getNotifications().then(values => values.forEach(value => value.close())).catch(() => {});
  const subscription = await self.registration.pushManager?.getSubscription().catch(() => null);
  if (subscription) await subscription.unsubscribe().catch(() => {});
}
self.addEventListener('activate', event => event.waitUntil(nrRetireSystemNotifications()));
// Acknowledge only a disabled compatibility binding. There is no push listener,
// no background notification display and no token registration in this worker.
self.addEventListener('message', event => {
  if (event.data?.type !== 'NR_NOTIFICATION_BIND') return;
  if (!event.source?.url || new URL(event.source.url).origin !== self.location.origin) return;
  event.waitUntil(nrRetireSystemNotifications().then(() => event.ports?.[0]?.postMessage({ ok: event.data.uid === null && event.data.enabled === false })));
});
self.addEventListener('notificationclick', event => { event.notification.close(); });
`;
