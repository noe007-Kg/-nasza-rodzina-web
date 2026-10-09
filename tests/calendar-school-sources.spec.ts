import { expect, test, type Locator, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

type Account = (typeof accounts)[keyof typeof accounts];
type View = 'Dzień' | 'Tydzień' | 'Miesiąc';
type RequestAudit = { remote: string[]; eduOperations: string[]; schoolMessageReads: string[]; firestoreWrites: string[]; privateCalendarOwners: string[]; allowManualWrites: boolean };
const audits = new WeakMap<Page, RequestAudit>();
// One date per scenario prevents a Warsaw midnight rollover from changing the
// fixture's day between seeding and navigation. Fixed Date does not stop timers.
let fixtureDay = todayKey();
const modal = (page: Page) => page.getByRole('dialog');
const viewSelector: Record<View, string> = {
  Dzień: '.calendar-day-view', Tydzień: '.calendar-week-card', Miesiąc: '.calendar-month-card',
};

function entry(title: string, person = 'Nikodem', fields: Record<string, unknown> = {}) {
  return {
    title, subject: title, person, type: 'lesson', source: 'eduvulcan', date: fixtureDay,
    time: '08:00', endTime: '08:45', weekday: 0, note: 'Sala 106',
    createdBy: accounts.parent.uid, createdAt: Timestamp.now(), ...fields,
  };
}

function calendarEntry(title: string, fields: Record<string, unknown> = {}) {
  return {
    // UTC midday stays on the same Warsaw date across both DST offsets.
    title, person: 'family', date: Timestamp.fromDate(new Date(`${fixtureDay}T12:00:00Z`)),
    endDate: Timestamp.fromDate(new Date(`${fixtureDay}T13:00:00Z`)), allDay: false,
    description: '', location: '', repeat: 'none', repeatUntil: null,
    createdBy: accounts.parent.uid, createdAt: Timestamp.now(), ...fields,
  };
}

async function seedSchool() {
  const db = fixtureDatabase();
  await Promise.all([
    db.doc('schoolItems/calendar-sp4-nikodem').set(entry('Przyroda ze źródła SP4')),
    db.doc('schoolItems/calendar-sp4-pawel').set(entry('Fizyka ze źródła SP4', 'Paweł', { time: '10:00', endTime: '10:45' })),
    db.doc('schoolItems/calendar-sp4-message').set(entry('Sekretna wiadomość nie jest zajęciem', 'Nikodem', { type: 'message' })),
    db.doc('schoolParentMessages/calendar-parent-secret').set(entry('Poufna skrzynka rodzica SP4', 'Nikodem', { type: 'message', note: 'Treść tylko dla rodzica' })),
    db.doc('schoolStudentMessages/calendar-student-secret').set(entry('Skrzynka ucznia nie jest planem', 'Nikodem', { type: 'message', sourceOwnerUid: accounts.child.uid })),
  ]);
}

async function seedPrivateCalendars() {
  const db = fixtureDatabase();
  for (const [account, title] of [
    [accounts.parent, 'Prywatny termin Sebastiana'],
    [accounts.child, 'Prywatny termin Nikodema'],
    [accounts.sibling, 'Prywatny termin Pawła'],
  ] as const) {
    await db.doc(`privateCalendarEvents/source-owner-${account.uid}`).set(calendarEntry(title, {
      person: account.name, createdBy: account.uid, ownerUid: account.uid, private: true,
    }));
  }
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

async function chooseView(page: Page, view: View) {
  await page.locator('.view-switch').getByRole('button', { name: view, exact: true }).click();
  await expect(page.locator(viewSelector[view])).toBeVisible();
  return page.locator(viewSelector[view]);
}

function eventButton(scope: Locator, title: string) {
  return scope.locator('.calendar-event').filter({ hasText: title });
}

async function preservedDocuments() {
  const collections = ['schoolItems', 'schoolParentMessages', 'schoolStudentMessages', 'calendarEvents', 'privateCalendarEvents'];
  return Promise.all(collections.map(async name => {
    const snapshot = await fixtureDatabase().collection(name).get();
    return { name, documents: snapshot.docs.map(item => ({ id: item.id, data: item.data() })).sort((a, b) => a.id.localeCompare(b.id)) };
  }));
}

function privateCalendarRequestOwners(body: string | null, search: string): string[] {
  const candidates = [body || ''];
  for (const encoded of [body || '', search]) {
    for (const [key, value] of new URLSearchParams(encoded)) {
      if (key.endsWith('___data__')) candidates.push(value);
    }
  }
  const owners: string[] = [];
  for (const candidate of candidates) {
    let parsed;
    try { parsed = JSON.parse(candidate); } catch { continue; }
    const structured = parsed?.addTarget?.query?.structuredQuery || parsed?.structuredQuery;
    if (!structured?.from?.some((item: { collectionId?: string }) => item.collectionId === 'privateCalendarEvents')) continue;
    const filter = structured.where?.fieldFilter;
    owners.push(filter?.field?.fieldPath === 'ownerUid' && filter.op === 'EQUAL'
      && typeof filter.value?.stringValue === 'string' ? filter.value.stringValue : 'unscoped');
  }
  return owners;
}

test.beforeEach(async ({ page }) => {
  fixtureDay = todayKey();
  await page.clock.setFixedTime(new Date(`${fixtureDay}T10:00:00Z`));
  // fixtureDatabase/seedEmulators refuse every host except the demo localhost emulators.
  await seedEmulators();
  await seedSchool();
  const audit: RequestAudit = { remote: [], eduOperations: [], schoolMessageReads: [], firestoreWrites: [], privateCalendarOwners: [], allowManualWrites: false };
  audits.set(page, audit);
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, async route => {
    // Store only the hostname; query strings, credentials and request bodies are never logged.
    audit.remote.push(new URL(route.request().url()).hostname);
    await route.abort('blockedbyclient');
  });
  await page.route(/https:\/\/[^/]*(?:eduvulcan\.pl|vulcan\.net\.pl)\//, async route => {
    audit.remote.push(new URL(route.request().url()).hostname);
    await route.abort('blockedbyclient');
  });
  await page.route('**/api/eduvulcan/**', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5173') {
      audit.remote.push(url.hostname);
      await route.abort('blockedbyclient');
      return;
    }
    const operation = url.pathname.split('/').at(-1)!;
    audit.eduOperations.push(operation);
    // The existing global parent activation hook reads status on login. No provider
    // protocol is mocked or contacted, and these read-only Calendar tests never sync.
    if (operation === 'status') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) });
    } else await route.abort('blockedbyclient');
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || url.port !== '8080') return;
    audit.privateCalendarOwners.push(...privateCalendarRequestOwners(request.postData(), url.search));
    if (/\/Write(?:\/|$)|\/documents:(?:commit|batchWrite)$/.test(url.pathname)) audit.firestoreWrites.push('Firestore Write');
    let payload = `${url.pathname}${url.search}${request.postData() || ''}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { payload = decodeURIComponent(payload); } catch { break; }
    }
    for (const name of ['schoolParentMessages', 'schoolStudentMessages']) {
      if (payload.includes(name)) audit.schoolMessageReads.push(name);
    }
  });
});

test.afterEach(async ({ page }) => {
  const audit = audits.get(page)!;
  expect(audit.remote, 'No remote Firebase or school portal may be contacted').toEqual([]);
  expect(audit.eduOperations.filter(operation => operation !== 'status'), 'A calendar projection must never connect, sync or disconnect eduVULCAN').toEqual([]);
  expect(audit.schoolMessageReads, 'The calendar must not subscribe to either school message inbox').toEqual([]);
  if (!audit.allowManualWrites) expect(audit.firestoreWrites, 'Viewing school projections must not write to Firestore').toEqual([]);
});

test('kalendarz SP4: rodzic widzi rzeczywiste datowane zajęcia obojga dzieci w Dzień / Tydzień / Miesiąc, bez importu', async ({ page }) => {
  await seedPrivateCalendars();
  const before = await preservedDocuments();
  await loginCalendar(page);
  for (const view of ['Dzień', 'Tydzień', 'Miesiąc'] as const) {
    const main = await chooseView(page, view);
    for (const title of ['Przyroda ze źródła SP4', 'Fizyka ze źródła SP4']) {
      const row = eventButton(main, title);
      await expect(row).toHaveCount(1);
      await expect(row.getByTestId('calendar-source-badge')).toHaveText('SP4');
    }
    await expect(main).not.toContainText('Sekretna wiadomość nie jest zajęciem');
    await expect(main).not.toContainText('Poufna skrzynka rodzica SP4');
    await expect(main).not.toContainText('Skrzynka ucznia nie jest planem');
    await expect(eventButton(main, 'Prywatny termin Sebastiana')).toHaveCount(1);
    await expect(page.locator('.calendar-package')).not.toContainText('Prywatny termin Nikodema');
    await expect(page.locator('.calendar-package')).not.toContainText('Prywatny termin Pawła');
  }
  await eventButton(page.locator('.calendar-month-card'), 'Przyroda ze źródła SP4').click();
  await expect(modal(page)).toContainText(/08:00\s*[–-]\s*08:45/);
  await expect(modal(page)).toContainText('Tylko do odczytu');
  await modal(page).getByRole('button', { name: 'Zamknij', exact: true }).click();
  expect(await preservedDocuments()).toEqual(before);
});

test('kalendarz SP4: dziecko odczytuje wyłącznie własne zajęcia, bez skrzynki rodzica i bez edu API', async ({ page }) => {
  await seedPrivateCalendars();
  await loginCalendar(page, accounts.child);
  for (const view of ['Dzień', 'Tydzień', 'Miesiąc'] as const) {
    const main = await chooseView(page, view);
    await expect(eventButton(main, 'Przyroda ze źródła SP4')).toHaveCount(1);
    await expect(page.locator('.calendar-package')).not.toContainText('Fizyka ze źródła SP4');
    await expect(page.locator('.calendar-package')).not.toContainText('Poufna skrzynka rodzica SP4');
    await expect(page.locator('.calendar-package')).not.toContainText('Treść tylko dla rodzica');
    await expect(eventButton(main, 'Prywatny termin Nikodema')).toHaveCount(1);
    await expect(page.locator('.calendar-package')).not.toContainText('Prywatny termin Sebastiana');
    await expect(page.locator('.calendar-package')).not.toContainText('Prywatny termin Pawła');
  }
  expect(audits.get(page)!.eduOperations).toEqual([]);
});

test('kalendarz SP4: szczegóły są tylko do odczytu, a ręczna edycja i usuwanie nadal działają', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc('calendarEvents/calendar-manual-crud').set(calendarEntry('Ręczne rodzinne wydarzenie'));
  const schoolBefore = (await preservedDocuments()).filter(item => item.name.startsWith('school'));
  await loginCalendar(page);
  await eventButton(page.locator('.calendar-week-card'), 'Przyroda ze źródła SP4').click();
  await expect(modal(page)).toContainText('Przyroda ze źródła SP4');
  await expect(modal(page)).toContainText('SP4');
  await expect(modal(page).getByRole('button', { name: /Edytuj|Usuń/ })).toHaveCount(0);
  await modal(page).getByRole('button', { name: 'Zamknij', exact: true }).click();
  expect(audits.get(page)!.firestoreWrites).toEqual([]);
  audits.get(page)!.allowManualWrites = true;
  await eventButton(page.locator('.calendar-week-card'), 'Ręczne rodzinne wydarzenie').click();
  await modal(page).getByRole('button', { name: /Edytuj/ }).click();
  await modal(page).getByLabel('Nazwa wydarzenia').fill('Ręczny wpis po zmianie');
  await modal(page).getByRole('button', { name: /Zapisz zmiany/ }).click();
  await expect(modal(page).getByRole('heading', { name: 'Ręczny wpis po zmianie', exact: true })).toBeVisible();
  await expect.poll(async () => (await db.doc('calendarEvents/calendar-manual-crud').get()).data()?.title).toBe('Ręczny wpis po zmianie');
  page.once('dialog', dialog => dialog.accept());
  await modal(page).getByRole('button', { name: /Usuń/ }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect.poll(async () => (await db.doc('calendarEvents/calendar-manual-crud').get()).exists).toBe(false);
  expect((await preservedDocuments()).filter(item => item.name.startsWith('school'))).toEqual(schoolBefore);
  expect((await db.collection('calendarEvents').get()).empty).toBe(true);
});

test('kalendarz SP4: odwołana lekcja pozostaje widoczna w każdym widoku i nie jest usuwana', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc('schoolItems/calendar-sp4-nikodem').update({ note: 'Lekcja odwołana\nSala 106' });
  await loginCalendar(page);
  for (const view of ['Dzień', 'Tydzień', 'Miesiąc'] as const) {
    const row = eventButton(await chooseView(page, view), 'Przyroda ze źródła SP4');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('ODWOŁANE');
    await row.click();
    await expect(modal(page)).toContainText('ODWOŁANE');
    await expect(modal(page).getByRole('button', { name: /Edytuj|Usuń/ })).toHaveCount(0);
    await modal(page).getByRole('button', { name: 'Zamknij', exact: true }).click();
  }
  expect((await db.doc('schoolItems/calendar-sp4-nikodem').get()).exists).toBe(true);
  expect((await db.collection('calendarEvents').get()).empty).toBe(true);
});

test('kalendarz SP4: aktualizacja tego samego ID odświeża kartę i szczegóły, a brak rekordu nie udaje odwołania', async ({ page }) => {
  const db = fixtureDatabase();
  await loginCalendar(page);
  const main = page.locator('.calendar-week-card');
  await eventButton(main, 'Przyroda ze źródła SP4').click();
  await expect(modal(page)).toContainText('Przyroda ze źródła SP4');
  await db.doc('schoolItems/calendar-sp4-nikodem').update({
    title: 'Zaktualizowana przyroda SP4', note: 'Lekcja odwołana\nSala 108', time: '09:00', endTime: '09:50',
  });
  const updatedRow = eventButton(main, 'Zaktualizowana przyroda SP4');
  await expect(updatedRow).toHaveCount(1);
  await expect(updatedRow).toContainText('ODWOŁANE');
  await expect(updatedRow.getByTestId('calendar-source-badge')).toHaveText('SP4');
  await expect(main).not.toContainText('Przyroda ze źródła SP4');
  await expect(modal(page).getByRole('heading', { name: 'Zaktualizowana przyroda SP4', exact: true })).toBeVisible();
  await expect(modal(page)).toContainText(/09:00\s*[–-]\s*09:50/);
  await expect(modal(page)).toContainText('Sala 108');
  await expect(modal(page)).toContainText('ODWOŁANE');
  await expect(modal(page).getByRole('button', { name: /Edytuj|Usuń/ })).toHaveCount(0);

  // A missing snapshot record does not prove provider cancellation. No tombstone
  // or calendar document may be invented, and an open stale detail must close.
  await db.doc('schoolItems/calendar-sp4-nikodem').delete();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator('.calendar-package')).not.toContainText('Zaktualizowana przyroda SP4');
  await expect(page.locator('.calendar-package')).not.toContainText('ODWOŁANE');
  await expect(eventButton(main, 'Fizyka ze źródła SP4')).toHaveCount(1);
  expect((await db.collection('calendarEvents').get()).empty).toBe(true);
  expect((await db.doc('schoolItems/calendar-sp4-nikodem').get()).exists).toBe(false);
});

test('kalendarz SP4: brak godziny lub daty nie tworzy fikcyjnego terminu; inne źródła i oceny nie stają się zajęciami', async ({ page }) => {
  const db = fixtureDatabase();
  await Promise.all([
    db.doc('schoolItems/calendar-no-start').set(entry('Zajęcia bez godziny rozpoczęcia', 'Nikodem', { time: '' })),
    db.doc('schoolItems/calendar-no-end').set(entry('Zajęcia bez godziny końca', 'Nikodem', { endTime: '' })),
    db.doc('schoolItems/calendar-weekly-only').set(entry('Plan bez daty nie jest importowany', 'Nikodem', { date: '', weekday: new Date().getDay() || 7 })),
    db.doc('schoolItems/calendar-other-source').set(entry('Niepotwierdzone źródło Fryderyk', 'Nikodem', { source: 'fryderyk' })),
    db.doc('schoolItems/calendar-grade').set(entry('Ocena nie jest zajęciem', 'Nikodem', { type: 'grade' })),
    db.doc('schoolItems/calendar-activity').set(entry('Datowane zajęcia dodatkowe SP4', 'Nikodem', { type: 'activity', time: '15:00', endTime: '15:45' })),
  ]);
  await loginCalendar(page);
  const main = await chooseView(page, 'Dzień');
  await expect(eventButton(main, 'Przyroda ze źródła SP4')).toHaveCount(1);
  await expect(eventButton(main, 'Datowane zajęcia dodatkowe SP4')).toHaveCount(1);
  await expect(page.locator('.calendar-source-notice').filter({ hasText: 'bez pełnej daty lub godzin' })).toContainText('3 wpisów bez pełnej daty lub godzin');
  for (const title of ['Zajęcia bez godziny rozpoczęcia', 'Zajęcia bez godziny końca', 'Plan bez daty nie jest importowany', 'Niepotwierdzone źródło Fryderyk', 'Ocena nie jest zajęciem']) {
    await expect(page.locator('.calendar-package')).not.toContainText(title);
  }
});

test('kalendarz SP4: istniejący link eliminuje duplikat, nieaktualny link nie ukrywa zajęć i namespace nie koliduje z ręcznym ID', async ({ page }) => {
  const db = fixtureDatabase();
  await Promise.all([
    db.doc('calendarEvents/actual-calendar-link').set(calendarEntry('Rzeczywisty połączony wpis')),
    db.doc('schoolItems/calendar-actual-link').set(entry('Nie twórz drugiego połączonego wpisu', 'Nikodem', { calendarEventId: 'actual-calendar-link' })),
    db.doc('schoolItems/calendar-stale-link').set(entry('Zajęcia z nieaktualnym linkiem', 'Nikodem', { calendarEventId: 'missing-calendar-link' })),
    db.doc('schoolItems/same-id').set(entry('Szkolny wpis z tym samym ID')),
    db.doc('calendarEvents/same-id').set(calendarEntry('Ręczny wpis z tym samym ID')),
  ]);
  const before = await preservedDocuments();
  await loginCalendar(page);
  const main = await chooseView(page, 'Dzień');
  for (const title of ['Rzeczywisty połączony wpis', 'Zajęcia z nieaktualnym linkiem', 'Szkolny wpis z tym samym ID', 'Ręczny wpis z tym samym ID']) {
    await expect(eventButton(main, title)).toHaveCount(1);
  }
  await expect(page.locator('.calendar-package')).not.toContainText('Nie twórz drugiego połączonego wpisu');
  expect(await preservedDocuments()).toEqual(before);
});

test('kalendarz SP4: zmiana rodzic → dziecko usuwa szeroki cache i zamyka szczegóły rodzeństwa bez reloadu', async ({ page }) => {
  await loginCalendar(page);
  await eventButton(page.locator('.calendar-week-card'), 'Fizyka ze źródła SP4').click();
  await expect(modal(page)).toContainText('Fizyka ze źródła SP4');
  await fixtureDatabase().doc(`members/${accounts.parent.uid}`).update({ role: 'child', name: 'Nikodem', personKey: 'Nikodem' });
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator('.calendar-package')).not.toContainText('Fizyka ze źródła SP4');
  await expect(eventButton(page.locator('.calendar-week-card'), 'Przyroda ze źródła SP4')).toHaveCount(1);
  await chooseView(page, 'Dzień');
  await chooseView(page, 'Tydzień');
  await expect(page.locator('.calendar-package')).not.toContainText('Fizyka ze źródła SP4');
});

test('kalendarz: otwarte szczegóły odświeżają zapisany wpis i znikają po przeniesieniu do prywatnego kalendarza innego rodzica', async ({ page }) => {
  const db = fixtureDatabase();
  const id = 'calendar-family-to-other-private';
  const shared = db.doc(`calendarEvents/${id}`);
  await shared.set(calendarEntry('Rodzinny termin przed zmianą', {
    createdBy: accounts.mother.uid, ownerUid: accounts.mother.uid,
    description: 'Pierwotna notatka widoczna rodzinie', location: 'Pierwotne miejsce',
  }));
  await loginCalendar(page);
  const main = page.locator('.calendar-week-card');
  await eventButton(main, 'Rodzinny termin przed zmianą').click();
  await expect(modal(page).getByRole('heading', { name: 'Rodzinny termin przed zmianą', exact: true })).toBeVisible();
  await expect(modal(page)).toContainText('Pierwotna notatka widoczna rodzinie');

  await shared.update({
    title: 'Rodzinny termin po rzeczywistej zmianie', description: 'Zaktualizowana notatka rodzinna', location: 'Nowe miejsce',
    date: Timestamp.fromDate(new Date(`${fixtureDay}T14:00:00Z`)),
    endDate: Timestamp.fromDate(new Date(`${fixtureDay}T14:30:00Z`)),
  });
  await expect(modal(page).getByRole('heading', { name: 'Rodzinny termin po rzeczywistej zmianie', exact: true })).toBeVisible();
  await expect(modal(page)).toContainText('Zaktualizowana notatka rodzinna');
  await expect(modal(page)).toContainText('Nowe miejsce');
  const expectedTime = (value: string) => new Date(value).toLocaleTimeString('pl-PL', {
    timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit',
  });
  await expect(modal(page)).toContainText(`${expectedTime(`${fixtureDay}T14:00:00Z`)} – ${expectedTime(`${fixtureDay}T14:30:00Z`)}`);
  await expect(modal(page)).not.toContainText('Pierwotna notatka widoczna rodzinie');

  const current = (await shared.get()).data()!;
  const batch = db.batch();
  batch.set(db.doc(`privateCalendarEvents/${id}`), {
    ...current, private: true, ownerUid: accounts.mother.uid, createdBy: accounts.mother.uid,
    title: 'Prywatny termin Dominiki po przeniesieniu', description: 'Poufna nowa notatka Dominiki',
  });
  batch.delete(shared);
  await batch.commit();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator('.calendar-package')).not.toContainText('Rodzinny termin po rzeczywistej zmianie');
  await expect(page.locator('.calendar-package')).not.toContainText('Zaktualizowana notatka rodzinna');
  await expect(page.locator('.calendar-package')).not.toContainText('Prywatny termin Dominiki po przeniesieniu');
  await expect(page.locator('.calendar-package')).not.toContainText('Poufna nowa notatka Dominiki');
  await chooseView(page, 'Dzień');
  await chooseView(page, 'Tydzień');
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator('.calendar-package')).not.toContainText('Prywatny termin Dominiki po przeniesieniu');
  expect((await shared.get()).exists).toBe(false);
  expect((await db.doc(`privateCalendarEvents/${id}`).get()).data()?.ownerUid).toBe(accounts.mother.uid);
  const owners = audits.get(page)!.privateCalendarOwners;
  expect(owners.length, 'Audit must observe the actual private calendar query').toBeGreaterThan(0);
  expect(owners.every(owner => owner === accounts.parent.uid), 'The browser must keep its ownerUid filter after another parent privatizes an event').toBe(true);
});

test('kalendarz SP4: korekta personKey zmienia zakres odczytu, niepoprawny klucz usuwa dane i otwarte szczegóły', async ({ page }) => {
  const db = fixtureDatabase();
  await loginCalendar(page, accounts.child);
  await expect(eventButton(page.locator('.calendar-week-card'), 'Przyroda ze źródła SP4')).toHaveCount(1);
  await db.doc(`members/${accounts.child.uid}`).update({ name: 'Paweł', personKey: 'Paweł' });
  await expect(eventButton(page.locator('.calendar-week-card'), 'Fizyka ze źródła SP4')).toHaveCount(1);
  await expect(page.locator('.calendar-package')).not.toContainText('Przyroda ze źródła SP4');
  await eventButton(page.locator('.calendar-week-card'), 'Fizyka ze źródła SP4').click();
  await expect(modal(page)).toContainText('Fizyka ze źródła SP4');
  await db.doc(`members/${accounts.child.uid}`).update({ personKey: '' });
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator('.calendar-package')).not.toContainText('Fizyka ze źródła SP4');
  await expect(page.locator('.calendar-package')).not.toContainText('Przyroda ze źródła SP4');
  await db.doc(`members/${accounts.child.uid}`).update({ name: 'Nikodem', personKey: 'Nikodem' });
  await expect(eventButton(page.locator('.calendar-week-card'), 'Przyroda ze źródła SP4')).toHaveCount(1);
  await expect(page.locator('.calendar-package')).not.toContainText('Fizyka ze źródła SP4');
  expect(audits.get(page)!.eduOperations).toEqual([]);
});

test('kalendarz SP4: wylogowanie rodzica i login dziecka nie przenosi szkolnych ani prywatnych szczegółów', async ({ page }) => {
  const db = fixtureDatabase();
  await db.doc('privateCalendarEvents/calendar-parent-private').set(calendarEntry('Prywatny termin rodzica', { person: 'Sebastian', private: true, ownerUid: accounts.parent.uid }));
  await loginCalendar(page);
  await expect(page.locator('.calendar-package')).toContainText('Prywatny termin rodzica');
  await page.evaluate(() => { location.hash = encodeURIComponent('Ustawienia'); });
  await expect(page.locator('.page-header h1')).toHaveText('Ustawienia');
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
  const parentOperationCount = audits.get(page)!.eduOperations.length;
  await loginCalendar(page, accounts.child);
  await expect(eventButton(page.locator('.calendar-week-card'), 'Przyroda ze źródła SP4')).toHaveCount(1);
  await expect(page.locator('.calendar-package')).not.toContainText('Fizyka ze źródła SP4');
  await expect(page.locator('.calendar-package')).not.toContainText('Prywatny termin rodzica');
  await expect(modal(page)).toHaveCount(0);
  expect(audits.get(page)!.eduOperations.slice(parentOperationCount)).toEqual([]);
});

test('kalendarz SP4: etykiety źródła i odwołania nie powodują poziomego przewijania w pięciu rozmiarach', async ({ page }) => {
  await fixtureDatabase().doc('schoolItems/calendar-sp4-nikodem').update({ note: 'Lekcja odwołana\nSala 106' });
  await loginCalendar(page);
  const main = await chooseView(page, 'Dzień');
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    const row = eventButton(main, 'Przyroda ze źródła SP4');
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByTestId('calendar-source-badge')).toBeVisible();
    await expect(row).toContainText('ODWOŁANE');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
