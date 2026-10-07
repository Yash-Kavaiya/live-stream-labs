import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

/** A short test video with a tone, made with ffmpeg. */
function clip(name: string, seconds: number): string {
  const dir = path.resolve('test-results/clips');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.webm`);
  execFileSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=320x180:rate=15`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libvorbis', file],
    { timeout: 60_000 },
  );
  return file;
}

test('the host runs a watch party: queue, playback, poll, reactions and scoreboard', async ({ page }) => {
  const long = clip('First clip', 20);
  const short = clip('Second_clip', 3);

  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Pia Party');
  await field(page, 'email').fill(`party-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);
  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'Party' } })).json();
  const saved = async () => (await (await page.request.post(`/api/broadcasts/${broadcast.id}/session`)).json()).scene.party;
  const program = (name: string) => page.getByTestId('program-canvas').screenshot({ path: `test-results/screens/party-${name}.png` });

  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('source-cam').waitFor();
  await page.getByTestId('template-watchparty').click();
  await page.getByTestId('tab-template').click();

  // --- Queue: two files and a link; a bad address is refused ---
  await page.getByTestId('party-add-files').setInputFiles([long, short]);
  await field(page, 'party-link-url').fill('not a link');
  await page.getByTestId('party-add-link').click();
  await expect(page.getByTestId('party-queue')).toContainText('Enter a web address starting with https://');
  await field(page, 'party-link-title').fill('Launch video');
  await field(page, 'party-link-url').fill('https://example.com/launch');
  await page.getByTestId('party-add-link').click();
  const items = page.getByTestId('party-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('First clip');
  await expect(items.nth(1)).toContainText('Second clip');
  await expect.poll(async () => (await saved()).queue.map((i: { kind: string }) => i.kind)).toEqual(['file', 'file', 'link']);

  // --- Playback: the file goes on stage with its length known ---
  await page.getByTestId('party-next').click();
  await expect(page.getByTestId('party-now-title')).toHaveText('First clip');
  await expect.poll(async () => (await saved()).playing?.title).toBe('First clip');
  expect(Math.round((await saved()).playing.duration)).toBe(20);
  await expect(page.getByTestId('source-clip')).toBeVisible();
  await expect(page.getByTestId('party-time')).not.toHaveText(/^0:00 \//, { timeout: 15_000 });
  await page.waitForTimeout(800);
  await program('playing');

  // Pause holds the position; resume carries on.
  await page.getByTestId('party-pause').click();
  await expect.poll(async () => (await saved()).playing?.pausedAt).not.toBeNull();
  const heldAt = (await saved()).playing.pausedAt as number;
  await page.waitForTimeout(1500);
  expect((await saved()).playing.pausedAt).toBe(heldAt);
  await page.getByTestId('party-pause').click();
  await expect.poll(async () => (await saved()).playing?.pausedAt).toBeNull();

  // --- Auto-advance: jump near the end of a short file and the next one starts by itself ---
  await page.getByTestId('party-seek').fill('18');
  await expect.poll(async () => (await saved()).upNextUntil, { timeout: 20_000 }).not.toBeNull();
  await program('up-next');
  await expect.poll(async () => (await saved()).playing?.title, { timeout: 20_000 }).toBe('Second clip');
  // The item after it is a link, which needs a click: playback stops there.
  await expect.poll(async () => (await saved()).playing, { timeout: 20_000 }).toBeNull();
  await expect(page.getByTestId('source-clip')).toHaveCount(0);

  // --- Poll with hand votes ---
  await field(page, 'poll-question').fill('Which clip was better?');
  await field(page, 'poll-answer-1').fill('The first');
  await field(page, 'poll-answer-2').fill('The second');
  await page.getByTestId('poll-start').click();
  const add = page.getByTestId('poll-add');
  await add.nth(0).click();
  await add.nth(1).click();
  await add.nth(1).click();
  await expect(page.getByTestId('poll-count').nth(1)).toHaveText('2');
  await expect.poll(async () => (await saved()).poll?.hand).toEqual([1, 2]);
  await page.getByTestId('poll-close').click();
  await expect.poll(async () => (await saved()).poll?.open).toBe(false);
  await expect(add.nth(0)).toHaveAttribute('disabled', '');
  await page.waitForTimeout(600);
  await program('poll');

  // --- Reactions fill the hype meter, which falls back by itself ---
  await page.getByTestId('reaction').first().click();
  await page.getByTestId('reaction').nth(3).click();
  await expect.poll(async () => (await saved()).hype).toBeGreaterThan(0);
  await expect.poll(async () => (await saved()).hype, { timeout: 30_000 }).toBe(0);

  // --- Scoreboard: the person on stage, a typed name, points, and the trophy for the leader ---
  await page.getByTestId('score-add-stage').click();
  await field(page, 'score-name').fill('Guest Gia');
  await page.getByTestId('score-add').click();
  await expect(page.getByTestId('score-row')).toHaveCount(2);
  await page.getByTestId('score-row').filter({ hasText: 'Guest Gia' }).getByTestId('score-plus-5').click();
  await page.getByTestId('score-row').filter({ hasText: 'Pia Party' }).getByTestId('score-plus').click();
  await expect.poll(async () => (await saved()).scores).toEqual([{ name: 'Pia Party', points: 1 }, { name: 'Guest Gia', points: 5 }]);
  await page.getByTestId('score-show').click();
  await expect.poll(async () => (await saved()).showScores).toBe(true);
  await page.waitForTimeout(600);
  await program('scores');
  await expect(page.getByTestId('score-celebrate')).toContainText('Guest Gia');
  await page.getByTestId('score-celebrate').click();
  const scene = async () => (await (await page.request.post(`/api/broadcasts/${broadcast.id}/session`)).json()).scene;
  await expect.poll(async () => (await scene()).celebration?.text).toBe('Guest Gia');

  // --- After a reload the queue is kept, and a file has to be chosen again ---
  await page.reload();
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('tab-template').click();
  await expect(page.getByTestId('party-item')).toHaveCount(3);
  await expect(page.getByTestId('party-attach')).toHaveCount(2);
  await page.getByTestId('party-attach').first().setInputFiles(long);
  await expect(page.getByTestId('party-attach')).toHaveCount(1);
  await page.getByTestId('party-play').first().click();
  await expect.poll(async () => (await saved()).playing?.title).toBe('First clip');
  await page.getByTestId('party-stop').click();
  await expect.poll(async () => (await saved()).playing).toBeNull();
});
