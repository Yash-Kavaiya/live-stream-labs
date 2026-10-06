import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { SecretBox, TokenSigner, hashPassword, verifyPassword } from '../crypto';
import type { DestinationRow } from '../db/schema';
import { createAdapterResolver } from './adapters';
import type { DestinationContext, OAuthSecret } from './types';

const config = loadConfig({
  NODE_ENV: 'test',
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  TWITCH_CLIENT_ID: 'tid',
  TWITCH_CLIENT_SECRET: 'tsecret',
});
const adapterFor = createAdapterResolver(config);
const broadcast = { title: 'Launch day', description: 'Hello' };

function destination(patch: Partial<DestinationRow>): DestinationRow {
  return {
    id: 'd1',
    userId: 'u1',
    platform: 'custom',
    kind: 'rtmp',
    label: 'Test',
    rtmpUrl: null,
    secretEnc: '',
    channel: null,
    createdAt: new Date(),
    ...patch,
  };
}

/** Records outbound calls and answers from a table of `[url fragment, JSON body]`. */
function fakeFetch(routes: [string, unknown][]) {
  const calls: { url: string; method: string; body: string }[] = [];
  const fetchFn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? 'GET', body: String(init.body ?? '') });
    const hit = routes.find(([fragment]) => url.includes(fragment));
    return new Response(JSON.stringify(hit ? hit[1] : { error: { message: 'no route' } }), {
      status: hit ? 200 : 404,
    });
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

function context(dest: DestinationRow, secret: OAuthSecret | string, fetchFn: typeof fetch) {
  const saved: string[] = [];
  const ctx: DestinationContext = {
    destination: dest,
    secret: typeof secret === 'string' ? secret : JSON.stringify(secret),
    fetch: fetchFn,
    saveSecret: async (next) => void saved.push(next),
  };
  return { ctx, saved };
}

describe('manual RTMP adapter', () => {
  it('joins the ingest URL and the stream key', async () => {
    const dest = destination({ platform: 'linkedin', rtmpUrl: 'rtmps://li.example/live/' });
    const { ctx } = context(dest, 'key-1', fetch);
    expect(await adapterFor(dest).prepare(ctx, broadcast)).toEqual({
      url: 'rtmps://li.example/live/key-1',
    });
  });
});

describe('YouTube adapter', () => {
  const dest = destination({ platform: 'youtube', kind: 'oauth' });
  const routes: [string, unknown][] = [
    ['oauth2.googleapis.com/token', { access_token: 'fresh', expires_in: 3600 }],
    ['liveBroadcasts/bind', {}],
    ['liveBroadcasts?', { id: 'bc1', snippet: { liveChatId: 'chat1' } }],
    [
      'liveStreams?',
      { id: 'st1', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://yt.example/live2', streamName: 'abcd' } } },
    ],
  ];

  it('creates a broadcast, a stream, binds them and returns the ingest target', async () => {
    const { calls, fetchFn } = fakeFetch(routes);
    const { ctx } = context(dest, { accessToken: 'tok', accountId: 'ch1' }, fetchFn);
    const target = await adapterFor(dest).prepare(ctx, broadcast);

    expect(target).toEqual({
      url: 'rtmp://yt.example/live2/abcd',
      session: { broadcastId: 'bc1', liveChatId: 'chat1' },
    });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'POST']);
    expect(calls[2]!.url).toContain('id=bc1&streamId=st1');
    expect(JSON.parse(calls[0]!.body).snippet.title).toBe('Launch day');
  });

  it('refreshes an expired access token first and saves the new one', async () => {
    const { calls, fetchFn } = fakeFetch(routes);
    const expired = { accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() - 1, accountId: 'ch1' };
    const { ctx, saved } = context(dest, expired, fetchFn);
    await adapterFor(dest).prepare(ctx, broadcast);

    expect(calls[0]!.url).toContain('oauth2.googleapis.com/token');
    expect(calls[0]!.body).toContain('refresh_token=r1');
    expect(JSON.parse(saved[0]!)).toMatchObject({ accessToken: 'fresh', refreshToken: 'r1', accountId: 'ch1' });
  });

  it('surfaces the platform error message', async () => {
    const { fetchFn } = fakeFetch([]);
    const { ctx } = context(dest, { accessToken: 'tok', accountId: 'ch1' }, fetchFn);
    await expect(adapterFor(dest).prepare(ctx, broadcast)).rejects.toThrow(/youtube: .*404.*no route/);
  });
});

describe('Twitch adapter', () => {
  it('reads the stream key for the connected channel', async () => {
    const dest = destination({ platform: 'twitch', kind: 'oauth' });
    const { calls, fetchFn } = fakeFetch([
      ['streams/key', { data: [{ stream_key: 'live_123' }] }],
      ['helix/channels', {}],
    ]);
    const { ctx } = context(dest, { accessToken: 'tok', accountId: '42' }, fetchFn);
    const target = await adapterFor(dest).prepare(ctx, broadcast);
    expect(target.url).toBe('rtmp://live.twitch.tv/app/live_123');
    expect(calls[0]!.url).toContain('broadcaster_id=42');
  });
});

describe('adapter resolver', () => {
  it('rejects one-click destinations whose app credentials are not configured', () => {
    const dest = destination({ platform: 'facebook', kind: 'oauth' });
    expect(() => adapterFor(dest)).toThrow(/not configured/);
  });
});

describe('crypto', () => {
  it('seals and opens, and detects tampering', () => {
    const box = new SecretBox('k'.repeat(32));
    const sealed = box.seal('stream-key');
    expect(sealed).not.toContain('stream-key');
    expect(box.open(sealed)).toBe('stream-key');
    expect(() => new SecretBox('other'.repeat(8)).open(sealed)).toThrow();
  });

  it('hashes passwords with a per-password salt', async () => {
    const [a, b] = await Promise.all([hashPassword('pw-one'), hashPassword('pw-one')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('pw-one', a)).toBe(true);
    expect(await verifyPassword('pw-two', a)).toBe(false);
  });

  it('does not accept a token of one type as another', async () => {
    const signer = new TokenSigner('s'.repeat(32));
    const token = await signer.sign('ingest', { bid: 'b1' }, '1h');
    expect(await signer.verify('ingest', token)).toMatchObject({ bid: 'b1' });
    expect(await signer.verify('session', token)).toBeNull();
  });
});
