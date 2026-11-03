import { test, expect } from '@playwright/test';
test('add, persistence, active tile, no invented ETA, archive and complete disappearance',async({page})=>{
  let parcels:unknown[]=[];
  await page.route('**/api/family/parcels',async route=>{
    const body=route.request().postDataJSON();
    if(body.operation==='add') parcels=[{number:body.number,status:'Czeka w paczkomacie',updatedAt:'2026-11-03T10:00:00Z',locker:'KOL01A',detailsUrl:`https://inpost.pl/sledzenie-przesylek?number=${body.number}`}];
    if(body.operation==='archive') parcels=[];
    await route.fulfill({json:{ok:true,parcels,configured:true,issue:'',checkedAt:null}});
  });
  await page.goto('/tests/fixtures/inpost.html');
  await expect(page.getByText('Nie śledzicie aktywnych paczek.',{exact:false})).toBeVisible();
  await expect(page.getByTestId('inpost-tile')).toHaveCount(0);
  await page.getByLabel('Numer przesyłki InPost Polska').fill('600000658493991742009752');
  await page.getByRole('button',{name:'Dodaj paczkę',exact:true}).click();
  await expect(page.getByTestId('inpost-tile')).toBeVisible();
  await expect(page.getByTestId('inpost-tile')).toContainText('Czeka w paczkomacie');
  await expect(page.getByTestId('inpost-tile')).toContainText('KOL01A');
  await expect(page.getByTestId('inpost-tile')).toContainText('•••• 009752');
  await expect(page.getByTestId('inpost-tile')).not.toContainText('Przewidywana');
  await page.reload();await expect(page.getByTestId('inpost-tile')).toBeVisible();
  for(const width of [390,1024]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/inpost-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'Zakończ śledzenie',exact:false}).click();
  await expect(page.getByTestId('inpost-tile')).toHaveCount(0);
  await expect(page.getByTestId('next-section')).toBeVisible();
});
test('missing tracking data explains the problem and retains the last confirmed status',async({page})=>{
  await page.route('**/api/family/parcels',route=>route.fulfill({json:{ok:true,configured:true,issue:'not-found',checkedAt:'2026-11-03T10:00:00Z',parcels:[{number:'600000658493991742009752',status:'W drodze',updatedAt:'2026-11-03T08:00:00Z',locker:'KOL01A',detailsUrl:'https://inpost.pl/sledzenie-przesylek?number=600000658493991742009752'}]}}));
  await page.goto('/tests/fixtures/inpost.html');
  const tile=page.getByTestId('inpost-tile');
  await expect(tile).toContainText('W drodze');
  await expect(tile).toContainText('Sprawdź numer');
  await expect(tile).not.toContainText('czekają na połączenie API');
  await expect(tile).toContainText('Ostatnia próba odczytu');
});
test('pickup code, note and private QR survive reload, enlarge on tap and can be cleared',async({page})=>{
  const number='600000658493991742009752';
  const parcel={number,status:'Czeka w paczkomacie',updatedAt:'2026-11-03T10:00:00Z',locker:'KOL01A',detailsUrl:'https://inpost.pl',pickup:{code:'',phone:'',note:'',qr:''}};
  let failSave=false;
  await page.route('**/api/family/parcels',async route=>{
    const body=route.request().postDataJSON();
    if(body.operation==='pickup') {
      if(failSave){await route.fulfill({status:503,json:{ok:false,error:{message:'Nie udało się zapisać danych odbioru.'}}});return;}
      parcel.pickup=body.pickup;
    }
    await route.fulfill({json:{ok:true,parcels:[parcel],configured:true,issue:'',checkedAt:null}});
  });
  await page.goto('/tests/fixtures/inpost.html');
  const tile=page.getByTestId('inpost-tile');
  await tile.getByRole('button',{name:'Dodaj kod / QR / notatkę'}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('Kod odbioru (6 cyfr)',{exact:true}).fill('012345');
  await dialog.getByLabel('Telefon do odbioru',{exact:false}).fill('123456789');
  await dialog.getByLabel('Notatka do paczki').fill('Buty dla Pawła — odbiera Dominika');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6e0AAAAASUVORK5CYII=','base64');
  await dialog.getByLabel('Zdjęcie kodu QR',{exact:false}).setInputFiles({name:'kod.png',mimeType:'image/png',buffer:png});
  await expect(dialog.getByAltText('Podgląd dodanego kodu QR')).toBeVisible();
  failSave=true;
  await dialog.getByRole('button',{name:'Zapisz dane odbioru'}).click();
  await expect(dialog.getByRole('alert')).toContainText('Nie udało się zapisać');
  await expect(dialog.getByLabel('Kod odbioru (6 cyfr)',{exact:true})).toHaveValue('012345');
  failSave=false;
  await dialog.getByRole('button',{name:'Zapisz dane odbioru'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(tile).toContainText('012345');await expect(tile).toContainText('odbiera Dominika');
  expect(parcel.pickup.qr).toMatch(/^data:image\/png;base64,/);
  await page.reload();await expect(tile).toContainText('012345');
  for(const width of [390,1024]) {
    await page.setViewportSize({width,height:1000});
    const trigger=tile.getByRole('button',{name:'Powiększ kod QR',exact:false});
    await trigger.click();dialog=page.getByRole('dialog');
    await expect(dialog).toContainText('012345');await expect(dialog).toContainText('123456789');
    const full=dialog.getByAltText('Kod QR do odbioru paczki');await expect(full).toBeVisible();
    expect((await full.boundingBox())!.width).toBeGreaterThan(112);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/inpost-pickup-${width}.png`,fullPage:true});
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  }
  await tile.getByRole('button',{name:'Edytuj dane odbioru'}).click();dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Usuń zdjęcie QR'}).click();
  await dialog.getByLabel('Kod odbioru (6 cyfr)',{exact:true}).fill('');
  await dialog.getByLabel('Telefon do odbioru',{exact:false}).fill('');
  await dialog.getByLabel('Notatka do paczki').fill('');
  await dialog.getByRole('button',{name:'Zapisz dane odbioru'}).click();
  await expect(tile.getByRole('button',{name:'Dodaj kod / QR / notatkę'})).toBeVisible();
  await expect(tile.getByAltText('Kod QR odbioru')).toHaveCount(0);
});
