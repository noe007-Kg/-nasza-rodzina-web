import { expect, test, type Page } from '@playwright/test';
import { accounts, fixtureDatabase, password, projectId, seedEmulators } from './emulator-fixtures';
import { OKRUSZEK_PLAN_ID } from '../src/school/okruszek-plan';

async function openSchool(page: Page, account: { email: string } = accounts.parent) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(() => { location.hash = encodeURIComponent('Szkoła'); });
  await expect(page.locator('.school-heading h1')).toHaveText('Szkoła');
}

async function savedPlan() {
  return fixtureDatabase().collection('schoolItems').where('person', '==', 'Paweł').where('schoolPlanId', '==', OKRUSZEK_PLAN_ID).get();
}

async function emulatorToken(account: { email: string }): Promise<string> {
  fixtureDatabase(); // Refuses remote Firebase before creating any authenticated client request.
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password, returnSecureToken: true }),
  });
  expect(response.status).toBe(200);
  const result = await response.json() as { idToken: string };
  expect(typeof result.idToken).toBe('string');
  return result.idToken;
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//, route => route.abort('blockedbyclient'));
  await page.route('**/api/eduvulcan/**', route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).pathname).toBe('/api/eduvulcan/status');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) });
  });
  await page.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
});

test('rodzic zapisuje pięć dni bez duplikatów; ręczna zmiana i dni wolne zostają, Nikodem bez zmian', async ({ page }) => {
  const nikodemBefore = (await fixtureDatabase().doc('schoolItems/nikodem-lesson').get()).data();
  await openSchool(page);
  await page.locator('.school-students').getByRole('button', { name: 'Paweł', exact: true }).click();
  await page.getByTestId('school-source-selector').getByRole('button', { name: /^Okruszek/ }).click();
  const plan = page.getByTestId('okruszek-plan');
  await expect(plan).toContainText('Plan przygotowany — niezapisany');
  await expect(plan.getByTestId('okruszek-day-1').locator('li')).toHaveText(['Rewalidacja', 'Rewalidacja', 'f.os i społ', 'f.os i społ', 'PDP/kuchnia', 'Z.R.Z', 'PDP', 'PDP']);
  await expect(plan.getByTestId('okruszek-day-2').locator('li').first()).toHaveText('-');
  await expect(plan.getByTestId('okruszek-day-1')).toContainText('07:30–15:10');
  await plan.getByRole('button', { name: 'Zapisz plan Okruszka', exact: true }).click();
  await expect(plan).toContainText('Plan zapisany');
  await expect.poll(async () => (await savedPlan()).size).toBe(5);
  const initialIds = (await savedPlan()).docs.map(item => item.id).sort();
  await plan.getByRole('button', { name: 'Edytuj plan', exact: true }).click();
  const monday = plan.getByRole('group', { name: 'Poniedziałek', exact: true });
  await monday.getByLabel('Koniec całego dnia', { exact: true }).fill('15:20');
  await monday.getByRole('textbox', { name: 'Zajęcia — po jednym w wierszu', exact: true }).fill('Rewalidacja\nRewalidacja\nf.os i społ\nf.os i społ\nPDP/kuchnia\nZ.R.Z\nPDP\nPDP — zmiana testowa');
  await plan.getByRole('textbox', { name: 'Dodatkowe dni wolne — daty RRRR-MM-DD, po jednej w wierszu', exact: true }).fill('2026-10-15');
  await plan.getByRole('button', { name: 'Zapisz zmiany planu', exact: true }).click();
  await expect(plan).toContainText('Zapisano zmiany planu.');
  await plan.getByRole('button', { name: 'Zapisz plan Okruszka', exact: true }).click();
  await expect(plan).toContainText('Nie dodano duplikatów i zachowano ręczne poprawki.');
  const after = await savedPlan();
  expect(after.size).toBe(5); expect(after.docs.map(item => item.id).sort()).toEqual(initialIds);
  const mondayRecord = after.docs.find(item => item.data().manualDayPlan.weekday === 1)!;
  const savedMonday = mondayRecord.data();
  expect(savedMonday.endTime).toBe('15:20');
  expect(savedMonday.createdBy).toBe(accounts.parent.uid);
  expect(savedMonday.manualDayPlan.lessons.at(-1)).toBe('PDP — zmiana testowa');
  expect(savedMonday.schoolPlanRevision).toBe(1);
  expect(savedMonday.type).toBe('message'); expect(savedMonday.weekday).toBe(0);
  const pawelToken = await emulatorToken(accounts.sibling);
  const nikodemToken = await emulatorToken(accounts.child);
  const documentUrl = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/schoolItems/${mondayRecord.id}`;
  expect((await fetch(documentUrl, { headers: { Authorization: `Bearer ${pawelToken}` } })).status).toBe(200);
  expect((await fetch(`${documentUrl}?updateMask.fieldPaths=note`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${pawelToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { note: { stringValue: 'Niedozwolona zmiana dziecka' } } }),
  })).status).toBe(403);
  expect((await fetch(documentUrl, { headers: { Authorization: `Bearer ${nikodemToken}` } })).status).toBe(403);
  await plan.getByLabel('Sprawdź dzień', { exact: true }).fill('2026-10-14');
  await expect(plan.getByTestId('okruszek-date-status')).toContainText('Dzień wolny');
  await expect(plan.getByTestId('okruszek-date-status')).not.toContainText('Cały dzień:');
  await plan.getByLabel('Sprawdź dzień', { exact: true }).fill('2026-10-15');
  await expect(plan.getByTestId('okruszek-date-status')).toContainText('Dodatkowy dzień wolny');
  await plan.getByLabel('Sprawdź dzień', { exact: true }).fill('2027-06-25');
  await expect(plan.getByTestId('okruszek-date-status')).toContainText('Status niepotwierdzony');
  await expect(plan.getByTestId('okruszek-date-status')).not.toContainText('Cały dzień:');
  expect((await fixtureDatabase().doc('schoolItems/nikodem-lesson').get()).data()).toEqual(nikodemBefore);
  for (const [width, height] of [[390, 844], [844, 390], [900, 1440], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(plan.getByTestId('okruszek-day-5')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test('Paweł widzi plan bez przycisków zarządzania, Nikodem zachowuje własną szkołę bez Okruszka', async ({ page }) => {
  await openSchool(page, accounts.sibling);
  await page.getByTestId('school-source-selector').getByRole('button', { name: /^Okruszek/ }).click();
  const plan = page.getByTestId('okruszek-plan');
  await expect(plan.getByTestId('okruszek-day-3')).toContainText('08:50–16:30');
  await expect(plan.getByRole('button', { name: /Zapisz plan|Edytuj plan/ })).toHaveCount(0);
  expect((await savedPlan()).size).toBe(0);
  const otherContext = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:5173', timezoneId: 'Europe/Warsaw', locale: 'pl-PL' });
  try {
    const childPage = await otherContext.newPage();
    await childPage.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await childPage.route('**/api/eduvulcan/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) }));
    await childPage.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
    await childPage.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//, route => route.abort('blockedbyclient'));
    await openSchool(childPage, accounts.child);
    await expect(childPage.getByTestId('school-source-selector').getByRole('button', { name: /^Okruszek/ })).toHaveCount(0);
    await expect(childPage.getByTestId('okruszek-plan')).toHaveCount(0);
    await expect(childPage.getByTestId('school-stat-today')).toBeVisible();
  } finally { await otherContext.close(); }
});
