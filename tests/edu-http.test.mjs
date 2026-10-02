import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createEduHandler, expectFields, readJsonBody } from '../server/edu-http.mjs';
import { EduServerError } from '../server/edu-auth.mjs';

function response() {
  return { headers: {}, statusCode: 0, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } };
}

test('all handler actions require authentication; forbidden parent cannot reach provider', async () => {
  let invoked = false;
  const handler = createEduHandler('POST', () => { invoked = true; }, { authenticate: async () => { throw new EduServerError('EDU_PARENT_REQUIRED', 403, 'Tylko rodzic.'); } });
  const res = response();
  await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { login: 'synthetic@example.invalid', password: 'ephemeral-test-value' } }, res);
  assert.equal(invoked, false); assert.equal(res.statusCode, 403);
  assert.equal(res.headers['Cache-Control'], 'no-store, private, max-age=0');
  assert.equal(res.body.error.code, 'EDU_PARENT_REQUIRED');
});

test('errors exclude upstream cookies, passwords and stack traces; framework credentials cleared', async () => {
  const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: { login: 'synthetic@example.invalid', password: 'ephemeral-test-value' } };
  const handler = createEduHandler('POST', () => { throw new Error('upstream cookie=private-token ephemeral-test-value'); }, { authenticate: async () => ({ uid: 'parent-test' }) });
  const res = response(); await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /cookie|private-token|ephemeral-test-value|stack/);
  assert.equal(req.body, undefined);
});

test('raw framework credential buffers are zeroed after rejected requests', async () => {
  const buffer = Buffer.from('{"login":"synthetic@example.invalid","password":"ephemeral-secret"}');
  const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: buffer };
  const handler = createEduHandler('POST', () => {}, { authenticate: async () => { throw new EduServerError('EDU_PARENT_REQUIRED', 403, 'Tylko rodzic.'); } });
  await handler(req, response());
  assert.equal(req.body, undefined);
  assert.equal(buffer.every((byte) => byte === 0), true);
});

test('unsupported methods cannot trigger login and expose only an Allow header', async () => {
  let authenticated = false;
  const handler = createEduHandler('POST', () => {}, { authenticate: async () => { authenticated = true; } });
  const res = response(); await handler({ method: 'GET' }, res);
  assert.equal(authenticated, false); assert.equal(res.statusCode, 405); assert.equal(res.headers.Allow, 'POST');
});

test('body accepts JSON only, rejects oversized streams and arrays', async () => {
  await assert.rejects(readJsonBody({ headers: { 'content-type': 'text/plain' }, body: '{}' }), (e) => e.status === 415);
  await assert.rejects(readJsonBody({ headers: { 'content-type': 'application/json' }, body: [] }), (e) => e.status === 400);
  const req = Readable.from([Buffer.alloc(20 * 1024, 'a')]); req.headers = { 'content-type': 'application/json' };
  await assert.rejects(readJsonBody(req), (e) => e.status === 413);
  await assert.rejects(readJsonBody({ headers: { 'content-type': 'application/json' }, body: '{wrong' }), (e) => e.status === 400);
});

test('API does not accept arbitrary upstream URLs or extra credential retention fields', () => {
  assert.throws(() => expectFields({ login: 'x', password: 'y', url: 'https://example.invalid/' }, ['login', 'password']), (e) => e.code === 'EDU_INVALID_REQUEST');
  assert.throws(() => expectFields({ savePassword: true }, []), (e) => e.code === 'EDU_INVALID_REQUEST');
});
