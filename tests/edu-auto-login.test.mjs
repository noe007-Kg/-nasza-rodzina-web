import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { familyMemoryContext, fixtureParent, fixtureChild } from './family-v2-test-helpers.mjs';
import { encryptSession, decryptSession, encryptLoginCredentials, decryptLoginCredentials } from '../server/edu-secrets.mjs';
import { connectAction, recoverConnection, disconnectAction } from '../server/edu-service.mjs';
import { readAutoLogin, getConnectionStatus, selectConnectionStudent, disconnectConnection, forgetAutoLogin } from '../server/edu-storage.mjs';
import { EduServerError } from '../server/edu-auth.mjs';

process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 41).toString('base64');
const profile = { id: 'test-sp4', studentName: 'Testowy uczeń', schoolName: 'Testowa szkoła', schoolSymbol: 'SP4' };
const session = { v: 1, cookieJar: { cookies: [{ key: 'session', value: 'synthetic' }] }, profiles: [profile] };
const provider = async () => ({ session, students: [profile] });
function fixture() {
  const ctx = familyMemoryContext({ 'members/child': { ...fixtureChild, personKey: 'Nikodem', schoolEnabled: true } });
  return { ...ctx, profile: fixtureParent, connection: { id: 'family', scope: 'family', accountRole: 'parent', actorUid: 'parent', allowedPersonKeys: ['Nikodem'], personProfileIds: { Nikodem: 'child' } } };
}
async function saved(remember = 'true') {
  const ctx = fixture();
  const body = { login: 'test@example.test', password: 'synthetic-password', rememberLogin: remember };
  await connectAction(ctx, body, { connect: provider });
  assert.equal(body.password, undefined); assert.equal(body.login, undefined);
  await selectConnectionStudent('family', { profileId: profile.id, personKey: 'Nikodem' }, ctx);
  return ctx;
}
const expire = ctx => ctx.db.collection('_eduConnections').doc('family').update({ expiresAt: Timestamp.fromMillis(0), reconnectRequired: true });
const raw = async ctx => (await ctx.db.collection('_eduConnections').doc('family').get()).data();

test('credentials are authenticated encrypted, separated by purpose and connection; sessions still reject passwords', () => {
  const envelope = encryptLoginCredentials('test-login', 'synthetic-password', 'family');
  assert(!JSON.stringify(envelope).includes('synthetic-password'));
  assert.deepEqual(decryptLoginCredentials(envelope, 'family'), { login: 'test-login', password: 'synthetic-password' });
  assert.throws(() => decryptLoginCredentials(envelope, 'other'));
  assert.throws(() => decryptSession(envelope, { uid: 'family' }));
  assert.throws(() => encryptSession({ password: 'synthetic-password' }, { uid: 'family' }));
  assert.throws(() => decryptLoginCredentials(encryptSession({}, { uid: 'family' }), 'family'));
});

test('opt-in only; public status has flags and never password, login or encrypted credentials', async () => {
  const ctx = await saved();
  const status = await getConnectionStatus('family', ctx);
  assert.deepEqual(status.autoLogin, { enabled: true, paused: false });
  for (const secret of ['synthetic-password', 'test@example.test', 'ciphertext', 'nonce']) assert(!JSON.stringify(status).includes(secret));
  assert(!JSON.stringify(await raw(ctx)).includes('synthetic-password'));
  const no = await saved('false');
  assert.equal((await raw(no)).autoLogin, undefined);
  await expire(no); assert.equal(await recoverConnection(no, { connect: () => { throw Error('must not login'); } }), false);
});

test('expired saved connection logs in once, preserves confirmed school mapping and stops retrying when healthy', async () => {
  const ctx = await saved(); await expire(ctx);
  let calls = 0;
  assert.equal(await recoverConnection(ctx, { connect: async credentials => { calls++; assert.equal(credentials.password, 'synthetic-password'); return provider(); } }), true);
  const status = await getConnectionStatus('family', ctx);
  assert.equal(status.state, 'connected'); assert.equal(status.selectedStudent.personKey, 'Nikodem');
  assert.equal(await recoverConnection(ctx, { connect: () => { throw Error('unneeded login'); } }), false);
  assert.equal(calls, 1);
});

test('invalid password pauses retry; temporary failure backs off for an hour', async () => {
  for (const [code, paused] of [['EDU_LOGIN_FAILED', true], ['EDU_INTERACTIVE_LOGIN_REQUIRED', true], ['EDU_UPSTREAM_TIMEOUT', false]]) {
    const ctx = await saved(); await expire(ctx);
    await assert.rejects(recoverConnection(ctx, { connect: async () => { throw new EduServerError(code, 401, 'Synthetic error'); } }), e => e.code === code);
    const current = await raw(ctx); assert.equal(current.autoLogin.paused, paused); assert(current.autoLogin.nextAttemptAt > Date.now());
    assert.equal(await recoverConnection(ctx, { connect: () => { throw Error('must back off'); } }), false);
  }
});

test('forgetting removes encrypted credentials without deleting the active session', async () => {
  const ctx = await saved();
  await disconnectAction(ctx, { forgetLogin: 'true' });
  const status = await getConnectionStatus('family', ctx);
  assert.equal(status.state, 'connected'); assert.equal(status.autoLogin.enabled, false); assert.equal((await raw(ctx)).autoLogin, undefined);
});

test('disconnect or forgetting while auto-login is in flight prevents late credentials/session resurrection', async () => {
  for (const remove of [disconnectConnection, forgetAutoLogin]) {
    const ctx = await saved(); await expire(ctx);
    let unblock, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const pending = recoverConnection(ctx, { connect: async () => { entered(); await new Promise(resolve => { unblock = resolve; }); return provider(); } });
    await ready; await remove('family', ctx); unblock();
    await assert.rejects(pending, e => e.code === 'EDU_CONNECTION_CHANGED');
    assert.equal((await raw(ctx))?.autoLogin, undefined);
  }
});

test('inactive actors cannot decrypt or use saved credentials', async () => {
  const ctx = await saved(); await expire(ctx);
  await ctx.db.collection('members').doc('parent').update({ active: false });
  await assert.rejects(readAutoLogin('family', ctx), e => e.code === 'EDU_MEMBER_REQUIRED');
});

test('reused provider profile id with a changed pupil cannot inherit the old child mapping', async () => {
  const ctx = await saved(); await expire(ctx);
  const changed = { ...profile, studentName: 'Inny uczeń' };
  await recoverConnection(ctx, { connect: async () => ({ session: { ...session, profiles: [changed] }, students: [changed] }) });
  const status = await getConnectionStatus('family', ctx);
  assert.equal(status.state, 'needs_profile'); assert.equal(status.selectedStudent, null);
});
