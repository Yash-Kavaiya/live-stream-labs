import type { LiveKitSettingsDto } from '@studio/shared';
import { eq } from 'drizzle-orm';
import type { LiveKitCredentials } from '../config';
import { sha256 } from '../crypto';
import { broadcasts, livekitSettings } from '../db/schema';
import { HttpError, type Deps } from '../http/context';
import type { LiveKitGateway } from './livekit';

export const LIVEKIT_NOT_CONFIGURED = 'livekit_not_configured';

/** Gateways are cheap but hold an HTTP client; reuse one per project rather than one per request. */
const MAX_CACHED = 200;
const cache = new Map<string, LiveKitGateway>();

function gatewayFor(deps: Deps, credentials: LiveKitCredentials): LiveKitGateway {
  const key = sha256(`${credentials.url}\n${credentials.apiKey}\n${credentials.apiSecret}`);
  let gateway = cache.get(key);
  if (!gateway) {
    gateway = deps.livekitFactory(credentials);
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(key, gateway);
  }
  return gateway;
}

/** Drops cached gateways, so a test's fresh factory is used. */
export function clearLiveKitCache(): void {
  cache.clear();
}

/** The account's own project if it saved one, otherwise the server's. */
export async function livekitCredentials(deps: Deps, userId: string): Promise<LiveKitCredentials | undefined> {
  const [row] = await deps.db.select().from(livekitSettings).where(eq(livekitSettings.userId, userId));
  if (row) return { url: row.url, apiKey: row.apiKey, apiSecret: deps.box.open(row.secretEnc) };
  return deps.config.livekit;
}

export interface LiveKitTarget {
  url: string;
  gateway: LiveKitGateway;
}

/** The LiveKit project that a user's studios run on. Fails with a clear message when there is none. */
export async function livekitFor(deps: Deps, userId: string): Promise<LiveKitTarget> {
  const credentials = await livekitCredentials(deps, userId);
  if (!credentials) {
    throw new HttpError(
      409,
      LIVEKIT_NOT_CONFIGURED,
      'Add your LiveKit Cloud project in Settings before opening the studio',
    );
  }
  return { url: credentials.url, gateway: gatewayFor(deps, credentials) };
}

/** The LiveKit project of a broadcast's owner, or null when it has none (nothing to notify). */
export async function livekitForBroadcast(deps: Deps, broadcastId: string): Promise<LiveKitTarget | null> {
  const [row] = await deps.db
    .select({ userId: broadcasts.userId })
    .from(broadcasts)
    .where(eq(broadcasts.id, broadcastId));
  if (!row) return null;
  const credentials = await livekitCredentials(deps, row.userId);
  return credentials ? { url: credentials.url, gateway: gatewayFor(deps, credentials) } : null;
}

export async function getLiveKitSettings(deps: Deps, userId: string): Promise<LiveKitSettingsDto> {
  const [row] = await deps.db.select().from(livekitSettings).where(eq(livekitSettings.userId, userId));
  if (row) return { source: 'account', url: row.url, apiKey: row.apiKey, updatedAt: row.updatedAt.toISOString() };
  const server = deps.config.livekit;
  // The server's key is not shown: it is not this account's.
  return server
    ? { source: 'server', url: server.url, apiKey: null, updatedAt: null }
    : { source: 'none', url: null, apiKey: null, updatedAt: null };
}

/** Checks the credentials against LiveKit, then saves them with the secret sealed. */
export async function saveLiveKitSettings(
  deps: Deps,
  userId: string,
  credentials: LiveKitCredentials,
): Promise<LiveKitSettingsDto> {
  // LiveKit Egress runs in the server's project and must find the studio's room there.
  if (deps.egress.mode === 'livekit') {
    throw new HttpError(409, 'livekit_egress', 'This server streams through its own LiveKit project, so studios use it too');
  }
  try {
    await deps.livekitFactory(credentials).verify();
  } catch (err) {
    const reason = err instanceof Error && err.message ? `: ${err.message.slice(0, 200)}` : '';
    throw new HttpError(
      400,
      'livekit_rejected',
      `LiveKit did not accept this URL, API key and secret${reason}. Check them in your LiveKit Cloud project under Settings → API keys.`,
    );
  }
  const values = {
    url: credentials.url,
    apiKey: credentials.apiKey,
    secretEnc: deps.box.seal(credentials.apiSecret),
    updatedAt: new Date(),
  };
  await deps.db
    .insert(livekitSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: livekitSettings.userId, set: values });
  return getLiveKitSettings(deps, userId);
}

export async function deleteLiveKitSettings(deps: Deps, userId: string): Promise<LiveKitSettingsDto> {
  await deps.db.delete(livekitSettings).where(eq(livekitSettings.userId, userId));
  return getLiveKitSettings(deps, userId);
}
