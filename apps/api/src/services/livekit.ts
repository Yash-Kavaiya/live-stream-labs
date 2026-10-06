import type { ParticipantMeta, StudioRole } from '@studio/shared';
import { encodeJson } from '@studio/shared';
import { AccessToken, DataPacket_Kind, RoomServiceClient, TwirpError } from 'livekit-server-sdk';

export interface TokenRequest {
  room: string;
  identity: string;
  name: string;
  role: StudioRole;
}

/** Everything the API needs from the SFU. Tests swap in `FakeLiveKit`. */
export interface LiveKitGateway {
  createToken(req: TokenRequest): Promise<string>;
  ensureRoom(room: string, metadata: string): Promise<void>;
  setRoomMetadata(room: string, metadata: string): Promise<void>;
  sendData(room: string, topic: string, payload: unknown): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
  muteTrack(room: string, identity: string, trackSid: string): Promise<void>;
}

export function roomName(broadcastId: string): string {
  return `b_${broadcastId}`;
}

function isNotFound(err: unknown): boolean {
  return err instanceof TwirpError && err.code === 'not_found';
}

export class LiveKitService implements LiveKitGateway {
  private readonly rooms: RoomServiceClient;

  constructor(private readonly cfg: { url: string; apiKey: string; apiSecret: string }) {
    const httpUrl = cfg.url.replace(/^ws/, 'http');
    this.rooms = new RoomServiceClient(httpUrl, cfg.apiKey, cfg.apiSecret);
  }

  createToken({ room, identity, name, role }: TokenRequest): Promise<string> {
    const meta: ParticipantMeta = { role };
    const token = new AccessToken(this.cfg.apiKey, this.cfg.apiSecret, {
      identity,
      name,
      metadata: JSON.stringify(meta),
      ttl: '12h',
    });
    token.addGrant({
      room,
      roomJoin: true,
      canSubscribe: true,
      canPublish: role !== 'renderer',
      canPublishData: role !== 'renderer',
      hidden: role === 'renderer',
    });
    return token.toJwt();
  }

  async ensureRoom(room: string, metadata: string): Promise<void> {
    // createRoom is idempotent: an existing room is returned unchanged.
    await this.rooms.createRoom({ name: room, metadata, emptyTimeout: 10 * 60, maxParticipants: 30 });
  }

  async setRoomMetadata(room: string, metadata: string): Promise<void> {
    try {
      await this.rooms.updateRoomMetadata(room, metadata);
    } catch (err) {
      // Nobody is in the studio yet; the next session reads the scene from the database.
      if (!isNotFound(err)) throw err;
    }
  }

  async sendData(room: string, topic: string, payload: unknown): Promise<void> {
    try {
      await this.rooms.sendData(room, encodeJson(payload), DataPacket_Kind.RELIABLE, { topic });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    await this.rooms.removeParticipant(room, identity);
  }

  async muteTrack(room: string, identity: string, trackSid: string): Promise<void> {
    await this.rooms.mutePublishedTrack(room, identity, trackSid, true);
  }
}

/** In-memory stand-in that records calls. */
export class FakeLiveKit implements LiveKitGateway {
  readonly metadata = new Map<string, string>();
  readonly sent: { room: string; topic: string; payload: unknown }[] = [];
  readonly removed: string[] = [];
  readonly muted: string[] = [];

  async createToken(req: TokenRequest): Promise<string> {
    return `fake.${req.role}.${req.identity}`;
  }
  async ensureRoom(room: string, metadata: string): Promise<void> {
    if (!this.metadata.has(room)) this.metadata.set(room, metadata);
  }
  async setRoomMetadata(room: string, metadata: string): Promise<void> {
    this.metadata.set(room, metadata);
  }
  async sendData(room: string, topic: string, payload: unknown): Promise<void> {
    this.sent.push({ room, topic, payload });
  }
  async removeParticipant(_room: string, identity: string): Promise<void> {
    this.removed.push(identity);
  }
  async muteTrack(_room: string, _identity: string, trackSid: string): Promise<void> {
    this.muted.push(trackSid);
  }
}
