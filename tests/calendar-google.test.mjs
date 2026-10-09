import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeGoogleCode, googleAuthorizationUrl, googleCalendarClient, normalizeGoogleEvent } from '../server/calendar-google.mjs';
import { calendarConfiguration } from '../server/calendar-config.mjs';
import { calendarTestEnvironment, testNow } from './calendar-test-helpers.mjs';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokens = { accessToken: 'test-access-placeholder', refreshToken: 'test-refresh-placeholder', expiresAt: testNow + 3600000 };
const timed = (id, extra = {}) => ({ id, summary: 'Lekcja', start: { dateTime: '2026-10-08T10:00:00+02:00' }, end: { dateTime: '2026-10-08T10:45:00+02:00' }, ...extra });

test('Google OAuth requests readonly scope, PKCE and fixed callback, never a provider password', () => {
  const restore = calendarTestEnvironment();
  try {
    const url = new URL(googleAuthorizationUrl(calendarConfiguration(), 'opaque-state', 'opaque-challenge'));
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.readonly');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://family.example.test/api/calendars/callback');
    assert.equal(url.searchParams.get('access_type'), 'offline');
  } finally { restore(); }
});
test('code exchange sends the verifier only to Google token endpoint and requires refresh authorization', async () => {
  const restore = calendarTestEnvironment();
  try {
    let recorded;
    const result = await exchangeGoogleCode(calendarConfiguration(), 'code-placeholder', 'a'.repeat(43), { now: testNow, fetchImpl: async (url, options) => {
      recorded = { url, options }; return response({ access_token: 'access-placeholder', refresh_token: 'refresh-placeholder', token_type: 'Bearer', expires_in: 3600 });
    } });
    assert.equal(recorded.url, 'https://oauth2.googleapis.com/token');
    assert.equal(recorded.options.redirect, 'error');
    assert.equal(new URLSearchParams(recorded.options.body).get('code_verifier'), 'a'.repeat(43));
    assert.equal(result.expiresAt, testNow + 3600000);
    await assert.rejects(exchangeGoogleCode(calendarConfiguration(), 'code', 'a'.repeat(43), { fetchImpl: async () => response({ access_token: 'access', token_type: 'Bearer', expires_in: 3600 }) }), { code: 'CALENDAR_RECONNECT_REQUIRED' });
  } finally { restore(); }
});
test('timed events retain actual instants, descriptions, rooms and series identity', () => {
  const value = normalizeGoogleEvent(timed('lesson', { description: 'Opis', location: 'Sala 12', recurringEventId: 'series', start: { dateTime: '2026-03-29T01:30:00+01:00' }, end: { dateTime: '2026-03-29T03:30:00+02:00' } }));
  assert.equal(value.end - value.start, 3600000);
  assert.equal(value.description, 'Opis'); assert.equal(value.location, 'Sala 12'); assert.equal(value.externalSeriesId, 'series');
});
test('Google all-day exclusive end becomes the existing inclusive model for one day, multiple days and DST', () => {
  for (const [start, end, hours] of [['2026-10-08', '2026-10-09', 24], ['2026-10-08', '2026-10-11', 72], ['2026-03-29', '2026-03-30', 23], ['2026-10-25', '2026-10-26', 25]]) {
    const value = normalizeGoogleEvent({ id: 'day', start: { date: start }, end: { date: end } }, 'Europe/Warsaw');
    assert.equal(value.allDay, true);
    assert.equal(value.sourceStartDate, start); assert.equal(value.sourceEndDateExclusive, end);
    assert.equal(value.end - value.start + 1, hours * 3600000);
    assert.equal(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date(value.end + 1)), end);
    assert.notEqual(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date(value.end)), end);
  }
});
test('all-day DATE starts at the first real instant when the source timezone skips midnight', () => {
  const value = normalizeGoogleEvent({ id: 'midnight-gap', start: { date: '2018-11-04', timeZone: null }, end: { date: '2018-11-05' } }, 'America/Sao_Paulo');
  assert.equal(value.start, Date.parse('2018-11-04T03:00:00Z'));
  assert.equal(value.end + 1, Date.parse('2018-11-05T02:00:00Z'));
  assert.equal(value.end - value.start + 1, 23 * 3600000);
  assert.equal(value.sourceStartDate, '2018-11-04'); assert.equal(value.sourceEndDateExclusive, '2018-11-05');
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  assert.equal(date.format(new Date(value.start - 1)), '2018-11-03');
  assert.equal(date.format(new Date(value.start)), '2018-11-04');
  assert.equal(time.format(new Date(value.start)), '01:00');
});
test('an entirely skipped source civil DATE is rejected instead of silently becoming the next day', () => {
  assert.throws(() => normalizeGoogleEvent({ id: 'skipped-date', start: { date: '2011-12-30' }, end: { date: '2011-12-31' } }, 'Pacific/Apia'), { code: 'CALENDAR_PROVIDER_UNAVAILABLE' });
});
test('a legitimate midnight-gap all-day record does not abort the complete Google history read', async () => {
  const restore = calendarTestEnvironment();
  try {
    const client = googleCalendarClient(calendarConfiguration(), tokens, { now: testNow, fetchImpl: async () => response({
      timeZone: 'America/Sao_Paulo', items: [{ id: 'old-date', start: { date: '2018-11-04', timeZone: null }, end: { date: '2018-11-05' } }, timed('current')], nextSyncToken: 'complete-cursor',
    }) });
    const result = await client.changes('primary');
    assert.equal(result.events.length, 2); assert.equal(result.syncToken, 'complete-cursor'); assert.equal(result.fullSnapshotComplete, true);
    const old = result.events.find(row => row.externalEventId === 'old-date');
    assert.equal(old.timeZone, 'America/Sao_Paulo'); assert.equal(old.sourceStartDate, '2018-11-04');
    assert.equal(old.end - old.start + 1, 23 * 3600000);
  } finally { restore(); }
});
test('incomplete, normalized-invalid and backward dates are refused; titleless cancellation is a tombstone', () => {
  for (const value of [timed('x', { end: {} }), timed('x', { start: { dateTime: '2026-02-30T10:00:00+01:00' } }), timed('x', { end: { dateTime: '2026-10-08T09:00:00+02:00' } }), { id: 'x', start: { date: '2026-02-30' }, end: { date: '2026-03-04' } }]) {
    assert.throws(() => normalizeGoogleEvent(value, 'Europe/Warsaw'), { code: 'CALENDAR_PROVIDER_UNAVAILABLE' });
  }
  assert.deepEqual(normalizeGoogleEvent({ id: 'gone', status: 'cancelled', recurringEventId: 'series' }), { externalEventId: 'gone', cancelled: true, externalSeriesId: 'series' });
});
test('CalendarList uses actual timezones and resolves missing or invalid timezone through read-only calendar metadata', async () => {
  const restore = calendarTestEnvironment();
  try {
    const calls = [], signals = [];
    const client = googleCalendarClient(calendarConfiguration(), tokens, { now: testNow, fetchImpl: async (url, options) => {
      const path = new URL(url).pathname; calls.push(path); signals.push(options.signal);
      assert.equal(options.method, undefined); assert.equal(options.redirect, 'error');
      if (path.endsWith('/calendarList')) return response({ items: [
        { id: 'known', summary: 'Gotowy', timeZone: 'Europe/Warsaw', accessRole: 'owner' },
        { id: 'missing/tz', summary: 'Brak strefy', timeZone: null, accessRole: 'reader' },
        { id: 'invalid-tz', summary: 'Nieprawidłowa strefa', timeZone: 'invalid/provider-zone', accessRole: 'writer' },
      ] });
      if (path.endsWith('/missing%2Ftz')) return response({ id: 'missing/tz', timeZone: 'Asia/Tokyo' });
      if (path.endsWith('/invalid-tz')) return response({ id: 'invalid-tz', timeZone: 'America/Sao_Paulo' });
      throw new Error('Unexpected provider request');
    } });
    const rows = await client.calendars();
    assert.deepEqual(rows.map(row => row.timeZone), ['Europe/Warsaw', 'Asia/Tokyo', 'America/Sao_Paulo']);
    assert.equal(calls.length, 3); assert.equal(calls.some(path => path.endsWith('/known')), false);
    assert.ok(signals.every(value => value === signals[0]));
  } finally { restore(); }
});
test('invalid or mismatched provider calendar metadata fails the whole list instead of inventing a timezone', async () => {
  const restore = calendarTestEnvironment();
  try {
    for (const metadata of [{ id: 'missing', timeZone: null }, { id: 'missing', timeZone: 'not-a-zone' }, { id: 'another', timeZone: 'Europe/Warsaw' }]) {
      const client = googleCalendarClient(calendarConfiguration(), tokens, { now: testNow, fetchImpl: async url => new URL(url).pathname.endsWith('/calendarList')
        ? response({ items: [{ id: 'known', timeZone: 'Asia/Tokyo', accessRole: 'reader' }, { id: 'missing', accessRole: 'owner' }] }) : response(metadata) });
      await assert.rejects(client.calendars(), { code: 'CALENDAR_PROVIDER_DATA' });
    }
  } finally { restore(); }
});
test('metadata resolution shares one cancellable deadline and cannot return a partial list after it expires', async () => {
  const restore = calendarTestEnvironment();
  try {
    const controller = new AbortController(), calls = [], signals = [];
    const client = googleCalendarClient(calendarConfiguration(), tokens, { now: testNow, signal: controller.signal, fetchImpl: async (url, options) => {
      const path = new URL(url).pathname; calls.push(path); signals.push(options.signal);
      if (path.endsWith('/calendarList')) return response({ items: [{ id: 'first', accessRole: 'owner' }, { id: 'second', accessRole: 'reader' }] });
      controller.abort(new Error('test-only deadline'));
      return response({ id: 'first', timeZone: 'Asia/Tokyo' });
    } });
    await assert.rejects(client.calendars(), { code: 'CALENDAR_PROVIDER_UNAVAILABLE' });
    assert.equal(calls.length, 2); assert.equal(calls.some(path => path.endsWith('/second')), false);
    assert.ok(signals.every(value => value === signals[0])); assert.equal(signals[0].aborted, true);
  } finally { restore(); }
});
test('all-day DATE requires a real source timezone while RFC3339 timed instants do not invent one', async () => {
  const restore = calendarTestEnvironment();
  try {
    const allDay = { id: 'date-only', start: { date: '2026-10-08', timeZone: null }, end: { date: '2026-10-09' } };
    assert.throws(() => normalizeGoogleEvent(allDay), { code: 'CALENDAR_PROVIDER_DATA' });
    const timedEvent = normalizeGoogleEvent(timed('actual-offset'));
    assert.equal(timedEvent.timeZone, null); assert.equal(timedEvent.start, Date.parse('2026-10-08T10:00:00+02:00'));
    const factory = providerZone => googleCalendarClient(calendarConfiguration(), tokens, { now: testNow, fetchImpl: async () => response({ items: [allDay], nextSyncToken: 'cursor', ...(providerZone ? { timeZone: providerZone } : {}) }) });
    const provider = await factory('Asia/Tokyo').changes('primary', { timeZone: 'Europe/Warsaw' });
    assert.equal(provider.events[0].timeZone, 'Asia/Tokyo');
    const configured = await factory().changes('primary', { timeZone: 'Europe/Warsaw' });
    assert.equal(configured.events[0].timeZone, 'Europe/Warsaw');
    await assert.rejects(factory().changes('primary'), { code: 'CALENDAR_PROVIDER_DATA' });
  } finally { restore(); }
});
test('incremental master pagination has no forbidden time filter and advances only after the last page', async () => {
  const restore = calendarTestEnvironment();
  try {
    const requests = [];
    const client = googleCalendarClient(calendarConfiguration(), tokens, { now: testNow, fetchImpl: async (url, options) => {
      const parsed = new URL(url); requests.push({ parsed, options });
      return parsed.searchParams.has('pageToken') ? response({ items: [timed('second')], nextSyncToken: 'new-cursor' }) : response({ items: [timed('first')], nextPageToken: 'page-two' });
    } });
    const result = await client.changes('a/b?calendar', { syncToken: 'old-cursor' });
    assert.equal(result.events.length, 2); assert.equal(result.syncToken, 'new-cursor');
    assert.equal(requests.length, 2);
    for (const { parsed, options } of requests) {
      assert.equal(parsed.origin, 'https://www.googleapis.com'); assert.match(parsed.pathname, /a%2Fb%3Fcalendar/);
      assert.equal(parsed.searchParams.get('syncToken'), 'old-cursor'); assert.equal(parsed.searchParams.get('singleEvents'), 'false');
      assert.equal(parsed.searchParams.has('timeMin'), false); assert.equal(parsed.searchParams.has('timeMax'), false); assert.equal(options.redirect, 'error');
    }
  } finally { restore(); }
});
test('expired sync token retries a full read and reports only authoritative fully-read series windows', async () => {
  const restore = calendarTestEnvironment();
  try {
    const requests = [];
    const client = googleCalendarClient(calendarConfiguration(), tokens, { now: testNow, fetchImpl: async url => {
      const parsed = new URL(url); requests.push(parsed);
      if (parsed.searchParams.has('syncToken')) return response({}, 410);
      if (parsed.pathname.endsWith('/instances')) return response({ items: [timed('instance', { recurringEventId: 'new-series' })] });
      return response({ items: [{ id: 'new-series', recurrence: ['RRULE:FREQ=WEEKLY'] }], nextSyncToken: 'complete-cursor' });
    } });
    const result = await client.changes('primary', { syncToken: 'expired', recurringIds: ['removed-series'] });
    assert.equal(result.recovered, true);
    assert.equal(result.fullSnapshotComplete, true); assert.deepEqual(result.authoritativeStandaloneIds, []);
    assert.deepEqual(new Set(result.authoritativeSeries), new Set(['new-series', 'removed-series']));
    assert.equal(result.windowStart, testNow - 180 * 86400000); assert.equal(result.windowEnd, testNow + 366 * 86400000);
    assert.equal(requests.filter(url => url.pathname.endsWith('/instances')).length, 1);
  } finally { restore(); }
});
test('recurring to standalone conversion identifies the old series for safe window reconciliation', async () => {
  const restore = calendarTestEnvironment();
  try {
    const client = googleCalendarClient(calendarConfiguration(), tokens, { now: testNow, fetchImpl: async () => response({ items: [timed('converted')], nextSyncToken: 'cursor' }) });
    const result = await client.changes('primary', { syncToken: 'old', recurringIds: ['converted'] });
    assert.deepEqual(result.recurringIds, []); assert.deepEqual(result.authoritativeSeries, ['converted']);
  } finally { restore(); }
});
test('failed pagination returns no partial records or authoritative reconciliation result', async () => {
  const restore = calendarTestEnvironment();
  try {
    let requests = 0;
    const client = googleCalendarClient(calendarConfiguration(), tokens, { now: testNow, fetchImpl: async () => ++requests === 1 ? response({ items: [timed('first')], nextPageToken: 'second' }) : response({}, 429) });
    await assert.rejects(client.changes('primary'), { code: 'CALENDAR_PROVIDER_RATE_LIMITED' });
    assert.equal(requests, 2);
  } finally { restore(); }
});
test('credential rotation survives the client refresh and invalid_grant requires reconnect', async () => {
  const restore = calendarTestEnvironment();
  try {
    const client = googleCalendarClient(calendarConfiguration(), { ...tokens, expiresAt: testNow }, { now: testNow, fetchImpl: async url => url === 'https://oauth2.googleapis.com/token'
      ? response({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600 })
      : response({ items: [], nextSyncToken: 'cursor' }) });
    await client.changes('primary'); assert.equal(client.tokens().refreshToken, 'new-refresh');
    const revoked = googleCalendarClient(calendarConfiguration(), { ...tokens, expiresAt: testNow }, { now: testNow, fetchImpl: async () => response({ error: 'invalid_grant' }, 400) });
    await assert.rejects(revoked.changes('primary'), { code: 'CALENDAR_RECONNECT_REQUIRED' });
  } finally { restore(); }
});
