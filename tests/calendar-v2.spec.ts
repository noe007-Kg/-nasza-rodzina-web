import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

async function login(page: Page, hash: string) {
  await page.goto(`/#${hash}`);
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

function storedEvent(title: string, fields: Record<string, unknown> = {}) {
  return { title, person: 'family', date: Timestamp.fromDate(new Date(`${todayKey()}T12:00:00Z`)), endDate: Timestamp.fromDate(new Date(`${todayKey()}T13:00:00Z`)), allDay: false, description: '', location: '', repeat: 'none', repeatUntil: null, createdBy: accounts.parent.uid, ownerUid: accounts.parent.uid, ...fields };
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.clock.setFixedTime(new Date(`${todayKey()}T10:00:00Z`));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//, route => route.abort('blockedbyclient'));
  await page.route('**/api/eduvulcan/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) }));
  await page.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
  await Promise.all([
    fixtureDatabase().doc('calendarEvents/v2-family').set(storedEvent('Rodzinny termin dnia')),
    fixtureDatabase().doc('privateCalendarEvents/v2-own').set(storedEvent('Sekret wyłącznie Sebastiana', { person: 'Sebastian', private: true })),
    fixtureDatabase().doc('privateCalendarEvents/v2-foreign').set(storedEvent('Sekret wyłącznie Dominiki', { person: 'Dominika', ownerUid: accounts.mother.uid, createdBy: accounts.mother.uid, private: true })),
  ]);
});

test('day and personal view are default; family excludes all private data and navigation preserves profiles', async ({ page }) => {
  await login(page, 'Kalendarz');
  await expect(page.locator('.calendar-day-view')).toBeVisible();
  await expect(page.locator('.person-filters button.active')).toHaveText('Moje wydarzenia');
  await expect(page.locator('.calendar-day-view')).toContainText('Sekret wyłącznie Sebastiana');
  await expect(page.locator('body')).not.toContainText('Sekret wyłącznie Dominiki');
  await page.locator('.person-filters').getByRole('button', { name: 'Cała rodzina', exact: true }).click();
  await expect(page.locator('.calendar-day-view')).toContainText('Rodzinny termin dnia');
  await expect(page.locator('body')).not.toContainText('Sekret wyłącznie Sebastiana');
  await expect(page.locator('[data-menu-page="Rodzina"]')).toHaveCount(0);
  await expect(page.getByTestId('family-profile-bar')).toBeVisible();
});

test('Start opens actual family-today event details and remains compact without page overflow', async ({ page }) => {
  await login(page, 'Start');
  const tile = page.getByTestId('start-card-calendar');
  await expect(tile).toContainText('Rodzinny termin dnia');
  await expect(tile).not.toContainText('Sekret wyłącznie Sebastiana');
  await tile.getByRole('button', { name: 'Szczegóły: Rodzinny termin dnia' }).click();
  await expect(page.getByRole('dialog')).toContainText('Dzisiejsze wydarzenie rodzinne');
  await page.getByRole('button', { name: 'Zamknij', exact: true }).click();
  for (const [width, height] of [[390, 844], [844, 390], [900, 1440], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(tile).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test('important terms display three then expand and manual event form keeps recurrence and importance', async ({ page }) => {
  await Promise.all(Array.from({ length: 4 }, (_, index) => fixtureDatabase().doc(`calendarEvents/v2-important-${index}`).set(storedEvent(`Ważny termin ${index + 1}`, { important: true }))));
  await login(page, 'Kalendarz');
  const panel = page.locator('.calendar-v2-important');
  await expect(panel.locator('.calendar-v2-important-list > button')).toHaveCount(3);
  await panel.getByRole('button', { name: /Pokaż wszystkie/ }).click();
  expect(await panel.locator('.calendar-v2-important-list > button').count()).toBeGreaterThanOrEqual(4);
  await panel.getByRole('button', { name: 'Zwiń listę' }).click();
  await expect(panel.locator('.calendar-v2-important-list > button')).toHaveCount(3);
  await page.getByRole('button', { name: /Dodaj wydarzenie/ }).click();
  await expect(page.getByRole('dialog').getByText('Oznacz jako ważne')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Powtarzanie')).toBeVisible();
});
