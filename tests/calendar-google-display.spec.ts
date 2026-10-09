import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

type Account = (typeof accounts)[keyof typeof accounts];
const eventId = `google-${'a'.repeat(64)}`;
const foreignEventId = `google-${'b'.repeat(64)}`;
const connectionId = 'calendar-display-test';
const modal = (page: Page) => page.getByRole('dialog');
let day = todayKey();
const requests = new WeakMap<Page, { remote: string[]; writes: string[]; privateOwners: string[]; actions: string[] }>();
function googleEvent(fields: Record<string, unknown> = {}) {
  return {
    title: 'Wizyta z Google Calendar', person: 'Sebastian', date: Timestamp.fromDate(new Date(`${day}T12:00:00Z`)), endDate: Timestamp.fromDate(new Date(`${day}T13:00:00Z`)),
    allDay: false, description: 'Notatka ze źródła', location: 'Kołobrzeg', repeat: 'none', repeatUntil: null,
    createdBy: accounts.parent.uid, ownerUid: accounts.parent.uid, private: false, source: 'google', readOnly: true, cancelled: false,
    sourceConnectionId: connectionId, sourceOwnerUid: accounts.parent.uid, ownerProfileId: accounts.parent.uid,
    externalCalendarId: 'google-display-calendar', externalEventId: 'google-display-event', timeZone: 'Europe/Warsaw', createdAt: Timestamp.now(), ...fields,
  };
}
async function loginCalendar(page: Page, account: Account = accounts.parent) {
  await page.goto('/#Kalendarz');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(() => { location.hash = encodeURIComponent('Kalendarz'); });
  await expect(page.locator('.page-header h1')).toHaveText('Kalendarz');
}
async function chooseDay(page: Page) {
  await page.locator('.view-switch').getByRole('button', { name: 'Dzień', exact: true }).click();
  return page.locator('.calendar-day-view');
}
async function openGoogle(page: Page, title = 'Wizyta z Google Calendar') {
  const view = await chooseDay(page);
  await view.locator('.calendar-event').filter({ hasText: title }).click();
  await expect(modal(page)).toBeVisible();
  return modal(page);
}
function privateOwners(body: string | null, search: string): string[] {
  const candidates = [body || ''];
  for (const input of [body || '', search]) for (const [key, value] of new URLSearchParams(input)) if (key.endsWith('___data__')) candidates.push(value);
  return candidates.flatMap(value => {
    let data;
    try { data = JSON.parse(value); } catch { return []; }
    const query = data?.addTarget?.query?.structuredQuery || data?.structuredQuery;
    if (!query?.from?.some((row: { collectionId?: string }) => row.collectionId === 'privateCalendarEvents')) return [];
    const filter = query.where?.fieldFilter;
    return [filter?.field?.fieldPath === 'ownerUid' && filter.op === 'EQUAL' && typeof filter.value?.stringValue === 'string' ? filter.value.stringValue : 'unscoped'];
  });
}
test.beforeEach(async ({ page }) => {
  day = todayKey();
  await page.clock.setFixedTime(new Date(`${day}T10:00:00Z`));
  await seedEmulators();
  await fixtureDatabase().doc(`calendarEvents/${eventId}`).set(googleEvent());
  const audit = { remote: [] as string[], writes: [] as string[], privateOwners: [] as string[], actions: [] as string[] };
  requests.set(page, audit);
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl)\//, async route => { audit.remote.push(new URL(route.request().url()).hostname); await route.abort('blockedbyclient'); });
  await page.route('**/api/eduvulcan/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1);
    if (action === 'status') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) });
    else await route.abort('blockedbyclient');
  });
  await page.route('**/api/calendars/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)!; audit.actions.push(action);
    if (action === 'status') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) });
    else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'CALENDAR_NOT_CONFIGURED' } }) });
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || url.port !== '8080') return;
    audit.privateOwners.push(...privateOwners(request.postData(), url.search));
    if (/\/Write(?:\/|$)|\/documents:(?:commit|batchWrite)$/.test(url.pathname)) audit.writes.push('Firestore Write');
  });
});
test.afterEach(async ({ page }) => {
  const audit = requests.get(page)!;
  expect(audit.remote, 'Display and visibility tests never contact production/provider servers').toEqual([]);
  expect(audit.writes, 'Google changes must use the authenticated API, never client SDK writes').toEqual([]);
});

test('Google Calendar provenance stays visible in every calendar view and content is read-only', async ({ page }) => {
  await fixtureDatabase().doc('schoolItems/google-sp4-distinction').set({ title: 'Zajęcia z SP4 obok Google', subject: 'Zajęcia z SP4 obok Google', person: 'Nikodem', type: 'lesson', source: 'eduvulcan', date: day, time: '08:00', endTime: '08:45', createdBy: accounts.parent.uid, createdAt: Timestamp.now() });
  await loginCalendar(page);
  for (const [view, selector] of [['Dzień', '.calendar-day-view'], ['Tydzień', '.calendar-week-card'], ['Miesiąc', '.calendar-month-card']]) {
    await page.locator('.view-switch').getByRole('button', { name: view, exact: true }).click();
    const scope = page.locator(selector);
    await expect(scope.locator('.calendar-event').filter({ hasText: 'Wizyta z Google Calendar' }).getByTestId('calendar-source-badge')).toHaveText('Google Calendar');
    await expect(scope.locator('.calendar-event').filter({ hasText: 'Zajęcia z SP4 obok Google' }).getByTestId('calendar-source-badge')).toHaveText('SP4');
  }
  const details = await openGoogle(page);
  await expect(details).toContainText('Google Calendar · Tylko do odczytu');
  await expect(details).toContainText('Notatka ze źródła');
  await expect(details.getByRole('button', { name: /Edytuj|Usuń|Otwórz Szkołę/ })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Ustaw jako prywatny', exact: true })).toBeVisible();
});

test('an actual source update and cancellation refresh the open Google modal without deleting history', async ({ page }) => {
  await loginCalendar(page); await openGoogle(page);
  await fixtureDatabase().doc(`calendarEvents/${eventId}`).update({ title: 'Zmieniony termin Google', description: 'Nowa notatka źródłowa', cancelled: true });
  await expect(modal(page)).toContainText('Zmieniony termin Google');
  await expect(modal(page)).toContainText('Nowa notatka źródłowa');
  await expect(modal(page)).toContainText('ODWOŁANE');
  await expect(modal(page).getByRole('button', { name: /Edytuj|Usuń/ })).toHaveCount(0);
  expect((await fixtureDatabase().doc(`calendarEvents/${eventId}`).get()).exists).toBe(true);
});

test('a visibility response alone never reports success; an authorized owner-only snapshot completes the change', async ({ page }) => {
  const calls: { body: unknown; authenticated: boolean }[] = [];
  await page.route('**/api/calendars/visibility', async route => {
    calls.push({ body: route.request().postDataJSON(), authenticated: !!route.request().headers().authorization?.startsWith('Bearer ') });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, eventId, visibility: 'private' }) });
  });
  await loginCalendar(page); const details = await openGoogle(page);
  await details.getByRole('button', { name: 'Ustaw jako prywatny', exact: true }).click();
  await expect(details.getByRole('status')).toContainText('Czekamy na odświeżenie kalendarza');
  await expect(page.getByText('Zmieniono widoczność wydarzenia.', { exact: true })).toHaveCount(0);
  await expect.poll(() => calls.length).toBe(1);
  expect(calls).toEqual([{ body: { connectionId, eventId, visibility: 'private' }, authenticated: true }]);
  const db = fixtureDatabase(), batch = db.batch();
  batch.set(db.doc(`privateCalendarEvents/${eventId}`), googleEvent({ private: true, visibilityOverride: 'private' }));
  batch.delete(db.doc(`calendarEvents/${eventId}`)); await batch.commit();
  await expect(modal(page)).toContainText('Prywatny — tylko Ty');
  await expect(modal(page).getByRole('button', { name: 'Udostępnij rodzinie', exact: true })).toBeEnabled();
  await expect(page.getByText('Zmieniono widoczność wydarzenia.', { exact: true })).toBeVisible();
  await expect.poll(() => requests.get(page)!.privateOwners.length).toBeGreaterThan(0);
  expect(new Set(requests.get(page)!.privateOwners)).toEqual(new Set([accounts.parent.uid]));
});

test('a failed visibility API keeps the original family event and shows a safe error', async ({ page }) => {
  await page.route('**/api/calendars/visibility', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'CALENDAR_EVENT_FORBIDDEN', message: 'internal-token-must-not-be-shown' } }) }));
  await loginCalendar(page); const details = await openGoogle(page);
  await details.getByRole('button', { name: 'Ustaw jako prywatny', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('Nie masz uprawnienia');
  await expect(details).not.toContainText('internal-token-must-not-be-shown');
  await expect(details.getByRole('button', { name: 'Ustaw jako prywatny', exact: true })).toBeEnabled();
  expect((await fixtureDatabase().doc(`calendarEvents/${eventId}`).get()).exists).toBe(true);
  expect((await fixtureDatabase().doc(`privateCalendarEvents/${eventId}`).get()).exists).toBe(false);
});

test('a child reads only its own private calendar and cannot change another importer family event', async ({ page }) => {
  await fixtureDatabase().doc(`privateCalendarEvents/${foreignEventId}`).set(googleEvent({ title: 'Prywatna wizyta importera', private: true }));
  await loginCalendar(page, accounts.child);
  const details = await openGoogle(page);
  await expect(details.getByRole('button', { name: /Ustaw jako prywatny|Udostępnij rodzinie/ })).toHaveCount(0);
  await expect(page.locator('.calendar-package')).not.toContainText('Prywatna wizyta importera');
  await expect.poll(() => requests.get(page)!.privateOwners.length).toBeGreaterThan(0);
  expect(new Set(requests.get(page)!.privateOwners)).toEqual(new Set([accounts.child.uid]));
  expect(requests.get(page)!.actions.filter(action => action !== 'status')).toEqual([]);
});

test('another parent private move closes an open Google modal and removes its former contents', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc(`calendarEvents/${eventId}`).set(googleEvent({ createdBy: accounts.mother.uid, ownerUid: accounts.mother.uid, sourceOwnerUid: accounts.mother.uid, ownerProfileId: accounts.mother.uid, person: 'Dominika' }));
  await loginCalendar(page); await openGoogle(page);
  await expect(modal(page).getByRole('button', { name: /Ustaw jako prywatny|Udostępnij rodzinie/ })).toHaveCount(0);
  const batch = db.batch(); batch.set(db.doc(`privateCalendarEvents/${eventId}`), googleEvent({ private: true, createdBy: accounts.mother.uid, ownerUid: accounts.mother.uid, sourceOwnerUid: accounts.mother.uid, ownerProfileId: accounts.mother.uid, person: 'Dominika' }));
  batch.delete(db.doc(`calendarEvents/${eventId}`)); await batch.commit();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator('.calendar-package')).not.toContainText('Wizyta z Google Calendar');
  await expect.poll(() => requests.get(page)!.privateOwners.length).toBeGreaterThan(0);
  expect(new Set(requests.get(page)!.privateOwners)).toEqual(new Set([accounts.parent.uid]));
});

for (const deviceZone of ['Europe/Warsaw', 'America/New_York']) test.describe(`Google all-day civil dates on ${deviceZone}`, () => {
  test.use({ timezoneId: deviceZone });
  test('Tokyo DATE is shown on its own civil day, without shifting to the previous device day', async ({ page }) => {
    const exclusive = new Date(`${day}T00:00:00Z`); exclusive.setUTCDate(exclusive.getUTCDate() + 1);
    const endDay = exclusive.toISOString().slice(0, 10);
    await fixtureDatabase().doc(`calendarEvents/${eventId}`).set(googleEvent({ title: 'Całodniowe zajęcia Tokyo', allDay: true, timeZone: 'Asia/Tokyo',
      sourceStartDate: day, sourceEndDateExclusive: endDay, date: Timestamp.fromDate(new Date(`${day}T00:00:00+09:00`)),
      endDate: Timestamp.fromMillis(Date.parse(`${endDay}T00:00:00+09:00`) - 1) }));
    await loginCalendar(page); const main = await chooseDay(page);
    await expect(main.locator('.all-day-row .calendar-event').filter({ hasText: 'Całodniowe zajęcia Tokyo' })).toHaveCount(1);
    await main.locator('.all-day-row .calendar-event').filter({ hasText: 'Całodniowe zajęcia Tokyo' }).click();
    await expect(modal(page)).toContainText('Cały dzień');
    const expected = new Date(`${day}T12:00:00Z`).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    await expect(modal(page)).toContainText(expected.charAt(0).toUpperCase() + expected.slice(1));
    await modal(page).getByRole('button', { name: 'Zamknij', exact: true }).click();
    await page.getByRole('button', { name: 'Importuj / pobierz kalendarz .ics', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await modal(page).getByRole('button', { name: 'Pobierz kalendarz', exact: true }).click();
    const stream = await (await downloaded).createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const ics = Buffer.concat(chunks).toString('utf8');
    expect(ics).toContain(`DTSTART;VALUE=DATE:${day.replaceAll('-', '')}`);
    expect(ics).toContain(`DTEND;VALUE=DATE:${endDay.replaceAll('-', '')}`);

  });
});
