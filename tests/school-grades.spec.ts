import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

function movedDay(days: number) {
  const date = new Date(`${todayKey()}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function sourceId(kind: 'grade' | 'grade-period', index: number) { return `${kind}:sha256:${index.toString(16).padStart(64, '0')}`; }
async function school(page: Page, account = accounts.parent as { email: string }) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(() => { location.hash = encodeURIComponent('Szkoła'); });
  await expect(page.locator('.school-heading h1')).toHaveText('Szkoła');
  if (account.email === accounts.parent.email) await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await expect(page.getByTestId('school-stat-grades')).toContainText('Oceny');
}
async function seedGrades() {
  const db = fixtureDatabase();
  const base = { person: 'Nikodem', type: 'grade', subject: 'Matematyka', date: todayKey(), time: '', endTime: '', weekday: 0, source: 'eduvulcan', sourceProfileId: 'verified-school-profile', providerScopeId: 'grades:period-1', createdBy: accounts.mother.uid, createdAt: Timestamp.now(), syncedAt: Timestamp.now() };
  const batch = db.batch();
  const titles = ['2', '3', '4', '4+', '5', '5-', '6'];
  for (let index = 0; index < 7; index++) batch.set(db.doc(`schoolItems/grade-ui-${index}`), { ...base, title: titles[index], date: movedDay(index - 6), sourceRecordId: sourceId('grade', index), note: `Sprawdzian — dostępna notatka\nNauczyciel: Nauczyciel testowy\nWaga w dzienniku: ${index === 6 ? '0' : '1'}\nŚrednia podana przez dziennik: 4,50`, createdAt: Timestamp.fromMillis(Date.now() + (7 - index) * 60_000) });
  batch.set(db.doc('schoolItems/grade-ui-period'), { ...base, title: 'Ocena okresowa: 5', sourceRecordId: sourceId('grade-period', 99), note: 'Średnia podana przez dziennik: 4,50' });
  batch.set(db.doc('schoolItems/grade-ui-points'), { ...base, subject: 'Muzyka', title: '8/10 pkt', sourceRecordId: sourceId('grade', 100), note: 'Nauczyciel: Drugi nauczyciel' });
  batch.set(db.doc('schoolItems/grade-ui-description'), { ...base, subject: 'Muzyka', title: 'Samodzielnie wykonuje zadania', sourceRecordId: sourceId('grade', 101), date: movedDay(-1), note: 'Ocena opisowa' });
  for (let index = 0; index < 9; index++) batch.set(db.doc(`schoolItems/sibling-grade-ui-${index}`), { ...base, person: 'Paweł', subject: 'Fizyka', title: 'Wynik wyłącznie Pawła', sourceProfileId: 'sibling-school-profile', sourceRecordId: sourceId('grade', 200 + index), note: '' });
  for (let index = 0; index < 9; index++) batch.set(db.doc(`schoolParentMessages/grade-ui-parent-${index}`), { ...base, type: 'message', title: `Poufna wiadomość rodzica ${index}`, note: 'Treść zastrzeżona dla rodziców', date: movedDay(index - 8) });
  await batch.commit();
}
test.beforeEach(async ({ page }) => {
  await seedEmulators(); await seedGrades();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, () => { throw new Error('School grade test attempted production Firebase access.'); });
  await page.route('**/api/eduvulcan/**', route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).pathname).toBe('/api/eduvulcan/status');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: true, state: 'disconnected', connectionScope: 'family', profiles: [], selectedStudent: null } }) });
  });
});

test('Oceny pokazują prawdziwe liczby, ostatnie pięć cząstkowych i osobne podsumowanie okresowe', async ({ page }) => {
  await school(page);
  await expect(page.getByTestId('school-stat-grades').locator('.family-stat-card__value')).toHaveText('10');
  await page.getByTestId('school-stat-grades').click();
  const dashboard = page.getByTestId('school-grades-dashboard');
  await expect(dashboard.locator('.school-grades-total strong')).toHaveText('10');
  await expect(dashboard.locator('.school-latest-grades [data-testid="school-grade-entry"]')).toHaveCount(5);
  await expect(page.getByTestId('school-grade-periods')).toContainText('Ocena okresowa: 5');
  await expect(dashboard.getByTestId('school-grade-subject-card')).toHaveCount(2);
  await expect(dashboard).not.toContainText('Wynik wyłącznie Pawła');
  await expect(page.getByTestId('school-grade-distribution').locator('li')).toHaveCount(5);
  await page.getByTestId('school-grade-distribution').getByRole('button', { name: 'Pokaż wszystkie: Rozkład oznaczeń', exact: true }).click();
  await expect(dashboard.locator('.school-grade-statistics')).toContainText('8/10 pkt');
  await expect(dashboard.locator('.school-grade-statistics')).toContainText('Samodzielnie wykonuje zadania');
  await expect(dashboard).not.toContainText('Średnia klasy');
});

test('Ostatnie oceny rozwijają wszystkie i zwijają do pięciu bez ponownego zapytania do dziennika', async ({ page }) => {
  await school(page); await page.getByTestId('school-stat-grades').click();
  const latest = page.getByTestId('school-latest-grades');
  await expect(latest.locator('[data-testid="school-grade-entry"]')).toHaveCount(5);
  await expect(latest.locator('[data-testid="school-grade-entry"]').first()).toHaveAttribute('data-grade-id', 'grade-ui-6');
  const diaryRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/eduvulcan/')) diaryRequests.push(request.url()); });
  const expand = latest.getByRole('button', { name: 'Pokaż wszystkie: Ostatnie oceny', exact: true });
  await expect(expand).toHaveText('Pokaż wszystkie (9)');
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.click();
  await expect(latest.locator('[data-testid="school-grade-entry"]')).toHaveCount(9);
  const collapse = latest.getByRole('button', { name: 'Zwiń listę: Ostatnie oceny', exact: true });
  await expect(collapse).toHaveText('Zwiń listę');
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(latest).not.toContainText('Ocena okresowa: 5');
  await expect(latest.locator('[data-testid="school-grade-entry"]').last()).toHaveAttribute('data-grade-id', 'grade-ui-0');
  await collapse.click();
  await expect(latest.locator('[data-testid="school-grade-entry"]')).toHaveCount(5);
  expect(diaryRequests).toEqual([]);
  await expand.click();
  await page.locator('.school-students').getByRole('button', { name: 'Paweł', exact: true }).click();
  await expect(page.getByTestId('school-latest-grades').locator('[data-testid="school-grade-entry"]')).toHaveCount(5);
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await expect(page.getByTestId('school-latest-grades').locator('[data-testid="school-grade-entry"]')).toHaveCount(5);
});

test('Ostatnie oceny z pięcioma wpisami nie pokazują zbędnego rozwijania ani domyślnej wagi', async ({ page }) => {
  const db = fixtureDatabase(); const batch = db.batch();
  for (let index = 0; index < 4; index++) batch.delete(db.doc(`schoolItems/grade-ui-${index}`));
  await batch.commit();
  await school(page); await page.getByTestId('school-stat-grades').click();
  const latest = page.getByTestId('school-latest-grades');
  await expect(latest.locator('[data-testid="school-grade-entry"]')).toHaveCount(5);
  await expect(latest.getByRole('button', { name: /Pokaż wszystkie|Zwiń listę/ })).toHaveCount(0);
  const noWeight = latest.locator('[data-grade-id="grade-ui-points"]');
  await expect(noWeight).not.toContainText('Waga w dzienniku');
  await noWeight.click();
  const dialog = page.getByRole('dialog', { name: 'Szczegóły oceny', exact: true });
  await expect(dialog).toContainText('Muzyka');
  await expect(dialog).toContainText('8/10 pkt');
  await expect(dialog).toContainText('Drugi nauczyciel');
  await expect(dialog).not.toContainText('Waga w dzienniku');
});

test('Statystyki rozróżniają czternaście ocen od pięciu rodzajów, zachowując oryginalne 5+ i +', async ({ page }) => {
  const db = fixtureDatabase(); const original = (await db.doc('schoolItems/grade-ui-0').get()).data()!;
  const batch = db.batch();
  for (const record of (await db.collection('schoolItems').where('person', '==', 'Nikodem').where('type', '==', 'grade').get()).docs) batch.delete(record.ref);
  const labels = ['5', '5+', '+', '4', 'Samodzielnie pracuje'];
  for (let index = 0; index < 14; index++) batch.set(db.doc(`schoolItems/grade-ui-count-${index}`), {
    ...original, title: labels[index % labels.length], date: movedDay(index - 13), sourceRecordId: sourceId('grade', 1_000 + index), note: '',
  });
  await batch.commit();
  await school(page); await page.getByTestId('school-stat-grades').click();
  await expect(page.locator('.school-grade-summary')).toContainText('14');
  const distribution = page.getByTestId('school-grade-distribution');
  await expect(distribution.locator('.school-list-section-heading > span')).toHaveText('5 rodzajów oznaczeń');
  await expect(distribution.locator('li')).toHaveCount(5);
  await expect(distribution.locator('li > span')).toHaveText(['+', '4', '5', '5+', 'Samodzielnie pracuje']);
  await expect(distribution).not.toContainText('5 wpisów');
  await expect(page.getByTestId('school-grades-dashboard')).not.toContainText('Średnia z dziennika');
});

test('Przedmiot: pięć najnowszych, rozwiń/zwiń oraz szczegóły oceny z prawdziwą wagą zero', async ({ page }) => {
  await school(page); await page.getByTestId('school-stat-grades').click();
  await page.getByTestId('school-grade-subject-card').filter({ hasText: 'Matematyka' }).click();
  const grades = page.getByTestId('school-subject-grades');
  await expect(grades.locator('[data-testid="school-grade-entry"]')).toHaveCount(5);
  await expect(grades.locator('[data-testid="school-grade-entry"]').first()).toHaveAttribute('data-grade-id', 'grade-ui-6');
  await grades.getByRole('button', { name: 'Pokaż wszystkie: Oceny i wyniki', exact: true }).click();
  await expect(grades.locator('[data-testid="school-grade-entry"]')).toHaveCount(7);
  await grades.getByRole('button', { name: 'Zwiń: Oceny i wyniki', exact: true }).click();
  await expect(grades.locator('[data-testid="school-grade-entry"]')).toHaveCount(5);
  const latest = grades.locator('[data-grade-id="grade-ui-6"]'); await latest.click();
  const dialog = page.getByRole('dialog', { name: 'Szczegóły oceny', exact: true });
  await expect(dialog).toContainText('6'); await expect(dialog).toContainText('Nauczyciel testowy');
  await expect(dialog).toContainText('Matematyka');
  await expect(dialog).toContainText('Sprawdzian — dostępna notatka');
  await expect(dialog.locator('.school-detail > div').filter({ hasText: 'Data' }).first().locator('dd')).not.toBeEmpty();
  await expect(dialog.locator('.school-detail > div').filter({ hasText: 'Waga w dzienniku' }).first().locator('dd')).toHaveText('0');
  await expect(dialog.getByRole('button', { name: /Edytuj|Usuń/ })).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(latest).toBeFocused();
});

test('Średnia pozostaje wartością portalu, a kilka okresów lub sprzeczne dane ukrywają zbiorczą średnią', async ({ page }) => {
  await school(page); await page.getByTestId('school-stat-grades').click();
  const math = page.getByTestId('school-grade-subject-card').filter({ hasText: 'Matematyka' });
  await expect(math).toContainText('Średnia z dziennika: 4,50');
  const db = fixtureDatabase();
  const original = (await db.doc('schoolItems/grade-ui-0').get()).data()!;
  await db.doc('schoolItems/grade-ui-extra-period').set({ ...original, providerScopeId: 'grades:period-2', sourceRecordId: sourceId('grade', 500), title: '4' });
  await expect(math).not.toContainText('Średnia z dziennika');
  await db.doc('schoolItems/grade-ui-extra-period').delete();
  await expect(math).toContainText('Średnia z dziennika: 4,50');
  await db.doc('schoolItems/grade-ui-0').update({ note: 'Średnia podana przez dziennik: 3,80' });
  await expect(math).not.toContainText('Średnia z dziennika');
});

test('Wszystkie ogranicza każdy rodzaj do pięciu, a zmiana filtra lub ucznia resetuje rozwinięcie', async ({ page }) => {
  await school(page);
  const grades = page.getByTestId('school-list-grade');
  await expect(grades.locator('.school-entry')).toHaveCount(5);
  await grades.getByRole('button', { name: 'Pokaż wszystkie: Oceny', exact: true }).click();
  await expect(grades.locator('.school-entry')).toHaveCount(10);
  await page.locator('.school-filters').getByRole('button', { name: /^Zadania domowe/ }).click();
  await page.locator('.school-filters').getByRole('button', { name: /^Wszystkie/ }).click();
  await expect(page.getByTestId('school-list-grade').locator('.school-entry')).toHaveCount(5);
  await page.getByTestId('school-list-grade').getByRole('button', { name: 'Pokaż wszystkie: Oceny', exact: true }).click();
  await page.locator('.school-students').getByRole('button', { name: 'Paweł', exact: true }).click();
  await expect(page.getByTestId('school-list-grade').locator('.school-entry')).toHaveCount(5);
  await expect(page.locator('.school-record-list')).not.toContainText('Nauczyciel testowy');
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await expect(page.getByTestId('school-list-grade').locator('.school-entry')).toHaveCount(5);
  await page.getByTestId('school-stat-grades').click();
  await page.getByTestId('school-grade-subject-card').filter({ hasText: 'Matematyka' }).click();
  await page.getByTestId('school-subject-grades').getByRole('button', { name: 'Pokaż wszystkie: Oceny i wyniki', exact: true }).click();
  await expect(page.getByTestId('school-subject-grades').locator('[data-testid="school-grade-entry"]')).toHaveCount(7);
  await page.locator('.school-students').getByRole('button', { name: 'Paweł', exact: true }).click();
  await expect(page.getByTestId('school-grades-dashboard')).toBeVisible();
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await expect(page.getByTestId('school-grades-dashboard')).toBeVisible();
  await page.getByTestId('school-grade-subject-card').filter({ hasText: 'Matematyka' }).click();
  await expect(page.getByTestId('school-subject-grades').locator('[data-testid="school-grade-entry"]')).toHaveCount(5);
  await page.locator('.school-filters').getByRole('button', { name: /^Zadania domowe/ }).click();
  await page.getByTestId('school-stat-grades').click();
  await expect(page.getByTestId('school-grades-dashboard')).toBeVisible();
});

test('Brak daty wystawienia nie staje się datą importu i nie wypycha prawidłowo datowanych ocen', async ({ page }) => {
  const db = fixtureDatabase();
  const original = (await db.doc('schoolItems/grade-ui-0').get()).data()!;
  await db.doc('schoolItems/grade-ui-old-dated').set({ ...original, title: 'Dawna ocena z datą', date: '2000-01-02', createdAt: Timestamp.fromDate(new Date('2098-01-01')), sourceRecordId: sourceId('grade', 600) });
  await db.doc('schoolItems/grade-ui-undated-import').set({ ...original, title: 'Ocena bez daty wystawienia', date: '', createdAt: Timestamp.fromDate(new Date('2099-01-01')), sourceRecordId: sourceId('grade', 601) });
  await school(page); await page.getByTestId('school-stat-grades').click();
  await page.getByTestId('school-grade-subject-card').filter({ hasText: 'Matematyka' }).click();
  const list = page.getByTestId('school-subject-grades');
  await expect(list.locator('[data-testid="school-grade-entry"]').first()).toHaveAttribute('data-grade-id', 'grade-ui-6');
  await list.getByRole('button', { name: 'Pokaż wszystkie: Oceny i wyniki', exact: true }).click();
  const entries = list.locator('[data-testid="school-grade-entry"]');
  await expect(entries.nth(7)).toHaveAttribute('data-grade-id', 'grade-ui-old-dated');
  await expect(entries.last()).toHaveAttribute('data-grade-id', 'grade-ui-undated-import');
  await expect(entries.last()).toContainText('Bez daty wystawienia');
  await expect(entries.last()).not.toContainText('2099');
});

test('Ponad sto opisowych oznaczeń zachowuje prawdziwy rozkład, ale domyślnie pokazuje pięć i nie przepełnia telefonu', async ({ page }) => {
  const db = fixtureDatabase();
  const original = (await db.doc('schoolItems/grade-ui-0').get()).data()!;
  const batch = db.batch();
  for (let index = 0; index < 101; index++) batch.set(db.doc(`schoolItems/grade-ui-descriptive-${index}`), { ...original, subject: 'Oceny opisowe', title: `Opis ${index}: ${'BardzoDługieDosłowneOznaczenie'.repeat(4)}`, sourceRecordId: sourceId('grade', 700 + index), note: 'Ocena opisowa' });
  await batch.commit();
  await page.setViewportSize({ width: 390, height: 844 });
  await school(page); await page.getByTestId('school-stat-grades').click();
  const distribution = page.getByTestId('school-grade-distribution');
  await expect(distribution.locator('li')).toHaveCount(5);
  await distribution.getByRole('button', { name: 'Pokaż wszystkie: Rozkład oznaczeń', exact: true }).click();
  await expect(distribution.locator('li')).toHaveCount(110);
  await expect(distribution).toContainText(`Opis 100: ${'BardzoDługieDosłowneOznaczenie'.repeat(4)}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await distribution.getByRole('button', { name: 'Zwiń: Rozkład oznaczeń', exact: true }).click();
  await expect(distribution.locator('li')).toHaveCount(5);
  await expect(page.getByTestId('school-grades-dashboard')).not.toContainText('Średnia klasy');
});

test('Wiadomości mają gwiazdki przed najnowszymi, ale dziecko nie otrzymuje prywatnej historii rodziców', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc(`userPreferences/${accounts.parent.uid}`).set({ importantItems: ['school:message:Nikodem:grade-ui-parent-0'] }, { merge: true });
  await school(page); await page.getByTestId('school-stat-messages').click();
  const list = page.getByTestId('school-list-message');
  await expect(list.locator('.school-entry-wrapper')).toHaveCount(5);
  await expect(list.locator('.school-entry-wrapper').first()).toContainText('Poufna wiadomość rodzica 0');
  await list.getByRole('button', { name: 'Pokaż wszystkie: Wiadomości', exact: true }).click();
  await expect(list.locator('.school-entry-wrapper')).toHaveCount(9);
  await page.evaluate(async () => { const path = '/src/firebase.ts'; const sdkPath = '/node_modules/.vite/deps/firebase_auth.js'; const { auth } = await import(path); const sdk = await import(sdkPath); await sdk.signOut(auth); });
  await school(page, accounts.child);
  await expect(page.getByTestId('school-stat-messages')).toHaveCount(0);
  await expect(page.locator('.school-record-list')).not.toContainText('Poufna wiadomość rodzica');
  await expect(page.locator('.school-record-list')).not.toContainText('Treść zastrzeżona dla rodziców');
  await expect(page.locator('.school-students').getByRole('button')).toHaveCount(1);
});

test('Najbliższe zadania i sprawdziany nie znikają za historią, a dzienny plan pozostaje kompletny', async ({ page }) => {
  const db = fixtureDatabase(); const base = { person: 'Nikodem', subject: '', note: '', time: '', endTime: '', weekday: 0, createdBy: accounts.parent.uid, createdAt: Timestamp.now() };
  for (let index = 0; index < 8; index++) await db.doc(`schoolItems/deadline-history-${index}`).set({ ...base, type: 'homework', title: `Dawne zadanie ${index}`, date: movedDay(-index - 1) });
  await db.doc('schoolItems/deadline-tomorrow').set({ ...base, type: 'homework', title: 'Najbliższe zadanie', date: movedDay(1) });
  await db.doc('schoolItems/deadline-test-tomorrow').set({ ...base, type: 'test', title: 'Najbliższy sprawdzian', date: movedDay(1) });
  for (let index = 0; index < 7; index++) await db.doc(`schoolItems/complete-plan-${index}`).set({ ...base, type: 'lesson', title: `Lekcja kompletnego planu ${index}`, date: todayKey(), time: `${String(9 + index).padStart(2, '0')}:00`, endTime: `${String(9 + index).padStart(2, '0')}:45` });
  await school(page);
  await expect(page.getByTestId('school-list-homework').locator('.school-entry').first()).toContainText('Najbliższe zadanie');
  await expect(page.getByTestId('school-list-test')).toContainText('Najbliższy sprawdzian');
  await expect(page.locator('.school-plan-list .school-plan-entry')).toHaveCount(8);
  await expect(page.locator('.school-plan-list')).toContainText('Lekcja kompletnego planu 6');
});

test('Telefon, tablet i desktop: Oceny/Szkoła zachowują układ i dostępność bez poziomego scrollu', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await school(page);
  for (const variant of [
    { width: 390, height: 844, name: 'phone-portrait', capture: true },
    { width: 844, height: 390, name: 'phone-landscape', capture: false },
    { width: 900, height: 1440, name: 'tablet-portrait', capture: false },
    { width: 1024, height: 768, name: 'tablet-landscape', capture: true },
    { width: 1440, height: 900, name: 'desktop', capture: false },
  ]) {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.locator('.school-filters').getByRole('button', { name: /^Wszystkie/ }).click();
    await page.locator('main.main-area').evaluate(main => {
      main.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (info.project.name === 'chromium' && variant.capture) {
      await mkdir('preview/stage-4', { recursive: true });
      await page.screenshot({ path: `preview/stage-4/school-${variant.name}-after.png`, fullPage: false });
    }
    await page.getByTestId('school-stat-grades').click();
    await expect(page.getByTestId('school-grades-dashboard')).toBeVisible();
    await page.locator('.school-records-panel').evaluate(panel => {
      const headerHeight = document.querySelector('.family-top-header')?.getBoundingClientRect().height || 0;
      window.scrollTo({ top: window.scrollY + panel.getBoundingClientRect().top - headerHeight - 12, left: 0, behavior: 'instant' });
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (info.project.name === 'chromium' && variant.capture) await page.screenshot({ path: `preview/stage-4/grades-${variant.name}-after.png`, fullPage: false });
  }
});
