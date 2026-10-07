import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_SHOW, type Show } from './news/show';

const DEV_SECRET = 'dev-only-secret-change-me-in-production!';

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_INGEST_URL: z.string().default('ws://localhost:4100/ingest'),

  SESSION_SECRET: optional,
  ENCRYPTION_KEY: optional,
  INTERNAL_SECRET: optional,

  DATABASE_URL: optional,
  DATA_DIR: z.string().default('.data'),

  LIVEKIT_URL: z.string().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().default('devkey'),
  LIVEKIT_API_SECRET: z.string().default('secret'),

  EGRESS_MODE: z.enum(['relay', 'livekit']).default('relay'),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  TWITCH_CLIENT_ID: optional,
  TWITCH_CLIENT_SECRET: optional,
  FACEBOOK_APP_ID: optional,
  FACEBOOK_APP_SECRET: optional,

  NVIDIA_API_KEY: optional,
  NEWS_MODEL: z.string().default('nvidia/nemotron-3-ultra-550b-a55b'),
  NEWS_FALLBACK_MODEL: z.string().default('nvidia/nemotron-3-super-120b-a12b'),
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
  SHOW_NAME: optional,
  SHOW_HOST: optional,
  SHOW_X: optional,
  SHOW_GITHUB: optional,
  SHOW_LINKEDIN: optional,
  /** Tests only: build the rundown from fixed items, with no network and no model. */
  NEWS_FIXTURE: optional,
});

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
}

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  webOrigin: string;
  publicIngestUrl: string;
  sessionSecret: string;
  encryptionKey: string;
  internalSecret: string;
  databaseUrl: string | undefined;
  dataDir: string;
  livekit: { url: string; apiKey: string; apiSecret: string };
  egressMode: 'relay' | 'livekit';
  oauth: { google?: OAuthApp; twitch?: OAuthApp; facebook?: OAuthApp };
  news: NewsConfig;
}

/** The daily rundown: which models may write it, and whose show it is. */
export interface NewsConfig {
  nvidiaKey: string | undefined;
  model: string;
  fallbackModel: string;
  geminiKey: string | undefined;
  geminiModel: string;
  show: Show;
  fixture: boolean;
}

function oauthApp(clientId?: string, clientSecret?: string): OAuthApp | undefined {
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/** Loads the repo-root .env when present, wherever the process was started from. */
export function loadDotEnv(): void {
  for (const dir of [process.cwd(), path.resolve(process.cwd(), '../..')]) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const env = envSchema.parse(source);

  const secret = (name: 'SESSION_SECRET' | 'ENCRYPTION_KEY' | 'INTERNAL_SECRET'): string => {
    const value = env[name];
    if (value && value.length >= 32) return value;
    if (env.NODE_ENV === 'production') {
      throw new Error(`${name} must be set to at least 32 characters in production`);
    }
    return value ?? DEV_SECRET;
  };

  return {
    env: env.NODE_ENV,
    port: env.API_PORT,
    webOrigin: env.WEB_ORIGIN.replace(/\/$/, ''),
    publicIngestUrl: env.PUBLIC_INGEST_URL,
    sessionSecret: secret('SESSION_SECRET'),
    encryptionKey: secret('ENCRYPTION_KEY'),
    internalSecret: secret('INTERNAL_SECRET'),
    databaseUrl: env.DATABASE_URL,
    dataDir: path.resolve(env.DATA_DIR),
    livekit: { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET },
    egressMode: env.EGRESS_MODE,
    oauth: {
      google: oauthApp(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
      twitch: oauthApp(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET),
      facebook: oauthApp(env.FACEBOOK_APP_ID, env.FACEBOOK_APP_SECRET),
    },
    news: {
      nvidiaKey: env.NVIDIA_API_KEY,
      model: env.NEWS_MODEL,
      fallbackModel: env.NEWS_FALLBACK_MODEL,
      geminiKey: env.GEMINI_API_KEY,
      geminiModel: env.GEMINI_MODEL,
      show: {
        name: env.SHOW_NAME ?? DEFAULT_SHOW.name,
        host: env.SHOW_HOST ?? DEFAULT_SHOW.host,
        x: (env.SHOW_X ?? DEFAULT_SHOW.x).replace(/^@/, ''),
        github: env.SHOW_GITHUB ?? DEFAULT_SHOW.github,
        linkedin: env.SHOW_LINKEDIN ?? DEFAULT_SHOW.linkedin,
      },
      fixture: env.NEWS_FIXTURE === '1',
    },
  };
}
