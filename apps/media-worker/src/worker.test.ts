import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EgressStatus } from '@studio/shared';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildFfmpegArgs, DEFAULT_ENCODE, isProgressLine, parseFailedOutput, parseProgress, teeSpec } from './ffmpeg-args';
import { startWorker, type ApiClient } from './server';

describe('ffmpeg arguments', () => {
  it('builds one tee output per destination plus the recording', () => {
    const spec = teeSpec([
      { format: 'flv', url: 'rtmp://a.example/live/key1' },
      { format: 'mp4', url: 'C:\\data\\rec.mp4' },
    ]);
    expect(spec).toBe(
      '[f=flv:flvflags=no_duration_filesize:onfail=ignore]rtmp://a.example/live/key1|' +
        '[f=mp4:movflags=frag_keyframe+empty_moov+default_base_moof:onfail=ignore]C:/data/rec.mp4',
    );
  });

  it('escapes characters the tee muxer treats as syntax', () => {
    expect(teeSpec([{ format: 'flv', url: "rtmp://a/live/k|e'y" }])).toContain("rtmp://a/live/k\\|e\\'y");
  });

  it('encodes H.264 + AAC with a 2 second keyframe interval', () => {
    const args = buildFfmpegArgs([{ format: 'flv', url: 'rtmp://a/live/k' }]);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value('-c:v')).toBe('libx264');
    expect(value('-c:a')).toBe('aac');
    expect(value('-g')).toBe('60');
    expect(value('-i')).toBe('pipe:0');
    expect(() => buildFfmpegArgs([])).toThrow();
  });

  it('asks for a constant bitrate, so a still picture does not starve the platform', () => {
    const args = buildFfmpegArgs([{ format: 'flv', url: 'rtmp://a/live/k' }]);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value('-b:v')).toBe('6000k');
    expect(value('-minrate')).toBe('6000k');
    expect(value('-maxrate')).toBe('6000k');
    // One second of buffer: the rate may not sag for longer than that.
    expect(value('-bufsize')).toBe('6000k');
    expect(value('-x264-params')).toContain('nal-hrd=cbr');
    expect(value('-x264-params')).toContain('force-cfr=1');
  });

  it('sends 1080p at 30 frames a second, at a bitrate every platform accepts', () => {
    const args = buildFfmpegArgs([{ format: 'flv', url: 'rtmp://a/live/k' }]);
    const filter = args[args.indexOf('-vf') + 1]!;
    expect(filter).toContain('scale=1920:1080');
    expect(filter).toContain('pad=1920:1080');
    expect(filter).toContain('fps=30');
    // Twitch refuses more than 6000 kbit/s; the others take at least that much at 1080p.
    expect(DEFAULT_ENCODE).toMatchObject({ width: 1920, height: 1080, fps: 30, videoKbps: 6000 });
  });

  it('reads the encoder health from a progress line', () => {
    expect(parseProgress('frame= 1234 fps= 30 q=23.0 size=N/A time=00:00:41.13 bitrate=N/A speed=1.00x')).toEqual({ frame: 1234, fps: 30, speed: 1 });
    expect(parseProgress('frame=   90 fps= 22 q=28.0 size=N/A time=00:00:03.00 bitrate=N/A speed=0.74x')).toEqual({ frame: 90, fps: 22, speed: 0.74 });
    expect(parseProgress('frame=    5 fps=0.0 q=0.0 size=N/A time=N/A bitrate=N/A speed=N/A')).toEqual({ frame: 5, fps: 0, speed: null });
    expect(parseProgress('[tee @ 0x1] Slave muxer #1 failed')).toBeNull();
  });

  it('reads ffmpeg log lines', () => {
    expect(parseFailedOutput('[tee @ 0x1] Slave muxer #1 failed: I/O error, continuing')).toBe(1);
    expect(parseFailedOutput('frame=  10 fps=30')).toBeNull();
    expect(isProgressLine('frame=   42 fps= 30 q=23.0 size=N/A')).toBe(true);
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.skipIf(!hasFfmpeg)('encoded stream', () => {
  it('keeps its bitrate up on a picture that does not move', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'studio-cbr-'));
    const input = path.join(dir, 'still.webm');
    const output = path.join(dir, 'out.flv');
    // Eight seconds of one flat colour and silence: the least there is to encode.
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=0x101830:s=1920x1080:r=30:d=8',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-shortest', '-c:v', 'libvpx', '-b:v', '500k', '-c:a', 'libopus', input,
    ]);
    const args = buildFfmpegArgs([{ format: 'flv', url: output }]).map((arg) => (arg === 'pipe:0' ? input : arg));
    execFileSync('ffmpeg', ['-y', ...args], { stdio: 'ignore' });

    const sizes = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,size', '-of', 'csv=p=0', output]).toString();
    const perSecond = new Map<number, number>();
    for (const line of sizes.split(/\r?\n/).filter(Boolean)) {
      const [time, size] = line.split(',').map(Number);
      perSecond.set(Math.floor(time!), (perSecond.get(Math.floor(time!)) ?? 0) + size! * 8);
    }
    // Leave out the first and last second, which are partial. Every other one carries about 6 Mbit.
    const whole = [...perSecond.entries()].sort((a, b) => a[0] - b[0]).slice(1, -1).map(([, bits]) => bits / 1000);
    expect(whole.length).toBeGreaterThanOrEqual(4);
    for (const kbit of whole) {
      expect(kbit).toBeGreaterThan(5100);
      expect(kbit).toBeLessThan(6900);
    }
  }, 60_000);
});

/** A few seconds of test pattern and tone, shaped like a browser MediaRecorder stream. */
function fakeBrowserStream(seconds: number) {
  return spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-re',
      '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
      '-c:v', 'libvpx', '-b:v', '800k', '-deadline', 'realtime', '-cpu-used', '8',
      '-c:a', 'libopus', '-f', 'webm', '-cluster_time_limit', '250', 'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
}

describe.skipIf(!hasFfmpeg)('worker end to end (real ffmpeg)', () => {
  it('rejects an ingest connection with a bad token', async () => {
    const api: ApiClient = { claim: async () => null, report: async () => undefined };
    const server = startWorker(
      { port: 0, apiUrl: '', internalSecret: '', dataDir: tmpdir(), ffmpegPath: 'ffmpeg' },
      api,
    );
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ingest?token=nope`);
    const code = await new Promise<number>((resolve) => socket.on('close', resolve));
    expect(code).toBe(4401);
    server.close();
  });

  it('transcodes a WebM stream to an H.264/AAC recording and reports each destination', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'worker-test-'));
    const statuses: EgressStatus[] = [];
    const api: ApiClient = {
      claim: async (token) =>
        token === 'good'
          ? {
              broadcastId: 'bc1',
              record: true,
              // Nothing listens here, so this destination must fail without stopping the recording.
              targets: [{ destinationId: 'dead', url: 'rtmp://127.0.0.1:9/live/key' }],
            }
          : null,
      report: async (status) => void statuses.push(status),
    };
    const server = startWorker(
      { port: 0, apiUrl: '', internalSecret: '', dataDir, ffmpegPath: 'ffmpeg' },
      api,
    );
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as AddressInfo;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ingest?token=good`);
    await new Promise((r) => socket.once('open', r));
    const source = fakeBrowserStream(4);
    source.stdout.on('data', (chunk: Buffer) => socket.send(chunk));
    await new Promise((r) => source.once('close', r));
    socket.close();

    await expect.poll(() => statuses.at(-1)?.state, { timeout: 15_000 }).toBe('ended');
    server.close();

    const last = statuses.at(-1)!;
    expect(statuses.some((s) => s.state === 'live')).toBe(true);
    expect(last.targets).toEqual([
      { destinationId: 'dead', status: 'failed', error: expect.stringContaining('rejected') },
    ]);
    expect(last.recording!.sizeBytes).toBeGreaterThan(10_000);

    const probe = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0',
      path.join(dataDir, 'recordings', last.recording!.file),
    ]);
    expect(probe.toString().split(/\s+/).filter(Boolean).sort()).toEqual(['aac', 'h264']);
  }, 40_000);
});
