import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.route(/https?:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, route => { throw new Error('Remote Firebase forbidden in offline UI test'); });
  await page.goto('/tests/fixtures/family-home.html');
  await expect(page.getByTestId('start-dashboard')).toBeVisible();
});
for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) test(`family home stays compact and readable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await expect(page.locator('.home-person')).toHaveCount(5);
  await expect(page.locator('.home-event')).toHaveCount(4);
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order', 'calendar,tasks,shortcuts');
  await expect(page.getByRole('heading', { name: 'Najbliżej w rodzinie' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wszystkie zadania' })).toBeVisible();
  await page.waitForTimeout(200);
  const geometry = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.home-panel')].map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; });
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1, overlap: cards.some((a, i) => cards.some((b, j) => j > i && a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1)), gap: cards[2].y - cards[1].bottom, columns: getComputedStyle(document.querySelector('.home-sections')!).display };
  });
  expect(geometry.overflow).toBe(false); expect(geometry.overlap).toBe(false);
  if (geometry.columns === 'grid') expect(geometry.gap).toBeGreaterThanOrEqual(17);
  if (geometry.columns === 'grid') expect(geometry.gap).toBeLessThanOrEqual(20);
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
test('keyboard drag changes only section order and survives reload; family stays pinned', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const handle = page.getByRole('button', { name: 'Przenieś sekcję: Najbliżej w rodzinie' });
  await handle.focus(); await page.keyboard.press('Space');
  await expect(page.getByTestId('home-section-calendar')).toHaveClass(/is-dragging/);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Nad sekcją: Do zrobienia.', { exact: true })).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order', 'tasks,calendar,shortcuts');
  await page.reload(); await expect(page.locator('.home-sections')).toHaveAttribute('data-order', 'tasks,calendar,shortcuts');
  const family = await page.locator('.home-family').boundingBox(), sections = await page.locator('.home-sections').boundingBox();
  expect(family!.y).toBeLessThan(sections!.y);
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

test('mouse drag reorders sections without opening their content', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  const a = await page.getByRole('button', { name: 'Przenieś sekcję: Najbliżej w rodzinie' }).boundingBox();
  const b = await page.getByTestId('home-section-tasks').boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2); await page.mouse.down();
  await page.mouse.move(a!.x + a!.width / 2 + 12, a!.y + a!.height / 2, { steps: 3 });
  await expect(page.getByTestId('home-section-calendar')).toHaveClass(/is-dragging/);
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 10 });
  await expect(page.getByText('Nad sekcją: Do zrobienia.', { exact: true })).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order', 'tasks,calendar,shortcuts');
  await expect(page.getByTestId('destination')).toHaveText('Start');
});
test('touch hold on handle reorders sections while content remains scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const handle = page.getByRole('button', { name: 'Przenieś sekcję: Do zrobienia' });
  await handle.evaluate(node => node.scrollIntoView({ block: 'start' }));
  await handle.evaluate(node => {
    const r = node.getBoundingClientRect();
    const touch = new Touch({ identifier: 1, target: node, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
    node.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], changedTouches: [touch], targetTouches: [touch] }));
  });
  await expect(page.getByTestId('home-section-tasks')).toHaveClass(/is-dragging/);
  await page.getByTestId('home-section-shortcuts').evaluate(node => {
    const r = node.getBoundingClientRect(); const handle = document.querySelector('[aria-label="Przenieś sekcję: Do zrobienia"]')!; const touch = new Touch({ identifier: 1, target: handle, clientX: r.x + r.width / 2, clientY: r.y + Math.min(100, r.height / 2) });
    handle.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch], changedTouches: [touch] }));
  });
  await expect(page.getByText('Nad sekcją: Szybki dostęp.', { exact: true })).toHaveCount(1);
  await page.evaluate(() => document.querySelector('[aria-label="Przenieś sekcję: Do zrobienia"]')!.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [] })));
  await expect(page.locator('.home-sections')).toHaveAttribute('data-order', 'calendar,shortcuts,tasks');
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
