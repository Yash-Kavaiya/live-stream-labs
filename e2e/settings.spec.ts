import { expect, test } from '@playwright/test';

// An account saves its own LiveKit project from the browser; the studio then runs on it.
const field = (page, id) => page.getByTestId(id).locator('input, textarea').first();

test('saves a LiveKit project from Settings and opens the studio on it', async ({ page }) => {
  // The web server answers first; wait for the API behind it.
  await expect.poll(async () => (await page.request.get('/api/health')).status(), { timeout: 120_000 }).toBe(200);
  await page.goto('/signup');
  await field(page, 'name').fill('Lia Host');
  await field(page, 'email').fill(`settings-${Date.now()}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);

  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByTestId('livekit-source')).toHaveText('Server default');

  // Wrong secret: LiveKit refuses it and nothing is saved.
  await field(page, 'livekit-url').fill('ws://localhost:7880');
  await field(page, 'livekit-key').fill('devkey');
  await field(page, 'livekit-secret').fill('not-the-secret');
  await page.getByTestId('livekit-save').click();
  await expect(page.getByRole('alert')).toContainText('LiveKit did not accept');
  await expect(page.getByTestId('livekit-source')).toHaveText('Server default');

  // The local dev server's real credentials.
  await field(page, 'livekit-secret').fill('secret');
  await page.getByTestId('livekit-save').click();
  await expect(page.getByTestId('livekit-source')).toHaveText('Your project');
  await page.screenshot({ path: 'test-results/screens/settings-livekit.png' });

  // Saved on the server: still there after a reload, with the secret not sent back.
  await page.reload();
  await expect(page.getByTestId('livekit-source')).toHaveText('Your project');
  const saved = await (await page.request.get('/api/settings/livekit')).json();
  expect(saved).toMatchObject({ source: 'account', url: 'ws://localhost:7880', apiKey: 'devkey' });
  expect(JSON.stringify(saved)).not.toContain('secret');

  const { id } = await (await page.request.post('/api/broadcasts', { data: { title: 'On my project' } })).json();
  const session = await (await page.request.post(`/api/broadcasts/${id}/session`)).json();
  expect(session.livekitUrl).toBe('ws://localhost:7880');
});
