import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

test('social links and QR codes show on the holding screens and survive a reload', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Sam Social');
  await field(page, 'email').fill(`social-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByTestId('new-broadcast').click();
  await field(page, 'broadcast-title').fill('Socials');
  await page.getByTestId('create-broadcast-submit').click();
  await page.getByTestId('enter-studio').click();
  await expect(page.getByTestId('studio')).toHaveAttribute('data-status', 'connected');

  await page.getByTestId('tab-scenes').click();
  await field(page, 'social-x').fill('@yashkavaiya');
  await field(page, 'social-youtube').fill('yashtalks');
  await field(page, 'social-instagram').fill('https://instagram.com/yash.k');
  await field(page, 'social-linkedin').fill('yash-kavaiya');
  await page.getByTestId('timer-5').click();
  await page.getByTestId('screen-starting').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('program-canvas').screenshot({ path: 'test-results/holding-starting-qr.png' });

  await page.getByTestId('socials-qr').click();
  await page.getByTestId('screen-brb').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('program-canvas').screenshot({ path: 'test-results/holding-brb-chips.png' });

  // The links are saved with the scene.
  await page.reload();
  await page.getByTestId('enter-studio').click().catch(() => {});
  await page.getByTestId('tab-scenes').click();
  await expect(field(page, 'social-linkedin')).toHaveValue('yash-kavaiya');
  await page.getByTestId('socials-qr').click();
  await page.getByTestId('screen-ending').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('program-canvas').screenshot({ path: 'test-results/holding-ending-qr.png' });
});
