import { DEFAULT_SCENE } from '@studio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { livekitSettings } from './db/schema';
import { createTestApp, TestClient, type TestApp } from './testing';

const CLOUD = { url: 'wss://my-show.livekit.cloud', apiKey: 'APIabc123', apiSecret: 'cloud-secret-xyz-0987654321' };

describe('LiveKit project saved per account', () => {
  let t: TestApp;
  let host: TestClient;
  let broadcastId: string;

  beforeAll(async () => {
    t = await createTestApp();
    host = new TestClient(t.app);
    await host.signup('lk@example.com');
    broadcastId = (await host.call('POST', '/api/broadcasts', { title: 'Show' })).body.id;
  });
  afterAll(() => t.close());

  it('uses the server project until the account saves its own', async () => {
    const res = await host.call('GET', '/api/settings/livekit');
    expect(res.body).toEqual({ source: 'server', url: 'ws://localhost:7880', apiKey: null, updatedAt: null });
    expect((await host.call('GET', '/api/config')).body.livekitServerDefault).toBe(true);
  });

  it('requires a signed-in user', async () => {
    expect((await new TestClient(t.app).call('GET', '/api/settings/livekit')).status).toBe(401);
  });

  it('rejects a URL that is not a LiveKit address', async () => {
    const res = await host.call('PUT', '/api/settings/livekit', { ...CLOUD, url: 'rtmp://nope' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/wss:\/\//);
  });

  it('refuses credentials LiveKit does not accept, and saves nothing', async () => {
    t.livekit.rejectCredentials = true;
    const res = await host.call('PUT', '/api/settings/livekit', CLOUD);
    t.livekit.rejectCredentials = false;
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('livekit_rejected');
    expect((await host.call('GET', '/api/settings/livekit')).body.source).toBe('server');
  });

  it('saves the project with the secret sealed, and never returns the secret', async () => {
    const res = await host.call('PUT', '/api/settings/livekit', { ...CLOUD, url: 'https://my-show.livekit.cloud/' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'account', url: CLOUD.url, apiKey: CLOUD.apiKey });
    expect(JSON.stringify(res.body)).not.toContain(CLOUD.apiSecret);

    const [row] = await t.deps.db.select().from(livekitSettings);
    expect(row!.secretEnc).not.toContain(CLOUD.apiSecret);
    expect(t.deps.box.open(row!.secretEnc)).toBe(CLOUD.apiSecret);
  });

  it("opens the studio, for host and guests, on the account's own project", async () => {
    t.livekit.credentials.length = 0;
    const session = (await host.call('POST', `/api/broadcasts/${broadcastId}/session`)).body;
    expect(session.livekitUrl).toBe(CLOUD.url);

    const invite = (await host.call('POST', `/api/broadcasts/${broadcastId}/invites`)).body;
    const guest = await new TestClient(t.app).call('POST', `/api/invites/${invite.token}/join`, { name: 'Ana' });
    expect(guest.body.livekitUrl).toBe(CLOUD.url);
    // One gateway per project, reused for every request.
    expect(t.livekit.credentials).toEqual([CLOUD]);
  });

  it('replaces the saved project, and goes back to the server project when removed', async () => {
    const next = { ...CLOUD, apiKey: 'APInew' };
    expect((await host.call('PUT', '/api/settings/livekit', next)).body.apiKey).toBe('APInew');
    expect(await t.deps.db.select().from(livekitSettings)).toHaveLength(1);

    const res = await host.call('DELETE', '/api/settings/livekit');
    expect(res.body.source).toBe('server');
    expect((await host.call('POST', `/api/broadcasts/${broadcastId}/session`)).body.livekitUrl).toBe('ws://localhost:7880');
  });

  it("keeps one account's project from another", async () => {
    await host.call('PUT', '/api/settings/livekit', CLOUD);
    const other = new TestClient(t.app);
    await other.signup('other@example.com');
    expect((await other.call('GET', '/api/settings/livekit')).body.source).toBe('server');
  });
});

describe('a server with no LiveKit project of its own', () => {
  let t: TestApp;
  let host: TestClient;

  beforeAll(async () => {
    t = await createTestApp({ env: { NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(32), ENCRYPTION_KEY: 'e'.repeat(32), INTERNAL_SECRET: 'i'.repeat(32) } });
    host = new TestClient(t.app);
    await host.signup();
  });
  afterAll(() => t.close());

  it('asks the account for its project before the studio opens, then uses it', async () => {
    expect((await host.call('GET', '/api/config')).body.livekitServerDefault).toBe(false);
    expect((await host.call('GET', '/api/settings/livekit')).body.source).toBe('none');

    const id = (await host.call('POST', '/api/broadcasts', { title: 'Show' })).body.id;
    const refused = await host.call('POST', `/api/broadcasts/${id}/session`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('livekit_not_configured');
    // Scenes still save while no studio is open.
    expect((await host.call('PUT', `/api/broadcasts/${id}/scene`, { scene: DEFAULT_SCENE })).status).toBe(200);

    await host.call('PUT', '/api/settings/livekit', CLOUD);
    expect((await host.call('POST', `/api/broadcasts/${id}/session`)).body.livekitUrl).toBe(CLOUD.url);
  });
});
