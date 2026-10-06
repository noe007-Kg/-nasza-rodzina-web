import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

async function login(page: Page, account: (typeof accounts)[keyof typeof accounts] = accounts.parent) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function openModule(page: Page, name: 'Szkoła' | 'Zakupy') {
  const desktop = page.locator('.sidebar-nav').getByRole('button', { name, exact: true });
  if (await desktop.isVisible()) await desktop.click();
  else {
    await page.getByRole('button', { name: 'Więcej', exact: true }).click();
    await page.locator('.mobile-more').getByRole('button', { name: new RegExp(`${name}$`) }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await fixtureDatabase().doc(`members/${accounts.child.uid}`).update({ schoolEnabled: true });
  await fixtureDatabase().doc(`members/${accounts.sibling.uid}`).update({ schoolEnabled: true });
  await fixtureDatabase().doc(`members/${accounts.inactive.uid}`).update({ active: true, canLogin: true, schoolEnabled: false });
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, (route) => {
    throw new Error(`School/shopping tests attempted production Firebase access: ${route.request().url()}`);
  });
  await page.route('**/api/eduvulcan/status', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }),
  }));
});

test('school roster uses schoolEnabled: Paweł/Nikodem only, profiles at top, historic Layla data retained', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc('schoolItems/historical-layla').set({
    person: 'Layla', type: 'homework', title: 'Historyczny wpis Layli', subject: '', date: todayKey(),
    time: '', endTime: '', weekday: 0, note: '', createdBy: accounts.parent.uid, createdAt: Timestamp.now(),
  });
  await login(page);
  await openModule(page, 'Szkoła');
  const students = page.locator('.school-students');
  await expect(students.getByRole('button', { name: 'Paweł', exact: true })).toBeVisible();
  await expect(students.getByRole('button', { name: 'Nikodem', exact: true })).toBeVisible();
  await expect(students.getByRole('button', { name: 'Layla', exact: true })).toHaveCount(0);
  const first = await page.locator('.school-module').evaluate((module) => module.firstElementChild?.classList.contains('school-students'));
  expect(first).toBe(true);
  await page.getByRole('button', { name: 'Dodaj wpis', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Dziecko').locator('option')).toHaveCount(2);
  await page.getByRole('dialog').getByRole('button', { name: 'Anuluj', exact: true }).click();
  await db.doc(`members/${accounts.sibling.uid}`).update({ schoolEnabled: false });
  await expect(students.getByRole('button', { name: 'Paweł', exact: true })).toHaveCount(0);
  await expect(students.getByRole('button', { name: 'Nikodem', exact: true })).toHaveCount(1);
  expect((await db.doc('schoolItems/historical-layla').get()).exists).toBe(true);
});

test('child school view selects only own enabled profile and never requests parent edu connection', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/eduvulcan/')) requests.push(request.url()); });
  await login(page, accounts.child);
  await openModule(page, 'Szkoła');
  await expect(page.locator('.school-students').getByRole('button')).toHaveCount(1);
  await expect(page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true })).toBeVisible();
  await expect(page.getByTestId('school-stat-messages')).toHaveCount(0);
  await fixtureDatabase().doc(`members/${accounts.child.uid}`).update({ schoolEnabled: false });
  await expect(page.locator('.school-students')).toHaveCount(0);
  await expect(page.locator('.school-student-panel')).toHaveCount(0);
  await expect(page.locator('.school-no-students')).toContainText('Ten profil nie ma włączonego modułu szkolnego.');
  expect(requests).toHaveLength(0);
});

test('quick shopping photo fills square; name is black with white glow and tap adds product', async ({ page }) => {
  await fixtureDatabase().doc('quickProducts/custom-photo-test').set({
    title: 'Zdjęcie produktu E2E', category: 'chemia', imageURL: '/oxy-chusteczki.png', icon: '🧴',
    defaultQuantity: '1', defaultUnit: 'opak.', custom: true, hidden: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const shopping = page.getByRole('button', { name: 'Zakupy', exact: true });
  await shopping.last().click();
  const product = page.locator('[data-product-id="custom-photo-test"]');
  await expect(product).toBeVisible();
  // Safari defers lazy images outside the scrolling product grid's viewport.
  // Bring the actual tile into view before waiting for its image to load.
  await product.scrollIntoViewIfNeeded();
  await expect.poll(() => product.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const geometry = await product.evaluate((tile) => {
    const box = tile.getBoundingClientRect();
    const image = tile.querySelector('img')!;
    const imageBox = image.getBoundingClientRect();
    const titleStyle = getComputedStyle(tile.querySelector('strong')!);
    return { width: box.width, height: box.height, imageWidth: imageBox.width, imageHeight: imageBox.height,
      fit: getComputedStyle(image).objectFit, color: titleStyle.color, shadow: titleStyle.textShadow,
      titleBackground: titleStyle.backgroundColor,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth };
  });
  expect(Math.abs(geometry.width - geometry.height)).toBeLessThanOrEqual(1);
  expect(geometry.imageWidth).toBeGreaterThanOrEqual(geometry.width - 3);
  expect(geometry.imageHeight).toBeGreaterThanOrEqual(geometry.height - 3);
  expect(geometry.fit).toBe('cover');
  expect(geometry.color).toBe('rgb(17, 17, 17)');
  expect(geometry.shadow).toContain('255, 255, 255');
  expect(geometry.titleBackground).toBe('rgba(0, 0, 0, 0)');
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  await product.click();
  await expect(page.locator('.shopping-row').filter({ hasText: 'Zdjęcie produktu E2E' })).toHaveCount(1);
});

test('quick shopping squares never overlap and the visible center belongs to the intended product in five viewport variants', async ({ page }, testInfo) => {
  await login(page);
  await openModule(page, 'Zakupy');
  const product = page.locator('[data-product-id="truskawki"]');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 900, height: 1440 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await product.hover();
    const geometry = await page.locator('.quick-products-grid').evaluate((grid) => {
      const tiles = Array.from(grid.querySelectorAll<HTMLButtonElement>('.quick-product-tile'));
      const boxes = tiles.map((tile) => tile.getBoundingClientRect());
      let overlap = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          overlap = Math.max(overlap, Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].left, boxes[j].left) > 1
            ? Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].top, boxes[j].top) : 0);
        }
      }
      const target = grid.querySelector<HTMLButtonElement>('[data-product-id="truskawki"]')!;
      const box = target.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[data-product-id]');
      return { overlap, squareError: Math.max(...boxes.map((box) => Math.abs(box.width - box.height))),
        target: hit?.getAttribute('data-product-id'),
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth };
    });
    expect(geometry.overlap, `overlapping product targets at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(1);
    expect(geometry.squareError).toBeLessThanOrEqual(1);
    expect(geometry.target).toBe('truskawki');
    expect(geometry.overflow).toBeLessThanOrEqual(1);
  }
  if (testInfo.project.name === 'chromium') {
    await mkdir('preview', { recursive: true });
    await page.screenshot({ path: 'preview/shopping-products.png', fullPage: true });
  }
});

test('quick shopping long press opens existing edit menu without adding the product', async ({ page }) => {
  await login(page);
  await openModule(page, 'Zakupy');
  const product = page.locator('[data-product-id="truskawki"]');
  // Locator hover waits for a stable, visible hit target before measuring it.
  await product.hover();
  const box = await product.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(620);
  await page.mouse.up();
  await expect(page.locator('.quick-product-menu')).toContainText('Truskawki');
  expect((await fixtureDatabase().collection('shoppingItems').where('title', '==', 'Truskawki').get()).size).toBe(0);
  await page.locator('.quick-product-menu').getByRole('button', { name: /Zmień ikonkę/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Truskawki');
});

test('teacher message stars belong to UID, rise to top and do not modify journal messages', async ({ page }) => {
  const db = fixtureDatabase();
  const base = { person: 'Nikodem', type: 'message', subject: '', date: todayKey(), time: '', endTime: '', weekday: 0,
    note: 'Treść tylko dla rodziców', source: 'eduvulcan', createdBy: accounts.mother.uid };
  await db.doc('schoolParentMessages/star-old').set({ ...base, title: 'Starsza ważna informacja', createdAt: Timestamp.fromMillis(Date.now() - 60_000) });
  await db.doc('schoolParentMessages/star-new').set({ ...base, title: 'Najnowsza zwykła informacja', createdAt: Timestamp.now() });
  await login(page);
  await openModule(page, 'Szkoła');
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await page.getByTestId('school-stat-messages').click();
  const entries = page.locator('.school-record-list .school-entry-wrapper');
  await expect(entries.first()).toContainText('Najnowsza zwykła informacja');
  await entries.filter({ hasText: 'Starsza ważna informacja' }).getByRole('button', { name: 'Oznacz jako ważne', exact: true }).click();
  await expect(entries.first()).toContainText('Starsza ważna informacja');
  await expect(entries.first().getByRole('button', { name: 'Usuń z ważnych', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await db.doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.importantItems).toContain('school:message:Nikodem:star-old');
  expect((await db.doc(`userPreferences/${accounts.mother.uid}`).get()).data()?.importantItems || []).not.toContain('school:message:Nikodem:star-old');
  const original = (await db.doc('schoolParentMessages/star-old').get()).data()!;
  expect(original.title).toBe('Starsza ważna informacja');
  expect(original.important).toBeUndefined();
  expect(original.starred).toBeUndefined();
});
