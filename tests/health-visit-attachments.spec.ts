import { expect, test, type Page } from '@playwright/test';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { PDFDocument } from 'pdf-lib';
import { manageHealthAction } from '../server/health-service.mjs';
import { accounts, fixtureDatabase, password, projectId, seedEmulators } from './emulator-fixtures';

type Controls = { writable: boolean; failFinalize: number; preparations: number; finalizations: number; revocationRequests?: string[] };

/** Actual health service + Auth/Firestore/Storage emulators; no production transport is used. */
async function localHealthApi(page: Page, controls: Controls) {
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199') throw new Error('Local Storage emulator required');
  const db = fixtureDatabase();
  const app = getApps().find(candidate => candidate.name === 'browser-tests')!;
  const actualBucket = getStorage(app).bucket(`${projectId}.appspot.com`);
  const bucket = { file(path: string) {
    const file = actualBucket.file(path);
    const original = file.setMetadata.bind(file);
    // Spy on the real SDK request without replacing the GCS operation or pretending
    // the emulator implements token revocation correctly.
    file.setMetadata = ((metadata: { metadata?: Record<string, unknown> }, ...args: unknown[]) => {
      if (metadata.metadata?.firebaseStorageDownloadTokens === null) (controls.revocationRequests ||= []).push(path);
      return original(metadata, ...args);
    }) as typeof file.setMetadata;
    return file;
  } };
  await page.route('**/api/family/health', async route => {
    try {
      const body = route.request().postDataJSON();
      const token = route.request().headers().authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw Object.assign(new Error('No fixture auth'), { code: 'AUTH_REQUIRED', status: 401 });
      const decoded = await getAuth(app).verifyIdToken(token);
      const profile = await db.doc(`members/${decoded.uid}`).get();
      const context = { uid: decoded.uid, profile: profile.data(), app, db, bucket };
      if (['state', 'status'].includes(body.operation)) {
        const result = await manageHealthAction(context, body);
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ...result, writesEnabled: controls.writable }) }); return;
      }
      if (!controls.writable) throw Object.assign(new Error('Preview test refuses writes'), { status: 503 });
      if (body.operation === 'prepare-visit-attachment') controls.preparations++;
      if (body.operation === 'finalize-visit-attachment') {
        controls.finalizations++;
        if (controls.failFinalize-- > 0) throw Object.assign(new Error('Testowe przerwanie potwierdzenia zapisu.'), { status: 503 });
      }
      const result = await manageHealthAction(context, body);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, writesEnabled: true, ...result }) });
    } catch (value) {
      const error = value as { status?: number; code?: string; message?: string };
      await route.fulfill({ status: error.status || 500, contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { code: error.code || 'TEST_API_FAILURE', message: error.message || 'Fixture error' } }) });
    }
  });
}

async function login(page: Page) {
  await page.goto('/#Zdrowie');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.page-header h1')).toHaveText('Zdrowie');
}
async function form(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, title: string) {
  await page.getByRole('button', { name: /Dodaj wizytę \/ wpis/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Osoba', { exact: true }).selectOption('Nikodem');
  await dialog.getByLabel('Nazwa / opis', { exact: true }).fill(title);
  await dialog.getByLabel('Lekarz', { exact: true }).fill('Lekarz testowy');
  await dialog.getByLabel('Plik (PDF / zdjęcie)', { exact: true }).setInputFiles(file);
  return dialog;
}
async function generatedPDF() {
  const pdf = await PDFDocument.create(); pdf.addPage([160, 160]).drawText('Non-personal fixture', { x: 10, y: 90, size: 10 });
  return { name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function readFile(page: Page, path: string) {
  return page.evaluate(async documentPath => {
    // @ts-expect-error Vite resolves the browser module.
    const { storage, storageRef, getBlob } = await import('/src/app-shared.tsx');
    try { const blob = await getBlob(storageRef(storage, documentPath)); return { ok: true, size: blob.size, code: '' }; }
    catch (error) { return { ok: false, size: 0, code: String((error as { code?: string }).code || '') }; }
  }, path);
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await fixtureDatabase().doc(`members/${accounts.child.uid}`).update({ birthDate: '2015-01-01' });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//,
    route => route.abort('blockedbyclient'));
  await page.route('**/api/eduvulcan/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true,
    status: { configured: false, state: 'disconnected', profiles: [] } }) }));
  await page.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
});

test('real generated PDF/JPG upload, failed final save and retry preserve one visit and permit authenticated reopening', async ({ page, request }) => {
  test.info().annotations.push({ type: 'emulator-limitation', description: 'Firebase Storage Emulator 15 keeps downloadTokens separately and regenerates them during Firebase GET. This test verifies the actual Admin null-removal request plus anonymous/foreign-UID Rules denials. Real-cloud bearer-token revocation requires verification before enabling production uploads.' });
  const controls: Controls = { writable: true, failFinalize: 1, preparations: 0, finalizations: 0 };
  await localHealthApi(page, controls); await login(page);
  const pdf = await generatedPDF();
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#c8c8ff'; ctx.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const files = [pdf, { name: 'fixture.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') }];
  let lastPath = '';
  for (const file of files) {
    const title = `Wizyta z ${file.name}`;
    const dialog = await form(page, file, title);
    await dialog.getByRole('button', { name: /Zapisz$/ }).click();
    if (file === pdf) {
      await expect(dialog.getByTestId('health-save-stage')).toContainText('zapis wizyty nie został potwierdzony');
      await expect(dialog.getByLabel('Nazwa / opis', { exact: true })).toHaveValue(title);
      await expect(dialog.getByLabel('Lekarz', { exact: true })).toHaveValue('Lekarz testowy');
      expect((await fixtureDatabase().collection('healthRecords').where('title', '==', title).get()).size).toBe(0);
      await expect(dialog.getByTestId('health-upload-progress')).toContainText('100%');
      await dialog.getByRole('button', { name: /Zapisz$/ }).click();
    }
    await expect(dialog).toHaveCount(0);
    const records = await fixtureDatabase().collection('healthRecords').where('title', '==', title).get(); expect(records.size).toBe(1);
    const record = records.docs[0].data(); expect(record.documentURL).toBe(''); expect(record.documentPath).toBe('');
    const document = (await fixtureDatabase().doc(`healthDocuments/${record.attachmentDocumentId}`).get()).data()!;
    lastPath = document.storagePath;
    expect(document.state).toBe('ready'); expect(await readFile(page, document.storagePath)).toEqual({ ok: true, size: file.buffer.length, code: '' });
    await page.locator('.health-manager article').filter({ hasText: title }).getByRole('button', { name: 'Plik', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Pobierz', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Zamknij', exact: true }).click();
    expect(controls.revocationRequests).toContain(document.storagePath);
    const anonymous = await request.get(`http://127.0.0.1:9199/v0/b/${projectId}.appspot.com/o/${encodeURIComponent(document.storagePath)}?alt=media`);
    expect(anonymous.status()).toBe(403);
  }
  expect(controls.preparations).toBe(2); expect(controls.finalizations).toBe(3);
  await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the browser module.
    const { auth, signOut } = await import('/src/app-shared.tsx'); await signOut(auth);
  });
  expect((await readFile(page, lastPath)).code).toBe('storage/unauthorized');
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.sibling.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  expect((await readFile(page, lastPath)).code).toBe('storage/unauthorized');
});

test('0% Storage denial keeps the form and safe error code, then retries the same ticket successfully', async ({ page }) => {
  const controls = { writable: true, failFinalize: 0, preparations: 0, finalizations: 0 };
  await localHealthApi(page, controls); await login(page);
  const dialog = await form(page, await generatedPDF(), 'Przerwany upload testowy');
  let rejected = false;
  await page.route('http://127.0.0.1:9199/**', async route => {
    if (route.request().method() === 'POST' && !rejected) {
      rejected = true;
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: 'Test Storage denial' } }) });
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: /Zapisz$/ }).click();
  await expect(dialog.getByTestId('health-upload-progress')).toHaveAttribute('data-phase', 'error');
  await expect(dialog.getByTestId('health-upload-progress')).toContainText('0%');
  await expect(dialog.getByTestId('health-upload-error-code')).toContainText('storage/unauthorized');
  await expect(dialog.getByLabel('Lekarz', { exact: true })).toHaveValue('Lekarz testowy');
  const drafts = await fixtureDatabase().collection('healthDocuments').where('state', '==', 'draft').get(); expect(drafts.size).toBe(1);
  await dialog.getByRole('button', { name: /Zapisz$/ }).click(); await expect(dialog).toHaveCount(0);
  expect(controls.preparations).toBe(1); expect(controls.finalizations).toBe(1);
  expect((await fixtureDatabase().collection('healthRecords').where('title', '==', 'Przerwany upload testowy').get()).size).toBe(1);
});

test('a result PDF uses the protected document path and creates no calendar appointment', async ({ page }) => {
  const controls: Controls = { writable: true, failFinalize: 0, preparations: 0, finalizations: 0 };
  await localHealthApi(page, controls); await login(page);
  const dialog = await form(page, await generatedPDF(), 'Wynik testowy bez danych medycznych');
  await dialog.getByLabel('Rodzaj', { exact: true }).selectOption('result');
  await dialog.getByRole('button', { name: /Zapisz$/ }).click();
  await expect(dialog).toBeHidden();
  const rows = await fixtureDatabase().collection('healthRecords').where('title', '==', 'Wynik testowy bez danych medycznych').get();
  expect(rows.size).toBe(1);
  const record = rows.docs[0].data(); expect(record.type).toBe('result'); expect(record.documentPath).toBe('');
  const document = await fixtureDatabase().doc(`healthDocuments/${record.attachmentDocumentId}`).get();
  expect(document.data()?.state).toBe('ready'); expect(document.data()?.storagePath).toMatch(/^healthDocuments\//);
  expect((await fixtureDatabase().collection('calendarEvents').where('sourceRecordId', '==', rows.docs[0].id).get()).size).toBe(0);
});

test('backend read-only state blocks upload and visit writes without relying on a frontend Preview flag', async ({ page }) => {
  const controls = { writable: false, failFinalize: 0, preparations: 0, finalizations: 0 };
  await localHealthApi(page, controls); await login(page);
  const before = (await fixtureDatabase().collection('healthRecords').get()).size;
  const dialog = await form(page, await generatedPDF(), 'Read-only fixture');
  await expect(dialog.getByRole('button', { name: /Zapisz$/ })).toBeDisabled();
  await expect(dialog).toContainText('Zapisywanie jest wyłączone');
  await expect(dialog.getByLabel('Nazwa / opis', { exact: true })).toHaveValue('Read-only fixture');
  expect(controls.preparations).toBe(0); expect(controls.finalizations).toBe(0);
  expect((await fixtureDatabase().collection('healthRecords').get()).size).toBe(before);
  expect((await fixtureDatabase().collection('healthDocuments').get()).size).toBe(0);
});
