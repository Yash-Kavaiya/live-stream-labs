import { sourceId, type ParticipantMeta, type Scene, type SourceKind, type StudioRole } from '@studio/shared';
import { Track, type Participant, type Room, type TrackPublication } from 'livekit-client';

/** Track names for a video clip a participant is playing into the room. */
export const CLIP_VIDEO = 'clip';
export const CLIP_AUDIO = 'clip-audio';

export interface ParticipantView {
  identity: string;
  name: string;
  role: StudioRole;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  /** Needed for the host's "mute guest" action. */
  micSid: string | null;
  cameraOff: boolean;
}

/** Something that can be put on stage. See `sourceIdSchema` for the id format. */
export interface StudioSource {
  id: string;
  kind: SourceKind;
  identity: string;
  label: string;
  isLocal: boolean;
  /** Null while the camera is off or the track is still subscribing; a name card is drawn instead. */
  video: Track | null;
  /** This source's own sound. For a camera that is the person's microphone; see `programAudio`. */
  audio: MediaStreamTrack[];
  /** True for a camera whose participant is talking right now. */
  speaking: boolean;
}

function roleOf(participant: Participant): StudioRole {
  try {
    return (JSON.parse(participant.metadata || '{}') as Partial<ParticipantMeta>).role ?? 'guest';
  } catch {
    return 'guest';
  }
}

/** Published and not muted. The track itself may still be subscribing (`pub.track` undefined). */
function isOn(pub: TrackPublication | undefined): pub is TrackPublication {
  return !!pub && !pub.isMuted;
}

function trackOf(pub: TrackPublication | undefined): Track | null {
  return isOn(pub) ? (pub.track ?? null) : null;
}

function audioOf(pub: TrackPublication | undefined): MediaStreamTrack[] {
  const track = trackOf(pub);
  return track ? [track.mediaStreamTrack] : [];
}

function byName(participant: Participant, name: string): TrackPublication | undefined {
  return [...participant.trackPublications.values()].find((pub) => pub.trackName === name);
}

type OnStage = Pick<Scene, 'stage' | 'screen'>;

/**
 * Who viewers can hear: everyone with a camera, screen or video on stage. Nobody on a holding
 * screen (starting soon, be right back, ending).
 */
export function onAir(sources: StudioSource[], scene: OnStage): Set<string> {
  if (scene.screen !== 'live') return new Set();
  return new Set(sources.filter((s) => scene.stage.includes(s.id)).map((s) => s.identity));
}

/**
 * The tracks of the program mix: the sound of every source on stage, and the microphone of each
 * person on air. A presenter stays audible with only their screen on stage; were the microphone
 * tied to the camera tile, taking the camera off to show a screen full-frame would silence them.
 */
export function programAudio(sources: StudioSource[], scene: OnStage): MediaStreamTrack[] {
  const heard = onAir(sources, scene);
  const wanted = sources.filter((s) => heard.has(s.identity) && (s.kind === 'cam' || scene.stage.includes(s.id)));
  return [...new Set(wanted.flatMap((s) => s.audio))];
}

export interface RoomView {
  participants: ParticipantView[];
  sources: StudioSource[];
}

/** A plain snapshot of the LiveKit room, recomputed whenever the room emits a change. */
export function readRoom(room: Room): RoomView {
  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  const participants: ParticipantView[] = [];
  const sources: StudioSource[] = [];

  for (const p of all) {
    const role = roleOf(p);
    if (role === 'renderer' || !p.identity) continue;
    const isLocal = p === room.localParticipant;
    const name = p.name || 'Guest';
    const camera = p.getTrackPublication(Track.Source.Camera);
    const mic = p.getTrackPublication(Track.Source.Microphone);
    const screen = p.getTrackPublication(Track.Source.ScreenShare);
    const clip = byName(p, CLIP_VIDEO);

    participants.push({
      identity: p.identity,
      name,
      role,
      isLocal,
      speaking: p.isSpeaking,
      micMuted: !isOn(mic),
      micSid: mic?.trackSid ?? null,
      cameraOff: !isOn(camera),
    });

    const base = { identity: p.identity, isLocal, speaking: false };
    sources.push({
      ...base,
      id: sourceId('cam', p.identity),
      kind: 'cam',
      label: name,
      video: trackOf(camera),
      audio: audioOf(mic),
      speaking: p.isSpeaking && isOn(mic),
    });
    if (isOn(screen)) {
      sources.push({
        ...base,
        id: sourceId('screen', p.identity),
        kind: 'screen',
        label: `${name}'s screen`,
        video: trackOf(screen),
        audio: audioOf(p.getTrackPublication(Track.Source.ScreenShareAudio)),
      });
    }
    if (isOn(clip)) {
      sources.push({
        ...base,
        id: sourceId('clip', p.identity),
        kind: 'clip',
        label: `${name}'s video`,
        video: trackOf(clip),
        audio: audioOf(byName(p, CLIP_AUDIO)),
      });
    }
  }
  return { participants, sources };
}
