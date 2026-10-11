import { expect, test, type Locator, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';
import { createOkruszekDays, okruszekDayEntry, okruszekDayId } from '../src/school/okruszek-plan';

const weekDay = '2026-10-21';
const monday = '2026-10-19';

async function protectRemoteCalls(page: Page) {
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//, route => route.abort('blockedbyclient'));
  await page.route('**/api/eduvulcan/**', route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).pathname).toBe('/api/eduvulcan/status');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) });
  });
  await page.route('**/api/calendars/**', route => {
    expect(route.request().method()).toBe('POST');
    expect(['status', 'list']).toContain(new URL(route.request().url()).pathname.split('/').at(-1));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false, connections: [] }) });
  });
}

function calendarEntry(day: string, title: string, person: string, start: string, end: string, extra: Record<string, unknown> = {}) {
  return { title, person, date: Timestamp.fromDate(new Date(`${day}T${start}:00+02:00`)),
    endDate: Timestamp.fromDate(new Date(`${day}T${end}:00+02:00`)), allDay: false,
    description: 'Dane testowe wyłącznie w lokalnym emulatorze.', location: '', repeat: 'none', repeatUntil: null,
    createdBy: accounts.parent.uid, ownerUid: accounts.parent.uid, createdAt: Timestamp.now(), ...extra };
}

async function seedSchedules(day: string) {
  const db = fixtureDatabase(); // Existing guard prevents writes to real Firebase.
  const batch = db.batch();
  batch.update(db.doc(`members/${accounts.sibling.uid}`), { calendarColor: '#4a36d9' });
  batch.set(db.doc('calendarEvents/timeline-work'), calendarEntry(day, 'Praca testowa', 'Sebastian', '08:00', '16:00'));
  batch.set(db.doc('calendarEvents/timeline-dominika'), calendarEntry(day, 'Rodzinny termin Dominiki', 'Dominika', '08:30', '11:00'));
  batch.set(db.doc('privateCalendarEvents/timeline-own'), calendarEntry(day, 'Prywatny czas Sebastiana', 'Sebastian', '11:00', '11:30', { private: true }));
  batch.set(db.doc('privateCalendarEvents/timeline-foreign'), calendarEntry(day, 'Poufny czas Dominiki', 'Dominika', '08:30', '09:30', {
    private: true, ownerUid: accounts.mother.uid, createdBy: accounts.mother.uid,
  }));
  for (const [id, title, time, endTime] of [
    ['timeline-sp4-polish', 'Język polski testowy', '08:00', '08:45'],
    ['timeline-sp4-maths', 'Matematyka testowa', '08:55', '09:40'],
  ]) batch.set(db.doc(`schoolItems/${id}`), {
    title, subject: title, person: 'Nikodem', type: 'lesson', source: 'eduvulcan', date: day,
    weekday: 0, time, endTime, note: '', createdBy: accounts.parent.uid, createdAt: Timestamp.now(),
  });
  for (const plannedDay of createOkruszekDays('Paweł', accounts.sibling.uid)) {
    batch.set(db.doc(`schoolItems/${await okruszekDayId(accounts.sibling.uid, plannedDay.weekday)}`), {
      ...okruszekDayEntry(plannedDay), createdBy: accounts.parent.uid, createdAt: Timestamp.now(),
    });
  }
  await batch.commit();
}

async function login(page: Page, module: 'Start' | 'Kalendarz') {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(name => { location.hash = encodeURIComponent(name); }, module);
}

async function showModule(page: Page, module: 'Start' | 'Kalendarz') {
  await page.evaluate(name => { location.hash = encodeURIComponent(name); }, module);
  if (module === 'Kalendarz') await expect(page.locator('.page-header h1')).toHaveText(module);
  else await expect(page.getByTestId('start-card-family-time')).toBeVisible();
}

async function selectPerson(page: Page, person: string) {
  await page.locator('.person-filters').getByRole('button', { name: person, exact: true }).click();
}

const axis = (page: Page) => page.getByTestId('calendar-day-time-axis');
const timed = (page: Page, id: string) => axis(page).locator(`.nr-calendar-timed-event[data-event-id="${id}"]`);
const currentStatus = (page: Page, uid: string) => page.locator(`.start-family-mini-profile[data-profile-id="${uid}"] .start-family-current-status`);

async function geometry(row: Locator) {
  return row.evaluate(element => {
    const html = element as HTMLElement;
    return { top: parseFloat(html.style.top), height: parseFloat(html.style.height),
      start: Number(html.dataset.startMinute), end: Number(html.dataset.endMinute),
      left: html.style.insetInlineStart, ownerColor: html.style.getPropertyValue('--calendar-owner-color') };
  });
}

async function preservedDocuments() {
  return Promise.all(['calendarEvents', 'privateCalendarEvents', 'schoolItems', 'tasks', 'shoppingItems', 'familyMessages', 'healthRecords'].map(async name => {
    const snapshot = await fixtureDatabase().collection(name).get();
    return { name, documents: snapshot.docs.map(item => ({ id: item.id, data: item.data() })).sort((a, b) => a.id.localeCompare(b.id)) };
  }));
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await protectRemoteCalls(page);
});

test('wspólna oś zachowuje pełną pracę, każdą lekcję i prawdziwe nakładanie godzin w pięciu rozmiarach', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${weekDay}T07:00:00Z`));
  await seedSchedules(weekDay);
  const before = await preservedDocuments();
  await login(page, 'Kalendarz');
  await expect(axis(page)).toBeVisible();
  await expect(axis(page)).toContainText('Prywatny czas Sebastiana');
  await expect(page.locator('body')).not.toContainText('Poufny czas Dominiki');
  await selectPerson(page, 'Cała rodzina');
  await expect(axis(page)).not.toContainText('Prywatny czas Sebastiana');
  const work = timed(page, 'timeline-work');
  const maths = axis(page).locator('.nr-calendar-timed-event[data-source="sp4"]').filter({ hasText: 'Matematyka testowa' });
  const lessons = axis(page).locator('.nr-calendar-timed-event[data-source="okruszek"][data-event-kind="lesson"]');
  await expect(work).toHaveCount(1);
  await expect(lessons).toHaveCount(8);
  await expect(lessons.filter({ hasText: /^WF/ })).toHaveCount(3);
  await expect(axis(page).locator('.nr-calendar-timed-event[data-source="okruszek"][data-event-kind="break"]')).toHaveCount(6);
  await expect(lessons.filter({ hasText: /^—/ })).toHaveCount(0);
  await expect(lessons.first()).toContainText('Godziny orientacyjne');
  await expect(maths).toHaveCount(1);
  expect((await geometry(work))).toMatchObject({ start: 480, end: 960, height: 960 });
  expect((await geometry(maths))).toMatchObject({ start: 535, end: 580, height: 90 });
  expect((await geometry(lessons.first())).ownerColor).toBe('#4a36d9');
  const familyIDs = await lessons.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.eventId));
  for (const [width, height] of [[390, 844], [844, 390], [900, 1440], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(work).toBeVisible();
    const workGeometry = await geometry(work), mathsGeometry = await geometry(maths), firstLesson = await geometry(lessons.first());
    expect(workGeometry.height / mathsGeometry.height).toBeCloseTo(480 / 45);
    expect(mathsGeometry.top - workGeometry.top).toBe(55 * 2);
    expect(mathsGeometry.top - firstLesson.top).toBe(5 * 2);
    expect(mathsGeometry.left).not.toBe(workGeometry.left);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await selectPerson(page, 'Paweł');
  expect(await lessons.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.eventId))).toEqual(familyIDs);
  await expect(work).toHaveCount(0);
  await expect(maths).toHaveCount(0);
  await selectPerson(page, 'Nikodem');
  await expect(lessons).toHaveCount(0);
  await expect(maths).toHaveCount(1);
  await selectPerson(page, 'Cała rodzina');
  await page.getByRole('button', { name: 'Tydzień', exact: true }).click();
  const weekCanvas = page.getByTestId('calendar-week-time-axis').locator(`.nr-calendar-time-canvas[data-day="${weekDay}"]`);
  expect(await geometry(weekCanvas.locator('[data-event-id="timeline-work"]'))).toMatchObject({ start: 480, end: 960, height: 960 });
  await expect(weekCanvas.locator('[data-source="okruszek"][data-event-kind="lesson"]').filter({ hasText: /^WF/ })).toHaveCount(3);
  expect(await preservedDocuments()).toEqual(before);
});

test('Start zmienia aktualne zajęcia i jawne przerwy automatycznie, zachowuje prywatność i odczytuje zmieniony grafik', async ({ page }) => {
  await page.clock.install({ time: new Date(`${monday}T05:54:00Z`) });
  await seedSchedules(monday);
  await login(page, 'Start');
  const pawel = currentStatus(page, accounts.sibling.uid), nikodem = currentStatus(page, accounts.child.uid);
  const sebastian = currentStatus(page, accounts.parent.uid), dominika = currentStatus(page, accounts.mother.uid);
  await expect(pawel).toHaveAttribute('data-status-kind', 'active');
  await expect(pawel).toHaveAttribute('data-status-estimated', 'false');
  await expect(pawel).toHaveText('Rewalidacja — do 07:55');
  await expect(nikodem).toHaveAttribute('data-status-kind', 'idle');
  await expect(dominika).not.toContainText('Poufny czas Dominiki');
  await page.clock.fastForward(61_000);
  await expect(pawel).toHaveAttribute('data-status-kind', 'break');
  await expect(pawel).toHaveAttribute('data-status-estimated', 'false');
  await expect(pawel).toContainText('Przerwa');
  await expect(pawel).toContainText('08:00');
  await page.clock.fastForward(5 * 60_000);
  await expect(pawel).toHaveAttribute('data-status-kind', 'active');
  await expect(pawel).toHaveAttribute('data-status-estimated', 'true');
  await expect(pawel).toHaveText('Orientacyjnie: Rewalidacja — do 08:45');
  await expect(nikodem).toHaveText('Język polski testowy — do 08:45');
  await expect(sebastian).toHaveText('Praca testowa — do 16:00');
  await page.clock.fastForward(45 * 60_000);
  await expect(nikodem).toHaveAttribute('data-status-kind', 'idle'); // A gap is not a break.
  const breakEntry = calendarEntry(monday, 'Przerwa między lekcjami', 'Nikodem', '08:45', '08:55', { eventKind: 'break' });
  await fixtureDatabase().doc('calendarEvents/timeline-explicit-break').set(breakEntry);
  await expect(nikodem).toHaveAttribute('data-status-kind', 'break');
  await expect(nikodem).toHaveText('Przerwa między lekcjami — do 08:55');
  await page.clock.fastForward(10 * 60_000);
  await expect(nikodem).toHaveText('Matematyka testowa — do 09:40');
  await expect(nikodem).toHaveAttribute('data-status-kind', 'active');
  const newWork = calendarEntry(monday, 'Praca po zmianie grafiku', 'Sebastian', '09:00', '17:00');
  await fixtureDatabase().doc('calendarEvents/timeline-work').update(newWork);
  await expect(sebastian).toHaveAttribute('data-status-kind', 'idle');
  await expect(sebastian).not.toContainText('Praca testowa');
  await showModule(page, 'Kalendarz');
  await expect(timed(page, 'timeline-work')).toContainText('Praca po zmianie grafiku');
  expect(await geometry(timed(page, 'timeline-work'))).toMatchObject({ start: 540, end: 1020, height: 960 });
  await selectPerson(page, 'Cała rodzina');
  expect(await geometry(timed(page, 'timeline-work'))).toMatchObject({ start: 540, end: 1020, height: 960 });
  await expect(axis(page)).not.toContainText('Prywatny czas Sebastiana');
  await showModule(page, 'Start');
  await page.clock.fastForward(5 * 60_000);
  await expect(sebastian).toHaveText('Praca po zmianie grafiku — do 17:00');
  await expect(sebastian).toHaveAttribute('data-status-kind', 'active');
  await expect(page.locator('body')).not.toContainText('Poufny czas Dominiki');
  expect((await fixtureDatabase().doc(`members/${accounts.sibling.uid}`).get()).data()?.calendarColor).toBe('#4a36d9');
});
