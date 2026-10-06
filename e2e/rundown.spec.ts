import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

test('the host runs the daily rundown from the News tab', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Nina News');
  await field(page, 'email').fill(`rundown-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);

  // The rundown must come from fixed test news. Against a stack started any other way, pressing
  // Generate would read the real feeds and call a model, so the test stops here instead.
  const status = await (await page.request.get('/api/rundowns/latest')).json();
  test.skip(!status.fixture, 'Start the stack with NEWS_FIXTURE=1 (or let Playwright start it) to run this test.');

  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'Rundown' } })).json();
  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('source-cam').waitFor();
  await page.getByTestId('template-newsroom').click();
  await page.getByTestId('tab-template').click();

  // No teleprompter until something from the rundown is on air.
  await expect(page.getByTestId('teleprompter')).toHaveCount(0);

  await page.getByTestId('rundown-generate').click();
  const items = page.getByTestId('rundown-item');
  await expect(items).toHaveCount(5);
  await expect(items.nth(1)).toContainText('Fixture Labs releases a faster model');

  // Taking an item fills the news scene and brings up the teleprompter.
  await items.nth(1).click();
  await expect(items.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(field(page, 'news-headline-text')).toHaveValue('Fixture Labs releases a faster model');
  await expect(page.getByTestId('teleprompter-script')).toContainText('Fixture Labs releases a faster model');
  await expect(page.getByTestId('teleprompter-position')).toHaveText('2 of 5');
  const saved = async () => (await (await page.request.post(`/api/broadcasts/${broadcast.id}/session`)).json()).scene;
  await expect.poll(async () => (await saved()).news.headline).toBe('Fixture Labs releases a faster model');
  await expect.poll(async () => (await saved()).banners.map((b: { id: string }) => b.id)).toContain('rundown-ticker');

  // The arrow keys step through the show, but not while typing in a field.
  await page.getByTestId('program-canvas').click();
  await page.keyboard.press('ArrowRight');
  await expect(items.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await field(page, 'news-headline-text').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(items.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('rundown-prev').click();
  await expect(items.nth(1)).toHaveAttribute('aria-pressed', 'true');

  // A source card goes on the stream and comes off again.
  const card = page.getByTestId('rundown-card').first();
  await card.click();
  await expect.poll(async () => (await saved()).news.source?.url).toBe('https://example.com/faster-model');
  await page.waitForTimeout(800);
  await page.getByTestId('program-canvas').screenshot({ path: 'test-results/screens/rundown-card.png' });
  await card.click();
  await expect.poll(async () => (await saved()).news.source).toBeNull();

  // A link the host adds can be opened and shown like the others; a bad address is refused.
  await field(page, 'rundown-add-link').fill('not a link');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rundown-panel')).toContainText('Enter a web address starting with https://');
  await field(page, 'rundown-add-link').fill('https://x.com/yashkavaiya/status/1');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rundown-open')).toHaveCount(2);

  // The sign-off puts the host's handle on screen.
  await items.nth(4).click();
  await expect.poll(async () => (await saved()).activeBannerIds).toContain('rundown-social');
  await page.screenshot({ path: 'test-results/screens/rundown-studio.png' });

  // The whole show on one page.
  await page.goto(`/rundown/${status.rundown?.date ?? (await (await page.request.get('/api/rundowns')).json())[0]}`);
  await expect(page.getByTestId('rundown-page')).toContainText('Fixture Labs releases a faster model');
  await expect(page.getByTestId('rundown-page')).toContainText('fixture/agent-kit');
  await expect(page.getByTestId('rundown-page').locator('a[href="https://example.com/faster-model"]')).toBeVisible();
});
