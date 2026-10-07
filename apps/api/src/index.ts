import { buildApp } from './app';
import { loadConfig, loadDotEnv } from './config';
import { SecretBox, TokenSigner } from './crypto';
import { openDb } from './db/client';
import { createAdapterResolver } from './destinations/adapters';
import { createEgressProvider } from './egress/providers';
import { collectFixture } from './news/fixture';
import { startSchedule } from './news/schedule';
import { dbStore, memoryStore, RundownService } from './news/service';
import { collectNews } from './news/sources';
import { createWriter } from './news/writer';
import { LiveKitService } from './services/livekit';

loadDotEnv();
const config = loadConfig();
const { db, close } = await openDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
const signer = new TokenSigner(config.sessionSecret);

// With NEWS_FIXTURE=1 (end-to-end tests) the rundown comes from fixed items, no model is called,
// and nothing is written to the database.
const rundowns = config.news.fixture
  ? new RundownService(memoryStore(), collectFixture, createWriter(config.news, fetch, []))
  : new RundownService(dbStore(db), (now) => collectNews(fetch, now), createWriter(config.news, fetch));

const app = await buildApp({
  config,
  db,
  signer,
  box: new SecretBox(config.encryptionKey),
  livekit: new LiveKitService(config.livekit),
  egress: createEgressProvider(config, signer),
  adapterFor: createAdapterResolver(config),
  fetch,
  rundowns,
});

await app.listen({ host: '0.0.0.0', port: config.port });
const stopSchedule = config.news.fixture ? () => undefined : startSchedule(rundowns, (message) => app.log.info(message));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopSchedule();
    await app.close();
    await close();
    process.exit(0);
  });
}
