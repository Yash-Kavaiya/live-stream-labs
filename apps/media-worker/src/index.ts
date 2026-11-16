import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_ENCODE } from './ffmpeg-args';
import { startWorker } from './server';

for (const dir of [process.cwd(), path.resolve(process.cwd(), '../..')]) {
  const file = path.join(dir, '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

const env = z
  .object({
    NODE_ENV: z.string().default('development'),
    WORKER_PORT: z.coerce.number().default(4100),
    API_INTERNAL_URL: z.string().default('http://localhost:4000'),
    INTERNAL_SECRET: z.string().optional(),
    DATA_DIR: z.string().default('.data'),
    FFMPEG_PATH: z.string().default('ffmpeg'),
    // The one encode every platform gets. Lower these on a small machine (720p: 1280, 720, 4500).
    ENCODE_WIDTH: z.coerce.number().int().positive().default(DEFAULT_ENCODE.width),
    ENCODE_HEIGHT: z.coerce.number().int().positive().default(DEFAULT_ENCODE.height),
    ENCODE_FPS: z.coerce.number().int().positive().default(DEFAULT_ENCODE.fps),
    ENCODE_VIDEO_KBPS: z.coerce.number().int().positive().default(DEFAULT_ENCODE.videoKbps),
    ENCODE_AUDIO_KBPS: z.coerce.number().int().positive().default(DEFAULT_ENCODE.audioKbps),
    // 1 where the worker and the API have separate disks: recordings are sent to the API.
    UPLOAD_RECORDINGS: z.string().optional(),
  })
  .parse(process.env);

if (env.NODE_ENV === 'production' && (env.INTERNAL_SECRET?.length ?? 0) < 32) {
  throw new Error('INTERNAL_SECRET must be set to at least 32 characters in production');
}

const server = startWorker({
  port: env.WORKER_PORT,
  // Render's private network gives `host:port` without a scheme.
  apiUrl: (/^https?:\/\//.test(env.API_INTERNAL_URL) ? env.API_INTERNAL_URL : `http://${env.API_INTERNAL_URL}`).replace(/\/$/, ''),
  // Must match the API's development default.
  internalSecret: env.INTERNAL_SECRET || 'dev-only-secret-change-me-in-production!',
  dataDir: path.resolve(env.DATA_DIR),
  ffmpegPath: env.FFMPEG_PATH,
  encode: {
    width: env.ENCODE_WIDTH,
    height: env.ENCODE_HEIGHT,
    fps: env.ENCODE_FPS,
    videoKbps: env.ENCODE_VIDEO_KBPS,
    audioKbps: env.ENCODE_AUDIO_KBPS,
  },
  uploadRecordings: env.UPLOAD_RECORDINGS === '1' || env.UPLOAD_RECORDINGS === 'true',
});

// On a deploy or restart the hosts' browsers are told to reconnect (close code 1012), and do so
// to the next instance; the platforms keep waiting meanwhile.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 15_000).unref();
  });
}
