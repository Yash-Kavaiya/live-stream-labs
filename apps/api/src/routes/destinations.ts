import { createDestinationSchema, PLATFORMS } from '@studio/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { newId } from '../crypto';
import { destinations } from '../db/schema';
import {
  authorizeUrl,
  exchangeCode,
  fetchAccount,
  oauthProvider,
  type OAuthProviderId,
} from '../destinations/oauth';
import type { OAuthSecret } from '../destinations/types';
import { notFound, parse, requireUserId, type Deps } from '../http/context';
import { toDestinationDto } from '../services/broadcasts';

const CONNECTABLE = ['youtube', 'twitch', 'facebook'] as const;
type Connectable = (typeof CONNECTABLE)[number];

function connectable(platform: string): platform is Connectable {
  return (CONNECTABLE as readonly string[]).includes(platform);
}

export function destinationRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;
  const redirectUri = (platform: string) => `${config.webOrigin}/api/oauth/${platform}/callback`;

  app.get('/api/destinations', async (req) => {
    const userId = await requireUserId(deps, req);
    const rows = await db
      .select()
      .from(destinations)
      .where(eq(destinations.userId, userId))
      .orderBy(desc(destinations.createdAt));
    return rows.map(toDestinationDto);
  });

  app.post('/api/destinations', async (req) => {
    const userId = await requireUserId(deps, req);
    const input = parse(createDestinationSchema, req.body);
    const [row] = await db
      .insert(destinations)
      .values({
        id: newId(),
        userId,
        platform: input.platform,
        kind: 'rtmp',
        label: input.label,
        rtmpUrl: input.rtmpUrl,
        secretEnc: deps.box.seal(input.streamKey),
        channel: input.channel || null,
      })
      .returning();
    return toDestinationDto(row!);
  });

  app.delete('/api/destinations/:id', async (req) => {
    const userId = await requireUserId(deps, req);
    const { id } = req.params as { id: string };
    const deleted = await db
      .delete(destinations)
      .where(and(eq(destinations.id, id), eq(destinations.userId, userId)))
      .returning({ id: destinations.id });
    if (deleted.length === 0) throw notFound('Destination');
    return { ok: true };
  });

  // --- One-click connect. The signed state carries the user, so the callback needs no cookie. ---

  app.get('/api/oauth/:platform/start', async (req, reply) => {
    const userId = await requireUserId(deps, req);
    const { platform } = req.params as { platform: string };
    const provider = connectable(platform) ? oauthProvider(config, platform) : null;
    if (!provider) throw notFound('One-click connection');
    const state = await deps.signer.sign('oauth-state', { p: platform, uid: userId }, '10m');
    return reply.redirect(authorizeUrl(provider, redirectUri(platform), state));
  });

  app.get('/api/oauth/:platform/callback', async (req, reply) => {
    const { platform } = req.params as { platform: string };
    const { code, state } = req.query as { code?: string; state?: string };
    const back = (query: string) => reply.redirect(`${config.webOrigin}/app/destinations?${query}`);

    const claims = state ? await deps.signer.verify<{ p: string; uid: string }>('oauth-state', state) : null;
    const provider = connectable(platform) ? oauthProvider(config, platform) : null;
    if (!provider || !code || !claims || claims.p !== platform) return back('error=connect');

    try {
      const token = await exchangeCode(provider, deps.fetch, code, redirectUri(platform));
      const account = await fetchAccount(provider, deps.fetch, token.accessToken);
      const secret: OAuthSecret = { ...token, accountId: account.id };
      await db.insert(destinations).values({
        id: newId(),
        userId: claims.uid,
        platform: platform as OAuthProviderId & Connectable,
        kind: 'oauth',
        label: `${PLATFORMS[platform as Connectable].name} · ${account.name}`,
        secretEnc: deps.box.sealJson(secret),
        channel: platform === 'twitch' ? account.name : null,
      });
      return back(`connected=${platform}`);
    } catch (err) {
      req.log.warn({ err }, 'oauth connect failed');
      return back('error=connect');
    }
  });
}
