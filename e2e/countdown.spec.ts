import { expect, test } from '@playwright/test';

const field = (page, id) => page.getByTestId(id).locator('input, textarea').first();

test('starting and BRB screens run a countdown that survives a reload', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Hana Host');
  await field(page, 'email').fill(`timer-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);
  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'Timer' } })).json();

  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('source-cam').waitFor();

  await page.getByTestId('timer-5').click();
  await expect(page.getByTestId('timer-5')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('screen-starting').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('program-canvas').screenshot({ path: 'test-results/screens/program-countdown.png' });

  // The API stores the end time, so guests and a reloaded studio show the same countdown.
  const saved = async () => (await (await page.request.post(`/api/broadcasts/${broadcast.id}/session`)).json()).scene;
  await expect.poll(async () => (await saved()).screenEndsAt).toBeGreaterThan(Date.now() + 4 * 60_000);
  expect((await saved()).screenTimerSec).toBe(300);

  // Going back to Live clears it.
  await page.getByTestId('screen-live').click();
  await expect.poll(async () => (await saved()).screenEndsAt).toBeNull();
});
