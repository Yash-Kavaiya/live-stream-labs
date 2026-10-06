import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

/** How far the page can scroll sideways. Zero means nothing sticks out of the viewport. */
const sidewaysOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * The control bar must not sit on top of studio content. On desktop the scrolling area ends above
 * it; on smaller screens it is fixed to the bottom and the page leaves room for it at the end.
 */
async function expectControlsClear(page: Page) {
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  const gap = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const bar = document.querySelector('[data-testid=control-bar]')!.getBoundingClientRect();
    const fixed = getComputedStyle(document.querySelector('[data-testid=control-bar]')!).position === 'fixed';
    const above = document.querySelector(fixed ? '.studio-side' : '.studio-scroll')!.getBoundingClientRect();
    return { clear: bar.top - above.bottom, left: bar.left, right: window.innerWidth - bar.right };
  });
  expect(gap.clear).toBeGreaterThanOrEqual(0);
  expect(gap.left).toBeGreaterThanOrEqual(0);
  expect(gap.right).toBeGreaterThanOrEqual(0);
  // Every control is inside the bar, not pushed off the edge of the screen.
  await expect(page.getByTestId('leave')).toBeInViewport();
  await expect(page.getByTestId('toggle-mic')).toBeInViewport();
}

test('studio fits phone, tablet and desktop for host and guest; device options work', async ({ page, browser }) => {
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Hana Host');
  await field(page, 'email').fill(`responsive-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);
  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'A fairly long title for a responsive show' } })).json();

  // --- Green room: options are offered before joining ---
  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('green-room-options').click();
  await expect(page.getByTestId('mic-noise')).toBeVisible();
  await expect(page.getByTestId('mic-level')).toBeVisible();
  await page.getByTestId('enter-studio').click();
  await expect(page.getByTestId('studio')).toHaveAttribute('data-status', 'connected');
  await page.getByTestId('source-cam').waitFor();

  // A shared image adds a second backstage tile, as in a real show.
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.getByTestId('share-image').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: pixel });
  await expect(page.locator('.backstage > *')).toHaveCount(2);

  // --- Host at every size ---
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await expectControlsClear(page);
    await page.screenshot({ path: `test-results/screens/responsive-host-${size.name}.png` });
  }

  // --- Microphone options: the menu opens, a switch is remembered, the meter is there ---
  await page.getByTestId('mic-options').click();
  await expect(page.getByTestId('mic-menu')).toBeVisible();
  await expect(page.getByTestId('mic-level')).toBeVisible();
  await page.getByTestId('mic-noise').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mic-prefs')!).noiseSuppression)).toBe(false);
  // The microphone is still live after being restarted with the new processing.
  await expect
    .poll(() => page.evaluate(() => navigator.mediaDevices.enumerateDevices().then((d) => d.some((x) => x.kind === 'audioinput'))))
    .toBe(true);
  await expect(page.locator('.snackbar.error')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mic-menu')).toHaveCount(0);

  // --- Camera background ---
  await page.getByTestId('camera-options').click();
  await expect(page.getByTestId('camera-menu')).toBeVisible();
  if ((await page.getByTestId('effects-unsupported').count()) === 0) {
    await page.getByTestId('effect-blur-medium').click();
    await page.getByTestId('effect-blur-strong').click();
    await expect(page.getByTestId('effect-blur-strong')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('effect-studio').click();
    await expect(page.getByTestId('effect-studio')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'test-results/screens/responsive-camera-effect.png' });
    // A failed effect switches itself off and says so; neither may have happened.
    await expect(page.getByTestId('effect-studio')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.snackbar.error')).toHaveCount(0);
    await page.getByTestId('effect-none').click();
  }
  await page.keyboard.press('Escape');

  // --- Clean template: a built-in background picture, then removed ---
  const saved = async () => (await (await page.request.post(`/api/broadcasts/${broadcast.id}/session`)).json()).scene;
  await page.getByTestId('tab-template').click();
  await page.getByTestId('background-sunset').click();
  await expect(page.getByTestId('background-preview')).toBeVisible();
  await expect.poll(async () => (await saved()).brand.backgroundUrl).toMatch(/^\/assets\//);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/screens/responsive-background.png' });
  await page.getByTestId('background-remove').click();
  await expect.poll(async () => (await saved()).brand.backgroundUrl).toBeNull();

  // --- Guest on a phone ---
  await page.getByTestId('invite').click();
  await expect(field(page, 'invite-url')).toHaveValue(/\/join\//);
  const inviteUrl = await field(page, 'invite-url').inputValue();
  await page.keyboard.press('Escape');

  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: SIZES[0] });
  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  expect(await sidewaysOverflow(guest)).toBeLessThanOrEqual(0);
  await guest.screenshot({ path: 'test-results/screens/responsive-guest-green-room.png' });
  await field(guest, 'guest-name').fill('Gus Guest');
  await guest.getByTestId('enter-studio').click();
  await expect(guest.getByTestId('studio')).toHaveAttribute('data-status', 'connected');
  await guest.getByTestId('source-cam').first().waitFor();
  await guest.bringToFront();
  for (const size of SIZES) {
    await guest.setViewportSize(size);
    await expectControlsClear(guest);
    await guest.screenshot({ path: `test-results/screens/responsive-guest-${size.name}.png` });
  }

  // The options sheet on a phone stays inside the screen.
  await guest.setViewportSize(SIZES[0]!);
  await guest.getByTestId('camera-options').click();
  const sheet = (await guest.getByTestId('camera-menu').boundingBox())!;
  expect(sheet.x).toBeGreaterThanOrEqual(0);
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(SIZES[0]!.width);
  expect(sheet.y).toBeGreaterThanOrEqual(0);
  await guest.screenshot({ path: 'test-results/screens/responsive-guest-camera-sheet.png' });

  await guestContext.close();
});
