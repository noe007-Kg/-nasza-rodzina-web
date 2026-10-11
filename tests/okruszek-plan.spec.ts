import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, projectId, seedEmulators } from './emulator-fixtures';
import { createOkruszekDays, OKRUSZEK_PLAN_ID, okruszekDayEntry, okruszekDayId } from '../src/school/okruszek-plan';

const fixtureDay = '2026-10-12';

async function protectRemoteCalls(page: Page) {
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//, route => route.abort('blockedbyclient'));
  await page.route('**/api/eduvulcan/**', route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).pathname).toBe('/api/eduvulcan/status');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) });
  });
  await page.route('**/api/calendars/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) }));
}

async function openCalendar(page: Page) {
  await page.evaluate(() => { location.hash = encodeURIComponent('Kalendarz'); });
  await expect(page.locator('.page-header h1')).toHaveText('Kalendarz');
  await expect(page.locator('.calendar-day-view')).toBeVisible();
}

const calendarPlan = (page: Page) => page.locator('.calendar-day-view .calendar-event[data-source="okruszek"][data-event-kind="lesson"]');

async function selectCalendarPerson(page: Page, name: string) {
  await page.locator('.person-filters').getByRole('button', { name, exact: true }).click();
}

async function calendarDocuments() {
  return Promise.all(['calendarEvents', 'privateCalendarEvents'].map(async collectionName => {
    const result = await fixtureDatabase().collection(collectionName).get();
    return { collectionName, documents: result.docs.map(item => ({ id: item.id, data: item.data() })).sort((a, b) => a.id.localeCompare(b.id)) };
  }));
}

async function openSchool(page: Page, account: { email: string } = accounts.parent) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(() => { location.hash = encodeURIComponent('Szkoła'); });
  await expect(page.locator('.school-heading h1')).toHaveText('Szkoła');
}

async function savedPlan() {
  return fixtureDatabase().collection('schoolItems').where('person', '==', 'Paweł').where('schoolPlanId', '==', OKRUSZEK_PLAN_ID).get();
}

async function emulatorToken(account: { email: string }): Promise<string> {
  fixtureDatabase(); // Refuses remote Firebase before creating any authenticated client request.
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password, returnSecureToken: true }),
  });
  expect(response.status).toBe(200);
  const result = await response.json() as { idToken: string };
  expect(typeof result.idToken).toBe('string');
  return result.idToken;
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.clock.setFixedTime(new Date(`${fixtureDay}T10:00:00Z`));
  await protectRemoteCalls(page);
});

test('rodzic przypisuje Okruszek Pawłowi, zachowuje poprawki i jeden plan w kalendarzu osobistym oraz rodzinnym', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc('schoolItems/nikodem-lesson').update({ source: 'eduvulcan', date: fixtureDay, weekday: 0 });
  const calendarFields = {
    title: 'Niezmieniany rodzinny termin testowy', person: 'Nikodem', date: Timestamp.fromDate(new Date(`${fixtureDay}T12:00:00Z`)),
    endDate: Timestamp.fromDate(new Date(`${fixtureDay}T13:00:00Z`)), allDay: false, description: 'Zachowaj istniejący wpis.',
    repeat: 'none', repeatUntil: null, createdBy: accounts.parent.uid, createdAt: Timestamp.now(),
  };
  await db.doc('calendarEvents/okruszek-unrelated-manual').set(calendarFields);
  await db.doc('privateCalendarEvents/okruszek-unrelated-google').set({ ...calendarFields, title: 'Niezmieniany prywatny Google',
    person: 'Sebastian', private: true, source: 'google', ownerUid: accounts.parent.uid, sourceOwnerUid: accounts.parent.uid });
  const calendarBefore = await calendarDocuments();
  const nikodemBefore = (await fixtureDatabase().doc('schoolItems/nikodem-lesson').get()).data();
  await openSchool(page);
  await page.locator('.school-students').getByRole('button', { name: 'Paweł', exact: true }).click();
  const sources = page.getByTestId('school-source-selector');
  await expect(sources.getByRole('button')).toHaveCount(1);
  await expect(sources.getByRole('button', { name: /^Okruszek/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('fryderyk-preparation')).toHaveCount(0);
  await expect(page.locator('.school-sp4-content')).not.toBeVisible();
  const plan = page.getByTestId('okruszek-plan');
  await expect(plan).toContainText('Plan przygotowany — niezapisany');
  await expect(plan.getByTestId('okruszek-day-1').locator('.okruszek-lesson-name')).toHaveText(['Rewalidacja', 'Rewalidacja', 'f.os i społ', 'f.os i społ', 'PDP/ kuchnia', 'Z.R.Z', 'PDP', 'PDP']);
  await expect(plan.getByTestId('okruszek-day-1').locator('.okruszek-lesson-time')).toHaveText(['07:30–07:55', '08:00–08:45', '08:50–09:35', '09:40–10:25', '10:30–11:15', '11:20–12:05', '12:10–12:55', '13:35–14:20']);
  await expect(plan.getByTestId('okruszek-day-1')).toContainText('Przerwa 07:55–08:00');
  await expect(plan.getByTestId('okruszek-day-1')).toContainText('Przerwa obiadowa 12:55–13:35');
  await expect(plan.getByTestId('okruszek-day-1')).toContainText('14:20–15:10 — pobyt w szkole; brak przypisanego przedmiotu');
  await expect(plan.getByTestId('okruszek-day-1').locator('.okruszek-timing-confidence').first()).toHaveText('Godziny potwierdzone');
  await expect(plan.getByTestId('okruszek-day-1').locator('.okruszek-timing-confidence').nth(1)).toHaveText('Godziny orientacyjne');
  await expect(plan.getByTestId('okruszek-day-3')).toContainText('Przerwa 16:00–16:05');
  await expect(plan.getByTestId('okruszek-day-3').locator('.okruszek-lesson-time').last()).toHaveText('16:05–16:30');
  await expect(plan.getByTestId('okruszek-day-5').locator('.okruszek-lesson-name').first()).toHaveText('Z.k.k.');
  await expect(plan.getByTestId('okruszek-day-2').locator('li').first()).toContainText('—');
  await expect(plan.getByTestId('okruszek-day-2').locator('li').first().locator('.okruszek-lesson-time')).toHaveCount(0);
  await expect(plan.getByTestId('okruszek-day-2').locator('.okruszek-lesson-time').first()).toHaveText('08:50–09:35');
  await expect(plan.getByTestId('okruszek-day-1')).toContainText('07:30–15:10');
  await plan.getByRole('button', { name: 'Zapisz plan Okruszka', exact: true }).click();
  await expect(plan).toContainText('Plan zapisany');
  await expect.poll(async () => (await savedPlan()).size).toBe(5);
  const initialIds = (await savedPlan()).docs.map(item => item.id).sort();
  expect(initialIds).toEqual((await Promise.all([1, 2, 3, 4, 5].map(weekday => okruszekDayId(accounts.sibling.uid, weekday)))).sort());
  for (const item of (await savedPlan()).docs) {
    expect(item.data().person).toBe('Paweł');
    expect(item.data().ownerProfileId).toBe(accounts.sibling.uid);
    expect(item.data().ownerProfileId).not.toBe(accounts.parent.uid);
    expect(item.data().manualDayPlan.periodStart).toBe('2026-10-12');
    expect(item.data().manualDayPlan.periodEnd).toBe('2027-06-30');
  }
  await plan.getByRole('button', { name: 'Edytuj plan', exact: true }).click();
  const monday = plan.getByRole('group', { name: 'Poniedziałek', exact: true });
  await monday.getByLabel('Koniec całego dnia', { exact: true }).fill('15:20');
  await monday.getByRole('textbox', { name: 'Zajęcia — po jednym w wierszu', exact: true }).fill('Rewalidacja\nRewalidacja\nf.os i społ\nf.os i społ\nPDP/kuchnia\nZ.R.Z\nPDP\nPDP — zmiana testowa');
  await plan.getByRole('textbox', { name: 'Dodatkowe dni wolne — daty RRRR-MM-DD, po jednej w wierszu', exact: true }).fill('2026-10-15');
  await plan.getByRole('button', { name: 'Zapisz zmiany planu', exact: true }).click();
  await expect(plan).toContainText('Zapisano zmiany planu.');
  await plan.getByRole('button', { name: 'Zapisz plan Okruszka', exact: true }).click();
  await expect(plan).toContainText('Nie dodano duplikatów i zachowano ręczne poprawki.');
  const after = await savedPlan();
  expect(after.size).toBe(5); expect(after.docs.map(item => item.id).sort()).toEqual(initialIds);
  const mondayRecord = after.docs.find(item => item.data().manualDayPlan.weekday === 1)!;
  const savedMonday = mondayRecord.data();
  expect(savedMonday.endTime).toBe('15:20');
  expect(savedMonday.createdBy).toBe(accounts.parent.uid);
  expect(savedMonday.ownerProfileId).toBe(accounts.sibling.uid);
  expect(savedMonday.manualDayPlan.lessons.at(-1)).toBe('PDP — zmiana testowa');
  expect(savedMonday.schoolPlanRevision).toBe(1);
  expect(savedMonday.type).toBe('message'); expect(savedMonday.weekday).toBe(0);
  const pawelToken = await emulatorToken(accounts.sibling);
  const nikodemToken = await emulatorToken(accounts.child);
  const documentUrl = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/schoolItems/${mondayRecord.id}`;
  expect((await fetch(documentUrl, { headers: { Authorization: `Bearer ${pawelToken}` } })).status).toBe(200);
  expect((await fetch(`${documentUrl}?updateMask.fieldPaths=note`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${pawelToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { note: { stringValue: 'Niedozwolona zmiana dziecka' } } }),
  })).status).toBe(403);
  expect((await fetch(documentUrl, { headers: { Authorization: `Bearer ${nikodemToken}` } })).status).toBe(403);
  await plan.getByLabel('Sprawdź dzień', { exact: true }).fill('2026-10-14');
  await expect(plan.getByTestId('okruszek-date-status')).toContainText('Dzień wolny');
  await expect(plan.getByTestId('okruszek-date-status')).not.toContainText('Cały dzień:');
  await plan.getByLabel('Sprawdź dzień', { exact: true }).fill('2026-10-15');
  await expect(plan.getByTestId('okruszek-date-status')).toContainText('Dodatkowy dzień wolny');
  await plan.getByLabel('Sprawdź dzień', { exact: true }).fill('2027-06-25');
  await expect(plan.getByTestId('okruszek-date-status')).toContainText('Status niepotwierdzony');
  await expect(plan.getByTestId('okruszek-date-status')).not.toContainText('Cały dzień:');
  expect((await fixtureDatabase().doc('schoolItems/nikodem-lesson').get()).data()).toEqual(nikodemBefore);
  for (const [width, height] of [[390, 844], [844, 390], [900, 1440], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(plan.getByTestId('okruszek-day-5')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await expect(sources.getByRole('button')).toHaveCount(2);
  await expect(sources.getByRole('button', { name: /^SP4/ })).toBeVisible();
  await expect(sources.getByRole('button', { name: /^Fryderyk/ })).toBeVisible();
  await expect(sources.getByRole('button', { name: /^Okruszek/ })).toHaveCount(0);
  await expect(plan).toHaveCount(0);
  await sources.getByRole('button', { name: /^Fryderyk/ }).click();
  await expect(page.getByTestId('fryderyk-preparation')).toContainText('Fryderyk — niepołączono');
  await openCalendar(page);
  await expect(calendarPlan(page)).toHaveCount(0);
  await selectCalendarPerson(page, 'Paweł');
  await expect(calendarPlan(page)).toHaveCount(8);
  await expect(calendarPlan(page).first().getByTestId('calendar-source-badge')).toHaveText('Okruszek');
  await expect(calendarPlan(page).first().locator('.calendar-owner-badge')).toContainText('Paweł');
  await expect(calendarPlan(page).first().getByTestId('calendar-source-badge')).toHaveText('Okruszek');
  const ownerColour = await calendarPlan(page).first().evaluate(element => (element as HTMLElement).style.getPropertyValue('--calendar-owner-color'));
  expect(ownerColour).toBeTruthy();
  const personalLabels = await calendarPlan(page).allInnerTexts();
  await expect(page.locator('.calendar-day-view .calendar-event[data-source="okruszek"][data-event-kind="break"]')).toHaveCount(7);
  await calendarPlan(page).first().click();
  const details = page.getByRole('dialog');
  await expect(details).toContainText('07:30 – 07:55');
  await expect(details).toContainText('Paweł');
  await expect(details).toContainText('Rewalidacja');
  await expect(details).toContainText('godziny potwierdzone przez rodzica');
  await expect(details).toContainText('Pobyt w szkole: 07:30–15:20');
  await details.getByRole('button', { name: 'Zamknij', exact: true }).click();
  await calendarPlan(page).last().click();
  await expect(details).toContainText('13:35 – 14:20');
  await expect(details).toContainText('PDP — zmiana testowa');
  await expect(details).toContainText('godziny orientacyjne');
  await expect(details.getByRole('button', { name: /Edytuj|Usuń/ })).toHaveCount(0);
  await details.getByRole('button', { name: 'Zamknij', exact: true }).click();
  await selectCalendarPerson(page, 'Cała rodzina');
  await expect(calendarPlan(page)).toHaveCount(8);
  expect(await calendarPlan(page).allInnerTexts()).toEqual(personalLabels);
  expect(await calendarPlan(page).first().evaluate(element => (element as HTMLElement).style.getPropertyValue('--calendar-owner-color'))).toBe(ownerColour);
  for (const person of ['Nikodem', 'Dominika', 'Moje wydarzenia']) {
    await selectCalendarPerson(page, person);
    await expect(calendarPlan(page)).toHaveCount(0);
  }
  expect(await calendarDocuments()).toEqual(calendarBefore);
  expect((await fixtureDatabase().doc('schoolItems/nikodem-lesson').get()).data()).toEqual(nikodemBefore);
  expect((await savedPlan()).size).toBe(5);
});

test('Paweł widzi plan bez przycisków zarządzania, Nikodem zachowuje własną szkołę bez Okruszka', async ({ page }) => {
  for (const day of createOkruszekDays('Paweł', accounts.sibling.uid)) {
    await fixtureDatabase().doc(`schoolItems/${await okruszekDayId(accounts.sibling.uid, day.weekday)}`).set({
      ...okruszekDayEntry(day), createdBy: accounts.parent.uid, createdAt: Timestamp.now(),
    });
  }
  await openSchool(page, accounts.sibling);
  await expect(page.getByTestId('school-source-selector').getByRole('button')).toHaveCount(1);
  await expect(page.getByTestId('school-source-selector').getByRole('button', { name: /^Okruszek/ })).toHaveAttribute('aria-pressed', 'true');
  const plan = page.getByTestId('okruszek-plan');
  await expect(plan.getByTestId('okruszek-day-3')).toContainText('08:50–16:30');
  await expect(plan).toContainText('Plan zapisany');
  await expect(plan.getByRole('button', { name: /Zapisz plan|Edytuj plan/ })).toHaveCount(0);
  await openCalendar(page);
  await expect(calendarPlan(page)).toHaveCount(8);
  await expect(calendarPlan(page).first().locator('.calendar-owner-badge')).toContainText('Paweł');
  expect((await savedPlan()).size).toBe(5);
  const otherContext = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:5173', timezoneId: 'Europe/Warsaw', locale: 'pl-PL' });
  try {
    const childPage = await otherContext.newPage();
    await childPage.clock.setFixedTime(new Date(`${fixtureDay}T10:00:00Z`));
    await protectRemoteCalls(childPage);
    await openSchool(childPage, accounts.child);
    await expect(childPage.getByTestId('school-source-selector').getByRole('button')).toHaveCount(2);
    await expect(childPage.getByTestId('school-source-selector').getByRole('button', { name: /^SP4/ })).toBeVisible();
    await expect(childPage.getByTestId('school-source-selector').getByRole('button', { name: /^Fryderyk/ })).toBeVisible();
    await expect(childPage.getByTestId('school-source-selector').getByRole('button', { name: /^Okruszek/ })).toHaveCount(0);
    await expect(childPage.getByTestId('okruszek-plan')).toHaveCount(0);
    await expect(childPage.getByTestId('school-stat-today')).toBeVisible();
    await openCalendar(childPage);
    await expect(calendarPlan(childPage)).toHaveCount(0);
    await selectCalendarPerson(childPage, 'Cała rodzina');
    await expect(calendarPlan(childPage)).toHaveCount(0);
  } finally { await otherContext.close(); }
});

test('zapis istniejącego starszego planu przypina UID Pawła bez nowych dokumentów i bez nadpisania zmian rodzica', async ({ page }) => {
  const db = fixtureDatabase();
  for (const day of createOkruszekDays('Paweł')) {
    const revised = day.weekday === 1 ? { ...day, endTime: '15:25', revision: 2, lessons: [...day.lessons, 'Zachowana poprawka rodzica'] } : day;
    const entry = { ...okruszekDayEntry(revised) };
    delete entry.ownerProfileId;
    await db.doc(`schoolItems/${await okruszekDayId('Paweł', day.weekday)}`).set({ ...entry,
      createdBy: accounts.mother.uid, createdAt: Timestamp.fromDate(new Date('2026-10-10T12:00:00Z')) });
  }
  const before = await savedPlan();
  const ids = before.docs.map(item => item.id).sort();
  await openSchool(page);
  await page.locator('.school-students').getByRole('button', { name: 'Paweł', exact: true }).click();
  const plan = page.getByTestId('okruszek-plan');
  await expect(plan.getByTestId('okruszek-day-1')).toContainText('15:25');
  await plan.getByRole('button', { name: 'Zapisz plan Okruszka', exact: true }).click();
  await expect(plan).toContainText('Plan zapisany');
  const after = await savedPlan();
  expect(after.size).toBe(5);
  expect(after.docs.map(item => item.id).sort()).toEqual(ids);
  for (const original of before.docs) {
    const updated = after.docs.find(item => item.id === original.id)!.data();
    expect(updated.ownerProfileId).toBe(accounts.sibling.uid);
    expect(updated).toMatchObject(original.data());
    expect(updated.createdBy).toBe(accounts.mother.uid);
  }
  const calendarBefore = await calendarDocuments();
  await openCalendar(page);
  await selectCalendarPerson(page, 'Paweł');
  await expect(calendarPlan(page)).toHaveCount(9);
  await calendarPlan(page).last().click();
  await expect(page.getByRole('dialog')).toContainText('14:25 – 15:10');
  await expect(page.getByRole('dialog')).toContainText('Pobyt w szkole: 07:30–15:25');
  await expect(page.getByRole('dialog')).toContainText('Zachowana poprawka rodzica');
  expect(await calendarDocuments()).toEqual(calendarBefore);
});
