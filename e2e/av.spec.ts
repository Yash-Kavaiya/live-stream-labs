import { execFileSync, spawnSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const RTMP = 'rtmp://localhost:1935/live';
const PLATFORMS = ['youtube', 'twitch', 'facebook', 'linkedin', 'x'] as const;

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

interface StreamInfo {
  codec_type: 'video' | 'audio';
  codec_name: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
}

/** What a stream or file says it carries. */
function describe(url: string): { video: StreamInfo | undefined; audio: StreamInfo | undefined; count: number } {
  const out = execFileSync('ffprobe', ['-v', 'error', '-rw_timeout', '15000000', '-show_streams', '-of', 'json', url], { timeout: 60_000 });
  const streams = JSON.parse(out.toString()).streams as StreamInfo[];
  return { video: streams.find((s) => s.codec_type === 'video'), audio: streams.find((s) => s.codec_type === 'audio'), count: streams.length };
}

interface Signal {
  /** Video frames decoded. */
  frames: number;
  /** Seconds of video and of audio decoded. */
  videoSec: number;
  audioSec: number;
  /** Loudest and average level of the audio, in dB. Digital silence is about -91. */
  maxVolume: number;
  meanVolume: number;
  frozen: boolean;
  black: boolean;
  /** Lines where the decoder complained. */
  errors: string[];
}

/** Decodes `seconds` of a stream (or all of a file) and measures what is actually in it. */
function measure(url: string, seconds?: number): Signal {
  const run = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-rw_timeout', '15000000', ...(seconds ? ['-t', String(seconds)] : []), '-i', url,
      '-map', '0:v:0', '-vf', 'freezedetect=n=0.001:d=2,blackdetect=d=1', '-f', 'null', '-',
      '-map', '0:a:0', '-af', 'volumedetect,ashowinfo', '-f', 'null', '-',
    ],
    { timeout: 180_000, maxBuffer: 256 * 1024 * 1024 },
  );
  const log = run.stderr.toString();
  const last = (pattern: RegExp) => [...log.matchAll(pattern)].pop()?.[1];
  const number = (pattern: RegExp) => Number(last(pattern) ?? Number.NaN);
  const audioSamples = [...log.matchAll(/Parsed_ashowinfo.*?nb_samples:(\d+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  const rate = number(/Parsed_ashowinfo.*?rate:(\d+)/g);
  const frames = number(/frame=\s*(\d+)/g);
  return {
    frames,
    videoSec: frames / 30,
    audioSec: audioSamples / rate,
    maxVolume: number(/max_volume: (-?[\d.]+) dB/g),
    meanVolume: number(/mean_volume: (-?[\d.]+) dB/g),
    frozen: /freeze_start/.test(log),
    black: /black_start/.test(log),
    errors: log.split(/\r?\n/).filter((line) => /error while decoding|corrupt|invalid data|non-monotonic/i.test(line)),
  };
}

/** How the video of a live stream is delivered: its bitrate and the longest wait between keyframes. */
function delivery(url: string, seconds: number): { kbps: number; maxKeyframeGapSec: number } {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-rw_timeout', '15000000', '-select_streams', 'v:0', '-read_intervals', `%+${seconds}`, '-show_entries', 'packet=pts_time,size,flags', '-of', 'csv=p=0', url],
    { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const packets = out.toString().trim().split(/\r?\n/).map((line) => line.split(',')).map(([pts, size, flags]) => ({ pts: Number(pts), size: Number(size), key: (flags ?? '').includes('K') }));
  const span = packets[packets.length - 1]!.pts - packets[0]!.pts;
  const keys = packets.filter((p) => p.key).map((p) => p.pts);
  const gaps = keys.slice(1).map((pts, i) => pts - keys[i]!);
  return { kbps: (packets.reduce((sum, p) => sum + p.size, 0) * 8) / span / 1000, maxKeyframeGapSec: Math.max(...gaps) };
}

test('every platform and the recording get moving video and audible audio', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Ava Audio');
  await field(page, 'email').fill(`av-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);

  // --- One destination on each platform, all streaming at once ---
  const keys: string[] = [];
  const ids: string[] = [];
  for (const platform of PLATFORMS) {
    const key = `av-${platform}-${stamp}`;
    const created = await page.request.post('/api/destinations', { data: { platform, label: `Mock ${platform}`, rtmpUrl: RTMP, streamKey: key } });
    expect(created.ok(), platform).toBe(true);
    keys.push(key);
    ids.push((await created.json()).id);
  }
  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'Sound and picture check', destinationIds: ids } })).json();

  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('enter-studio').click();
  await expect(page.getByTestId('studio')).toHaveAttribute('data-status', 'connected');
  await expect(page.getByTestId('source-cam')).toHaveAttribute('data-on-stage', 'true');
  await expect(page.getByTestId('destination-status')).toHaveCount(PLATFORMS.length);

  await page.getByTestId('go-live').click();
  await expect(page.getByTestId('live-chip')).toBeVisible();
  for (const status of await page.getByTestId('destination-status').all()) {
    await expect(status).toHaveAttribute('data-status', 'live', { timeout: 90_000 });
  }
  // Let the encoder settle into its steady rate before measuring.
  await page.waitForTimeout(8000);

  // --- Every platform receives the same complete stream ---
  for (const [i, key] of keys.entries()) {
    const platform = PLATFORMS[i]!;
    const url = `${RTMP}/${key}`;
    const { video, audio, count } = describe(url);
    expect(count, platform).toBe(2);
    expect(video, platform).toMatchObject({ codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p', width: 1920, height: 1080, r_frame_rate: '30/1' });
    expect(audio, platform).toMatchObject({ codec_name: 'aac', sample_rate: '44100', channels: 2 });

    const signal = measure(url, 6);
    console.log(platform, JSON.stringify(signal));
    expect(signal.errors, platform).toEqual([]);
    // Six seconds of picture and of sound: neither one stalls or runs short of the other.
    expect(signal.frames, platform).toBeGreaterThan(150);
    expect(Math.abs(signal.videoSec - signal.audioSec), platform).toBeLessThan(0.5);
    // The synthetic camera moves and the synthetic microphone beeps.
    expect(signal.frozen, platform).toBe(false);
    expect(signal.black, platform).toBe(false);
    expect(signal.maxVolume, platform).toBeGreaterThan(-35);
  }

  // What the platforms' ingest guides ask for: a steady 6 Mbit/s and a keyframe every two seconds.
  const sent = delivery(`${RTMP}/${keys[0]}`, 10);
  console.log('delivery', JSON.stringify(sent));
  expect(sent.kbps).toBeGreaterThan(5000);
  expect(sent.kbps).toBeLessThan(7000);
  expect(sent.maxKeyframeGapSec).toBeLessThanOrEqual(2.1);

  // --- Muting the microphone silences the stream without stopping it ---
  await page.getByTestId('toggle-mic').click();
  await page.waitForTimeout(3000);
  const muted = measure(`${RTMP}/${keys[1]}`, 4);
  console.log('muted', JSON.stringify(muted));
  expect(muted.frames).toBeGreaterThan(100);
  expect(muted.audioSec).toBeGreaterThan(3);
  expect(muted.maxVolume).toBeLessThan(-60);
  await page.getByTestId('toggle-mic').click();
  await page.waitForTimeout(3000);
  expect(measure(`${RTMP}/${keys[1]}`, 4).maxVolume).toBeGreaterThan(-35);

  // --- The recording has the same picture and sound, start to finish ---
  await page.getByTestId('end-stream').click();
  await page.getByTestId('confirm-end').click();
  await expect(page.getByTestId('go-live')).toBeVisible();
  await expect.poll(async () => (await (await page.request.get('/api/recordings')).json()).length, { timeout: 30_000 }).toBe(1);
  const [recording] = await (await page.request.get('/api/recordings')).json();
  const file = `http://localhost:5173/api/watch/${recording.shareToken}/video`;

  const { video, audio, count } = describe(file);
  expect(count).toBe(2);
  expect(video).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080 });
  expect(audio).toMatchObject({ codec_name: 'aac', sample_rate: '44100', channels: 2 });

  const whole = measure(file);
  console.log('recording', JSON.stringify(whole), `${recording.sizeBytes} bytes`);
  expect(whole.errors).toEqual([]);
  expect(whole.videoSec).toBeGreaterThan(40);
  expect(Math.abs(whole.videoSec - whole.audioSec)).toBeLessThan(1);
  expect(whole.frozen).toBe(false);
  expect(whole.black).toBe(false);
  expect(whole.maxVolume).toBeGreaterThan(-35);
});
