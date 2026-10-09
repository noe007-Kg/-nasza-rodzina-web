import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarServerError } from '../server/calendar-errors.mjs';
import { createCalendarHandler } from '../server/calendar-http.mjs';
import { calendarTestEnvironment } from './calendar-test-helpers.mjs';

function response() { const headers = new Map(); return { headers, statusCode: 0, setHeader: (name, value) => headers.set(name, value), end(value) { this.body = value; } }; }
const request = (action = 'status', extra = {}) => ({ method: 'POST', url: `/api/calendars/${action}`, query: { action }, headers: { origin: 'https://family.example.test', 'content-type': 'application/json' }, body: {}, ...extra });
const deps = { services: () => ({ db: 'in-memory' }), authenticate: async () => ({ uid: 'actor' }) };

test('grouped calendar router calls authenticated action and excludes the HttpOnly cookie from JSON', async () => {
  const restore = calendarTestEnvironment();
  try {
    let actor, third;
    const handler = createCalendarHandler({ start: async (context, body, cookie) => { actor = context.uid; third = cookie; return { authorizationUrl: 'https://accounts.google.com/test', cookie: 'test-cookie' }; } }, deps);
    const req = request('start'), res = response(); await handler(req, res);
    assert.equal(actor, 'actor'); assert.equal(third, undefined); assert.equal(res.statusCode, 200);
    assert.equal(res.headers.get('Set-Cookie'), 'test-cookie'); assert.equal(Object.hasOwn(JSON.parse(res.body), 'cookie'), false);
    assert.equal(req.body, undefined); assert.match(res.headers.get('Cache-Control'), /no-store/);
  } finally { restore(); }
});
test('foreign browser origin is rejected before Firebase authentication', async () => {
  const restore = calendarTestEnvironment();
  try {
    let calls = 0;
    const handler = createCalendarHandler({ status: async () => ({ configured: true }) }, { ...deps, authenticate: async () => { calls++; return { uid: 'actor' }; } });
    const req = request('status', { headers: { origin: 'https://attacker.example.test', 'content-type': 'application/json' } }), res = response(); await handler(req, res);
    assert.equal(res.statusCode, 403); assert.equal(JSON.parse(res.body).error.code, 'CALENDAR_FORBIDDEN_ORIGIN'); assert.equal(calls, 0);
  } finally { restore(); }
});
test('status works without optional calendar environment and never requires VAPID', async () => {
  const restore = calendarTestEnvironment();
  try {
    delete process.env.CALENDAR_SITE_ORIGIN; delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const handler = createCalendarHandler({ status: async () => ({ configured: false, connections: [] }) }, deps);
    const req = request('status', { headers: { 'content-type': 'application/json' } }), res = response(); await handler(req, res);
    assert.equal(res.statusCode, 200); assert.equal(JSON.parse(res.body).configured, false);
  } finally { restore(); }
});
test('callback relies on provider handshake, uses a canonical redirect and never serializes the code', async () => {
  const restore = calendarTestEnvironment();
  try {
    let authenticated = false, query;
    const handler = createCalendarHandler({}, { ...deps, authenticate: async () => { authenticated = true; }, complete: async (services, received) => { query = received; return { location: 'https://family.example.test/?calendarOAuth=opaque' }; } });
    const req = request('callback', { method: 'GET', url: '/api/calendars/callback?code=test-code-placeholder&state=opaque' }), res = response(); await handler(req, res);
    assert.equal(authenticated, false); assert.equal(query.code, 'test-code-placeholder'); assert.equal(res.statusCode, 303);
    assert.equal(res.headers.get('Location'), 'https://family.example.test/?calendarOAuth=opaque'); assert.equal(res.body, undefined);
  } finally { restore(); }
});
test('provider callback failure redirects only a safe error code and rejects duplicate fields', async () => {
  const restore = calendarTestEnvironment();
  try {
    const handler = createCalendarHandler({}, { ...deps, complete: async () => { throw new Error('sensitive upstream payload'); } });
    const req = request('callback', { method: 'GET', url: '/api/calendars/callback?state=one&state=two&code=hidden' }), res = response(); await handler(req, res);
    assert.equal(res.statusCode, 303); assert.equal(res.headers.get('Location'), 'https://family.example.test/?calendarOAuthError=CALENDAR_OAUTH_INVALID');
    assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/); assert.equal(res.body, undefined);
    const req2 = request('callback', { method: 'GET', url: '/api/calendars/callback?state=one&code=hidden' }), res2 = response(); await handler(req2, res2);
    assert.equal(res2.headers.get('Location'), 'https://family.example.test/?calendarOAuthError=CALENDAR_SERVER_ERROR');
  } finally { restore(); }
});
test('methods, unknown routes, ambiguous route arrays and oversized bodies are rejected', async () => {
  const restore = calendarTestEnvironment();
  try {
    const handler = createCalendarHandler({ status: async () => ({ configured: true }) }, deps);
    for (const [req, expected] of [[request('status', { method: 'GET' }), 405], [request('unknown'), 404], [request('status', { query: { action: ['status', 'sync'] } }), 404], [request('status', { body: JSON.stringify({ huge: 'x'.repeat(20000) }) }), 413], [request('status', { body: [] }), 400]]) {
      const res = response(); await handler(req, res); assert.equal(res.statusCode, expected);
    }
  } finally { restore(); }
});
test('unknown provider errors reveal neither tokens nor stacks; cooldown returns Retry-After', async () => {
  const restore = calendarTestEnvironment();
  try {
    const secretText = 'test-upstream-token-placeholder';
    const handler = createCalendarHandler({ status: async () => { throw new Error(secretText); }, sync: async () => { throw new CalendarServerError('CALENDAR_RATE_LIMITED', 429, 'Spróbuj za minutę.'); } }, deps);
    const res = response(); await handler(request(), res); assert.equal(res.statusCode, 500); assert.equal(res.body.includes(secretText), false); assert.equal(res.body.includes('stack'), false);
    const res2 = response(); await handler(request('sync'), res2); assert.equal(res2.statusCode, 429); assert.equal(res2.headers.get('Retry-After'), '60');
  } finally { restore(); }
});
test('finalize receives only the parsed browser nonce and clears it after success', async () => {
  const restore = calendarTestEnvironment();
  try {
    let received;
    const handler = createCalendarHandler({ finalize: async (context, body, cookie) => { received = cookie; return { connectionId: 'opaque' }; } }, deps);
    const req = request('finalize', { headers: { origin: 'https://family.example.test', 'content-type': 'application/json', cookie: `__Host-calendar-oauth=${'a'.repeat(43)}.${'b'.repeat(43)}` } }), res = response(); await handler(req, res);
    assert.deepEqual(received, { stateId: 'a'.repeat(43), nonce: 'b'.repeat(43) }); assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
  } finally { restore(); }
});

test('a conflicting action cannot select the public callback from a protected URL', async () => {
  const restore = calendarTestEnvironment();
  try {
    let calls = 0;
    const forbidden = () => { calls++; throw new Error('Invalid routes must be rejected before services'); };
    const handler = createCalendarHandler({ sync: forbidden, status: forbidden }, { services: forbidden, authenticate: forbidden, complete: forbidden });
    for (const req of [request('sync', { method: 'GET', query: { action: 'callback' } }), request('sync', { method: 'GET', url: '/api/calendars/sync?action=callback' }),
      request('status', { url: '/api/calendars/callback?action=status' }), request('callback', { method: 'GET', url: '/api/calendars/callback?action=callback&action=callback' })]) {
      const res = response(); await handler(req, res);
      assert.equal(res.statusCode, 404); assert.equal(res.headers.has('Location'), false);
      assert.equal(JSON.parse(res.body).error.code, 'CALENDAR_ACTION_NOT_FOUND');
    }
    assert.equal(calls, 0);
  } finally { restore(); }
});

test('encoded, non-canonical and missing paths cannot be normalized into a calendar action', async () => {
  const restore = calendarTestEnvironment();
  try {
    let calls = 0; const forbidden = () => { calls++; throw new Error('Invalid routes must be rejected before services'); };
    const handler = createCalendarHandler({ status: forbidden }, { services: forbidden, authenticate: forbidden, complete: forbidden });
    for (const url of ['/api/calendars/%73tatus', '/api/calendars/%2Fstatus', '/api/calendars/../calendars/status', '/api/calendars/status/',
      '//api/calendars/status', 'https://family.example.test/api/calendars/status', '/api/calendars/unknown', '/api/calendars/status#extra', '/api/calendars/status\\extra', undefined]) {
      const res = response(); await handler(request('status', { url }), res); assert.equal(res.statusCode, 404);
    }
    assert.equal(calls, 0);
  } finally { restore(); }
});

test('both Vercel dynamic route metadata and plain canonical HTTP paths retain the same authenticated guard', async () => {
  const restore = calendarTestEnvironment();
  try {
    let authentications = 0, actions = 0;
    const handler = createCalendarHandler({ status: async () => { actions++; return { configured: false }; } }, { ...deps, authenticate: async () => { authentications++; return { uid: 'actor' }; } });
    for (const req of [request('status'), request('status', { query: {} }), request('status', { url: '/api/calendars/status?action=status&keep=1' })]) {
      const res = response(); await handler(req, res); assert.equal(res.statusCode, 200);
    }
    assert.equal(authentications, 3); assert.equal(actions, 3);
  } finally { restore(); }
});
