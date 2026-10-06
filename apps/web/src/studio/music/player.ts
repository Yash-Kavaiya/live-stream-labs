import type { TrackKind } from './synth';

const STORE_KEY = 'studio.music';
/** How far the music drops while someone on stage is talking. */
const DUCK = 0.25;
const DUCK_SEC = 0.3;
const SWAP_SEC = 0.5;
const FADE_OUT_SEC = 2;

/** Gain the music should sit at: the volume, or a quarter of it while someone speaks. */
export function musicLevel(volume: number, speaking: boolean, duck: boolean): number {
  const level = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
  return duck && speaking ? level * DUCK : level;
}

export interface MusicState {
  /** Ids of the looping bed and the one-shot sting that are playing. */
  bed: string | null;
  sting: string | null;
  /** The track being prepared, between the click and the first sound. */
  loading: string | null;
  volume: number;
  duck: boolean;
  /** The track that last failed to play, and why. */
  error: { id: string; message: string } | null;
}

export type TrackData = AudioBuffer | [Float32Array, Float32Array];

interface Playing {
  id: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export function readMusicPrefs(): { volume: number; duck: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { volume?: unknown; duck?: unknown };
    return { volume: typeof saved.volume === 'number' ? musicLevel(saved.volume, false, false) : 0.6, duck: saved.duck !== false };
  } catch {
    return { volume: 0.6, duck: true };
  }
}

/**
 * Plays the studio's music: one looping bed and one sting at a time. The host hears it on their
 * speakers, and `track` carries the same sound into the program mix. Create it from a click: a
 * browser only lets an audio context start after the user has done something.
 */
export class MusicPlayer {
  private readonly ctx = new AudioContext();
  private readonly master = this.ctx.createGain();
  private readonly out = this.ctx.createMediaStreamDestination();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly listeners = new Set<(state: MusicState) => void>();
  private bed: Playing | null = null;
  private sting: Playing | null = null;
  private speaking = false;
  private state: MusicState;

  constructor() {
    this.state = { bed: null, sting: null, loading: null, error: null, ...readMusicPrefs() };
    this.master.gain.value = musicLevel(this.state.volume, false, this.state.duck);
    this.master.connect(this.ctx.destination);
    this.master.connect(this.out);
  }

  /** The music as a track for the program mix. It is silent while nothing plays. */
  get track(): MediaStreamTrack {
    return this.out.stream.getAudioTracks()[0]!;
  }

  get current(): MusicState {
    return this.state;
  }

  subscribe(listener: (state: MusicState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts a track. A new bed takes over from the one playing; a new sting cuts the last one off. */
  async play(id: string, kind: TrackKind, load: () => Promise<TrackData> | TrackData): Promise<void> {
    this.set({ loading: id, error: null });
    try {
      await this.ctx.resume();
      let buffer = this.buffers.get(id);
      if (!buffer) {
        buffer = this.toBuffer(await load());
        this.buffers.set(id, buffer);
      }
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      source.buffer = buffer;
      source.loop = kind === 'bed';
      source.connect(gain).connect(this.master);
      const playing: Playing = { id, source, gain };

      if (kind === 'bed') {
        this.release(this.bed, SWAP_SEC);
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + (this.bed ? SWAP_SEC : 0.05));
        this.bed = playing;
      } else {
        this.release(this.sting, 0.05);
        this.sting = playing;
        source.onended = () => {
          if (this.sting !== playing) return;
          this.sting = null;
          this.set({ sting: null });
        };
      }
      source.start();
      this.set({ loading: null, bed: this.bed?.id ?? null, sting: this.sting?.id ?? null });
    } catch (err) {
      const message = err instanceof Error && err.name !== 'EncodingError' ? err.message : 'This file could not be played';
      this.set({ loading: null, error: { id, message: message || 'This file could not be played' } });
    }
  }

  stop(id: string): void {
    if (this.bed?.id === id) {
      this.release(this.bed, 0.15);
      this.bed = null;
    }
    if (this.sting?.id === id) {
      this.release(this.sting, 0.15);
      this.sting = null;
    }
    this.set({ bed: this.bed?.id ?? null, sting: this.sting?.id ?? null });
  }

  /** Fades everything out over two seconds, for the end of a segment. */
  fadeOut(): void {
    this.release(this.bed, FADE_OUT_SEC);
    this.release(this.sting, FADE_OUT_SEC);
    this.bed = null;
    this.sting = null;
    this.set({ bed: null, sting: null });
  }

  setVolume(volume: number): void {
    this.set({ volume: musicLevel(volume, false, false) });
    this.applyLevel(0.05);
    this.savePrefs();
  }

  setDuck(duck: boolean): void {
    this.set({ duck });
    this.applyLevel(DUCK_SEC);
    this.savePrefs();
  }

  /** Tells the player whether someone on stage is talking, so the music can make room. */
  setSpeaking(speaking: boolean): void {
    if (speaking === this.speaking) return;
    this.speaking = speaking;
    this.applyLevel(DUCK_SEC);
  }

  /** Forgets a track, so the next play loads it again (an upload that was replaced or removed). */
  forget(id: string): void {
    this.stop(id);
    this.buffers.delete(id);
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  close(): void {
    this.release(this.bed, 0);
    this.release(this.sting, 0);
    this.listeners.clear();
    void this.ctx.close();
  }

  private toBuffer(data: TrackData): AudioBuffer {
    if (data instanceof AudioBuffer) return data;
    const buffer = this.ctx.createBuffer(2, data[0].length, this.ctx.sampleRate);
    buffer.copyToChannel(data[0] as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(data[1] as Float32Array<ArrayBuffer>, 1);
    return buffer;
  }

  /** Fades a playing track down and stops it. */
  private release(playing: Playing | null, seconds: number): void {
    if (!playing) return;
    playing.source.onended = null;
    const now = this.ctx.currentTime;
    try {
      playing.gain.gain.cancelScheduledValues(now);
      playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
      playing.gain.gain.linearRampToValueAtTime(0, now + seconds);
      playing.source.stop(now + seconds + 0.02);
    } catch {
      // Already stopped.
    }
  }

  private applyLevel(seconds: number): void {
    const now = this.ctx.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(musicLevel(this.state.volume, this.speaking, this.state.duck), now + seconds);
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ volume: this.state.volume, duck: this.state.duck }));
    } catch {
      // Private browsing: the choice just is not remembered.
    }
  }

  private set(patch: Partial<MusicState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}
