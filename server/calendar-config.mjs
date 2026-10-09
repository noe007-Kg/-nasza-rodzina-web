import { failCalendar } from './calendar-errors.mjs';
export { calendarError, failCalendar } from './calendar-errors.mjs';
export function calendarConfiguration(env = process.env) {
  const { GOOGLE_CALENDAR_CLIENT_ID: clientId, GOOGLE_CALENDAR_CLIENT_SECRET: clientSecret, CALENDAR_SITE_ORIGIN: rawOrigin } = env;
  if (!clientId || !/^[a-zA-Z0-9_.-]+\.apps\.googleusercontent\.com$/.test(clientId)
    || typeof clientSecret !== 'string' || !clientSecret || clientSecret.length > 4096 || !rawOrigin) {
    failCalendar('CALENDAR_NOT_CONFIGURED', 503, 'Połączenie Google Calendar wymaga konfiguracji administratora. Kalendarz rodziny działa normalnie.');
  }
  let url;
  try { url = new URL(rawOrigin); } catch { failCalendar('CALENDAR_NOT_CONFIGURED', 503, 'Nieprawidłowa domena integracji kalendarzy.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.port && url.port !== '443') {
    failCalendar('CALENDAR_NOT_CONFIGURED', 503, 'Integracja kalendarzy wymaga stałej, bezpiecznej domeny HTTPS.');
  }
  return { clientId, clientSecret, origin: url.origin, redirectUri: `${url.origin}/api/calendars/callback` };
}

export function expectCalendarFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(field => !allowed.includes(field))) {
    failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Żądanie kalendarza zawiera nieobsługiwane pola.');
  }
}
export const activeCalendarMember = profile => profile?.active === true && profile.canLogin === true
  && profile.archived !== true && profile.disabled !== true && ['parent', 'adult', 'child'].includes(profile.role);
export const calendarIdentifier = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f]/.test(value);
export function calendarSelection(body) {
  if (typeof body.ownerProfileId !== 'string' || !body.ownerProfileId || body.ownerProfileId.length > 128
    || /[\x00-\x1f/\\]/.test(body.ownerProfileId) || !['private', 'family'].includes(body.visibility) || !['import', 'sync'].includes(body.mode)) {
    failCalendar('CALENDAR_INVALID_REQUEST', 400, 'Wybierz profil, widoczność i sposób pobierania kalendarza.');
  }
  return { ownerProfileId: body.ownerProfileId, visibility: body.visibility, mode: body.mode };
}
