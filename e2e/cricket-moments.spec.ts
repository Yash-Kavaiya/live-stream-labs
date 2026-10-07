import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

test('cricket moments play from the score, from the buttons and from a typed banner', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Uma Umpire');
  await field(page, 'email').fill(`moments-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);
  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'Final' } })).json();
  const celebration = async () => (await (await page.request.post(`/api/broadcasts/${broadcast.id}/session`)).json()).scene.celebration;
  /** The program canvas mid-moment, for visual review. */
  const program = async (name: string) => {
    await page.waitForTimeout(1700);
    await page.getByTestId('program-canvas').screenshot({ path: `test-results/screens/moment-${name}.png` });
    // Let it finish, so the next moment starts on a clear frame.
    await page.waitForTimeout(2200);
  };

  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('source-cam').waitFor();
  await page.getByTestId('template-cricket').click();
  await page.getByTestId('tab-template').click();
  await page.getByTestId('cricket-source-manual').click();
  await page.getByTestId('cricket-reset').click();

  // --- Scoring a ball plays the moment it earns ---
  await page.getByTestId('ball-6').click();
  await expect.poll(celebration).toMatchObject({ kind: 'moment', moment: 'six', detail: 'Batter 1 6 (1)' });
  await program('six');
  await page.getByTestId('ball-1').click();
  expect((await celebration()).moment).toBe('six');
  await page.getByTestId('ball-4').click();
  await expect.poll(celebration).toMatchObject({ moment: 'four', detail: 'Batter 2 4 (1)' });
  await program('four');
  await page.getByTestId('ball-W').click();
  await expect.poll(celebration).toMatchObject({ moment: 'wicket', detail: 'IND 11/1' });
  await program('wicket');
  await page.getByTestId('ball-nb').click();
  await expect.poll(celebration).toMatchObject({ moment: 'freehit' });
  await program('freehit');

  // --- With automatic moments off, the score stays quiet ---
  await page.getByTestId('cricket-auto-moments').click();
  const { id } = await celebration();
  await page.getByTestId('ball-6').click();
  await expect(page.getByTestId('cricket-score')).toContainText('18/1');
  expect((await celebration()).id).toBe(id);

  // --- The buttons play any moment by hand ---
  await page.getByTestId('moment-fifty').click();
  await expect.poll(celebration).toMatchObject({ moment: 'fifty' });
  await program('fifty');
  await page.getByTestId('moment-hundred').click();
  await expect.poll(celebration).toMatchObject({ moment: 'hundred' });
  await program('hundred');

  // --- A banner in the host's own words ---
  await expect(page.getByTestId('moment-show')).toHaveAttribute('disabled', '');
  await field(page, 'moment-text').fill('What a shot!');
  await page.getByTestId('moment-show').click();
  await expect.poll(celebration).toMatchObject({ moment: 'custom', text: 'What a shot!', emoji: '📣' });
  await program('custom');
  await page.getByTestId('moment-preset').first().click();
  await expect.poll(celebration).toMatchObject({ moment: 'custom', text: 'HAT-TRICK!' });
});
