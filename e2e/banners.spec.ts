import { expect, test } from '@playwright/test';

const field = (page, id) => page.getByTestId(id).locator('input, textarea').first();

test('banners in different positions show together; same position replaces', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Hana Host');
  await field(page, 'email').fill(`banners-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);
  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'Banners' } })).json();

  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('source-cam').waitFor();
  await page.getByTestId('tab-banners').click();

  const showing = page.locator('[data-testid=banner-toggle][aria-pressed=true]');
  const program = (name: string) =>
    page.getByTestId('program-canvas').screenshot({ path: `test-results/screens/banners-${name}.png` });

  // Five presets, five different positions: all stay up.
  for (const preset of ['Subscribe', 'Guest', 'Topic', 'Q&A', 'Ticker']) await page.getByTestId(`preset-${preset}`).click();
  await expect(showing).toHaveCount(5);
  await page.waitForTimeout(1200);
  await program('all');

  // Another bottom-left banner takes the guest banner's place.
  await page.getByTestId('preset-Follow').click();
  await expect(showing).toHaveCount(5);
  await expect(page.getByTestId('banner-toggle').nth(1)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1200);
  await program('social');

  // A hand-made two-line banner.
  await page.getByTestId('banner-style-title').click();
  await field(page, 'banner-text').fill('Chapter two');
  await field(page, 'banner-subtitle').fill('Where it gets interesting');
  await page.getByTestId('banner-add').click();
  await page.getByTestId('banner-toggle').last().click();
  await expect(showing).toHaveCount(6);
  await page.waitForTimeout(1200);
  await program('title');

  // The server keeps the set, so guests and a reload see the same banners.
  const saved = async () => (await (await page.request.post(`/api/broadcasts/${broadcast.id}/session`)).json()).scene;
  await expect.poll(async () => (await saved()).activeBannerIds.length).toBe(6);

  await page.getByTestId('banner-hide-all').click();
  await expect(showing).toHaveCount(0);
  await expect.poll(async () => (await saved()).activeBannerIds.length).toBe(0);
});
