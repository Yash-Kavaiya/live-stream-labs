import type { EgressStatus, Scene } from '@studio/shared';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../lib/api';
import { useToast } from '../lib/app-context';
import { AudioMixer, ProgramBroadcaster } from './broadcaster';
import type { StudioSource } from './sources';

export type LivePhase = 'idle' | 'starting' | 'live' | 'ending';

export interface LiveControl {
  phase: LivePhase;
  /** Epoch ms when the stream started, for the on-air timer. */
  startedAt: number | null;
  goLive(): Promise<void>;
  end(): Promise<void>;
}

interface Options {
  broadcastId: string;
  canvas: RefObject<HTMLCanvasElement | null>;
  scene: Scene;
  sources: StudioSource[];
  egress: EgressStatus | null;
  /** The host's music, once they have played some. It goes out on every screen, holding screens included. */
  music: MediaStreamTrack | null;
  /** True when the server reports this broadcast as already live (server-side egress). */
  initiallyLive: boolean;
  onChanged(): void;
}

/** The host's Go live / End stream state machine, for both egress modes. */
export function useLiveControl(opts: Options): LiveControl {
  const { broadcastId, canvas, scene, sources, egress, music, onChanged } = opts;
  const toast = useToast();
  const [phase, setPhase] = useState<LivePhase>(opts.initiallyLive ? 'live' : 'idle');
  const [startedAt, setStartedAt] = useState<number | null>(opts.initiallyLive ? Date.now() : null);
  const mixer = useRef<AudioMixer | null>(null);
  const broadcaster = useRef<ProgramBroadcaster | null>(null);

  const release = useCallback(() => {
    broadcaster.current?.stop();
    broadcaster.current = null;
    mixer.current?.close();
    mixer.current = null;
    setPhase('idle');
    setStartedAt(null);
  }, []);

  // The program mix is the audio of whatever is on stage right now. A holding screen
  // (starting soon, be right back, ending) is silent: nobody should be heard behind it.
  useEffect(() => {
    if (!mixer.current) return;
    const onStage = new Set(scene.screen === 'live' ? scene.stage : []);
    const stage = sources.filter((s) => onStage.has(s.id)).flatMap((s) => s.audio);
    mixer.current.sync(music ? [...stage, music] : stage);
  }, [scene.stage, scene.screen, sources, music, phase]);

  // The server says the stream is over (every destination dropped, or the worker stopped).
  useEffect(() => {
    if (phase !== 'live' || !egress) return;
    if (egress.state === 'failed') toast.show(egress.error ?? 'The stream failed.');
    if (egress.state === 'failed' || egress.state === 'ended') {
      release();
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [egress]);

  useEffect(() => release, [release]);

  const goLive = useCallback(async () => {
    if (!canvas.current) return;
    setPhase('starting');
    try {
      const result = await api.goLive(broadcastId);
      if (result.mode === 'relay' && result.ingestUrl) {
        mixer.current = new AudioMixer();
        broadcaster.current = new ProgramBroadcaster(canvas.current, mixer.current, (reason) => {
          toast.show(`Stream stopped: ${reason}`);
          release();
          void api.endBroadcast(broadcastId).finally(onChanged);
        });
        await broadcaster.current.start(result.ingestUrl);
      }
      setStartedAt(Date.now());
      setPhase('live');
    } catch (err) {
      toast.error(err);
      release();
      // The API may already have marked the broadcast live; put it back.
      await api.endBroadcast(broadcastId).catch(() => undefined);
    }
    onChanged();
  }, [broadcastId, canvas, onChanged, release, toast]);

  const end = useCallback(async () => {
    setPhase('ending');
    broadcaster.current?.stop();
    broadcaster.current = null;
    await api.endBroadcast(broadcastId).catch((err) => toast.error(err));
    release();
    onChanged();
  }, [broadcastId, onChanged, release, toast]);

  return { phase, startedAt, goLive, end };
}
