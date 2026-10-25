import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { expect, test } from '@playwright/test';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';

test('parent reward form requires description and preserves the uploaded image and fields when saving fails', async ({ page }) => {
  page.on('pageerror', error => console.error('Local application error:', error.message));
  await seedEmulators(); // Refuses any database except guarded local demo emulators.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//, route => route.abort('blockedbyclient'));
  await page.route('**/api/eduvulcan/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) }));
  await page.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
  let reservationCount = 0; let saveCount = 0;
  let releaseFirstSave: () => void = () => {};
  const firstSaveGate = new Promise<void>(resolve => { releaseFirstSave = resolve; });
  let ticket: { uploadId: string; path: string; rewardId: string } | null = null;
  let rewards: Array<Record<string, unknown>> = [];
  // Explicit UI stub: Storage below is real emulator Storage. Fresh-role checks,
  // signature validation and transactional points are covered in server tests.
  await page.route('**/api/family/tasks', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'state') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, writesEnabled: true, storageConfigured: true,
        balances: [], rewards, requests: [], history: [] }) }); return;
    }
    if (body.action === 'begin-reward-image') {
      reservationCount += 1;
      const uploadId = randomUUID(); const rewardId = String(body.rewardId);
      ticket = { uploadId, rewardId, path: `taskRewardImages/${rewardId}/${accounts.parent.uid}/${uploadId}.png` };
      await fixtureDatabase().doc(`_taskRewardImageUploads/${uploadId}`).set({ rewardId, uid: accounts.parent.uid, path: ticket.path,
        state: 'open', contentType: body.contentType, size: body.size, people: [], active: false,
        expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60_000), orphanAfter: Timestamp.fromMillis(Date.now() + 86_400_000) });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ...ticket }) }); return;
    }
    expect(body.action).toBe('save-reward'); saveCount += 1;
    expect(body.note).toBe('Opis testowej nagrody'); expect(body.cost).toBe(20);
    expect(body.imageUploadId).toBe(ticket?.uploadId);
    expect(body).not.toHaveProperty('imagePath');
    if (saveCount === 1) {
      await firstSaveGate;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false,
        error: { message: 'Testowe przerwanie zapisu. Spróbuj ponownie.' } }) }); return;
    }
    await fixtureDatabase().doc(`_taskRewardImageUploads/${ticket!.uploadId}`).update({ state: 'attached', people: [], active: true });
    rewards = [{ id: body.id, title: body.title, note: body.note, cost: body.cost, people: body.people, active: body.active, imagePath: ticket!.path }];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, rewardId: body.id }) });
  });
  await page.goto('/#Zadania');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  const tasks = page.getByTestId('tasks-v2'); await expect(tasks).toBeVisible();
  await tasks.getByRole('button', { name: 'Punkty i nagrody', exact: true }).click();
  await tasks.getByRole('button', { name: '＋ Dodaj nagrodę', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Nazwa nagrody', { exact: true }).fill('Nagroda z testową ilustracją');
  await form.getByLabel('Koszt punktowy', { exact: true }).fill('20');
  await form.getByRole('button', { name: 'Zapisz nagrodę', exact: true }).click();
  expect(saveCount).toBe(0); expect(reservationCount).toBe(0);
  await form.getByLabel('Opis', { exact: true }).fill('Opis testowej nagrody');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8WQAAAAASUVORK5CYII=', 'base64');
  await form.getByLabel('Zdjęcie nagrody (opcjonalnie)', { exact: true }).setInputFiles({ name: 'reward.png', mimeType: 'image/png', buffer: image });
  await form.getByRole('button', { name: 'Zapisz nagrodę', exact: true }).click();
  await expect.poll(() => saveCount).toBe(1);
  for (const label of ['Nazwa nagrody', 'Koszt punktowy', 'Opis', 'Nagroda aktywna', 'Zdjęcie nagrody (opcjonalnie)', 'Nikodem']) {
    await expect(form.getByLabel(label, { exact: true })).toBeDisabled();
  }
  releaseFirstSave();
  await expect(form.getByRole('alert')).toContainText('Testowe przerwanie zapisu');
  for (const label of ['Nazwa nagrody', 'Koszt punktowy', 'Opis', 'Nagroda aktywna', 'Zdjęcie nagrody (opcjonalnie)', 'Nikodem']) {
    await expect(form.getByLabel(label, { exact: true })).toBeEnabled();
  }
  await expect(form.getByLabel('Opis', { exact: true })).toHaveValue('Opis testowej nagrody');
  await expect(form.getByLabel('Nazwa nagrody', { exact: true })).toHaveValue('Nagroda z testową ilustracją');
  await expect(form.getByRole('progressbar', { name: 'Postęp przesyłania zdjęcia nagrody' })).toHaveAttribute('value', '100');
  await form.getByRole('button', { name: 'Spróbuj ponownie', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(reservationCount).toBe(1); expect(saveCount).toBe(2);
  await expect(tasks.getByRole('img', { name: 'Zdjęcie nagrody: Nagroda z testową ilustracją' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const saved = await fixtureDatabase().doc(`_taskRewardImageUploads/${ticket!.uploadId}`).get();
  expect(saved.data()?.state).toBe('attached');
});
