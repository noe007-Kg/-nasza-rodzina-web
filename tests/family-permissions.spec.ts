import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';

type Account = (typeof accounts)[keyof typeof accounts];
const missingSchoolProfile = 'Profil nie jest jeszcze powiązany z danymi szkolnymi. Rodzic musi uzupełnić profil.';

async function loginToFamily(page: Page, account: Account) {
  // Open this module directly: an error in another module must not masquerade
  // as a failure of one of the four FamilyPage listeners.
  await page.goto('/#Rodzina');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.family-v130')).toBeVisible();
}

async function selectProfile(page: Page, uid: string) {
  await page.locator(`[data-testid="family-profile"][data-uid="${uid}"]`).click();
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, route => {
    throw new Error(`A FamilyPage test attempted production Firebase access: ${route.request().url()}`);
  });
});

for (const account of [accounts.parent, accounts.mother]) {
  test(`Rodzina: ${account.name} odczytuje rodzinne dane i tylko własny kalendarz prywatny`, async ({ page }) => {
    const db = fixtureDatabase();
    const start = Timestamp.fromMillis(Date.now() + 60 * 60_000);
    const end = Timestamp.fromMillis(Date.now() + 2 * 60 * 60_000);
    const other = account.uid === accounts.parent.uid ? accounts.mother : accounts.parent;
    const event = { person: 'family', date: start, endDate: end, allDay: false, description: '', repeat: 'none', repeatUntil: null };
    await Promise.all([
      db.doc('calendarEvents/family-listener-shared').set({ ...event, title: 'Rodzinny spacer diagnostyczny', createdBy: account.uid }),
      db.doc('privateCalendarEvents/family-listener-own').set({ ...event, title: 'Własny prywatny termin diagnostyczny', createdBy: account.uid, ownerUid: account.uid, private: true }),
      db.doc('privateCalendarEvents/family-listener-other').set({ ...event, title: 'Prywatny termin drugiego rodzica', createdBy: other.uid, ownerUid: other.uid, private: true }),
    ]);

    await loginToFamily(page, account);
    const family = page.locator('.family-v130');
    await expect(family).toContainText('Rodzinny spacer diagnostyczny');
    await expect(family).toContainText('Własny prywatny termin diagnostyczny');
    await expect(family).not.toContainText('Prywatny termin drugiego rodzica');
    await expect(family).toContainText('Wynieść śmieci — test zatwierdzania');
    await selectProfile(page, accounts.child.uid);
    await expect(family).toContainText('Przyroda Nikodema');
    await selectProfile(page, accounts.sibling.uid);
    await expect(family).toContainText('Fizyka Pawła');
    await expect(page.locator('.family-notice.error')).toHaveCount(0);
  });
}

for (const identity of [
  { label: 'pusty personKey przy poprawnej nazwie', fields: { name: 'Nikodem', personKey: '' } },
  { label: 'niepoprawny personKey przy poprawnej nazwie', fields: { name: 'Nikodem', personKey: 'member-invalid' } },
  { label: 'brak rozpoznawalnej tożsamości', fields: { name: '', personKey: '' } },
]) {
  test(`Rodzina: ${identity.label} daje informację o profilu zamiast błędu zapytania szkolnego`, async ({ page }) => {
    await fixtureDatabase().doc(`members/${accounts.child.uid}`).update(identity.fields);
    await loginToFamily(page, accounts.child);
    await expect(page.getByRole('status').filter({ hasText: missingSchoolProfile })).toBeVisible();
    await expect(page.locator('.family-notice.error')).toHaveCount(0);
    await expect(page.locator('.family-v130')).not.toContainText('Przyroda Nikodema');
    await expect(page.locator('.family-v130')).not.toContainText('Fizyka Pawła');
  });
}

test('Rodzina: zmiana personKey dziecka przełącza zapytanie bez przeładowania modułu', async ({ page }) => {
  await loginToFamily(page, accounts.child);
  await selectProfile(page, accounts.child.uid);
  const family = page.locator('.family-v130');
  await expect(family).toContainText('Przyroda Nikodema');
  await expect(family).not.toContainText('Fizyka Pawła');

  // This update represents a parent correcting the authenticated profile.
  // It is written only through the explicitly local fixture Admin SDK.
  await fixtureDatabase().doc(`members/${accounts.child.uid}`).update({ name: 'Paweł', personKey: 'Paweł' });
  await expect(page.locator(`[data-testid="family-profile"][data-uid="${accounts.child.uid}"]`)).toHaveAttribute('aria-label', 'Profil: Paweł');
  await selectProfile(page, accounts.child.uid);
  await expect(family).toContainText('Fizyka Pawła');
  await expect(family).not.toContainText('Przyroda Nikodema');
  await expect(page.locator('.family-notice.error')).toHaveCount(0);
});

test('Rodzina: utrata roli rodzica usuwa poprzedni szeroki odczyt szkolny', async ({ page }) => {
  await loginToFamily(page, accounts.parent);
  await selectProfile(page, accounts.sibling.uid);
  const family = page.locator('.family-v130');
  await expect(family).toContainText('Fizyka Pawła');

  await fixtureDatabase().doc(`members/${accounts.parent.uid}`).update({ role: 'child', name: 'Nikodem', personKey: 'Nikodem' });
  await expect(family).not.toContainText('Fizyka Pawła');
  await expect(page.locator(`[data-testid="family-profile"][data-uid="${accounts.parent.uid}"]`)).toHaveAttribute('aria-label', 'Profil: Nikodem');
  await selectProfile(page, accounts.parent.uid);
  await expect(family).toContainText('Przyroda Nikodema');
  await expect(family).not.toContainText('Fizyka Pawła');
});

test('Rodzina: uzupełnienie brakującej tożsamości rozpoczyna odczyt szkolny bez przeładowania', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc(`members/${accounts.child.uid}`).update({ personKey: '' });
  await loginToFamily(page, accounts.child);
  await expect(page.getByRole('status').filter({ hasText: missingSchoolProfile })).toBeVisible();

  await db.doc(`members/${accounts.child.uid}`).update({ personKey: 'Nikodem' });
  await expect(page.getByRole('status').filter({ hasText: missingSchoolProfile })).toHaveCount(0);
  await expect(async () => {
    await selectProfile(page, accounts.child.uid);
    await expect(page.locator('.family-v130')).toContainText('Przyroda Nikodema');
  }).toPass({ timeout: 10_000 });
  await expect(page.locator('.family-notice.error')).toHaveCount(0);
});

test('zmiana rodzic → dziecko zamyka otwarte szczegóły prywatnej wiadomości szkolnej', async ({ page }) => {
  const title = 'Wiadomość wyłącznie dla rodzica — test zmiany roli';
  await fixtureDatabase().doc('schoolParentMessages/role-change-private').set({
    person: 'Nikodem', type: 'message', title, subject: '', date: '', time: '', endTime: '', weekday: 0,
    note: 'Poufna treść testowa tylko dla rodzica', source: 'eduvulcan', createdAt: Timestamp.now(),
  });
  await loginToFamily(page, accounts.parent);
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Szkoła', exact: true }).click();
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await page.locator('.school-record-list .school-entry').filter({ hasText: title }).click();
  await expect(page.getByRole('dialog')).toContainText('Poufna treść testowa tylko dla rodzica');

  await fixtureDatabase().doc(`members/${accounts.parent.uid}`).update({ role: 'child', name: 'Nikodem', personKey: 'Nikodem' });
  await expect(page.locator('.school-students')).toHaveAttribute('aria-label', 'Twój profil szkolny');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.school-module')).not.toContainText(title);
  await expect(page.locator('.school-module')).not.toContainText('Poufna treść testowa tylko dla rodzica');
});

test('odmowa szkolnego zapytania pokazuje właściwy kod i nie pozostaje po opuszczeniu modułu', async ({ page }) => {
  // Exercise a real permission-denied response using only the demo emulator.
  // Restore the original rules even if an assertion fails; no production CLI is used.
  const rules = await readFile('firestore.rules', 'utf8');
  const schoolRule = "match /schoolItems/{id} {\n      allow read: if member() && (parent() || resource.data.person == ownPerson());";
  expect(rules).toContain(schoolRule);
  const configure = (value: string) => initializeTestEnvironment({
    projectId: 'demo-nasza-rodzina', firestore: { host: '127.0.0.1', port: 8080, rules: value },
  });
  const restricted = await configure(rules.replace(schoolRule, 'match /schoolItems/{id} {\n      allow read: if false;'));
  try {
    await loginToFamily(page, accounts.parent);
    await expect(page.locator('.family-notice.error')).toContainText('family.school/permission-denied');
    await page.locator('.sidebar-nav').getByRole('button', { name: 'Kalendarz', exact: true }).click();
    await expect(page.locator('.family-notice.error')).toHaveCount(0);
  } finally {
    const restored = await configure(rules);
    await restored.cleanup();
    await restricted.cleanup();
  }
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Rodzina', exact: true }).click();
  await selectProfile(page, accounts.child.uid);
  await expect(page.locator('.family-v130')).toContainText('Przyroda Nikodema');
  await expect(page.locator('.family-notice.error')).toHaveCount(0);
});
