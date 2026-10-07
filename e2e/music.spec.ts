import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

/** One second of a 440 Hz tone as a 16-bit mono WAV file. */
function toneWav(): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(rate * 2);
  for (let i = 0; i < rate; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test('the host plays built-in music and an uploaded track', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Mira Music');
  await field(page, 'email').fill(`music-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);
  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'Music' } })).json();

  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('source-cam').waitFor();
  await page.getByTestId('tab-banners').click();

  // A bed loops until it is stopped; a second bed takes over from the first.
  const headlines = page.getByTestId('music-headlines');
  await headlines.click();
  await expect(headlines).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('music-soft').click();
  await expect(page.getByTestId('music-soft')).toHaveAttribute('aria-pressed', 'true');
  await expect(headlines).toHaveAttribute('aria-pressed', 'false');

  // A sting plays over the bed and finishes by itself.
  const transition = page.getByTestId('music-transition');
  await transition.click();
  await expect(transition).toHaveAttribute('aria-pressed', 'true');
  await expect(transition).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
  await expect(page.getByTestId('music-soft')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('music-fade').click();
  await expect(page.getByTestId('music-soft')).toHaveAttribute('aria-pressed', 'false');

  // An uploaded track is kept with the broadcast and plays.
  await page.getByTestId('music-upload').setInputFiles({ name: 'My theme.wav', mimeType: 'audio/wav', buffer: toneWav() });
  const mine = page.getByTestId('music-upload-track');
  await expect(mine).toContainText('My theme');
  await mine.click();
  await expect(mine).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('music-panel')).not.toContainText('could not be played');

  await page.reload();
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('tab-banners').click();
  await expect(page.getByTestId('music-upload-track')).toContainText('My theme');
});
