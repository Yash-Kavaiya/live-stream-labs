import { z } from 'zod';
import { platformIdSchema } from './platforms';
import { sceneSchema } from './scene';

// ---------- Auth ----------

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = signupSchema.pick({ email: true, password: true });
export type LoginInput = z.infer<typeof loginSchema>;

export interface UserDto {
  id: string;
  name: string;
  email: string;
}

// ---------- Destinations ----------

const rtmpUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^rtmps?:\/\/[^\s]+$/, 'Must start with rtmp:// or rtmps://');

export const createDestinationSchema = z.object({
  platform: platformIdSchema,
  label: z.string().trim().min(1).max(80),
  rtmpUrl,
  streamKey: z.string().trim().max(500),
  /** Twitch channel login, used to read chat. */
  channel: z.string().trim().max(80).optional(),
});
export type CreateDestinationInput = z.infer<typeof createDestinationSchema>;

export interface DestinationDto {
  id: string;
  platform: z.infer<typeof platformIdSchema>;
  kind: 'rtmp' | 'oauth';
  label: string;
  /** Ingest host only; the stream key never leaves the server. */
  rtmpHost: string | null;
  channel: string | null;
  createdAt: string;
}

// ---------- Broadcasts ----------

export const BROADCAST_STATUSES = ['draft', 'scheduled', 'live', 'ended'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export const DESTINATION_STATUSES = ['idle', 'connecting', 'live', 'failed', 'ended'] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

export const createBroadcastSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).default(''),
  scheduledAt: z.iso.datetime().nullable().default(null),
  destinationIds: z.array(z.string()).max(20).default([]),
});
export type CreateBroadcastInput = z.input<typeof createBroadcastSchema>;

export const updateBroadcastSchema = createBroadcastSchema.partial();
export type UpdateBroadcastInput = z.input<typeof updateBroadcastSchema>;

export interface BroadcastDestinationDto {
  destination: DestinationDto;
  status: DestinationStatus;
  error: string | null;
}

export interface BroadcastDto {
  id: string;
  title: string;
  description: string;
  status: BroadcastStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  destinations: BroadcastDestinationDto[];
}

export interface RecordingDto {
  id: string;
  broadcastId: string;
  broadcastTitle: string;
  sizeBytes: number;
  createdAt: string;
  shareToken: string;
}

// ---------- Studio ----------

export const updateSceneSchema = z.object({ scene: sceneSchema });

export const joinInviteSchema = z.object({ name: z.string().trim().min(1).max(40) });

export type StudioRole = 'host' | 'guest' | 'renderer';

/** Stored as LiveKit participant metadata. */
export interface ParticipantMeta {
  role: StudioRole;
}

export interface StudioSession {
  role: StudioRole;
  livekitUrl: string;
  token: string;
  identity: string;
  broadcast: { id: string; title: string; status: BroadcastStatus };
  scene: z.infer<typeof sceneSchema>;
}

export interface InviteDto {
  token: string;
  url: string;
  expiresAt: string;
}

export interface GoLiveResult {
  mode: 'relay' | 'livekit';
  /** Relay mode only: the WebSocket the host streams the program to. */
  ingestUrl: string | null;
}

export interface CommentDto {
  id: string;
  platform: string;
  author: string;
  text: string;
  at: string;
}

export interface ServerConfigDto {
  oauth: { google: boolean; youtube: boolean; twitch: boolean; facebook: boolean };
  egressMode: 'relay' | 'livekit';
}

export interface ApiError {
  error: string;
  message: string;
}
