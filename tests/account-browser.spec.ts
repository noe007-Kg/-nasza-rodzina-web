import { expect, test, type Page } from '@playwright/test';
import { getAuth } from 'firebase-admin/auth';
import { getApps } from 'firebase-admin/app';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';
import { mkdir } from 'node:fs/promises';

function fixtureAuth() { fixtureDatabase(); return getAuth(getApps().find((app) => app.name === 'browser-tests')!); }
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}
async function settings(page: Page) {
  await page.evaluate(() => { location.hash = encodeURIComponent('Ustawienia'); });
  await expect(page.locator('#account-login')).toBeVisible();
}
async function oobCodes() {
  const response = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-nasza-rodzina/oobCodes');
  if (!response.ok) throw new Error('Local Auth OOB codes unavailable');
  return (await response.json()).oobCodes as Array<{ requestType: string; email: string; newEmail?: string; oobCode: string }>;
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  // Account tests may change e-mail/providers; restore the same emulator UID, never production users.
  await fixtureAuth().updateUser(accounts.parent.uid, { email: accounts.parent.email, password, providersToUnlink: ['google.com'] });
  await fixtureAuth().updateUser(accounts.mother.uid, { email: accounts.mother.email, password, providersToUnlink: ['google.com'] });
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 19, weather_code: 1, wind_speed_10m: 8 }, daily: { temperature_2m_max: [22], temperature_2m_min: [12] } }) }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, (route) => { throw new Error(`Production Firebase is forbidden in tests: ${route.request().url()}`); });
});

test('logowanie: wspólne SVG i subtelny reset w jednej linii przy pięciu szerokościach', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('.login-v11-features svg')).toHaveCount(7);
  const sizes = [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expect(page.getByRole('button', { name: 'Przypomnij hasło', exact: true })).toBeVisible();
    const geometry = await page.locator('.login-password-reset').evaluate((row) => {
      const text = row.querySelector('span')!.getBoundingClientRect();
      const link = row.querySelector('button')!.getBoundingClientRect();
      return { textTop: text.top, linkTop: link.top, textBottom: text.bottom, linkBottom: link.bottom, scroll: document.documentElement.scrollWidth, width: window.innerWidth };
    });
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    expect(Math.max(geometry.textTop, geometry.linkTop)).toBeLessThan(Math.min(geometry.textBottom, geometry.linkBottom));
  }
  if (info.project.name === 'chromium') {
    await mkdir('preview', { recursive: true });
    await page.screenshot({ path: 'preview/account-login.png', fullPage: true });
    await page.locator('.login-password-reset').screenshot({ path: 'preview/account-password-reset.png' });
  }
});

test('przypomnienie używa istniejącego Firebase resetu hasła, a e-mail/hasło nadal loguje do tego samego UID', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  const previousCodes = (await oobCodes()).filter((code) => code.requestType === 'PASSWORD_RESET' && code.email === accounts.parent.email).length;
  await page.getByRole('button', { name: 'Przypomnij hasło', exact: true }).click();
  await expect.poll(async () => (await oobCodes()).filter((code) => code.requestType === 'PASSWORD_RESET' && code.email === accounts.parent.email).length).toBeGreaterThan(previousCodes);
  const code = (await oobCodes()).filter((row) => row.requestType === 'PASSWORD_RESET' && row.email === accounts.parent.email).at(-1)!;
  const newPassword = 'NewFamilyTest!2026';
  try {
    await page.evaluate(async ({ oobCode, next }) => {
      const firebasePath = '/src/firebase.ts'; const authPath = '/node_modules/.vite/deps/firebase_auth.js';
      const { auth } = await import(firebasePath); const sdk = await import(authPath);
      await sdk.confirmPasswordReset(auth, oobCode, next);
    }, { oobCode: code.oobCode, next: newPassword });
    await page.getByLabel('Hasło', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
    await expect(page.locator('.app-shell')).toBeVisible();
    const uid = await page.evaluate(async () => { const path = '/src/firebase.ts'; return (await import(path)).auth.currentUser.uid; });
    expect(uid).toBe(accounts.parent.uid);
    expect((await fixtureDatabase().doc(`members/${uid}`).get()).data()?.name).toBe(accounts.parent.name);
  } finally { await fixtureAuth().updateUser(accounts.parent.uid, { password }); }
});

test('Konto i logowanie: zmiana adresu po potwierdzeniu zachowuje UID, profil i historię', async ({ page }, info) => {
  await login(page); await settings(page);
  const before = (await fixtureDatabase().doc(`members/${accounts.parent.uid}`).get()).data();
  const newEmail = 'sebastian-new-address@example.test';
  try {
    if (info.project.name === 'chromium') await page.locator('#account-login').screenshot({ path: 'preview/account-settings.png' });
    await page.locator('#account-login').getByRole('button', { name: 'Zmień e-mail', exact: true }).click();
    await page.getByLabel('Aktualne hasło', { exact: true }).fill(password);
    await page.getByLabel('Nowy e-mail', { exact: true }).fill(newEmail);
    await page.getByRole('button', { name: 'Wyślij link potwierdzający', exact: true }).click();
    await expect(page.locator('#account-login .account-success')).toContainText('Wysłano link');
    expect((await fixtureAuth().getUser(accounts.parent.uid)).email).toBe(accounts.parent.email);
    await expect.poll(async () => (await oobCodes()).filter((row) => row.requestType === 'VERIFY_AND_CHANGE_EMAIL' && row.newEmail === newEmail).length).toBeGreaterThan(0);
    const code = (await oobCodes()).filter((row) => row.requestType === 'VERIFY_AND_CHANGE_EMAIL' && row.newEmail === newEmail).at(-1)!;
    await page.evaluate(async (oobCode) => {
      const firebasePath = '/src/firebase.ts'; const authPath = '/node_modules/.vite/deps/firebase_auth.js';
      const { auth } = await import(firebasePath); const sdk = await import(authPath);
      await sdk.applyActionCode(auth, oobCode); await sdk.reload(auth.currentUser);
    }, code.oobCode);
    const account = await fixtureAuth().getUser(accounts.parent.uid);
    expect(account.uid).toBe(accounts.parent.uid); expect(account.email).toBe(newEmail);
    expect((await fixtureDatabase().doc(`members/${accounts.parent.uid}`).get()).data()).toEqual(before);
    expect((await fixtureDatabase().collection('tasks').where('createdBy', '==', accounts.parent.uid).get()).empty).toBe(false);
  } finally { await fixtureAuth().updateUser(accounts.parent.uid, { email: accounts.parent.email, password }); }
});

test('łączenie i odłączanie Google przez rzeczywisty SDK emulatora nie tworzy drugiego UID ani members', async ({ page }) => {
  await login(page);
  const auth = fixtureAuth();
  const beforeUsers = (await auth.listUsers()).users.map((user) => user.uid).sort();
  const beforeMembers = (await fixtureDatabase().collection('members').get()).docs.map((row) => row.id).sort();
  try {
    const result = await page.evaluate(async ({ email }) => {
      const firebasePath = '/src/firebase.ts'; const authPath = '/node_modules/.vite/deps/firebase_auth.js';
      const { auth } = await import(firebasePath); const sdk = await import(authPath);
      const originalUid = auth.currentUser.uid;
      // The Auth emulator explicitly accepts synthetic provider identity JSON; production never does.
      const credential = sdk.GoogleAuthProvider.credential(JSON.stringify({ sub: 'test-existing-google-subject', email, email_verified: true }));
      const linked = await sdk.linkWithCredential(auth.currentUser, credential);
      return { originalUid, linkedUid: linked.user.uid };
    }, { email: accounts.parent.email });
    expect(result).toEqual({ originalUid: accounts.parent.uid, linkedUid: accounts.parent.uid });
    await page.reload(); await expect(page.locator('.app-shell')).toBeVisible(); await settings(page);
    await expect(page.locator('#account-login')).toContainText('Połączono');
    await page.locator('#account-login').getByRole('button', { name: 'Odłącz Google', exact: true }).click();
    await expect(page.locator('#account-login')).toContainText('Google odłączone');
    expect((await auth.getUser(accounts.parent.uid)).providerData.map((provider) => provider.providerId)).toEqual(['password']);
    expect((await auth.listUsers()).users.map((user) => user.uid).sort()).toEqual(beforeUsers);
    expect((await fixtureDatabase().collection('members').get()).docs.map((row) => row.id).sort()).toEqual(beforeMembers);
  } finally { await auth.updateUser(accounts.parent.uid, { providersToUnlink: ['google.com'] }); }
});

test('Google zajęte przez inne UID jest odrzucane bez przełączenia bieżącego konta', async ({ page }) => {
  const auth = fixtureAuth();
  await auth.updateUser(accounts.mother.uid, { providerToLink: { providerId: 'google.com', uid: 'test-google-owned-by-mother', email: accounts.mother.email } });
  await login(page);
  try {
    const result = await page.evaluate(async (email) => {
      const firebasePath = '/src/firebase.ts'; const authPath = '/node_modules/.vite/deps/firebase_auth.js'; const accountPath = '/src/account/account-client.ts';
      const { auth } = await import(firebasePath); const sdk = await import(authPath); const account = await import(accountPath);
      try {
        await sdk.linkWithCredential(auth.currentUser, sdk.GoogleAuthProvider.credential(JSON.stringify({ sub: 'test-google-owned-by-mother', email, email_verified: true })));
        return { uid: auth.currentUser.uid, code: '' };
      } catch (error) { return { uid: auth.currentUser.uid, code: (error as { code?: string }).code, message: account.accountActionMessage(error) }; }
    }, accounts.mother.email);
    expect(result.uid).toBe(accounts.parent.uid); expect(result.code).toBe('auth/credential-already-in-use');
    expect(result.message).toContain('innym kontem Firebase');
    expect((await auth.getUser(accounts.parent.uid)).providerData.map((provider) => provider.providerId)).toEqual(['password']);
    expect((await fixtureDatabase().collection('members').get()).size).toBe(5);
  } finally { await auth.updateUser(accounts.mother.uid, { providersToUnlink: ['google.com'] }); }
});

test('odłączenie ostatniego providera jest blokowane przez wspólną funkcję konta', async ({ page }) => {
  await login(page);
  const outcome = await page.evaluate(async () => {
    const accountPath = '/src/account/account-client.ts'; const sdk = await import(accountPath);
    const syntheticUser = { providerData: [{ providerId: 'google.com' }] };
    try { await sdk.unlinkGoogleFromAccount(syntheticUser); return ''; }
    catch (error) { return (error as { code?: string }).code; }
  });
  expect(outcome).toBe('ACCOUNT_LAST_PROVIDER');
  expect((await fixtureAuth().getUser(accounts.parent.uid)).uid).toBe(accounts.parent.uid);
});
