import { createHash } from 'node:crypto';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { CookieJar } from 'tough-cookie';
import { load } from 'cheerio';
import { EduServerError } from './edu-auth.mjs';
import { normalizeAssignments, normalizeGrades, normalizeMessages, normalizeTimetable, parseEduDate, plainText } from './edu-normalize.mjs';

// Protocol facts were independently checked against first-party login HTML/JS
// and the public references listed in integration-research/vulcan/README.md.
// Only authentication/federation uses POST. Every journal/messages request is GET.
const ALLOWED_HOSTS = new Set(['eduvulcan.pl', 'www.eduvulcan.pl', 'uczen.eduvulcan.pl',
  'wiadomosci.eduvulcan.pl', 'fs.eduvulcan.pl', 'dziennik-logowanie.vulcan.net.pl']);
const LOGIN_URL = 'https://eduvulcan.pl/logowanie';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 400;
const MAX_REQUESTS = 90;
const OPERATION_MS = 50000;
const DETAIL_LIMIT = 30;

function failure(code = 'EDU_UPSTREAM_UNAVAILABLE', status = 502) {
  const messages = {
    EDU_UPSTREAM_UNAVAILABLE: 'Dziennik jest chwilowo niedostępny. Spróbuj ponownie później.',
    EDU_UPSTREAM_TIMEOUT: 'Pobieranie z dziennika trwało zbyt długo. Ostatnie dane pozostają zachowane.',
    EDU_SESSION_EXPIRED: 'Sesja eduVULCAN wygasła. Połącz konto ponownie.',
    EDU_LOGIN_FAILED: 'Nie udało się zalogować do eduVULCAN. Sprawdź login i hasło w dzienniku.',
    EDU_INTERACTIVE_LOGIN_REQUIRED: 'eduVULCAN wymaga dodatkowego potwierdzenia w swoim dzienniku. Zaloguj się tam i spróbuj ponownie.',
    EDU_SCHEMA_CHANGED: 'Dziennik zwrócił nierozpoznany format danych. Ostatnie pobrane dane pozostają zachowane.',
    EDU_NO_PROFILES: 'Konto eduVULCAN nie udostępniło profili dziennika. Sprawdź dostęp do dziennika w eduVULCAN.',
    EDU_INVALID_STUDENT: 'Wybierz aktualny profil ucznia szkoły z połączonego konta. Profil przedszkola nie jest obsługiwany przez tę integrację.',
    EDU_PROFILE_AMBIGUOUS: 'Nie udało się jednoznacznie powiązać wybranego profilu z uczniem. Dane nie zostały pobrane.',
    EDU_STUDENT_INACTIVE: 'Wybrany profil dziennika jest nieaktywny. Wybierz aktualny profil szkoły.',
    EDU_RATE_LIMITED: 'eduVULCAN ograniczył liczbę zapytań. Odczekaj przed następną próbą.',
    EDU_DATA_LIMIT: 'Dziennik udostępnił zbyt wiele danych na jedną synchronizację. Ostatnie dane pozostają zachowane.',
    EDU_SESSION_INVALID: 'Zapisana sesja dziennika jest nieaktualna. Połącz konto ponownie.',
  };
  return new EduServerError(code, status, messages[code] || messages.EDU_UPSTREAM_UNAVAILABLE);
}

export function validateEduUrl(input, base = LOGIN_URL) {
  let url;
  try { url = new URL(input, base); } catch { throw failure('EDU_SCHEMA_CHANGED'); }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password
    || (url.port && url.port !== '443') || url.href.length > 16384) throw failure('EDU_SCHEMA_CHANGED');
  return url;
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
// In domain records `data` is also the Polish field for a date. Only unwrap
// structured payloads; a test/message date must never replace its full record.
function unwrapped(value) { return isObject(value) && (isObject(value.data) || Array.isArray(value.data)) ? value.data : value; }
function arrayPayload(value, maximum = 2000) {
  const rows = unwrapped(value);
  if (!Array.isArray(rows) || rows.length > maximum || rows.some((row) => !isObject(row))) throw failure('EDU_SCHEMA_CHANGED');
  return rows;
}
function compact(value, limit = 300) { return plainText(value, limit).replace(/\s+/g, ' ').trim(); }

function hiddenInputs($, form) {
  const fields = new URLSearchParams();
  const inputs = $(form).find('input[type="hidden"][name]').toArray();
  if (inputs.length > 80) throw failure('EDU_SCHEMA_CHANGED');
  for (const input of inputs) {
    const name = $(input).attr('name'); const value = $(input).attr('value') || '';
    if (name.length > 100 || value.length > 1024 * 1024) throw failure('EDU_SCHEMA_CHANGED');
    fields.append(name, value);
  }
  return fields;
}

/** Profile IDs expose neither the portal URL nor its account parameters. */
export function extractPortalProfiles(html, baseUrl = 'https://eduvulcan.pl/') {
  const $ = load(html); const profiles = new Map();
  const candidates = $('a[href]').toArray().filter((element) => {
    const href = $(element).attr('href') || '';
    return /^\/?dziennik\?/i.test(href) || /\/dziennik\?/i.test(href)
      || $(element).is('.panel-access__profile, .connected-account.access-row, [title="Przejdź do Dziennika"]');
  });
  for (const element of candidates) {
    const anchor = $(element);
    const url = validateEduUrl(anchor.attr('href') || '', baseUrl);
    if (!((['eduvulcan.pl', 'www.eduvulcan.pl'].includes(url.hostname) && /^\/dziennik\/?$/i.test(url.pathname))
      || (url.hostname === 'uczen.eduvulcan.pl' && !/\/api\//i.test(url.pathname)))) continue;
    const row = anchor.closest('.flex-row, .access-row, .panel-access__profile');
    const label = compact(row.find('.connected-account-name, .panel-access__profile-name').first().text()
      || anchor.find('.connected-account-name, .panel-access__profile-name').first().text()
      || anchor.attr('aria-label') || anchor.text() || row.text());
    const schoolMatch = /\(([^()]+)\)\s*$/.exec(label);
    const studentName = compact(schoolMatch ? label.slice(0, schoolMatch.index) : label) || 'Profil ucznia';
    const schoolName = compact(row.find('.connected-account-school, .panel-access__profile-school').first().text()
      || schoolMatch?.[1] || '');
    // Never hash a whole SSO URL: a new nonce/ReturnUrl would duplicate history.
    // Use explicit account/profile identity fields when present. Otherwise the
    // display identity is a conservative fallback; identical labels are ambiguous.
    const identityKeys = new Set(['id', 'guid', 'accountid', 'accountguid', 'profileid', 'profileguid']);
    const identityParams = [...url.searchParams].filter(([name, value]) => identityKeys.has(name.toLowerCase())
      && value && value.length <= 500).sort(([a], [b]) => a.localeCompare(b));
    const identity = identityParams.length
      ? [url.origin, url.pathname.toLowerCase(), identityParams]
      : [url.origin, url.pathname.toLowerCase(), studentName.normalize('NFC').toLocaleLowerCase('pl'), schoolName.normalize('NFC').toLocaleLowerCase('pl')];
    const id = `profile_${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
    const prior = profiles.get(id);
    if (prior && !identityParams.length && prior.journalUrl !== url.href) throw failure('EDU_PROFILE_AMBIGUOUS', 409);
    profiles.set(id, { id, studentName, schoolName, journalUrl: url.href,
      identityMethod: identityParams.length ? 'account-field' : 'display-fallback' });
    if (profiles.size > 30) throw failure('EDU_SCHEMA_CHANGED');
  }
  return [...profiles.values()];
}

/** The published first-party login widget's bounded computational challenge. */
export async function computeLoginProof({ challenge, difficulty, rounds }, { clock = Date.now, deadline = clock() + 8000 } = {}) {
  if (typeof challenge !== 'string' || !/^[a-zA-Z0-9_-]{16,200}$/.test(challenge)
    || !Number.isInteger(difficulty) || difficulty < 100000 || difficulty > 0xffffffff
    || !Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw failure('EDU_INTERACTIVE_LOGIN_REQUIRED', 409);
  const solutions = [];
  for (let round = 0; round < rounds; round += 1) {
    const prefix = challenge + solutions.join(''); let solved = false;
    for (let nonce = 1; nonce <= 1000000; nonce += 1) {
      // The public widget hashes the low byte of each character, not UTF-16.
      const digest = createHash('sha256').update(Buffer.from(prefix + nonce, 'latin1')).digest();
      if (digest.readUInt32BE(0) < difficulty) { solutions.push(nonce); solved = true; break; }
      if (nonce % 2048 === 0) {
        if (clock() >= deadline) throw failure('EDU_INTERACTIVE_LOGIN_REQUIRED', 409);
        await yieldEventLoop();
      }
    }
    if (!solved || clock() >= deadline) throw failure('EDU_INTERACTIVE_LOGIN_REQUIRED', 409);
  }
  return solutions.join(';');
}

function extractAppTokens(html) {
  const find = (name) => {
    const pattern = new RegExp(`(?:["']?${name}["']?)\\s*:\\s*["']([^"'\\r\\n]{1,4096})["']`, 'i');
    return pattern.exec(html)?.[1] || '';
  };
  return { appGuid: find('appGuid'), csrf: find('antiForgeryToken') || find('requestVerificationToken') || find('token') };
}

function deriveJournalLanding(response) {
  const url = validateEduUrl(response.url);
  if (url.hostname !== 'uczen.eduvulcan.pl') throw failure('EDU_SESSION_EXPIRED', 401);
  if (/\/End\/NieaktywnyUczen/i.test(url.pathname)) throw failure('EDU_STUDENT_INACTIVE', 409);
  const segments = url.pathname.split('/').filter(Boolean);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(segments[0] || '') || segments[1]?.toLowerCase() !== 'app') throw failure('EDU_SCHEMA_CHANGED');
  let appKey = '';
  try { appKey = segments.length >= 3 ? decodeURIComponent(segments[2]) : ''; } catch { throw failure('EDU_SCHEMA_CHANGED'); }
  return { tenant: segments[0], baseUrl: `${url.origin}/${segments[0]}`, referer: url.href, appKey, ...extractAppTokens(response.body) };
}

/** Select by the journal's exact App key. No first-profile or fuzzy-name match. */
export function chooseContextStudent(raw, appKey) {
  const context = unwrapped(raw);
  if (!isObject(context) || !Array.isArray(context.uczniowie) || context.uczniowie.length > 30) throw failure('EDU_SCHEMA_CHANGED');
  const students = context.uczniowie.filter((student) => isObject(student) && typeof student.key === 'string'
    && student.key && student.key.length <= 500 && student.aktywny !== false);
  const matches = appKey ? students.filter((student) => student.key === appKey) : students;
  if (matches.length !== 1) throw failure('EDU_PROFILE_AMBIGUOUS', 409);
  const pupil = matches[0];
  if (pupil.isPrzedszkolak === true) throw failure('EDU_INVALID_STUDENT', 400);
  if (pupil.wymagaAutoryzacji === true) throw failure('EDU_INTERACTIVE_LOGIN_REQUIRED', 409);
  if (!['string', 'number'].includes(typeof pupil.idDziennik) || !String(pupil.idDziennik) || String(pupil.idDziennik).length > 100
    || (pupil.globalKeySkrzynka !== undefined && (typeof pupil.globalKeySkrzynka !== 'string' || pupil.globalKeySkrzynka.length > 500))) throw failure('EDU_SCHEMA_CHANGED');
  return { key: pupil.key, idDziennik: pupil.idDziennik, globalKeySkrzynka: typeof pupil.globalKeySkrzynka === 'string' ? pupil.globalKeySkrzynka : '',
    isPrzedszkolak: pupil.isPrzedszkolak === true, uczen: compact(pupil.uczen), oddzial: compact(pupil.oddzial, 100),
    jednostka: compact(pupil.jednostka), dziennikDataOd: parseEduDate(pupil.dziennikDataOd), dziennikDataDo: parseEduDate(pupil.dziennikDataDo) };
}

function apiHeaders(app) {
  return { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: app.referer,
    ...(app.appGuid ? { 'X-V-AppGuid': app.appGuid } : {}),
    ...(app.csrf ? { 'X-V-RequestVerificationToken': app.csrf } : {}) };
}
function apiUrl(baseUrl, name, params = {}) {
  if (!/^[A-Za-z]+$/.test(name)) throw failure('EDU_SCHEMA_CHANGED');
  const url = validateEduUrl(`${baseUrl}/api/${name}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.href;
}

function polishDate(epoch) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(epoch));
  const value = (name) => parts.find((part) => part.type === name).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function shiftDate(date, offset) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); }
function dateBoundary(date, end = false) {
  const wallClock = `${date}T${end ? '23:59:59.999' : '00:00:00.000'}`;
  let candidate = new Date(`${wallClock}Z`);
  const formatter = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Warsaw', timeZoneName: 'longOffset' });
  // Refine at the actual local boundary, including the day clocks change.
  for (let pass = 0; pass < 2; pass += 1) {
    const offset = formatter.formatToParts(candidate).find((part) => part.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
    candidate = new Date(`${wallClock}${offset}`);
  }
  return candidate.toISOString();
}

export function createEduProvider({ fetchImpl = (...args) => globalThis.fetch(...args), clock = Date.now } = {}) {
  function operation(jar) {
    const deadline = clock() + OPERATION_MS; let requests = 0;
    async function request(input, { method = 'GET', body, headers = {} } = {}) {
      const url = validateEduUrl(input);
      if (++requests > MAX_REQUESTS || clock() >= deadline) throw failure('EDU_UPSTREAM_TIMEOUT', 504);
      const cookie = await jar.getCookieString(url.href);
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), Math.max(1, Math.min(10000, deadline - clock())));
      try {
        const response = await fetchImpl(url.href, { method, redirect: 'manual', signal: abort.signal, body,
          headers: { 'User-Agent': 'NaszaRodzina/1.5 (read-only eduVULCAN client)', 'Accept-Language': 'pl-PL,pl;q=0.9',
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', ...headers, ...(cookie ? { Cookie: cookie } : {}) } });
        const length = Number(response.headers.get('content-length') || 0);
        if (length > MAX_RESPONSE_BYTES) throw failure('EDU_DATA_LIMIT');
        const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
        if (cookies.length > 100) throw failure('EDU_DATA_LIMIT');
        for (const value of cookies) await jar.setCookie(value, url.href, { ignoreError: true });
        const chunks = []; let bytes = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (true) {
              const chunk = await reader.read(); if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw failure('EDU_DATA_LIMIT'); }
              chunks.push(Buffer.from(chunk.value));
            }
          } finally { reader.releaseLock(); }
        }
        const result = { status: response.status, headers: response.headers, body: Buffer.concat(chunks).toString('utf8'), url: url.href };
        if (result.status === 429) throw failure('EDU_RATE_LIMITED', 429);
        if (result.status === 401 || result.status === 403) throw failure('EDU_SESSION_EXPIRED', 401);
        if (result.status >= 500) throw failure();
        return result;
      } catch (error) {
        if (error instanceof EduServerError) throw error;
        throw failure(abort.signal.aborted ? 'EDU_UPSTREAM_TIMEOUT' : 'EDU_UPSTREAM_UNAVAILABLE', abort.signal.aborted ? 504 : 502);
      } finally { clearTimeout(timeout); }
    }

    async function navigate(input, initial = {}) {
      let response = await request(input, initial); let hops = 0;
      while (++hops <= 16) {
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) throw failure('EDU_SCHEMA_CHANGED');
          const target = validateEduUrl(location, response.url);
          // Never forward a credential or federation POST to another origin on 307/308.
          if ((response.status === 307 || response.status === 308) && initial.method === 'POST') {
            if (target.origin !== new URL(response.url).origin) throw failure('EDU_SCHEMA_CHANGED');
            response = await request(target.href, { ...initial, headers: { ...initial.headers, Referer: response.url } });
          } else {
            initial = {}; response = await request(target.href, { headers: { Referer: response.url } });
          }
          continue;
        }
        if (response.status < 200 || response.status >= 300) throw failure();
        const $ = load(response.body);
        const federation = $('form').toArray().find((form) => $(form).find('input[name="wresult"][type="hidden"]').length > 0);
        if (!federation) return response;
        if (($(federation).attr('method') || '').toLowerCase() !== 'post') throw failure('EDU_SCHEMA_CHANGED');
        const target = validateEduUrl($(federation).attr('action') || '', response.url);
        // A federation relay contains only hidden fields, never any user's password.
        const fields = hiddenInputs($, federation);
        if ([...fields.keys()].some((name) => /^(?:password|username|alias)$/i.test(name))) throw failure('EDU_SCHEMA_CHANGED');
        initial = { method: 'POST', body: fields.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded',
          Referer: response.url, Origin: new URL(response.url).origin } };
        response = await request(target.href, initial);
      }
      throw failure('EDU_SCHEMA_CHANGED');
    }

    async function json(input, app) {
      const response = await request(input, { headers: apiHeaders(app) });
      if (response.status >= 300 && response.status < 400) throw failure('EDU_SESSION_EXPIRED', 401);
      if (response.status !== 200) throw failure();
      if (!/^\s*[\[{]/.test(response.body)) {
        if (/name=["'](?:UserName|Password)["']/i.test(response.body)) throw failure('EDU_SESSION_EXPIRED', 401);
        throw failure('EDU_SCHEMA_CHANGED');
      }
      try { return JSON.parse(response.body); } catch { throw failure('EDU_SCHEMA_CHANGED'); }
    }
    return { request, navigate, json, deadline };
  }

  async function connectProvider({ login, password }) {
    if (typeof login !== 'string' || !login.trim() || login.length > 320 || typeof password !== 'string' || !password || password.length > 1024) throw failure('EDU_LOGIN_FAILED', 400);
    const jar = new CookieJar(); const io = operation(jar);
    const loginPage = await io.navigate(LOGIN_URL); const $ = load(loginPage.body);
    const form = $('form').toArray().find((element) => $(element).find('input[name="UserName"]').length && $(element).find('input[name="Password"]').length);
    if (!form) throw failure('EDU_SCHEMA_CHANGED');
    const loginTarget = validateEduUrl($(form).attr('action') || '', loginPage.url);
    if (!['eduvulcan.pl', 'www.eduvulcan.pl'].includes(loginTarget.hostname) || !/^\/logowanie\/?$/i.test(loginTarget.pathname)) throw failure('EDU_SCHEMA_CHANGED');
    const fields = hiddenInputs($, form); const token = fields.get('__RequestVerificationToken');
    if (!token || token.length > 4096) throw failure('EDU_SCHEMA_CHANGED');
    let needsProof = false;
    if ($(form).attr('data-queryskip') !== 'True') {
      const infoTarget = validateEduUrl($(form).attr('data-queryuri') || '', loginPage.url);
      if (infoTarget.origin !== loginTarget.origin || infoTarget.pathname !== '/Account/QueryUserInfo') throw failure('EDU_SCHEMA_CHANGED');
      const info = await io.request(infoTarget.href, { method: 'POST', body: new URLSearchParams({ alias: login.trim(), __RequestVerificationToken: token }).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest',
          Referer: loginPage.url, Origin: loginTarget.origin, Accept: 'application/json' } });
      let result;
      try { result = JSON.parse(info.body); } catch { throw failure('EDU_INTERACTIVE_LOGIN_REQUIRED', 409); }
      if (info.status !== 200 || result.success !== true || !isObject(result.data) || typeof result.data.ShowCaptcha !== 'boolean') throw failure('EDU_INTERACTIVE_LOGIN_REQUIRED', 409);
      needsProof = result.data.ShowCaptcha;
    } else {
      // Without the identity query we cannot safely infer whether the challenge is required.
      needsProof = $(form).find('.captcha-wrapper').length > 0;
    }
    let proof = '';
    if (needsProof) {
      const widget = $(form).find('.captcha-wrapper').first();
      if (widget.length !== 1) throw failure('EDU_INTERACTIVE_LOGIN_REQUIRED', 409);
      proof = await computeLoginProof({ challenge: widget.attr('data-challenge'), difficulty: Number(widget.attr('data-difficulty')),
        rounds: Number(widget.attr('data-rounds')) }, { clock, deadline: Math.min(io.deadline - 15000, clock() + 8000) });
    }
    fields.set('UserName', login.trim()); fields.set('Password', password); fields.set('captcha-response', proof);
    let landing;
    try {
      landing = await io.navigate(loginTarget.href, { method: 'POST', body: fields.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: loginPage.url, Origin: loginTarget.origin } });
    } finally { fields.delete('Password'); password = undefined; }
    let $home = load(landing.body);
    if ($home('input[name="Password"], input[name="UserName"]').length) throw failure('EDU_LOGIN_FAILED', 401);
    let profiles = extractPortalProfiles(landing.body, landing.url);
    if (!profiles.length && ['eduvulcan.pl', 'www.eduvulcan.pl'].includes(new URL(landing.url).hostname)) {
      // The current first-party WordPress homepage links to this access panel.
      // Opening the panel does not enter any student's journal.
      landing = await io.navigate('https://eduvulcan.pl/dostep-do-dziennika/', { headers: { Referer: landing.url } });
      if (/name=["'](?:UserName|Password)["']/i.test(landing.body)) throw failure('EDU_LOGIN_FAILED', 401);
      $home = load(landing.body);
      profiles = extractPortalProfiles(landing.body, landing.url);
    }
    if (!profiles.length) {
      if (/dwuskładnik|dwuetap|kod weryfik|potwierdź|potwierdzenia|klucz dostępu|captcha/i.test($home('main, .message-error, .validation-summary-errors').text())) throw failure('EDU_INTERACTIVE_LOGIN_REQUIRED', 409);
      throw failure('EDU_NO_PROFILES', 409);
    }
    // Connecting only discovers profiles. Journal SSO starts after explicit selection.
    return { session: { v: 1, cookieJar: jar.toJSON(), profiles, currentProfileId: null },
      profiles: profiles.map(({ journalUrl: _secret, identityMethod: _method, ...profile }) => profile) };
  }

  async function readProviderData(session, profileId, { includeMessages = true } = {}) {
    if (typeof includeMessages !== 'boolean') throw failure('EDU_INVALID_REQUEST', 400);
    if (!isObject(session) || session.v !== 1 || !isObject(session.cookieJar) || !Array.isArray(session.profiles) || session.profiles.length > 30) throw failure('EDU_SESSION_INVALID', 401);
    const profile = session.profiles.find((entry) => entry.id === profileId);
    if (!profile) throw failure('EDU_INVALID_STUDENT', 400);
    let jar;
    try { jar = CookieJar.fromJSON(session.cookieJar); } catch { throw failure('EDU_SESSION_INVALID', 401); }
    const io = operation(jar); const warnings = []; const items = []; const reconcileScopes = [];
    const report = (text) => { if (!warnings.includes(text)) warnings.push(text); };
    let journal;
    const landing = await io.navigate(validateEduUrl(profile.journalUrl).href, { headers: { Referer: 'https://eduvulcan.pl/' } });
    if (/name=["'](?:UserName|Password)["']/i.test(landing.body)) throw failure('EDU_SESSION_EXPIRED', 401);
    journal = deriveJournalLanding(landing);
    const pupil = chooseContextStudent(await io.json(apiUrl(journal.baseUrl, 'Context'), journal), journal.appKey);
    journal = { ...journal, ...pupil, profileId };
    const today = polishDate(clock()); const dateFrom = shiftDate(today, -7); const dateTo = shiftDate(today, 21);
    const assignmentsTo = shiftDate(today, 30);
    const scope = async (read, label) => {
      try { return await read(); } catch (error) {
        if (!(error instanceof EduServerError) || ['EDU_SESSION_EXPIRED', 'EDU_RATE_LIMITED', 'EDU_UPSTREAM_TIMEOUT'].includes(error.code)) throw error;
        report(`${label}: nie udało się pobrać danych; poprzednie wpisy pozostają zachowane.`); return null;
      }
    };

    // Limited concurrency for independent, read-only sections.
    const [gradeResult, timetableResult, assignmentsResult] = await Promise.all([
      scope(async () => {
        const periods = arrayPayload(await io.json(apiUrl(journal.baseUrl, 'OkresyKlasyfikacyjne', { key: pupil.key, idDziennik: pupil.idDziennik }), journal), 20);
        const current = periods.filter((period) => period.id !== undefined && parseEduDate(period.dataOd) && parseEduDate(period.dataDo)
          && parseEduDate(period.dataOd) <= today && parseEduDate(period.dataDo) >= today);
        if (current.length !== 1) { report('Oceny: dziennik nie wskazał jednoznacznego bieżącego okresu klasyfikacyjnego.'); return null; }
        const periodId = String(current[0].id);
        if (!periodId || periodId.length > 100) throw failure('EDU_SCHEMA_CHANGED');
        const rows = normalizeGrades(await io.json(apiUrl(journal.baseUrl, 'Oceny', { key: pupil.key, idOkresKlasyfikacyjny: periodId }), journal), { profileId, periodId });
        return { rows, periodId };
      }, 'Oceny'),
      scope(async () => normalizeTimetable(await io.json(apiUrl(journal.baseUrl, 'PlanZajec', { key: pupil.key,
        dataOd: dateBoundary(dateFrom), dataDo: dateBoundary(dateTo, true), zakresDanych: 2 }), journal)), 'Plan lekcji'),
      scope(async () => arrayPayload(await io.json(apiUrl(journal.baseUrl, 'SprawdzianyZadaniaDomowe', { key: pupil.key,
        dataOd: dateBoundary(dateFrom), dataDo: dateBoundary(assignmentsTo, true) }), journal), 1000), 'Zadania i sprawdziany'),
    ]);
    if (gradeResult) { items.push(...gradeResult.rows); reconcileScopes.push({ type: 'grade', scopeId: `grades:${gradeResult.periodId}` }); }
    if (timetableResult) { items.push(...timetableResult); reconcileScopes.push({ type: 'lesson', scopeId: 'timetable', dateFrom, dateTo }); }
    if (items.length > MAX_ITEMS) throw failure('EDU_DATA_LIMIT');

    async function mapLimited(rows, limit, read, label) {
      const selected = rows.slice(0, limit); const results = new Array(selected.length); let cursor = 0;
      if (rows.length > limit) report(`${label}: pobrano szczegóły najwyżej ${limit} wpisów w tej synchronizacji.`);
      await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
        while (cursor < selected.length) {
          const index = cursor++; const value = selected[index];
          results[index] = await scope(() => read(value), label);
        }
      }));
      return results;
    }

    let assignmentsSucceeded = false; let assignmentsNotificationReady = false;
    if (assignmentsResult) {
      const supportedAssignments = assignmentsResult.filter((row) => [1, 2, 3, 4].includes(Number(row.typ)));
      if (supportedAssignments.length !== assignmentsResult.length) report('Zadania i sprawdziany: pominięto nieznany rodzaj wpisu z dziennika.');
      const detailed = await mapLimited(supportedAssignments, DETAIL_LIMIT, async (row) => {
        if (!['number', 'string'].includes(typeof row.id) || String(row.id).length > 100) throw failure('EDU_SCHEMA_CHANGED');
        const detailEndpoint = Number(row.typ) === 4 ? 'ZadanieDomoweSzczegoly' : 'SprawdzianSzczegoly';
        const detail = unwrapped(await io.json(apiUrl(journal.baseUrl, detailEndpoint, { key: pupil.key, id: row.id }), journal));
        if (!isObject(detail) || !['opis', 'temat', 'tresc'].some((name) => typeof detail[name] === 'string')
          || (detail.id !== undefined && String(detail.id) !== String(row.id))) throw failure('EDU_SCHEMA_CHANGED');
        if (typeof detail.opis === 'string' && detail.opis.length > 20000) report('Zadania i sprawdziany: bardzo długa treść została skrócona; całość jest dostępna w dzienniku.');
        return { ...row, ...detail, id: row.id, typ: row.typ };
      }, 'Zadania i sprawdziany');
      // A failed detail must not replace a previously cached body with list metadata.
      const enriched = detailed.filter((value) => value !== null);
      const normalized = await scope(async () => normalizeAssignments(enriched), 'Zadania i sprawdziany');
      if (normalized) {
        const capacity = MAX_ITEMS - items.length;
        if (normalized.length > capacity) report('Zadania i sprawdziany: część wpisów przekracza limit tej synchronizacji.');
        items.push(...normalized.slice(0, capacity));
        assignmentsSucceeded = assignmentsResult.length === 0 || normalized.length > 0;
        // Notification history is initialized only after the selected section
        // has real, successfully read details. A partial import must not make
        // recovered older homework/tests look like newly created records.
        assignmentsNotificationReady = supportedAssignments.length === assignmentsResult.length
          && detailed.every((value) => value !== null) && normalized.length <= capacity;
      }
    }

    let messagesApp; let messagesSucceeded = false; let messagesNotificationReady = false;
    // A pupil's school identity does not prove ownership of a parent mailbox.
    // Personal student scopes omit mail until provider role verification exists.
    if (!includeMessages) report('Wiadomości z osobistego konta ucznia nie są jeszcze obsługiwane.');
    else if (!pupil.globalKeySkrzynka) report('Wiadomości: wybrany profil nie udostępnił identyfikatora swojej skrzynki.');
    else if (clock() > io.deadline - 12000) report('Wiadomości: zabrakło czasu w tej synchronizacji; wcześniejsze dane pozostają zachowane.');
    else await scope(async () => {
      const messageLanding = await io.navigate(`https://wiadomosci.eduvulcan.pl/${journal.tenant}/App`, { headers: { Referer: journal.referer } });
      const messageUrl = validateEduUrl(messageLanding.url);
      if (messageUrl.hostname !== 'wiadomosci.eduvulcan.pl' || !messageUrl.pathname.startsWith(`/${journal.tenant}/`)) throw failure('EDU_SESSION_EXPIRED', 401);
      messagesApp = { baseUrl: `${messageUrl.origin}/${journal.tenant}`, referer: messageUrl.href, ...extractAppTokens(messageLanding.body) };
      const mailboxes = arrayPayload(await io.json(apiUrl(messagesApp.baseUrl, 'Skrzynki'), messagesApp), 100);
      if (mailboxes.filter((box) => box.globalKey === pupil.globalKeySkrzynka).length !== 1) throw failure('EDU_SCHEMA_CHANGED');
      const inbox = arrayPayload(await io.json(apiUrl(messagesApp.baseUrl, 'OdebraneSkrzynka', { globalKeySkrzynka: pupil.globalKeySkrzynka,
        idLastWiadomosc: 0, pageSize: DETAIL_LIMIT }), messagesApp), 1000);
      if (inbox.length >= DETAIL_LIMIT) report(`Wiadomości: pobrano ostatnie ${DETAIL_LIMIT} wiadomości z wybranej skrzynki.`);
      const details = new Map();
      await mapLimited(inbox, DETAIL_LIMIT, async (row) => {
        if (typeof row.apiGlobalKey !== 'string' || !row.apiGlobalKey || row.apiGlobalKey.length > 500) throw failure('EDU_SCHEMA_CHANGED');
        const detail = unwrapped(await io.json(apiUrl(messagesApp.baseUrl, 'WiadomoscSzczegoly', { apiGlobalKey: row.apiGlobalKey }), messagesApp));
        if (!isObject(detail) || typeof detail.tresc !== 'string'
          || (detail.apiGlobalKey !== undefined && detail.apiGlobalKey !== row.apiGlobalKey)) throw failure('EDU_SCHEMA_CHANGED');
        if (typeof detail.tresc === 'string' && detail.tresc.length > 20000) report('Wiadomości: bardzo długa treść została skrócona; całość jest dostępna w dzienniku.');
        details.set(row.apiGlobalKey, detail); return true;
      }, 'Treść wiadomości');
      // Preserve an existing message when its full-body GET fails or changes schema.
      const normalized = normalizeMessages(inbox.slice(0, DETAIL_LIMIT).filter((row) => details.has(row.apiGlobalKey)), details);
      const capacity = MAX_ITEMS - items.length;
      if (normalized.length > capacity) report('Wiadomości: część wpisów przekracza limit tej synchronizacji.');
      items.push(...normalized.slice(0, capacity));
      messagesSucceeded = inbox.length === 0 || normalized.length > 0;
      messagesNotificationReady = details.size === Math.min(inbox.length, DETAIL_LIMIT) && normalized.length <= capacity;
    }, 'Wiadomości');

    if (!gradeResult && !timetableResult && !assignmentsSucceeded && !messagesSucceeded) throw failure('EDU_SYNC_FAILED');
    const countTypes = { grades: 'grade', lessons: 'lesson', homework: 'homework', tests: 'test', messages: 'message' };
    const counts = Object.fromEntries(Object.entries(countTypes).map(([name, type]) => [name, items.filter((item) => item.type === type).length]));
    // Internal metadata for the server notification baseline only; these flags
    // never change portal requests, session handling, public counts or leases.
    const notificationReadyTypes = [
      ...(gradeResult ? ['grade'] : []), ...(timetableResult !== null ? ['lesson'] : []),
      ...(assignmentsNotificationReady ? ['homework', 'test'] : []), ...(messagesNotificationReady ? ['message'] : []),
    ];
    return { session: { ...session, cookieJar: jar.toJSON(), currentProfileId: profileId, journal }, items, counts, warnings,
      reconcileScopes, notificationReadyTypes, range: { dateFrom, dateTo, assignmentsTo } };
  }

  return { connectProvider, readProviderData };
}

const provider = createEduProvider();
export const connectProvider = provider.connectProvider;
export const readProviderData = provider.readProviderData;
