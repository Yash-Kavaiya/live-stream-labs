import type { Rundown } from '@studio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { rundowns } from './db/schema';
import { collectFixture } from './news/fixture';
import { memoryStore, RundownService } from './news/service';
import { createWriter, type Writer } from './news/writer';
import { createTestApp, TestClient, type TestApp } from './testing';

// 18:30 in India on 6 October 2026.
const NOW = new Date('2026-10-06T13:00:00Z');
let t: TestApp;
/** The app the current test opened, if it opened one. */
let open: TestApp | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

async function signedIn(opts: Parameters<typeof createTestApp>[0] = {}) {
  t = open = await createTestApp({ now: () => NOW, ...opts });
  const host = new TestClient(t.app);
  await host.signup();
  return host;
}

describe('daily rundown', () => {
  it('is for signed-in users only', async () => {
    await signedIn();
    const anon = new TestClient(t.app);
    for (const url of ['/api/rundowns/latest', '/api/rundowns', '/api/rundowns/2026-10-06']) expect((await anon.call('GET', url)).status).toBe(401);
    expect((await anon.call('POST', '/api/rundowns/generate')).status).toBe(401);
  });

  it('has nothing before the first one is made, and names the show', async () => {
    const host = await signedIn();
    const { status, body } = await host.call('GET', '/api/rundowns/latest');
    expect(status).toBe(200);
    expect(body).toMatchObject({ rundown: null, generating: false, error: null, show: { name: 'AI Daily', x: 'yashkavaiya' } });
    expect((await host.call('GET', '/api/rundowns')).body).toEqual([]);
  });

  it('makes the rundown for the day in India and serves it', async () => {
    const host = await signedIn();
    expect((await host.call('POST', '/api/rundowns/generate')).status).toBe(200);
    await t.deps.rundowns.generate();

    const latest = (await host.call('GET', '/api/rundowns/latest')).body;
    expect(latest.generating).toBe(false);
    expect(latest.rundown.date).toBe('2026-10-06');
    expect(latest.rundown.items.map((i: { segment: string }) => i.segment)).toEqual(['open', 'top', 'story', 'repo', 'close']);
    expect((await host.call('GET', '/api/rundowns')).body).toEqual(['2026-10-06']);
    expect((await host.call('GET', '/api/rundowns/2026-10-06')).body.items).toHaveLength(5);
  });

  it('replaces the rundown already stored for the day', async () => {
    await signedIn();
    await t.deps.rundowns.generate();
    await t.deps.rundowns.generate();
    expect(await t.deps.rundowns.dates()).toEqual(['2026-10-06']);
  });

  it('makes one rundown when asked twice at once', async () => {
    let writes = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const plain = createWriter(loadConfig({ NODE_ENV: 'test' }).news, fetch, []);
    const writer: Writer = {
      async write(collected, date, now) {
        writes += 1;
        await held;
        return plain.write(collected, date, now);
      },
    };
    const host = await signedIn({ writer });

    await host.call('POST', '/api/rundowns/generate');
    const second = await host.call('POST', '/api/rundowns/generate');
    expect(second.body.generating).toBe(true);
    release();
    await t.deps.rundowns.generate();
    expect(writes).toBe(1);
    expect(t.deps.rundowns.generating).toBe(false);
  });

  it('stores nothing and says why when no news could be collected', async () => {
    const host = await signedIn({ collect: async () => ({ items: [], warnings: ['Hacker News could not be reached'] }) });
    await t.deps.rundowns.generate();
    const { body } = await host.call('GET', '/api/rundowns/latest');
    expect(body.rundown).toBeNull();
    expect(body.error).toContain('No news source could be reached');
  });

  it('keeps the earlier rundown when a later attempt fails', async () => {
    let fail = false;
    const host = await signedIn({ collect: async () => (fail ? { items: [], warnings: [] } : collectFixture()) });
    await t.deps.rundowns.generate();
    fail = true;
    await t.deps.rundowns.generate();
    const { body } = await host.call('GET', '/api/rundowns/latest');
    expect(body.rundown.date).toBe('2026-10-06');
    expect(body.error).toContain('No news source');
  });

  it('reports a writer that throws instead of crashing', async () => {
    const host = await signedIn({ writer: { write: async () => Promise.reject(new Error('boom')) } });
    await t.deps.rundowns.generate();
    expect((await host.call('GET', '/api/rundowns/latest')).body).toMatchObject({ rundown: null, generating: false, error: 'boom' });
  });

  it('can keep rundowns in memory, newest first, without a database', async () => {
    let day = '2026-10-05T13:00:00Z';
    const service = new RundownService(memoryStore(), collectFixture, createWriter(loadConfig({ NODE_ENV: 'test' }).news, fetch, []), () => new Date(day));
    await service.generate();
    day = '2026-10-06T13:00:00Z';
    await service.generate();
    expect(await service.dates()).toEqual(['2026-10-06', '2026-10-05']);
    expect((await service.latest())!.date).toBe('2026-10-06');
    expect((await service.byDate('2026-10-05'))!.items.length).toBeGreaterThan(0);
    expect(await service.byDate('2026-10-04')).toBeNull();
  });

  it('refuses a malformed date and an unknown day', async () => {
    const host = await signedIn();
    expect((await host.call('GET', '/api/rundowns/not-a-date')).status).toBe(400);
    expect((await host.call('GET', '/api/rundowns/2020-01-01')).status).toBe(404);
  });

  it('ignores a stored rundown that no longer fits the schema', async () => {
    const host = await signedIn();
    await t.deps.db.insert(rundowns).values({ date: '2026-10-05', data: { nonsense: true } as unknown as Rundown });
    expect((await host.call('GET', '/api/rundowns/latest')).body.rundown).toBeNull();
    expect((await host.call('GET', '/api/rundowns/2026-10-05')).status).toBe(404);
  });
});
