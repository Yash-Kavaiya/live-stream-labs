import {
  egressStatusSchema,
  redactRtmpTarget,
  type CommentDto,
  type EgressJob,
  type EgressStatus,
  type GoLiveResult,
} from '@studio/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { WebhookReceiver } from 'livekit-server-sdk';
import { z } from 'zod';
import { safeEqual } from '../crypto';
import { broadcastDestinations, broadcasts, egressSessions } from '../db/schema';
import type { EgressTarget, IngestClaims } from '../egress/providers';
import { HttpError, notFound, parse, requireUserId, type Deps } from '../http/context';
import {
  applyEgressStatus,
  destinationContext,
  finishBroadcast,
  getOwnedBroadcast,
  loadBroadcastTargets,
  setTargetStatus,
} from '../services/broadcasts';

export function liveRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;

  app.post('/api/broadcasts/:id/live', async (req): Promise<GoLiveResult> => {
    const userId = await requireUserId(deps, req);
    const broadcast = await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    if (broadcast.status === 'live') throw new HttpError(409, 'live', 'Already live');

    const links = await loadBroadcastTargets(deps, broadcast.id);
    if (links.length === 0) {
      throw new HttpError(400, 'no_destinations', 'Add at least one destination before going live');
    }

    // Ask every platform for an ingest URL. One platform failing must not block the others.
    const targets: EgressTarget[] = [];
    const errors: string[] = [];
    await Promise.all(
      links.map(async ({ destination }) => {
        try {
          const prepared = await deps
            .adapterFor(destination)
            .prepare(destinationContext(deps, destination), broadcast);
          targets.push({ destinationId: destination.id, url: prepared.url });
          await db
            .update(broadcastDestinations)
            .set({ status: 'connecting', error: null, session: prepared.session ?? null })
            .where(
              and(
                eq(broadcastDestinations.broadcastId, broadcast.id),
                eq(broadcastDestinations.destinationId, destination.id),
              ),
            );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Could not prepare destination';
          errors.push(message);
          await setTargetStatus(deps, broadcast.id, destination.id, 'failed', message);
        }
      }),
    );
    if (targets.length === 0) {
      throw new HttpError(502, 'destinations_failed', errors.join('; '));
    }
    req.log.info({ targets: targets.map((t) => redactRtmpTarget(t.url)) }, 'going live');

    const started = await deps.egress.start(broadcast.id, targets);
    const sessionRow = {
      broadcastId: broadcast.id,
      mode: deps.egress.mode,
      targetsEnc: deps.box.sealJson(targets),
      externalId: started.externalId,
    };
    await db
      .insert(egressSessions)
      .values(sessionRow)
      .onConflictDoUpdate({ target: egressSessions.broadcastId, set: sessionRow });
    await db
      .update(broadcasts)
      .set({ status: 'live', startedAt: new Date(), endedAt: null })
      .where(eq(broadcasts.id, broadcast.id));

    return { mode: deps.egress.mode, ingestUrl: started.ingestUrl };
  });

  app.post('/api/broadcasts/:id/end', async (req) => {
    const userId = await requireUserId(deps, req);
    const broadcast = await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    const [session] = await db
      .select()
      .from(egressSessions)
      .where(eq(egressSessions.broadcastId, broadcast.id));
    if (session) {
      await deps.egress.stop(broadcast.id, session.externalId).catch((err: unknown) => {
        req.log.warn({ err }, 'egress stop failed');
      });
    }
    await finishBroadcast(deps, broadcast.id);
    return { ok: true };
  });

  /** Comments from platforms whose chat is read server-side (YouTube). Twitch chat is read in the browser. */
  app.get('/api/broadcasts/:id/comments', async (req): Promise<CommentDto[]> => {
    const userId = await requireUserId(deps, req);
    const broadcast = await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    const links = await loadBroadcastTargets(deps, broadcast.id);

    const batches = await Promise.all(
      links.map(async ({ link, destination }) => {
        const adapter = link.session ? deps.adapterFor(destination) : null;
        if (!adapter?.fetchComments || !link.session) return [];
        try {
          const result = await adapter.fetchComments(
            destinationContext(deps, destination),
            link.session,
          );
          await db
            .update(broadcastDestinations)
            .set({ session: result.session })
            .where(
              and(
                eq(broadcastDestinations.broadcastId, broadcast.id),
                eq(broadcastDestinations.destinationId, destination.id),
              ),
            );
          return result.comments;
        } catch {
          return [];
        }
      }),
    );
    return batches.flat();
  });

  // --- Media worker callbacks (relay mode). Authenticated with the shared internal secret. ---

  function requireInternal(req: FastifyRequest): void {
    const given = req.headers['x-internal-secret'];
    if (typeof given !== 'string' || !safeEqual(given, config.internalSecret)) {
      throw new HttpError(403, 'forbidden', 'Internal endpoint');
    }
  }

  app.post('/internal/egress/claim', async (req): Promise<EgressJob> => {
    requireInternal(req);
    const { token } = parse(z.object({ token: z.string() }), req.body);
    const claims = await deps.signer.verify<IngestClaims>('ingest', token);
    if (!claims) throw new HttpError(401, 'bad_token', 'Invalid or expired ingest token');

    const [session] = await db
      .select()
      .from(egressSessions)
      .where(eq(egressSessions.broadcastId, claims.bid));
    if (!session || session.mode !== 'relay') throw notFound('Egress session');
    return {
      broadcastId: claims.bid,
      targets: deps.box.openJson<EgressTarget[]>(session.targetsEnc),
      record: true,
    };
  });

  app.post('/internal/egress/status', async (req) => {
    requireInternal(req);
    await applyEgressStatus(deps, parse(egressStatusSchema, req.body));
    return { ok: true };
  });

  // --- LiveKit Egress webhook (livekit mode). The signature is checked against the API secret. ---

  const receiver = new WebhookReceiver(config.livekit.apiKey, config.livekit.apiSecret);

  app.post('/api/livekit/webhook', async (req) => {
    const event = await receiver
      .receive(req.body as string, req.headers.authorization)
      .catch(() => null);
    const info = event?.egressInfo;
    if (!event || !info) return { ok: true };

    const [session] = await db
      .select()
      .from(egressSessions)
      .where(eq(egressSessions.externalId, info.egressId));
    if (!session) return { ok: true };

    const state: EgressStatus['state'] | null =
      event.event === 'egress_ended'
        ? info.error
          ? 'failed'
          : 'ended'
        : event.event === 'egress_started' || event.event === 'egress_updated'
          ? 'live'
          : null;
    if (!state) return { ok: true };

    const targetStatus = state === 'live' ? 'live' : state;
    const file = info.fileResults[0];
    await applyEgressStatus(deps, {
      broadcastId: session.broadcastId,
      state,
      error: info.error || null,
      targets: deps.box.openJson<EgressTarget[]>(session.targetsEnc).map((t) => ({
        destinationId: t.destinationId,
        status: targetStatus,
        error: info.error || null,
      })),
      recording:
        state !== 'live' && file
          ? { file: file.filename.replace(/^recordings\//, ''), sizeBytes: Number(file.size) }
          : null,
    });
    return { ok: true };
  });
}
