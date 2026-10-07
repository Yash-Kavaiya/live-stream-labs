import {
  chatMessageSchema,
  decodeJson,
  egressStatusSchema,
  encodeJson,
  normalizeScene,
  TOPIC_CHAT,
  TOPIC_EGRESS,
  type EgressStatus,
  type Scene,
  type StudioSession,
} from '@studio/shared';
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type RemoteTrack,
} from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadMicPrefs } from './camera-effects';
import type { DrawableSource } from './compositor';
import { readRoom, type RoomView, type StudioSource } from './sources';

export interface JoinOptions {
  camera: boolean;
  mic: boolean;
  cameraId?: string;
  micId?: string;
}

export interface ChatEntry {
  id: string;
  author: string;
  text: string;
  at: number;
  mine: boolean;
}

export interface StudioRoomState {
  room: Room | null;
  status: 'connecting' | 'connected' | 'ended';
  /** Why the session ended, in words the user can read. */
  endReason: string | null;
  view: RoomView;
  /** The scene as last published by the host through room metadata. */
  remoteScene: Scene;
  chat: ChatEntry[];
  sendChat(text: string): void;
  egress: EgressStatus | null;
}

const EMPTY_VIEW: RoomView = { participants: [], sources: [] };

/** Off-screen home for <video>/<audio> elements that only feed the canvas or the speakers. */
function mediaSink(): HTMLElement {
  let sink = document.getElementById('media-sink');
  if (!sink) {
    sink = document.createElement('div');
    sink.id = 'media-sink';
    sink.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    document.body.append(sink);
  }
  return sink;
}

function parseScene(metadata: string | undefined, fallback: Scene): Scene {
  try {
    return normalizeScene(JSON.parse(metadata || 'null'), fallback);
  } catch {
    return fallback;
  }
}

/**
 * Turns a device on, trying once more after a pause. The green room has only just let go of the
 * camera, and some drivers refuse to reopen it for a moment ("device in use").
 */
async function startDevice(enable: () => Promise<unknown>): Promise<void> {
  for (const pauseMs of [0, 800]) {
    if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    try {
      await enable();
      return;
    } catch {
      // Try again, then give up quietly: the user can still turn it on from the control bar.
    }
  }
}

const CAMERA_SETTLE_MS = 1500;

/**
 * Turns the camera on and checks a moment later that it stayed on. A camera reopened right after
 * the green room released it can come up and then stop at once; when that happens it is restarted.
 */
async function startCamera(room: Room): Promise<void> {
  const local = room.localParticipant;
  await startDevice(() => local.setCameraEnabled(true));
  await new Promise((resolve) => setTimeout(resolve, CAMERA_SETTLE_MS));
  if (room.state !== 'connected') return;

  const publication = local.getTrackPublication(Track.Source.Camera);
  const alive = publication?.track?.mediaStreamTrack.readyState === 'live' && !publication.isMuted;
  if (alive) return;
  await local.setCameraEnabled(false).catch(() => undefined);
  await startDevice(() => local.setCameraEnabled(true));
}

const END_REASONS: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.PARTICIPANT_REMOVED]: 'The host removed you from the studio.',
  [DisconnectReason.ROOM_DELETED]: 'The studio was closed.',
  [DisconnectReason.DUPLICATE_IDENTITY]: 'You joined this studio from another tab.',
};

/** Connects to the LiveKit room for a studio session and exposes it as plain React state. */
export function useStudioRoom(session: StudioSession, join: JoinOptions): StudioRoomState {
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState<StudioRoomState['status']>('connecting');
  const [endReason, setEndReason] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [remoteScene, setRemoteScene] = useState(session.scene);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [egress, setEgress] = useState<EgressStatus | null>(null);

  useEffect(() => {
    const next = new Room({
      // The compositor draws from off-screen elements, so visibility-based quality must be off.
      adaptiveStream: false,
      dynacast: true,
      // Cameras stay at 720p although the program is 1080p: every participant's browser encodes its
      // camera for the room, and at 1080p that costs enough processor to make the stream stutter.
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution, deviceId: join.cameraId },
      audioCaptureDefaults: { deviceId: join.micId, ...loadMicPrefs() },
      // Above LiveKit's default for 720p: a blurred or replaced background has soft gradients and
      // a moving edge around the person, which break up into blocks at a low bitrate.
      publishDefaults: { videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 } },
    });
    const bump = () => setVersion((n) => n + 1);

    const playRemoteAudio = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) mediaSink().append(track.attach());
    };
    const stopRemoteAudio = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove());
    };

    next
      .on(RoomEvent.TrackSubscribed, playRemoteAudio)
      .on(RoomEvent.TrackUnsubscribed, stopRemoteAudio)
      .on(RoomEvent.RoomMetadataChanged, (metadata) => {
        setRemoteScene((current) => parseScene(metadata, current));
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        const data = decodeJson(payload);
        if (topic === TOPIC_CHAT && participant) {
          const message = chatMessageSchema.safeParse(data);
          if (!message.success) return;
          const author = participant.name || 'Guest';
          setChat((list) => [...list.slice(-199), { ...message.data, author, mine: false }]);
        } else if (topic === TOPIC_EGRESS && !participant) {
          // Only the server (no participant) may report egress state.
          const parsed = egressStatusSchema.safeParse(data);
          if (parsed.success) setEgress(parsed.data);
        }
      })
      .on(RoomEvent.Disconnected, (reason) => {
        setStatus('ended');
        setEndReason((reason !== undefined && END_REASONS[reason]) || 'You left the studio.');
      });

    for (const event of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.ParticipantMetadataChanged,
    ] as const) {
      next.on(event, bump);
    }

    let cancelled = false;
    (async () => {
      try {
        await next.connect(session.livekitUrl, session.token);
        if (cancelled) return;
        setRoom(next);
        setRemoteScene((current) => parseScene(next.metadata, current));
        setStatus('connected');
        // A blocked or missing device must not keep someone out of the studio.
        if (join.mic) await startDevice(() => next.localParticipant.setMicrophoneEnabled(true));
        if (join.camera) await startCamera(next);
        bump();
      } catch (err) {
        if (cancelled) return;
        setStatus('ended');
        setEndReason(err instanceof Error ? `Could not connect: ${err.message}` : 'Could not connect.');
      }
    })();

    return () => {
      cancelled = true;
      void next.disconnect();
    };
    // A session is joined once; changing devices later goes through the room, not a reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token]);

  const view = useMemo(
    () => (room && status === 'connected' ? readRoom(room) : EMPTY_VIEW),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, status, version],
  );

  const sendChat = useCallback(
    (text: string) => {
      if (!room || !text.trim()) return;
      const message = { id: crypto.randomUUID(), text: text.trim().slice(0, 1000), at: Date.now() };
      void room.localParticipant.publishData(encodeJson(message), { reliable: true, topic: TOPIC_CHAT });
      const author = room.localParticipant.name || 'You';
      setChat((list) => [...list.slice(-199), { ...message, author, mine: true }]);
    },
    [room],
  );

  return { room, status, endReason, view, remoteScene, chat, sendChat, egress };
}

/**
 * Keeps one off-screen <video> per source track for the compositor to read frames from, and
 * returns them keyed by source id.
 */
export function useDrawableSources(sources: StudioSource[]): Map<string, DrawableSource> {
  const elements = useRef(new Map<Track, HTMLVideoElement>());

  const drawables = useMemo(() => {
    const live = new Set<Track>();
    const map = new Map<string, DrawableSource>();
    for (const source of sources) {
      let frame: HTMLVideoElement | null = null;
      if (source.video) {
        live.add(source.video);
        frame = elements.current.get(source.video) ?? null;
        if (!frame) {
          frame = source.video.attach() as HTMLVideoElement;
          frame.muted = true;
          mediaSink().append(frame);
          elements.current.set(source.video, frame);
        }
      }
      map.set(source.id, { label: source.label, frame, speaking: source.speaking });
    }
    for (const [track, el] of elements.current) {
      if (live.has(track)) continue;
      track.detach(el);
      el.remove();
      elements.current.delete(track);
    }
    return map;
  }, [sources]);

  useEffect(() => {
    const held = elements.current;
    return () => {
      for (const [track, el] of held) {
        track.detach(el);
        el.remove();
      }
      held.clear();
    };
  }, []);

  return drawables;
}
