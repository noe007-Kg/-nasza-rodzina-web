import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { getAuth } from 'firebase-admin/auth';
import { getApps } from 'firebase-admin/app';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { manageProfileAction } from '../server/account-profiles.mjs';
import { manageMemberAction } from '../server/account-members.mjs';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
function fixtureAuth() { fixtureDatabase(); return getAuth(getApps().find(app => app.name === 'browser-tests')!); }

/** Vite has no Vercel API runtime. This bridge runs the real action against LOCAL Auth/Firestore. */
async function bridgeProfileApis(page: Page) {
  await page.route(/\/api\/account\/(?:profile|members)$/, async route => {
    try {
      const token = route.request().headers().authorization?.replace(/^Bearer /, '') || '';
      const decoded = await fixtureAuth().verifyIdToken(token);
      const db = fixtureDatabase();
      const profile = (await db.doc(`members/${decoded.uid}`).get()).data();
      const context = { uid: decoded.uid, db, profile, auth: fixtureAuth() };
      const body = route.request().postDataJSON();
      const result = route.request().url().endsWith('/profile') ? await manageProfileAction(context, body) : await manageMemberAction(context, body);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ...result }) });
    } catch (reason) {
      const error = reason as { status?: number; code?: string; message?: string };
      await route.fulfill({ status: error.status || 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: error.code || 'ACCOUNT_DENIED', message: error.status ? error.message : 'Nie udało się potwierdzić konta.' } }) });
    }
  });
}
async function login(page: Page, account: { email: string } = accounts.parent) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}
async function navigate(page: Page, module: string) {
  await page.evaluate(target => { location.hash = encodeURIComponent(target); }, module);
  await expect(page.getByRole('heading', { name: module, exact: true, level: 1 })).toBeVisible();
}
async function ownEditor(page: Page) {
  await navigate(page, 'Ustawienia');
  await page.locator('#own-profile-settings').getByRole('button', { name: 'Edytuj swój profil', exact: true }).click();
  return page.getByTestId('member-profile-editor');
}
test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await bridgeProfileApis(page);
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 19, weather_code: 1, wind_speed_10m: 8 }, daily: { temperature_2m_max: [22], temperature_2m_min: [12] } }) }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, route => { throw new Error(`Production Firebase is forbidden in tests: ${route.request().url()}`); });
});

test('Cała rodzina jest agregatorem kalendarza, zalogowana osoba pozostaje pierwsza i nie powstaje konto', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('family-profile').first()).toHaveAttribute('data-uid', accounts.parent.uid);
  await expect(page.getByTestId('family-profile')).toHaveCount(5);
  await page.getByTestId('family-aggregate-profile').click();
  await expect(page.locator('.page-header h1')).toHaveText('Kalendarz');
  await expect(page.locator('.person-filters button.active')).toHaveText('Cała rodzina');
  await page.locator('.person-filters').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await page.getByTestId('family-aggregate-profile').click();
  await expect(page.locator('.person-filters button.active')).toHaveText('Cała rodzina');
  expect((await fixtureDatabase().collection('members').get()).size).toBe(5);
  expect((await fixtureDatabase().doc('members/family').get()).exists).toBe(false);
});

test('kolejni członkowie bez loginu działają dynamicznie w pasku i kalendarzu, bez poziomego scrollu strony', async ({ page }) => {
  const db = fixtureDatabase();
  for (let i = 0; i < 7; i++) await db.doc(`members/profile-extra-${i}`).set({ name: `Nowa osoba ${i}`, personKey: `member-${String(i).padStart(24, '0')}`, role: i % 2 ? 'adult' : 'child', active: true, canLogin: false });
  await login(page); await expect(page.getByTestId('family-profile')).toHaveCount(12);
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.getByTestId('family-aggregate-profile').click();
  await expect(page.locator('.person-filters').getByRole('button', { name: 'Nowa osoba 6', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dodaj członka', exact: true })).toHaveCount(0);
});

test('dziecko ma edycję własnego profilu, bez zarządzania rodzeństwem lub profilem całej rodziny', async ({ page }) => {
  await login(page, accounts.child);
  await expect(page.getByTestId('family-aggregate-profile')).toHaveCount(0);
  const editor = await ownEditor(page);
  await expect(page.locator('#family-members-settings')).toHaveCount(0);
  await editor.getByLabel('Ikona / emoji', { exact: true }).fill('🦊');
  await editor.getByRole('button', { name: 'Zapisz profil', exact: true }).click();
  await expect(editor.locator('.account-success')).toBeVisible();
  const own = (await fixtureDatabase().doc(`members/${accounts.child.uid}`).get()).data()!;
  expect(own.emoji).toBe('🦊'); expect(own.personKey).toBe('Nikodem'); expect(own.role).toBe('child');
  expect((await fixtureDatabase().doc(`members/${accounts.sibling.uid}`).get()).data()?.name).toBe('Paweł');
});

test('Dorosły może się logować i edytować siebie, ale nie otrzymuje zarządzania rodziców', async ({ page }) => {
  await fixtureDatabase().doc(`members/${accounts.mother.uid}`).update({ role: 'adult', schoolEnabled: false });
  await login(page, accounts.mother);
  await expect(page.getByTestId('family-profile').first()).toHaveAttribute('data-uid', accounts.mother.uid);
  await expect(page.getByTestId('family-aggregate-profile')).toHaveCount(0);
  await ownEditor(page);
  await expect(page.locator('#family-members-settings')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dodaj członka', exact: true })).toHaveCount(0);
});

test('rodzic dodaje profil dorosłego bez konta tylko w Ustawieniach, bez tworzenia Authentication UID', async ({ page }) => {
  const before = (await fixtureAuth().listUsers()).users.map(user => user.uid).sort();
  await login(page); await navigate(page, 'Ustawienia');
  const section = page.locator('#family-members-settings');
  await section.getByRole('button', { name: 'Dodaj członka', exact: true }).click();
  await section.getByLabel('Imię', { exact: true }).fill('Babcia');
  await section.getByLabel('Rola', { exact: true }).selectOption('adult');
  await expect(section.getByLabel('Dostęp do logowania', { exact: true })).not.toBeChecked();
  await section.getByRole('button', { name: 'Zapisz członka', exact: true }).click();
  await expect(section.locator('.account-success')).toBeVisible();
  const profiles = await fixtureDatabase().collection('members').where('name', '==', 'Babcia').get();
  expect(profiles.size).toBe(1); expect(profiles.docs[0].data().role).toBe('adult'); expect(profiles.docs[0].data().canLogin).toBe(false);
  expect((await fixtureAuth().listUsers()).users.map(user => user.uid).sort()).toEqual(before);
  await expect(page.getByTestId('family-profile')).toHaveCount(6);
});

test('własne zdjęcie przechodzi chroniony upload, zapisuje path zamiast download tokenu i wraca po reload', async ({ page }) => {
  await fixtureDatabase().doc(`members/${accounts.parent.uid}`).update({ photoURL: '/missing-legacy-avatar.png' });
  await login(page);
  const editor = await ownEditor(page);
  await editor.getByLabel('Zdjęcie profilu', { exact: true }).setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await editor.getByRole('button', { name: 'Zapisz profil', exact: true }).click();
  await expect(editor.locator('.account-success')).toBeVisible();
  await expect(editor.locator('progress')).toHaveAttribute('value', '100');
  const saved = (await fixtureDatabase().doc(`members/${accounts.parent.uid}`).get()).data()!;
  expect(saved.avatarPath).toMatch(/^avatars\/members\/test-sebastian\/test-sebastian\/[^/]+\.png$/); expect(saved.avatarSource).toBe('custom'); expect(saved.photoURL).toBeUndefined();
  await expect(page.getByTestId('family-profile').first().locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByTestId('family-profile').first().locator('img')).toBeVisible();
  await page.reload(); await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByTestId('family-profile').first().locator('img')).toHaveAttribute('src', /^blob:/);
  const uid = await page.evaluate(async () => { const path = '/src/firebase.ts'; return (await import(path)).auth.currentUser.uid; });
  expect(uid).toBe(accounts.parent.uid);
});

test('rodzic edytuje zdjęcie dziecka i profilu bez loginu, lecz nie zdjęcie drugiego aktywnego rodzica', async ({ page }) => {
  await login(page); await navigate(page, 'Ustawienia');
  const section = page.locator('#family-members-settings');
  await expect(section.getByRole('button', { name: 'Zdjęcie i profil Dominika', exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Zdjęcie i profil Layla', exact: true }).click();
  const editor = page.getByTestId('member-profile-editor');
  await editor.getByLabel('Imię profilu', { exact: true }).fill('Lajla');
  await editor.getByLabel('Ikona / emoji', { exact: true }).fill('🐣');
  await editor.getByLabel('Zdjęcie profilu', { exact: true }).setInputFiles({ name: 'child.png', mimeType: 'image/png', buffer: png });
  await editor.getByRole('button', { name: 'Zapisz profil', exact: true }).click();
  await expect(editor.locator('.account-success')).toBeVisible();
  const saved = (await fixtureDatabase().doc(`members/${accounts.inactive.uid}`).get()).data()!;
  expect(saved.name).toBe('Lajla'); expect(saved.personKey).toBe('Layla'); expect(saved.canLogin).toBe(false);
  expect(saved.avatarPath).toMatch(/^avatars\/members\/test-inactive\/test-sebastian\//);
  await expect(page.getByTestId('family-profile').filter({ hasText: 'Lajla' }).locator('img')).toHaveAttribute('src', /^blob:/);
});

test('Cała rodzina ma chronione zdjęcie i wraca do ikony po usunięciu, bez osobnego members', async ({ page }) => {
  await login(page); await navigate(page, 'Ustawienia');
  await page.getByRole('button', { name: 'Edytuj profil rodziny', exact: true }).click();
  const editor = page.getByTestId('family-aggregate-editor');
  await editor.getByLabel('Ikona / emoji', { exact: true }).fill('🏡');
  await editor.getByLabel('Zdjęcie profilu', { exact: true }).setInputFiles({ name: 'family.png', mimeType: 'image/png', buffer: png });
  await editor.getByRole('button', { name: 'Zapisz profil', exact: true }).click();
  await expect(editor.locator('.account-success')).toBeVisible();
  await expect(page.getByTestId('family-aggregate-profile').locator('img')).toHaveAttribute('src', /^blob:/);
  await editor.getByRole('button', { name: 'Usuń zdjęcie', exact: true }).click();
  await editor.getByRole('button', { name: 'Zapisz profil', exact: true }).click();
  await expect(editor.locator('.account-success')).toBeVisible();
  await expect(page.getByTestId('family-aggregate-profile').locator('img')).toHaveCount(0);
  const metadata = (await fixtureDatabase().doc('familySettings/profile').get()).data()!;
  expect(metadata.avatarPath).toBeUndefined(); expect(metadata.avatarSource).toBe('default'); expect(metadata.emoji).toBe('🏡');
  await editor.getByRole('button', { name: 'Domyślna ikona', exact: true }).click();
  await editor.getByRole('button', { name: 'Zapisz profil', exact: true }).click();
  await expect(editor.locator('.account-success')).toBeVisible();
  expect((await fixtureDatabase().doc('familySettings/profile').get()).data()?.emoji).toBe('👨‍👩‍👧‍👦');
  expect((await fixtureDatabase().collection('members').get()).size).toBe(5);
});

test('nieobsługiwane zdjęcia nie rozpoczynają uploadu i pokazują prosty błąd', async ({ page }) => {
  await login(page); const editor = await ownEditor(page);
  await editor.getByLabel('Zdjęcie profilu', { exact: true }).setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await expect(editor.locator('.account-error')).toContainText('JPG');
  await expect(editor.locator('progress')).toHaveCount(0);
  await editor.getByLabel('Zdjęcie profilu', { exact: true }).setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(editor.locator('.account-error')).toContainText('5 MB');
  expect((await fixtureDatabase().doc(`members/${accounts.parent.uid}`).get()).data()?.avatarPath).toBeUndefined();
});

test('archiwizacja wymaga potwierdzenia, usuwa tylko aktywny profil z paska i zachowuje historię', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc('calendarEvents/archived-history').set({ title: 'Historia Layli', person: 'Layla', date: Timestamp.fromDate(new Date(`${todayKey()}T10:00:00`)), endDate: Timestamp.fromDate(new Date(`${todayKey()}T11:00:00`)), allDay: false, description: '', repeat: 'none', createdBy: accounts.parent.uid, createdAt: Timestamp.now() });
  await login(page); await navigate(page, 'Ustawienia');
  await page.getByRole('button', { name: 'Archiwizuj profil Layla', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Archiwizować profil Layla?' })).toBeVisible();
  expect((await db.doc(`members/${accounts.inactive.uid}`).get()).data()?.archived).not.toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Archiwizuj profil', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('family-profile')).toHaveCount(4);
  expect((await db.doc(`members/${accounts.inactive.uid}`).get()).data()?.archived).toBe(true);
  expect((await db.doc('calendarEvents/archived-history').get()).exists).toBe(true);
  await page.getByTestId('family-aggregate-profile').click();
  await expect(page.locator('.calendar-package')).toContainText('Historia Layli');
});

test('prywatny czat proponuje tylko konta z loginem, historia profilu pasywnego pozostaje w rozmowie rodzinnej', async ({ page }) => {
  await fixtureDatabase().doc('familyMessages/passive-history').set({ text: 'Dawny wpis profilu bez konta', uid: accounts.inactive.uid, name: 'Layla', channel: 'family', participants: [], createdAt: Timestamp.now() });
  await login(page); await navigate(page, 'Czat');
  await expect(page.getByRole('log')).toContainText('Dawny wpis profilu bez konta');
  await page.locator('.chat-mode-tabs').getByRole('button', { name: 'Prywatne', exact: true }).click();
  await expect(page.locator('.private-list')).not.toContainText('Layla');
  await expect(page.locator('.private-list .conversation-row')).toHaveCount(3);
});


test('ustawienia profili i zdjęcia rodziny mieszczą się w pięciu układach bez poziomego przewijania', async ({ page }) => {
  await login(page); await navigate(page, 'Ustawienia');
  const section = page.locator('#family-members-settings');
  await section.getByRole('button', { name: 'Edytuj profil rodziny', exact: true }).click();
  const editor = page.getByTestId('family-aggregate-editor');
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await expect(editor.getByLabel('Zdjęcie profilu', { exact: true })).toBeVisible();
    await expect(editor.getByLabel('Zdjęcie profilu', { exact: true })).toHaveAccessibleDescription(/maksymalnie 5 MB/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const detailWidths = await section.locator('.family-admin-details').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
    expect(detailWidths.every(width => width >= 120)).toBe(true);
    await expect(section.getByRole('button', { name: 'Dodaj członka', exact: true })).toHaveCSS('border-radius', '15px');
    if (test.info().project.name === 'chromium' && (size.width === 390 || size.width === 1024)) {
      await mkdir('preview/stage-3', { recursive: true });
      await section.evaluate(element => { const bottom = document.querySelector('[data-testid="family-profile-bar"]')?.getBoundingClientRect().height || 0; window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - bottom - 12, behavior: 'instant' }); });
      await page.screenshot({ path: `preview/stage-3/family-settings-${size.width === 390 ? 'phone-portrait' : 'tablet-landscape'}-after.png` });
    }
  }
});


test('szkolny awatar pokazuje odnowione chronione zdjęcie po wcześniejszym błędzie obrazu', async ({ page }) => {
  await page.route('**/api/eduvulcan/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: true, state: 'disconnected', profiles: [] } }) }));
  await login(page); await navigate(page, 'Ustawienia');
  await page.locator('#family-members-settings').getByRole('button', { name: 'Zdjęcie i profil Nikodem', exact: true }).click();
  const editor = page.getByTestId('member-profile-editor');
  await editor.getByLabel('Zdjęcie profilu', { exact: true }).setInputFiles({ name: 'student.png', mimeType: 'image/png', buffer: png });
  await editor.getByRole('button', { name: 'Zapisz profil', exact: true }).click();
  await expect(editor.locator('.account-success')).toBeVisible();
  const ref = fixtureDatabase().doc(`members/${accounts.child.uid}`);
  const path = (await ref.get()).data()!.avatarPath;
  await navigate(page, 'Szkoła');
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  const image = page.locator('.school-student-avatar img');
  await expect(image).toHaveAttribute('src', /^blob:/); await expect(image).toBeVisible();
  await ref.update({ avatarPath: FieldValue.delete(), photoURL: '/missing-student-avatar.png' });
  await expect(image).toHaveAttribute('src', '/missing-student-avatar.png'); await expect(image).toBeHidden();
  await ref.update({ avatarPath: path, photoURL: FieldValue.delete(), avatarSource: 'custom' });
  await expect(image).toHaveAttribute('src', /^blob:/); await expect(image).toBeVisible();
});
