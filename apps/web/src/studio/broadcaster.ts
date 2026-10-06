/** Mixes the audio of everything on stage into one track for the program. */
export class AudioMixer {
  private readonly ctx = new AudioContext();
  private readonly out = this.ctx.createMediaStreamDestination();
  private readonly inputs = new Map<string, MediaStreamAudioSourceNode>();

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

/**
 * Relay egress, browser side: records the program canvas plus the audio mix and streams the
 * chunks to the media worker, which transcodes and fans out to the platforms.
 */
export class ProgramBroadcaster {
  private socket: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private capture: ReturnType<typeof captureCanvas> | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mixer: AudioMixer,
    /** Called when the stream stops for any reason other than `stop()`. */
    private readonly onInterrupted: (reason: string) => void,
  ) {}

  async start(ingestUrl: string): Promise<void> {
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This browser cannot record the program stream');

    const socket = new WebSocket(ingestUrl);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('Could not reach the streaming server'));
    });

    this.capture = captureCanvas(this.canvas);
    const recorder = new MediaRecorder(new MediaStream([this.capture.track, this.mixer.track]), {
      mimeType,
      videoBitsPerSecond: 5_000_000,
      audioBitsPerSecond: 160_000,
    });
    this.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(event.data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return; // stop() was called.
      this.release();
      this.onInterrupted(event.reason || 'The connection to the streaming server was lost');
    };
    recorder.start(CHUNK_MS);
  }

  stop(): void {
    const socket = this.socket;
    const recorder = this.recorder;
    this.socket = null;
    if (recorder && recorder.state !== 'inactive') {
      // Let the final chunk go out before closing the socket.
      recorder.onstop = () => socket?.close(1000);
    } else {
      socket?.close(1000);
    }
    this.release();
  }

  private release(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    this.capture?.stop();
    this.capture = null;
    this.socket = null;
  }
}
