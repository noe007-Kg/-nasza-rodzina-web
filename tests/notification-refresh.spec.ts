import { expect, test } from '@playwright/test';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { createNotificationHandler } from '../server/notification-http.mjs';
import { refreshInAppNotifications } from '../server/notification-refresh.mjs';
import { requireMember } from '../server/edu-auth.mjs';
import { accounts, fixtureDatabase, password, projectId, seedEmulators } from './emulator-fixtures';

test('IN-APP Vercel: committed chat change creates a real Admin inbox without Functions and hides unrelated private messages', async ({ page }) => {
  await seedEmulators();
  process.env.FIREBASE_PROJECT_ID = projectId;
  const db = fixtureDatabase();
  const app = getApps().find(candidate => candidate.name === 'browser-tests')!;
  let baselineCreated = false;
  let requests = 0;
  // Vite serves the UI only. Run the actual authenticated Vercel handler here
  // against the local emulators, rather than fabricating an inbox response.
  const handler = createNotificationHandler(refreshInAppNotifications,
    request => requireMember(request, { app, auth: getAuth(app), db }));
  await page.route('**/api/notifications/refresh', async route => {
    requests++;
    const headers: Record<string, string> = {};
    let json = '';
    const response = { statusCode: 0, setHeader(key: string, value: string) { headers[key] = value; }, end(body: string) { json = body; } };
    const request = route.request();
    await handler({ method: request.method(), headers: { ...request.headers(), host: new URL(request.url()).host }, body: request.postDataJSON() }, response);
    const body = JSON.parse(json);
    baselineCreated ||= body.ok === true && body.baselines === 6;
    await route.fulfill({ status: response.statusCode, headers, body: json });
  });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(accounts.parent.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByTestId('notification-bell')).toBeVisible();
  await expect.poll(() => baselineCreated).toBe(true);
  const inbox = db.collection('notificationInbox').doc(accounts.parent.uid).collection('items');
  expect((await inbox.get()).size).toBe(0);

  const batch = db.batch();
  batch.set(db.doc('familyMessages/inapp-real-family'), {
    text: 'Nowa wiadomość po baseline', uid: accounts.mother.uid, name: accounts.mother.name,
    channel: 'family', participants: [], createdAt: Timestamp.now(),
  });
  const participants = [accounts.child.uid, accounts.sibling.uid].sort();
  batch.set(db.doc('familyMessages/inapp-unrelated-private'), {
    text: 'Tajemnica prywatnej rozmowy dzieci', uid: accounts.child.uid, name: accounts.child.name,
    channel: `private:${participants.join(':')}`, participants, createdAt: Timestamp.now(),
  });
  await batch.commit();
  await expect(page.getByTestId('notification-bell')).toHaveAttribute('aria-label', 'Powiadomienia: 1 nieprzeczytanych');
  const entries = await inbox.get();
  expect(entries.size).toBe(1);
  expect(entries.docs[0].data().eventId).toBe('familyChat:inapp-real-family');
  expect(entries.docs[0].data().read).toBe(false);
  expect(JSON.stringify(entries.docs[0].data())).not.toContain('Tajemnica');
  expect((await db.collection('_notificationOutbox').get()).size).toBe(0);
  expect((await db.collection('_notificationDevices').get()).size).toBe(0);
  await page.getByTestId('notification-bell').click();
  await expect(page.getByRole('dialog')).toContainText('Nowa wiadomość rodzinna');
  await page.locator('.notification-item-content').click();
  await expect(page.locator('.chat-page')).toBeVisible();
  await expect.poll(async () => (await entries.docs[0].ref.get()).data()?.read).toBe(true);
  expect(requests).toBeGreaterThanOrEqual(2);
});
