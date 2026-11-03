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
