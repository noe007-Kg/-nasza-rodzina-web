import { expect, test, type Page } from '@playwright/test';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';
import { START_CARD_IDS } from '../src/features/start-layout';
import { START_TILE_COLOR_PALETTE } from '../src/features/start-tile-colors';

async function login(page: Page, account: { email: string } = accounts.parent) {
  await page.goto('/'); await page.getByLabel('E-mail', { exact: true }).fill(account.email); await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click(); await expect(page.getByTestId('start-dashboard')).toBeVisible();
}
async function go(page: Page, module: string) {
  await page.evaluate(value => { location.hash = encodeURIComponent(value); }, module);
  await expect(module === 'Start' ? page.getByTestId('start-dashboard') : page.getByTestId('settings-appearance')).toBeVisible();
  if (module === 'Ustawienia') {
    const disclosure = page.getByRole('button', { name: 'Kolory kafelków', exact: true });
    if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
  }
}
async function background(page: Page, card = 'shopping') { return page.getByTestId(`start-card-${card}`).evaluate(node => getComputedStyle(node).backgroundColor); }
test.beforeEach(async ({ context }) => {
  await seedEmulators();
  await context.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await context.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, () => { throw new Error('Color tests forbid production Firebase.'); });
  await context.route('**/api/eduvulcan/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) }));
  await context.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
  await context.route('**/api/notifications/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'in-app', devices: [] }) }));
});

test('Oryginalny wygląd, niezależne kolory i reset tylko kolorów bez zmiany motywu lub kolejności', async ({ page }) => {
  const db = fixtureDatabase(), order = ['chat', 'shopping', 'family-time', 'school', 'health', 'calendar', 'tasks'];
  await db.doc(`userPreferences/${accounts.parent.uid}`).set({ dashboardOrder: order, importantItems: ['school:test:fixture'] });
  await login(page); await expect(page.locator('.start-dashboard-grid')).toHaveAttribute('data-order', order.join(','));
  await expect(page.locator('.start-dashboard-card[data-custom-color]')).toHaveCount(0);
  const original = await background(page), taskOriginal = await background(page, 'tasks');
  await go(page, 'Ustawienia');
  const settings = page.getByTestId('tile-color-settings'); await expect(settings).toContainText('nie synchronizują się między urządzeniami');
  await settings.getByRole('radio', { name: 'Zakupy: Turkusowy', exact: true }).check();
  await settings.getByRole('radio', { name: 'Czat: Fioletowy', exact: true }).check();
  await go(page, 'Start'); await expect(page.getByTestId('start-card-shopping')).toHaveAttribute('data-custom-color', 'turquoise');
  await expect(page.getByTestId('start-card-chat')).toHaveAttribute('data-custom-color', 'violet');
  expect(await background(page)).not.toBe(original); expect(await background(page, 'tasks')).toBe(taskOriginal);
  await page.reload(); await expect(page.getByTestId('start-card-shopping')).toHaveAttribute('data-custom-color', 'turquoise');
  await go(page, 'Ustawienia'); await settings.getByRole('radio', { name: 'Zakupy: Oryginalny', exact: true }).check();
  await go(page, 'Start'); expect(await background(page)).toBe(original); await expect(page.getByTestId('start-card-chat')).toHaveAttribute('data-custom-color', 'violet');
  await go(page, 'Ustawienia'); await page.getByRole('button', { name: 'Ciemny', exact: true }).click();
  await settings.getByRole('button', { name: 'Przywróć domyślne kolory', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); await go(page, 'Start');
  await expect(page.locator('.start-dashboard-card[data-custom-color]')).toHaveCount(0); await expect(page.locator('.start-dashboard-grid')).toHaveAttribute('data-order', order.join(','));
  expect((await db.doc(`userPreferences/${accounts.parent.uid}`).get()).data()).toEqual({ dashboardOrder: order, importantItems: ['school:test:fixture'] });
});

test('Kolory pozostają przypisane do UID po wylogowaniu i zmianie rodzica lub dziecka', async ({ page }) => {
  await login(page); await go(page, 'Ustawienia'); await page.getByRole('radio', { name: 'Zakupy: Turkusowy', exact: true }).check();
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click(); await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await login(page, accounts.mother); await expect(page.locator('.start-dashboard-card[data-custom-color]')).toHaveCount(0);
  await go(page, 'Ustawienia'); await page.getByRole('radio', { name: 'Zakupy: Pomarańczowy', exact: true }).check();
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click(); await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await login(page, accounts.child); await expect(page.locator('.start-dashboard-card[data-custom-color]')).toHaveCount(0);
  await go(page, 'Ustawienia'); await page.getByRole('button', { name: 'Wyloguj', exact: true }).click(); await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await login(page); await expect(page.getByTestId('start-card-shopping')).toHaveAttribute('data-custom-color', 'turquoise');
});

test('Wszystkie osiem kolorów działa w jasnym i ciemnym motywie, a napisy pozostają czytelne', async ({ page }) => {
  test.setTimeout(90_000); await login(page);
  for (const theme of ['Jasny', 'Ciemny']) for (const color of START_TILE_COLOR_PALETTE) {
    await go(page, 'Ustawienia'); await page.getByRole('button', { name: theme, exact: true }).click();
    await page.getByRole('radio', { name: `Zakupy: ${color.label}`, exact: true }).check(); await go(page, 'Start');
    const actual = await page.getByTestId('start-card-shopping').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, text: getComputedStyle(node.querySelector('.start-card-heading > strong')!).color, muted: getComputedStyle(node.querySelector('.start-card-status')!).color, icon: getComputedStyle(node.querySelector('.start-card-icon')!).color }));
    const expectedHex = theme === 'Jasny' ? color.background : color.darkBackground;
    const expected = expectedHex.slice(1).match(/../g)!.map(value => parseInt(value, 16));
    expect(actual.background).toBe(`rgb(${expected.join(', ')})`);
    const rgb = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number);
    const luminance = (channels: number[]) => channels.map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const a = luminance(rgb(actual.background)), b = luminance(rgb(actual.text));
    expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
    const muted = luminance(rgb(actual.muted)), icon = luminance(rgb(actual.icon));
    expect((Math.max(a, muted) + .05) / (Math.min(a, muted) + .05)).toBeGreaterThanOrEqual(4.5);
    expect((Math.max(a, icon) + .05) / (Math.min(a, icon) + .05)).toBeGreaterThanOrEqual(4.5);
  }
});

test('Kółeczka 18 px mają wygodny dotyk, motywy są kompaktowe i brak przepełnienia w pięciu rozmiarach', async ({ page, browserName }) => {
  await login(page); await go(page, 'Ustawienia');
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const card of START_CARD_IDS) {
      const row = page.getByTestId(`tile-color-row-${card}`); await expect(row.getByRole('radio')).toHaveCount(9);
      const sizes = await row.locator('.start-color-choice').first().evaluate(node => ({ target: node.getBoundingClientRect().width, dot: node.querySelector('.start-color-dot')!.getBoundingClientRect().width }));
      expect(sizes.target).toBeGreaterThanOrEqual(36); expect(sizes.dot).toBe(18);
    }
    for (const name of ['Jasny', 'Ciemny']) { const button = page.getByRole('button', { name, exact: true }); await expect(button).toBeVisible(); expect((await button.boundingBox())!.width).toBeLessThan(130); }
    if (process.env.NASZA_CAPTURE_CURRENT_PREVIEWS === 'true' && browserName === 'chromium' && [390, 1024].includes(size.width)) {
      await page.getByTestId('settings-appearance').evaluate(node => { const header = document.querySelector('[data-testid="family-profile-bar"]')!.getBoundingClientRect().height; window.scrollTo({ top: scrollY + node.getBoundingClientRect().top - header - 12, behavior: 'instant' }); });
      await expect.poll(async () => Math.round((await page.getByTestId('family-profile-bar').boundingBox())!.y)).toBe(0);
      await page.screenshot({ path: `preview/current-fixes/appearance-${size.width === 390 ? 'phone' : 'tablet'}.png` });
    }
  }
});

test('Niedostępny zapis zgłasza ograniczenie i zachowuje wybrane kolory podczas przełączania modułów', async ({ page }) => {
  await page.addInitScript(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('nr-start-tile-colors:')) throw new DOMException('Synthetic quota', 'QuotaExceededError'); original.call(this, key, value); }; });
  await login(page); await go(page, 'Ustawienia'); await page.getByRole('radio', { name: 'Zakupy: Turkusowy', exact: true }).check();
  await expect(page.getByTestId('tile-color-settings').getByRole('status')).toContainText('Nie udało się zapisać');
  await go(page, 'Start'); await expect(page.getByTestId('start-card-shopping')).toHaveAttribute('data-custom-color', 'turquoise');
});

test('Kolor kafelka zachowuje się także w DragOverlay bez sortowania w trakcie gestu', async ({ page }) => {
  await login(page); await go(page, 'Ustawienia'); await page.getByRole('radio', { name: 'Zakupy: Turkusowy', exact: true }).check(); await go(page, 'Start');
  const grid = page.locator('.start-dashboard-grid'); await expect(grid).toHaveAttribute('data-layout-ready', 'true'); const order = await grid.getAttribute('data-order');
  const tile = page.getByTestId('start-card-shopping'); await tile.scrollIntoViewIfNeeded(); const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30); await page.mouse.down();
  await expect(page.getByTestId('start-drag-overlay')).toBeVisible(); await expect(page.getByTestId('start-drag-overlay')).toHaveAttribute('data-custom-color', 'turquoise');
  expect(await page.getByTestId('start-drag-overlay').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(await background(page));
  await expect(grid).toHaveAttribute('data-order', order!); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByTestId('start-drag-overlay')).toHaveCount(0); await expect(grid).toHaveAttribute('data-order', order!);
});

test('Zmiana w drugiej karcie jest widoczna po ponownym otwarciu Startu', async ({ page, context }) => {
  await login(page); await go(page, 'Ustawienia'); await page.getByRole('radio', { name: 'Zakupy: Turkusowy', exact: true }).check();
  await page.evaluate(() => { location.hash = encodeURIComponent('Czat'); }); await expect(page.getByRole('heading', { name: 'Czat', exact: true })).toBeVisible();
  const other = await context.newPage(); await other.goto('/'); await expect(other.locator('.app-shell')).toBeVisible();
  await go(other, 'Ustawienia'); await other.getByRole('radio', { name: 'Zakupy: Niebieski', exact: true }).check();
  await go(page, 'Start'); await expect(page.getByTestId('start-card-shopping')).toHaveAttribute('data-custom-color', 'blue'); await other.close();
});
