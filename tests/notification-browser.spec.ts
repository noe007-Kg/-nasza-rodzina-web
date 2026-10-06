import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { NOTIFICATION_WORKER_SOURCE } from '../server/notification-worker.mjs';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';

const categories = { calendar: true, tasks: true, shopping: true, familyChat: true, privateChat: true, health: true, school: true, important: true };
const preferences = { enabled: true, sound: true, categories };
async function login(page: Page, account = accounts.parent as (typeof accounts)[keyof typeof accounts]) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByTestId('notification-bell')).toBeVisible();
}
async function settings(page: Page) {
  await page.evaluate(() => { location.hash = encodeURIComponent('Ustawienia'); });
  await expect(page.locator('.notification-settings')).toBeVisible();
  return page.locator('.notification-settings');
}
async function logout(page: Page) {
  await settings(page);
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
}
async function putInbox(id: string, value: Record<string, unknown> = {}, uid: string = accounts.parent.uid) {
  await fixtureDatabase().doc(`notificationInbox/${uid}/items/${id}`).set({ eventId: id, title: 'Nowa ocena — Nikodem', body: 'Otwórz Szkołę, aby zobaczyć szczegóły.', category: 'school', module: 'Szkoła', important: false, read: false, starred: false, createdAt: Timestamp.now(), ...value });
}
async function oscillatorCount(page: Page) { return page.evaluate(() => (window as unknown as { __notificationOscillators: number }).__notificationOscillators); }
test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 19, weather_code: 1, wind_speed_10m: 8 }, daily: { temperature_2m_max: [22], temperature_2m_min: [12] } }) }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, route => { throw new Error(`Notification test attempted remote Firebase: ${route.request().url()}`); });
  // Deterministic browser permission/audio doubles; no system permission or real
  // FCM subscription is requested by these local emulator tests.
  await page.addInitScript(() => {
    const state = window as unknown as { __notificationPermission: NotificationPermission; __notificationPermissionRequests: number; __notificationPermissionReads: number; __notificationOscillators: number };
    state.__notificationPermission = 'default'; state.__notificationPermissionRequests = 0; state.__notificationPermissionReads = 0; state.__notificationOscillators = 0;
    class NotificationDouble {
      static get permission() { state.__notificationPermissionReads++; return state.__notificationPermission; }
      static async requestPermission() { state.__notificationPermissionRequests++; state.__notificationPermission = 'granted'; return 'granted'; }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationDouble });
    class AudioDouble {
      state = 'suspended'; currentTime = 0; destination = {};
      async resume() { this.state = 'running'; }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() { state.__notificationOscillators++; }, stop() {} }; }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioDouble });
  });
});

test('IN-APP: preferencje kategorii i dźwięku zapisują się do właściwego UID; brak systemowych push w pięciu rozmiarach', async ({ page, browserName }) => {
  await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).set({ dashboardOrder: ['school', 'health', 'chat', 'shopping', 'tasks', 'calendar', 'family-time'] });
  await login(page);
  const panel = await settings(page);
  await expect(panel.getByRole('switch', { name: /^Powiadomienia/ })).toHaveAttribute('aria-checked', 'true');
  await expect(panel).toContainText('Powiadomienia systemowe — dostępne w przyszłej aktualizacji.');
  await expect(panel.getByRole('button', { name: 'Włącz powiadomienia systemowe' })).toHaveCount(0);
  await panel.getByRole('switch', { name: /^Dźwięk powiadomień/ }).click();
  await expect(panel.getByRole('switch', { name: /^Dźwięk powiadomień/ })).toHaveAttribute('aria-checked', 'false');
  await panel.getByRole('checkbox', { name: 'Szkoła', exact: true }).uncheck();
  await expect.poll(async () => (await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.notifications?.categories?.school).toBe(false);
  const saved = (await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).get()).data()!;
  expect(saved.notifications.enabled).toBe(true); expect(saved.notifications.sound).toBe(false); expect(saved.dashboardOrder[0]).toBe('school');
  expect((await fixtureDatabase().doc(`userPreferences/${accounts.mother.uid}`).get()).exists).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __notificationPermissionRequests: number; __notificationPermissionReads: number }).__notificationPermissionRequests)).toBe(0);
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - window.innerWidth)).toBeLessThanOrEqual(1);
  }
  if (browserName === 'chromium') { await mkdir('preview', { recursive: true }); await panel.screenshot({ path: 'preview/notifications-settings.png' }); }
});

test('Dzwonek: badge, ważne na górze, osobista gwiazdka, odczyt i otwarcie właściwego modułu', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await putInbox('school-grade', { createdAt: Timestamp.fromMillis(Date.now() - 3000) });
  await putInbox('calendar-event', { title: 'Zmiana w kalendarzu', category: 'calendar', module: 'Kalendarz', important: true, createdAt: Timestamp.fromMillis(Date.now() - 1000) });
  await putInbox('task-event', { title: 'Nowe zadanie', category: 'tasks', module: 'Zadania', read: true });
  await login(page);
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('2');
  await page.getByTestId('notification-bell').click();
  const center = page.locator('.notification-center');
  await expect(center.locator('.notification-item')).toHaveCount(3);
  await expect(center.locator('.notification-item').first()).toContainText('Zmiana w kalendarzu');
  const grade = center.locator('.notification-item').filter({ hasText: 'Nowa ocena — Nikodem' });
  await grade.getByRole('button', { name: 'Oznacz jako ważne' }).click();
  await expect.poll(async () => (await fixtureDatabase().doc(`notificationInbox/${accounts.parent.uid}/items/school-grade`).get()).data()?.starred).toBe(true);
  await center.getByRole('button', { name: '★ Ważne', exact: true }).click();
  await expect(center.locator('.notification-item')).toHaveCount(2);
  await center.getByRole('button', { name: 'Wszystkie', exact: true }).click();
  if (browserName === 'chromium') { await mkdir('preview', { recursive: true }); await page.screenshot({ path: 'preview/notifications-center.png', fullPage: true }); }
  await center.locator('.notification-item').filter({ hasText: 'Zmiana w kalendarzu' }).locator('.notification-item-content').click();
  await expect(page.locator('.page-header h1')).toHaveText('Kalendarz');
  await expect.poll(async () => (await fixtureDatabase().doc(`notificationInbox/${accounts.parent.uid}/items/calendar-event`).get()).data()?.read).toBe(true);
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('1');
  expect((await fixtureDatabase().doc(`notificationInbox/${accounts.mother.uid}/items/school-grade`).get()).exists).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('notification-bell').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('Dźwięk IN-APP: nowe foreground tylko raz, OFF, ukryta aplikacja i wyłączona kategoria milczą', async ({ page }) => {
  await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).set({ notifications: preferences });
  await login(page); const panel = await settings(page);
  await expect(panel.getByRole('switch', { name: /^Powiadomienia/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('notification-bell').click(); await page.getByRole('button', { name: 'Zamknij powiadomienia' }).click();
  await putInbox('foreground-one');
  await expect.poll(() => oscillatorCount(page)).toBe(3);
  await fixtureDatabase().doc(`notificationInbox/${accounts.parent.uid}/items/foreground-one`).update({ read: false, starred: true });
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('1');
  expect(await oscillatorCount(page)).toBe(3);
  await panel.getByRole('switch', { name: /^Dźwięk powiadomień/ }).click();
  await expect(panel.getByRole('switch', { name: /^Dźwięk powiadomień/ })).toHaveAttribute('aria-checked', 'false');
  await putInbox('foreground-two');
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('2');
  expect(await oscillatorCount(page)).toBe(3);
  await panel.getByRole('switch', { name: /^Dźwięk powiadomień/ }).click();
  await expect(panel.getByRole('switch', { name: /^Dźwięk powiadomień/ })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('checkbox', { name: 'Szkoła', exact: true })).toBeEnabled();
  await panel.getByRole('checkbox', { name: 'Szkoła', exact: true }).uncheck();
  await expect.poll(async () => (await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.notifications?.categories?.school).toBe(false);
  await putInbox('disabled-school');
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('3');
  expect(await oscillatorCount(page)).toBe(3);
  await putInbox('other-uid', { category: 'familyChat', module: 'Czat' }, accounts.mother.uid);
  expect(await oscillatorCount(page)).toBe(3);
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
  await putInbox('background-quiet', { category: 'familyChat', module: 'Czat' });
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('4');
  expect(await oscillatorCount(page)).toBe(3);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
  await panel.getByRole('switch', { name: /^Powiadomienia/ }).click();
  await expect(panel.getByRole('switch', { name: /^Powiadomienia/ })).toHaveAttribute('aria-checked', 'false');
  await putInbox('master-disabled', { category: 'familyChat', module: 'Czat' });
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('5');
  expect(await oscillatorCount(page)).toBe(3);
});

test('Centrum: Sebastian logout → Dominika login nie pokazuje poprzednich prywatnych alertów ani jego gwiazdek', async ({ page }) => {
  await putInbox('sebastian-only', { title: 'Powiadomienie Sebastiana', starred: true });
  await putInbox('dominika-only', { title: 'Powiadomienie Dominiki' }, accounts.mother.uid);
  await login(page); await page.getByTestId('notification-bell').click();
  await expect(page.locator('.notification-center')).toContainText('Powiadomienie Sebastiana');
  await page.getByRole('button', { name: 'Zamknij powiadomienia' }).click();
  await logout(page); await login(page, accounts.mother);
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('1');
  await page.getByTestId('notification-bell').click();
  await expect(page.locator('.notification-center')).toContainText('Powiadomienie Dominiki');
  await expect(page.locator('.notification-center')).not.toContainText('Powiadomienie Sebastiana');
  await expect(page.locator('.notification-center').getByRole('button', { name: 'Usuń z ważnych' })).toHaveCount(0);
});

test('IN-APP start działa bez VAPID, Functions i rejestracji FCM; nie czyta ani nie pyta o zgodę systemową', async ({ page }) => {
  const forbidden: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (/firebase_messaging|firebaseinstallations|fcmregistrations|fcm\.googleapis|\/src\/notifications\/push\.ts|\/api\/notifications\/(?:register|status)/.test(url)) forbidden.push(url);
  });
  await login(page);
  const panel = await settings(page);
  await expect(panel).toContainText('IN-APP');
  await expect(panel).toContainText('Powiadomienia systemowe — dostępne w przyszłej aktualizacji.');
  await expect(panel.locator('[role="status"]')).toHaveCount(0);
  for (const name of ['Powiadomienia', 'Dźwięk powiadomień']) {
    await panel.getByRole('switch', { name: new RegExp(`^${name}`) }).click();
    await expect(panel.getByRole('switch', { name: new RegExp(`^${name}`) })).toBeEnabled();
  }
  await putInbox('without-functions');
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('1');
  await page.getByTestId('notification-bell').click();
  await expect(page.locator('.notification-center')).toContainText('Nowa ocena — Nikodem');
  const permission = await page.evaluate(() => {
    const state = window as unknown as { __notificationPermissionReads: number; __notificationPermissionRequests: number };
    return { reads: state.__notificationPermissionReads, requests: state.__notificationPermissionRequests };
  });
  expect(permission).toEqual({ reads: 0, requests: 0 });
  expect(forbidden).toEqual([]);
});

test('Dziecko ma tylko własny dzwonek; prywatna skrzynka rodziców nie trafia do centrum', async ({ page }) => {
  await putInbox('parent-teacher-private', { title: 'Poufna wiadomość nauczyciela' });
  await putInbox('child-grade', { title: 'Nowa ocena dla Nikodema' }, accounts.child.uid);
  await login(page, accounts.child);
  await expect(page.getByTestId('notification-bell').locator('.notification-badge')).toHaveText('1');
  await page.getByTestId('notification-bell').click();
  await expect(page.locator('.notification-center')).toContainText('Nowa ocena dla Nikodema');
  await expect(page.locator('.notification-center')).not.toContainText('Poufna wiadomość nauczyciela');
});

// Only the OLD worker is provided by the test. The current app safely retires
// its UID binding instead of registering a new push session or device token.
test('Aktualizacja PWA: stary worker wyłączony na start i logout; nowe konto nie odziedziczy push', async ({ page, context }) => {
  await page.addInitScript(() => {
    // Represents a pre-existing transport, never a new browser subscription.
    Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { configurable: true, get() { return { async getSubscription() { return { async unsubscribe() { return true; } }; } }; } });
  });
  const workerSource = NOTIFICATION_WORKER_SOURCE + `\nself.addEventListener('message', event => { if (event.data?.type === 'NR_TEST_STATE') event.waitUntil(nrSession('readonly').then(value => event.ports[0].postMessage(value))); });`;
  await context.route('**/notification-test-sw.js*', route => route.fulfill({ contentType: 'application/javascript', headers: { 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-store' }, body: workerSource }));
  await context.route('**/notification-upgrade-seed.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="pl"><head><title>Stan przed aktualizacją PWA</title></head><body>Istniejąca instalacja — bez uruchamiania aplikacji.</body></html>' }));
  await page.goto('/notification-upgrade-seed.html');
  await page.evaluate(async uid => {
    const registration = await navigator.serviceWorker.register('/notification-test-sw.js', { scope: '/' });
    const active = registration.active || await new Promise<ServiceWorker>(resolve => {
      const worker = registration.installing!; worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(worker); });
    });
    await new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); }; active.postMessage({ type: 'NR_NOTIFICATION_BIND', uid, enabled: true, categories: {}, bindingVersion: 1, version: 1 }, [channel.port2]); });
  }, accounts.parent.uid);
  async function state() {
    return page.evaluate(async () => {
      const worker = (await navigator.serviceWorker.getRegistration('/'))!.active!;
      return await new Promise<{ uid: string | null; enabled: boolean }>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); }; worker.postMessage({ type: 'NR_TEST_STATE' }, [channel.port2]); });
    });
  }
  expect((await state()).uid).toBe(accounts.parent.uid);
  await login(page);
  await expect.poll(async () => (await state()).uid).toBeNull();
  expect((await state()).enabled).toBe(false);
  await logout(page); await login(page, accounts.mother);
  await expect.poll(async () => (await state()).uid).toBeNull();
  expect((await state()).enabled).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __notificationPermissionRequests: number }).__notificationPermissionRequests)).toBe(0);
});
