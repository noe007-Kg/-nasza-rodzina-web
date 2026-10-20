// Current Start contracts replace the removed seven-tile preview assertions.
import { expect, test } from '@playwright/test';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';
test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 14 }, daily: {} }) }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, () => { throw new Error('Production Firebase forbidden'); });
});
async function open(page: import('@playwright/test').Page) {
  await page.goto('/'); await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email); await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click(); await expect(page.getByTestId('start-dashboard')).toBeVisible();
}
test('family status includes passive profiles, excludes archived profiles and does not fabricate events', async ({ page }) => {
  const db = fixtureDatabase(); await db.doc('members/archived').set({ name: 'Archiwalny profil', personKey: 'Archiwalny', role: 'child', active: true, archived: true, canLogin: false });
  await open(page); await expect(page.locator('.home-person')).toHaveCount(5);
  const layla = page.locator('.home-person').filter({ hasText: 'Layla' }); await expect(layla).toContainText('Brak aktualnego wydarzenia');
  await expect(page.locator('.home-people')).not.toContainText('Archiwalny profil');
});
test('shopping shortcut shows actual remaining count and navigates to the existing list', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc('shoppingItems/open').set({ title: 'Mleko', done: false }); await db.doc('shoppingItems/bought').set({ title: 'Chleb', done: true });
  await open(page); const shortcut = page.locator('.home-shortcuts').getByRole('button', { name: /Zakupy/ });
  await expect(shortcut).toContainText('1 do kupienia'); await shortcut.click(); await expect(page.getByRole('heading', { name: 'Zakupy', exact: true })).toBeVisible();
  expect((await db.doc('shoppingItems/open').get()).data()?.done).toBe(false);
});
test('tasks on Start are previews and never complete or approve a task', async ({ page }) => {
  await open(page); await page.locator('.home-task').filter({ hasText: 'Wynieść śmieci' }).click();
  await expect(page.getByRole('heading', { name: 'Zadania', exact: true })).toBeVisible();
  const task = (await fixtureDatabase().doc('tasks/child-approval').get()).data(); expect(task?.done).toBe(false); expect(task?.approvalStatus).toBe('none');
});
