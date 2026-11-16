import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EgressStatus } from '@studio/shared';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildFfmpegArgs, buildRelayArgs, DEFAULT_ENCODE, isProgressLine, parseProgress, teeSpec } from './ffmpeg-args';
import { DEFAULT_RETRY, retryDelay } from './relay';
import { startWorker, type ApiClient } from './server';

describe('ffmpeg arguments', () => {
  it('writes the program to the relays as MPEG-TS, plus the recording', () => {
    const spec = teeSpec([
      { format: 'mpegts', url: 'pipe:1' },
      { format: 'mp4', url: 'C:\\data\\rec.mp4' },
    ]);
    expect(spec).toBe(
      '[f=mpegts:bsfs/v=dump_extra]pipe:1|' +
        '[f=mp4:movflags=frag_keyframe+empty_moov+default_base_moof:onfail=ignore]C:/data/rec.mp4',
    );
  });

  it('escapes characters the tee muxer treats as syntax', () => {
    expect(teeSpec([{ format: 'mp4', url: "C:/rec/k|e'y.mp4" }])).toContain("C:/rec/k\\|e\\'y.mp4");
  });

  it('copies the program to a platform without encoding it again', () => {
    const args = buildRelayArgs('rtmp://a/live/k');
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value('-c')).toBe('copy');
    expect(args).toContain('mpegts');
    expect(args).toContain('flv');
    expect(args.at(-1)).toBe('rtmp://a/live/k');
  });

  it('waits longer after each failure, up to a limit', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => retryDelay(DEFAULT_RETRY, n))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('encodes H.264 + AAC with a 2 second keyframe interval', () => {
    const args = buildFfmpegArgs([{ format: 'mpegts', url: 'pipe:1' }]);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value('-c:v')).toBe('libx264');
    expect(value('-c:a')).toBe('aac');
    expect(value('-g')).toBe('60');
    expect(value('-i')).toBe('pipe:0');
    expect(() => buildFfmpegArgs([])).toThrow();
  });

  it('asks for a constant bitrate, so a still picture does not starve the platform', () => {
    const args = buildFfmpegArgs([{ format: 'mpegts', url: 'pipe:1' }]);
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
    const args = buildFfmpegArgs([{ format: 'mpegts', url: 'pipe:1' }]);
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

  it('knows a progress line', () => {
    expect(isProgressLine('frame=   42 fps= 30 q=23.0 size=N/A')).toBe(true);
    expect(isProgressLine('[flv @ 0x1] Failed to update header')).toBe(false);
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.skipIf(!hasFfmpeg)('encoded stream', () => {
  it('keeps its bitrate up on a picture that does not move', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'studio-cbr-'));
    const input = path.join(dir, 'still.webm');
    const output = path.join(dir, 'out.ts');
    // Eight seconds of one flat colour and silence: the least there is to encode.
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=0x101830:s=1920x1080:r=30:d=8',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-shortest', '-c:v', 'libvpx', '-b:v', '500k', '-c:a', 'libopus', input,
    ]);
    const args = buildFfmpegArgs([{ format: 'mpegts', url: output }]).map((arg) => (arg === 'pipe:0' ? input : arg));
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

/** Small and quick, so the tests do not depend on how fast the machine encodes 1080p. */
const SMALL = { width: 640, height: 360, fps: 30, videoKbps: 1000, audioKbps: 96 };
const QUICK = { baseMs: 100, maxMs: 400, maxFailuresBeforeLive: 3 };

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
    // A file stands in for a platform that takes the stream.
    const good = path.join(dataDir, 'good.flv');
    const statuses: EgressStatus[] = [];
    const api: ApiClient = {
      claim: async (token) =>
        token === 'good'
          ? {
              broadcastId: 'bc1',
              record: true,
              attempt: 3,
              // Nothing listens at the first, so it must fail without stopping the other or the recording.
              targets: [
                { destinationId: 'dead', url: 'rtmp://127.0.0.1:9/live/key' },
                { destinationId: 'good', url: good },
              ],
            }
          : null,
      report: async (status) => void statuses.push(status),
    };
    const server = startWorker(
      { port: 0, apiUrl: '', internalSecret: '', dataDir, ffmpegPath: 'ffmpeg', encode: SMALL, retry: QUICK },
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
      { destinationId: 'good', status: 'ended', error: null },
    ]);
    expect(statuses.every((s) => s.attempt === 3)).toBe(true);
    expect(statuses.some((s) => s.targets.find((t) => t.destinationId === 'good')?.status === 'live')).toBe(true);
    expect(last.recording!.sizeBytes).toBeGreaterThan(10_000);
    // The platform that worked got the stream in full, untouched by the one that failed.
    const delivered = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', good]).toString());
    expect(delivered).toBeGreaterThan(2.5);

    const probe = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0',
      path.join(dataDir, 'recordings', last.recording!.file),
    ]);
    expect(probe.toString().split(/\s+/).filter(Boolean).sort()).toEqual(['aac', 'h264']);
  }, 40_000);

  /** A worker whose single job records only, so no destination can fail the test. */
  async function recordingWorker(reconnectGraceMs: number) {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'worker-drop-'));
    const statuses: { at: number; status: EgressStatus }[] = [];
    const api: ApiClient = {
      claim: async () => ({ broadcastId: 'bc1', record: true, targets: [] }),
      report: async (status) => void statuses.push({ at: Date.now(), status }),
    };
    const server = startWorker(
      { port: 0, apiUrl: '', internalSecret: '', dataDir, ffmpegPath: 'ffmpeg', reconnectGraceMs },
      api,
    );
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as AddressInfo;
    const terminal = () => statuses.filter(({ status }) => status.state === 'ended' || status.state === 'failed');
    return { server, port, statuses, terminal };
  }

  /** Streams for `seconds` over a new ingest connection and returns the open socket. */
  async function streamFor(port: number, seconds: number) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ingest?token=good`);
    await new Promise((r) => socket.once('open', r));
    const source = fakeBrowserStream(seconds);
    source.stdout.on('data', (chunk: Buffer) => socket.readyState === socket.OPEN && socket.send(chunk));
    await new Promise((r) => source.once('close', r));
    return socket;
  }

  it('keeps the broadcast going when the connection drops and comes back', async () => {
    const { server, port, statuses, terminal } = await recordingWorker(8_000);

    // The network drops: no close frame, as when Wi-Fi goes away.
    (await streamFor(port, 3)).terminate();
    await new Promise((r) => setTimeout(r, 1_500));
    (await streamFor(port, 3)).close(1000);

    await expect.poll(() => terminal().length, { timeout: 20_000 }).toBe(1);
    server.close();

    // Only the deliberate end at the very close counts; the drop in between ended nothing.
    expect(terminal()[0]!.status.state).toBe('ended');
    expect(statuses.at(-1)!.status.state).toBe('ended');
    expect(statuses.filter(({ status }) => status.state === 'live').length).toBe(2);
    // Each stretch of the stream keeps its recording.
    expect(new Set(statuses.map(({ status }) => status.recording?.file).filter(Boolean)).size).toBe(2);
  }, 60_000);

  it('ends the broadcast when a dropped connection does not come back in time', async () => {
    const { server, port, terminal } = await recordingWorker(3_000);

    const socket = await streamFor(port, 3);
    const droppedAt = Date.now();
    socket.terminate();

    await expect.poll(() => terminal().length, { timeout: 20_000 }).toBe(1);
    server.close();
    expect(terminal()[0]!.at - droppedAt).toBeGreaterThanOrEqual(3_000);
    expect(terminal()[0]!.status.state).toBe('ended');
  }, 60_000);

  it('reconnects a platform that drops in the middle, while the others carry on', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'worker-flaky-'));
    const good = path.join(dataDir, 'good.flv');
    // A platform that takes part of the stream, hangs up once, then takes it again.
    let connections = 0;
    const flaky = createNetServer((socket) => {
      connections += 1;
      const first = connections === 1;
      let received = 0;
      socket.on('error', () => undefined);
      socket.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (first && received > 150_000) socket.destroy();
      });
    });
    await new Promise<void>((resolve) => flaky.listen(0, '127.0.0.1', resolve));
    const flakyPort = (flaky.address() as AddressInfo).port;

    const statuses: EgressStatus[] = [];
    const api: ApiClient = {
      claim: async () => ({
        broadcastId: 'bc1',
        record: false,
        targets: [
          { destinationId: 'flaky', url: `tcp://127.0.0.1:${flakyPort}` },
          { destinationId: 'good', url: good },
        ],
      }),
      report: async (status) => void statuses.push(status),
    };
    const server = startWorker(
      { port: 0, apiUrl: '', internalSecret: '', dataDir, ffmpegPath: 'ffmpeg', encode: SMALL, retry: QUICK },
      api,
    );
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as AddressInfo;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ingest?token=good`);
    await new Promise((r) => socket.once('open', r));
    const source = fakeBrowserStream(7);
    source.stdout.on('data', (chunk: Buffer) => socket.send(chunk));
    await new Promise((r) => source.once('close', r));
    socket.close();

    await expect.poll(() => statuses.at(-1)?.state, { timeout: 20_000 }).toBe('ended');
    server.close();
    flaky.close();

    const flakyStates = statuses.map((s) => s.targets.find((t) => t.destinationId === 'flaky')!.status);
    // live, then reconnecting after the drop, then live again: the platform was not given up on.
    const firstLive = flakyStates.indexOf('live');
    const reconnecting = flakyStates.indexOf('connecting', firstLive);
    expect(firstLive).toBeGreaterThanOrEqual(0);
    expect(reconnecting).toBeGreaterThan(firstLive);
    expect(flakyStates.indexOf('live', reconnecting)).toBeGreaterThan(reconnecting);
    expect(connections).toBeGreaterThanOrEqual(2);
    expect(statuses.at(-1)!.targets).toEqual([
      { destinationId: 'flaky', status: 'ended', error: null },
      { destinationId: 'good', status: 'ended', error: null },
    ]);
    // The platform that never dropped got the whole stream.
    const delivered = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', good]).toString());
    expect(delivered).toBeGreaterThan(5.5);
  }, 60_000);
});
