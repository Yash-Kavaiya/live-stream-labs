import type { CommentDto } from '@studio/shared';
import type { DestinationRow } from '../db/schema';

export type Fetch = typeof fetch;

export interface OAuthSecret {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
  /** Channel, user or page id on the platform. */
  accountId: string;
}

export interface DestinationContext {
  destination: DestinationRow;
  /** Decrypted secret: the stream key (rtmp) or `OAuthSecret` JSON (oauth). */
  secret: string;
  /** Persists a rotated secret, e.g. after an OAuth token refresh. */
  saveSecret(next: string): Promise<void>;
  fetch: Fetch;
}

export type AdapterSession = Record<string, string>;

export interface PreparedTarget {
  /** Full RTMP(S) URL including the stream key. Never sent to a browser. */
  url: string;
  session?: AdapterSession;
}

export interface BroadcastInfo {
  title: string;
  description: string;
}

/** One implementation per way of getting an ingest URL out of a platform. */
export interface DestinationAdapter {
  prepare(ctx: DestinationContext, broadcast: BroadcastInfo): Promise<PreparedTarget>;
  end?(ctx: DestinationContext, session: AdapterSession): Promise<void>;
  fetchComments?(
    ctx: DestinationContext,
    session: AdapterSession,
  ): Promise<{ comments: CommentDto[]; session: AdapterSession }>;
}

export class PlatformError extends Error {
  constructor(
    readonly platform: string,
    message: string,
  ) {
    super(`${platform}: ${message}`);
  }
}

/** Calls a platform JSON API and turns a non-2xx answer into a readable `PlatformError`. */
export async function platformJson<T>(
  fetchFn: Fetch,
  platform: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetchFn(url, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error page; fall through with the status code.
  }
  if (!res.ok) {
    const err = body as { error?: { message?: string } | string; message?: string } | null;
    const detail =
      (typeof err?.error === 'object' ? err.error?.message : err?.error) ?? err?.message ?? '';
    throw new PlatformError(platform, `request failed (${res.status}) ${detail}`.trim());
  }
  return body as T;
}
