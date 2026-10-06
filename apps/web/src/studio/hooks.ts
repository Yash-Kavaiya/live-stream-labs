import {
  addToStage,
  parseSourceId,
  pickAutoLayout,
  promoteOnStage,
  type BroadcastDto,
  type CommentDto,
  type Scene,
} from '@studio/shared';
import { Track, type Room } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../lib/app-context';
import { CLIP_AUDIO, CLIP_VIDEO, type StudioSource } from './sources';
import { watchTwitchChat } from './twitch-chat';

/**
 * The host's copy of the scene. Changes apply locally at once and are saved to the API, which
 * pushes them to everyone else. Saves are serialised and only the latest state is sent.
 */
export function useSceneController(broadcastId: string, initial: Scene) {
  const toast = useToast();
  const [scene, setScene] = useState(initial);
  const latest = useRef(initial);
  const saving = useRef({ busy: false, dirty: false });

  const flush = useCallback(() => {
    const state = saving.current;
    if (state.busy) {
      state.dirty = true;
      return;
    }
    state.busy = true;
    api
      .saveScene(broadcastId, latest.current)
      .catch((err) => toast.error(err))
      .finally(() => {
        state.busy = false;
        if (state.dirty) {
          state.dirty = false;
          flush();
        }
      });
  }, [broadcastId, toast]);

  const update = useCallback(
    (change: (scene: Scene) => Scene) => {
      const next = change(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      setScene(next);
      flush();
    },
    [flush],
  );

  return [scene, update] as const;
}

const MAX_COMMENTS = 200;
const YOUTUBE_POLL_MS = 6000;

/** Viewer comments while live: Twitch over IRC in the browser, YouTube polled through the API. */
export function useComments(broadcast: BroadcastDto | undefined, live: boolean): CommentDto[] {
  const [comments, setComments] = useState<CommentDto[]>([]);
  const destinations = broadcast?.destinations;
  const broadcastId = broadcast?.id;

  useEffect(() => {
    if (!live || !destinations || !broadcastId) return;
    const add = (incoming: CommentDto[]) => {
      if (incoming.length === 0) return;
      setComments((list) => {
        const known = new Set(list.map((c) => c.id));
        return [...list, ...incoming.filter((c) => !known.has(c.id))].slice(-MAX_COMMENTS);
      });
    };

    const stops = destinations
      .filter((d) => d.destination.platform === 'twitch' && d.destination.channel)
      .map((d) => watchTwitchChat(d.destination.channel!, (comment) => add([comment])));

    const hasYouTube = destinations.some(
      (d) => d.destination.platform === 'youtube' && d.destination.kind === 'oauth',
    );
    if (hasYouTube) {
      const timer = setInterval(() => void api.comments(broadcastId).then(add, () => undefined), YOUTUBE_POLL_MS);
      stops.push(() => clearInterval(timer));
    }
    return () => stops.forEach((stop) => stop());
  }, [live, destinations, broadcastId]);

  return comments;
}

type CaptureVideo = HTMLVideoElement & { captureStream(): MediaStream };

/**
 * Plays a local video file into the room as a "clip" source, picture and sound.
 * Returns `stop`, and calls `onEnded` when the file finishes by itself.
 */
export async function shareVideoClip(room: Room, file: File, onEnded: () => void): Promise<() => void> {
  const video = document.createElement('video') as CaptureVideo;
  video.src = URL.createObjectURL(file);
  video.playsInline = true;
  await video.play();

  const stream = video.captureStream();
  const published: MediaStreamTrack[] = [];
  const [picture] = stream.getVideoTracks();
  const [sound] = stream.getAudioTracks();
  if (picture) {
    await room.localParticipant.publishTrack(picture, { name: CLIP_VIDEO, source: Track.Source.Unknown, simulcast: false });
    published.push(picture);
  }
  if (sound) {
    await room.localParticipant.publishTrack(sound, { name: CLIP_AUDIO, source: Track.Source.Unknown });
    published.push(sound);
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    video.pause();
    for (const track of published) void room.localParticipant.unpublishTrack(track);
    URL.revokeObjectURL(video.src);
  };
  video.onended = () => {
    stop();
    onEnded();
  };
  return stop;
}

/** Seconds since `since`, ticking once a second. */
export function useElapsed(since: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : (now - since) / 1000;
}

const isPerson = (id: string) => parseSourceId(id).kind === 'cam';
/** How long someone must keep talking before the studio cuts to them. Stops a cough stealing the shot. */
const FOLLOW_SPEAKER_HOLD_MS = 1200;

/**
 * The host's automatic director. Depending on `scene.auto` it puts joining guests on stage,
 * re-picks the layout when the stage changes, and moves the current speaker into the main slot.
 * Every action is an ordinary scene update, so the host can always override it by hand.
 */
export function useAutoDirector(
  scene: Scene,
  update: (change: (scene: Scene) => Scene) => void,
  sources: StudioSource[],
  active: boolean,
): void {
  const { auto } = scene;

  // Each guest is offered the stage once, when first seen. If the host takes them off again,
  // they stay off.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!active) return;
    for (const source of sources) {
      if (source.kind !== 'cam' || source.isLocal || seen.current.has(source.id)) continue;
      seen.current.add(source.id);
      update((s) => {
        const people = s.stage.filter(isPerson).length;
        return s.auto.addGuests && people < s.auto.maxOnStage ? addToStage(s, source.id) : s;
      });
    }
  }, [active, sources, update]);

  // Re-pick the layout only when its inputs change, so a layout the host chose by hand survives
  // until the stage next changes (and survives a page reload).
  const layoutInputs = `${scene.stage.join('|')}#${auto.layout}#${auto.followSpeaker}#${scene.template}`;
  const lastLayoutInputs = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const first = lastLayoutInputs.current === null;
    const changed = lastLayoutInputs.current !== layoutInputs;
    lastLayoutInputs.current = layoutInputs;
    if (first || !changed || !auto.layout) return;
    update((s) => {
      const layout = pickAutoLayout(s.stage, { followSpeaker: s.auto.followSpeaker, template: s.template });
      return layout === s.layout ? s : { ...s, layout };
    });
  }, [active, layoutInputs, auto.layout, update]);

  // Follow the speaker: only among people, and never while a screen or clip holds the main slot.
  const people = scene.stage.filter(isPerson);
  const speaking = new Set(sources.filter((s) => s.speaking).map((s) => s.id));
  const sharing = people.length !== scene.stage.length;
  const mainIsSpeaking = people[0] !== undefined && speaking.has(people[0]);
  const candidate =
    auto.followSpeaker && !sharing && !mainIsSpeaking ? (people.find((id) => speaking.has(id)) ?? null) : null;
  useEffect(() => {
    if (!active || !candidate) return;
    const timer = setTimeout(() => update((s) => promoteOnStage(s, candidate)), FOLLOW_SPEAKER_HOLD_MS);
    return () => clearTimeout(timer);
  }, [active, candidate, update]);
}
