import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { accounts, fixtureDatabase, password, seedEmulators, todayKey } from './emulator-fixtures';

type Account = (typeof accounts)[keyof typeof accounts];
const privateTitle = 'Wiadomość nauczyciela tylko dla rodziców — test układu';
const privateBody = 'Prywatna treść rodziców, niewidoczna w szkolnym widoku ucznia.';
const gradeTitle = '5 · odpowiedź ustna';
const variants = [
  { name: 'telefon pionowo', slug: 'phone-portrait', width: 390, height: 844, columns: 2 },
  { name: 'telefon poziomo', slug: 'phone-landscape', width: 844, height: 390, columns: 3 },
  // The existing sidebar occupies 184px; the remaining school container is
  // under 700px wide. Two columns are intentional at this portrait size.
  { name: 'tablet pionowo', slug: 'tablet-portrait', width: 900, height: 1440, columns: 2 },
  { name: 'desktop poziomo', slug: 'desktop-landscape', width: 1440, height: 900, columns: 4 },
] as const;

async function seedSchoolRecords() {
  const db = fixtureDatabase();
  const now = Date.now();
  const day = todayKey();
  const batch = db.batch();
  const base = {
    person: 'Nikodem', date: day, time: '', endTime: '', weekday: 0, note: '',
    source: 'eduvulcan', sourceProfileId: 'layout-nikodem-sp4',
    createdBy: accounts.mother.uid, createdAt: Timestamp.fromMillis(now), syncedAt: Timestamp.fromMillis(now),
  };
  for (let index = 0; index < 8; index += 1) {
    batch.set(db.doc(`schoolItems/layout-grade-${index}`), {
      ...base, type: 'grade', subject: index === 7 ? 'Matematyka' : 'Edukacja',
      title: index === 7 ? gradeTitle : `${4 + index % 2} · praca na lekcji`,
      createdAt: Timestamp.fromMillis(now + index),
    });
  }
  for (let index = 0; index < 3; index += 1) {
    batch.set(db.doc(`schoolItems/layout-homework-${index}`), {
      ...base, type: 'homework', subject: 'Matematyka', title: `Ćwiczenia ${index + 1}`,
    });
  }
  for (let index = 0; index < 2; index += 1) {
    batch.set(db.doc(`schoolItems/layout-test-${index}`), {
      ...base, type: 'test', subject: index ? 'Język angielski' : 'Matematyka',
      title: index ? 'Słówka' : 'Dodawanie i odejmowanie',
    });
  }
  batch.set(db.doc('schoolItems/layout-dated-lesson'), {
    ...base, type: 'lesson', subject: 'Matematyka', title: 'Matematyka',
    time: '08:55', endTime: '09:40', note: 'Sala 106',
  });
  // A sibling's records must never inflate the active student's dashboard.
  for (let index = 0; index < 11; index += 1) {
    batch.set(db.doc(`schoolItems/layout-sibling-grade-${index}`), {
      ...base, person: 'Paweł', type: 'grade', subject: 'Fizyka', title: 'Ocena Pawła',
      sourceProfileId: 'layout-pawel',
    });
  }
  batch.set(db.doc('schoolParentMessages/layout-parent-message'), {
    ...base, type: 'message', subject: '', title: privateTitle, note: privateBody,
  });
  await batch.commit();
}

async function mockExternalResponses(page: Page) {
  const operations: string[] = [];
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseapp\.com|firebasestorage\.app)\//, () => {
    throw new Error('School layout test attempted production Firebase access.');
  });
  await page.route('**/api/eduvulcan/**', (route) => {
    const request = route.request();
    const operation = new URL(request.url()).pathname.split('/').at(-1) || '';
    operations.push(operation);
    expect(request.method()).toBe('GET');
    expect(operation).toBe('status');
    expect(request.headers().authorization).toMatch(/^Bearer\s+\S+$/);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: {
        configured: true, state: 'connected', connectionScope: 'family', profiles: [{
          id: 'layout-nikodem-sp4', studentName: 'Nikodem', schoolName: 'Szkoła Podstawowa nr 4',
          schoolSymbol: 'SP4', className: '1B', academicYear: '2026/2027',
        }], selectedStudent: { profileId: 'layout-nikodem-sp4', personKey: 'Nikodem' },
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        lastSyncAt: new Date(Date.now() - 60_000).toISOString(),
        lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
        // Counts returned by sync describe that operation, not Firestore totals.
        // Deliberately different numbers prove the dashboard uses stored records.
        counts: { grades: 99, homework: 99, tests: 99, messages: 99 },
      } }),
    });
  });
  return operations;
}

async function loginSchool(page: Page, account: Account = accounts.parent) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  const school = page.locator('.sidebar-nav').getByRole('button', { name: 'Szkoła', exact: true });
  if (await school.isVisible()) await school.click();
  else {
    await page.getByRole('button', { name: 'Więcej', exact: true }).click();
    await page.locator('.mobile-more').getByRole('button', { name: /Szkoła$/ }).click();
  }
  await expect(page.locator('.school-heading h1')).toContainText('Szkoła');
  await expect(page.locator('.school-loading')).toHaveCount(0);
  await page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true }).click();
  await expect(page.getByTestId('school-stat-grades')).toContainText('Oceny');
  await page.evaluate(() => document.fonts.ready);
}

async function gridGeometry(page: Page) {
  return page.locator('.school-dashboard-grid').evaluate((grid) => {
    const cards = Array.from(grid.querySelectorAll('[data-testid^="school-stat-"]'));
    const boxes = cards.map((card) => {
      const box = card.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    const gap = parseFloat(getComputedStyle(grid).columnGap);
    const trackWidth = Math.min(...boxes.map((box) => box.width));
    const width = grid.getBoundingClientRect().width;
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    return {
      width,
      // A wide today card occupies two tracks. Counting cards in its row
      // would incorrectly report one column on a two-column phone layout.
      columns: Math.round((width + gap) / (trackWidth + gap)),
      todaySpan: Math.round((boxes[0].width + gap) / (trackWidth + gap)),
      occupiedCells: boxes.reduce((total, box) => total + Math.round((box.width + gap) / (trackWidth + gap)), 0),
      boxes,
      // Chromium reserves the classic scrollbar's width for the existing
      // scrollbar-gutter:stable; WebKit uses an overlay scrollbar. The mobile
      // shell already uses scrollbar-gutter:auto in both engines.
      reservedViewportGutter: Math.max(0, window.innerWidth - root.clientWidth,
        window.innerWidth - root.getBoundingClientRect().width,
        window.innerWidth - parseFloat(rootStyle.width)),
      pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    };
  });
}

async function expectRecordCounts(page: Page) {
  await expect(page.getByTestId('school-stat-grades').locator('.family-stat-card__value')).toHaveText('8');
  await expect(page.getByTestId('school-stat-homework').locator('.family-stat-card__value')).toHaveText('3');
  await expect(page.getByTestId('school-stat-tests').locator('.family-stat-card__value')).toHaveText('2');
  await expect(page.getByTestId('school-stat-lessons').locator('.family-stat-card__value')).toHaveText('2');
}

test.beforeEach(async () => {
  await seedEmulators();
  await seedSchoolRecords();
});

for (const variant of variants) {
  test(`szkolny dashboard: ${variant.name}, dane w kaflach i brak poziomego przewijania strony`, async ({ page, browserName }, testInfo) => {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    const calls = await mockExternalResponses(page);
    await loginSchool(page);
    await expectRecordCounts(page);
    await expect(page.locator('.school-student-panel')).toContainText('Nikodem');
    await expect(page.locator('.school-student-panel')).toContainText('Szkoła Podstawowa nr 4');
    await expect(page.locator('.school-student-panel')).toContainText('Połączono');
    const geometry = await gridGeometry(page);
    expect(geometry.columns).toBe(variant.columns);
    expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
    expect(geometry.boxes).toHaveLength(7);
    expect(geometry.todaySpan).toBe(2);
    expect(geometry.occupiedCells).toBe(8);
    expect(geometry.boxes.every((box) => box.height >= 44 && box.width >= 100)).toBe(true);
    await expect(page.locator('.school-dashboard-grid svg').first()).toBeVisible();
    const visual = await page.getByTestId('school-stat-grades').evaluate((card) => {
      const style = getComputedStyle(card);
      return { radius: parseFloat(style.borderTopLeftRadius), background: style.backgroundColor };
    });
    expect(visual.radius).toBeGreaterThanOrEqual(20);
    expect(visual.radius).toBeLessThanOrEqual(24);
    const backgroundChannels = visual.background.match(/[\d.]+/g)?.map(Number) || [];
    expect(backgroundChannels.slice(0, 3).every((channel) => channel >= 220)).toBe(true);
    // The visual student header observes the existing status response; it must
    // not fetch or synchronize separately as a side effect of its rendering.
    expect(calls).toEqual(['status']);
    await testInfo.attach('layout geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
    if (browserName === 'chromium') {
      await mkdir('preview', { recursive: true });
      await page.screenshot({ path: `preview/school-${variant.slug}.png`, fullPage: true });
    }
  });
}

test('szkolne kafle zmieniają profil i otwierają istniejące szczegóły z zachowaniem fokusu', async ({ page }) => {
  const calls = await mockExternalResponses(page);
  await loginSchool(page);
  await expectRecordCounts(page);
  await expect(page.getByTestId('school-stat-grades')).toContainText('Matematyka');
  await expect(page.getByTestId('school-stat-grades')).toContainText(gradeTitle);
  const profiles = page.locator('.school-students');
  await expect(profiles.getByRole('button', { name: 'Nikodem', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await profiles.getByRole('button', { name: 'Paweł', exact: true }).click();
  await expect(page.getByTestId('school-stat-grades').locator('.family-stat-card__value')).toHaveText('11');
  await expect(page.locator('.school-student-panel')).not.toContainText('Szkoła Podstawowa nr 4');
  await profiles.getByRole('button', { name: 'Nikodem', exact: true }).click();
  await expectRecordCounts(page);
  await page.getByTestId('school-stat-grades').click();
  const entry = page.locator('.school-record-list .school-entry').filter({ hasText: gradeTitle });
  await expect(entry).toBeVisible();
  await entry.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: gradeTitle, exact: true })).toBeVisible();
  await expect(dialog).toContainText('Matematyka');
  await expect(dialog).toContainText('tylko do odczytu');
  await expect(dialog.getByRole('button', { name: 'Edytuj wpis', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await page.getByTestId('school-stat-messages').click();
  const message = page.locator('.school-record-list .school-entry').filter({ hasText: privateTitle });
  await expect(message).toBeVisible();
  await message.click();
  await expect(page.getByRole('dialog')).toContainText(privateBody);
  await page.getByRole('dialog').getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(message).toBeFocused();
  expect(calls).toEqual(['status']);
});

test('szkolny dashboard dziecka pokazuje tylko własny profil i nie pobiera wiadomości rodzica ani połączenia', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockExternalResponses(page);
  await loginSchool(page, accounts.child);
  await expectRecordCounts(page);
  await expect(page.locator('.school-students').getByRole('button')).toHaveCount(1);
  await expect(page.locator('.school-students').getByRole('button', { name: 'Nikodem', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('school-stat-messages')).toHaveCount(0);
  await expect(page.locator('.edu-vulcan-connection')).toHaveCount(0);
  await expect(page.getByText(privateTitle, { exact: false })).toHaveCount(0);
  await expect(page.getByText(privateBody, { exact: false })).toHaveCount(0);
  await expect(page.getByText('Ocena Pawła', { exact: false })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(privateBody);
  const geometry = await gridGeometry(page);
  expect(geometry.columns).toBe(2);
  expect(geometry.boxes).toHaveLength(6);
  expect(geometry.todaySpan).toBe(2);
  expect(geometry.occupiedCells).toBe(7);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  expect(calls).toEqual([]);
});

test('Safari i Chrome zachowują ten sam układ oraz geometrię kafli przy równej szerokości kontenera', async ({ page, browserName, playwright }, testInfo) => {
  const otherBrowser = await (browserName === 'chromium' ? playwright.webkit : playwright.chromium).launch();
  const otherContext = await otherBrowser.newContext({
    baseURL: 'http://127.0.0.1:5173', locale: 'pl-PL', timezoneId: 'Europe/Warsaw',
  });
  try {
    const otherPage = await otherContext.newPage();
    await Promise.all([mockExternalResponses(page), mockExternalResponses(otherPage)]);
    await loginSchool(page);
    await loginSchool(otherPage);
    for (const variant of variants) {
      await Promise.all([page.setViewportSize(variant), otherPage.setViewportSize(variant)]);
      await Promise.all([expectRecordCounts(page), expectRecordCounts(otherPage)]);
      const [first, second] = await Promise.all([gridGeometry(page), gridGeometry(otherPage)]);
      expect(first.columns).toBe(variant.columns);
      expect(second.columns).toBe(first.columns);
      // First prove any difference at the same viewport is exactly the native
      // scrollbar gutter, rather than a browser-specific school breakpoint.
      expect(Math.abs((first.width + first.reservedViewportGutter)
        - (second.width + second.reservedViewportGutter))).toBeLessThanOrEqual(1);
      expect(first.pageOverflow).toBeLessThanOrEqual(1);
      expect(second.pageOverflow).toBeLessThanOrEqual(1);
      await testInfo.attach(`native layout ${variant.slug}`, {
        body: JSON.stringify({ [browserName]: first, [browserName === 'chromium' ? 'webkit' : 'chromium']: second }),
        contentType: 'application/json',
      });
      // The component contract is based on available container width. Match
      // that width in test DOM only, then compare pixels without loosening the
      // tolerance or changing the application's shared scrollbar behaviour.
      const commonWidth = Math.min(first.width, second.width);
      const matchContainerWidth = async (target: Page) => target.locator('.school-module').evaluate((school, width) => {
        const grid = school.querySelector('.school-dashboard-grid')!;
        const inset = school.getBoundingClientRect().width - grid.getBoundingClientRect().width;
        (school as HTMLElement).style.width = `${width + inset}px`;
      }, commonWidth);
      await Promise.all([matchContainerWidth(page), matchContainerWidth(otherPage)]);
      const [matchedFirst, matchedSecond] = await Promise.all([gridGeometry(page), gridGeometry(otherPage)]);
      expect(Math.abs(matchedFirst.width - matchedSecond.width)).toBeLessThanOrEqual(1);
      expect(matchedFirst.columns).toBe(variant.columns);
      expect(matchedSecond.columns).toBe(matchedFirst.columns);
      expect(first.boxes).toHaveLength(second.boxes.length);
      for (let index = 0; index < first.boxes.length; index += 1) {
        expect(Math.abs(matchedFirst.boxes[index].width - matchedSecond.boxes[index].width)).toBeLessThanOrEqual(1);
        expect(Math.abs(matchedFirst.boxes[index].height - matchedSecond.boxes[index].height)).toBeLessThanOrEqual(1);
        const firstOffset = matchedFirst.boxes[index].x - matchedFirst.boxes[0].x;
        const secondOffset = matchedSecond.boxes[index].x - matchedSecond.boxes[0].x;
        expect(Math.abs(firstOffset - secondOffset)).toBeLessThanOrEqual(1);
        const firstRowOffset = matchedFirst.boxes[index].y - matchedFirst.boxes[0].y;
        const secondRowOffset = matchedSecond.boxes[index].y - matchedSecond.boxes[0].y;
        expect(Math.abs(firstRowOffset - secondRowOffset)).toBeLessThanOrEqual(1);
      }
      expect(matchedFirst.pageOverflow).toBeLessThanOrEqual(1);
      expect(matchedSecond.pageOverflow).toBeLessThanOrEqual(1);
      if (browserName === 'chromium' && variant.slug === 'desktop-landscape') {
        await mkdir('preview', { recursive: true });
        await page.locator('.school-dashboard-grid').screenshot({ path: 'preview/school-dashboard.png' });
      }
      await Promise.all([page.locator('.school-module').evaluate((school) => { (school as HTMLElement).style.removeProperty('width'); }),
        otherPage.locator('.school-module').evaluate((school) => { (school as HTMLElement).style.removeProperty('width'); })]);
    }
  } finally {
    await otherContext.close();
    await otherBrowser.close();
  }
});
