import { Track, type Room } from 'livekit-client';
import { CLIP_AUDIO, CLIP_VIDEO } from '../sources';

type CaptureVideo = HTMLVideoElement & { captureStream(): MediaStream };

const UNPLAYABLE = 'This file could not be played';

/**
 * Plays one of the watch party's video files into the room as the "clip" source: its picture and
 * its sound go on stage, to guests and into the program. Unlike a one-off clip it can be paused,
 * moved and turned down, and the sound passes through a gain so the level on the stream follows.
 */
export class PartyPlayer {
  private readonly ctx = new AudioContext();
  private readonly gain = this.ctx.createGain();
  private video: CaptureVideo | null = null;
  private room: Room | null = null;
  private published: MediaStreamTrack[] = [];
  private url: string | null = null;
  /** Called when the file reaches its end by itself. */
  onEnded: (() => void) | null = null;

  constructor() {
    // The host hears the video on their own speakers; guests and viewers get the published track.
    this.gain.connect(this.ctx.destination);
  }

  /** Starts a file from the beginning. Resolves with its length in seconds, 0 when unknown. */
  async load(room: Room, file: File): Promise<number> {
    this.stop();
    const video = document.createElement('video') as CaptureVideo;
    const url = URL.createObjectURL(file);
    video.src = url;
    video.playsInline = true;
    video.preload = 'auto';
    this.video = video;
    this.room = room;
    this.url = url;

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error(UNPLAYABLE));
      });
      const out = this.ctx.createMediaStreamDestination();
      const source = this.ctx.createMediaElementSource(video);
      source.connect(this.gain);
      this.gain.connect(out);
      await this.ctx.resume();
      await video.play();

      const [picture] = video.captureStream().getVideoTracks();
      const [sound] = out.stream.getAudioTracks();
      if (!picture) throw new Error(UNPLAYABLE);
      await room.localParticipant.publishTrack(picture, { name: CLIP_VIDEO, source: Track.Source.Unknown, simulcast: false });
      this.published.push(picture);
      if (sound) {
        await room.localParticipant.publishTrack(sound, { name: CLIP_AUDIO, source: Track.Source.Unknown });
        this.published.push(sound);
      }
    } catch (err) {
      this.stop();
      throw err instanceof Error && err.message === UNPLAYABLE ? err : new Error(UNPLAYABLE);
    }

    video.onended = () => this.onEnded?.();
    return Number.isFinite(video.duration) ? video.duration : 0;
  }

  get loaded(): boolean {
    return this.video !== null;
  }

  /** Where the file is, in seconds. */
  get position(): number {
    return this.video?.currentTime ?? 0;
  }

  play(): void {
    void this.ctx.resume();
    void this.video?.play().catch(() => undefined);
  }

  pause(): void {
    this.video?.pause();
  }

  seek(seconds: number): void {
    if (this.video) this.video.currentTime = Math.max(0, seconds);
  }

  /** 0 to 1. Changes what the host hears and what goes out on the stream. */
  setVolume(volume: number): void {
    const level = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    this.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.03);
  }

  /** Takes the video off the stage and lets the file go. */
  stop(): void {
    const { video, room } = this;
    if (video) {
      video.onended = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    for (const track of this.published) {
      void room?.localParticipant.unpublishTrack(track);
      track.stop();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.published = [];
    this.video = null;
    this.url = null;
  }

  close(): void {
    this.onEnded = null;
    this.stop();
    void this.ctx.close();
  }
}
