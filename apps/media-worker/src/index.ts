import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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
  })
  .parse(process.env);

if (env.NODE_ENV === 'production' && (env.INTERNAL_SECRET?.length ?? 0) < 32) {
  throw new Error('INTERNAL_SECRET must be set to at least 32 characters in production');
}

const server = startWorker({
  port: env.WORKER_PORT,
  apiUrl: env.API_INTERNAL_URL.replace(/\/$/, ''),
  // Must match the API's development default.
  internalSecret: env.INTERNAL_SECRET || 'dev-only-secret-change-me-in-production!',
  dataDir: path.resolve(env.DATA_DIR),
  ffmpegPath: env.FFMPEG_PATH,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
