import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EgressStatus } from '@studio/shared';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildFfmpegArgs, isProgressLine, parseFailedOutput, teeSpec } from './ffmpeg-args';
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

  it('reads ffmpeg log lines', () => {
    expect(parseFailedOutput('[tee @ 0x1] Slave muxer #1 failed: I/O error, continuing')).toBe(1);
    expect(parseFailedOutput('frame=  10 fps=30')).toBeNull();
    expect(isProgressLine('frame=   42 fps= 30 q=23.0 size=N/A')).toBe(true);
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

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
