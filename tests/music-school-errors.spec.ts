import { test, expect } from '@playwright/test';
import { accounts, password } from './emulator-fixtures';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

test('music plan failures are visible on Start, Calendar and School and retry recovers on tablet', async ({ page }) => {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.2:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.2:8080') throw new Error('Dedicated local music emulators required.');
  const app = initializeApp({ projectId: 'demo-nasza-rodzina' }, `music-${Date.now()}`);
  const db = getFirestore(app);
  await fetch('http://127.0.0.2:8080/emulator/v1/projects/demo-nasza-rodzina/databases/(default)/documents', { method: 'DELETE' });
  for (const account of [accounts.parent, accounts.child]) {
    try { await getAuth(app).createUser({ uid: account.uid, email: account.email, password }); } catch { await getAuth(app).updateUser(account.uid, { password }); }
    await db.doc(`members/${account.uid}`).set({ name: account.name, personKey: account.name, role: account.role, active: true, canLogin: true, schoolEnabled: account.role === 'child' });
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|fryderyk\.edu\.pl)\//, r => r.abort());
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] }, connections: [], items: [], plans: [], bills: [], documents: [] }) }));
  await page.clock.setFixedTime(new Date('2026-10-28T13:00:00Z'));
  const plan = { id: 'music-test', ownerProfileId: accounts.child.uid, person: 'Nikodem', revision: 1,
    validFrom: '2026-10-19', validUntil: '2027-06-30', lessons: [], excludedDates: [], check: null,
    occurrences: [{ id: '2026-10-28_rhythm-wed', title: 'Podstawy rytmiki', date: '2026-10-28', time: '15:50', endTime: '16:35',
      startAt: '2026-10-28T14:50:00.000Z', endAt: '2026-10-28T15:35:00.000Z', teacher: 'Nauczyciel', room: '10', cancelled: false, moved: false, manual: false, note: '', evidence: null }] };
  let failing = true, showPlan = true;
  await page.route('**/api/family/music-school', r => r.fulfill({ status: failing ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failing ? { ok: false, error: { message: 'Plan chwilowo niedostępny.' } } : { ok: true, plans: showPlan ? [plan] : [], template: [], writesEnabled: true }) }));
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Terminy i status rodziny' })).toBeVisible();
  await page.evaluate(() => { location.hash = encodeURIComponent('Kalendarz'); });
  await expect(page.getByRole('status').filter({ hasText: 'Kalendarz może nie pokazywać' })).toBeVisible();
  failing = false;
  await page.getByRole('button', { name: 'Ponów odczyt planu' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Kalendarz może nie pokazywać' })).toHaveCount(0);
  await expect(page.locator('.person-filters button.active')).toHaveText('Cała rodzina');
  await expect(page.locator('[data-event-id="music:music-test:2026-10-28_rhythm-wed"]')).toBeVisible();
  await page.locator('.person-filters').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await expect(page.locator('[data-event-id="music:music-test:2026-10-28_rhythm-wed"]')).toBeVisible();
  showPlan = false;
  failing = true;
  await page.evaluate(() => { location.hash = encodeURIComponent('Szkoła'); });
  await page.getByTestId('school-source-selector').getByRole('button', { name: /Fryderyk/ }).click();
  const panel = page.getByTestId('fryderyk-preparation');
  await expect(panel.getByRole('alert')).toContainText('Nie można potwierdzić');
  await expect(panel).not.toContainText('Nie zapisano planu tego ucznia');
  failing = false;
  await panel.getByRole('button', { name: 'Ponów odczyt planu' }).click();
  await expect(panel).toContainText('Nie zapisano planu tego ucznia');
  await expect(panel).toContainText('bez cotygodniowego zapisywania');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

