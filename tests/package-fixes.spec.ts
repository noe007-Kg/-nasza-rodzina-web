import {test,expect,type Page} from '@playwright/test';
import {Timestamp} from 'firebase-admin/firestore';
import {accounts,fixtureDatabase,password,seedEmulators,todayKey} from './emulator-fixtures';
async function login(page:Page) {
 await page.goto('/'); await page.getByLabel('E-mail',{exact:true}).fill(accounts.parent.email); await page.getByLabel('Hasło',{exact:true}).fill(password); await page.getByRole('button',{name:'Zaloguj się',exact:true}).click(); await expect(page.locator('.app-shell')).toBeVisible();
}
async function module(page:Page,name:string){await page.evaluate(name=>location.hash=encodeURIComponent(name),name);}
async function protect(page:Page){
 page.on('pageerror', error => console.error('PAGE ERROR:', error.message, error.stack));
 page.on('console', message => {if(message.type() === 'error' && message.text().includes('Error')) console.error('BROWSER:', message.text());});
 await page.route('https://api.open-meteo.com/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
 await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//,r=>r.abort());
 await page.route('**/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,status:{configured:false,state:'disconnected',profiles:[]},connections:[],items:[],plans:[],bills:[],documents:[]})}));
}
test.beforeEach(async({page})=>{await seedEmulators(); await protect(page);});
for(const [label,width,height] of [['phone',390,844],['ipad',1024,768],['desktop',1440,1000]] as const){
 test(`schedule ${label}: overlap, native page scroll and event details`,async({page})=>{
  await page.setViewportSize({width,height});
  const day=todayKey();const db=fixtureDatabase();
  for(let i=0;i<2;i++) await db.doc(`calendarEvents/package-overlap-${i}`).set({title:`Pakiet termin ${i}`,person:'Sebastian',date:Timestamp.fromDate(new Date(`${day}T10:00:00+02:00`)),endDate:Timestamp.fromDate(new Date(`${day}T11:00:00+02:00`)),allDay:false,description:'Opis testowy',location:'Sala 10',repeat:'none',repeatUntil:null,createdBy:accounts.parent.uid,createdAt:Timestamp.now()});
  await login(page);await module(page,'Kalendarz');
  await expect(page.getByRole('button',{name:'Harmonogram',exact:true})).toHaveClass(/active/);
  await expect(page.locator('.calendar-schedule-day .nr-calendar-time-ruler')).toContainText('22:00');
  const events=page.locator('.calendar-schedule-day [data-event-id^="package-overlap-"]');await expect(events).toHaveCount(2);
  const a=await events.nth(0).boundingBox(),b=await events.nth(1).boundingBox();expect(a!.x+a!.width).toBeLessThanOrEqual(b!.x+1);
  const beforeScroll = (await events.first().boundingBox())!.y;
  await page.mouse.move(width / 3, height / 2);await page.mouse.wheel(0, 240);
  await expect.poll(async()=> (await events.first().boundingBox())!.y).toBeLessThan(beforeScroll);
  await events.first().click();
  if(width>=768){await expect(page.locator('.calendar-schedule-details')).toContainText('Sala 10');const d=await page.locator('.calendar-schedule-details').boundingBox(),axis=await page.locator('.calendar-schedule-day').boundingBox();expect(d!.x).toBeGreaterThan(axis!.x+axis!.width-1);}
  else {await expect(page.getByRole('dialog')).toContainText('Sala 10');await page.getByRole('dialog').getByRole('button',{name:'Zamknij',exact:true}).click();}
  await page.getByRole('button',{name:'Dzisiaj',exact:true}).click();
  if(width>=768)await expect(page.locator('.calendar-schedule-details')).toContainText('Wybierz wydarzenie');
  for(const [label,selector] of [['Dzień','.calendar-day-view'],['Tydzień','.nr-calendar-week-content'],['Miesiąc','.calendar-month-card']]){await page.getByRole('button',{name:label,exact:true}).click();await expect(page.locator(selector)).toBeVisible();}

 });
}
test('chat receipts persist on two devices and do not clear unrendered history',async({page,browser})=>{
 const db=fixtureDatabase();const channel=`private:${[accounts.parent.uid,accounts.child.uid].sort().join(':')}`;
 const batch=db.batch();
 for(let i=0;i<310;i++)batch.set(db.doc(`familyMessages/package-message-${i}`),{uid:accounts.child.uid,name:'Nikodem',text:`Wiadomość ${i}`,channel,participants:[accounts.parent.uid,accounts.child.uid].sort(),createdAt:Timestamp.fromMillis(Date.now()-100000+i)});
 await batch.commit();await login(page);await module(page,'Czat');await page.getByRole('button',{name:/Prywatne/}).click();await page.locator('.conversation-row').filter({hasText:'Nikodem'}).click();
 await expect.poll(async()=> (await db.collection('chatReadStates').doc(accounts.parent.uid).collection('messages').get()).size).toBeGreaterThan(0);
 expect((await db.doc(`chatReadStates/${accounts.parent.uid}/messages/package-message-0`).get()).exists).toBe(false);
 const context=await browser.newContext();const second=await context.newPage();await protect(second);await login(second);await module(second,'Czat');await second.getByRole('button',{name:/Prywatne/}).click();await second.locator('.conversation-row').filter({hasText:'Nikodem'}).click();
 await page.reload();await expect(page.locator('.chat-page')).toBeVisible();await expect(page.getByText('Nie udało się zapisać stanu odczytu. Spróbuj ponownie.')).toHaveCount(0);await context.close();
});
test('school new grades, personal read state, pin survives re-sync and reload',async({page})=>{
 const db=fixtureDatabase();await login(page);await module(page,'Szkoła');await page.locator('.school-students').getByRole('button',{name:'Nikodem',exact:true}).click();
 await expect.poll(async()=> (await db.doc(`userPreferences/${accounts.parent.uid}/schoolState/baseline`).get()).exists).toBe(true);
 const entry={person:'Nikodem',type:'grade',title:'5',subject:'Matematyka testowa',date:todayKey(),time:'',endTime:'',weekday:0,note:'Test',source:'eduvulcan',sourceRecordId:'grade-package',sourceProfileId:'package',createdBy:accounts.parent.uid,createdAt:Timestamp.now(),syncedAt:Timestamp.now()};
 await db.doc('schoolItems/package-grade').set(entry);
 await expect(page.locator('.school-new-counters')).toHaveCount(0);
 const row=page.locator('.school-recent-grades .school-entry-wrapper').filter({hasText:'Matematyka testowa'});await expect(row.locator('.school-new-badge')).toHaveText('NOWE'); const badgeBox=await row.locator('.school-new-badge').boundingBox(), rowBox=await row.locator('.school-entry').boundingBox();expect(badgeBox!.y-rowBox!.y).toBeLessThan(14);expect(rowBox!.x+rowBox!.width-badgeBox!.x-badgeBox!.width).toBeLessThan(16);await row.getByRole('button',{name:'Oznacz jako ważne',exact:true}).click();
 await expect(page.locator('.school-important-section')).toContainText('Matematyka testowa');
 await expect.poll(async()=> (await db.doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.importantItems || []).toContain('school:entry:package-grade');
 await db.doc('schoolItems/package-grade').update({syncedAt:Timestamp.now()});await page.reload();await expect(page.locator('.app-shell')).toBeVisible();await module(page,'Szkoła');await page.locator('.school-students').getByRole('button',{name:'Nikodem',exact:true}).click();await expect(page.locator('.school-important-section')).toContainText('Matematyka testowa');
 await page.locator('.school-important-section .school-entry').click();await expect.poll(async()=> (await db.doc(`userPreferences/${accounts.parent.uid}/schoolSeen/package-grade`).get()).exists).toBe(true);
 await expect(page.locator('.school-new-badge')).toHaveCount(0);
 await page.keyboard.press('Escape');
 await page.locator('.school-important-section .school-important-toggle').click();
 await expect.poll(async()=> (await db.doc(`userPreferences/${accounts.parent.uid}`).get()).data()?.importantItems || []).not.toContain('school:entry:package-grade');
 await db.doc('schoolItems/package-grade').update({syncedAt:Timestamp.now()});
 await page.reload();await expect(page.locator('.app-shell')).toBeVisible();await module(page,'Szkoła');await page.locator('.school-students').getByRole('button',{name:'Nikodem',exact:true}).click();
 await expect(page.locator('.school-new-badge')).toHaveCount(0);
 await expect(page.locator('.school-important-section')).not.toContainText('Matematyka testowa');
});
test('opening a short private conversation clears only its badge and notification, persistently',async({page})=>{
 const db=fixtureDatabase();
 await db.doc(`notificationInbox/${accounts.parent.uid}/items/private-unread`).set({eventId:'receipt-private',category:'privateChat',module:'Czat',title:'Wiadomość',body:'Test',recordId:'parents-private',read:false,starred:false,createdAt:Timestamp.now()});
 await db.doc(`notificationInbox/${accounts.parent.uid}/items/other-unread`).set({eventId:'receipt-other',category:'school',module:'Szkoła',title:'Sprawdzian',body:'Test',recordId:'other-school',read:false,starred:false,createdAt:Timestamp.now()});
 await login(page);await module(page,'Czat');await page.getByRole('button',{name:/Prywatne/}).click();
 const conversation=page.locator('.private-list .conversation-row').filter({hasText:'Dominika'});
 await expect(conversation.locator('.chat-unread-badge')).toHaveText('1');await conversation.click();
 await expect(conversation.locator('.chat-unread-badge')).toHaveCount(0);
 await expect.poll(async()=> (await db.doc(`notificationInbox/${accounts.parent.uid}/items/private-unread`).get()).data()?.read).toBe(true);
 expect((await db.doc(`notificationInbox/${accounts.parent.uid}/items/other-unread`).get()).data()?.read).toBe(false);
 expect((await db.doc(`chatReadStates/${accounts.mother.uid}/messages/parents-private`).get()).exists).toBe(false);
 await page.reload();await expect(page.locator('.app-shell')).toBeVisible();await module(page,'Czat');await page.getByRole('button',{name:/Prywatne/}).click();await expect(page.locator('.private-list .conversation-row').filter({hasText:'Dominika'}).locator('.chat-unread-badge')).toHaveCount(0);
});
test('new homework and tests counters open only their new records without rewriting source data',async({page})=>{
 const db=fixtureDatabase();await login(page);await module(page,'Szkoła');await page.locator('.school-students').getByRole('button',{name:'Nikodem',exact:true}).click();
 await expect.poll(async()=> (await db.doc(`userPreferences/${accounts.parent.uid}/schoolState/baseline`).get()).exists).toBe(true);
 for(const type of ['test','homework'])await db.doc(`schoolItems/package-${type}`).set({person:'Nikodem',type,title:`Nowy wpis ${type}`,subject:'Biologia',date:todayKey(),time:'',endTime:'',weekday:0,note:'Przygotuj zeszyt',source:'eduvulcan',sourceRecordId:`source-${type}`,createdBy:accounts.parent.uid,createdAt:Timestamp.now()});
 const original=(await db.doc('schoolItems/package-homework').get()).data();
 for(const [type,label] of [['test','Nowe sprawdziany'],['homework','Nowe zadania']]){
  const counter=page.locator('.school-new-counters').getByRole('button',{name:new RegExp(label)});await expect(counter).toContainText('1');await counter.click();
  await expect(page.locator('.school-record-list')).toContainText(`Nowy wpis ${type}`);
  await page.locator('.school-record-list .school-entry').click();await expect(page.getByRole('dialog')).toContainText('Przygotuj zeszyt');await page.getByRole('button',{name:'Zamknij okno',exact:true}).click();await expect(counter).toContainText('0');
 }
 expect((await db.doc('schoolItems/package-homework').get()).data()).toEqual(original);
});

 test('health icon navigation remains readable and usable on phone and desktop',async({page})=>{
 await fixtureDatabase().doc('healthRecords/history-layout').set({title:'Wizyta kontrolna',person:'family',type:'history',date:'',privateToParents:false,createdBy:accounts.parent.uid,createdAt:Timestamp.now()});
 await login(page);await module(page,'Zdrowie');const nav=page.getByRole('navigation',{name:'Sekcje zdrowia'});await expect(nav.getByRole('button')).toHaveCount(6);await expect(nav.locator('svg')).toHaveCount(6);
 const historyRow=page.locator('.timeline-health-row').filter({hasText:'Wizyta kontrolna'});await expect(historyRow).toContainText('Cała rodzina');await expect(historyRow).toContainText('Bez daty');await expect(historyRow).not.toContainText('family');
 const titleBox=await historyRow.locator('strong').boundingBox(), personBox=await historyRow.locator('small').boundingBox();expect(personBox!.y).toBeGreaterThanOrEqual(titleBox!.y+titleBox!.height);
 for(const size of [{width:390,height:844},{width:1440,height:900}]){await page.setViewportSize(size);await nav.getByRole('button',{name:'Wizyty',exact:true}).click();await expect(nav.getByRole('button',{name:'Wizyty',exact:true})).toHaveAttribute('aria-pressed','true');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);await nav.getByRole('button',{name:'Przegląd',exact:true}).click();}
});
