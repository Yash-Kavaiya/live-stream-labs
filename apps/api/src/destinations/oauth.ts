import type { Config, OAuthApp } from '../config';
import type { DestinationContext, Fetch, OAuthSecret } from './types';
import { platformJson, PlatformError } from './types';

export type OAuthProviderId = 'google' | 'youtube' | 'twitch' | 'facebook';

export interface OAuthProvider {
  id: OAuthProviderId;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
  app: OAuthApp;
}

const GRAPH = 'https://graph.facebook.com/v21.0';

export function oauthProvider(config: Config, id: OAuthProviderId): OAuthProvider | null {
  const { google, twitch, facebook } = config.oauth;
  switch (id) {
    case 'google':
      return google
        ? {
            id,
            app: google,
            authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            scopes: ['openid', 'email', 'profile'],
          }
        : null;
    case 'youtube':
      return google
        ? {
            id,
            app: google,
            authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
            // offline + consent is what makes Google return a refresh token.
            extraAuthParams: { access_type: 'offline', prompt: 'consent' },
          }
        : null;
    case 'twitch':
      return twitch
        ? {
            id,
            app: twitch,
            authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
            tokenUrl: 'https://id.twitch.tv/oauth2/token',
            scopes: ['channel:read:stream_key', 'channel:manage:broadcast'],
          }
        : null;
    case 'facebook':
      return facebook
        ? {
            id,
            app: facebook,
            authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
            tokenUrl: `${GRAPH}/oauth/access_token`,
            scopes: ['publish_video'],
          }
        : null;
  }
}

export function authorizeUrl(provider: OAuthProvider, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: provider.app.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: provider.scopes.join(' '),
    state,
    ...provider.extraAuthParams,
  });
  return `${provider.authorizeUrl}?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function toSecret(token: TokenResponse, previous?: OAuthSecret): Omit<OAuthSecret, 'accountId'> {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? previous?.refreshToken,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  };
}

function tokenRequest(provider: OAuthProvider, fetchFn: Fetch, params: Record<string, string>) {
  return platformJson<TokenResponse>(fetchFn, provider.id, provider.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: provider.app.clientId,
      client_secret: provider.app.clientSecret,
      ...params,
    }),
  });
}

export async function exchangeCode(
  provider: OAuthProvider,
  fetchFn: Fetch,
  code: string,
  redirectUri: string,
): Promise<Omit<OAuthSecret, 'accountId'>> {
  let token = await tokenRequest(provider, fetchFn, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  if (provider.id === 'facebook') {
    // Facebook has no refresh tokens; swap the short-lived token for a 60-day one instead.
    token = await tokenRequest(provider, fetchFn, {
      grant_type: 'fb_exchange_token',
      fb_exchange_token: token.access_token,
    });
  }
  return toSecret(token);
}

export interface OAuthAccount {
  id: string;
  name: string;
  email?: string;
}

/** Who did the user just connect? Used for the destination label and account id. */
export async function fetchAccount(
  provider: OAuthProvider,
  fetchFn: Fetch,
  accessToken: string,
): Promise<OAuthAccount> {
  const auth = { authorization: `Bearer ${accessToken}` };
  switch (provider.id) {
    case 'google': {
      const me = await platformJson<{ sub: string; name?: string; email: string }>(
        fetchFn,
        'google',
        'https://openidconnect.googleapis.com/v1/userinfo',
        { headers: auth },
      );
      return { id: me.sub, name: me.name ?? me.email, email: me.email };
    }
    case 'youtube': {
      const res = await platformJson<{ items?: { id: string; snippet: { title: string } }[] }>(
        fetchFn,
        'youtube',
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: auth },
      );
      const channel = res.items?.[0];
      if (!channel) throw new PlatformError('youtube', 'this Google account has no channel');
      return { id: channel.id, name: channel.snippet.title };
    }
    case 'twitch': {
      const res = await platformJson<{ data: { id: string; login: string }[] }>(
        fetchFn,
        'twitch',
        'https://api.twitch.tv/helix/users',
        { headers: { ...auth, 'client-id': provider.app.clientId } },
      );
      const user = res.data[0];
      if (!user) throw new PlatformError('twitch', 'user lookup returned nothing');
      return { id: user.id, name: user.login };
    }
    case 'facebook': {
      const me = await platformJson<{ id: string; name: string }>(
        fetchFn,
        'facebook',
        `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
      );
      return me;
    }
  }
}

/** Returns a valid access token, refreshing and persisting it first when it is about to expire. */
export async function freshAccessToken(
  ctx: DestinationContext,
  provider: OAuthProvider,
): Promise<{ accessToken: string; accountId: string }> {
  const secret = JSON.parse(ctx.secret) as OAuthSecret;
  const expiring = secret.expiresAt !== undefined && secret.expiresAt - Date.now() < 60_000;
  if (!expiring || !secret.refreshToken) return secret;

  const token = await tokenRequest(provider, ctx.fetch, {
    grant_type: 'refresh_token',
    refresh_token: secret.refreshToken,
  });
  const next: OAuthSecret = { ...toSecret(token, secret), accountId: secret.accountId };
  await ctx.saveSecret(JSON.stringify(next));
  return next;
}
