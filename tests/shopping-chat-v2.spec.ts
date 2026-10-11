import { expect, test, type Page } from '@playwright/test';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';

async function login(page: Page, account: (typeof accounts)['parent'] | (typeof accounts)['child'] = accounts.parent) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 19, weather_code: 1, wind_speed_10m: 8 }, daily: { temperature_2m_max: [22], temperature_2m_min: [12] } }) }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, route => { throw new Error(`V2 browser tests forbid production Firebase: ${route.request().url()}`); });
});

test('shopping store assignment shares one product and one bought state across views', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { location.hash = encodeURIComponent('Zakupy'); });
  await expect(page.locator('.page-header h1')).toHaveText('Zakupy');
  const picker = page.getByRole('group', { name: 'Sklepy dla nowych produktów (opcjonalnie)' });
  await picker.getByLabel('Biedronka').check();
  await picker.getByLabel('Lidl').check();
  await page.getByPlaceholder('Np. długopis, gumka, zeszyt, lampka, zegarek…').fill('Mleko, Banany');
  await page.getByRole('button', { name: '✨ Dodaj wszystkie' }).click();
  await expect.poll(async () => (await fixtureDatabase().collection('shoppingItems').get()).size).toBe(2);
  const rows = await fixtureDatabase().collection('shoppingItems').get();
  for (const row of rows.docs) expect(row.data().shopIds).toEqual(['biedronka', 'lidl']);
  const tabs = page.getByRole('group', { name: 'Wybierz sklep' });
  await tabs.getByRole('button', { name: /Biedronka/ }).click();
  await page.getByRole('button', { name: 'Oznacz jako kupione: Mleko', exact: true }).click();
  await tabs.getByRole('button', { name: /Lidl/ }).click();
  await expect(page.getByRole('button', { name: 'Przywróć: Mleko', exact: true })).toBeVisible();
  expect((await fixtureDatabase().collection('shoppingItems').get()).size).toBe(2);
  await page.getByRole('button', { name: '＋ Własne sklepy' }).click();
  await page.getByLabel('Nazwa sklepu', { exact: true }).fill('Testowy sklep');
  await page.getByRole('button', { name: 'Dodaj sklep', exact: true }).click();
  await expect.poll(async () => (await fixtureDatabase().collection('shoppingStores').get()).size).toBe(1);
});

test('chat persists real emoji reactions and per-user read cursors without media', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { location.hash = encodeURIComponent('Czat'); });
  await expect(page.locator('.chat-messages')).toContainText('Wspólna wiadomość testowa');
  const message = page.locator('.chat-message-line').filter({ hasText: 'Wspólna wiadomość testowa' });
  await message.getByRole('button', { name: 'Opcje wiadomości', exact: true }).click();
  await page.getByRole('button', { name: 'Zareaguj 👍', exact: true }).click();
  const reaction = fixtureDatabase().doc(`familyMessages/family-message/reactions/${accounts.parent.uid}`);
  await expect.poll(async () => (await reaction.get()).data()?.emoji).toBe('👍');
  await expect(message.locator('.chat-message-reactions')).toContainText('👍');
  await message.locator('.chat-message-reactions').getByRole('button').click();
  await expect.poll(async () => (await reaction.get()).exists).toBe(false);
  await page.locator('.chat-mode-tabs').getByRole('button', { name: 'Prywatne', exact: true }).click();
  await page.locator('.private-list').getByRole('button', { name: /Dominika/ }).click();
  await expect(page.locator('.chat-messages')).toContainText('Poufna rozmowa rodziców');
  const channel = `private:${[accounts.parent.uid, accounts.mother.uid].sort().join(':')}`;
  await expect.poll(async () => (await fixtureDatabase().doc(`chatReadStates/${accounts.parent.uid}/channels/${channel}`).get()).data()?.lastMessageId).toBe('parents-private');
  await expect(page.locator('.chat-composer input[type="file"]')).toHaveCount(0);
});

test('child chat stays private and keeps the composer inside five responsive viewports', async ({ page }) => {
  await login(page, accounts.child);
  await page.evaluate(() => { location.hash = encodeURIComponent('Czat'); });
  await expect(page.locator('.chat-messages')).toContainText('Wspólna wiadomość testowa');
  await page.locator('.chat-mode-tabs').getByRole('button', { name: 'Prywatne', exact: true }).click();
  await page.locator('.private-list').getByRole('button', { name: /Sebastian/ }).click();
  await expect(page.locator('.chat-messages')).toContainText('Rozmowa z Nikodemem');
  await expect(page.locator('.chat-messages')).not.toContainText('Poufna rozmowa rodziców');
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.chat-composer')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const composer = document.querySelector('.chat-composer')!.getBoundingClientRect();
      const navigation = document.querySelector('.mobile-navigation');
      const boundary = navigation && getComputedStyle(navigation).display !== 'none' ? navigation.getBoundingClientRect().top : innerHeight;
      return composer.bottom - boundary;
    })).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});
