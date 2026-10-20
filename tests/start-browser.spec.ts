import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';
async function login(page: Page, account = accounts.parent as (typeof accounts)[keyof typeof accounts]) {
  await page.goto('/'); await page.getByLabel('E-mail', { exact: true }).fill(account.email); await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByTestId('start-dashboard')).toBeVisible(); await expect(page.locator('.home-sections')).toHaveAttribute('data-layout-ready', 'true');
}
test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 9, weather_code: 1, wind_speed_10m: 8 }, daily: { temperature_2m_max: [12], temperature_2m_min: [7] } }) }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, () => { throw new Error('Production Firebase forbidden'); });
});
for (const width of [390, 900, 1440]) test(`authenticated family home at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await login(page);
  await expect(page.locator('.home-person')).toHaveCount(5); await expect(page.getByTestId('home-section-tasks')).toContainText('2 zadań');
  await expect(page.locator('.home-shortcuts button')).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
test('real UID preferences survive section drag and no write happens just by opening Start', async ({ page }) => {
  const db = fixtureDatabase(), ref = db.doc(`userPreferences/${accounts.parent.uid}`);
  const order = ['health', 'school', 'family-time', 'calendar', 'shopping', 'tasks', 'chat'];
  await ref.set({ dashboardOrder: order }); await login(page);
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order', 'shortcuts,calendar,tasks');
  expect((await ref.get()).data()?.dashboardOrder).toEqual(order);
  await page.getByRole('button', { name: 'Przenieś sekcję: Szybki dostęp' }).focus(); await page.keyboard.press('Space');
  await expect(page.getByTestId('home-section-shortcuts')).toHaveClass(/is-dragging/); await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Nad sekcją: Najbliżej w rodzinie.', { exact: true })).toHaveCount(1); await page.keyboard.press('Space');
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order', 'calendar,shortcuts,tasks');
  await expect.poll(async () => (await ref.get()).data()?.dashboardOrder).toEqual(['family-time', 'calendar', 'health', 'school', 'shopping', 'chat', 'tasks']);
});
test('family agenda excludes own and other-user private events while retaining shared future events', async ({ page }) => {
  const db = fixtureDatabase(), from = new Date(Date.now() + 86400000);
  const base = { person: 'family', date: Timestamp.fromDate(from), endDate: Timestamp.fromDate(new Date(+from + 1800000)), allDay: false, description: '', repeat: 'none', repeatUntil: null, createdAt: Timestamp.now() };
  await db.doc('calendarEvents/shared-future').set({ ...base, title: 'Wspólny przyszły plan', createdBy: accounts.parent.uid, private: false });
  for (const account of [accounts.parent, accounts.mother]) await db.doc(`privateCalendarEvents/private-${account.uid}`).set({ ...base, title: `Prywatny plan ${account.name}`, createdBy: account.uid, ownerUid: account.uid, private: true });
  await login(page); const agenda = page.getByTestId('home-section-calendar');
  await expect(agenda).toContainText('Wspólny przyszły plan'); await expect(agenda).not.toContainText('Prywatny plan');
  await agenda.getByRole('button', { name: /Wspólny przyszły plan/ }).click(); await expect(page.getByRole('dialog')).toContainText('Wspólny przyszły plan');
});
test('logged-in identity owns the accent and top roster order', async ({ page }) => {
  await login(page, accounts.mother); await expect(page.locator('html')).toHaveAttribute('data-account-accent', 'pink');
  await expect(page.locator('.home-person').first()).toContainText('Dominika');
});
