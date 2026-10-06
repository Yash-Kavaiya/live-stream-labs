import type { BackgroundProcessor, SwitchBackgroundProcessorOptions } from '@livekit/track-processors';
import { RoomEvent, Track, type LocalVideoTrack, type Room } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { backdropUrl } from './backdrops';

export type BlurStrength = 'light' | 'medium' | 'strong';

/** What is done to the picture behind the person on camera. */
export type CameraEffect =
  | { kind: 'none' }
  | { kind: 'blur'; strength: BlurStrength }
  | { kind: 'backdrop'; id: string }
  /** The user's own picture, as a data URL so it survives a reload without a server. */
  | { kind: 'image'; url: string };

export interface MicPrefs {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export const DEFAULT_MIC_PREFS: MicPrefs = { noiseSuppression: true, echoCancellation: true, autoGainControl: true };

const EFFECT_KEY = 'camera-effect';
const MIC_KEY = 'mic-prefs';
// The processor blurs a quarter-size copy of the frame, so these are four times the radius it
// really uses, and it caps that at 16 (64 here). Below about 12 the blur is barely visible.
const BLUR_RADIUS: Record<BlurStrength, number> = { light: 16, medium: 32, strong: 60 };

function readStored(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is full or blocked: the choice still applies for this visit.
  }
}

export function loadCameraEffect(): CameraEffect {
  const stored = readStored(EFFECT_KEY) as Partial<CameraEffect & { strength: string; id: string; url: string }> | null;
  if (stored?.kind === 'blur') return { kind: 'blur', strength: stored.strength === 'strong' || stored.strength === 'medium' ? stored.strength : 'light' };
  if (stored?.kind === 'backdrop' && typeof stored.id === 'string' && backdropUrl(stored.id, 160, 90)) return { kind: 'backdrop', id: stored.id };
  if (stored?.kind === 'image' && typeof stored.url === 'string' && stored.url.startsWith('data:image/')) return { kind: 'image', url: stored.url };
  return { kind: 'none' };
}

export function loadMicPrefs(): MicPrefs {
  const stored = readStored(MIC_KEY) as Partial<MicPrefs> | null;
  const flag = (key: keyof MicPrefs) => (typeof stored?.[key] === 'boolean' ? stored[key] : DEFAULT_MIC_PREFS[key]);
  return { noiseSuppression: flag('noiseSuppression'), echoCancellation: flag('echoCancellation'), autoGainControl: flag('autoGainControl') };
}

function processorOptions(effect: CameraEffect): SwitchBackgroundProcessorOptions | null {
  switch (effect.kind) {
    case 'none':
      return null;
    case 'blur':
      return { mode: 'background-blur', blurRadius: BLUR_RADIUS[effect.strength] };
    case 'backdrop': {
      const imagePath = backdropUrl(effect.id);
      return imagePath ? { mode: 'virtual-background', imagePath } : null;
    }
    case 'image':
      return { mode: 'virtual-background', imagePath: effect.url };
  }
}

// The segmentation library is large, so it is fetched only when an effect is first wanted.
const library = () => import('@livekit/track-processors');

const processors = new WeakMap<LocalVideoTrack, ReturnType<typeof BackgroundProcessor>>();
let queue: Promise<void> = Promise.resolve();

/**
 * Puts an effect on a camera track, or takes it off. Calls are run one after another: starting
 * and switching a processor are slow, and two at once would leave the track in between.
 */
export function applyCameraEffect(track: LocalVideoTrack, effect: CameraEffect): Promise<void> {
  const run = async () => {
    const options = processorOptions(effect);
    const current = processors.get(track);
    const active = current && track.getProcessor() === current;
    if (!options) {
      processors.delete(track);
      if (active) await track.stopProcessor();
      return;
    }
    if (active) {
      await current.switchTo(options);
      return;
    }
    const processor = (await library()).BackgroundProcessor(options);
    await track.setProcessor(processor);
    processors.set(track, processor);
  };
  queue = queue.then(run, run);
  return queue;
}

/** Whether this browser can run camera effects at all. False until the check has finished. */
export function useEffectsSupported(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let live = true;
    library().then(
      (lib) => live && setSupported(lib.supportsBackgroundProcessors()),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return supported;
}

/** The remembered camera effect, as state. */
export function useStoredCameraEffect(): [CameraEffect, (effect: CameraEffect) => void] {
  const [effect, setEffect] = useState(loadCameraEffect);
  const set = useCallback((next: CameraEffect) => {
    writeStored(EFFECT_KEY, next);
    setEffect(next);
  }, []);
  return [effect, set];
}

/** The remembered microphone processing switches, as state. */
export function useStoredMicPrefs(): [MicPrefs, (prefs: MicPrefs) => void] {
  const [prefs, setPrefs] = useState(loadMicPrefs);
  const set = useCallback((next: MicPrefs) => {
    writeStored(MIC_KEY, next);
    setPrefs(next);
  }, []);
  return [prefs, set];
}

/**
 * Keeps the chosen effect on one camera track. When the effect cannot start (no WebGL, the model
 * failed to download) it is switched off and `onError` says so.
 */
export function useTrackEffect(
  track: LocalVideoTrack | null | undefined,
  effect: CameraEffect,
  setEffect: (effect: CameraEffect) => void,
  onError: (err: unknown) => void,
): void {
  const supported = useEffectsSupported();
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => {
    if (!track || !supported) return;
    applyCameraEffect(track, effect).catch((err) => {
      if (effect.kind === 'none') return;
      setEffect({ kind: 'none' });
      report.current(new Error('The camera effect could not start', { cause: err }));
    });
  }, [track, effect, supported, setEffect]);
}

/** The local participant's camera track, following it as the camera is published and replaced. */
export function useLocalCamera(room: Room | null): LocalVideoTrack | null {
  const [track, setTrack] = useState<LocalVideoTrack | null>(null);
  useEffect(() => {
    if (!room) return;
    const read = () => setTrack(room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null);
    read();
    room.on(RoomEvent.LocalTrackPublished, read).on(RoomEvent.LocalTrackUnpublished, read);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, read).off(RoomEvent.LocalTrackUnpublished, read);
    };
  }, [room]);
  return track;
}

/** Applies new microphone processing switches to the room: the live track now, and later ones. */
export async function applyMicPrefs(room: Room, prefs: MicPrefs): Promise<void> {
  room.options.audioCaptureDefaults = { ...room.options.audioCaptureDefaults, ...prefs };
  const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
  await track?.restartTrack({ ...room.options.audioCaptureDefaults, deviceId: room.getActiveDevice('audioinput') });
}
