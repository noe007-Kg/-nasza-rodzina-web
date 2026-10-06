import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';

type Account = (typeof accounts)[keyof typeof accounts];

async function login(page: Page, account: Account = accounts.parent) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function openModule(page: Page, name: 'Czat' | 'Zdrowie') {
  await page.evaluate((module) => { location.hash = encodeURIComponent(module); }, name);
  await expect(page.locator('.page-header h1')).toHaveText(name);
}

async function signOut(page: Page) {
  await page.evaluate(async () => {
    // Browser module import keeps the same emulator-authenticated Firebase app.
    // @ts-expect-error Vite resolves this project module inside the browser.
    const { auth, signOut } = await import('/src/app-shared.tsx');
    await signOut(auth);
  });
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
}

async function readProtectedFile(page: Page, path: string) {
  return page.evaluate(async (documentPath) => {
    // @ts-expect-error Vite resolves this project module inside the browser.
    const { storage, storageRef, getBlob } = await import('/src/app-shared.tsx');
    try {
      const blob = await getBlob(storageRef(storage, documentPath));
      return { ok: true, size: blob.size, code: '' };
    } catch (error) {
      return { ok: false, size: 0, code: String((error as { code?: string }).code || '') };
    }
  }, path);
}

async function prepareUpload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, title: string, privateToParents = false) {
  await page.getByRole('button', { name: /Dodaj wizytę \/ wpis/ }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Osoba', { exact: true }).selectOption('Nikodem');
  await modal.getByLabel('Rodzaj', { exact: true }).selectOption('result');
  await modal.getByLabel('Nazwa / opis', { exact: true }).fill(title);
  await modal.getByLabel('Widoczne tylko dla rodziców', { exact: false }).setChecked(privateToParents);
  await modal.getByLabel('Plik (PDF / zdjęcie)', { exact: true }).setInputFiles(file);
  return modal;
}

async function uploadedRecord(title: string) {
  const snapshot = await fixtureDatabase().collection('healthRecords').where('title', '==', title).get();
  expect(snapshot.size).toBe(1);
  return snapshot.docs[0].data();
}

async function expectComposerVisible(page: Page, bottomLimit?: number) {
  await expect(page.locator('.chat-composer input')).toBeVisible();
  await expect(page.locator('.chat-composer button[type="submit"]')).toBeVisible();
  // Viewport changes are measured on the next animation frame. Wait for the
  // resulting layout, while still failing if the private list expands its row.
  const geometry = () => page.evaluate(() => {
    const composer = document.querySelector('.chat-composer')!.getBoundingClientRect();
    const chat = document.querySelector('.chat-page')!.getBoundingClientRect();
    const navigation = document.querySelector('.mobile-navigation');
    const navVisible = navigation && getComputedStyle(navigation).display !== 'none';
    return {
      composerTop: composer.top, composerBottom: composer.bottom,
      chatBottom: chat.bottom,
      bottom: navVisible ? navigation!.getBoundingClientRect().top : window.innerHeight,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  await expect.poll(async () => {
    const measured = await geometry();
    return measured.composerBottom - (bottomLimit ?? measured.bottom);
  }).toBeLessThanOrEqual(1);
  const measured = await geometry();
  expect(measured.composerTop).toBeGreaterThanOrEqual(0);
  expect(measured.composerBottom).toBeLessThanOrEqual(measured.chatBottom + 1);
  expect(measured.chatBottom).toBeLessThanOrEqual((bottomLimit ?? measured.bottom) + 1);
  expect(measured.overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      current: { temperature_2m: 19, weather_code: 1, wind_speed_10m: 8 },
      daily: { temperature_2m_max: [22], temperature_2m_min: [12] },
    }),
  }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, (route) => {
    throw new Error(`Chat/health tests forbid production Firebase: ${route.request().url()}`);
  });
});

test('family/private composers remain above navigation in all five viewport variants', async ({ page, browserName }) => {
  await login(page);
  await openModule(page, 'Czat');
  for (const size of [
    { width: 390, height: 844 }, { width: 844, height: 390 },
    { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.locator('.chat-mode-tabs').getByRole('button', { name: 'Rodzina', exact: true }).click();
    await expect(page.locator('.chat-messages')).toContainText('Wspólna wiadomość testowa');
    await expect.poll(async () => page.locator('.chat-page').evaluate((node) => node.style.getPropertyValue('--chat-available-height'))).not.toBe('');
    await expectComposerVisible(page);
    await page.locator('.chat-mode-tabs').getByRole('button', { name: 'Prywatne', exact: true }).click();
    await page.locator('.private-list').getByRole('button', { name: /Dominika/ }).click();
    await expect(page.locator('.chat-room-header')).toContainText('Dominika');
    await expect(page.locator('.chat-messages')).toContainText('Poufna rozmowa rodziców');
    await expectComposerVisible(page);
  }
  if (browserName === 'chromium') {
    await page.setViewportSize({ width: 390, height: 844 });
    await mkdir('preview', { recursive: true });
    await page.screenshot({ path: 'preview/private-chat.png', fullPage: true });
  }
});

test('private composer follows a reduced visual viewport without changing the conversation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, accounts.child);
  await openModule(page, 'Czat');
  await page.locator('.chat-mode-tabs').getByRole('button', { name: 'Prywatne', exact: true }).click();
  await page.locator('.private-list').getByRole('button', { name: /Sebastian/ }).click();
  await page.getByLabel('Treść wiadomości', { exact: true }).focus();
  // Desktop browser engines cannot open an iOS software keyboard. This exercises
  // the same visualViewport resize event using a measured keyboard-sized viewport.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, get: () => 350 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.chat-page')).toHaveAttribute('data-keyboard-open', 'true');
  await expectComposerVisible(page, 350);
  await page.getByLabel('Treść wiadomości', { exact: true }).fill('Wiadomość przy otwartej klawiaturze');
  await page.getByRole('button', { name: 'Wyślij', exact: true }).click();
  await expect(page.locator('.chat-messages')).toContainText('Wiadomość przy otwartej klawiaturze');
});

test('important family messages are newest-first at the top and stars stay individual to the UID', async ({ page, browserName }) => {
  for (const [id, text, offset] of [['older-important', 'Starsza ważna informacja rodzinna', 1000], ['newer-important', 'Nowsza ważna informacja rodzinna', 2000]] as const) {
    await fixtureDatabase().doc(`familyMessages/${id}`).set({
      text, uid: accounts.mother.uid, name: accounts.mother.name,
      channel: 'family', participants: [], createdAt: new Date(Date.now() + offset),
    });
  }
  await login(page);
  await openModule(page, 'Czat');
  for (const text of ['Starsza ważna informacja rodzinna', 'Nowsza ważna informacja rodzinna']) {
    await page.locator('.chat-message-line').filter({ hasText: text }).getByRole('button', { name: 'Oznacz wiadomość jako ważną', exact: true }).click();
    await expect(page.locator('.chat-message-line').filter({ hasText: text }).getByRole('button', { name: 'Usuń wiadomość z ważnych', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('.chat-message-line').nth(0)).toContainText('Nowsza ważna informacja rodzinna');
  await expect(page.locator('.chat-message-line').nth(1)).toContainText('Starsza ważna informacja rodzinna');
  // Firestore updates the visible stars optimistically. Verify the committed
  // server document before reloading or switching users, rather than racing ACK.
  await expect.poll(async () => {
    const ownPreference = (await fixtureDatabase().doc(`userPreferences/${accounts.parent.uid}`).get()).data();
    return [...(ownPreference?.importantItems || [])].sort();
  }).toEqual(['chat:message:newer-important', 'chat:message:older-important']);
  await page.reload();
  await expect(page.locator('.chat-message-line').nth(0)).toContainText('Nowsza ważna informacja rodzinna');
  if (browserName === 'chromium') {
    await mkdir('preview', { recursive: true });
    await page.screenshot({ path: 'preview/important-family-messages.png', fullPage: true });
  }
  await signOut(page);
  await login(page, accounts.mother);
  await openModule(page, 'Czat');
  await expect(page.locator('.chat-message-star[aria-pressed="true"]')).toHaveCount(0);
});

test('PDF, JPG, JPEG and PNG upload to protected Storage and reopen through authenticated SDK reads', async ({ page }) => {
  await login(page);
  await openModule(page, 'Zdrowie');
  const jpeg = await readFile('public/sidebar-sunset.jpg');
  const png = await readFile('public/icons/icon-192.png');
  const files = [
    { name: 'medical-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
    { name: 'medical-test.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'medical-test.jpeg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'medical-test.png', mimeType: 'image/png', buffer: png },
  ];
  for (const file of files) {
    const title = `Dokument testowy ${file.name}`;
    const modal = await prepareUpload(page, file, title);
    await modal.getByRole('button', { name: /Zapisz$/ }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('health-upload-progress')).toContainText('✓ Przesłano');
    await expect(page.getByTestId('health-upload-progress')).toContainText('100%');
    const record = await uploadedRecord(title);
    expect(record.documentURL).toBe('');
    expect(record.documentPath).toMatch(/^health\/shared\/Nikodem\/test-sebastian\//);
    expect(await readProtectedFile(page, record.documentPath)).toEqual({ ok: true, size: file.buffer.length, code: '' });
    const response = page.waitForResponse((candidate) => candidate.url().includes(':9199/') && candidate.request().method() === 'GET');
    await page.locator('.document-row').filter({ hasText: title }).getByRole('button', { name: 'Otwórz', exact: true }).click();
    expect((await response).ok()).toBe(true);
  }
});

test('failed Storage upload never reports success and the selected file can be retried', async ({ page }) => {
  await login(page);
  await openModule(page, 'Zdrowie');
  const modal = await prepareUpload(page, { name: 'retry-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') }, 'Dokument po błędzie');
  const denyUpload = async (route: import('@playwright/test').Route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: 'Permission denied.' } }) });
    else await route.continue();
  };
  await page.route('http://127.0.0.1:9199/**', denyUpload);
  await modal.getByRole('button', { name: /Zapisz$/ }).click();
  await expect(page.getByTestId('health-upload-progress')).toHaveAttribute('data-phase', 'error');
  await expect(page.getByTestId('health-upload-progress')).not.toContainText('100%');
  await expect(page.getByTestId('health-upload-progress')).toContainText('spróbować ponownie');
  expect((await fixtureDatabase().collection('healthRecords').where('title', '==', 'Dokument po błędzie').get()).size).toBe(0);
  await page.unroute('http://127.0.0.1:9199/**', denyUpload);
  await modal.getByRole('button', { name: /Zapisz$/ }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId('health-upload-progress')).toHaveAttribute('data-phase', 'uploaded');
  expect((await uploadedRecord('Dokument po błędzie')).documentURL).toBe('');
});

test('private health blobs deny children and anonymous access while an own shared file remains readable', async ({ page }) => {
  await login(page);
  await openModule(page, 'Zdrowie');
  const file = { name: 'privacy-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') };
  let modal = await prepareUpload(page, file, 'Prywatny plik rodziców', true);
  await modal.getByRole('button', { name: /Zapisz$/ }).click();
  await expect(modal).toHaveCount(0);
  const privatePath = (await uploadedRecord('Prywatny plik rodziców')).documentPath as string;
  modal = await prepareUpload(page, file, 'Wspólny plik Nikodema');
  await modal.getByRole('button', { name: /Zapisz$/ }).click();
  await expect(modal).toHaveCount(0);
  const sharedPath = (await uploadedRecord('Wspólny plik Nikodema')).documentPath as string;
  expect((await readProtectedFile(page, privatePath)).ok).toBe(true);
  await signOut(page);
  expect((await readProtectedFile(page, privatePath)).code).toBe('storage/unauthorized');
  await login(page, accounts.child);
  await openModule(page, 'Zdrowie');
  await expect(page.locator('.health-manager')).not.toContainText('Prywatny plik rodziców');
  expect((await readProtectedFile(page, privatePath)).code).toBe('storage/unauthorized');
  expect((await readProtectedFile(page, sharedPath)).ok).toBe(true);
  await signOut(page);
  await login(page, accounts.sibling);
  expect((await readProtectedFile(page, sharedPath)).code).toBe('storage/unauthorized');
});

test('real resumable upload shows an intermediate progress preview before final completion', async ({ page, browserName }) => {
  await login(page);
  await openModule(page, 'Zdrowie');
  const totalBytes = 7 * 512 * 1024;
  const file = Buffer.alloc(totalBytes);
  Buffer.from('%PDF-1.4\n').copy(file);
  const modal = await prepareUpload(page, { name: 'progress-test.pdf', mimeType: 'application/pdf', buffer: file }, 'Dokument testowy — postęp');
  let held = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('http://127.0.0.1:9199/**', async (route) => {
    const request = route.request();
    const offset = Number(request.headers()['x-goog-upload-offset'] || 0);
    if (request.method() === 'POST' && offset >= totalBytes / 2 && !held) {
      held = true;
      await gate;
    }
    await route.continue();
  });
  try {
    await modal.getByRole('button', { name: /Zapisz$/ }).click();
    await expect.poll(() => held).toBe(true);
    await expect(page.getByTestId('health-upload-progress')).toContainText('50%');
    await expect(page.getByTestId('health-upload-progress')).toHaveAttribute('data-phase', 'uploading');
    if (browserName === 'chromium') {
      await page.getByTestId('health-upload-progress').scrollIntoViewIfNeeded();
      await mkdir('preview', { recursive: true });
      await page.screenshot({ path: 'preview/health-upload-50.png', fullPage: true });
    }
  } finally { release(); }
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId('health-upload-progress')).toContainText('100%');
});
