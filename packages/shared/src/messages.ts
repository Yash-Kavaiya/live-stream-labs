import { z } from 'zod';
import { DESTINATION_STATUSES } from './api';

/** LiveKit data-channel topics. */
export const TOPIC_CHAT = 'chat';
export const TOPIC_EGRESS = 'egress';

export const chatMessageSchema = z.object({
  id: z.string().max(40),
  text: z.string().min(1).max(1000),
  at: z.number(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const targetStatusSchema = z.object({
  destinationId: z.string(),
  status: z.enum(DESTINATION_STATUSES),
  error: z.string().nullable(),
});
export type TargetStatus = z.infer<typeof targetStatusSchema>;

/** Worker -> API (HTTP) and API -> studio (LiveKit data, topic `egress`). */
export const egressStatusSchema = z.object({
  broadcastId: z.string(),
  state: z.enum(['starting', 'live', 'ended', 'failed']),
  targets: z.array(targetStatusSchema),
  error: z.string().nullable(),
  recording: z.object({ file: z.string(), sizeBytes: z.number() }).nullable(),
});
export type EgressStatus = z.infer<typeof egressStatusSchema>;

/** What the worker receives when it claims an ingest token. Contains stream keys: server-side only. */
export const egressJobSchema = z.object({
  broadcastId: z.string(),
  targets: z.array(z.object({ destinationId: z.string(), url: z.string() })),
  record: z.boolean(),
});
export type EgressJob = z.infer<typeof egressJobSchema>;

export function encodeJson(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function decodeJson(payload: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}
