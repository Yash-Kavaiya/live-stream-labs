import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const RTMP = 'rtmp://localhost:1935/live';

/** Codec names of a stream or file, e.g. ['aac', 'h264']. */
function codecs(url: string): string[] {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-rw_timeout', '15000000', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', url],
    { timeout: 30_000 },
  );
  return out.toString().split(/\s+/).filter(Boolean).sort();
}

/**
 * True when the middle of the main tile shows camera video. Chrome's synthetic camera is green,
 * while an empty tile, a name card and the backdrop are all grey or blue.
 */
function showsCamera(page: Page): Promise<boolean> {
  return page.getByTestId('program-canvas').evaluate((canvas: HTMLCanvasElement) => {
    // Read the pixel through a scratch canvas. Reading the program canvas directly makes Chrome
    // move it to software rendering, which slows the whole studio down for the rest of the test.
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(canvas, 480, 300, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return g! > r! + 40 && g! > b! + 40;
  });
}

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

test('host and guest go live to two destinations, and the stream is recorded', async ({ page, browser }) => {
  const stamp = Date.now();
  const keys = { a: `e2e-a-${stamp}`, b: `e2e-b-${stamp}` };

  // --- Sign up ---
  await page.goto('/signup');
  await field(page, 'name').fill('Hana Host');
  await field(page, 'email').fill(`host-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await expect(page).toHaveURL(/\/app$/);

  // --- Destinations: one through the UI, one through the API ---
  await page.goto('/app/destinations');
  await page.getByTestId('add-destination').click();
  await field(page, 'destination-label').fill('Mock YouTube');
  await field(page, 'destination-url').fill(RTMP);
  await field(page, 'destination-key').fill(keys.a);
  await page.getByTestId('destination-save').click();
  await expect(page.getByTestId('destination-row')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText(keys.a);

  const created = await page.request.post('/api/destinations', {
    data: { platform: 'twitch', label: 'Mock Twitch', rtmpUrl: RTMP, streamKey: keys.b },
  });
  expect(created.ok()).toBe(true);

  // --- New broadcast with both destinations ---
  await page.goto('/app');
  await page.getByTestId('new-broadcast').click();
  await field(page, 'broadcast-title').fill('E2E launch show');
  for (const box of await page.locator('md-dialog[open] md-checkbox').all()) await box.click();
  await page.getByTestId('create-broadcast-submit').click();
  await expect(page).toHaveURL(/\/studio\//);

  // --- Green room, then the studio ---
  await page.getByTestId('enter-studio').click();
  const studio = page.getByTestId('studio');
  await expect(studio).toHaveAttribute('data-status', 'connected');
  await expect(page.getByTestId('source-cam')).toHaveCount(1);
  await expect(page.getByTestId('source-cam')).toHaveAttribute('data-on-stage', 'true');
  await expect(page.getByTestId('destination-status')).toHaveCount(2);

  // --- Invite a guest, who joins from a separate browser profile without an account ---
  await page.getByTestId('invite').click();
  await expect(field(page, 'invite-url')).toHaveValue(/\/join\//);
  const inviteUrl = await field(page, 'invite-url').inputValue();
  await page.keyboard.press('Escape');

  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  await field(guest, 'guest-name').fill('Gus Guest');
  await guest.getByTestId('enter-studio').click();
  await expect(guest.getByTestId('studio')).toHaveAttribute('data-status', 'connected');
  await expect(guest.getByTestId('go-live')).toHaveCount(0);

  // Chrome stops animation frames for the page that is not in front, which stalls Playwright's
  // actionability checks, so each side is brought forward before it is driven.
  await page.bringToFront();

  // --- Auto director, templates, layout ---
  // The auto director puts the joining guest on stage and re-arranges the frame.
  const tiles = page.getByTestId('source-cam');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(1)).toHaveAttribute('data-on-stage', 'true');
  await expect(page.getByTestId('layout-grid')).toHaveAttribute('aria-pressed', 'true');

  // --- Template and holding screen ---
  await page.getByTestId('template-newsroom').click();
  await expect(page.getByTestId('template-newsroom')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('screen-starting').click();
  // The holding screen fades in over the cameras, then back out.
  await expect.poll(() => showsCamera(page)).toBe(false);
  await page.screenshot({ path: 'test-results/studio-starting.png' });
  await page.getByTestId('screen-live').click();
  await expect.poll(() => showsCamera(page)).toBe(true);

  // News scenes replace the layout picker while the news room is on.
  await page.getByTestId('open-template-page').click();
  await page.getByTestId('news-interview').click();
  await expect(page.getByTestId('news-interview')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('layout-spotlight')).toHaveCount(0);

  // Cricket: score two balls and read the result back.
  await page.getByTestId('tab-scenes').click();
  await page.getByTestId('template-cricket').click();
  await page.getByTestId('tab-template').click();
  await page.getByTestId('ball-4').click();
  await page.getByTestId('ball-W').click();
  await expect(page.getByTestId('cricket-score')).toContainText('4/1');
  await page.getByTestId('cricket-dashboard').click();
  await expect(page.getByTestId('cricket-dashboard')).toHaveAttribute('aria-pressed', 'true');

  // Back on the clean look the host can override the layout by hand.
  await page.getByTestId('tab-scenes').click();
  await page.getByTestId('template-none').click();
  await page.getByTestId('layout-spotlight').click();

  // The Layout page: a two-person layout from the gallery.
  await page.getByTestId('tab-template').click();
  await page.getByTestId('gallery-split').click();
  await expect(page.getByTestId('layout-split')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('layout-spotlight').click();
  await expect(page.getByTestId('layout-spotlight')).toHaveAttribute('aria-pressed', 'true');

  // --- A banner ---
  await page.getByTestId('tab-banners').click();
  await field(page, 'banner-text').fill('Welcome to the show');
  await page.getByTestId('banner-add').click();
  await page.getByTestId('banner-toggle').click();
  await expect(page.getByTestId('banner-toggle')).toHaveAttribute('aria-pressed', 'true');

  await page.screenshot({ path: 'test-results/studio-stage.png' });
  // The program shows camera video, not an empty frame, for the host and for the guest.
  await expect.poll(() => showsCamera(page)).toBe(true);
  await expect.poll(() => showsCamera(guest)).toBe(true);

  // --- Private chat reaches the host ---
  await guest.bringToFront();
  await field(guest, 'chat-input').fill('Hello from the guest');
  await guest.keyboard.press('Enter');
  await page.bringToFront();
  await page.getByTestId('tab-chat').click();
  await expect(page.locator('.chat-message')).toContainText('Hello from the guest');

  // --- Go live ---
  await page.getByTestId('go-live').click();
  await expect(page.getByTestId('live-chip')).toBeVisible();
  for (const status of await page.getByTestId('destination-status').all()) {
    await expect(status).toHaveAttribute('data-status', 'live', { timeout: 90_000 });
  }

  // Both mock platforms really receive H.264 video and AAC audio.
  expect(codecs(`${RTMP}/${keys.a}`)).toEqual(['aac', 'h264']);
  expect(codecs(`${RTMP}/${keys.b}`)).toEqual(['aac', 'h264']);
  await page.screenshot({ path: 'test-results/studio-live.png' });

  // --- End the stream; a recording appears and plays back ---
  await page.getByTestId('end-stream').click();
  await expect(page.getByTestId('go-live')).toBeVisible();

  await expect
    .poll(async () => (await (await page.request.get('/api/recordings')).json()).length, { timeout: 30_000 })
    .toBe(1);
  const [recording] = await (await page.request.get('/api/recordings')).json();
  expect(recording.sizeBytes).toBeGreaterThan(50_000);
  const video = await page.request.get(`/api/watch/${recording.shareToken}/video`, {
    headers: { range: 'bytes=0-99' },
  });
  expect(video.status()).toBe(206);
  expect(codecs(`http://localhost:5173/api/watch/${recording.shareToken}/video`)).toEqual(['aac', 'h264']);

  await page.goto('/app/recordings');
  await expect(page.getByTestId('recording-row')).toContainText('E2E launch show');

  await guestContext.close();
});
