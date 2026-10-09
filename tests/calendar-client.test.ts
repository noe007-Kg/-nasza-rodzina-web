import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedCalendarUrl, availableCalendarOwners, calendarCompletion, CalendarRequestError, calendarErrorMessage, calendarMessage, calendarOwnerName, manualCalendarSyncAvailableAt, parseCalendarStatus, parseExternalCalendars, withoutCalendarCompletion } from '../src/calendars/model.ts';
import { calendarTransport } from '../src/calendars/calendar-transport.ts';

const connection = { id: 'connection-one', provider: 'google', calendarId: 'calendar@example.test', calendarName: 'Mój kalendarz', ownerProfileId: 'member-one', person: 'Osoba', visibility: 'private', mode: 'sync', status: 'connected', selectionConfirmed: true, lastSuccessfulSyncAt: '2026-10-07T10:00:00Z', lastAttemptAt: null, lastErrorCode: null };
function reply(row: unknown = connection) { return { ok: true, configured: true, connections: [row] }; }
const user = { uid: 'member-one', getIdToken: async () => 'synthetic-firebase-token' };

test('public status preserves exact profile assignment and private visibility while dropping provider secrets', () => {
  const status = parseCalendarStatus(reply({ ...connection, accessToken: 'never-client', refreshToken: 'never-client', syncToken: 'never-client', session: 'never-client' } as typeof connection));
  assert.deepEqual(status.connections[0], connection); assert.ok(!JSON.stringify(status).includes('never-client'));
});
test('missing Google configuration is an ordinary valid status', () => { assert.deepEqual(parseCalendarStatus({ ok: true, configured: false, connections: [] }), { ok: true, configured: false, connections: [] }); });
test('ambiguous, missing selection confirmation and malformed status never become usable connections', () => {
  for (const bad of [{ ...reply(), connections: [connection, connection] }, reply({ ...connection, visibility: 'public' }), reply({ ...connection, selectionConfirmed: undefined }), reply({ ...connection, lastSuccessfulSyncAt: 'bad-date' }), reply({ ...connection, status: 'random' })]) assert.throws(() => parseCalendarStatus(bad), CalendarRequestError);
});
test('calendar choices require genuine names, unique ids and timezone', () => {
  const list = { ok: true, calendars: [{ id: 'one', name: 'Kalendarz', timeZone: 'Europe/Warsaw', primary: true }] };
  assert.deepEqual(parseExternalCalendars(list), list.calendars);
  assert.throws(() => parseExternalCalendars({ ...list, calendars: [...list.calendars, ...list.calendars] }), CalendarRequestError);
  assert.throws(() => parseExternalCalendars({ ok: true, calendars: [{ ...list.calendars[0], timeZone: '' }] }), CalendarRequestError);
});
test('calendar list accepts the full provider limit of 250 and rejects 251 records', () => {
  const calendars = Array.from({ length: 250 }, (_, index) => ({ id: `calendar-${index}`, name: `Kalendarz ${index}`, timeZone: 'Europe/Warsaw', primary: index === 0 }));
  assert.deepEqual(parseExternalCalendars({ ok: true, calendars }), calendars);
  assert.throws(() => parseExternalCalendars({ ok: true, calendars: [...calendars, { ...calendars[0], id: 'calendar-250' }] }), CalendarRequestError);
});
test('retained-source limit has a safe distinct message without implying automatic history deletion', () => {
  assert.match(calendarMessage('CALENDAR_SOURCE_HISTORY_LIMIT'), /30 zapisanych źródeł/);
  assert.match(calendarMessage('CALENDAR_SOURCE_HISTORY_LIMIT'), /historia nie jest usuwana automatycznie/);
});
test('OAuth navigation accepts only the Google authorization endpoint without bearer secrets', () => {
  const expected = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=public-client-id&state=opaque-state&code_challenge=public-challenge';
  assert.equal(authorizedCalendarUrl(expected), expected);
  for (const value of ['javascript:alert(1)', 'https://evil.example/o/oauth2/v2/auth', 'https://accounts.google.com.evil.example/o/oauth2/v2/auth', 'https://accounts.google.com/o/oauth2/v2/auth?access_token=secret', 'https://accounts.google.com/o/oauth2/v2/auth?code=secret', 'https://accounts.google.com/o/oauth2/v2/auth#access_token=secret', 'https://accounts.google.com@evil.example/', 'http://accounts.google.com/o/oauth2/v2/auth']) assert.throws(() => authorizedCalendarUrl(value), CalendarRequestError);
});
test('owner options are dynamic, include passive active profiles for parents and exclude archives', () => {
  const profiles = [{ id: 'me', name: 'Nowy rodzic', active: true }, { id: 'baby', name: 'Nowe niemowlę', active: true, canLogin: false }, { id: 'archived', active: true, archived: true }, { id: 'inactive', active: false }, { id: 'unknown' }];
  assert.deepEqual(availableCalendarOwners(profiles, 'me', true).map(row => row.id), ['me', 'baby']);
  assert.deepEqual(availableCalendarOwners(profiles, 'me', false).map(row => row.id), ['me']);
});
test('manual sync uses a minute cooldown rather than the automatic hour', () => {
  assert.equal(manualCalendarSyncAvailableAt({ lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt }), Date.parse(connection.lastSuccessfulSyncAt) + 60_000);
  assert.equal(manualCalendarSyncAvailableAt({ lastSuccessfulSyncAt: null }), null);
  assert.equal(manualCalendarSyncAvailableAt({ lastSuccessfulSyncAt: 'bad' }), null);
});
test('recent failed attempts respect the same backend minute cooldown without treating them as success', () => {
  const recent = '2026-10-07T10:10:00Z';
  assert.equal(manualCalendarSyncAvailableAt({ lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt, lastAttemptAt: recent }), Date.parse(recent) + 60_000);
  assert.equal(manualCalendarSyncAvailableAt({ lastSuccessfulSyncAt: null, lastAttemptAt: recent }), Date.parse(recent) + 60_000);
  assert.equal(manualCalendarSyncAvailableAt({ lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt, lastAttemptAt: 'bad' }), Date.parse(connection.lastSuccessfulSyncAt) + 60_000);
});
test('source assignment uses current family names instead of technical identifiers', () => {
  const profiles = [{ id: 'new-profile', personKey: 'member-aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Nowy członek' }];
  assert.equal(calendarOwnerName({ ownerProfileId: 'new-profile' }, profiles), 'Nowy członek');
  assert.equal(calendarOwnerName({ ownerProfileId: 'family' }, profiles), 'Cała rodzina');
  assert.equal(calendarOwnerName({ ownerProfileId: 'removed-profile' }, profiles), 'Profil rodziny');
});
test('callback accepts a single opaque completion id and cleans only its own query parameters', () => {
  const id = 'A'.repeat(43), url = new URL(`https://app.example/?keep=1&calendarOAuth=${id}#Ustawienia`);
  assert.deepEqual(calendarCompletion(url), { completionId: id }); assert.equal(withoutCalendarCompletion(url), '/?keep=1#Ustawienia');
  assert.equal(calendarCompletion(new URL('https://app.example/')), null);
});
test('invalid or duplicate completions and raw callback errors are reduced to safe error codes', () => {
  const id = 'A'.repeat(43);
  for (const suffix of [`calendarOAuth=${id}&calendarOAuth=${id}`, 'calendarOAuth=secret', 'calendarOAuthError=raw-token']) assert.deepEqual(calendarCompletion(new URL(`https://app.example/?${suffix}`)), { errorCode: 'CALENDAR_OAUTH_INVALID' });
  assert.deepEqual(calendarCompletion(new URL('https://app.example/?calendarOAuthError=CALENDAR_OAUTH_CANCELLED')), { errorCode: 'CALENDAR_OAUTH_CANCELLED' });
});
test('unknown errors and raw thrown messages do not expose provider text', () => {
  assert.ok(!calendarErrorMessage(new Error('private-token-and-stack')).includes('private-token'));
  assert.ok(!calendarMessage('PRIVATE_TOKEN').includes('PRIVATE_TOKEN'));
});
test('calendar API sends Firebase Bearer, same-origin credentials and only the requested body', async () => {
  const result = await calendarTransport('start', user, { ownerProfileId: 'baby', visibility: 'private', mode: 'sync' }, undefined, { currentUid: () => user.uid, fetch: async (url, init) => {
    assert.equal(url, '/api/calendars/start'); assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store'); assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-firebase-token');
    assert.deepEqual(JSON.parse(init?.body as string), { ownerProfileId: 'baby', visibility: 'private', mode: 'sync' });
    return Response.json({ ok: true, authorizationUrl: 'public-authorization-url' });
  } });
  assert.deepEqual(result, { ok: true, authorizationUrl: 'public-authorization-url' });
});
test('account change while getting the Firebase token prevents the request', async () => {
  let uid: string | null = user.uid, calls = 0;
  const changing = { ...user, getIdToken: async () => { uid = 'another-member'; return 'old-token'; } };
  await assert.rejects(calendarTransport('sync', changing, {}, undefined, { currentUid: () => uid, fetch: async () => { calls++; return Response.json({ ok: true }); } }), { code: 'CALENDAR_ACCOUNT_CHANGED' });
  assert.equal(calls, 0);
});
test('late API responses after logout cannot enter a new account UI', async () => {
  let uid: string | null = user.uid;
  await assert.rejects(calendarTransport('status', user, {}, undefined, { currentUid: () => uid, fetch: async () => { uid = null; return Response.json({ ok: true, configured: true, connections: [connection] }); } }), { code: 'CALENDAR_ACCOUNT_CHANGED' });
});
test('backend error codes yield local Polish messages while raw error text stays unused', async () => {
  await assert.rejects(calendarTransport('sync', user, {}, undefined, { currentUid: () => user.uid, fetch: async () => Response.json({ ok: false, error: { code: 'CALENDAR_RATE_LIMITED', message: 'raw-provider-token' } }, { status: 429 }) }), error => error instanceof CalendarRequestError && error.code === 'CALENDAR_RATE_LIMITED' && error.message.includes('minutę') && !error.message.includes('raw-provider-token'));
});
test('aborted API request never starts and invalid JSON is safely reported', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(calendarTransport('status', user, {}, controller.signal, { currentUid: () => user.uid, fetch: async () => { calls++; return Response.json({ ok: true }); } }), { code: 'CALENDAR_ACCOUNT_CHANGED' }); assert.equal(calls, 0);
  await assert.rejects(calendarTransport('status', user, {}, undefined, { currentUid: () => user.uid, fetch: async () => new Response('<html>unavailable</html>') }), { code: 'CALENDAR_INVALID_RESPONSE' });
});
