import {test,expect,type Page} from '@playwright/test';
import {getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getStorage} from 'firebase-admin/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {accounts,fixtureDatabase,password,seedEmulators} from './emulator-fixtures';
import {manageTasksAction} from '../server/tasks-service.mjs';
import {createOkruszekDays,okruszekDayEntry,okruszekDayId} from '../src/school/okruszek-plan';
const family='usability-test-family';
async function protect(page:Page){
  page.on('console',message=>{if(message.type()==='error')console.error('BROWSER ERROR',message.text());});
  page.on('pageerror',error=>console.error('PAGE ERROR',error.stack));
  await page.route('https://api.open-meteo.com/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app|eduvulcan\.pl|vulcan\.net\.pl|fryderyk\.edu\.pl)\//,r=>r.abort());
  await page.route('**/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,status:{configured:false,state:'disconnected',profiles:[]},connections:[],plans:[],bills:[],documents:[],items:[],balances:[],rewards:[],requests:[],history:[]})}));
}
async function login(page:Page,section='Start'){
  await page.goto('/#'+encodeURIComponent(section));
  await page.getByLabel('E-mail',{exact:true}).fill(accounts.parent.email);await page.getByLabel('Hasło',{exact:true}).fill(password);await page.getByRole('button',{name:'Zaloguj się',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
}
test.beforeEach(async({page})=>{
  await seedEmulators();await protect(page);
  const db=fixtureDatabase();for(const account of Object.values(accounts)) await db.doc(`members/${account.uid}`).update({familyId:family});
});
test('Start shows recent school entries and the top Paweł profile reads the complete Okruszek timetable',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-10-21T07:00:00Z'));
  const db=fixtureDatabase();
  for(const day of createOkruszekDays('Paweł',accounts.sibling.uid)) await db.doc(`schoolItems/${await okruszekDayId(accounts.sibling.uid,day.weekday)}`).set({...okruszekDayEntry(day),createdBy:accounts.parent.uid,createdAt:Timestamp.now()});
  await login(page);
  await expect(page.getByTestId('home-section-school')).toBeVisible();
  await expect.poll(async()=> (await db.doc(`userPreferences/${accounts.parent.uid}/schoolState/baseline`).get()).exists).toBe(true);
  await db.doc('schoolItems/new-homework-usability').set({person:'Nikodem',type:'homework',title:'Ćwiczenia strona 12',subject:'Matematyka',date:'2026-10-22',source:'eduvulcan',createdAt:Timestamp.fromMillis(Date.now()+1000),createdBy:accounts.parent.uid});
  const school=page.getByTestId('home-section-school');await expect(school).toContainText('Ćwiczenia strona 12');await expect(school).toContainText('Dodano');await expect(school).toContainText('NOWE');
  await page.getByRole('button',{name:'Profil: Paweł',exact:true}).click();
  const plan=page.locator('.family-hub-card').filter({has:page.getByText('Dzisiejszy plan',{exact:false})}).first();
  await expect(plan).not.toContainText('Brak planu na dziś');await expect(plan).toContainText('PDP/ kuchnia');await expect(plan.locator('.family-hub-row')).toHaveCount(14);
  for(const viewport of [{width:900,height:1440},{width:1024,height:768},{width:390,height:844}]) {await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
});
test('parent reward image is actually resized and uploaded, then reward and task can be removed',async({page})=>{
  const db=fixtureDatabase(),app=getApps().find(a=>a.name==='browser-tests')!;
  process.env.TASKS_LEGACY_FAMILY_ID=family;
  await page.route('**/api/family/tasks',async route=>{
    try{const token=route.request().headers().authorization?.replace(/^Bearer /,'');const auth=await getAuth(app).verifyIdToken(token!);const profile=(await db.doc(`members/${auth.uid}`).get()).data();const result=await manageTasksAction({db,uid:auth.uid,profile,bucket:getStorage(app).bucket('demo-nasza-rodzina.appspot.com')},route.request().postDataJSON());await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,writesEnabled:true,storageConfigured:true,...result})});}
    catch(error){const e=error as {status?:number;message:string};await route.fulfill({status:e.status||500,contentType:'application/json',body:JSON.stringify({ok:false,error:{message:e.message}})});}
  });
  await login(page,'Zadania');const tasks=page.getByTestId('tasks-v2');
  await tasks.getByRole('button',{name:'Punkty i nagrody',exact:true}).click();await tasks.getByRole('button',{name:'＋ Dodaj nagrodę',exact:true}).click();
  const form=page.getByRole('dialog');await form.getByLabel('Nazwa nagrody',{exact:true}).fill('Nagroda ze zdjęciem');await form.getByLabel('Opis',{exact:true}).fill('Wyjście do kina');await form.getByLabel('Koszt punktowy',{exact:true}).fill('20');
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=3200;c.height=2400;const x=c.getContext('2d')!;x.fillStyle='#fe9876';x.fillRect(0,0,3200,2400);return c.toDataURL('image/png').split(',')[1];});
  await form.getByLabel('Zdjęcie nagrody (opcjonalnie)',{exact:true}).setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});await form.getByRole('button',{name:'Zapisz nagrodę',exact:true}).click();await expect(form).toHaveCount(0);
  const image=tasks.getByRole('img',{name:'Zdjęcie nagrody: Nagroda ze zdjęciem'});await expect(image).toBeVisible();await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>[e.naturalWidth,e.naturalHeight])).toEqual([1600,1200]);
  const reward=(await db.collection('taskRewards').get()).docs.find(d=>d.data().title==='Nagroda ze zdjęciem')!;const path=reward.data().imagePath;
  const [metadata]=await getStorage(app).bucket('demo-nasza-rodzina.appspot.com').file(path).getMetadata();expect(metadata.contentType).toBe('image/jpeg');expect(Number(metadata.size)).toBeLessThan(8*1024*1024);
  page.on('dialog',dialog=>dialog.accept());await image.locator('..').getByRole('button',{name:'Usuń nagrodę',exact:true}).click();await expect(image).toHaveCount(0);expect((await reward.ref.get()).data()?.archived).toBe(true);
  await tasks.getByRole('button',{name:'Zadania rodzinne',exact:true}).click();const remove=tasks.getByRole('button',{name:/Usuń zadanie:/}).first();const title=(await remove.getAttribute('aria-label'))!.replace('Usuń zadanie: ','');await remove.click();await expect(tasks.getByRole('button',{name:`Usuń zadanie: ${title}`,exact:true})).toHaveCount(0);
});
test('dark mode covers page surfaces and settings contain useful working controls',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await login(page,'Ustawienia');
  await page.getByRole('button',{name:'Ciemny',exact:false}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('.settings-dashboard')).not.toContainText('Połączenie nie jest jeszcze dostępne');await expect(page.locator('.settings-dashboard')).not.toContainText('canLogin:');
  await expect(page.getByRole('button',{name:'Zmień e-mail',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Edytuj swój profil',exact:true})).toBeVisible();
  const findings:Record<string,unknown>={};
  for(const name of ['Start','Kalendarz','Zadania','Zakupy','Finanse','Czat','Zdrowie','Szkoła','Rodzina','Ustawienia']){
    console.log('DARK_PAGE',name);
    await page.evaluate(name=>location.hash=encodeURIComponent(name),name);await page.waitForTimeout(250);
    await expect(page.locator('.app-shell')).toBeVisible();await expect(page.locator('.page-content')).toBeVisible();
    const bright=await page.evaluate(()=>[...document.querySelectorAll('.page-content :is(section,article,aside,form,fieldset,input,select,textarea,button)')].filter(e=>{const r=e.getBoundingClientRect();if(r.width*r.height<1500)return false;const c=getComputedStyle(e).backgroundColor.match(/[\d.]+/g)?.map(Number)||[];return c.length>=3&&(c.length<4||c[3]>0.9)&&Math.min(...c.slice(0,3))>185;}).map(e=>({tag:e.tagName,class:e.className,bg:getComputedStyle(e).backgroundColor})).slice(0,15));
    findings[name]=bright;
  }
  console.log('DARK_SURFACES',JSON.stringify(findings));expect(findings).toEqual(Object.fromEntries(Object.keys(findings).map(key=>[key,[]])));
  await page.screenshot({path:'test-results/usability-settings-dark.png',fullPage:true});
});
