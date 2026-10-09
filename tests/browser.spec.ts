import { expect, test, type Page } from '@playwright/test';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

type Account = (typeof accounts)[keyof typeof accounts];
type Module = 'Start' | 'Kalendarz' | 'Zadania' | 'Zakupy' | 'Czat' | 'Zdrowie' | 'Szkoła' | 'Rodzina' | 'Ustawienia';

async function login(page: Page, account: Account = accounts.parent) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  const welcome = page.getByTestId('start-merged-banner');
  await expect(welcome.getByRole('heading', { name: /^Cześć,/ })).toBeVisible();
  await expect(welcome).toContainText(account.name);
}

async function goTo(page: Page, module: Module) {
  const desktopButton = page.locator('.sidebar-nav').getByRole('button', { name: module, exact: true });
  if (await desktopButton.isVisible()) await desktopButton.click();
  else {
    const mobileButton = page.locator('.mobile-navigation').getByRole('button', { name: module, exact: true });
    if (await mobileButton.isVisible()) await mobileButton.click();
    else {
      await page.getByRole('button', { name: 'Więcej', exact: true }).click();
      await page.locator('.mobile-more').getByRole('button', { name: new RegExp(`${module}$`) }).click();
    }
  }
  if (module === 'Szkoła') await expect(page.locator('.school-heading h1')).toContainText('Szkoła');
  else if (module !== 'Start') await expect(page.locator('.page-header h1')).toHaveText(module);
}

async function logout(page: Page) {
  await goTo(page, 'Ustawienia');
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
}

function modal(page: Page) { return page.locator('.modal-card'); }
function taskRow(page: Page, title: string) { return page.locator('.task-row').filter({ hasText: title }); }
function shoppingRow(page: Page, title: string) { return page.locator('.shopping-row').filter({ hasText: title }); }

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  // Only the external weather response is stubbed. All app data goes through real emulator SDKs/rules.
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      current: { temperature_2m: 19, weather_code: 1, wind_speed_10m: 8 },
      daily: { temperature_2m_max: [22], temperature_2m_min: [12] },
    }),
  }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, (route) => {
    throw new Error(`A browser test attempted production Firebase access: ${route.request().url()}`);
  });
});

test('logowanie, błędne hasło i wylogowanie', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.login-error')).toBeVisible();
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await goTo(page, 'Ustawienia');
  await expect(page.getByRole('heading', { name: 'Konto i logowanie', exact: true })).toBeVisible();
  await logout(page);
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
});

test('konto bez aktywnego dostępu rodzinnego nie otwiera danych', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.inactive.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.access-card')).toBeVisible();
  await expect(page.locator('.start-dashboard-page')).toHaveCount(0);
});

test('kalendarz: zapis, edycja, ponowne wczytanie i usunięcie wydarzenia', async ({ page }) => {
  await login(page);
  await goTo(page, 'Kalendarz');
  await page.getByRole('button', { name: /Dodaj wydarzenie/ }).click();
  await modal(page).getByLabel('Nazwa wydarzenia').fill('Basen — test E2E');
  await modal(page).getByLabel('Osoba', { exact: true }).selectOption('Nikodem');
  await modal(page).getByLabel('Data', { exact: true }).fill(todayKey());
  await modal(page).getByLabel('Od', { exact: true }).fill('10:00');
  await modal(page).getByLabel('Do', { exact: true }).fill('11:00');
  await modal(page).getByRole('button', { name: /Zapisz wydarzenie/ }).click();
  await expect(modal(page)).toHaveCount(0);
  await page.locator('.calendar-event').filter({ hasText: 'Basen — test E2E' }).first().click();
  await modal(page).getByRole('button', { name: /Edytuj/ }).click();
  await modal(page).getByLabel('Nazwa wydarzenia').fill('Basen — zmieniony');
  await modal(page).getByRole('button', { name: /Zapisz zmiany/ }).click();
  await expect(modal(page).getByRole('heading', { name: 'Basen — zmieniony' })).toBeVisible();
  await modal(page).getByRole('button', { name: 'Zamknij', exact: true }).click();
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await goTo(page, 'Kalendarz');
  await page.locator('.calendar-event').filter({ hasText: 'Basen — zmieniony' }).first().click();
  page.once('dialog', (dialog) => dialog.accept());
  await modal(page).getByRole('button', { name: /Usuń/ }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator('.calendar-event').filter({ hasText: 'Basen — zmieniony' })).toHaveCount(0);
  await expect.poll(async () => (await fixtureDatabase().collection('calendarEvents').where('title', '==', 'Basen — zmieniony').get()).empty).toBe(true);
});

test('widok dnia pokazuje wydarzenia przed godziną szóstą i stare serie codzienne', async ({ page }) => {
  const db = fixtureDatabase();
  const { Timestamp } = await import('firebase-admin/firestore');
  await db.doc('calendarEvents/early-recurring').set({
    title: 'Wczesne wydarzenie cykliczne', person: 'family',
    date: Timestamp.fromDate(new Date('2010-01-01T01:00:00+01:00')),
    endDate: Timestamp.fromDate(new Date('2010-01-01T02:00:00+01:00')),
    allDay: false, description: '', repeat: 'daily', repeatUntil: null,
    createdBy: accounts.parent.uid, createdAt: Timestamp.now(),
  });
  await login(page);
  await goTo(page, 'Kalendarz');
  await page.getByRole('button', { name: 'Dzień', exact: true }).click();
  await expect(page.locator('.calendar-day-view .calendar-event').filter({ hasText: 'Wczesne wydarzenie cykliczne' })).toBeVisible();
});

test('zadanie: dziecko zgłasza wykonanie, rodzic zatwierdza i punkty są trwałe', async ({ page }) => {
  await login(page, accounts.child);
  await goTo(page, 'Zadania');
  const childTask = taskRow(page, 'Wynieść śmieci — test zatwierdzania');
  await expect(childTask).toBeVisible();
  await expect(childTask.locator('.icon-button, .icon-danger')).toHaveCount(0);
  await childTask.locator('.check-button').click();
  await expect(childTask).toHaveClass(/pending/);
  expect((await fixtureDatabase().doc('tasks/child-approval').get()).data()?.done).toBe(false);

  await logout(page);
  await login(page);
  await goTo(page, 'Zadania');
  await taskRow(page, 'Wynieść śmieci — test zatwierdzania').getByRole('button', { name: /Zatwierdź/ }).click();
  await expect(taskRow(page, 'Wynieść śmieci — test zatwierdzania')).toHaveClass(/done/);
  const persisted = (await fixtureDatabase().doc('tasks/child-approval').get()).data();
  expect(persisted?.approvalStatus).toBe('approved');
  expect(persisted?.points).toBe(10);
  await expect(page.locator('.points-panel').getByText('10 pkt', { exact: true })).toBeVisible();
});

test('zadanie cykliczne zachowuje wykonanie i tworzy następny termin', async ({ page }) => {
  await login(page);
  await goTo(page, 'Zadania');
  await page.getByRole('button', { name: /Dodaj zadanie/ }).click();
  await modal(page).getByLabel('Zadanie', { exact: true }).fill('Odkurzanie miesięczne E2E');
  await modal(page).getByLabel('Osoba', { exact: true }).selectOption('Nikodem');
  await modal(page).getByLabel('Termin', { exact: true }).fill('2026-01-31');
  await modal(page).getByLabel('Powtarzanie', { exact: true }).selectOption('monthly');
  await modal(page).getByRole('button', { name: /Zapisz$/ }).click();
  await expect(modal(page)).toHaveCount(0);
  await taskRow(page, 'Odkurzanie miesięczne E2E').locator('.check-button').click();
  await expect.poll(async () => {
    const docs = await fixtureDatabase().collection('tasks').where('title', '==', 'Odkurzanie miesięczne E2E').get();
    return docs.docs.map((doc) => doc.data()).filter((item) => !item.done).map((item) => item.dueDate);
  }).toEqual(['2026-02-28']);
  const docs = await fixtureDatabase().collection('tasks').where('title', '==', 'Odkurzanie miesięczne E2E').get();
  expect(docs.docs.filter((doc) => doc.data().done)).toHaveLength(1);
});

test('zakupy: dodanie, szybka notatka, kupione i usunięcie po potwierdzeniu', async ({ page }) => {
  await login(page);
  await goTo(page, 'Zakupy');
  await page.locator('.shopping-product').fill('Mleko testowe');
  await page.locator('.shopping-quantity').fill('2');
  await page.locator('.shopping-bar').getByRole('button', { name: /Dodaj/ }).click();
  await expect(shoppingRow(page, 'Mleko testowe')).toContainText('2 szt.');
  await page.locator('.quick-note-card textarea').fill('Chleb testowy, Jabłka testowe');
  await page.getByRole('button', { name: /Dodaj wszystkie/ }).click();
  await expect(shoppingRow(page, 'Chleb testowy')).toBeVisible();
  await expect(shoppingRow(page, 'Jabłka testowe')).toBeVisible();
  await shoppingRow(page, 'Mleko testowe').locator('.check-button').click();
  await expect(shoppingRow(page, 'Mleko testowe')).toHaveClass(/done/);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /Usuń kupione/ }).click();
  await expect(shoppingRow(page, 'Mleko testowe')).toHaveCount(0);
  await expect(shoppingRow(page, 'Chleb testowy')).toBeVisible();
});

test('czat rodzinny i prywatny: wysłanie, zapis i izolacja kanałów', async ({ page }) => {
  await login(page, accounts.child);
  await goTo(page, 'Czat');
  await expect(page.locator('.chat-messages')).toContainText('Wspólna wiadomość testowa');
  await expect(page.locator('.chat-messages')).not.toContainText('Poufna rozmowa rodziców');
  await page.locator('.chat-compose input').fill('Rodzinne pozdrowienia E2E');
  await page.getByRole('button', { name: 'Wyślij', exact: true }).click();
  await expect(page.locator('.chat-messages')).toContainText('Rodzinne pozdrowienia E2E');
  await page.getByRole('button', { name: 'Prywatne', exact: true }).click();
  await page.locator('.private-list').getByRole('button', { name: /Sebastian/ }).click();
  await expect(page.locator('.chat-messages')).toContainText('Rozmowa z Nikodemem');
  await expect(page.locator('.chat-messages')).not.toContainText('Rodzinne pozdrowienia E2E');
  await page.locator('.chat-compose input').fill('Prywatne pozdrowienia E2E');
  await page.getByRole('button', { name: 'Wyślij', exact: true }).click();
  await expect(page.locator('.chat-messages')).toContainText('Prywatne pozdrowienia E2E');
  const docs = await fixtureDatabase().collection('familyMessages').where('text', '==', 'Prywatne pozdrowienia E2E').get();
  expect(docs.size).toBe(1);
  expect(docs.docs[0].data().participants.sort()).toEqual([accounts.child.uid, accounts.parent.uid].sort());
});

test('szkoła: dodanie oceny przez rodzica i dziecko widzi własny plan', async ({ page }) => {
  await login(page);
  await goTo(page, 'Szkoła');
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await page.getByRole('button', { name: /Dodaj wpis/ }).click();
  const schoolDialog = page.getByRole('dialog');
  await schoolDialog.getByLabel('Rodzaj wpisu', { exact: true }).selectOption('grade');
  await schoolDialog.getByLabel('Ocena / wynik *', { exact: true }).fill('6');
  await schoolDialog.getByLabel('Przedmiot', { exact: true }).fill('Przyroda E2E');
  await schoolDialog.getByRole('button', { name: 'Zapisz wpis', exact: true }).click();
  await expect(schoolDialog).toHaveCount(0);
  await expect(page.locator('.school-record-list')).toContainText('Przyroda E2E');
  await logout(page);
  await login(page, accounts.child);
  await goTo(page, 'Szkoła');
  await expect(page.locator('.school-record-list')).toContainText('Przyroda Nikodema');
  await expect(page.locator('.school-record-list')).toContainText('Przyroda E2E');
  await expect(page.locator('.school-record-list')).not.toContainText('Fizyka Pawła');
  await expect(page.locator('.school-students')).not.toContainText('Paweł');
  await page.locator('.school-record-list .school-entry').filter({ hasText: 'Przyroda E2E' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Edytuj|Usuń/ })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await expect(page.getByText(/VULCAN/i).first()).toBeVisible();
});

test('zdrowie: dokument PDF zapisuje się w Storage i poufne dokumenty są niewidoczne dziecku', async ({ page }) => {
  await login(page);
  await goTo(page, 'Zdrowie');
  await page.getByRole('button', { name: /Dodaj wizytę \/ wpis/ }).click();
  await modal(page).getByLabel('Osoba', { exact: true }).selectOption('Nikodem');
  await modal(page).getByLabel('Rodzaj', { exact: true }).selectOption('result');
  await modal(page).getByLabel('Nazwa / opis', { exact: true }).fill('Wynik Nikodema E2E');
  await modal(page).getByLabel('Plik (PDF / zdjęcie)', { exact: true }).setInputFiles({
    name: 'wynik-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'),
  });
  await modal(page).getByRole('button', { name: /Zapisz$/ }).click();
  await expect(modal(page)).toHaveCount(0);
  const docs = await fixtureDatabase().collection('healthRecords').where('title', '==', 'Wynik Nikodema E2E').get();
  expect(docs.size).toBe(1);
  expect(docs.docs[0].data().documentURL).toBe('');
  expect(docs.docs[0].data().documentPath).toMatch(/^health\/shared\/Nikodem\/test-sebastian\//);
  const fileResponse = page.waitForResponse((response) => response.url().includes(':9199/') && response.request().method() === 'GET');
  await page.locator('.document-row').filter({ hasText: 'Wynik Nikodema E2E' }).getByRole('button', { name: 'Otwórz', exact: true }).click();
  expect((await fileResponse).ok()).toBe(true);
  await logout(page);
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await login(page, accounts.child);
  await goTo(page, 'Zdrowie');
  await expect(page.locator('.health-dashboard-grid')).toContainText('Wynik Nikodema E2E');
  await expect(page.locator('.health-dashboard-grid')).not.toContainText('Poufny dokument Pawła');
  await expect(page.locator('.health-dashboard-grid')).not.toContainText('Kontrola Pawła');
});

test('telefon, tablet i komputer: wszystkie moduły działają w pionie oraz poziomie', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  const sizes = [
    { width: 320, height: 700 },
    { width: 390, height: 844 }, { width: 844, height: 390 },
    { width: 768, height: 1024 }, { width: 1024, height: 768 },
    { width: 1440, height: 900 }, { width: 900, height: 1440 },
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const module of ['Start', 'Kalendarz', 'Zadania', 'Zakupy', 'Czat', 'Zdrowie', 'Szkoła', 'Rodzina', 'Ustawienia'] as Module[]) {
      await goTo(page, module);
      if (module === 'Start' && browserName === 'chromium' && [390,768,1440].includes(size.width)) await page.screenshot({ path: `preview/start-${size.width}x${size.height}.png`, fullPage: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), { message: `${module}: ${size.width}×${size.height} must not overflow the screen` }).toBe(true);
    }
    await goTo(page, 'Kalendarz');
    await page.getByRole('button', { name: /Dodaj wydarzenie/ }).click();
    await expect(modal(page)).toBeVisible();
    const bounds = await modal(page).boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(size.width + 1);
    await expect(modal(page).getByLabel('Nazwa wydarzenia')).toBeVisible();
    await modal(page).getByRole('button', { name: 'Zamknij', exact: true }).click();
  }
  expect(errors).toEqual([]);
});
