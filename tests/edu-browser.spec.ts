import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

type Account = (typeof accounts)[keyof typeof accounts];
type Operation = 'status' | 'connect' | 'select' | 'sync' | 'disconnect';
type Profile = { id: string; studentName: string; schoolName: string; schoolSymbol?: string; className?: string; academicYear?: string };
type ConnectionStatus = {
  configured: boolean;
  state: 'disconnected' | 'needs_profile' | 'connected' | 'expired';
  profiles: Profile[];
  selectedStudent?: { profileId: string; personKey: string };
  expiresAt?: string;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  lastErrorCode?: string;
};
type ApiBody = { ok: true; status: ConnectionStatus; sync?: { counts: Record<string, number>; warnings?: string[] } }
  | { ok: false; error: { code: string; message: string } };
type MockResponse = { body?: ApiBody; httpStatus?: number; contentType?: string; rawBody?: string };
type Call = { operation: string; method: string; authenticated: boolean; sameOrigin: boolean; bodyMatches: boolean; credentialStored: boolean };

const eduLogin = 'rodzic@example.test';
const eduPassword = 'EduBrowserFixture!2026';
const parentMessageTitle = 'Poufna wiadomość szkolna dla rodzica E2E';
const parentMessageNote = 'Poufna treść wiadomości o Nikodemie E2E';
const profiles: Profile[] = [
  { id: 'nikodem-kindergarten', studentName: 'Nikodem', schoolName: 'Przedszkole nr 7', schoolSymbol: 'P7', className: 'Zerówka', academicYear: '2025/2026' },
  { id: 'nikodem-sp4', studentName: 'Nikodem', schoolName: 'Szkoła Podstawowa nr 4', schoolSymbol: 'SP4', className: '1A', academicYear: '2026/2027' },
];
const disconnected: ConnectionStatus = { configured: true, state: 'disconnected', profiles: [] };
const needsProfile: ConnectionStatus = { configured: true, state: 'needs_profile', profiles };
// These tests exercise explicit connection controls. Activation-based refresh
// has its own cases; a recent successful sync keeps it out of this fixture.
const recentSyncAt = new Date(Date.now() - 10 * 60_000).toISOString();
const connected: ConnectionStatus = {
  configured: true, state: 'connected', profiles,
  selectedStudent: { profileId: 'nikodem-sp4', personKey: 'Nikodem' },
  expiresAt: '2026-12-31T23:59:59.000Z',
  lastSyncAt: recentSyncAt,
  lastSuccessAt: recentSyncAt,
};

async function containsStoredCredential(page: Page) {
  // Return a boolean; credentials and storage values must never appear in assertion output.
  return page.evaluate((credential) => [localStorage, sessionStorage].some((storage) =>
    Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) || '') || '')
      .some((value) => value.includes(credential))), eduPassword);
}

async function mockApi(page: Page, initial: ConnectionStatus, handlers: Partial<Record<Operation, () => MockResponse | Promise<MockResponse>>> = {}) {
  let status = initial;
  const calls: Call[] = [];
  await page.route('**/api/eduvulcan/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const operation = url.pathname.split('/').at(-1) || '';
    const method = request.method();
    const expectedMethod = operation === 'status' ? 'GET' : 'POST';
    let bodyMatches = method === expectedMethod;
    if (method === 'POST') {
      let body: unknown;
      try { body = request.postDataJSON(); } catch { bodyMatches = false; }
      const values = body as Record<string, unknown> | undefined;
      if (operation === 'connect') bodyMatches &&= values?.login === eduLogin && values.password === eduPassword && Object.keys(values).length === 2;
      else if (operation === 'select') bodyMatches &&= values?.profileId === 'nikodem-sp4' && values.personKey === 'Nikodem' && Object.keys(values).length === 2;
      else bodyMatches &&= !!values && Object.keys(values).length === 0;
    }
    calls.push({
      operation, method, bodyMatches,
      authenticated: /^Bearer\s+\S+$/.test(request.headers().authorization || ''),
      sameOrigin: url.origin === new URL(page.url()).origin,
      credentialStored: await containsStoredCredential(page),
    });
    const handler = handlers[operation as Operation];
    const response: MockResponse = handler ? await handler() : operation === 'status'
      ? { body: { ok: true, status } }
      : { httpStatus: 500, body: { ok: false, error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Nieoczekiwane żądanie testowe.' } } };
    if (response.body?.ok) status = response.body.status;
    await route.fulfill({
      status: response.httpStatus || 200,
      contentType: response.contentType || 'application/json',
      body: response.rawBody ?? JSON.stringify(response.body),
    });
  });
  return calls;
}

function expectAuthorizedCalls(calls: Call[]) {
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((call) => call.authenticated && call.sameOrigin && call.bodyMatches)).toBe(true);
  expect(calls.some((call) => call.credentialStored)).toBe(false);
}

async function loginSchool(page: Page, account: Account = accounts.parent) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Szkoła', exact: true }).click();
  await expect(page.locator('.school-heading')).toContainText('Szkoła');
  await expect(page.locator('.school-loading')).toHaveCount(0);
}

async function submitCredentials(page: Page) {
  const panel = page.locator('.edu-vulcan-connection');
  await panel.getByLabel('Login lub e-mail eduVULCAN', { exact: true }).fill(eduLogin);
  await panel.getByLabel('Hasło eduVULCAN', { exact: true }).fill(eduPassword);
  await panel.getByRole('button', { name: 'Połącz', exact: true }).click();
}

async function seedParentMessage() {
  await fixtureDatabase().doc('schoolParentMessages/eduvulcan-browser-private-message').set({
    person: 'Nikodem', type: 'message', title: parentMessageTitle, note: parentMessageNote,
    subject: '', date: todayKey(), time: '', endTime: '', weekday: 0,
    source: 'eduvulcan', sourceProfileId: 'nikodem-sp4',
    createdAt: Timestamp.now(), syncedAt: Timestamp.now(),
  });
}

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, (route) => {
    throw new Error(`eduVULCAN test attempted production Firebase access: ${route.request().url()}`);
  });
});

test('eduVULCAN: rodzic jawnie wybiera SP4 i dziecko, następnie synchronizuje i rozłącza dziennik', async ({ page }) => {
  const calls = await mockApi(page, disconnected, {
    connect: () => ({ body: { ok: true, status: needsProfile } }),
    select: () => ({ body: { ok: true, status: connected } }),
    sync: () => ({ body: { ok: true, status: { ...connected, lastSyncAt: '2026-10-01T10:00:00.000Z', lastSuccessAt: '2026-10-01T10:00:00.000Z' }, sync: { counts: { grade: 3, lesson: 2, message: 1 } } } }),
    disconnect: () => ({ body: { ok: true, status: disconnected } }),
  });
  await loginSchool(page);
  const panel = page.locator('.edu-vulcan-connection');
  await expect(panel.getByRole('heading', { name: 'eduVULCAN', level: 2, exact: true })).toBeVisible();
  await submitCredentials(page);
  await expect(panel.getByLabel('Hasło eduVULCAN', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('radio')).toHaveCount(2);
  await expect(panel.getByRole('radio').locator('..').first()).toContainText('2025/2026');
  await expect(panel.getByRole('radio').locator('..').last()).toContainText('2026/2027');
  await expect(panel.locator('input[type="radio"]:checked')).toHaveCount(0);
  const student = panel.getByLabel('Dziecko w Naszej Rodzinie', { exact: true });
  const select = panel.getByRole('button', { name: 'Połącz wybrany dziennik', exact: true });
  await expect(student).toHaveValue('');
  await expect(select).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Synchronizuj teraz', exact: true })).toHaveCount(0);
  expect(calls.filter((call) => call.operation === 'select' || call.operation === 'sync')).toHaveLength(0);
  await panel.getByRole('radio', { name: /Nikodem.*Szkoła Podstawowa nr 4/ }).check();
  await expect(select).toBeDisabled();
  await student.selectOption('Nikodem');
  await panel.getByRole('radio', { name: /Nikodem.*Przedszkole nr 7/ }).check();
  await expect(select).toBeEnabled();
  await panel.getByRole('radio', { name: /Nikodem.*Szkoła Podstawowa nr 4/ }).check();
  await student.selectOption('');
  await expect(select).toBeDisabled();
  await student.selectOption('Nikodem');
  await select.click();
  await expect(panel.locator('.edu-vulcan-state')).toHaveText('Połączono');
  await expect(panel).toContainText('Szkoła Podstawowa nr 4');
  await expect(panel).toContainText('Nikodem');
  await expect.poll(() => calls.filter((call) => call.operation === 'sync').length).toBe(1);
  await expect(panel.locator('.edu-vulcan-summary')).toContainText('Ostatnia udana synchronizacja');
  await expect(panel.locator('.edu-vulcan-summary')).toContainText('1 października 2026');
  await expect(panel.locator('.edu-vulcan-counts > div').filter({ hasText: 'Oceny' })).toContainText('3');
  await expect(panel.locator('.edu-vulcan-counts > div').filter({ hasText: 'Lekcje' })).toContainText('2');
  await expect(panel.locator('.edu-vulcan-counts > div').filter({ hasText: 'Wiadomości rodzica' })).toContainText('1');
  await panel.getByRole('button', { name: 'Synchronizuj teraz', exact: true }).click();
  await expect.poll(() => calls.filter((call) => call.operation === 'sync').length).toBe(2);
  await expect(panel.getByRole('button', { name: 'Synchronizuj teraz', exact: true })).toBeEnabled();
  await expect(panel.locator('.edu-vulcan-notice')).toContainText('Odświeżanie danych zostało zakończone');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Rozłącz', exact: true }).click();
  const confirmation = panel.getByRole('button', { name: 'Rozłącz i usuń dostęp', exact: true });
  await expect(confirmation).toBeVisible();
  expect(calls.filter((call) => call.operation === 'disconnect')).toHaveLength(0);
  await confirmation.click();
  await expect(panel.getByLabel('Login lub e-mail eduVULCAN', { exact: true })).toBeVisible();
  await expect(panel.locator('.edu-vulcan-state')).toHaveText('Niepołączono');
  await expect(panel.getByLabel('Hasło eduVULCAN', { exact: true })).toHaveValue('');
  expect(calls.map((call) => call.operation)).toEqual(['status', 'connect', 'select', 'sync', 'sync', 'disconnect']);
  expectAuthorizedCalls(calls);
  expect(await containsStoredCredential(page)).toBe(false);
});

test('eduVULCAN: błędne logowanie i blokada prób mają czytelny błąd, a hasło znika z formularza', async ({ page }) => {
  let attempts = 0;
  const calls = await mockApi(page, disconnected, {
    connect: () => {
      attempts += 1;
      return attempts === 1
        ? { httpStatus: 401, body: { ok: false, error: { code: 'EDU_INVALID_CREDENTIALS', message: 'Nieprawidłowy login lub hasło eduVULCAN.' } } }
        : { httpStatus: 429, body: { ok: false, error: { code: 'EDU_LOGIN_COOLDOWN', message: 'Zbyt wiele prób logowania.' } } };
    },
  });
  await loginSchool(page);
  await submitCredentials(page);
  const panel = page.locator('.edu-vulcan-connection');
  await expect(panel.getByRole('alert')).toContainText(/login|hasło|logowani/i);
  await expect(panel.getByLabel('Hasło eduVULCAN', { exact: true })).toHaveValue('');
  await expect(panel.getByRole('radio')).toHaveCount(0);
  await submitCredentials(page);
  await expect(panel.getByRole('alert')).toContainText(/odczekaj/i);
  await expect(panel.getByRole('alert')).toContainText(/prób logowania/i);
  await expect(panel.getByLabel('Hasło eduVULCAN', { exact: true })).toHaveValue('');
  await expect(panel.getByRole('radio')).toHaveCount(0);
  expect(calls.map((call) => call.operation)).toEqual(['status', 'connect', 'connect']);
  expectAuthorizedCalls(calls);
  expect(await containsStoredCredential(page)).toBe(false);
});

test('eduVULCAN: jedno połączenie Dominiki jest dostępne Sebastianowi z pełnym imieniem i bez personKey', async ({ page }) => {
  const db = fixtureDatabase();
  // The application role grants access; optional display names cannot revoke it.
  await db.doc(`members/${accounts.mother.uid}`).set({ name: 'Dominika Rodzic', role: 'parent', active: true, canLogin: true, adult: true });
  await db.doc(`members/${accounts.parent.uid}`).set({ name: 'Sebastian Rodzic', role: 'parent', active: true, canLogin: true, adult: true });
  await db.doc('schoolItems/eduvulcan-family-shared-grade').set({
    person: 'Nikodem', type: 'grade', title: 'Ocena wspólnego dziennika E2E', subject: 'Edukacja',
    date: todayKey(), time: '', endTime: '', weekday: 0, note: '',
    source: 'eduvulcan', sourceProfileId: 'nikodem-sp4',
    createdBy: accounts.mother.uid, createdAt: Timestamp.now(), syncedAt: Timestamp.now(),
  });
  await seedParentMessage();
  const sharedStatus = { ...connected, lastSyncAt: recentSyncAt, lastSuccessAt: recentSyncAt };
  // One route state survives changing application identity. The eduVULCAN
  // fixture password belongs to the shared provider account, not both parents.
  const calls = await mockApi(page, disconnected, {
    connect: () => ({ body: { ok: true, status: needsProfile } }),
    select: () => ({ body: { ok: true, status: connected } }),
    sync: () => ({ body: { ok: true, status: sharedStatus, sync: { counts: { grades: 1, messages: 1 } } } }),
    disconnect: () => ({ body: { ok: true, status: disconnected } }),
  });
  await loginSchool(page, accounts.mother);
  let panel = page.locator('.edu-vulcan-connection');
  await expect(panel.getByRole('heading', { name: 'Połącz konto', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Sprawdź stan połączenia', exact: true })).toBeVisible();
  await submitCredentials(page);
  await panel.getByRole('radio', { name: /Nikodem.*Szkoła Podstawowa nr 4/ }).check();
  await panel.getByLabel('Dziecko w Naszej Rodzinie', { exact: true }).selectOption('Nikodem');
  await panel.getByRole('button', { name: 'Połącz wybrany dziennik', exact: true }).click();
  await expect.poll(() => calls.filter((call) => call.operation === 'sync').length).toBe(1);
  await expect(panel.locator('.edu-vulcan-state')).toHaveText('Połączono');
  await expect(page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.school-record-list')).toContainText('Ocena wspólnego dziennika E2E');
  await expect(page.locator('.school-record-list')).toContainText(parentMessageTitle);
  await page.evaluate(() => { location.hash = encodeURIComponent('Ustawienia'); });
  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();

  await loginSchool(page, accounts.parent);
  panel = page.locator('.edu-vulcan-connection');
  await expect(panel.locator('.edu-vulcan-state')).toHaveText('Połączono');
  await expect(panel.locator('.edu-vulcan-summary')).toContainText('Nikodem');
  await expect(panel.locator('.edu-vulcan-summary')).toContainText('Szkoła Podstawowa nr 4');
  await expect(panel.locator('.edu-vulcan-summary')).toContainText(new Date(recentSyncAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' }));
  await expect(panel.getByLabel('Hasło eduVULCAN', { exact: true })).toHaveCount(0);
  await expect(page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.school-record-list')).toContainText('Ocena wspólnego dziennika E2E');
  await expect(page.locator('.school-record-list')).toContainText(parentMessageTitle);
  await panel.getByRole('button', { name: 'Sprawdź stan połączenia', exact: true }).click();
  await expect.poll(() => calls.filter((call) => call.operation === 'status').length).toBe(3);
  await panel.getByRole('button', { name: 'Synchronizuj teraz', exact: true }).click();
  await expect.poll(() => calls.filter((call) => call.operation === 'sync').length).toBe(2);
  await panel.getByRole('button', { name: 'Rozłącz', exact: true }).click();
  await panel.getByRole('button', { name: 'Rozłącz i usuń dostęp', exact: true }).click();
  await expect(panel.locator('.edu-vulcan-state')).toHaveText('Niepołączono');
  expect(calls.filter((call) => call.operation === 'connect')).toHaveLength(1);
  expect(calls.map((call) => call.operation)).toEqual(['status', 'connect', 'select', 'sync', 'status', 'status', 'sync', 'disconnect']);
  expectAuthorizedCalls(calls);
  expect(await containsStoredCredential(page)).toBe(false);
});

test('eduVULCAN: wygaśnięcie sesji podczas odświeżania przywraca logowanie', async ({ page }) => {
  const calls = await mockApi(page, connected, {
    sync: () => ({ httpStatus: 401, body: { ok: false, error: { code: 'EDU_SESSION_EXPIRED', message: 'Sesja eduVULCAN wygasła. Połącz dziennik ponownie.' } } }),
  });
  await loginSchool(page);
  const panel = page.locator('.edu-vulcan-connection');
  await expect(panel.locator('.edu-vulcan-state')).toHaveText('Połączono');
  await panel.getByRole('button', { name: 'Synchronizuj teraz', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText(/wygas|ponown/i);
  await expect(panel.locator('.edu-vulcan-state')).toHaveText('Sesja wygasła');
  await expect(panel.getByLabel('Login lub e-mail eduVULCAN', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Hasło eduVULCAN', { exact: true })).toHaveValue('');
  await expect(panel.getByRole('button', { name: 'Synchronizuj teraz', exact: true })).toHaveCount(0);
  expect(calls.map((call) => call.operation)).toEqual(['status', 'sync']);
  expectAuthorizedCalls(calls);
});

test('eduVULCAN: brak konfiguracji backendu nie udostępnia formularza hasła', async ({ page }) => {
  const calls = await mockApi(page, { ...disconnected, configured: false });
  await loginSchool(page);
  const panel = page.locator('.edu-vulcan-connection');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/backend|serwer/i);
  await expect(panel.getByLabel('Hasło eduVULCAN', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Połącz', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Synchronizuj teraz', exact: true })).toHaveCount(0);
  expect(calls.map((call) => call.operation)).toEqual(['status']);
  expectAuthorizedCalls(calls);
});

test('eduVULCAN: statyczna strona Vercel zamiast API pokazuje błąd backendu', async ({ page }) => {
  const calls = await mockApi(page, disconnected, {
    status: () => ({ contentType: 'text/html', rawBody: '<!doctype html><html><body>Static Vercel fallback</body></html>' }),
  });
  await loginSchool(page);
  const panel = page.locator('.edu-vulcan-connection');
  await expect(panel.getByRole('alert')).toContainText(/backend|serwer|API/i);
  await expect(panel).not.toContainText('Static Vercel fallback');
  await expect(panel.getByLabel('Hasło eduVULCAN', { exact: true })).toHaveCount(0);
  expect(calls.map((call) => call.operation)).toEqual(['status']);
  expectAuthorizedCalls(calls);
});

test('eduVULCAN: dziecko widzi szkołę bez panelu rodzica i bez żądań do integracji', async ({ page }) => {
  const calls = await mockApi(page, connected);
  await seedParentMessage();
  await loginSchool(page, accounts.child);
  await expect(page.locator('.school-record-list')).toContainText('Przyroda Nikodema');
  await expect(page.locator('.school-record-list')).not.toContainText(parentMessageTitle);
  await expect(page.locator('.school-record-list')).not.toContainText(parentMessageNote);
  await expect(page.locator('.edu-vulcan-connection')).toHaveCount(0);
  await expect(page.getByLabel('Login lub e-mail eduVULCAN', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Hasło eduVULCAN', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synchronizuj teraz', exact: true })).toHaveCount(0);
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Szkoła', exact: true }).click();
  await expect(page.locator('.school-loading')).toHaveCount(0);
  await expect(page.locator('.school-record-list')).not.toContainText(parentMessageTitle);
  await expect(page.locator('.school-record-list')).not.toContainText(parentMessageNote);
  expect(calls).toHaveLength(0);
});

test('eduVULCAN: rodzic widzi prywatne wiadomości i dane do odczytu, wpisy ręczne pozostają edytowalne', async ({ page }) => {
  const calls = await mockApi(page, disconnected);
  const db = fixtureDatabase();
  const common = { person: 'Nikodem', type: 'grade', title: '5', date: todayKey(), time: '', endTime: '', weekday: 0, note: '', createdBy: accounts.parent.uid, createdAt: Timestamp.now() };
  await db.doc('schoolItems/eduvulcan-browser-grade').set({ ...common, subject: 'Ocena z eduVULCAN E2E', source: 'eduvulcan', sourceProfileId: 'nikodem-sp4' });
  await db.doc('schoolItems/manual-browser-grade').set({ ...common, subject: 'Ocena ręczna E2E' });
  await seedParentMessage();
  await loginSchool(page);
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  const privateMessage = page.locator('.school-record-list .school-entry').filter({ hasText: parentMessageTitle });
  await expect(privateMessage).toBeVisible();
  await expect(privateMessage).toContainText('eduVULCAN · dla rodzica');
  await privateMessage.click();
  await expect(page.getByRole('dialog')).toContainText(parentMessageNote);
  await expect(page.getByRole('dialog')).toContainText('Źródło: eduVULCAN · tylko do odczytu');
  await expect(page.getByRole('dialog')).toContainText('Wiadomość z dziennika jest dostępna wyłącznie rodzicom.');
  await expect(page.getByRole('dialog').getByRole('button', { name: /Edytuj|Usuń/ })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await page.locator('.school-record-list .school-entry').filter({ hasText: 'Ocena z eduVULCAN E2E' }).click();
  await expect(page.getByRole('dialog')).toContainText(/eduVULCAN/i);
  await expect(page.getByRole('dialog').getByRole('button', { name: /Edytuj|Usuń/ })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await page.locator('.school-record-list .school-entry').filter({ hasText: 'Ocena ręczna E2E' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Edytuj wpis', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Usuń', exact: true })).toBeVisible();
  expect((await db.doc('schoolItems/eduvulcan-browser-grade').get()).data()?.source).toBe('eduvulcan');
  expectAuthorizedCalls(calls);
});
