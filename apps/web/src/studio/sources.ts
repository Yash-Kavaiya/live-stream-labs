import { sourceId, type ParticipantMeta, type SourceKind, type StudioRole } from '@studio/shared';
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
  /** Audio that goes into the program mix while this source is on stage. */
  audio: MediaStreamTrack[];
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

    const base = { identity: p.identity, isLocal };
    sources.push({
      ...base,
      id: sourceId('cam', p.identity),
      kind: 'cam',
      label: name,
      video: trackOf(camera),
      audio: audioOf(mic),
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
