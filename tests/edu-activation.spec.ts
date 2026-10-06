import { expect, test, type Page } from '@playwright/test';
import { accounts, password, seedEmulators } from './emulator-fixtures';

type Call = { operation: string; authorized: boolean; method: string; emptyBody: boolean };
async function mockJournal(page: Page, ageInMinutes: number) {
  let clock = Date.now();
  let success = clock - ageInMinutes * 60_000;
  const calls: Call[] = [];
  const status = () => ({
    configured: true, state: 'connected', scope: 'family', accountRole: 'parent',
    profiles: [{ id: 'nikodem-sp4', studentName: 'Nikodem', schoolName: 'Szkoła Podstawowa nr 4', schoolSymbol: 'SP4' }],
    selectedStudent: { profileId: 'nikodem-sp4', personKey: 'Nikodem' },
    lastSyncAt: new Date(success).toISOString(), lastSuccessAt: new Date(success).toISOString(),
    nextSyncAt: new Date(success + 5 * 60_000).toISOString(),
  });
  await page.route('**/api/eduvulcan/**', async route => {
    const request = route.request();
    const operation = new URL(request.url()).pathname.split('/').at(-1)!;
    calls.push({ operation, authorized: /^Bearer\s+\S+$/.test(request.headers().authorization || ''), method: request.method(), emptyBody: operation === 'status' || request.postData() === '{}' });
    if (operation === 'sync') success = clock;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: status(), ...(operation === 'sync' ? { sync: { counts: { grades: 1 }, warnings: [] } } : {}) }) });
  });
  return {
    calls,
    async advance(minutes: number) { clock += minutes * 60_000; await page.clock.setFixedTime(new Date(clock)); },
  };
}

async function login(page: Page, account = accounts.parent as (typeof accounts)[keyof typeof accounts]) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function visibility(page: Page, state: 'hidden' | 'visible', burst = false) {
  await page.evaluate(({ next, many }) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    document.dispatchEvent(new Event('visibilitychange'));
    if (many) { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); }
  }, { next: state, many: burst });
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, route => {
    throw new Error(`Activation test attempted production Firebase: ${route.request().url()}`);
  });
});

test('activation: parent login on Start synchronizes a journal older than 60 minutes once', async ({ page }) => {
  const journal = await mockJournal(page, 61);
  await login(page);
  await expect.poll(() => journal.calls.filter(call => call.operation === 'sync').length).toBe(1);
  await expect(page.getByTestId('start-dashboard')).toBeVisible();
  expect(journal.calls.map(call => call.operation)).toEqual(['status', 'sync']);
  expect(journal.calls.every(call => call.authorized && call.emptyBody)).toBe(true);
  expect(journal.calls.find(call => call.operation === 'sync')?.method).toBe('POST');
});

test('activation: a recent sync and ordinary module changes never resynchronize', async ({ page }) => {
  const journal = await mockJournal(page, 10);
  await login(page);
  await expect.poll(() => journal.calls.filter(call => call.operation === 'status').length).toBe(1);
  for (const module of ['Kalendarz', 'Zadania', 'Szkoła', 'Start', 'Szkoła']) {
    await page.locator('.sidebar-nav').getByRole('button', { name: module, exact: true }).click();
  }
  await expect(page.locator('.edu-vulcan-state')).toHaveText('Połączono');
  expect(journal.calls.filter(call => call.operation === 'sync')).toHaveLength(0);
  expect(journal.calls.filter(call => call.operation === 'status')).toHaveLength(1);
});

test('activation: foreground after an hour synchronizes once despite visibility/focus/pageshow burst', async ({ page }) => {
  const journal = await mockJournal(page, 10);
  await login(page);
  await expect.poll(() => journal.calls.length).toBe(1);
  await visibility(page, 'hidden', true);
  await journal.advance(51);
  await visibility(page, 'hidden', true);
  expect(journal.calls.filter(call => call.operation === 'sync')).toHaveLength(0);
  await visibility(page, 'visible', true);
  await expect.poll(() => journal.calls.filter(call => call.operation === 'sync').length).toBe(1);
  expect(journal.calls.map(call => call.operation)).toEqual(['status', 'status', 'sync']);
  await journal.advance(1);
  await visibility(page, 'visible', true);
  await expect.poll(() => journal.calls.filter(call => call.operation === 'status').length).toBe(3);
  expect(journal.calls.filter(call => call.operation === 'sync')).toHaveLength(1);
});

test('activation: Synchronizuj teraz bypasses the hour and then displays the recent-sync cooldown', async ({ page }) => {
  const journal = await mockJournal(page, 10);
  await login(page);
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Szkoła', exact: true }).click();
  const panel = page.locator('.edu-vulcan-connection');
  const button = panel.getByRole('button', { name: 'Synchronizuj teraz', exact: true });
  await expect(button).toBeEnabled();
  expect(journal.calls.filter(call => call.operation === 'sync')).toHaveLength(0);
  await button.click();
  await expect.poll(() => journal.calls.filter(call => call.operation === 'sync').length).toBe(1);
  await expect(button).toBeDisabled();
  await expect(panel).toContainText('Dane odświeżono bardzo niedawno');
  expect(journal.calls.map(call => call.operation)).toEqual(['status', 'sync']);
});

test('activation: reopening an authenticated application checks status without another recent sync', async ({ page }) => {
  const journal = await mockJournal(page, 61);
  await login(page);
  await expect.poll(() => journal.calls.filter(call => call.operation === 'sync').length).toBe(1);
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect.poll(() => journal.calls.filter(call => call.operation === 'status').length).toBe(2);
  expect(journal.calls.filter(call => call.operation === 'sync')).toHaveLength(1);
});

test('activation: a child never requests the shared private parent connection', async ({ page }) => {
  const journal = await mockJournal(page, 61);
  await login(page, accounts.child);
  await visibility(page, 'hidden');
  await journal.advance(61);
  await visibility(page, 'visible', true);
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Szkoła', exact: true }).click();
  await expect(page.locator('.school-record-list')).toContainText('Przyroda Nikodema');
  await expect(page.locator('.edu-vulcan-connection')).toHaveCount(0);
  expect(journal.calls).toHaveLength(0);
});
