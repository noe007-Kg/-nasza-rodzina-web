import { test, expect } from '@playwright/test';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { accounts, password } from './emulator-fixtures';
import { connectAction, disconnectAction, statusAction } from '../server/edu-service.mjs';

test('parent opts in to encrypted auto-login and can forget credentials without disconnecting', async ({ page }) => {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.2:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.2:8080') throw Error('Dedicated local emulators required');
  process.env.EDUVULCAN_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 17).toString('base64');
  const app = initializeApp({ projectId: 'demo-nasza-rodzina' }, `edu-auto-${Date.now()}`), db = getFirestore(app);
  await fetch('http://127.0.0.2:8080/emulator/v1/projects/demo-nasza-rodzina/databases/(default)/documents', { method: 'DELETE' });
  const actor = { name: 'Sebastian', personKey: 'Sebastian', role: 'parent', active: true, canLogin: true };
  for (const account of [accounts.parent, accounts.child]) {
    try { await getAuth(app).createUser({ uid: account.uid, email: account.email, password }); } catch { await getAuth(app).updateUser(account.uid, { password }); }
    await db.doc(`members/${account.uid}`).set(account.role === 'parent' ? actor : { name: 'Nikodem', personKey: 'Nikodem', role: 'child', active: true, canLogin: true, schoolEnabled: true });
  }
  const ctx = { db, uid: accounts.parent.uid, profile: actor, connection: { id: 'family', scope: 'family', accountRole: 'parent', actorUid: accounts.parent.uid,
    allowedPersonKeys: ['Nikodem'], personProfileIds: { Nikodem: accounts.child.uid } } };
  const profile = { id: 'synthetic-sp4', studentName: 'Nikodem', schoolName: 'Szkoła testowa', schoolSymbol: 'SP4' };
  const provider = async () => ({ session: { v: 1, cookieJar: { cookies: [{ key: 'synthetic-session', value: 'opaque' }] }, profiles: [profile] }, students: [profile] });
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl)\//, r => r.abort());
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: { configured: false, state: 'disconnected', profiles: [] }, connections: [], items: [], plans: [], bills: [], documents: [] }) }));
  await page.route('**/api/eduvulcan/**', async r => {
    const action = new URL(r.request().url()).pathname.split('/').pop();
    const body = r.request().method() === 'GET' ? {} : r.request().postDataJSON();
    const result = action === 'connect' ? await connectAction(ctx, body, { connect: provider })
      : action === 'disconnect' ? await disconnectAction(ctx, body) : await statusAction(ctx);
    const serialized = JSON.stringify({ ok: true, ...result });
    expect(serialized).not.toContain('synthetic-password'); expect(serialized).not.toContain('ciphertext');
    await r.fulfill({ contentType: 'application/json', body: serialized });
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/#' + encodeURIComponent('Szkoła'));
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  const connection = page.locator('.edu-vulcan-connection');
  const remember = connection.getByRole('checkbox', { name: /Zapamiętaj login i hasło/ });
  await expect(remember).not.toBeChecked();
  await connection.getByLabel('Login lub e-mail eduVULCAN').fill('synthetic@example.test');
  await connection.getByLabel('Hasło eduVULCAN', { exact: true }).fill('synthetic-password');
  await remember.check();
  await connection.getByRole('button', { name: 'Połącz', exact: true }).click();
  await expect(connection.getByRole('button', { name: 'Usuń zapamiętane dane' })).toBeVisible();
  const stored = (await db.doc('_eduConnections/family').get()).data()!;
  expect(stored.autoLogin.envelope.ciphertext).toBeTruthy();
  expect(JSON.stringify(stored)).not.toContain('synthetic-password');
  await connection.getByRole('button', { name: 'Usuń zapamiętane dane' }).click();
  await expect(connection).toContainText('Zapamiętany login i hasło zostały usunięte');
  expect((await db.doc('_eduConnections/family').get()).data()!.autoLogin).toBeUndefined();
  expect((await db.doc('_eduConnections/family').get()).data()!.envelope).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
