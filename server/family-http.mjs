import { EduServerError, getServerFirebase, requireMember, eduRequestHeader } from './edu-auth.mjs';
import { readJsonBody } from './edu-http.mjs';
import { assertFamilyV2WriteAllowed, familyV2WritesAllowed } from './family-v2-policy.mjs';
import { manageTasksAction } from './tasks-service.mjs';
import { manageHealthAction } from './health-service.mjs';
import { manageMusicSchoolAction, assertMusicWrites, musicWritesAllowed } from './music-school-service.mjs';
import { manageFinanceAction } from './finance-service.mjs';

function routeDomain(request) {
  if (typeof request.url !== 'string' || /[\u0000-\u0020\u007f\\#]/.test(request.url)) return null;
  const separator = request.url.indexOf('?');
  const path = separator < 0 ? request.url : request.url.slice(0, separator);
  const match = /^\/api\/family\/(tasks|health|finance|music-school)$/.exec(path);
  if (!match) return null;
  const domain = match[1];
  const query = new URLSearchParams(separator < 0 ? '' : request.url.slice(separator + 1)).getAll('action');
  if (query.length > 1 || query.length === 1 && query[0] !== domain) return null;
  if (request.query && Object.hasOwn(request.query, 'action') && request.query.action !== domain) return null;
  return domain;
}

/** New API origin policy does not change the existing eduVULCAN origin. */
export function assertFamilyOrigin(request, env = process.env) {
  const origin = eduRequestHeader(request, 'origin');
  if (!origin) return; // Signed, revoked-token-checked non-browser clients remain authenticated.
  let url;
  try { url = new URL(origin); } catch { throw new EduServerError('FAMILY_FORBIDDEN_ORIGIN', 403, 'Niedozwolona domena żądania.'); }
  if (url.origin !== origin) throw new EduServerError('FAMILY_FORBIDDEN_ORIGIN', 403, 'Niedozwolona domena żądania.');
  const allowed = new Set();
  const configured = env.FAMILY_V2_SITE_ORIGIN || env.CALENDAR_SITE_ORIGIN || env.EDUVULCAN_SITE_ORIGIN;
  if (configured && env.VERCEL_ENV !== 'preview') {
    try { const expected = new URL(configured); if (expected.origin === configured && expected.protocol === 'https:') allowed.add(configured); } catch { /* Fail closed. */ }
  }
  if (env.VERCEL_ENV === 'preview') {
    for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      if (typeof host === 'string' && /^[a-z0-9][a-z0-9.-]*\.vercel\.app$/.test(host)) allowed.add(`https://${host}`);
    }
  }
  if (!env.VERCEL && env.FIREBASE_PROJECT_ID?.startsWith('demo-')
    && env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099' && env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080') {
    allowed.add('http://127.0.0.1:5173'); allowed.add('http://localhost:5173');
  }
  if (!allowed.has(url.origin)) throw new EduServerError('FAMILY_FORBIDDEN_ORIGIN', 403, 'Niedozwolona domena żądania.');
}

function authRequestAfterOriginValidation(request) {
  const headers = typeof request.headers?.get === 'function' ? new Headers(request.headers) : { ...request.headers };
  if (typeof headers.delete === 'function') headers.delete('origin');
  else { delete headers.origin; delete headers.Origin; }
  return { ...request, headers };
}

/** One Vercel function: same-origin, fresh Firebase identity, fail-closed writes. */
export function createFamilyRouter({ services = getServerFirebase, memberGuard = requireMember,
  tasksAction = manageTasksAction, healthAction = manageHealthAction, financeAction = manageFinanceAction, musicAction = manageMusicSchoolAction, env = process.env } = {}) {
  return async function familyRouter(request, response) {
    response.setHeader('Cache-Control', 'no-store, private, max-age=0');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const domain = routeDomain(request);
      if (!domain) throw new EduServerError('FAMILY_NOT_FOUND', 404, 'Nie znaleziono tej operacji.');
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new EduServerError('FAMILY_METHOD_NOT_ALLOWED', 405, 'Nieobsługiwana metoda żądania.');
      }
      assertFamilyOrigin(request, env);
      const context = await memberGuard(authRequestAfterOriginValidation(request), services());
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EduServerError('FAMILY_INVALID_REQUEST', 400, 'Nieprawidłowe dane żądania.');
      if (body.operation && body.action && body.operation !== body.action) throw new EduServerError('FAMILY_INVALID_REQUEST', 400, 'Nieprawidłowa operacja.');
      const operation = body.operation || body.action;
      if (!['state', 'status'].includes(operation)) {
        if (domain === 'music-school') assertMusicWrites(env);
        else assertFamilyV2WriteAllowed(context, env, domain);
      }
      const result = domain === 'music-school' ? await musicAction(context, body, { env })
        : await ({ tasks: tasksAction, health: healthAction, finance: financeAction })[domain](context, body);
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true, ...result, writesEnabled: domain === 'music-school' ? musicWritesAllowed(env) : familyV2WritesAllowed(context, env, domain) }));
    } catch (error) {
      const known = error instanceof EduServerError;
      response.statusCode = known ? error.status : 500;
      response.end(JSON.stringify({ ok: false, error: { code: known ? error.code : 'FAMILY_SERVER_ERROR',
        message: known ? error.message : 'Nie udało się wykonać operacji. Spróbuj ponownie.' } }));
    } finally {
      if (Buffer.isBuffer(request.body)) request.body.fill(0);
      request.body = undefined;
    }
  };
}
