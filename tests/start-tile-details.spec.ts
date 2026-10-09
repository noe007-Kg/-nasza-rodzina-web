import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';

async function login(page: Page, account = accounts.parent as (typeof accounts)[keyof typeof accounts]) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByTestId('start-dashboard')).toBeVisible();
  await expect(page.locator('.start-dashboard-grid')).toHaveAttribute('data-layout-ready', 'true');
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 14, weather_code: 1, wind_speed_10m: 9 }, daily: { temperature_2m_max: [17], temperature_2m_min: [11] } }) }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, route => { throw new Error('A Start tile test attempted production Firebase access'); });
});

for (const viewport of [
  { width: 390, height: 844, compact: true }, { width: 844, height: 390, compact: true },
  { width: 900, height: 1440, compact: false }, { width: 1024, height: 768, compact: false },
  { width: 1440, height: 900, compact: false },
]) {
  test(`Start details: mobile header, unchanged four tiles and no page overflow at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await login(page);
    const header = page.getByTestId('start-mobile-header');
    const banner = page.getByTestId('start-merged-banner');
    if (viewport.compact) {
      await expect(header).toBeVisible();
      await expect(header).toContainText('Cześć, Sebastian!');
      await expect(header).toContainText('14°C');
      await expect(header).toContainText('9 km/h');
      const height = (await banner.boundingBox())!.height;
      expect(height).toBeGreaterThanOrEqual(35);
      expect(height).toBeLessThanOrEqual(45);
      await expect(page.locator('.start-welcome-copy')).not.toBeVisible();
    } else {
      await expect(header).not.toBeVisible();
      await expect(page.locator('.start-welcome-copy')).toBeVisible();
      expect((await banner.boundingBox())!.height).toBeGreaterThanOrEqual(108);
    }
    for (const id of ['calendar', 'tasks', 'health', 'school']) {
      const card = page.getByTestId(`start-card-${id}`);
      await expect(card.locator('.start-card-value')).toBeVisible();
      await expect(card.locator('.start-custom-content')).toHaveCount(0);
    }
    await expect(page.locator('.start-dashboard-grid > .start-dashboard-card')).toHaveCount(7);
    expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - window.innerWidth)).toBeLessThanOrEqual(1);
  });
}

test('Rodzinny czas: dynamic profiles include members without login and exclude archived profiles', async ({ page }) => {
  const db = fixtureDatabase();
  await Promise.all([
    db.doc('members/passive-sixth').set({ name: 'Nowy członek', personKey: `member-${'6'.repeat(24)}`, role: 'child', active: true, canLogin: false, schoolEnabled: false, emoji: '👶' }),
    db.doc('members/passive-seventh').set({ name: 'Kolejny członek', personKey: `member-${'7'.repeat(24)}`, role: 'child', active: true, canLogin: false, schoolEnabled: false }),
    db.doc('members/archived-profile').set({ name: 'Archiwalny profil', personKey: `member-${'8'.repeat(24)}`, role: 'child', active: false, archived: true, canLogin: false }),
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const profiles = page.getByTestId('start-family-time-profiles');
  await expect(profiles.locator('[data-profile-id]')).toHaveCount(7);
  await expect(profiles).toContainText('Nowy członek');
  await expect(profiles).toContainText('Kolejny członek');
  await expect(profiles).not.toContainText('Archiwalny profil');
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - window.innerWidth)).toBeLessThanOrEqual(1);
  await db.doc('members/passive-sixth').update({ active: false, archived: true });
  await expect(profiles.locator('[data-profile-id]')).toHaveCount(6);
});

test('Zakupy: actual quantities, matching custom product image and purchase progress', async ({ page }) => {
  const db = fixtureDatabase(); const createdAt = Timestamp.now();
  await Promise.all([
    db.doc('shoppingItems/bananas').set({ title: 'Banany', category: 'owoce', quantity: '', unit: '', done: false, createdAt }),
    db.doc('shoppingItems/milk').set({ title: 'Mleko', category: 'nabial', quantity: '2', unit: 'l', done: false, createdAt }),
    db.doc('shoppingItems/bread').set({ title: 'Chleb', category: 'pieczywo', quantity: '1', unit: 'szt.', done: false, createdAt }),
    db.doc('shoppingItems/bought').set({ title: 'Kupiony produkt testowy', category: 'inne', quantity: '5', unit: 'szt.', done: true, createdAt }),
    db.doc('quickProducts/mleko').set({ title: 'Mleko', category: 'nabial', imageURL: '/wojanek-napoj.png', defaultQuantity: '1', defaultUnit: 'szt.' }),
  ]);
  await login(page);
  const tile = page.getByTestId('start-card-shopping');
  await expect(tile.locator('.start-card-value')).toHaveText('3');
  await expect(tile).toContainText('2 l');
  await expect(tile).toContainText('1 / 4');
  await expect(tile).not.toContainText('Kupiony produkt testowy');
  await expect(tile).not.toContainText('Prawie brak');
  await expect(tile.locator('[data-product-id="milk"] img')).toHaveAttribute('src', '/wojanek-napoj.png');
  await expect(tile.locator('[data-product-id="bananas"]')).not.toContainText('1 szt.');
  await tile.click();
  await expect(page.locator('.page-header h1')).toHaveText('Zakupy');
});

test('Czat: private counterpart stays correct for outgoing messages; only real unread notifications create badges', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc('familyMessages/parents-private').update({ uid: accounts.parent.uid, name: accounts.parent.name, text: 'Moja wiadomość do Dominiki', createdAt: Timestamp.now() });
  await db.doc(`notificationInbox/${accounts.parent.uid}/items/chat-unread`).set({ eventId: 'chat:family:family-message', title: 'Nowa wiadomość', body: 'Otwórz czat', category: 'familyChat', module: 'Czat', read: false, starred: false, important: false, recordId: 'family-message', createdAt: Timestamp.now() });
  await login(page);
  const tile = page.getByTestId('start-card-chat');
  const privateRow = tile.locator('.start-chat-row').filter({ hasText: 'Moja wiadomość do Dominiki' });
  await expect(privateRow.locator('strong')).toHaveText('Dominika');
  await expect(tile.getByLabel('1 nieprzeczytanych powiadomień z czatu', { exact: true })).toBeVisible();
  await expect(tile.locator('.start-chat-row')).toHaveCount(3);
  await db.doc(`notificationInbox/${accounts.parent.uid}/items/chat-unread`).update({ read: true });
  await expect(tile.locator('.start-chat-unread')).toHaveCount(0);
  await tile.click();
  await expect(page.locator('.page-header h1')).toHaveText('Czat');
});

test('Rodzinny czas: missing plan never fabricates availability or school hours', async ({ page }) => {
  await Promise.all([
    fixtureDatabase().doc('schoolItems/nikodem-lesson').delete(),
    fixtureDatabase().doc('schoolItems/pawel-lesson').delete(),
  ]);
  await login(page, accounts.child);
  const tile = page.getByTestId('start-card-family-time');
  await expect(tile.locator('.start-card-value')).toHaveText('—');
  await expect(tile).toContainText('Niepełny plan — tylko dostępne godziny');
  await expect(tile).not.toContainText('08:45');
  await expect(tile.locator('.start-family-countdown')).toHaveCount(0);
});
