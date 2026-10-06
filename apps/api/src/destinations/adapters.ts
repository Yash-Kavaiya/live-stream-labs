import { buildRtmpTarget, type CommentDto } from '@studio/shared';
import type { Config } from '../config';
import type { DestinationRow } from '../db/schema';
import { freshAccessToken, oauthProvider, type OAuthProvider } from './oauth';
import { platformJson, PlatformError, type DestinationAdapter } from './types';

/** Works for every platform: the user pasted an ingest URL and a stream key. */
export const manualRtmpAdapter: DestinationAdapter = {
  async prepare({ destination, secret }) {
    if (!destination.rtmpUrl) throw new PlatformError(destination.platform, 'missing RTMP URL');
    return { url: buildRtmpTarget(destination.rtmpUrl, secret) };
  },
};

const YT = 'https://www.googleapis.com/youtube/v3';

function jsonInit(method: string, accessToken: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/** Creates a YouTube broadcast bound to a fresh ingest stream; YouTube starts it when video arrives. */
export function youtubeAdapter(provider: OAuthProvider): DestinationAdapter {
  return {
    async prepare(ctx, { title, description }) {
      const { accessToken } = await freshAccessToken(ctx, provider);
      const call = <T>(path: string, method: string, body?: unknown) =>
        platformJson<T>(ctx.fetch, 'youtube', `${YT}/${path}`, jsonInit(method, accessToken, body));

      const broadcast = await call<{ id: string; snippet: { liveChatId?: string } }>(
        'liveBroadcasts?part=snippet,status,contentDetails',
        'POST',
        {
          snippet: { title, description, scheduledStartTime: new Date().toISOString() },
          status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
          contentDetails: { enableAutoStart: true, enableAutoStop: true },
        },
      );
      const stream = await call<{
        id: string;
        cdn: { ingestionInfo: { ingestionAddress: string; streamName: string } };
      }>('liveStreams?part=snippet,cdn', 'POST', {
        snippet: { title },
        cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
      });
      await call(`liveBroadcasts/bind?part=id&id=${broadcast.id}&streamId=${stream.id}`, 'POST');

      const { ingestionAddress, streamName } = stream.cdn.ingestionInfo;
      return {
        url: buildRtmpTarget(ingestionAddress, streamName),
        session: { broadcastId: broadcast.id, liveChatId: broadcast.snippet.liveChatId ?? '' },
      };
    },

    async end(ctx, session) {
      if (!session.broadcastId) return;
      const { accessToken } = await freshAccessToken(ctx, provider);
      await platformJson(
        ctx.fetch,
        'youtube',
        `${YT}/liveBroadcasts/transition?part=id&broadcastStatus=complete&id=${session.broadcastId}`,
        jsonInit('POST', accessToken),
      );
    },

    async fetchComments(ctx, session) {
      if (!session.liveChatId) return { comments: [], session };
      const { accessToken } = await freshAccessToken(ctx, provider);
      const params = new URLSearchParams({
        liveChatId: session.liveChatId,
        part: 'snippet,authorDetails',
        ...(session.pageToken ? { pageToken: session.pageToken } : {}),
      });
      const res = await platformJson<{
        nextPageToken?: string;
        items: {
          id: string;
          snippet: { displayMessage?: string; publishedAt: string };
          authorDetails: { displayName: string };
        }[];
      }>(ctx.fetch, 'youtube', `${YT}/liveChat/messages?${params}`, jsonInit('GET', accessToken));

      const comments: CommentDto[] = res.items
        .filter((item) => item.snippet.displayMessage)
        .map((item) => ({
          id: item.id,
          platform: 'youtube',
          author: item.authorDetails.displayName,
          text: item.snippet.displayMessage!,
          at: item.snippet.publishedAt,
        }));
      return { comments, session: { ...session, pageToken: res.nextPageToken ?? '' } };
    },
  };
}

/** Reads the channel's stream key from Helix and sets the stream title. */
export function twitchAdapter(provider: OAuthProvider): DestinationAdapter {
  return {
    async prepare(ctx, { title }) {
      const { accessToken, accountId } = await freshAccessToken(ctx, provider);
      const headers = {
        authorization: `Bearer ${accessToken}`,
        'client-id': provider.app.clientId,
        'content-type': 'application/json',
      };
      const helix = 'https://api.twitch.tv/helix';
      const res = await platformJson<{ data: { stream_key: string }[] }>(
        ctx.fetch,
        'twitch',
        `${helix}/streams/key?broadcaster_id=${accountId}`,
        { headers },
      );
      const key = res.data[0]?.stream_key;
      if (!key) throw new PlatformError('twitch', 'no stream key returned');

      // The title is cosmetic; a failure here must not block going live.
      await ctx
        .fetch(`${helix}/channels?broadcaster_id=${accountId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ title: title.slice(0, 140) }),
        })
        .catch(() => undefined);

      return { url: buildRtmpTarget('rtmp://live.twitch.tv/app', key) };
    },
  };
}

/** Creates a Facebook live video on the connected profile and returns its RTMPS URL. */
export function facebookAdapter(provider: OAuthProvider): DestinationAdapter {
  const graph = 'https://graph.facebook.com/v21.0';
  return {
    async prepare(ctx, { title, description }) {
      const { accessToken, accountId } = await freshAccessToken(ctx, provider);
      const video = await platformJson<{ id: string; secure_stream_url: string }>(
        ctx.fetch,
        'facebook',
        `${graph}/${accountId}/live_videos`,
        {
          method: 'POST',
          body: new URLSearchParams({
            status: 'LIVE_NOW',
            title,
            description,
            access_token: accessToken,
          }),
        },
      );
      return { url: video.secure_stream_url, session: { liveVideoId: video.id } };
    },

    async end(ctx, session) {
      if (!session.liveVideoId) return;
      const { accessToken } = await freshAccessToken(ctx, provider);
      await platformJson(ctx.fetch, 'facebook', `${graph}/${session.liveVideoId}`, {
        method: 'POST',
        body: new URLSearchParams({ end_live_video: 'true', access_token: accessToken }),
      });
    },
  };
}

export type AdapterResolver = (destination: DestinationRow) => DestinationAdapter;

export function createAdapterResolver(config: Config): AdapterResolver {
  const factories = { youtube: youtubeAdapter, twitch: twitchAdapter, facebook: facebookAdapter };

  return (destination) => {
    if (destination.kind === 'rtmp') return manualRtmpAdapter;
    const platform = destination.platform as keyof typeof factories;
    const provider = factories[platform] ? oauthProvider(config, platform) : null;
    if (!provider) {
      throw new PlatformError(destination.platform, 'one-click connection is not configured');
    }
    return factories[platform](provider);
  };
}
