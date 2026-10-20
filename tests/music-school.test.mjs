import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_SCHOOL_TEMPLATE, schoolInstant, occurrences } from '../server/music-school-model.mjs';
import { parsePublicCancellation, fetchPublicCancellations } from '../server/music-school-public.mjs';
import { manageMusicSchoolAction, runMusicSchoolHourly } from '../server/music-school-service.mjs';
import { familyMemoryContext, fixtureChild, fixtureParent } from './family-v2-test-helpers.mjs';
import { createFamilyRouter } from '../server/family-http.mjs';

const env = { MUSIC_SCHOOL_ENABLED: 'true' }, now = Date.parse('2026-10-20T06:00:05Z');
const noticeUrl = 'https://www.gov.pl/web/psmkolobrzeg/pani-agnieszka-sokolnicka';
const article = text => `<main><article id="main-content"><h2>Pani Agnieszka Sokolnicka</h2><div class="editor-content">${text}</div></article></main>`;
const html = article('W dniach 19 - 22 października 2026 r. zajęcia z Panią Agnieszką Sokolnicką są odwołane.');
const notices = parsePublicCancellation(html, noticeUrl).notices;
const fetchPublic = async () => ({ notices, review: false });
function fixture() { return familyMemoryContext({
  'members/child': { ...fixtureChild, schoolEnabled: true },
  'members/parent2': fixtureParent,
  'members/foreign': { ...fixtureParent, familyId: 'another-household' },
  'members/sibling': { ...fixtureChild, schoolEnabled: true },
}); }
const draft = { operation: 'save', ownerProfileId: 'child', revision: 0, validFrom: '2026-10-19', validUntil: '2027-06-30', lessons: MUSIC_SCHOOL_TEMPLATE, excludedDates: [] };
const act = (ctx, body, extra = {}) => manageMusicSchoolAction(ctx, body, { env, now, fetchPublic, clock: () => now, ...extra });
const state = ctx => act(ctx, { operation: 'state' });
async function saved() { const ctx = fixture(); await act(ctx, draft); return ctx; }

test('confirmed template has five independent lessons and exact screenshot times', () => {
  assert.equal(MUSIC_SCHOOL_TEMPLATE.length, 5);
  assert.deepEqual(MUSIC_SCHOOL_TEMPLATE.map(x => [x.weekday, x.time, x.endTime]), [[1,'16:40','17:25'],[1,'17:30','18:15'],[2,'15:00','15:30'],[3,'15:50','16:35'],[4,'13:15','13:45']]);
});
test('Warsaw conversion respects summer, winter and DST transitions', () => {
  assert.equal(schoolInstant('2026-10-20', '15:00'), '2026-10-20T13:00:00.000Z');
  assert.equal(schoolInstant('2026-10-27', '15:00'), '2026-10-27T14:00:00.000Z');
});
test('explicit current public notice gives exact teacher and bounded date range', () => {
  assert.equal(notices.length, 1); assert.equal(notices[0].from, '2026-10-19'); assert.equal(notices[0].until, '2026-10-22');
  assert.equal(notices[0].teacher, 'Agnieszka Sokolnicka');
});
test('absence, unknown wording, mismatched teacher, invalid dates never imply cancellation', () => {
  for (const text of ['Nauczyciel nieobecny.', 'Zajęcia odwołane.', 'W dniach 32 - 33 października 2026 r. zajęcia z Panią Agnieszką Sokolnicką są odwołane.',
    'W dniach 19 - 22 października 2026 r. zajęcia z Panią Inną Osobą są odwołane.']) {
    const result = parsePublicCancellation(article(text), noticeUrl); assert.equal(result.notices.length, 0); assert.equal(result.review, true);
  }
});
test('bounded public crawler does not follow external links or request Fryderyk', async () => {
  const urls = [];
  const result = await fetchPublicCancellations({ fetcher: async url => { urls.push(url); return new Response(url === noticeUrl ? html : `<main>Nieobecności<a href="/web/psmkolobrzeg/pani-agnieszka-sokolnicka">Komunikat</a><a href="https://evil.test/web/psmkolobrzeg/pani-x">x</a></main>`, { headers: { 'content-type': 'text/html' } }); } });
  assert.equal(urls.length, 2); assert.equal(result.notices.length, 1);
});
test('public crawler rejects redirects, oversized pages and failures', async () => {
  for (const response of [new Response('', { status: 403 }), new Response('', { status: 302 }), new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'text/html' } })]) {
    await assert.rejects(fetchPublicCancellations({ fetcher: async () => response }));
  }
});
test('save binds real owner UID, same-family parents share it, child only sees own plan', async () => {
  const ctx = await saved(), p = (await state(ctx)).plans[0];
  assert.equal(p.ownerProfileId, 'child'); assert.equal((await state(ctx.as('parent2'))).plans.length, 1);
  assert.equal((await state(ctx.as('child'))).plans.length, 1);
  assert.equal((await state(ctx.as('sibling'))).plans.length, 0);
  assert.equal((await state(ctx.as('foreign'))).plans.length, 0);
});
test('foreign household, sibling and child cannot write or trigger checks', async () => {
  const ctx = await saved();
  for (const uid of ['foreign', 'child', 'sibling']) {
    await assert.rejects(act(ctx.as(uid), { ...draft, revision: 1 }));
    await assert.rejects(act(ctx.as(uid), { operation: 'check', ownerProfileId: 'child' }));
  }
  assert.equal((await state(ctx)).plans[0].revision, 1);
});
test('missing or legacy family fails closed without writes', async () => {
  for (const familyId of [undefined, '__legacy__', 'legacy']) {
    const ctx = fixture(); ctx.rows.set('members/parent', { ...fixtureParent, familyId });
    await assert.rejects(act(ctx, draft)); await assert.rejects(state(ctx)); assert.equal(ctx.calls.length, 0);
  }
});
test('Preview and disabled configuration do not enable writes', async () => {
  for (const e of [{}, { MUSIC_SCHOOL_ENABLED: 'true', VERCEL_ENV: 'preview' }]) {
    const ctx = fixture(); await assert.rejects(act(ctx, draft, { env: e })); assert.equal(ctx.calls.length, 0);
  }
});
test('repeat import never duplicates or overwrites an existing plan', async () => {
  const ctx = await saved(); await assert.rejects(act(ctx, draft), { code: 'MUSIC_CONFLICT' });
  assert.equal((await state(ctx)).plans.length, 1);
});
test('calendar occurrences are bounded, excluded days absent, lessons never merged', async () => {
  const ctx = fixture(); await act(ctx, { ...draft, excludedDates: ['2026-10-20'] });
  const p = (await state(ctx)).plans[0];
  assert.equal(p.occurrences.filter(x => x.date === '2026-10-19').length, 2);
  assert.equal(p.occurrences.some(x => x.date === '2026-10-20'), false);
  assert.ok(p.occurrences.every(x => x.date <= '2027-06-30'));
});
test('notice cancels only matching teacher and dates; repeat checks create no duplicates', async () => {
  const ctx = await saved(); await act(ctx, { operation: 'check', ownerProfileId: 'child' });
  const before = (await state(ctx)).plans[0].occurrences;
  assert.equal(before.filter(x => x.cancelled).length, 3);
  assert.equal(before.find(x => x.date === '2026-10-20').cancelled, false);
  await act(ctx, { operation: 'check', ownerProfileId: 'child' }, { now: now + 3600_000 });
  assert.deepEqual((await state(ctx)).plans[0].occurrences, before);
});
test('failed fetch and disappeared notice preserve cancellations and last success', async () => {
  const ctx = await saved(); await act(ctx, { operation: 'check', ownerProfileId: 'child' });
  await act(ctx, { operation: 'check', ownerProfileId: 'child' }, { now: now + 3600_000, fetchPublic: async () => { throw new Error('network'); } });
  let p = (await state(ctx)).plans[0]; assert.equal(p.check.status, 'unavailable'); assert.equal(p.check.successAt, now);
  assert.equal(p.occurrences.filter(x => x.cancelled).length, 3);
  await act(ctx, { operation: 'check', ownerProfileId: 'child' }, { now: now + 7200_000, fetchPublic: async () => ({ notices: [], review: false }) });
  p = (await state(ctx)).plans[0]; assert.equal(p.occurrences.filter(x => x.cancelled).length, 3);
});
test('manual moved/cancelled override survives public checks with stable occurrence ID', async () => {
  const ctx = await saved(), original = (await state(ctx)).plans[0].occurrences[0];
  await act(ctx, { operation: 'override', ownerProfileId: 'child', revision: 1, occurrenceId: original.id,
    override: { date: '2026-10-23', time: '12:00', endTime: '12:45', cancelled: false, note: 'Potwierdzone przez rodzica' } });
  await act(ctx, { operation: 'check', ownerProfileId: 'child' });
  const moved = (await state(ctx)).plans[0].occurrences.find(x => x.id === original.id);
  assert.equal(moved.date, '2026-10-23'); assert.equal(moved.moved, true); assert.equal(moved.cancelled, false);
});
test('hourly job checks lesson days only within 08–18 Warsaw, including winter time', async () => {
  const ctx = await saved(); let calls = 0;
  const run = async iso => runMusicSchoolHourly(ctx, { env, clock: () => Date.parse(iso) + 5000, now: Date.parse(iso) + 5000, scheduleTime: iso, fetchPublic: async () => { calls++; return { notices: [], review: false }; } });
  await run('2026-10-20T05:00:00Z'); assert.equal(calls, 0); // 07:00
  await run('2026-10-20T06:00:00Z'); assert.equal(calls, 1); // 08:00
  await run('2026-10-20T16:00:00Z'); assert.equal(calls, 2); // 18:00
  await run('2026-10-20T17:00:00Z'); assert.equal(calls, 2); // 19:00
  await run('2026-10-23T06:00:00Z'); assert.equal(calls, 2); // Friday, no lessons
  await run('2026-10-27T07:00:00Z'); assert.equal(calls, 3); // winter 08:00
});
test('same scheduler slot runs once despite delivery jitter; next slot still runs', async () => {
  const ctx = await saved(); let calls = 0;
  const run = (iso, delay) => runMusicSchoolHourly(ctx, { env, clock: () => Date.parse(iso) + 5000, now: Date.parse(iso) + delay, scheduleTime: iso, fetchPublic: async () => { calls++; return { notices: [], review: false }; } });
  await run('2026-10-20T06:00:00Z', 15000); await run('2026-10-20T06:00:00Z', 20000);
  await run('2026-10-20T07:00:00Z', 1000); assert.equal(calls, 2);
});
test('manual check and scheduler share lease, and concurrent edits cannot clobber it', async () => {
  const ctx = await saved(); let release, started;
  const ready = new Promise(r => started = r), gate = new Promise(r => release = r); let calls = 0;
  const pending = act(ctx, { operation: 'check', ownerProfileId: 'child' }, { fetchPublic: async () => { calls++; started(); await gate; return { notices: [], review: false }; } });
  await ready;
  await runMusicSchoolHourly(ctx, { env, clock: () => now, now, scheduleTime: '2026-10-20T06:00:00Z', fetchPublic: async () => { calls++; return { notices: [], review: false }; } });
  await assert.rejects(act(ctx, { ...draft, revision: 1 }), { code: 'MUSIC_BUSY' });
  release(); await pending; assert.equal(calls, 1);
});
test('archive/reassign profile stops public checking and removes it from API views', async () => {
  const ctx = await saved(); ctx.rows.set('members/child', { ...fixtureChild, schoolEnabled: true, familyId: 'another-household' });
  let calls = 0;
  await runMusicSchoolHourly(ctx, { env, clock: () => now, now, scheduleTime: '2026-10-20T06:00:00Z', fetchPublic: async () => { calls++; return { notices: [], review: false }; } });
  assert.equal(calls, 0); assert.equal((await state(ctx)).plans.length, 0);
});
test('invalid dates and malformed lesson times rejected without writes', async () => {
  for (const body of [{ ...draft, validFrom: '2026-02-30' }, { ...draft, lessons: [{ ...MUSIC_SCHOOL_TEMPLATE[0], time: '18:00', endTime: '17:00' }] }]) {
    const ctx = fixture(); await assert.rejects(act(ctx, body)); assert.equal(ctx.calls.length, 0);
  }
});

test('expired lease cannot commit a late public response', async () => {
  const ctx = await saved();
  await act(ctx, { operation: 'check', ownerProfileId: 'child' }, { clock: () => now + 91_000 });
  assert.equal((await state(ctx)).plans[0].occurrences.some(x => x.cancelled), false);
});
test('new API has an independent gate and never enables legacy module writes', async () => {
  const ctx = fixture(); let musicCalls = 0, taskCalls = 0;
  const handler = createFamilyRouter({ env: { ...env, FAMILY_V2_WRITES_ENABLED: 'false' }, services: () => ({}),
    memberGuard: async () => ctx, musicAction: async () => { musicCalls++; return {}; }, tasksAction: async () => { taskCalls++; return {}; } });
  const request = domain => ({ method: 'POST', url: `/api/family/${domain}`, headers: { 'content-type': 'application/json' }, body: { operation: 'save' } });
  const response = () => ({ setHeader() {}, end(body) { this.body = JSON.parse(body); } });
  const music = response(); await handler(request('music-school'), music); assert.equal(music.statusCode, 200);
  const task = response(); await handler(request('tasks'), task); assert.equal(task.statusCode, 503);
  assert.equal(musicCalls, 1); assert.equal(taskCalls, 0);
});
test('manual correction changes do not affect SP4 or existing calendar documents', async () => {
  const ctx = fixture(); ctx.rows.set('schoolItems/existing-sp4', { person: 'other', title: 'SP4' });
  ctx.rows.set('calendarEvents/existing', { title: 'Existing private event', private: true });
  await act(ctx, draft); await act(ctx, { operation: 'check', ownerProfileId: 'child' });
  assert.ok(ctx.calls.every(x => x.path.startsWith('musicSchoolPlans/')));
  assert.deepEqual(ctx.rows.get('schoolItems/existing-sp4'), { person: 'other', title: 'SP4' });
  assert.deepEqual(ctx.rows.get('calendarEvents/existing'), { title: 'Existing private event', private: true });
});
