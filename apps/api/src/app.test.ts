import { DEFAULT_SCENE, TOPIC_EGRESS, type EgressStatus } from '@studio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { destinations } from './db/schema';
import { createTestApp, TestClient, type TestApp } from './testing';

let t: TestApp;
let host: TestClient;

beforeAll(async () => {
  t = await createTestApp();
  host = new TestClient(t.app);
});
afterAll(() => t.close());

const internal = { 'x-internal-secret': '' };
const STREAM_KEY = 'super-secret-key-123';

describe('auth', () => {
  it('signs up, rejects a duplicate email, and reports the current user', async () => {
    expect((await host.signup()).status).toBe(200);
    expect((await new TestClient(t.app).signup()).status).toBe(409);
    expect((await host.call('GET', '/api/auth/me')).body.user.email).toBe('host@example.com');
  });

  it('logs in with the right password only', async () => {
    const client = new TestClient(t.app);
    const login = (password: string) =>
      client.call('POST', '/api/auth/login', { email: 'HOST@example.com', password });
    expect((await login('wrong password')).status).toBe(401);
    expect((await login('correct horse')).status).toBe(200);
  });

  it('refuses anonymous access to private routes', async () => {
    const anon = new TestClient(t.app);
    expect((await anon.call('GET', '/api/broadcasts')).status).toBe(401);
    expect((await anon.call('GET', '/api/destinations')).status).toBe(401);
  });

  it('validates input', async () => {
    const res = await new TestClient(t.app).call('POST', '/api/auth/signup', {
      name: 'x',
      email: 'not-an-email',
      password: 'short',
    });
    expect(res.status).toBe(400);
  });
});

describe('destinations', () => {
  it('stores the stream key encrypted and never returns it', async () => {
    const res = await host.call('POST', '/api/destinations', {
      platform: 'youtube',
      label: 'My channel',
      rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: STREAM_KEY,
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(STREAM_KEY);
    expect(res.body.rtmpHost).toBe('a.rtmp.youtube.com');

    const [row] = await t.deps.db.select().from(destinations);
    expect(row!.secretEnc).not.toContain(STREAM_KEY);
    expect(t.deps.box.open(row!.secretEnc)).toBe(STREAM_KEY);
  });

  it('rejects a non-RTMP URL', async () => {
    const res = await host.call('POST', '/api/destinations', {
      platform: 'custom',
      label: 'Bad',
      rtmpUrl: 'https://example.com/live',
      streamKey: 'k',
    });
    expect(res.status).toBe(400);
  });

  it("hides one user's destinations from another", async () => {
    const other = new TestClient(t.app);
    await other.signup('other@example.com');
    expect((await other.call('GET', '/api/destinations')).body).toEqual([]);
    const [mine] = (await host.call('GET', '/api/destinations')).body;
    expect((await other.call('DELETE', `/api/destinations/${mine.id}`)).status).toBe(404);
  });
});

describe('broadcast lifecycle', () => {
  let broadcastId: string;
  let destinationId: string;
  let room: string;

  it('creates a broadcast with destinations attached', async () => {
    destinationId = (await host.call('GET', '/api/destinations')).body[0].id;
    const res = await host.call('POST', '/api/broadcasts', {
      title: 'Launch day',
      destinationIds: [destinationId, 'someone-elses-id'],
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
    expect(res.body.destinations).toHaveLength(1);
    broadcastId = res.body.id;
    room = `b_${broadcastId}`;
  });

  it('marks a broadcast with a start time as scheduled', async () => {
    const res = await host.call('POST', '/api/broadcasts', {
      title: 'Later',
      scheduledAt: '2030-01-01T10:00:00.000Z',
    });
    expect(res.body.status).toBe('scheduled');
  });

  it('opens a host studio session and seeds the room with the scene', async () => {
    const res = await host.call('POST', `/api/broadcasts/${broadcastId}/session`);
    expect(res.body.role).toBe('host');
    expect(res.body.token).toMatch(/^fake\.host\.host-/);
    expect(JSON.parse(t.livekit.metadata.get(room)!)).toEqual(DEFAULT_SCENE);
  });

  it('lets a guest join through an invite link without an account', async () => {
    const invite = (await host.call('POST', `/api/broadcasts/${broadcastId}/invites`)).body;
    expect(invite.url).toContain(`/join/${invite.token}`);

    const guest = new TestClient(t.app);
    expect((await guest.call('GET', `/api/invites/${invite.token}`)).body.title).toBe('Launch day');
    const joined = await guest.call('POST', `/api/invites/${invite.token}/join`, { name: 'Ada' });
    expect(joined.body.role).toBe('guest');
    expect(joined.body.identity).toMatch(/^guest-/);

    expect((await guest.call('POST', '/api/invites/not-a-token/join', { name: 'Ada' })).status).toBe(404);
    // A guest session grants nothing on the host API.
    expect((await guest.call('PUT', `/api/broadcasts/${broadcastId}/scene`, {})).status).toBe(401);
  });

  it('validates, saves and pushes scene changes to the room', async () => {
    const scene = { ...DEFAULT_SCENE, layout: 'spotlight', stage: ['cam:host-1', 'screen:host-1'] };
    const ok = await host.call('PUT', `/api/broadcasts/${broadcastId}/scene`, { scene });
    expect(ok.status).toBe(200);
    expect(JSON.parse(t.livekit.metadata.get(room)!).layout).toBe('spotlight');

    const bad = await host.call('PUT', `/api/broadcasts/${broadcastId}/scene`, {
      scene: { ...scene, layout: 'nope' },
    });
    expect(bad.status).toBe(400);
  });

  it('removes a guest on request', async () => {
    await host.call('POST', `/api/broadcasts/${broadcastId}/participants/guest-1/remove`);
    expect(t.livekit.removed).toEqual(['guest-1']);
  });

  it('goes live: the worker claims the job and gets the full RTMP target', async () => {
    internal['x-internal-secret'] = t.deps.config.internalSecret;
    const live = await host.call('POST', `/api/broadcasts/${broadcastId}/live`);
    expect(live.status).toBe(200);
    expect(live.body.mode).toBe('relay');
    expect(live.body.ingestUrl).not.toContain(STREAM_KEY);
    const token = new URL(live.body.ingestUrl).searchParams.get('token')!;

    const denied = await t.app.inject({
      method: 'POST',
      url: '/internal/egress/claim',
      payload: { token },
    });
    expect(denied.statusCode).toBe(403);

    const claim = await t.app.inject({
      method: 'POST',
      url: '/internal/egress/claim',
      payload: { token },
      headers: internal,
    });
    expect(claim.json()).toEqual({
      broadcastId,
      record: true,
      targets: [{ destinationId, url: `rtmp://a.rtmp.youtube.com/live2/${STREAM_KEY}` }],
    });

    const dto = (await host.call('GET', `/api/broadcasts/${broadcastId}`)).body;
    expect(dto.status).toBe('live');
    expect(dto.destinations[0].status).toBe('connecting');
    expect((await host.call('POST', `/api/broadcasts/${broadcastId}/live`)).status).toBe(409);
  });

  const report = (status: EgressStatus) =>
    t.app.inject({ method: 'POST', url: '/internal/egress/status', payload: status, headers: internal });

  it('records per-destination status from the worker and relays it to the studio', async () => {
    const status: EgressStatus = {
      broadcastId,
      state: 'live',
      error: null,
      recording: null,
      targets: [{ destinationId, status: 'live', error: null }],
    };
    expect((await report(status)).statusCode).toBe(200);
    const dto = (await host.call('GET', `/api/broadcasts/${broadcastId}`)).body;
    expect(dto.destinations[0].status).toBe('live');
    expect(t.livekit.sent.at(-1)).toMatchObject({ room, topic: TOPIC_EGRESS, payload: status });
  });

  it('ends the broadcast and lists the recording once', async () => {
    const ended: EgressStatus = {
      broadcastId,
      state: 'ended',
      error: null,
      recording: { file: 'rec-1.mp4', sizeBytes: 1234 },
      targets: [{ destinationId, status: 'ended', error: null }],
    };
    await report(ended);
    await report(ended);

    const dto = (await host.call('GET', `/api/broadcasts/${broadcastId}`)).body;
    expect(dto.status).toBe('ended');
    expect(dto.endedAt).not.toBeNull();

    const recordings = (await host.call('GET', '/api/recordings')).body;
    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toMatchObject({ broadcastTitle: 'Launch day', sizeBytes: 1234 });

    const shared = await new TestClient(t.app).call('GET', `/api/watch/${recordings[0].shareToken}`);
    expect(shared.body.title).toBe('Launch day');
  });

  it('refuses to go live without a destination', async () => {
    const empty = (await host.call('POST', '/api/broadcasts', { title: 'Empty' })).body;
    expect((await host.call('POST', `/api/broadcasts/${empty.id}/live`)).status).toBe(400);
  });
});
