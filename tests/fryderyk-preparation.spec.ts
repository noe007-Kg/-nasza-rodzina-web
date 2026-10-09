import { expect, test, type Page } from '@playwright/test';
import { accounts, password, seedEmulators } from './emulator-fixtures';

async function login(page: Page, account: { email: string } = accounts.parent) {
  await page.goto('/'); await page.getByLabel('E-mail', { exact: true }).fill(account.email); await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click(); await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(() => { location.hash = encodeURIComponent('Szkoła'); }); await expect(page.locator('.school-heading h1')).toHaveText('Szkoła');
}
test.beforeEach(async ({ context }) => {
  await seedEmulators();
  await context.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await context.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, () => { throw new Error('Fryderyk tests forbid production Firebase.'); });
  await context.route('**/api/eduvulcan/**', route => { expect(route.request().method()).toBe('GET'); expect(new URL(route.request().url()).pathname).toBe('/api/eduvulcan/status'); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) }); });
  await context.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
});

test('Rodzic otwiera osobny, niepołączony Fryderyk; żaden plan lub wiadomość SP4 nie jest prezentowana jako muzyczna', async ({ page, context }) => {
  const requests: string[] = []; await context.route(/https:\/\/[^/]*fryderyk\.edu\.pl\//, route => { requests.push(route.request().url()); return route.abort(); });
  await login(page); await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await expect(page.getByTestId('school-stat-lessons')).toBeVisible();
  await page.getByTestId('school-source-selector').getByRole('button', { name: /Fryderyk/ }).click();
  const panel = page.getByTestId('fryderyk-preparation'); await expect(panel).toContainText('Fryderyk — niepołączono'); await expect(panel).toContainText('jeszcze nie wykonano');
  await expect(panel).not.toContainText('Przyroda Nikodema'); await expect(page.getByTestId('school-sp4-content')).toBeHidden();
  for (const name of ['Plan zajęć', 'Ogłoszenia', 'Wiadomości', 'Nieobecności']) { await panel.getByRole('button', { name, exact: true }).click(); await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible(); }
  await expect(panel.getByRole('textbox')).toHaveCount(0); await expect(panel.getByRole('button', { name: /Połącz|Synchronizuj/ })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Wróć do SP4', exact: true }).click(); await expect(page.getByTestId('school-stat-lessons')).toBeVisible();
  await expect(page.locator('.school-plan-list')).toContainText('Przyroda Nikodema'); expect(requests).toEqual([]);
});

test('Dziecko widzi tylko swój profil, bez skrzynki rodzica i bez żądania statusu rodzicielskiego eduVULCAN', async ({ page }) => {
  let eduRequests = 0; page.on('request', request => { if (request.url().includes('/api/eduvulcan/')) eduRequests++; });
  await login(page, accounts.child); await expect(page.locator('.school-students button')).toHaveCount(1);
  await page.getByTestId('school-source-selector').getByRole('button', { name: /Fryderyk/ }).click();
  const panel = page.getByTestId('fryderyk-preparation'); await expect(panel).toHaveAttribute('aria-label', 'Fryderyk: Nikodem');
  await expect(panel.getByRole('button', { name: 'Wiadomości', exact: true })).toHaveCount(0); await expect(page.getByTestId('school-stat-messages')).toHaveCount(0); expect(eduRequests).toBe(0);
  await page.evaluate(() => { location.hash = encodeURIComponent('Ustawienia'); });
  await expect(page.getByTestId('settings-appearance')).toBeVisible();
  await expect(page.getByTestId('school-connections-preparation')).toHaveCount(0);
});

test('Zmiana ucznia przywraca jego osobny domyślny widok SP4', async ({ page }) => {
  await login(page); await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await page.getByTestId('school-source-selector').getByRole('button', { name: /Fryderyk/ }).click(); await expect(page.getByTestId('fryderyk-preparation')).toBeVisible();
  await page.locator('.school-students').getByRole('button', { name: 'Paweł', exact: true }).click(); await expect(page.getByTestId('fryderyk-preparation')).toHaveCount(0);
  await expect(page.getByTestId('school-sp4-content')).toBeVisible(); await expect(page.locator('.school-plan-list')).toContainText('Fizyka Pawła');
});

test('Fryderyk jest responsywny w pięciu rozmiarach, a przygotowanie połączenia występuje tylko w ustawieniach rodzica', async ({ page, browserName }) => {
  await login(page); await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await page.getByTestId('school-source-selector').getByRole('button', { name: /Fryderyk/ }).click();
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size); await expect(page.getByTestId('fryderyk-preparation')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (process.env.NASZA_CAPTURE_CURRENT_PREVIEWS === 'true' && browserName === 'chromium' && [390, 1024].includes(size.width)) await page.screenshot({ path: `preview/current-fixes/fryderyk-${size.width === 390 ? 'phone' : 'tablet'}.png` });
  }
  await page.evaluate(() => { location.hash = encodeURIComponent('Ustawienia'); }); await expect(page.getByTestId('school-connections-preparation')).toContainText('Fryderyk — niepołączono');
  await page.getByTestId('school-connections-preparation').getByRole('button', { name: 'Otwórz moduł Szkoła', exact: true }).click(); await expect(page.locator('.school-heading h1')).toHaveText('Szkoła');
});
