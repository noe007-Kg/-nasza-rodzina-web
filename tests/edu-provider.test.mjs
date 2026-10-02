import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { chooseContextStudent, computeLoginProof, createEduProvider, extractPortalProfiles, validateEduUrl } from '../server/edu-provider.mjs';

// All HTML, credentials, cookies and school records below are invented fixtures.
// The fetch replacement never opens a network connection.
const NOW = Date.parse('2026-10-01T11:00:00Z');
const LOGIN = 'synthetic-parent@example.invalid';
const PASSWORD = 'synthetic-password-only';
const SCHOOL_KEY = 'key-SP4-Nikodem==';
const PRESCHOOL_KEY = 'key-preschool==';
const MAILBOX = 'mailbox-SP4-only';
const LONG_BODY = 'Pełna ważna wiadomość dla rodzica. '.repeat(90);

function html(body, { status = 200, headers = {}, cookies = [] } = {}) {
  const actual = new Headers({ 'Content-Type': 'text/html; charset=utf-8', ...headers });
  for (const cookie of cookies) actual.append('Set-Cookie', cookie);
  return new Response(body, { status, headers: actual });
}
function json(body, options = {}) { return html(JSON.stringify(body), { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }); }
function redirect(location, options = {}) { return html('', { status: 302, ...options, headers: { Location: location, ...options.headers } }); }

function accessPanel(nonce = 'one') {
  return `<main class="panel-access">
    <a class="panel-access__profile" href="/dziennik?id=preschool-account&amp;nonce=${nonce}"><span class="panel-access__profile-name">Layla Kowalska</span><span class="panel-access__profile-school">Przedszkole</span></a>
    <a class="panel-access__profile" href="/dziennik?id=old-account&amp;nonce=${nonce}"><span class="panel-access__profile-name">Nikodem Kowalski</span><span class="panel-access__profile-school">Dawna szkoła</span></a>
    <a class="panel-access__profile" href="/dziennik?id=sp4-account&amp;nonce=${nonce}"><span class="panel-access__profile-name">Nikodem Kowalski</span><span class="panel-access__profile-school">SP 4 Kołobrzeg</span></a>
  </main>`;
}
function loginPage({ action = '/logowanie', challenge = '' } = {}) {
  return `<main><form method="post" action="${action}" data-queryuri="/Account/QueryUserInfo" data-queryskip="False">
    <input type="hidden" name="__RequestVerificationToken" value="csrf-fixture">
    <input name="UserName"><input type="password" name="Password">
    ${challenge}<input type="hidden" name="captcha-response" value="">
  </form></main>`;
}
function federation(action) {
  return `<form action="${action}" method="post"><input type="hidden" name="wresult" value="synthetic-federation-result"><input type="hidden" name="wctx" value="synthetic-context"></form>`;
}
const context = () => ({ uczniowie: [
  { key: PRESCHOOL_KEY, uczen: 'Layla Kowalska', jednostka: 'Przedszkole', idDziennik: 9, globalKeySkrzynka: 'mailbox-preschool', isPrzedszkolak: true },
  { key: 'key-old-school', uczen: 'Nikodem Kowalski', jednostka: 'Dawna szkoła', idDziennik: 7, aktywny: false },
  { key: SCHOOL_KEY, uczen: 'Nikodem Kowalski', jednostka: 'SP 4 Kołobrzeg', oddzial: '3a', idDziennik: 4009, globalKeySkrzynka: MAILBOX, isUczen: true, isPrzedszkolak: false },
] });
const grades = () => ({ ustawienia: { isOcenaOpisowa: true, isSrednia: false }, ocenyPrzedmioty: [
  { przedmiotNazwa: 'Edukacja wczesnoszkolna', kolumnyOcenyCzastkowe: [{ idKolumny: 41, kategoriaKolumny: 'Opis', nazwaKolumny: 'Czytanie', oceny: [
    { wpis: 'Dobrze', dataOceny: '29.09.2026', nauczyciel: 'Anna' },
    { wpis: 'Świetnie', dataOceny: '30.09.2026', nauczyciel: 'Anna', idOcenaPoprawiona: 10 },
  ] }], podsumowanieOcen: 'Samodzielnie czyta ze zrozumieniem.' },
] });
const plan = () => [{ data: '2026-10-01T00:00:00', godzinaOd: '2026-10-01T08:00:00', godzinaDo: '2026-10-01T08:45:00', przedmiot: 'Matematyka', prowadzacy: 'Anna', sala: '4', adnotacja: 1 },
  { data: '2026-10-01T00:00:00', godzinaOd: '2026-10-01T08:00:00', godzinaDo: '2026-10-01T08:45:00', przedmiot: 'Język polski', prowadzacy: 'Jan', sala: '5', adnotacja: 2 }];

function recordedPortal({ override = () => undefined, showCaptcha = false, nonce = 'one' } = {}) {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input); const headers = new Headers(init.headers);
    const request = { url: url.href, host: url.hostname, path: url.pathname, query: url.searchParams,
      method: init.method, headers, body: init.body || '', fields: new URLSearchParams(init.body || '') };
    requests.push(request);
    const changed = await override(url, request, requests);
    if (changed !== undefined) return changed;
    if (url.hostname === 'eduvulcan.pl') {
      if (url.pathname === '/logowanie' && request.method === 'GET') return html(loginPage(), { cookies: ['csrf_cookie=csrf-fixture; Path=/; Secure; HttpOnly; SameSite=Lax'] });
      if (url.pathname === '/Account/QueryUserInfo') {
        assert.equal(request.method, 'POST');
        assert.equal(request.fields.get('alias'), LOGIN);
        assert.equal(request.fields.get('__RequestVerificationToken'), 'csrf-fixture');
        assert.equal(request.fields.has('Password'), false);
        assert.match(headers.get('cookie'), /csrf_cookie=csrf-fixture/);
        assert.equal(headers.get('x-requested-with'), 'XMLHttpRequest');
        return json({ success: true, data: { ShowCaptcha: showCaptcha } });
      }
      if (url.pathname === '/logowanie' && request.method === 'POST') {
        assert.equal(request.fields.get('UserName'), LOGIN);
        assert.equal(request.fields.get('Password'), PASSWORD);
        assert.equal(request.fields.get('__RequestVerificationToken'), 'csrf-fixture');
        assert.match(headers.get('cookie'), /csrf_cookie=csrf-fixture/);
        return redirect('/', { cookies: ['edu_auth=opaque-fixture-session; Domain=.eduvulcan.pl; Path=/; Secure; HttpOnly; SameSite=Lax'] });
      }
      if (url.pathname === '/') {
        assert.equal(request.method, 'GET');
        assert.equal(request.body, '');
        assert.match(headers.get('cookie'), /edu_auth=opaque-fixture-session/);
        return html('<main><h1>Portal eduVULCAN</h1><a href="/dostep-do-dziennika/">Dostęp do dziennika</a></main>');
      }
      if (url.pathname === '/dostep-do-dziennika/') return html(accessPanel(nonce));
      if (url.pathname === '/dziennik') {
        assert.equal(url.searchParams.get('id'), 'sp4-account', 'Only the explicitly selected school account may be entered');
        return redirect('https://fs.eduvulcan.pl/ls?school=sp4');
      }
    }
    if (url.hostname === 'fs.eduvulcan.pl') return html(federation('https://uczen.eduvulcan.pl/kolobrzeg/AccountLogin'));
    if (url.hostname === 'uczen.eduvulcan.pl') {
      if (url.pathname === '/kolobrzeg/AccountLogin') {
        assert.equal(request.method, 'POST');
        assert.equal(request.fields.get('wresult'), 'synthetic-federation-result');
        assert.equal(request.fields.has('Password'), false);
        return redirect(`/kolobrzeg/App/${encodeURIComponent(SCHOOL_KEY)}/Start`, { cookies: ['student_session=school4-fixture; Path=/; Secure; HttpOnly'] });
      }
      if (url.pathname.includes('/App/')) return html('<script>window.config={appGuid:"student-guid-fixture",antiForgeryToken:"student-csrf-fixture"}</script>');
      assert.equal(request.method, 'GET');
      assert.equal(headers.get('x-v-appguid'), 'student-guid-fixture');
      assert.equal(headers.get('x-v-requestverificationtoken'), 'student-csrf-fixture');
      assert.match(headers.get('cookie'), /student_session=school4-fixture/);
      if (url.pathname.endsWith('/Context')) return json(context());
      assert.equal(url.searchParams.get('key'), SCHOOL_KEY, 'A sibling/preschool key must never enter any data request');
      if (url.pathname.endsWith('/OkresyKlasyfikacyjne')) {
        assert.equal(url.searchParams.get('idDziennik'), '4009');
        return json([{ id: 'old-period', dataOd: '2026-01-01', dataDo: '2026-08-31' }, { id: 'current-period', numerOkresu: 1, dataOd: '2026-09-01', dataDo: '2027-01-31' }]);
      }
      if (url.pathname.endsWith('/Oceny')) {
        assert.equal(url.searchParams.get('idOkresKlasyfikacyjny'), 'current-period');
        return json(grades());
      }
      if (url.pathname.endsWith('/PlanZajec')) return json(plan());
      if (url.pathname.endsWith('/SprawdzianyZadaniaDomowe')) return json([
        { id: 31, typ: 4, data: '2026-10-01', przedmiotNazwa: 'Przyroda' }, { id: 32, typ: 2, data: '2026-10-02', przedmiotNazwa: 'Matematyka' },
      ]);
      if (url.pathname.endsWith('/ZadanieDomoweSzczegoly')) {
        assert.equal(url.searchParams.get('id'), '31');
        return json({ opis: '<p>Przeczytaj rozdział o roślinach.</p>', terminOdpowiedzi: '2026-10-05', nauczycielImieNazwisko: 'Anna' });
      }
      if (url.pathname.endsWith('/SprawdzianSzczegoly')) {
        assert.equal(url.searchParams.get('id'), '32');
        return json({ opis: 'Kartkówka: dodawanie', data: '2026-10-02', nauczycielImieNazwisko: 'Jan' });
      }
    }
    if (url.hostname === 'wiadomosci.eduvulcan.pl') {
      if (url.pathname === '/kolobrzeg/App') return redirect('https://dziennik-logowanie.vulcan.net.pl/kolobrzeg/Fs/Ls');
      if (url.pathname === '/kolobrzeg/AccountLogin') {
        assert.equal(request.method, 'POST');
        assert.equal(request.fields.has('Password'), false);
        return redirect('/kolobrzeg/App/Index', { cookies: ['mail_session=sp4-fixture; Path=/; Secure; HttpOnly'] });
      }
      if (url.pathname === '/kolobrzeg/App/Index') return html('<script>window.config={appGuid:"mail-guid-fixture",antiForgeryToken:"mail-csrf-fixture"}</script>');
      assert.equal(request.method, 'GET');
      assert.equal(headers.get('x-v-appguid'), 'mail-guid-fixture');
      assert.equal(headers.get('x-v-requestverificationtoken'), 'mail-csrf-fixture');
      assert.match(headers.get('cookie'), /mail_session=sp4-fixture/);
      if (url.pathname.endsWith('/Skrzynki')) return json([{ globalKey: 'mailbox-preschool', nazwa: 'Przedszkole', typUzytkownika: 2 }, { globalKey: MAILBOX, nazwa: 'SP4 Nikodem', typUzytkownika: 2 }]);
      if (url.pathname.endsWith('/OdebraneSkrzynka')) {
        assert.equal(url.searchParams.get('globalKeySkrzynka'), MAILBOX);
        return json([{ apiGlobalKey: 'school-mail-51', id: 51, data: '2026-10-01T10:30:00', temat: 'Zebranie', korespondenci: 'Anna', przeczytana: false, hasZalaczniki: true }]);
      }
      if (url.pathname.endsWith('/WiadomoscSzczegoly')) {
        assert.equal(url.searchParams.get('apiGlobalKey'), 'school-mail-51');
        return json({ apiGlobalKey: 'school-mail-51', data: '2026-10-01T10:30:00', tresc: `<p>${LONG_BODY}</p><script>tracker()</script>`, nadawca: 'Anna', odczytana: false });
      }
    }
    if (url.hostname === 'dziennik-logowanie.vulcan.net.pl') return html(federation('https://wiadomosci.eduvulcan.pl/kolobrzeg/AccountLogin'));
    throw new Error(`Unexpected synthetic route: ${request.method} ${url.href}`);
  };
  return { provider: createEduProvider({ fetchImpl, clock: () => NOW }), requests };
}

async function connectAndRead(options) {
  const fixture = recordedPortal(options);
  const connected = await fixture.provider.connectProvider({ login: LOGIN, password: PASSWORD });
  const profile = connected.profiles.find((item) => item.schoolName === 'SP 4 Kołobrzeg');
  assert.ok(profile);
  const data = await fixture.provider.readProviderData(connected.session, profile.id);
  return { ...fixture, connected, profile, data };
}

test('connect handles real UserName/query/CSRF/cookie protocol and discovers profiles without fetching any school', async () => {
  const { provider, requests } = recordedPortal();
  const connection = await provider.connectProvider({ login: ` ${LOGIN} `, password: PASSWORD });
  assert.equal(connection.profiles.length, 3);
  assert.equal(connection.profiles[2].schoolName, 'SP 4 Kołobrzeg');
  assert.equal(connection.session.currentProfileId, null);
  assert.ok(requests.every((request) => request.host === 'eduvulcan.pl'));
  assert.deepEqual(requests.map((request) => [request.method, request.path]), [
    ['GET', '/logowanie'], ['POST', '/Account/QueryUserInfo'], ['POST', '/logowanie'], ['GET', '/'], ['GET', '/dostep-do-dziennika/'],
  ]);
  assert.equal(JSON.stringify(connection).includes(PASSWORD), false);
  assert.equal(JSON.stringify(connection.session).includes(LOGIN), false);
  assert.ok(connection.profiles.every((profile) => !Object.hasOwn(profile, 'journalUrl')));
});

test('explicit SP4 sync reads current detailed/descriptive grades, dated plan, correct homework endpoint and only its mailbox', async () => {
  const { data, requests, profile } = await connectAndRead();
  assert.deepEqual(data.counts, { grades: 3, lessons: 2, homework: 1, tests: 1, messages: 1 });
  assert.deepEqual(data.warnings, []);
  assert.deepEqual(data.range, { dateFrom: '2026-09-24', dateTo: '2026-10-22', assignmentsTo: '2026-10-31' });
  assert.equal(data.session.currentProfileId, profile.id);
  assert.equal(data.session.journal.key, SCHOOL_KEY);
  assert.equal(data.session.journal.globalKeySkrzynka, MAILBOX);
  assert.deepEqual(data.items.filter((item) => item.type === 'grade').map((item) => item.title), ['Dobrze', 'Świetnie', 'Podsumowanie ocen: Samodzielnie czyta ze zrozumieniem.']);
  assert.equal(data.items.find((item) => item.type === 'homework').date, '2026-10-05');
  assert.ok(data.items.filter((item) => item.type === 'lesson').every((item) => item.date === '2026-10-01' && item.weekday === 0));
  const message = data.items.find((item) => item.type === 'message');
  assert.ok(message.note.includes(LONG_BODY.trim()));
  assert.ok(message.note.length > 2000);
  assert.doesNotMatch(message.note, /tracker|<script/);
  assert.equal(message.read, false);
  assert.deepEqual(data.reconcileScopes, [{ type: 'grade', scopeId: 'grades:current-period' },
    { type: 'lesson', scopeId: 'timetable', dateFrom: '2026-09-24', dateTo: '2026-10-22' }]);
  const planRequest = requests.find((request) => request.path.endsWith('/PlanZajec'));
  assert.equal(planRequest.query.get('zakresDanych'), '2');
  assert.equal(planRequest.query.get('dataOd'), '2026-09-23T22:00:00.000Z');
  assert.equal(planRequest.query.get('dataDo'), '2026-10-22T21:59:59.999Z');
  const dataCalls = requests.filter((request) => request.path.includes('/api/'));
  assert.ok(dataCalls.every((request) => request.method === 'GET'));
  assert.ok(requests.every((request) => !request.query.toString().includes(PRESCHOOL_KEY)));
  assert.equal(requests.filter((request) => request.method === 'PUT' || request.method === 'DELETE').length, 0);
  assert.equal(requests.filter((request) => request.body.includes(PASSWORD)).length, 1);
  assert.equal(requests.find((request) => request.body.includes(PASSWORD)).host, 'eduvulcan.pl');
  assert.equal(JSON.stringify(data).includes(PASSWORD), false);
});

test('a failed timetable or malformed grade section warns and cannot reconcile a previously good snapshot', async () => {
  const { data } = await connectAndRead({ override: (url) => {
    if (url.pathname.endsWith('/PlanZajec')) return html('upstream failed', { status: 500 });
    if (url.pathname.endsWith('/Oceny')) return json({ unknownShape: true });
  } });
  assert.equal(data.items.filter((item) => ['lesson', 'grade'].includes(item.type)).length, 0);
  assert.equal(data.items.filter((item) => item.type === 'message').length, 1);
  assert.deepEqual(data.reconcileScopes, []);
  assert.ok(data.warnings.some((warning) => warning.startsWith('Plan lekcji:')));
  assert.ok(data.warnings.some((warning) => warning.startsWith('Oceny:')));
});

test('one failed detail is skipped rather than overwriting cached homework/message with an empty body', async () => {
  const { data } = await connectAndRead({ override: (url) => {
    if (url.pathname.endsWith('/ZadanieDomoweSzczegoly') || url.pathname.endsWith('/WiadomoscSzczegoly')) return html('upstream failed', { status: 500 });
  } });
  assert.equal(data.items.some((item) => item.externalId === 'agenda-4:31'), false);
  assert.equal(data.items.some((item) => item.externalId === 'message:school-mail-51'), false);
  assert.equal(data.counts.homework, 0);
  assert.equal(data.counts.messages, 0);
  assert.equal(data.counts.tests, 1);
  assert.ok(data.warnings.some((warning) => warning.startsWith('Zadania i sprawdziany:')));
  assert.ok(data.warnings.some((warning) => warning.startsWith('Treść wiadomości:')));
  assert.ok(data.reconcileScopes.every((scope) => ['grade', 'lesson'].includes(scope.type)));
});

test('missing message body field fails that detail, while an explicit empty attachment-only body is accepted', async () => {
  const missing = await connectAndRead({ override: (url) => url.pathname.endsWith('/WiadomoscSzczegoly') ? json({ apiGlobalKey: 'school-mail-51', zalaczniki: [] }) : undefined });
  assert.equal(missing.data.counts.messages, 0);
  assert.ok(missing.data.warnings.some((warning) => /wiadomości/i.test(warning)));
  const attachments = await connectAndRead({ override: (url) => url.pathname.endsWith('/WiadomoscSzczegoly')
    ? json({ apiGlobalKey: 'school-mail-51', tresc: '', zalaczniki: [{ nazwaPliku: 'Plan.pdf' }] }) : undefined });
  assert.equal(attachments.data.counts.messages, 1);
  assert.match(attachments.data.items.find((item) => item.type === 'message').note, /Załączniki/);
});

test('authorized mailbox discovery must match the chosen Context key before reading any inbox', async () => {
  const { data, requests } = await connectAndRead({ override: (url) => url.pathname.endsWith('/Skrzynki')
    ? json([{ globalKey: 'mailbox-preschool', nazwa: 'Przedszkole', typUzytkownika: 2 }]) : undefined });
  assert.equal(data.counts.messages, 0);
  assert.ok(data.warnings.some((warning) => warning.startsWith('Wiadomości:')));
  assert.equal(requests.some((request) => request.path.endsWith('/OdebraneSkrzynka')), false);
  assert.equal(requests.some((request) => request.path.endsWith('/WiadomoscSzczegoly')), false);
});

test('expired HTML API responses abort the operation and do not return a successful empty sync', async () => {
  await assert.rejects(connectAndRead({ override: (url) => url.pathname.endsWith('/Context') ? html(loginPage()) : undefined }),
    (error) => error.code === 'EDU_SESSION_EXPIRED' && error.status === 401);
  await assert.rejects(connectAndRead({ override: (url) => url.pathname.endsWith('/PlanZajec') ? redirect('/logowanie') : undefined }),
    (error) => error.code === 'EDU_SESSION_EXPIRED');
});

test('all failed schemas reject the sync instead of presenting empty sections', async () => {
  await assert.rejects(connectAndRead({ override: (url) => ['/Oceny', '/PlanZajec', '/SprawdzianyZadaniaDomowe', '/Skrzynki']
    .some((suffix) => url.pathname.endsWith(suffix)) ? json({ incompatible: true }) : undefined }),
  (error) => error.code === 'EDU_SYNC_FAILED');
});

test('host allowlist rejects credential form actions and malicious redirects before any external request', async () => {
  for (const mode of ['form', 'redirect']) {
    const { provider, requests } = recordedPortal({ override: (url, request) => {
      if (mode === 'form' && url.pathname === '/logowanie' && request.method === 'GET') return html(loginPage({ action: 'https://attacker.invalid/logowanie' }));
      if (mode === 'redirect' && url.pathname === '/logowanie' && request.method === 'POST') return redirect('https://attacker.invalid/collect');
    } });
    await assert.rejects(provider.connectProvider({ login: LOGIN, password: PASSWORD }), (error) => error.code === 'EDU_SCHEMA_CHANGED');
    assert.ok(requests.every((request) => request.host === 'eduvulcan.pl'));
    assert.equal(requests.some((request) => request.host === 'attacker.invalid'), false);
  }
});

test('307/308 cross-origin redirects cannot forward credentials even to another allowed VULCAN host', async () => {
  for (const status of [307, 308]) {
    const { provider, requests } = recordedPortal({ override: (url, request) => url.pathname === '/logowanie' && request.method === 'POST'
      ? redirect('https://uczen.eduvulcan.pl/collect', { status }) : undefined });
    await assert.rejects(provider.connectProvider({ login: LOGIN, password: PASSWORD }), (error) => error.code === 'EDU_SCHEMA_CHANGED');
    assert.equal(requests.some((request) => request.host === 'uczen.eduvulcan.pl'), false);
  }
});

test('preschool and ambiguous Contexts fail before any grades, plan or mailbox reads', async () => {
  for (const variant of ['preschool', 'wrong-key']) {
    const fixture = recordedPortal({ override: (url) => {
      if (!url.pathname.endsWith('/Context')) return undefined;
      const changed = context();
      if (variant === 'preschool') changed.uczniowie[2].isPrzedszkolak = true;
      else changed.uczniowie[2].key = 'another-context-key';
      return json(changed);
    } });
    const connected = await fixture.provider.connectProvider({ login: LOGIN, password: PASSWORD });
    await assert.rejects(fixture.provider.readProviderData(connected.session, connected.profiles[2].id),
      (error) => error.code === (variant === 'preschool' ? 'EDU_INVALID_STUDENT' : 'EDU_PROFILE_AMBIGUOUS'));
    assert.equal(fixture.requests.some((request) => /(?:Oceny|PlanZajec|OdebraneSkrzynka|Skrzynki)$/.test(request.path)), false);
  }
});

test('profile identity remains stable when portal tracking and SSO nonce change', () => {
  const first = extractPortalProfiles(accessPanel('first'), 'https://eduvulcan.pl/dostep-do-dziennika/');
  const second = extractPortalProfiles(accessPanel('different').replaceAll('nonce=different', 'nonce=different&amp;tracking=changed'), 'https://eduvulcan.pl/');
  assert.deepEqual(first.map((profile) => profile.id), second.map((profile) => profile.id));
  assert.notDeepEqual(first.map((profile) => profile.journalUrl), second.map((profile) => profile.journalUrl));
  const displayOnly = (nonce) => `<a class="panel-access__profile" href="/dziennik?nonce=${nonce}"><span class="panel-access__profile-name">Nikodem Kowalski (SP4)</span></a>`;
  assert.equal(extractPortalProfiles(displayOnly('a'))[0].id, extractPortalProfiles(displayOnly('b'))[0].id);
});

test('URL validation rejects lookalike hosts, userinfo, HTTP and unusual ports', () => {
  for (const url of ['http://eduvulcan.pl/logowanie', 'https://eduvulcan.pl.attacker.invalid/', 'https://attacker.invalid/?next=eduvulcan.pl',
    'https://eduvulcan.pl:444/logowanie', 'https://login:password@eduvulcan.pl/logowanie', 'javascript:alert(1)']) assert.throws(() => validateEduUrl(url));
  assert.equal(validateEduUrl('/Account/QueryUserInfo').href, 'https://eduvulcan.pl/Account/QueryUserInfo');
  assert.throws(() => chooseContextStudent(context(), ''), (error) => error.code === 'EDU_PROFILE_AMBIGUOUS');
  assert.equal(chooseContextStudent(context(), SCHOOL_KEY).key, SCHOOL_KEY);
});

test('bounded login proof verifies independent chained hashes and declines unsupported challenges', async () => {
  const challenge = 'SyntheticChallenge123'; const difficulty = 0xffffffff;
  const answer = await computeLoginProof({ challenge, difficulty, rounds: 2 }, { clock: () => NOW });
  const solutions = answer.split(';').map(Number);
  assert.equal(solutions.length, 2);
  for (let index = 0; index < solutions.length; index += 1) {
    assert.ok(Number.isInteger(solutions[index]) && solutions[index] > 0);
    const digest = createHash('sha256').update(Buffer.from(challenge + solutions.slice(0, index).join('') + solutions[index], 'latin1')).digest();
    assert.ok(digest.readUInt32BE(0) < difficulty);
  }
  await assert.rejects(computeLoginProof({ challenge, difficulty: 1, rounds: 2 }), (error) => error.code === 'EDU_INTERACTIVE_LOGIN_REQUIRED');
  await assert.rejects(computeLoginProof({ challenge, difficulty, rounds: 1 }, { clock: () => NOW, deadline: NOW - 1 }), (error) => error.code === 'EDU_INTERACTIVE_LOGIN_REQUIRED');
});

test('ShowCaptcha requirement without the published widget asks for interactive login without posting a password', async () => {
  const { provider, requests } = recordedPortal({ showCaptcha: true });
  await assert.rejects(provider.connectProvider({ login: LOGIN, password: PASSWORD }), (error) => error.code === 'EDU_INTERACTIVE_LOGIN_REQUIRED');
  assert.equal(requests.some((request) => request.body.includes(PASSWORD)), false);
});
