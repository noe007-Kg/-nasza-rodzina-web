import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  const layouts=new Map<string,Record<string,unknown>>();
  await page.context().route('**/api/family/home-layout',async route=>{
    const uid=route.request().headers().authorization || 'none';
    const body=route.request().postDataJSON();const value=layouts.get(uid)||{};
    if(body.operation==='save'){value[body.device]=body.tiles;layouts.set(uid,value);}
    await route.fulfill({json:{ok:true,layouts:value,writesEnabled:true}});
  });
  await page.context().route('**/api/family/parcels',route=>route.fulfill({json:{ok:true,configured:true,issue:'',checkedAt:null,parcels:[{number:'600000658493991742009752',status:'Czeka w paczkomacie',updatedAt:'2026-11-03T10:00:00Z',locker:'KOL01A',detailsUrl:'https://inpost.pl',pickup:{code:'012345',phone:'123456789',note:'Buty dla Pawła',qr:''}}]}}));
  await page.route(/https?:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, route => { throw new Error('Remote Firebase forbidden in offline UI test'); });
  await page.goto('/tests/fixtures/family-home.html');
  await expect(page.getByTestId('start-dashboard')).toBeVisible();
});
for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) test(`family home stays compact and readable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await expect(page.locator('.home-person')).toHaveCount(5);
  await expect(page.locator('.home-event')).toHaveCount(4);
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order', 'family,parcels,calendar,tasks,shortcuts,school');
  await expect(page.getByRole('heading', { name: 'Najbliżej w rodzinie' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wszystkie zadania' })).toBeVisible();
  await page.waitForTimeout(200);
  const geometry = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.home-panel')].map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; });
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1, overlap: cards.some((a, i) => cards.some((b, j) => j > i && a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1)), gap: cards[2].y - cards[1].bottom, columns: getComputedStyle(document.querySelector('.home-sections')!).display };
  });
  expect(geometry.overflow).toBe(false); expect(geometry.overlap).toBe(false);
  const square=await page.locator('[data-home-tile=parcels] .home-tile-content').boundingBox();expect(Math.abs(square!.width-square!.height)).toBeLessThan(2);
  if ([390, 1024].includes(width)) await page.screenshot({ path: `test-results/family-home-${width}.png`, fullPage: true });
});
test('accent is UID-specific, persists, switches across tabs, and resets on logout', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-account-accent', 'blue');
  await page.getByRole('button', { name: 'Kolor pink', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-account-accent', 'pink');
  const otherTab = await page.context().newPage();
  await otherTab.goto('/tests/fixtures/family-home.html');
  await expect(otherTab.locator('html')).toHaveAttribute('data-account-accent', 'pink');
  await page.getByRole('button', { name: 'Kolor blue', exact: true }).click();
  await expect(otherTab.locator('html')).toHaveAttribute('data-account-accent', 'blue');
  await page.getByRole('button', { name: 'Kolor pink', exact: true }).click();
  await otherTab.close();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-account-accent', 'pink');
  await page.getByRole('button', { name: 'Zmień konto' }).click();
  await expect(page.getByRole('heading', { name: 'Cześć, Dominika!' })).toBeVisible();
  await page.getByRole('button', { name: 'Kolor blue', exact: true }).click();
  await page.getByRole('button', { name: 'Zmień konto' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-account-accent', 'pink');
  await page.getByRole('button', { name: 'Wyloguj test' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-account-accent');
});
test('edit mode supports arrow buttons, cancel, keyboard drag and confirmed saves', async ({ page }) => {
  await page.setViewportSize({width:390,height:1000});
  await page.getByRole('button',{name:'Dostosuj pulpit'}).click();
  await page.getByRole('button',{name:'Przesuń wcześniej: Paczki InPost',exact:true}).click();
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order','parcels,family,calendar,tasks,shortcuts,school');
  await page.getByRole('button',{name:'Anuluj',exact:true}).click();
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order','family,parcels,calendar,tasks,shortcuts,school');
  await page.getByRole('button',{name:'Dostosuj pulpit'}).click();
  const handle=page.getByRole('button',{name:'Przeciągnij: Najbliżej w rodzinie'});
  await handle.focus();await page.keyboard.press('Space');
  await expect(page.locator('.home-sections')).toHaveAttribute('data-dragging','calendar');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Space');
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order','family,parcels,tasks,calendar,shortcuts,school');
  await page.getByRole('button',{name:'Gotowe',exact:true}).click();
  await expect(page.getByRole('button',{name:'Dostosuj pulpit'})).toBeVisible();
  await page.reload();await expect(page.locator('.home-sections')).toHaveAttribute('data-order','family,parcels,tasks,calendar,shortcuts,school');
});
test('dark appearance and navigation preserve content and calendar owner colors', async ({ page }) => {
  const colors = await page.locator('.home-person').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).style.getPropertyValue('--person-color')));
  await page.getByRole('button', { name: 'Jasny / ciemny' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Kolor pink', exact: true }).click();
  expect(await page.locator('.home-person').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).style.getPropertyValue('--person-color')))).toEqual(colors);
  await page.getByRole('button', { name: 'Zobacz kalendarz' }).click(); await expect(page.getByTestId('destination')).toHaveText('Kalendarz');
  await expect(page.getByText('Odwołane', { exact: true })).toBeVisible();
  await expect(page.getByText('Godziny orientacyjne', { exact: true })).toBeVisible();
});

test('mouse drag reorders sections without opening their content',async({page})=>{
  await page.setViewportSize({width:1024,height:1000});
  await page.getByRole('button',{name:'Dostosuj pulpit'}).click();
  await page.getByRole('combobox',{name:'Rozmiar: Nasza rodzina',exact:true}).selectOption('small');
  const handle=page.getByRole('button',{name:'Przeciągnij: Paczki InPost',exact:true});await handle.scrollIntoViewIfNeeded();
  const a=await handle.boundingBox(),b=await page.locator('[data-home-tile=family]').boundingBox();
  await page.mouse.move(a!.x+a!.width/2,a!.y+a!.height/2);await page.mouse.down();
  await page.mouse.move(a!.x+a!.width/2+12,a!.y+a!.height/2,{steps:3});
  await expect(page.locator('[data-home-tile=parcels]')).toHaveClass(/is-dragging/);
  await page.mouse.move(b!.x+b!.width/2,b!.y+25,{steps:10});await page.mouse.up();
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order','parcels,family,calendar,tasks,shortcuts,school');
  await expect(page.getByTestId('destination')).toHaveText('Start');
});
test('both account accents have readable text in light and dark modes', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const accent of ['blue', 'pink']) {
      await page.getByRole('button', { name: `Kolor ${accent}`, exact: true }).click();
      const ratios = await page.evaluate(() => {
        const luminance = (color: string) => { const v = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
        const ratio = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
        const panel = getComputedStyle(document.querySelector('.home-panel')!);
        return ['.home-panel-heading h2', '.home-section-note', '.home-section-link'].map(selector => ratio(getComputedStyle(document.querySelector(selector)!).color, panel.backgroundColor));
      });
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('all tiles resize to squares, phone and desktop preferences stay separate, and users keep their own layouts',async({page})=>{
  await page.setViewportSize({width:390,height:1000});
  await page.getByRole('button',{name:'Dostosuj pulpit'}).click();
  for(const name of ['Nasza rodzina','Paczki InPost','Najbliżej w rodzinie','Do zrobienia','Szybki dostęp','Szkoła — ostatnie wpisy'])await page.getByRole('combobox',{name:`Rozmiar: ${name}`,exact:true}).selectOption('small');
  await page.getByRole('button',{name:'Gotowe',exact:true}).click();
  await expect(page.getByRole('button',{name:'Dostosuj pulpit'})).toBeVisible();
  const squares=await page.locator('.home-tile-content').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return Math.abs(r.width-r.height);}));
  expect(squares.every(diff=>diff<2)).toBe(true);
  await page.screenshot({path:'test-results/home-editor-squares-390.png',fullPage:true});
  await page.setViewportSize({width:1280,height:1000});
  await expect(page.locator('.home-sections')).toHaveAttribute('data-device','desktop');
  await expect(page.locator('[data-home-tile=calendar]')).toHaveAttribute('data-size','rectangle');
  await page.getByRole('button',{name:'Dostosuj pulpit'}).click();
  await page.getByRole('combobox',{name:'Rozmiar: Najbliżej w rodzinie',exact:true}).selectOption('large');
  await page.getByRole('button',{name:'Gotowe',exact:true}).click();
  await page.reload();await expect(page.locator('[data-home-tile=calendar]')).toHaveAttribute('data-size','large');
  await page.setViewportSize({width:390,height:1000});
  await expect(page.locator('[data-home-tile=calendar]')).toHaveAttribute('data-size','small');
  await page.getByRole('button',{name:'Zmień konto'}).click();
  await expect(page.locator('[data-home-tile=calendar]')).toHaveAttribute('data-size','rectangle');
  await page.getByRole('button',{name:'Zmień konto'}).click();
  await expect(page.locator('[data-home-tile=calendar]')).toHaveAttribute('data-size','small');
});
test('small parcel tile opens its details and pickup code with one dialog at a time',async({page})=>{
  await page.setViewportSize({width:390,height:1000});
  await page.getByRole('button',{name:'Otwórz paczki'}).click();
  let dialog=page.getByRole('dialog');await expect(dialog).toHaveCount(1);await expect(dialog).toContainText('Buty dla Pawła');
  await dialog.getByRole('button',{name:'Kod odbioru i QR',exact:true}).click();
  dialog=page.getByRole('dialog');await expect(dialog).toHaveCount(1);await expect(dialog).toContainText('012345');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toContainText('Paczki InPost');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('touch dragging left changes the draft and reset can be cancelled',async({page})=>{
  await page.setViewportSize({width:390,height:1000});
  await page.getByRole('button',{name:'Dostosuj pulpit'}).click();
  await page.getByRole('combobox',{name:'Rozmiar: Nasza rodzina',exact:true}).selectOption('small');
  const source=page.getByRole('button',{name:'Przeciągnij: Paczki InPost',exact:true});
  await source.scrollIntoViewIfNeeded();
  const from=await source.boundingBox(),to=await page.getByRole('button',{name:'Przeciągnij: Nasza rodzina',exact:true}).boundingBox();
  const cdp=await page.context().newCDPSession(page);
  const touch=(x:number,y:number)=>({x,y,id:1});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(from!.x+from!.width/2,from!.y+from!.height/2)]});
  await page.waitForTimeout(500);await expect(page.locator('.home-sections')).toHaveAttribute('data-dragging','parcels');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(to!.x+to!.width/2,to!.y+to!.height/2)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order','parcels,family,calendar,tasks,shortcuts,school');
  await page.getByRole('button',{name:'Gotowe',exact:true}).click();
  await expect(page.getByRole('button',{name:'Dostosuj pulpit'})).toBeVisible();
  await page.getByRole('button',{name:'Dostosuj pulpit'}).click();
  await page.getByRole('button',{name:'Przywróć domyślny układ',exact:true}).click();
  await page.getByRole('button',{name:'Anuluj',exact:true}).click();
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order','parcels,family,calendar,tasks,shortcuts,school');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('failed save keeps the draft available and does not change the persisted layout',async({page})=>{
  await page.route('**/api/family/home-layout',async route=>{
    if(route.request().postDataJSON().operation==='save')await route.fulfill({status:503,json:{ok:false,error:{message:'Zapis chwilowo niedostępny.'}}});
    else await route.fallback();
  });
  await page.getByRole('button',{name:'Dostosuj pulpit'}).click();
  await page.getByRole('combobox',{name:'Rozmiar: Paczki InPost',exact:true}).selectOption('large');
  await page.getByRole('button',{name:'Gotowe',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Zapis chwilowo niedostępny');
  await expect(page.getByRole('combobox',{name:'Rozmiar: Paczki InPost',exact:true})).toHaveValue('large');
  await page.reload();await expect(page.locator('[data-home-tile=parcels]')).toHaveAttribute('data-size','small');
});
