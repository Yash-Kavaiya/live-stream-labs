import {
  createBroadcastSchema,
  DEFAULT_SCENE,
  joinInviteSchema,
  normalizeScene,
  updateBroadcastSchema,
  updateSceneSchema,
  type InviteDto,
  type StudioSession,
} from '@studio/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId, randomToken, sha256 } from '../crypto';
import { broadcasts, invites, users, type BroadcastRow } from '../db/schema';
import { HttpError, notFound, parse, requireUserId, type Deps } from '../http/context';
import {
  getOwnedBroadcast,
  listBroadcasts,
  setBroadcastDestinations,
  toBroadcastDtos,
} from '../services/broadcasts';
import { roomName } from '../services/livekit';

const INVITE_DAYS = 7;

export function broadcastRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, livekit, config } = deps;

  const one = async (row: BroadcastRow) => (await toBroadcastDtos(deps, [row]))[0]!;

  async function session(
    broadcast: BroadcastRow,
    role: 'host' | 'guest',
    identity: string,
    name: string,
  ): Promise<StudioSession> {
    const room = roomName(broadcast.id);
    // Scenes saved by an older version lack newer fields; fill them in before anyone reads it.
    const scene = normalizeScene(broadcast.scene);
    await livekit.ensureRoom(room, JSON.stringify(scene));
    return {
      role,
      identity,
      livekitUrl: config.livekit.url,
      token: await livekit.createToken({ room, identity, name, role }),
      broadcast: { id: broadcast.id, title: broadcast.title, status: broadcast.status },
      scene,
    };
  }

  app.get('/api/broadcasts', async (req) => listBroadcasts(deps, await requireUserId(deps, req)));

  app.post('/api/broadcasts', async (req) => {
    const userId = await requireUserId(deps, req);
    const input = parse(createBroadcastSchema, req.body);
    const [row] = await db
      .insert(broadcasts)
      .values({
        id: newId(),
        userId,
        title: input.title,
        description: input.description,
        status: input.scheduledAt ? 'scheduled' : 'draft',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        scene: DEFAULT_SCENE,
      })
      .returning();
    await setBroadcastDestinations(deps, userId, row!.id, input.destinationIds);
    return one(row!);
  });

  app.get('/api/broadcasts/:id', async (req) => {
    const userId = await requireUserId(deps, req);
    return one(await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id));
  });

  app.patch('/api/broadcasts/:id', async (req) => {
    const userId = await requireUserId(deps, req);
    const current = await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    const input = parse(updateBroadcastSchema, req.body);

    const patch: Partial<BroadcastRow> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.scheduledAt !== undefined) {
      patch.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
      if (current.status === 'draft' || current.status === 'scheduled') {
        patch.status = input.scheduledAt ? 'scheduled' : 'draft';
      }
    }
    if (input.destinationIds !== undefined) {
      if (current.status === 'live') {
        throw new HttpError(409, 'live', 'Destinations cannot change while the broadcast is live');
      }
      await setBroadcastDestinations(deps, userId, current.id, input.destinationIds);
    }
    const [row] = Object.keys(patch).length
      ? await db.update(broadcasts).set(patch).where(eq(broadcasts.id, current.id)).returning()
      : [current];
    return one(row!);
  });

  app.delete('/api/broadcasts/:id', async (req) => {
    const userId = await requireUserId(deps, req);
    const current = await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    if (current.status === 'live') throw new HttpError(409, 'live', 'End the broadcast first');
    await db.delete(broadcasts).where(eq(broadcasts.id, current.id));
    return { ok: true };
  });

  // --- Studio ---

  app.post('/api/broadcasts/:id/session', async (req) => {
    const userId = await requireUserId(deps, req);
    const broadcast = await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return session(broadcast, 'host', `host-${userId}`, user!.name);
  });

  app.put('/api/broadcasts/:id/scene', async (req) => {
    const userId = await requireUserId(deps, req);
    const broadcast = await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    const { scene } = parse(updateSceneSchema, req.body);
    await db.update(broadcasts).set({ scene }).where(eq(broadcasts.id, broadcast.id));
    await livekit.setRoomMetadata(roomName(broadcast.id), JSON.stringify(scene));
    return { scene };
  });

  app.post('/api/broadcasts/:id/participants/:identity/remove', async (req) => {
    const userId = await requireUserId(deps, req);
    const { id, identity } = req.params as { id: string; identity: string };
    const broadcast = await getOwnedBroadcast(deps, userId, id);
    await livekit.removeParticipant(roomName(broadcast.id), identity);
    return { ok: true };
  });

  app.post('/api/broadcasts/:id/participants/:identity/mute', async (req) => {
    const userId = await requireUserId(deps, req);
    const { id, identity } = req.params as { id: string; identity: string };
    const { trackSid } = parse(z.object({ trackSid: z.string().min(1) }), req.body);
    const broadcast = await getOwnedBroadcast(deps, userId, id);
    await livekit.muteTrack(roomName(broadcast.id), identity, trackSid);
    return { ok: true };
  });

  // --- Guest invites. Only the hash is stored; the link is shown once, when it is created. ---

  app.post('/api/broadcasts/:id/invites', async (req): Promise<InviteDto> => {
    const userId = await requireUserId(deps, req);
    const broadcast = await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
    await db
      .insert(invites)
      .values({ id: newId(), broadcastId: broadcast.id, tokenHash: sha256(token), expiresAt });
    return {
      token,
      url: `${config.webOrigin}/join/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  });

  async function broadcastForInvite(token: string): Promise<BroadcastRow> {
    const [row] = await db
      .select({ invite: invites, broadcast: broadcasts })
      .from(invites)
      .innerJoin(broadcasts, eq(broadcasts.id, invites.broadcastId))
      .where(eq(invites.tokenHash, sha256(token)));
    if (!row || row.invite.expiresAt < new Date()) throw notFound('Invite');
    return row.broadcast;
  }

  app.get('/api/invites/:token', async (req) => {
    const broadcast = await broadcastForInvite((req.params as { token: string }).token);
    return { title: broadcast.title };
  });

  app.post('/api/invites/:token/join', async (req) => {
    const broadcast = await broadcastForInvite((req.params as { token: string }).token);
    const { name } = parse(joinInviteSchema, req.body);
    return session(broadcast, 'guest', `guest-${newId()}`, name);
  });
}
