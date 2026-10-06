import { buildApp } from './app';
import { loadConfig, loadDotEnv } from './config';
import { SecretBox, TokenSigner } from './crypto';
import { openDb } from './db/client';
import { createAdapterResolver } from './destinations/adapters';
import { createEgressProvider } from './egress/providers';
import { LiveKitService } from './services/livekit';

loadDotEnv();
const config = loadConfig();
const { db, close } = await openDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
const signer = new TokenSigner(config.sessionSecret);

const app = await buildApp({
  config,
  db,
  signer,
  box: new SecretBox(config.encryptionKey),
  livekit: new LiveKitService(config.livekit),
  egress: createEgressProvider(config, signer),
  adapterFor: createAdapterResolver(config),
  fetch,
});

await app.listen({ host: '0.0.0.0', port: config.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}
