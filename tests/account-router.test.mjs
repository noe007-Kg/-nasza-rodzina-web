import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createAccountRouter } from '../server/account-router.mjs';
import accountApi from '../api/account/[action].mjs';

function response() {
  return {
    headers: {}, statusCode: 0,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.result = JSON.parse(value); },
  };
}

function request(url, extra = {}) {
  return {
    url, method: 'POST',
    headers: {
      origin: 'https://rodzina.example', host: 'rodzina.example',
      'content-type': 'application/json', authorization: 'Bearer header.payload.signature',
    },
    body: { action: 'synthetic-action' },
    ...extra,
  };
}

function router({ role = 'parent', active = true, archived = false } = {}) {
  const calls = [];
  const firebase = {
    auth: { verifyIdToken: async (token, revoked) => {
      calls.push(['verify', token, revoked]);
      return { uid: 'existing-uid' };
    } },
    db: { collection: name => ({ doc: uid => ({ get: async () => {
      calls.push(['member', name, uid]);
      return { exists: true, data: () => ({ role, active, archived, canLogin: true }) };
    } }) }) },
  };
  const handler = createAccountRouter({
    services: () => { calls.push(['services']); return firebase; },
    memberAction: async (context, body) => {
      calls.push(['members', context.uid, body.action]);
      return { operation: 'members', uid: context.uid };
    },
    profileAction: async (context, body) => {
      calls.push(['profile', context.uid, body.action]);
      return { operation: 'profile', uid: context.uid };
    },
    googleAction: async (body, context) => {
      assert.equal(context, firebase);
      calls.push(['google-login', body.credential]);
      return { operation: 'google-login', token: 'synthetic-response-token' };
    },
  });
  return { handler, calls };
}

test('members retains the parent guard while profile admits active adults and children with their existing UID', async () => {
  for (const role of ['parent', 'adult', 'child']) {
    for (const action of ['members', 'profile']) {
      const { handler, calls } = router({ role });
      const output = response();
      await handler(request(`/api/account/${action}`, { query: { action } }), output);
      const allowed = action === 'profile' || role === 'parent';
      assert.equal(output.statusCode, allowed ? 200 : 403, `${action}: ${role}`);
      assert.deepEqual(calls.filter(([kind]) => kind === 'verify'), [['verify', 'header.payload.signature', true]]);
      assert.deepEqual(calls.filter(([kind]) => kind === action), allowed ? [[action, 'existing-uid', 'synthetic-action']] : []);
      if (allowed) assert.equal(output.result.uid, 'existing-uid');
    }
  }
});

test('inactive or archived members cannot use either authenticated operation', async () => {
  for (const flags of [{ active: false }, { archived: true }]) {
    for (const action of ['members', 'profile']) {
      const { handler, calls } = router(flags);
      const output = response();
      await handler(request(`/api/account/${action}`), output);
      assert.equal(output.statusCode, 403);
      assert.equal(calls.some(([kind]) => ['members', 'profile', 'google-login'].includes(kind)), false);
    }
  }
});

test('Google remains public and keeps the existing body-first action adapter without checking a Firebase ID token', async () => {
  const { handler, calls } = router({ role: 'child' });
  const input = request('/api/account/google-login', {
    query: { action: 'google-login' },
    headers: { origin: 'https://rodzina.example', host: 'rodzina.example', 'content-type': 'application/json' },
    body: { credential: 'synthetic-google-credential' },
  });
  const output = response();
  await handler(input, output);
  assert.equal(output.statusCode, 200);
  assert.deepEqual(calls, [['services'], ['google-login', 'synthetic-google-credential']]);
  assert.equal(input.body, undefined);
});

test('query.action cannot make the members pathname public, even if framework parameters claim google-login', async () => {
  for (const [url, query] of [
    ['/api/account/members?action=google-login', undefined],
    ['/api/account/members', { action: 'google-login' }],
    ['/api/account/members?action=members', { action: 'google-login' }],
    ['/api/account/members?%61ction=google-login', { action: 'members' }],
    ['/api/account/profile?action=google-login', undefined],
    ['/api/account/google-login?action=members', undefined],
  ]) {
    const { handler, calls } = router({ role: 'child' });
    const output = response();
    await handler(request(url, { query }), output);
    assert.equal(output.statusCode, 404, url);
    assert.deepEqual(calls, []);
  }
});

test('an action in request body or an unrelated query cannot alter the members authorization guard', async () => {
  const { handler, calls } = router({ role: 'child' });
  const output = response();
  await handler(request('/api/account/members?next=google-login', { body: { action: 'google-login', credential: 'synthetic' } }), output);
  assert.equal(output.statusCode, 403);
  assert.equal(calls.some(([kind]) => ['members', 'profile', 'google-login'].includes(kind)), false);
});

test('matching route parameters are accepted, while repeated, empty, array or non-string action parameters fail closed', async () => {
  for (const action of ['members', 'profile', 'google-login']) {
    const { handler } = router();
    const output = response();
    await handler(request(`/api/account/${action}?action=${action}&view=compact`, { query: { action } }), output);
    assert.equal(output.statusCode, 200);
  }
  for (const [url, query] of [
    ['/api/account/members?action=members&action=members', undefined],
    ['/api/account/members?action=', undefined],
    ['/api/account/members', { action: ['members'] }],
    ['/api/account/members', { action: undefined }],
    ['/api/account/members', { action: { toString: () => 'members' } }],
  ]) {
    const { handler, calls } = router();
    const output = response();
    await handler(request(url, { query }), output);
    assert.equal(output.statusCode, 404);
    assert.deepEqual(calls, []);
  }
});

test('unknown, encoded, normalized and malformed pathnames never choose a handler or initialize Firebase', async () => {
  const paths = [
    '/api/account/unknown', '/api/account', '/api/account/members/',
    '/api/account/MEMBERS', '/api/account/%6dembers', '/api/account/members%3F',
    '/api/account/members/../google-login', '/api/account/./google-login',
    '/api/account//google-login', '/api/account/%2e%2e/google-login',
    '/api/account/members%2f..%2fgoogle-login', '/api/account/members#google-login',
    '/api/account/members?target=#google-login', '/api/account/members\\..\\google-login',
    'https://rodzina.example/api/account/google-login', '//rodzina.example/api/account/google-login',
    '/api/account/members\u0000', '/api/account/members\n', '/api/account/members ',
    '', undefined, null, ['members'],
  ];
  for (const url of paths) {
    const { handler, calls } = router();
    const output = response();
    await handler(request(url, { query: { action: 'google-login' } }), output);
    assert.equal(output.statusCode, 404, String(url));
    assert.deepEqual(calls, []);
    assert.equal(output.headers['Cache-Control'], 'no-store, private, max-age=0');
    assert.equal(output.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(output.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(output.headers['Referrer-Policy'], 'no-referrer');
  }
});

test('routing ignores spoofed path headers and retains the guard of the actual URL', async () => {
  const { handler, calls } = router({ role: 'child' });
  const input = request('/api/account/members');
  input.headers['x-matched-path'] = '/api/account/google-login';
  input.headers['x-original-url'] = '/api/account/google-login';
  const output = response();
  await handler(input, output);
  assert.equal(output.statusCode, 403);
  assert.equal(calls.some(([kind]) => kind === 'google-login'), false);
});

test('all three public URLs retain POST-only and same-origin protections before service initialization', async () => {
  for (const action of ['members', 'profile', 'google-login']) {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const { handler, calls } = router();
      const output = response();
      await handler(request(`/api/account/${action}`, { method }), output);
      assert.equal(output.statusCode, 405);
      assert.equal(output.headers.Allow, 'POST');
      assert.deepEqual(calls, []);
    }
    const { handler, calls } = router();
    const input = request(`/api/account/${action}`);
    input.headers.origin = 'https://intruder.example';
    const output = response();
    await handler(input, output);
    assert.equal(output.statusCode, 403);
    assert.deepEqual(calls, []);
  }
});

test('missing or malformed ID tokens remain rejected for members and profile, even on valid dynamic routes', async () => {
  for (const action of ['members', 'profile']) {
    for (const authorization of [undefined, 'Bearer invalid']) {
      const { handler, calls } = router();
      const input = request(`/api/account/${action}`, { query: { action } });
      input.headers.authorization = authorization;
      const output = response();
      await handler(input, output);
      assert.equal(output.statusCode, 401);
      assert.deepEqual(calls, [['services']]);
    }
  }
});

test('404 responses clear object and buffer credentials without reflecting secrets or the requested path', async () => {
  const { handler, calls } = router();
  const savedBody = { credential: 'synthetic-secret', token: 'synthetic-token', password: 'synthetic-password', action: 'ignored' };
  const input = request('/api/account/unknown?secret=synthetic-query-secret', { body: savedBody });
  const output = response();
  await handler(input, output);
  assert.equal(output.statusCode, 404);
  assert.deepEqual(savedBody, { action: 'ignored' });
  assert.equal(input.body, undefined);
  assert.doesNotMatch(JSON.stringify(output.result), /synthetic|unknown\?secret/);
  const buffer = Buffer.from('synthetic-secret-buffer');
  const bufferInput = request('/api/account/unknown', { body: buffer });
  await handler(bufferInput, response());
  assert.equal(buffer.every(value => value === 0), true);
  assert.equal(bufferInput.body, undefined);
  assert.deepEqual(calls, []);
});

test('the production dynamic API delegates the unchanged public paths and only one account entry point is bundled', async () => {
  for (const action of ['members', 'profile', 'google-login']) {
    const output = response();
    await accountApi(request(`/api/account/${action}`, { method: 'GET', query: { action } }), output);
    assert.equal(output.statusCode, 405);
    assert.equal(output.headers.Allow, 'POST');
  }
  const files = await readdir(new URL('../api/account/', import.meta.url));
  assert.deepEqual(files.filter(file => file.endsWith('.mjs')), ['[action].mjs']);
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.functions['api/account/*.mjs'].maxDuration, 30);
  assert.equal(config.functions['api/account/*.mjs'].includeFiles, 'server/**');
});
