import { expect, test, type Page } from '@playwright/test';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { manageHealthAction } from '../server/health-service.mjs';

const viewports = [{ width: 390, height: 844 }, { width: 844, height: 390 },
  { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }];

async function login(page: Page, module: 'Zadania' | 'Zdrowie') {
  await page.goto(`/#${encodeURIComponent(module)}`);
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.page-header h1')).toHaveText(module);
}

async function noPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await seedEmulators(); // Guarded demo project and localhost emulators only.
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//, route => route.abort('blockedbyclient'));
  await page.route('**/api/eduvulcan/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) }));
  await page.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
});

test('Tasks preserves existing household reads when its backend is unavailable and serializes the three verification modes using an explicit API stub', async ({ page }) => {
  let backendAvailable = false;
  const submittedDrafts: Array<Record<string, unknown>> = [];
  // This is a UI-only API stub. Transactions, points and Storage deletion are
  // verified separately by family-v2-critical.test.mjs, not by these responses.
  await page.route('**/api/family/tasks', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === 'state') {
      if (!backendAvailable) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false,
        error: { code: 'TEST_BACKEND_UNAVAILABLE', message: 'Backend testowy nie jest skonfigurowany.' } }) });
      else await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, writesEnabled: true,
        storageConfigured: true, balances: [], rewards: [], requests: [], history: [] }) });
      return;
    }
    expect(backendAvailable).toBe(true);
    expect(body.action).toBe('save-task');
    submittedDrafts.push(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, taskId: body.id }) });
  });
  await login(page, 'Zadania');
  const tasks = page.getByTestId('tasks-v2');
  await expect(tasks).toContainText('Wynieść śmieci — test zatwierdzania');
  await expect(tasks).toContainText('Zadanie Pawła');
  await expect(tasks.locator('.tasks-setup-note')).toContainText('Istniejące zadania gospodarstwa pozostają dostępne.');
  await expect(tasks.getByRole('button', { name: '＋ Dodaj zadanie', exact: true })).toBeDisabled();
  await expect(tasks.getByRole('button', { name: 'Oznacz wykonanie: Wynieść śmieci — test zatwierdzania', exact: true })).toBeDisabled();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(tasks.locator('.tasks-main-grid')).toBeVisible();
    await noPageOverflow(page);
  }

  backendAvailable = true;
  await page.reload();
  await expect(tasks.getByRole('button', { name: '＋ Dodaj zadanie', exact: true })).toBeEnabled();
  for (const mode of ['trust', 'parent', 'photo'] as const) {
    await tasks.getByRole('button', { name: '＋ Dodaj zadanie', exact: true }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Zadanie', { exact: true }).fill(`Formularz testowy ${mode}`);
    await form.getByLabel('Osoba', { exact: true }).selectOption('Nikodem');
    await form.getByLabel('Punkty', { exact: true }).fill('7');
    await form.getByRole('combobox', { name: 'Potwierdzenie wykonania', exact: true }).selectOption(mode);
    await expect(form.getByRole('combobox', { name: 'Potwierdzenie wykonania', exact: true })).toHaveValue(mode);
    if (mode === 'photo') {
      await expect(form).toContainText('Zdjęcie jest wymagane przy zgłoszeniu.');
      for (const viewport of viewports) { await page.setViewportSize(viewport); await noPageOverflow(page); }
    }
    await form.getByRole('button', { name: 'Zapisz zadanie', exact: true }).click();
    await expect(form).toHaveCount(0);
  }
  expect(submittedDrafts.map(draft => draft.verificationMode)).toEqual(['trust', 'parent', 'photo']);
  expect(submittedDrafts.every(draft => draft.person === 'Nikodem' && draft.points === 7)).toBe(true);
  // A fulfilled API stub must not pretend to have created actual Firestore tasks.
  expect((await fixtureDatabase().collection('tasks').get()).size).toBe(2);
});

test('Health Documents renders its compact UI and actual emulator queries deny another UID document even to a parent', async ({ page }) => {
  await page.route('**/api/family/health', async route => {
    // The local transport uses the real authorized list service. Direct-document
    // permission denial below still uses the browser SDK and emulator Rules.
    expect(route.request().postDataJSON().operation).toBe('state');
    const app = getApps().find(candidate => candidate.name === 'browser-tests')!;
    const token = route.request().headers().authorization?.replace(/^Bearer /, '') || '';
    const decoded = await getAuth(app).verifyIdToken(token);
    const result = await manageHealthAction({ db: fixtureDatabase(), uid: decoded.uid }, { operation: 'state' });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ...result, writesEnabled: false }) });
  });
  function protectedDocument(id: string, title: string, readers: string[]) {
    return { title, documentType: 'general', ownerProfileId: accounts.sibling.uid, ownerUid: accounts.sibling.uid,
      ownerPersonKey: 'Paweł', readers, editors: readers, createdBy: readers[0], state: 'ready', protected: true,
      storagePath: `healthDocuments/${id}/${readers[0]}/test.pdf`, mimeType: 'application/pdf', fileName: 'test.pdf',
      size: 16, issuedOn: '2026-01-02', expiresOn: '', indefinite: true, number: '', note: '', pinned: true, shareOwner: false };
  }
  await Promise.all([
    fixtureDatabase().doc('healthDocuments/v2-allowed').set(protectedDocument('v2-allowed', 'Dokument testowy z dostępem rodzica', [accounts.parent.uid])),
    fixtureDatabase().doc('healthDocuments/v2-other-uid').set(protectedDocument('v2-other-uid', 'Dokument testowy tylko innego UID', [accounts.mother.uid])),
  ]);
  await login(page, 'Zdrowie');
  await page.getByRole('navigation', { name: 'Sekcje zdrowia' }).getByRole('button', { name: 'Dokumenty', exact: true }).click();
  await page.getByRole('region', { name: 'Wybór kartoteki zdrowia' }).getByRole('combobox', { name: 'Osoba', exact: true }).selectOption('Paweł');
  const documents = page.getByRole('region', { name: 'Chronione dokumenty zdrowotne' });
  await expect(documents).toContainText('Dokument testowy z dostępem rodzica');
  await expect(documents).not.toContainText('Dokument testowy tylko innego UID');
  await expect(documents.locator('.health-important-document-types > button')).toHaveCount(3);
  await expect(documents).toContainText('Sama rola rodzica nie daje dostępu.');

  const actualAccess = await page.evaluate(async (uid) => {
    // @ts-expect-error Vite resolves this project module inside the browser.
    const { db, getDoc, doc } = await import('/src/app-shared.tsx');
    // @ts-expect-error Vite resolves this project module inside the browser.
    const { healthDocumentAction } = await import('/src/health/health-api.ts');
    const visible = await healthDocumentAction({ operation: 'state' });
    let denied = '';
    try { await getDoc(doc(db, 'healthDocuments', 'v2-other-uid')); }
    catch (error) { denied = String((error as { code?: string }).code || ''); }
    return { ids: visible.documents.map((item: { id: string }) => item.id), denied };
  }, accounts.parent.uid);
  expect(actualAccess.ids).toEqual(['v2-allowed']);
  expect(actualAccess.denied).toBe('permission-denied');
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(documents).toBeVisible();
    await noPageOverflow(page);
  }
  await documents.getByRole('button', { name: 'Dodaj dokument +', exact: true }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByRole('combobox', { name: 'Właściciel dokumentu', exact: true })).toHaveValue(accounts.sibling.uid);
  await expect(form.getByRole('checkbox', { name: 'Udostępnij dokument osobie: Paweł', exact: true })).not.toBeChecked();
  await expect(form.getByRole('button', { name: 'Zapisz dokument', exact: true })).toBeDisabled();
  await expect(form).toContainText('Podgląd formularza — zapisywanie jest wyłączone.');
  for (const viewport of viewports) { await page.setViewportSize(viewport); await noPageOverflow(page); }
});
