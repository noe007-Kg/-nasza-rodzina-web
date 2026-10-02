import { expect, test, type Page } from '@playwright/test';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

async function loginSchool(page: Page) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Szkoła', exact: true }).click();
  await expect(page.locator('.school-heading')).toContainText('Szkoła');
  await expect(page.locator('.school-loading')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, (route) => {
    throw new Error(`School tests attempted production Firebase access: ${route.request().url()}`);
  });
});

test('szkoła: import wymaga zatwierdzenia, pomija powtórzenia i zachowuje ręczną edycję', async ({ page }) => {
  const row = { person: 'Nikodem', type: 'homework', title: 'Importowane zadanie E2E', subject: 'Matematyka', date: todayKey(), time: '', endTime: '', weekday: 0, note: 'Własna notatka' };
  const payload = { name: 'zadania.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([row, row])) };
  await loginSchool(page);
  await page.getByRole('button', { name: 'Importuj plik', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const originalCount = (await fixtureDatabase().collection('schoolItems').get()).size;
  await dialog.getByLabel('Wybierz przygotowany plik').setInputFiles({
    name: 'nieprawidlowy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([row, { ...row, date: '2026-02-30' }])),
  });
  await expect(dialog.getByRole('alert')).toContainText('Wpis 2');
  await expect(dialog.getByRole('button', { name: 'Importuj', exact: true })).toBeDisabled();
  expect((await fixtureDatabase().collection('schoolItems').get()).size).toBe(originalCount);
  await dialog.getByLabel('Wybierz przygotowany plik').setInputFiles(payload);
  await expect(dialog.locator('.school-import-preview tbody tr')).toHaveCount(2);
  expect((await fixtureDatabase().collection('schoolItems').get()).size).toBe(originalCount);
  await dialog.getByRole('button', { name: 'Importuj (2)', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.school-notice')).toContainText('dodano 1 wpisów, pominięto 1 powtórzeń');
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await page.locator('.school-record-list .school-entry').filter({ hasText: 'Importowane zadanie E2E' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edytuj wpis', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Nazwa wpisu *', { exact: true }).fill('Zadanie po ręcznej poprawce E2E');
  await page.getByRole('dialog').getByLabel('Notatka / sala / treść wiadomości').fill('Ręczna poprawka zachowana');
  await page.getByRole('dialog').getByRole('button', { name: 'Zapisz wpis', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Importuj plik', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Wybierz przygotowany plik').setInputFiles(payload);
  await page.getByRole('dialog').getByRole('button', { name: 'Importuj (2)', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.school-notice')).toContainText('dodano 0 wpisów, pominięto 2 powtórzeń');
  expect((await fixtureDatabase().collection('schoolItems').get()).size).toBe(originalCount + 1);
  const imported = await fixtureDatabase().collection('schoolItems').where('title', '==', 'Zadanie po ręcznej poprawce E2E').get();
  expect(imported.size).toBe(1);
  expect(imported.docs[0].id).toMatch(/^import_[a-f0-9]{64}$/);
  expect(imported.docs[0].data().note).toBe('Ręczna poprawka zachowana');
});

test('szkoła: datowane zajęcia mają połączony kalendarz bez prywatnych notatek i usuwają się razem', async ({ page }) => {
  await loginSchool(page);
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await page.getByRole('button', { name: /Dodaj wpis/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Rodzaj wpisu', { exact: true }).selectOption('activity');
  await dialog.getByLabel('Nazwa wpisu *', { exact: true }).fill('Fortepian powiązany E2E');
  await dialog.getByLabel('Termin zajęć', { exact: true }).selectOption('date');
  await dialog.getByLabel('Data *', { exact: true }).fill(todayKey());
  await dialog.getByLabel('Od *', { exact: true }).fill('17:00');
  await dialog.getByLabel('Do *', { exact: true }).fill('18:00');
  await dialog.getByLabel('Notatka / sala / treść wiadomości').fill('Prywatna notatka szkolna E2E');
  await dialog.getByLabel('Pokaż zajęcia także w rodzinnym kalendarzu').check();
  await dialog.getByRole('button', { name: 'Zapisz wpis', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const db = fixtureDatabase();
  const entries = await db.collection('schoolItems').where('title', '==', 'Fortepian powiązany E2E').get();
  expect(entries.size).toBe(1);
  const schoolEntry = entries.docs[0];
  const data = schoolEntry.data();
  expect(data.note).toBe('Prywatna notatka szkolna E2E');
  expect(data.calendarCreatedBy).toBe(accounts.parent.uid);
  const calendar = await db.doc(`calendarEvents/${data.calendarEventId}`).get();
  expect(calendar.exists).toBe(true);
  expect(calendar.data()?.description).toBe('');
  expect(calendar.data()?.repeat).toBe('none');
  expect(JSON.stringify(calendar.data())).not.toContain('Prywatna notatka szkolna E2E');
  await page.locator('.school-record-list .school-entry').filter({ hasText: 'Fortepian powiązany E2E' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('połączony wpis');
  await page.getByRole('dialog').getByRole('button', { name: 'Usuń wpis', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await schoolEntry.ref.get()).exists).toBe(false);
  expect((await calendar.ref.get()).exists).toBe(false);
});
