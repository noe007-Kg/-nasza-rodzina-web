import { CalendarServerError, failCalendar } from './calendar-errors.mjs';
import { EduServerError, assertSameOrigin, eduRequestHeader, getServerFirebase, requireMember } from './edu-auth.mjs';
import { readJsonBody } from './edu-http.mjs';
import { calendarConfiguration } from './calendar-config.mjs';
import { calendarOAuthCookie, completeCalendarOAuth, parseCalendarOAuthCookie } from './calendar-service.mjs';

/** OAuth configuration is optional for status; authentication is not. */
export function assertCalendarOrigin(request) {
  const origin = eduRequestHeader(request, 'origin');
  const configured = process.env.CALENDAR_SITE_ORIGIN;
  if (!configured) { assertSameOrigin(request); return; }
  let expected;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port && url.port !== '443') throw new Error();
    expected = url.origin;
  } catch { failCalendar('CALENDAR_NOT_CONFIGURED', 503, 'Administrator musi poprawić domenę integracji kalendarzy.'); }
  // A non-browser caller still must supply a verified, non-revoked Firebase ID token.
  if (!origin) return;
  try {
    const actual = new URL(origin);
    if (actual.origin === expected && actual.pathname === '/' && !actual.username && !actual.password && !actual.search && !actual.hash) return;
  } catch { /* deny */ }
  failCalendar('CALENDAR_FORBIDDEN_ORIGIN', 403, 'Niedozwolona domena żądania kalendarza.');
}

function safeError(error) {
  if (error instanceof CalendarServerError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof EduServerError) {
    if (error.code === 'EDU_UNAUTHENTICATED') return { status: 401, code: 'CALENDAR_UNAUTHENTICATED', message: 'Zaloguj się ponownie do Naszej Rodziny.' };
    if (error.status === 403) return { status: 403, code: 'CALENDAR_MEMBER_REQUIRED', message: 'Konto wymaga aktywnego dostępu do Naszej Rodziny.' };
    if (error.status >= 400 && error.status < 500) return { status: error.status, code: 'CALENDAR_INVALID_REQUEST', message: 'Nieprawidłowe żądanie kalendarza.' };
    return { status: 503, code: 'CALENDAR_NOT_CONFIGURED', message: 'Integracja kalendarzy wymaga konfiguracji administratora.' };
  }
  return { status: 500, code: 'CALENDAR_SERVER_ERROR', message: 'Nie udało się odświeżyć kalendarza. Spróbuj ponownie.' };
}

export function calendarActionFromRequest(request) {
  // A query parameter must never turn an authenticated URL into the public
  // callback. Check the raw origin-form path before parsing query fields.
  if (typeof request.url !== 'string' || /[\u0000-\u0020\u007f\\#]/.test(request.url)) return null;
  const separator = request.url.indexOf('?');
  const path = separator < 0 ? request.url : request.url.slice(0, separator);
  const match = /^\/api\/calendars\/([a-z]{1,20})$/.exec(path);
  if (!match) return null;
  const action = match[1];
  const queryActions = new URLSearchParams(separator < 0 ? '' : request.url.slice(separator + 1)).getAll('action');
  if (queryActions.length > 1 || queryActions.length === 1 && queryActions[0] !== action) return null;
  // Vercel's injected dynamic segment must agree with the actual pathname.
  if (request.query && Object.hasOwn(request.query, 'action') && request.query.action !== action) return null;
  return action;
}

/** One grouped Vercel endpoint. Provider callback uses PKCE/state/cookie; all other actions require Firebase auth. */
export function createCalendarHandler(actions, { services = getServerFirebase, authenticate = requireMember, complete = completeCalendarOAuth } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store, private, max-age=0');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    const action = calendarActionFromRequest(request), isCallback = action === 'callback';
    try {
      if (isCallback) {
        if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); failCalendar('CALENDAR_METHOD_NOT_ALLOWED', 405, 'Nieobsługiwana metoda żądania.'); }
        const params = new URL(request.url || '/api/calendars/callback', 'https://local.invalid').searchParams;
        // The URL parser retains repeated fields; reject an ambiguous provider callback.
        const query = Object.fromEntries(['code', 'state', 'error'].map(name => {
          if (params.getAll(name).length > 1) failCalendar('CALENDAR_OAUTH_INVALID', 400, 'Nieprawidłowe potwierdzenie Google Calendar.');
          const value = params.get(name) ?? request.query?.[name];
          if (value !== undefined && value !== null && typeof value !== 'string') failCalendar('CALENDAR_OAUTH_INVALID', 400, 'Nieprawidłowe potwierdzenie Google Calendar.');
          return [name, value];
        }));
        const result = await complete(services(), query, parseCalendarOAuthCookie(eduRequestHeader(request, 'cookie')));
        response.statusCode = 303;
        response.setHeader('Location', result.location);
        response.end();
        return;
      }
      if (!action || !Object.hasOwn(actions, action)) failCalendar('CALENDAR_ACTION_NOT_FOUND', 404, 'Nieobsługiwana operacja kalendarza.');
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); failCalendar('CALENDAR_METHOD_NOT_ALLOWED', 405, 'Nieobsługiwana metoda żądania.'); }
      assertCalendarOrigin(request);
      const context = await authenticate(request, services());
      const body = await readJsonBody(request);
      const result = action === 'finalize'
        ? await actions[action](context, body, parseCalendarOAuthCookie(eduRequestHeader(request, 'cookie')))
        : await actions[action](context, body);
      const { cookie, ...publicResult } = result;
      if (cookie) response.setHeader('Set-Cookie', cookie);
      if (action === 'finalize') response.setHeader('Set-Cookie', calendarOAuthCookie('', true));
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true, ...publicResult }));
    } catch (error) {
      const safe = safeError(error);
      if (isCallback && request.method === 'GET') {
        try {
          const config = calendarConfiguration();
          response.statusCode = 303;
          response.setHeader('Set-Cookie', calendarOAuthCookie('', true));
          response.setHeader('Location', `${config.origin}/?calendarOAuthError=${encodeURIComponent(safe.code)}`);
          response.end();
          return;
        } catch { /* Invalid configuration: return a safe JSON error without a user-controlled redirect. */ }
      }
      response.statusCode = safe.status;
      if (safe.status === 429) response.setHeader('Retry-After', '60');
      response.end(JSON.stringify({ ok: false, error: { code: safe.code, message: safe.message } }));
    } finally {
      if (Buffer.isBuffer(request.body)) request.body.fill(0);
      request.body = undefined;
      if (request.query) for (const field of ['code', 'state', 'error']) delete request.query[field];
    }
  };
}
