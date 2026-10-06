import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { mkdir } from 'node:fs/promises';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

async function loginCalendar(page: Page, account: typeof accounts.parent | typeof accounts.mother = accounts.parent) {
  await page.goto('/#Kalendarz');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(() => { location.hash = encodeURIComponent('Kalendarz'); });
  await expect(page.locator('.page-header h1')).toHaveText('Kalendarz');
}
const modal = (page: Page) => page.locator('.modal-card');

test.beforeEach(async ({ page }) => {
  await seedEmulators();
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ contentType:'application/json', body:JSON.stringify({current:{temperature_2m:17,weather_code:2,wind_speed_10m:8},daily:{temperature_2m_max:[20],temperature_2m_min:[11]}}) }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, (route) => { throw new Error(`Calendar test attempted production Firebase: ${route.request().url()}`); });
});

test('kalendarz: pon–pt oraz custom interwał, dni i koniec po X są zapisane i ponownie odczytane', async ({ page }, testInfo) => {
  await loginCalendar(page);
  await page.getByRole('button', { name:/Dodaj wydarzenie/ }).click();
  await modal(page).getByLabel('Nazwa wydarzenia').fill('Powtarzalne spacery');
  await modal(page).getByLabel('Data', { exact:true }).fill(todayKey());
  await modal(page).getByLabel('Powtarzanie', { exact:true }).selectOption('weekdays');
  await modal(page).getByLabel('Zakończenie powtarzania').selectOption('count');
  await modal(page).getByLabel('Liczba wystąpień').fill('5');
  await modal(page).getByRole('button', { name:/Zapisz wydarzenie/ }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect.poll(async () => (await fixtureDatabase().collection('calendarEvents').where('title','==','Powtarzalne spacery').get()).docs[0]?.data().repeat).toBe('weekdays');
  await page.getByRole('button', { name:/Dodaj wydarzenie/ }).click();
  await modal(page).getByLabel('Nazwa wydarzenia').fill('Co dwa tygodnie');
  await modal(page).getByLabel('Powtarzanie', { exact:true }).selectOption('custom');
  await modal(page).getByLabel('Powtarzaj co', { exact:true }).fill('2');
  await modal(page).getByLabel('Jednostka powtarzania').selectOption('week');
  await modal(page).getByLabel('Pon', { exact:true }).check();
  await modal(page).getByLabel('Śr', { exact:true }).check();
  await modal(page).getByLabel('Zakończenie powtarzania').selectOption('count');
  await modal(page).getByLabel('Liczba wystąpień').fill('8');
  if (testInfo.project.name==='chromium') { await mkdir('preview',{recursive:true}); await page.screenshot({path:'preview/calendar-recurring-event.png',fullPage:true}); }
  await modal(page).getByRole('button', { name:/Zapisz wydarzenie/ }).click();
  await expect(modal(page)).toHaveCount(0);
  const stored=await fixtureDatabase().collection('calendarEvents').where('title','==','Co dwa tygodnie').get();
  expect(stored.docs[0].data().recurrence.interval).toBe(2); expect(stored.docs[0].data().recurrence.weekdays).toEqual(expect.arrayContaining([1,3])); expect(stored.docs[0].data().repeatCount).toBe(8);
  await page.reload(); await expect(page.locator('.page-header h1')).toHaveText('Kalendarz');
  await expect.poll(async()=> (await fixtureDatabase().collection('calendarEvents').where('title','==','Co dwa tygodnie').get()).size).toBe(1);
});

test('kalendarz: pojedynczy wyjątek, przyszłość, cała seria i usunięcie zachowują granice zakresu', async ({ page }, testInfo) => {
  const day=new Date(`${todayKey()}T09:00:00`), base=new Date(day); base.setDate(base.getDate()-2);
  await fixtureDatabase().doc('calendarEvents/series-ui').set({title:'Seria testowa',person:'family',date:Timestamp.fromDate(base),endDate:Timestamp.fromDate(new Date(base.getTime()+3600000)),allDay:false,description:'',repeat:'daily',repeatUntil:null,repeatCount:8,createdBy:accounts.parent.uid,createdAt:Timestamp.now()});
  await loginCalendar(page);
  await page.locator('.calendar-side section').first().locator('.calendar-event').filter({hasText:'Seria testowa'}).click();
  await modal(page).getByRole('button',{name:/Edytuj/}).click();
  await modal(page).getByLabel('Tylko tego wydarzenia',{exact:true}).check();
  await modal(page).getByLabel('Nazwa wydarzenia').fill('Jeden termin');
  await modal(page).getByRole('button',{name:/Zapisz zmiany/}).click();
  await expect(modal(page).getByRole('heading',{name:'Jeden termin',exact:true})).toBeVisible();
  const afterSingle=(await fixtureDatabase().doc('calendarEvents/series-ui').get()).data()!;
  expect(afterSingle.title).toBe('Seria testowa'); expect(Object.keys(afterSingle.recurrenceOverrides)).toHaveLength(1);
  await modal(page).getByRole('button',{name:'Zamknij',exact:true}).click();
  await page.locator('.calendar-side section').first().locator('.calendar-event').filter({hasText:'Jeden termin'}).click();
  await modal(page).getByRole('button',{name:/Edytuj/}).click();
  await modal(page).getByLabel('Tego i kolejnych',{exact:true}).check();
  await modal(page).getByLabel('Nazwa wydarzenia').fill('Od dziś');
  if(testInfo.project.name==='chromium') { await mkdir('preview',{recursive:true}); await page.screenshot({path:'preview/calendar-edit-series.png',fullPage:true}); }
  await modal(page).getByRole('button',{name:/Zapisz zmiany/}).click();
  await modal(page).getByRole('button',{name:'Zamknij',exact:true}).click();
  await expect.poll(async()=> (await fixtureDatabase().collection('calendarEvents').get()).size).toBe(2);
  const past=(await fixtureDatabase().doc('calendarEvents/series-ui').get()).data()!;
  expect(past.title).toBe('Seria testowa'); expect(past.repeatBefore.toMillis()).toBe(day.getTime());
  await page.locator('.calendar-side section').first().locator('.calendar-event').filter({hasText:'Od dziś'}).click();
  await modal(page).getByRole('button',{name:/Edytuj/}).click();
  await modal(page).getByLabel('Wszystkich wydarzeń',{exact:true}).check();
  await modal(page).getByLabel('Nazwa wydarzenia').fill('Wszystkie terminy');
  await modal(page).getByRole('button',{name:/Zapisz zmiany/}).click();
  await modal(page).getByRole('button',{name:'Zamknij',exact:true}).click();
  await expect.poll(async()=> (await fixtureDatabase().collection('calendarEvents').where('title','==','Wszystkie terminy').get()).size).toBe(2);
  await page.locator('.calendar-side section').first().locator('.calendar-event').filter({hasText:'Wszystkie terminy'}).click();
  await modal(page).getByRole('button',{name:/Usuń/}).click();
  await modal(page).getByLabel('Cała seria',{exact:true}).check(); page.once('dialog',dialog=>dialog.accept());
  await modal(page).getByRole('button',{name:'Potwierdź usunięcie',exact:true}).click();
  await expect(modal(page)).toHaveCount(0); await expect.poll(async()=> (await fixtureDatabase().collection('calendarEvents').get()).empty).toBe(true);
});

test('kalendarz: prywatny wpis pozostaje wyłącznie właścicielowi po zmianie użytkownika', async ({ page }) => {
  await loginCalendar(page);
  await page.getByRole('button',{name:/Dodaj wydarzenie/}).click();
  await modal(page).getByLabel('Nazwa wydarzenia').fill('Prywatna konsultacja');
  await modal(page).getByLabel('Prywatne — widoczne wyłącznie dla właściciela').check();
  await modal(page).getByRole('button',{name:/Zapisz wydarzenie/}).click(); await expect(modal(page)).toHaveCount(0);
  const snapshots=await fixtureDatabase().collection('privateCalendarEvents').get(); expect(snapshots.size).toBe(1); expect(snapshots.docs[0].data().ownerUid).toBe(accounts.parent.uid);
  expect((await fixtureDatabase().collection('calendarEvents').get()).empty).toBe(true);
  await expect(page.locator('.calendar-event').filter({hasText:'Prywatna konsultacja'}).first()).toBeVisible();
  await page.evaluate(()=>{location.hash=encodeURIComponent('Ustawienia');});
  await page.getByRole('button',{name:'Wyloguj',exact:true}).click();
  await loginCalendar(page,accounts.mother);
  await expect(page.locator('.calendar-event').filter({hasText:'Prywatna konsultacja'})).toHaveCount(0);
});

test('kalendarz: import ICS, ponowny import bez duplikatu oraz eksport własnych danych', async ({ page }) => {
  await loginCalendar(page);
  await page.getByRole('button',{name:'Importuj / pobierz kalendarz .ics',exact:true}).click();
  const key=todayKey().replace(/-/g,''), content=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ics-e2e-unique\r\nDTSTART;TZID=Europe/Warsaw:${key}T120000\r\nDTEND;TZID=Europe/Warsaw:${key}T130000\r\nSUMMARY:Spotkanie z ICS\r\nRRULE:FREQ=DAILY;INTERVAL=2;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  await modal(page).getByLabel('Plik kalendarza ICS').setInputFiles({name:'calendar.ics',mimeType:'text/calendar',buffer:Buffer.from(content)});
  await expect(modal(page).getByRole('status')).toContainText('Zaimportowano: 1');
  await modal(page).getByLabel('Plik kalendarza ICS').setInputFiles({name:'calendar.ics',mimeType:'text/calendar',buffer:Buffer.from(content)});
  await expect(modal(page).getByRole('status')).toContainText('Pominięto istniejące: 1');
  expect((await fixtureDatabase().collection('calendarEvents').get()).size).toBe(1);
  const download=page.waitForEvent('download'); await modal(page).getByRole('button',{name:'Pobierz kalendarz',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('nasza-rodzina.ics');
});
