import type { BroadcastStatus, DestinationStatus, PlatformId, Rundown, Scene } from '@studio/shared';
import { bigint, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  googleSub: text('google_sub').unique(),
  createdAt: createdAt(),
});

export const destinations = pgTable('destinations', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').$type<PlatformId>().notNull(),
  kind: text('kind').$type<'rtmp' | 'oauth'>().notNull(),
  label: text('label').notNull(),
  rtmpUrl: text('rtmp_url'),
  /** Sealed stream key (rtmp) or sealed OAuth token JSON (oauth). */
  secretEnc: text('secret_enc').notNull(),
  channel: text('channel'),
  createdAt: createdAt(),
});

export const broadcasts = pgTable('broadcasts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').$type<BroadcastStatus>().notNull().default('draft'),
  scheduledAt: ts('scheduled_at'),
  startedAt: ts('started_at'),
  endedAt: ts('ended_at'),
  scene: jsonb('scene').$type<Scene>().notNull(),
  createdAt: createdAt(),
});

export const broadcastDestinations = pgTable(
  'broadcast_destinations',
  {
    broadcastId: text('broadcast_id')
      .notNull()
      .references(() => broadcasts.id, { onDelete: 'cascade' }),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    status: text('status').$type<DestinationStatus>().notNull().default('idle'),
    error: text('error'),
    /** Adapter state for this broadcast, e.g. the YouTube broadcast and live chat ids. */
    session: jsonb('session').$type<Record<string, string>>(),
  },
  (t) => [primaryKey({ columns: [t.broadcastId, t.destinationId] })],
);

export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  broadcastId: text('broadcast_id')
    .notNull()
    .references(() => broadcasts.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
});

export const egressSessions = pgTable('egress_sessions', {
  broadcastId: text('broadcast_id')
    .primaryKey()
    .references(() => broadcasts.id, { onDelete: 'cascade' }),
  mode: text('mode').$type<'relay' | 'livekit'>().notNull(),
  /** Sealed list of RTMP targets, stream keys included. */
  targetsEnc: text('targets_enc').notNull(),
  externalId: text('external_id'),
  createdAt: createdAt(),
});

export const recordings = pgTable('recordings', {
  id: text('id').primaryKey(),
  broadcastId: text('broadcast_id')
    .notNull()
    .references(() => broadcasts.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  shareToken: text('share_token').notNull().unique(),
  createdAt: createdAt(),
});

/** The daily news rundown: one for the whole installation per day in India. */
export const rundowns = pgTable('rundowns', {
  date: text('date').primaryKey(),
  data: jsonb('data').$type<Rundown>().notNull(),
  createdAt: createdAt(),
});

export type UserRow = typeof users.$inferSelect;
export type DestinationRow = typeof destinations.$inferSelect;
export type BroadcastRow = typeof broadcasts.$inferSelect;
export type BroadcastDestinationRow = typeof broadcastDestinations.$inferSelect;
