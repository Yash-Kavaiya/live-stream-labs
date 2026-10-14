import { reconnectDelay, RECONNECT_WINDOW_MS, shouldReconnect, STALL_LIMIT_MS, StallWatch } from './reconnect';

/** Mixes the audio of everything on stage into one track for the program. */
export class AudioMixer {
  private readonly ctx = new AudioContext();
  private readonly out = this.ctx.createMediaStreamDestination();
  private readonly inputs = new Map<string, MediaStreamAudioSourceNode>();

  constructor() {
    // A mix with nothing connected produces no audio at all, not silence, and the recorder then
    // holds back the video too: the stream stops the moment everyone on stage is muted. A silent
    // source that is always connected keeps the audio, and so the whole stream, flowing.
    const silence = this.ctx.createConstantSource();
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    silence.connect(mute).connect(this.out);
    silence.start();
  }

  get track(): MediaStreamTrack {
    return this.out.stream.getAudioTracks()[0]!;
  }

  /** Makes the mix contain exactly these tracks. Cheap to call on every room change. */
  sync(tracks: MediaStreamTrack[]): void {
    void this.ctx.resume();
    const wanted = new Map(tracks.map((t) => [t.id, t]));
    for (const [id, node] of this.inputs) {
      if (wanted.has(id)) continue;
      node.disconnect();
      this.inputs.delete(id);
    }
    for (const [id, track] of wanted) {
      if (this.inputs.has(id)) continue;
      const node = this.ctx.createMediaStreamSource(new MediaStream([track]));
      node.connect(this.out);
      this.inputs.set(id, node);
    }
  }

  close(): void {
    for (const node of this.inputs.values()) node.disconnect();
    this.inputs.clear();
    void this.ctx.close();
  }
}

const MIME_TYPES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const CHUNK_MS = 250;
const FPS = 30;

/** Chromium's insertable-streams track source; not in TypeScript's DOM library yet. */
interface FrameTrackGenerator extends MediaStreamTrack {
  readonly writable: WritableStream<VideoFrame>;
}
declare const MediaStreamTrackGenerator:
  | (new (init: { kind: 'video' }) => FrameTrackGenerator)
  | undefined;

/**
 * A video track of the program canvas at a steady frame rate.
 *
 * `canvas.captureStream()` only emits a frame when the browser paints the page, so it nearly
 * stops when the host switches tabs or the picture is still, and the encoder downstream then
 * stalls. Where the browser allows it (Chrome, Edge) we instead copy the canvas into the track
 * ourselves on a Worker timer, which keeps ticking in a background tab.
 */
function captureCanvas(canvas: HTMLCanvasElement): { track: MediaStreamTrack; stop(): void } {
  if (typeof MediaStreamTrackGenerator === 'undefined') {
    const track = canvas.captureStream(FPS).getVideoTracks()[0]!;
    return { track, stop: () => track.stop() };
  }

  const track = new MediaStreamTrackGenerator({ kind: 'video' });
  const writer = track.writable.getWriter();
  const ticker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' });
  ticker.onmessage = () => {
    // Drop the frame rather than queue it if the encoder is behind.
    if ((writer.desiredSize ?? 1) <= 0) return;
    const frame = new VideoFrame(canvas, { timestamp: performance.now() * 1000 });
    writer.write(frame).catch(() => undefined);
    frame.close();
  };
  ticker.postMessage(1000 / FPS);

  return {
    track,
    stop: () => {
      ticker.terminate();
      void writer.close().catch(() => undefined);
      track.stop();
    },
  };
}

function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error('Could not reach the streaming server'));
  });
}

export interface BroadcasterEvents {
  /** The stream stopped for any reason other than `stop()`. */
  onInterrupted(reason: string): void;
  /** The connection dropped and the broadcaster is getting it back; the platforms are waiting. */
  onReconnecting(): void;
  onReconnected(): void;
}

/**
 * Relay egress, browser side: records the program canvas plus the audio mix and streams the
 * chunks to the media worker, which transcodes and fans out to the platforms.
 *
 * A connection that drops is opened again with a fresh recording (the worker needs a stream that
 * starts from its header). The worker holds the broadcast open while that happens, so a network
 * blip or a worker restart costs the viewers a few seconds, not the broadcast.
 */
export class ProgramBroadcaster {
  private socket: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private capture: ReturnType<typeof captureCanvas> | null = null;
  private ingestUrl = '';
  private mimeType = '';
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mixer: AudioMixer,
    private readonly events: BroadcasterEvents,
  ) {}

  async start(ingestUrl: string): Promise<void> {
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This browser cannot record the program stream');
    this.ingestUrl = ingestUrl;
    this.mimeType = mimeType;

    const socket = await openSocket(ingestUrl);
    if (this.stopped) return void socket.close(1000);
    this.capture = captureCanvas(this.canvas);
    this.attach(socket);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const socket = this.socket;
    const recorder = this.recorder;
    this.socket = null;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      // Let the final chunk go out before closing the socket.
      recorder.onstop = () => socket?.close(1000);
      recorder.stop();
    } else {
      socket?.close(1000);
    }
    this.capture?.stop();
    this.capture = null;
  }

  /** Records onto this connection, from a fresh header. */
  private attach(socket: WebSocket): void {
    this.socket = socket;
    const recorder = new MediaRecorder(new MediaStream([this.capture!.track, this.mixer.track]), {
      mimeType: this.mimeType,
      // Well above what goes out: this copy is encoded again by the media worker, and should lose little here.
      videoBitsPerSecond: 12_000_000,
      audioBitsPerSecond: 160_000,
    });
    this.recorder = recorder;
    const stall = new StallWatch(STALL_LIMIT_MS, Date.now());
    recorder.ondataavailable = (event) => {
      if (this.socket !== socket || event.data.size === 0 || socket.readyState !== WebSocket.OPEN) return;
      if (stall.check(socket.bufferedAmount, Date.now())) {
        this.dropped(socket, 1006, '');
        return;
      }
      socket.send(event.data);
      stall.sent(socket.bufferedAmount);
    };
    socket.onclose = (event) => this.dropped(socket, event.code, event.reason);
    recorder.start(CHUNK_MS);
  }

  /** The connection is gone without `stop()`: get it back, or give up and say why. */
  private dropped(socket: WebSocket, code: number, reason: string): void {
    if (this.socket !== socket) return; // stop() was called, or this one was already let go.
    this.socket = null;
    socket.onclose = null;
    socket.close();
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;

    if (!shouldReconnect(code)) return this.interrupted(reason || 'The connection to the streaming server was lost');
    this.events.onReconnecting();
    void this.reconnect(Date.now() + RECONNECT_WINDOW_MS, 0);
  }

  private async reconnect(deadline: number, failures: number): Promise<void> {
    if (this.stopped) return;
    try {
      const socket = await openSocket(this.ingestUrl);
      if (this.stopped) return void socket.close(1000);
      this.attach(socket);
      this.events.onReconnected();
    } catch {
      const delay = reconnectDelay(failures);
      if (Date.now() + delay > deadline) {
        return this.interrupted('The connection to the streaming server was lost and could not be restored');
      }
      this.retryTimer = setTimeout(() => void this.reconnect(deadline, failures + 1), delay);
    }
  }

  private interrupted(reason: string): void {
    if (this.stopped) return;
    this.stop();
    this.events.onInterrupted(reason);
  }
}
