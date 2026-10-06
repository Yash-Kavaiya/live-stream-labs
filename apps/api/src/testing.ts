import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { loadConfig, type Config } from './config';
import { SecretBox, TokenSigner } from './crypto';
import { openDb } from './db/client';
import { createAdapterResolver } from './destinations/adapters';
import type { Fetch } from './destinations/types';
import { RelayEgress } from './egress/providers';
import type { Deps } from './http/context';
import { FakeLiveKit } from './services/livekit';

export interface TestApp {
  app: FastifyInstance;
  deps: Deps;
  livekit: FakeLiveKit;
  close(): Promise<void>;
}

/** A full API on an in-memory database, with LiveKit and outbound HTTP faked. */
export async function createTestApp(
  opts: { env?: Record<string, string>; fetch?: Fetch } = {},
): Promise<TestApp> {
  const config: Config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: mkdtempSync(path.join(tmpdir(), 'studio-test-')),
    ...opts.env,
  });
  const { db, close } = await openDb({});
  const signer = new TokenSigner(config.sessionSecret);
  const livekit = new FakeLiveKit();
  const deps: Deps = {
    config,
    db,
    signer,
    livekit,
    box: new SecretBox(config.encryptionKey),
    egress: new RelayEgress(signer, config.publicIngestUrl),
    adapterFor: createAdapterResolver(config),
    fetch:
      opts.fetch ??
      (async () => {
        throw new Error('unexpected outbound request in test');
      }),
  };
  const app = await buildApp(deps);
  return {
    app,
    deps,
    livekit,
    close: async () => {
      await app.close();
      await close();
    },
  };
}

/** A signed-in client: keeps the session cookie between calls. */
export class TestClient {
  private cookie = '';

  constructor(private readonly app: FastifyInstance) {}

  async call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
    const res = await this.app.inject({
      method,
      url,
      payload: body as object | undefined,
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) this.cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.statusCode, body: res.json() as any };
  }

  async signup(email = 'host@example.com') {
    return this.call('POST', '/api/auth/signup', { name: 'Host', email, password: 'correct horse' });
  }
}
