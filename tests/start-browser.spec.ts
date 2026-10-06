import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

const initialOrder = ['family-time', 'calendar', 'tasks', 'shopping', 'chat', 'health', 'school'];
const variants = [
  { width: 1440, height: 900, slug: 'desktop' },
  { width: 900, height: 1440, slug: 'tablet-portrait' },
  { width: 1024, height: 768, slug: 'tablet-landscape' },
  { width: 390, height: 844, slug: 'phone-portrait' },
  { width: 844, height: 390, slug: 'phone-landscape' },
];

async function login(page: Page, account = accounts.parent as (typeof accounts)[keyof typeof accounts]) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByTestId('start-dashboard')).toBeVisible();
  await expect(page.locator('.start-dashboard-grid')).toHaveAttribute('data-layout-ready', 'true');
  await expect(page.getByTestId('start-card-tasks').locator('.start-card-value')).toHaveText('2');
}

async function logout(page: Page) {
  const settings = page.locator('.sidebar-nav').getByRole('button', { name: 'Ustawienia', exact: true });
  if (await settings.isVisible()) await settings.click();
  else { await page.getByRole('button', { name: 'Więcej', exact: true }).click(); await page.locator('.mobile-more').getByRole('button', { name: /Ustawienia$/ }).click(); }
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
}

async function cardOrder(page: Page) { return page.locator('.start-dashboard-grid > .start-dashboard-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-card-id'))); }
async function cardBoxes(page: Page) { return page.locator('.start-dashboard-grid > .start-dashboard-card').evaluateAll(cards => cards.map(card => { const rect = card.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })); }

// Measure inside the page: WebKit protocol round trips can exceed the entire
// 550 ms hold, so a runner-side wait does not describe the gesture duration.
async function observeDragActivation(page: Page) {
  await page.evaluate(() => {
    const timing = { startedAt: 0, activatedAfter: null as number | null, visibleDuringShortHold: null as boolean | null };
    (window as Window & { startDragTiming?: typeof timing }).startDragTiming = timing;
    const start = () => {
      if (timing.startedAt) return;
      timing.startedAt = performance.now();
      window.setTimeout(() => { timing.visibleDuringShortHold = !!document.querySelector('[data-testid="start-drag-overlay"]'); }, 250);
    };
    document.addEventListener('mousedown', start, { capture: true, once: true });
    document.addEventListener('touchstart', start, { capture: true, once: true });
    const observer = new MutationObserver(() => {
      if (!timing.startedAt || !document.querySelector('[data-testid="start-drag-overlay"]')) return;
      timing.activatedAfter = performance.now() - timing.startedAt;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function expectDelayedOverlay(page: Page) {
  await expect(page.getByTestId('start-drag-overlay')).toBeVisible();
  const timing = await page.evaluate(() => (window as Window & { startDragTiming?: { activatedAfter: number | null; visibleDuringShortHold: boolean | null } }).startDragTiming);
  expect(timing?.visibleDuringShortHold).toBe(false);
  expect(timing?.activatedAfter).toBeGreaterThanOrEqual(540);
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 19, weather_code: 1, wind_speed_10m: 8 }, daily: { temperature_2m_max: [22], temperature_2m_min: [12] } }) }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, route => { throw new Error(`Start test attempted remote Firebase: ${route.request().url()}`); });
});

for (const variant of variants) {
  test(`Start: sticky profile bar, compact banner and real tiles at ${variant.width}×${variant.height}`, async ({ page, browserName }) => {
    await page.setViewportSize(variant);
    await login(page);
    const bar = page.getByTestId('family-profile-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('family-profile')).toHaveCount(5);
    await expect(bar.getByTestId('family-profile').first()).toContainText('Sebastian');
    await expect(page.getByTestId('start-dashboard').getByTestId('family-profile')).toHaveCount(0);
    await expect(page.locator('.family-quick-strip, .today-people-grid, .family-free-banner')).toHaveCount(0);
    await expect(page.getByTestId('start-card-family-time')).toContainText('Rodzinny czas');
    await expect(page.locator('.start-dashboard-grid > .start-dashboard-card')).toHaveCount(7);
    await expect(page.getByTestId('start-merged-banner')).toContainText('Cześć, Sebastian!');
    await expect(page.getByTestId('start-merged-banner')).toContainText('Kołobrzeg');
    await expect(page.getByTestId('start-merged-banner')).toContainText('19°C');
    expect((await page.getByTestId('start-merged-banner').boundingBox())!.height).toBeLessThanOrEqual(195);
    await expect(page.getByTestId('start-card-chat')).toContainText('Wspólna wiadomość testowa');
    await expect(page.getByTestId('start-card-school')).toContainText('Przyroda Nikodema');
    expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - window.innerWidth)).toBeLessThanOrEqual(1);
    const before = (await bar.boundingBox())!.y;
    await page.evaluate(() => { const space = document.createElement('div'); space.id = 'sticky-test-spacer'; space.style.height = '1500px'; document.body.append(space); window.scrollTo(0, 450); });
    await expect.poll(async () => (await bar.boundingBox())!.y).toBeLessThanOrEqual(before + 1);
    await page.evaluate(() => { document.getElementById('sticky-test-spacer')?.remove(); window.scrollTo(0, 0); });
    // Capture the actual screen dimensions; a full-page phone image otherwise
    // places its fixed bottom navigation halfway through a tall screenshot.
    if (browserName === 'chromium') { await mkdir('preview', { recursive: true }); await page.screenshot({ path: `preview/start-${variant.slug}.png`, fullPage: false }); }
  });
}

test('Start: active account is first for Dominika and Nikodem; child previews exclude other private data', async ({ page }) => {
  await login(page, accounts.mother);
  await expect(page.getByTestId('family-profile-bar').getByTestId('family-profile').first()).toContainText('Dominika');
  await logout(page);
  await login(page, accounts.child);
  await expect(page.getByTestId('family-profile-bar').getByTestId('family-profile').first()).toContainText('Nikodem');
  await expect(page.getByTestId('start-card-school').locator('.start-card-value')).toHaveText('1');
  await expect(page.getByTestId('start-card-chat')).not.toContainText('Poufna rozmowa rodziców');
  await expect(page.getByTestId('start-card-health')).not.toContainText('Kontrola Pawła');
});

test('Start: long press activates overlay, source positions stay fixed, drop alone saves the UID order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const beforeBoxes = await cardBoxes(page);
  const source = await page.getByTestId('start-card-family-time').boundingBox();
  const target = await page.getByTestId('start-card-tasks').boundingBox();
  const sourceX = source!.x + source!.width / 2, sourceY = source!.y + source!.height / 2;
  const targetX = target!.x + target!.width / 2, targetY = target!.y + target!.height / 2;
  await observeDragActivation(page);
  await page.mouse.move(sourceX, sourceY); await page.mouse.down();
  await expectDelayedOverlay(page);
  await page.mouse.move(targetX, targetY, { steps: 6 });
  expect(await cardOrder(page)).toEqual(initialOrder);
  expect(await cardBoxes(page)).toEqual(beforeBoxes);
  const moving = (await page.getByTestId('start-drag-overlay').boundingBox())!;
  expect(Math.abs(moving.x + moving.width / 2 - targetX)).toBeLessThanOrEqual(4);
  expect(Math.abs(moving.y + moving.height / 2 - targetY)).toBeLessThanOrEqual(4);
  expect((await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.dashboardOrder).toBeUndefined();
  await page.mouse.up();
  const expected = ['calendar', 'tasks', 'family-time', 'shopping', 'chat', 'health', 'school'];
  await expect.poll(() => cardOrder(page)).toEqual(expected);
  await expect.poll(async () => (await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.dashboardOrder).toEqual(expected);
  await expect(page.getByTestId('start-dashboard')).toBeVisible();
  await page.reload(); await expect(page.locator('.start-dashboard-grid')).toHaveAttribute('data-layout-ready', 'true');
  expect(await cardOrder(page)).toEqual(expected);
  await logout(page); await login(page, accounts.mother);
  expect(await cardOrder(page)).toEqual(initialOrder);
  expect((await fixtureDatabase().doc(`userPreferences/${accounts.mother.uid}`).get()).data()?.dashboardOrder).toBeUndefined();
});

test('Start: touch long press uses the overlay and ordinary tap still opens a module', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  const source = (await page.getByTestId('start-card-family-time').boundingBox())!;
  const destination = (await page.getByTestId('start-card-calendar').boundingBox())!;
  const point = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  async function touch(type: string, x: number, y: number) {
    const finger = { identifier: 1, clientX: x, clientY: y, screenX: x, screenY: y };
    // dispatchEvent builds a TouchEvent / TouchList for each browser. A plain
    // Event with added touches is not recognized by dnd-kit's coordinate reader.
    await page.getByTestId('start-card-family-time').dispatchEvent(type, {
      touches: type === 'touchend' ? [] : [finger],
      changedTouches: [finger],
      targetTouches: type === 'touchend' ? [] : [finger],
    });
  }
  await observeDragActivation(page);
  await touch('touchstart', point.x, point.y);
  await expectDelayedOverlay(page);
  const targetX = destination.x + destination.width / 2, targetY = destination.y + destination.height / 2;
  const beforeBoxes = await cardBoxes(page);
  await touch('touchmove', targetX, targetY);
  await expect.poll(async () => {
    const overlay = (await page.getByTestId('start-drag-overlay').boundingBox())!;
    return Math.max(Math.abs(overlay.x + overlay.width / 2 - targetX), Math.abs(overlay.y + overlay.height / 2 - targetY));
  }).toBeLessThanOrEqual(4);
  expect(await cardOrder(page)).toEqual(initialOrder);
  expect(await cardBoxes(page)).toEqual(beforeBoxes);
  expect((await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.dashboardOrder).toBeUndefined();
  await touch('touchend', targetX, targetY);
  await expect.poll(() => cardOrder(page)).toEqual(['calendar', 'family-time', 'tasks', 'shopping', 'chat', 'health', 'school']);
  await expect.poll(async () => (await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.dashboardOrder).toEqual(['calendar', 'family-time', 'tasks', 'shopping', 'chat', 'health', 'school']);
  await page.waitForTimeout(300); await page.getByTestId('start-card-tasks').click();
  await expect(page.locator('.page-header h1')).toHaveText('Zadania');
});

test('Start: movement beyond the hold tolerance cancels dragging without saving an order', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  // Perform this short gesture in one browser task; runner-side round trips
  // otherwise risk moving only after the 550 ms activation on a busy WebKit.
  const activated = await page.getByTestId('start-card-family-time').evaluate(async tile => {
    const rect = tile.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    let overlaySeen = false;
    const observer = new MutationObserver(() => { if (document.querySelector('[data-testid="start-drag-overlay"]')) overlaySeen = true; });
    observer.observe(document.body, { childList: true, subtree: true });
    tile.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x + 9, clientY: y }));
    await new Promise(resolve => window.setTimeout(resolve, 650));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: x + 9, clientY: y }));
    observer.disconnect();
    return overlaySeen;
  });
  expect(activated).toBe(false);
  expect(await cardOrder(page)).toEqual(initialOrder);
  expect((await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.dashboardOrder).toBeUndefined();
  await page.getByTestId('start-card-calendar').click();
  await expect(page.locator('.page-header h1')).toHaveText('Kalendarz');
});

test('Start: calendar preview includes own private event but never another UID private event', async ({ page }) => {
  const db = fixtureDatabase();
  const date = new Date(`${todayKey()}T23:00:00+02:00`);
  const base = { person: 'family', date: Timestamp.fromDate(date), endDate: Timestamp.fromDate(new Date(date.getTime() + 30 * 60_000)), allDay: false, description: '', repeat: 'none', repeatUntil: null, createdAt: Timestamp.now() };
  await db.doc('privateCalendarEvents/start-own-private').set({ ...base, title: 'Moje prywatne wydarzenie', createdBy: accounts.parent.uid, ownerUid: accounts.parent.uid, private: true });
  await db.doc('privateCalendarEvents/start-other-private').set({ ...base, title: 'Prywatne wydarzenie Dominiki', createdBy: accounts.mother.uid, ownerUid: accounts.mother.uid, private: true });
  await login(page);
  await expect(page.getByTestId('start-card-calendar')).toContainText('Moje prywatne wydarzenie');
  await expect(page.getByTestId('start-card-calendar')).not.toContainText('Prywatne wydarzenie Dominiki');
});
