import { expect, test, type Page } from '@playwright/test';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { manageFinanceAction } from '../server/finance-service.mjs';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

const viewports = [{ width: 390, height: 844 }, { width: 844, height: 390 },
  { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }];
const household = 'finance-test-household';

/** Local test transport, using the real finance service, Auth tokens and Firestore transactions.
 * It does not exercise deployment configuration or the deployed HTTP endpoint. */
async function localFinanceApi(page: Page) {
  const db = fixtureDatabase(); // Refuses anything except the local demo emulators.
  const app = getApps().find(candidate => candidate.name === 'browser-tests')!;
  await page.route('**/api/family/finance', async route => {
    try {
      const token = route.request().headers().authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw Object.assign(new Error('Brak sesji testowej.'), { status: 401, code: 'AUTH_REQUIRED' });
      const decoded = await getAuth(app).verifyIdToken(token);
      const profile = await db.doc(`members/${decoded.uid}`).get();
      const result = await manageFinanceAction({ db, uid: decoded.uid, profile: profile.data() }, route.request().postDataJSON());
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, writesEnabled: true, ...result }) });
    } catch (value) {
      const error = value as { status?: number; code?: string; message?: string };
      await route.fulfill({ status: error.status || 500, contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { code: error.code || 'TEST_API_FAILURE', message: error.message || 'Błąd API testowego.' } }) });
    }
  });
}

async function login(page: Page, account: typeof accounts.parent | typeof accounts.child) {
  await page.goto('/#Finanse');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByTestId('finance-page')).toBeVisible();
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  // Explicit test-only provisioning. Shared Tasks/Health fixtures stay unchanged.
  const db = fixtureDatabase();
  const batch = db.batch();
  for (const account of Object.values(accounts)) batch.update(db.doc(`members/${account.uid}`), { familyId: household });
  await batch.commit();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//,
    route => route.abort('blockedbyclient'));
  await page.route('**/api/eduvulcan/**', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) }));
  await page.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
});

test('a parent creates, copies, edits and pays a real emulator bill; recurring periods stay independent and responsive', async ({ page }) => {
  await localFinanceApi(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText(value: string) { (window as unknown as { __financeClipboard: string }).__financeClipboard = value; return Promise.resolve(); },
  } }));
  await login(page, accounts.parent);
  const finance = page.getByTestId('finance-page');
  await expect(finance).toContainText('Nie dodano jeszcze opłat.');
  await expect(finance.locator('.finance-bill-row')).toHaveCount(0);
  expect((await fixtureDatabase().collection('financeBills').get()).empty).toBe(true);
  await finance.getByRole('button', { name: 'Dodaj opłatę', exact: true }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByRole('checkbox', { name: 'Udostępnij: Nikodem', exact: true })).not.toBeChecked();
  await form.getByLabel('Nazwa opłaty', { exact: true }).fill('Opłata testowa bez danych osobowych');
  await form.getByLabel('Kwota w PLN', { exact: true }).fill('129,99');
  await form.getByLabel('Termin płatności', { exact: true }).fill(todayKey());
  await form.getByRole('combobox', { name: 'Powtarzanie', exact: true }).selectOption('monthly');
  await form.getByLabel('Numer rachunku — opcjonalnie', { exact: true }).fill('PL00000000000000000000000000');
  await form.getByLabel('Tytuł przelewu — opcjonalnie', { exact: true }).fill('PRZELEW TESTOWY');
  await form.getByLabel('Oficjalny link do płatności HTTPS — opcjonalnie', { exact: true }).fill('https://payments.example.test/pay');
  await form.getByRole('checkbox', { name: 'Udostępnij: Nikodem', exact: true }).check();
  for (const viewport of viewports) { await page.setViewportSize(viewport); await noOverflow(page); }
  await form.getByRole('button', { name: 'Zapisz opłatę', exact: true }).click();
  await expect(form).toHaveCount(0);
  const detail = page.getByTestId('finance-bill-detail');
  await expect(detail).toContainText('129,99');
  const root = (await fixtureDatabase().collection('financeBills').get()).docs[0];
  expect(root.data()).toMatchObject({ amountGrosze: 12999, status: 'unpaid', familyId: household,
    ownerUid: accounts.parent.uid, sharedWith: [accounts.child.uid], calendarEnabled: false });
  await detail.getByRole('button', { name: 'Kopiuj numer', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __financeClipboard: string }).__financeClipboard)).toBe('PL00000000000000000000000000');
  await detail.getByRole('button', { name: 'Kopiuj tytuł', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __financeClipboard: string }).__financeClipboard)).toBe('PRZELEW TESTOWY');
  const paymentLink = detail.getByRole('link', { name: 'Otwórz link' });
  await expect(paymentLink).toHaveAttribute('href', 'https://payments.example.test/pay');
  await expect(paymentLink).toHaveAttribute('target', '_blank');
  await expect(paymentLink).toHaveAttribute('rel', 'noopener noreferrer');
  for (const viewport of viewports) { await page.setViewportSize(viewport); await expect(detail).toBeVisible(); await noOverflow(page); }
  await detail.getByRole('button', { name: 'Edytuj opłatę', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Kwota w PLN', { exact: true }).fill('139,01');
  await page.getByRole('dialog').getByRole('button', { name: 'Zapisz opłatę', exact: true }).click();
  await expect(detail).toContainText('139,01');
  const calendarChoice = detail.getByRole('checkbox', { name: /Dodaj do kalendarza/ });
  await calendarChoice.click(); // This controlled value changes after the authenticated server save.
  await expect.poll(async () => (await root.ref.get()).data()?.calendarEnabled).toBe(true);
  await expect(calendarChoice).toBeChecked();
  await detail.getByRole('button', { name: 'Utwórz dwa kolejne okresy', exact: true }).click();
  await expect(finance).toContainText('Przygotowano dwa kolejne okresy.');
  await detail.getByRole('button', { name: 'Utwórz dwa kolejne okresy', exact: true }).click();
  await expect.poll(async () => (await fixtureDatabase().collection('financeBills').get()).size).toBe(3);
  await detail.getByRole('button', { name: 'Oznacz jako opłacone', exact: true }).click();
  await expect(detail).toContainText('Opłacony okres pozostaje w historii');
  const periods = (await fixtureDatabase().collection('financeBills').get()).docs.map(row => row.data());
  expect(periods.filter(row => row.status === 'paid')).toHaveLength(1);
  expect(periods.filter(row => row.status === 'unpaid')).toHaveLength(2);
  expect(periods.filter(row => row.periodIndex > 0).every(row => row.sharedWith.length === 0)).toBe(true);
  expect((await root.ref.get()).data()?.amountGrosze).toBe(13901);
  expect((await root.ref.get()).data()?.paidAt).toBeInstanceOf(Timestamp);
  const paidAudit = await fixtureDatabase().collection('financeBillAudit').where('billId', '==', root.id).where('kind', '==', 'paid').get();
  expect(paidAudit.size).toBe(1);
  expect((await fixtureDatabase().collection('calendarEvents').get()).empty).toBe(true);
  await finance.getByRole('combobox', { name: 'Okres historii opłat', exact: true }).selectOption('all');
  const totals = finance.getByRole('region', { name: 'Podsumowanie opłat wybranego okresu', exact: true });
  await expect(totals).toContainText('139,01');
  await expect(totals).toContainText('278,02');
  await finance.locator('.finance-history summary').click();
  await expect(finance.getByRole('table', { name: 'Historia terminów i płatności', exact: true })).toContainText('139,01');
  for (const viewport of viewports) { await page.setViewportSize(viewport); await noOverflow(page); }
});

test('a child receives only a specific shared bill through the real service and direct Firebase/API attempts remain denied', async ({ page }) => {
  const db = fixtureDatabase();
  const data = { title: 'Opłata prywatna testowa', category: 'Inne', amountGrosze: 3500, dueDate: todayKey(),
    recipient: '', bankAccount: '', transferTitle: '', note: '', paymentUrl: '', recurrence: 'none', calendarEnabled: true,
    sharedWith: [], familyId: household, ownerUid: accounts.parent.uid, status: 'unpaid', archived: false,
    seriesId: 'private-test', periodIndex: 0, anchorDueDate: todayKey(), createdAt: Timestamp.now(), updatedAt: Timestamp.now(), paidAt: null };
  await Promise.all([
    db.doc('financeBills/private-test').set(data),
    db.doc('financeBills/shared-test').set({ ...data, title: 'Opłata udostępniona testowa', seriesId: 'shared-test', sharedWith: [accounts.child.uid] }),
    db.doc('financeBills/other-family-test').set({ ...data, title: 'Opłata obcego domostwa', familyId: 'other-household', sharedWith: [accounts.child.uid] }),
  ]);
  await localFinanceApi(page);
  await login(page, accounts.child);
  const finance = page.getByTestId('finance-page');
  await expect(finance).toContainText('Udostępnione opłaty');
  await expect(finance.locator('.finance-bill-row')).toHaveCount(1);
  await expect(finance).toContainText('Opłata udostępniona testowa');
  await expect(finance).not.toContainText('Opłata prywatna testowa');
  await expect(finance).not.toContainText('Opłata obcego domostwa');
  await expect(finance.getByRole('button', { name: 'Dodaj opłatę', exact: true })).toHaveCount(0);
  await finance.locator('.finance-bill-row').click();
  const detail = page.getByTestId('finance-bill-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Oznacz jako opłacone', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Edytuj opłatę', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('link', { name: 'Otwórz link' })).toHaveCount(0);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves this local project module in the browser.
    const { db, doc, getDoc, updateDoc } = await import('/src/app-shared.tsx');
    // @ts-expect-error Vite resolves this local project module in the browser.
    const { familyAction } = await import('/src/family-v2-client.ts');
    const denied: string[] = [];
    for (const id of ['private-test', 'other-family-test']) {
      try { await getDoc(doc(db, 'financeBills', id)); denied.push('UNEXPECTED_READ'); }
      catch (error) { denied.push((error as { code?: string }).code || ''); }
    }
    try { await updateDoc(doc(db, 'financeBills', 'shared-test'), { status: 'paid' }); denied.push('UNEXPECTED_WRITE'); }
    catch (error) { denied.push((error as { code?: string }).code || ''); }
    let apiDenied = false;
    try { await familyAction('finance', { action: 'markPaid', billId: 'shared-test' }); }
    catch { apiDenied = true; }
    return { denied, apiDenied, sharedExists: (await getDoc(doc(db, 'financeBills', 'shared-test'))).exists() };
  });
  expect(result).toEqual({ denied: ['permission-denied', 'permission-denied', 'permission-denied'], apiDenied: true, sharedExists: true });
  expect((await db.doc('financeBills/shared-test').get()).data()?.status).toBe('unpaid');
  expect((await db.collection('financeBillAudit').get()).empty).toBe(true);
  for (const viewport of viewports) { await page.setViewportSize(viewport); await expect(detail).toBeVisible(); await noOverflow(page); }
});

test('an unavailable finance backend shows an empty protected preview and preserves the form without a write', async ({ page }) => {
  await page.route('**/api/family/finance', route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: { code: 'TEST_BACKEND_UNAVAILABLE', message: 'Backend testowy jest niedostępny.' } }) }));
  await login(page, accounts.parent);
  const finance = page.getByTestId('finance-page');
  await expect(finance.getByRole('alert')).toContainText('Backend testowy jest niedostępny.');
  await expect(finance.locator('.finance-bill-row')).toHaveCount(0);
  await finance.getByRole('button', { name: 'Dodaj opłatę', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Nazwa opłaty', { exact: true }).fill('Niezapisana opłata testowa');
  await expect(form.getByRole('button', { name: 'Zapisz opłatę', exact: true })).toBeDisabled();
  await expect(form).toContainText('Podgląd formularza — zapis jest wyłączony');
  for (const viewport of viewports) { await page.setViewportSize(viewport); await noOverflow(page); }
  await expect(form.getByLabel('Nazwa opłaty', { exact: true })).toHaveValue('Niezapisana opłata testowa');
  expect((await fixtureDatabase().collection('financeBills').get()).empty).toBe(true);
});

test('an unassigned parent cannot read legacy bills through API or Rules and the existing calendar stays available', async ({ page }) => {
  const db = fixtureDatabase();
  const batch = db.batch();
  for (const account of Object.values(accounts)) batch.update(db.doc(`members/${account.uid}`), { familyId: FieldValue.delete() });
  batch.set(db.doc('financeBills/unclassified'), { title: 'Niedostępna opłata innego gospodarstwa', familyId: '__legacy__',
    ownerUid: accounts.mother.uid, sharedWith: [], amountGrosze: 10000, status: 'unpaid', archived: false, dueDate: todayKey(), calendarEnabled: true });
  batch.set(db.doc('calendarEvents/legacy-compatible'), { title: 'Dotychczasowy rodzinny termin', person: 'family',
    date: Timestamp.fromDate(new Date(`${todayKey()}T12:00:00Z`)), endDate: Timestamp.fromDate(new Date(`${todayKey()}T13:00:00Z`)),
    allDay: false, description: '', location: '', repeat: 'none', repeatUntil: null, createdBy: accounts.parent.uid });
  for (const account of [accounts.parent, accounts.mother]) batch.set(db.doc(`privateCalendarEvents/private-${account.uid}`), {
    title: `Prywatny termin ${account.name}`, person: account.name, ownerUid: account.uid, createdBy: account.uid, private: true,
    date: Timestamp.fromDate(new Date(`${todayKey()}T14:00:00Z`)), endDate: Timestamp.fromDate(new Date(`${todayKey()}T15:00:00Z`)),
    allDay: false, description: '', location: '', repeat: 'none', repeatUntil: null,
  });
  await batch.commit();
  const initialBill = (await db.doc('financeBills/unclassified').get()).data();
  let financeRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/family/finance')) financeRequests++; });
  await localFinanceApi(page);
  await login(page, accounts.parent);
  const finance = page.getByTestId('finance-page');
  await expect(finance.getByRole('alert')).toContainText('zweryfikowanego przypisania');
  await expect(finance.locator('.finance-bill-row')).toHaveCount(0);
  await expect(finance).not.toContainText('Niedostępna opłata innego gospodarstwa');
  const denied = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves this local project module in the browser.
    const { db, doc, getDoc } = await import('/src/app-shared.tsx');
    try { await getDoc(doc(db, 'financeBills', 'unclassified')); return false; }
    catch (error) { return (error as { code?: string }).code === 'permission-denied'; }
  });
  expect(denied).toBe(true);
  const requestsBeforeCalendar = financeRequests;
  await page.goto('/#Kalendarz');
  await expect(page.locator('.calendar-day-view')).toBeVisible();
  await expect(page.locator('.calendar-day-view')).toContainText('Prywatny termin Sebastian');
  await expect(page.locator('.calendar-day-view')).not.toContainText('Prywatny termin Dominika');
  await page.locator('.person-filters').getByRole('button', { name: 'Cała rodzina', exact: true }).click();
  await expect(page.locator('.calendar-day-view')).toContainText('Dotychczasowy rodzinny termin');
  await expect(page.locator('.calendar-day-view')).not.toContainText('Niedostępna opłata');
  await expect(page.locator('.calendar-day-view')).not.toContainText('Prywatny termin');
  expect(financeRequests).toBe(requestsBeforeCalendar);
  expect((await db.doc('financeBills/unclassified').get()).data()).toEqual(initialBill);
  expect((await db.collection('financeBillAudit').get()).empty).toBe(true);
});
