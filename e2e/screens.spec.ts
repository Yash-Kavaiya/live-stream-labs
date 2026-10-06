import { test } from '@playwright/test';

// Captures the main screens in both themes into test-results/screens for visual review.
const field = (page, id) => page.getByTestId(id).locator('input, textarea').first();

for (const theme of ['light', 'dark'] as const) {
  test(`screens ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
    const shot = (name: string) => page.screenshot({ path: `test-results/screens/${name}-${theme}.png` });
    const stamp = Date.now();

    await page.goto('/');
    await page.waitForTimeout(800);
    await shot('landing');
    await page.goto('/signup');
    await field(page, 'name').fill('Hana Host');
    await field(page, 'email').fill(`shots-${theme}-${stamp}@example.com`);
    await field(page, 'password').fill('correct horse battery');
    await shot('signup');
    await page.getByTestId('submit').click();
    await page.waitForURL(/\/app$/);

    for (const [platform, label] of [['youtube', 'My YouTube channel'], ['twitch', 'Twitch'], ['linkedin', 'LinkedIn page']]) {
      await page.request.post('/api/destinations', {
        data: { platform, label, rtmpUrl: 'rtmp://localhost:1935/live', streamKey: `k-${platform}-${stamp}` },
      });
    }
    const ids = (await (await page.request.get('/api/destinations')).json()).map((d) => d.id);
    await page.request.post('/api/broadcasts', { data: { title: 'Weekly product update', destinationIds: ids } });
    await page.request.post('/api/broadcasts', { data: { title: 'Launch day live', scheduledAt: '2030-01-01T10:00:00.000Z', destinationIds: ids.slice(0, 1) } });

    await page.goto('/app');
    await page.getByTestId('broadcast-card').first().waitFor();
    await shot('broadcasts');
    await page.goto('/app/destinations');
    await page.getByTestId('destination-row').first().waitFor();
    await shot('destinations');
    await page.getByTestId('add-destination').click();
    await page.waitForTimeout(600);
    await shot('add-destination');
    await page.keyboard.press('Escape');

    const [first] = await (await page.request.get('/api/broadcasts')).json();
    await page.goto(`/studio/${first.id}`);
    await page.getByTestId('enter-studio').waitFor();
    await page.waitForTimeout(1500);
    await shot('green-room');
    await page.getByTestId('enter-studio').click();
    await page.getByTestId('source-cam').waitFor();
    await page.waitForTimeout(2500);
    await shot('studio');

    // Program output for each template and holding screen (the canvas only).
    const program = (name: string) =>
      page.getByTestId('program-canvas').screenshot({ path: `test-results/screens/program-${name}-${theme}.png` });
    await page.getByTestId('tab-banners').click();
    await field(page, 'banner-text').fill('Markets rally as rates hold steady');
    await page.getByTestId('banner-add').click();
    await page.getByTestId('banner-toggle').click();
    await page.getByTestId('tab-scenes').click();
    // News room: every scene, with a headline and story points.
    await page.getByTestId('template-newsroom').click();
    await field(page, 'news-headline-text').fill('Markets rally as rates hold steady');
    for (const view of ['anchor', 'interview', 'panel', 'headline']) {
      await page.getByTestId(`news-${view}`).click();
      await page.waitForTimeout(1200);
      await program(`news-${view}`);
    }

    // Cricket: score an over, then both views.
    await page.getByTestId('template-cricket').click();
    for (const ball of ['1', '4', '0', 'W', '6', 'wd', '2']) await page.getByTestId(`ball-${ball}`).click();
    await page.waitForTimeout(1200);
    await program('cricket-match');
    await page.getByTestId('cricket-dashboard').click();
    await page.waitForTimeout(1200);
    await program('cricket-dashboard');

    // Watch party: mid-celebration.
    await page.getByTestId('template-watchparty').click();
    await field(page, 'winner-name').fill('Team Rocket');
    await page.getByTestId('celebrate-winner').click();
    await page.waitForTimeout(1800);
    await program('watchparty-winner');
    await page.waitForTimeout(5500);
    await page.getByTestId('reaction').first().click();
    await page.waitForTimeout(1500);
    await program('watchparty-reaction');

    await page.getByTestId('screen-starting').click();
    await page.waitForTimeout(1200);
    await program('starting');
    await shot('studio-scenes');
  });
}
