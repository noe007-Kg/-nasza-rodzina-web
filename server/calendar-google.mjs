import { failCalendar, calendarIdentifier } from './calendar-config.mjs';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const MAX_GOOGLE_RECORDS = 5000;
export const MAX_GOOGLE_READ_MS = 45000;
const API_ROOT = 'https://www.googleapis.com/calendar/v3/';
const OFFSET_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) failCalendar('CALENDAR_PROVIDER_LIMIT', 502, 'Kalendarz jest zbyt duży, aby bezpiecznie pobrać go w jednym kroku.');
  let bytes = 0, chunks = [];
  if (response.body) for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 4 * 1024 * 1024) { await response.body.cancel().catch(() => {}); failCalendar('CALENDAR_PROVIDER_LIMIT', 502, 'Kalendarz jest zbyt duży, aby bezpiecznie pobrać go w jednym kroku.'); }
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Nie udało się odczytać kalendarza. Spróbuj ponownie.'); }
}

export function googleAuthorizationUrl(config, state, challenge) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: GOOGLE_CALENDAR_SCOPE,
    state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }).toString();
  return url.href;
}
function tokenFields(payload, previous, now) {
  if (!payload || typeof payload.access_token !== 'string' || !payload.access_token || payload.access_token.length > 16384
    || String(payload.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(payload.expires_in) || payload.expires_in < 1 || payload.expires_in > 86400
    || payload.refresh_token && (typeof payload.refresh_token !== 'string' || payload.refresh_token.length > 16384)) {
    failCalendar('CALENDAR_PROVIDER_DATA', 502, 'Google nie przekazał pełnych danych autoryzacji. Spróbuj ponownie później.');
  }
  if (payload.scope && !String(payload.scope).split(' ').includes(GOOGLE_CALENDAR_SCOPE)) {
    failCalendar('CALENDAR_RECONNECT_REQUIRED', 401, 'Google nie potwierdził uprawnienia do odczytu kalendarza. Połącz kalendarz ponownie.');
  }
  const refreshToken = payload.refresh_token || previous?.refreshToken;
  if (!refreshToken) failCalendar('CALENDAR_RECONNECT_REQUIRED', 401, 'Google nie udostępnił autoryzacji do kolejnych odświeżeń. Połącz kalendarz ponownie.');
  return { accessToken: payload.access_token, refreshToken, expiresAt: now + payload.expires_in * 1000 };
}
async function tokenRequest(config, parameters, { fetchImpl = fetch, now = Date.now(), signal } = {}, previous) {
  let response;
  try { response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: signal || AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }).toString() }); }
  catch { failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Google Calendar chwilowo nie odpowiada. Spróbuj ponownie.'); }
  const payload = await boundedJson(response);
  if (!response.ok) {
    if (payload.error === 'invalid_grant') failCalendar('CALENDAR_RECONNECT_REQUIRED', 401, 'Google unieważnił autoryzację. Połącz kalendarz ponownie.');
    failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Nie udało się potwierdzić dostępu do Google Calendar.');
  }
  return tokenFields(payload, previous, now);
}
export function exchangeGoogleCode(config, code, verifier, options) {
  if (!calendarIdentifier(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) failCalendar('CALENDAR_OAUTH_INVALID', 400, 'Nieprawidłowe potwierdzenie połączenia kalendarza.');
  return tokenRequest(config, { code, code_verifier: verifier, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }, options);
}

export function googleCalendarClient(config, initialTokens, { fetchImpl = fetch, now = Date.now(), signal } = {}) {
  let tokens = { ...initialTokens };
  // All pages and any missing metadata share one deadline. Resolving a larger
  // list must not restart a fresh timeout for every provider request.
  const deadline = AbortSignal.timeout(MAX_GOOGLE_READ_MS);
  const operationSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const checkDeadline = () => { if (operationSignal.aborted) failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Nie udało się odświeżyć kalendarza. Spróbujemy ponownie.'); };
  const refresh = async () => {
    checkDeadline();
    if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || tokens.refreshToken.length > 16384) failCalendar('CALENDAR_DECRYPT_FAILED', 503, 'Nie udało się odczytać połączenia kalendarza. Zapisane wydarzenia pozostają widoczne.');
    tokens = await tokenRequest(config, { refresh_token: tokens.refreshToken, grant_type: 'refresh_token' }, { fetchImpl, now, signal: operationSignal }, tokens);
    checkDeadline();
  };
  const request = async (path, params = {}) => {
    checkDeadline();
    if (!tokens.accessToken || tokens.expiresAt < now + 30000) await refresh();
    const url = new URL(path, API_ROOT); url.search = new URLSearchParams(params).toString();
    if (url.origin !== new URL(API_ROOT).origin || !url.pathname.startsWith('/calendar/v3/')) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Nieprawidłowy adres kalendarza.');
    let response;
    const call = async () => {
      checkDeadline();
      try { return await fetchImpl(url.href, { redirect: 'error', signal: operationSignal, headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' } }); }
      catch { failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Nie udało się odświeżyć kalendarza. Spróbujemy ponownie.'); }
    };
    response = await call();
    checkDeadline();
    if (response.status === 401) { await refresh(); response = await call(); }
    checkDeadline();
    if (response.status === 410) failCalendar('CALENDAR_CURSOR_EXPIRED', 410, 'Kalendarz wymaga pełnego odświeżenia.');
    if (response.status === 401) failCalendar('CALENDAR_RECONNECT_REQUIRED', 401, 'Google unieważnił autoryzację. Połącz kalendarz ponownie.');
    if (response.status === 429) failCalendar('CALENDAR_PROVIDER_RATE_LIMITED', 429, 'Google ograniczył liczbę odświeżeń. Spróbuj ponownie później.');
    if (!response.ok) failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Nie udało się odświeżyć kalendarza. Spróbujemy ponownie.');
    const result = await boundedJson(response); checkDeadline(); return result;
  };
  const pages = async (path, params, budget) => {
    const rows = []; let pageToken, nextSyncToken, timeZone;
    for (let page = 0; page < 10; page++) {
      const result = await request(path, { ...params, ...(pageToken ? { pageToken } : {}) });
      if (!Array.isArray(result.items) || result.items.length > 1000) failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Google zwrócił nieprawidłowy kalendarz.');
      rows.push(...result.items); budget.count += result.items.length;
      if (budget.count > MAX_GOOGLE_RECORDS) failCalendar('CALENDAR_PROVIDER_LIMIT', 502, 'Kalendarz jest zbyt duży, aby bezpiecznie pobrać go w jednym kroku.');
      timeZone = validTimeZone(result.timeZone) || timeZone;
      nextSyncToken = result.nextSyncToken || nextSyncToken;
      pageToken = result.nextPageToken;
      if (!pageToken) return { rows, nextSyncToken, timeZone };
      if (!calendarIdentifier(pageToken)) failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Google zwrócił nieprawidłowe stronicowanie.');
    }
    failCalendar('CALENDAR_PROVIDER_LIMIT', 502, 'Kalendarz wymaga więcej stron niż można bezpiecznie pobrać w jednym kroku.');
  };
  return {
    tokens: () => ({ ...tokens }),
    async calendars() {
      const result = await pages('users/me/calendarList', { maxResults: '250' }, { count: 0 });
      if (result.rows.length > 250) failCalendar('CALENDAR_PROVIDER_LIMIT', 502, 'Lista kalendarzy jest zbyt długa.');
      const calendars = [];
      for (const row of result.rows.filter(row => calendarIdentifier(row.id) && ['owner', 'writer', 'reader'].includes(row.accessRole))) {
        let timeZone = validTimeZone(row.timeZone);
        if (!timeZone) {
          // DATE events commonly omit start.timeZone. Use the actual provider
          // calendar metadata rather than guessing the family's local zone.
          const metadata = await request(`calendars/${encodeURIComponent(row.id)}`);
          timeZone = metadata.id === row.id ? validTimeZone(metadata.timeZone) : null;
          if (!timeZone) failCalendar('CALENDAR_PROVIDER_DATA', 502, 'Google nie przekazał pełnych danych kalendarza. Spróbuj ponownie.');
        }
        calendars.push({ id: row.id, name: String(row.summary || 'Kalendarz').slice(0, 200), timeZone, primary: row.primary === true });
      }
      return calendars;
    },
    async changes(calendarId, { syncToken, recurringIds = [], timeZone } = {}) {
      if (!calendarIdentifier(calendarId) || recurringIds.length > 500 || syncToken && !calendarIdentifier(syncToken)) failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Nieprawidłowe źródło kalendarza.');
      const path = `calendars/${encodeURIComponent(calendarId)}/events`;
      let result, recovered = false; const budget = { count: 0 };
      try { result = await pages(path, { singleEvents: 'false', showDeleted: 'true', maxResults: '1000', ...(syncToken ? { syncToken } : {}) }, budget); }
      catch (error) {
        if (error.code !== 'CALENDAR_CURSOR_EXPIRED' || !syncToken) throw error;
        budget.count = 0; recovered = true;
        result = await pages(path, { singleEvents: 'false', showDeleted: 'true', maxResults: '1000' }, budget);
      }
      const series = new Set(syncToken && !recovered ? recurringIds : []), cancellations = [], events = [], explicitlyInactive = new Set();
      timeZone = validTimeZone(result.timeZone) || validTimeZone(timeZone);
      for (const record of result.rows) {
        if (!calendarIdentifier(record.id)) failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Google zwrócił nieprawidłowy identyfikator wydarzenia.');
        if (record.status === 'cancelled') { cancellations.push(record.id); series.delete(record.id); explicitlyInactive.add(record.id); events.push({ externalEventId: record.id, cancelled: true }); }
        else if (Array.isArray(record.recurrence) && record.recurrence.length) series.add(record.id);
        else { series.delete(record.id); if (recurringIds.includes(record.id)) explicitlyInactive.add(record.id); events.push(normalizeGoogleEvent(record, timeZone)); }
      }
      if (series.size > 500) failCalendar('CALENDAR_PROVIDER_LIMIT', 502, 'Kalendarz ma zbyt wiele serii, aby bezpiecznie odświeżyć go w jednym kroku.');
      const windowStart = new Date(now - 180 * 86400000).toISOString(), windowEnd = new Date(now + 366 * 86400000).toISOString();
      for (const id of series) {
        const instances = await pages(`${path}/${encodeURIComponent(id)}/instances`, { timeMin: windowStart, timeMax: windowEnd, showDeleted: 'true', maxResults: '1000' }, budget);
        for (const record of instances.rows) events.push(normalizeGoogleEvent(record, timeZone));
      }
      // A complete full snapshot proves that an old master is no longer recurring.
      if (!syncToken || recovered) for (const id of recurringIds) if (!series.has(id)) explicitlyInactive.add(id);
      if (!calendarIdentifier(result.nextSyncToken)) failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Google nie potwierdził kompletnego pobrania kalendarza.');
      return { events, cancelledSeries: cancellations, recurringIds: [...series], syncToken: result.nextSyncToken, timeZone, recovered,
        fullSnapshotComplete: !syncToken || recovered,
        authoritativeStandaloneIds: !syncToken || recovered ? result.rows.filter(row => row.status !== 'cancelled'
          && !(Array.isArray(row.recurrence) && row.recurrence.length) && !row.recurringEventId).map(row => row.id) : [],
        authoritativeSeries: [...new Set([...series, ...explicitlyInactive])], windowStart: Date.parse(windowStart), windowEnd: Date.parse(windowEnd) };
    },
  };
}

export function validTimeZone(value) { if (typeof value !== 'string' || value.length > 80) return null; try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; } catch { return null; } }
function civilDateStart(text, timeZone) {
  if (!DATE.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number), utc = Date.UTC(y, m - 1, d);
  if (y < 1900 || y > 2200 || new Date(utc).toISOString().slice(0, 10) !== text) return null;
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = utc;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    instant += utc - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  }
  const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  if (`${p.year}-${p.month}-${p.day}` === text && p.hour === '00' && p.minute === '00') return instant;
  // A valid DATE can begin after 00:00 when the provider timezone advances
  // over midnight. Find its first real instant instead of inventing midnight.
  // A completely skipped civil date (e.g. Apia 2011-12-30) remains invalid.
  const dates = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateAt = millis => dates.format(new Date(millis));
  let before = utc - 36 * 3600000, after = utc + 36 * 3600000;
  if (dateAt(before) >= text || dateAt(after) < text) return null;
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2);
    if (dateAt(middle) < text) before = middle;
    else after = middle;
  }
  return dateAt(after) === text ? after : null;
}
export function normalizeGoogleEvent(raw, fallbackTimeZone) {
  if (!raw || !calendarIdentifier(raw.id)) failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Google zwrócił nieprawidłowe wydarzenie.');
  const externalEventId = raw.id;
  if (raw.status === 'cancelled') return { externalEventId, cancelled: true, ...(calendarIdentifier(raw.recurringEventId) ? { externalSeriesId: raw.recurringEventId } : {}) };
  const timeZone = validTimeZone(raw.start?.timeZone) || validTimeZone(fallbackTimeZone);
  const allDay = typeof raw.start?.date === 'string' && typeof raw.end?.date === 'string';
  if (allDay && !timeZone) failCalendar('CALENDAR_PROVIDER_DATA', 502, 'Google nie przekazał pełnych danych kalendarza. Spróbuj ponownie.');
  const realCivilDate = text => {
    if (typeof text !== 'string' || !DATE.test(text.slice(0, 10))) return false;
    const [year, month, day] = text.slice(0, 10).split('-').map(Number);
    return year >= 1900 && year <= 2200 && new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === text.slice(0, 10);
  };
  if (!allDay && (!realCivilDate(raw.start?.dateTime) || !realCivilDate(raw.end?.dateTime))) failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Google zwrócił wydarzenie bez poprawnego terminu.');
  const start = allDay ? civilDateStart(raw.start.date, timeZone) : OFFSET_DATE.test(raw.start?.dateTime || '') ? Date.parse(raw.start.dateTime) : null;
  const end = allDay ? civilDateStart(raw.end.date, timeZone) : OFFSET_DATE.test(raw.end?.dateTime || '') ? Date.parse(raw.end.dateTime) : null;
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) failCalendar('CALENDAR_PROVIDER_UNAVAILABLE', 502, 'Google zwrócił wydarzenie bez poprawnego terminu.');
  const safeText = (value, limit) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, limit) : '';
  return { externalEventId, title: safeText(raw.summary, 500).trim() || 'Wydarzenie', description: safeText(raw.description, 10000), location: safeText(raw.location, 2000),
    start, end: allDay ? end - 1 : end, allDay, timeZone, cancelled: false,
    ...(allDay ? { sourceStartDate: raw.start.date, sourceEndDateExclusive: raw.end.date } : {}),
    ...(calendarIdentifier(raw.recurringEventId) ? { externalSeriesId: raw.recurringEventId } : {}) };
}
