import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, projectId, seedEmulators, todayKey } from './emulator-fixtures';

// These fixtures model reviewed post-migration metadata only in the local demo.
// The shared seed remains unchanged, and no provider or production API is called.
const household = 'browser-household-a';
const foreignHousehold = 'browser-household-b';
type Account = (typeof accounts)[keyof typeof accounts];

async function login(page: Page, module: string, account: Account) {
  await page.goto(`/#${encodeURIComponent(module)}`);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(value => { location.hash = encodeURIComponent(value); }, module);
  await expect(page.locator('.page-header h1')).toHaveText(module);
}

async function expectForbiddenDocuments(page: Page, documents: readonly string[]) {
  const results = await page.evaluate(async paths => {
    // @ts-expect-error Vite serves the application's actual emulator-bound Firebase SDK.
    const { db, doc, getDoc } = await import('/src/app-shared.tsx');
    return Promise.all(paths.map(async path => {
      try { await getDoc(doc(db, path)); return 'UNEXPECTED_READ'; }
      catch (error) { return String((error as { code?: string }).code || ''); }
    }));
  }, documents);
  expect(results).toEqual(documents.map(() => 'permission-denied'));
}

async function checkCompactLayouts(page: Page) {
  for (const size of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
}

function calendarEvent(title: string, extra: Record<string, unknown> = {}) {
  return { title, person: 'family', familyId: household, private: false, visibility: 'family',
    ownerUid: accounts.parent.uid, ownerProfileId: 'family', createdBy: accounts.parent.uid,
    source: 'manual', date: Timestamp.fromDate(new Date(`${todayKey()}T12:00:00Z`)),
    endDate: Timestamp.fromDate(new Date(`${todayKey()}T13:00:00Z`)), allDay: false,
    description: '', location: '', repeat: 'none', repeatUntil: null, ...extra };
}

test.beforeEach(async ({ page }) => {
  if (projectId !== 'demo-nasza-rodzina' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
    || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local demo emulators are mandatory.');
  await seedEmulators();
  await page.clock.setFixedTime(new Date(`${todayKey()}T10:00:00Z`));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//,
    route => route.abort('blockedbyclient'));
  // Vite has no server API. Only safe UI read responses are simulated here;
  // the actual Firestore listeners and forbidden direct reads use emulator Rules.
  await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    ok: true, writesEnabled: false, configured: false, connections: [], documents: [], documentsReady: true,
    storageConfigured: false, balances: [], rewards: [], requests: [], history: [],
    status: { configured: false, state: 'disconnected', profiles: [] },
  }) }));
  const db = fixtureDatabase(), batch = db.batch();
  for (const account of Object.values(accounts)) batch.update(db.doc(`members/${account.uid}`), {
    familyId: account.uid === accounts.inactive.uid ? foreignHousehold : household,
  });
  for (const collection of ['tasks', 'schoolItems', 'healthRecords']) {
    const records = await db.collection(collection).get();
    for (const record of records.docs) batch.update(record.ref, { familyId: household });
  }
  batch.set(db.doc('calendarEvents/isolation-family'), calendarEvent('Termin naszej rodziny'));
  batch.set(db.doc('calendarEvents/isolation-own'), calendarEvent('Własny termin Sebastiana', {
    person: 'Sebastian', ownerProfileId: accounts.parent.uid,
  }));
  batch.set(db.doc('calendarEvents/isolation-foreign'), calendarEvent('Termin obcego gospodarstwa', {
    familyId: foreignHousehold, ownerUid: accounts.inactive.uid, createdBy: accounts.inactive.uid,
  }));
  batch.set(db.doc('privateCalendarEvents/isolation-private-own'), calendarEvent('Prywatny termin Sebastiana', {
    private: true, visibility: 'private', person: 'Sebastian', ownerProfileId: accounts.parent.uid,
  }));
  batch.set(db.doc('privateCalendarEvents/isolation-private-mother'), calendarEvent('Prywatny termin drugiego rodzica', {
    private: true, visibility: 'private', person: 'Dominika', ownerUid: accounts.mother.uid,
    ownerProfileId: accounts.mother.uid, createdBy: accounts.mother.uid,
  }));
  const task = { dueDate: todayKey(), done: false, points: 0, requireApproval: true, approvalStatus: 'none',
    priority: 'normal', repeat: 'none', createdBy: accounts.parent.uid, familyId: household };
  batch.set(db.doc('tasks/isolation-family'), { ...task, title: 'Zadanie dla naszej rodziny', person: 'family' });
  batch.set(db.doc('tasks/isolation-foreign'), { ...task, familyId: foreignHousehold,
    title: 'Zadanie obcego gospodarstwa', person: 'Nikodem', createdBy: accounts.inactive.uid });
  const health = { person: 'family', type: 'history', date: todayKey(), title: 'Wspólny wpis naszej rodziny',
    privateToParents: false, familyId: household, createdBy: accounts.parent.uid, createdAt: Timestamp.now() };
  batch.set(db.doc('healthRecords/isolation-family'), health);
  batch.set(db.doc('healthRecords/isolation-foreign'), { ...health, person: 'Nikodem', familyId: foreignHousehold,
    title: 'Wpis zdrowia obcego gospodarstwa', createdBy: accounts.inactive.uid });
  await batch.commit();
});

test('parent Calendar preserves personal/family views and excludes other-household and other-parent private data', async ({ page }) => {
  await login(page, 'Kalendarz', accounts.parent);
  const day = page.locator('.calendar-day-view');
  await expect(day).toContainText('Własny termin Sebastiana');
  await expect(day).toContainText('Prywatny termin Sebastiana');
  await expect(page.locator('body')).not.toContainText('Prywatny termin drugiego rodzica');
  await expect(page.locator('body')).not.toContainText('Termin obcego gospodarstwa');
  await page.locator('.person-filters').getByRole('button', { name: 'Cała rodzina', exact: true }).click();
  await expect(day).toContainText('Termin naszej rodziny');
  await expect(day).toContainText('Własny termin Sebastiana');
  await expect(day).not.toContainText('Prywatny termin Sebastiana');
  await expectForbiddenDocuments(page, ['calendarEvents/isolation-foreign', 'privateCalendarEvents/isolation-private-mother']);
  await checkCompactLayouts(page);
});

test('child Tasks uses own/family scoped listeners and cannot directly read sibling or foreign assignments', async ({ page }) => {
  await login(page, 'Zadania', accounts.child);
  const tasks = page.getByTestId('tasks-v2');
  await expect(tasks).toContainText('Wynieść śmieci — test zatwierdzania');
  await expect(tasks).toContainText('Zadanie dla naszej rodziny');
  await expect(tasks).not.toContainText('Zadanie Pawła');
  await expect(tasks).not.toContainText('Zadanie obcego gospodarstwa');
  await expectForbiddenDocuments(page, ['tasks/sibling-approval', 'tasks/isolation-foreign']);
  await checkCompactLayouts(page);
});

test('child Health retains own/shared records without exposing sibling, parent-private or foreign records', async ({ page }) => {
  await login(page, 'Zdrowie', accounts.child);
  await page.locator('.health-person-filter').getByRole('combobox', { name: 'Osoba', exact: true }).selectOption('family');
  const records = page.locator('.health-manager');
  await expect(records).toContainText('Kontrola Nikodema');
  await expect(records).toContainText('Wspólny wpis naszej rodziny');
  await expect(records).not.toContainText('Kontrola Pawła');
  await expect(records).not.toContainText('Poufny dokument Pawła');
  await expect(records).not.toContainText('Wpis zdrowia obcego gospodarstwa');
  await expectForbiddenDocuments(page, ['healthRecords/pawel-public', 'healthRecords/pawel-private', 'healthRecords/isolation-foreign']);
  await checkCompactLayouts(page);
});


test('protected product thumbnail/edit preview and legacy household shopping backup retain their original behavior',async({page})=>{
  const bucket=getStorage(getApps().find(app=>app.name==='browser-tests')!).bucket(`${projectId}.appspot.com`);
  const path=`quick-products/${accounts.parent.uid}/isolated-preview.png`;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=','base64');
  await bucket.file(path).save(png,{resumable:false,metadata:{contentType:'image/png',metadata:{familyId:household}}});
  try {
    const db=fixtureDatabase();
    await db.doc('quickProducts/owned-proof').set({familyId:household,createdBy:accounts.parent.uid,
      title:'Chroniony produkt testowy',category:'inne',imagePath:path,defaultQuantity:'1',defaultUnit:'szt.',custom:true});
    await db.doc('shoppingItems/legacy-own').set({title:'Legacy own shopping entry',createdBy:accounts.parent.uid,done:false});
    await db.doc('shoppingItems/foreign-entry').set({title:'Foreign shopping entry',createdBy:accounts.inactive.uid,done:false});
    await login(page,'Zakupy',accounts.parent);
    const tile=page.getByRole('button',{name:'Chroniony produkt testowy',exact:true});
    // WebKit starts loading a lazy thumbnail only when it reaches the viewport.
    await tile.scrollIntoViewIfNeeded();
    await expect.poll(()=>tile.locator('img').evaluateAll(images=>images.some(image=>image instanceof HTMLImageElement&&image.src.startsWith('blob:')&&image.naturalWidth>0))).toBe(true);
    await tile.dispatchEvent('contextmenu');
    await page.getByRole('button',{name:'🖼️ Zmień ikonkę / Edytuj',exact:true}).click();
    await expect.poll(()=>page.locator('.quick-image-preview').evaluateAll(images=>images.some(image=>image instanceof HTMLImageElement&&image.src.startsWith('blob:')&&image.naturalWidth>0))).toBe(true);
    await page.getByRole('button',{name:'Zamknij',exact:true}).click();
    await page.evaluate(()=>{location.hash=encodeURIComponent('Ustawienia');});
    const downloading=page.waitForEvent('download');
    await page.getByRole('button',{name:'Pobierz kopię danych',exact:true}).click();
    const download=await downloading, stream=await download.createReadStream();
    const bytes=[];for await(const chunk of stream!) bytes.push(chunk);
    const backup=JSON.parse(Buffer.concat(bytes).toString());
    expect(backup.data.shoppingItems.map((row:{data:{title:string}})=>row.data.title)).toEqual(['Legacy own shopping entry']);
    expect(JSON.stringify(backup)).not.toContain('Foreign shopping entry');
  } finally {await bucket.file(path).delete({ignoreNotFound:true});}
});
