import { expect, test, type Page } from '@playwright/test';
import { accounts, fixtureDatabase, password, seedEmulators } from './emulator-fixtures';
import type { CalendarConnection } from '../src/calendars/model';

const completionId = 'A'.repeat(43);
const calendarId = 'google-secondary@example.test';
function source(overrides: Partial<CalendarConnection> = {}): CalendarConnection {
  return { id: 'calendar-fixture-one', provider: 'google', calendarId, calendarName: 'Zajęcia muzyczne', ownerProfileId: accounts.parent.uid, person: accounts.parent.name, visibility: 'private', mode: 'sync', status: 'connected', selectionConfirmed: true, lastSuccessfulSyncAt: new Date(Date.now() - 10 * 60_000).toISOString(), lastAttemptAt: null, lastErrorCode: null, ...overrides };
}
async function login(page: Page, account: { email: string } = accounts.parent) {
  await page.goto('/'); await page.getByLabel('E-mail', { exact: true }).fill(account.email); await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click(); await expect(page.locator('.app-shell')).toBeVisible();
}
async function settings(page: Page) {
  await page.evaluate(() => { location.hash = encodeURIComponent('Ustawienia'); });
  await expect(page.getByTestId('connected-calendars')).toBeVisible();
}
async function visibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate(next => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); }, state);
}
async function mockApi(page: Page, connections: CalendarConnection[] = [], configured = true) {
  const state: { connections: CalendarConnection[]; requests: Array<{ action: string; body: Record<string, unknown>; uid: string }>; finalizeGate?: Promise<void> } = { connections, requests: [] };
  await page.route('**/api/calendars/**', async route => {
    const request = route.request(), action = new URL(request.url()).pathname.split('/').at(-1)!;
    expect(request.method()).toBe('POST'); expect(request.headers().authorization).toMatch(/^Bearer \S+$/);
    const token = request.headers().authorization!.slice(7), claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    const uid: string = claims.user_id || claims.sub;
    const body = request.postDataJSON() as Record<string, unknown>; state.requests.push({ action, body, uid });
    let result: Record<string, unknown> = { ok: true };
    if (action === 'status') result = { ok: true, configured, connections: uid === accounts.parent.uid ? state.connections : [] };
    else if (action === 'start') result.authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=public-fixture-client&state=opaque-state';
    else if (action === 'finalize') { if (state.finalizeGate) await state.finalizeGate; state.connections = [source({ selectionConfirmed: false, calendarId: 'primary@example.test', calendarName: 'Główny', lastSuccessfulSyncAt: null })]; result.connectionId = state.connections[0].id; }
    else if (action === 'list') result.calendars = [{ id: 'primary@example.test', name: 'Główny', timeZone: 'Europe/Warsaw', primary: true }, { id: calendarId, name: 'Zajęcia muzyczne', timeZone: 'Europe/Warsaw', primary: false }];
    else if (action === 'configure') {
      state.connections = state.connections.map(row => row.id !== body.connectionId ? row : { ...row, calendarId: String(body.calendarId), calendarName: body.calendarId === calendarId ? 'Zajęcia muzyczne' : 'Główny', ownerProfileId: String(body.ownerProfileId), visibility: body.visibility as CalendarConnection['visibility'], mode: body.mode as CalendarConnection['mode'], selectionConfirmed: true }); result.connectionId = body.connectionId;
    } else if (action === 'sync') {
      const selected = state.connections.find(row => row.id === body.connectionId); expect(selected?.selectionConfirmed).toBe(true);
      state.connections = state.connections.map(row => row.id !== body.connectionId ? row : { ...row, lastSuccessfulSyncAt: new Date().toISOString(), status: row.mode === 'import' ? 'imported' : 'connected' });
      result = { ok: true, imported: 3, changed: 0, cancelled: 0, unchanged: 0, lastSuccessfulSyncAt: new Date().toISOString() };
    } else if (action === 'disconnect') { state.connections = state.connections.map(row => row.id !== body.connectionId ? row : { ...row, status: 'disconnected' }); result.removed = body.removeEvents ? 3 : 0; }
    else throw new Error(`Unexpected local calendar action: ${action}`);
    // A deliberate logout test aborts an in-flight completion before its reply.
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) }).catch(error => { if (!state.finalizeGate || action !== 'finalize') throw error; });
  });
  return state;
}
test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, () => { throw new Error('Calendar browser test attempted production Firebase.'); });
  await page.route('**/api/eduvulcan/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] } }) }));
});

test('Brak konfiguracji Google nie blokuje aplikacji ani istniejących przycisków .ics', async ({ page }) => {
  const api = await mockApi(page, [], false); await login(page); await settings(page);
  const panel = page.getByTestId('connected-calendars');
  await expect(panel.getByTestId('calendar-not-configured')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Połącz Google Calendar', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Pobierz kalendarz .ics', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Import, osoby i zakres dat', exact: true }).click(); await expect(page.locator('.calendar-package')).toBeVisible();
  expect(api.requests.filter(request => request.action !== 'status')).toHaveLength(0);
});

test('Google Calendar wymaga jawnej widoczności i pozwala rodzicowi wybrać przyszły profil bez konta', async ({ page }) => {
  await fixtureDatabase().doc('members/new-baby-calendar').set({ name: 'Nowy członek', personKey: 'member-aaaaaaaaaaaaaaaaaaaaaaaa', role: 'profile', active: true, canLogin: false });
  const api = await mockApi(page); await page.route('https://accounts.google.com/o/oauth2/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Local synthetic OAuth consent</h1>' }));
  await login(page); await settings(page); const panel = page.getByTestId('connected-calendars');
  await expect(panel.getByRole('radio', { name: 'Prywatny', exact: true })).not.toBeChecked(); await expect(panel.getByRole('radio', { name: 'Rodzinny', exact: true })).not.toBeChecked();
  await expect(panel.getByRole('button', { name: 'Połącz Google Calendar', exact: true })).toBeDisabled();
  await panel.getByLabel('Przypisz wydarzenia do', { exact: true }).selectOption('new-baby-calendar');
  await panel.getByRole('radio', { name: 'Prywatny', exact: true }).check(); await expect(panel).toContainText('Prywatne wydarzenia zobaczysz tylko Ty');
  await panel.getByLabel('Sposób pobierania', { exact: true }).selectOption('import'); await panel.getByRole('button', { name: 'Połącz Google Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Local synthetic OAuth consent' })).toBeVisible();
  expect(api.requests.find(request => request.action === 'start')?.body).toEqual({ ownerProfileId: 'new-baby-calendar', visibility: 'private', mode: 'import' });
  expect(api.requests.filter(request => request.action === 'sync')).toHaveLength(0);
});

test('Powrót OAuth finalizuje dla bieżącego UID, usuwa parametr i wymaga listy oraz wyboru przed pierwszym pobraniem', async ({ page }) => {
  const api = await mockApi(page); await login(page); await page.goto(`/?keep=1&calendarOAuth=${completionId}`);
  const panel = page.getByTestId('connected-calendars'); await expect(panel).toContainText('Google Calendar połączono');
  expect(new URL(page.url()).searchParams.has('calendarOAuth')).toBe(false); expect(new URL(page.url()).searchParams.get('keep')).toBe('1');
  expect(api.requests.find(request => request.action === 'finalize')?.body).toEqual({ completionId }); expect(api.requests.filter(request => request.action === 'sync')).toHaveLength(0);
  await panel.getByTestId('calendar-connection').getByRole('button', { name: 'Wybierz kalendarz', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Wybierz kalendarz Google', exact: true });
  await expect(dialog.getByLabel('Kalendarz Google', { exact: true })).toHaveValue('primary@example.test'); await dialog.getByLabel('Kalendarz Google', { exact: true }).selectOption(calendarId);
  await dialog.getByRole('button', { name: 'Potwierdź i pobierz wydarzenia', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(panel).toContainText('Zajęcia muzyczne');
  const mutating = api.requests.filter(request => ['finalize', 'list', 'configure', 'sync'].includes(request.action)); expect(mutating.map(request => request.action)).toEqual(['finalize', 'list', 'configure', 'sync']);
  expect(mutating[2].body).toMatchObject({ calendarId, ownerProfileId: accounts.parent.uid, visibility: 'private', mode: 'sync' });
});

test('Anulowana zgoda Google daje bezpieczny komunikat i nigdy nie uruchamia finalize ani sync', async ({ page }) => {
  const api = await mockApi(page); await login(page); await page.goto('/?calendarOAuthError=CALENDAR_OAUTH_CANCELLED');
  await expect(page.getByTestId('connected-calendars')).toContainText('Anulowano zgodę Google'); expect(new URL(page.url()).searchParams.has('calendarOAuthError')).toBe(false);
  expect(api.requests.filter(request => request.action === 'finalize' || request.action === 'sync')).toHaveLength(0);
});

test('Ręczne pobranie omija godzinę, ale bardzo świeży sukces daje komunikat zamiast kolejnego zapytania', async ({ page }) => {
  const api = await mockApi(page, [source()]); await login(page); await settings(page); const panel = page.getByTestId('connected-calendars');
  expect(api.requests.filter(request => request.action === 'sync')).toHaveLength(0);
  const button = panel.getByTestId('calendar-connection').getByRole('button', { name: 'Synchronizuj teraz', exact: true }); await button.click();
  await expect(panel).toContainText('Kalendarz został odświeżony'); expect(api.requests.filter(request => request.action === 'sync')).toHaveLength(1);
  await button.click(); await expect(panel).toContainText('Odczekaj minutę'); expect(api.requests.filter(request => request.action === 'sync')).toHaveLength(1);
});

test('Świeża nieudana próba również blokuje kolejne ręczne żądanie, a sprawdzenie stanu nie synchronizuje', async ({ page }) => {
  const api = await mockApi(page, [source({ lastAttemptAt: new Date().toISOString(), lastErrorCode: 'CALENDAR_PROVIDER_UNAVAILABLE' })]);
  await login(page); await settings(page); const panel = page.getByTestId('connected-calendars');
  await panel.getByTestId('calendar-connection').getByRole('button', { name: 'Synchronizuj teraz', exact: true }).click();
  await expect(panel).toContainText('Odczekaj minutę'); expect(api.requests.filter(request => request.action === 'sync')).toHaveLength(0);
  const checks = api.requests.filter(request => request.action === 'status').length;
  await panel.getByRole('button', { name: 'Sprawdź stan połączeń', exact: true }).click();
  await expect.poll(() => api.requests.filter(request => request.action === 'status').length).toBeGreaterThan(checks);
  expect(api.requests.filter(request => request.action === 'sync')).toHaveLength(0);
});

test('Import jednorazowy pokazuje zakończony status i nigdy nie odświeża źródła w foreground', async ({ page }) => {
  const api = await mockApi(page, [source({ mode: 'import', status: 'imported', lastSuccessfulSyncAt: new Date(Date.now() - 120 * 60_000).toISOString() })]);
  await login(page); await settings(page); const connection = page.getByTestId('calendar-connection');
  await expect(connection).toContainText('Import zakończony'); await expect(connection).toContainText('Import jednorazowy');
  await expect(connection.getByRole('button', { name: 'Synchronizuj teraz', exact: true })).toHaveCount(0);
  await expect(connection.getByRole('button', { name: 'Importuj teraz', exact: true })).toHaveCount(0);
  await visibility(page, 'hidden'); await visibility(page, 'visible');
  expect(api.requests.filter(request => request.action === 'sync')).toHaveLength(0);
});

test('Przypisanie przyszłego członka pokazuje jego imię, bez technicznego personKey', async ({ page }) => {
  const ownerProfileId = 'members-new-calendar-profile';
  await fixtureDatabase().doc(`members/${ownerProfileId}`).set({ name: 'Nowa osoba', personKey: 'member-bbbbbbbbbbbbbbbbbbbbbbbb', role: 'profile', active: true, canLogin: false });
  await mockApi(page, [source({ ownerProfileId, person: 'member-bbbbbbbbbbbbbbbbbbbbbbbb' })]);
  await login(page); await settings(page); const connection = page.getByTestId('calendar-connection');
  await expect(connection).toContainText('Nowa osoba'); await expect(connection).not.toContainText('member-bbbbbbbbbbbbbbbbbbbbbbbb');
});

for (const remove of [false, true]) test(`Rozłączanie wymaga jawnego wyboru: ${remove ? 'usuń wyłącznie źródło' : 'pozostaw historię'}`, async ({ page }) => {
  const api = await mockApi(page, [source()]); await login(page); await settings(page);
  await page.getByTestId('calendar-connection').getByRole('button', { name: 'Rozłącz', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Rozłączyć kalendarz?', exact: true });
  await expect(dialog.getByRole('button', { name: 'Potwierdź rozłączenie', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: remove ? 'Usuń wydarzenia pochodzące wyłącznie z tego źródła' : 'Pozostaw wcześniej pobrane wydarzenia', exact: true }).check();
  await dialog.getByRole('button', { name: 'Potwierdź rozłączenie', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(api.requests.find(request => request.action === 'disconnect')?.body).toEqual({ connectionId: 'calendar-fixture-one', removeEvents: remove });
});

for (const account of [accounts.child, accounts.sibling]) test(`${account.name}: profil własny i Cała rodzina, bez zarządzania przypisaniem rodzeństwa lub rodziców`, async ({ page }) => {
  if (account.uid === accounts.sibling.uid) await fixtureDatabase().doc(`members/${account.uid}`).update({ role: 'adult' });
  await mockApi(page); await login(page, account); await settings(page); const panel = page.getByTestId('connected-calendars');
  const owners = panel.getByLabel('Przypisz wydarzenia do', { exact: true });
  await expect(owners.locator('option:not([disabled])')).toHaveCount(2); await expect(owners).toHaveValue(account.uid); await expect(owners.locator(`option[value="${accounts.parent.uid}"]`)).toHaveCount(0);
  await expect(owners.locator('option[value="family"]')).toHaveText('Cała rodzina'); await expect(panel.getByTestId('calendar-connection')).toHaveCount(0);
});

test('Foreground po godzinie odświeża raz, a zwykłe przełączanie modułów i aplikacja w tle nie synchronizują', async ({ page }) => {
  const api = await mockApi(page, [source()]); await login(page); await expect.poll(() => api.requests.filter(row => row.action === 'status').length).toBeGreaterThan(0);
  for (const module of ['Kalendarz', 'Zadania', 'Start']) { await page.evaluate(next => { location.hash = encodeURIComponent(next); }, module); }
  expect(api.requests.filter(row => row.action === 'sync')).toHaveLength(0);
  await visibility(page, 'hidden'); api.connections[0].lastSuccessfulSyncAt = new Date(Date.now() - 61 * 60_000).toISOString(); expect(api.requests.filter(row => row.action === 'sync')).toHaveLength(0);
  await visibility(page, 'visible'); await expect.poll(() => api.requests.filter(row => row.action === 'sync').length).toBe(1);
});

test('Zmiana UID podczas finalize nie przekazuje połączenia ani komunikatu poprzedniego rodzica', async ({ page }) => {
  const api = await mockApi(page); let release!: () => void; api.finalizeGate = new Promise(resolve => { release = resolve; });
  await login(page); await page.goto(`/?calendarOAuth=${completionId}`); await expect.poll(() => api.requests.filter(row => row.action === 'finalize').length).toBe(1);
  await page.evaluate(async () => { const path = '/src/firebase.ts', sdkPath = '/node_modules/.vite/deps/firebase_auth.js'; const { auth } = await import(path); const sdk = await import(sdkPath); await sdk.signOut(auth); });
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible(); await login(page, accounts.mother); release();
  await settings(page); await expect(page.getByTestId('connected-calendars').getByTestId('calendar-connection')).toHaveCount(0); await expect(page.getByTestId('connected-calendars')).not.toContainText('Google Calendar połączono');
  expect(api.requests.filter(row => row.action === 'finalize').map(row => row.uid)).toEqual([accounts.parent.uid]);
});

test('Pięć rozmiarów: panel jest dostępny i nie powoduje poziomego scrollu; niepotwierdzone źródło nie autosyncuje', async ({ page, browserName }) => {
  const api = await mockApi(page, [source({ selectionConfirmed: false, lastSuccessfulSyncAt: null })]); await login(page); await settings(page);
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 1440 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size); await expect(page.getByTestId('connected-calendars')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (process.env.NASZA_CAPTURE_CALENDAR_PREVIEW === 'true' && browserName === 'chromium' && [390, 1024].includes(size.width)) {
      await page.getByTestId('connected-calendars').evaluate(element => {
        const headerHeight = document.querySelector('[data-testid="family-profile-bar"]')?.getBoundingClientRect().height || 0;
        window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - headerHeight - 12, behavior: 'instant' });
      });
      await expect.poll(async () => Math.round((await page.getByTestId('family-profile-bar').boundingBox())?.y ?? Infinity)).toBe(0);
      await page.screenshot({ path: `preview/stage-9/google-calendar-settings-${size.width === 390 ? 'phone-portrait' : 'tablet-landscape'}.png` });
    }
  }
  expect(api.requests.filter(row => row.action === 'sync')).toHaveLength(0);
});

test('Ponowne połączenie przekazuje istniejący connectionId i zachowuje przypisanie oraz prywatność', async ({ page }) => {
  const api = await mockApi(page, [source({ status: 'needs-reconnect', lastErrorCode: 'CALENDAR_RECONNECT_REQUIRED' })]); await page.route('https://accounts.google.com/o/oauth2/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Local reconnect consent</h1>' }));
  await login(page); await settings(page); await page.getByTestId('calendar-connection').getByRole('button', { name: 'Połącz ponownie', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Local reconnect consent' })).toBeVisible();
  expect(api.requests.find(row => row.action === 'start')?.body).toEqual({ connectionId: 'calendar-fixture-one', ownerProfileId: accounts.parent.uid, visibility: 'private', mode: 'sync' });
});
