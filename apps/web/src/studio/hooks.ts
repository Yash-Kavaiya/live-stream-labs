import type { BroadcastDto, CommentDto, Scene } from '@studio/shared';
import { Track, type Room } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../lib/app-context';
import { CLIP_AUDIO, CLIP_VIDEO } from './sources';
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
