import {
  TOPIC_EGRESS,
  type BroadcastDto,
  type DestinationDto,
  type DestinationStatus,
  type EgressStatus,
} from '@studio/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { newId, randomToken } from '../crypto';
import {
  broadcastDestinations,
  broadcasts,
  destinations,
  egressSessions,
  recordings,
  type BroadcastRow,
  type DestinationRow,
} from '../db/schema';
import type { DestinationContext } from '../destinations/types';
import { notFound, type Deps } from '../http/context';
import { roomName } from './livekit';

function rtmpHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.replace(/^rtmp/, 'http')).host;
  } catch {
    return null;
  }
}

export function toDestinationDto(row: DestinationRow): DestinationDto {
  return {
    id: row.id,
    platform: row.platform,
    kind: row.kind,
    label: row.label,
    rtmpHost: rtmpHost(row.rtmpUrl),
    channel: row.channel,
    createdAt: row.createdAt.toISOString(),
  };
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

export async function getOwnedBroadcast(deps: Deps, userId: string, id: string) {
  const [row] = await deps.db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.id, id), eq(broadcasts.userId, userId)));
  if (!row) throw notFound('Broadcast');
  return row;
}

export async function loadBroadcastTargets(deps: Deps, broadcastId: string) {
  return deps.db
    .select({ link: broadcastDestinations, destination: destinations })
    .from(broadcastDestinations)
    .innerJoin(destinations, eq(destinations.id, broadcastDestinations.destinationId))
    .where(eq(broadcastDestinations.broadcastId, broadcastId));
}

export async function toBroadcastDtos(deps: Deps, rows: BroadcastRow[]): Promise<BroadcastDto[]> {
  if (rows.length === 0) return [];
  const links = await deps.db
    .select({ link: broadcastDestinations, destination: destinations })
    .from(broadcastDestinations)
    .innerJoin(destinations, eq(destinations.id, broadcastDestinations.destinationId))
    .where(
      inArray(
        broadcastDestinations.broadcastId,
        rows.map((r) => r.id),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    scheduledAt: iso(row.scheduledAt),
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    createdAt: row.createdAt.toISOString(),
    destinations: links
      .filter((l) => l.link.broadcastId === row.id)
      .map((l) => ({
        destination: toDestinationDto(l.destination),
        status: l.link.status,
        error: l.link.error,
      })),
  }));
}

export async function listBroadcasts(deps: Deps, userId: string): Promise<BroadcastDto[]> {
  const rows = await deps.db
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.userId, userId))
    .orderBy(desc(broadcasts.createdAt));
  return toBroadcastDtos(deps, rows);
}

/** Replaces the set of destinations attached to a broadcast, keeping only ones the user owns. */
export async function setBroadcastDestinations(
  deps: Deps,
  userId: string,
  broadcastId: string,
  destinationIds: string[],
): Promise<void> {
  const owned = destinationIds.length
    ? await deps.db
        .select({ id: destinations.id })
        .from(destinations)
        .where(and(eq(destinations.userId, userId), inArray(destinations.id, destinationIds)))
    : [];
  await deps.db
    .delete(broadcastDestinations)
    .where(eq(broadcastDestinations.broadcastId, broadcastId));
  if (owned.length) {
    await deps.db
      .insert(broadcastDestinations)
      .values(owned.map((d) => ({ broadcastId, destinationId: d.id })));
  }
}

export function destinationContext(deps: Deps, destination: DestinationRow): DestinationContext {
  return {
    destination,
    secret: deps.box.open(destination.secretEnc),
    fetch: deps.fetch,
    saveSecret: async (next) => {
      await deps.db
        .update(destinations)
        .set({ secretEnc: deps.box.seal(next) })
        .where(eq(destinations.id, destination.id));
    },
  };
}

export async function setTargetStatus(
  deps: Deps,
  broadcastId: string,
  destinationId: string,
  status: DestinationStatus,
  error: string | null = null,
): Promise<void> {
  await deps.db
    .update(broadcastDestinations)
    .set({ status, error })
    .where(
      and(
        eq(broadcastDestinations.broadcastId, broadcastId),
        eq(broadcastDestinations.destinationId, destinationId),
      ),
    );
}

/** Tells each platform the stream is over and forgets the egress session. Safe to call twice. */
export async function finishBroadcast(deps: Deps, broadcastId: string): Promise<void> {
  const targets = await loadBroadcastTargets(deps, broadcastId);
  await Promise.all(
    targets.map(async ({ link, destination }) => {
      if (!link.session) return;
      try {
        await deps.adapterFor(destination).end?.(destinationContext(deps, destination), link.session);
      } catch {
        // The platform also ends the broadcast by itself when the video stops.
      }
    }),
  );
  await deps.db
    .update(broadcastDestinations)
    .set({ status: 'ended', session: null })
    .where(
      and(
        eq(broadcastDestinations.broadcastId, broadcastId),
        inArray(broadcastDestinations.status, ['connecting', 'live']),
      ),
    );
  await deps.db
    .update(broadcasts)
    .set({ status: 'ended', endedAt: new Date() })
    .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, 'live')));
  await deps.db.delete(egressSessions).where(eq(egressSessions.broadcastId, broadcastId));
}

/**
 * Single entry point for egress progress, whichever provider reports it (media worker or LiveKit
 * webhook). Persists it, then fans it out to the studio over the room's data channel.
 */
export async function applyEgressStatus(deps: Deps, status: EgressStatus): Promise<void> {
  const { broadcastId } = status;
  for (const target of status.targets) {
    await setTargetStatus(deps, broadcastId, target.destinationId, target.status, target.error);
  }

  if (status.recording) {
    const { file, sizeBytes } = status.recording;
    const [known] = await deps.db.select().from(recordings).where(eq(recordings.file, file));
    if (!known) {
      await deps.db
        .insert(recordings)
        .values({ id: newId(), broadcastId, file, sizeBytes, shareToken: randomToken(18) });
    }
  }

  if (status.state === 'ended' || status.state === 'failed') {
    await finishBroadcast(deps, broadcastId);
  }

  await deps.livekit.sendData(roomName(broadcastId), TOPIC_EGRESS, status);
}
